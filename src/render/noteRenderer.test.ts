// @vitest-environment happy-dom
//
// Exercises noteRenderer.ts's DOM-building functions against a real DOM
// (happy-dom, not Obsidian) - exactly the "pull this out into standard Web
// tools" testability issue #183 asks for. Only this file opts into the
// happy-dom environment (see the directive above); everything else in this
// project still runs under vitest's default node environment.
import { describe, it, expect } from 'vitest';
import { buildNotePageElements, buildNotePagePlaceholders, fillNotePagePlaceholder } from './noteRenderer';

describe('buildNotePageElements', () => {
    it('builds one page-container per image, in order', () => {
        const container = document.createElement('div');
        const pages = buildNotePageElements(['data:image/png;base64,aaa', 'data:image/png;base64,bbb'], container);

        expect(pages).toHaveLength(2);
        expect(pages[0].pageNumber).toBe(1);
        expect(pages[1].pageNumber).toBe(2);
        expect(pages[0].imageEl.src).toBe('data:image/png;base64,aaa');
        expect(pages[1].imageEl.src).toBe('data:image/png;base64,bbb');
        expect(container.querySelectorAll('.page-container')).toHaveLength(2);
        expect(pages[0].containerEl.dataset.pageNumber).toBe('1');
    });

    it('numbers pages starting from startPageNumber', () => {
        const container = document.createElement('div');
        const pages = buildNotePageElements(['data:image/png;base64,aaa'], container, { startPageNumber: 5 });

        expect(pages[0].pageNumber).toBe(5);
        expect(pages[0].containerEl.dataset.pageNumber).toBe('5');
    });

    it('applies the invert-dark class only when requested', () => {
        const container = document.createElement('div');
        const [withInvert] = buildNotePageElements(['data:image/png;base64,aaa'], container, { invertColorsWhenDark: true });
        const [withoutInvert] = buildNotePageElements(['data:image/png;base64,bbb'], container);

        expect(withInvert.imageEl.classList.contains('supernote-invert-dark')).toBe(true);
        expect(withoutInvert.imageEl.classList.contains('supernote-invert-dark')).toBe(false);
    });
});

describe('buildNotePagePlaceholders', () => {
    it('builds pageCount placeholders with no image src set', () => {
        const container = document.createElement('div');
        const pages = buildNotePagePlaceholders(3, container, { pageWidth: 1404, pageHeight: 1872 });

        expect(pages).toHaveLength(3);
        expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
        for (const page of pages) {
            expect(page.imageEl.src).toBe('');
            expect(page.imageEl.style.aspectRatio).toBe('1404 / 1872');
            expect(page.imageEl.style.width).toBe('100%');
        }
    });
});

describe('fillNotePagePlaceholder', () => {
    it('sets the image src and clears the placeholder sizing overrides', () => {
        const container = document.createElement('div');
        const [page] = buildNotePagePlaceholders(1, container, { pageWidth: 100, pageHeight: 200 });

        fillNotePagePlaceholder(page, 'data:image/png;base64,ccc');

        expect(page.imageEl.src).toBe('data:image/png;base64,ccc');
        expect(page.imageEl.style.width).toBe('');
        expect(page.imageEl.style.aspectRatio).toBe('');
    });
});
