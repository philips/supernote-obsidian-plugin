import { App, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianCloudMirrorVault } from './obsidianCloudMirrorVault';

vi.mock('obsidian', () => ({ TFile: class TFile { path = ''; } }));

function fakeVault() {
    const entries = new Map<string, Uint8Array | null>();
    const vault = {
        getAbstractFileByPath: (path: string) => !entries.has(path) ? null
            : entries.get(path) === null ? { path } : Object.assign(new TFile(), { path }),
        readBinary: vi.fn(async (file: TFile) => entries.get(file.path)!.slice().buffer),
        createFolder: vi.fn(async (path: string) => { entries.set(path, null); }),
        createBinary: vi.fn(async (path: string, buffer: ArrayBuffer) => {
            entries.set(path, new Uint8Array(buffer));
        }),
        modifyBinary: vi.fn(async (file: TFile, buffer: ArrayBuffer) => {
            entries.set(file.path, new Uint8Array(buffer));
        }),
    };
    const fileManager = { trashFile: vi.fn(async (file: TFile) => { entries.delete(file.path); }) };
    return { entries, vault, fileManager,
        adapter: new ObsidianCloudMirrorVault({ vault, fileManager } as unknown as App) };
}

describe('Obsidian Cloud mirror vault', () => {
    it('creates nested parent folders and writes exact bytes at the planned path', async () => {
        const { entries, vault, adapter } = fakeVault();
        await adapter.write('Mirror/Note/fixture.note', new Uint8Array([0, 255, 1]));
        expect(vault.createFolder.mock.calls.map(([path]) => path)).toEqual(['Mirror', 'Mirror/Note']);
        expect(await adapter.read('Mirror/Note/fixture.note')).toEqual(new Uint8Array([0, 255, 1]));
        await adapter.write('Mirror/Note/fixture.note', new Uint8Array([4, 5]));
        expect(entries.get('Mirror/Note/fixture.note')).toEqual(new Uint8Array([4, 5]));
        expect(vault.createBinary).toHaveBeenCalledOnce();
        expect(vault.modifyBinary).toHaveBeenCalledOnce();
    });

    it('refuses folder collisions without writing', async () => {
        const { entries, vault, adapter } = fakeVault();
        entries.set('Mirror', new Uint8Array([1]));
        await expect(adapter.write('Mirror/Note/fixture.note', new Uint8Array([2])))
            .rejects.toThrow('not a folder');
        entries.set('Mirror', null);
        entries.set('Mirror/Note', null);
        entries.set('Mirror/Note/fixture.note', null);
        await expect(adapter.read('Mirror/Note/fixture.note')).rejects.toThrow('not a file');
        await expect(adapter.write('Mirror/Note/fixture.note', new Uint8Array([2])))
            .rejects.toThrow('not a file');
        expect(vault.modifyBinary).not.toHaveBeenCalled();
        expect(vault.createBinary).not.toHaveBeenCalled();
    });

    it('moves only a real file through Obsidian file manager Trash', async () => {
        const { entries, fileManager, adapter } = fakeVault();
        entries.set('Mirror/Note/fixture.note', new Uint8Array([1]));
        entries.set('Mirror/Note/folder', null);
        await adapter.trash('Mirror/Note/fixture.note');
        expect(fileManager.trashFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'Mirror/Note/fixture.note' }));
        expect(entries.has('Mirror/Note/fixture.note')).toBe(false);
        await expect(adapter.trash('Mirror/Note/folder')).rejects.toThrow('not a file');
        await expect(adapter.trash('Mirror/Note/unknown.note')).rejects.toThrow('not a file');
        expect(fileManager.trashFile).toHaveBeenCalledOnce();
    });
});