import { installAtPolyfill } from 'polyfills';
installAtPolyfill();

import { SupernoteX, toImage, IRenderableNote } from 'supernote-typescript';
import { encodeDataURL, encodePng } from 'image-js';

export { };

export type SupernoteWorkerMessage =
    | { type: 'convert'; note: SupernoteX; pageNumbers?: number[] }
    | { type: 'renderPdfPage'; pageRenderData: IRenderableNote };

export type SupernoteWorkerResponse =
    | { type: 'result'; images: string[] }
    | { type: 'pdfPageResult'; pngBytes: Uint8Array }
    | { type: 'error'; error: string };

self.onmessage = async (e: MessageEvent<SupernoteWorkerMessage>) => {
    try {
        const data = e.data;

        if (data.type === 'convert') {
            const results = await toImage(data.note, data.pageNumbers);
            // Convert canvas/images to data URLs before sending
            const images = results.map(result => encodeDataURL(result));
            const response: SupernoteWorkerResponse = { type: 'result', images };
            self.postMessage(response);
        } else if (data.type === 'renderPdfPage') {
            const [image] = await toImage(data.pageRenderData, [1]);
            const pngBytes = encodePng(image);
            const response: SupernoteWorkerResponse = { type: 'pdfPageResult', pngBytes };
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
