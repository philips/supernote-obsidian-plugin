// Builds an invisible, per-word text overlay directly from a note's own
// recognition data - no PDF assembly, no pdf.js, no Obsidian dependency.
// This is what makes find-in-note (see SupernoteViewerElement.ts) possible
// in a standalone web component at all: the Obsidian plugin's own
// SupernoteView instead assembles an invisible PDF (see
// supernote-typescript's pdf.ts) purely so pdf.js's getTextContent()/
// renderTextLayer() can hand back positioned spans - a real, working
// approach, but one that needs Obsidian's own bundled pdf.js
// (`loadPdfJs()`), which has no equivalent outside Obsidian at all.
//
// The word-level position data pdf.ts's own drawRecognitionText() draws
// into invisible PDF text was never actually PDF-shaped to begin with -
// it's just x/y/width/height in raster-pixel space, already sitting in
// every parsed note's `page.recognitionElements` (the same source
// supernote-typescript's own extractText()/extractParagraphs() - i.e. this
// plugin's compact text mode - already reads). This module applies that
// same position data directly as CSS, sidestepping PDF/pdf.js entirely.
import { IPage } from 'supernote-typescript';

export interface WordOverlayEntry {
    pageNumber: number;
    label: string;
    // null for a word with no bounding box - real recognition data includes
    // literal whitespace/punctuation as their own separate "word" entries
    // purely to reconstruct correctly-spaced reading-order text (see
    // buildWordSearchText below), and those routinely have no box at all.
    // Still returned here (rather than dropped) so a caller reconstructing
    // reading-order text gets correct spacing; there's just nothing to
    // highlight for it.
    el: HTMLElement | null;
    // Native (unscaled) page-pixel position/size - the same space
    // pageWidth/pageHeight are defined in. repositionWordOverlay() scales
    // these into the page's *currently rendered* CSS pixel size, the same
    // "one scale factor derived from rendered vs. native width" approach
    // main.ts's own positionLinkOverlay() uses for link click regions.
    // Meaningless (0) when el is null.
    nativeX: number;
    nativeY: number;
    nativeWidth: number;
    nativeHeight: number;
}

// Empirically-verified constant used by Supernote's own recognition format:
// recognized word bounding boxes are stored in raster-pixel units divided by
// this factor. Mirrors supernote-typescript/src/pdf.ts's own copy of the
// same constant (used there to embed these same words as invisible PDF
// text) - duplicated rather than imported since supernote-typescript
// doesn't currently export it as a standalone helper. If it's ever wrong,
// fix both copies.
const RECOGNITION_COORDINATE_SCALE = 11.9;

