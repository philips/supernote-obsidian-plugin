import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchFromDevice, DEVICE_REQUEST_TIMEOUT_MS } from './deviceFetch';

describe('fetchFromDevice', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns the response on success', async () => {
        const response = new Response('ok', { status: 200 });
        const fetchMock = vi.fn().mockResolvedValue(response);
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list');

        expect(result).toBe(response);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://192.168.1.50:8089/path',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest types expect.any()'s return as `any` by design
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('forwards request init options like method and body alongside the timeout signal', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
        vi.stubGlobal('fetch', fetchMock);
        const body = new FormData();

        await fetchFromDevice('192.168.1.50', '/path', 'Upload failed', { method: 'POST', body });

        expect(fetchMock).toHaveBeenCalledWith(
            'http://192.168.1.50:8089/path',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest types expect.any()'s return as `any` by design
            expect.objectContaining({ method: 'POST', body, signal: expect.any(AbortSignal) }),
        );
    });

    it('reports the device as unresponsive when the request times out', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list')).rejects.toThrow(
            `Failed to load file list: Supernote at 192.168.1.50 did not respond within ${DEVICE_REQUEST_TIMEOUT_MS / 1000}s. `
            + `Check that it's on the same network and "Browse and Access" is turned on.`
        );
    });

    it('treats an AbortError the same as a timeout', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list')).rejects.toThrow(
            /did not respond within/
        );
    });

    it('reports an unreachable device distinctly from a timeout', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchFromDevice('192.168.1.50', '/path', 'Failed to load file list')).rejects.toThrow(
            'Failed to load file list: could not reach Supernote at 192.168.1.50 (Failed to fetch).'
        );
    });
});
