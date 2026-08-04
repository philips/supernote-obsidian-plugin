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

    it('projects a light-DOM child slotted as toolbar-extra into the toolbar', async () => {
        // Lets a host add its own controls (e.g. SupernoteView's "export
        // current page as image" button in main.ts, which writes to an
        // Obsidian vault - nothing this portable component can do itself)
        // without needing an imperative "addToolbarButton()" API - see
        // buildToolbar()'s own comment on this slot for the full
        // rationale. Added *before* noteData is set, matching how a real
        // host builds it (append once, right after creating the element),
        // to confirm the slotted content survives the element's own
        // subsequent build/render rather than only working if added after.
        const el = createViewer();
        const btn = document.createElement('button');
        btn.slot = 'toolbar-extra';
        btn.textContent = 'Export';
        el.appendChild(btn);
        document.body.appendChild(el);

        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
        await loaded;

        const slot = el.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="toolbar-extra"]');
        expect(slot).toBeTruthy();
        expect(slot!.assignedElements()).toEqual([btn]);
    });

    describe('iconRenderer', () => {
        it('falls back to a baked-in SVG icon when unset', async () => {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note'); // 2 pages
            await loaded;

            const findBtn = el.shadowRoot!.querySelector('button[aria-label="Find in note"]')!;
            expect(findBtn.querySelector('svg')).toBeTruthy();
        });

        it('calls a host-supplied renderer with the icon\'s canonical (Lucide-matching) name and the button element, instead of using the fallback', async () => {
            // A host (e.g. SupernoteView/SupernoteEmbed in main.ts) wires
            // this to Obsidian's own setIcon() for exact visual
            // consistency with the rest of its UI - see iconRenderer's
            // own doc comment for why IconName's values already equal
            // Lucide's own icon names, so a real host needs no
            // translation table, just `(name, el) => setIcon(el, name)`.
            const el = createViewer();
            const calls: Array<{ name: string; el: HTMLElement }> = [];
            el.iconRenderer = (name, iconEl) => {
                calls.push({ name, el: iconEl });
                iconEl.textContent = `[${name}]`;
            };
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
            await loaded;

            const findBtn = el.shadowRoot!.querySelector('button[aria-label="Find in note"]')!;
            expect(findBtn.querySelector('svg')).toBeNull();
            expect(findBtn.textContent).toBe('[search]');
            expect(calls.some((c) => c.name === 'search' && c.el === findBtn)).toBe(true);
            expect(calls.some((c) => c.name === 'layout-list')).toBe(true);
            expect(calls.some((c) => c.name === 'zoom-in')).toBe(true);
            expect(calls.some((c) => c.name === 'zoom-out')).toBe(true);
            expect(calls.some((c) => c.name === 'rotate-ccw')).toBe(true);
            expect(calls.some((c) => c.name === 'stretch-horizontal')).toBe(true);
            expect(calls.some((c) => c.name === 'type')).toBe(true);
        });
    });

    it('includes each page\'s own PAGEID in the supernote-load event, for a host resolving a same-named link-click', async () => {
        // A host embedding this component (e.g. SupernoteEmbed in main.ts)
        // knows its own file's name, which this component deliberately
        // doesn't - pageIds is what lets it resolve a link whose text
        // happens to match that name without re-parsing the same note a
        // second time just to get this list back. See handleLinkClick()'s
        // own dispatch comment for the split.
        const el = createViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent<{ pageIds: string[] }>(el, 'supernote-load');
        el.noteData = readFixture('nomad-3.26.40-link-tag-3p.note');

        const evt = await loaded;
        expect(evt.detail.pageIds).toEqual([
            'P20240303144624294784hYDadze19JFd',
            'P20240303145300685218PTuXezQHAYAa',
            'P20260603095253336544uuby12WmGW3u',
        ]);
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
        expect(el.shadowRoot!.querySelector<HTMLInputElement>('.page-jump-input')?.value).toBe('1');
        expect(el.currentPage).toBe(1);

        // Now page 2 is the one at the top instead (a real fast scroll
        // jumping straight past page 1, not an intermediate observer batch).
        vi.spyOn(page1, 'getBoundingClientRect').mockReturnValue({ top: -905 } as DOMRect);
        vi.spyOn(page2, 'getBoundingClientRect').mockReturnValue({ top: -5 } as DOMRect);
        pagesEl.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        expect(el.shadowRoot!.querySelector<HTMLInputElement>('.page-jump-input')?.value).toBe('2');
        expect(el.currentPage).toBe(2);
    });

    it('currentPage is 0 before any note has loaded', () => {
        const el = createViewer();
        document.body.appendChild(el);
        expect(el.currentPage).toBe(0);
    });

    it('textProcessor transforms recognized text shown in text mode, but not word-overlay/find-in-note\'s own index', async () => {
        // See textProcessor's own doc comment: it only ever touches the
        // rawText/textEl copy built in wrapPageStates(), not the separate
        // word-overlay entries built from recognitionElements' own
        // per-word boxes - a host substituting text (e.g. SupernoteView's
        // custom-dictionary feature in main.ts) has no per-word
        // substitution data, so find-in-note keeps matching the
        // unprocessed OCR text even though recognized-text mode displays
        // the processed version.
        const el = createViewer();
        el.textProcessor = (text) => text.toUpperCase();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('rtr.note');
        await loaded;

        const textEl = el.shadowRoot!.querySelector('.page-text');
        expect(textEl?.textContent).toBe(textEl?.textContent?.toUpperCase());
        expect(textEl?.textContent?.length).toBeGreaterThan(0);
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

        const page2Container = el.shadowRoot!.querySelectorAll('.page-container')[1];
        const page2Img = page2Container.querySelector('img');
        expect(page2Img?.src).toBe('data:image/png;base64,page2');
        // fillNotePagePlaceholder()'s own inline sizing overrides (see
        // buildNotePagePlaceholders()) get cleared once real content loads
        // in, but ensurePageImageLoaded() immediately reapplies the
        // current zoom (see applyZoomToPages()) on top - so the img ends
        // up at width: 100% (of its own container, not the placeholder's
        // aspect-ratio trick), and the container itself carries an
        // explicit zoom-scaled pixel width, not the empty string either.
        expect(page2Img?.style.width).toBe('100%');
        expect((page2Container as HTMLElement).style.width).toMatch(/^\d+(\.\d+)?px$/);

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

    describe('page-jump textbox (issue #194)', () => {
        it('jumps to the typed page on Enter', async () => {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note'); // 2 pages
            await loaded;

            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.page-jump-input')!;
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            const scrollToSpy = vi.spyOn(pagesEl, 'scrollTo');

            // Enter itself only blurs the field (see its own keydown
            // handler comment for why) - real focus is needed first, or
            // that blur() call is a no-op and no 'blur' event ever fires.
            input.focus();
            input.value = '2';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

            expect(scrollToSpy).toHaveBeenCalledTimes(1);
            expect(el.rasterizePage).toHaveBeenCalledWith(expect.anything(), 2);
        });

        it('jumps to the typed page on blur, same as Enter', async () => {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
            await loaded;

            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.page-jump-input')!;
            input.value = '2';
            input.dispatchEvent(new Event('blur'));

            expect(el.rasterizePage).toHaveBeenCalledWith(expect.anything(), 2);
        });

        it('ignores a non-numeric value rather than jumping or throwing', async () => {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
            await loaded;

            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.page-jump-input')!;
            input.value = 'not a number';
            input.dispatchEvent(new Event('blur'));

            expect(el.rasterizePage).not.toHaveBeenCalled();
        });

        it('does not overwrite the input\'s value while the user is focused on it', async () => {
            // Mirrors SupernoteView's own identical guard (main.ts) - see
            // updateCurrentPageIndicator()'s own comment on why this
            // needs shadowRoot.activeElement, not document.activeElement.
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
            await loaded;

            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.page-jump-input')!;
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            const [, page2] = Array.from(el.shadowRoot!.querySelectorAll('.page-container'));

            input.focus();
            input.value = '2 (typing...)';

            vi.spyOn(pagesEl, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
            vi.spyOn(page2, 'getBoundingClientRect').mockReturnValue({ top: -5 } as DOMRect);
            pagesEl.dispatchEvent(new Event('scroll'));
            await new Promise((resolve) => window.requestAnimationFrame(resolve));

            expect(input.value).toBe('2 (typing...)');
        });
    });

    describe('thumbnail sidebar', () => {
        async function createLoadedViewer() {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note'); // pageWidth 1404, pageHeight 1872, 2 pages
            await loaded;
            return el;
        }

        it('builds one item per page, reserving the note\'s own aspect ratio, initially closed', async () => {
            const el = await createLoadedViewer();

            const toggleBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Toggle page thumbnails"]');
            expect(toggleBtn).toBeTruthy();
            expect(toggleBtn!.getAttribute('aria-pressed')).toBe('false');

            const sidebar = el.shadowRoot!.querySelector('.thumb-sidebar');
            expect(sidebar).toBeTruthy();
            expect(sidebar!.classList.contains('open')).toBe(false);

            const items = el.shadowRoot!.querySelectorAll('.sidebar-list-item');
            expect(items).toHaveLength(2);
            for (const item of Array.from(items)) {
                expect(item.querySelector<HTMLImageElement>('.sidebar-list-thumb')?.style.aspectRatio).toBe('1404 / 1872');
            }
        });

        it('tags thumbnail images for dark-mode inversion when invert-dark is set, same as main page images', async () => {
            // Confirmed as a real, reported bug (issue #192): only main page
            // images (buildNotePagePlaceholders() in noteRenderer.ts) got
            // the supernote-invert-dark class - thumbnails never did, so
            // they never inverted regardless of dark mode.
            const el = createViewer();
            el.setAttribute('invert-dark', '');
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
            await loaded;

            const thumbs = el.shadowRoot!.querySelectorAll<HTMLImageElement>('.sidebar-list-thumb');
            expect(thumbs).toHaveLength(2);
            for (const thumb of Array.from(thumbs)) {
                expect(thumb.classList.contains('supernote-invert-dark')).toBe(true);
            }
        });

        it('toggle button opens and closes the sidebar', async () => {
            const el = await createLoadedViewer();
            const toggleBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Toggle page thumbnails"]')!;
            const sidebar = el.shadowRoot!.querySelector('.thumb-sidebar')!;

            toggleBtn.click();
            expect(sidebar.classList.contains('open')).toBe(true);
            expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');

            toggleBtn.click();
            expect(sidebar.classList.contains('open')).toBe(false);
            expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
        });

        it('clicking a thumbnail navigates to that page', async () => {
            const el = await createLoadedViewer();
            const items = el.shadowRoot!.querySelectorAll<HTMLElement>('.sidebar-list-item');

            items[1].click();
            // ensurePageImageLoaded() (triggered by goToPage()) is async.
            await Promise.resolve();
            await Promise.resolve();

            expect(el.rasterizePage).toHaveBeenCalledWith(expect.anything(), 2);
        });

        it('highlights the thumbnail for whatever page is actually scrolled into view', async () => {
            // Mirrors the page-indicator test's own approach: happy-dom has
            // no real layout engine, so this stubs each page's geometry
            // directly to exercise updateCurrentPageIndicator()'s
            // threshold-scanning logic (which now also drives thumbnail
            // highlighting) deterministically.
            const el = await createLoadedViewer();
            const pagesEl = el.shadowRoot!.querySelector('.pages')!;
            const [page1, page2] = Array.from(el.shadowRoot!.querySelectorAll('.page-container'));
            const [thumb1, thumb2] = Array.from(el.shadowRoot!.querySelectorAll('.sidebar-list-item'));
            vi.spyOn(pagesEl, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);

            vi.spyOn(page1, 'getBoundingClientRect').mockReturnValue({ top: -5 } as DOMRect);
            vi.spyOn(page2, 'getBoundingClientRect').mockReturnValue({ top: 895 } as DOMRect);
            pagesEl.dispatchEvent(new Event('scroll'));
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            expect(thumb1.classList.contains('is-active')).toBe(true);
            expect(thumb2.classList.contains('is-active')).toBe(false);

            vi.spyOn(page1, 'getBoundingClientRect').mockReturnValue({ top: -905 } as DOMRect);
            vi.spyOn(page2, 'getBoundingClientRect').mockReturnValue({ top: -5 } as DOMRect);
            pagesEl.dispatchEvent(new Event('scroll'));
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            expect(thumb1.classList.contains('is-active')).toBe(false);
            expect(thumb2.classList.contains('is-active')).toBe(true);
        });

        it('opening the find bar repositions the sidebar without throwing', async () => {
            const el = await createLoadedViewer();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Toggle page thumbnails"]')!.click();
            const findBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!;
            expect(() => findBtn.click()).not.toThrow();
            expect(el.shadowRoot!.querySelector('.thumb-sidebar')).toBeTruthy();
        });

        it('has no toolbar/thumbnail sidebar for a single-page note', async () => {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('rtr.note'); // 1 page
            await loaded;

            expect(el.shadowRoot!.querySelector('button[aria-label="Toggle page thumbnails"]')).toBeNull();
            expect(el.shadowRoot!.querySelector('.thumb-sidebar')).toBeNull();
        });

        it('has no toolbar/thumbnail sidebar in single-page (attribute) mode', async () => {
            const el = createViewer();
            el.setAttribute('single-page', '');
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
            await loaded;

            expect(el.shadowRoot!.querySelector('button[aria-label="Toggle page thumbnails"]')).toBeNull();
            expect(el.shadowRoot!.querySelector('.thumb-sidebar')).toBeNull();
        });
    });

    describe('zoom', () => {
        async function createLoadedViewer() {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note'); // pageWidth 1404, 2 pages
            await loaded;
            return el;
        }

        it('zoom in/out/reset buttons scale every page and update the label', async () => {
            // happy-dom has no real layout engine (.pages' clientWidth
            // defaults to 0 - see applyFitWidth()'s own early-return
            // guard), so fit-width - on by default - never actually
            // *applies* a computed width here at load time (the initial
            // container width is still whatever noteRenderer.ts's own
            // placeholder set, e.g. "100%" of .pages). A reset click below
            // establishes a known, deterministic 100%/1404px baseline via
            // setZoom(1) instead, which - being a manual action - always
            // applies regardless of .pages' width.
            const el = await createLoadedViewer();
            const zoomInBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!;
            const zoomOutBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')!;
            const resetBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Reset zoom"]')!;
            const label = el.shadowRoot!.querySelector('.zoom-label')!;
            const containers = el.shadowRoot!.querySelectorAll<HTMLElement>('.page-container');

            resetBtn.click();
            expect(label.textContent).toBe('100%');
            expect(containers[0].style.width).toBe('1404px');
            expect(containers[1].style.width).toBe('1404px');

            zoomInBtn.click();
            expect(label.textContent).toBe('125%');
            expect(containers[0].style.width).toBe('1755px'); // 1404 * 1.25

            zoomOutBtn.click();
            zoomOutBtn.click();
            expect(label.textContent).toBe('80%'); // 125% / 1.25 / 1.25

            resetBtn.click();
            expect(label.textContent).toBe('100%');
            expect(containers[0].style.width).toBe('1404px');

            // Every page's img stays at width: 100% of its own
            // (explicitly, zoom-scaled) container - see applyZoomToPages().
            for (const container of Array.from(containers)) {
                expect(container.querySelector('img')?.style.width).toBe('100%');
            }
        });

        it('clamps manual zoom to [5%, 500%]', async () => {
            const el = await createLoadedViewer();
            const zoomInBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!;
            const zoomOutBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')!;
            const label = el.shadowRoot!.querySelector('.zoom-label')!;

            for (let i = 0; i < 20; i++) zoomInBtn.click();
            expect(label.textContent).toBe('500%');

            for (let i = 0; i < 40; i++) zoomOutBtn.click();
            expect(label.textContent).toBe('5%');
        });

        it('any manual zoom action turns off fit-width', async () => {
            const el = await createLoadedViewer();
            const fitWidthBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Fit page to viewport width"]')!;
            const zoomInBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!;
            expect(fitWidthBtn.getAttribute('aria-pressed')).toBe('true');

            zoomInBtn.click();

            expect(fitWidthBtn.getAttribute('aria-pressed')).toBe('false');
        });

        it('ctrl+wheel zooms; a plain wheel does not', async () => {
            const el = await createLoadedViewer();
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            const label = el.shadowRoot!.querySelector('.zoom-label')!;

            const plainWheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
            pagesEl.dispatchEvent(plainWheel);
            expect(label.textContent).toBe('100%');
            expect(plainWheel.defaultPrevented).toBe(false);

            // happy-dom's WheelEvent constructor doesn't wire up ctrlKey
            // from its init dict (confirmed directly: MouseEvent respects
            // it, WheelEvent silently doesn't) - defineProperty is a
            // reliable, if slightly unusual, workaround. Real ctrl+scroll/
            // pinch-to-zoom input is verified separately in a real browser
            // (see the Playwright verification for this feature).
            const ctrlWheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
            Object.defineProperty(ctrlWheel, 'ctrlKey', { value: true });
            pagesEl.dispatchEvent(ctrlWheel);
            expect(ctrlWheel.defaultPrevented).toBe(true);
            expect(label.textContent).not.toBe('100%');
            // deltaY -100 -> factor min(1.05, 1 - (-100)*0.01) = min(1.05, 2) = 1.05
            expect(label.textContent).toBe('105%');
        });

        it('two-finger touch pinch zooms (issue #202)', async () => {
            const el = await createLoadedViewer();
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            const label = el.shadowRoot!.querySelector('.zoom-label')!;
            const resetBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Reset zoom"]')!;
            resetBtn.click();
            expect(label.textContent).toBe('100%');

            const touch = (id: number, x: number, y: number) =>
                new Touch({ identifier: id, target: pagesEl, clientX: x, clientY: y });

            // Two touches 100px apart...
            pagesEl.dispatchEvent(
                new TouchEvent('touchstart', { touches: [touch(1, 0, 0), touch(2, 100, 0)], cancelable: true }),
            );
            // ...spread to 200px apart - double the starting distance, so
            // zoom should double from its 100% starting point.
            const move = new TouchEvent('touchmove', {
                touches: [touch(1, -50, 0), touch(2, 150, 0)],
                cancelable: true,
            });
            pagesEl.dispatchEvent(move);

            expect(move.defaultPrevented).toBe(true);
            expect(label.textContent).toBe('200%');
        });

        it('a single-finger touchmove does not pinch-zoom', async () => {
            const el = await createLoadedViewer();
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            const label = el.shadowRoot!.querySelector('.zoom-label')!;
            const resetBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Reset zoom"]')!;
            resetBtn.click();

            const touch = (y: number) => new Touch({ identifier: 1, target: pagesEl, clientX: 0, clientY: y });
            pagesEl.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(100)], cancelable: true }));
            pagesEl.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(50)], cancelable: true }));

            expect(label.textContent).toBe('100%');
        });

        it('re-enabling fit-width recomputes from .pages\' current width', async () => {
            const el = await createLoadedViewer();
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            const fitWidthBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Fit page to viewport width"]')!;
            const zoomOutBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')!;
            const label = el.shadowRoot!.querySelector('.zoom-label')!;
            const container = el.shadowRoot!.querySelector<HTMLElement>('.page-container')!;

            // happy-dom's clientWidth is always 0 by default - stub it to a
            // real value to exercise applyFitWidth()'s actual computation.
            Object.defineProperty(pagesEl, 'clientWidth', { value: 702, configurable: true });

            zoomOutBtn.click(); // manual action -> turns fit-width off
            expect(fitWidthBtn.getAttribute('aria-pressed')).toBe('false');

            fitWidthBtn.click(); // re-enable -> recomputes immediately
            expect(fitWidthBtn.getAttribute('aria-pressed')).toBe('true');
            expect(label.textContent).toBe('50%'); // 702 / 1404
            expect(container.style.width).toBe('702px');
        });

        it('has no toolbar/zoom controls in single-page mode, and stays capped by CSS instead of zoom', async () => {
            const el = createViewer();
            el.setAttribute('single-page', '');
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note'); // pageWidth 1404
            await loaded;
            await Promise.resolve();
            await Promise.resolve();

            expect(el.shadowRoot!.querySelector('.toolbar')).toBeNull();
            expect(el.shadowRoot!.querySelector('.zoom-label')).toBeNull();
            // ensurePageImageLoaded() still calls applyZoomToPages() here
            // (zoomScale never changes from its 1/100% default in this
            // mode, since no controls exist to change it) - the container
            // gets the same explicit native-pixel width a zoomed page
            // would, but single-page mode's CSS (the plain, un-overridden
            // max-width: 100% rule - see the :host(:not([single-page]))
            // scoping) still caps it down to whatever's actually
            // available, unlike normal mode where zoom can exceed it.
            const container = el.shadowRoot!.querySelector<HTMLElement>('.page-container')!;
            expect(container.style.width).toBe('1404px');
        });
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

    it('builds an invisible word-overlay span per boxed recognized word', async () => {
        const el = createViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('rtr.note');
        await loaded;

        const spans = el.shadowRoot!.querySelectorAll('.word-overlay-span');
        expect(spans.length).toBeGreaterThan(0);
        expect(Array.from(spans).some((s) => s.textContent === 'Real')).toBe(true);
    });

    it('shows the toolbar and find bar even for a single-page note, but no page nav', async () => {
        // The mode toggle and find button are useful regardless of page
        // count - only the page-jump textbox is conditioned on there
        // being more than one page to navigate between (see
        // buildToolbar()).
        const el = createViewer();
        document.body.appendChild(el);
        const loaded = waitForEvent(el, 'supernote-load');
        el.noteData = readFixture('rtr.note'); // 1 page
        await loaded;

        expect(el.shadowRoot!.querySelector('.toolbar')).toBeTruthy();
        expect(el.shadowRoot!.querySelector('.find-bar')).toBeTruthy();
        expect(el.shadowRoot!.querySelector('button[aria-label="Find in note"]')).toBeTruthy();
        expect(el.shadowRoot!.querySelector('.page-jump-input')).toBeNull();
    });

    describe('touch scroll boundary containment (issue #202)', () => {
        async function createLoadedViewer() {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
            await loaded;
            return el;
        }

        it('prevents default on a single-finger pull past the top boundary', async () => {
            const el = await createLoadedViewer();
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            // happy-dom has no real layout - scrollTop/scrollHeight/
            // clientHeight all default to 0, which (0 <= 0, 0+0 >= 0) looks
            // like both the top *and* bottom boundary at once. Stubbed
            // explicitly to a real mid-scroll position so this test
            // exercises the "at top" branch specifically, not an artifact
            // of the unstubbed defaults.
            Object.defineProperty(pagesEl, 'scrollTop', { value: 0, configurable: true });
            Object.defineProperty(pagesEl, 'clientHeight', { value: 400, configurable: true });
            Object.defineProperty(pagesEl, 'scrollHeight', { value: 2000, configurable: true });

            const touch = (y: number) => new Touch({ identifier: 1, target: pagesEl, clientX: 0, clientY: y });
            pagesEl.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(100)], cancelable: true }));
            // Finger moves down (clientY increases) while already scrolled
            // to the top - the exact "pull past the boundary" motion that
            // rubber-bands/chains outward without this fix.
            const pullDown = new TouchEvent('touchmove', { touches: [touch(150)], cancelable: true });
            pagesEl.dispatchEvent(pullDown);

            expect(pullDown.defaultPrevented).toBe(true);
        });

        it('prevents default on a single-finger pull past the bottom boundary', async () => {
            const el = await createLoadedViewer();
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            Object.defineProperty(pagesEl, 'scrollTop', { value: 1600, configurable: true });
            Object.defineProperty(pagesEl, 'clientHeight', { value: 400, configurable: true });
            Object.defineProperty(pagesEl, 'scrollHeight', { value: 2000, configurable: true });

            const touch = (y: number) => new Touch({ identifier: 1, target: pagesEl, clientX: 0, clientY: y });
            pagesEl.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(150)], cancelable: true }));
            // Finger moves up (clientY decreases) while already scrolled to
            // the bottom.
            const pullUp = new TouchEvent('touchmove', { touches: [touch(100)], cancelable: true });
            pagesEl.dispatchEvent(pullUp);

            expect(pullUp.defaultPrevented).toBe(true);
        });

        it('does not prevent default for an ordinary in-range scroll', async () => {
            const el = await createLoadedViewer();
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            Object.defineProperty(pagesEl, 'scrollTop', { value: 800, configurable: true });
            Object.defineProperty(pagesEl, 'clientHeight', { value: 400, configurable: true });
            Object.defineProperty(pagesEl, 'scrollHeight', { value: 2000, configurable: true });

            const touch = (y: number) => new Touch({ identifier: 1, target: pagesEl, clientX: 0, clientY: y });
            pagesEl.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(150)], cancelable: true }));
            const move = new TouchEvent('touchmove', { touches: [touch(100)], cancelable: true });
            pagesEl.dispatchEvent(move);

            expect(move.defaultPrevented).toBe(false);
        });
    });

    describe('Obsidian host gesture opt-out (issue #204)', () => {
        async function createLoadedViewer() {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-blank-2p.note');
            await loaded;
            return el;
        }

        function touchstart(target: HTMLElement) {
            const touch = new Touch({ identifier: 1, target, clientX: 0, clientY: 0 });
            target.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], cancelable: true }));
        }

        it('sets data-ignore-swipe when scrolled below the top (blocks the palette-pull gesture)', async () => {
            const el = await createLoadedViewer();
            const rootEl = el.shadowRoot!.querySelector('.root') as HTMLElement;
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            Object.defineProperty(pagesEl, 'scrollTop', { value: 500, configurable: true });

            touchstart(rootEl);

            expect(rootEl.dataset.ignoreSwipe).toBe('true');
        });

        it('clears data-ignore-swipe when at the very top and not horizontally scrollable', async () => {
            const el = await createLoadedViewer();
            const rootEl = el.shadowRoot!.querySelector('.root') as HTMLElement;
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            Object.defineProperty(pagesEl, 'scrollTop', { value: 0, configurable: true });
            Object.defineProperty(pagesEl, 'scrollWidth', { value: 400, configurable: true });
            Object.defineProperty(pagesEl, 'clientWidth', { value: 400, configurable: true });

            touchstart(rootEl);

            expect(rootEl.hasAttribute('data-ignore-swipe')).toBe(false);
        });

        it('sets data-ignore-swipe when horizontally scrollable and not at an edge (blocks the sidebar-swipe gesture)', async () => {
            const el = await createLoadedViewer();
            const rootEl = el.shadowRoot!.querySelector('.root') as HTMLElement;
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            Object.defineProperty(pagesEl, 'scrollTop', { value: 0, configurable: true });
            Object.defineProperty(pagesEl, 'scrollWidth', { value: 1000, configurable: true });
            Object.defineProperty(pagesEl, 'clientWidth', { value: 400, configurable: true });
            Object.defineProperty(pagesEl, 'scrollLeft', { value: 300, configurable: true });

            touchstart(rootEl);

            expect(rootEl.dataset.ignoreSwipe).toBe('true');
        });

        it('sets data-ignore-swipe for horizontal overflow regardless of scroll position (no single "edge" - a sidebar swipe can go either way)', async () => {
            const el = await createLoadedViewer();
            const rootEl = el.shadowRoot!.querySelector('.root') as HTMLElement;
            const pagesEl = el.shadowRoot!.querySelector('.pages') as HTMLElement;
            Object.defineProperty(pagesEl, 'scrollTop', { value: 0, configurable: true });
            Object.defineProperty(pagesEl, 'scrollWidth', { value: 1000, configurable: true });
            Object.defineProperty(pagesEl, 'clientWidth', { value: 400, configurable: true });
            Object.defineProperty(pagesEl, 'scrollLeft', { value: 0, configurable: true }); // at the left edge

            touchstart(rootEl);

            expect(rootEl.dataset.ignoreSwipe).toBe('true');
        });
    });

    describe('find in note', () => {
        async function createLoadedViewer() {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('rtr.note');
            await loaded;
            return el;
        }

        it('opening the find bar focuses the input and marks the toggle pressed', async () => {
            const el = await createLoadedViewer();
            const findBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!;
            const bar = el.shadowRoot!.querySelector('.find-bar')!;
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;

            expect(bar.classList.contains('open')).toBe(false);

            findBtn.click();

            expect(bar.classList.contains('open')).toBe(true);
            expect(findBtn.getAttribute('aria-pressed')).toBe('true');
            expect(el.shadowRoot!.activeElement).toBe(input);
        });

        it('a query with one real match highlights exactly it and reports "1 / 1"', async () => {
            const el = await createLoadedViewer();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!.click();
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;

            input.value = 'real';
            input.dispatchEvent(new Event('input'));

            const current = el.shadowRoot!.querySelectorAll('.word-overlay-match-current');
            expect(current).toHaveLength(1);
            expect(current[0].textContent).toBe('Real');
            expect(el.shadowRoot!.querySelector('.find-count')?.textContent).toBe('1 / 1');
        });

        it('cycles through every match with next/prev, wrapping in both directions', async () => {
            // This fixture's recognized text contains "paragraph" 4 times
            // (confirmed directly against the real fixture, not asserted
            // blindly) - a good real case for wraparound cycling, since it
            // spans multiple separate recognitionElements/lines.
            const el = await createLoadedViewer();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!.click();
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;
            const nextBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Next match"]')!;
            const prevBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Previous match"]')!;
            const countEl = el.shadowRoot!.querySelector('.find-count')!;

            input.value = 'paragraph';
            input.dispatchEvent(new Event('input'));

            expect(el.shadowRoot!.querySelectorAll('.word-overlay-match')).toHaveLength(4);
            expect(countEl.textContent).toBe('1 / 4');

            nextBtn.click();
            expect(countEl.textContent).toBe('2 / 4');
            nextBtn.click();
            nextBtn.click();
            expect(countEl.textContent).toBe('4 / 4');
            nextBtn.click(); // wraps forward past the last match
            expect(countEl.textContent).toBe('1 / 4');
            prevBtn.click(); // wraps backward past the first match
            expect(countEl.textContent).toBe('4 / 4');

            // Exactly one match is ever "current" at a time.
            expect(el.shadowRoot!.querySelectorAll('.word-overlay-match-current')).toHaveLength(1);
        });

        it('reports no results for a query with no match, without throwing', async () => {
            const el = await createLoadedViewer();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!.click();
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;

            input.value = 'zzzznotfound';
            input.dispatchEvent(new Event('input'));

            expect(el.shadowRoot!.querySelectorAll('.word-overlay-match')).toHaveLength(0);
            expect(el.shadowRoot!.querySelector('.find-count')?.textContent).toBe('No results');
        });

        it('a multi-word query highlights every word it spans, not just the first (issue #199)', async () => {
            // Confirmed as a real, reported bug: searching "with enough"
            // (present once in this fixture, in "With enough space a new
            // paragraph") correctly reported "1 / 1" but only ever
            // highlighted "With" - the first word in the match, via
            // entryAt(match.start) alone - leaving "enough" unhighlighted
            // even though the match genuinely spans both words. Works
            // correctly in recognized-text mode already (a single <mark>
            // wraps the whole [start, end) range there, not one span per
            // word), which is why this was image-mode-only.
            const el = await createLoadedViewer();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!.click();
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;

            input.value = 'with enough';
            input.dispatchEvent(new Event('input'));

            expect(el.shadowRoot!.querySelector('.find-count')?.textContent).toBe('1 / 1');
            const current = Array.from(el.shadowRoot!.querySelectorAll('.word-overlay-match-current'));
            expect(current.map((s) => s.textContent)).toEqual(['With', 'enough']);
        });

        it('clears every word\'s highlight from a multi-word match, not just the first', async () => {
            const el = await createLoadedViewer();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!.click();
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;

            input.value = 'with enough';
            input.dispatchEvent(new Event('input'));
            expect(el.shadowRoot!.querySelectorAll('.word-overlay-match')).toHaveLength(2);

            input.value = 'zzzznotfound';
            input.dispatchEvent(new Event('input'));
            expect(el.shadowRoot!.querySelectorAll('.word-overlay-match, .word-overlay-match-current')).toHaveLength(0);
        });

        it('highlights matches with <mark> in recognized-text mode too', async () => {
            // Image-mode's word-overlay spans have nothing sensible to
            // overlay in text mode (the image is hidden entirely, and the
            // reflowed text bears no relation to the handwriting's x/y
            // layout) - text mode instead wraps the matched range of the
            // page's own recognized text in a <mark>, using the offsets
            // computed in runFind().
            const el = await createLoadedViewer();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Toggle recognized text view"]')!.click();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!.click();
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;

            input.value = 'real';
            input.dispatchEvent(new Event('input'));

            const marks = el.shadowRoot!.querySelectorAll('.page-text mark');
            expect(marks).toHaveLength(1);
            expect(marks[0].textContent).toBe('Real');
            expect(marks[0].classList.contains('find-match-current')).toBe(true);
            expect(el.shadowRoot!.querySelector('.find-count')?.textContent).toBe('1 / 1');
        });

        it('cycling matches in text mode moves the find-match-current mark, not just the count', async () => {
            const el = await createLoadedViewer();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Toggle recognized text view"]')!.click();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!.click();
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;
            const nextBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Next match"]')!;

            input.value = 'paragraph';
            input.dispatchEvent(new Event('input'));
            expect(el.shadowRoot!.querySelectorAll('.page-text mark.find-match')).toHaveLength(4);
            const firstCurrent = el.shadowRoot!.querySelector('.find-match-current')!;

            nextBtn.click();

            const marksAfter = el.shadowRoot!.querySelectorAll('.page-text mark.find-match-current');
            expect(marksAfter).toHaveLength(1);
            expect(marksAfter[0]).not.toBe(firstCurrent);
        });

        it('the text-mode page-text still reads correctly with no active search', async () => {
            const el = await createLoadedViewer();
            const textEl = el.shadowRoot!.querySelector('.page-text')!;
            expect(textEl.textContent).toContain('Real');
            expect(textEl.querySelector('mark')).toBeNull();
        });

        it('closing the find bar clears highlights (both modes\' kinds), the query, and the count', async () => {
            const el = await createLoadedViewer();
            const findBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!;
            findBtn.click();
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;
            input.value = 'paragraph';
            input.dispatchEvent(new Event('input'));
            expect(el.shadowRoot!.querySelectorAll('.word-overlay-match').length).toBeGreaterThan(0);
            expect(el.shadowRoot!.querySelectorAll('.page-text mark').length).toBeGreaterThan(0);

            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Close find bar"]')!.click();
            expect(el.shadowRoot!.querySelectorAll('.page-text mark')).toHaveLength(0);

            expect(el.shadowRoot!.querySelector('.find-bar')!.classList.contains('open')).toBe(false);
            expect(findBtn.getAttribute('aria-pressed')).toBe('false');
            expect(el.shadowRoot!.querySelectorAll('.word-overlay-match')).toHaveLength(0);
            expect(input.value).toBe('');
            expect(el.shadowRoot!.querySelector('.find-count')?.textContent).toBe('');
        });

        it('Escape in the find input closes the bar; Enter/Shift+Enter step next/prev', async () => {
            const el = await createLoadedViewer();
            el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Find in note"]')!.click();
            const input = el.shadowRoot!.querySelector<HTMLInputElement>('.find-bar input')!;
            const countEl = el.shadowRoot!.querySelector('.find-count')!;

            input.value = 'paragraph';
            input.dispatchEvent(new Event('input'));
            expect(countEl.textContent).toBe('1 / 4');

            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            expect(countEl.textContent).toBe('2 / 4');

            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
            expect(countEl.textContent).toBe('1 / 4');

            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(el.shadowRoot!.querySelector('.find-bar')!.classList.contains('open')).toBe(false);
        });
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

    describe('link overlay', () => {
        // Same fixture linkOverlay.test.ts's own "LINKRECT against a real
        // .note fixture" block uses - a real, device-created note with 3
        // genuine internal links, all on page index 1 (page 2), confirmed
        // there via bucketLinksByPage(). None of its 3 links have an empty
        // ILink.text prefix (every one explicitly names a target note,
        // including the one whose PAGEID actually resolves to this same
        // note's own page 1) - real device-authored links apparently always
        // carry a filename, even for what would be a same-file jump in an
        // Obsidian-aware viewer that knows its own file's basename. That
        // makes this fixture a good real-world check of the *deferred*
        // path (dispatching link-click) specifically, which is what a
        // portable component with no concept of "my own filename" will hit
        // for virtually every real link.
        it('builds one clickable rect per page for that page\'s own links, none for pages with none', async () => {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-link-tag-3p.note');
            await loaded;

            const [page1, page2, page3] = Array.from(el.shadowRoot!.querySelectorAll('.page-container'));
            expect(page1.querySelectorAll('.link-overlay-rect')).toHaveLength(0);
            expect(page2.querySelectorAll('.link-overlay-rect')).toHaveLength(3);
            expect(page3.querySelectorAll('.link-overlay-rect')).toHaveLength(0);
        });

        it('dispatches link-click with the full ILink when a rect is clicked, and prevents the anchor\'s own navigation', async () => {
            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-link-tag-3p.note');
            await loaded;

            const page2 = el.shadowRoot!.querySelectorAll('.page-container')[1];
            const [rect] = Array.from(page2.querySelectorAll<HTMLAnchorElement>('.link-overlay-rect'));

            const clicked = waitForEvent<{ link: { text: string; PAGEID: string } }>(el, 'link-click');
            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
            rect.dispatchEvent(clickEvent);

            const evt = await clicked;
            expect(evt.detail.link.text).toBe('nomad-3.26.40-link-tag-3p#Page 1');
            expect(evt.detail.link.PAGEID).toBe('P20240303144624294784hYDadze19JFd');
            expect(clickEvent.defaultPrevented).toBe(true);
        });

        it('repositions link rects to the page\'s rendered size via the shared ResizeObserver', async () => {
            // happy-dom's ResizeObserver never actually fires (no real
            // layout engine), so it's stubbed here to synchronously hand
            // back a chosen size instead - same technique as this file's
            // other geometry-scaling tests, capturing setupOverlayResizing()
            // ()'s callback so it can be driven directly.
            const observed: { target: Element; cb: ResizeObserverCallback }[] = [];
            class FakeResizeObserver {
                constructor(private cb: ResizeObserverCallback) {}
                observe(target: Element) { observed.push({ target, cb: this.cb }); }
                disconnect() {}
            }
            vi.stubGlobal('ResizeObserver', FakeResizeObserver);

            const el = createViewer();
            document.body.appendChild(el);
            const loaded = waitForEvent(el, 'supernote-load');
            el.noteData = readFixture('nomad-3.26.40-link-tag-3p.note');
            await loaded;

            const page2 = el.shadowRoot!.querySelectorAll('.page-container')[1];
            const [rect] = Array.from(page2.querySelectorAll<HTMLAnchorElement>('.link-overlay-rect'));

            const entry = observed.find((o) => o.target === page2);
            entry?.cb([{ target: page2, contentRect: { width: 500, height: 600 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);

            // LINKRECT '118,1253,743,132' in this note's native 1404x1872
            // page space, scaled to a 500x600 render, should land well away
            // from its raw native-space numbers - proving the rendered size
            // (not the native pixel size) drove the positioning.
            expect(rect.style.left).not.toBe('118px');
            expect(parseFloat(rect.style.left)).toBeCloseTo((118 / 1404) * 500, 0);
        });
    });
});
