// Pure geometry/bucketing logic for rendering Supernote internal links
// (ILink) as a clickable overlay in SupernoteView. Kept free of any
// 'obsidian' import (unlike main.ts, which extends Obsidian base classes and
// so can't be unit tested without mocking that whole surface) so it can be
// tested directly — same pattern as deviceDate.ts/deviceSync.ts.

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
