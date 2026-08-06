// @vitest-environment happy-dom
//
// Exercises <supernote-atelier-viewer> against a real DOM (happy-dom) with
// no Obsidian involved at all - same testability goal as
// SupernoteViewerElement.test.ts. Real compositing is CPU work (image-js)
// with no Worker-specific API surface of its own, but the element now
// dispatches it to a real Web Worker in production (see openSpd/
// compositeSurfaces' own doc comment on the element) - happy-dom doesn't
// implement Workers, so every test here overrides those two hooks to call
// render/atelierRenderer.ts's real functions directly instead, the same
// "fake just the part the test environment can't run" pattern
// SupernoteViewerElement.test.ts's own createViewer() uses for
// rasterizePage. Real fixtures throughout (the same sample.spd supernote-
// typescript's own atelier.test.ts uses), backed by the real sql.js wasm
// binary via sql-wasm.test-stub.ts (see vitest.config.ts's own alias and
// that stub's header comment for why a bare `.wasm` import needs one under
// vitest at all).
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { atelierLayerOptions, compositeImage, openAtelierBuffer } from '../render/atelierRenderer';
// Also registers the HTMLElementTagNameMap augmentation, so
// document.createElement('supernote-atelier-viewer') below is properly
// typed with no cast needed.
import './SupernoteAtelierViewerElement';

const FIXTURES_DIR = path.join(import.meta.dirname, '..', '..', 'supernote-typescript', 'tests', 'input');

// sample.spd's own known shape (see supernote-typescript/tests/atelier.test
// .ts): 4 layers - "Layer 3" (id 3, surface_3, no tiles at all), "Layer 2"
// (surface_2, has tiles), "Layer 1" (surface_1, has tiles), and a
// background "Reference Layer" (id 9999, surface_9999, covers every tile -
// this is what makes the shared composite 1536x2048).
function readFixture(name: string): Uint8Array {
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, name));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// Builds a viewer with openSpd/compositeSurfaces overridden to run
// render/atelierRenderer.ts's real functions directly on the main thread -
// see this file's own header comment for why. Mirrors the shape of a real
// AtelierWorkerClient session: `open` parses once and the parsed instance
// stays alive (in this closure, not a Worker) for every later `composite`
// call, same as atelierComposite.worker.ts's own module-level `spd`.
function createAtelierViewer() {
    const el = document.createElement('supernote-atelier-viewer');
    let spd: Awaited<ReturnType<typeof openAtelierBuffer>> | null = null;
    el.openSpd = async (buffer) => {
        spd = await openAtelierBuffer(buffer);
        return atelierLayerOptions(spd);
    };
    el.compositeSurfaces = async (visibleSurfaces) => {
        if (!spd) throw new Error('compositeSurfaces called before openSpd resolved');
        return compositeImage(spd, visibleSurfaces);
    };
    return el;
}

function waitForEvent<T>(target: EventTarget, type: string): Promise<CustomEvent<T>> {
    return new Promise((resolve) => {
        target.addEventListener(type, (e) => resolve(e as CustomEvent<T>), { once: true });
    });
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('<supernote-atelier-viewer>', () => {
    it('shows an informational status when no source is set', async () => {
        const el = createAtelierViewer();
        document.body.appendChild(el);
        await Promise.resolve();

        const status = el.shadowRoot!.querySelector('.status');
        expect(status?.textContent).toMatch(/no supernote atelier file loaded/i);
        expect(status?.classList.contains('error')).toBe(false);
    });

    it('parses a .spd file set via noteData and shows the composite image', async () => {
        const el = createAtelierViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent<{ width: number; height: number; layerCount: number }>(el, 'supernote-atelier-load');
        el.noteData = readFixture('sample.spd');

        const evt = await loaded;
        expect(evt.detail.width).toBe(1536);
        expect(evt.detail.height).toBe(2048);
        expect(evt.detail.layerCount).toBe(4);

        const img = el.shadowRoot!.querySelector('.atelier-image') as HTMLImageElement;
        expect(img.src).toMatch(/^data:image\/png;base64,/);
        expect(img.style.display).not.toBe('none');
        // The "Loading…" status shown while the parse/composite was in
        // flight must actually be gone once real content replaces it - not
        // just hidden - since buildViewer() wipes rootEl.innerHTML (and the
        // statusEl reference along with it) before building the real
        // toolbar/image/sidebar.
        expect(el.shadowRoot!.querySelector('.status')).toBeNull();
    }, 30000);

    it('builds a layer-toggle button and one sidebar row per layer, every checkbox starting checked', async () => {
        const el = createAtelierViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-atelier-load');
        el.noteData = readFixture('sample.spd');
        await loaded;

        const toggleBtn = el.shadowRoot!.querySelector('button[aria-label="Toggle layers"]');
        expect(toggleBtn).toBeTruthy();

        const rows = el.shadowRoot!.querySelectorAll('.layer-sidebar .sidebar-list-item');
        expect(rows).toHaveLength(4);
        rows.forEach((row) => {
            const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
            expect(checkbox.checked).toBe(true);
        });

        // Sidebar starts closed - the toggle button opens it.
        expect(el.shadowRoot!.querySelector('.layer-sidebar')?.classList.contains('open')).toBe(false);
        (toggleBtn as HTMLButtonElement).click();
        expect(el.shadowRoot!.querySelector('.layer-sidebar')?.classList.contains('open')).toBe(true);
    }, 30000);

    it('unchecking a non-empty layer re-composites and changes the displayed image', async () => {
        const el = createAtelierViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-atelier-load');
        el.noteData = readFixture('sample.spd');
        await loaded;

        const img = el.shadowRoot!.querySelector('.atelier-image') as HTMLImageElement;
        const initialSrc = img.src;

        // Row 0 is "Layer 3", which has no tiles at all - toggling it can
        // never visibly change the composite (see this file's own fixture
        // comment), so this targets row 1 ("Layer 2", which does have real
        // tiles) to actually exercise a real re-composite.
        const checkboxes = el.shadowRoot!.querySelectorAll('.layer-sidebar .sidebar-list-item input[type="checkbox"]');
        const layer2Checkbox = checkboxes[1] as HTMLInputElement;
        layer2Checkbox.checked = false;
        layer2Checkbox.dispatchEvent(new Event('change'));

        await vi.waitFor(() => {
            expect(img.src).not.toBe(initialSrc);
        }, { timeout: 10000 });
    }, 30000);

    it('reports a fatal (non-recomposite) error for bytes that are not a valid .spd file', async () => {
        const el = createAtelierViewer();
        document.body.appendChild(el);
        const errored = waitForEvent<{ error: unknown; recomposite?: boolean }>(el, 'supernote-atelier-error');
        el.noteData = new Uint8Array([1, 2, 3, 4]);

        const evt = await errored;
        expect(evt.detail.recomposite).toBeUndefined();
        expect(el.shadowRoot!.querySelector('.status.error')).toBeTruthy();
    }, 30000);

    it('applies the dark tri-state attribute the same override-not-OR way as <supernote-viewer>', async () => {
        const el = createAtelierViewer();
        el.setAttribute('dark', 'false');
        document.body.appendChild(el);
        await Promise.resolve();
        // Purely a CSS attribute selector - just confirms the attribute
        // round-trips onto the host element for :host([dark="false"]) to
        // match against, same as SupernoteViewerElement's identical
        // contract.
        expect(el.getAttribute('dark')).toBe('false');
    });
});
