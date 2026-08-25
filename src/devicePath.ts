/** Normalizes a device-side filename for comparison and vault paths. */
export function normalizeDeviceFileName(name: string): string {
    return name.normalize('NFC').replace(/\u00A0/g, ' ');
}

// URI path segments are not form fields: a literal `+` is a literal plus.
// Supernote's Browse and Access listings nevertheless sometimes use form-style
// `+` for a space, so callers that have the listing's display name can use the
// form-style variant as a fallback.
export function decodeDevicePathSegment(segment: string): string {
    try {
        return normalizeDeviceFileName(decodeURIComponent(segment));
    } catch {
        return normalizeDeviceFileName(segment);
    }
}

export function decodeDeviceFormPathSegment(segment: string): string {
    return decodeDevicePathSegment(segment.replace(/\+/g, ' '));
}

/** Returns the URI path's standards-compliant and Supernote form-style forms. */
export function decodeDevicePathVariants(path: string): string[] {
    const decodePath = (decodeSegment: (segment: string) => string) => path
        .split('/')
        .map(decodeSegment)
        .join('/');
    return [...new Set([
        decodePath(decodeDevicePathSegment),
        decodePath(decodeDeviceFormPathSegment),
    ])];
}

/**
 * Percent-encodes every path segment for an HTTP request. `expectedLeafName`,
 * when available from a directory listing, disambiguates a literal `+` from
 * the Supernote server's non-standard `+`-for-space form.
 */
export function encodeDeviceRequestPath(path: string, expectedLeafName?: string): string {
    const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    const segments = withLeadingSlash.split('/');
    return segments
        .map((segment, index) => {
            if (index === 0 && segment === '') return '';
            if (segment === '') return segment;

            const standard = decodeDevicePathSegment(segment);
            const formStyle = decodeDeviceFormPathSegment(segment);
            const isLeaf = index === segments.length - 1;
            const expected = expectedLeafName === undefined ? undefined : normalizeDeviceFileName(expectedLeafName);
            const decoded = isLeaf && expected !== undefined && formStyle === expected && standard !== expected
                ? formStyle
                : standard;
            return encodeURIComponent(decoded);
        })
        .join('/') || '/';
}
