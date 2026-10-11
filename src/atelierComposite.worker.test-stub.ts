// Stand-in for the real src/atelierComposite.worker.ts, used only by
// vitest's `resolve.alias` for the bare `atelierComposite.worker` import
// specifier (see vitest.config.ts) - same role, same reasoning, as
// rasterize.worker.test-stub.ts. render/atelierWorkerClient.ts is never
// exercised directly in SupernoteAtelierViewerElement.test.ts - that file
// overrides the element's own openSpd/compositeSurfaces hooks instead (the
// `.spd` equivalent of overriding rasterizePage), so this default export is
// never actually called; it only needs to exist so the static
// `import Worker from 'atelierComposite.worker'` in atelierWorkerClient.ts
// resolves to *something* when that module is loaded at all.
export default class NoopTestWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage(): void { /* never called in tests - see file header */ }
    terminate(): void { /* never called in tests - see file header */ }
}
