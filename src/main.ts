import { installAtPolyfill } from './polyfills';
import { App, Modal, Notice, TFile, Plugin, Editor, MarkdownView, MarkdownFileInfo, WorkspaceLeaf, FileView, Component, Scope, Platform, setIcon } from 'obsidian';
import { SupernotePluginSettings, SupernoteSettingTab, DEFAULT_SETTINGS, ImportFormat, PageExportImageFormat } from './settings';
import { SupernoteX, ILink, RecognitionStatuses, fetchMirrorFrame, extractPdfPageData, addSvgPage, prepareVectorInkPages, buildVectorInkBackgroundNote, buildRasterInkOverlayNote, toSvg } from 'supernote-typescript';
import { encode } from 'image-js';
import { DownloadListModal, UploadListModal } from './FileListModal';
import { ImportTodayModal } from './ImportTodayModal';
import { ErrorModal } from './ErrorModal';
import { PdfBuildWorkerMessage, PdfBuildWorkerResponse } from './pdfBuild.worker';
import PdfBuildWorker from 'pdfBuild.worker';
import { ImageConverter, pageMayNeedRasterOverlay, terminateSharedWorkerPool } from './render/imageConverter';
// Side-effect import: registers <supernote-viewer> (customElements.define)
// - see SupernoteEmbed below, which is now a thin wrapper around it rather
// than its own separate rendering implementation.
import './webcomponent/SupernoteViewerElement';
import type { SupernoteViewerElement } from './webcomponent/SupernoteViewerElement';
import { replaceTextWithCustomDictionary } from './customDictionary';
import { runDeviceSync, appendSyncLogEntry } from './syncEngine';
import { formatSyncFailureLogEntry } from './deviceSync';
import { SupernoteAtelierEmbed, SupernoteAtelierView, VIEW_TYPE_SUPERNOTE_ATELIER, renderAtelierCompositeDataUrl, renderAtelierCompositeFromBuffer } from './atelierView';
import { PDFDocument } from 'pdf-lib';
import { markToAnnotatedPdf } from './markPdf';

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

