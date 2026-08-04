// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { buildSidebarList, setupLazyListLoading, fillSidebarThumbnail } from './sidebarList';

describe('buildSidebarList', () => {
    it('builds one item per spec, in order, with a thumbnail reserving the given aspect ratio', () => {
        const container = document.createElement('div');
        const items = buildSidebarList(
            container,
            [{ label: '1' }, { label: '2' }, { label: '3' }],
            { thumbnailAspectRatio: { width: 1404, height: 1872 } },
        );

        expect(items).toHaveLength(3);
        expect(container.querySelectorAll('.sidebar-list-item')).toHaveLength(3);
        for (const item of items) {
            expect(item.imgEl.style.aspectRatio).toBe('1404 / 1872');
            expect(item.imgEl.src).toBe('');
        }
    });

    it('renders a plain label (no checkbox) when checkbox is omitted', () => {
        const container = document.createElement('div');
        const [item] = buildSidebarList(container, [{ label: 'Page 1' }], {
            thumbnailAspectRatio: { width: 100, height: 200 },
        });

        expect(item.itemEl.querySelector('input[type="checkbox"]')).toBeNull();
        expect(item.itemEl.querySelector('.sidebar-list-label')?.textContent).toBe('Page 1');
    });

    it('renders a checkbox (checked state + label) when provided, and calls onChange with the new checked state', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        const [item] = buildSidebarList(
            container,
            [{ label: 'Background', checkbox: { checked: true, onChange } }],
            { thumbnailAspectRatio: { width: 100, height: 200 } },
        );

        const checkbox = item.itemEl.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        expect(checkbox.checked).toBe(true);
        expect(item.itemEl.querySelector('.sidebar-list-checkbox-label')?.textContent).toContain('Background');
        // No separate .sidebar-list-label - the checkbox's own <label> already carries the text.
        expect(item.itemEl.querySelector('.sidebar-list-label')).toBeNull();

        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenCalledWith(false);
    });

    it('calls onItemClick with the clicked item\'s index when the row is clicked', () => {
        const container = document.createElement('div');
        const onItemClick = vi.fn();
        const items = buildSidebarList(container, [{ label: 'a' }, { label: 'b' }], {
            thumbnailAspectRatio: { width: 1, height: 1 },
            onItemClick,
        });

        items[1].itemEl.click();

        expect(onItemClick).toHaveBeenCalledWith(1);
        expect(onItemClick).toHaveBeenCalledTimes(1);
    });

    it('does not attach a click handler when onItemClick is omitted (no error on click)', () => {
        const container = document.createElement('div');
        const [item] = buildSidebarList(container, [{ label: 'a' }], { thumbnailAspectRatio: { width: 1, height: 1 } });
        expect(() => item.itemEl.click()).not.toThrow();
    });
});

describe('fillSidebarThumbnail', () => {
    it('sets the item\'s img src', () => {
        const container = document.createElement('div');
        const [item] = buildSidebarList(container, [{ label: 'a' }], { thumbnailAspectRatio: { width: 1, height: 1 } });
        fillSidebarThumbnail(item, 'data:image/png;base64,aaa');
        expect(item.imgEl.src).toBe('data:image/png;base64,aaa');
    });
});

describe('setupLazyListLoading', () => {
    // happy-dom's IntersectionObserver never actually fires callbacks (no
    // real layout engine - see this project's other test files' own
    // comments on the same limitation), so this only exercises the setup
    // itself (every item gets observed) - the debounce/re-check behavior
    // is verified in a real browser instead (see the Playwright
    // verification for this feature).
    it('observes every item element against the given root', () => {
        const root = document.createElement('div');
        const items = [document.createElement('div'), document.createElement('div')];
        const observeSpy = vi.spyOn(IntersectionObserver.prototype, 'observe');

        setupLazyListLoading(root, items, () => {});

        expect(observeSpy).toHaveBeenCalledTimes(2);
        expect(observeSpy).toHaveBeenCalledWith(items[0]);
        expect(observeSpy).toHaveBeenCalledWith(items[1]);
        observeSpy.mockRestore();
    });

    it('returns a real IntersectionObserver instance', () => {
        const root = document.createElement('div');
        const observer = setupLazyListLoading(root, [], () => {});
        expect(observer).toBeInstanceOf(IntersectionObserver);
    });
});
