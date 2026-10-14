import { describe, expect, it, vi } from 'vitest';
import { hashBytes } from '../deviceSync';
import { DEFAULT_FILE_EXTENSION_ALLOWLIST } from '../syncFilters';
import { CloudInventoryItem } from './cloudInventory';
import { planVerifiedCloudInventory, runVerifiedCloudMirror } from './cloudMirrorPipeline';
import { SharedMirrorManifest } from './sharedMirrorManifest';
import { loadMirrorManifest, MirrorManifestSlot, saveMirrorManifest } from './sharedMirrorManifestStore';

const md5 = '0123456789abcdef0123456789abcdef';

function item(id: string, fileName: string): CloudInventoryItem {
    return { id, fileName, directoryId: '0', isFolder: false, size: '3', md5, depth: 1,
        parentDerivedPath: `/unverified/${fileName}`, parentPath: '/unverified' };
}

describe('Cloud inventory to shared-manifest planning', () => {
    it('trashes only unchanged managed files missing from two identical verified inventories', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const files = new Map([['Mirror/Note/Missing.note', bytes],
            ['Mirror/Note/Edited.note', new Uint8Array([3, 2, 1])],
            ['Mirror/Note/Out.txt', bytes], ['Mirror/Note/Kept.note', bytes],
            ['Mirror/Note/Unmanaged.note', bytes]]);
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, {
            version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: Object.fromEntries(
                ['Missing.note', 'Edited.note', 'Out.txt', 'Kept.note'].map((name) => [
                    `Mirror/Note/${name}`, { contentHash: hashBytes(bytes), source: { engineId: 'ip-device' as const,
                        deviceUri: '/synthetic', deviceDate: '2026-01-01', deviceSize: 3 } },
                ])),
        });
        const vault = {
            read: vi.fn(async (path: string) => files.get(path) ?? null),
            write: vi.fn(async () => {}),
            trash: vi.fn(async (path: string) => { files.delete(path); }),
        };
        const inventory = { directories: [], items: [item('1', 'Kept.note')] };
        const canonicalPathsById = { '1': '/Note/Kept.note' };
        const verifyDeletionInventory = vi.fn(async () => ({ inventory, canonicalPathsById }));
        const result = await runVerifiedCloudMirror({
            inventory, canonicalPathsById, syncFolder: 'Mirror', legacyManifest: {},
            accountFingerprint: 'v1:synthetic-account', vault, storage,
            transfer: { download: vi.fn(async () => bytes), md5: vi.fn(async () => md5) },
            pathFilters: [], fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory,
        });
        expect(result).toMatchObject({ removed: 1, protected: ['Mirror/Note/Edited.note'] });
        expect(vault.trash).toHaveBeenCalledExactlyOnceWith('Mirror/Note/Missing.note');
        expect(files.has('Mirror/Note/Unmanaged.note')).toBe(true);
        expect(files.has('Mirror/Note/Out.txt')).toBe(true);
        expect(files.has('Mirror/Note/Kept.note')).toBe(true);
        expect((await loadMirrorManifest(storage, {})).manifest.records).toHaveProperty('Mirror/Note/Edited.note');
        expect((await loadMirrorManifest(storage, {})).manifest.records).not.toHaveProperty('Mirror/Note/Missing.note');
        expect(verifyDeletionInventory).toHaveBeenCalledOnce();
    });

    it.each(['changed', 'incomplete'])('suppresses cleanup when the second inventory is %s', async (state) => {
        const bytes = new Uint8Array([1, 2, 3]);
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic-account',
            records: { 'Mirror/Note/Missing.note': { contentHash: hashBytes(bytes),
                source: { engineId: 'supernote-cloud', md5 } } } });
        const vault = { read: vi.fn(async () => bytes), write: vi.fn(async () => {}), trash: vi.fn() };
        const result = await runVerifiedCloudMirror({
            inventory: { directories: [], items: [] }, canonicalPathsById: {}, syncFolder: 'Mirror',
            legacyManifest: {}, accountFingerprint: 'v1:synthetic-account', vault, storage,
            transfer: { download: vi.fn(), md5: vi.fn() }, pathFilters: [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory: async () => {
                if (state === 'incomplete') throw new Error('Incomplete pagination');
                return { inventory: { directories: [], items: [item('2', 'New.note')] },
                    canonicalPathsById: { '2': '/Note/New.note' } };
            },
        });
        expect(result.removed).toBe(0);
        expect(result.warningCategories).toEqual([expect.stringContaining('deletion skipped')]);
        expect(vault.trash).not.toHaveBeenCalled();
        expect(vault.read).not.toHaveBeenCalled();
        expect((await loadMirrorManifest(storage, {})).manifest.records).toHaveProperty('Mirror/Note/Missing.note');
    });

    it('stops deleting after Trash when the manifest commit fails', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const slots = new Map<MirrorManifestSlot, string>();
        let failWrite = false;
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => {
                if (failWrite) throw new Error('Manifest unavailable');
                slots.set(slot, value);
            },
        };
        await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic-account',
            records: Object.fromEntries(['First.note', 'Second.note'].map((name) => [
                `Mirror/Note/${name}`, { contentHash: hashBytes(bytes), source: { engineId: 'supernote-cloud' as const, md5 } },
            ])) });
        failWrite = true;
        const trash = vi.fn(async () => {});
        await expect(runVerifiedCloudMirror({
            inventory: { directories: [], items: [] }, canonicalPathsById: {}, syncFolder: 'Mirror',
            legacyManifest: {}, accountFingerprint: 'v1:synthetic-account', storage,
            vault: { read: vi.fn(async () => bytes), write: vi.fn(async () => {}), trash },
            transfer: { download: vi.fn(), md5: vi.fn() }, pathFilters: [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory: async () => ({ inventory: { directories: [], items: [] }, canonicalPathsById: {} }),
        })).rejects.toThrow('Manifest unavailable');
        expect(trash).toHaveBeenCalledOnce();
    });

    it('writes once, persists history, skips unchanged bytes, and protects a later local edit', async () => {
        const bytes = new Uint8Array([0, 255, 1]);
        const files = new Map<string, Uint8Array>();
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: vi.fn(async (slot: MirrorManifestSlot) => slots.get(slot) ?? null),
            write: vi.fn(async (slot: MirrorManifestSlot, contents: string) => { slots.set(slot, contents); }),
        };
        const bound: SharedMirrorManifest = {
            version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {},
        };
        await saveMirrorManifest(storage, null, bound);
        const vault = {
            read: vi.fn(async (path: string) => files.get(path) ?? null),
            write: vi.fn(async (path: string, content: Uint8Array) => { files.set(path, content.slice()); }),
        };
        const transfer = { download: vi.fn(async () => bytes.slice()), md5: vi.fn(async () => md5) };
        const options = {
            inventory: { directories: [], items: [item('1', 'Kept.note')] },
            canonicalPathsById: { '1': '/Note/Kept.note' }, syncFolder: 'Mirror', legacyManifest: {},
            accountFingerprint: 'v1:synthetic-account', vault, storage, transfer,
            pathFilters: [], fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
        };
        expect(await runVerifiedCloudMirror(options)).toMatchObject({
            synced: 1, unchanged: 0, protected: [], failed: [],
        });
        expect((await loadMirrorManifest(storage, {})).manifest.records['Mirror/Note/Kept.note'].contentHash)
            .toBe(hashBytes(bytes));
        expect(await runVerifiedCloudMirror(options)).toMatchObject({
            synced: 0, unchanged: 1, protected: [], failed: [],
        });
        expect(transfer.download).toHaveBeenCalledOnce();
        files.set('Mirror/Note/Kept.note', new Uint8Array([3, 2, 1]));
        expect(await runVerifiedCloudMirror(options)).toMatchObject({
            synced: 0, protected: ['Mirror/Note/Kept.note'], failed: [],
        });
        expect(vault.write).toHaveBeenCalledOnce();
        expect(transfer.download).toHaveBeenCalledOnce();
    });

    it('blocks an account mismatch before requesting bytes', async () => {
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, {
            version: 1, cloudAccountFingerprint: 'v1:other', records: {},
        });
        const transfer = { download: vi.fn(), md5: vi.fn() };
        await expect(runVerifiedCloudMirror({
            inventory: { directories: [], items: [item('1', 'Kept.note')] },
            canonicalPathsById: { '1': '/Note/Kept.note' }, syncFolder: 'Mirror', legacyManifest: {},
            accountFingerprint: 'v1:synthetic-account',
            vault: { read: vi.fn(async () => null), write: vi.fn(async () => {}) }, storage, transfer,
            pathFilters: [], fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
        })).rejects.toThrow('account binding');
        expect(transfer.download).not.toHaveBeenCalled();
    });

    it('keeps the existing vault copy and manifest when a transfer fails integrity verification', async () => {
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        const original = new Uint8Array([4, 5, 6]);
        await saveMirrorManifest(storage, null, {
            version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {
                'Mirror/Note/Kept.note': { contentHash: hashBytes(original),
                    source: { engineId: 'supernote-cloud', md5: 'f'.repeat(32) } },
            },
        });
        const vault = { read: vi.fn(async () => original), write: vi.fn(async () => {}) };
        const result = await runVerifiedCloudMirror({
            inventory: { directories: [], items: [item('1', 'Kept.note')] },
            canonicalPathsById: { '1': '/Note/Kept.note' }, syncFolder: 'Mirror', legacyManifest: {},
            accountFingerprint: 'v1:synthetic-account', vault, storage,
            transfer: { download: vi.fn(async () => new Uint8Array([1, 2, 3])), md5: vi.fn(async () => '0'.repeat(32)) },
            pathFilters: [], fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
        });
        expect(result.failed).toEqual(['Mirror/Note/Kept.note']);
        expect(result.failureCategories).toEqual(['Cloud download failed size or checksum validation']);
        expect(vault.write).not.toHaveBeenCalled();
        expect((await loadMirrorManifest(storage, {})).revision).toBe(1);
    });

    it('stops when manifest persistence fails after a write', async () => {
        const slots = new Map<MirrorManifestSlot, string>();
        let rejectNextWrite = false;
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => {
                if (rejectNextWrite) throw new Error('Storage unavailable');
                slots.set(slot, value);
            },
        };
        await saveMirrorManifest(storage, null, {
            version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {},
        });
        rejectNextWrite = true;
        const vault = { read: vi.fn(async () => null), write: vi.fn(async () => {}) };
        const transfer = { download: vi.fn(async () => new Uint8Array([0, 255, 1])), md5: vi.fn(async () => md5) };
        await expect(runVerifiedCloudMirror({
            inventory: { directories: [], items: [item('1', 'Kept.note'), item('2', 'Other.note')] },
            canonicalPathsById: { '1': '/Note/Kept.note', '2': '/Note/Other.note' },
            syncFolder: 'Mirror', legacyManifest: {}, accountFingerprint: 'v1:synthetic-account',
            vault, storage, transfer, pathFilters: [], fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST,
            maxFileBytes: 100,
        })).rejects.toThrow('Storage unavailable');
        expect(transfer.download).toHaveBeenCalledOnce();
        expect(vault.write).toHaveBeenCalledOnce();
    });
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