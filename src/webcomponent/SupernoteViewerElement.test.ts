// @vitest-environment happy-dom
//
// Exercises <supernote-viewer> against a real DOM (happy-dom) with no
// Obsidian involved at all - exactly the testability upside issue #183
// calls out. `rasterizePage` is swapped for a fake in every test: the real
// implementation dispatches to a Web Worker (see imageConverter.ts), which
// happy-dom doesn't implement, so a real note is parsed (via supernote-
// typescript, straight off disk - the same fixtures supernote-typescript's
// own tests and linkOverlay.test.ts use) but never actually rasterized.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// Also registers the HTMLElementTagNameMap augmentation, so
// document.createElement('supernote-viewer') below is properly typed with
// no cast needed.
import './SupernoteViewerElement';

const FIXTURES_DIR = path.join(import.meta.dirname, '..', '..', 'supernote-typescript', 'tests', 'input');

function readFixture(name: string): ArrayBuffer {
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, name));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function waitForEvent<T>(target: EventTarget, type: string): Promise<CustomEvent<T>> {
    return new Promise((resolve) => {
        target.addEventListener(type, (e) => resolve(e as CustomEvent<T>), { once: true });
    });
}

function createViewer() {
    const el = document.createElement('supernote-viewer');
    // Fake rasterizer: real page rasterization needs a Web Worker, which
    // happy-dom doesn't implement - see this file's header comment.
    el.rasterizePage = vi.fn(async (_sn, pageNumber: number) => `data:image/png;base64,page${pageNumber}`);
    return el;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('<supernote-viewer>', () => {
    it('shows an informational status when no source is set', async () => {
        const el = createViewer();
        document.body.appendChild(el);
        await Promise.resolve();

        const status = el.shadowRoot!.querySelector('.status');
        expect(status?.textContent).toMatch(/no supernote file loaded/i);
        expect(status?.classList.contains('error')).toBe(false);
    });

    it('parses a note set via noteData and builds one placeholder per page', async () => {
        const el = createViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent<{ pageCount: number }>(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-blank-2p.note');

        const evt = await loaded;
        expect(evt.detail.pageCount).toBe(2);

        const pages = el.shadowRoot!.querySelectorAll('.page-container');
        expect(pages).toHaveLength(2);
        // The "Loading…" status shown while the fetch/parse was in flight
        // must be gone once real content replaces it - it previously stuck
        // around forever as a permanent header alongside the real content.
        expect(el.shadowRoot!.querySelector('.status')).toBeNull();
        // Lazily loaded: nothing observed by IntersectionObserver in this
        // environment (happy-dom never fires it - no real layout engine),
        // so no page should have been rasterized just from building the
        // viewer.
        expect(el.rasterizePage).not.toHaveBeenCalled();

        const toolbar = el.shadowRoot!.querySelector('.toolbar');
        expect(toolbar).toBeTruthy();
        // Not asserting the indicator's exact text here - see the dedicated
        // test below for that. happy-dom has no real layout engine (every
        // element's getBoundingClientRect() is a zero rect by default - see
        // updateCurrentPageIndicator()), so the indicator's real value at
        // this exact point depends on stubbed geometry, not anything this
        // test sets up.
    });

    it('recomputes the current page from real geometry on scroll, not a batch of observer entries', async () => {
        // The page indicator used to be driven by an IntersectionObserver,
        // which caused two related but distinct bugs on real, many-page
        // notes (confirmed via real user testing on a 102-page note):
        //   - the observer's very first callback isn't guaranteed to
        //     reflect settled layout, so it could report an arbitrary page
        //     (not page 1) as the initial current page.
        //   - scrolling *quickly* could report the very last page
        //     mid-scroll, since a fast scroll can cross several pages'
        //     intersection thresholds within the same batched callback, and
        //     "the last entry in that batch" has no guaranteed relationship
        //     to "the page actually on screen".
        // Fixed by switching to a scroll listener that recomputes from real
        // getBoundingClientRect() geometry every time (see
        // updateCurrentPageIndicator()) - which forces a fresh, synchronous
        // layout read, so there's no batching/staleness to race against.
        // happy-dom has no real layout engine, so this stubs each page's
        // geometry directly to exercise that same threshold-scanning logic
        // deterministically instead.
        const el = createViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-blank-2p.note'); // 2 pages
        await loaded;

        const pagesEl = el.shadowRoot!.querySelector('.pages')!;
        const [page1, page2] = Array.from(el.shadowRoot!.querySelectorAll('.page-container'));
        vi.spyOn(pagesEl, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);

        // Page 1 sitting right at the top, page 2 not yet scrolled into view.
        vi.spyOn(page1, 'getBoundingClientRect').mockReturnValue({ top: -5 } as DOMRect);
        vi.spyOn(page2, 'getBoundingClientRect').mockReturnValue({ top: 895 } as DOMRect);
        pagesEl.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        expect(el.shadowRoot!.querySelector('.page-indicator')?.textContent).toBe('1 / 2');

        // Now page 2 is the one at the top instead (a real fast scroll
        // jumping straight past page 1, not an intermediate observer batch).
        vi.spyOn(page1, 'getBoundingClientRect').mockReturnValue({ top: -905 } as DOMRect);
        vi.spyOn(page2, 'getBoundingClientRect').mockReturnValue({ top: -5 } as DOMRect);
        pagesEl.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        expect(el.shadowRoot!.querySelector('.page-indicator')?.textContent).toBe('2 / 2');
    });

    it('goToPage() forces that page to load immediately, once, idempotently', async () => {
        const el = createViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
        await loaded;

        el.goToPage(2);
        // ensurePageImageLoaded() is async - let its microtasks settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(el.rasterizePage).toHaveBeenCalledTimes(1);
        expect(el.rasterizePage).toHaveBeenCalledWith(expect.anything(), 2);

        const page2Img = el.shadowRoot!.querySelectorAll('.page-container')[1].querySelector('img');
        expect(page2Img?.src).toBe('data:image/png;base64,page2');
        // The placeholder's inline sizing overrides (see
        // buildNotePagePlaceholders()) should be cleared once real content
        // loads in.
        expect(page2Img?.style.width).toBe('');

        // Calling again shouldn't re-trigger a rasterization of an
        // already-loaded page.
        el.goToPage(2);
        await Promise.resolve();
        expect(el.rasterizePage).toHaveBeenCalledTimes(1);
    });

    it('goToPage() scrolls only its own .pages, never scrollIntoView()', async () => {
        // scrollIntoView() cascades up through *every* scrollable ancestor,
        // not just this component's own .pages - a real, reported bug when
        // embedded inside another scrollable page (Obsidian's own note
        // editor, for SupernoteEmbed): clicking a page-nav button also
        // scrolled the *host* page, dragging the toolbar (and the button
        // just clicked) off screen along with it. goToPage() must only ever
        // call .pages.scrollTo(), which - unlike scrollIntoView() - never
        // touches anything outside the element it's called on.
        const el = createViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
        await loaded;

        const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
        const scrollToSpy = vi.spyOn(pagesEl, 'scrollTo');
        const scrollIntoViewSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');

        el.goToPage(2);

        expect(scrollToSpy).toHaveBeenCalledTimes(1);
        expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    });

    it('shows recognized text in text mode, unrasterized', async () => {
        const el = createViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('rtr.note');
        await loaded;

        const textEl = el.shadowRoot!.querySelector('.page-text');
        expect(textEl?.textContent).toContain('Real');
        expect(textEl?.classList.contains('empty')).toBe(false);
        // Single-page note - #183's example content never needed a
        // rasterized image to expose its recognized text.
        expect(el.rasterizePage).not.toHaveBeenCalled();
    });

    it('single-page mode renders only the requested page, eagerly, with no toolbar', async () => {
        const el = createViewer();
        el.setAttribute('single-page', '');
        el.setAttribute('page', '2');
        document.body.appendChild(el);
        const loaded = waitForEvent<{ pageCount: number }>(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
        await loaded;
        // ensurePageImageLoaded() is fired eagerly (no goToPage()/observer
        // needed) - give its microtasks a moment to settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(el.shadowRoot!.querySelector('.toolbar')).toBeNull();

        const pages = el.shadowRoot!.querySelectorAll('.page-container');
        expect(pages).toHaveLength(1);
        expect(pages[0].getAttribute('data-page-number')).toBe('2');
        expect(el.rasterizePage).toHaveBeenCalledTimes(1);
        expect(el.rasterizePage).toHaveBeenCalledWith(expect.anything(), 2);
        expect(pages[0].querySelector('img')?.src).toBe('data:image/png;base64,page2');
    });

    it('single-page mode clamps an out-of-range page to the last page', async () => {
        const el = createViewer();
        el.setAttribute('single-page', '');
        el.setAttribute('page', '99');
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-blank-2p.note'); // 2 pages
        await loaded;

        expect(el.shadowRoot!.querySelector('.page-container')?.getAttribute('data-page-number')).toBe('2');
    });

    it('invert-dark tags page images with the invert class at build time', async () => {
        const el = createViewer();
        el.setAttribute('invert-dark', '');
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
        await loaded;

        const images = el.shadowRoot!.querySelectorAll('.page-container img');
        expect(images).toHaveLength(2);
        for (const img of images) {
            expect(img.classList.contains('supernote-invert-dark')).toBe(true);
        }
    });

    it('omits the invert class without invert-dark', async () => {
        const el = createViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
        await loaded;

        const img = el.shadowRoot!.querySelector('.page-container img');
        expect(img?.classList.contains('supernote-invert-dark')).toBe(false);
    });

    it('shows an error and dispatches supernote-error when the fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

        const el = createViewer();
        const errored = waitForEvent<{ error: unknown }>(el, 'supernote-error');
        el.setAttribute('src', 'https://example.invalid/missing.note');
        document.body.appendChild(el);

        const evt = await errored;
        expect(evt.detail.error).toBeInstanceOf(Error);

        const status = el.shadowRoot!.querySelector('.status');
        expect(status?.classList.contains('error')).toBe(true);
        expect(status?.textContent).toMatch(/failed to load/i);
    });
});
