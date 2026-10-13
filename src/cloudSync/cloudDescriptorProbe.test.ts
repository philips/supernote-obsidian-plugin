import { describe, expect, it, vi } from 'vitest';
import { inspectCloudDescriptorHost, probeCloudDownloadDescriptor, verifyCloudFixtureDownload } from '../../scripts/cloudDescriptorProbe';
import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { CloudControlPlaneTransport } from './cloudProtocol';
import { CLOUD_ROUTES } from './cloudPolicy';

describe('read-only Cloud descriptor probe', () => {
    it('checks descriptor, byte count, and MD5 without writing the fixture', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const checksum = bytesToHex(md5(bytes));
        const post = vi.fn<CloudControlPlaneTransport['post']>().mockResolvedValue({
            status: 200, body: JSON.stringify({ success: true, url: 'https://files.example.test/signed?secret=token', md5: checksum }),
        });
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes));
        const transport = { bootstrapCsrf: vi.fn(), post };
        await expect(verifyCloudFixtureDownload(transport, 'access', '123', 3, checksum, 'files.example.test', fetcher))
            .resolves.toEqual({ sizeVerified: true, md5Verified: true });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'manual' });
        await expect(verifyCloudFixtureDownload(transport, 'access', '123', 3, '0'.repeat(32), 'files.example.test', fetcher))
            .rejects.toThrow('checksum');
        expect(fetcher).toHaveBeenCalledOnce();
        await expect(verifyCloudFixtureDownload(transport, 'access', '123', 3, checksum, 'other.example.test', fetcher))
            .rejects.toThrow('reviewed host');
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it('rejects corrupted fixture bytes after transfer', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const checksum = bytesToHex(md5(bytes));
        const transport: CloudControlPlaneTransport = {
            bootstrapCsrf: vi.fn(),
            post: vi.fn().mockResolvedValue({
                status: 200, body: JSON.stringify({ success: true, url: 'https://files.example.test/file', md5: checksum }),
            }),
        };
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([3, 2, 1])));
        await expect(verifyCloudFixtureDownload(transport, 'access', '123', 3, checksum, 'files.example.test', fetcher))
            .rejects.toThrow('MD5 verification');
    });
    it('exposes only a validated HTTPS hostname for local review', () => {
        const response = (url: string) => ({ status: 200, body: JSON.stringify({ success: true, url }) });
        expect(inspectCloudDescriptorHost(response('https://files.example.test/private?signature=secret')))
            .toBe('files.example.test');
        for (const url of ['http://files.example.test/private', 'https://user:pass@files.example.test/private',
            'https://files.example.test:8443/private', 'https://127.0.0.1/private']) {
            expect(() => inspectCloudDescriptorHost(response(url))).toThrow();
        }
    });
    it('requests only a download descriptor and returns no URL, checksum, or identifier', async () => {
        const post = vi.fn<CloudControlPlaneTransport['post']>().mockResolvedValue({
            status: 200,
            body: JSON.stringify({ success: true, url: 'https://download.example/file?secret=token', md5: 'a'.repeat(32) }),
        });
        const summary = await probeCloudDownloadDescriptor({ bootstrapCsrf: vi.fn(), post }, 'access-secret', '9223372036854775807');
        expect(post).toHaveBeenCalledWith(CLOUD_ROUTES.downloadDescriptor,
            { id: '9223372036854775807', type: '0' }, { accessToken: 'access-secret' });
        expect(summary).toEqual({ scheme: 'https', hostClass: 'other', md5FormatValid: true });
        expect(JSON.stringify(summary)).not.toMatch(/download\.example|token|9223372036854775807|aaaaaaaa/);
    });

    it('rejects invalid fixture IDs before sending a request', async () => {
        const post = vi.fn<CloudControlPlaneTransport['post']>();
        await expect(probeCloudDownloadDescriptor({ bootstrapCsrf: vi.fn(), post }, 'token', '01'))
            .rejects.toThrow('Invalid Cloud fixture ID');
        expect(post).not.toHaveBeenCalled();
    });
});