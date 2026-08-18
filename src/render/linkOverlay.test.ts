// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ILink, SupernoteX } from 'supernote-typescript';
import { parseLinkRect, bucketLinksByPage, buildLinkOverlay, repositionLinkOverlay } from './linkOverlay';

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
    const fixturePath = path.join(import.meta.dirname, '..', '..', 'supernote-typescript', 'tests', 'input', 'link-n6-3.26.40-partial-erase-3p.note');

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

describe('buildLinkOverlay', () => {
    it('creates one appended <a> per link with a valid LINKRECT', () => {
        const container = document.createElement('div');
        const links = [fakeLink({ text: 'a' }), fakeLink({ text: 'b', LINKRECT: '1,2,3,4' })];
        const entries = buildLinkOverlay(links, container);

        expect(entries).toHaveLength(2);
        expect(container.querySelectorAll('a.link-overlay-rect')).toHaveLength(2);
        for (const entry of entries) {
            expect(entry.el.parentElement).toBe(container);
        }
    });

    it('carries the parsed rect through as native geometry', () => {
        const container = document.createElement('div');
        const [entry] = buildLinkOverlay([fakeLink({ LINKRECT: '10,20,300,400' })], container);
        expect(entry).toMatchObject({ nativeX: 10, nativeY: 20, nativeWidth: 300, nativeHeight: 400 });
    });

    it('skips a link whose LINKRECT does not parse, without throwing', () => {
        const container = document.createElement('div');
        const entries = buildLinkOverlay([fakeLink({ LINKRECT: 'garbage' })], container);
        expect(entries).toHaveLength(0);
        expect(container.children).toHaveLength(0);
    });

    it('sets the anchor\'s title to the link\'s decoded text', () => {
        const container = document.createElement('div');
        const [entry] = buildLinkOverlay([fakeLink({ text: 'Other Note#Page 3' })], container);
        expect(entry.el.title).toBe('Other Note#Page 3');
    });

    it('keeps the original ILink reachable from the entry, for the caller\'s own click handling', () => {
        const container = document.createElement('div');
        const link = fakeLink({ text: 'a' });
        const [entry] = buildLinkOverlay([link], container);
        expect(entry.link).toBe(link);
    });
});

describe('repositionLinkOverlay', () => {
    it('scales native rect geometry to the rendered page size', () => {
        const container = document.createElement('div');
        const entries = buildLinkOverlay([fakeLink({ LINKRECT: '100,200,300,400' })], container);

        // Rendered at exactly half the note's native page size.
        repositionLinkOverlay(entries, 500, 600, 1000, 1200);

        expect(entries[0].el.style.left).toBe('50px');
        expect(entries[0].el.style.top).toBe('100px');
        expect(entries[0].el.style.width).toBe('150px');
        expect(entries[0].el.style.height).toBe('200px');
    });

    it('repositions every entry independently', () => {
        const container = document.createElement('div');
        const entries = buildLinkOverlay(
            [fakeLink({ LINKRECT: '0,0,100,100' }), fakeLink({ LINKRECT: '100,100,100,100' })],
            container,
        );

        repositionLinkOverlay(entries, 1000, 1000, 1000, 1000);

        expect(entries[0].el.style.left).toBe('0px');
        expect(entries[1].el.style.left).toBe('100px');
    });
});
