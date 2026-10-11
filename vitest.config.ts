import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // Mirrors tsconfig.json's paths / esbuild.config.mjs's alias: the
            // submodule isn't an npm dependency (see CLAUDE.md), so point
            // straight at its compiled output rather than a node_modules
            // symlink.
            'supernote-typescript': path.resolve(__dirname, 'supernote-typescript/lib'),
            // tsc/esbuild both resolve this bare specifier via tsconfig.json's
            // baseUrl straight to the real src/rasterize.worker.ts - Vite
            // (which vitest uses) doesn't read baseUrl, and the real file
            // assumes an actual Worker global scope anyway (see
            // rasterize.worker.test-stub.ts).
            'rasterize.worker': path.resolve(__dirname, 'src/rasterize.worker.test-stub.ts'),
            // Same reasoning as rasterize.worker above, for
            // atelierWorkerClient.ts's identical bare-specifier `import
            // Worker from 'atelierComposite.worker'` - see
            // atelierComposite.worker.test-stub.ts's own comment for why
            // this one's never actually exercised in tests either.
            'atelierComposite.worker': path.resolve(__dirname, 'src/atelierComposite.worker.test-stub.ts'),
            // esbuild's `binary` loader turns this into a Uint8Array at
            // bundle time (see esbuild.config.mjs); Vite/vitest has no
            // equivalent for a bare `.wasm` import and fails outright (see
            // sql-wasm.test-stub.ts's own comment) - alias it to a stub that
            // reads the same real file via Node's fs instead.
            'sql.js/dist/sql-wasm.wasm': path.resolve(__dirname, 'src/sql-wasm.test-stub.ts'),
        },
    },
    test: {
        // supernote-typescript is a git submodule with its own vitest setup;
        // scope discovery to this project's own src/ so `npm test` here
        // doesn't also try to run (or conflict with) the submodule's tests.
        include: ['src/**/*.test.ts'],
    },
});
