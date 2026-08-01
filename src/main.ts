import { installAtPolyfill } from './polyfills';
import { App, Modal, Notice, TFile, Plugin, Editor, MarkdownView, MarkdownFileInfo, WorkspaceLeaf, FileView, Component, loadPdfJs, Scope, SearchComponent, setIcon, Platform } from 'obsidian';
import { SupernotePluginSettings, SupernoteSettingTab, DEFAULT_SETTINGS, ImportFormat } from './settings';
import { SupernoteX, ILink, RecognitionStatuses, fetchMirrorFrame, createPdfContext, addPdfPage, addTextOnlyPdfPage, extractPageRenderData, IRenderableNote } from 'supernote-typescript';
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
import { SupernoteAtelierEmbed, SupernoteAtelierView, VIEW_TYPE_SUPERNOTE_ATELIER, renderAtelierCompositeDataUrl, renderAtelierCompositeFromBuffer } from './atelierView';
import { PDFDocument } from 'pdf-lib';

// TEMPORARY, for bisecting issue #154's remaining memory growth (worker
// instances staying large - 100MB+ - across a long scroll session, even
// though the plugin's own page load/evict tracking shows a healthy, bounded
// total) between the two independent subsystems that could cause it: the
// text-layer pipeline (pdf-lib assembling a whole-document PDF + pdf.js
// parsing it, both used only for search/selection - see onLoadFile()'s
// pdfDocPromise) and the image pipeline (the Worker pool rasterizing pages -
// see ensurePageImage()/ensureThumbnail()). Toggle from the DevTools console
// without needing a rebuild - affects every currently-open and future
// SupernoteView immediately, so flip a flag, close and reopen the note (or
// just open it fresh) to test:
//   supernoteDebug.disableTextLayer = true   // skip pdf-lib/pdf.js entirely
//   supernoteDebug.disableImages = true      // skip page/thumbnail rasterization entirely
// Remove this whole block (and its three call sites) once the bisection
// is done and the real cause is found.
const supernoteDebugFlags = { disableTextLayer: false, disableImages: false };
(window as unknown as { supernoteDebug: typeof supernoteDebugFlags }).supernoteDebug = supernoteDebugFlags;

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

// "data:image/png;base64,..." -> "image/png"
function dataUrlMimeType(dataUrl: string): string {
    return dataUrl.slice('data:'.length, dataUrl.indexOf(';'));
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

// Wraps a single already-rasterized PNG (as a data URL) in a one-page PDF,
// at the same 300dpi-assumed-source-density sizing convention `.note`'s PDF
// export uses (createPdfContext/addPdfPage above). Used for `.spd`, which
// has no recognition/OCR text to lay an invisible text layer under the way
// addPdfPage does for `.note` pages, so this builds directly with pdf-lib
// instead. Shared by VaultWriter.exportAtelierToPDF and its
// buildInsertableContent .spd import path.
async function buildSinglePagePdf(pngDataUrl: string): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const pngImage = await pdfDoc.embedPng(dataUrlToBuffer(pngDataUrl));
    const dpi = 300;
    const pointsPerPixel = 72 / dpi;
    const widthPts = pngImage.width * pointsPerPixel;
    const heightPts = pngImage.height * pointsPerPixel;
    const pdfPage = pdfDoc.addPage([widthPts, heightPts]);
    pdfPage.drawImage(pngImage, { x: 0, y: 0, width: widthPts, height: heightPts });
    return pdfDoc.save();
}

// Builds a PDF with only the invisible recognized-text layer, no page images
// at all — for SupernoteView's internal pdfDocPromise, which exists purely
// so pdf.js's getTextContent()/getViewport() can build a search/select text
// layer over pages that are actually displayed via direct canvas rendering
// (drawPageImage()); pdf.js's own render() is never called against it. A
// real page image there would be pure dead weight: embedding one only for
// pdf-lib to decode, recompress, and serialize turned out to be genuinely
// expensive (multiple seconds for a many-page or high-resolution note) for
// bytes nothing ever looks at. Don't use this for anything the user actually
// opens/exports as a PDF — see assemblePdfFromImages() for that.
async function assembleTextOnlyPdf(sn: SupernoteX): Promise<Uint8Array> {
    const ctx = await createPdfContext();
    for (let i = 0; i < sn.pages.length; i++) {
        // Per-page, not just before/after the whole loop: if this ever hangs
        // or crashes partway through (see issue #147 - a hard crash with no
        // catchable JS error, so the only trace of it is whatever was last
        // logged), the last page number logged narrows it down to one page's
        // recognition data rather than "somewhere in this note".
        console.debug(`Supernote: text-only PDF — page ${i + 1}/${sn.pages.length}`);
        await addTextOnlyPdfPage(ctx, sn.pages[i], sn.pageWidth, sn.pageHeight);
    }
    console.debug(`Supernote: text-only PDF — saving (${sn.pages.length} page(s))`);
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

// Splits pageNumbers into at most `workerCount` chunks.
function chunkPageNumbers(pageNumbers: number[], workerCount: number): number[][] {
    const chunkSize = Math.ceil(pageNumbers.length / workerCount);
    const chunks: number[][] = [];
    for (let i = 0; i < pageNumbers.length; i += chunkSize) {
        chunks.push(pageNumbers.slice(i, i + chunkSize));
    }
    return chunks;
}

// Slices out only the requested pages, in the given order, into a
// structured-clone-safe IRenderableNote - see supernote-typescript's
// extractPageRenderData() (which this wraps to cover more than one page at
// once) for exactly why this matters: postMessage-ing the *whole* parsed
// SupernoteX to a Worker - which is what this replaced - clones every
// page's raw layer data across, not just the page(s) actually requested.
// WorkerPool round-robins across every worker it has (see processChunk()),
// so as a user scrolls through a long document, every worker eventually
// receives - and holds, in its own separate V8 heap, invisible to the main
// thread's own heap snapshots/profiling - a full copy of the entire
// document, just to render one page at a time. Confirmed via real
// profiling on issue #154: navigator.hardwareConcurrency (8, on the
// reporting device) separate ~100MB Worker heaps, matching a ~900MB total
// that neither DPR capping nor zoom-aware rasterization could ever have
// addressed, since neither touches what gets sent to a Worker in the first
// place.
function extractPagesRenderData(note: SupernoteX, pageNumbers: number[]): IRenderableNote {
    return {
        pageWidth: note.pageWidth,
        pageHeight: note.pageHeight,
        pages: pageNumbers.map((n) => extractPageRenderData(note, n).pages[0]),
    };
}

export class WorkerPool {
    private workers: Worker[];
    // Chained onto so a new request to a given worker waits for that
    // worker's previous request to actually resolve/reject before sending -
    // see processChunk()'s comment for why this matters.
    private queues: Promise<void>[];
    // Round-robins across every call to processChunk(), not just within one
    // processPages() call - see processChunk()'s comment.
    private nextWorker = 0;
    // How many rasterization calls each worker (by index) has handled since
    // it was last (re)created - see recycleWorkerIfNeeded()'s comment.
    private callCounts: number[];

    // Recycle a worker after this many calls, regardless of anything else.
    // Confirmed via real profiling and a bisection test on issue #154: a
    // worker's own memory footprint grows with how many pages it's ever
    // rasterized over its lifetime (100MB+ after ~25 calls), not with
    // anything currently held on the JS side - disabling image
    // rasterization entirely kept total memory around 200MB even after a
    // full scroll through a 100+ page document, while disabling the
    // separate text-layer/pdf.js pipeline made no difference at all. Very
    // likely image-js's own internal decode/encode buffers, or a WASM
    // codec's linear memory, neither ever released mid-lifetime regardless
    // of what this plugin does on the JS side. Periodically discarding and
    // recreating the worker is the practical way to bound that when the
    // actual growth lives inside a dependency's own native/WASM state, not
    // anything reachable from this code.
    //
    // First tried at 20: confirmed the mechanism works (memory climbed to
    // 1.2GB, then dropped to 243MB once recycling kicked in), but a 1.2GB
    // peak before the first recycle landed is still far too high - it means
    // every worker ran nearly its whole lifetime before any of them got
    // replaced. Lowered to recycle more often, trading a bit more
    // Worker-recreation overhead (spinning up a fresh Worker and reloading
    // its bundled script isn't free) for a substantially lower ceiling.
    private static readonly MAX_CALLS_PER_WORKER = 8;

    constructor(private maxWorkers: number = navigator.hardwareConcurrency) {
        this.workers = Array(maxWorkers).fill(null).map(() =>
            new Worker()
        );
        this.queues = this.workers.map(() => Promise.resolve());
        this.callCounts = this.workers.map(() => 0);
    }

    // Terminates and replaces the worker at this index once it's handled
    // MAX_CALLS_PER_WORKER calls - see that constant's comment. Only called
    // from within processChunk()'s own queue chain, after a call settles
    // and before the next queued one runs, so there's never an in-flight
    // request on the worker being replaced.
    private recycleWorkerIfNeeded(workerIndex: number): void {
        this.callCounts[workerIndex]++;
        if (this.callCounts[workerIndex] < WorkerPool.MAX_CALLS_PER_WORKER) return;
        this.workers[workerIndex].terminate();
        this.workers[workerIndex] = new Worker();
        this.callCounts[workerIndex] = 0;
    }

    // Picks the next worker (round-robin across every call this pool ever
    // makes, not reset per processPages() call - see below) and queues onto
    // it rather than sending immediately.
    //
    // This used to just take a worker directly, relying on callers to keep
    // at most one in-flight request per worker (safe when processPages() was
    // the only caller: a single call's chunks always spread 1:1 across
    // distinct workers). Lazy per-page image loading (SupernoteView's
    // ensurePageImage(), see issue #147) broke that assumption - each is its
    // own separate processPages() call for a single page, which
    // chunkPageNumbers() always turns into exactly one chunk, previously
    // always dispatched to workers[0] (chunks.map's index is always 0 for a
    // one-chunk call). Several pages loading nearly at once (a fast scroll,
    // or the thumbnail sidebar loading every page at once) meant several
    // concurrent requests all landing on worker 0, each overwriting the
    // last's onmessage handler before its response arrived - silently
    // losing that page's result (rendered blank) or misdirecting it to
    // resolve a *different* page's promise instead (wrong image on the
    // wrong page). Queuing per-worker (so a worker only ever has one
    // request in flight) and round-robining across every call (so
    // concurrent single-page requests still spread across every worker,
    // instead of piling onto worker 0) fixes both.
    private processChunk(note: SupernoteX, pageNumbers: number[], scale?: number): Promise<string[]> {
        const workerIndex = this.nextWorker % this.workers.length;
        this.nextWorker++;

        // Sliced *before* ever constructing the message - see
        // extractPagesRenderData()'s comment for why sending the whole
        // `note` here was a real, serious memory bug (issue #154).
        const renderableNote = extractPagesRenderData(note, pageNumbers);

        const send = (): Promise<string[]> => new Promise((resolve, reject) => {
            // Looked up now, not captured at the top of processChunk() - a
            // prior queued call on this same index may have recycled the
            // worker (see recycleWorkerIfNeeded()) in the meantime.
            const worker = this.workers[workerIndex];
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
                note: renderableNote,
                scale
            };

            worker.postMessage(message);
        });

        const result = this.queues[workerIndex].then(send);
        // Marks this worker free again once this request settles, regardless
        // of outcome - a failed request shouldn't leave the next one waiting
        // forever. Deliberately swallows the rejection here: `result` (what
        // this call actually returns) still carries it to its own caller.
        // Also where recycling is checked - after the call settles, before
        // whatever's next in this worker's own queue runs.
        this.queues[workerIndex] = result.then(() => undefined, () => undefined)
            .then(() => this.recycleWorkerIfNeeded(workerIndex));
        return result;
    }

    async processPages(note: SupernoteX, allPageNumbers: number[], scale?: number): Promise<string[]> {
        //console.time('Total processing time');

        const chunks = chunkPageNumbers(allPageNumbers, this.workers.length);

        //console.log(`Processing ${allPageNumbers.length} pages in ${chunks.length} chunks`);

        // Process chunks concurrently - safe now regardless of how many land
        // on the same worker, or how many separate processPages() calls are
        // in flight at once (see processChunk()'s comment).
        const results = await Promise.all(
            chunks.map((chunk) => this.processChunk(note, chunk, scale))
        );

        //console.timeEnd('Total processing time');
        return results.flat();
    }

    terminate() {
        this.workers.forEach(worker => worker.terminate());
        this.workers = [];
    }
}

