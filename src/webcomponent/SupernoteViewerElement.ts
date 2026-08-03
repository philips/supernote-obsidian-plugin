// Standalone `<supernote-viewer>` custom element - the "pull SupernoteView
// out into a web component" half of issue #183. Built entirely on top of
// src/render/ (imageConverter.ts, noteRenderer.ts), both already free of any
// `obsidian` import, so this file itself never touches Obsidian either: it
// can run on any plain page (a static site, a demo, eventually a vault
// exported to HTML) with nothing but this bundle and a modern browser.
//
// Deliberately v1-scoped: read-only viewing (rasterized page images, plus a
// recognized-text mode), no save/export UI - see the plan on #183 for why
// that's a separate concern (it needs a browser-native Blob/download story,
// not Obsidian's vault-write APIs this codebase otherwise uses).
import { SupernoteX } from 'supernote-typescript';
import { ImageConverter } from '../render/imageConverter';
import { RenderedNotePage, buildNotePagePlaceholders, fillNotePagePlaceholder, parseNote } from '../render/noteRenderer';

interface ViewerPageState extends RenderedNotePage {
    textEl: HTMLElement;
    loaded: boolean;
    visible: boolean;
    loadDebounceTimer?: number;
}

const STYLE = `
:host {
    display: block;
    --supernote-viewer-border: #d0d0d0;
    --supernote-viewer-bg: #ffffff;
    --supernote-viewer-fg: #1a1a1a;
    --supernote-viewer-muted: #666666;
    color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
    :host {
        --supernote-viewer-border: #444444;
        --supernote-viewer-bg: #1e1e1e;
        --supernote-viewer-fg: #e8e8e8;
        --supernote-viewer-muted: #a0a0a0;
    }
}
.root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 200px;
    border: 1px solid var(--supernote-viewer-border);
    border-radius: 6px;
    background: var(--supernote-viewer-bg);
    color: var(--supernote-viewer-fg);
    overflow: hidden;
    font: 14px/1.4 system-ui, sans-serif;
    box-sizing: border-box;
}
/* For embedding inside a host page that already provides its own frame
   (border/background/scroll) around this element - e.g. Obsidian's
   SupernoteEmbed, which wraps this in its own bordered/resizable
   .supernote-embed container - so this element's own chrome doesn't double
   up with the host's. Purely a CSS attribute selector: no JS involved, so
   toggling it live needs no re-render. */
:host([bare]) .root {
    border: none;
    border-radius: 0;
    background: transparent;
}
.toolbar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    padding: 0.4em 0.6em;
    background: var(--supernote-viewer-bg);
    border-bottom: 1px solid var(--supernote-viewer-border);
}
button {
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid var(--supernote-viewer-border);
    border-radius: 4px;
    padding: 0.2em 0.6em;
    cursor: pointer;
}
button[aria-pressed="true"] {
    background: var(--supernote-viewer-muted);
    opacity: 0.3;
}
.page-indicator {
    min-width: 4em;
    text-align: center;
    color: var(--supernote-viewer-muted);
    font-size: 0.9em;
}
.pages {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1em;
    padding: 1em;
    box-sizing: border-box;
}
.pages .page-container {
    max-width: 100%;
}
.pages .page-container > img {
    display: block;
    max-width: 100%;
}
.pages.mode-text .page-container > img {
    display: none;
}
.pages .page-container > .page-text {
    display: none;
    white-space: pre-wrap;
    padding: 1em;
    border: 1px solid var(--supernote-viewer-border);
    border-radius: 4px;
    max-width: 40em;
    box-sizing: border-box;
}
.pages.mode-text .page-container > .page-text {
    display: block;
}
.pages .page-container > .page-text.empty {
    color: var(--supernote-viewer-muted);
    font-style: italic;
}
/* Only actually inverted in dark mode, mirroring the "invert-dark" attribute
   -> "only when the environment is dark" two-part condition the Obsidian
   plugin's own invertColorsWhenDark setting has (see main.ts's
   SupernoteEmbed) - the attribute alone is "opt in to inversion", not
   "always invert". */
@media (prefers-color-scheme: dark) {
    .pages .page-container > img.supernote-invert-dark {
        filter: invert(1);
    }
}
.status {
    margin: auto;
    padding: 1em;
    color: var(--supernote-viewer-muted);
    text-align: center;
}
.status.error {
    color: #c0392b;
}
`;

