// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SupernoteX, IPage } from 'supernote-typescript';
import { buildWordOverlay, buildWordSearchText, repositionWordOverlay } from './wordOverlay';

function fakePage(recognitionElements: IPage['recognitionElements']): IPage {
    return { recognitionElements } as unknown as IPage;
}

describe('buildWordOverlay', () => {
    it('creates one appended span per boxed word, skipping non-Text elements', () => {
        const page = fakePage([
            {
                label: 'Real',
                type: 'Text',
                words: [{ label: 'Real', 'bounding-box': { x: 1, y: 2, width: 3, height: 4 } }],
            },
            {
                label: 'ignored',
                type: 'SomethingElse',
                words: [{ label: 'ignored', 'bounding-box': { x: 0, y: 0, width: 1, height: 1 } }],
            },
        ]);
        const container = document.createElement('div');

        const entries = buildWordOverlay(page, container, 1);

        expect(entries).toHaveLength(1);
        expect(entries[0].label).toBe('Real');
        expect(entries[0].pageNumber).toBe(1);
        expect(entries[0].el).not.toBeNull();
        expect(container.querySelectorAll('.word-overlay-span')).toHaveLength(1);
        expect(entries[0].el!.textContent).toBe('Real');
    });

    it('scales native bounding-box units by RECOGNITION_COORDINATE_SCALE (11.9)', () => {
        const page = fakePage([
            { label: 'x', type: 'Text', words: [{ label: 'x', 'bounding-box': { x: 10, y: 20, width: 30, height: 40 } }] },
        ]);
        const container = document.createElement('div');

        const [entry] = buildWordOverlay(page, container, 1);

        expect(entry.nativeX).toBeCloseTo(10 * 11.9);
        expect(entry.nativeY).toBeCloseTo(20 * 11.9);
        expect(entry.nativeWidth).toBeCloseTo(30 * 11.9);
        expect(entry.nativeHeight).toBeCloseTo(40 * 11.9);
    });

    it('keeps a word without a bounding box as a null-el entry rather than dropping it', () => {
        const page = fakePage([
            {
                label: 'paragraph test',
                type: 'Text',
                words: [{ label: 'paragraph' }, { label: ' ' }, { label: 'test' }].map((w) => ({
                    ...w,
                    'bounding-box': w.label === ' ' ? undefined : { x: 0, y: 0, width: 1, height: 1 },
                })),
            },
        ]);
        const container = document.createElement('div');

        const entries = buildWordOverlay(page, container, 1);

        expect(entries.map((e) => e.label)).toEqual(['paragraph', ' ', 'test']);
        expect(entries[1].el).toBeNull();
        expect(container.querySelectorAll('.word-overlay-span')).toHaveLength(2);
    });

    it('skips words with an empty label even if they have a bounding box', () => {
        const page = fakePage([
            { label: '', type: 'Text', words: [{ label: '', 'bounding-box': { x: 0, y: 0, width: 1, height: 1 } }] },
        ]);
        const container = document.createElement('div');

        expect(buildWordOverlay(page, container, 1)).toHaveLength(0);
    });
});

describe('buildWordSearchText', () => {
    it('concatenates word labels with no added separator', () => {
        const container = document.createElement('div');
        const page = fakePage([
            {
                label: 'paragraph test',
                type: 'Text',
                words: [
                    { label: 'paragraph', 'bounding-box': { x: 0, y: 0, width: 1, height: 1 } },
                    { label: ' ' },
                    { label: 'test', 'bounding-box': { x: 0, y: 0, width: 1, height: 1 } },
                ],
            },
        ]);
        const entries = buildWordOverlay(page, container, 1);

        const { text } = buildWordSearchText(entries);

        expect(text).toBe('paragraph test');
    });

    it('maps a character offset back to the entry that produced it', () => {
        const container = document.createElement('div');
        const page = fakePage([
            {
                label: 'Real time',
                type: 'Text',
                words: [
                    { label: 'Real', 'bounding-box': { x: 0, y: 0, width: 1, height: 1 } },
                    { label: ' ' },
                    { label: 'time', 'bounding-box': { x: 0, y: 0, width: 1, height: 1 } },
                ],
            },
        ]);
        const entries = buildWordOverlay(page, container, 1);

        const { text, entryAt } = buildWordSearchText(entries);
        expect(text).toBe('Real time');

        // "Real" occupies [0, 4); "time" occupies [5, 9)
        expect(entryAt(0)?.label).toBe('Real');
        expect(entryAt(3)?.label).toBe('Real');
        expect(entryAt(5)?.label).toBe('time');
        expect(entryAt(8)?.label).toBe('time');
        // offset 4 falls inside the boxless space entry - still resolvable,
        // just to an entry with a null el (nothing to visually highlight).
        expect(entryAt(4)?.label).toBe(' ');
        expect(entryAt(4)?.el).toBeNull();
    });

    it('returns undefined past the end of the text', () => {
        const { entryAt } = buildWordSearchText([]);
        expect(entryAt(0)).toBeUndefined();
    });

    describe('entriesInRange', () => {
        it('returns every entry a multi-word range overlaps, not just the one at its start', () => {
            // Confirmed as a real, reported bug (issue #199): a caller that
            // only ever looked up entryAt(range.start) - the shape
            // runFind() used before this function existed - silently
            // dropped every word after the first one a multi-word match
            // spanned, e.g. only "With" out of a "With enough" match.
            const container = document.createElement('div');
            const page = fakePage([
                {
                    label: 'With enough space',
                    type: 'Text',
                    words: [
                        { label: 'With', 'bounding-box': { x: 0, y: 0, width: 1, height: 1 } },
                        { label: ' ' },
                        { label: 'enough', 'bounding-box': { x: 0, y: 0, width: 1, height: 1 } },
                        { label: ' ' },
                        { label: 'space', 'bounding-box': { x: 0, y: 0, width: 1, height: 1 } },
                    ],
                },
            ]);
            const entries = buildWordOverlay(page, container, 1);
            const { text, entriesInRange } = buildWordSearchText(entries);
            expect(text).toBe('With enough space');

            // "With enough" spans [0, 11).
            const spanned = entriesInRange(0, 11);
            expect(spanned.map((e) => e.label)).toEqual(['With', ' ', 'enough']);
        });

        it('returns an empty array for a range with no overlap', () => {
            const { entriesInRange } = buildWordSearchText([]);
            expect(entriesInRange(0, 5)).toEqual([]);
        });
    });
});

