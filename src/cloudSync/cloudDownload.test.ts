import { describe, expect, it, vi } from 'vitest';
import { downloadCloudBytes } from './cloudDownload';

const md5 = '0123456789abcdef0123456789abcdef';
const descriptor = (url: string, checksum = md5) => ({
    status: 200, body: JSON.stringify({ success: true, url, md5: checksum }),
});
const hosts = new Set(['download.test', 'cdn.test']);

describe('Cloud descriptor transfer', () => {
    it('rejects unreviewed hosts, credentials, and mismatched checksums before fetching', async () => {
        const fetcher = vi.fn<typeof fetch>();
        for (const url of ['http://download.test/file', 'https://other.test/file',
            'https://user:secret@download.test/file', 'https://download.test:8443/file']) {
            await expect(downloadCloudBytes(descriptor(url), md5, hosts, 16, fetcher)).rejects.toThrow();
        }
        await expect(downloadCloudBytes(descriptor('https://download.test/file'), md5, new Set(), 16, fetcher)).rejects.toThrow();
        await expect(downloadCloudBytes(descriptor('https://download.test/file', 'f'.repeat(32)), md5, hosts, 16, fetcher)).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('follows only approved redirect hops without forwarding Cloud credentials', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.test/file' } }))
            .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
        const bytes = await downloadCloudBytes(descriptor('https://download.test/file'), md5, hosts, 3, fetcher);
        expect([...bytes]).toEqual([1, 2, 3]);
        expect(fetcher).toHaveBeenCalledTimes(2);
        for (const [, init] of fetcher.mock.calls) {
            expect(init?.headers).toBeUndefined();
            expect(init?.redirect).toBe('manual');
            expect(init?.credentials).toBe('omit');
            expect(init?.referrerPolicy).toBe('no-referrer');
        }
    });

    it('blocks unapproved redirect targets and oversized streamed responses', async () => {
        const redirected = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
            status: 302, headers: { location: 'https://unreviewed.test/file' },
        }));
        await expect(downloadCloudBytes(descriptor('https://download.test/file'), md5, hosts, 3, redirected)).rejects.toThrow();
        expect(redirected).toHaveBeenCalledOnce();

        const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4])));
        await expect(downloadCloudBytes(descriptor('https://download.test/file'), md5, hosts, 3, oversized)).rejects.toThrow('size limit');
    });

    it('bounds redirect chains at five hops', async () => {
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, {
            status: 302, headers: { location: '/next' },
        }));
        await expect(downloadCloudBytes(descriptor('https://download.test/file'), md5, hosts, 3, fetcher))
            .rejects.toThrow('Too many Cloud download redirects');
        expect(fetcher).toHaveBeenCalledTimes(6);
    });
});