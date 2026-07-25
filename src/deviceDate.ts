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
