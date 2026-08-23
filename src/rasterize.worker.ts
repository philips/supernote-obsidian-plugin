import { installAtPolyfill } from 'polyfills';
installAtPolyfill();

import { IRenderableNote, toImage, addSvgPage } from 'supernote-typescript';
import type { VectorInkPage } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';

export { };

// Rasterization only - the on-screen/lazy-loaded page-image path shared by
// SupernoteView, SupernoteEmbed, and the standalone <supernote-viewer> web
// component (see src/render/imageConverter.ts, which is what actually talks
// to this worker). Split out from what used to be one combined
// myworker.worker.ts specifically so none of these consumers pull in pdf-lib
// just because they used to share a Worker script with the plugin's
// PDF export feature - confirmed via a real esbuild bundle-size check
// (issue #183's standalone bundle) that they previously did, unconditionally,
// even though the web component never sends the other worker's 'buildPdf'
// message at all. See pdfBuild.worker.ts for that separate, plugin-only
// concern.

// The ink layers withoutInkLayers/buildRenderNoteForVectorInk null on the
// full note; here, on the per-page slice, the same names. BGLAYER
// (background) is deliberately not in this list — it's what toImage
// rasterizes to sit beneath the vector strokes.
const INK_LAYER_NAMES = ['MAINLAYER', 'LAYER1', 'LAYER2', 'LAYER3'] as const;

export type RasterizeWorkerMessage =
    // `note` is always the minimal per-page slice built by
    // extractPagesRenderData() (never the whole parsed SupernoteX) - see
    // its comment (src/render/imageConverter.ts) for why that matters.
    // Already contains exactly the requested pages, in order, so there's no
    // separate pageNumbers field to also send - toImage() defaults to every
    // page in the given note, which here is exactly the ones asked for.
    //
    // `vectorInk`, when present, is a parallel array aligned by index with
    // note.pages. For a page whose entry has useVectorInk true, the worker
    // nulls that page's bitmap ink layers (so toImage rasterizes only the
    // background) and assembles an SVG via addSvgPage with the entry's
    // strokes/strokeStyles drawn as vector paths on top, returned as an
    // image/svg+xml data URL. A page with useVectorInk false (or no entry)
    // returns a PNG data URL as before. Only sent for full-res renders
    // (scale undefined) — downsampled thumbnails keep the raster path since
    // vector coordinates don't survive a downsample.
    //
    // `backgroundOnly`, when present, is a parallel boolean array aligned
    // by index with note.pages. A page whose entry is true has its bitmap
    // ink layers nulled exactly as above but returns a plain PNG data URL
    // (no addSvgPage) — the bare paper/ruling/background with the ink
    // stripped, for callers that supply their own ink. That's the
    // web component's write-on stroke animation mode (see
    // src/webcomponent/strokeAnimation.ts), which draws the strokes itself,
    // one at a time, over the returned base layer.
    { type: 'convert'; note: IRenderableNote; scale?: number; vectorInk?: VectorInkPage[]; backgroundOnly?: boolean[] };

export type RasterizeWorkerResponse =
    | { type: 'result'; images: string[] }
    | { type: 'error'; error: string };

self.onmessage = async (e: MessageEvent<RasterizeWorkerMessage>) => {
    try {
        const data = e.data;
        const vectorInk = data.vectorInk;
        const backgroundOnly = data.backgroundOnly;

        // Strip the bitmap ink layers from each vector-ink page (and each
        // background-only page — same strip, plain-PNG result, see the
        // `backgroundOnly` comment on the message type) *before* toImage,
        // so the raster it produces for those pages is the background only —
        // the vector strokes (carried alongside in the VectorInkPage entry)
        // are drawn on top by addSvgPage below. Doing this on the slice
        // (rather than via buildRenderNoteForVectorInk on the whole note)
        // keeps the sliced-send memory model from imageConverter.ts intact:
        // the worker never sees the full SupernoteX.
        if (vectorInk || backgroundOnly) {
            for (let i = 0; i < data.note.pages.length; i++) {
                if (!vectorInk?.[i]?.useVectorInk && !backgroundOnly?.[i]) continue;
                const page = data.note.pages[i];
                for (const name of INK_LAYER_NAMES) {
                    const layer = page[name];
                    if (layer) {
                        page[name] = { ...layer, bitmapBuffer: null };
                    }
                }
            }
        }

        const results = await toImage(data.note, undefined, { scale: data.scale });
        const images = results.map((result, i) => {
            const vip = vectorInk?.[i];
            if (vip?.useVectorInk) {
                // addSvgPage embeds the background PNG as a base64 <image>
                // and draws the strokes as vector <path>s on top.
                // includeText: false — this plugin's find-in-note uses its
                // own wordOverlay (src/render/wordOverlay.ts), not an SVG
                // text layer, so the bytes would be dead weight here.
                // The { ...page, recognitionElements: [] } spread satisfies
                // addSvgPage's IPdfPage parameter; recognitionElements is
                // only read when includeText is true, which it isn't here.
                const page = data.note.pages[i];
                const svg = addSvgPage(
                    { ...page, recognitionElements: [] },
                    result,
                    data.note.pageWidth,
                    data.note.pageHeight,
                    { strokes: vip.strokes, strokeStyles: vip.styles, includeText: false },
                );
                // addSvgPage returns a raw SVG string; wrap it as a data
                // URL so it drops into an <img src> the same way the PNG
                // data URLs already do (see noteRenderer.ts). The SVG's
                // content is entirely ASCII (SVG tags, base64 PNG, numeric
                // path data), so btoa is safe here.
                return 'data:image/svg+xml;base64,' + btoa(svg);
            }
            return encodeDataURL(result);
        });
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