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
    | { type: 'convert'; note: IRenderableNote; scale?: number };

export type SupernoteWorkerResponse =
    | { type: 'result'; images: string[] }
    | { type: 'error'; error: string };

self.onmessage = async (e: MessageEvent<SupernoteWorkerMessage>) => {
    try {
        const data = e.data;

        if (data.type === 'convert') {
            const results = await toImage(data.note, undefined, { scale: data.scale });
            // Convert canvas/images to data URLs before sending
            const images = results.map(result => encodeDataURL(result));
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
