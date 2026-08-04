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
import { ILink, SupernoteX } from 'supernote-typescript';
import { ImageConverter } from '../render/imageConverter';
import { RenderedNotePage, buildNotePagePlaceholders, evictNotePageImage, fillNotePagePlaceholder, parseNote } from '../render/noteRenderer';
import { WordOverlayEntry, buildWordOverlay, buildWordSearchText, repositionWordOverlay } from '../render/wordOverlay';
import { LinkOverlayEntry, bucketLinksByPage, buildLinkOverlay, repositionLinkOverlay } from '../render/linkOverlay';
import { SidebarListItem, buildSidebarList, fillSidebarThumbnail, setupLazyListLoading } from '../render/sidebarList';

interface ViewerPageState extends RenderedNotePage {
    textEl: HTMLElement;
    // Stashed alongside textEl (rather than re-reading sn.pages each time)
    // so renderPageTextHighlights() can rebuild textEl's content - wrapping
    // the current match range in a <mark> - from the same string every
    // time, without needing the original SupernoteX instance around.
    rawText: string;
    wordEntries: WordOverlayEntry[];
    linkEntries: LinkOverlayEntry[];
    loaded: boolean;
    visible: boolean;
}

interface FindMatch {
    pageIndex: number;
    // Offsets into that page's search text (see buildWordSearchText) - and,
    // since that text is character-identical to page.text (confirmed by a
    // dedicated wordOverlay.test.ts test), also directly usable as offsets
    // into rawText above for highlighting matches in recognized-text mode,
    // where there's no image/overlay-span geometry to point to at all.
    start: number;
    end: number;
    // The overlay span for the word the match started in - used for
    // image-mode highlighting/scrolling. Always non-null (see runFind()):
    // a match whose start landed on a boxless word is discarded rather than
    // kept with a null entry, since text mode's <mark> highlighting still
    // needs a real word to point to for image-mode's own highlight.
    entry: WordOverlayEntry;
}

