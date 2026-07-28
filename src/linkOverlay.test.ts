import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ILink, SupernoteX } from 'supernote-typescript';
import { parseLinkRect, bucketLinksByPage } from './linkOverlay';

function fakeLink(overrides: Partial<ILink> = {}): ILink {
    return {
        LINKTYPE: '1',
        LINKINOUT: '0',
        LINKBITMAP: '0',
        LINKSTYLE: '0',
        LINKTIMESTAMP: '0',
        LINKRECT: '10,20,30,40',
        LINKRECTORI: '0',
        LINKPROTOCAL: 'RATTA_RLE',
        LINKFILE: '',
        LINKFILEID: '0',
        PAGEID: '0',
        OBJPAGE: '0',
        text: 'target-note',
        bitmapBuffer: null,
        ...overrides,
    };
}

describe('parseLinkRect', () => {
    it('parses a valid "x,y,w,h" rect', () => {
        expect(parseLinkRect('10,20,300,400')).toEqual([10, 20, 300, 400]);
    });

    it('returns null for the wrong number of components', () => {
        expect(parseLinkRect('10,20,300')).toBeNull();
        expect(parseLinkRect('10,20,300,400,500')).toBeNull();
    });

    it('returns null for non-numeric components', () => {
        expect(parseLinkRect('10,20,thirty,400')).toBeNull();
    });

    it('returns null for an empty string', () => {
        expect(parseLinkRect('')).toBeNull();
    });
});

describe('bucketLinksByPage', () => {
    it('buckets by the 1-indexed page number in the key\'s first 4 characters', () => {
        const links: Record<string, ILink[]> = {
            '0001125301180132': [fakeLink({ text: 'a' })], // page 1 -> index 0
            '0003165101560070': [fakeLink({ text: 'b' })], // page 3 -> index 2
        };
        const byPage = bucketLinksByPage(links);
        expect(byPage.get(0)?.map((l) => l.text)).toEqual(['a']);
        expect(byPage.get(2)?.map((l) => l.text)).toEqual(['b']);
        expect(byPage.has(1)).toBe(false);
    });

    it('merges multiple keys that resolve to the same page', () => {
        const links: Record<string, ILink[]> = {
            '0001125301180132': [fakeLink({ text: 'a' })],
            '0001099901180132': [fakeLink({ text: 'b' })],
        };
        const byPage = bucketLinksByPage(links);
        expect(byPage.get(0)?.map((l) => l.text)).toEqual(['a', 'b']);
    });

    it('does not filter by LINKTYPE', () => {
        // Two real notes checked both have genuine internal links with
        // LINKTYPE '0' as well as '1' — its doc comment ("1 = internal note
        // link") doesn't hold up in practice, so everything sn.links hands
        // back is treated as a real, clickable link.
        const links: Record<string, ILink[]> = {
            '0001125301180132': [fakeLink({ LINKTYPE: '0', text: 'kept' })],
        };
        expect(bucketLinksByPage(links).get(0)?.map((l) => l.text)).toEqual(['kept']);
    });

    it('ignores keys that do not decode to a valid page number', () => {
        const links: Record<string, ILink[]> = {
            'not-a-page-key': [fakeLink()],
        };
        expect(bucketLinksByPage(links).size).toBe(0);
    });
});

describe('LINKRECT against a real .note fixture', () => {
    // Same fixture the supernote-typescript submodule's own link-parsing test
    // uses (tests/main.test.ts, describe("links")) — confirms the coordinate
    // -space assumption positionLinkOverlay() in main.ts depends on: LINKRECT
    // is in the page's own native pixel space, not some other unit/origin.
    const fixturePath = path.join(import.meta.dirname, '..', 'supernote-typescript', 'tests', 'input', 'nomad-3.26.40-link-tag-3p.note');

    it('decodes to 4 numbers within [0, pageWidth] x [0, pageHeight]', () => {
        const buffer = fs.readFileSync(fixturePath);
        const sn = new SupernoteX(new Uint8Array(buffer));
        const allLinks = Object.values(sn.links).flat();
        expect(allLinks.length).toBeGreaterThan(0);

        for (const link of allLinks) {
            const rect = parseLinkRect(link.LINKRECT);
            expect(rect).not.toBeNull();
            const [x, y, w, h] = rect!;
            expect(x).toBeGreaterThanOrEqual(0);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(x + w).toBeLessThanOrEqual(sn.pageWidth);
            expect(y + h).toBeLessThanOrEqual(sn.pageHeight);
        }
    });

    it('bucketLinksByPage places every real link on a valid page index', () => {
        const buffer = fs.readFileSync(fixturePath);
        const sn = new SupernoteX(new Uint8Array(buffer));
        const byPage = bucketLinksByPage(sn.links);
        expect(byPage.size).toBeGreaterThan(0);
        for (const pageIndex of byPage.keys()) {
            expect(pageIndex).toBeGreaterThanOrEqual(0);
            expect(pageIndex).toBeLessThan(sn.pages.length);
        }
    });

    it('bucketLinksByPage matches this fixture\'s known per-page link layout', () => {
        // All 3 of this fixture's links share the same sn.links Record key
        // prefix ("0002") — i.e. this fixture happens to place all of them on
        // page index 1. Asserting that exactly, rather than "some valid
        // page", is what would have caught shipping OBJPAGE-based bucketing
        // (which scattered these across pages 0/1/2 instead) as a regression.
        const buffer = fs.readFileSync(fixturePath);
        const sn = new SupernoteX(new Uint8Array(buffer));
        const byPage = bucketLinksByPage(sn.links);
        expect(byPage.get(1)?.length).toBe(3);
        expect(byPage.has(0)).toBe(false);
        expect(byPage.has(2)).toBe(false);
    });
});