// Shared for the plugin's lifetime instead of every ImageConverter owning
// (and tearing down) its own WorkerPool. Spinning up hardwareConcurrency new
// Web Workers is real, fixed-cost work — previously paid on *every single*
// rasterization call regardless of outcome, so opening a note repeatedly
// paid full multi-worker startup/teardown cost every time. Created lazily
// (on first actual use) so plugin activation itself doesn't spin up workers
// before any note is opened; torn down once in SupernotePlugin.onunload().
let sharedWorkerPool: WorkerPool | undefined;
function getSharedWorkerPool(): WorkerPool {
    if (!sharedWorkerPool) {
        sharedWorkerPool = new WorkerPool();
    }
    return sharedWorkerPool;
}
function terminateSharedWorkerPool(): void {
    sharedWorkerPool?.terminate();
    sharedWorkerPool = undefined;
}

export class ImageConverter {
    // `scale` (default 1, full resolution): a positive integer downsample
    // factor forwarded all the way to supernote-typescript's toImage(),
    // which decodes directly at the reduced resolution rather than
    // downscaling a full-resolution decode afterward - see
    // https://github.com/philips/supernote-typescript/issues/40. Meant for
    // SupernoteView's thumbnail sidebar (see ensureThumbnail()), which
    // otherwise paid the same decode/memory cost as actually viewing the
    // page just to fill in a ~140px preview.
    async convertToImages(note: SupernoteX, pageNumbers?: number[], scale?: number): Promise<string[]> {
        const pages = pageNumbers ?? Array.from({length: note.pages.length}, (_, i) => i+1);
        return getSharedWorkerPool().processPages(note, pages, scale);
    }
}

// In-process extension point for other Obsidian plugins that want to enrich
// a page's text before it lands in the generated markdown — e.g. an OCR/LLM
// companion plugin transcribing handwriting the device's own recognition
// missed (see https://github.com/philips/supernote-obsidian-ocr-llm for a
// reference implementation against a local OpenAI-compatible server).
// Undocumented by design: the
// same "reach into another plugin's loaded instance" pattern Templater/
// Dataview expose their own APIs through, since Obsidian has no formal
// inter-plugin dependency mechanism. Callers must feature-detect
// (`app.plugins.plugins['supernote']?.registerPageTextProcessor`) and accept
// that this can change across versions.
export interface PageTextProcessorContext {
	/** 1-indexed, matching the "## Page N" headings in the generated markdown. */
	pageNumber: number;
	totalPages: number;
	/** Filename of the source .note file (e.g. "2026-01-15.note"). Not
	 *  necessarily saved into the vault — some import paths rasterize pages
	 *  without ever writing the raw .note itself. */
	sourceName: string;
	/** This page's text so far: the device's own recognized text (if any),
	 *  already run through any earlier-registered processors. Empty string
	 *  if none. */
	text: string;
	/** MIME type of the bytes `readImage()` resolves to. Currently always
	 *  "image/png" — the rasterization pipeline's one fixed output format —
	 *  but read this rather than assuming it, in case that ever changes. */
	imageMimeType: string;
	/** Reads this page's rasterized image bytes. Raw bytes rather than a
	 *  vault TFile: this runs whether or not the current export/import
	 *  actually wants image files saved into the vault, so there may be no
	 *  TFile backing it at all. */
	readImage(): Promise<ArrayBuffer>;
	/** This page's starred keywords, as Supernote's own handwriting
	 *  recognition read them (`IKeyword.KEYWORD`) — raw OCR'd text, in
	 *  encounter order, deduplicated. Not sanitized into Obsidian tag form;
	 *  that's a choice for whichever processor consumes this. Most starred
	 *  keywords never appear as literal text elsewhere on the page, so this
	 *  is the only way an external processor can see them at all. */
	keywords: string[];
	/** This page's own internal links (Supernote's link feature). Same-file
	 *  page anchors are already resolved (`ILink.text` gets `#Page N`
	 *  appended). Cross-file anchors are not — `ILink.LINKFILE` is the
	 *  base64-encoded absolute device path of the target `.note` file, for a
	 *  processor that wants to resolve that itself. */
	links: ILink[];
	/** This page's own PAGEID, if any — the identifier other notes' links
	 *  resolve against (empty string if the page has none). */
	pageId: string;
	/** This page's orientation, exactly as recorded in the `.note` file. */
	orientation: string;
	/** Whether the device's own handwriting recognition ran on this page,
	 *  and whether it completed — distinguishes "recognition never ran"
	 *  and "ran, found nothing" from `text` alone, which conflates both with
	 *  "recognition ran and found nothing". */
	recognitionStatus: RecognitionStatuses;
}

