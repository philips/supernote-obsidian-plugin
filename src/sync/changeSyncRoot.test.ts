import { beforeEach, expect, it, vi } from 'vitest';
import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { ChangeSyncFolderModal } from './ChangeSyncFolderModal';
import { SyncRootChange } from './changeSyncRoot';
import { ObsidianMirrorManifestStorage } from './obsidianMirrorManifestStorage';
import { loadMirrorManifest, saveMirrorManifest } from './sharedMirrorManifestStore';

const controls = vi.hoisted(() => ({
    buttons: new Map<string, () => void>(),
    disabled: new Map<string, boolean>(),
    paragraphs: [] as { text: string; cls: string; hidden: boolean }[],
    chooseParent: (_path: string) => {},
}));
vi.mock('obsidian', () => {
    class AbstractFile { path = ''; }
    class Folder extends AbstractFile { children: AbstractFile[] = []; }
    return {
    TAbstractFile: AbstractFile,
    TFile: class TFile extends AbstractFile {},
    TFolder: Folder,
    Modal: class Modal {
        contentEl = { empty: () => { controls.paragraphs.length = 0; },
            createEl: (_tag: string, options?: { text?: string; cls?: string }) => {
                const element = { text: options?.text ?? '', cls: options?.cls ?? '', hidden: false,
                    setText(value: string) { element.text = value; } };
                controls.paragraphs.push(element);
                return element;
            } };
        constructor(public app: App) {}
        setTitle() {}
        open() { (this as unknown as { onOpen(): void }).onOpen(); }
        close() { (this as unknown as { onClose(): void }).onClose(); }
    },
    Setting: class Setting {
        constructor(_container: unknown) {}
        setName() { return this; }
        setDesc() { return this; }
        addDropdown(callback: (dropdown: unknown) => void) {
            callback({ addOption: () => {}, onChange: (handler: (value: string) => void) => {
                controls.chooseParent = handler;
            } });
            return this;
        }
        addButton(callback: (button: unknown) => void) {
            let label = '';
            const button = { setButtonText: (text: string) => { label = text; return button; },
                setCta: () => button, setDisabled: (value: boolean) => { controls.disabled.set(label, value); return button; },
                onClick: (handler: () => void) => { controls.buttons.set(label, handler); return button; } };
            callback(button);
            return this;
        }
    },
    };
});

function fixture() {
    const entries = new Map<string, { type: 'file' | 'folder'; text?: string }>();
    const local = new Map<string, unknown>();
    entries.set('Mirror', { type: 'folder' });
    entries.set('New Mirror', { type: 'folder' });
    let root = 'Mirror';
    let legacy = {};
    let failSave = false;
    let failRename = false;
    let renameCount = 0;
    let failAfterRenames = -1;
    const adapter = {
        stat: async (path: string) => entries.get(path) ?? null,
        read: async (path: string) => entries.get(path)?.text ?? '',
        readBinary: async (path: string) => new TextEncoder().encode(entries.get(path)?.text ?? '').buffer,
        write: async (path: string, text: string) => { entries.set(path, { type: 'file', text }); },
        mkdir: async (path: string) => { entries.set(path, { type: 'folder' }); },
        remove: async (path: string) => { entries.delete(path); },
        list: async (path: string) => ({
            files: [...entries].filter(([key, value]) => key.startsWith(`${path}/`)
                && !key.slice(path.length + 1).includes('/') && value.type === 'file').map(([key]) => key),
            folders: [...entries].filter(([key, value]) => key.startsWith(`${path}/`)
                && !key.slice(path.length + 1).includes('/') && value.type === 'folder').map(([key]) => key),
        }),
    };
    const app = {
        loadLocalStorage: (key: string) => local.get(key) ?? null,
        saveLocalStorage: (key: string, value: unknown) => { local.set(key, value); },
        vault: {
            adapter,
            getAbstractFileByPath: (path: string) => entries.get(path)
                ? Object.assign(entries.get(path)?.type === 'folder' ? new TFolder() : new TFile(), { path }) : null,
            rename: async (file: TAbstractFile, path: string) => {
                if (failRename || renameCount++ === failAfterRenames) throw new Error('rename failed');
                for (const [key, value] of [...entries]) {
                    if (key === file.path || key.startsWith(`${file.path}/`)) {
                        entries.delete(key);
                        entries.set(`${path}${key.slice(file.path.length)}`, value);
                    }
                }
            },
        },
    } as unknown as App;
    const saveRoot = vi.fn(async (next: string) => {
        if (failSave) throw new Error('settings failed');
        root = next;
        legacy = {};
    });
    const change = new SyncRootChange(app, () => root, () => legacy, saveRoot);
    return { app, entries, adapter, change, saveRoot, root: () => root,
        failSave: (value: boolean) => { failSave = value; },
        failRename: (value: boolean) => { failRename = value; },
        failAfterRenames: (count: number) => { failAfterRenames = count; } };
}

