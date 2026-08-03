import { installAtPolyfill } from 'polyfills';
installAtPolyfill();

import { IRenderableNote, toImage } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';

export { };

// Rasterization only - the on-screen/lazy-loaded page-image path shared by
// SupernoteView, SupernoteEmbed, and the standalone <supernote-viewer> web
// component (see src/render/imageConverter.ts, which is what actually talks
// to this worker). Split out from what used to be one combined
// myworker.worker.ts specifically so none of those consumers pull in
// pdf-lib just because they used to share a Worker script with the plugin's
// PDF export feature - confirmed via a real esbuild bundle-size check
// (issue #183's standalone bundle) that they previously did, unconditionally,
// even though the web component never sends the other worker's 'buildPdf'
// message at all. See pdfBuild.worker.ts for that separate, plugin-only
// concern.
export type RasterizeWorkerMessage =
    // `note` is always the minimal per-page slice built by
    // extractPagesRenderData() (never the whole parsed SupernoteX) - see
    // its comment (src/render/imageConverter.ts) for why that matters.
    // Already contains exactly the requested pages, in order, so there's no
    // separate pageNumbers field to also send - toImage() defaults to every
    // page in the given note, which here is exactly the ones asked for.
    { type: 'convert'; note: IRenderableNote; scale?: number };

export type RasterizeWorkerResponse =
    | { type: 'result'; images: string[] }
    | { type: 'error'; error: string };

self.onmessage = async (e: MessageEvent<RasterizeWorkerMessage>) => {
    try {
        const data = e.data;
        const results = await toImage(data.note, undefined, { scale: data.scale });
        // Convert canvas/images to data URLs before sending
        const images = results.map(result => encodeDataURL(result));
        const response: RasterizeWorkerResponse = { type: 'result', images };
        self.postMessage(response);
    } catch (error) {
        const response: RasterizeWorkerResponse = {
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
        self.postMessage(response);
    }
};
