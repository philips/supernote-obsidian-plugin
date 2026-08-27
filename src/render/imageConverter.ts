// The rasterization slice of the rendering pipeline: bytes-parsed-into-a-
// SupernoteX in, page images out, via a pool of Web Workers. Deliberately
// free of any `obsidian` import — see issue #183 (pulling SupernoteView out
// into a standalone web component). SupernoteEmbed/SupernoteView (main.ts)
// are the Obsidian-side callers; this module itself only ever touches
// standard Worker/DOM globals and supernote-typescript.
import {
    SupernoteX,
    IRenderableNote,
    extractPageRenderData,
    prepareVectorInkPages,
    buildVectorInkBackgroundNote,
    buildRasterInkOverlayNote,
} from 'supernote-typescript';
import type { VectorInkPage } from 'supernote-typescript';
import { RasterizeWorkerMessage, RasterizeWorkerResponse } from '../rasterize.worker';
import Worker from 'rasterize.worker';

// Caps how many pages a single worker call ever rasterizes at once -
// deliberately NOT `pageNumbers.length / workerCount` (this function's
// previous behavior). That scheme sized each chunk to the *pool's* size, not
// to what's actually safe to hold in memory at once: fine while the pool
// defaulted to navigator.hardwareConcurrency (8-9 workers, ~12 pages per
// chunk), but once WorkerPool.DEFAULT_MAX_WORKERS was deliberately shrunk to
// 2 to bound the *scrolling* peak (see issue #154), a full-note export of a
// 100+ page document started handing each of those 2 workers ~50 pages in a
// single toImage() call - confirmed via real-device testing to peak over 2GB
// (~1GB held per worker simultaneously decoding/encoding its own ~50 pages).
// A small fixed cap keeps each individual worker call's own peak bounded
// regardless of pool size or document length; the existing per-worker queue
// (see WorkerPool.processChunk()) still processes every chunk, just more of
// them, sequentially per worker - slower for a large bulk export, but that's
// an acceptable trade for a rare, deliberate, one-off action (see
// DEFAULT_MAX_WORKERS' own comment for the same reasoning).
const MAX_PAGES_PER_CHUNK = 4;

function chunkPageNumbers(pageNumbers: number[]): number[][] {
    const chunks: number[][] = [];
    for (let i = 0; i < pageNumbers.length; i += MAX_PAGES_PER_CHUNK) {
        chunks.push(pageNumbers.slice(i, i + MAX_PAGES_PER_CHUNK));
    }
    return chunks;
}

// Slices out only the requested pages, in the given order, into a
// structured-clone-safe IRenderableNote - see supernote-typescript's
// extractPageRenderData() (which this wraps to cover more than one page at
// once) for exactly why this matters: postMessage-ing the *whole* parsed
// SupernoteX to a Worker - which is what this replaced - clones every
// page's raw layer data across, not just the page(s) actually requested.
// WorkerPool round-robins across every worker it has (see processChunk()),
// so as a user scrolls through a long document, every worker eventually
// receives - and holds, in its own separate V8 heap, invisible to the main
// thread's own heap snapshots/profiling - a full copy of the entire
// document, just to render one page at a time. Confirmed via real
// profiling on issue #154: navigator.hardwareConcurrency (8, on the
// reporting device) separate ~100MB Worker heaps, matching a ~900MB total
// that neither DPR capping nor zoom-aware rasterization could ever have
// addressed, since neither touches what gets sent to a Worker in the first
// place.
// The public vector-ink builders return a structural note copy rather than a
// SupernoteX instance, but extractPageRenderData() accepts that same full
// parsed-note shape.
type VectorInkRenderNote = ReturnType<typeof buildVectorInkBackgroundNote>;

function extractPagesRenderData(note: VectorInkRenderNote, pageNumbers: number[]): IRenderableNote {
    return {
        pageWidth: note.pageWidth,
        pageHeight: note.pageHeight,
        pages: pageNumbers.map((n) => extractPageRenderData(note, n).pages[0]),
    };
}

