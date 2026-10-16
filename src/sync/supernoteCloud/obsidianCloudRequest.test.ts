import { describe, expect, it, vi } from 'vitest';
import { requestUrl, type RequestUrlParam } from 'obsidian';
import { createObsidianCloudRequest } from './obsidianCloudRequest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

describe('Obsidian Cloud request adapter', () => {
    it('maps fetch-style requests to requestUrl and maps the response back', async () => {
        vi.mocked(requestUrl).mockResolvedValue({
            status: 200,
            headers: { 'x-xsrf-token': 'synthetic-csrf' },
            text: '{"success":true}',
            json: { success: true },
            arrayBuffer: new ArrayBuffer(0),
        });
        const cloudRequest = createObsidianCloudRequest();

        const response = await cloudRequest(new URL('https://cloud.test/api/user/query'), {
            method: 'POST',
            headers: new Headers({ 'x-access-token': 'synthetic-token', 'Content-Type': 'application/json' }),
            body: '{"probe":true}',
        });

        expect(requestUrl).toHaveBeenCalledWith({
            url: 'https://cloud.test/api/user/query',
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-access-token': 'synthetic-token' },
            body: '{"probe":true}',
            throw: false,
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('x-xsrf-token')).toBe('synthetic-csrf');
        await expect(response.text()).resolves.toBe('{"success":true}');
    });

    it('preserves a redirect status returned by requestUrl', async () => {
        vi.mocked(requestUrl).mockResolvedValue({
            status: 302,
            headers: { location: 'https://cloud.test/next' },
            text: '',
            json: null,
            arrayBuffer: new ArrayBuffer(0),
        });
        const response = await createObsidianCloudRequest()('https://cloud.test/api/csrf');
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('https://cloud.test/next');
    });

    it('rejects promptly when the transport timeout signal aborts', async () => {
        const request = vi.fn((_options: RequestUrlParam) => new Promise<{
            status: number;
            headers: Record<string, string>;
            text: string;
        }>(() => {}));
        const controller = new AbortController();
        const pending = createObsidianCloudRequest(request)('https://cloud.test/api/csrf', {
            signal: controller.signal,
        });
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(request).toHaveBeenCalledOnce();
    });
});