// This page's starred keywords (IKeyword.KEYWORD), deduplicated. sn.keywords'
// Record keys encode the 1-indexed page as their first 4 characters — the
// same convention _parseLinks documents for sn.links (see collectPageLinks
// below), and more reliable than IKeyword.KEYWORDPAGE, which can be '0'
// (invalid).
function collectPageKeywords(sn: SupernoteX, pageIndex: number): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const [key, entries] of Object.entries(sn.keywords)) {
		if (parseInt(key.slice(0, 4)) - 1 !== pageIndex) continue;
		for (const entry of entries) {
			const text = entry.KEYWORD.trim();
			if (text.length === 0 || seen.has(text)) continue;
			seen.add(text);
			result.push(text);
		}
	}
	return result;
}

// This page's own links. See supernote-typescript's _parseLinks doc comment
// for why sn.links' Record keys (not ILink.OBJPAGE) are the reliable way to
// find which page a link is drawn on.
function collectPageLinks(sn: SupernoteX, pageIndex: number): ILink[] {
	const result: ILink[] = [];
	for (const [key, entries] of Object.entries(sn.links)) {
		if (parseInt(key.slice(0, 4)) - 1 !== pageIndex) continue;
		result.push(...entries);
	}
	return result;
}

// Return the page's new text (replacing `ctx.text` entirely — a processor
// that wants to keep the existing text should fold it in itself), or
// null/undefined to leave it unchanged. Processors run in registration
// order, each seeing the previous one's output as `ctx.text`.
export type PageTextProcessor = (ctx: PageTextProcessorContext) => Promise<string | null | undefined>;

class VaultWriter {
	app: App;
	settings: SupernotePluginSettings;
	processors: Set<PageTextProcessor>;

	constructor(app: App, settings: SupernotePluginSettings, processors: Set<PageTextProcessor>) {
		this.app = app;
		this.settings = settings;
		this.processors = processors;
	}

	// `imageDataUrl` comes from the in-memory rasterization pass
	// (ImageConverter), independent of whether this export/import is also
	// writing that image out as a vault attachment — callers rasterize on
	// demand (see rasterizePages()) whenever processors are registered, even
	// for a markdown-only export that wouldn't otherwise touch images at all.
	private async applyPageTextProcessors(sourceName: string, pageIndex: number, sn: SupernoteX, text: string, imageDataUrl: string | undefined): Promise<string> {
		if (!imageDataUrl || this.processors.size === 0) return text;

		const page = sn.pages[pageIndex];
		const keywords = collectPageKeywords(sn, pageIndex);
		const links = collectPageLinks(sn, pageIndex);

		let result = text;
		for (const processor of this.processors) {
			try {
				const out = await processor({
					pageNumber: pageIndex + 1,
					totalPages: sn.pages.length,
					sourceName,
					text: result,
					imageMimeType: dataUrlMimeType(imageDataUrl),
					readImage: async () => dataUrlToBuffer(imageDataUrl),
					keywords,
					links,
					pageId: page.PAGEID ?? '',
					orientation: page.ORIENTATION,
					recognitionStatus: page.RECOGNSTATUS,
				});
				if (out !== null && out !== undefined) result = out;
			} catch (err) {
				console.error('Supernote page text processor failed:', err);
			}
		}
		return result;
	}

	// Rasterizes every page once via the worker pool. Callers that also need
	// the images written to the vault pass the result to writeImageFiles()
	// rather than rasterizing a second time.
	private async rasterizePages(sn: SupernoteX): Promise<string[]> {
		return new ImageConverter().convertToImages(sn);
	}

	// `images` (raw rasterized page data URLs, for processors) is independent
	// of `imgs` (vault TFiles, for the embedded image links) — a markdown-only
	// export passes `imgs: null` but can still pass `images` so registered
	// processors run, even though no image attachment gets saved.
	async writeMarkdownFile(file: TFile, sn: SupernoteX, imgs: TFile[] | null, images: string[] | null = null) {
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
			let pageText = sn.pages[i].text !== undefined && sn.pages[i].text.length > 0
				? processSupernoteText(sn.pages[i].text, this.settings)
				: '';
			pageText = await this.applyPageTextProcessors(file.name, i, sn, pageText, images?.[i]);
			if (pageText.length > 0) {
				content += `${pageText}\n`;
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

	// `images` is already-rasterized page data URLs (see rasterizePages()) —
	// this just persists them, so callers that also need them for text
	// processors rasterize once and pass the same array to both.
	async writeImageFiles(basename: string, images: string[]): Promise<TFile[]> {
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

		// This export doesn't otherwise touch images at all, but a registered
		// processor still needs one to work with — rasterize only when
		// there's actually a processor to hand it to.
		const images = this.processors.size > 0 ? await this.rasterizePages(sn) : null;
		await this.writeMarkdownFile(file, sn, null, images);
	}

	async attachNoteFiles(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));

		const images = await this.rasterizePages(sn);
		const imgs = await this.writeImageFiles(file.basename, images);
		await this.writeMarkdownFile(file, sn, imgs, images);
	}

	/**
	 * Converts a Supernote .note or .spd file (fetched from a device, not yet
	 * in the vault) into the requested format and returns markdown for
	 * inserting it inline into another note, rather than creating a new .md
	 * file for it.
	 */
	async buildInsertableContent(deviceFileName: string, noteBuffer: ArrayBuffer, targetPath: string, format: ImportFormat): Promise<string> {
		if (/\.spd$/i.test(deviceFileName)) {
			return this.buildInsertableAtelierContent(deviceFileName, noteBuffer, targetPath, format);
		}

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
			const images = await this.rasterizePages(sn);
			const pdfBytes = await assemblePdfFromImages(sn, images);
			const filename = await this.app.fileManager.getAvailablePathForAttachment(`${basename}.pdf`);
			const tfile = await this.app.vault.createBinary(filename, toArrayBuffer(pdfBytes));
			const link = this.app.fileManager.generateMarkdownLink(tfile, targetPath);
			return `${link}\n`;
		}