export class SupernoteViewerElement extends HTMLElement {
    static get observedAttributes(): string[] {
        return ['src', 'page', 'single-page', 'invert-dark'];
    }

    // Overridable so tests can substitute a fake rasterizer - the real
    // ImageConverter dispatches to a Web Worker (see imageConverter.ts),
    // which test environments without a real browser (e.g. happy-dom) don't
    // implement.
    rasterizePage: (sn: SupernoteX, pageNumber: number) => Promise<string> = async (sn, pageNumber) => {
        const [imageDataUrl] = await new ImageConverter().convertToImages(sn, [pageNumber]);
        return imageDataUrl;
    };

    private readonly rootEl: HTMLElement;
    private pagesEl: HTMLElement | null = null;
    private toolbarEl: HTMLElement | null = null;
    private pageIndicatorEl: HTMLElement | null = null;
    private modeToggleBtn: HTMLButtonElement | null = null;
    private pageObserver: IntersectionObserver | null = null;
    private pageLoadObserver: IntersectionObserver | null = null;
    private pageStates: ViewerPageState[] = [];
    private currentPage = 0;
    private mode: 'image' | 'text' = 'image';
    private sn: SupernoteX | null = null;
    private renderQueued = false;
    private renderToken = 0;
    private _noteData: ArrayBuffer | Uint8Array | null = null;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = STYLE;
        shadow.appendChild(style);

