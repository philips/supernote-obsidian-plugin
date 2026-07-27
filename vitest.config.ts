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
        },
    },
    test: {
        // supernote-typescript is a git submodule with its own vitest setup;
        // scope discovery to this project's own src/ so `npm test` here
        // doesn't also try to run (or conflict with) the submodule's tests.
        include: ['src/**/*.test.ts'],
    },
});