// Some recognition environments produce mojibake-looking labels that are
// actually correctly-encoded UTF-8 bytes misinterpreted as Latin-1
// somewhere upstream in the recognition pipeline - each character's code
// unit is really a raw byte 0-255, so re-decoding those bytes as UTF-8
// recovers the original text. supernote-typescript's own
// drawRecognitionText() does the same fix via the deprecated escape()/
// decodeURIComponent() round-trip; TextDecoder is the modern equivalent
// (confirmed byte-for-byte identical output against every real fixture
// with non-ASCII recognized text this project has, including Turkish
// diacritics) without the deprecation warning.
function decodeRecognitionLabel(label: string): string {
    const bytes = Uint8Array.from(label, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
}

// Builds one absolutely-positioned, invisible <span> per recognized word
// that has a bounding box (matching drawRecognitionText()'s own "skip words
// without one" behavior for the *visual* overlay) and appends them to
// `container`, which must already establish a positioning context (e.g.
// `position: relative`) for the absolute positions below to land relative
// to it, not some further-out ancestor. Deliberately invisible-only
// (`opacity: 0` by default - see the consuming component's own stylesheet
// for the actual rule) rather than aiming for pixel-perfect selectable/
// copyable text the way a real text layer would: getting manual click-and-
// drag selection to feel reliable across many independently-positioned word
// spans (arranged to match the original handwriting's x/y layout, not
// linear reading order) is exactly the problem issue #171 already hit and
// fixed by introducing compact text mode instead - this module is
// deliberately scoped to *finding* text (search + programmatic highlight,
// not manual drag-selection), where that problem doesn't apply.
//
// Words *without* a bounding box are still returned (with `el: null`, no
// span created) rather than dropped entirely: real recognition data uses
// boxless "words" to carry literal whitespace/punctuation needed to
// reconstruct correctly-spaced reading-order text (see
// buildWordSearchText), so silently skipping them here would make that
// reconstruction lose spacing information a caller has no other way to
// recover.
export function buildWordOverlay(page: IPage, container: HTMLElement, pageNumber: number): WordOverlayEntry[] {
    const entries: WordOverlayEntry[] = [];
    const textElements = page.recognitionElements.filter((element) => element.type === 'Text');

    for (let elementIndex = 0; elementIndex < textElements.length; elementIndex++) {
        for (const word of textElements[elementIndex].words) {
            const label = decodeRecognitionLabel(word.label);
            if (!label) continue;

            const box = word['bounding-box'];
            if (!box) {
                entries.push({ pageNumber, label, el: null, nativeX: 0, nativeY: 0, nativeWidth: 0, nativeHeight: 0 });
                continue;
            }

            const span = document.createElement('span');
            span.className = 'word-overlay-span';
            span.textContent = label;
            span.style.position = 'absolute';
            container.appendChild(span);

            entries.push({
                pageNumber,
                label,
                el: span,
                nativeX: box.x * RECOGNITION_COORDINATE_SCALE,
                nativeY: box.y * RECOGNITION_COORDINATE_SCALE,
                nativeWidth: box.width * RECOGNITION_COORDINATE_SCALE,
                nativeHeight: box.height * RECOGNITION_COORDINATE_SCALE,
            });
        }

        // Separates one recognitionElement's words from the next (e.g.
        // "Real", "time", "recognition" as three separate single-word
        // elements in real fixture data, with no shared inter-element space
        // word) using the same '\n' pdf.ts's own extractText() already
        // joins whole elements with. Without this, adjacent elements'
        // labels would concatenate directly ("Realtimerecognition"),
        // breaking both a search query that spans the boundary and the
        // reconstructed text's readability.
        if (elementIndex < textElements.length - 1) {
            entries.push({ pageNumber, label: '\n', el: null, nativeX: 0, nativeY: 0, nativeWidth: 0, nativeHeight: 0 });
        }
    }

    return entries;
}

// Reconstructs this page's reading-order text from the same word entries
// used for the overlay, and returns an offset->entry lookup for mapping a
// search match's character position back to the word (and thus screen
// position) it came from. Concatenates every word's label with no added
// separator - unlike pdf.ts's extractText() (which joins whole *lines* with
// '\n'), individual whitespace/punctuation characters between words are
// already present as their own boxless word entries in real recognition
// data, so adding another separator here would double them up.
export function buildWordSearchText(entries: WordOverlayEntry[]): {
    text: string;
    entryAt: (offset: number) => WordOverlayEntry | undefined;
    entriesInRange: (start: number, end: number) => WordOverlayEntry[];
} {
    let text = '';
    const ranges: { start: number; end: number; entry: WordOverlayEntry }[] = [];

    for (const entry of entries) {
        const start = text.length;
        text += entry.label;
        ranges.push({ start, end: text.length, entry });
    }

    const entryAt = (offset: number): WordOverlayEntry | undefined => {
        const found = ranges.find((r) => offset >= r.start && offset < r.end);
        return found?.entry;
    };

    // Every entry a *multi-word* match's own [start, end) range overlaps,
    // not just the single word at its start offset - entryAt() alone only
    // ever finds the first word a match begins in, which is enough to
    // scroll to, but silently drops every word after it from the caller's
    // own view of "what did this match cover" (confirmed as a real,
    // reported bug: a two-word search only highlighted its first word in
    // image mode, since the caller was highlighting entryAt(match.start)
    // alone). Half-open interval overlap (r.start < end && r.end > start),
    // matching this module's own [start, end) convention throughout.
    const entriesInRange = (start: number, end: number): WordOverlayEntry[] => {
        return ranges.filter((r) => r.start < end && r.end > start).map((r) => r.entry);
    };

    return { text, entryAt, entriesInRange };
}

// Repositions every word span in `entries` to match the page's *currently
// rendered* CSS pixel size - call whenever that changes (initial layout,
// container resize, zoom, once this or a consumer supports it).
// nativeWidth/nativeHeight are the note's own pageWidth/pageHeight (the
// same space entries' own native* fields are defined in) - not necessarily
// this exact page's numbers if a future format ever varies them per page,
// but supernote-typescript defines these at the note level today.
export function repositionWordOverlay(
    entries: WordOverlayEntry[],
    renderedWidth: number,
    renderedHeight: number,
    nativeWidth: number,
    nativeHeight: number,
): void {
    const scaleX = renderedWidth / nativeWidth;
    const scaleY = renderedHeight / nativeHeight;

    for (const entry of entries) {
        if (!entry.el) continue;
        entry.el.style.left = `${entry.nativeX * scaleX}px`;
        entry.el.style.top = `${entry.nativeY * scaleY}px`;
        entry.el.style.width = `${entry.nativeWidth * scaleX}px`;
        entry.el.style.height = `${entry.nativeHeight * scaleY}px`;
    }
}