describe('repositionWordOverlay', () => {
    it('scales native rects into the currently rendered CSS pixel size', () => {
        const container = document.createElement('div');
        const page = fakePage([{ label: 'x', type: 'Text', words: [{ label: 'x', 'bounding-box': { x: 10, y: 10, width: 10, height: 10 } }] }]);
        const entries = buildWordOverlay(page, container, 1);
        // native x/y/w/h are all 10 * 11.9 = 119

        repositionWordOverlay(entries, 238, 238, 238, 238); // rendered == native -> scale 1
        expect(entries[0].el!.style.left).toBe('119px');
        expect(entries[0].el!.style.top).toBe('119px');
        expect(entries[0].el!.style.width).toBe('119px');
        expect(entries[0].el!.style.height).toBe('119px');

        repositionWordOverlay(entries, 119, 119, 238, 238); // rendered at half native size -> scale 0.5
        expect(entries[0].el!.style.left).toBe('59.5px');
        expect(entries[0].el!.style.top).toBe('59.5px');
    });

    it('does not throw on entries with a null el', () => {
        const entries = [{ pageNumber: 1, label: ' ', el: null, nativeX: 0, nativeY: 0, nativeWidth: 0, nativeHeight: 0 }];
        expect(() => repositionWordOverlay(entries, 100, 100, 200, 200)).not.toThrow();
    });
});

describe('against a real .note fixture', () => {
    // Same fixture used elsewhere in this project for recognized-text
    // testing (has real English-language handwriting recognition data).
    const fixturePath = path.join(import.meta.dirname, '..', '..', 'supernote-typescript', 'tests', 'input', 'rtr.note');

    it('builds sensible, in-bounds overlay entries and search text from a real page', () => {
        const buffer = fs.readFileSync(fixturePath);
        const sn = new SupernoteX(new Uint8Array(buffer));
        const page = sn.pages[0];
        const container = document.createElement('div');

        const entries = buildWordOverlay(page, container, 1);
        expect(entries.length).toBeGreaterThan(0);

        const boxed = entries.filter((e) => e.el !== null);
        expect(boxed.length).toBeGreaterThan(0);
        for (const entry of boxed) {
            expect(entry.nativeX).toBeGreaterThanOrEqual(0);
            expect(entry.nativeY).toBeGreaterThanOrEqual(0);
            expect(entry.nativeX + entry.nativeWidth).toBeLessThanOrEqual(sn.pageWidth);
            expect(entry.nativeY + entry.nativeHeight).toBeLessThanOrEqual(sn.pageHeight);
        }

        expect(entries[0].label).toBe('Real');

        const { text, entryAt } = buildWordSearchText(entries);
        expect(text).toContain('Real');
        const offset = text.indexOf('Real');
        expect(entryAt(offset)?.label).toBe('Real');
    });

    it('reconstructs text identical to extractText()\'s own page.text for this fixture', () => {
        // Confirms the element-boundary '\n' inserted between separate
        // recognitionElements (e.g. this fixture's "Real"/"time"/
        // "recognition", three separate single-word elements with no
        // shared inter-element space word) keeps the word-level
        // reconstruction in sync with pdf.ts's own extractText() - without
        // it, adjacent elements' labels concatenate directly into one
        // glued-together word ("Realtimerecognition"), a real bug caught by
        // this exact assertion during development.
        const buffer = fs.readFileSync(fixturePath);
        const sn = new SupernoteX(new Uint8Array(buffer));
        const page = sn.pages[0];
        const container = document.createElement('div');

        const entries = buildWordOverlay(page, container, 1);
        const { text } = buildWordSearchText(entries);

        expect(text).toBe(page.text);
    });
});
