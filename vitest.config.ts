import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // supernote-typescript is a git submodule with its own vitest setup;
        // scope discovery to this project's own src/ so `npm test` here
        // doesn't also try to run (or conflict with) the submodule's tests.
        include: ['src/**/*.test.ts'],
    },
});