// Builds one standalone SVG document for a single already-rasterized page,
// reusing the same PNG bytes ImageConverter produced (rather than
// re-rasterizing via supernote-typescript's own toSvg(), which would decode
// the page a second time) and extractPdfPageData() for the recognized-text
// overlay, the same source addPdfPage()/buildPdfInWorker() draw their own
// invisible text layer from.
function buildSvgForPage(sn: SupernoteX, pageNumber: number, imageDataUrl: string): string {
    const { pageWidth, pageHeight, pages } = extractPdfPageData(sn, pageNumber);
    const pngBytes = new Uint8Array(dataUrlToBuffer(imageDataUrl));
    // Pass the note's device family + native pageWidth so the invisible
    // recognition-text overlay lands at the right position on every device
    // (N6/A6X use their own pageWidth as the recognition canvas, not the
    // 1920px reference A5X/Manta do — issue #219). nativePageWidth == the
    // pageWidth here since this path never upscales; addSvgPage still needs
    // it explicitly so a future caller rendering an upscaled image through
    // here wouldn't silently regress.
    return addSvgPage(pages[0], pngBytes, pageWidth, pageHeight, {
        equipment: sn.header.APPLY_EQUIPMENT,
        nativePageWidth: sn.pageWidth,
    });
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

// Rasterizes and assembles the *entire* PDF for `sn` inside a dedicated
// Worker (see pdfBuild.worker.ts) rather than on the main thread - pdf-lib's
// own embedPng() is genuinely expensive, and entirely inherent to it:
// confirmed via real-device testing (see pdfBuild.worker.ts's own doc
// comment for the full trail) that it still peaks ~1.7GB and takes 10+
// seconds for a 100-page note even after dropping each page's alpha
// channel, since it always fully decodes every embedded PNG to raw pixels
// and retains that until pdfDoc.save().
// None of that is fixable short of not using pdf-lib, but running it inside
// a Worker at least means Obsidian's own UI thread never carries any of that
// cost, regardless of how large it is.
//
// A *dedicated* Worker, not the shared pool (getSharedWorkerPool()) used for
// on-screen rendering: this can run for many seconds, and tying up one of
// the pool's 2 workers for that whole time would stall on-screen page/
// thumbnail loading for just as long, since only one worker would remain to
// serve them - a large export shouldn't compete with actually reading the
// note. Terminated once done regardless of outcome; this is a one-shot,
// long-running task, not something worth keeping warm for reuse.
async function buildPdfInWorker(sn: SupernoteX, vectorInk: boolean): Promise<Uint8Array> {
    const pageNumbers = Array.from({ length: sn.pages.length }, (_, i) => i + 1);
    // When vectorInk is on, prepare the per-page vector strokes/styles on the
    // main thread: the worker only receives structured-clone-safe IPdfPage
    // slices (extractPdfPageData), which don't carry the TOTALPATH buffer or
    // note.titles the vector-ink decode reads. The upstream background/overlay
    // pair leaves templates below the vector paths and keeps bitmap-only
    // DISABLE text boxes/Digests for a transparent image painted afterward.
    // Coordinates share toImage()'s native page-pixel space (this export never
    // upscales). See supernote-typescript's README, "Vector ink from the
    // parallel/Worker path".
    const vectorInkPages = vectorInk ? prepareVectorInkPages(sn, pageNumbers, 1) : [];
    const backgroundNote = vectorInk ? buildVectorInkBackgroundNote(sn, vectorInkPages) : sn;
    const overlayPageIndexes = vectorInkPages.flatMap((vip, index) =>
        pageMayNeedRasterOverlay(sn, vip) ? [index] : [],
    );
    const rasterOverlayNote = overlayPageIndexes.length > 0
        ? buildRasterInkOverlayNote(sn, vectorInkPages)
        : undefined;
    const pages = pageNumbers.map((n) => extractPdfPageData(backgroundNote, n).pages[0]);
    // Sent as compact, global-indexed slices rather than a transparent overlay
    // for every vector page. The worker maps them back into its 8-page batches.
    const rasterOverlayPages = rasterOverlayNote
        ? overlayPageIndexes.map((index) => extractPdfPageData(rasterOverlayNote, pageNumbers[index]).pages[0])
        : undefined;
    // Parallel to `pages` by position; undefined entries fall back to the
    // raster the worker already embedded (addPdfPage no-ops on empty/absent
    // strokes), so a page whose ink didn't decode keeps its rasterized ink.
    const strokes = vectorInk ? vectorInkPages.map((vip) => (vip.useVectorInk ? vip.strokes : undefined)) : undefined;
    const strokeStyles = vectorInk ? vectorInkPages.map((vip) => (vip.useVectorInk ? vip.styles : undefined)) : undefined;

    const worker = new PdfBuildWorker();
    try {
        return await new Promise<Uint8Array>((resolve, reject) => {
            worker.onmessage = (e: MessageEvent<PdfBuildWorkerResponse>) => {
                if (e.data.type === 'error') reject(new Error(e.data.error));
                else if (e.data.type === 'pdfResult') resolve(e.data.pdfBytes);
            };
            worker.onerror = (error) => reject(new Error(error.message));
            const message: PdfBuildWorkerMessage = {
                type: 'buildPdf',
                pageWidth: sn.pageWidth,
                pageHeight: sn.pageHeight,
                pages,
                strokes,
                strokeStyles,
                rasterOverlayPages,
                rasterOverlayPageIndexes: rasterOverlayPages ? overlayPageIndexes : undefined,
                // The note's device family + native pageWidth drive the
                // recognition-coordinate scale of the invisible text layer
                // (N6/A6X use their own pageWidth as the recognition canvas,
                // not the 1920px reference A5X/Manta do — issue #219).
                // nativePageWidth == sn.pageWidth here since this path never
                // upscales; addPdfPage still needs it explicitly so the
                // canvas is recoverable if a future caller renders upscaled.
                equipment: sn.header.APPLY_EQUIPMENT,
                nativePageWidth: sn.pageWidth,
            };
            worker.postMessage(message);
        });
    } finally {
        worker.terminate();
    }
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

	// A 100-page PDF conversion (or similar) can take a while, so surface
	// completion with a Notice instead of leaving the user to guess whether
	// anything happened - clicking it jumps straight to the new file.
	private notifyExportComplete(file: TFile) {
		const notice = new Notice(`Created "${file.path}" - click to open`);
		notice.messageEl.addEventListener('click', () => {
			void this.app.workspace.getLeaf(false).openFile(file);
		});
	}

	// `images` (raw rasterized page data URLs, for processors) is independent
	// of `imgs` (vault TFiles, for the embedded image links) — a markdown-only
	// export passes `imgs: null` but can still pass `images` so registered
	// processors run, even though no image attachment gets saved.
	async writeMarkdownFile(file: TFile, sn: SupernoteX, imgs: TFile[] | null, images: string[] | null = null): Promise<TFile> {
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

		return this.app.vault.create(filename, content);
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

	// SVG equivalent of writeImageFiles() — same already-rasterized `images`
	// input, but each page is wrapped into a standalone SVG document (see
	// buildSvgForPage()) rather than saved as a raw PNG. SVG is text, not
	// binary, so this uses vault.create() rather than createBinary().
	async writeSvgFiles(basename: string, sn: SupernoteX, images: string[]): Promise<TFile[]> {
		const imgs: TFile[] = [];
		for (let i = 0; i < images.length; i++) {
			const svg = buildSvgForPage(sn, i + 1, images[i]);
			const filename = await this.app.fileManager.getAvailablePathForAttachment(`${basename}-${i + 1}.svg`);
			imgs.push(await this.app.vault.create(filename, svg));
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
		const mdFile = await this.writeMarkdownFile(file, sn, null, images);
		this.notifyExportComplete(mdFile);
	}

	async attachNoteFiles(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));

		const images = await this.rasterizePages(sn);
		const imgs = await this.writeImageFiles(file.basename, images);
		const mdFile = await this.writeMarkdownFile(file, sn, imgs, images);
		this.notifyExportComplete(mdFile);
	}

	// SVG equivalent of attachNoteFiles() — see writeSvgFiles().
	async attachNoteFilesAsSvg(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		const sn = new SupernoteX(new Uint8Array(note));

		const images = await this.rasterizePages(sn);
		const imgs = await this.writeSvgFiles(file.basename, sn, images);
		const mdFile = await this.writeMarkdownFile(file, sn, imgs, images);
		this.notifyExportComplete(mdFile);
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
			const pdfBytes = await buildPdfInWorker(sn, this.settings.vectorInk);
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

		// Runs entirely inside a dedicated Worker (see buildPdfInWorker()) so
		// pdf-lib's own considerable memory/CPU cost never blocks Obsidian's
		// UI thread, regardless of note length.
		const pdfBytes = await buildPdfInWorker(sn, this.settings.vectorInk);

		// Generate filename and save
		const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}.pdf`);
		const pdfFile = await this.app.vault.createBinary(filename, toArrayBuffer(pdfBytes));
		this.notifyExportComplete(pdfFile);
	}

	private annotatedSiblingPath(pdf: TFile): string {
		const parent = pdf.parent?.path;
		return `${parent ? `${parent}/` : ''}${pdf.basename} - annotated.pdf`;
	}

	async exportMarkToAnnotatedPdf(file: TFile, notify = true): Promise<TFile | null> {
		if (!/\.pdf\.mark$/i.test(file.path)) {
			throw new Error('This command expects a .pdf.mark file.');
		}

		const pdfPath = file.path.replace(/\.mark$/i, '');
		const siblingPdf = this.app.vault.getAbstractFileByPath(pdfPath);
		if (!(siblingPdf instanceof TFile) || siblingPdf.extension.toLowerCase() !== 'pdf') {
			throw new Error(`No sibling PDF found for "${file.name}".`);
		}

		const markBytes = await this.app.vault.readBinary(file);
		const mark = new SupernoteX(new Uint8Array(markBytes));
		const originalPdf = new Uint8Array(await this.app.vault.readBinary(siblingPdf));
		const annotatedPdf = await markToAnnotatedPdf(mark, originalPdf);

		if (annotatedPdf === null) {
			new Notice(`No visible ink found in "${file.name}".`);
			return null;
		}

		const outPath = this.annotatedSiblingPath(siblingPdf);
		const existing = this.app.vault.getAbstractFileByPath(outPath);
		let outFile: TFile;
		if (existing instanceof TFile) {
			await this.app.vault.modifyBinary(existing, toArrayBuffer(annotatedPdf));
			outFile = existing;
		} else {
			outFile = await this.app.vault.createBinary(outPath, toArrayBuffer(annotatedPdf));
		}
		if (notify) this.notifyExportComplete(outFile);
		return outFile;
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
		const pngFile = await this.app.vault.createBinary(filename, dataUrlToBuffer(dataUrl));
		this.notifyExportComplete(pngFile);
		return pngFile;
	}

	async exportAtelierToPDF(file: TFile) {
		const dataUrl = await this.rasterizeAtelier(file);
		const pdfBytes = await buildSinglePagePdf(dataUrl);

		const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}.pdf`);
		const pdfFile = await this.app.vault.createBinary(filename, toArrayBuffer(pdfBytes));
		this.notifyExportComplete(pdfFile);
	}
}

