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
