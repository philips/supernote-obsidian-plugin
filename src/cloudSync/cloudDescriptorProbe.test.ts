import { describe, expect, it, vi } from 'vitest';
import { probeCloudDownloadDescriptor } from '../../scripts/cloudDescriptorProbe';
import { CloudControlPlaneTransport } from './cloudProtocol';
import { CLOUD_ROUTES } from './cloudPolicy';

describe('read-only Cloud descriptor probe', () => {
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