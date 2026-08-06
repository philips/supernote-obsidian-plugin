import { describe, it, expect } from 'vitest';
import { buildFrontmatter } from './frontmatter';

describe('buildFrontmatter', () => {
    it('always includes the supernote tag, source link, and page count', () => {
        const block = buildFrontmatter({
            sourceLink: '[[Meeting notes.note]]',
            device: '',
            pageCount: 3,
            keywords: [],
        });
        expect(block).toBe(
            '---\n'
            + 'tags:\n'
            + '  - supernote\n'
            + 'source: "[[Meeting notes.note]]"\n'
            + 'pages: 3\n'
            + '---\n',
        );
    });

    it('omits the device line when device is empty or the "0" sentinel', () => {
        for (const device of ['', '0']) {
            const block = buildFrontmatter({ sourceLink: '[[a]]', device, pageCount: 1, keywords: [] });
            expect(block).not.toContain('device:');
        }
    });

    it('includes the device line when set', () => {
        const block = buildFrontmatter({ sourceLink: '[[a]]', device: 'A5X2', pageCount: 1, keywords: [] });
        expect(block).toContain('device: "A5X2"\n');
    });

    it('omits the keywords block when there are no keywords', () => {
        const block = buildFrontmatter({ sourceLink: '[[a]]', device: '', pageCount: 1, keywords: [] });
        expect(block).not.toContain('keywords:');
    });

    it('renders keywords as a YAML list, preserving order', () => {
        const block = buildFrontmatter({
            sourceLink: '[[a]]',
            device: '',
            pageCount: 1,
            keywords: ['budget', 'Q3 plan'],
        });
        expect(block).toContain('keywords:\n  - "budget"\n  - "Q3 plan"\n');
    });

    it('safely quotes keywords and links containing YAML-significant characters', () => {
        const block = buildFrontmatter({
            sourceLink: '[[Notes: "quarterly" review]]',
            device: '',
            pageCount: 1,
            keywords: ['contains: a colon', 'has "quotes"'],
        });
        // The block must stay valid, single-value-per-line YAML: none of the
        // quoted scalars should introduce an unescaped colon or quote that
        // would be parsed as starting a new key or breaking the string.
        expect(block).toContain('source: "[[Notes: \\"quarterly\\" review]]"\n');
        expect(block).toContain('  - "contains: a colon"\n');
        expect(block).toContain('  - "has \\"quotes\\""\n');
    });

    it('starts and ends with the YAML delimiter, ending in a trailing blank line', () => {
        const block = buildFrontmatter({ sourceLink: '[[a]]', device: 'A5X2', pageCount: 2, keywords: ['x'] });
        expect(block.startsWith('---\n')).toBe(true);
        expect(block.endsWith('---\n')).toBe(true);
    });
});