		const rasterized = await this.rasterizePages(sn);
		const imgs = await this.writeImageFiles(basename, rasterized);
		return this.renderPagesMarkdown(basename, sn, imgs, targetPath, format, deviceFileName, rasterized);
	}

	// `.spd` equivalent of buildInsertableContent above. `.spd` has no pages
	// and no recognized/OCR text (see rasterizeAtelier's doc comment below),
	// so 'images' and 'images-text' both reduce to the same single-image
	// output — there's no per-page text for the latter to add that the
	// former doesn't already have.
	private async buildInsertableAtelierContent(deviceFileName: string, buffer: ArrayBuffer, targetPath: string, format: ImportFormat): Promise<string> {
		const basename = deviceFileName.replace(/\.spd$/i, '');

		if (format === 'note-link' || format === 'embed') {
			const filename = await this.app.fileManager.getAvailablePathForAttachment(deviceFileName);
			const tfile = await this.app.vault.createBinary(filename, buffer);
			const link = this.app.fileManager.generateMarkdownLink(tfile, targetPath);
			return `${format === 'embed' ? '!' : ''}${link}\n`;
		}

		const dataUrl = await renderAtelierCompositeFromBuffer(new Uint8Array(buffer));
		if (dataUrl === null) {
			throw new Error(`"${deviceFileName}" has no drawn content to import.`);
		}

		if (format === 'pdf') {
			const pdfBytes = await buildSinglePagePdf(dataUrl);
			const filename = await this.app.fileManager.getAvailablePathForAttachment(`${basename}.pdf`);
			const tfile = await this.app.vault.createBinary(filename, toArrayBuffer(pdfBytes));
			const link = this.app.fileManager.generateMarkdownLink(tfile, targetPath);
			return `${link}\n`;
		}

		const filename = await this.app.fileManager.getAvailablePathForAttachment(`${basename}.png`);
		const tfile = await this.app.vault.createBinary(filename, dataUrlToBuffer(dataUrl));
		const alt = this.settings.invertColorsWhenDark ? 'supernote-invert-dark' : '';
		const link = generateMarkdownImageEmbed(this.app, tfile, targetPath, alt);
		return `## ${basename}\n\n${link}\n`;
	}

	// Shared page-by-page markdown body (heading + optional recognized text +
	// image embed) used by buildInsertableContent's images/images-text formats.
	private async renderPagesMarkdown(basename: string, sn: SupernoteX, imgs: TFile[], targetPath: string, format: ImportFormat, sourceName: string, rasterized: string[]): Promise<string> {
		let content = `## ${basename}\n\n`;
		for (let i = 0; i < sn.pages.length; i++) {
			content += `### Page ${i + 1}\n\n`;
			if (format === 'images-text') {
				let pageText = sn.pages[i].text !== undefined && sn.pages[i].text.length > 0
					? processSupernoteText(sn.pages[i].text, this.settings)
					: '';
				pageText = await this.applyPageTextProcessors(sourceName, i, sn, pageText, rasterized[i]);
				if (pageText.length > 0) {
					content += `${pageText}\n`;
				}
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
		const images = await this.rasterizePages(sn);

		const pdfBytes = await assemblePdfFromImages(sn, images);

		// Generate filename and save
		const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}.pdf`);
		await this.app.vault.createBinary(filename, toArrayBuffer(pdfBytes));
	}

	// `.spd` (Supernote Atelier) equivalents of the exports above. Unlike
	// `.note`, `.spd` has no pages and no recognized/OCR text — just one
	// flattened composite image (see renderAtelierCompositeDataUrl).
	private async rasterizeAtelier(file: TFile): Promise<string> {
		const dataUrl = await renderAtelierCompositeDataUrl(this.app, file);
		if (dataUrl === null) {
			throw new Error(`"${file.basename}.spd" has no drawn content to export.`);
		}
		return dataUrl;
	}

	async attachAtelierImage(file: TFile): Promise<TFile> {
		const dataUrl = await this.rasterizeAtelier(file);
		const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}.png`);
		return this.app.vault.createBinary(filename, dataUrlToBuffer(dataUrl));
	}

	async exportAtelierToPDF(file: TFile) {
		const dataUrl = await this.rasterizeAtelier(file);
		const pdfBytes = await buildSinglePagePdf(dataUrl);

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
	// Releases this document's resources in pdf.js's own internal Worker -
	// see onLoadFile()'s call to this before replacing pdfDocPromise with a
	// new file's document. Without it, pdf.js's worker keeps every
	// previously-opened note's parsed PDF resident for as long as the
	// Supernote view itself stays open, accumulating across every note
	// switch in a session (confirmed via a real Task Manager reading on
	// issue #154: pdf.worker.min.mjs alone was 82.4MB).
	destroy(): Promise<void>;
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
	// zoom-critical path. null until ensurePageImage() loads it, and again
	// after evictPageImage() frees it. Full page resolution - see
	// thumbnailDataUrl below for the separate, cheap thumbnail-only path.
	imageBitmap: ImageBitmap | null;
	// This page's full-resolution rasterized PNG data URL, once
	// ensurePageImage() loads it — needed for the "Save image to vault"
	// button. null again after evictPageImage().
	imageDataUrl: string | null;
	// In-flight/completed load, so a page nearing the viewport (pageObserver),
	// an explicit jump (goToPage), and "Save image to vault" can't each kick
	// off their own separate rasterization of the same page. Reset to null
	// by evictPageImage() so a later reload isn't mistaken for one already
	// in flight/done.
	imageLoadPromise: Promise<void> | null;
	// This page's thumbnail, entirely independent of imageBitmap/imageDataUrl
	// above: rasterized at THUMBNAIL_SCALE (a fraction of full page
	// resolution, see ensureThumbnail()) rather than reusing the full-size
	// image, since most of the time a visible thumbnail's page isn't also
	// open in the main view. null until ensureThumbnail() loads it, and
	// again after evictThumbnail() frees it.
	thumbnailDataUrl: string | null;
	thumbnailLoadPromise: Promise<void> | null;
	// Whether this page is currently within pageObserver's margin (main
	// view), or its thumbnail item is within thumbObserver's margin
	// (sidebar) - each drives its own independent load/evict cycle
	// (ensurePageImage()/evictPageImage() for the former,
	// ensureThumbnail()/evictThumbnail() for the latter), since the two no
	// longer share a resolution/cost to begin with.
	visibleInMainView: boolean;
	visibleInThumbnail: boolean;
	// Debounces thumbObserver's load trigger (not eviction) - see its doc
	// comment in buildThumbSidebar().
	thumbLoadDebounceTimer: number | undefined;
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
	// Retained (rather than a local in onLoadFile) so ensurePageImage() can
	// rasterize a single page on demand, well after onLoadFile() itself has
	// returned — see issue #147.
	private sn: SupernoteX | null = null;

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
	// Scoped to the thumbnail sidebar's own scroll container, not contentEl -
	// re-created per file load in buildThumbSidebar() (thumbSidebarEl itself
	// is a fresh element each load, and root can't be changed after an
	// IntersectionObserver is constructed). Drives ensureThumbnail()/
	// evictThumbnail(), entirely independent of pageObserver/
	// ensurePageImage()/evictPageImage() above - see
	// PageRenderState.thumbnailDataUrl for why the two no longer share a
	// load/evict cycle.
	private thumbObserver: IntersectionObserver | null = null;

	private layerMode: 'image' | 'text' = 'image';
	private imageModeBtn: HTMLElement | null = null;
	private textModeBtn: HTMLElement | null = null;

	private thumbnailsVisible = false;
	private thumbToggleBtn: HTMLElement | null = null;
	private thumbSidebarEl: HTMLElement | null = null;
	private thumbItems: HTMLElement[] = [];
	// Parallel to thumbItems/pageStates — empty (no `src`) until
	// ensurePageImage() loads that page, or until the sidebar is first
	// opened (see toggleThumbnails()), whichever happens first.
	private thumbImgs: HTMLImageElement[] = [];

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
		//
		// On mobile (issue #148 - reported on an iPhone 13 mini, but likely
		// any small screen), that same ancestor padding on the left/right/
		// bottom sides is real, wasted width on a screen already tight for
		// legibility of handwritten content - left alone on desktop, where a
		// window is normally wide enough that it isn't a meaningful loss.
		// div.page-container's own margin gets the equivalent reduction in
		// styles.css, scoped to body.is-mobile the same way.
		this.contentEl.setCssStyles(
			Platform.isMobile
				? { paddingTop: '0', paddingLeft: '0.25em', paddingRight: '0.25em', paddingBottom: '0.25em' }
				: { paddingTop: '0' },
		);

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

		// Loads each page's image and selectable text lazily, only once it's
		// about to scroll into view (rootMargin prefetches a screen ahead/
		// behind so it feels instant by the time you actually get there) —
		// for a long note, rasterizing/decoding/drawing every page's image
		// (and building N pages' worth of text-layer DOM) upfront is real,
		// mostly wasted work if you only ever look at the first few pages,
		// and scales memory with page count regardless (see issue #147).
		// Also evicts a page's image once it scrolls back *out* of that same
		// margin (see evictPageImage()) - loading lazily instead of upfront
		// bounds memory by "how many pages are near the viewport right now"
		// rather than "how many have been scrolled past so far", which for a
		// long enough document (100 pages, see issue #154) still grows
		// without bound as you keep scrolling even though each individual
		// page loads lazily. Text layers are left alone for eviction - much
		// lighter (a string + some span elements, not a decoded bitmap/
		// canvas backing store) and losing search state/highlights on
		// scroll-past would be a worse trade for a small saving.
		//
		// Independent of thumbObserver (see buildThumbSidebar()) - each page
		// now has its own separate full-resolution (this) and thumbnail
		// (that one) load/evict cycle, rather than sharing one, since a
		// thumbnail no longer costs anywhere near what the full main-view
		// image does (see ensureThumbnail()).
		// Re-observes fresh page containers each file load; see onLoadFile().
		this.pageObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const state = this.pageStates.find((s) => s.pageContainer === entry.target);
				if (!state) continue;
				state.visibleInMainView = entry.isIntersecting;
				if (entry.isIntersecting) {
					void this.ensurePageImage(state);
					void this.ensureTextLayer(state);
				} else {
					this.evictPageImage(state);
				}
			}
		}, { root: this.contentEl, rootMargin: '100% 0px' });
	}

	async onLoadFile(file: TFile): Promise<void> {
		const container = this.contentEl;
		container.empty();

		// Releases the *previous* file's pdf.js document, if any, in pdf.js's
		// own internal Worker - see PdfJsDocument.destroy()'s comment for why
		// this matters (confirmed via a real Task Manager reading on issue
		// #154: pdf.worker.min.mjs alone was 82.4MB, apparently never
		// released across note switches). Fire-and-forget: doesn't block
		// this file's own loading on the previous one's teardown, and the
		// previous promise may still be in-flight (a fast note switch) -
		// .then() waits for whatever state it's actually in first. Silently
		// swallows a rejection - a note that failed to build a PDF in the
		// first place has nothing to destroy, and either way there's
		// nothing useful to do about it here.
		this.pdfDocPromise?.then((doc) => doc.destroy()).catch(() => { /* nothing to clean up */ });

		window.clearTimeout(this.zoomDebounceTimer);
		this.pageObserver?.disconnect();
		this.thumbObserver?.disconnect();
		// Disconnecting the observer stops new callbacks, but doesn't cancel
		// timers already scheduled by earlier ones - without this, one could
		// still fire after the file switch and redundantly load a page from
		// a note the user has already navigated away from.
		for (const state of this.pageStates) window.clearTimeout(state.thumbLoadDebounceTimer);
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
		this.sn = sn;
		this.pageIds = sn.pages.map((p) => p.PAGEID ?? '');
		const linksByPage = bucketLinksByPage(sn.links);

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
		this.buildToolbar(this.headerEl, sn.pages.length);
		this.buildFindBar(this.headerEl);
		this.updateThumbSidebarOffset();

		const body = container.createDiv({ cls: 'supernote-body' });
		this.buildThumbSidebar(body, sn.pages.length, sn.pageWidth, sn.pageHeight);

		this.pagesEl = body.createDiv({ cls: 'supernote-pages' });
		this.pagesEl.toggleClass('supernote-mode-text', this.layerMode === 'text');

		// Page containers/canvases are built for every page up front (cheap —
		// just DOM elements, sized from sn.pageWidth/pageHeight, which are
		// already known without rasterizing anything), but each page's actual
		// image is loaded lazily by ensurePageImage() — see pageObserver in
		// onOpen(). Rasterizing, decoding, and drawing every page immediately
		// (the previous behavior) scaled memory with page count regardless of
		// how much of the note was ever actually looked at — see issue #147.
		const renderStart = performance.now();

		for (let i = 0; i < sn.pages.length; i++) {
			const pageContainer = this.pagesEl.createDiv({
				cls: 'page-container',
			})

			const canvasWrap = pageContainer.createDiv({ cls: 'supernote-canvas-wrap' });
			const canvas = canvasWrap.createEl("canvas");
			if (this.settings.invertColorsWhenDark) {
				canvas.addClass("supernote-invert-dark");
			}

			const state: PageRenderState = {
				pageNumber: i + 1,
				pdfPage: null,
				nativeWidth: sn.pageWidth,
				nativeHeight: sn.pageHeight,
				pageContainer,
				canvasWrap,
				canvas,
				textLayerDiv: canvasWrap.createDiv({ cls: 'textLayer' }),
				linksLayerDiv: canvasWrap.createDiv({ cls: 'supernote-links-layer' }),
				linkEls: [],
				imageBitmap: null,
				imageDataUrl: null,
				imageLoadPromise: null,
				thumbnailDataUrl: null,
				thumbnailLoadPromise: null,
				visibleInMainView: false,
				visibleInThumbnail: false,
				thumbLoadDebounceTimer: undefined,
				textLayerLoaded: false,
				text: '',
				spans: [],
			};
			this.pageStates.push(state);

			// Deliberately NOT draggable. A previous version wired up manual
			// drag-out (canvas doesn't get it natively the way <img> does) by
			// putting the page's raw data: URL straight into the drag data —
			// dropping that into a note inserts the *entire* base64-encoded
			// PNG as literal text (there's no vault file to link to; nothing
			// was ever saved), which for a real page-resolution image is
			// enough text to lock up the editor. "Save image to vault" below
			// is the safe equivalent: it creates a real attachment file and
			// only does so on an explicit click, not on every page anyone
			// happens to view. A correct drag-out would need the same
			// save-to-vault to finish *before* the drop, and dataTransfer can
			// only be populated synchronously inside dragstart — not
			// attempted here for that reason. See #152.

			for (const link of linksByPage.get(i) ?? []) {
				const rect = parseLinkRect(link.LINKRECT);
				if (!rect) continue;
				const el = state.linksLayerDiv.createEl('a', {
					cls: 'supernote-link-rect',
					attr: { href: '#', title: link.text },
				});
				el.addEventListener('click', (evt) => {
					evt.preventDefault();
					void this.handleLinkClick(link);
				});
				state.linkEls.push({ el, rect });
			}

			// No image yet (imageBitmap is null) — this only sizes the canvas
			// and its overlays correctly from nativeWidth/nativeHeight, same as
			// every subsequent zoom redraw. ensurePageImage() calls this again
			// once the page's actual image is loaded.
			this.drawPageImage(state, this.zoomScale);

			this.pageObserver?.observe(pageContainer);

			// Create a button to save image to vault
			if (this.settings.showExportButtons) {
				const saveButton = pageContainer.createEl("button", {
					text: "Save image to vault",
					cls: "mod-cta",
				});

				saveButton.addEventListener("click", () => void (async () => {
					// Force the load rather than assuming pageObserver already
					// triggered it — a save click is always possible before a
					// page's ever scrolled into view (e.g. a very tall page,
					// or a fast click right after load).
					await this.ensurePageImage(state);
					if (!state.imageDataUrl) return;
					const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}-${i + 1}.png`);
					const buffer = dataUrlToBuffer(state.imageDataUrl);
					await this.app.vault.createBinary(filename, buffer);
				})());
			}
		}

		console.debug(`Supernote: page render — DOM build ${(performance.now() - renderStart).toFixed(1)}ms for ${sn.pages.length} page(s) (images load lazily as pages scroll into view)`);

		if (this.fitWidthEnabled) {
			this.applyFitWidth();
		}
		this.updateCurrentPageIndicator();

		// Kicked off now — after pages are already visible from their own
		// rasterized images (drawPageImage() above, no pdf.js involved at
		// all) — rather than before rendering them, so this fire-and-forget
		// pipeline (still real work on this same single JS thread) can't
		// compete with/inflate the apparent cost of the page-render loop.
		// Only the text layer (selection/search) needs this, lazily, per
		// page — see ensureTextLayer() — so delaying it only delays search
		// readiness, not anything visible. Uses assembleTextOnlyPdf() (no
		// page images at all — see its doc comment) rather than
		// assemblePdfFromImages(), since this PDF is only ever handed to
		// pdf.js for getTextContent()/getViewport(), never rendered/shown.
		if (supernoteDebugFlags.disableTextLayer) {
			console.debug('Supernote: search text layer — skipped (supernoteDebug.disableTextLayer)');
			this.pdfDocPromise = null;
			return;
		}
		this.pdfDocPromise = (async () => {
			// Logged stage-by-stage (see issue #147): a hard native crash
			// here has no catchable JS error to report — ensureTextLayer()'s
			// own try/catch only fires for an ordinary thrown exception, and
			// wouldn't run at all if nothing ever scrolled a page into view.
			// The last of these lines to print is the closest thing to a
			// stack trace such a crash leaves behind.
			console.debug('Supernote: search text layer — building text-only PDF…');
			const pdfBytes = await assembleTextOnlyPdf(sn);
			console.debug(`Supernote: search text layer — text-only PDF built (${pdfBytes.byteLength} bytes), loading pdf.js…`);
			this.pdfjsLib = await loadPdfJs() as PdfJsLib;
			console.debug('Supernote: search text layer — pdf.js loaded, parsing PDF…');
			const pdfDoc = await this.pdfjsLib.getDocument({ data: pdfBytes }).promise;
			console.debug('Supernote: search text layer — ready');
			return pdfDoc;
		})();
	}

	// Best-effort memory estimate for logPageMemoryTrace() below - not used
	// for any actual decision, just to give a sense of scale when
	// investigating a suspected memory issue (see issue #154). Accounts for
	// both the decoded ImageBitmap (native page resolution) and the canvas
	// backing store, which is typically larger - up to 9x the bitmap's pixel
	// count at capped 3x devicePixelRatio (see drawPageImage()) - since both
	// are held in memory per loaded page. thumbnailDataUrl's own (much
	// smaller) memory isn't included here - see ensureThumbnail()/
	// evictThumbnail()'s own tracing below instead.
	private estimatedPageMemoryBytes(state: PageRenderState): number {
		if (!state.imageBitmap) return 0;
		const bitmapBytes = state.imageBitmap.width * state.imageBitmap.height * 4;
		const canvasBytes = state.canvas.width * state.canvas.height * 4;
		return bitmapBytes + canvasBytes;
	}

	// Traces every full-resolution load/evict with a running total across
	// every currently-loaded page - added to make a suspected leak (issue
	// #154: scrolling through all 100 pages of a long document still
	// eventually crashes, even after #155/#156/#158/#159/#162's fixes)
	// directly observable. Watch whether "currently loaded" keeps climbing
	// over a long scroll (something isn't actually being freed) or stays
	// roughly bounded (eviction is working and the cause is something else
	// entirely - see #166's fix for what that turned out to be: the whole
	// note being cloned to a Worker on every lazy load, not a JS-visible
	// leak at all). Easiest to correlate on desktop, where DevTools' own
	// Memory tab (or, given #166's finding, a Worker-specific heap
	// snapshot) can be cross-checked against these numbers directly.
	private logPageMemoryTrace(action: 'loaded' | 'evicted', pageNumber: number, pageBytes: number): void {
		const loadedStates = this.pageStates.filter((s) => s.imageBitmap !== null);
		const totalBytes = loadedStates.reduce((sum, s) => sum + this.estimatedPageMemoryBytes(s), 0);
		const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
		console.debug(
			`Supernote: page ${pageNumber} ${action} (~${mb(pageBytes)}MB) — ` +
			`${loadedStates.length} page(s) currently loaded, ~${mb(totalBytes)}MB estimated total`,
		);
	}

	// Loads this page's own full-resolution rasterized image if it hasn't
	// been already — triggered by pageObserver as a page nears the
	// viewport, or forced immediately by page-jump/save-image so those
	// don't have to wait on scroll+observer timing. Idempotent (safe to
	// call speculatively) and de-duplicated against a concurrent call via
	// imageLoadPromise, the same pattern ensureTextLayer() uses for its own
	// one-time work. Entirely independent of ensureThumbnail() below - see
	// PageRenderState.thumbnailDataUrl for why they no longer share a load.
	private ensurePageImage(state: PageRenderState): Promise<void> {
		if (supernoteDebugFlags.disableImages) return Promise.resolve();
		if (state.imageBitmap) return Promise.resolve();
		if (state.imageLoadPromise) return state.imageLoadPromise;

		state.imageLoadPromise = (async () => {
			try {
				if (!this.sn) return;
				const [imageDataUrl] = await new ImageConverter().convertToImages(this.sn, [state.pageNumber]);
				// The page can easily have scrolled back out of view while
				// this was in flight (a worker round-trip, ~100-300ms) - on a
				// fast scroll through a long document, most in-flight loads
				// lose this race. Finalizing anyway would leave this page
				// "stuck" loaded forever: eviction only re-triggers on the
				// *next* intersection transition (see pageObserver in
				// onOpen()), which won't happen again until the user
				// scrolls back to this exact page. Confirmed as the actual
				// cause of issue #154's runaway growth during a fast scroll
				// via real profiling: "currently loaded" climbed past 30
				// pages with zero evictions, well beyond pageObserver's
				// rootMargin window. Resetting imageLoadPromise (not just
				// bailing out) lets a later re-visit trigger a fresh load
				// instead of reusing this now-settled, empty-result promise.
				if (!state.visibleInMainView) {
					state.imageLoadPromise = null;
					return;
				}
				state.imageDataUrl = imageDataUrl;
				const blob = new Blob([dataUrlToBuffer(imageDataUrl)], { type: 'image/png' });
				const bitmap = await createImageBitmap(blob);
				// Re-checked again here - createImageBitmap() is itself
				// async, another window for the same race to happen in.
				if (!state.visibleInMainView) {
					bitmap.close();
					state.imageDataUrl = null;
					state.imageLoadPromise = null;
					return;
				}
				state.imageBitmap = bitmap;
				this.drawPageImage(state, this.zoomScale);
				this.logPageMemoryTrace('loaded', state.pageNumber, this.estimatedPageMemoryBytes(state));
			} catch (err) {
				console.error(`Supernote: failed to load page ${state.pageNumber}'s image:`, err);
			}
		})();
		return state.imageLoadPromise;
	}

	// Downsample factor for ensureThumbnail() below - the sidebar only ever
	// displays a thumbnail at ~140px CSS width (see .supernote-thumb-img in
	// styles.css), so there's no reason to pay full-page-resolution
	// rasterization cost just to shrink it back down via CSS afterward (see
	// https://github.com/philips/supernote-typescript/issues/40, and issue
	// #154's crash trail generally). Picked so a typical Supernote page
	// (~1400px wide) decodes to comfortably above the sidebar's own width,
	// with headroom for higher-DPI displays, while still being a small
	// fraction of the full-resolution decode/memory cost.
	private static readonly THUMBNAIL_SCALE = 4;

	// Loads this page's own thumbnail-resolution image if it hasn't been
	// already — triggered by thumbObserver as its sidebar item nears the
	// viewport (see buildThumbSidebar()). Same idempotent/de-duplicated
	// pattern as ensurePageImage(), but entirely separate state
	// (thumbnailDataUrl/thumbnailLoadPromise) and its own, much cheaper
	// rasterization at THUMBNAIL_SCALE - a thumbnail being visible doesn't
	// imply the main view wants this page's full-resolution image too, and
	// vice versa, so there's no reason for one to force-load the other.
	private ensureThumbnail(state: PageRenderState): Promise<void> {
		if (supernoteDebugFlags.disableImages) return Promise.resolve();
		if (state.thumbnailDataUrl) return Promise.resolve();
		if (state.thumbnailLoadPromise) return state.thumbnailLoadPromise;

		state.thumbnailLoadPromise = (async () => {
			try {
				if (!this.sn) return;
				const [dataUrl] = await new ImageConverter().convertToImages(
					this.sn, [state.pageNumber], SupernoteView.THUMBNAIL_SCALE,
				);
				// Same race as ensurePageImage()'s own check above - the
				// sidebar can easily have scrolled this item back out of
				// view while the (debounced, but still real) rasterization
				// was in flight. See that comment for why finalizing anyway
				// would leave this stuck loaded forever.
				if (!state.visibleInThumbnail) {
					state.thumbnailLoadPromise = null;
					return;
				}
				state.thumbnailDataUrl = dataUrl;
				const thumbImg = this.thumbImgs[state.pageNumber - 1];
				if (thumbImg) thumbImg.src = dataUrl;
				this.logThumbnailMemoryTrace('loaded', state.pageNumber, dataUrl.length);
			} catch (err) {
				console.error(`Supernote: failed to load page ${state.pageNumber}'s thumbnail:`, err);
			}
		})();
		return state.thumbnailLoadPromise;
	}

	// Frees a page's thumbnail once its sidebar item scrolls back out of
	// thumbObserver's viewport (see buildThumbSidebar()) - independent of
	// evictPageImage() below, since loading/evicting a thumbnail no longer
	// has anything to do with the main view's own full-resolution state.
	private evictThumbnail(state: PageRenderState): void {
		if (!state.thumbnailDataUrl) return;
		const dataUrlLength = state.thumbnailDataUrl.length;
		state.thumbnailDataUrl = null;
		state.thumbnailLoadPromise = null;
		const thumbImg = this.thumbImgs[state.pageNumber - 1];
		if (thumbImg) thumbImg.src = '';
		this.logThumbnailMemoryTrace('evicted', state.pageNumber, dataUrlLength);
	}

	// Same trace as logPageMemoryTrace() above, but for the separate,
	// much-cheaper thumbnail path (see THUMBNAIL_SCALE) - added alongside
	// it so a suspected leak/residual memory issue (issue #154) can be
	// attributed to whichever path is actually responsible, not just
	// full-resolution main-view pages. Estimates bytes from the data URL's
	// own string length (base64, ~4/3 of the underlying binary size) -
	// there's no canvas backing store to account for here, unlike
	// estimatedPageMemoryBytes().
	private logThumbnailMemoryTrace(action: 'loaded' | 'evicted', pageNumber: number, dataUrlLength: number): void {
		const loadedCount = this.pageStates.filter((s) => s.thumbnailDataUrl !== null).length;
		const totalChars = this.pageStates.reduce((sum, s) => sum + (s.thumbnailDataUrl?.length ?? 0), 0);
		const kb = (chars: number) => ((chars * 0.75) / 1024).toFixed(1);
		console.debug(
			`Supernote: page ${pageNumber} thumbnail ${action} (~${kb(dataUrlLength)}KB) — ` +
			`${loadedCount} thumbnail(s) currently loaded, ~${kb(totalChars)}KB estimated total`,
		);
	}

	// Draws the page's own already-decoded bitmap at the given scale — no
	// pdf.js involved. Synchronous (drawImage from an ImageBitmap doesn't
	// need awaiting), so redrawing on every zoom tick is cheap; pdf.js's own
	// pdfPage.render() had to redecode the embedded PDF image every time.
	private drawPageImage(state: PageRenderState, scale: number) {
		const width = Math.max(1, Math.round(state.nativeWidth * scale));
		const height = Math.max(1, Math.round(state.nativeHeight * scale));

		// CSS (layout) size always tracks the current zoom, for every page,
		// regardless of whether its image is actually loaded right now.
		// commitZoom() calls this unconditionally for every page on every
		// zoom change - scroll position, thumbnail click-to-jump, and
		// page-anchor links all depend on every page's box being the right
		// height even for pages that aren't currently loaded (never viewed
		// yet, or evicted after scrolling away - see evictPageImage()).
		state.canvas.setCssStyles({ width: `${width}px`, height: `${height}px` });
		state.canvasWrap.setCssStyles({ width: `${width}px`, height: `${height}px` });
		state.textLayerDiv.setCssStyles({ width: `${width}px`, height: `${height}px` });
		state.linksLayerDiv.setCssStyles({ width: `${width}px`, height: `${height}px` });
		this.positionLinkOverlay(state, width, height);

		// The backing store (actual pixel buffer - the expensive part) only
		// needs to match this size when there's a real image to draw into
		// it. Previously resized unconditionally here, which meant
		// commitZoom()'s loop over every page reallocated a full-size
		// backing store for every page in the document on every zoom
		// change, including pages nowhere near the viewport - undoing lazy
		// loading's whole memory benefit for a long document the moment you
		// touched zoom at all (see issue #154). A page with no imageBitmap
		// keeps whatever backing store size it already has (a fresh
		// <canvas>'s browser default, or evictPageImage()'s 1x1 shrink) -
		// the browser just stretches/blurs that placeholder to fill the CSS
		// box above, fine since such a page is off-screen by definition.
		if (!state.imageBitmap) return;

		// Rendering the backing store at devicePixelRatio and leaving the
		// CSS size alone (set above) fixes the "chunky artifacts" a 1:1
		// backing store gets upscaled into on a high-DPR mobile screen;
		// capped at 3 so an extreme DPR display doesn't blow up canvas
		// memory for no visible benefit.
		const dpr = Math.min(window.devicePixelRatio || 1, 3);
		const bitmapWidth = Math.max(1, Math.round(width * dpr));
		const bitmapHeight = Math.max(1, Math.round(height * dpr));
		state.canvas.width = bitmapWidth;
		state.canvas.height = bitmapHeight;
		state.canvas.getContext("2d")?.drawImage(state.imageBitmap, 0, 0, bitmapWidth, bitmapHeight);
	}

	// Frees a page's full-resolution decoded image once it's scrolled back
	// out of pageObserver's margin (see onOpen()). Lazy *loading* alone
	// still lets memory grow without bound on a long enough document as the
	// main view is scrolled, since nothing ever released an earlier page's
	// bitmap/canvas backing store once loaded (see issue #154). Safe to
	// call speculatively: a no-op if nothing's actually loaded (most pages,
	// most of the time - pageObserver also reports initial non-intersection
	// for anything outside the viewport at file-open time). Entirely
	// independent of evictThumbnail() below - this only ever touches the
	// main view's own state, never the thumbnail sidebar's.
	private evictPageImage(state: PageRenderState): void {
		if (!state.imageBitmap) return;
		// Captured before freeing anything below - there'd be nothing left
		// to measure afterward.
		const pageBytes = this.estimatedPageMemoryBytes(state);

		// Releases the decoded bitmap's memory explicitly rather than
		// waiting on GC to notice it's unreachable.
		state.imageBitmap.close();
		state.imageBitmap = null;
		state.imageDataUrl = null;
		// Lets a later re-entry actually reload instead of reusing this
		// already-settled (but now stale) promise - ensurePageImage()'s
		// imageBitmap check alone isn't enough once it's null again.
		state.imageLoadPromise = null;

		// The backing store doesn't shrink on its own just because nothing
		// points at an ImageBitmap for it anymore - a canvas keeps its full
		// pixel buffer resident until its width/height actually change.
		// Deliberately doesn't touch CSS size (drawPageImage() already set
		// that correctly and it doesn't need to change) - only this.
		state.canvas.width = 1;
		state.canvas.height = 1;

		this.logPageMemoryTrace('evicted', state.pageNumber, pageBytes);
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
			// See issue #147: if this ever crashes hard (no catchable JS
			// error), the last of these lines to print is the closest thing
			// to a stack trace it leaves behind.
			console.debug(`Supernote: text layer — page ${state.pageNumber} awaiting PDF…`);
			const pdfDoc = await this.pdfDocPromise;
			if (!pdfDoc) return;

			if (!state.pdfPage) {
				state.pdfPage = await pdfDoc.getPage(state.pageNumber);
			}
			const pdfPage = state.pdfPage;

			console.debug(`Supernote: text layer — page ${state.pageNumber} building…`);
			const viewport = pdfPage.getViewport({ scale: this.zoomScale });
			await this.buildTextLayerForState(pdfPage, state, viewport);
			console.debug(`Supernote: text layer — page ${state.pageNumber} ready`);
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
		const zoomResetBtn = zoomGroup.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Reset zoom' } });
		setIcon(zoomResetBtn, 'rotate-ccw');
		this.fitWidthBtn = zoomGroup.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Fit page to viewport width' } });
		setIcon(this.fitWidthBtn, 'stretch-horizontal');

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
		this.imageModeBtn = layerGroup.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Show page image' } });
		setIcon(this.imageModeBtn, 'image');
		this.textModeBtn = layerGroup.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Show recognized text' } });
		setIcon(this.textModeBtn, 'type');
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

	// Reuses the same page PNGs ensurePageImage() rasterizes for the main
	// view (see thumbImg assignment there) — no separate low-res render pass,
	// just let CSS scale them down. Starts empty (no `src`) for every page:
	// images are no longer all ready up front (see issue #147), so a
	// thumbnail fills in whenever its page happens to load - from scrolling
	// the main view, or all at once when the sidebar is first opened, see
	// toggleThumbnails().
	private buildThumbSidebar(body: HTMLElement, pageCount: number, pageWidth: number, pageHeight: number) {
		const thumbSidebarEl = body.createDiv({ cls: 'supernote-thumb-sidebar' });
		this.thumbSidebarEl = thumbSidebarEl;
		this.thumbItems = [];
		this.thumbImgs = [];

		// Scoped to this sidebar's own scroll container (it scrolls
		// independently of the main view - see CSS `overflow-y: auto` on
		// .supernote-thumb-sidebar), not contentEl. A fresh observer every
		// file load: thumbSidebarEl above is itself a brand new element each
		// time, and an IntersectionObserver's root can't be changed after
		// construction, so the one from any previous file load (disconnected
		// in onLoadFile()) can't just be reused here. While the sidebar is
		// hidden (display: none, see applyThumbSidebarVisibility()) every
		// item reports non-intersecting - it has no layout box to intersect
		// with - so nothing loads until it's actually shown; opening it then
		// only loads whichever thumbnails are actually scrolled into view in
		// it.
		//
		// No rootMargin prefetch buffer here, unlike pageObserver's '100%
		// 0px' - confirmed by testing (issue #154): opening the sidebar at
		// all still crashed even after this observer existed, because a
		// percentage margin is relative to the *root's own* size, and a
		// thumbnail item (~150-250px, image + label) is much smaller than a
		// main-view page (often near-full-viewport). The same 100% margin
		// that only ever brings 1-2 main-view pages into range at once fit
		// several times that many thumbnails into an equivalent pixel
		// margin. A thumbnail popping in slightly after it's actually
		// scrolled to is an acceptable trade-off for a navigation aid,
		// unlike the main reading view.
		// Loading itself (not eviction) is also debounced ~200ms - confirmed
		// by testing (issue #154): even bounded to "only what's visible" and
		// with the pop/reflow fixed, scrolling the sidebar *quickly* through
		// many pages still crashed, while scrolling slowly was fine. A fast
		// scroll flings most thumbnails past the viewport well within that
		// window, each one triggering (then almost immediately evicting) a
		// rasterization in quick succession. Debouncing means a thumbnail
		// that's only ever transiently intersecting during a fast scroll
		// never triggers a load at all - only ones the user actually lingers
		// near for a moment do. Eviction isn't debounced: freeing memory
		// promptly has no downside. Since ensureThumbnail() below now
		// rasterizes at a small fraction of full page resolution rather than
		// reusing the same path as the main view (see
		// https://github.com/philips/supernote-typescript/issues/40), this
		// debounce mostly just avoids pointless work for a fast flyby, not a
		// crash risk on its own - kept regardless, since there's still no
		// reason to rasterize a thumbnail nobody actually looked at.
		this.thumbObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const index = this.thumbItems.indexOf(entry.target as HTMLElement);
				if (index === -1) continue;
				const state = this.pageStates[index];
				if (!state) continue;
				state.visibleInThumbnail = entry.isIntersecting;
				window.clearTimeout(state.thumbLoadDebounceTimer);
				if (entry.isIntersecting) {
					state.thumbLoadDebounceTimer = window.setTimeout(() => {
						// Re-checks rather than assuming still true - the
						// timer firing doesn't mean nothing happened since
						// it was scheduled.
						if (state.visibleInThumbnail) void this.ensureThumbnail(state);
					}, 200);
				} else {
					this.evictThumbnail(state);
				}
			}
		}, { root: thumbSidebarEl });

		for (let i = 0; i < pageCount; i++) {
			const item = thumbSidebarEl.createDiv({ cls: 'supernote-thumb-item' });
			const img = item.createEl('img', { cls: 'supernote-thumb-img' });
			// Reserves this thumbnail's correct box size (width is already
			// fixed at 100% of the item via CSS; aspect-ratio derives the
			// height from that) before ensurePageImage() ever sets `src` -
			// an <img> with no src/dimensions otherwise collapses to ~0
			// height, so it "pops" to full size right as it loads. That's
			// not just visual: every pop shifts every later thumbnail's
			// position, which reflows the whole sidebar and can re-trigger
			// thumbObserver for a large swath of items at once - plausibly
			// why scrolling the sidebar for a while still crashed (issue
			// #154) even after loads were bounded to whatever's actually
			// visible. A stable layout from the start means each item's
			// intersection only ever changes because of an actual scroll,
			// not a layout shift caused by a sibling loading in.
			img.style.aspectRatio = `${pageWidth} / ${pageHeight}`;
			item.createSpan({ cls: 'supernote-thumb-label', text: String(i + 1) });

			item.addEventListener('click', () => {
				void this.goToPage(i + 1);
			});

			this.thumbItems.push(item);
			this.thumbImgs.push(img);
			this.thumbObserver.observe(item);
		}

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
	// scroll a given 1-indexed page into view and prime its image/text layer.
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
		// explicitly asked to jump to — a fast programmatic jump can easily
		// land before pageObserver's next tick fires. Marking it visible
		// directly (rather than just calling ensurePageImage()) also closes
		// off a narrow race with evictPageImage(): a stray non-intersecting
		// callback firing for this page while the scroll is still settling
		// would otherwise see visibleInMainView still false and could evict
		// the very page we just asked to load.
		state.visibleInMainView = true;
		void this.ensurePageImage(state);
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
		// how far a user should zoom in by hand). "100%" here is one canvas
		// pixel per native rasterized page pixel (see nativeWidth/nativeHeight),
		// not anything tied to the available viewport — so a page with a small
		// native resolution on a large or high-DPI display can legitimately
		// need well over 5x to fill it with "Fit width". Applying the same
		// 500% ceiling there just left the page stuck at a fixed pixel width
		// regardless of how much wider the pane actually was, while showing a
		// confusing pinned "500%" (see issue #108). Fit width instead gets a
		// much higher ceiling, purely as a guard against a pathological render
		// (e.g. a zero-width native page) rather than a real intended limit.
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
			this.drawPageImage(state, targetZoom);
			state.canvasWrap.setCssStyles({ transform: '', transformOrigin: '' });

			// Only rebuild the text layer for pages that already had one —
			// pages not yet loaded (ensureTextLayer() never ran) will build
			// theirs at whatever zoom is current when they eventually do.
			if (state.textLayerLoaded && state.pdfPage) {
				const pdfPage = state.pdfPage;
				const viewport = pdfPage.getViewport({ scale: targetZoom });
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
	// container's own margin.
	private applyFitWidth() {
		const state = this.pageStates[0];
		if (!state || !this.pagesEl || state.nativeWidth <= 0) return;

		const availableWidth = this.pagesEl.clientWidth;
		if (availableWidth <= 0) return;

		const containerStyle = getComputedStyle(state.pageContainer);
		const horizontalMargin = parseFloat(containerStyle.marginLeft || '0') + parseFloat(containerStyle.marginRight || '0');
		const targetWidth = Math.max(availableWidth - horizontalMargin, 1);

		this.setZoom(targetWidth / state.nativeWidth, { manual: false });
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
		this.thumbObserver?.disconnect();
		for (const state of this.pageStates) window.clearTimeout(state.thumbLoadDebounceTimer);
		// See onLoadFile()'s matching call for why this matters - closing the
		// view entirely shouldn't leave its last file's pdf.js document
		// resident in pdf.js's own Worker either.
		this.pdfDocPromise?.then((doc) => doc.destroy()).catch(() => { /* nothing to clean up */ });
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

		let images: string[];
		try {
			images = await new ImageConverter().convertToImages(sn, singlePage !== null ? [singlePage] : undefined);
		} catch (err) {
			if (!this.destroyed) this.renderError(err);
			return;
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
	// Live reference handed to VaultWriter — registering/unregistering here
	// after construction still takes effect, since both hold the same Set.
	pageTextProcessors: Set<PageTextProcessor> = new Set();

	/**
	 * Registers a processor that can enrich or replace a page's text before
	 * it's written into the generated markdown — e.g. an OCR/LLM companion
	 * plugin transcribing handwriting the device's own recognition missed.
	 * See PageTextProcessor's doc comment (above VaultWriter) for the
	 * contract, and https://github.com/philips/supernote-obsidian-ocr-llm
	 * for a reference implementation.
	 *
	 * Undocumented/unstable: the same "reach into another plugin's loaded
	 * instance" pattern Templater/Dataview use for their own APIs, not a
	 * formal Obsidian extension point. Returns an unregister function — call
	 * it from your plugin's onunload().
	 */
	registerPageTextProcessor(processor: PageTextProcessor): () => void {
		this.pageTextProcessors.add(processor);
		return () => this.pageTextProcessors.delete(processor);
	}

	async onload() {
        // Install polyfills before any other code runs
        installAtPolyfill();

		await this.loadSettings();
		vw = new VaultWriter(this.app, this.settings, this.pageTextProcessors);
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

		// Prototype: `.spd` files (Supernote Atelier app) — see atelierView.ts.
		this.registerView(
			VIEW_TYPE_SUPERNOTE_ATELIER,
			(leaf) => new SupernoteAtelierView(leaf)
		);
		this.registerExtensions(['spd'], VIEW_TYPE_SUPERNOTE_ATELIER);

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

			this.app.embedRegistry.registerExtension('spd', (context, file) =>
				new SupernoteAtelierEmbed(this.app, context.containerEl, file)
			);
			this.register(() => this.app.embedRegistry?.unregisterExtension('spd'));
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
			id: 'export-atelier-as-png',
			name: 'Export this .spd file as a PNG attachment',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "spd") {
					if (checking) {
						return true
					}
					if (!file) {
						new ErrorModal(this.app, new Error("No file to attach")).open();
					} else {
						vw.attachAtelierImage(file).catch((err: unknown) => {
							new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
						});
					}
					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: 'export-atelier-as-pdf',
			name: 'Export this .spd file as PDF',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "spd") {
					if (checking) {
						return true
					}
					if (!file) {
						new ErrorModal(this.app, new Error("No file to attach")).open();
					} else {
						vw.exportAtelierToPDF(file).catch((err: unknown) => {
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
			name: "Import notes and drawings edited today",
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
		terminateSharedWorkerPool();
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