export class WorkerPool {
    private workers: Worker[];
    // Chained onto so a new request to a given worker waits for that
    // worker's previous request to actually resolve/reject before sending -
    // see processChunk()'s comment for why this matters.
    private queues: Promise<void>[];
    // Round-robins across every call to processChunk(), not just within one
    // processPages() call - see processChunk()'s comment.
    private nextWorker = 0;

    // Deliberately NOT navigator.hardwareConcurrency (the previous default,
    // and the usual choice for CPU-bound parallel work) - confirmed via
    // real profiling on issue #154 that a worker's own memory footprint
    // grows with how many pages it's ever rasterized over its lifetime
    // (likely image-js's own internal decode/encode buffers, or a WASM
    // codec's linear memory, neither ever released mid-lifetime regardless
    // of what this plugin does on the JS side), and that the resulting peak
    // during a fast scroll scales with how many workers can be
    // simultaneously mid-growth at once - so *fewer* concurrent workers
    // directly caps it. A small fixed number, not tied to core count, is
    // deliberate: more cores would otherwise mean a *higher* ceiling on a
    // more capable device, backwards from what actually matters here. (A
    // per-worker call-count recycling scheme was also tried as a
    // complementary fix, but disabling it made no measurable difference to
    // real-device heap usage, so it was removed rather than kept as
    // unjustified complexity - see getSharedWorkerPool()'s idle teardown
    // for what actually addresses the resting-footprint side of this.)
    // Trade-off: bulk operations that rasterize every page at once (a full
    // PDF/markdown-with-images export) get less parallelism and take
    // longer - acceptable, since those are rare, deliberate, one-off
    // actions, unlike lazy per-page loading during routine scrolling,
    // which is both the common case and the one that actually needs to be
    // memory-safe on a constrained device.
    private static readonly DEFAULT_MAX_WORKERS = 2;

    constructor(private maxWorkers: number = WorkerPool.DEFAULT_MAX_WORKERS) {
        this.workers = Array(maxWorkers).fill(null).map(() =>
            new Worker()
        );
        this.queues = this.workers.map(() => Promise.resolve());
    }

