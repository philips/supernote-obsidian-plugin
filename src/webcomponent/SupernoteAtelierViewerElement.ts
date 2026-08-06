// Standalone `<supernote-atelier-viewer>` custom element - the `.spd`
// (Supernote Atelier) equivalent of SupernoteViewerElement.ts's
// `<supernote-viewer>` (see that file's own header comment for the
// "no Obsidian dependency, runs on any page" rationale, which applies here
// identically). Built on src/render/atelierRenderer.ts (parsing/compositing,
// itself already free of any `obsidian` import) and src/render/sidebarList.ts
// (the layer-toggle sidebar's row/thumbnail machinery, shared with this
// component's `.note` sibling's own page-thumbnail sidebar).
//
// Deliberately simpler than its `.note` sibling: a `.spd` file has no page
// concept, no recognized/searchable text, just layered tiles flattened onto
// one canvas - so there's no find bar, no page-jump toolbar, no text mode.
// Zooming is a plain CSS width change on the composited <img> (no vector/
// text source to re-rasterize from at a new scale, unlike a `.note` page).
import { IAtelierSurfaceName } from 'supernote-typescript';
import { AtelierComposite, AtelierLayerOption } from '../render/atelierRenderer';
import { AtelierWorkerClient } from '../render/atelierWorkerClient';
import { SidebarListItem, buildSidebarList, fillSidebarThumbnail } from '../render/sidebarList';
import { svgIcon } from './icons';

// Canonical names chosen to equal real Lucide icon names (see
// SupernoteViewerElement.ts's own IconName for the same reasoning) so a host
// with a real icon system (e.g. Obsidian's setIcon()/Lucide) can wire up
// iconRenderer with no translation table.
type IconName = 'zoom-out' | 'zoom-in' | 'rotate-ccw' | 'stretch-horizontal' | 'layers';

const FALLBACK_ICONS: Record<IconName, () => SVGSVGElement> = {
    'zoom-out': () => svgIcon([['line', { x1: '5', y1: '12', x2: '19', y2: '12' }]]),
    'zoom-in': () => svgIcon([
        ['line', { x1: '12', y1: '5', x2: '12', y2: '19' }],
        ['line', { x1: '5', y1: '12', x2: '19', y2: '12' }],
    ]),
    'rotate-ccw': () => svgIcon([
        ['path', { d: 'M3 12a9 9 0 1 0 2.6-6.4' }],
        ['path', { d: 'M3 4v5h5' }],
    ]),
    'stretch-horizontal': () => svgIcon([
        ['path', { d: 'M8 3 4 7l4 4' }],
        ['line', { x1: '4', y1: '7', x2: '20', y2: '7' }],
        ['path', { d: 'M16 3l4 4-4 4' }],
    ]),
    // Approximates Lucide's "layers" glyph (a diamond with a second,
    // partially-obscured diamond peeking out below it) with plain
    // primitives - same "close enough, not pixel-exact" approach as every
    // other fallback icon here and in SupernoteViewerElement.ts's own set.
    'layers': () => svgIcon([
        ['polygon', { points: '12,3 21,9 12,15 3,9' }],
        ['path', { d: 'M3 13l9 6 9-6' }],
    ]),
};

