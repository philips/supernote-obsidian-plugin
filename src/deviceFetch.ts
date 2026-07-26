import { requestUrl, RequestUrlParam } from 'obsidian';

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
export const DEVICE_REQUEST_TIMEOUT_MS = 3000;

export interface DeviceResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type DeviceRequestInit = Pick<RequestUrlParam, 'method' | 'body' | 'contentType' | 'headers'>;

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
    let timeoutHandle: ReturnType<typeof window.setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = window.setTimeout(
            () => reject(new DOMException('The operation timed out.', 'TimeoutError')),
            DEVICE_REQUEST_TIMEOUT_MS,
        );
    });

    try {
        const response = await Promise.race([
            requestUrl({
                url: `http://${ip}:8089${path}`,
                throw: false,
                ...init,
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
                `${context}: Supernote at ${ip} did not respond within ${DEVICE_REQUEST_TIMEOUT_MS / 1000}s. `
                + `Check that it's on the same network and "Browse and Access" is turned on.`
            );
        }
        throw new Error(
            `${context}: could not reach Supernote at ${ip} (${err instanceof Error ? err.message : String(err)}).`
        );
    }
}
