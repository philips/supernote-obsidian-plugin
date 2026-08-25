import { describe, it, expect } from 'vitest';
import {
    decodeDeviceFormPathSegment,
    decodeDevicePathSegment,
    decodeDevicePathVariants,
    encodeDeviceRequestPath,
} from './devicePath';

describe('device path decoding', () => {
    it('decodes percent-encoded spaces', () => {
        expect(decodeDevicePathSegment('Work%20Journal.note')).toBe('Work Journal.note');
    });

    it('keeps literal plus signs in URI path segments', () => {
        expect(decodeDevicePathSegment('C++.note')).toBe('C++.note');
    });

    it('offers the Supernote form-style plus-as-space form separately', () => {
        expect(decodeDeviceFormPathSegment('Substack+Notes.note')).toBe('Substack Notes.note');
        expect(decodeDevicePathVariants('/Note/Substack+Notes.note')).toEqual([
            '/Note/Substack+Notes.note',
            '/Note/Substack Notes.note',
        ]);
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

    it('uses the listing name to distinguish literal plus from a space', () => {
        expect(encodeDeviceRequestPath('/Note/C++.note', 'C++.note')).toBe('/Note/C%2B%2B.note');
        expect(encodeDeviceRequestPath('/Note/Substack+Notes.note', 'Substack Notes.note')).toBe('/Note/Substack%20Notes.note');
    });

    it('uses display names for form-style spaces in parent directories', () => {
        expect(encodeDeviceRequestPath(
            '/Note/test+dir/a+b.note',
            'a b.note',
            ['Note', 'test dir'],
        )).toBe('/Note/test%20dir/a%20b.note');
    });
});
