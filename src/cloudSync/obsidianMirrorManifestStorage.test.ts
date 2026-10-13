import { App, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianMirrorManifestStorage } from './obsidianMirrorManifestStorage';
import { loadMirrorManifest, saveMirrorManifest } from './sharedMirrorManifestStore';

vi.mock('obsidian', () => ({ TFile: class TFile { path = ''; } }));

function fakeVault() {
    const entries = new Map<string, string | null>();
    const vault = {
        getAbstractFileByPath: (path: string) => !entries.has(path) ? null
            : entries.get(path) === null ? { path } : Object.assign(new TFile(), { path }),
        read: async (file: TFile) => entries.get(file.path)!,
        createFolder: vi.fn(async (path: string) => { entries.set(path, null); }),
        create: vi.fn(async (path: string, contents: string) => {
            entries.set(path, contents);
            return Object.assign(new TFile(), { path });
        }),
        modify: vi.fn(async (file: TFile, contents: string) => { entries.set(file.path, contents); }),
    };
    return { entries, vault, app: { vault } as unknown as App };
}

describe('Obsidian mirror manifest storage', () => {
    it('creates its reserved folder and alternates the two manifest files', async () => {
        const { app, vault, entries } = fakeVault();
        const storage = new ObsidianMirrorManifestStorage(app, 'Mirror');
        const first = await loadMirrorManifest(storage, {});
        expect(vault.createFolder).toHaveBeenCalledWith('Mirror');
        expect(vault.createFolder).toHaveBeenCalledWith('Mirror/.supernote-sync');
        const second = await saveMirrorManifest(storage, first, first.manifest);
        const third = await saveMirrorManifest(storage, second, second.manifest);
        expect(third.revision).toBe(3);
        expect(vault.modify).toHaveBeenCalledOnce();
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
        const { app, vault } = fakeVault();
        await loadMirrorManifest(new ObsidianMirrorManifestStorage(app, 'Vault/Mirror'), {});
        expect(vault.createFolder.mock.calls.map(([path]) => path))
            .toEqual(['Vault', 'Vault/Mirror', 'Vault/Mirror/.supernote-sync']);
    });

    it('rejects unsafe destination roots before any vault access', () => {
        const { app, vault } = fakeVault();
        expect(() => new ObsidianMirrorManifestStorage(app, 'Mirror/../other'))
            .toThrow('Unsafe shared mirror destination root');
        expect(() => new ObsidianMirrorManifestStorage(app, 'Mirror./other'))
            .toThrow('Unsafe shared mirror destination root');
        expect(vault.createFolder).not.toHaveBeenCalled();
    });
});