let vw: VaultWriter;
export const VIEW_TYPE_SUPERNOTE = "supernote-view";

export class SupernoteView extends FileView {
	declare file: TFile;
	settings: SupernotePluginSettings;

	private viewerEl: SupernoteViewerElement | null = null;
	// This file's own pages' PAGEIDs, from the component's own supernote-load
	// event - lets handleNoteLinkClick() resolve a link naming this same file
	// explicitly without re-parsing bytes already parsed once inside the
	// component. Same field, same reason, as SupernoteEmbed's own copy below.
	private pageIds: string[] = [];

	constructor(leaf: WorkspaceLeaf, settings: SupernotePluginSettings) {
		super(leaf);
		this.settings = settings;
		// Documented pattern (obsidian.d.ts View.scope) for registering hotkeys
		// that are only active while this view has focus.
		this.scope = new Scope(this.app.scope);
		// Mirrors SupernoteEmbed's own identical registration/reasoning (see
		// its constructor) - without this, <supernote-viewer>'s own light/
		// dark default (the OS-level prefers-color-scheme media feature) is
		// the only thing driving it, completely independent of Obsidian's
		// own theme setting - confirmed as a real, reported bug: the full
		// view stayed permanently dark (or light) regardless of Obsidian's
		// theme, tracking only the OS's own scheme instead. registerEvent()
		// is auto-cleaned-up by Component (View extends Component), so this
		// needs no matching onClose() teardown.
		this.registerEvent(this.app.workspace.on('css-change', () => this.updateDarkAttribute()));
	}

