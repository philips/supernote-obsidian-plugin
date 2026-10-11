// esbuild-plugin-inline-worker transforms every one of these imports the
// same way at build time (into a factory function returning a real Worker),
// a shape the source .worker.ts files themselves don't literally export -
// these ambient declarations are what actually type the import for each,
// taking priority over tsconfig.json's baseUrl-based resolution to the real
// file. TypeScript's wildcard module patterns (e.g. `declare module
// '*.worker'`) don't match these bare (no-slash) specifiers, so each needs
// its own explicit declaration rather than one shared pattern.
declare module 'rasterize.worker' {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}
declare module 'pdfBuild.worker' {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}
declare module 'atelierComposite.worker' {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}