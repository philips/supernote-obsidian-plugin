#!/usr/bin/env node
// Builds and runs the real plugin sync modules in Node against a Browse &
// Access server. This is intentionally opt-in: it uploads a fixture to the
// configured test directory and leaves it there (the device API exposes no
// documented delete endpoint). Use a dedicated device directory only.

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporaryDirectory = await mkdtemp(`${tmpdir()}/supernote-device-sync-`);
const outputFile = resolve(temporaryDirectory, 'test-device-sync.mjs');

try {
    await build({
        entryPoints: [resolve('scripts/test-device-sync.entry.ts')],
        outfile: outputFile,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node22',
        alias: {
            // The test exercises plugin source in Node, so only its Obsidian
            // boundary is replaced with the minimal requestUrl/Vault shim.
            obsidian: resolve('scripts/obsidian-device-test-stub.ts'),
            'supernote-typescript': resolve('supernote-typescript'),
        },
        logLevel: 'warning',
    });
    await import(pathToFileURL(outputFile).href);
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
