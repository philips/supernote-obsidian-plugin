#!/usr/bin/env node
// Browser smoke test for the standalone <supernote-viewer>. It serves the
// repository itself, loads a real note fixture, and verifies the paused
// write-on presentation can start playing without the expensive SVG masks.
//
// One-time browser setup:
//   npx playwright install chromium
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mimeTypes = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.note': 'application/octet-stream',
};

function startServer() {
    const server = createServer(async (request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        const relativePath = pathname === '/'
            ? 'demo/index.html'
            : pathname.endsWith('/')
                ? `${pathname.replace(/^\/+/, '')}index.html`
                : pathname.replace(/^\/+/, '');
        const file = normalize(join(projectRoot, relativePath));
        if (!file.startsWith(`${projectRoot}/`)) {
            response.writeHead(403).end();
            return;
        }
        try {
            const body = await readFile(file);
            response.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream' }).end(body);
        } catch {
            response.writeHead(404).end();
        }
    });
    return new Promise((resolveServer) => {
        server.listen(0, '127.0.0.1', () => resolveServer(server));
    });
}

const server = await startServer();
const address = server.address();
assert(address && typeof address !== 'string');
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto(`http://127.0.0.1:${address.port}/demo/`, { waitUntil: 'networkidle' });
    // The demo itself loads rtr.note; wait for that default sample rather
    // than injecting a fixture through the file picker.
    await page.waitForFunction(() => {
        const viewer = document.querySelector('supernote-viewer');
        return !!viewer?.shadowRoot?.querySelector('.page-container > img[src]')
            && document.querySelector('#status')?.textContent?.startsWith('Loaded');
    });
    await page.locator('supernote-viewer').evaluate((element) => {
        element.setAttribute('dark', '');
        element.setAttribute('invert-dark', '');
        element.presentation = 'write-on-paused';
    });
    await page.waitForFunction(() => document.querySelector('supernote-viewer')?.shadowRoot?.querySelector('.anim-controls.active'));

    const initial = await page.locator('supernote-viewer').evaluate((element) => {
        const root = element.shadowRoot;
        if (!root) throw new Error('Viewer has no shadow root');
        const background = root.querySelector('.page-container > img');
        const overlay = root.querySelector('.page-container > .stroke-animation-svg');
        if (!(background instanceof HTMLImageElement) || !(overlay instanceof SVGSVGElement)) {
            throw new Error('Write-on page layers missing');
        }
        return {
            masks: root.querySelectorAll('mask').length,
            previews: root.querySelectorAll('svg path[pathLength="1"]').length,
            hiddenFinals: [...root.querySelectorAll('svg path[fill^="rgb"]')].filter((path) => path.style.display === 'none').length,
            hasPlay: !!root.querySelector('button[aria-label="Play write-on animation"]'),
            backgroundFilter: getComputedStyle(background).filter,
            overlayFilter: getComputedStyle(overlay).filter,
        };
    });
    assert.equal(initial.masks, 0, 'write-on playback must not use SVG masks');
    assert(initial.previews > 0, 'expected dashed centerline previews');
    assert(initial.hiddenFinals > 0, 'contours should be hidden before playback');
    assert(initial.hasPlay, 'paused presentation should expose Play');
    assert.equal(initial.backgroundFilter, 'invert(1)', 'dark mode should invert the write-on background');
    assert.equal(initial.overlayFilter, initial.backgroundFilter, 'dark mode must invert the SVG ink with its background');

    await page.locator('supernote-viewer').evaluate((element) => {
        const button = element.shadowRoot?.querySelector('button[aria-label="Play write-on animation"]');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Play button missing');
        button.click();
    });
    await page.waitForFunction(() => {
        const root = document.querySelector('supernote-viewer')?.shadowRoot;
        return [...(root?.querySelectorAll('svg path[fill^="rgb"]') ?? [])].some((path) => path.style.display !== 'none');
    });
    assert.equal(pageErrors.length, 0, pageErrors.map(String).join('\n'));
    console.log(`Web-component Playwright smoke test passed (${initial.previews} centerline previews).`);
} finally {
    await browser?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
}