interface PageSearchEntry {
    lower: string;
    entryAt: (offset: number) => WordOverlayEntry | undefined;
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
/* The dark attribute is a tri-state, not a plain boolean, and the two
   rules below are an override, not an OR - getting this wrong (an earlier
   version of this file did) is a real, confirmed bug: a host whose OS-level
   color scheme happens to be dark while the host itself is actually
   rendering light (e.g. Obsidian set to its light theme on a system whose
   OS is set to dark - a completely ordinary, common combination, not an
   edge case) would otherwise still get this media-query guess applied
   underneath, on top of whatever the host explicitly asked for - inverting
   page images and swapping colors to dark even though the surrounding page
   is light, making handwriting strokes invisible against it.
     - attribute absent entirely: follow the OS-level guess below
     - attribute present, value anything other than the string false
       (including the attribute with no value at all): force dark
     - attribute present with value exactly false: force light, regardless
       of what the OS guess would otherwise say
   Obsidian's SupernoteEmbed (main.ts) always explicitly sets one of the
   latter two - see updateDarkAttribute() - specifically so its actual
   theme-dark/theme-light state always wins over the OS guess in both
   directions, not just the force-dark one.

   :not() has to be nested *inside* :host()'s own argument list -
   :host([dark]:not([dark="false"])), not :host([dark]):not([dark="false"])
   chained after it - confirmed by testing directly: the chained form
   parses without error and CSS.supports() even reports it as a supported
   selector, but silently never matches anything, in a bare, from-scratch
   shadow root as well as this real component - not specific to anything
   else going on here. */
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
.zoom-label {
    min-width: 3.5em;
    text-align: center;
    color: var(--supernote-viewer-muted);
    font-size: 0.9em;
}
.find-bar {
    display: none;
    align-items: center;
    gap: 0.5em;
    padding: 0.4em 0.6em;
    background: var(--supernote-viewer-bg);
    border-bottom: 1px solid var(--supernote-viewer-border);
}
.find-bar.open {
    display: flex;
}
.find-bar input {
    flex: 1;
    min-width: 0;
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid var(--supernote-viewer-border);
    border-radius: 4px;
    padding: 0.2em 0.5em;
}
.find-count {
    min-width: 5em;
    color: var(--supernote-viewer-muted);
    font-size: 0.9em;
    white-space: nowrap;
}
/* Overlays .pages (position: absolute against .root's own position:
   relative above) rather than sharing a flex row with it - the same
   lesson SupernoteView's own thumbnail sidebar already learned the hard
   way (issue #179): if opening/closing this changed how much width .pages
   itself got, fit-width would re-render every page's size against that,
   reflowing the whole note and bouncing whatever page was currently in
   view. Overlaying instead means toggling this never affects .pages'
   own width at all. "top" is set from JS (see
   updateThumbSidebarOffset()) to sit just below the toolbar/find-bar,
   since neither is a fixed, CSS-only height (the find bar toggles
   open/closed, changing the total header height beneath which this
   should start). */
.thumb-sidebar {
    display: none;
    position: absolute;
    left: 0;
    z-index: 2;
    flex-direction: column;
    width: 140px;
    max-height: calc(100% - 1em);
    margin: 0.5em;
    overflow-y: auto;
    gap: 0.6em;
    padding: 0.5em;
    background: var(--supernote-viewer-bg);
    border: 1px solid var(--supernote-viewer-border);
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    box-sizing: border-box;
}
.thumb-sidebar.open {
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
.sidebar-list-item.is-active {
    border-color: var(--supernote-viewer-fg);
}
.sidebar-list-thumb {
    display: block;
    width: 100%;
    border-radius: 2px;
}
.sidebar-list-label {
    display: block;
    margin-top: 0.25em;
    color: var(--supernote-viewer-muted);
    font-size: 0.85em;
}
.sidebar-list-checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.4em;
    cursor: pointer;
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
    position: relative;
    max-width: 100%;
}
/* Zoom (see setZoom()/applyFitWidth()) needs a page to be able to render
   wider than .pages' own available width - a manually zoomed-in page
   should overflow (enabling .pages' own overflow: auto to scroll to it),
   not get silently capped back down to "fit" regardless of the requested
   zoom level. Single-page mode has no zoom controls at all (see
   buildSinglePageViewer()) and still wants its one page capped to
   whatever width is actually available, same as any other loaded,
   non-zoomed page always was - so this override is scoped to normal
   (non-single-page) mode only, leaving the plain max-width: 100% above as
   single-page mode's only sizing rule. */
:host(:not([single-page])) .pages .page-container {
    max-width: none;
}
.pages .page-container > img {
    display: block;
    max-width: 100%;
}
/* A not-yet-loaded or evicted img (buildNotePagePlaceholders()/
   evictNotePageImage() in noteRenderer.ts) deliberately has no src
   attribute at all, not even an empty one - but it's still given an
   explicit box size via inline width/aspect-ratio (see those functions'
   own comments for why: so the page list's scroll height is correct
   before any image has loaded). Confirmed via direct screenshot during a
   reliably-reproducible report: Chromium paints its generic "broken
   image" glyph for any img with a defined layout box and no image
   content, regardless of whether a src was ever set or a request ever
   failed - no error event fires for this (confirmed separately), it's
   just the browser's default rendering for "sized replaced element,
   nothing to show". img:not([src]) hides that glyph while leaving the
   reserved box itself (and thus the scroll-height math) untouched -
   visibility: hidden, not display: none, for exactly that reason. */
.pages .page-container > img:not([src]) {
    visibility: hidden;
}
/* Invisible-by-default per-word overlay (see src/render/wordOverlay.ts) -
   positioned absolutely over the page image/placeholder using the same
   container this rule's own position: relative above establishes. Text
   itself is never shown (color: transparent) - this exists purely so
   find-in-note has something to search and a box to highlight, not to
   render a visible/selectable text layer (that's what "recognized text"
   mode, toggled by the Aa button, already does). */
.word-overlay-span {
    position: absolute;
    color: transparent;
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
}
.word-overlay-span.word-overlay-match {
    background: rgba(255, 214, 0, 0.45);
}
.word-overlay-span.word-overlay-match-current {
    background: rgba(255, 128, 0, 0.7);
}
/* Recognized-text mode hides the image entirely (see the img rule just
   below), which collapses .page-container to the text block's own height -
   nothing like the image's native aspect ratio the word-overlay spans
   above are positioned against. Left visible, a match's highlighted span
   would render as a stray colored box floating at whatever nonsensical
   position that mismatched scaling produces. Text-mode matches are
   highlighted a different way entirely (see the <mark> rules below, and
   renderPageTextHighlights() in SupernoteViewerElement.ts), so the
   image-mode spans have nothing useful to do here regardless. */
.pages.mode-text .word-overlay-span {
    display: none;
}
/* Clickable overlay for Supernote internal links (see
   src/render/linkOverlay.ts and handleLinkClick() below) - positioned
   absolutely over the page image using the same container's position:
   relative, same convention as .word-overlay-span above. Unlike that span,
   this is meant to be seen and clicked (a visible hover highlight, real
   pointer events - no pointer-events: none override needed here the way
   .word-overlay-span has, since an <a> already defaults to receiving
   them). */
.link-overlay-rect {
    position: absolute;
    display: block;
    border-radius: 2px;
    cursor: pointer;
    background: transparent;
    transition: background-color 0.1s ease;
}
.link-overlay-rect:hover {
    background: color-mix(in srgb, var(--supernote-viewer-muted) 35%, transparent);
}
/* Text mode reflows this page's content into a column with nothing like
   the image's native pixel layout the link rects above are positioned
   against (same reasoning as the word-overlay-span rule above, and the
   same behavior main.ts's own SupernoteView already has for its link
   overlay in text/layer mode) - no natural position to anchor a link rect
   to once the text is reflowed, so it's hidden entirely rather than left
   floating at a stale position. */
.pages.mode-text .link-overlay-rect {
    display: none;
}
.pages.mode-text .page-container > img {
    display: none;
}
/* Left-aligned, not centered (.pages' own align-items: center, meant for
   image mode's varying page widths) - confirmed as a real, reported
   readability complaint: centered text columns whose width also varies
   per page (see the fixed-width rule just below for why that varied)
   made scrolling through recognized text distracting, each page
   drifting to a different horizontal position as well as a different
   width. */
.pages.mode-text {
    align-items: flex-start;
}
/* A fixed width, not auto - !important, not just specificity, because
   this overrides an *inline* style (buildNotePagePlaceholders()/
   fillNotePagePlaceholder() in noteRenderer.ts, set directly on
   .style.width - no selector can ever outrank that without it). That
   inline width is a placeholder-sizing trick for the still-hidden <img>
   above (see those functions' own comments), reserving a full-width box
   before the real image loads so .pages' scroll height is correct - but
   text mode never shows that img at all.
   Originally just "auto" here (shrink-to-fit .page-text's own content),
   which did stop a background image load from visibly resizing this
   box (see that fix's own history) but turned out to have its own
   readability problem: shrink-to-fit sizes to each page's own longest
   wrapped line, so a page of short lines produced a genuinely narrower
   box than a page that wrapped all the way out to .page-text's
   max-width: 40em below - a different width per page, confirmed as a
   real, reported distraction while scrolling. A fixed width - matching
   that same max-width, so .page-text (block, no explicit width of its
   own) fills it exactly via ordinary block layout, capped again by
   min(...,100%) so a narrow host viewport isn't overflowed - gives
   every page the same box regardless of its own text's line lengths. */
.pages.mode-text .page-container {
    width: min(40em, 100%) !important;
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
/* Recognized-text mode's own match highlighting (see
   renderPageTextHighlights()) - same colors as the image-mode
   word-overlay-match/-current classes above, for one consistent look
   regardless of which mode find-in-note is used in. color: inherit
   overrides <mark>'s default black text, which would be unreadable
   against this element's own dark-mode text color. */
.page-text mark.find-match {
    background: rgba(255, 214, 0, 0.45);
    color: inherit;
}
.page-text mark.find-match-current {
    background: rgba(255, 128, 0, 0.7);
    color: inherit;
}
/* Only actually inverted in dark mode, mirroring the "invert-dark" attribute
   -> "only when the environment is dark" two-part condition the Obsidian
   plugin's own invertColorsWhenDark setting has (see main.ts's
   SupernoteEmbed) - the attribute alone is "opt in to inversion", not
   "always invert". The dark attribute's override (not OR) semantics are
   exactly the same as the :host color-variable rules above, and for the
   same reason: without the :not([dark])/[dark="false"] guards, a
   light-themed host on a dark-OS system would still get its page images
   inverted underneath it, same bug as the border/background colors
   above. */
@media (prefers-color-scheme: dark) {
    :host(:not([dark])) .pages .page-container > img.supernote-invert-dark {
        filter: invert(1);
    }
}
:host([dark]:not([dark="false"])) .pages .page-container > img.supernote-invert-dark {
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
    private pageLoadObserver: IntersectionObserver | null = null;
    // Shared across every page - see setupPageLoadObserver()'s own comment
    // for why loading needs one debounce for "has scrolling settled" rather
    // than each page tracking its own independently.
    private loadCheckDebounceTimer?: number;
    // Manual debugging aid only - see debugLoopEvictReload().
    private debugLoopTimer?: number;
    private resizeObserver: ResizeObserver | null = null;
    // Separate from resizeObserver above (which watches each *page's own*
    // rendered size, for word-overlay repositioning) - this one watches
    // .pages itself, so fit-width can recompute when the *viewport*
    // resizes (a split pane, a sidebar opening/closing, the window itself),
    // not just when a page's own size happens to change.
    private pagesResizeObserver: ResizeObserver | null = null;
    private fitWidthDebounceTimer?: number;
    private pageStates: ViewerPageState[] = [];
    private currentPage = 0;
    private pageIndicatorScrollScheduled = false;
    private mode: 'image' | 'text' = 'image';
    private sn: SupernoteX | null = null;
    private renderQueued = false;
    private renderToken = 0;
    private _noteData: ArrayBuffer | Uint8Array | null = null;
    private findBarEl: HTMLElement | null = null;
    private findInputEl: HTMLInputElement | null = null;
    private findCountEl: HTMLElement | null = null;
    private findToggleBtn: HTMLButtonElement | null = null;
    private pageSearchIndex: PageSearchEntry[] = [];
    private findMatches: FindMatch[] = [];
    private findMatchIndex = -1;
    private thumbSidebarEl: HTMLElement | null = null;
    private thumbToggleBtn: HTMLButtonElement | null = null;
    private thumbItems: SidebarListItem[] = [];
    private thumbLoadObserver: IntersectionObserver | null = null;
    private thumbnailsVisible = false;
    // "100%" is one rendered pixel per native rasterized page pixel
    // (sn.pageWidth), not anything tied to the available viewport width -
    // see applyFitWidth() for the mode that actually fills whatever space
    // is available. Zoom/fit-width apply only in normal (non-single-page)
    // mode - see the :host(:not([single-page])) CSS override above.
    private zoomScale = 1;
    private fitWidthEnabled = true;
    private zoomLabelEl: HTMLElement | null = null;
    private fitWidthBtn: HTMLButtonElement | null = null;

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
        this.pageLoadObserver?.disconnect();
        this.resizeObserver?.disconnect();
        this.thumbLoadObserver?.disconnect();
        window.clearTimeout(this.loadCheckDebounceTimer);
        window.clearInterval(this.debugLoopTimer);
        this.pagesResizeObserver?.disconnect();
        window.clearTimeout(this.fitWidthDebounceTimer);
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
        if (this.pageStates.length === 0 || !this.sn || !this.pagesEl) return;
        const clamped = Math.min(Math.max(Math.round(pageNumber), 1), this.pageStates.length);
        const state = this.pageStates[clamped - 1];
        // Deliberately NOT state.containerEl.scrollIntoView(): that method
        // cascades up through *every* scrollable ancestor, not just this
        // component's own .pages, so it also scrolled a host page this
        // element is embedded inside (e.g. Obsidian's own note editor, for
        // SupernoteEmbed) to bring this element as close to the top of
        // *that* outer viewport as possible too - confirmed as a real,
        // reported annoyance: clicking the toolbar's "next page" button
        // scrolled the whole host note, dragging the toolbar (and the very
        // button just clicked) out of view along with it. Computing the
        // target's position relative to .pages via getBoundingClientRect()
        // and scrolling .pages directly only ever touches this component's
        // own internal scroll position, regardless of what it's embedded
        // inside - getBoundingClientRect() rather than offsetTop since the
        // latter's offsetParent resolution isn't reliable across a shadow
        // root boundary.
        const pagesRect = this.pagesEl.getBoundingClientRect();
        const targetRect = state.containerEl.getBoundingClientRect();
        const targetTop = this.pagesEl.scrollTop + (targetRect.top - pagesRect.top);
        this.pagesEl.scrollTo({ top: targetTop, behavior: 'smooth' });
        // Marked visible before forcing the load (not just left to whatever
        // the observer last reported) - a jump can target a page nowhere
        // near the current scroll position, still mid-animation and not
        // actually intersecting yet, which ensurePageImageLoaded()'s own
        // scrolled-away-mid-load guard would otherwise mistake for exactly
        // that: a page that's since become irrelevant, discarding the
        // result instead of finishing the load. Mirrors SupernoteView's own
        // goToPage()/highlightCurrentMatch() in main.ts, which set
        // visibleInMainView = true for the same reason before their own
        // forced loads.
        state.visible = true;
        if (!state.loaded) void this.ensurePageImageLoaded(this.sn, state);
    }

    // Manual debugging aid for a report that's hard to reproduce
    // second-hand (e.g. a broken-image icon or a page that won't reload
    // seen on someone else's machine) - dumps every page's own load/
    // visibility bookkeeping alongside its <img>'s actual DOM state, so a
    // mismatch between the two (the most likely shape of that kind of bug)
    // is visible directly rather than needing to guess from a screenshot.
    // Call from the browser DevTools console, e.g.:
    //   document.querySelectorAll('supernote-viewer').forEach(v => v.debugDumpPageStates())
    debugDumpPageStates(): void {
        console.debug(`supernote-viewer: ${this.pageStates.length} page(s), mode=${this.mode}`);
        for (const state of this.pageStates) {
            const img = state.imageEl;
            console.debug(
                `  page ${state.pageNumber}: loaded=${state.loaded} visible=${state.visible} ` +
                `img.hasAttribute('src')=${img.hasAttribute('src')} img.src=${JSON.stringify(img.src.slice(0, 50))} ` +
                `naturalWidth=${img.naturalWidth} naturalHeight=${img.naturalHeight} complete=${img.complete}`,
            );
        }
    }

    // Manual debugging aid for a reliably-seen but hard-to-catch
    // broken-image report: repeatedly loads then evicts one page on a fixed
    // interval, isolating the load/evict *logic* itself from any real
    // scrolling, so a user can just watch (or screen-record) that one page
    // without needing to reproduce a specific scroll gesture at all. Each
    // cycle goes through the real rasterizePage()/worker pipeline (eviction
    // via removeAttribute() means there's no cached data URL to reuse - see
    // evictNotePageImage()'s own comment), so this genuinely re-exercises
    // the browser's own decode path every time, in case a large data URL
    // assigned to img.src shows as transiently "broken" while still
    // decoding rather than only on a genuine failed load (an open
    // hypothesis raised against this specific report). If that hypothesis
    // is right, the existing <img> `error` listener in
    // buildNotePagePlaceholders() should stay silent throughout even if the
    // image looks broken on screen - a failed load isn't the only way to
    // get a broken-image icon on screen; a decode error while the src IS
    // valid can also blank the image before the natural size is known,
    // though that's not the same DOM state a *failed* load produces. Call
    // from DevTools:
    //   document.querySelectorAll('supernote-viewer').forEach(v => v.debugLoopEvictReload(1))
    // Stop with:
    //   document.querySelectorAll('supernote-viewer').forEach(v => v.debugStopLoop())
    debugLoopEvictReload(pageNumber: number, intervalMs = 800): void {
        if (!this.sn) return;
        const sn = this.sn;
        const state = this.pageStates[pageNumber - 1];
        if (!state) return;
        window.clearInterval(this.debugLoopTimer);
        let evictNext = state.loaded;
        this.debugLoopTimer = window.setInterval(() => {
            if (evictNext) {
                this.evictPageImage(sn, state);
            } else {
                state.visible = true;
                void this.ensurePageImageLoaded(sn, state);
            }
            evictNext = !evictNext;
        }, intervalMs);
    }

    debugStopLoop(): void {
        window.clearInterval(this.debugLoopTimer);
        this.debugLoopTimer = undefined;
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
            // pageIds lets a host resolve a link-click whose target names
            // this same note explicitly (see handleLinkClick() above) -
            // this component only resolves the *un-named* same-note case
            // itself, since it has no concept of "my own filename" to
            // compare a link's target against; a host that does know its
            // own file's name can match it here without re-parsing the
            // note a second time just to get this list.
            detail: { pageCount: sn.pages.length, pageWidth: sn.pageWidth, pageHeight: sn.pageHeight, pageIds: sn.pages.map((p) => p.PAGEID ?? '') },
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
        this.pageLoadObserver?.disconnect();
        this.pageLoadObserver = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.thumbLoadObserver?.disconnect();
        this.thumbLoadObserver = null;
        window.clearTimeout(this.loadCheckDebounceTimer);
        window.clearInterval(this.debugLoopTimer);
        this.pagesResizeObserver?.disconnect();
        this.pagesResizeObserver = null;
        window.clearTimeout(this.fitWidthDebounceTimer);
        this.pageStates = [];
        this.pagesEl = null;
        this.toolbarEl = null;
        this.pageIndicatorEl = null;
        this.modeToggleBtn = null;
        this.currentPage = 0;
        this.pageIndicatorScrollScheduled = false;
        this.mode = 'image';
        this.sn = null;
        this.findBarEl = null;
        this.findInputEl = null;
        this.findCountEl = null;
        this.findToggleBtn = null;
        this.pageSearchIndex = [];
        this.findMatches = [];
        this.findMatchIndex = -1;
        this.thumbSidebarEl = null;
        this.thumbToggleBtn = null;
        this.thumbItems = [];
        this.thumbnailsVisible = false;
        this.zoomScale = 1;
        this.fitWidthEnabled = true;
        this.zoomLabelEl = null;
        this.fitWidthBtn = null;
        this.rootEl.innerHTML = '';
    }

    private buildViewer(sn: SupernoteX): void {
        // Clears the "Loading…" status showStatus() left in rootEl - without
        // this, real content just gets appended alongside it instead of
        // replacing it, leaving that message stuck visible indefinitely.
        this.rootEl.innerHTML = '';

        const invertColorsWhenDark = this.hasAttribute('invert-dark');

        if (this.hasAttribute('single-page')) {
            this.buildSinglePageViewer(sn, invertColorsWhenDark);
            return;
        }

        const pageCount = sn.pages.length;
        // The toolbar itself (mode toggle + find) is worth having even for
        // a single-page document - only the prev/next-page arrows and page
        // indicator inside it are conditioned on pageCount > 1 (see
        // buildToolbar()), since there's nowhere else to navigate to.
        this.buildToolbar(pageCount);
        this.buildFindBar();

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
        this.pageSearchIndex = states.map((state) => {
            const { text, entryAt } = buildWordSearchText(state.wordEntries);
            return { lower: text.toLowerCase(), entryAt };
        });

        this.setupPageLoadObserver(sn, states);
        if (pageCount > 1) {
            this.setupPageIndicatorTracking();
            this.buildThumbSidebar(sn, pageCount);
        }
        this.setupOverlayResizing(sn, states);

        // Matches SupernoteView's own onLoadFile() ordering: build pages,
        // then apply whichever zoom state is active before first paint - no
        // separate "flash of 100%/native size" in between, since nothing
        // yields to the event loop here.
        if (this.fitWidthEnabled) this.applyFitWidth();
        else this.applyZoomToPages();
        this.setupZoomWheelHandling();
        this.setupFitWidthResizing();
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
        this.setupOverlayResizing(sn, this.pageStates);
        // Single-page mode has no IntersectionObserver at all (nothing else
        // to scroll to), so nothing else would ever mark this page visible -
        // needed so ensurePageImageLoaded()'s scrolled-away-mid-load guard
        // doesn't mistake this one-and-only page for one that's since
        // become irrelevant.
        state.visible = true;
        void this.ensurePageImageLoaded(sn, state);
    }

    // Builds each placeholder's recognized-text sibling and the rest of its
    // ViewerPageState - shared by the normal (all-pages, lazy) and
    // single-page (one page, eager) construction paths above.
    private wrapPageStates(sn: SupernoteX, placeholders: RenderedNotePage[]): ViewerPageState[] {
        // Bucketed once for the whole call, not per page - see
        // bucketLinksByPage()'s own doc comment for why the key-prefix
        // convention it implements is the reliable way to find which page a
        // link is drawn on.
        const linksByPage = bucketLinksByPage(sn.links);

        return placeholders.map((page) => {
            const notePage = sn.pages[page.pageNumber - 1];
            const rawText = notePage?.text ?? '';
            const textEl = document.createElement('div');
            textEl.className = 'page-text';
            textEl.classList.toggle('empty', rawText.length === 0);
            textEl.textContent = rawText.length > 0 ? rawText : 'No recognized text on this page.';
            page.containerEl.appendChild(textEl);

            // Built unconditionally (even in single-page mode, which has no
            // find UI to consume it) - cheap, keeps "this page's word
            // overlay is built and correctly positioned" a plain invariant
            // rather than something a caller needs to check the render mode
            // to reason about.
            const wordEntries = notePage ? buildWordOverlay(notePage, page.containerEl, page.pageNumber) : [];

            const linkEntries = buildLinkOverlay(linksByPage.get(page.pageNumber - 1) ?? [], page.containerEl);
            for (const entry of linkEntries) {
                entry.el.addEventListener('click', (evt) => {
                    evt.preventDefault();
                    this.handleLinkClick(entry.link);
                });
            }

            return { ...page, textEl, rawText, wordEntries, linkEntries, loaded: false, visible: false };
        });
    }

    // A clicked link region's target: a same-note page jump (resolvable
    // entirely from this note's own parsed pages, no host/vault knowledge
    // needed at all) when the link carries no filename of its own - per
    // ILink.text's own doc comment, a same-file page anchor is already
    // resolved to bare "#Page N" with nothing before the '#', unlike a
    // cross-file link, which names the target note explicitly. Anything
    // else - a link naming another file, or a same-file link whose PAGEID
    // doesn't resolve to any page this note actually has - needs
    // information this portable component doesn't have (which vault file a
    // name belongs to, how to open it), so it's handed off entirely via the
    // `link-click` event instead: matches issue #183's own phased plan,
    // "component renders/detects the clickable regions; navigation decision
    // ... stays with whoever's listening". Mirrors SupernoteView's own
    // handleLinkClick() (main.ts) for the part that *is* self-contained.
    private handleLinkClick(link: ILink): void {
        if (!this.sn) return;
        const targetBasename = link.text.split('#')[0];
        if (!targetBasename) {
            const pageIndex = this.sn.pages.findIndex((p) => p.PAGEID === link.PAGEID);
            if (pageIndex >= 0) {
                this.goToPage(pageIndex + 1);
                return;
            }
        }
        this.dispatchEvent(new CustomEvent<{ link: ILink }>('link-click', { detail: { link } }));
    }

    // Loads each page's image lazily, only once scrolling has actually
    // *settled* somewhere near it - rasterizing every page upfront made
    // even the first page wait on the whole document finishing (see issue
    // #183 and the same fix already applied to SupernoteEmbed in main.ts),
    // and loading eagerly on every single intersection change (an earlier
    // version of this method did) made a continuous scroll to the bottom
    // of a long document visibly rasterize *every* page along the way, in
    // order, well after each one had scrolled back out of view - a real,
    // reported bug. A page-scoped debounce (checking only "has this one
    // page been near the viewport for 150ms", the same pattern
    // SupernoteView's own pageObserver in main.ts uses) doesn't actually
    // fix that: state.visible reflects the *padded* rootMargin zone (100%
    // of .pages' own height above/below the real viewport), so a page can
    // stay "within margin" for 150ms+ even while a fast, *continuous*
    // scroll carries it straight through and back out again - confirmed
    // directly, tightening that check to the real, unpadded viewport (or
    // anywhere in between) made no difference at the scroll speeds that
    // actually trigger this, since each page genuinely does sit somewhere
    // in that zone around the 150ms mark either way. What actually
    // distinguishes "the user paused here" from "just passing through" is
    // whether *scrolling itself* has stopped, not any one page's own
    // timer - so this debounce is shared across every page and reset by
    // both intersection changes and every raw scroll event, only
    // re-evaluating (and loading) whatever's actually near the viewport
    // once neither has happened for a while. Also evicts a page's image
    // immediately (no debounce - see evictPageImage()'s own comment) once
    // it scrolls back *out* of the prefetch margin - loading lazily
    // instead of upfront already bounds memory by "how many pages are
    // near the viewport right now" rather than "how many have been
    // scrolled past so far", but without eviction that first bound only
    // ever grows monotonically as you keep scrolling through a long
    // document - exactly the memory-safety gap SupernoteView itself had
    // to fix once (issue #154) before this component existed, and would
    // otherwise silently reintroduce here.
    private setupPageLoadObserver(sn: SupernoteX, states: ViewerPageState[]): void {
        const scheduleLoadCheck = () => {
            window.clearTimeout(this.loadCheckDebounceTimer);
            this.loadCheckDebounceTimer = window.setTimeout(() => {
                for (const state of states) {
                    // A generous-but-not-huge buffer once settled (half a
                    // viewport height) - enough to prime the very next
                    // page ahead of actually reaching it, far short of the
                    // observer's own 100% prefetch margin that only exists
                    // to decide when a page is worth watching at all.
                    if (state.visible && !state.loaded && this.isPageNearScreen(state, 0.5)) {
                        void this.ensurePageImageLoaded(sn, state);
                    }
                }
            }, 150);
        };

        this.pageLoadObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const state = states.find((s) => s.containerEl === entry.target);
                if (!state) continue;
                state.visible = entry.isIntersecting;
                if (!entry.isIntersecting) this.evictPageImage(sn, state);
            }
            scheduleLoadCheck();
        }, { root: this.pagesEl, rootMargin: '100% 0px' });

        for (const state of states) this.pageLoadObserver.observe(state.containerEl);

        // The observer's own callbacks only fire on actual intersection
        // *transitions*, which can be sparse relative to how continuously
        // a real scroll gesture fires 'scroll' events - without this, a
        // long, unbroken scroll pass where nothing happens to enter/exit
        // the margin for a stretch could let the settle timer fire
        // mid-scroll instead of only once it actually stops.
        this.pagesEl?.addEventListener('scroll', scheduleLoadCheck, { passive: true });
    }

    // Real intersection with .pages' own visible bounds, padded by only
    // `marginRatio` x .pages' own height - unlike the pageLoadObserver's
    // own rootMargin: '100% 0px', which deliberately pads a much more
    // generous zone around the real viewport just to decide when a page is
    // worth starting to watch at all. See setupPageLoadObserver()'s own
    // comment for why the two need to be different checks.
    private isPageNearScreen(state: ViewerPageState, marginRatio: number): boolean {
        if (!this.pagesEl) return false;
        const pagesRect = this.pagesEl.getBoundingClientRect();
        const margin = pagesRect.height * marginRatio;
        const stateRect = state.containerEl.getBoundingClientRect();
        return stateRect.bottom > pagesRect.top - margin && stateRect.top < pagesRect.bottom + margin;
    }

    // Keeps the toolbar's page indicator in sync with whatever page is
    // actually scrolled into view. Deliberately a scroll listener that
    // recomputes from real, current getBoundingClientRect() geometry - see
    // updateCurrentPageIndicator() - rather than an IntersectionObserver,
    // after two related but distinct IntersectionObserver bugs surfaced via
    // real user testing on a 102-page note:
    //   - the observer's very first callback (fired once per .observe()
    //     call, reporting each target's *current* intersection state)
    //     isn't guaranteed to reflect settled layout for a freshly built,
    //     many-page placeholder list - it initially read "63 / 102",
    //     correcting itself only once a real, later, layout-settled update
    //     arrived.
    //   - scrolling *quickly* could report "102 / 102" (the very last
    //     page) mid-scroll, nowhere near the actual visible page - a fast
    //     scroll can cross several pages' 50% thresholds within the same
    //     batched callback, and "the last entry in that batch wins" has no
    //     guaranteed relationship to "the page actually on screen".
    // getBoundingClientRect() forces a fresh synchronous layout read every
    // time, so there's no equivalent staleness risk to patch around -
    // this is the same pattern (and for the same reason) SupernoteView's
    // own updateCurrentPageIndicator() in main.ts already uses.
    private setupPageIndicatorTracking(): void {
        if (!this.pagesEl) return;
        this.pagesEl.addEventListener('scroll', () => {
            if (this.pageIndicatorScrollScheduled) return;
            this.pageIndicatorScrollScheduled = true;
            window.requestAnimationFrame(() => {
                this.pageIndicatorScrollScheduled = false;
                this.updateCurrentPageIndicator();
            });
        }, { passive: true });
        // Sets the correct initial value immediately - synchronous, so
        // there's no window where a stale/default value could be shown
        // before real state is confirmed.
        this.updateCurrentPageIndicator();
    }

    private updateCurrentPageIndicator(): void {
        if (!this.pagesEl || this.pageStates.length === 0) return;
        const threshold = this.pagesEl.getBoundingClientRect().top + 1;

        let current = 0;
        for (let i = 0; i < this.pageStates.length; i++) {
            if (this.pageStates[i].containerEl.getBoundingClientRect().top <= threshold) {
                current = i;
            } else {
                break;
            }
        }

        this.currentPage = current;
        if (this.pageIndicatorEl) this.pageIndicatorEl.textContent = `${current + 1} / ${this.pageStates.length}`;
        this.highlightThumbnail(current);
    }

    // Keeps every page's word-overlay spans (see src/render/wordOverlay.ts)
    // and link-click rects (src/render/linkOverlay.ts) aligned with that
    // page's *currently rendered* CSS size - a ResizeObserver, not a
    // one-time measurement at build time, since a page's rendered size can
    // change after these are first positioned (a window resize, a host
    // layout change, or the placeholder's forced 100% width giving way to
    // the real image's natural size once it loads). Guarded for
    // environments without ResizeObserver (none known among real browsers
    // this targets, but costs nothing to check).
    private setupOverlayResizing(sn: SupernoteX, states: ViewerPageState[]): void {
        if (typeof ResizeObserver === 'undefined') return;
        const { pageWidth, pageHeight } = sn;
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const state = states.find((s) => s.containerEl === entry.target);
                if (!state) continue;
                const { width, height } = entry.contentRect;
                if (width <= 0 || height <= 0) continue;
                repositionWordOverlay(state.wordEntries, width, height, pageWidth, pageHeight);
                repositionLinkOverlay(state.linkEntries, width, height, pageWidth, pageHeight);
            }
        });
        for (const state of states) this.resizeObserver.observe(state.containerEl);
    }

    // Downsample factor for ensureThumbnailLoaded() below - the sidebar
    // only ever displays a thumbnail at ~140px CSS width (see
    // .sidebar-list-thumb), so a full-resolution rasterization would be
    // needless decode/memory cost for a preview this small. Mirrors
    // SupernoteView's own THUMBNAIL_SCALE (main.ts) exactly.
    private static readonly THUMBNAIL_SCALE = 4;

    // Builds the (initially closed - see .thumb-sidebar/.open) page
    // thumbnail sidebar: one item per page (via the portable
    // src/render/sidebarList.ts, built to be reusable by a future
    // Supernote Atelier/.spd layer-toggle view too - see that module's own
    // header comment), each lazily rasterized once it nears the sidebar's
    // own viewport. Only built for pageCount > 1 (see buildToolbar()) -
    // nothing to navigate to via thumbnails on a single-page document
    // either.
    private buildThumbSidebar(sn: SupernoteX, pageCount: number): void {
        const sidebar = document.createElement('div');
        sidebar.className = 'thumb-sidebar';
        sidebar.setAttribute('part', 'thumb-sidebar');
        this.rootEl.appendChild(sidebar);
        this.thumbSidebarEl = sidebar;

        const specs = Array.from({ length: pageCount }, (_, i) => ({ label: String(i + 1) }));
        this.thumbItems = buildSidebarList(sidebar, specs, {
            thumbnailAspectRatio: { width: sn.pageWidth, height: sn.pageHeight },
            onItemClick: (index) => this.goToPage(index + 1),
        });

        this.thumbLoadObserver = setupLazyListLoading(
            sidebar,
            this.thumbItems.map((item) => item.itemEl),
            (index) => void this.ensureThumbnailLoaded(sn, index),
        );

        this.updateThumbSidebarOffset();
    }

    private toggleThumbSidebar(): void {
        this.thumbnailsVisible = !this.thumbnailsVisible;
        this.thumbSidebarEl?.classList.toggle('open', this.thumbnailsVisible);
        this.thumbToggleBtn?.setAttribute('aria-pressed', String(this.thumbnailsVisible));
        // Toggling never changes .pages' own width (the sidebar overlays
        // it - see .thumb-sidebar's own CSS comment), so there's no
        // fit-width re-render to trigger here, unlike zoom's own resize
        // handling.
        if (this.thumbnailsVisible) this.updateThumbSidebarOffset();
    }

    // The thumbnail sidebar overlays .pages (position: absolute against
    // .root) rather than sharing a flex row with it - see its own CSS
    // comment for why - so its `top` has to be set from here instead of a
    // fixed CSS value: neither the toolbar nor the find bar has a fixed
    // height (the find bar toggles open/closed, changing the total header
    // height beneath which this should start). pagesEl's own offsetTop
    // already reflects however much space both of those actually take up,
    // whatever that combined height happens to be, without this needing
    // to know about either one individually.
    private updateThumbSidebarOffset(): void {
        if (!this.thumbSidebarEl || !this.pagesEl) return;
        this.thumbSidebarEl.style.top = `${this.pagesEl.offsetTop}px`;
    }

    // Idempotent - a page's thumbnail is loaded once and never evicted
    // (see fillSidebarThumbnail()'s own comment for why) - checking the
    // <img>'s own src rather than a separate loaded flag keeps this in
    // sync with the DOM directly, with nothing else to fall out of sync.
    private async ensureThumbnailLoaded(sn: SupernoteX, index: number): Promise<void> {
        const item = this.thumbItems[index];
        if (!item || item.imgEl.src) return;
        try {
            const [dataUrl] = await new ImageConverter().convertToImages(
                sn, [index + 1], SupernoteViewerElement.THUMBNAIL_SCALE,
            );
            fillSidebarThumbnail(item, dataUrl);
        } catch (err) {
            console.error(`supernote-viewer: page ${index + 1}'s thumbnail failed to load`, err);
        }
    }

    private highlightThumbnail(index: number): void {
        this.thumbItems.forEach((item, i) => item.itemEl.classList.toggle('is-active', i === index));
    }

    // Sets zoomScale (clamped) and applies it. Mirrors SupernoteView's own
    // setZoom() (main.ts), but considerably simpler: that one re-rasterizes
    // each page's canvas at the target zoom (debounced, so rapid wheel/
    // button input doesn't thrash it) for pixel-perfect crispness at any
    // scale. This component only ever CSS-scales the same already-
    // rasterized <img> (see applyZoomToPages()) - cheap enough to apply
    // instantly and synchronously, no debounce/re-render step needed at
    // all. The trade-off: zooming in well past 100% shows the same
    // native-resolution image scaled up (blurrier), rather than a
    // freshly-rasterized higher-resolution one.
    private setZoom(newScale: number, opts: { manual?: boolean } = {}): void {
        const isManual = opts.manual !== false;
        if (isManual) {
            // Any direct zoom action (buttons, wheel, reset) is the user
            // taking manual control - stop auto-adjusting on resize until
            // they ask for fit-width again. applyFitWidth() itself calls in
            // with manual: false so it doesn't immediately cancel the mode
            // it's trying to apply.
            this.fitWidthEnabled = false;
            this.updateFitWidthButton();
        }

        // Floor/ceiling mirror SupernoteView's own setZoom(): fit-width can
        // legitimately need to go far outside a sane *manual* zoom range
        // (a narrow mobile screen might need under 25%; a small native
        // page resolution on a large/high-DPI display might need well over
        // 500% just to fill the available width) - the wider ceiling there
        // is purely a guard against a pathological render (e.g. a
        // zero-width native page), not a real intended limit the way
        // manual zoom's 500% cap is.
        const ceiling = isManual ? 5 : 20;
        this.zoomScale = Math.min(ceiling, Math.max(0.05, newScale));
        this.applyZoomToPages();
    }

    // Applies the current zoomScale to every page's container - explicit
    // pixel width, not a CSS transform, so .pages' own scrollable content
    // size (and thus scrollbar/overflow behavior) actually reflects the
    // zoomed size, the same way a real image resize would. Each page's
    // <img> stays at width: 100% (of its own now explicitly-sized
    // container, set by noteRenderer.ts for both the still-loading
    // placeholder and, once ensurePageImageLoaded() calls this again, the
    // real loaded image) - keeping the width source in one place (the
    // container) rather than duplicating this same computation onto every
    // img too.
    private applyZoomToPages(): void {
        if (!this.sn) return;
        const width = `${this.sn.pageWidth * this.zoomScale}px`;
        for (const state of this.pageStates) {
            state.containerEl.style.width = width;
            state.imageEl.style.width = '100%';
        }
        if (this.zoomLabelEl) this.zoomLabelEl.textContent = `${Math.round(this.zoomScale * 100)}%`;
    }

    // Scales every page so its rendered width matches however much
    // horizontal space is actually available (.pages' own content box,
    // minus its first page-container's own horizontal margin, if any -
    // mirrors SupernoteView's own applyFitWidth() exactly, including
    // reading that margin from computed style rather than assuming it's
    // zero, even though this component's own stylesheet uses .pages' gap
    // rather than page-container margins for inter-page spacing today).
    private applyFitWidth(): void {
        if (!this.sn || !this.pagesEl || this.sn.pageWidth <= 0) return;

        const availableWidth = this.pagesEl.clientWidth;
        if (availableWidth <= 0) return;

        const state = this.pageStates[0];
        const containerStyle = state ? getComputedStyle(state.containerEl) : null;
        const horizontalMargin = containerStyle
            ? parseFloat(containerStyle.marginLeft || '0') + parseFloat(containerStyle.marginRight || '0')
            : 0;
        const targetWidth = Math.max(availableWidth - horizontalMargin, 1);

        this.setZoom(targetWidth / this.sn.pageWidth, { manual: false });
    }

    private updateFitWidthButton(): void {
        this.fitWidthBtn?.setAttribute('aria-pressed', String(this.fitWidthEnabled));
    }

    // Ctrl+scroll to zoom (trackpad pinch-to-zoom is reported as a wheel
    // event with ctrlKey set, on every platform) - mirrors SupernoteView's
    // own registerDomEvent(this.contentEl, 'wheel', ...) handler in
    // main.ts, deliberately NOT metaKey (Cmd on macOS): Cmd is also the
    // modifier held down through a whole Cmd+Tab app switch, and a wheel
    // event from scroll momentum/inertia that happens to fire mid-switch -
    // nothing to do with zooming - would still carry metaKey: true and get
    // treated as a zoom gesture. Trackpad pinch never sets metaKey, only
    // ctrlKey.
    private setupZoomWheelHandling(): void {
        if (!this.pagesEl) return;
        this.pagesEl.addEventListener('wheel', (evt: WheelEvent) => {
            if (!evt.ctrlKey) return;
            evt.preventDefault();

            // Trackpads report a pinch-to-zoom gesture as a wheel event
            // with ctrlKey set - the same flag an ordinary two-finger
            // scroll can spuriously carry for a stray event or two right
            // as the scroll hits a boundary. A fixed per-event zoom step
            // let a short burst of those misfires snowball straight to the
            // zoom cap; scaling the step by the event's own deltaY keeps a
            // real, sustained pinch feeling responsive while capping how
            // much a single misfired event can do.
            const factor = Math.min(1.05, Math.max(0.95, 1 - evt.deltaY * 0.01));
            this.setZoom(this.zoomScale * factor);
        }, { passive: false });
    }

    // While "Fit width" is on, keeps every page matched to however much
    // room is actually available as .pages itself resizes (a split pane, a
    // sidebar opening/closing, the window itself) - not just at the moment
    // it was turned on. Debounced since resize fires continuously while
    // dragging. Separate from resizeObserver (see setupOverlayResizing())
    // - that one watches each page's own size for word/link overlay
    // repositioning; this one watches .pages itself, the viewport
    // fit-width computes against.
    private setupFitWidthResizing(): void {
        if (!this.pagesEl || typeof ResizeObserver === 'undefined') return;
        this.pagesResizeObserver = new ResizeObserver(() => {
            if (!this.fitWidthEnabled) return;
            window.clearTimeout(this.fitWidthDebounceTimer);
            this.fitWidthDebounceTimer = window.setTimeout(() => this.applyFitWidth(), 150);
        });
        this.pagesResizeObserver.observe(this.pagesEl);
    }

    // Idempotent and safe to call speculatively - `loaded` is set eagerly so
    // a slow rasterization can't be triggered twice for the same page.
    private async ensurePageImageLoaded(sn: SupernoteX, state: ViewerPageState): Promise<void> {
        state.loaded = true;
        console.debug(`supernote-viewer: loading page ${state.pageNumber}`);
        try {
            const imageDataUrl = await this.rasterizePage(sn, state.pageNumber);
            // The page can easily have scrolled back out of view while this
            // was in flight (a worker round-trip) - finalizing anyway would
            // leave it "stuck" loaded, with eviction never getting a chance
            // to run for it until the user happens to scroll back to this
            // exact page again. Confirmed as a real cause of a memory
            // regression in SupernoteView's own equivalent (main.ts's
            // ensurePageImage(), issue #154) via real profiling there: on a
            // fast scroll, most in-flight loads lose this race, and without
            // this check "currently loaded" climbed well past what the
            // observer's own prefetch margin should ever allow, with zero
            // evictions. Resetting `loaded` (not just discarding the
            // result) lets a later re-visit trigger a fresh load instead of
            // silently doing nothing forever - goToPage()/scrollToMatch()/
            // buildSinglePageViewer() all mark `visible` true immediately
            // before a forced call for exactly this reason, so a
            // deliberate jump never trips this guard.
            if (!state.visible) {
                state.loaded = false;
                console.debug(`supernote-viewer: discarding page ${state.pageNumber}'s load - scrolled away while rasterizing`);
                return;
            }
            fillNotePagePlaceholder(state, imageDataUrl);
            console.debug(`supernote-viewer: page ${state.pageNumber} loaded, img.src set (length ${imageDataUrl.length})`);
            // fillNotePagePlaceholder() clears this page's width overrides
            // back to noteRenderer.ts's own loaded-image default (native
            // size, capped down by CSS if too big - see the img's own
            // max-width: 100% rule) - fine for single-page mode, which has
            // no zoom concept at all, but not sufficient once zoomed *in*
            // past 100%: CSS max-width only ever shrinks, never stretches a
            // loaded image past its own native pixel size. Reapplying the
            // current zoom here (cheap - just a style-string assignment per
            // page) keeps a page that finishes loading mid-zoom sized the
            // same as every already-loaded one.
            this.applyZoomToPages();
        } catch (err) {
            // Allows a retry on the next intersection - a transient
            // rasterization failure shouldn't permanently blank this page.
            state.loaded = false;
            console.error(`supernote-viewer: page ${state.pageNumber} failed to load`, err);
            this.dispatchEvent(new CustomEvent('supernote-error', { detail: { error: err, pageNumber: state.pageNumber } }));
        }
    }

    // Releases a loaded page's image once it's scrolled out of the
    // pageLoadObserver's own prefetch margin (see setupPageLoadObserver()) -
    // the "evict" half of the lazy-load/evict cycle that bounds memory on a
    // long scroll, mirroring SupernoteView's own evictPageImage() (main.ts,
    // issue #154's fix). Safe to call speculatively: a no-op if nothing's
    // actually loaded (most pages, most of the time - the observer also
    // reports initial non-intersection for anything outside the viewport
    // at file-open time).
    private evictPageImage(sn: SupernoteX, state: ViewerPageState): void {
        if (!state.loaded) return;
        console.debug(`supernote-viewer: evicting page ${state.pageNumber}`);
        evictNotePageImage(state, sn.pageWidth, sn.pageHeight);
        state.loaded = false;
    }

    private buildToolbar(pageCount: number): void {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        toolbar.setAttribute('part', 'toolbar');

        // Nothing to navigate to with only one page - the mode toggle and
        // find button below are still worth having regardless of page
        // count, so only these four are conditioned on pageCount > 1.
        if (pageCount > 1) {
            const thumbBtn = document.createElement('button');
            thumbBtn.type = 'button';
            thumbBtn.setAttribute('part', 'button');
            thumbBtn.setAttribute('aria-label', 'Toggle page thumbnails');
            thumbBtn.setAttribute('aria-pressed', 'false');
            thumbBtn.textContent = '☰';
            thumbBtn.addEventListener('click', () => this.toggleThumbSidebar());
            toolbar.appendChild(thumbBtn);
            this.thumbToggleBtn = thumbBtn;

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
        }

        // Zoom - worth having regardless of page count (even a single-page
        // document can have detail worth zooming in on), so unlike the
        // page-nav block above, not conditioned on pageCount > 1.
        const zoomOutBtn = document.createElement('button');
        zoomOutBtn.type = 'button';
        zoomOutBtn.setAttribute('part', 'button');
        zoomOutBtn.setAttribute('aria-label', 'Zoom out');
        zoomOutBtn.textContent = '−';
        zoomOutBtn.addEventListener('click', () => this.setZoom(this.zoomScale / 1.25));
        toolbar.appendChild(zoomOutBtn);

        const zoomLabel = document.createElement('span');
        zoomLabel.className = 'zoom-label';
        zoomLabel.setAttribute('part', 'zoom-label');
        zoomLabel.textContent = '100%';
        toolbar.appendChild(zoomLabel);
        this.zoomLabelEl = zoomLabel;

        const zoomInBtn = document.createElement('button');
        zoomInBtn.type = 'button';
        zoomInBtn.setAttribute('part', 'button');
        zoomInBtn.setAttribute('aria-label', 'Zoom in');
        zoomInBtn.textContent = '+';
        zoomInBtn.addEventListener('click', () => this.setZoom(this.zoomScale * 1.25));
        toolbar.appendChild(zoomInBtn);

        const zoomResetBtn = document.createElement('button');
        zoomResetBtn.type = 'button';
        zoomResetBtn.setAttribute('part', 'button');
        zoomResetBtn.setAttribute('aria-label', 'Reset zoom');
        zoomResetBtn.textContent = '↺';
        zoomResetBtn.addEventListener('click', () => this.setZoom(1));
        toolbar.appendChild(zoomResetBtn);

        const fitWidthBtn = document.createElement('button');
        fitWidthBtn.type = 'button';
        fitWidthBtn.setAttribute('part', 'button');
        fitWidthBtn.setAttribute('aria-label', 'Fit page to viewport width');
        fitWidthBtn.setAttribute('aria-pressed', 'true'); // fitWidthEnabled defaults to true
        fitWidthBtn.textContent = 'Fit';
        fitWidthBtn.addEventListener('click', () => {
            this.fitWidthEnabled = !this.fitWidthEnabled;
            if (this.fitWidthEnabled) this.applyFitWidth();
            this.updateFitWidthButton();
        });
        toolbar.appendChild(fitWidthBtn);
        this.fitWidthBtn = fitWidthBtn;

        const modeBtn = document.createElement('button');
        modeBtn.type = 'button';
        modeBtn.setAttribute('part', 'button');
        modeBtn.setAttribute('aria-label', 'Toggle recognized text view');
        modeBtn.setAttribute('aria-pressed', 'false');
        modeBtn.textContent = 'Aa';
        modeBtn.addEventListener('click', () => this.toggleMode());
        toolbar.appendChild(modeBtn);
        this.modeToggleBtn = modeBtn;

        const findBtn = document.createElement('button');
        findBtn.type = 'button';
        findBtn.setAttribute('part', 'button');
        findBtn.setAttribute('aria-label', 'Find in note');
        findBtn.setAttribute('aria-pressed', 'false');
        findBtn.textContent = 'Find';
        findBtn.addEventListener('click', () => this.toggleFindBar());
        toolbar.appendChild(findBtn);
        this.findToggleBtn = findBtn;

        this.rootEl.appendChild(toolbar);
        this.toolbarEl = toolbar;
    }

    // Builds the (initially hidden - see the .find-bar/.open CSS rule) find
    // UI: a text input searching every page's recognized words (via
    // pageSearchIndex, built in buildViewer()) directly against the
    // invisible word-overlay spans built in wrapPageStates() - no PDF/pdf.js
    // involved at all, unlike SupernoteView's own find-in-note in main.ts.
    private buildFindBar(): void {
        const bar = document.createElement('div');
        bar.className = 'find-bar';
        bar.setAttribute('part', 'find-bar');

        const input = document.createElement('input');
        input.type = 'text';
        input.setAttribute('part', 'find-input');
        input.placeholder = 'Find in note…';
        input.addEventListener('input', () => this.runFind(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.stepFind(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeFindBar();
            }
        });
        bar.appendChild(input);
        this.findInputEl = input;

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.setAttribute('part', 'button');
        prevBtn.setAttribute('aria-label', 'Previous match');
        prevBtn.textContent = '‹';
        prevBtn.addEventListener('click', () => this.stepFind(-1));
        bar.appendChild(prevBtn);

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.setAttribute('part', 'button');
        nextBtn.setAttribute('aria-label', 'Next match');
        nextBtn.textContent = '›';
        nextBtn.addEventListener('click', () => this.stepFind(1));
        bar.appendChild(nextBtn);

        const count = document.createElement('span');
        count.className = 'find-count';
        count.setAttribute('part', 'find-count');
        bar.appendChild(count);
        this.findCountEl = count;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.setAttribute('part', 'button');
        closeBtn.setAttribute('aria-label', 'Close find bar');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => this.closeFindBar());
        bar.appendChild(closeBtn);

        this.rootEl.appendChild(bar);
        this.findBarEl = bar;
    }

    private toggleFindBar(): void {
        if (this.findBarEl?.classList.contains('open')) this.closeFindBar();
        else this.openFindBar();
    }

    private openFindBar(): void {
        this.findBarEl?.classList.add('open');
        this.findToggleBtn?.setAttribute('aria-pressed', 'true');
        this.findInputEl?.focus();
        this.findInputEl?.select();
        // The find bar adds to the total header height the thumbnail
        // sidebar sits below - see updateThumbSidebarOffset()'s own
        // comment for why this can't just be a fixed CSS value.
        this.updateThumbSidebarOffset();
    }

    private closeFindBar(): void {
        this.findBarEl?.classList.remove('open');
        this.findToggleBtn?.setAttribute('aria-pressed', 'false');
        this.clearFindHighlights();
        this.findMatches = [];
        this.findMatchIndex = -1;
        this.renderPageTextHighlights(); // clears every page's <mark>s too
        if (this.findInputEl) this.findInputEl.value = '';
        if (this.findCountEl) this.findCountEl.textContent = '';
        this.updateThumbSidebarOffset();
    }

    // Rebuilds findMatches from scratch against every page's search text -
    // simple linear re-scan on every keystroke rather than incremental
    // matching, which is plenty fast for the amount of recognized text a
    // handwritten note actually has (a few thousand characters per page at
    // most) and much simpler than maintaining incremental state.
    private runFind(query: string): void {
        this.clearFindHighlights();
        this.findMatches = [];
        this.findMatchIndex = -1;

        const q = query.trim().toLowerCase();
        if (q.length > 0) {
            for (let pageIndex = 0; pageIndex < this.pageSearchIndex.length; pageIndex++) {
                const { lower, entryAt } = this.pageSearchIndex[pageIndex];
                let from = 0;
                for (;;) {
                    const idx = lower.indexOf(q, from);
                    if (idx === -1) break;
                    const end = idx + q.length;
                    from = end;
                    const entry = entryAt(idx);
                    // Only a genuinely highlightable word (one with a
                    // bounding box, i.e. a real overlay span - see
                    // wordOverlay.ts) counts as a match: a hit that landed
                    // on a boxless whitespace/punctuation entry has nothing
                    // for image mode to point to on screen (recognized-text
                    // mode's <mark> highlighting only needs the offsets,
                    // but keeping one rule for what counts as a match, in
                    // both modes, is simpler than two).
                    if (entry?.el) this.findMatches.push({ pageIndex, start: idx, end, entry });
                }
            }
            for (const match of this.findMatches) match.entry.el!.classList.add('word-overlay-match');
        }

        if (this.findMatches.length > 0) this.stepFind(1);
        else {
            this.updateFindCount();
            this.renderPageTextHighlights();
        }
    }

    // Moves the current match by `delta` (wrapping in both directions) and
    // scrolls it into view. Called both by the prev/next buttons (delta
    // ±1) and by runFind() itself (delta +1 from the initial index of -1,
    // landing on the first match) - reusing the same wrap-around math
    // rather than special-casing "select the first match".
    private stepFind(delta: number): void {
        if (this.findMatches.length === 0) return;

        this.findMatches[this.findMatchIndex]?.entry.el?.classList.remove('word-overlay-match-current');

        const n = this.findMatches.length;
        this.findMatchIndex = ((this.findMatchIndex + delta) % n + n) % n;

        const match = this.findMatches[this.findMatchIndex];
        match.entry.el?.classList.add('word-overlay-match-current');
        this.updateFindCount();
        this.renderPageTextHighlights();
        this.scrollToMatch(match);
    }

    // Recognized-text mode shows page.text reflowed as plain paragraphs -
    // nothing like the handwriting's original x/y layout the image-mode
    // word-overlay spans are positioned against (and worse, that mode
    // hides the image entirely, collapsing the container to the text
    // block's own height - see the .word-overlay-span display:none rule
    // in mode-text - so those spans have nothing sensible to overlay even
    // if shown). Matches there are instead highlighted by wrapping the
    // matched range of each page's stored rawText in a <mark>, using the
    // same start/end offsets computed in runFind() - safe to reuse
    // directly because buildWordSearchText()'s reconstruction is
    // character-identical to page.text (see wordOverlay.test.ts).
    // Rebuilds every page's text unconditionally on every find action
    // (not just the affected page) - simple, and cheap at the amount of
    // recognized text one note actually has (see runFind()'s own
    // comment).
    private renderPageTextHighlights(): void {
        const matchesByPage = new Map<number, FindMatch[]>();
        for (const match of this.findMatches) {
            const forPage = matchesByPage.get(match.pageIndex) ?? [];
            forPage.push(match);
            matchesByPage.set(match.pageIndex, forPage);
        }

        for (let pageIndex = 0; pageIndex < this.pageStates.length; pageIndex++) {
            const state = this.pageStates[pageIndex];
            const matches = matchesByPage.get(pageIndex) ?? [];
            const textEl = state.textEl;
            textEl.textContent = '';

            if (state.rawText.length === 0) {
                textEl.textContent = 'No recognized text on this page.';
                continue;
            }
            if (matches.length === 0) {
                textEl.textContent = state.rawText;
                continue;
            }

            let cursor = 0;
            for (const match of matches) {
                if (match.start > cursor) textEl.appendChild(document.createTextNode(state.rawText.slice(cursor, match.start)));
                const mark = document.createElement('mark');
                mark.className = match === this.findMatches[this.findMatchIndex] ? 'find-match find-match-current' : 'find-match';
                mark.textContent = state.rawText.slice(match.start, match.end);
                textEl.appendChild(mark);
                cursor = match.end;
            }
            if (cursor < state.rawText.length) textEl.appendChild(document.createTextNode(state.rawText.slice(cursor)));
        }
    }

    private scrollToMatch(match: FindMatch): void {
        if (!this.sn || !this.pagesEl) return;
        const state = this.pageStates[match.pageIndex];
        if (!state) return;

        // Recognized-text mode has no image/overlay-span geometry to
        // scroll to (see renderPageTextHighlights()) - the current <mark>
        // it just built is the only thing with a real on-screen position.
        if (this.mode === 'text') {
            const mark = state.textEl.querySelector('.find-match-current');
            if (mark) this.scrollElementIntoPagesView(mark);
            return;
        }

        const el = match.entry.el;
        if (!el) return;
        // See goToPage()'s identical comment - a find match can jump the
        // length of the whole document, well before the smooth-scroll
        // animation to it actually finishes.
        state.visible = true;
        if (!state.loaded) void this.ensurePageImageLoaded(this.sn, state);
        this.scrollElementIntoPagesView(el);
    }

    // Centers `el` within the visible .pages viewport rather than just
    // bringing its page's top edge into view (goToPage()'s own behavior,
    // too coarse for a match partway down a tall page) - .pages.scrollTo()
    // with a manually computed offset, never scrollIntoView(), which would
    // cascade to any scrollable ancestor this element is embedded in (e.g.
    // Obsidian's own note editor, for SupernoteEmbed).
    private scrollElementIntoPagesView(el: Element): void {
        if (!this.pagesEl) return;
        const pagesRect = this.pagesEl.getBoundingClientRect();
        const targetRect = el.getBoundingClientRect();
        const targetTop = this.pagesEl.scrollTop + (targetRect.top - pagesRect.top) - pagesRect.height / 2 + targetRect.height / 2;
        this.pagesEl.scrollTo({ top: targetTop, behavior: 'smooth' });
    }

    private clearFindHighlights(): void {
        for (const match of this.findMatches) {
            match.entry.el?.classList.remove('word-overlay-match', 'word-overlay-match-current');
        }
    }

    private updateFindCount(): void {
        if (!this.findCountEl) return;
        if (this.findMatches.length === 0) {
            this.findCountEl.textContent = this.findInputEl?.value.trim() ? 'No results' : '';
        } else {
            this.findCountEl.textContent = `${this.findMatchIndex + 1} / ${this.findMatches.length}`;
        }
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