	private updateDarkAttribute(): void {
		this.viewerEl?.setAttribute('dark', document.body.classList.contains('theme-dark') ? 'true' : 'false');
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
	// (which awaits onLoadFile()) has resolved. onLoadFile() itself now
	// awaits the component's own supernote-load/-error before returning (see
	// its own comment for why), so by the time this runs, viewerEl's page
	// list is already built and goToPage() won't silently no-op. Mirrors the
	// anchor SupernoteEmbed accepts for embeds; see parsePageAnchor().
	setEphemeralState(state: unknown): void {
		const subpath = (state as { subpath?: string } | undefined)?.subpath;
		const page = parsePageAnchor(subpath);
		if (page !== null) this.viewerEl?.goToPage(page);
	}

	async onOpen(): Promise<void> {
		// Scopes styles.css's button.mod-cta display:block rule to just this
		// view, instead of it applying to every CTA button in Obsidian (see
		// issue #74 — an unscoped rule shifted button text down app-wide).
		this.contentEl.addClass('supernote-view-content');

		// Obsidian's .view-content has its own top padding, leaving a gap
		// above <supernote-viewer>'s own sticky toolbar - a negative margin
		// on the toolbar itself would fight position: sticky's positioning
		// math, so this zeroes the ancestor's padding directly instead. On
		// mobile (issue #148), that same ancestor padding on the left/right/
		// bottom sides is real, wasted width on a screen already tight for
		// legibility of handwritten content.
		this.contentEl.setCssStyles(
			Platform.isMobile
				? { paddingTop: '0', paddingLeft: '0.25em', paddingRight: '0.25em', paddingBottom: '0.25em' }
				: { paddingTop: '0' },
		);

		// Mod+F opens/focuses <supernote-viewer>'s own find bar. Scope is an
		// Obsidian-only concept the component has no way to register a
		// view-scoped hotkey through itself, so the wrapper still owns this
		// one registration even though everything the hotkey actually does
		// (the find bar itself, stepping matches, highlighting) now lives
		// entirely in the component.
		this.scope?.register(['Mod'], 'f', (evt) => {
			evt.preventDefault();
			this.viewerEl?.toggleFindBar();
			return false;
		});
	}

	async onLoadFile(file: TFile): Promise<void> {
		if (file.extension === 'mark') {
			const annotatedPdf = await vw.exportMarkToAnnotatedPdf(file, false);
			if (annotatedPdf) {
				// Opening another file while Obsidian is still committing this
				// FileView's load can be overwritten by that in-flight transition.
				window.setTimeout(() => void this.leaf.openFile(annotatedPdf), 0);
			}
			return;
		}

		const container = this.contentEl;
		container.empty();
		this.viewerEl = null;
		this.pageIds = [];

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

		const bytes = await this.app.vault.readBinary(file);

		const viewer = container.createEl('supernote-viewer');
		if (file.extension === 'mark') {
			viewer.style.setProperty('--supernote-viewer-page-background', '#ffffff');
		}
		// Applies the plugin's custom-dictionary substitution (if enabled)
		// to recognized text shown in the component's own text mode - the
		// one piece of SupernoteView's previous behavior <supernote-viewer>
		// has no portable equivalent for, since it reads plugin settings
		// this Obsidian-free component has no concept of. See
		// textProcessor's own doc comment (SupernoteViewerElement.ts) for
		// the narrow find-in-note inconsistency this leaves.
		viewer.textProcessor = (text) => processSupernoteText(text, this.settings);
		// Vector ink on by default (settings.vectorInk) — draws the on-screen
		// page's pen strokes as crisp vector paths instead of the rasterized
		// ink layers. See SupernoteViewerElement.vectorInk's doc comment.
		viewer.vectorInk = this.settings.vectorInk;
		// Obsidian's own icon set (setIcon()/Lucide) instead of the
		// component's own baked-in inline SVGs - see iconRenderer's own
		// doc comment (SupernoteViewerElement.ts) for why this is safe:
		// the component picked its icon names to already equal Lucide's
		// own, specifically so a host with a real icon system can wire
		// this up with no translation table of its own (issue #197's
		// original ask for the export button, extended here to the whole
		// toolbar for full UX consistency with the rest of Obsidian).
		viewer.iconRenderer = (name, el) => setIcon(el, name);
		if (this.settings.invertColorsWhenDark) {
			viewer.setAttribute('invert-dark', '');
		}
		this.viewerEl = viewer;
		this.updateDarkAttribute();

		// A real toolbar button, not a standalone element outside the
		// component (an earlier version of this wrapper did that - a real,
		// reported regression, since it no longer sat with the rest of the
		// page-nav/mode/find controls the way it did in SupernoteView's own
		// pre-web-component toolbar). <supernote-viewer> has no portable
		// equivalent for this - it writes to an Obsidian vault - so it
		// exposes a "toolbar-extra" slot instead of building export UI
		// itself (see buildToolbar()'s own comment on that slot, and its
		// header comment's "no save/export UI" v1 boundary). A plain
		// light-DOM child of `viewer`, unaffected by the component
		// rebuilding its own shadow-root toolbar on every note load - no
		// re-adding needed beyond this one call per onLoadFile().
		//
		// Uses Obsidian's own icon set (setIcon(), Lucide), not the
		// component's own inline-SVG icons (issue #197) - this button is
		// SupernoteView's own addition, built entirely within Obsidian's
		// context (unlike the component's toolbar, which has no Obsidian
		// dependency and bakes its icons in for exactly that reason - see
		// SupernoteViewerElement.ts's own icon* functions), so there's no
		// portability reason not to use the real thing here. 'download',
		// cls: 'clickable-icon' - same icon name and pattern this button
		// had before the #183 web-component swap, and the same pattern
		// SupernoteAtelierView's own toolbar buttons already use
		// (atelierView.ts).
		const exportPageBtn = viewer.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', slot: 'toolbar-extra', 'aria-label': 'Export current page as image' },
		});
		setIcon(exportPageBtn, 'download');
		exportPageBtn.addEventListener('click', () => {
			this.exportCurrentPageAsImage(this.settings.pageExportImageFormat).catch((err: unknown) => {
				new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
			});
		});

