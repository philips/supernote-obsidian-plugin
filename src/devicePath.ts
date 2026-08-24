/** Normalizes a device-side filename for comparison and vault paths. */
export function normalizeDeviceFileName(name: string): string {
    return name.normalize('NFC').replace(/\u00A0/g, ' ');
}

/** Decodes one URI path segment; treats '+' as space (some device listings use it). */
export function decodeDevicePathSegment(segment: string): string {
    const plusAsSpace = segment.replace(/\+/g, ' ');
    try {
        return normalizeDeviceFileName(decodeURIComponent(plusAsSpace));
    } catch {
        return normalizeDeviceFileName(plusAsSpace);
    }
}

// Percent-encodes each path segment for HTTP requests. Device listings often
// carry literal spaces in `uri` (or `%20` / `+` already); raw spaces in a URL
// are invalid and break downloads unless encoded.
export function encodeDeviceRequestPath(path: string): string {
    const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    return withLeadingSlash
        .split('/')
        .map((segment, index) => {
            if (index === 0 && segment === '') return '';
            if (segment === '') return segment;
            return encodeURIComponent(decodeDevicePathSegment(segment));
        })
        .join('/') || '/';
}
