// @vitest-environment node
//
// Verifies the vectorInk wiring in the rasterize worker path — the same
// contract pdfBuild.test.ts covers for the PDF path, for the on-screen
// rendering pipeline (rasterize.worker.ts + imageConverter.ts). The worker
// itself can't run under node/vitest (it's a Web Worker), so this replays
// its exact main-thread + assembly logic against a real parsed note:
// extractPageRenderData slices the page, the ink layers are nulled on the
// slice (what the worker does for a useVectorInk page), toImage rasterizes
// the stripped slice (background only), and addSvgPage draws the vector
// strokes on top as an SVG.
//
// This catches the same class of regression pdfBuild.test.ts watches for
// the PDF path — a wrong key name in the worker message, mis-aligned
// strokes/styles, the strip not actually happening — for the path that
// feeds the on-screen note view and image export.
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    SupernoteX,
    extractPageRenderData,
    prepareVectorInkPages,
    buildVectorInkBackgroundNote,
    buildRasterInkOverlayNote,
    toImage,
    addSvgPage,
} from 'supernote-typescript';

// One '..' (this test sits directly in src/) — see pdfBuild.test.ts's
// FIXTURES_DIR comment for why the count matters.
const FIXTURES_DIR = path.join(import.meta.dirname, '..', 'supernote-typescript', 'tests', 'input');

// A note with real decodable TOTALPATH ink — the same fixture the
// submodule's pdf.test.ts and this plugin's pdfBuild.test.ts use.
const VECTOR_INK_FIXTURE = 'ink-a5x-2.14.28-old-pen-width.note';

function readFixture(name: string): Uint8Array {
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, name));
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

// Replays the worker's per-page logic: derive the public vector background
// and optional compact raster-overlay notes on the full parsed note, slice
// them for the worker, rasterize, then assemble. Returns the SVG string from
// addSvgPage (the meaningful artifact; the btoa data-URL wrapping the worker
// does is trivial).
async function renderPage(sn: SupernoteX, pageNumber: number, vectorInk: boolean): Promise<{ svg: string; strippedInk: boolean }> {
    const vip = vectorInk ? prepareVectorInkPages(sn, [pageNumber], 1)[0] : undefined;
    const useVector = vip?.useVectorInk ?? false;
    const vectorPages = vip ? [vip] : [];
    const backgroundNote = useVector ? buildVectorInkBackgroundNote(sn, vectorPages) : sn;
    const disable = sn.pages[pageNumber - 1].DISABLE;
    const overlayNote = useVector && disable !== undefined && disable !== '' && disable !== 'none'
        ? buildRasterInkOverlayNote(sn, vectorPages)
        : undefined;
    const slice = extractPageRenderData(backgroundNote, pageNumber).pages[0];
    const [image] = await toImage({
        pageWidth: sn.pageWidth,
        pageHeight: sn.pageHeight,
        pages: [slice],
    });
    const [overlayImage] = overlayNote
        ? await toImage(extractPageRenderData(overlayNote, pageNumber))
        : [];
    const svg = addSvgPage(
        { ...slice, recognitionElements: [] },
        image,
        sn.pageWidth,
        sn.pageHeight,
        {
            strokes: useVector ? vip!.strokes : undefined,
            strokeStyles: useVector ? vip!.styles : undefined,
            overlayImage,
            includeText: false,
        },
    );
    return { svg, strippedInk: useVector };
}

describe('rasterize worker vectorInk wiring', () => {
    it('draws ink as vector <path> elements when vectorInk is on', async () => {
        const sn = new SupernoteX(readFixture(VECTOR_INK_FIXTURE));
        const { svg, strippedInk } = await renderPage(sn, 1, true);

        // The fixture's ink must decode for this test to mean anything.
        expect(strippedInk).toBe(true);
        // A vector-ink SVG contains real <path> elements (the strokes).
        expect(svg).toContain('<path');
        // And the background <image> is still there beneath them.
        expect(svg).toContain('<image');
        expect(svg).toContain('</svg>');
        expect(svg).not.toContain('data-raster-ink-overlay="true"');
    });

    it('keeps bitmap-only text boxes above vector paths', async () => {
        const sn = new SupernoteX(readFixture('textbox-n5-20260016-digest.note'));
        const { svg, strippedInk } = await renderPage(sn, 4, true);

        expect(strippedInk).toBe(true);
        expect(svg).toContain('<path');
        expect(svg).toContain('data-raster-ink-overlay="true"');
        expect(svg.indexOf('<path')).toBeLessThan(svg.indexOf('data-raster-ink-overlay="true"'));
    }, 30000);

    it('leaves ink as a plain raster image (no vector <path>) when vectorInk is off', async () => {
        const sn = new SupernoteX(readFixture(VECTOR_INK_FIXTURE));
        const { svg, strippedInk } = await renderPage(sn, 1, false);

        // Off path: no stripping, no strokes passed to addSvgPage.
        expect(strippedInk).toBe(false);
        // The SVG still embeds the background image, but draws no vector
        // strokes on top (addSvgPage no-ops on absent/empty strokes).
        expect(svg).toContain('<image');
        expect(svg).not.toContain('<path');
    });

    it('produces a valid data URL when wrapped the way the worker does', async () => {
        const sn = new SupernoteX(readFixture(VECTOR_INK_FIXTURE));
        const { svg } = await renderPage(sn, 1, true);
        // The worker wraps addSvgPage's string as a base64 SVG data URL.
        // Verify that wrapping produces a decodable URL whose decoded
        // content matches the original SVG (i.e. the round-trip is sound
        // and the <path> content survives it).
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
        expect(dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
        // atob is a global in Node 16+; vitest's node env has it.
        const decoded = atob(dataUrl.slice('data:image/svg+xml;base64,'.length));
        expect(decoded).toBe(svg);
        expect(decoded).toContain('<path');
    });
});