import { App, TFile, TFolder } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianCloudMirrorVault } from './obsidianCloudMirrorVault';

vi.mock('obsidian', () => ({ TFile: class TFile { path = ''; }, TFolder: class TFolder { path = ''; children: object[] = []; } }));

function fakeVault() {
    const entries = new Map<string, Uint8Array | null>();
    const lookup = (path: string): TFile | TFolder | null => {
        if (!entries.has(path)) return null;
        if (entries.get(path) !== null) return Object.assign(new TFile(), { path });
        return Object.assign(new TFolder(), { path,
            children: [...entries.keys()].filter((child) => child.startsWith(`${path}/`)
                && !child.slice(path.length + 1).includes('/')).map((child) => lookup(child)) });
    };
    const vault = {
        getAbstractFileByPath: lookup,
        readBinary: vi.fn(async (file: TFile) => entries.get(file.path)!.slice().buffer),
        createFolder: vi.fn(async (path: string) => { entries.set(path, null); }),
        createBinary: vi.fn(async (path: string, buffer: ArrayBuffer) => {
            entries.set(path, new Uint8Array(buffer));
        }),
        modifyBinary: vi.fn(async (file: TFile, buffer: ArrayBuffer) => {
            entries.set(file.path, new Uint8Array(buffer));
        }),
    };
    const fileManager = { trashFile: vi.fn(async (file: TFile | TFolder) => { entries.delete(file.path); }) };
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

    it('trashes only an empty folder and leaves occupied or missing folders untouched', async () => {
        const { entries, fileManager, adapter } = fakeVault();
        entries.set('Mirror/Empty', null);
        entries.set('Mirror/Occupied', null);
        entries.set('Mirror/Occupied/metadata.json', new Uint8Array([1]));
        for (const extension of ['.md', '.jpg', '.png', '.pdf']) {
            entries.set(`Mirror/Converted${extension}`, null);
            entries.set(`Mirror/Converted${extension}/fixture${extension}`, new Uint8Array([2]));
        }
        entries.set('Mirror/File.note', new Uint8Array([1]));
        expect(await adapter.trashEmptyFolder('Mirror/Occupied')).toBe(false);
        for (const extension of ['.md', '.jpg', '.png', '.pdf']) {
            expect(await adapter.trashEmptyFolder(`Mirror/Converted${extension}`)).toBe(false);
            expect(entries.has(`Mirror/Converted${extension}/fixture${extension}`)).toBe(true);
        }
        expect(await adapter.trashEmptyFolder('Mirror/File.note')).toBe(false);
        expect(await adapter.trashEmptyFolder('Mirror/Missing')).toBe(false);
        expect(await adapter.trashEmptyFolder('Mirror/Empty')).toBe(true);
        expect(fileManager.trashFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: 'Mirror/Empty' }));
    });

    it('lists only descendant folders within the configured root', async () => {
        const { entries, adapter } = fakeVault();
        for (const folder of ['Mirror', 'Mirror/Note', 'Mirror/Note/MM', 'Other', 'Other/Note']) entries.set(folder, null);
        entries.set('Mirror/Note/fixture.note', new Uint8Array([1]));
        expect(await adapter.listFolders('Mirror')).toEqual(['Mirror/Note', 'Mirror/Note/MM']);
        expect(await adapter.listFolders('Missing')).toEqual([]);
    });
});