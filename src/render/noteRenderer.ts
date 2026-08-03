// Bytes-to-DOM helpers with zero `obsidian` dependency — see issue #183
// (pulling SupernoteView out into a standalone web component). Obsidian-side
// callers (SupernoteEmbed/SupernoteView in main.ts) parse a note and
// rasterize its pages themselves (via ImageConverter, see imageConverter.ts,
// also Obsidian-free), then hand the resulting image data URLs here to
// become plain, displayable DOM. Kept separate from ImageConverter so this
// half - construction only, no Worker/postMessage involved - stays trivially
// synchronous and unit-testable.
import { SupernoteX } from 'supernote-typescript';

export interface RenderedNotePage {
    pageNumber: number;
    containerEl: HTMLElement;
    imageEl: HTMLImageElement;
}

export interface BuildNotePageElementsOptions {
    // Page number of images[0]. Defaults to 1 (the whole-note case).
    startPageNumber?: number;
    invertColorsWhenDark?: boolean;
}

export interface BuildNotePagePlaceholdersOptions {
    // Page number of the first placeholder. Defaults to 1.
    startPageNumber?: number;
    invertColorsWhenDark?: boolean;
    pageWidth: number;
    pageHeight: number;
}

// Parses raw `.note` bytes into a SupernoteX. A one-line wrapper, but named
// so callers rendering a note share one entry point for it rather than each
// importing supernote-typescript's constructor directly.
export function parseNote(bytes: ArrayBuffer): SupernoteX {
    return new SupernoteX(new Uint8Array(bytes));
}

// Builds one `<div class="page-container">` (holding a single `<img>`) per
// already-rasterized page image and appends them to `container`, using only
// plain DOM APIs (no Obsidian's createDiv/createEl/addClass helpers) - so
// this can run in a plain browser with no Obsidian runtime loaded. Doesn't
// rasterize the images itself (see ImageConverter in imageConverter.ts) or
// build any toolbar/observers around them - callers layer that on top of the
// returned elements.
export function buildNotePageElements(
    images: string[],
    container: HTMLElement,
    options: BuildNotePageElementsOptions = {},
): RenderedNotePage[] {
    const startPageNumber = options.startPageNumber ?? 1;

    return images.map((imageDataUrl, i) => {
        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.dataset.pageNumber = String(startPageNumber + i);

        const img = document.createElement('img');
        img.src = imageDataUrl;
        if (options.invertColorsWhenDark) img.classList.add('supernote-invert-dark');
        pageContainer.appendChild(img);
        container.appendChild(pageContainer);

        return { pageNumber: startPageNumber + i, containerEl: pageContainer, imageEl: img };
    });
}

// Builds `pageCount` `<div class="page-container">` elements (each holding a
// still-`src`-less `<img>`) and appends them to `container`, reserving each
// one's correct box size up front via `aspect-ratio` - an <img> with no src/
// dimensions otherwise collapses to ~0 height, so it "pops" to full size
// right as it loads, shifting every later page's position (the same trick,
// for the same reason, as SupernoteView's thumbnail sidebar - see
// buildThumbSidebar()'s own comment on it). Pairs with a caller-driven lazy
// loader (e.g. an IntersectionObserver watching each returned containerEl)
// that sets each returned imageEl's `src` once that page is actually
// rasterized - this function itself never loads or rasterizes anything, so
// it can build a note's entire page list immediately (correct toolbar page
// count, scrollbar length, page-jump math) without waiting on a single
// image to decode.
export function buildNotePagePlaceholders(
    pageCount: number,
    container: HTMLElement,
    options: BuildNotePagePlaceholdersOptions,
): RenderedNotePage[] {
    const startPageNumber = options.startPageNumber ?? 1;

    return Array.from({ length: pageCount }, (_, i) => {
        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.dataset.pageNumber = String(startPageNumber + i);
        // Also load-bearing, not just the img's own width:100% below - see
        // that one's comment for the full trick, but the short version:
        // page-container has no CSS width of its own (see noteRenderer's
        // caller-side stylesheets), so under a flex container using
        // `align-items: center` rather than the stretch default (both
        // SupernoteViewerElement's .pages and SupernoteView's own page list
        // do this, to keep pages narrower than the viewport actually
        // centered instead of stretched), a flex item with no explicit
        // width sizes to its own content's width - and the still-src-less
        // img's "100%" below has nothing definite to resolve against in
        // that case, collapsing to ~0 regardless of its aspect-ratio.
        // Confirmed via real, direct testing: without this, every
        // not-yet-loaded placeholder measured ~22px tall (a bare <img>'s
        // default fallback size) instead of its real page height, which
        // silently made the *entire* scrollable page list far shorter than
        // it should've been for any pages beyond however many happened to
        // have already loaded - manifesting as "scrolling quickly jumps
        // straight to the last page number" (a real user-reported bug):
        // the scrollable range was measured against those collapsed
        // heights, so a normal-sized scroll gesture could reach what was
        // then the *current* (still growing) scroll-max long before
        // reaching the note's real end. Cleared again in
        // fillNotePagePlaceholder() once a real image loads, for the same
        // reason the img's own overrides are - reverting to natural,
        // possibly-narrower-than-container, centered sizing.
        pageContainer.style.width = '100%';

        const img = document.createElement('img');
        // `width: 100%` is the load-bearing half of this trick, not just
        // `aspect-ratio`: this module's CSS only ever caps a *loaded* page
        // image at `max-width: 100%` (so a page smaller than its container
        // isn't stretched past its own native resolution), which is never a
        // definite size for an unloaded <img> to derive a height from. See
        // fillNotePagePlaceholder(), which clears this override again once a
        // real image is actually loaded in, reverting to that same
        // native-size-capped-by-container behavior.
        img.style.width = '100%';
        img.style.aspectRatio = `${options.pageWidth} / ${options.pageHeight}`;
        if (options.invertColorsWhenDark) img.classList.add('supernote-invert-dark');
        pageContainer.appendChild(img);
        container.appendChild(pageContainer);

        return { pageNumber: startPageNumber + i, containerEl: pageContainer, imageEl: img };
    });
}

// Fills in a placeholder built by buildNotePagePlaceholders() with its
// actual rasterized image, clearing the placeholder-only inline overrides it
// set (see that function's comment) so the loaded image reverts to being
// sized the same way an eagerly-rendered page from buildNotePageElements()
// would be: by its own real intrinsic dimensions, capped by the container
// via ordinary CSS.
export function fillNotePagePlaceholder(page: RenderedNotePage, imageDataUrl: string): void {
    page.containerEl.style.width = '';
    page.imageEl.style.width = '';
    page.imageEl.style.aspectRatio = '';
    page.imageEl.src = imageDataUrl;
}
