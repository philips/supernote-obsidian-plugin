import { installAtPolyfill } from 'polyfills';
installAtPolyfill();

import { SupernoteX, toImage } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';

export { };

export type SupernoteWorkerMessage =
    | { type: 'convert'; note: SupernoteX; pageNumbers?: number[]; scale?: number };

export type SupernoteWorkerResponse =
    | { type: 'result'; images: string[] }
    | { type: 'error'; error: string };

self.onmessage = async (e: MessageEvent<SupernoteWorkerMessage>) => {
    try {
        const data = e.data;

        if (data.type === 'convert') {
            const results = await toImage(data.note, data.pageNumbers, { scale: data.scale });
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
