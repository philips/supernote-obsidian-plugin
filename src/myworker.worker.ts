import { installAtPolyfill } from 'polyfills';
installAtPolyfill();

import { IRenderableNote, toImage } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';

export { };

export type SupernoteWorkerMessage =
    // `note` is always the minimal per-page slice built by main.ts's
    // extractPagesRenderData() (never the whole parsed SupernoteX) - see
    // its comment for why that matters. Already contains exactly the
    // requested pages, in order, so there's no separate pageNumbers field
    // to also send - toImage() defaults to every page in the given note,
    // which here is exactly the ones asked for.
    //
    // `flatten`: toImage()'s pages are RGBA - background (unwritten) pixels
    // are alpha=0 *by design*, so the on-screen <img> can sit directly over
    // Obsidian's own theme background (see the invertColorsWhenDark setting)
    // instead of a hardcoded white rectangle. Their RGB channel already
    // holds the correct plain-white-page appearance regardless of alpha
    // (background pixels are packed as opaque white with alpha stripped),
    // so for a caller that's going to flatten onto a real page anyway (PDF
    // export - see assemblePdfFromNote() in main.ts) it's safe to just drop
    // the alpha channel outright rather than composite it. That matters:
    // pdf-lib's own PNG embedder always fully decodes to raw RGBA *and*
    // retains a whole separate raw alpha-channel copy for any page with a
    // non-255 alpha value (real background pixels: exactly this note's
    // pages) until pdfDoc.save() compresses and releases it - confirmed via
    // real-device testing to be a large share of a reported ~2GB peak/20s+
    // freeze during PDF export. A 3-channel PNG never triggers that path at
    // all, so this trades nothing on the main view (untouched - this only
    // applies when explicitly requested) for a real memory/time win on
    // export.
    | { type: 'convert'; note: IRenderableNote; scale?: number; flatten?: boolean };

export type SupernoteWorkerResponse =
    | { type: 'result'; images: string[] }
    | { type: 'error'; error: string };

self.onmessage = async (e: MessageEvent<SupernoteWorkerMessage>) => {
    try {
        const data = e.data;

        if (data.type === 'convert') {
            const results = await toImage(data.note, undefined, { scale: data.scale });
            // Convert canvas/images to data URLs before sending - dropping
            // to RGB first when requested (see SupernoteWorkerMessage's
            // `flatten` doc comment). Only converts images that actually
            // have an alpha channel to begin with; convertColor() would
            // otherwise throw converting RGB to itself.
            const images = results.map(result => {
                const toEncode = data.flatten && result.alpha ? result.convertColor('RGB') : result;
                return encodeDataURL(toEncode);
            });
            const response: SupernoteWorkerResponse = { type: 'result', images };
            self.postMessage(response);
        }
    } catch (error) {
        const response: SupernoteWorkerResponse = {
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
        self.postMessage(response);
    }
};
