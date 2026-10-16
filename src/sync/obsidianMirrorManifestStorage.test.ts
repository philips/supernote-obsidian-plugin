import { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianMirrorManifestStorage } from './obsidianMirrorManifestStorage';
import { loadMirrorManifest, saveMirrorManifest } from './sharedMirrorManifestStore';

function fakeVault() {
    const entries = new Map<string, string | null>();
    const adapter = {
        stat: vi.fn(async (path: string) => !entries.has(path) ? null
            : { type: entries.get(path) === null ? 'folder' : 'file' }),
        read: vi.fn(async (path: string) => entries.get(path)!),
        mkdir: vi.fn(async (path: string) => { entries.set(path, null); }),
        write: vi.fn(async (path: string, contents: string) => { entries.set(path, contents); }),
    };
    const vault = { adapter, getAbstractFileByPath: vi.fn(() => null) };
    return { entries, adapter, vault, app: { vault } as unknown as App };
}

describe('Obsidian mirror manifest storage', () => {
    it('creates its reserved folder and alternates the two manifest files', async () => {
        const { app, adapter, vault, entries } = fakeVault();
        const storage = new ObsidianMirrorManifestStorage(app, 'Mirror');
        const first = await loadMirrorManifest(storage, {});
        expect(adapter.mkdir).toHaveBeenCalledWith('Mirror');
        expect(adapter.mkdir).toHaveBeenCalledWith('Mirror/.supernote-sync');
        const second = await saveMirrorManifest(storage, first, first.manifest);
        const third = await saveMirrorManifest(storage, second, second.manifest);
        expect(third.revision).toBe(3);
        expect(adapter.write).toHaveBeenCalledTimes(3);
        expect(vault.getAbstractFileByPath).not.toHaveBeenCalled();
        expect(entries.has('Mirror/.supernote-sync/primary.json')).toBe(true);
        expect(entries.has('Mirror/.supernote-sync/backup.json')).toBe(true);
    });

    it('refuses metadata collisions rather than overwriting existing vault entries', async () => {
        const { app, entries } = fakeVault();
        entries.set('Mirror/.supernote-sync', 'user file');
        const storage = new ObsidianMirrorManifestStorage(app, 'Mirror');
        await expect(loadMirrorManifest(storage, {})).rejects.toThrow('not a folder');
        entries.set('Mirror/.supernote-sync', null);
        entries.set('Mirror/.supernote-sync/primary.json', null);
        await expect(loadMirrorManifest(storage, {})).rejects.toThrow('not a file');
    });

    it('creates nested sync roots one segment at a time', async () => {
        const { app, adapter } = fakeVault();
        await loadMirrorManifest(new ObsidianMirrorManifestStorage(app, 'Vault/Mirror'), {});
        expect(adapter.mkdir.mock.calls.map(([path]) => path))
            .toEqual(['Vault', 'Vault/Mirror', 'Vault/Mirror/.supernote-sync']);
    });

    it('rejects unsafe destination roots before any vault access', () => {
        const { app, adapter } = fakeVault();
        expect(() => new ObsidianMirrorManifestStorage(app, 'Mirror/../other'))
            .toThrow('Unsafe shared mirror destination root');
        expect(() => new ObsidianMirrorManifestStorage(app, 'Mirror./other'))
            .toThrow('Unsafe shared mirror destination root');
        expect(adapter.mkdir).not.toHaveBeenCalled();
    });
});