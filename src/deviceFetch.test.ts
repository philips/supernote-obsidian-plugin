import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { fetchFromDevice, buildMultipartBody, DEVICE_REQUEST_TIMEOUT_MS, DEVICE_TRANSFER_TIMEOUT_MS } from './deviceFetch';

vi.mock('obsidian', () => ({
    requestUrl: vi.fn(),
}));

// deviceFetch.ts calls window.setTimeout/clearTimeout (needed for Obsidian's
// popout windows at runtime); vitest's default node environment has no
// `window`, so alias it to the global timer functions for these tests.
vi.stubGlobal('window', globalThis);

function mockResponse(overrides: Partial<Awaited<ReturnType<typeof requestUrl>>> = {}) {
    return {
        status: 200,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        json: undefined,
        text: '',
        ...overrides,
    };
}

describe('fetchFromDevice', () => {
    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('returns an ok response on success', async () => {
        vi.mocked(requestUrl).mockResolvedValue(mockResponse({ status: 200, text: 'ok' }));

        const result = await fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list');

        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        expect(await result.text()).toBe('ok');
        expect(requestUrl).toHaveBeenCalledWith(
            expect.objectContaining({ url: 'http://192.168.1.50:8089/path', throw: false }),
        );
    });

    it('reports non-2xx statuses as not ok instead of throwing', async () => {
        vi.mocked(requestUrl).mockResolvedValue(mockResponse({ status: 404, text: 'not found' }));

        const result = await fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list');

        expect(result.ok).toBe(false);
        expect(result.status).toBe(404);
    });

    it('forwards request init options like method, body, and contentType', async () => {
        vi.mocked(requestUrl).mockResolvedValue(mockResponse());

        await fetchFromDevice('192.168.1.50', '/path', 'Upload failed', {
            method: 'POST',
            body: 'payload',
            contentType: 'text/plain',
        });

        expect(requestUrl).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'POST', body: 'payload', contentType: 'text/plain' }),
        );
    });

    it('does not forward timeoutMs to requestUrl, which has no such option', async () => {
        vi.mocked(requestUrl).mockResolvedValue(mockResponse());

        await fetchFromDevice('192.168.1.50', '/path', 'Upload failed', { timeoutMs: DEVICE_TRANSFER_TIMEOUT_MS });

        const [[calledWith]] = vi.mocked(requestUrl).mock.calls;
        expect(calledWith).not.toHaveProperty('timeoutMs');
    });

    describe('with fake timers', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        function mockNeverResolving() {
            const pending = new Promise(() => { /* never resolves */ });
            vi.mocked(requestUrl).mockReturnValue(Object.assign(pending, {
                arrayBuffer: pending.then(() => new ArrayBuffer(0)),
                json: pending.then(() => undefined),
                text: pending.then(() => ''),
            }) as ReturnType<typeof requestUrl>);
        }

        it('reports the device as unresponsive when the request times out', async () => {
            mockNeverResolving();

            const assertion = expect(fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list')).rejects.toThrow(
                `Failed to load file list: Supernote at 192.168.1.50 did not respond within ${DEVICE_REQUEST_TIMEOUT_MS / 1000}s. `
                + `Check that it's on the same network and "Browse and Access" is turned on.`
            );
            await vi.advanceTimersByTimeAsync(DEVICE_REQUEST_TIMEOUT_MS);
            await assertion;
        });

        it('honors a longer timeoutMs override for file transfers', async () => {
            mockNeverResolving();

            const assertion = expect(
                fetchFromDevice('192.168.1.50', '/path', 'Failed to download file', { timeoutMs: DEVICE_TRANSFER_TIMEOUT_MS })
            ).rejects.toThrow(
                `Failed to download file: Supernote at 192.168.1.50 did not respond within ${DEVICE_TRANSFER_TIMEOUT_MS / 1000}s. `
                + `Check that it's on the same network and "Browse and Access" is turned on.`
            );
            // Confirm it hasn't already rejected at the short default timeout.
            await vi.advanceTimersByTimeAsync(DEVICE_REQUEST_TIMEOUT_MS);
            await vi.advanceTimersByTimeAsync(DEVICE_TRANSFER_TIMEOUT_MS - DEVICE_REQUEST_TIMEOUT_MS);
            await assertion;
        });
    });

    it('reports an unreachable device distinctly from a timeout', async () => {
        vi.mocked(requestUrl).mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

        await expect(fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list')).rejects.toThrow(
            'Failed to load file list: could not reach Supernote at 192.168.1.50 (net::ERR_CONNECTION_REFUSED).'
        );
    });

    describe('path normalization (host pinning)', () => {
        // The path comes from parsed device directory listings, i.e. from a
        // device an on-LAN attacker could impersonate. Without a leading "/",
        // a crafted path reparsesthe URL so the request leaves the device
        // host entirely — see fetchFromDevice's comment in deviceFetch.ts.
        it('prefixes a missing leading slash so an "@"-led path cannot smuggle in another host', async () => {
            vi.mocked(requestUrl).mockResolvedValue(mockResponse());

            await fetchFromDevice('192.168.1.50', '@evil.example/secret.note', 'Failed to download file');

            // Leading "/" still pins the host; "@" in the segment is encoded.
            expect(requestUrl).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'http://192.168.1.50:8089/%40evil.example/secret.note' }),
            );
        });

        it('prefixes a backslash-led path, which otherwise also terminates the URL authority', async () => {
            vi.mocked(requestUrl).mockResolvedValue(mockResponse());

            await fetchFromDevice('192.168.1.50', '\\evil.example/x.note', 'Failed to download file');

            expect(requestUrl).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'http://192.168.1.50:8089/%5Cevil.example/x.note' }),
            );
        });

        it('leaves already-absolute paths on the device host, encoding special characters in segments', async () => {
            vi.mocked(requestUrl).mockResolvedValue(mockResponse());

            await fetchFromDevice('192.168.1.50', '/Note/@mentions/x.note', 'Failed to load file list');

            expect(requestUrl).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'http://192.168.1.50:8089/Note/%40mentions/x.note' }),
            );
        });

        it('percent-encodes spaces and other special characters in path segments', async () => {
            vi.mocked(requestUrl).mockResolvedValue(mockResponse());

            await fetchFromDevice('192.168.1.50', '/Note/Work Journal.note', 'Failed to download file');

            expect(requestUrl).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'http://192.168.1.50:8089/Note/Work%20Journal.note' }),
            );
        });

        it('does not double-encode segments that are already percent-encoded', async () => {
            vi.mocked(requestUrl).mockResolvedValue(mockResponse());

            await fetchFromDevice('192.168.1.50', '/Note/Work%20Journal.note', 'Failed to download file');

            expect(requestUrl).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'http://192.168.1.50:8089/Note/Work%20Journal.note' }),
            );
        });
    });
});

describe('buildMultipartBody', () => {
    it('encodes a single-part multipart/form-data body with the given field, filename, and content', () => {
        const content = new TextEncoder().encode('hello world').buffer;

        const { body, contentType } = buildMultipartBody('file', 'note.txt', 'text/plain', content);

        expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
        const boundary = contentType.split('boundary=')[1];
        const decoded = new TextDecoder().decode(body);

        expect(decoded).toBe(
            `--${boundary}\r\n`
            + `Content-Disposition: form-data; name="file"; filename="note.txt"\r\n`
            + `Content-Type: text/plain\r\n\r\n`
            + `hello world`
            + `\r\n--${boundary}--\r\n`
        );
    });
});
