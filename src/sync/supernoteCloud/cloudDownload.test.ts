import { describe, expect, it, vi } from 'vitest';
import { downloadCloudBytes } from './cloudDownload';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

const md5 = '0123456789abcdef0123456789abcdef';
const descriptor = (url: string, checksum = md5) => ({
    status: 200, body: JSON.stringify({ success: true, url, md5: checksum }),
});

describe('Cloud descriptor transfer', () => {
    it('requests the signed URL without Cloud authentication headers or redirect options', async () => {
        const request = vi.fn().mockResolvedValue({ status: 200, arrayBuffer: new Uint8Array([0, 255, 1]).buffer });
        const url = 'https://download.test/file?signature=private';
        const bytes = await downloadCloudBytes(descriptor(url), md5, 3, request);
        expect([...bytes]).toEqual([0, 255, 1]);
        expect(request).toHaveBeenCalledExactlyOnceWith({ url, method: 'GET', throw: false });
    });

    it('rejects a descriptor checksum mismatch before requesting bytes', async () => {
        const request = vi.fn();
        await expect(downloadCloudBytes(descriptor('https://download.test/file', 'f'.repeat(32)), md5, 3, request))
            .rejects.toThrow('checksum');
        expect(request).not.toHaveBeenCalled();
    });

    it('rejects failed requests, non-success status, and oversized responses', async () => {
        const url = 'https://download.test/file';
        await expect(downloadCloudBytes(descriptor(url), md5, 3, vi.fn().mockRejectedValue(new Error('private URL'))))
            .rejects.toThrow('Cloud download request failed');
        await expect(downloadCloudBytes(descriptor(url), md5, 3,
            vi.fn().mockResolvedValue({ status: 403, arrayBuffer: new ArrayBuffer(0) })))
            .rejects.toThrow('Cloud download request failed');
        await expect(downloadCloudBytes(descriptor(url), md5, 3,
            vi.fn().mockResolvedValue({ status: 200, arrayBuffer: new ArrayBuffer(4) })))
            .rejects.toThrow('size limit');
    });
});