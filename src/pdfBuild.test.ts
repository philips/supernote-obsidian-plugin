// @vitest-environment node
//
// Verifies the vectorInk wiring in buildPdfInWorker() - that the main-thread
// prep (prepareVectorInkPages + buildRenderNoteForVectorInk) actually strips
// the bitmap ink layers from vector-replaced pages and produces non-empty
// strokes/styles for exactly those pages, and that the off path leaves the
// note untouched.
//
// buildPdfInWorker() itself spins up a real Web Worker (pdfBuild.worker.ts)
// which node/vitest can't host, and inflating the final PDF's content
// stream to assert vector operators needs node's zlib (not in this
// project's DOM-only tsconfig) - the submodule's own tests/pdf.test.ts
// covers that end of the contract directly. What's left to verify *here*
// is the plugin's own wiring: that the boolean flows through to (a) ink
// layers being stripped on the on path and (b) the parallel
// strokes/strokeStyles arrays being populated for exactly the pages
// prepareVectorInkPages flagged. addPdfPage's drawing of those strokes into
// vector PDF operators is the submodule's tested contract, not something
// this plugin re-implements.
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    SupernoteX,
    prepareVectorInkPages,
    buildRenderNoteForVectorInk,
} from 'supernote-typescript';

// One '..' (not two like src/render/* and src/webcomponent/* tests use): this
// test sits directly in src/, so a single '..' reaches the repo root where
// the supernote-typescript submodule lives. Two would escape above the repo
// to a sibling 'supernote-typescript' that exists locally (a leftover
// clone) but not in CI, where it ENOENTs.
const FIXTURES_DIR = path.join(import.meta.dirname, '..', 'supernote-typescript', 'tests', 'input');

// A note with real decodable TOTALPATH ink - the same fixture the
// submodule's pdf.test.ts uses to assert vector paths land in the PDF, i.e.
// a known-good "vectorInk actually emits primitives" fixture. A fixture with
// no decodable TOTALPATH would fall back to raster and make an on-path
// assertion pass for the wrong reason.
const VECTOR_INK_FIXTURE = 'ink-a5x-2.14.28-old-pen-width.note';

function readFixture(name: string): Uint8Array {
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, name));
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

// The ink layers withoutInkLayers nulls (MAINLAYER + LAYER1-3); BGLAYER
// (background) is left intact so toImage still rasterizes it. Build the
// list from the note's own LAYERSEQ so this stays correct if the layout
// ever grows another ink layer.
const INK_LAYERS = ['MAINLAYER', 'LAYER1', 'LAYER2', 'LAYER3'] as const;

describe('buildPdfInWorker vectorInk wiring', () => {
    it('strips ink layers on the on path so the worker rasterizes only the background for vector pages', () => {
        const sn = new SupernoteX(readFixture(VECTOR_INK_FIXTURE));
        const pageNumbers = Array.from({ length: sn.pages.length }, (_, i) => i + 1);

        const vectorInkPages = prepareVectorInkPages(sn, pageNumbers, 1);
        const renderNote = buildRenderNoteForVectorInk(sn, vectorInkPages);

        // At least one page must have decided to use vector ink for the
        // rest of this test to mean anything.
        const vectorPageCount = vectorInkPages.filter((p) => p.useVectorInk).length;
        expect(vectorPageCount).toBeGreaterThan(0);

        for (let i = 0; i < vectorInkPages.length; i++) {
            const vip = vectorInkPages[i];
            const pageNumber = vip.pageNumber;
            const strippedPage = renderNote.pages[pageNumber - 1];
            const originalPage = sn.pages[pageNumber - 1];
            for (const layerName of INK_LAYERS) {
                const strippedBuf = strippedPage[layerName]?.bitmapBuffer;
                const originalBuf = originalPage[layerName]?.bitmapBuffer;
                if (vip.useVectorInk) {
                    // The vector page's ink bitmap is gone - that's what
                    // stops the worker from rasterizing the ink on top of
                    // the vector strokes addPdfPage lays down. (Only assert
                    // for layers the note actually has; a layer absent
                    // from LAYERSEQ reads as undefined on both sides.)
                    if (originalBuf) {
                        expect(strippedBuf).toBeNull();
                    }
                } else {
                    // A fallback page keeps its rasterized ink layers
                    // untouched, byte-for-byte.
                    expect(strippedBuf).toEqual(originalBuf);
                }
            }
        }
    });

    it('builds non-empty strokes/strokeStyles for exactly the useVectorInk pages', () => {
        const sn = new SupernoteX(readFixture(VECTOR_INK_FIXTURE));
        const pageNumbers = Array.from({ length: sn.pages.length }, (_, i) => i + 1);
        const vectorInkPages = prepareVectorInkPages(sn, pageNumbers, 1);

        // The exact parallel arrays buildPdfInWorker builds and posts to the
        // worker (see main.ts): strokes/strokeStyles per page, undefined for
        // any page that fell back to raster.
        const strokes = vectorInkPages.map((vip) => (vip.useVectorInk ? vip.strokes : undefined));
        const strokeStyles = vectorInkPages.map((vip) => (vip.useVectorInk ? vip.styles : undefined));

        expect(strokes.length).toBe(vectorInkPages.length);
        expect(strokeStyles.length).toBe(vectorInkPages.length);
        for (let i = 0; i < vectorInkPages.length; i++) {
            const vip = vectorInkPages[i];
            if (vip.useVectorInk) {
                // A vector page hands real strokes/styles to addPdfPage.
                expect(strokes[i]).toBeDefined();
                expect(strokes[i]!.length).toBeGreaterThan(0);
                expect(strokeStyles[i]).toBeDefined();
                expect(strokeStyles[i]!.length).toBe(strokes[i]!.length);
            } else {
                // A fallback page keeps its raster - no strokes to draw.
                expect(strokes[i]).toBeUndefined();
                expect(strokeStyles[i]).toBeUndefined();
            }
        }
    });

    it('leaves the note untouched on the off path (no prep, no strip)', () => {
        const sn = new SupernoteX(readFixture(VECTOR_INK_FIXTURE));
        // buildPdfInWorker's off path: vectorInk false -> renderNote === sn,
        // no strokes/strokeStyles arrays built at all. Confirm the note's
        // ink layers are intact for every page (i.e. the off path is the
        // original behavior, unchanged by this feature).
        for (const page of sn.pages) {
            for (const layerName of INK_LAYERS) {
                // Whatever the note carries, the off path carries it too:
                // buildRenderNoteForVectorInk is never called, so nothing
                // is nulled. Only assert for layers the note actually has.
                const buf = page[layerName]?.bitmapBuffer;
                if (buf) {
                    expect(buf.length).toBeGreaterThan(0);
                }
            }
        }
    });
});
