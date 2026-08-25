import { requestUrl, RequestUrlParam } from 'obsidian';
import { encodeDeviceRequestPath } from './devicePath';

// Wraps Obsidian's `requestUrl` for requests to the Supernote's local "Browse
// and Access" HTTP server so every call site (listing, download, upload)
// times out and fails with the same clear message instead of hanging until
// the OS's TCP timeout (which can take a minute or more on an unreachable
// device and, to the user, looks indistinguishable from the plugin just
// doing nothing).
//
// This uses `requestUrl` rather than the global `fetch` because Obsidian's
// mobile app runs inside a WKWebView, which blocks cross-origin `fetch()`
// calls to a plain-HTTP LAN device (no CORS headers, mixed-content
// restrictions). `requestUrl` goes through Obsidian's native networking
// layer instead of the WebView's, so it isn't subject to those restrictions
// on either desktop or mobile.
//
// This short timeout is for metadata calls (directory listing) where a
// non-responding device should fail fast. File transfers (download/upload)
// pass a much longer `timeoutMs` below since moving the actual file bytes
// over a slow LAN/Tailscale link can legitimately take longer.
export const DEVICE_REQUEST_TIMEOUT_MS = 3000;
export const DEVICE_TRANSFER_TIMEOUT_MS = 120_000;

export interface DeviceResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type DeviceRequestInit = Pick<RequestUrlParam, 'method' | 'body' | 'contentType' | 'headers'> & {
    timeoutMs?: number;
    /** Display name from the listing, used to distinguish literal `+` from a space. */
    pathLeafName?: string;
    /** Listing display names for every parent directory of the requested path. */
    pathDirectoryNames?: readonly string[];
};

// `requestUrl`'s body can only be a string or ArrayBuffer (no FormData/Blob
// support like `fetch`), so a file upload has to be multipart/form-data-
// encoded by hand.
export function buildMultipartBody(
    fieldName: string,
    filename: string,
    mimeType: string,
    content: ArrayBuffer,
): { body: ArrayBuffer; contentType: string } {
    const boundary = `----ObsidianFormBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const encoder = new TextEncoder();
    const head = encoder.encode(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`
        + `Content-Type: ${mimeType}\r\n\r\n`
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);

    const body = new Uint8Array(head.length + content.byteLength + tail.length);
    body.set(head, 0);
    body.set(new Uint8Array(content), head.length);
    body.set(tail, head.length + content.byteLength);

    return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function fetchFromDevice(
    ip: string,
    path: string,
    context: string,
    init: DeviceRequestInit = {},
): Promise<DeviceResponse> {
    const { timeoutMs = DEVICE_REQUEST_TIMEOUT_MS, pathLeafName, pathDirectoryNames, ...requestInit } = init;

    // Pin the request to the device host: `path` comes from parsed device
    // directory listings, so a hostile or impersonating device controls its
    // contents. Without a leading "/", a crafted path like
    // "@evil.example/x" would make the URL's authority parse as userinfo
    // "ip:8089" plus host "evil.example" (WHATWG URL parsing treats
    // everything up to the first "/", "\\", "?", or "#" as the authority).
    // A leading "/" terminates the authority right after the port, so the
    // host can never be escaped. Normalizing (prefixing) rather than
    // rejecting keeps odd-but-benign listings from real devices working.
    const requestPath = encodeDeviceRequestPath(path, pathLeafName, pathDirectoryNames);

    let timeoutHandle: ReturnType<typeof window.setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = window.setTimeout(
            () => reject(new DOMException('The operation timed out.', 'TimeoutError')),
            timeoutMs,
        );
    });

    try {
        const response = await Promise.race([
            requestUrl({
                url: `http://${ip}:8089${requestPath}`,
                throw: false,
                ...requestInit,
            }),
            timeout,
        ]);
        window.clearTimeout(timeoutHandle!);
        return {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            text: async () => response.text,
            arrayBuffer: async () => response.arrayBuffer,
        };
    } catch (err) {
        window.clearTimeout(timeoutHandle!);
        const name = (err as { name?: string } | null)?.name;
        if (name === 'TimeoutError' || name === 'AbortError') {
            throw new Error(
                `${context}: Supernote at ${ip} did not respond within ${timeoutMs / 1000}s. `
                + `Check that it's on the same network and "Browse and Access" is turned on.`
            );
        }
        throw new Error(
            `${context}: could not reach Supernote at ${ip} (${err instanceof Error ? err.message : String(err)}).`
        );
    }
}