    // Picks the next worker (round-robin across every call this pool ever
    // makes, not reset per processPages() call - see below) and queues onto
    // it rather than sending immediately.
    //
    // This used to just take a worker directly, relying on callers to keep
    // at most one in-flight request per worker (safe when processPages() was
    // the only caller: a single call's chunks always spread 1:1 across
    // distinct workers). Lazy per-page image loading (SupernoteView's
    // ensurePageImage(), see issue #147) broke that assumption - each is its
    // own separate processPages() call for a single page, which
    // chunkPageNumbers() always turns into exactly one chunk, previously
    // always dispatched to workers[0] (chunks.map's index is always 0 for a
    // one-chunk call). Several pages loading nearly at once (a fast scroll,
    // or the thumbnail sidebar loading every page at once) meant several
    // concurrent requests all landing on worker 0, each overwriting the
    // last's onmessage handler before its response arrived - silently
    // losing that page's result (rendered blank) or misdirecting it to
    // resolve a *different* page's promise instead (wrong image on the
    // wrong page). Queuing per-worker (so a worker only ever has one
    // request in flight) and round-robining across every call (so
    // concurrent single-page requests still spread across every worker,
    // instead of piling onto worker 0) fixes both.
    private processChunk(
        note: VectorInkRenderNote,
        pageNumbers: number[],
        scale?: number,
        vectorInkPages?: VectorInkPage[],
        backgroundOnly?: boolean[],
        rasterOverlayNote?: VectorInkRenderNote,
        rasterOverlayPageNumbers?: ReadonlySet<number>,
    ): Promise<RasterizedPageImage[]> {
        const workerIndex = this.nextWorker % this.workers.length;
        this.nextWorker++;
        const worker = this.workers[workerIndex];

        // Sliced *before* ever constructing the message - see
        // extractPagesRenderData()'s comment for why sending the whole
        // `note` here was a real, serious memory bug (issue #154).
        const renderableNote = extractPagesRenderData(note, pageNumbers);
        const overlayPageIndexes = rasterOverlayNote && rasterOverlayPageNumbers
            ? pageNumbers.flatMap((pageNumber, index) => rasterOverlayPageNumbers.has(pageNumber) ? [index] : [])
            : [];
        const rasterOverlay = rasterOverlayNote && overlayPageIndexes.length > 0
            ? {
                note: extractPagesRenderData(
                    rasterOverlayNote,
                    overlayPageIndexes.map((index) => pageNumbers[index]),
                ),
                pageIndexes: overlayPageIndexes,
            }
            : undefined;

        const send = (): Promise<RasterizedPageImage[]> => new Promise((resolve, reject) => {
            worker.onmessage = (e: MessageEvent<RasterizeWorkerResponse>) => {
                const response = e.data;
                if (response.type === 'error') {
                    reject(new Error(response.error));
                } else if (response.type === 'result') {
                    resolve(response.images.map((imageDataUrl, i) => ({
                        imageDataUrl,
                        rasterOverlayDataUrl: response.rasterOverlays?.[i],
                    })));
                }
            };

            worker.onerror = (error) => {
                console.error('Worker error:', error);
                reject(new Error(error.message));
            };

            const message: RasterizeWorkerMessage = {
                type: 'convert',
                note: renderableNote,
                scale,
                vectorInk: vectorInkPages,
                backgroundOnly,
                rasterOverlay,
            };

            worker.postMessage(message);
        });

        const result = this.queues[workerIndex].then(send);
        // Marks this worker free again once this request settles, regardless
        // of outcome - a failed request shouldn't leave the next one waiting
        // forever. Deliberately swallows the rejection here: `result` (what
        // this call actually returns) still carries it to its own caller.
        this.queues[workerIndex] = result.then(() => undefined, () => undefined);
        return result;
    }

    // `backgroundOnly`, when present, is a parallel array aligned by index
    // with allPageNumbers. Vector-ink callers pass a background note already
    // split by the public upstream API; legacy callers without vector data
    // retain the worker's historical all-bitmap-layer strip.
    async processPages(
        note: VectorInkRenderNote,
        allPageNumbers: number[],
        scale?: number,
        vectorInkPages?: VectorInkPage[],
        backgroundOnly?: boolean[],
        rasterOverlayNote?: VectorInkRenderNote,
        rasterOverlayPageNumbers?: ReadonlySet<number>,
    ): Promise<RasterizedPageImage[]> {
        //console.time('Total processing time');

        const chunks = chunkPageNumbers(allPageNumbers);

        //console.log(`Processing ${allPageNumbers.length} pages in ${chunks.length} chunks`);

        // Process chunks concurrently - safe now regardless of how many land
        // on the same worker, or how many separate processPages() calls are
        // in flight at once (see processChunk()'s comment). vectorInkPages
        // and backgroundOnly, when present, are aligned by index with
        // allPageNumbers, so slice each the same way each chunk slices the
        // page numbers. The overlay note is separately sliced to just its
        // bitmap-only pages and carries their local chunk indexes.
        let offset = 0;
        const results = await Promise.all(
            chunks.map((chunk) => {
                const start = offset;
                offset += chunk.length;
                const vip = vectorInkPages?.slice(start, start + chunk.length);
                const bg = backgroundOnly?.slice(start, start + chunk.length);
                return this.processChunk(
                    note,
                    chunk,
                    scale,
                    vip,
                    bg,
                    rasterOverlayNote,
                    rasterOverlayPageNumbers,
                );
            })
        );

        //console.timeEnd('Total processing time');
        return results.flat();
    }

    terminate() {
        this.workers.forEach(worker => worker.terminate());
        this.workers = [];
    }
}