beforeEach(() => { vi.clearAllMocks(); controls.buttons.clear(); controls.disabled.clear(); });

it('stages an existing destination for move and leaves cancellation without a choice', async () => {
    const notes = Object.assign(new TFolder(), { path: 'Notes' });
    const app = { vault: { getAllLoadedFiles: () => [notes],
        getAbstractFileByPath: (path: string) => path === 'Notes' ? notes : null } } as unknown as App;
    const modal = new ChangeSyncFolderModal(app, 'Mirror', true);
    const choice = modal.choose();
    expect(controls.disabled.get('Move files')).toBe(true);
    expect(controls.disabled.get('Leave files and start fresh')).toBe(true);
    controls.chooseParent('Notes');
    expect(controls.disabled.get('Move files')).toBe(false);
    expect(controls.disabled.get('Leave files and start fresh')).toBe(false);
    controls.buttons.get('Move files')?.();
    await expect(choice).resolves.toEqual({ root: 'Notes', mode: 'move' });

    const cancelled = new ChangeSyncFolderModal(app, 'Mirror', true).choose();
    controls.buttons.get('Cancel')?.();
    await expect(cancelled).resolves.toBeNull();
});

it('stages an existing folder and presents a single choice when there is nothing to move', async () => {
    const empty = Object.assign(new TFolder(), { path: 'Empty' });
    const app = { vault: { getAllLoadedFiles: () => [empty],
        getAbstractFileByPath: (path: string) => path === 'Empty' ? empty : null } } as unknown as App;
    const choice = new ChangeSyncFolderModal(app, 'Mirror', false).choose();
    expect(controls.buttons.has('Move files')).toBe(false);
    expect(controls.disabled.get('Change destination')).toBe(true);
    controls.chooseParent('Empty');
    expect(controls.disabled.get('Change destination')).toBe(false);
    controls.buttons.get('Change destination')?.();
    await expect(choice).resolves.toEqual({ root: 'Empty', mode: 'fresh' });
});