		viewer.addEventListener('supernote-load', ((e: CustomEvent<{ pageIds: string[] }>) => {
			this.pageIds = e.detail.pageIds;
		}) as EventListener);
		viewer.addEventListener('supernote-error', ((e: CustomEvent<{ error: unknown; pageNumber?: number }>) => {
			// A single page failing to rasterize (pageNumber set) just
			// leaves that one page blank and retries later - only a
			// whole-note failure (fetch/parse, no pageNumber) is worth
			// surfacing as a hard error.
			if (e.detail.pageNumber === undefined) {
				new ErrorModal(this.app, e.detail.error instanceof Error ? e.detail.error : new Error(String(e.detail.error))).open();
			}
		}) as EventListener);
		viewer.addEventListener('link-click', ((e: CustomEvent<{ link: ILink }>) => {
			void handleNoteLinkClick(this.app, file.basename, this.pageIds, this.viewerEl, e.detail.link);
		}) as EventListener);

		// Awaited (unlike SupernoteEmbed's identical assignment, which is
		// fire-and-forget) so setEphemeralState() - which Obsidian calls
		// right after onLoadFile() resolves, for a `#page=N` link's initial
		// jump - never races the component's own async parse/build: without
		// this, goToPage() could run before the component's page list even
		// exists yet (noteData's actual parsing is deferred to a
		// microtask - see queueRender() in SupernoteViewerElement.ts) and
		// silently no-op.
		const loaded = new Promise<void>((resolve) => {
			viewer.addEventListener('supernote-load', () => resolve(), { once: true });
			viewer.addEventListener('supernote-error', ((e: CustomEvent<{ pageNumber?: number }>) => {
				if (e.detail.pageNumber === undefined) resolve();
			}) as EventListener, { once: true });
		});
		viewer.noteData = bytes;
		await loaded;
	}

	// Exports the page currently on screen (viewerEl.currentPage, kept up to
	// date by the component's own scroll-driven page indicator) as a PNG or
	// SVG attachment - the single-page equivalent of the whole-note export
	// buttons above, for when the user only wants the page they're looking
	// at right now rather than the whole note. Exposed as commands (see
	// 'export-current-page-as-image'/'export-current-page-as-svg') and the
	// toolbar button above, which passes settings.pageExportImageFormat
	// rather than a hardcoded format.
	// Independently re-reads and rasterizes just this one page rather than
	// reaching into the live <supernote-viewer>'s own internal state -
	// mirrors how VaultWriter's own export methods already read+convert
	// independently of whatever's currently displayed.
	async exportCurrentPageAsImage(format: PageExportImageFormat = 'png'): Promise<void> {
		if (!this.viewerEl || this.viewerEl.currentPage === 0) return;
		const pageNumber = this.viewerEl.currentPage;

		const note = await this.app.vault.readBinary(this.file);
		const sn = new SupernoteX(new Uint8Array(note));

		let savedFile: TFile;
		if (format === 'svg') {
			// When vectorInk is on, use the submodule's toSvg() directly — it
			// draws strokes as vector <path>s and keeps the searchable text
			// layer (includeText defaults true), which is exactly what an SVG
			// export should produce. When off, fall back to the raster-embed
			// path (buildSvgForPage), which wraps the rasterized PNG in an SVG
			// with the same text layer.
			const svg = this.settings.vectorInk
				? (await toSvg(sn, { vectorInk: true, pageNumbers: [pageNumber] }))[0]
				: buildSvgForPage(sn, pageNumber, (await new ImageConverter().convertToImages(sn, [pageNumber]))[0]);
			const filename = await this.app.fileManager.getAvailablePathForAttachment(`${this.file.basename}-page-${pageNumber}.svg`);
			savedFile = await this.app.vault.create(filename, svg);
		} else {
			// PNG stays raster regardless of vectorInk — a PNG is pixels, so
			// vector ink's crisp-at-any-zoom benefit doesn't survive the
			// format anyway, and this keeps the export matching the note's
			// own rendered ink.
			const [imageDataUrl] = await new ImageConverter().convertToImages(sn, [pageNumber]);
			const filename = await this.app.fileManager.getAvailablePathForAttachment(`${this.file.basename}-page-${pageNumber}.png`);
			savedFile = await this.app.vault.createBinary(filename, dataUrlToBuffer(imageDataUrl));
		}

		// Same "click to open" completion notice as VaultWriter's exports
		// (see notifyExportComplete(), issue #167 / PR #175).
		const notice = new Notice(`Created "${savedFile.path}" - click to open`);
		notice.messageEl.addEventListener('click', () => {
			void this.app.workspace.getLeaf(false).openFile(savedFile);
		});
	}

	async onClose() {
		this.viewerEl = null;
	}
}

