import { describe, expect, it, vi } from 'vitest';
import { hashBytes } from '../directIP/deviceSync';
import { DEFAULT_FILE_EXTENSION_ALLOWLIST } from '../syncFilters';
import { DEFAULT_SYNC_EXECUTION_STATE, SingleEngineSyncCoordinator } from '../syncAbstraction';
import { CloudInventoryItem } from './cloudInventory';
import { planVerifiedCloudInventory, runVerifiedCloudMirror } from './cloudMirrorPipeline';
import { SharedMirrorManifest } from '../sharedMirrorManifest';
import { loadMirrorManifest, MirrorManifestSlot, RootMirrorManifestService, saveMirrorManifest } from '../sharedMirrorManifestStore';
import { recoverMirrorOperation } from '../mirrorOperationExecutor';

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
            trashEmptyFolder: vi.fn(async () => false),
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
        expect(result).toMatchObject({ removed: 1, removedFolders: 0, protected: ['Mirror/Note/Edited.note'] });
        expect(vault.trash).toHaveBeenCalledExactlyOnceWith('Mirror/Note/Missing.note');
        expect(vault.trashEmptyFolder).not.toHaveBeenCalled();
        expect(files.has('Mirror/Note/Unmanaged.note')).toBe(true);
        expect(files.has('Mirror/Note/Out.txt')).toBe(true);
        expect(files.has('Mirror/Note/Kept.note')).toBe(true);
        expect((await loadMirrorManifest(storage, {})).manifest.records).toHaveProperty('Mirror/Note/Edited.note');
        expect((await loadMirrorManifest(storage, {})).manifest.records).not.toHaveProperty('Mirror/Note/Missing.note');
        expect(verifyDeletionInventory).toHaveBeenCalledOnce();
    });

    it('prunes nested empty ancestors after commit but never the root or an occupied sibling', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic-account',
            records: { 'Mirror/Note/Nested/Missing.note': { contentHash: hashBytes(bytes),
                source: { engineId: 'supernote-cloud', md5 } } } });
        const folders = new Set(['Mirror', 'Mirror/Note', 'Mirror/Note/Nested', 'Mirror/Unrelated']);
        const files = new Map([['Mirror/Note/Nested/Missing.note', bytes]]);
        const trashEmptyFolder = vi.fn(async (path: string) => {
            expect((await loadMirrorManifest(storage, {})).manifest.records).not.toHaveProperty('Mirror/Note/Nested/Missing.note');
            if (!folders.has(path) || [...files.keys(), ...folders].some((entry) => entry.startsWith(`${path}/`))) return false;
            folders.delete(path);
            return true;
        });
        const vault = {
            read: vi.fn(async (path: string) => files.get(path) ?? null), write: vi.fn(async () => {}),
            trash: vi.fn(async (path: string) => { files.delete(path); }), trashEmptyFolder,
            listFolders: vi.fn(async () => ['Mirror/Note', 'Mirror/Note/Nested']),
        };
        const inventory = { directories: [], items: [] };
        const result = await runVerifiedCloudMirror({
            inventory, canonicalPathsById: {}, syncFolder: 'Mirror', legacyManifest: {},
            accountFingerprint: 'v1:synthetic-account', vault, storage,
            transfer: { download: vi.fn(), md5: vi.fn() }, pathFilters: [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory: async () => ({ inventory, canonicalPathsById: {} }),
        });
        expect(result.removed).toBe(1);
        expect(result.removedFolders).toBe(2);
        expect(trashEmptyFolder.mock.calls.map(([path]) => path)).toEqual(['Mirror/Note/Nested', 'Mirror/Note']);
        expect(folders).toEqual(new Set(['Mirror', 'Mirror/Unrelated']));
    });

    it.each(['absent', 'folder-empty', 'extension-excluded', 'path-excluded', 'included'].flatMap((state) =>
        [null, '.md', '.jpg', '.png', '.pdf'].map((localExtension) => ({ state, localExtension }))))('preserves a local $localExtension file with $state remote contents', async ({ state, localExtension }) => {
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {} });
        const folders = new Set(['Mirror', 'Mirror/Note', 'Mirror/Note/MM', 'Mirror/Note/Converted',
            'Mirror/Other', 'Mirror/.supernote-sync']);
        const localFiles = new Set(['Mirror/Note/Converted/fixture.md',
            ...(localExtension ? [`Mirror/Note/MM/fixture${localExtension}`] : [])]);
        const trashEmptyFolder = vi.fn(async (path: string) => {
            if (!folders.has(path) || [...folders, ...localFiles].some((child) => child.startsWith(`${path}/`))) return false;
            folders.delete(path);
            return true;
        });
        const folder: CloudInventoryItem = { ...item('1', 'MM'), isFolder: true, size: null, md5: null };
        const remote = state === 'absent' ? [] : state === 'folder-empty' ? [folder]
            : [folder, item('2', state === 'extension-excluded' ? 'Remote.txt' : 'Remote.note')];
        const inventory = { directories: [], items: remote };
        const canonicalPathsById: Record<string, string> = remote.length
            ? { '1': '/Note/MM', ...(remote.length > 1 ? { '2': `/Note/MM/${remote[1].fileName}` } : {}) } : {};
        const vault = { read: vi.fn(async () => null), write: vi.fn(async () => {}),
            trash: vi.fn(), listFolders: vi.fn(async () => [...folders].filter((path) => path !== 'Mirror')),
            trashEmptyFolder };
        const result = await runVerifiedCloudMirror({ inventory, canonicalPathsById, syncFolder: 'Mirror',
            legacyManifest: {}, accountFingerprint: 'v1:synthetic-account', vault, storage,
            transfer: { download: vi.fn(async () => new Uint8Array([1, 2, 3])), md5: vi.fn(async () => md5) },
            pathFilters: state === 'path-excluded' ? ['/Note/Elsewhere/**'] : [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory: async () => ({ inventory, canonicalPathsById }),
        });
        expect(result.failed).toEqual([]);
        expect(result.removedFolders).toBe(state !== 'included' && localExtension === null ? 2 : 1);
        expect(folders.has('Mirror/Note/MM')).toBe(state === 'included' || localExtension !== null);
        if (localExtension) expect(localFiles.has(`Mirror/Note/MM/fixture${localExtension}`)).toBe(true);
        expect(folders.has('Mirror/Note')).toBe(true);
        expect(folders.has('Mirror/Note/Converted')).toBe(true);
        expect(localFiles.has('Mirror/Note/Converted/fixture.md')).toBe(true);
        expect(folders.has('Mirror')).toBe(true);
        expect(folders.has('Mirror/.supernote-sync')).toBe(true);
        expect(vault.trash).not.toHaveBeenCalled();
        expect(trashEmptyFolder).not.toHaveBeenCalledWith('Mirror');
    });

    it.each(['changed', 'incomplete'])('does not sweep empty folders with a %s second inventory', async (state) => {
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {} });
        const trashEmptyFolder = vi.fn();
        const result = await runVerifiedCloudMirror({
            inventory: { directories: [], items: [] }, canonicalPathsById: {}, syncFolder: 'Mirror',
            legacyManifest: {}, accountFingerprint: 'v1:synthetic-account', storage,
            vault: { read: vi.fn(), write: vi.fn(), trash: vi.fn(),
                listFolders: vi.fn(async () => ['Mirror/Note/MM']), trashEmptyFolder },
            transfer: { download: vi.fn(), md5: vi.fn() }, pathFilters: [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory: async () => {
                if (state === 'incomplete') throw new Error('Incomplete inventory');
                return { inventory: { directories: [], items: [item('1', 'Remote.note')] },
                    canonicalPathsById: { '1': '/Note/MM/Remote.note' } };
            },
        });
        expect(result.warningCategories).toEqual([expect.stringContaining('deletion skipped')]);
        expect(result.removedFolders).toBe(0);
        expect(trashEmptyFolder).not.toHaveBeenCalled();
    });

    it('does not count a failed folder Trash move', async () => {
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {} });
        const inventory = { directories: [], items: [] };
        const result = await runVerifiedCloudMirror({
            inventory, canonicalPathsById: {}, syncFolder: 'Mirror', legacyManifest: {},
            accountFingerprint: 'v1:synthetic-account', storage,
            vault: { read: vi.fn(), write: vi.fn(), trash: vi.fn(),
                listFolders: vi.fn(async () => ['Mirror/Note']),
                trashEmptyFolder: vi.fn(async () => { throw new Error('Trash unavailable'); }) },
            transfer: { download: vi.fn(), md5: vi.fn() }, pathFilters: [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory: async () => ({ inventory, canonicalPathsById: {} }),
        });
        expect(result.removedFolders).toBe(0);
        expect(result.warningCategories).toEqual(['Cloud mirror folder cleanup failed']);
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
        const vault = { read: vi.fn(async () => bytes), write: vi.fn(async () => {}),
            trash: vi.fn(), trashEmptyFolder: vi.fn() };
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
        expect(vault.trashEmptyFolder).not.toHaveBeenCalled();
        expect(vault.read).not.toHaveBeenCalled();
        expect((await loadMirrorManifest(storage, {})).manifest.records).toHaveProperty('Mirror/Note/Missing.note');
    });

    it('does not Trash when the intent commit fails', async () => {
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
        const trashEmptyFolder = vi.fn();
        await expect(runVerifiedCloudMirror({
            inventory: { directories: [], items: [] }, canonicalPathsById: {}, syncFolder: 'Mirror',
            legacyManifest: {}, accountFingerprint: 'v1:synthetic-account', storage,
            vault: { read: vi.fn(async () => bytes), write: vi.fn(async () => {}), trash, trashEmptyFolder },
            transfer: { download: vi.fn(), md5: vi.fn() }, pathFilters: [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory: async () => ({ inventory: { directories: [], items: [] }, canonicalPathsById: {} }),
        })).rejects.toThrow('Manifest unavailable');
        expect(trash).not.toHaveBeenCalled();
        expect(trashEmptyFolder).not.toHaveBeenCalled();
    });

    it('recovers a pipeline write when the final manifest commit fails', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const slots = new Map<MirrorManifestSlot, string>();
        let failFinalCommit = false;
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => {
                if (failFinalCommit) {
                    failFinalCommit = false;
                    throw new Error('Manifest unavailable');
                }
                slots.set(slot, value);
                if ((JSON.parse(value) as { manifest: SharedMirrorManifest }).manifest.pendingOperation) failFinalCommit = true;
            },
        };
        await saveMirrorManifest(storage, null, {
            version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {},
        });
        const files = new Map<string, Uint8Array>();
        const vault = {
            read: async (path: string) => files.get(path) ?? null,
            write: async (path: string, content: Uint8Array) => { files.set(path, content.slice()); },
        };
        const inventory = { directories: [], items: [item('1', 'Interrupted.note')] };
        const options = {
            inventory, canonicalPathsById: { '1': '/Note/Interrupted.note' }, syncFolder: 'Mirror',
            legacyManifest: {}, accountFingerprint: 'v1:synthetic-account', vault, storage,
            transfer: { download: async () => bytes, md5: async () => md5 }, pathFilters: [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
        };

        await expect(runVerifiedCloudMirror(options)).rejects.toThrow('Manifest unavailable');
        expect([...files.keys()]).toEqual(['Mirror/Note/Interrupted.note']);
        expect((await loadMirrorManifest(storage, {})).manifest.pendingOperation?.path)
            .toBe('Mirror/Note/Interrupted.note');

        const service = new RootMirrorManifestService(() => storage);
        const loaded = await service.load({});
        await recoverMirrorOperation(service, loaded, 'Mirror', vault.read);
        expect((await loadMirrorManifest(storage, {})).manifest.pendingOperation).toBeUndefined();
        expect((await loadMirrorManifest(storage, {})).manifest.records['Mirror/Note/Interrupted.note'].contentHash)
            .toBe(hashBytes(bytes));
        expect(await runVerifiedCloudMirror(options)).toMatchObject({ synced: 0, unchanged: 1, failed: [] });
    });

    it('recovers a pipeline Trash when the final manifest commit fails', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const slots = new Map<MirrorManifestSlot, string>();
        let failFinalCommit = false;
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => {
                if (failFinalCommit) {
                    failFinalCommit = false;
                    throw new Error('Manifest unavailable');
                }
                slots.set(slot, value);
                if ((JSON.parse(value) as { manifest: SharedMirrorManifest }).manifest.pendingOperation) failFinalCommit = true;
            },
        };
        const path = 'Mirror/Note/Interrupted.note';
        const files = new Map([[path, bytes]]);
        const record = { contentHash: hashBytes(bytes), source: { engineId: 'supernote-cloud' as const, md5 } };
        await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic-account',
            records: { [path]: record } });
        const vault = {
            read: async (target: string) => files.get(target) ?? null,
            write: async () => {},
            trash: async (target: string) => { files.delete(target); },
        };
        const inventory = { directories: [], items: [] };
        const options = {
            inventory, canonicalPathsById: {}, syncFolder: 'Mirror', legacyManifest: {},
            accountFingerprint: 'v1:synthetic-account', vault, storage,
            transfer: { download: async () => bytes, md5: async () => md5 }, pathFilters: [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory: async () => ({ inventory, canonicalPathsById: {} }),
        };

        await expect(runVerifiedCloudMirror(options)).rejects.toThrow('Manifest unavailable');
        expect(files.has(path)).toBe(false);
        expect((await loadMirrorManifest(storage, {})).manifest.pendingOperation?.path).toBe(path);

        const service = new RootMirrorManifestService(() => storage);
        const loaded = await service.load({});
        await recoverMirrorOperation(service, loaded, 'Mirror', vault.read, async () => 'absent');
        expect((await loadMirrorManifest(storage, {})).manifest.pendingOperation).toBeUndefined();
        expect((await loadMirrorManifest(storage, {})).manifest.records).not.toHaveProperty(path);
        expect(await runVerifiedCloudMirror(options)).toMatchObject({ removed: 0, failed: [] });
    });

    it('rejects a stale second instance before writing and retries from the latest manifest', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, {
            version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {},
        });
        const files = new Map<string, Uint8Array>();
        const vault = {
            read: vi.fn(async (path: string) => files.get(path) ?? null),
            write: vi.fn(async (path: string, content: Uint8Array) => { files.set(path, content.slice()); }),
        };
        const firstPath = 'Mirror/Note/First.note';
        const secondPath = 'Mirror/Note/Second.note';
        const common = {
            syncFolder: 'Mirror', legacyManifest: {}, accountFingerprint: 'v1:synthetic-account',
            vault, storage, pathFilters: [], fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST,
            maxFileBytes: 100,
        };
        const firstOptions = {
            ...common, inventory: { directories: [], items: [item('1', 'First.note')] },
            canonicalPathsById: { '1': '/Note/First.note' },
            transfer: { download: vi.fn(async () => bytes), md5: vi.fn(async () => md5) },
        };
        const secondTransfer = {
            download: vi.fn(async () => {
                expect(await runVerifiedCloudMirror(firstOptions)).toMatchObject({ synced: 1, failed: [] });
                return bytes;
            }),
            md5: vi.fn(async () => md5),
        };
        const secondOptions = {
            ...common, inventory: { directories: [], items: [item('2', 'Second.note')] },
            canonicalPathsById: { '2': '/Note/Second.note' }, transfer: secondTransfer,
        };

        await expect(runVerifiedCloudMirror(secondOptions)).rejects.toThrow('changed since it was loaded');
        expect(files.has(firstPath)).toBe(true);
        expect(files.has(secondPath)).toBe(false);
        expect(vault.write).toHaveBeenCalledExactlyOnceWith(firstPath, bytes);
        const rejected = await loadMirrorManifest(storage, {});
        expect(rejected.manifest.pendingOperation).toBeUndefined();
        expect(Object.keys(rejected.manifest.records)).toEqual([firstPath]);

        const freshMd5 = 'fedcba9876543210fedcba9876543210';
        secondTransfer.download.mockImplementation(async () => bytes);
        secondTransfer.md5.mockImplementation(async () => freshMd5);
        const freshOptions = { ...secondOptions,
            inventory: { directories: [], items: [item('1', 'First.note'),
                { ...item('2', 'Second.note'), md5: freshMd5 }] },
            canonicalPathsById: { '1': '/Note/First.note', '2': '/Note/Second.note' },
        };
        const manualRun = vi.fn(async () => {
            const mirror = await runVerifiedCloudMirror(freshOptions);
            return { engineId: 'supernote-cloud' as const, ...mirror,
                issues: mirror.protected.map((item) => ({ kind: 'protected' as const, item, message: 'Protected' })) };
        });
        const state = { ...DEFAULT_SYNC_EXECUTION_STATE, activeSyncEngine: 'supernote-cloud' as const };
        const coordinator = new SingleEngineSyncCoordinator({ 'supernote-cloud': {
            id: 'supernote-cloud', name: 'Cloud', getReadiness: () => ({ ready: true }),
            run: manualRun, clearHistory: async () => {},
        } }, { load: () => state, save: () => {} }, new RootMirrorManifestService(() => storage),
        async () => {}, undefined, { root: () => 'Mirror', read: vault.read, attention: async () => {} });
        files.set(secondPath, new Uint8Array([9, 9, 9]));
        expect(await coordinator.runActive({ kind: 'manual', commandId: 'sync-now' })).toMatchObject({
            synced: 0, issues: [{ kind: 'protected', item: secondPath }], failed: [],
        });
        expect(vault.write).toHaveBeenCalledOnce();
        expect((await loadMirrorManifest(storage, {})).manifest.records).not.toHaveProperty(secondPath);

        files.delete(secondPath);
        expect(await coordinator.runActive({ kind: 'manual', commandId: 'sync-now' })).toMatchObject({
            synced: 1, unchanged: 1, failed: [], issues: [],
        });
        expect(manualRun).toHaveBeenCalledTimes(2);
        expect(vault.write).toHaveBeenCalledTimes(2);
        expect(files.get(secondPath)).toEqual(bytes);
        const current = await loadMirrorManifest(storage, {});
        expect(current.manifest.pendingOperation).toBeUndefined();
        expect(Object.keys(current.manifest.records).sort()).toEqual([firstPath, secondPath]);
        expect(current.manifest.records[secondPath].source).toMatchObject({ md5: freshMd5 });
    });

    it('protects a same-path file changed by another instance while download is in flight', async () => {
        const firstBytes = new Uint8Array([1, 2, 3]);
        const secondBytes = new Uint8Array([3, 2, 1]);
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, {
            version: 1, cloudAccountFingerprint: 'v1:synthetic-account', records: {},
        });
        const path = 'Mirror/Note/Shared.note';
        const files = new Map<string, Uint8Array>();
        const vault = {
            read: vi.fn(async (target: string) => files.get(target) ?? null),
            write: vi.fn(async (target: string, content: Uint8Array) => { files.set(target, content.slice()); }),
        };
        const common = {
            inventory: { directories: [], items: [item('1', 'Shared.note')] },
            canonicalPathsById: { '1': '/Note/Shared.note' }, syncFolder: 'Mirror',
            legacyManifest: {}, accountFingerprint: 'v1:synthetic-account', vault, storage,
            pathFilters: [], fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
        };
        const firstOptions = { ...common,
            transfer: { download: vi.fn(async () => firstBytes), md5: vi.fn(async () => md5) },
        };
        const secondOptions = { ...common,
            transfer: { download: vi.fn(async () => {
                await runVerifiedCloudMirror(firstOptions);
                return secondBytes;
            }), md5: vi.fn(async () => md5) },
        };

        expect(await runVerifiedCloudMirror(secondOptions)).toMatchObject({ synced: 0, protected: [path], failed: [] });
        expect(vault.write).toHaveBeenCalledExactlyOnceWith(path, firstBytes);
        expect(files.get(path)).toEqual(firstBytes);
        const current = await loadMirrorManifest(storage, {});
        expect(current.manifest.pendingOperation).toBeUndefined();
        expect(current.manifest.records[path].contentHash).toBe(hashBytes(firstBytes));
    });

    it('leaves a pending intent and does not prune when file Trash fails', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const slots = new Map<MirrorManifestSlot, string>();
        const storage = {
            read: async (slot: MirrorManifestSlot) => slots.get(slot) ?? null,
            write: async (slot: MirrorManifestSlot, value: string) => { slots.set(slot, value); },
        };
        await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic-account',
            records: Object.fromEntries(['Failed.note', 'Edited.note'].map((name) => [
                `Mirror/Note/${name}`, { contentHash: hashBytes(bytes), source: { engineId: 'supernote-cloud' as const, md5 } },
            ])) });
        const trash = vi.fn(async () => { throw new Error('Trash unavailable'); });
        const trashEmptyFolder = vi.fn();
        const inventory = { directories: [], items: [] };
        await expect(runVerifiedCloudMirror({
            inventory, canonicalPathsById: {}, syncFolder: 'Mirror', legacyManifest: {},
            accountFingerprint: 'v1:synthetic-account', storage,
            vault: { read: vi.fn(async (path: string) => path.endsWith('Edited.note')
                ? new Uint8Array([3, 2, 1]) : bytes), write: vi.fn(async () => {}), trash, trashEmptyFolder },
            transfer: { download: vi.fn(), md5: vi.fn() }, pathFilters: [],
            fileExtensions: DEFAULT_FILE_EXTENSION_ALLOWLIST, maxFileBytes: 100,
            verifyDeletionInventory: async () => ({ inventory, canonicalPathsById: {} }),
        })).rejects.toThrow('Trash unavailable');
        expect(trash).toHaveBeenCalledExactlyOnceWith('Mirror/Note/Failed.note');
        expect(trashEmptyFolder).not.toHaveBeenCalled();
        expect(Object.keys((await loadMirrorManifest(storage, {})).manifest.records)).toHaveLength(2);
        expect((await loadMirrorManifest(storage, {})).manifest.pendingOperation?.path).toBe('Mirror/Note/Failed.note');
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
        expect(vault.write).not.toHaveBeenCalled();
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