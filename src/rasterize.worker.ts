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
// just because they used to share a Worker script with the plugin's PDF export
// feature - confirmed via a real esbuild bundle-size check (issue #183's
// standalone bundle) that they previously did, unconditionally, even though
// the web component never sends the other worker's 'buildPdf' message at all.
// See pdfBuild.worker.ts for that separate, plugin-only concern.

// Kept only for the legacy backgroundOnly-only request. Vector-ink requests
// now arrive as the public buildVectorInkBackgroundNote() output, rather than
// reimplementing that split by mutating worker-local slices.
const INK_LAYER_NAMES = ['MAINLAYER', 'LAYER1', 'LAYER2', 'LAYER3'] as const;

export interface RasterOverlayPages {
    // Contains only the pages with a bitmap-only text-box/Digest overlay,
    // rather than a transparent full-page image for every vectorized page.
    note: IRenderableNote;
    // Indexes into the enclosing convert message's note.pages array; aligned
    // with note.pages above.
    pageIndexes: number[];
}

export type RasterizeWorkerMessage =
    // `note` is always the minimal per-page slice built by
    // extractPagesRenderData() (never the whole parsed SupernoteX) - see
    // its comment (src/render/imageConverter.ts) for why that matters.
    // Already contains exactly the requested pages, in order, so there's no
    // separate pageNumbers field to also send - toImage() defaults to every
    // page in the given note, which here is exactly the ones asked for.
    //
    // `vectorInk`, when present, is a parallel array aligned by index with
    // note.pages. imageConverter prepares the background note on the main
    // thread with buildVectorInkBackgroundNote(), because the worker slices
    // lack the TOTALPATH/title data needed to do that safely. For a page whose
    // entry has useVectorInk true, this worker assembles an SVG with the
    // background raster and vector paths. `rasterOverlay`, if present, holds
    // only the matching text-box/Digest rasters, which addSvgPage paints after
    // the paths. A fallback page still returns a PNG as before.
    //
    // `backgroundOnly` requests plain PNG bases for write-on playback. Its
    // vector pages are likewise already pre-split by imageConverter; the
    // response carries their optional overlay data URLs separately so the
    // component can position them above the animated SVG. The no-vectorInk
    // variant retains the historical "strip all bitmap ink" behavior used by
    // convertToBackgroundImages().
    {
        type: 'convert';
        note: IRenderableNote;
        scale?: number;
        vectorInk?: VectorInkPage[];
        backgroundOnly?: boolean[];
        rasterOverlay?: RasterOverlayPages;
    };

export type RasterizeWorkerResponse =
    | { type: 'result'; images: string[]; rasterOverlays?: (string | undefined)[] }
    | { type: 'error'; error: string };

self.onmessage = async (e: MessageEvent<RasterizeWorkerMessage>) => {
    try {
        const data = e.data;
        const vectorInk = data.vectorInk;
        const backgroundOnly = data.backgroundOnly;

        // Compatibility path for callers asking for a bare background without
        // vector page metadata. Vector-ink callers receive a pre-split
        // background note instead, which is essential to keep DISABLE pixels
        // out of the base raster and available for the later overlay.
        if (backgroundOnly && !vectorInk) {
            for (let i = 0; i < data.note.pages.length; i++) {
                if (!backgroundOnly[i]) continue;
                const page = data.note.pages[i];
                for (const name of INK_LAYER_NAMES) {
                    const layer = page[name];
                    if (layer) page[name] = { ...layer, bitmapBuffer: null };
                }
            }
        }

        const results = await toImage(data.note, undefined, { scale: data.scale });
        const overlayResults = data.rasterOverlay
            ? await toImage(data.rasterOverlay.note, undefined, { scale: data.scale })
            : undefined;
        const overlayByPageIndex = new Map<number, NonNullable<typeof overlayResults>[number]>();
        if (overlayResults && data.rasterOverlay) {
            data.rasterOverlay.pageIndexes.forEach((pageIndex, i) => {
                const overlay = overlayResults[i];
                if (overlay) overlayByPageIndex.set(pageIndex, overlay);
            });
        }

        const images = results.map((result, i) => {
            const vip = vectorInk?.[i];
            // A write-on page owns its vector SVG separately, so its worker
            // result remains the plain pre-split background PNG.
            if (vip?.useVectorInk && !backgroundOnly?.[i]) {
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
                    {
                        strokes: vip.strokes,
                        strokeStyles: vip.styles,
                        overlayImage: overlayByPageIndex.get(i),
                        includeText: false,
                    },
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
        const rasterOverlays = overlayResults
            ? results.map((_, i) => {
                const overlay = overlayByPageIndex.get(i);
                return overlay ? encodeDataURL(overlay) : undefined;
            })
            : undefined;
        const response: RasterizeWorkerResponse = { type: 'result', images, rasterOverlays };
        self.postMessage(response);
    } catch (error) {
        const response: RasterizeWorkerResponse = {
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
        self.postMessage(response);
    }
};
