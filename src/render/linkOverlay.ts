// Geometry/bucketing logic, plus DOM-building, for rendering Supernote
// internal links (ILink) as a clickable overlay - shared by SupernoteView
// (main.ts) and <supernote-viewer> (SupernoteViewerElement.ts). Kept free of
// any 'obsidian' import so both the pure logic and the DOM-building below
// can run, and be unit tested, outside Obsidian entirely - same pattern as
// wordOverlay.ts's own split between geometry and rendering in this
// directory.

import { ILink } from 'supernote-typescript';

// ILink.LINKRECT is "x,y,w,h" in the page's native (unscaled) pixel
// coordinate space — the same space as SupernoteX.pageWidth/pageHeight, so
// SupernoteView.positionLinkOverlay() can scale it by the same factor
// already used for the canvas/text layer.
export function parseLinkRect(rect: string): [number, number, number, number] | null {
	const parts = rect.split(',').map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
	return parts as [number, number, number, number];
}

// Buckets a note's links by 0-indexed source page: sn.links' Record key's
// first 4 characters, parsed as a 1-indexed page number, minus one. NOT
// ILink.OBJPAGE, despite its doc comment ("0-indexed page number this link
// appears on") sounding like the obvious field to use — pixel-checked
// against a real note with two internal links: OBJPAGE was 4 and 1 for
// links whose LINKRECT ink actually falls on array pages 0 and 3
// respectively (a 4-page note), which isn't consistent with OBJPAGE under
// *any* indexing convention. It turned out to track the page's own
// user-visible template label instead, which had drifted from its current
// array position (most likely from page reordering) — not usable for
// layout. The key-prefix convention checks out: 1 -> index 0, 4 -> index 3,
// confirmed by drawing each LINKRECT on every rendered page and measuring
// ink coverage under it. (An earlier version of this function used OBJPAGE
// directly, having wrongly concluded the key-prefix approach was broken from
// a single fixture where three links coincidentally shared one page and one
// prefix — always verify against more than one real note before trusting a
// hypothesis like this.)
//
// Also doesn't filter by LINKTYPE ("1 = internal note link" per its doc
// comment) — in both real notes checked, genuine internal links have
// LINKTYPE '0' as often as '1', so that comment doesn't hold up either;
// everything present in sn.links was already resolved as a real link by the
// parser, so nothing more to gate on.
export function bucketLinksByPage(links: Record<string, ILink[]>): Map<number, ILink[]> {
	const byPage = new Map<number, ILink[]>();
	for (const key of Object.keys(links)) {
		const pageIndex = parseInt(key.slice(0, 4), 10) - 1;
		if (!Number.isFinite(pageIndex) || pageIndex < 0) continue;
		const bucket = byPage.get(pageIndex) ?? [];
		bucket.push(...links[key]);
		byPage.set(pageIndex, bucket);
	}
	return byPage;
}

export interface LinkOverlayEntry {
	link: ILink;
	el: HTMLAnchorElement;
	// Native (unscaled) page-pixel position/size, straight from LINKRECT -
	// the same space pageWidth/pageHeight are defined in.
	// repositionLinkOverlay() scales these into the page's *currently
	// rendered* CSS pixel size, the same approach wordOverlay.ts's own
	// WordOverlayEntry/repositionWordOverlay() uses.
	nativeX: number;
	nativeY: number;
	nativeWidth: number;
	nativeHeight: number;
}

// Builds one absolutely-positioned, clickable <a> per link with a parseable
// LINKRECT (silently skipping any that don't - same "nothing sensible to
// draw" tolerance main.ts's own pre-portable version already had) and
// appends them directly to `container`, which must already establish a
// positioning context (e.g. `position: relative`) for the absolute
// positions below to land relative to it - same convention as
// wordOverlay.ts's buildWordOverlay(), and deliberately flat (no dedicated
// wrapping layer the way main.ts's own .supernote-links-layer is): unlike
// that div - which has to blanket-disable pointer-events because it stacks
// full page-sized canvas/text/link layers on top of each other - these
// anchors are the only overlay elements here that ever want pointer events
// at all, each covering only its own small link rect, so there's nothing
// for them to accidentally swallow clicks from.
//
// Doesn't attach a click handler itself - what a click should *do* (jump
// within this same note vs. hand off to a host that knows about files/
// vaults) is caller policy, not overlay-building; see
// SupernoteViewerElement.ts's own handleLinkClick() and the `link-click`
// event it dispatches for links this component can't resolve on its own.
export function buildLinkOverlay(links: ILink[], container: HTMLElement): LinkOverlayEntry[] {
	const entries: LinkOverlayEntry[] = [];

	for (const link of links) {
		const rect = parseLinkRect(link.LINKRECT);
		if (!rect) continue;
		const [x, y, w, h] = rect;

		const el = document.createElement('a');
		el.className = 'link-overlay-rect';
		el.href = '#';
		el.title = link.text;
		container.appendChild(el);

		entries.push({ link, el, nativeX: x, nativeY: y, nativeWidth: w, nativeHeight: h });
	}

	return entries;
}

// Repositions every link rect in `entries` to match the page's *currently
// rendered* CSS pixel size - call whenever that changes (initial layout,
// container resize, zoom), same pattern and same call site as
// wordOverlay.ts's own repositionWordOverlay().
export function repositionLinkOverlay(
	entries: LinkOverlayEntry[],
	renderedWidth: number,
	renderedHeight: number,
	nativeWidth: number,
	nativeHeight: number,
): void {
	const scaleX = renderedWidth / nativeWidth;
	const scaleY = renderedHeight / nativeHeight;

	for (const entry of entries) {
		entry.el.style.left = `${entry.nativeX * scaleX}px`;
		entry.el.style.top = `${entry.nativeY * scaleY}px`;
		entry.el.style.width = `${entry.nativeWidth * scaleX}px`;
		entry.el.style.height = `${entry.nativeHeight * scaleY}px`;
	}
}
