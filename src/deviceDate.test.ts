import { describe, it, expect } from 'vitest';
import { parseDeviceDate, isSameLocalDay, formatDateInputValue, parseDateInputValue } from './deviceDate';

describe('parseDeviceDate', () => {
    it('parses the space-separated format the Supernote device sends', () => {
        const d = parseDeviceDate('2026-07-25 10:33:04');
        expect(d).not.toBeNull();
        expect(d?.getFullYear()).toBe(2026);
        expect(d?.getMonth()).toBe(6); // 0-indexed: July
        expect(d?.getDate()).toBe(25);
        expect(d?.getHours()).toBe(10);
        expect(d?.getMinutes()).toBe(33);
        expect(d?.getSeconds()).toBe(4);
    });

    it('parses dates at the start and end of a month', () => {
        expect(parseDeviceDate('2026-01-01 00:00:00')?.getDate()).toBe(1);
        expect(parseDeviceDate('2026-12-31 23:59:59')?.getDate()).toBe(31);
    });

    it('falls back to a raw Date parse for other formats the server might send', () => {
        const d = parseDeviceDate('2026-07-25T10:33:04Z');
        expect(d).not.toBeNull();
        expect(d?.getUTCFullYear()).toBe(2026);
    });

    it('returns null for an empty string', () => {
        expect(parseDeviceDate('')).toBeNull();
    });

    it('returns null for unparseable garbage', () => {
        expect(parseDeviceDate('not a date')).toBeNull();
    });
});

describe('isSameLocalDay', () => {
    it('is true for the same calendar day at different times', () => {
        const morning = new Date(2026, 6, 25, 0, 0, 1);
        const night = new Date(2026, 6, 25, 23, 59, 59);
        expect(isSameLocalDay(morning, night)).toBe(true);
    });

    it('is false across a day boundary', () => {
        const justBeforeMidnight = new Date(2026, 6, 25, 23, 59, 59);
        const justAfterMidnight = new Date(2026, 6, 26, 0, 0, 0);
        expect(isSameLocalDay(justBeforeMidnight, justAfterMidnight)).toBe(false);
    });

    it('is false for the same day and month a year apart', () => {
        const thisYear = new Date(2026, 6, 25);
        const lastYear = new Date(2025, 6, 25);
        expect(isSameLocalDay(thisYear, lastYear)).toBe(false);
    });

    it('is false for the same day number in a different month', () => {
        const july = new Date(2026, 6, 25);
        const august = new Date(2026, 7, 25);
        expect(isSameLocalDay(july, august)).toBe(false);
    });
});

describe('formatDateInputValue / parseDateInputValue', () => {
    it('formats a Date as the YYYY-MM-DD value <input type="date"> expects', () => {
        expect(formatDateInputValue(new Date(2026, 6, 5))).toBe('2026-07-05');
    });

    it('pads single-digit months and days', () => {
        expect(formatDateInputValue(new Date(2026, 0, 1))).toBe('2026-01-01');
    });

    it('parses an input value back into a local-midnight Date', () => {
        const d = parseDateInputValue('2026-07-25');
        expect(d).not.toBeNull();
        expect(d?.getFullYear()).toBe(2026);
        expect(d?.getMonth()).toBe(6);
        expect(d?.getDate()).toBe(25);
        expect(d?.getHours()).toBe(0);
    });

    it('round-trips through format then parse', () => {
        const original = new Date(2025, 11, 31);
        const roundTripped = parseDateInputValue(formatDateInputValue(original));
        expect(roundTripped && isSameLocalDay(roundTripped, original)).toBe(true);
    });

    it('returns null for a malformed input value', () => {
        expect(parseDateInputValue('not-a-date')).toBeNull();
        expect(parseDateInputValue('')).toBeNull();
        expect(parseDateInputValue('2026/07/25')).toBeNull();
    });
});
