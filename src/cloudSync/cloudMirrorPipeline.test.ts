import { describe, expect, it, vi } from 'vitest';
import { hashBytes } from '../deviceSync';
import { DEFAULT_FILE_EXTENSION_ALLOWLIST } from '../syncFilters';
import { CloudInventoryItem } from './cloudInventory';
import { planVerifiedCloudInventory } from './cloudMirrorPipeline';
import { SharedMirrorManifest } from './sharedMirrorManifest';

const md5 = '0123456789abcdef0123456789abcdef';

function item(id: string, fileName: string): CloudInventoryItem {
    return { id, fileName, directoryId: '0', isFolder: false, size: '3', md5, depth: 1,
        parentDerivedPath: `/unverified/${fileName}`, parentPath: '/unverified' };
}

describe('Cloud inventory to shared-manifest planning', () => {
    it('reads only in-scope vault paths and protects edits to unchanged Cloud files', async () => {
        const written = new Uint8Array([0, 255, 1]);
        const changed = new Uint8Array([1, 2, 3]);
        const vault = {
            read: vi.fn(async (path: string) => path.endsWith('Kept.note') ? changed : written),
            write: vi.fn(async () => {}),
        };
        const manifest: SharedMirrorManifest = {
            version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {
                'Mirror/Note/Kept.note': { contentHash: hashBytes(written),
                    source: { engineId: 'supernote-cloud', md5 } },
            },
        };
        const inventory = { directories: [], items: [item('1', 'Kept.note'), item('2', 'Out.txt')] };
        const plan = await planVerifiedCloudInventory(inventory, {
            '1': '/Note/Kept.note', '2': '/Note/Out.txt',
        }, 'Mirror', manifest, 'v1:synthetic-account', vault, [], DEFAULT_FILE_EXTENSION_ALLOWLIST);

        expect(plan.protected.map(({ item: entry }) => entry.id)).toEqual(['1']);
        expect(plan.excluded.map(({ item: entry }) => entry.id)).toEqual(['2']);
        expect(vault.read).toHaveBeenCalledExactlyOnceWith('Mirror/Note/Kept.note');
        expect(vault.write).not.toHaveBeenCalled();
    });

    it('fails before vault access when a canonical path is missing', async () => {
        const vault = { read: vi.fn(async () => null), write: vi.fn(async () => {}) };
        const manifest: SharedMirrorManifest = { version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {} };
        await expect(planVerifiedCloudInventory({ directories: [], items: [item('1', 'Lost.note')] },
            {}, 'Mirror', manifest, 'v1:synthetic-account', vault, [], DEFAULT_FILE_EXTENSION_ALLOWLIST))
            .rejects.toThrow('Missing verified Cloud file path');
        expect(vault.read).not.toHaveBeenCalled();
    });

    it('rejects a different account before reading the vault', async () => {
        const vault = { read: vi.fn(async () => null), write: vi.fn(async () => {}) };
        const manifest: SharedMirrorManifest = { version: 1, cloudAccountFingerprint: 'v1:original', records: {} };
        await expect(planVerifiedCloudInventory({ directories: [], items: [item('1', 'Lost.note')] },
            { '1': '/Note/Lost.note' }, 'Mirror', manifest, 'v1:another', vault, [], DEFAULT_FILE_EXTENSION_ALLOWLIST))
            .rejects.toThrow('account binding');
        expect(vault.read).not.toHaveBeenCalled();
    });
});