it('warns on occupied and invalid selections and enables actions only for an empty independent folder', async () => {
    const empty = Object.assign(new TFolder(), { path: 'Empty' });
    const occupied = Object.assign(new TFolder(), { path: 'Occupied', children: [new TFile()] });
    const nested = Object.assign(new TFolder(), { path: 'Mirror/Child' });
    const folders = [empty, occupied, nested];
    const app = { vault: { getAllLoadedFiles: () => folders,
        getAbstractFileByPath: (path: string) => folders.find((folder) => folder.path === path) ?? null } } as unknown as App;
    const choice = new ChangeSyncFolderModal(app, 'Mirror', true).choose();
    const warning = controls.paragraphs.find((element) => element.cls === 'supernote-sync-folder-warning');
    expect(warning).toBeDefined();
    expect(controls.paragraphs.indexOf(warning!)).toBeLessThan(controls.paragraphs.findIndex(
        (element) => element.text.startsWith('Select an empty folder for the new location')));
    expect(warning?.hidden).toBe(true);
    for (const path of ['Occupied', 'Missing', 'Mirror/Child']) {
        controls.chooseParent(path);
        expect(warning).toMatchObject({ text: 'Select an empty vault folder', hidden: false });
        expect(controls.disabled.get('Move files')).toBe(true);
        expect(controls.disabled.get('Leave files and start fresh')).toBe(true);
    }
    controls.chooseParent('Empty');
    expect(warning?.hidden).toBe(true);
    expect(controls.disabled.get('Move files')).toBe(false);
    occupied.children.length = 0;
    controls.chooseParent('Occupied');
    expect(warning?.hidden).toBe(true);
    expect(controls.disabled.get('Leave files and start fresh')).toBe(false);
    controls.chooseParent('');
    expect(warning?.hidden).toBe(true);
    expect(controls.disabled.get('Move files')).toBe(true);
    controls.buttons.get('Cancel')?.();
    await expect(choice).resolves.toBeNull();
});

it('moves the old root contents into an existing empty folder and rewrites manifest destinations', async () => {
    const vault = fixture();
    vault.entries.set('Mirror/edited.note', { type: 'file', text: 'local edit' });
    vault.entries.set('Mirror/Sync Log.md', { type: 'file', text: 'log' });
    vault.entries.set('Mirror/unrelated.txt', { type: 'file', text: 'user file' });
    const storage = new ObsidianMirrorManifestStorage(vault.app, 'Mirror');
    await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic', records: {
        'Mirror/edited.note': { contentHash: 'original', source: { engineId: 'ip-device',
            deviceUri: '/edited.note', deviceDate: '', deviceSize: 8 } },
    } });

    await vault.change.change('New Mirror', 'move');

    expect(vault.root()).toBe('New Mirror');
    expect(vault.entries.has('Mirror')).toBe(true);
    expect(vault.entries.has('Mirror/edited.note')).toBe(false);
    expect(vault.entries.get('New Mirror/edited.note')?.text).toBe('local edit');
    expect(vault.entries.get('New Mirror/unrelated.txt')?.text).toBe('user file');
    expect(vault.entries.get('New Mirror/Sync Log.md')?.text).toBe('log');
    const manifest = (await loadMirrorManifest(new ObsidianMirrorManifestStorage(vault.app, 'New Mirror'), {})).manifest;
    expect(manifest).toMatchObject({ cloudAccountFingerprint: 'v1:synthetic', legacyHistoryRetired: true,
        records: { 'New Mirror/edited.note': { contentHash: 'original' } } });
    vault.change.assertReady();
});

it('leaves existing files unmanaged and does not reactivate old history on return', async () => {
    const vault = fixture();
    vault.entries.set('Mirror/user.note', { type: 'file', text: 'edited' });
    const storage = new ObsidianMirrorManifestStorage(vault.app, 'Mirror');
    await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic', records: {
        'Mirror/user.note': { contentHash: 'original', source: { engineId: 'supernote-cloud', md5: '0'.repeat(32) } },
    } });
    await vault.change.change('New Mirror', 'fresh');
    expect(vault.entries.get('Mirror/user.note')?.text).toBe('edited');
    expect((await loadMirrorManifest(new ObsidianMirrorManifestStorage(vault.app, 'New Mirror'), {})).manifest)
        .toMatchObject({ cloudAccountFingerprint: 'v1:synthetic', records: {}, legacyHistoryRetired: true });
    expect(await vault.adapter.stat('Mirror/.supernote-sync/primary.json')).toBeNull();
    await expect(vault.change.change('Mirror', 'fresh')).rejects.toThrow('occupied');
    expect(await vault.adapter.stat('Mirror/.supernote-sync/backup.json')).toBeNull();
    expect(vault.entries.get('Mirror/user.note')?.text).toBe('edited');
});

