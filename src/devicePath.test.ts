import { describe, it, expect } from 'vitest';
import { decodeDevicePathSegment, encodeDeviceRequestPath } from './devicePath';

describe('decodeDevicePathSegment', () => {
    it('decodes percent-encoded spaces', () => {
        expect(decodeDevicePathSegment('Work%20Journal.note')).toBe('Work Journal.note');
    });

    it('treats plus signs as spaces', () => {
        expect(decodeDevicePathSegment('Substack+Notes.note')).toBe('Substack Notes.note');
    });

    it('returns the segment unchanged when decoding fails', () => {
        expect(decodeDevicePathSegment('%E0%A4%A')).toBe('%E0%A4%A');
    });
});

describe('encodeDeviceRequestPath', () => {
    it('prefixes a missing leading slash before encoding', () => {
        expect(encodeDeviceRequestPath('Note/a b.note')).toBe('/Note/a%20b.note');
    });

    it('does not double-encode segments that are already percent-encoded', () => {
        expect(encodeDeviceRequestPath('/Note/Work%20Journal.note')).toBe('/Note/Work%20Journal.note');
    });
});
