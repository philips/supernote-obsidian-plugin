import { installAtPolyfill } from 'polyfills';
installAtPolyfill();

import { SupernoteX, toImage } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';

export { };

export type SupernoteWorkerMessage = {
    type: 'convert';
    note: SupernoteX;
    pageNumbers?: number[];
}

export type SupernoteWorkerResponse = {
    type: 'result';
    images: string[];
    error?: string;
}

self.onmessage = async (e: MessageEvent<SupernoteWorkerMessage>) => {
    try {
        const { type, note, pageNumbers } = e.data;

        if (type === 'convert') {
            const results = await toImage(note, pageNumbers);
            // Convert canvas/images to data URLs before sending
            const dataUrls = results.map(result => {
                if (result) {
                    return encodeDataURL(result);
                }
                console.error('Result is not a valid image');
                return null;
            });

            self.postMessage({
                type: 'result',
                images: dataUrls
            });
        }
    } catch (error) {
        self.postMessage({
            type: 'result',
            images: [],
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        });
    }
};