it('rejects overlapping or occupied destinations before changing the root', async () => {
    const vault = fixture();
    vault.entries.set('Other', { type: 'folder' });
    vault.entries.set('Other/user.note', { type: 'file', text: 'user' });
    await expect(vault.change.change('Mirror/child', 'move')).rejects.toThrow('non-overlapping');
    await expect(vault.change.change('Other', 'fresh')).rejects.toThrow('occupied');
    await expect(vault.change.change('Other', 'move')).rejects.toThrow('occupied');
    await expect(vault.change.change('Missing', 'move')).rejects.toThrow('existing empty');
    expect(vault.root()).toBe('Mirror');
    vault.change.assertReady();
});

it('offers a move when metadata contains an unrelated user file', async () => {
    const vault = fixture();
    vault.entries.set('Mirror/.supernote-sync', { type: 'folder' });
    vault.entries.set('Mirror/.supernote-sync/user.txt', { type: 'file', text: 'keep' });
    expect(await vault.change.hasContent()).toBe(true);
});

it('changes an absent old root without creating it, including after interrupted settings save', async () => {
    const vault = fixture();
    vault.entries.delete('Mirror');
    expect(await vault.change.hasContent()).toBe(false);
    vault.failSave(true);
    await expect(vault.change.change('New Mirror', 'fresh')).rejects.toThrow('settings failed');
    expect(vault.entries.has('Mirror')).toBe(false);
    vault.failSave(false);
    await vault.change.recover();
    expect(vault.root()).toBe('New Mirror');
    expect(vault.entries.has('Mirror')).toBe(false);
    vault.change.assertReady();
});

it('resumes after a settings failure and keeps runs blocked until recovery', async () => {
    const vault = fixture();
    vault.entries.set('Mirror/user.note', { type: 'file', text: 'edited' });
    vault.failSave(true);
    await expect(vault.change.change('New Mirror', 'move')).rejects.toThrow('settings failed');
    expect(() => vault.change.assertReady()).toThrow('pending');
    vault.failSave(false);
    await vault.change.recover();
    expect(vault.root()).toBe('New Mirror');
    vault.change.assertReady();
});

it('recovers a failed entry move without overwriting the old folder', async () => {
    const vault = fixture();
    vault.entries.set('Mirror/user.note', { type: 'file', text: 'edited' });
    vault.failRename(true);
    await expect(vault.change.change('New Mirror', 'move')).rejects.toThrow('rename failed');
    expect(vault.entries.get('Mirror/user.note')?.text).toBe('edited');
    expect(() => vault.change.assertReady()).toThrow('pending');
    vault.failRename(false);
    await vault.change.recover();
    expect(vault.entries.get('New Mirror/user.note')?.text).toBe('edited');
});

it('recovers after one child moves, preserving nested files and the original folder', async () => {
    const vault = fixture();
    vault.entries.set('Mirror/Folder', { type: 'folder' });
    vault.entries.set('Mirror/Folder/edited.note', { type: 'file', text: 'local edit' });
    vault.entries.set('Mirror/other.note', { type: 'file', text: 'another file' });
    vault.failAfterRenames(2);
    await expect(vault.change.change('New Mirror', 'move')).rejects.toThrow('rename failed');
    expect(vault.entries.has('Mirror')).toBe(true);
    expect(vault.entries.get('New Mirror/Folder/edited.note')?.text).toBe('local edit');
    expect(vault.entries.get('Mirror/other.note')?.text).toBe('another file');
    await vault.change.recover();
    expect(vault.entries.get('New Mirror/other.note')?.text).toBe('another file');
    expect(vault.entries.has('Mirror')).toBe(true);
    expect(vault.root()).toBe('New Mirror');
});

