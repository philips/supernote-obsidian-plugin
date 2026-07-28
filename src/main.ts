import { installAtPolyfill } from './polyfills';
import { App, Modal, Notice, TFile, Plugin, Editor, MarkdownView, MarkdownFileInfo, WorkspaceLeaf, FileView, Component, loadPdfJs, Scope, SearchComponent, setIcon, Platform } from 'obsidian';
import { SupernotePluginSettings, SupernoteSettingTab, DEFAULT_SETTINGS, ImportFormat } from './settings';
import { SupernoteX, ILink, fetchMirrorFrame, createPdfContext, addPdfPage } from 'supernote-typescript';
import { encode } from 'image-js';
import { DownloadListModal, UploadListModal } from './FileListModal';
import { ImportTodayModal } from './ImportTodayModal';
import { ErrorModal } from './ErrorModal';
import { SupernoteWorkerMessage, SupernoteWorkerResponse } from './myworker.worker';
import Worker from 'myworker.worker';
import { replaceTextWithCustomDictionary } from './customDictionary';
import { runDeviceSync, appendSyncLogEntry } from './syncEngine';
import { formatSyncFailureLogEntry } from './deviceSync';
import { parseLinkRect, bucketLinksByPage } from './linkOverlay';

function generateTimestamp(): string {
	const date = new Date();
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0'); // Add leading zero for single-digit months
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');

	const timestamp = `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
	return timestamp;
}

function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
    // Remove data URL prefix (e.g., "data:image/png;base64,")
    const base64 = dataUrl.split(',')[1];
    // Convert base64 to binary string
    const binaryString = atob(base64);
    // Create buffer and view
    const bytes = new Uint8Array(binaryString.length);
    // Convert binary string to buffer
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// app.fileManager.generateMarkdownLink() follows the vault's "Use Wikilinks"
// setting, producing `![[...]]` for users who have that on. The images here
// are ones we just created as attachments, so embed them with explicit
// markdown image syntax regardless of that setting, for a consistent,
// portable result. `alt` doubles as a CSS-selector hook (see styles.css)
// for the dark-mode color inversion toggle.
function generateMarkdownImageEmbed(app: App, file: TFile, sourcePath: string, alt = ''): string {
    const linktext = app.metadataCache.fileToLinktext(file, sourcePath);
    return `![${alt}](${encodeURI(linktext)})`;
}

// Uint8Array.buffer isn't safe to hand to APIs wanting a plain ArrayBuffer
// when the array is a view over a larger/offset buffer (not guaranteed for
// pdf-lib's PDFDocument.save() output, so don't assume it). This always
// returns a buffer sized to exactly this array's bytes.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// Assembles a PDF from pages already rasterized elsewhere (the `images`
// array from ImageConverter, used for thumbnails/save-to-vault/drag-out),
// instead of rasterizing a second time. addPdfPage() accepts pre-encoded PNG
// bytes directly, so this just needs to decode the data URLs already sitting
// in memory back to bytes (a cheap base64 decode, not a re-render) and hand
// them to the library's own createPdfContext/addPdfPage assembly.
async function assemblePdfFromImages(sn: SupernoteX, images: string[]): Promise<Uint8Array> {
    const ctx = await createPdfContext();
    for (let i = 0; i < sn.pages.length; i++) {
        const pngBytes = new Uint8Array(dataUrlToBuffer(images[i]));
        await addPdfPage(ctx, sn.pages[i], pngBytes);
    }
    return ctx.pdfDoc.save();
}

/**
 * Processes the Supernote text based on the provided settings.
 * 
 * @param text - The input text to be processed.
 * @param settings - The settings for the Supernote plugin.
 * @returns The processed text.
 */
function processSupernoteText(text: string, settings: SupernotePluginSettings): string {
	let processedText = text;
	if (settings.isCustomDictionaryEnabled) {
		processedText = replaceTextWithCustomDictionary(processedText, settings.customDictionary);
	}
	return processedText;
}

// Splits pageNumbers into at most `workerCount` chunks. Callers that then map
// chunks[i] -> workers[i % workers.length] are guaranteed each worker gets at
// most one chunk (chunks.length <= workers.length), so processing chunks
// concurrently via Promise.all never has two in-flight calls fighting over
// the same worker's onmessage handler.
function chunkPageNumbers(pageNumbers: number[], workerCount: number): number[][] {
    const chunkSize = Math.ceil(pageNumbers.length / workerCount);
    const chunks: number[][] = [];
    for (let i = 0; i < pageNumbers.length; i += chunkSize) {
        chunks.push(pageNumbers.slice(i, i + chunkSize));
    }
    return chunks;
}

export class WorkerPool {
    private workers: Worker[];

    constructor(private maxWorkers: number = navigator.hardwareConcurrency) {
        this.workers = Array(maxWorkers).fill(null).map(() =>
            new Worker()
        );
    }

    private processChunk(worker: Worker, note: SupernoteX, pageNumbers: number[]): Promise<string[]> {
        return new Promise((resolve, reject) => {
            worker.onmessage = (e: MessageEvent<SupernoteWorkerResponse>) => {
                if (e.data.type === 'error') {
                    reject(new Error(e.data.error));
                } else if (e.data.type === 'result') {
                    resolve(e.data.images);
                }
            };

            worker.onerror = (error) => {
                console.error('Worker error:', error);
                reject(new Error(error.message));
            };

            const message: SupernoteWorkerMessage = {
                type: 'convert',
                note,
                pageNumbers
            };

            worker.postMessage(message);
        });
    }

    async processPages(note: SupernoteX, allPageNumbers: number[]): Promise<string[]> {
        //console.time('Total processing time');

        const chunks = chunkPageNumbers(allPageNumbers, this.workers.length);

        //console.log(`Processing ${allPageNumbers.length} pages in ${chunks.length} chunks`);

        // Process chunks in parallel using available workers
        const results = await Promise.all(
            chunks.map((chunk, index) =>
                this.processChunk(this.workers[index % this.workers.length], note, chunk)
            )
        );

        //console.timeEnd('Total processing time');
        return results.flat();
    }

    terminate() {
        this.workers.forEach(worker => worker.terminate());
        this.workers = [];
    }
}

export class ImageConverter {
    private workerPool: WorkerPool;

    constructor(maxWorkers = navigator.hardwareConcurrency) {  // Default to 4 workers
        this.workerPool = new WorkerPool(maxWorkers);
    }

    async convertToImages(note: SupernoteX, pageNumbers?: number[]): Promise<string[]> {
        const pages = pageNumbers ?? Array.from({length: note.pages.length}, (_, i) => i+1);
        const results = await this.workerPool.processPages(note, pages);
        return results;
    }

    terminate() {
        this.workerPool.terminate();
    }
}

class VaultWriter {
	app: App;
	settings: SupernotePluginSettings;

	constructor(app: App, settings: SupernotePluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	async writeMarkdownFile(file: TFile, sn: SupernoteX, imgs: TFile[] | null) {
		let content = '';

		// Generate a non-conflicting filename - it has a bit of a race but that is OK
		let filename = `${file.parent?.path}/${file.basename}.md`;
		let i = 0;
		while (this.app.vault.getFileByPath(filename) !== null) {
			filename = `${file.parent?.path}/${file.basename} ${++i}.md`;
		}

		content = this.app.fileManager.generateMarkdownLink(file, filename);
		content += '\n';

		for (let i = 0; i < sn.pages.length; i++) {
			content += `## Page ${i + 1}\n\n`
			if (sn.pages[i].text !== undefined && sn.pages[i].text.length > 0) {
				content += `${processSupernoteText(sn.pages[i].text, this.settings)}\n`;
			}
			if (imgs) {
				let alt = '';
				if (this.settings.invertColorsWhenDark) {
					alt = 'supernote-invert-dark';
				}

				const link = generateMarkdownImageEmbed(this.app, imgs[i], filename, alt);
				content += `${link}\n`;
			}
		}

		await this.app.vault.create(filename, content);
	}

	async writeImageFiles(basename: string, sn: SupernoteX): Promise<TFile[]> {
		let images: string[] = [];

		const converter = new ImageConverter();
		try {
			images = await converter.convertToImages(sn);
		} finally {
			// Clean up the worker when done
			converter.terminate();
		}

		const imgs: TFile[] = [];
		for (let i = 0; i < images.length; i++) {
			const filename = await this.app.fileManager.getAvailablePathForAttachment(`${basename}-${i + 1}.png`);
			const buffer = dataUrlToBuffer(images[i]);
			imgs.push(await this.app.vault.createBinary(filename, buffer));
		}
		return imgs;
	}

	async attachMarkdownFile(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));

		await this.writeMarkdownFile(file, sn, null);
	}

	async attachNoteFiles(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));

		const imgs = await this.writeImageFiles(file.basename, sn);
		await this.writeMarkdownFile(file, sn, imgs);
	}

	/**
	 * Converts a Supernote .note file (fetched from a device, not yet in the
	 * vault) into the requested format and returns markdown for inserting it
	 * inline into another note, rather than creating a new .md file for it.
	 */
	async buildInsertableContent(deviceFileName: string, noteBuffer: ArrayBuffer, targetPath: string, format: ImportFormat): Promise<string> {
		const basename = deviceFileName.replace(/\.note$/i, '');

		// These two formats save the raw .note file itself into the vault and
		// point at it, rather than rasterizing pages, so they don't need to
		// touch SupernoteX/ImageConverter at all.
		if (format === 'note-link' || format === 'embed') {
			const filename = await this.app.fileManager.getAvailablePathForAttachment(deviceFileName);
			const tfile = await this.app.vault.createBinary(filename, noteBuffer);
			const link = this.app.fileManager.generateMarkdownLink(tfile, targetPath);
			return `${format === 'embed' ? '!' : ''}${link}\n`;
		}

		const sn = new SupernoteX(new Uint8Array(noteBuffer));

		if (format === 'pdf') {
			const converter = new ImageConverter();
			let images: string[] = [];
			try {
				images = await converter.convertToImages(sn);
			} finally {
				converter.terminate();
			}
			const pdfBytes = await assemblePdfFromImages(sn, images);
			const filename = await this.app.fileManager.getAvailablePathForAttachment(`${basename}.pdf`);
			const tfile = await this.app.vault.createBinary(filename, toArrayBuffer(pdfBytes));
			const link = this.app.fileManager.generateMarkdownLink(tfile, targetPath);
			return `${link}\n`;
		}

		const imgs = await this.writeImageFiles(basename, sn);
		return this.renderPagesMarkdown(basename, sn, imgs, targetPath, format);
	}

	// Shared page-by-page markdown body (heading + optional recognized text +
	// image embed) used by buildInsertableContent's images/images-text formats.
	private renderPagesMarkdown(basename: string, sn: SupernoteX, imgs: TFile[], targetPath: string, format: ImportFormat): string {
		let content = `## ${basename}\n\n`;
		for (let i = 0; i < sn.pages.length; i++) {
			content += `### Page ${i + 1}\n\n`;
			if (format === 'images-text' && sn.pages[i].text !== undefined && sn.pages[i].text.length > 0) {
				content += `${processSupernoteText(sn.pages[i].text, this.settings)}\n`;
			}

			let alt = '';
			if (this.settings.invertColorsWhenDark) {
				alt = 'supernote-invert-dark';
			}
			const link = generateMarkdownImageEmbed(this.app, imgs[i], targetPath, alt);
			content += `${link}\n`;
		}
		return content;
	}

	async exportToPDF(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));

		// Rasterizes across the Worker pool in parallel (same pass the other
		// export paths use), then assembles the PDF from those images rather
		// than rendering a second time.
		const converter = new ImageConverter();
		let images: string[] = [];
		try {
			images = await converter.convertToImages(sn);
		} finally {
			converter.terminate();
		}

		const pdfBytes = await assemblePdfFromImages(sn, images);

		// Generate filename and save
		const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}.pdf`);
		await this.app.vault.createBinary(filename, toArrayBuffer(pdfBytes));
	}
}

// Obsidian's loadPdfJs() returns `any` since it hands back whatever pdf.js
// build happens to be bundled with the user's Obsidian install, unpinned.
// These types cover just the subset of that API this file touches, so calls
// against it are type-checked without assuming a specific pdfjs-dist version
// that may not match what's actually loaded at runtime.
type PdfJsViewport = unknown; // opaque here — only ever handed back to pdf.js's own APIs

interface PdfJsTextContentItem {
	str?: string;
}

interface PdfJsTextContent {
	items: PdfJsTextContentItem[];
}

interface PdfJsPage {
	getViewport(params: { scale: number }): PdfJsViewport;
	getTextContent(): Promise<PdfJsTextContent>;
}

interface PdfJsDocument {
	getPage(pageNumber: number): Promise<PdfJsPage>;
}

interface PdfJsTextLayer {
	render(): Promise<void>;
}

interface PdfJsRenderTextLayerTask {
	promise: Promise<void>;
}

interface PdfJsLib {
	getDocument(params: { data: Uint8Array }): { promise: Promise<PdfJsDocument> };
	TextLayer?: new (params: { textContentSource: PdfJsTextContent; container: HTMLElement; viewport: PdfJsViewport }) => PdfJsTextLayer;
	renderTextLayer?: (params: { textContentSource: PdfJsTextContent; container: HTMLElement; viewport: PdfJsViewport }) => PdfJsRenderTextLayerTask;
}

// Renders a pdf.js text layer into `container`, preferring the modern
// `TextLayer` class (pdf.js >=3.4) and falling back to the older
// `renderTextLayer()` function on earlier bundles. Obsidian's `loadPdfJs()`
// only promises the core pdfjsLib, not a pinned version, so neither API is
// guaranteed — if neither exists, pages still render, they just lose
// selectable text and find-in-note for that session.
async function renderTextLayer(pdfjsLib: PdfJsLib, textContent: PdfJsTextContent, container: HTMLElement, viewport: PdfJsViewport): Promise<boolean> {
	container.empty();

	if (typeof pdfjsLib.TextLayer === 'function') {
		const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container, viewport });
		await textLayer.render();
		return true;
	}

	if (typeof pdfjsLib.renderTextLayer === 'function') {
		const task = pdfjsLib.renderTextLayer({ textContentSource: textContent, container, viewport });
		await task.promise;
		return true;
	}

	return false;
}

type PageRenderState = {
	pageNumber: number;
	// Fetched lazily — see SupernoteView.ensureTextLayer(). null until then.
	pdfPage: PdfJsPage | null;
	baseScale: number;
	nativeWidth: number;
	nativeHeight: number;
	pageContainer: HTMLElement;
	canvasWrap: HTMLElement;
	canvas: HTMLCanvasElement;
	textLayerDiv: HTMLElement;
	linksLayerDiv: HTMLElement;
	// Rendered once at page-build time, in native (unscaled) page-pixel
	// coordinates; repositioned to the current CSS pixel size on every
	// drawPageImage() call (initial render + each zoom redraw) — see
	// positionLinkOverlay().
	linkEls: { el: HTMLElement; rect: [number, number, number, number] }[];
	// Decoded once from the already-rasterized page image and reused for
	// every zoom redraw (see drawPageImage()) — no pdf.js/decode work on the
	// zoom-critical path.
	imageBitmap: ImageBitmap | null;
	// Guards ensureTextLayer()'s one-time (per page) work.
	textLayerLoaded: boolean;
	text: string;
	spans: HTMLSpanElement[];
};

type FindMatch = {
	pageIndex: number;
	spanIndex: number;
};

let vw: VaultWriter;
export const VIEW_TYPE_SUPERNOTE = "supernote-view";

export class SupernoteView extends FileView {
	declare file: TFile;
	settings: SupernotePluginSettings;

	private pdfjsLib: PdfJsLib | null = null;
	private pageStates: PageRenderState[] = [];
	private pagesEl: HTMLElement | null = null;
	// This file's own pages' PAGEIDs, 0-indexed to match pageStates — lets a
	// same-file link's PAGEID resolve to a page number without retaining the
	// whole parsed SupernoteX. See handleLinkClick().
	private pageIds: string[] = [];

	private zoomScale = 1;
	private renderedZoomScale = 1;
	private zoomDebounceTimer: number | undefined;
	private zoomLabelEl: HTMLElement | null = null;
	// True from the moment setZoom() schedules a debounced commitZoom() until
	// that commit actually redraws pages at their final size. goToPage() waits
	// this out — see waitForZoomToSettle() for why.
	private zoomCommitPending = false;
	private zoomSettleResolvers: Array<() => void> = [];

	private fitWidthEnabled = true;
	private fitWidthBtn: HTMLElement | null = null;
	private fitWidthDebounceTimer: number | undefined;
	private resizeObserver: ResizeObserver | null = null;

	// The combined PDF (image + invisible RTR text per page) is assembled
	// and loaded into pdf.js in the background, not awaited before the first
	// paint — pages are visible immediately from their own rasterized image
	// (see drawPageImage()), which doesn't depend on this at all. Only the
	// text layer (selection/search) needs it, and only when a given page is
	// actually loaded — see ensureTextLayer()/pageObserver.
	private pdfDocPromise: Promise<PdfJsDocument> | null = null;
	private pageObserver: IntersectionObserver | null = null;

	private layerMode: 'image' | 'text' = 'image';
	private imageModeBtn: HTMLElement | null = null;
	private textModeBtn: HTMLElement | null = null;

	private thumbnailsVisible = false;
	private thumbToggleBtn: HTMLElement | null = null;
	private thumbSidebarEl: HTMLElement | null = null;
	private thumbItems: HTMLElement[] = [];

	private headerEl: HTMLElement | null = null;
	private pageJumpInput: HTMLInputElement | null = null;
	private scrollUpdateScheduled = false;

	private findToggleBtn: HTMLElement | null = null;
	private findBarEl: HTMLElement | null = null;
	private findInput: SearchComponent | null = null;
	private findMatchCountEl: HTMLElement | null = null;
	private findMatches: FindMatch[] = [];
	private findMatchCursor = -1;
	private findRequestId = 0;

	constructor(leaf: WorkspaceLeaf, settings: SupernotePluginSettings) {
		super(leaf);
		this.settings = settings;
		// Documented pattern (obsidian.d.ts View.scope) for registering hotkeys
		// that are only active while this view has focus.
		this.scope = new Scope(this.app.scope);
	}

	getViewType() {
		return VIEW_TYPE_SUPERNOTE;
	}

	getDisplayText() {
		if (!this.file) {
			return "Supernote view"
		}
		return this.file.basename;
	}

	// Obsidian delivers a link's `#page=N` subpath here — for both
	// `[[file.note#page=8]]` and `[text](file.note#page=8)` — once setState()
	// (which awaits onLoadFile(), so pageStates is already populated) has
	// resolved. Mirrors the anchor SupernoteEmbed accepts for embeds; see
	// parsePageAnchor().
	setEphemeralState(state: unknown): void {
		const subpath = (state as { subpath?: string } | undefined)?.subpath;
		const page = parsePageAnchor(subpath);
		if (page !== null) void this.goToPage(page);
	}

	async onOpen(): Promise<void> {
		// Scopes styles.css's button.mod-cta display:block rule to just this
		// view, instead of it applying to every CTA button in Obsidian (see
		// issue #74 — an unscoped rule shifted button text down app-wide).
		this.contentEl.addClass('supernote-view-content');

		// Obsidian's .view-content has its own top padding, leaving a gap
		// above the sticky toolbar. A previous attempt cancelled it with a
		// negative margin on the (sticky) header itself, which fought with
		// `position: sticky`'s own positioning math and let page content
		// render through/above the stuck toolbar instead. Zeroing the
		// ancestor's padding directly avoids combining sticky with a negative
		// margin at all; .supernote-header's own (positive, sticky-safe)
		// padding-top puts a little breathing room back.
		this.contentEl.setCssStyles({ paddingTop: '0' });

		this.scope?.register(['Mod'], 'f', (evt) => {
			evt.preventDefault();
			this.toggleFindBar();
			return false;
		});

		// Ctrl+scroll to zoom (trackpad pinch-to-zoom is reported as a wheel
		// event with ctrlKey set, on every platform); plain scroll keeps paging
		// through the note as before. contentEl persists across file loads
		// (onLoadFile only rebuilds its children), so this only needs
		// registering once.
		//
		// Deliberately NOT metaKey (Cmd on macOS): Cmd is also the modifier
		// held down through a whole Cmd+Tab app switch, and a wheel event from
		// scroll momentum/inertia that happens to fire mid-switch — nothing to
		// do with zooming — would still carry metaKey:true and get treated as
		// a zoom gesture. Trackpad pinch never sets metaKey, only ctrlKey, so
		// dropping metaKey here loses nothing for the gesture this is actually
		// meant to support.
		this.registerDomEvent(this.contentEl, 'wheel', (evt: WheelEvent) => {
			if (!evt.ctrlKey) return;
			evt.preventDefault();

			// Trackpads report a pinch-to-zoom gesture as a wheel event with
			// ctrlKey set — the same flag an ordinary two-finger scroll can
			// spuriously carry for a stray event or two right as the scroll
			// hits a boundary (e.g. scrolling up to the very top). A fixed
			// per-event zoom step let a short burst of those misfires snowball
			// straight to the zoom cap. Scaling the step by the event's own
			// deltaY keeps a real, sustained pinch feeling responsive while
			// capping how much a single misfired event can do.
			const factor = Math.min(1.05, Math.max(0.95, 1 - evt.deltaY * 0.01));
			this.setZoom(this.zoomScale * factor);
		}, { passive: false });

		// Keep the toolbar's page number in sync with whatever page is actually
		// scrolled into view, rAF-throttled since scroll fires very frequently.
		this.registerDomEvent(this.contentEl, 'scroll', () => {
			if (this.scrollUpdateScheduled) return;
			this.scrollUpdateScheduled = true;
			window.requestAnimationFrame(() => {
				this.scrollUpdateScheduled = false;
				this.updateCurrentPageIndicator();
			});
		}, { passive: true });

		// While "Fit width" is on, keep the page matched to however much room
		// is actually available as the pane resizes (split panes, sidebars
		// opening/closing, window resize) — not just at the moment it was
		// turned on. Debounced since resize fires continuously while dragging.
		this.resizeObserver = new ResizeObserver(() => {
			if (!this.fitWidthEnabled) return;
			window.clearTimeout(this.fitWidthDebounceTimer);
			this.fitWidthDebounceTimer = window.setTimeout(() => this.applyFitWidth(), 150);
		});
		this.resizeObserver.observe(this.contentEl);

		// Loads each page's selectable text lazily, only once it's about to
		// scroll into view (rootMargin prefetches a screen ahead/behind so it
		// feels instant by the time you actually get there) — for a long note,
		// building N pages' worth of text-layer DOM upfront is real, mostly
		// wasted work if you only ever look at the first few. Re-observes
		// fresh page containers each file load; see onLoadFile().
		this.pageObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const state = this.pageStates.find((s) => s.pageContainer === entry.target);
				if (state) void this.ensureTextLayer(state);
			}
		}, { root: this.contentEl, rootMargin: '100% 0px' });
	}

	async onLoadFile(file: TFile): Promise<void> {
		const container = this.contentEl;
		container.empty();

		window.clearTimeout(this.zoomDebounceTimer);
		this.pageObserver?.disconnect();
		this.pageStates = [];
		this.zoomScale = 1;
		this.renderedZoomScale = 1;
		this.findMatches = [];
		this.findMatchCursor = -1;
		// Invalidates any in-flight runFind() from a file the user just
		// navigated away from, so it can't resolve later and touch this one's
		// (unrelated) pageStates.
		this.findRequestId++;

		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));
		this.pageIds = sn.pages.map((p) => p.PAGEID ?? '');
		const linksByPage = bucketLinksByPage(sn.links);
		let images: string[] = [];

		const converter = new ImageConverter();
		try {
			images = await converter.convertToImages(sn);
		} finally {
			// Clean up the worker when done
			converter.terminate();
		}

		// Kicked off now but not awaited: pages are visible immediately from
		// their own rasterized image (drawPageImage(), no pdf.js involved at
		// all), so there's no reason to block the first paint on assembling a
		// PDF and loading it into pdf.js. Only the text layer (selection/
		// search) needs this, lazily, per page — see ensureTextLayer().
		this.pdfDocPromise = (async () => {
			const pdfBytes = await assemblePdfFromImages(sn, images);
			this.pdfjsLib = await loadPdfJs() as PdfJsLib;
			return this.pdfjsLib.getDocument({ data: pdfBytes }).promise;
		})();

		if (this.settings.showExportButtons) {
			const exportNoteBtn = container.createEl("p").createEl("button", {
				text: "Attach Markdown to vault",
				cls: "mod-cta",
			});

			exportNoteBtn.addEventListener("click", () => {
				void vw.attachMarkdownFile(file);
			});

			const exportAllBtn = container.createEl("p").createEl("button", {
				text: "Attach Markdown and images to vault",
				cls: "mod-cta",
			});

			exportAllBtn.addEventListener("click", () => {
				void vw.attachNoteFiles(file);
			});

			const exportPDFBtn = container.createEl("p").createEl("button", {
				text: "Attach as PDF",
				cls: "mod-cta",
			});

			exportPDFBtn.addEventListener("click", () => {
				void vw.exportToPDF(file);
			});
		}

		// Sticky header so the toolbar (and find bar, when open) stay visible
		// while scrolling through a long note instead of scrolling away with it.
		this.headerEl = container.createDiv({ cls: 'supernote-header' });
		this.buildToolbar(this.headerEl, images.length);
		this.buildFindBar(this.headerEl);
		this.updateThumbSidebarOffset();

		const body = container.createDiv({ cls: 'supernote-body' });
		this.buildThumbSidebar(body, images);

		this.pagesEl = body.createDiv({ cls: 'supernote-pages' });
		this.pagesEl.toggleClass('supernote-mode-text', this.layerMode === 'text');

		// Same for every page in a note (sn.pageWidth/pageHeight are note-level,
		// not per-page) — computed once from data already in memory, no pdf.js
		// or rasterization needed just to know how big to lay pages out.
		const baseScale = this.settings.noteImageMaxDim / Math.max(sn.pageWidth, sn.pageHeight);

		for (let i = 0; i < images.length; i++) {
			const imageDataUrl = images[i];

			const pageContainer = this.pagesEl.createDiv({
				cls: 'page-container',
			})

			const canvasWrap = pageContainer.createDiv({ cls: 'supernote-canvas-wrap' });
			const canvas = canvasWrap.createEl("canvas");
			if (this.settings.invertColorsWhenDark) {
				canvas.addClass("supernote-invert-dark");
			}

			// Canvas doesn't get native image drag-out the way <img> did; wire it up
			// manually against the same page PNG the canvas is rendered from. This
			// is best-effort — worth confirming it actually reproduces useful
			// drag-and-drop behavior in a real vault, since the pre-canvas <img>
			// drag may not have produced a proper vault attachment link either.
			canvas.draggable = true;
			canvas.addEventListener('dragstart', (evt) => {
				if (!evt.dataTransfer) return;
				evt.dataTransfer.setData('text/uri-list', imageDataUrl);
				evt.dataTransfer.setData('text/plain', imageDataUrl);
				evt.dataTransfer.setDragImage(canvas, 0, 0);
			});

			const textLayerDiv = canvasWrap.createDiv({ cls: 'textLayer' });
			const linksLayerDiv = canvasWrap.createDiv({ cls: 'supernote-links-layer' });

			const state: PageRenderState = {
				pageNumber: i + 1,
				pdfPage: null,
				baseScale,
				nativeWidth: sn.pageWidth,
				nativeHeight: sn.pageHeight,
				pageContainer,
				canvasWrap,
				canvas,
				textLayerDiv,
				linksLayerDiv,
				linkEls: [],
				imageBitmap: null,
				textLayerLoaded: false,
				text: '',
				spans: [],
			};
			this.pageStates.push(state);

			for (const link of linksByPage.get(i) ?? []) {
				const rect = parseLinkRect(link.LINKRECT);
				if (!rect) continue;
				const el = linksLayerDiv.createEl('a', {
					cls: 'supernote-link-rect',
					attr: { href: '#', title: link.text },
				});
				el.addEventListener('click', (evt) => {
					evt.preventDefault();
					void this.handleLinkClick(link);
				});
				state.linkEls.push({ el, rect });
			}

			// Decodes the same PNG already sitting in `images[i]` — no pdf.js,
			// no re-rasterization. Cached on the state and reused for every
			// zoom redraw (drawPageImage()).
			const blob = new Blob([dataUrlToBuffer(imageDataUrl)], { type: 'image/png' });
			state.imageBitmap = await createImageBitmap(blob);
			this.drawPageImage(state, baseScale * this.zoomScale);

			this.pageObserver?.observe(pageContainer);

			// Create a button to save image to vault
			if (this.settings.showExportButtons) {
				const saveButton = pageContainer.createEl("button", {
					text: "Save image to vault",
					cls: "mod-cta",
				});

				saveButton.addEventListener("click", () => void (async () => {
					const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}-${i + 1}.png`);
					const buffer = dataUrlToBuffer(imageDataUrl);
					await this.app.vault.createBinary(filename, buffer);
				})());
			}
		}

		if (this.fitWidthEnabled) {
			this.applyFitWidth();
		}
		this.updateCurrentPageIndicator();
	}

	// Draws the page's own already-decoded bitmap at the given scale — no
	// pdf.js involved. Synchronous (drawImage from an ImageBitmap doesn't
	// need awaiting), so redrawing on every zoom tick is cheap; pdf.js's own
	// pdfPage.render() had to redecode the embedded PDF image every time.
	private drawPageImage(state: PageRenderState, scale: number) {
		const width = Math.max(1, Math.round(state.nativeWidth * scale));
		const height = Math.max(1, Math.round(state.nativeHeight * scale));

		// The canvas's backing store (width/height attributes) previously
		// matched its CSS display size 1:1, so on a high-DPR mobile screen the
		// browser had to upscale it to cover the physical pixels — the "chunky
		// artifacts" that make handwritten strokes hard to read. Rendering the
		// backing store at devicePixelRatio and leaving the CSS size alone
		// (via explicit style, since an unstyled <canvas> otherwise takes its
		// size from its width/height attributes) fixes that; capped at 3 so an
		// extreme DPR display doesn't blow up canvas memory for no visible
		// benefit.
		const dpr = Math.min(window.devicePixelRatio || 1, 3);
		const bitmapWidth = Math.max(1, Math.round(width * dpr));
		const bitmapHeight = Math.max(1, Math.round(height * dpr));

		state.canvas.width = bitmapWidth;
		state.canvas.height = bitmapHeight;
		state.canvas.setCssStyles({ width: `${width}px`, height: `${height}px` });
		state.canvasWrap.setCssStyles({ width: `${width}px`, height: `${height}px` });
		state.textLayerDiv.setCssStyles({ width: `${width}px`, height: `${height}px` });
		state.linksLayerDiv.setCssStyles({ width: `${width}px`, height: `${height}px` });
		this.positionLinkOverlay(state, width, height);

		if (state.imageBitmap) {
			state.canvas.getContext("2d")?.drawImage(state.imageBitmap, 0, 0, bitmapWidth, bitmapHeight);
		}
	}

	// Repositions each link's clickable region to the page's current CSS
	// pixel size — called on initial render and every zoom redraw (see
	// drawPageImage()). LINKRECT is stored in native (unscaled) page-pixel
	// coordinates, the same space as nativeWidth/nativeHeight, so one scale
	// factor (derived from the page's current rendered width, same source as
	// canvas/textLayerDiv's own sizing above) maps rect -> CSS px.
	private positionLinkOverlay(state: PageRenderState, width: number, height: number) {
		if (state.linkEls.length === 0) return;
		const scaleX = width / state.nativeWidth;
		const scaleY = height / state.nativeHeight;
		for (const { el, rect } of state.linkEls) {
			const [x, y, w, h] = rect;
			el.setCssStyles({
				left: `${x * scaleX}px`,
				top: `${y * scaleY}px`,
				width: `${w * scaleX}px`,
				height: `${h * scaleY}px`,
			});
		}
	}

	// (Re)builds the selectable/searchable text layer at the given viewport.
	// Shared by ensureTextLayer() (first load) and commitZoom() (rebuild at
	// the new scale for pages that were already loaded).
	private async buildTextLayerForState(pdfPage: PdfJsPage, state: PageRenderState, viewport: PdfJsViewport): Promise<void> {
		const textContent = await pdfPage.getTextContent();
		state.text = textContent.items.map(item => item.str ?? '').join('');

		const hasTextLayer = this.pdfjsLib
			? await renderTextLayer(this.pdfjsLib, textContent, state.textLayerDiv, viewport)
			: false;
		state.spans = hasTextLayer ? Array.from(state.textLayerDiv.querySelectorAll('span')) : [];
	}

	// Loads this page's text layer if it hasn't been already — triggered by
	// pageObserver as a page nears the viewport, or forced immediately by
	// page-jump/thumbnail-click/find-in-note so those don't have to wait on
	// scroll+observer timing. Idempotent and safe to call speculatively.
	private async ensureTextLayer(state: PageRenderState): Promise<void> {
		if (state.textLayerLoaded) return;
		state.textLayerLoaded = true; // set eagerly: no double-trigger race

		try {
			const pdfDoc = await this.pdfDocPromise;
			if (!pdfDoc) return;

			if (!state.pdfPage) {
				state.pdfPage = await pdfDoc.getPage(state.pageNumber);
			}
			const pdfPage = state.pdfPage;

			const viewport = pdfPage.getViewport({ scale: state.baseScale * this.zoomScale });
			await this.buildTextLayerForState(pdfPage, state, viewport);
		} catch (error) {
			console.error(`Failed to build text layer for page ${state.pageNumber}:`, error);
		}
	}

	private buildToolbar(container: HTMLElement, pageCount: number) {
		this.pageJumpInput = null;
		const toolbar = container.createDiv({ cls: 'supernote-toolbar' });

		if (pageCount > 1) {
			const thumbGroup = toolbar.createDiv({ cls: 'supernote-toolbar-group' });
			this.thumbToggleBtn = thumbGroup.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Toggle page thumbnails' } });
			setIcon(this.thumbToggleBtn, 'layout-list');
			this.thumbToggleBtn.addEventListener('click', () => this.toggleThumbnails());
		}

		const zoomGroup = toolbar.createDiv({ cls: 'supernote-toolbar-group' });
		const zoomOutBtn = zoomGroup.createEl('button', { text: '−', cls: 'clickable-icon', attr: { 'aria-label': 'Zoom out' } });
		this.zoomLabelEl = zoomGroup.createSpan({ cls: 'supernote-zoom-label', text: '100%' });
		const zoomInBtn = zoomGroup.createEl('button', { text: '+', cls: 'clickable-icon', attr: { 'aria-label': 'Zoom in' } });
		const zoomResetBtn = zoomGroup.createEl('button', { text: 'Reset zoom', cls: 'clickable-icon' });
		this.fitWidthBtn = zoomGroup.createEl('button', { text: 'Fit width', cls: 'clickable-icon', attr: { 'aria-label': 'Fit page to viewport width' } });

		zoomOutBtn.addEventListener('click', () => this.setZoom(this.zoomScale / 1.25));
		zoomInBtn.addEventListener('click', () => this.setZoom(this.zoomScale * 1.25));
		zoomResetBtn.addEventListener('click', () => this.setZoom(1));
		this.fitWidthBtn.addEventListener('click', () => {
			this.fitWidthEnabled = !this.fitWidthEnabled;
			if (this.fitWidthEnabled) {
				this.applyFitWidth();
			}
			this.updateFitWidthButton();
		});
		this.updateFitWidthButton();

		const layerGroup = toolbar.createDiv({ cls: 'supernote-toolbar-group' });
		this.imageModeBtn = layerGroup.createEl('button', { text: 'Image', cls: 'clickable-icon', attr: { 'aria-label': 'Show page image' } });
		this.textModeBtn = layerGroup.createEl('button', { text: 'Text', cls: 'clickable-icon', attr: { 'aria-label': 'Show recognized text' } });
		this.imageModeBtn.addEventListener('click', () => this.setLayerMode('image'));
		this.textModeBtn.addEventListener('click', () => this.setLayerMode('text'));
		this.updateLayerModeButtons();

		// Mod+F (registered in onOpen) already toggles the find bar, but that
		// hotkey has no mobile equivalent — without a button, search is
		// unreachable on touch devices. Toolbar button covers both.
		const findGroup = toolbar.createDiv({ cls: 'supernote-toolbar-group' });
		this.findToggleBtn = findGroup.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Find in note' } });
		setIcon(this.findToggleBtn, 'search');
		this.findToggleBtn.addEventListener('click', () => this.toggleFindBar());

		if (pageCount > 1) {
			const jumpGroup = toolbar.createDiv({ cls: 'supernote-toolbar-group' });
			jumpGroup.createSpan({ text: 'Page', cls: 'supernote-page-jump-label' });
			const pageInput = jumpGroup.createEl('input', {
				cls: 'supernote-page-jump-input',
				attr: { type: 'number', min: '1', max: String(pageCount), value: '1' },
			});
			this.pageJumpInput = pageInput;
			jumpGroup.createSpan({ text: `/ ${pageCount}`, cls: 'supernote-page-jump-total' });

			const jumpToPage = () => {
				const requested = Number(pageInput.value);
				if (!Number.isFinite(requested)) return;
				void this.goToPage(Math.round(requested));
			};

			pageInput.addEventListener('keydown', (evt: KeyboardEvent) => {
				if (evt.key === 'Enter') {
					evt.preventDefault();
					jumpToPage();
				}
			});
			pageInput.addEventListener('blur', jumpToPage);
		}
	}

	private setLayerMode(mode: 'image' | 'text') {
		this.layerMode = mode;
		this.pagesEl?.toggleClass('supernote-mode-text', mode === 'text');
		this.updateLayerModeButtons();
	}

	private updateLayerModeButtons() {
		this.imageModeBtn?.toggleClass('is-active', this.layerMode === 'image');
		this.textModeBtn?.toggleClass('is-active', this.layerMode === 'text');
	}

	// Reuses the same page PNGs already generated for the save-to-vault/
	// drag-out buttons — no separate low-res render pass, just let CSS scale
	// them down. Built up front (images are ready before pdf.js even starts),
	// independent of the pdf.js page-render loop below.
	private buildThumbSidebar(body: HTMLElement, images: string[]) {
		const thumbSidebarEl = body.createDiv({ cls: 'supernote-thumb-sidebar' });
		this.thumbSidebarEl = thumbSidebarEl;
		this.thumbItems = [];

		images.forEach((dataUrl, i) => {
			const item = thumbSidebarEl.createDiv({ cls: 'supernote-thumb-item' });
			const img = item.createEl('img', { cls: 'supernote-thumb-img' });
			img.src = dataUrl;
			item.createSpan({ cls: 'supernote-thumb-label', text: String(i + 1) });

			item.addEventListener('click', () => {
				void this.goToPage(i + 1);
			});

			this.thumbItems.push(item);
		});

		this.applyThumbSidebarVisibility();
	}

	private toggleThumbnails() {
		this.thumbnailsVisible = !this.thumbnailsVisible;
		this.applyThumbSidebarVisibility();
	}

	private applyThumbSidebarVisibility() {
		this.thumbSidebarEl?.toggle(this.thumbnailsVisible);
		this.thumbToggleBtn?.toggleClass('is-active', this.thumbnailsVisible);
		if (this.thumbnailsVisible) this.updateThumbSidebarOffset();

		// Showing/hiding the sidebar changes how much horizontal room pagesEl
		// actually has, but that's an internal flex redistribution within
		// contentEl, not a change to contentEl's own box — the ResizeObserver
		// driving auto-refit on window/pane resize never fires for it. Without
		// this, a page already fit to the full width just sits there too wide
		// once the sidebar eats into that space, spilling into horizontal
		// scroll instead of shrinking to match.
		if (this.fitWidthEnabled) {
			this.applyFitWidth();
		}
	}

	// The thumbnail sidebar is sticky below the header, not at top:0 like the
	// header itself — otherwise it would stick right under the top edge of
	// the view, overlapping the header instead of sitting below it. The find
	// bar toggling open/closed changes the header's height, so this needs
	// re-running whenever that happens, not just once at load.
	private updateThumbSidebarOffset() {
		if (!this.thumbSidebarEl) return;
		const headerHeight = this.headerEl?.offsetHeight ?? 0;
		this.thumbSidebarEl.setCssStyles({ top: `${headerHeight}px` });
	}

	private highlightThumbnail(index: number) {
		this.thumbItems.forEach((item, i) => item.toggleClass('is-active', i === index));
	}

	// Shared by the toolbar's page-jump input, the thumbnail sidebar, and
	// setEphemeralState() (a `#page=N` link anchor) — all three just need to
	// scroll a given 1-indexed page into view and prime its text layer.
	private async goToPage(pageNumber: number): Promise<void> {
		if (this.pageStates.length === 0) return;
		// Wait out any in-flight fit-width/zoom re-render first — see
		// waitForZoomToSettle() for why scrolling before it settles can land on
		// the wrong page.
		await this.waitForZoomToSettle();
		if (this.pageStates.length === 0) return;
		const clamped = Math.min(this.pageStates.length, Math.max(1, pageNumber));
		const state = this.pageStates[clamped - 1];
		if (!state) return;
		state.pageContainer.scrollIntoView({ block: 'start', behavior: 'smooth' });
		// Don't wait on scroll+observer timing for a page the user (or link)
		// explicitly asked to jump to.
		void this.ensureTextLayer(state);
		if (this.pageJumpInput) this.pageJumpInput.value = String(clamped);
	}

	// A clicked link region's target: same-file (jump in place via goToPage)
	// when its basename matches this file, or another vault note (open via a
	// new leaf, reusing the `#page=N` ephemeral-state anchor that regular
	// `[[note#page=N]]` links already use — see setEphemeralState()). Basename
	// matching against the vault mirrors VaultWriter.resolvePageAnchor()'s
	// export-time link resolution (see PR #122), so a link resolves the same
	// note whether you're viewing it live or exporting it; ambiguous if two
	// vault notes share a basename in different folders, same known
	// limitation as that export path.
	private async handleLinkClick(link: ILink): Promise<void> {
		const targetBasename = link.text.split('#')[0];
		const pageid = link.PAGEID;

		if (!targetBasename || targetBasename === this.file.basename) {
			const pageIndex = this.pageIds.findIndex((id) => id === pageid);
			if (pageIndex >= 0) void this.goToPage(pageIndex + 1);
			return;
		}

		const targetFile = this.app.vault.getFiles().find((f) => f.extension === 'note' && f.basename === targetBasename);
		if (!targetFile) {
			new Notice(`Linked note "${targetBasename}.note" not found in vault.`);
			return;
		}

		let subpath: string | undefined;
		if (pageid && pageid !== '0' && pageid !== 'none') {
			try {
				const buffer = await this.app.vault.readBinary(targetFile);
				const pageIndex = new SupernoteX(new Uint8Array(buffer)).pages.findIndex((p) => p.PAGEID === pageid);
				if (pageIndex >= 0) subpath = `#page=${pageIndex + 1}`;
			} catch {
				// Malformed target file — fall through and open without a page anchor.
			}
		}

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(targetFile, subpath ? { eState: { subpath } } : undefined);
	}

	// Scrollspy: find the last page whose top has scrolled up past the sticky
	// header, and reflect it in the toolbar's page number — unless the user is
	// actively typing in that field themselves.
	private updateCurrentPageIndicator() {
		if (!this.pageJumpInput || this.pageStates.length === 0) return;
		if (document.activeElement === this.pageJumpInput) return;

		const headerHeight = this.headerEl?.offsetHeight ?? 0;
		const threshold = this.contentEl.getBoundingClientRect().top + headerHeight + 1;

		let current = 0;
		for (let i = 0; i < this.pageStates.length; i++) {
			if (this.pageStates[i].pageContainer.getBoundingClientRect().top <= threshold) {
				current = i;
			} else {
				break;
			}
		}

		this.pageJumpInput.value = String(current + 1);
		this.highlightThumbnail(current);
	}

	private setZoom(newScale: number, opts: { manual?: boolean } = {}) {
		const isManual = opts.manual !== false;
		if (isManual) {
			// Any direct zoom action (buttons, wheel, reset) is the user taking
			// manual control — stop auto-adjusting on resize until they ask for
			// fit-width again. applyFitWidth() itself calls in with manual:false
			// so it doesn't immediately cancel the mode it's trying to apply.
			this.fitWidthEnabled = false;
			this.updateFitWidthButton();
		}

		// Floor lowered from a former 0.25: "Fit width" (on by default) computes
		// whatever zoom is needed to match the available viewport width, and on
		// a narrow mobile screen — especially with the thumbnail sidebar open,
		// or a wide/landscape note — that can legitimately need to go below
		// 25%. Clamping it there just forced horizontal scrolling instead.
		//
		// The 500% ceiling only makes sense for *manual* zoom (a sanity cap on
		// how far a user should zoom in by hand). "100%" here is only ever
		// relative to noteImageMaxDim — an arbitrary default render size, not
		// the note's true resolution or the available viewport — so a large or
		// high-resolution display can legitimately need well over 5x to
		// actually fill it with "Fit width". Applying the same 500% ceiling
		// there just left the page stuck at a fixed pixel width regardless of
		// how much wider the pane actually was, while showing a confusing
		// pinned "500%" (see issue #108). Fit width instead gets a much higher
		// ceiling, purely as a guard against a pathological render (e.g. a
		// zero-width native page) rather than a real intended limit.
		const ceiling = isManual ? 5 : 20;
		this.zoomScale = Math.min(ceiling, Math.max(0.05, newScale));
		this.zoomLabelEl?.setText(`${Math.round(this.zoomScale * 100)}%`);

		// Instant CSS-scale feedback while the user is still zooming; the real
		// re-render (crisp at the new resolution, text layer repositioned) is
		// debounced below so rapid wheel/button input doesn't thrash pdf.js.
		const instantFactor = this.zoomScale / this.renderedZoomScale;
		for (const state of this.pageStates) {
			state.canvasWrap.setCssStyles({ transform: `scale(${instantFactor})`, transformOrigin: 'top left' });
		}

		window.clearTimeout(this.zoomDebounceTimer);
		this.zoomCommitPending = true;
		this.zoomDebounceTimer = window.setTimeout(() => void this.commitZoom(), 200);
	}

	private async commitZoom(): Promise<void> {
		const targetZoom = this.zoomScale;
		for (const state of this.pageStates) {
			this.drawPageImage(state, state.baseScale * targetZoom);
			state.canvasWrap.setCssStyles({ transform: '', transformOrigin: '' });

			// Only rebuild the text layer for pages that already had one —
			// pages not yet loaded (ensureTextLayer() never ran) will build
			// theirs at whatever zoom is current when they eventually do.
			if (state.textLayerLoaded && state.pdfPage) {
				const pdfPage = state.pdfPage;
				const viewport = pdfPage.getViewport({ scale: state.baseScale * targetZoom });
				await this.buildTextLayerForState(pdfPage, state, viewport);
			}
		}
		this.renderedZoomScale = targetZoom;
		this.updateCurrentPageIndicator();

		this.zoomCommitPending = false;
		const resolvers = this.zoomSettleResolvers;
		this.zoomSettleResolvers = [];
		resolvers.forEach((resolve) => resolve());
	}

	// Until commitZoom() runs, page containers are still sized at whatever
	// zoom was rendered *before* the pending setZoom() call (the interim CSS
	// transform scale it applies for instant visual feedback doesn't change
	// their layout box). onLoadFile() calls applyFitWidth() as soon as pages
	// are built, so a page-anchor link (setEphemeralState() -> goToPage(),
	// firing right as that file finishes loading) can easily land its
	// scrollIntoView() before fit-width's real re-render — using page heights
	// that are about to change once commitZoom() actually fires, and landing
	// on the wrong page once they do. Waiting this out first keeps
	// scrollIntoView() targeting final, stable page positions.
	private async waitForZoomToSettle(): Promise<void> {
		if (!this.zoomCommitPending) return;
		await new Promise<void>((resolve) => this.zoomSettleResolvers.push(resolve));
	}

	// Scales the page so its rendered width matches however much horizontal
	// space is actually available (pagesEl's content box, which already
	// accounts for the thumbnail sidebar if it's open) minus the page
	// container's own margin, rather than the fixed noteImageMaxDim cap.
	private applyFitWidth() {
		const state = this.pageStates[0];
		if (!state || !this.pagesEl || state.nativeWidth <= 0) return;

		const availableWidth = this.pagesEl.clientWidth;
		if (availableWidth <= 0) return;

		const containerStyle = getComputedStyle(state.pageContainer);
		const horizontalMargin = parseFloat(containerStyle.marginLeft || '0') + parseFloat(containerStyle.marginRight || '0');
		const targetWidth = Math.max(availableWidth - horizontalMargin, 1);

		this.setZoom(targetWidth / (state.nativeWidth * state.baseScale), { manual: false });
	}

	private updateFitWidthButton() {
		this.fitWidthBtn?.toggleClass('is-active', this.fitWidthEnabled);
	}

	private buildFindBar(container: HTMLElement) {
		const bar = container.createDiv({ cls: 'supernote-find-bar' });
		bar.hide();
		this.findBarEl = bar;

		this.findInput = new SearchComponent(bar);
		this.findInput.setPlaceholder('Find in note…');
		this.findInput.onChange((value) => this.runFind(value));

		this.findMatchCountEl = bar.createSpan({ cls: 'supernote-find-count' });

		const prevBtn = bar.createEl('button', { text: '↑', cls: 'clickable-icon', attr: { 'aria-label': 'Previous match' } });
		const nextBtn = bar.createEl('button', { text: '↓', cls: 'clickable-icon', attr: { 'aria-label': 'Next match' } });
		const closeBtn = bar.createEl('button', { text: '✕', cls: 'clickable-icon', attr: { 'aria-label': 'Close find bar' } });

		prevBtn.addEventListener('click', () => this.stepFind(-1));
		nextBtn.addEventListener('click', () => this.stepFind(1));
		closeBtn.addEventListener('click', () => this.closeFindBar());

		bar.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') {
				evt.preventDefault();
				this.closeFindBar();
			} else if (evt.key === 'Enter') {
				evt.preventDefault();
				this.stepFind(evt.shiftKey ? -1 : 1);
			}
		});
	}

	private toggleFindBar() {
		if (!this.findBarEl) return;
		if (this.findBarEl.isShown()) {
			this.closeFindBar();
			return;
		}
		this.findBarEl.show();
		this.findToggleBtn?.toggleClass('is-active', true);
		this.findInput?.inputEl.focus();
		this.findInput?.inputEl.select();
		this.updateThumbSidebarOffset();
	}

	private closeFindBar() {
		this.clearFindHighlights();
		this.findBarEl?.hide();
		this.findToggleBtn?.toggleClass('is-active', false);
		this.updateThumbSidebarOffset();
	}

	private clearFindHighlights() {
		for (const state of this.pageStates) {
			for (const span of state.spans) {
				span.removeClass('supernote-find-match');
				span.removeClass('supernote-find-match-current');
			}
		}
		this.findMatches = [];
		this.findMatchCursor = -1;
		this.findMatchCountEl?.setText('');
	}

	// Maps a character offset within state.text back to the span that contains
	// it. Assumes pdf.js's text layer renders one span per text-content item in
	// order, which holds for the common case; a mismatch here just means a
	// match highlights the wrong span rather than crashing.
	private findSpanForOffset(state: PageRenderState, offset: number): number {
		let cumulative = 0;
		for (let i = 0; i < state.spans.length; i++) {
			const len = state.spans[i].textContent?.length ?? 0;
			if (offset < cumulative + len) return i;
			cumulative += len;
		}
		return -1;
	}

	private async runFind(query: string) {
		const requestId = ++this.findRequestId;

		this.clearFindHighlights();
		if (!query) return;

		// Search needs every page's text, not just whatever's been lazily
		// loaded so far — force any not-yet-loaded pages to load now rather
		// than silently missing matches on pages the user hasn't scrolled to.
		// Already-loaded pages resolve near-instantly, so this only really
		// costs anything on the first search of a long, mostly-unscrolled note.
		await Promise.all(this.pageStates.map((state) => this.ensureTextLayer(state)));
		// A newer search may have started (and even finished) while this one
		// was waiting on that — don't clobber its results with stale ones.
		if (requestId !== this.findRequestId) return;

		const lowerQuery = query.toLowerCase();
		for (let pageIndex = 0; pageIndex < this.pageStates.length; pageIndex++) {
			const state = this.pageStates[pageIndex];
			const lowerText = state.text.toLowerCase();

			for (let searchStart = 0; ;) {
				const matchOffset = lowerText.indexOf(lowerQuery, searchStart);
				if (matchOffset === -1) break;

				const spanIndex = this.findSpanForOffset(state, matchOffset);
				if (spanIndex !== -1) {
					this.findMatches.push({ pageIndex, spanIndex });
					state.spans[spanIndex].addClass('supernote-find-match');
				}
				searchStart = matchOffset + lowerQuery.length;
			}
		}

		if (this.findMatches.length > 0) {
			this.findMatchCursor = 0;
			this.highlightCurrentMatch();
		}
		this.updateFindCount();
	}

	private stepFind(direction: 1 | -1) {
		if (this.findMatches.length === 0) return;
		this.findMatchCursor = (this.findMatchCursor + direction + this.findMatches.length) % this.findMatches.length;
		this.highlightCurrentMatch();
		this.updateFindCount();
	}

	private highlightCurrentMatch() {
		for (const state of this.pageStates) {
			for (const span of state.spans) {
				span.removeClass('supernote-find-match-current');
			}
		}

		const match = this.findMatches[this.findMatchCursor];
		if (!match) return;

		const state = this.pageStates[match.pageIndex];
		const span = state.spans[match.spanIndex];
		span.addClass('supernote-find-match-current');
		state.pageContainer.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	private updateFindCount() {
		if (!this.findMatchCountEl) return;
		this.findMatchCountEl.setText(this.findMatches.length === 0 ? 'No matches' : `${this.findMatchCursor + 1}/${this.findMatches.length}`);
	}

	async onClose() {
		window.clearTimeout(this.zoomDebounceTimer);
		window.clearTimeout(this.fitWidthDebounceTimer);
		this.resizeObserver?.disconnect();
		this.pageObserver?.disconnect();
	}
}

// Obsidian's PDF support accepts a `#page=3` anchor — as an embed
// (`![[file.pdf#page=3]]`) or a regular link (`[[file.pdf#page=3]]` /
// `[text](file.pdf#page=3)`) — to jump straight to one page; mirror that
// syntax for `.note` files rather than inventing a new one. Used by both
// SupernoteView.setEphemeralState() (regular links) and SupernoteEmbed
// (embeds).
function parsePageAnchor(subpath?: string): number | null {
	const match = subpath?.match(/^#page=(\d+)$/);
	return match ? parseInt(match[1], 10) : null;
}

// Renders a `.note` file into an `![[example.note]]` embed via Obsidian's
// undocumented app.embedRegistry API (see registration in SupernotePlugin.onload
// — there's no public API for embedding a custom, non-markdown file type; core's
// own image/PDF/canvas embeds are wired up through this same internal registry).
// Deliberately much simpler than SupernoteView: a scrollable, read-only page
// list with a minimal PDF-embed-style page-nav toolbar, not SupernoteView's
// full zoom/find/thumbnail toolbar — so this doesn't share code with it beyond
// ImageConverter/SupernoteX.
export class SupernoteEmbed extends Component {
	private destroyed = false;
	private pageEls: HTMLElement[] = [];
	private pageIndicatorEl: HTMLElement | null = null;
	private pageObserver: IntersectionObserver | null = null;
	private currentPage = 0;

	private pagesEl: HTMLElement | null = null;
	private toolbarEl: HTMLElement | null = null;
	// note page height / width — used to keep min-height (see setupMinHeightTracking)
	// matched to one full page's rendered height at whatever width the embed
	// currently has, the same "always show at least one whole page" behavior
	// Obsidian's own PDF embed has.
	private pageAspectRatio: number | null = null;
	private minHeightObserver: ResizeObserver | null = null;
	private lastMinHeightWidth = -1;

	constructor(
		private app: App,
		private settings: SupernotePluginSettings,
		private containerEl: HTMLElement,
		private file: TFile,
		// Set when the embed link has a `#page=N` anchor — renders just that
		// one page instead of the whole (scrollable, toolbar'd) note.
		private pageAnchor: number | null,
	) {
		super();
	}

	// Called by Obsidian's embed system once this component has been mounted
	// into context.containerEl (separate from Component's own load(), since the
	// same embed component can be asked to loadFile() again if the underlying
	// link changes without being recreated).
	loadFile(): void {
		void this.render();
	}

	onunload(): void {
		this.destroyed = true;
		this.pageObserver?.disconnect();
		this.minHeightObserver?.disconnect();
	}

	private async render(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass('supernote-embed');
		this.containerEl.setCssStyles({ minHeight: '' });
		this.pageObserver?.disconnect();
		this.pageObserver = null;
		this.minHeightObserver?.disconnect();
		this.minHeightObserver = null;
		this.pageEls = [];
		this.currentPage = 0;
		this.toolbarEl = null;
		this.pageAspectRatio = null;
		this.lastMinHeightWidth = -1;

		let sn: SupernoteX;
		try {
			const note = await this.app.vault.readBinary(this.file);
			if (this.destroyed) return;
			sn = new SupernoteX(new Uint8Array(note));
		} catch (err) {
			this.renderError(err);
			return;
		}

		// Clamped rather than rejected: a stale anchor (note re-paginated
		// since the link was written) should still show *a* page, not error.
		const singlePage = this.pageAnchor !== null
			? Math.min(Math.max(this.pageAnchor, 1), sn.pages.length)
			: null;
		this.pageAspectRatio = sn.pageHeight / sn.pageWidth;

		const converter = new ImageConverter();
		let images: string[];
		try {
			images = await converter.convertToImages(sn, singlePage !== null ? [singlePage] : undefined);
		} catch (err) {
			if (!this.destroyed) this.renderError(err);
			return;
		} finally {
			converter.terminate();
		}
		if (this.destroyed) return;

		// A single requested page, or a single-page note, needs no page-nav
		// toolbar — there's nowhere for it to navigate to.
		const showToolbar = singlePage === null && sn.pages.length > 1;
		if (showToolbar) {
			this.buildToolbar(sn.pages.length);
		}

		const pagesEl = this.containerEl.createDiv({ cls: 'supernote-embed-pages' });
		this.pagesEl = pagesEl;
		const startPageNumber = singlePage ?? 1;
		images.forEach((imageDataUrl, i) => {
			const pageContainer = pagesEl.createDiv({ cls: 'page-container' });
			pageContainer.dataset.pageNumber = String(startPageNumber + i);
			const img = pageContainer.createEl('img', { attr: { src: imageDataUrl } });
			if (this.settings.invertColorsWhenDark) {
				img.addClass('supernote-invert-dark');
			}
			this.pageEls.push(pageContainer);
		});

		if (showToolbar) {
			this.observePages();
		}

		this.setupMinHeightTracking();
	}

	// Obsidian's PDF embed never lets the embed shrink below one full page —
	// there's always at least one whole page visible, however tall that page
	// happens to be, with any extra pages scrolled below it. Pixel height
	// depends on width (pages scale to fill it) and on this particular note's
	// own page aspect ratio, so it's recomputed whenever the embed is resized
	// (window resize, pane split/unsplit, sidebar toggle), not just once.
	private setupMinHeightTracking(): void {
		if (!this.pagesEl) return;
		this.minHeightObserver = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width;
			if (width) this.applyMinHeight(width);
		});
		this.minHeightObserver.observe(this.pagesEl);
	}

	// `width` is pagesEl's content-box width (ResizeObserver's contentRect
	// already excludes its own padding), i.e. exactly the width a page image
	// renders at inside it — no separate padding math needed for that part.
	private applyMinHeight(width: number): void {
		if (this.pageAspectRatio === null || !this.pagesEl) return;
		if (Math.abs(width - this.lastMinHeightWidth) < 1) return;
		this.lastMinHeightWidth = width;

		const toolbarHeight = this.toolbarEl?.offsetHeight ?? 0;
		const pagesStyle = getComputedStyle(this.pagesEl);
		const pagesPaddingY = parseFloat(pagesStyle.paddingTop) + parseFloat(pagesStyle.paddingBottom);
		const pageHeight = width * this.pageAspectRatio;
		this.containerEl.setCssStyles({ minHeight: `${Math.ceil(toolbarHeight + pagesPaddingY + pageHeight)}px` });
	}

	private buildToolbar(pageCount: number): void {
		const toolbar = this.containerEl.createDiv({ cls: 'supernote-embed-toolbar' });
		this.toolbarEl = toolbar;

		const prevBtn = toolbar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Previous page' } });
		setIcon(prevBtn, 'chevron-up');
		prevBtn.addEventListener('click', () => this.scrollToPage(this.currentPage - 1));

		this.pageIndicatorEl = toolbar.createSpan({ cls: 'supernote-embed-page-indicator', text: `1 / ${pageCount}` });

		const nextBtn = toolbar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Next page' } });
		setIcon(nextBtn, 'chevron-down');
		nextBtn.addEventListener('click', () => this.scrollToPage(this.currentPage + 1));
	}

	private scrollToPage(index: number): void {
		const clamped = Math.min(Math.max(index, 0), this.pageEls.length - 1);
		this.pageEls[clamped]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	// Keeps the toolbar's page indicator in sync with whatever page is
	// actually scrolled into view, the same pattern SupernoteView itself uses
	// for its own (much larger) page-jump indicator.
	private observePages(): void {
		this.pageObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const idx = this.pageEls.indexOf(entry.target as HTMLElement);
				if (idx === -1) continue;
				this.currentPage = idx;
				this.pageIndicatorEl?.setText(`${idx + 1} / ${this.pageEls.length}`);
			}
		}, { root: this.containerEl, threshold: 0.5 });
		this.pageEls.forEach((el) => this.pageObserver?.observe(el));
	}

	private renderError(err: unknown): void {
		this.containerEl.empty();
		this.containerEl.createDiv({
			cls: 'supernote-embed-error',
			text: `Failed to render Supernote file: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
}

export default class SupernotePlugin extends Plugin {
	settings!: SupernotePluginSettings;
	vaultWriter!: VaultWriter;
	private syncInFlight = false;

	async onload() {
        // Install polyfills before any other code runs
        installAtPolyfill();

		await this.loadSettings();
		vw = new VaultWriter(this.app, this.settings);
		this.vaultWriter = vw;

		this.addSettingTab(new SupernoteSettingTab(this.app, this));

		this.addCommand({
			id: 'attach-file-from-device',
			name: 'Attach file from device',
			callback: () => {
				if (this.settings.directConnectIP.length === 0) {
					new DirectConnectErrorModal(this.app, this.settings, new Error("IP is unset")).open();
					return;
				}
				new DownloadListModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'upload-file-to-device',
			name: 'Upload the current file to a device',
			callback: () => {
				if (this.settings.directConnectIP.length === 0) {
					new DirectConnectErrorModal(this.app, this.settings, new Error("IP is unset")).open();
					return;
				}
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					new UploadListModal(this.app, this, activeFile).open();
				}
			}
		});

		this.registerView(
			VIEW_TYPE_SUPERNOTE,
			(leaf) => new SupernoteView(leaf, this.settings)
		);
		this.registerExtensions(['note'], VIEW_TYPE_SUPERNOTE);

		// Wires up `![[example.note]]` embeds via Obsidian's internal
		// app.embedRegistry (undocumented — not in obsidian.d.ts, see
		// src/obsidian-embed.d.ts — but the same mechanism core uses for
		// image/PDF/canvas embeds). Feature-detected since an internal API can
		// be changed or removed by Obsidian without notice; falling back to no
		// embed support (rather than throwing) keeps the rest of the plugin
		// working either way.
		if (this.app.embedRegistry?.registerExtension) {
			this.app.embedRegistry.registerExtension('note', (context, file, subpath) =>
				new SupernoteEmbed(this.app, this.settings, context.containerEl, file, parsePageAnchor(subpath))
			);
			this.register(() => this.app.embedRegistry?.unregisterExtension('note'));
		}

		this.addCommand({
			id: 'insert-screen-mirror-image',
			name: 'Insert a screen mirroring image as attachment',
			editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
				// Screen mirroring is an indefinitely-open multipart MJPEG stream read
				// with a raw `fetch()` + ReadableStream reader (see fetchMirrorFrame in
				// supernote-typescript). Mobile Obsidian runs in a WKWebView, which
				// blocks cross-origin fetch() to a plain-HTTP LAN device, and
				// Obsidian's mobile-safe `requestUrl` alternative can't substitute here
				// because it only resolves once the whole response body finishes -
				// which for this stream never happens. Fail fast with an actionable
				// message instead of attempting (and mysteriously failing) the request.
				if (Platform.isMobile) {
					new ErrorModal(this.app, new Error(
						"Screen mirroring insert isn't supported on Obsidian mobile: it needs a continuous network "
						+ "stream that mobile's WebView can't read. Use \"Browse and Access\" to insert a file "
						+ "instead, or run this command on desktop."
					)).open();
					return;
				}

				// generate a unique filename for the mirror based on the current note path
				const ts = generateTimestamp();
				const f = this.app.workspace.activeEditor?.file?.basename || '';
				const filename = await this.app.fileManager.getAvailablePathForAttachment(`supernote-mirror-${f}-${ts}.png`);

				try {
					if (this.settings.directConnectIP.length == 0) {
						throw new Error("IP is unset, please set in Supernote plugin settings")
					}
					const image = await fetchMirrorFrame(`${this.settings.directConnectIP}:8080`);

					const file = await this.app.vault.createBinary(filename, encode(image).buffer as ArrayBuffer);
					const path = this.app.workspace.activeEditor?.file?.path;
					if (!path) {
						throw new Error("Active file path is null")
					}
					const link = generateMarkdownImageEmbed(this.app, file, path);
					editor.replaceRange(link, editor.getCursor());
				} catch (err) {
					new DirectConnectErrorModal(this.app, this.settings, err instanceof Error ? err : new Error(String(err))).open();
				}
			},
		});

		this.addCommand({
			id: 'export-note-as-files',
			name: 'Export this note as a Markdown and PNG files as attachments',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "note") {
					if (checking) {
						return true
					}
					if (!file) {
						new ErrorModal(this.app, new Error("No file to attach")).open();
					} else {
						vw.attachNoteFiles(file).catch((err: unknown) => {
							new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
						});
					}
					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: 'export-note-as-pdf',
			name: 'Export this note as PDF',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "note") {
					if (checking) {
						return true
					}
					if (!file) {
						new ErrorModal(this.app, new Error("No file to attach")).open();
					} else {
						vw.exportToPDF(file).catch((err: unknown) => {
							new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
						});
					}
					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: 'export-note-as-markdown',
			name: 'Export this note as a Markdown file attachment',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "note") {
					if (checking) {
						return true
					}
					if (!file) {
						new ErrorModal(this.app, new Error("No file to attach")).open();
					} else {
						vw.attachMarkdownFile(file).catch((err: unknown) => {
							new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
						});
					}
					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: 'import-todays-pages',
			name: "Import notes edited today",
			editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
				if (this.settings.directConnectIP.length === 0) {
					new DirectConnectErrorModal(this.app, this.settings, new Error("IP is unset")).open();
					return;
				}
				const targetPath = view.file?.path;
				if (!targetPath) {
					new ErrorModal(this.app, new Error("Active file path is null")).open();
					return;
				}
				new ImportTodayModal(this.app, this, editor, targetPath).open();
			},
		});

		this.addCommand({
			id: 'sync-notes-from-device',
			name: 'Sync supernote notes now',
			callback: () => { void this.runSync(); },
		});
	}

	async runSync(): Promise<void> {
		if (this.settings.directConnectIP.length === 0) {
			new DirectConnectErrorModal(this.app, this.settings, new Error("IP is unset")).open();
			return;
		}
		// A slow sync (large device, slow LAN) could still be running when the
		// command is invoked again — e.g. the user re-runs it by hand right
		// after triggering it. Two runs racing on the same manifest could each
		// read a stale copy and clobber the other's updates when they save.
		if (this.syncInFlight) {
			new Notice('Supernote sync is already running');
			return;
		}

		this.syncInFlight = true;
		try {
			const result = await runDeviceSync(this.app, this.settings, () => this.saveSettings());

			const parts = [`${result.synced} synced`, `${result.unchanged} unchanged`];
			if (result.excluded > 0) parts.push(`${result.excluded} out of scope`);
			if (result.skippedConflicts.length > 0) parts.push(`${result.skippedConflicts.length} skipped (locally edited)`);
			if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
			new Notice(`Supernote sync: ${parts.join(', ')}`);

			if (result.skippedConflicts.length > 0) {
				console.warn('Supernote sync skipped these files because they were edited locally since the last sync:', result.skippedConflicts);
			}
			if (result.failed.length > 0) {
				console.error('Supernote sync failed for these files:', result.failed);
			}
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			// Best-effort: a run that fails before producing a per-file result at
			// all (e.g. the device was unreachable) is exactly the kind of thing
			// worth a Sync Log entry, but a logging failure on top of that
			// shouldn't hide the real error from the modal below.
			await appendSyncLogEntry(this.app, this.settings.syncFolder, formatSyncFailureLogEntry(error.message))
				.catch((logErr) => console.error('Failed to write to Supernote sync log:', logErr));
			new DirectConnectErrorModal(this.app, this.settings, error).open();
		} finally {
			this.syncInFlight = false;
		}
	}

	onunload() {

	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SUPERNOTE);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			if (!leaf) {
				throw new Error("leaf is null");
			}
			await leaf.setViewState({ type: VIEW_TYPE_SUPERNOTE, active: true });
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		await workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<SupernotePluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


class DirectConnectErrorModal extends Modal {
	error: Error;
	public settings: SupernotePluginSettings;

	constructor(app: App, settings: SupernotePluginSettings, error: Error) {
		super(app);
		this.error = error;
		this.settings = settings;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(`Error: ${this.error.message}. Is the Supernote connected to Wifi on IP ${this.settings.directConnectIP} and running Screen Mirroring?`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
