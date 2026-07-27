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

// Buckets a note's links by 0-indexed source page. sn.links' Record key
// isn't a plain page number — its first 4 characters, parsed as an int minus
// one, give the page index (more reliable than ILink.OBJPAGE); see PR #122's
// linksByPage (the markdown-export equivalent of this) for the same
// convention. Only LINKTYPE '1' ("internal note link") entries are surfaced
// as clickable regions.
export function bucketLinksByPage(links: Record<string, ILink[]>): Map<number, ILink[]> {
	const byPage = new Map<number, ILink[]>();
	for (const key of Object.keys(links)) {
		const pageIndex = parseInt(key.slice(0, 4)) - 1;
		if (!Number.isFinite(pageIndex) || pageIndex < 0) continue;
		const internal = links[key].filter((l) => l.LINKTYPE === '1');
		if (internal.length === 0) continue;
		const bucket = byPage.get(pageIndex) ?? [];
		bucket.push(...internal);
		byPage.set(pageIndex, bucket);
	}
	return byPage;
}