// Shared for the plugin's lifetime instead of every ImageConverter owning
// (and tearing down) its own WorkerPool. Spinning up new Web Workers is
// real, fixed-cost work — previously paid on *every single* rasterization
// call regardless of outcome, so opening a note repeatedly paid full
// multi-worker startup/teardown cost every time. Created lazily (on first
// actual use) so plugin activation itself doesn't spin up workers before
// any note is opened; torn down once in SupernotePlugin.onunload().
let sharedWorkerPool: WorkerPool | undefined;

// Bounds the pool's *resting* footprint once the user has simply stopped
// interacting with a note - DEFAULT_MAX_WORKERS above only bounds memory
// *during* sustained scrolling (issue #154's original peak problem); left
// alone, the 2 pooled workers just sit there afterward, still holding
// whatever they'd accumulated. Tearing the whole pool down after a period of
// inactivity reclaims that, at the cost of a small worker re-init the next
// time it's needed. Confirmed via real-device testing: ~200MB reclaimed once
// this fires.
//
// Only scheduled once activeWorkerCalls (below) drops back to zero, and
// cancelled the moment a new call starts - so this can only ever fire
// between calls, never while a rasterization is actually in flight. That
// matters: WorkerPool.terminate() just calls Worker.terminate() outright,
// which abandons any pending onmessage with no error - if a call's own
// worker were torn out from under it mid-request, that call's promise would
// never resolve or reject, hanging its caller forever.
const WORKER_POOL_IDLE_TEARDOWN_MS = 2000;
let workerPoolIdleTimer: number | undefined;
let activeWorkerCalls = 0;

function getSharedWorkerPool(): WorkerPool {
    window.clearTimeout(workerPoolIdleTimer);
    if (!sharedWorkerPool) {
        sharedWorkerPool = new WorkerPool();
        console.debug('Supernote: worker pool created');
    }
    return sharedWorkerPool;
}
export function terminateSharedWorkerPool(): void {
    window.clearTimeout(workerPoolIdleTimer);
    workerPoolIdleTimer = undefined;
    sharedWorkerPool?.terminate();
    sharedWorkerPool = undefined;
}
// Called once a call into the shared pool settles (see ImageConverter.
// convertToImages()) - only actually schedules the teardown if nothing
// else is still in flight, since activeWorkerCalls is shared across every
// concurrent caller, not just this one.
function scheduleIdleTeardownIfIdle(): void {
    window.clearTimeout(workerPoolIdleTimer);
    if (activeWorkerCalls > 0) return;
    workerPoolIdleTimer = window.setTimeout(() => {
        console.debug(`Supernote: worker pool idle for ${WORKER_POOL_IDLE_TEARDOWN_MS}ms, tearing down`);
        terminateSharedWorkerPool();
    }, WORKER_POOL_IDLE_TEARDOWN_MS);
}

export interface RasterizedPageImage {
    imageDataUrl: string;
    // Present only when this page has bitmap-only text-box/Digest content
    // which must paint above vector ink.
    rasterOverlayDataUrl?: string;
}

function pageMayNeedRasterOverlay(note: SupernoteX, vectorInkPage: VectorInkPage): boolean {
    const disable = note.pages[vectorInkPage.pageNumber - 1]?.DISABLE;
    // buildRasterInkOverlayNote() treats malformed values as transparent, so
    // this inexpensive prefilter can conservatively send an unnecessary page
    // for malformed metadata without ever losing real overlay ink.
    return vectorInkPage.useVectorInk && disable !== undefined && disable !== '' && disable !== 'none';
}

