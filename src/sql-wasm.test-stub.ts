// Stand-in for the real `sql.js/dist/sql-wasm.wasm` binary import, used only
// by vitest's `resolve.alias` for that exact specifier (see
// vitest.config.ts) - the same "alias a bare import to a test-friendly
// stand-in" pattern rasterize.worker.test-stub.ts already uses for the
// unrelated Worker problem. Production builds (esbuild) resolve `.wasm`
// imports via the `binary` loader (see esbuild.config.mjs's own comment),
// decoding the file straight into a Uint8Array at bundle time - Vite/vitest
// has no equivalent for a bare (no `?init`/`?url` suffix) `.wasm` import,
// and fails outright with "Unknown file extension .wasm" (confirmed by
// testing directly) rather than silently doing something usably different.
// This stub reads the exact same file straight off disk via Node's `fs`
// instead, giving tests the real wasm bytes SupernoteAtelier.open() needs
// (see render/atelierRenderer.ts's openAtelierBuffer()) without needing a
// real wasm-loading Vite plugin just for tests. Locates the file by a plain
// relative path from this one (node_modules/sql.js/...), the same
// import.meta.dirname-relative approach SupernoteViewerElement.test.ts's
// own FIXTURES_DIR already uses, rather than require.resolve() - simpler,
// and sidesteps needing @types/node's "module" package typings (which,
// unlike "fs"/"path", didn't resolve cleanly under this project's
// moduleResolution: "bundler" setting).
import * as fs from 'fs';
import * as path from 'path';

const wasmPath = path.join(import.meta.dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const buf = fs.readFileSync(wasmPath);

export default new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
