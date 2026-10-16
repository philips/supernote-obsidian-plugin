// The device's file listing gives dates as local wall-clock strings (no
// timezone), e.g. "2026-07-25 10:33:04". `new Date("... ...")` fails to
// parse that in most engines, so swap the separator for a `T` first and
// fall back to a raw parse for anything else the server might send.
export function parseDeviceDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    let d = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) {
        d = new Date(dateStr);
    }
    return isNaN(d.getTime()) ? null : d;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

export function todayLocalMidnight(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function formatDateInputValue(d: Date): string {
    const year = String(d.getFullYear()).padStart(4, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// `<input type="date">.valueAsDate` parses as UTC midnight, which shifts to
// the wrong calendar day in negative-UTC-offset timezones. Parse the
// "YYYY-MM-DD" string ourselves into a local-midnight Date instead.
export function parseDateInputValue(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
}
