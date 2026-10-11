// Portable "lazy-loaded thumbnail list" building block - a scrollable
// sidebar of items, each with a thumbnail image (loaded lazily, via a
// debounced IntersectionObserver, once it nears the viewport) and a label,
// optionally with a checkbox instead of a plain click-to-select row.
//
// Extracted from SupernoteView's own thumbnail sidebar (main.ts,
// buildThumbSidebar()) - the same debounced load-on-approach pattern that
// fixed a real out-of-memory crash scrolling a long document's sidebar
// quickly (issue #154) - so <supernote-viewer>'s own page-thumbnail
// sidebar (SupernoteViewerElement.ts) and a similarly-shaped list could
// share it instead of each reimplementing the same lazy-load/debounce
// machinery from scratch. The checkbox option exists for exactly that
// second case: <supernote-atelier-viewer>'s own layer-visibility sidebar
// (SupernoteAtelierViewerElement.ts's buildLayerSidebarRows()) - though
// that one deliberately skips setupLazyListLoading() below (see its own
// comment): a .spd file only ever has a handful of layers, so there's
// nothing worth lazy-loading, and every layer's thumbnail is composited
// eagerly instead.
export interface SidebarListItemSpec {
    label: string;
    // Rendered as a checkbox before the label if provided (the
    // layer-toggle use case: checked = that layer/surface is visible).
    // Omitted entirely for a plain click-to-select row (the page-thumbnail
    // use case: clicking navigates, no checkbox).
    checkbox?: {
        checked: boolean;
        onChange: (checked: boolean) => void;
    };
}

export interface SidebarListItem {
    itemEl: HTMLElement;
    imgEl: HTMLImageElement;
}

export interface BuildSidebarListOptions {
    // Every item's thumbnail reserves this aspect ratio before its image
    // loads - the same "reserve the box size up front" trick
    // buildNotePagePlaceholders() uses and for the same reason: an <img>
    // with no src/dimensions otherwise collapses to ~0 height, so it
    // "pops" to full size right as it loads, reflowing every later item's
    // position (confirmed, in the original thumbnail sidebar this was
    // extracted from, to be why scrolling it for a while could still crash
    // - issue #154 - even after loading itself was bounded to "only what's
    // visible": each pop re-triggers the observer for a large swath of
    // items at once). One ratio for the whole list, not per item, since
    // every page of a note (or every layer of an Atelier file, composited
    // against one shared tile-grid - see SupernoteAtelier.toImage()'s own
    // doc comment) shares one native size.
    thumbnailAspectRatio: { width: number; height: number };
    onItemClick?: (index: number) => void;
    // Tags each thumbnail <img> for dark-mode stroke inversion, same as a
    // main page image (see noteRenderer.ts's own invertColorsWhenDark) -
    // without this, a thumbnail's handwriting stayed uninverted regardless
    // of the setting, since this class was never applied here at all
    // (confirmed as a real, reported bug - issue #192).
    invertColorsWhenDark?: boolean;
}

// Builds one item per entry in `items` and appends them to `container` -
// plain DOM APIs only, no Obsidian dependency, so this can run in a
// standalone browser context same as the rest of src/render/. Doesn't load
// any thumbnail image itself (see setupLazyListLoading()) or build the
// scrollable container/toggle button around the list - callers layer that
// on top of the returned elements, the same division of responsibility
// noteRenderer.ts's own buildNotePagePlaceholders() has.
export function buildSidebarList(
    container: HTMLElement,
    items: SidebarListItemSpec[],
    options: BuildSidebarListOptions,
): SidebarListItem[] {
    const { width, height } = options.thumbnailAspectRatio;

    return items.map((spec, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'sidebar-list-item';
        itemEl.dataset.index = String(index);

        if (spec.checkbox) {
            const checkboxLabel = document.createElement('label');
            checkboxLabel.className = 'sidebar-list-checkbox-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = spec.checkbox.checked;
            checkbox.addEventListener('change', () => spec.checkbox!.onChange(checkbox.checked));
            checkboxLabel.appendChild(checkbox);
            checkboxLabel.appendChild(document.createTextNode(spec.label));
            itemEl.appendChild(checkboxLabel);
        }

        const img = document.createElement('img');
        img.className = 'sidebar-list-thumb';
        if (options.invertColorsWhenDark) img.classList.add('supernote-invert-dark');
        img.style.aspectRatio = `${width} / ${height}`;
        itemEl.appendChild(img);

        // A plain click-to-select row (no checkbox) still needs its own
        // visible label - the layer-toggle row above already put its label
        // text inside the checkbox's own <label>, so this only runs for
        // the other case.
        if (!spec.checkbox) {
            const labelEl = document.createElement('span');
            labelEl.className = 'sidebar-list-label';
            labelEl.textContent = spec.label;
            itemEl.appendChild(labelEl);
        }

        if (options.onItemClick) {
            itemEl.addEventListener('click', () => options.onItemClick!(index));
        }

        container.appendChild(itemEl);
        return { itemEl, imgEl: img };
    });
}

// Debounced IntersectionObserver-driven lazy loader - mirrors
// SupernoteView's own thumbObserver (buildThumbSidebar()) exactly,
// including its debounce: confirmed by testing there that scrolling a long
// sidebar *quickly* still triggered a rasterization storm without one,
// even once loading was already bounded to "only what's currently
// visible" (issue #154) - a fast scroll flings most items past the
// viewport well within the debounce window, so only ones actually lingered
// near for a moment trigger a real load.
export function setupLazyListLoading(
    root: HTMLElement,
    itemEls: HTMLElement[],
    loadItem: (index: number) => void,
    options: { rootMargin?: string; debounceMs?: number } = {},
): IntersectionObserver {
    const rootMargin = options.rootMargin ?? '100% 0px';
    const debounceMs = options.debounceMs ?? 200;
    const debounceTimers = new Map<number, number>();
    const currentlyVisible = new Set<number>();

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const index = itemEls.indexOf(entry.target as HTMLElement);
            if (index === -1) continue;

            if (entry.isIntersecting) currentlyVisible.add(index);
            else currentlyVisible.delete(index);

            window.clearTimeout(debounceTimers.get(index));
            if (!entry.isIntersecting) continue;

            debounceTimers.set(index, window.setTimeout(() => {
                // Re-checks rather than assuming still true - the timer
                // firing doesn't mean nothing happened since it was
                // scheduled (see this function's own comment).
                if (currentlyVisible.has(index)) loadItem(index);
            }, debounceMs));
        }
    }, { root, rootMargin });

    for (const el of itemEls) observer.observe(el);
    return observer;
}

// Fills in a lazily-loaded item's thumbnail. Split out from
// setupLazyListLoading()'s loadItem callback only because both
// SupernoteViewerElement.ts (page thumbnails) and a future Atelier
// layer-toggle would otherwise duplicate this same "load once, keep
// forever" shape - unlike a page's own full-resolution image (see
// noteRenderer.ts's fillNotePagePlaceholder()), a thumbnail is never
// evicted once loaded: a full document's worth of these amounts to a few
// MB total at typical thumbnail scale (see issue #154), not enough memory
// pressure to bother evicting for, and keeping them around means
// scrolling back to an already-visited thumbnail never has to redecode.
export function fillSidebarThumbnail(item: SidebarListItem, imageDataUrl: string): void {
    item.imgEl.src = imageDataUrl;
}
