#!/usr/bin/env node

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporaryDirectory = await mkdtemp(`${tmpdir()}/supernote-cloud-protocol-`);
const outputFile = resolve(temporaryDirectory, 'test-cloud-protocol.mjs');
const descriptorMode = ['descriptor', 'host-review', 'fixture-transfer'].includes(process.argv[2]);
if (process.argv.length > 3 || (process.argv[2] && !descriptorMode)) {
    throw new Error('Expected optional descriptor, host-review, or fixture-transfer mode');
}

try {
    await build({
        entryPoints: [resolve(descriptorMode ? 'scripts/test-cloud-descriptor.entry.ts' : 'scripts/test-cloud-protocol.entry.ts')],
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