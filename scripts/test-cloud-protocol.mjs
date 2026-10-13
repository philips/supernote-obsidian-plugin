#!/usr/bin/env node

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporaryDirectory = await mkdtemp(`${tmpdir()}/supernote-cloud-protocol-`);
const outputFile = resolve(temporaryDirectory, 'test-cloud-protocol.mjs');

try {
    await build({
        entryPoints: [resolve('scripts/test-cloud-protocol.entry.ts')],
        outfile: outputFile,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node20',
        logLevel: 'warning',
    });
    await import(pathToFileURL(outputFile).href);
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}