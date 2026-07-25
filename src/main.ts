import { installAtPolyfill } from './polyfills';
import { App, Modal, TFile, Plugin, Editor, MarkdownView, MarkdownFileInfo, WorkspaceLeaf, FileView, loadPdfJs, Scope, SearchComponent, setIcon } from 'obsidian';
import { SupernotePluginSettings, SupernoteSettingTab, DEFAULT_SETTINGS } from './settings';
import { SupernoteX, fetchMirrorFrame, toPdf } from 'supernote-typescript';
import { encode } from 'image-js';
import { DownloadListModal, UploadListModal } from './FileListModal';
import { SupernoteWorkerMessage, SupernoteWorkerResponse } from './myworker.worker';
import Worker from 'myworker.worker';
import { replaceTextWithCustomDictionary } from './customDictionary';

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

// Uint8Array.buffer isn't safe to hand to APIs wanting a plain ArrayBuffer
// when the array is a view over a larger/offset buffer (not guaranteed for
// pdf-lib's PDFDocument.save() output, so don't assume it). This always
// returns a buffer sized to exactly this array's bytes.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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

export class WorkerPool {
    private workers: Worker[];

    constructor(private maxWorkers: number = navigator.hardwareConcurrency) {
        this.workers = Array(maxWorkers).fill(null).map(() =>
            new Worker()
        );
    }

    private processChunk(worker: Worker, note: SupernoteX, pageNumbers: number[]): Promise<any[]> {
        return new Promise((resolve, reject) => {
            worker.onmessage = (e: MessageEvent<SupernoteWorkerResponse>) => {
                if (e.data.error) {
                    reject(new Error(e.data.error));
                } else {
                    resolve(e.data.images);
                }
            };

            worker.onerror = (error) => {
                console.error('Worker error:', error);
                reject(error);
            };

            const message: SupernoteWorkerMessage = {
                type: 'convert',
                note,
                pageNumbers
            };

            worker.postMessage(message);
        });
    }

    async processPages(note: SupernoteX, allPageNumbers: number[]): Promise<any[]> {
        //console.time('Total processing time');

        // Split pages into chunks based on number of workers
        const chunkSize = Math.ceil(allPageNumbers.length / this.workers.length);
        const chunks: number[][] = [];

        for (let i = 0; i < allPageNumbers.length; i += chunkSize) {
            chunks.push(allPageNumbers.slice(i, i + chunkSize));
        }

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

    async convertToImages(note: SupernoteX, pageNumbers?: number[]): Promise<any[]> {
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
				let subpath = '';
				if (this.settings.invertColorsWhenDark) {
					subpath = '#supernote-invert-dark';
				}

				const link = this.app.fileManager.generateMarkdownLink(imgs[i], filename, subpath);
				content += `${link}\n`;
			}
		}

		this.app.vault.create(filename, content);
	}

	async writeImageFiles(file: TFile, sn: SupernoteX): Promise<TFile[]> {
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
			const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}-${i}.png`);
			const buffer = dataUrlToBuffer(images[i]);
			imgs.push(await this.app.vault.createBinary(filename, buffer));
		}
		return imgs;
	}

	async attachMarkdownFile(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));

		this.writeMarkdownFile(file, sn, null);
	}

	async attachNoteFiles(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));

		const imgs = await this.writeImageFiles(file, sn);
		this.writeMarkdownFile(file, sn, imgs);
	}

	async exportToPDF(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));

		// toPdf() rasterizes internally (via the library's own toImage), so no
		// separate ImageConverter pass is needed here like the other export
		// paths — this is the only consumer of the PDF bytes.
		const pdfBytes = await toPdf(sn);

		// Generate filename and save
		const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}.pdf`);
		await this.app.vault.createBinary(filename, toArrayBuffer(pdfBytes));
	}
}