const STYLE = `
:host {
    display: block;
    --supernote-viewer-border: #d0d0d0;
    --supernote-viewer-bg: #ffffff;
    --supernote-viewer-fg: #1a1a1a;
    --supernote-viewer-muted: #666666;
    color-scheme: light dark;
}
/* Tri-state dark override, not an OR with the OS-level guess - identical
   contract, and identical bug it avoids, as SupernoteViewerElement.ts's own
   :host([dark]) rules (see that file's own comment for the full
   explanation: an override is required, not an OR, since a host's actual
   theme and its OS-level color-scheme guess are otherwise-independent and
   commonly mismatched). */
@media (prefers-color-scheme: dark) {
    :host(:not([dark])) {
        --supernote-viewer-border: #444444;
        --supernote-viewer-bg: #1e1e1e;
        --supernote-viewer-fg: #e8e8e8;
        --supernote-viewer-muted: #a0a0a0;
    }
}
:host([dark]:not([dark="false"])) {
    --supernote-viewer-border: #444444;
    --supernote-viewer-bg: #1e1e1e;
    --supernote-viewer-fg: #e8e8e8;
    --supernote-viewer-muted: #a0a0a0;
}
.root {
    position: relative;
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
/* Same "drop this element's own frame" contract as SupernoteViewerElement's
   [bare] - for a host that already provides its own border/background
   around this element (e.g. Obsidian's SupernoteAtelierEmbed). */
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
button svg {
    width: 1.1em;
    height: 1.1em;
    display: block;
}
button[aria-pressed="true"] {
    background: var(--supernote-viewer-muted);
    opacity: 0.3;
}
.zoom-label {
    min-width: 3.5em;
    text-align: center;
    color: var(--supernote-viewer-muted);
    font-size: 0.9em;
}
/* The scrollable region below the toolbar - both the composited <img> and
   the layer sidebar (overlaid, see .layer-sidebar below) live inside this.
   position: relative so the sidebar's position: absolute is relative to
   *this*, not .root - meaning it starts right at this element's own top
   edge, already below the (sticky but still in-flow) toolbar, with no need
   for SupernoteViewerElement's own JS-computed top offset (that component's
   thumbnail sidebar overlays .root directly, past a toolbar *and* a
   variable-height find bar - this one only ever has the fixed toolbar
   above it). */
.image-wrapper {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* See SupernoteViewerElement.ts's own .pages rule and
       setupHostGestureOptOut() for why this alone isn't sufficient on
       iOS 13 (no overscroll-behavior support there) - the data-ignore-swipe
       attribute this component sets on itself (see setupHostGestureOptOut
       below) covers that gap the same way. */
    overscroll-behavior: contain;
}
.atelier-image {
    display: block;
    margin: 0.5em auto;
}
/* Overlays .image-wrapper (position: absolute against its own position:
   relative above) rather than sharing a flex row with it - same lesson
   SupernoteViewerElement's own .thumb-sidebar already learned (issue #179):
   toggling this must never change .image-wrapper's own width, or
   fit-width's own resize-driven recompute would reflow/rescale the image
   every time the sidebar opens or closes. */
.layer-sidebar {
    display: none;
    position: absolute;
    left: 0;
    top: 0;
    z-index: 2;
    flex-direction: column;
    width: 140px;
    max-height: calc(100% - 1em);
    overflow-y: auto;
    gap: 0.6em;
    margin: 0.5em;
    padding: 0.5em;
    background: var(--supernote-viewer-bg);
    border: 1px solid var(--supernote-viewer-border);
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    box-sizing: border-box;
}
.layer-sidebar.open {
    display: flex;
}
.sidebar-list-item {
    cursor: pointer;
    text-align: center;
    padding: 0.25em;
    border: 2px solid transparent;
    border-radius: 4px;
}
.sidebar-list-item:hover {
    background: rgba(128, 128, 128, 0.2);
}
.sidebar-list-thumb {
    display: block;
    width: 100%;
    border-radius: 2px;
    background: repeating-conic-gradient(rgba(128, 128, 128, 0.15) 0% 25%, transparent 0% 50%) 50% / 12px 12px;
}
.sidebar-list-checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.4em;
    cursor: pointer;
}
/* Same override-not-OR dark-mode inversion contract, and the same
   thumbnail-inversion fix (issue #192), as SupernoteViewerElement.ts's own
   identical rule pair - see that file's own comment for the full
   explanation. */
@media (prefers-color-scheme: dark) {
    :host(:not([dark])) .atelier-image.supernote-invert-dark,
    :host(:not([dark])) .sidebar-list-thumb.supernote-invert-dark {
        filter: invert(1);
    }
}
:host([dark]:not([dark="false"])) .atelier-image.supernote-invert-dark,
:host([dark]:not([dark="false"])) .sidebar-list-thumb.supernote-invert-dark {
    filter: invert(1);
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

export class SupernoteAtelierViewerElement extends HTMLElement {
    static get observedAttributes(): string[] {
        return ['src', 'invert-dark'];
    }

    // Overridable hook for rendering a toolbar icon into `el` - same
    // overridable-property pattern (and same reasoning) as
    // SupernoteViewerElement's own iconRenderer. `name` already equals a
    // real Lucide icon name wherever one exists, so a host wiring this up
    // to Obsidian's setIcon() needs no translation table:
    // `viewer.iconRenderer = (name, el) => setIcon(el, name);`
    iconRenderer?: (name: IconName, el: HTMLElement) => void;

    private renderIcon(name: IconName, el: HTMLElement): void {
        if (this.iconRenderer) {
            this.iconRenderer(name, el);
            return;
        }
        el.appendChild(FALLBACK_ICONS[name]());
    }

    // One dedicated Worker for this element's whole lifetime (see
    // render/atelierWorkerClient.ts's own header comment for why a full
    // WorkerPool like imageConverter.ts's isn't warranted here) - created
    // lazily on first use, reused across this element's own file reloads,
    // torn down in disconnectedCallback().
    private readonly workerClient = new AtelierWorkerClient();

    // Overridable so tests can substitute a fake opener/compositor - the
    // real implementations dispatch to workerClient above, which test
    // environments without a real browser (e.g. happy-dom) don't
    // implement. Same overridable-property pattern (and same reasoning) as
    // SupernoteViewerElement's own rasterizePage. Routing both through the
    // worker, not just compositing, is deliberate: confirmed via real
    // Obsidian testing that a synchronous compositeImage() call here -
    // even one deferred a macrotask via setTimeout - still blocked the
    // main thread for 100+ms on every layer toggle and tripped a "long
    // handler" violation regardless of which task it ran in; relocating
    // *which* callstack gets blamed doesn't help, only actually moving the
    // work off-thread does.
    openSpd: (buffer: Uint8Array) => Promise<AtelierLayerOption[]> = (buffer) => this.workerClient.open(buffer);
    compositeSurfaces: (visibleSurfaces: Iterable<IAtelierSurfaceName>) => Promise<AtelierComposite | null> =
        (visibleSurfaces) => this.workerClient.composite(visibleSurfaces);

    private readonly rootEl: HTMLElement;
    private toolbarEl: HTMLElement | null = null;
    private imageWrapperEl: HTMLElement | null = null;
    private imageEl: HTMLImageElement | null = null;
    private statusEl: HTMLElement | null = null;
    private layerSidebarEl: HTMLElement | null = null;
    private layerToggleBtn: HTMLButtonElement | null = null;
    private layerItems: SidebarListItem[] = [];
    private layerSidebarOpen = false;

    private resizeObserver: ResizeObserver | null = null;

    // Invalidates a stale in-flight load/re-composite (a newer render()
    // call, or a layer toggle that landed after the file was already
    // reloaded) - same "bump on every render, compare before applying
    // results" pattern as SupernoteViewerElement's own renderToken.
    private renderToken = 0;
    private renderQueued = false;

    private layers: AtelierLayerOption[] = [];
    private visibleSurfaces: Set<IAtelierSurfaceName> = new Set();

    // Native pixel size of the current composite - every surface in a file
    // shares the same tile-grid bounds (see AtelierComposite's own doc
    // comment in atelierRenderer.ts), so these are set once per file load,
    // not on every layer-toggle re-composite, and reused as-is for every
    // per-layer sidebar thumbnail's own aspect ratio too. 0 until the first
    // successful composite.
    private nativeWidth = 0;
    private nativeHeight = 0;

    // 1 = one image pixel per CSS pixel, same "100%" meaning
    // SupernoteViewerElement's own zoom uses.
    private zoomScale = 1;
    private fitWidthEnabled = true;
    private zoomLabelEl: HTMLElement | null = null;
    private fitWidthBtn: HTMLButtonElement | null = null;

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

        this.setupHostGestureOptOut();
    }

    // Raw .spd bytes, as an alternative to the `src` URL attribute - for
    // callers that already have the file in memory. Takes priority over
    // `src` when both are set. Same shape as SupernoteViewerElement's own
    // noteData.
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
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.workerClient.dispose();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (oldValue === newValue) return;
        // Both consumed at build/composite time (invert-dark tags the
        // rendered <img>s; src picks which bytes to fetch) - same "no
        // cheaper path than a full rebuild" call SupernoteViewerElement's
        // own attributeChangedCallback makes for the identical pair.
        this.queueRender();
    }

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
        const token = ++this.renderToken;
        this.teardownForRerender();

        if (!this._noteData && !this.getAttribute('src')) {
            this.showStatus('No Supernote Atelier file loaded — set the "src" attribute or the noteData property.');
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

        let layers: AtelierLayerOption[];
        try {
            layers = await this.openSpd(new Uint8Array(bytes));
        } catch (err) {
            if (token !== this.renderToken) return;
            this.handleLoadError(err);
            return;
        }
        if (token !== this.renderToken) return;

        this.layers = layers;
        this.visibleSurfaces = new Set(layers.map((l) => l.surfaceName));

        this.buildViewer(this.layers);
        await this.updateImage(token);
        if (token !== this.renderToken) return;

        if (this.layers.length > 1) this.buildLayerSidebarRows(this.layers, token);

        this.dispatchEvent(new CustomEvent('supernote-atelier-load', {
            detail: { width: this.nativeWidth, height: this.nativeHeight, layerCount: this.layers.length },
        }));
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
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.toolbarEl = null;
        this.imageWrapperEl = null;
        this.imageEl = null;
        this.statusEl = null;
        this.layerSidebarEl = null;
        this.layerToggleBtn = null;
        this.layerItems = [];
        this.layerSidebarOpen = false;
        this.layers = [];
        this.visibleSurfaces = new Set();
        this.nativeWidth = 0;
        this.nativeHeight = 0;
        this.zoomScale = 1;
        this.fitWidthEnabled = true;
        this.zoomLabelEl = null;
        this.fitWidthBtn = null;
        this.rootEl.innerHTML = '';
    }

    private buildViewer(layers: AtelierLayerOption[]): void {
        // Clears the "Loading…" status showStatus() left in rootEl - also
        // dropping the reference to it, not just the DOM node: leaving
        // this.statusEl pointing at a now-detached element would make the
        // next showStatus() call silently mutate that orphan instead of
        // creating a fresh, actually-visible one (confirmed while writing
        // this - showStatus()'s `if (!this.statusEl)` guard has no other
        // way to know the old node was thrown away).
        this.rootEl.innerHTML = '';
        this.statusEl = null;

        this.buildToolbar(layers.length);

        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'image-wrapper';
        imageWrapper.setAttribute('part', 'image-wrapper');
        this.rootEl.appendChild(imageWrapper);
        this.imageWrapperEl = imageWrapper;

        if (layers.length > 1) {
            const sidebar = document.createElement('div');
            sidebar.className = 'layer-sidebar';
            sidebar.setAttribute('part', 'layer-sidebar');
            imageWrapper.appendChild(sidebar);
            this.layerSidebarEl = sidebar;
        }

        const img = document.createElement('img');
        img.className = 'atelier-image';
        if (this.hasAttribute('invert-dark')) img.classList.add('supernote-invert-dark');
        imageWrapper.appendChild(img);
        this.imageEl = img;

        imageWrapper.addEventListener('wheel', (evt: WheelEvent) => {
            if (!evt.ctrlKey) return;
            evt.preventDefault();
            const factor = Math.min(1.05, Math.max(0.95, 1 - evt.deltaY * 0.01));
            this.setZoom(this.zoomScale * factor);
        }, { passive: false });

        // No debounce (unlike SupernoteViewerElement's own fit-width
        // resize handling): re-fitting here is just recomputing one CSS
        // width, not re-rasterizing a page from a vector/text source.
        this.resizeObserver = new ResizeObserver(() => {
            if (this.fitWidthEnabled) this.applyFitWidth();
        });
        this.resizeObserver.observe(imageWrapper);
    }

    private buildToolbar(layerCount: number): void {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        toolbar.setAttribute('part', 'toolbar');
        this.rootEl.appendChild(toolbar);
        this.toolbarEl = toolbar;

        const zoomOutBtn = this.makeButton('zoom-out', 'Zoom out');
        toolbar.appendChild(zoomOutBtn);

        const zoomLabel = document.createElement('span');
        zoomLabel.className = 'zoom-label';
        zoomLabel.textContent = '100%';
        toolbar.appendChild(zoomLabel);
        this.zoomLabelEl = zoomLabel;

        const zoomInBtn = this.makeButton('zoom-in', 'Zoom in');
        toolbar.appendChild(zoomInBtn);
        const zoomResetBtn = this.makeButton('rotate-ccw', 'Reset zoom');
        toolbar.appendChild(zoomResetBtn);
        const fitWidthBtn = this.makeButton('stretch-horizontal', 'Fit image to viewport width');
        toolbar.appendChild(fitWidthBtn);
        this.fitWidthBtn = fitWidthBtn;

        zoomOutBtn.addEventListener('click', () => this.setZoom(this.zoomScale / 1.25));
        zoomInBtn.addEventListener('click', () => this.setZoom(this.zoomScale * 1.25));
        zoomResetBtn.addEventListener('click', () => this.setZoom(1));
        fitWidthBtn.addEventListener('click', () => {
            this.fitWidthEnabled = !this.fitWidthEnabled;
            if (this.fitWidthEnabled) this.applyFitWidth();
            this.updateFitWidthButton();
        });
        this.updateFitWidthButton();

        // Nothing to toggle with zero or one layer - same threshold
        // atelierView.ts's old inline checkbox row used.
        if (layerCount > 1) {
            const layerBtn = this.makeButton('layers', 'Toggle layers');
            layerBtn.setAttribute('aria-pressed', 'false');
            layerBtn.addEventListener('click', () => this.toggleLayerSidebar());
            toolbar.appendChild(layerBtn);
            this.layerToggleBtn = layerBtn;
        }
    }

    private makeButton(icon: IconName, label: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('part', 'button');
        btn.setAttribute('aria-label', label);
        this.renderIcon(icon, btn);
        return btn;
    }

    private toggleLayerSidebar(): void {
        this.layerSidebarOpen = !this.layerSidebarOpen;
        this.layerSidebarEl?.classList.toggle('open', this.layerSidebarOpen);
        this.layerToggleBtn?.setAttribute('aria-pressed', String(this.layerSidebarOpen));
    }

    // Builds the layer sidebar's rows (via the portable
    // src/render/sidebarList.ts, shared with SupernoteViewerElement's own
    // page-thumbnail sidebar) and eagerly composites every layer's own
    // thumbnail in parallel - unlike that page sidebar, this skips
    // setupLazyListLoading()'s IntersectionObserver/debounce machinery
    // entirely: a .spd file only ever has a handful of layers, so there's
    // nothing worth lazy-loading (see sidebarList.ts's own header comment,
    // which anticipated exactly this use case).
    private buildLayerSidebarRows(layers: AtelierLayerOption[], token: number): void {
        const sidebar = this.layerSidebarEl;
        if (!sidebar || this.nativeWidth <= 0 || this.nativeHeight <= 0) return;

        const invertColorsWhenDark = this.hasAttribute('invert-dark');
        const specs = layers.map((layer) => ({
            label: layer.label,
            checkbox: {
                checked: this.visibleSurfaces.has(layer.surfaceName),
                // updateImage() below re-composites via compositeSurfaces()
                // (workerClient.composite() by default) - real work happens
                // on the worker's own thread, so this handler itself stays
                // cheap (just a postMessage) and returns immediately; no
                // setTimeout/macrotask deferral needed to keep it off the
                // browser's "long handler" radar, unlike an earlier version
                // of this that ran compositeImage() directly on the main
                // thread (see openSpd/compositeSurfaces' own comment).
                onChange: (checked: boolean) => {
                    if (checked) this.visibleSurfaces.add(layer.surfaceName);
                    else this.visibleSurfaces.delete(layer.surfaceName);
                    void this.updateImage(this.renderToken);
                },
            },
        }));

        this.layerItems = buildSidebarList(sidebar, specs, {
            thumbnailAspectRatio: { width: this.nativeWidth, height: this.nativeHeight },
            invertColorsWhenDark,
        });

        for (const [index, layer] of layers.entries()) {
            void (async () => {
                let composite: AtelierComposite | null;
                try {
                    composite = await this.compositeSurfaces([layer.surfaceName]);
                } catch (err) {
                    console.error(`supernote-atelier-viewer: layer "${layer.label}" thumbnail failed to render`, err);
                    return;
                }
                if (token !== this.renderToken || !composite) return;
                const item = this.layerItems[index];
                if (item) fillSidebarThumbnail(item, composite.dataUrl);
            })();
        }
    }

    private setZoom(newScale: number, opts: { manual?: boolean } = {}): void {
        const isManual = opts.manual !== false;
        if (isManual) {
            this.fitWidthEnabled = false;
            this.updateFitWidthButton();
        }

        // Same split SupernoteViewerElement's setZoom uses: fit-width can
        // legitimately need a wide range (a small native image on a large/
        // high-DPI display), while manual zoom gets a tighter sanity cap.
        const ceiling = isManual ? 5 : 20;
        this.zoomScale = Math.min(ceiling, Math.max(0.05, newScale));
        if (this.zoomLabelEl) this.zoomLabelEl.textContent = `${Math.round(this.zoomScale * 100)}%`;

        if (this.imageEl && this.nativeWidth > 0) {
            this.imageEl.style.width = `${this.nativeWidth * this.zoomScale}px`;
            this.imageEl.style.maxWidth = 'none';
        }
    }

    // Scales the image so its rendered width matches however much
    // horizontal space is actually available in .image-wrapper.
    private applyFitWidth(): void {
        if (this.nativeWidth <= 0 || !this.imageWrapperEl) return;
        const style = getComputedStyle(this.imageWrapperEl);
        const availableWidth = this.imageWrapperEl.clientWidth
            - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
        if (availableWidth <= 0) return;
        this.setZoom(availableWidth / this.nativeWidth, { manual: false });
    }

    private updateFitWidthButton(): void {
        this.fitWidthBtn?.setAttribute('aria-pressed', String(this.fitWidthEnabled));
    }

    // Re-composites just the visible surfaces and swaps the <img> src -
    // reused for both the initial render and every layer-toggle click, so
    // a toggle mid-render can't leave the image out of sync with the
    // checkboxes. A composite failure here is reported via
    // supernote-atelier-error with `recomposite: true` (non-fatal, mirrors
    // SupernoteViewerElement's own per-page `pageNumber`-set errors) - the
    // very first call (from render(), before the file is considered fully
    // "loaded") is the one exception: see render()'s own comment for why
    // supernote-atelier-load still fires either way once parsing itself
    // succeeded.
    private async updateImage(token: number): Promise<void> {
        if (!this.imageEl) return;

        let composite: AtelierComposite | null;
        try {
            composite = await this.compositeSurfaces(this.visibleSurfaces);
        } catch (err) {
            if (token !== this.renderToken) return;
            console.error('supernote-atelier-viewer: failed to composite layers', err);
            this.showStatus(`Failed to render layers: ${err instanceof Error ? err.message : String(err)}`, true);
            this.dispatchEvent(new CustomEvent('supernote-atelier-error', { detail: { error: err, recomposite: true } }));
            return;
        }
        if (token !== this.renderToken) return;

        if (composite === null) {
            this.imageEl.style.display = 'none';
            this.showStatus(this.visibleSurfaces.size === 0 ? 'No layers selected.' : 'This .spd file has no drawn content.');
            return;
        }

        this.hideStatus();
        this.imageEl.style.display = 'block';
        this.imageEl.src = composite.dataUrl;

        // Composite dimensions are shared across every surface in the file
        // (see AtelierComposite's own doc comment), so this only needs
        // setting - and fit-width only needs applying - once, on the load
        // that first discovers them, not on every subsequent re-composite.
        if (this.nativeWidth === 0) {
            this.nativeWidth = composite.width;
            this.nativeHeight = composite.height;
            this.applyFitWidth();
        }
    }

    private showStatus(message: string, isError = false): void {
        if (!this.statusEl) {
            const status = document.createElement('div');
            status.className = 'status';
            // Appended to rootEl directly during the initial "Loading…"
            // state (before imageWrapperEl exists yet); once it does,
            // later calls append inside it instead so the status sits
            // where the image will end up, not above the toolbar.
            (this.imageWrapperEl ?? this.rootEl).appendChild(status);
            this.statusEl = status;
        }
        this.statusEl.classList.toggle('error', isError);
        this.statusEl.textContent = message;
        this.statusEl.style.display = '';
    }

    private hideStatus(): void {
        if (this.statusEl) this.statusEl.style.display = 'none';
    }

    private handleLoadError(err: unknown): void {
        this.showStatus(`Failed to load Supernote Atelier file: ${err instanceof Error ? err.message : String(err)}`, true);
        this.dispatchEvent(new CustomEvent('supernote-atelier-error', { detail: { error: err } }));
    }

    // Mirrors SupernoteViewerElement.ts's own setupHostGestureOptOut()
    // exactly - same issue #204 fix, same reasoning (Obsidian's mobile
    // shell reads a plain, literal "true" string on the *host* element's
    // own dataset, not anything inside this shadow root, to decide whether
    // to let a pull-down/swipe gesture pass through to this element's own
    // internal scrolling instead of hijacking it) - see that method's own
    // comment for the full explanation this one intentionally doesn't
    // repeat. Registered once, here in the constructor - not per render()/
    // buildViewer() call - reading this.imageWrapperEl fresh at event time
    // instead of closing over one specific element, so repeated file loads
    // (each of which replaces imageWrapperEl) don't stack up a fresh
    // listener on rootEl every time.
    private setupHostGestureOptOut(): void {
        this.rootEl.addEventListener('touchstart', () => {
            const scrollEl = this.imageWrapperEl;
            const blocksPalettePull = !!scrollEl && scrollEl.scrollTop > 0;
            const blocksSidebarSwipe = !!scrollEl && scrollEl.scrollWidth > scrollEl.clientWidth + 50;
            if (blocksPalettePull || blocksSidebarSwipe) this.setAttribute('data-ignore-swipe', 'true');
            else this.removeAttribute('data-ignore-swipe');
        }, { passive: true });
    }
}

if (!customElements.get('supernote-atelier-viewer')) {
    customElements.define('supernote-atelier-viewer', SupernoteAtelierViewerElement);
}

// Same "give createElement()/createEl() the real type back" convention as
// SupernoteViewerElement.ts's own identical declaration - see that file's
// own comment for the full explanation.
declare global {
    interface HTMLElementTagNameMap {
        'supernote-atelier-viewer': SupernoteAtelierViewerElement;
    }
}
