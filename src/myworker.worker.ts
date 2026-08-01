import { installAtPolyfill } from 'polyfills';
installAtPolyfill();

import { IRenderableNote, IPdfPage, toImage, createPdfContext, addPdfPage, flattenToWhite } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';

export { };

export type SupernoteWorkerMessage =
    // `note` is always the minimal per-page slice built by main.ts's
    // extractPagesRenderData() (never the whole parsed SupernoteX) - see
    // its comment for why that matters. Already contains exactly the
    // requested pages, in order, so there's no separate pageNumbers field
    // to also send - toImage() defaults to every page in the given note,
    // which here is exactly the ones asked for.
    | { type: 'convert'; note: IRenderableNote; scale?: number }
    // Rasterizes and assembles a *whole* PDF in one call, batching internally
    // (see PDF_ASSEMBLY_BATCH_SIZE) - not just rasterization, unlike
    // 'convert' above. Building a PDF this way needs createPdfContext()
    // through pdfDoc.save() to happen in one uninterrupted place: its
    // pdf-lib objects aren't structured-clone-safe, so they can't be handed
    // back to the main thread partway through and resumed later. Confirmed
    // via real-device testing that pdf-lib's own embedPng() (always fully
    // decoding every PNG to raw pixels, retained until save()) makes this
    // genuinely expensive - ~1.7GB and 10+ seconds for a 100-page note, even
    // after dropping the alpha channel - entirely inherent to pdf-lib itself,
    // not anything fixable on this plugin's side short of not using it (see
    // main.ts's now-removed assemblePdfFromNote() for the fuller trail).
    // Doing all of that here means Obsidian's own UI thread never carries
    // any of that cost, regardless of how large it is.
    | { type: 'buildPdf'; pageWidth: number; pageHeight: number; pages: IPdfPage[] };

export type SupernoteWorkerResponse =
    | { type: 'result'; images: string[] }
    | { type: 'pdfResult'; pdfBytes: Uint8Array }
    | { type: 'error'; error: string };

// See PDF_ASSEMBLY_BATCH_SIZE's old home in main.ts (removed once this moved
// here) for the fuller reasoning - a small batch keeps this from ever
// rasterizing more than a handful of pages' worth of decoded images at once
// on top of whatever pdf-lib's own ctx.pdfDoc is separately retaining
// per-page regardless of batch size.
const PDF_ASSEMBLY_BATCH_SIZE = 8;

// Uint8Array.buffer isn't safe to transfer directly when the array is a view
// over a larger/offset buffer (not guaranteed for pdf-lib's PDFDocument.save()
// output, so don't assume it) - transferring the whole underlying buffer
// could hand over more (or differently-offset) bytes than this array
// actually represents. Always returns a buffer sized to exactly this array's
// bytes, safe to list in postMessage()'s transfer list.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// tsconfig.json's `lib` only includes "DOM", not "WebWorker" (the project
// also has plenty of main-thread DOM code sharing this same config, and the
// two libs' conflicting global declarations don't mix cleanly in one
// tsconfig) - so TypeScript resolves `self.postMessage` against `Window`'s
// overloads, which don't accept a transfer list. Actually calling this at
// runtime works fine regardless (this file only ever runs as a Worker) -
// this just gives it the signature that's actually true here. Called
// *through* `self` below, not extracted as a standalone reference first:
// postMessage is a native method that depends on its `this` being the real
// worker global scope, so detaching it from `self` first would risk an
// "illegal invocation" error at runtime.
function postMessageWithTransfer(message: unknown, transfer?: Transferable[]): void {
    (self.postMessage as (message: unknown, transfer?: Transferable[]) => void)(message, transfer);
}

// Chrome-only, non-standard diagnostic API, available on a Worker's own
// `self.performance` too - undefined on other engines, so this always guards
// its presence. Kept from this logging's old home in main.ts's
// assemblePdfFromNote(), just now reporting this Worker's own heap instead
// of the main thread's (which no longer does any of this work at all) -
// still useful to confirm the numbers a report is based on.
function currentHeapMB(): string {
    const memory = (self.performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return memory ? (memory.usedJSHeapSize / 1_048_576).toFixed(0) : 'unknown';
}

self.onmessage = async (e: MessageEvent<SupernoteWorkerMessage>) => {
    try {
        const data = e.data;

        if (data.type === 'convert') {
            const results = await toImage(data.note, undefined, { scale: data.scale });
            // Convert canvas/images to data URLs before sending
            const images = results.map(result => encodeDataURL(result));
            const response: SupernoteWorkerResponse = { type: 'result', images };
            self.postMessage(response);
        } else if (data.type === 'buildPdf') {
            const ctx = await createPdfContext();
            for (let start = 0; start < data.pages.length; start += PDF_ASSEMBLY_BATCH_SIZE) {
                const batch = data.pages.slice(start, start + PDF_ASSEMBLY_BATCH_SIZE);
                const note: IRenderableNote = { pageWidth: data.pageWidth, pageHeight: data.pageHeight, pages: batch };
                const images = await toImage(note);
                for (let i = 0; i < batch.length; i++) {
                    // flattenToWhite(), not just discarding the alpha
                    // channel: background/unwritten pixels are packed with
                    // their color at black (see
                    // RattaRLEDecoder.buildPackedTranslation()) specifically
                    // *because* nothing looks at it while alpha is
                    // respected - a naive channel-drop revealed that black
                    // as if it were solid ink (confirmed via a real export:
                    // a black page background with the actual strokes
                    // barely visible on top). Actually blending each pixel
                    // toward white by its own alpha gives the right result.
                    await addPdfPage(ctx, batch[i], flattenToWhite(images[i]));
                }
                console.debug(
                    `Supernote: PDF export (worker) — embedded page ${start + batch.length}/${data.pages.length}, heap ~${currentHeapMB()}MB`,
                );
            }
            console.debug(`Supernote: PDF export (worker) — calling pdfDoc.save(), heap ~${currentHeapMB()}MB`);
            const saveStart = performance.now();
            const savedBytes = await ctx.pdfDoc.save();
            console.debug(
                `Supernote: PDF export (worker) — save() done in ${(performance.now() - saveStart).toFixed(0)}ms, ` +
                `${(savedBytes.length / 1_048_576).toFixed(1)}MB output, heap ~${currentHeapMB()}MB`,
            );
            // Re-wrapped in a Uint8Array over an exact-sized buffer (see
            // toArrayBuffer()'s comment) *before* constructing the response,
            // so the buffer actually referenced by `response.pdfBytes` is
            // the same one listed in postMessage()'s transfer list below -
            // transferring an unrelated buffer would silently do nothing,
            // leaving this array structured-clone (deep-copied) instead.
            const buffer = toArrayBuffer(savedBytes);
            const response: SupernoteWorkerResponse = { type: 'pdfResult', pdfBytes: new Uint8Array(buffer) };
            postMessageWithTransfer(response, [buffer]);
        }
    } catch (error) {
        const response: SupernoteWorkerResponse = {
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
        self.postMessage(response);
    }
};