// A clicked internal note link's navigation target: same-file (jump in
// place via viewerEl.goToPage()) when the link carries no filename at all
// or names the file currently open/embedded, or another vault note (open
// via a new leaf, reusing the `#page=N` ephemeral-state anchor that regular
// `[[note#page=N]]` links already use — see SupernoteView.setEphemeralState()
// and SupernoteEmbed's own pageAnchor handling). Basename matching against
// the vault mirrors VaultWriter.resolvePageAnchor()'s export-time link
// resolution (see PR #122), so a link resolves the same note whether you're
// viewing it live or exporting it; ambiguous if two vault notes share a
// basename in different folders, same known limitation as that export path.
// Shared by SupernoteView and SupernoteEmbed, which had identical copies of
// this before this function existed - the only difference between them was
// which file/pageIds/viewerEl to check against, now just parameters.
async function handleNoteLinkClick(
	app: App,
	currentFileBasename: string,
	pageIds: string[],
	viewerEl: SupernoteViewerElement | null,
	link: ILink,
): Promise<void> {
	const targetBasename = link.text.split('#')[0];
	const pageid = link.PAGEID;

	if (!targetBasename || targetBasename === currentFileBasename) {
		const pageIndex = pageIds.findIndex((id) => id === pageid);
		if (pageIndex >= 0) viewerEl?.goToPage(pageIndex + 1);
		return;
	}

	const targetFile = app.vault.getFiles().find((f) => f.extension === 'note' && f.basename === targetBasename);
	if (!targetFile) {
		new Notice(`Linked note "${targetBasename}.note" not found in vault.`);
		return;
	}

	let subpath: string | undefined;
	if (pageid && pageid !== '0' && pageid !== 'none') {
		try {
			const buffer = await app.vault.readBinary(targetFile);
			const pageIndex = new SupernoteX(new Uint8Array(buffer)).pages.findIndex((p) => p.PAGEID === pageid);
			if (pageIndex >= 0) subpath = `#page=${pageIndex + 1}`;
		} catch {
			// Malformed target file — fall through and open without a page anchor.
		}
	}

	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(targetFile, subpath ? { eState: { subpath } } : undefined);
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
//
// A thin adapter around <supernote-viewer> (src/webcomponent/), not its own
// rendering implementation - Obsidian's renderer is a real Chromium/WebView
// browsing context, so the same standalone custom element built for issue
// #183 runs here unmodified. This class's whole job is bridging Obsidian
// specifics the component itself has no way to know about: reading the
// file's bytes from the vault, the plugin's invertColorsWhenDark setting,
// and the "always show at least one full page" min-height sizing Obsidian's
// own PDF embed has (see applyMinHeight()) - everything else (lazy loading,
// the page-nav toolbar, the recognized-text toggle) now lives in the
// component, shared with every other consumer of it.
export class SupernoteEmbed extends Component {
	private viewerEl: SupernoteViewerElement | null = null;
	// note page height / width, from the component's own supernote-load
	// event - used to keep min-height (see setupMinHeightTracking) matched
	// to one full page's rendered height at whatever width the embed
	// currently has, the same "always show at least one whole page" behavior
	// Obsidian's own PDF embed has.
	private pageAspectRatio: number | null = null;
	private minHeightObserver: ResizeObserver | null = null;
	private lastMinHeightWidth = -1;
	// This note's own pages' PAGEIDs, from the component's own supernote-load
	// event - lets handleNoteLinkClick() resolve a link that names this same
	// file explicitly (this.file.basename) without re-parsing bytes already
	// parsed once inside the component. See that event's own detail comment
	// (SupernoteViewerElement.ts) for why the component can't resolve this
	// particular case itself.
	private pageIds: string[] = [];

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
		// <supernote-viewer>'s own light/dark defaults come from the OS-level
		// prefers-color-scheme media feature (the right call for a page with
		// no other context) - but Obsidian's own dark/light theme is set
		// independently of that, and plenty of users run one dark and the
		// other light (confirmed as a real bug, not a hypothetical: on a
		// system whose OS-level scheme is dark, an embed inside Obsidian's
		// *light* theme still got its page images inverted by the OS-level
		// guess, since an earlier version of the component's CSS treated
		// that guess and this attribute as independent conditions rather
		// than this attribute overriding it - see SupernoteViewerElement's
		// STYLE constant for the fix). Always setting an explicit "true" or
		// "false" value below (never just adding/removing the attribute)
		// is what makes this actually override the OS guess in *both*
		// directions, not just toward dark. registerEvent() (auto-cleaned-up
		// by Component, regardless of this class's own onunload() override
		// below) keeps it in sync if the user swaps themes without
		// navigating away.
		this.registerEvent(this.app.workspace.on('css-change', () => this.updateDarkAttribute()));
	}

	private updateDarkAttribute(): void {
		this.viewerEl?.setAttribute('dark', document.body.classList.contains('theme-dark') ? 'true' : 'false');
	}

	// Called by Obsidian's embed system once this component has been mounted
	// into context.containerEl (separate from Component's own load(), since the
	// same embed component can be asked to loadFile() again if the underlying
	// link changes without being recreated).
	loadFile(): void {
		void this.render();
	}

	onunload(): void {
		this.minHeightObserver?.disconnect();
	}

	private async render(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass('supernote-embed');
		this.containerEl.setCssStyles({ minHeight: '' });
		this.minHeightObserver?.disconnect();
		this.minHeightObserver = null;
		this.pageAspectRatio = null;
		this.lastMinHeightWidth = -1;

		let bytes: ArrayBuffer;
		try {
			bytes = await this.app.vault.readBinary(this.file);
		} catch (err) {
			this.renderError(err);
			return;
		}

		const viewer = this.containerEl.createEl('supernote-viewer');
		if (this.file.extension === 'mark') {
			viewer.style.setProperty('--supernote-viewer-page-background', '#ffffff');
		}
		// The outer .supernote-embed container (see styles.css) already
		// supplies a bordered, resizable frame - `bare` drops the component's
		// own default chrome so the two don't visually double up.
		viewer.setAttribute('bare', '');
		if (this.pageAnchor !== null) {
			viewer.setAttribute('single-page', '');
			viewer.setAttribute('page', String(this.pageAnchor));
		}
		if (this.settings.invertColorsWhenDark) {
			viewer.setAttribute('invert-dark', '');
		}
		// Obsidian's own icon set (setIcon()/Lucide), same as SupernoteView's
		// identical assignment - see its own comment, and iconRenderer's
		// doc comment in SupernoteViewerElement.ts, for why this is safe.
		viewer.iconRenderer = (name, el) => setIcon(el, name);
		// Same vectorInk opt-in as SupernoteView above.
		viewer.vectorInk = this.settings.vectorInk;
		this.viewerEl = viewer;
		this.updateDarkAttribute();

		viewer.addEventListener('supernote-load', ((e: CustomEvent<{ pageWidth: number; pageHeight: number; pageIds: string[] }>) => {
			this.pageAspectRatio = e.detail.pageHeight / e.detail.pageWidth;
			this.setupMinHeightTracking();
			this.pageIds = e.detail.pageIds;
		}) as EventListener);
		viewer.addEventListener('supernote-error', ((e: CustomEvent<{ error: unknown; pageNumber?: number }>) => {
			// A single page failing to rasterize (pageNumber set) just
			// leaves that one page blank and retries later - only a
			// whole-note failure (fetch/parse, no pageNumber) should blow
			// away the embed with an error message.
			if (e.detail.pageNumber === undefined) this.renderError(e.detail.error);
		}) as EventListener);
		viewer.addEventListener('link-click', ((e: CustomEvent<{ link: ILink }>) => {
			void handleNoteLinkClick(this.app, this.file.basename, this.pageIds, this.viewerEl, e.detail.link);
		}) as EventListener);

		// createEl() above already appended (and thus connected) it - matters
		// for its own queueRender() (see SupernoteViewerElement.ts), which
		// this kicks off via the fetch-free "bytes already in hand" path.
		viewer.noteData = bytes;
	}

	// Obsidian's PDF embed never lets the embed shrink below one full page —
	// there's always at least one whole page visible, however tall that page
	// happens to be, with any extra pages scrolled below it. Pixel height
	// depends on width (pages scale to fill it) and on this particular note's
	// own page aspect ratio, so it's recomputed whenever the embed is resized
	// (window resize, pane split/unsplit, sidebar toggle), not just once.
	private setupMinHeightTracking(): void {
		if (!this.viewerEl) return;
		this.minHeightObserver = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width;
			if (width) this.applyMinHeight(width);
		});
		this.minHeightObserver.observe(this.viewerEl);
	}

	// Approximates rather than exactly matches a page's own toolbar/padding
	// chrome (which now lives inside the component's shadow root, not
	// something this wrapper measures) - close enough for "always show
	// roughly one full page," and simpler than reaching into the shadow DOM
	// to measure it precisely.
	private applyMinHeight(width: number): void {
		if (this.pageAspectRatio === null) return;
		if (Math.abs(width - this.lastMinHeightWidth) < 1) return;
		this.lastMinHeightWidth = width;

		const pageHeight = width * this.pageAspectRatio;
		this.containerEl.setCssStyles({ minHeight: `${Math.ceil(pageHeight)}px` });
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
		this.registerExtensions(['note', 'mark'], VIEW_TYPE_SUPERNOTE);

		// `.spd` files (Supernote Atelier app) — see atelierView.ts.
		this.registerView(
			VIEW_TYPE_SUPERNOTE_ATELIER,
			(leaf) => new SupernoteAtelierView(leaf, this.settings)
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

			this.app.embedRegistry.registerExtension('mark', (context, file, subpath) =>
				new SupernoteEmbed(this.app, this.settings, context.containerEl, file, parsePageAnchor(subpath))
			);
			this.register(() => this.app.embedRegistry?.unregisterExtension('mark'));

			this.app.embedRegistry.registerExtension('spd', (context, file) =>
				new SupernoteAtelierEmbed(this.app, this.settings, context.containerEl, file)
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
			id: 'export-mark-as-annotated-pdf',
			name: 'Export this .pdf.mark file as an annotated PDF',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'mark' || !/\.pdf$/i.test(file.basename)) {
					return false;
				}

				if (checking) {
					return true;
				}

				vw.exportMarkToAnnotatedPdf(file).catch((err: unknown) => {
					new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
				});
				return true;
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
			id: 'export-note-as-svg-files',
			name: 'Export this note as a Markdown and SVG files as attachments',
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
						vw.attachNoteFilesAsSvg(file).catch((err: unknown) => {
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
			id: 'export-current-page-as-image',
			name: 'Export current page as PNG attachment',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(SupernoteView);
				if (!view) return false;
				if (checking) return true;

				view.exportCurrentPageAsImage().catch((err: unknown) => {
					new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
				});
				return true;
			},
		});

		this.addCommand({
			id: 'export-current-page-as-svg',
			name: 'Export current page as SVG attachment',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(SupernoteView);
				if (!view) return false;
				if (checking) return true;

				view.exportCurrentPageAsImage('svg').catch((err: unknown) => {
					new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
				});
				return true;
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

		this.addCommand({
			id: 'sync-pdf-annotations-from-device',
			name: 'Sync PDF annotations from device',
			callback: () => { void this.runSync(true); },
		});
	}

	async runSync(pdfAnnotationsOnly = false): Promise<void> {
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
			const result = await runDeviceSync(
				this.app,
				this.settings,
				() => this.saveSettings(),
				pdfAnnotationsOnly,
			);

			const parts = [`${result.synced} synced`, `${result.unchanged} unchanged`];
			if (result.excluded > 0) parts.push(`${result.excluded} out of scope`);
			if (result.skippedConflicts.length > 0) parts.push(`${result.skippedConflicts.length} skipped (locally edited)`);
			if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
			const label = pdfAnnotationsOnly ? 'Supernote PDF annotation sync' : 'Supernote sync';
			new Notice(`${label}: ${parts.join(', ')}`);

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