// Renders a pdf.js text layer into `container`, preferring the modern
// `TextLayer` class (pdf.js >=3.4) and falling back to the older
// `renderTextLayer()` function on earlier bundles. Obsidian's `loadPdfJs()`
// only promises the core pdfjsLib, not a pinned version, so neither API is
// guaranteed — if neither exists, pages still render, they just lose
// selectable text and find-in-note for that session.
async function renderTextLayer(pdfjsLib: any, textContent: any, container: HTMLElement, viewport: any): Promise<boolean> {
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
	pdfPage: any;
	baseScale: number;
	nativeWidth: number;
	nativeHeight: number;
	pageContainer: HTMLElement;
	canvasWrap: HTMLElement;
	canvas: HTMLCanvasElement;
	textLayerDiv: HTMLElement;
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

	private pdfjsLib: any;
	private pageStates: PageRenderState[] = [];
	private pagesEl: HTMLElement | null = null;

	private zoomScale = 1;
	private renderedZoomScale = 1;
	private zoomDebounceTimer: number | undefined;
	private zoomLabelEl: HTMLElement | null = null;

	private fitWidthEnabled = false;
	private fitWidthBtn: HTMLElement | null = null;
	private fitWidthDebounceTimer: number | undefined;
	private resizeObserver: ResizeObserver | null = null;

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

	private findBarEl: HTMLElement | null = null;
	private findInput: SearchComponent | null = null;
	private findMatchCountEl: HTMLElement | null = null;
	private findMatches: FindMatch[] = [];
	private findMatchCursor = -1;

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
			return "Supernote View"
		}
		return this.file.basename;
	}

	async onOpen(): Promise<void> {
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
			requestAnimationFrame(() => {
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
	}

	async onLoadFile(file: TFile): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.createEl("h1", { text: file.name });

		window.clearTimeout(this.zoomDebounceTimer);
		this.pageStates = [];
		this.zoomScale = 1;
		this.renderedZoomScale = 1;
		this.findMatches = [];
		this.findMatchCursor = -1;

		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));
		let images: string[] = [];

		const converter = new ImageConverter();
		try {
			images = await converter.convertToImages(sn);
		} finally {
			// Clean up the worker when done
			converter.terminate();
		}

		// Build the same searchable PDF as "Attach as PDF" and hand it straight to
		// pdf.js as an in-memory byte array — Obsidian's own PDF viewer is internal
		// and file-backed, but `loadPdfJs()` exposes the underlying pdfjsLib it uses,
		// so pages can be rendered here without ever writing a file to the vault.
		// toPdf() rasterizes internally, separately from the `images` above (which
		// exist for the thumbnail sidebar, save-to-vault, and drag-out) — a small
		// duplicated render pass, traded for not having to thread pre-rendered
		// images through the library's PDF builder.
		const pdfBytes = await toPdf(sn);
		this.pdfjsLib = await loadPdfJs();
		const pdfDoc = await this.pdfjsLib.getDocument({ data: pdfBytes }).promise;

		if (this.settings.showExportButtons) {
			const exportNoteBtn = container.createEl("p").createEl("button", {
				text: "Attach markdown to vault",
				cls: "mod-cta",
			});

			exportNoteBtn.addEventListener("click", async () => {
				vw.attachMarkdownFile(file);
			});

			const exportAllBtn = container.createEl("p").createEl("button", {
				text: "Attach markdown and images to vault",
				cls: "mod-cta",
			});

			exportAllBtn.addEventListener("click", async () => {
				vw.attachNoteFiles(file);
			});

			const exportPDFBtn = container.createEl("p").createEl("button", {
				text: "Attach as PDF",
				cls: "mod-cta",
			});

			exportPDFBtn.addEventListener("click", async () => {
				vw.exportToPDF(file);
			});
		}

		// Sticky header so the toolbar (and find bar, when open) stay visible
		// while scrolling through a long note instead of scrolling away with it.
		this.headerEl = container.createEl("div", { cls: 'supernote-header' });
		this.buildToolbar(this.headerEl, images.length);
		this.buildFindBar(this.headerEl);
		this.updateThumbSidebarOffset();

		const body = container.createEl("div", { cls: 'supernote-body' });
		this.buildThumbSidebar(body, images);

		this.pagesEl = body.createEl("div", { cls: 'supernote-pages' });
		this.pagesEl.toggleClass('supernote-mode-text', this.layerMode === 'text');

		for (let i = 0; i < images.length; i++) {
			const imageDataUrl = images[i];

			const pageContainer = this.pagesEl.createEl("div", {
				cls: 'page-container',
			})

			// Render the page through pdf.js against the in-memory PDF built above,
			// instead of dropping in the raw page image.
			const pdfPage = await pdfDoc.getPage(i + 1);
			const unscaledViewport = pdfPage.getViewport({ scale: 1 });
			const baseScale = this.settings.noteImageMaxDim / Math.max(unscaledViewport.width, unscaledViewport.height);

			const canvasWrap = pageContainer.createEl("div", { cls: 'supernote-canvas-wrap' });
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

			const textLayerDiv = canvasWrap.createEl("div", { cls: 'textLayer' });

			const state: PageRenderState = {
				pdfPage,
				baseScale,
				nativeWidth: unscaledViewport.width,
				nativeHeight: unscaledViewport.height,
				pageContainer,
				canvasWrap,
				canvas,
				textLayerDiv,
				text: '',
				spans: [],
			};
			this.pageStates.push(state);

			await this.renderPage(state, baseScale * this.zoomScale);

			// Create a button to save image to vault
			if (this.settings.showExportButtons) {
				const saveButton = pageContainer.createEl("button", {
					text: "Save image to vault",
					cls: "mod-cta",
				});

				saveButton.addEventListener("click", async () => {
					const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}-${i}.png`);
					const buffer = dataUrlToBuffer(imageDataUrl);
					await this.app.vault.createBinary(filename, buffer);
				});
			}
		}

		if (this.fitWidthEnabled) {
			this.applyFitWidth();
		}
		this.updateCurrentPageIndicator();
	}

	private async renderPage(state: PageRenderState, scale: number): Promise<void> {
		const viewport = state.pdfPage.getViewport({ scale });

		state.canvas.width = viewport.width;
		state.canvas.height = viewport.height;
		state.canvasWrap.setCssStyles({ width: `${viewport.width}px`, height: `${viewport.height}px` });

		const canvasContext = state.canvas.getContext("2d");
		if (canvasContext) {
			await state.pdfPage.render({ canvasContext, viewport }).promise;
		}

		const textContent = await state.pdfPage.getTextContent();
		state.text = textContent.items.map((item: any) => ('str' in item ? item.str : '')).join('');

		const hasTextLayer = await renderTextLayer(this.pdfjsLib, textContent, state.textLayerDiv, viewport);
		state.spans = hasTextLayer ? Array.from(state.textLayerDiv.querySelectorAll('span')) : [];
	}

	private buildToolbar(container: HTMLElement, pageCount: number) {
		this.pageJumpInput = null;
		const toolbar = container.createEl('div', { cls: 'supernote-toolbar' });

		if (pageCount > 1) {
			const thumbGroup = toolbar.createEl('div', { cls: 'supernote-toolbar-group' });
			this.thumbToggleBtn = thumbGroup.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Toggle page thumbnails' } });
			setIcon(this.thumbToggleBtn, 'layout-list');
			this.thumbToggleBtn.addEventListener('click', () => this.toggleThumbnails());
		}

		const zoomGroup = toolbar.createEl('div', { cls: 'supernote-toolbar-group' });
		const zoomOutBtn = zoomGroup.createEl('button', { text: '−', cls: 'clickable-icon', attr: { 'aria-label': 'Zoom out' } });
		this.zoomLabelEl = zoomGroup.createEl('span', { cls: 'supernote-zoom-label', text: '100%' });
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

		const layerGroup = toolbar.createEl('div', { cls: 'supernote-toolbar-group' });
		this.imageModeBtn = layerGroup.createEl('button', { text: 'Image', cls: 'clickable-icon', attr: { 'aria-label': 'Show page image' } });
		this.textModeBtn = layerGroup.createEl('button', { text: 'Text', cls: 'clickable-icon', attr: { 'aria-label': 'Show recognized text' } });
		this.imageModeBtn.addEventListener('click', () => this.setLayerMode('image'));
		this.textModeBtn.addEventListener('click', () => this.setLayerMode('text'));
		this.updateLayerModeButtons();

		if (pageCount > 1) {
			const jumpGroup = toolbar.createEl('div', { cls: 'supernote-toolbar-group' });
			jumpGroup.createEl('span', { text: 'Page', cls: 'supernote-page-jump-label' });
			const pageInput = jumpGroup.createEl('input', {
				cls: 'supernote-page-jump-input',
				attr: { type: 'number', min: '1', max: String(pageCount), value: '1' },
			});
			this.pageJumpInput = pageInput;
			jumpGroup.createEl('span', { text: `/ ${pageCount}`, cls: 'supernote-page-jump-total' });

			const jumpToPage = () => {
				const requested = Number(pageInput.value);
				if (!Number.isFinite(requested)) return;
				const target = Math.min(pageCount, Math.max(1, Math.round(requested)));
				pageInput.value = String(target);
				this.pageStates[target - 1]?.pageContainer.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
		this.thumbSidebarEl = body.createEl('div', { cls: 'supernote-thumb-sidebar' });
		this.thumbItems = [];

		images.forEach((dataUrl, i) => {
			const item = this.thumbSidebarEl!.createEl('div', { cls: 'supernote-thumb-item' });
			const img = item.createEl('img', { cls: 'supernote-thumb-img' });
			img.src = dataUrl;
			item.createEl('span', { cls: 'supernote-thumb-label', text: String(i + 1) });

			item.addEventListener('click', () => {
				this.pageStates[i]?.pageContainer.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
		if (opts.manual !== false) {
			// Any direct zoom action (buttons, wheel, reset) is the user taking
			// manual control — stop auto-adjusting on resize until they ask for
			// fit-width again. applyFitWidth() itself calls in with manual:false
			// so it doesn't immediately cancel the mode it's trying to apply.
			this.fitWidthEnabled = false;
			this.updateFitWidthButton();
		}

		this.zoomScale = Math.min(5, Math.max(0.25, newScale));
		this.zoomLabelEl?.setText(`${Math.round(this.zoomScale * 100)}%`);

		// Instant CSS-scale feedback while the user is still zooming; the real
		// re-render (crisp at the new resolution, text layer repositioned) is
		// debounced below so rapid wheel/button input doesn't thrash pdf.js.
		const instantFactor = this.zoomScale / this.renderedZoomScale;
		for (const state of this.pageStates) {
			state.canvasWrap.setCssStyles({ transform: `scale(${instantFactor})`, transformOrigin: 'top left' });
		}

		window.clearTimeout(this.zoomDebounceTimer);
		this.zoomDebounceTimer = window.setTimeout(() => this.commitZoom(), 200);
	}

	private async commitZoom(): Promise<void> {
		const targetZoom = this.zoomScale;
		for (const state of this.pageStates) {
			await this.renderPage(state, state.baseScale * targetZoom);
			state.canvasWrap.setCssStyles({ transform: '', transformOrigin: '' });
		}
		this.renderedZoomScale = targetZoom;
		this.updateCurrentPageIndicator();
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
		const bar = container.createEl('div', { cls: 'supernote-find-bar' });
		bar.hide();
		this.findBarEl = bar;

		this.findInput = new SearchComponent(bar);
		this.findInput.setPlaceholder('Find in note…');
		this.findInput.onChange((value) => this.runFind(value));

		this.findMatchCountEl = bar.createEl('span', { cls: 'supernote-find-count' });

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
		this.findInput?.inputEl.focus();
		this.findInput?.inputEl.select();
		this.updateThumbSidebarOffset();
	}

	private closeFindBar() {
		this.clearFindHighlights();
		this.findBarEl?.hide();
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

	private runFind(query: string) {
		this.clearFindHighlights();
		if (!query) return;

		const lowerQuery = query.toLowerCase();
		for (let pageIndex = 0; pageIndex < this.pageStates.length; pageIndex++) {
			const state = this.pageStates[pageIndex];
			const lowerText = state.text.toLowerCase();

			let searchStart = 0;
			while (true) {
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
	}
}

export default class SupernotePlugin extends Plugin {
	settings!: SupernotePluginSettings;

	async onload() {
        // Install polyfills before any other code runs
        installAtPolyfill();

		await this.loadSettings();
		vw = new VaultWriter(this.app, this.settings);

		this.addSettingTab(new SupernoteSettingTab(this.app, this));

		this.addCommand({
			id: 'attach-supernote-file-from-device',
			name: 'Attach Supernote file from device',
			callback: () => {
				if (this.settings.directConnectIP.length === 0) {
					new DirectConnectErrorModal(this.app, this.settings, new Error("IP is unset")).open();
					return;
				}
				new DownloadListModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'upload-file-to-supernote',
			name: 'Upload the current file to a Supernote device',
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

		this.addCommand({
			id: 'insert-supernote-screen-mirror-image',
			name: 'Insert a Supernote screen mirroring image as attachment',
			editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
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
					const link = this.app.fileManager.generateMarkdownLink(file, path);
					editor.replaceRange(link, editor.getCursor());
				} catch (err: any) {
					new DirectConnectErrorModal(this.app, this.settings, err).open();
				}
			},
		});

		this.addCommand({
			id: 'export-supernote-note-as-files',
			name: 'Export this Supernote note as a markdown and PNG files as attachments',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "note") {
					if (checking) {
						return true
					}
					try {
						if (!file) {
							throw new Error("No file to attach");
						}
						vw.attachNoteFiles(file);
					} catch (err: any) {
						new ErrorModal(this.app, err).open();
					}
					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: 'export-supernote-note-as-pdf',
			name: 'Export this Supernote note as PDF',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "note") {
					if (checking) {
						return true
					}
					try {
						if (!file) {
							throw new Error("No file to attach");
						}
						vw.exportToPDF(file);
					} catch (err: any) {
						new ErrorModal(this.app, err).open();
					}
					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: 'export-supernote-note-as-markdown',
			name: 'Export this Supernote note as a markdown file attachment',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "note") {
					if (checking) {
						return true
					}
					try {
						if (!file) {
							throw new Error("No file to attach");
						}
						vw.attachMarkdownFile(file);
					} catch (err: any) {
						new ErrorModal(this.app, err).open();
					}
					return true;
				}

				return false;
			},
		});
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
		workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

class ErrorModal extends Modal {
	error: Error;

	constructor(app: App, error: Error) {
		super(app);
		this.error = error;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(`Error: ${this.error.message}.`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
