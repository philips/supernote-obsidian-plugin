import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { fetchFromDevice, buildMultipartBody, DEVICE_REQUEST_TIMEOUT_MS } from './deviceFetch';

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

    describe('with fake timers', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        it('reports the device as unresponsive when the request times out', async () => {
            const pending = new Promise(() => { /* never resolves */ });
            vi.mocked(requestUrl).mockReturnValue(Object.assign(pending, {
                arrayBuffer: pending.then(() => new ArrayBuffer(0)),
                json: pending.then(() => undefined),
                text: pending.then(() => ''),
            }) as ReturnType<typeof requestUrl>);

            const assertion = expect(fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list')).rejects.toThrow(
                `Failed to load file list: Supernote at 192.168.1.50 did not respond within ${DEVICE_REQUEST_TIMEOUT_MS / 1000}s. `
                + `Check that it's on the same network and "Browse and Access" is turned on.`
            );
            await vi.advanceTimersByTimeAsync(DEVICE_REQUEST_TIMEOUT_MS);
            await assertion;
        });
    });

    it('reports an unreachable device distinctly from a timeout', async () => {
        vi.mocked(requestUrl).mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

        await expect(fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list')).rejects.toThrow(
            'Failed to load file list: could not reach Supernote at 192.168.1.50 (net::ERR_CONNECTION_REFUSED).'
        );
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
