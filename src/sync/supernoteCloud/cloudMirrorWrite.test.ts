import { describe, expect, it, vi } from 'vitest';
import { hashBytes } from '../directIP/deviceSync';
import { CLOUD_MAX_MOBILE_FILE_BYTES } from './cloudPolicy';
import { CloudInventoryItem } from './cloudInventory';
import { CloudMirrorCandidate } from './cloudMirrorPlan';
import { applyCloudDownload } from './cloudMirrorWrite';
import { SharedMirrorManifest } from '../sharedMirrorManifest';

const content = new Uint8Array([0, 255, 1]);
const md5 = '0123456789abcdef0123456789abcdef';
const vaultPath = 'Mirror/Note/Binary.note';
const item: CloudInventoryItem = {
    id: '1', directoryId: '0', fileName: 'Binary.note', isFolder: false, size: '3', md5,
    depth: 1, parentDerivedPath: '/unverified/Binary.note', parentPath: '/unverified',
};
const candidate: CloudMirrorCandidate = { item, canonicalPath: '/Note/Binary.note', vaultPath };

function fixture(existing: Uint8Array | null, manifestRecord?: SharedMirrorManifest['records'][string]) {
    let stored = existing;
    const vault = {
        read: vi.fn(async () => stored),
        write: vi.fn(async (_path: string, bytes: Uint8Array) => { stored = bytes.slice(); }),
        contents: () => stored,
    };
    const transfer = { download: vi.fn(async () => content.slice()), md5: vi.fn(async () => md5) };
    const manifest: SharedMirrorManifest = {
        version: 1, cloudAccountFingerprint: 'v1:synthetic-account',
        records: manifestRecord ? { [vaultPath]: manifestRecord } : {},
    };
    return { vault, transfer, manifest };
}

describe('Cloud raw-byte mirror boundary', () => {
    it('writes exact downloaded bytes and records their content hash after verification', async () => {
        const { vault, transfer, manifest } = fixture(null);
        const result = await applyCloudDownload(candidate, manifest, 'v1:synthetic-account', vault,
            transfer, CLOUD_MAX_MOBILE_FILE_BYTES);
        expect(result.outcome).toBe('written');
        expect(vault.contents()).toEqual(content);
        expect(result.manifest.records[vaultPath]).toEqual({
            contentHash: hashBytes(content), source: { engineId: 'supernote-cloud', md5 },
        });
        expect(manifest.records).toEqual({});
    });

    it('protects local edits detected after the download completes', async () => {
        const { vault, transfer, manifest } = fixture(new Uint8Array([99]), {
            contentHash: hashBytes(new Uint8Array([1])),
            source: { engineId: 'ip-device', deviceUri: '/Binary.note', deviceDate: 'today', deviceSize: 1 },
        });
        const result = await applyCloudDownload(candidate, manifest, 'v1:synthetic-account', vault,
            transfer, CLOUD_MAX_MOBILE_FILE_BYTES);
        expect(result.outcome).toBe('protected');
        expect(result.manifest).toBe(manifest);
        expect(vault.write).not.toHaveBeenCalled();
    });

    it('re-baselines identical IP bytes without writing and refuses unowned collisions', async () => {
        const previous = { contentHash: hashBytes(content), source: {
            engineId: 'ip-device' as const, deviceUri: '/Binary.note', deviceDate: 'today', deviceSize: 3,
        } };
        const owned = fixture(content.slice(), previous);
        const adopted = await applyCloudDownload(candidate, owned.manifest, 'v1:synthetic-account', owned.vault,
            owned.transfer, CLOUD_MAX_MOBILE_FILE_BYTES);
        expect(adopted.outcome).toBe('already-current');
        expect(owned.vault.write).not.toHaveBeenCalled();
        expect(adopted.manifest.records[vaultPath].source).toEqual({ engineId: 'supernote-cloud', md5 });

        const unowned = fixture(new Uint8Array([5]));
        const refused = await applyCloudDownload(candidate, unowned.manifest, 'v1:synthetic-account', unowned.vault,
            unowned.transfer, CLOUD_MAX_MOBILE_FILE_BYTES);
        expect(refused.outcome).toBe('protected');
        expect(unowned.vault.write).not.toHaveBeenCalled();
    });

    it('never writes or updates history on bad checksum, excessive size, or failed write', async () => {
        const { vault, transfer, manifest } = fixture(null);
        transfer.md5.mockResolvedValueOnce('ffffffffffffffffffffffffffffffff');
        await expect(applyCloudDownload(candidate, manifest, 'v1:synthetic-account', vault,
            transfer, CLOUD_MAX_MOBILE_FILE_BYTES))
            .rejects.toThrow('checksum validation');
        expect(vault.write).not.toHaveBeenCalled();
        expect(manifest.records).toEqual({});

        await expect(applyCloudDownload(candidate, manifest, 'v1:synthetic-account', vault, transfer, 2))
            .rejects.toThrow('oversized transfer metadata');
        expect(transfer.download).toHaveBeenCalledOnce();

        vault.write.mockRejectedValueOnce(new Error('disk full'));
        await expect(applyCloudDownload(candidate, manifest, 'v1:synthetic-account', vault,
            transfer, CLOUD_MAX_MOBILE_FILE_BYTES))
            .rejects.toThrow('disk full');
        expect(manifest.records).toEqual({});
    });

    it('never downloads across account bindings', async () => {
        const { vault, transfer, manifest } = fixture(null);
        await expect(applyCloudDownload(candidate, manifest, 'v1:another', vault,
            transfer, CLOUD_MAX_MOBILE_FILE_BYTES)).rejects.toThrow('account binding');
        expect(transfer.download).not.toHaveBeenCalled();
    });
});