        this.rootEl = document.createElement('div');
        this.rootEl.className = 'root';
        this.rootEl.setAttribute('part', 'root');
        shadow.appendChild(this.rootEl);
    }

    // Raw note bytes, as an alternative to the `src` URL attribute - for
    // callers that already have the file in memory (a <input type="file">
    // picker, a File System Access API handle) rather than something
    // fetchable by URL. Takes priority over `src` when both are set.
    get noteData(): ArrayBuffer | Uint8Array | null {
        return this._noteData;
    }

    set noteData(value: ArrayBuffer | Uint8Array | null) {
        this._noteData = value;
        this.queueRender();
    }

    connectedCallback(): void {
        this.queueRender();
    }

    disconnectedCallback(): void {
        this.pageObserver?.disconnect();
        this.pageLoadObserver?.disconnect();
        for (const state of this.pageStates) window.clearTimeout(state.loadDebounceTimer);
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (oldValue === newValue) return;
        if (name === 'src' || name === 'single-page' || name === 'invert-dark') {
            // All three are consumed at build time (which page(s) to build,
            // and whether to tag their images for dark-mode inversion), so
            // there's no cheaper path than a full rebuild when they change.
            this.queueRender();
            return;
        }
        if (name === 'page') {
            if (this.hasAttribute('single-page')) {
                // Selects *which* page single-page mode builds, not a jump
                // within an already-built page list - needs a full rebuild.
                this.queueRender();
            } else {
                const n = Number(newValue);
                if (Number.isFinite(n)) this.goToPage(n);
            }
        }
    }

    // Scrolls to (1-indexed) `pageNumber` and forces that page's image to
    // load immediately if it hasn't already - the same "don't wait on the
    // lazy-load observer for a deliberate jump" pattern SupernoteView's own
    // goToPage() uses (see main.ts).
    goToPage(pageNumber: number): void {
        if (this.pageStates.length === 0 || !this.sn) return;
        const clamped = Math.min(Math.max(Math.round(pageNumber), 1), this.pageStates.length);
        const state = this.pageStates[clamped - 1];
        state.containerEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
        if (!state.loaded) void this.ensurePageImageLoaded(this.sn, state);
    }

    // Coalesces a burst of synchronous attribute/property sets (e.g. setting
    // `src` right after creating the element, before it's connected) into a
    // single render() call, deferred to a microtask so every attribute set
    // in the same synchronous block is visible by the time it runs.
    private queueRender(): void {
        if (!this.isConnected) return;
        if (this.renderQueued) return;
        this.renderQueued = true;
        queueMicrotask(() => {
            this.renderQueued = false;
            void this.render();
        });
    }

    private async render(): Promise<void> {
        // Invalidates any earlier in-flight render() - e.g. `src` changed
        // again before the previous fetch settled - so a slow first load
        // can't clobber a newer one that finished first.
        const token = ++this.renderToken;
        this.teardownForRerender();

        if (!this._noteData && !this.getAttribute('src')) {
            this.showStatus('No Supernote file loaded — set the "src" attribute or the noteData property.');
            return;
        }

        this.showStatus('Loading…');

        let bytes: ArrayBuffer;
        try {
            bytes = await this.loadBytes();
        } catch (err) {
            if (token !== this.renderToken) return;
            this.handleLoadError(err);
            return;
        }
        if (token !== this.renderToken) return;

        let sn: SupernoteX;
        try {
            sn = parseNote(bytes);
        } catch (err) {
            if (token !== this.renderToken) return;
            this.handleLoadError(err);
            return;
        }
        if (token !== this.renderToken) return;

        this.sn = sn;
        this.buildViewer(sn);
        this.dispatchEvent(new CustomEvent('supernote-load', {
            detail: { pageCount: sn.pages.length, pageWidth: sn.pageWidth, pageHeight: sn.pageHeight },
        }));

        // Single-page mode already built exactly the requested page directly
        // (see buildSinglePageViewer()) - there's no separate page list to
        // jump within.
        if (this.hasAttribute('single-page')) return;

        const pageAttr = this.getAttribute('page');
        const pageNumber = pageAttr !== null ? Number(pageAttr) : NaN;
        if (Number.isFinite(pageNumber)) this.goToPage(pageNumber);
    }

    private handleLoadError(err: unknown): void {
        this.showError(err);
        this.dispatchEvent(new CustomEvent('supernote-error', { detail: { error: err } }));
    }

    private async loadBytes(): Promise<ArrayBuffer> {
        if (this._noteData) {
            return this._noteData instanceof Uint8Array
                ? (this._noteData.buffer.slice(
                    this._noteData.byteOffset,
                    this._noteData.byteOffset + this._noteData.byteLength,
                ) as ArrayBuffer)
                : this._noteData;
        }
        const src = this.getAttribute('src')!;
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Failed to fetch "${src}" (HTTP ${response.status})`);
        return response.arrayBuffer();
    }

    private teardownForRerender(): void {
        this.pageObserver?.disconnect();
        this.pageObserver = null;
        this.pageLoadObserver?.disconnect();
        this.pageLoadObserver = null;
        for (const state of this.pageStates) window.clearTimeout(state.loadDebounceTimer);
        this.pageStates = [];
        this.pagesEl = null;
        this.toolbarEl = null;
        this.pageIndicatorEl = null;
        this.modeToggleBtn = null;
        this.currentPage = 0;
        this.mode = 'image';
        this.sn = null;
        this.rootEl.innerHTML = '';
    }

    private buildViewer(sn: SupernoteX): void {
        const invertColorsWhenDark = this.hasAttribute('invert-dark');

        if (this.hasAttribute('single-page')) {
            this.buildSinglePageViewer(sn, invertColorsWhenDark);
            return;
        }

        const pageCount = sn.pages.length;
        if (pageCount > 1) this.buildToolbar(pageCount);

        const pagesEl = document.createElement('div');
        pagesEl.className = 'pages';
        pagesEl.setAttribute('part', 'pages');
        this.rootEl.appendChild(pagesEl);
        this.pagesEl = pagesEl;

        const placeholders = buildNotePagePlaceholders(pageCount, pagesEl, {
            pageWidth: sn.pageWidth,
            pageHeight: sn.pageHeight,
            invertColorsWhenDark,
        });

        const states = this.wrapPageStates(sn, placeholders);
        this.pageStates = states;

        this.setupPageLoadObserver(sn, states);
        if (pageCount > 1) this.setupPageIndicatorObserver(states);
    }

    // A single deep-linked page (the `page` attribute, clamped, defaulting
    // to 1) with no toolbar/navigation and no lazy loading - there's nothing
    // else in this mode to navigate to or defer loading for. Rendered
    // eagerly for the same reason. Mirrors what SupernoteEmbed's own
    // pageAnchor path in main.ts did before it became a thin wrapper around
    // this element.
    private buildSinglePageViewer(sn: SupernoteX, invertColorsWhenDark: boolean): void {
        const pageAttr = this.getAttribute('page');
        const requested = pageAttr !== null ? Number(pageAttr) : 1;
        const pageNumber = Number.isFinite(requested)
            ? Math.min(Math.max(Math.round(requested), 1), sn.pages.length)
            : 1;

        const pagesEl = document.createElement('div');
        pagesEl.className = 'pages';
        pagesEl.setAttribute('part', 'pages');
        this.rootEl.appendChild(pagesEl);
        this.pagesEl = pagesEl;

        const placeholders = buildNotePagePlaceholders(1, pagesEl, {
            startPageNumber: pageNumber,
            pageWidth: sn.pageWidth,
            pageHeight: sn.pageHeight,
            invertColorsWhenDark,
        });

        const [state] = this.wrapPageStates(sn, placeholders);
        this.pageStates = [state];
        void this.ensurePageImageLoaded(sn, state);
    }

    // Builds each placeholder's recognized-text sibling and the rest of its
    // ViewerPageState - shared by the normal (all-pages, lazy) and
    // single-page (one page, eager) construction paths above.
    private wrapPageStates(sn: SupernoteX, placeholders: RenderedNotePage[]): ViewerPageState[] {
        return placeholders.map((page) => {
            const rawText = sn.pages[page.pageNumber - 1]?.text ?? '';
            const textEl = document.createElement('div');
            textEl.className = 'page-text';
            textEl.classList.toggle('empty', rawText.length === 0);
            textEl.textContent = rawText.length > 0 ? rawText : 'No recognized text on this page.';
            page.containerEl.appendChild(textEl);

            return { ...page, textEl, loaded: false, visible: false };
        });
    }

    // Loads each page's image lazily, only once it's about to scroll into
    // view - rasterizing every page upfront made even the first page wait on
    // the whole document finishing (see issue #183 and the same fix already
    // applied to SupernoteEmbed in main.ts, which this mirrors).
    private setupPageLoadObserver(sn: SupernoteX, states: ViewerPageState[]): void {
        this.pageLoadObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const state = states.find((s) => s.containerEl === entry.target);
                if (!state) continue;
                state.visible = entry.isIntersecting;
                if (!entry.isIntersecting) continue;

                window.clearTimeout(state.loadDebounceTimer);
                state.loadDebounceTimer = window.setTimeout(() => {
                    if (!state.visible || state.loaded) return;
                    void this.ensurePageImageLoaded(sn, state);
                }, 150);
            }
        }, { root: this.pagesEl, rootMargin: '100% 0px' });

        for (const state of states) this.pageLoadObserver.observe(state.containerEl);
    }

    // Keeps the toolbar's page indicator in sync with whatever page is
    // actually scrolled into view - same pattern as SupernoteEmbed's
    // observePages() in main.ts.
    private setupPageIndicatorObserver(states: ViewerPageState[]): void {
        this.pageObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const idx = states.findIndex((s) => s.containerEl === entry.target);
                if (idx === -1) continue;
                this.currentPage = idx;
                if (this.pageIndicatorEl) this.pageIndicatorEl.textContent = `${idx + 1} / ${states.length}`;
            }
        }, { root: this.pagesEl, threshold: 0.5 });

        for (const state of states) this.pageObserver.observe(state.containerEl);
    }

    // Idempotent and safe to call speculatively - `loaded` is set eagerly so
    // a slow rasterization can't be triggered twice for the same page.
    private async ensurePageImageLoaded(sn: SupernoteX, state: ViewerPageState): Promise<void> {
        state.loaded = true;
        try {
            const imageDataUrl = await this.rasterizePage(sn, state.pageNumber);
            fillNotePagePlaceholder(state, imageDataUrl);
        } catch (err) {
            // Allows a retry on the next intersection - a transient
            // rasterization failure shouldn't permanently blank this page.
            state.loaded = false;
            console.error(`supernote-viewer: page ${state.pageNumber} failed to load`, err);
            this.dispatchEvent(new CustomEvent('supernote-error', { detail: { error: err, pageNumber: state.pageNumber } }));
        }
    }

    private buildToolbar(pageCount: number): void {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        toolbar.setAttribute('part', 'toolbar');

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.setAttribute('part', 'button');
        prevBtn.setAttribute('aria-label', 'Previous page');
        prevBtn.textContent = '↑';
        prevBtn.addEventListener('click', () => this.goToPage(this.currentPage));
        toolbar.appendChild(prevBtn);

        const indicator = document.createElement('span');
        indicator.className = 'page-indicator';
        indicator.setAttribute('part', 'page-indicator');
        indicator.textContent = `1 / ${pageCount}`;
        toolbar.appendChild(indicator);
        this.pageIndicatorEl = indicator;

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.setAttribute('part', 'button');
        nextBtn.setAttribute('aria-label', 'Next page');
        nextBtn.textContent = '↓';
        nextBtn.addEventListener('click', () => this.goToPage(this.currentPage + 2));
        toolbar.appendChild(nextBtn);

        const modeBtn = document.createElement('button');
        modeBtn.type = 'button';
        modeBtn.setAttribute('part', 'button');
        modeBtn.setAttribute('aria-label', 'Toggle recognized text view');
        modeBtn.setAttribute('aria-pressed', 'false');
        modeBtn.textContent = 'Aa';
        modeBtn.addEventListener('click', () => this.toggleMode());
        toolbar.appendChild(modeBtn);
        this.modeToggleBtn = modeBtn;

        this.rootEl.appendChild(toolbar);
        this.toolbarEl = toolbar;
    }

    private toggleMode(): void {
        this.mode = this.mode === 'image' ? 'text' : 'image';
        this.pagesEl?.classList.toggle('mode-text', this.mode === 'text');
        this.modeToggleBtn?.setAttribute('aria-pressed', String(this.mode === 'text'));
    }

    private showStatus(message: string): void {
        this.rootEl.innerHTML = '';
        const status = document.createElement('div');
        status.className = 'status';
        status.textContent = message;
        this.rootEl.appendChild(status);
    }

    private showError(err: unknown): void {
        this.rootEl.innerHTML = '';
        const status = document.createElement('div');
        status.className = 'status error';
        status.textContent = `Failed to load Supernote file: ${err instanceof Error ? err.message : String(err)}`;
        this.rootEl.appendChild(status);
    }
}

if (!customElements.get('supernote-viewer')) {
    customElements.define('supernote-viewer', SupernoteViewerElement);
}

// Standard TypeScript/DOM convention for registering a custom element's real
// type: without this, document.createElement('supernote-viewer') (and
// Obsidian's own createEl(), which has the same
// `K extends keyof HTMLElementTagNameMap` signature) can only type the
// result as the generic HTMLElement, forcing every caller to `as` it back to
// SupernoteViewerElement themselves.
declare global {
    interface HTMLElementTagNameMap {
        'supernote-viewer': SupernoteViewerElement;
    }
}
