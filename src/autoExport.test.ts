import { describe, expect, it } from 'vitest';
import { computeDigest, decideAction, isPathInScope, FM_SOURCE_DIGEST, FM_SOURCE_IMAGES, FM_OVERWRITE } from './autoExport';

describe('computeDigest', () => {
    it('is deterministic for the same bytes', async () => {
        const bytes = new TextEncoder().encode('hello supernote').buffer;
        const a = await computeDigest(bytes);
        const b = await computeDigest(bytes);
        expect(a).toBe(b);
        expect(a).toMatch(/^sha1-[0-9a-f]{40}$/);
    });

    it('differs for different bytes', async () => {
        const a = await computeDigest(new TextEncoder().encode('one').buffer);
        const b = await computeDigest(new TextEncoder().encode('two').buffer);
        expect(a).not.toBe(b);
    });
});

describe('isPathInScope', () => {
    it('is false when the watch list is empty', () => {
        expect(isPathInScope('Notes/Meeting.note', [])).toBe(false);
    });

    it('matches a file directly inside a watched folder', () => {
        expect(isPathInScope('Notes/Meeting.note', ['Notes'])).toBe(true);
    });

    it('matches a file nested arbitrarily deep inside a watched folder', () => {
        expect(isPathInScope('Notes/2026/07/Meeting.note', ['Notes'])).toBe(true);
    });

    it('does not match a sibling folder with a shared prefix', () => {
        expect(isPathInScope('Notes Archive/Meeting.note', ['Notes'])).toBe(false);
    });

    it('tolerates leading/trailing slashes in the configured folder', () => {
        expect(isPathInScope('Notes/Meeting.note', ['/Notes/'])).toBe(true);
    });

    it('ignores an empty-string folder entry instead of matching everything', () => {
        expect(isPathInScope('Anything/Meeting.note', ['', 'Other'])).toBe(false);
    });

    it('matches when one of several watched folders applies', () => {
        expect(isPathInScope('Work/Meeting.note', ['Personal', 'Work'])).toBe(true);
    });
});

describe('decideAction', () => {
    it('creates when no file exists at the target path', () => {
        expect(decideAction(null, false, 'sha1-aaa')).toEqual({ type: 'create' });
    });

    it('skips a foreign file (target exists but has no supernote frontmatter)', () => {
        expect(decideAction({}, false, 'sha1-aaa')).toEqual({ type: 'skip-foreign-file' });
    });

    it('is a no-op when the digest is unchanged', () => {
        const fm = { [FM_SOURCE_DIGEST]: 'sha1-aaa' };
        expect(decideAction(fm, true, 'sha1-aaa')).toEqual({ type: 'noop' });
    });

    it('regenerates when the digest changed and overwrite is not disabled', () => {
        const fm = { [FM_SOURCE_DIGEST]: 'sha1-aaa', [FM_SOURCE_IMAGES]: ['Note-1.png', 'Note-2.png'] };
        expect(decideAction(fm, true, 'sha1-bbb')).toEqual({
            type: 'regenerate',
            staleImages: ['Note-1.png', 'Note-2.png'],
        });
    });

    it('regenerates with an empty stale-image list when none were recorded', () => {
        const fm = { [FM_SOURCE_DIGEST]: 'sha1-aaa' };
        expect(decideAction(fm, true, 'sha1-bbb')).toEqual({ type: 'regenerate', staleImages: [] });
    });

    it('skips a user-edited file when the digest changed but overwrite is false', () => {
        const fm = { [FM_SOURCE_DIGEST]: 'sha1-aaa', [FM_OVERWRITE]: false };
        expect(decideAction(fm, true, 'sha1-bbb')).toEqual({ type: 'skip-user-edited' });
    });
});