it('keeps the checkpoint when a moved child is changed before recovery', async () => {
    const vault = fixture();
    vault.entries.set('Mirror/user.note', { type: 'file', text: 'original' });
    vault.failAfterRenames(0);
    await expect(vault.change.change('New Mirror', 'move')).rejects.toThrow('rename failed');
    vault.entries.set('New Mirror/user.note', { type: 'file', text: 'unrelated' });
    await expect(vault.change.recover()).rejects.toThrow('Ambiguous');
    expect(vault.entries.get('Mirror/user.note')?.text).toBe('original');
    expect(() => vault.change.assertReady()).toThrow('pending');
});

it('stops before moving more entries if the relocated manifest changes', async () => {
    const vault = fixture();
    vault.entries.set('Mirror/user.note', { type: 'file', text: 'original' });
    vault.failAfterRenames(1);
    await expect(vault.change.change('New Mirror', 'move')).rejects.toThrow('rename failed');
    const storage = new ObsidianMirrorManifestStorage(vault.app, 'New Mirror');
    const loaded = await loadMirrorManifest(storage, {});
    await saveMirrorManifest(storage, loaded, { ...loaded.manifest,
        cloudAccountFingerprint: 'v1:another-account' });
    await expect(vault.change.recover()).rejects.toThrow('does not match checkpoint');
    expect(vault.entries.get('Mirror/user.note')?.text).toBe('original');
    expect(() => vault.change.assertReady()).toThrow('pending');
});

it('resumes leave-behind after settings failure without re-adopting old records', async () => {
    const vault = fixture();
    vault.entries.set('Mirror/user.note', { type: 'file', text: 'edited' });
    vault.failSave(true);
    await expect(vault.change.change('New Mirror', 'fresh')).rejects.toThrow('settings failed');
    expect(() => vault.change.assertReady()).toThrow('pending');
    vault.failSave(false);
    await vault.change.recover();
    expect(vault.root()).toBe('New Mirror');
    expect(vault.entries.get('Mirror/user.note')?.text).toBe('edited');
    expect((await loadMirrorManifest(new ObsidianMirrorManifestStorage(vault.app, 'New Mirror'), {})).manifest.records)
        .toEqual({});
});

it('rejects account changes and corrupt manifests before moving files', async () => {
    const vault = fixture();
    const storage = new ObsidianMirrorManifestStorage(vault.app, 'Mirror');
    await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic',
        records: {}, accountChange: { targetFingerprint: `v1:${'a'.repeat(64)}`,
            pendingPath: null, protectedPaths: [] } });
    await expect(vault.change.change('New Mirror', 'fresh')).rejects.toThrow('Cloud account change');
    expect(vault.root()).toBe('Mirror');
    vault.change.assertReady();

    const broken = fixture();
    broken.entries.set('Mirror/.supernote-sync', { type: 'folder' });
    broken.entries.set('Mirror/.supernote-sync/primary.json', { type: 'file', text: '{invalid' });
    await expect(broken.change.change('New Mirror', 'move')).rejects.toThrow('neither copy is valid');
    broken.change.assertReady();
});

it('rejects manifest paths outside the root before a move', async () => {
    const vault = fixture();
    await saveMirrorManifest(new ObsidianMirrorManifestStorage(vault.app, 'Mirror'), null, {
        version: 1, cloudAccountFingerprint: null, records: {
            'Outside/user.note': { contentHash: 'hash', source: { engineId: 'ip-device',
                deviceUri: '/user.note', deviceDate: '', deviceSize: 4 } },
        },
    });
    await expect(vault.change.change('New Mirror', 'move')).rejects.toThrow('outside the current sync folder');
    expect(vault.root()).toBe('Mirror');
    vault.change.assertReady();
});

it('stops recovery when both old and new folders exist after an interrupted move', async () => {
    const vault = fixture();
    vault.failRename(true);
    await expect(vault.change.change('New Mirror', 'move')).rejects.toThrow('rename failed');
    vault.entries.set('New Mirror/unexpected.note', { type: 'file', text: 'someone else' });
    await expect(vault.change.recover()).rejects.toThrow('Ambiguous');
    expect(() => vault.change.assertReady()).toThrow('pending');
    expect(vault.root()).toBe('Mirror');
});