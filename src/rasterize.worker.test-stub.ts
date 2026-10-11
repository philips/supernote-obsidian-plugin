// Stand-in for the real src/rasterize.worker.ts, used only by vitest's
// `resolve.alias` for the bare `rasterize.worker` import specifier (see
// vitest.config.ts). Production builds (tsc, esbuild) resolve that same
// specifier via tsconfig.json's baseUrl straight to the real file - this
// stub only exists because the real one assumes it's executing inside an
// actual Worker global scope (`self.onmessage` et al. at module scope),
// which isn't true when a test merely imports src/render/imageConverter.ts
// for its ImageConverter/WorkerPool exports. No test in this project
// actually constructs a Worker (they override SupernoteViewerElement's
// rasterizePage, or don't touch rasterization at all), so this default
// export is never called.
export default class NoopTestWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage(): void { /* never called in tests - see file header */ }
    terminate(): void { /* never called in tests - see file header */ }
}