export class ImageConverter {
    // `scale` (default 1, full resolution): a positive integer downsample
    // factor forwarded all the way to supernote-typescript's toImage(),
    // which decodes directly at the reduced resolution rather than
    // downscaling a full-resolution decode afterward - see
    // https://github.com/philips/supernote-typescript/issues/40. Meant for
    // SupernoteView's thumbnail sidebar (see ensureThumbnail()), which
    // otherwise paid the same decode/memory cost as actually viewing the
    // page just to fill in a ~140px preview.
    async convertToImages(note: SupernoteX, pageNumbers?: number[], scale?: number, vectorInk?: boolean): Promise<string[]> {
        const pages = pageNumbers ?? Array.from({length: note.pages.length}, (_, i) => i+1);
        activeWorkerCalls++;
        try {
            // Prepare vector ink on the main thread: the worker only
            // receives structured-clone-safe IRenderableNote slices, which
            // don't carry the TOTALPATH buffer or note.titles the
            // vector-ink decode reads. Only for full-res renders (no
            // downsample) — vector coordinates don't survive a downsample,
            // so thumbnails keep the raster path.
            const vectorInkPages = vectorInk && !scale ? prepareVectorInkPages(note, pages, 1) : undefined;
            const overlayPageNumbers = vectorInkPages
                ? new Set(vectorInkPages.filter((page) => pageMayNeedRasterOverlay(note, page)).map((page) => page.pageNumber))
                : undefined;
            const backgroundNote = vectorInkPages ? buildVectorInkBackgroundNote(note, vectorInkPages) : note;
            const rasterOverlayNote = overlayPageNumbers && overlayPageNumbers.size > 0
                ? buildRasterInkOverlayNote(note, vectorInkPages!)
                : undefined;
            const rendered = await getSharedWorkerPool().processPages(
                backgroundNote,
                pages,
                scale,
                vectorInkPages,
                undefined,
                rasterOverlayNote,
                overlayPageNumbers,
            );
            return rendered.map((page) => page.imageDataUrl);
        } finally {
            activeWorkerCalls--;
            scheduleIdleTeardownIfIdle();
        }
    }

    // Background-only raster retained for callers that need a bare page even
    // when it cannot be vectorized. The worker's no-vectorInk compatibility
    // path strips every bitmap ink layer as it did before write-on overlays.
    async convertToBackgroundImages(note: SupernoteX, pageNumbers?: number[]): Promise<string[]> {
        const pages = pageNumbers ?? Array.from({length: note.pages.length}, (_, i) => i+1);
        activeWorkerCalls++;
        try {
            const rendered = await getSharedWorkerPool().processPages(note, pages, undefined, undefined, pages.map(() => true));
            return rendered.map((page) => page.imageDataUrl);
        } finally {
            activeWorkerCalls--;
            scheduleIdleTeardownIfIdle();
        }
    }

    // The write-on equivalent of convertToImages(): returns the plain PNG
    // background below the animator's SVG plus an optional bitmap-only
    // text-box/Digest image that the component must place above that SVG.
    // Callers request only animatable pages, so every requested page has
    // vetted vector ink; keeping this separate avoids changing the legacy
    // convertToBackgroundImages() contract for other consumers.
    async convertToAnimationImages(note: SupernoteX, pageNumbers: number[]): Promise<RasterizedPageImage[]> {
        activeWorkerCalls++;
        try {
            const vectorInkPages = prepareVectorInkPages(note, pageNumbers, 1);
            const overlayPageNumbers = new Set(
                vectorInkPages.filter((page) => pageMayNeedRasterOverlay(note, page)).map((page) => page.pageNumber),
            );
            const backgroundNote = buildVectorInkBackgroundNote(note, vectorInkPages);
            const rasterOverlayNote = overlayPageNumbers.size > 0
                ? buildRasterInkOverlayNote(note, vectorInkPages)
                : undefined;
            return await getSharedWorkerPool().processPages(
                backgroundNote,
                pageNumbers,
                undefined,
                vectorInkPages,
                pageNumbers.map(() => true),
                rasterOverlayNote,
                overlayPageNumbers,
            );
        } finally {
            activeWorkerCalls--;
            scheduleIdleTeardownIfIdle();
        }
    }
}
