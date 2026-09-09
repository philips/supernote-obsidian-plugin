import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { runDeviceSync } from './syncEngine';
import { scanDeviceSupernoteTree } from './FileListModal';
import { fetchFromDevice } from './deviceFetch';
import { buildSyncRecord, hashBytes } from './deviceSync';
import type { DeviceNoteListing, SyncManifest, SyncedNoteRecord } from './deviceSync';
import type { SupernotePluginSettings } from './settings';

vi.mock('obsidian', () => ({
    // syncEngine only uses TFile at runtime (instanceof checks in
    // writeBinaryAt / currentHash / ensureSyncLogFile); everything else in
    // its import graph is either type-only or mocked out below.
    TFile: class TFile {
        path = '';
    },
}));

vi.mock('./FileListModal', () => ({
    scanDeviceSupernoteTree: vi.fn(),
}));

vi.mock('./deviceFetch', () => ({
    fetchFromDevice: vi.fn(),
    DEVICE_TRANSFER_TIMEOUT_MS: 120_000,
}));

// ---------------------------------------------------------------------------
// In-memory fake vault: enough of Vault for runDeviceSync — path lookups,
// binary create/modify/read, text create/append, folder creation — so the
// orchestration (and only the orchestration; the decisions come from the
// real deviceSync.ts) runs against something that behaves like the real
// thing, TFile instanceof checks included.
// ---------------------------------------------------------------------------

type Entry = { kind: 'folder' } | { kind: 'file'; file: TFile; bytes: Uint8Array; text: string };

function makeVault() {
    const entries = new Map<string, Entry>();
    const decoder = new TextDecoder();
    const vault = {
        getAbstractFileByPath(path: string) {
            const entry = entries.get(path);
            if (!entry) return null;
            if (entry.kind === 'file') return entry.file;
            return { path, isFolder: true }; // TFolder stand-in; never a TFile instance.
        },
        async createFolder(path: string) {
            entries.set(path, { kind: 'folder' });
        },
        async createBinary(path: string, buffer: ArrayBuffer) {
            const file = Object.assign(new TFile(), { path });
            entries.set(path, { kind: 'file', file, bytes: new Uint8Array(buffer), text: '' });
            return file;
        },
        async modifyBinary(file: TFile, buffer: ArrayBuffer) {
            const entry = entries.get(file.path);
            if (entry?.kind === 'file') entry.bytes = new Uint8Array(buffer);
        },
        async readBinary(file: TFile) {
            const entry = entries.get(file.path);
            if (entry?.kind !== 'file') throw new Error(`not a file: ${file.path}`);
            return entry.bytes.slice().buffer;
        },
        async create(path: string, text: string) {
            const file = Object.assign(new TFile(), { path });
            entries.set(path, { kind: 'file', file, bytes: new TextEncoder().encode(text), text });
            return file;
        },
        async append(file: TFile, text: string) {
            const entry = entries.get(file.path);
            if (entry?.kind === 'file') {
                entry.text += text;
                entry.bytes = new TextEncoder().encode(entry.text);
            }
        },
    };
    return {
        vault,
        app: { vault } as unknown as App,
        exists: (path: string) => entries.has(path),
        readText: (path: string) => {
            const entry = entries.get(path);
            if (entry?.kind !== 'file') throw new Error(`missing: ${path}`);
            return entry.text !== '' ? entry.text : decoder.decode(entry.bytes);
        },
        seedFile: (path: string, content: string) => {
            const file = Object.assign(new TFile(), { path });
            entries.set(path, { kind: 'file', file, bytes: new TextEncoder().encode(content), text: content });
            return file;
        },
        seedFolder: (path: string) => entries.set(path, { kind: 'folder' }),
    };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SYNC_FOLDER = 'Supernote sync';

function settingsWith(noteSyncState: SyncManifest, syncPathFiltersRaw = ''): SupernotePluginSettings {
    return {
        directConnectIP: '10.11.12.13',
        syncFolder: SYNC_FOLDER,
        syncPathFiltersRaw,
        noteSyncState,
    } as unknown as SupernotePluginSettings;
}

function deviceFile(name: string, content: string, overrides: Partial<DeviceNoteListing> = {}) {
    return {
        name,
        uri: `/${name}`,
        date: '2026-07-25 10:33:04',
        size: content.length,
        extension: 'note',
        isDirectory: false,
        ...overrides,
    };
}

function manifestRecord(listing: DeviceNoteListing, vaultPath: string, lastWritten: string): SyncedNoteRecord {
    return buildSyncRecord(listing, vaultPath, hashBytes(new TextEncoder().encode(lastWritten)));
}

function vaultPathFor(name: string): string {
    return `${SYNC_FOLDER}/${name}`;
}

/** Makes fetchFromDevice hand out per-URI content and records requested URIs. */
function mockDeviceContents(contents: Map<string, string>, failUris: string[] = []) {
    vi.mocked(fetchFromDevice).mockImplementation(async (_ip, uri) => {
        if (failUris.includes(uri)) {
            return { ok: false, status: 500, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
        }
        const text = contents.get(uri);
        if (text === undefined) throw new Error(`no mock content for ${uri}`);
        return {
            ok: true,
            status: 200,
            text: async () => text,
            arrayBuffer: async () => new TextEncoder().encode(text).buffer,
        };
    });
}

function fetchedUris(): string[] {
    return vi.mocked(fetchFromDevice).mock.calls.map((call) => call[1]);
}

beforeEach(() => {
    vi.mocked(scanDeviceSupernoteTree).mockReset();
    vi.mocked(fetchFromDevice).mockReset();
});

// ---------------------------------------------------------------------------
// The PR #258 fix: restoring locally deleted files whose device copy is
// unchanged (previously stranded in plan.unchanged forever).
// ---------------------------------------------------------------------------

describe('runDeviceSync: restoring locally deleted files (PR #258)', () => {
    it('re-downloads an unchanged device file whose vault copy was deleted', async () => {
        const vault = makeVault();
        const listing = deviceFile('foo.note', 'device content');
        vi.mocked(scanDeviceSupernoteTree).mockResolvedValue([listing]);
        mockDeviceContents(new Map([['/foo.note', 'device content']]));
        const settings = settingsWith({
            '/foo.note': manifestRecord(listing, vaultPathFor('foo.note'), 'device content'),
        });

        const result = await runDeviceSync(vault.app, settings, async () => {});

        // Restored: fetched, rewritten at the exact same path, counted as synced.
        expect(fetchedUris()).toContain('/foo.note');
        expect(vault.readText(vaultPathFor('foo.note'))).toBe('device content');
        expect(result.synced).toBe(1);
        expect(result.unchanged).toBe(0);
        expect(settings.noteSyncState['/foo.note'].contentHash).toBe(hashBytes(new TextEncoder().encode('device content')));
    });

    it('recreates missing parent folders when restoring a nested deleted file', async () => {
        const vault = makeVault();
        const listing = deviceFile('deep.note', 'nested', { uri: '/Projects/Deep/deep.note' });
        vi.mocked(scanDeviceSupernoteTree).mockResolvedValue([listing]);
        mockDeviceContents(new Map([['/Projects/Deep/deep.note', 'nested']]));
        const settings = settingsWith({
            '/Projects/Deep/deep.note': manifestRecord(listing, vaultPathFor('Projects/Deep/deep.note'), 'nested'),
        });

        await runDeviceSync(vault.app, settings, async () => {});

        expect(vault.readText(vaultPathFor('Projects/Deep/deep.note'))).toBe('nested');
    });

    it('leaves intact unchanged files untouched and un-fetched', async () => {
        const vault = makeVault();
        const listing = deviceFile('foo.note', 'device content');
        vi.mocked(scanDeviceSupernoteTree).mockResolvedValue([listing]);
        mockDeviceContents(new Map());
        vault.seedFile(vaultPathFor('foo.note'), 'device content');
        const settings = settingsWith({
            '/foo.note': manifestRecord(listing, vaultPathFor('foo.note'), 'device content'),
        });

        const result = await runDeviceSync(vault.app, settings, async () => {});

        expect(fetchedUris()).not.toContain('/foo.note');
        expect(result.synced).toBe(0);
        expect(result.unchanged).toBe(1);
        expect(vault.readText(vaultPathFor('foo.note'))).toBe('device content');
    });

    it('still flags locally edited unchanged files as conflicts instead of restoring over them', async () => {
        const vault = makeVault();
        const listing = deviceFile('foo.note', 'device content');
        vi.mocked(scanDeviceSupernoteTree).mockResolvedValue([listing]);
        mockDeviceContents(new Map());
        vault.seedFile(vaultPathFor('foo.note'), 'user edited this');
        const settings = settingsWith({
            '/foo.note': manifestRecord(listing, vaultPathFor('foo.note'), 'device content'),
        });

        const result = await runDeviceSync(vault.app, settings, async () => {});

        expect(result.skippedConflicts).toEqual([vaultPathFor('foo.note')]);
        expect(fetchedUris()).not.toContain('/foo.note');
        expect(vault.readText(vaultPathFor('foo.note'))).toBe('user edited this');
    });

    it('partitions a mixed run into exactly one bucket per file', async () => {
        const vault = makeVault();
        const newFile = deviceFile('new.note', 'brand new', { uri: '/Notes/new.note' });
        const restored = deviceFile('restored.note', 'restore me', { uri: '/Notes/restored.note' });
        const intact = deviceFile('intact.note', 'same bytes', { uri: '/Notes/intact.note' });
        const edited = deviceFile('edited.note', 'device version', { uri: '/Notes/edited.note' });
        const hidden = deviceFile('hidden.note', 'secret', { uri: '/Secret/hidden.note' });
        vi.mocked(scanDeviceSupernoteTree).mockResolvedValue([newFile, restored, intact, edited, hidden]);
        mockDeviceContents(new Map([
            ['/Notes/new.note', 'brand new'],
            ['/Notes/restored.note', 'restore me'],
        ]));
        vault.seedFile(vaultPathFor('Notes/intact.note'), 'same bytes');
        vault.seedFile(vaultPathFor('Notes/edited.note'), 'locally edited');
        const settings = settingsWith({
            '/Notes/restored.note': manifestRecord(restored, vaultPathFor('Notes/restored.note'), 'restore me'),
            '/Notes/intact.note': manifestRecord(intact, vaultPathFor('Notes/intact.note'), 'same bytes'),
            '/Notes/edited.note': manifestRecord(edited, vaultPathFor('Notes/edited.note'), 'device version'),
        }, '/Notes/**');

        const result = await runDeviceSync(vault.app, settings, async () => {});

        expect(result).toMatchObject({ synced: 2, unchanged: 2, excluded: 1, skippedConflicts: [vaultPathFor('Notes/edited.note')], failed: [] });
        expect(vault.readText(vaultPathFor('Notes/new.note'))).toBe('brand new');
        expect(vault.readText(vaultPathFor('Notes/restored.note'))).toBe('restore me');
        expect(vault.readText(vaultPathFor('Notes/intact.note'))).toBe('same bytes');
        expect(vault.readText(vaultPathFor('Notes/edited.note'))).toBe('locally edited');
        expect(vault.exists(vaultPathFor('Secret/hidden.note'))).toBe(false);
    });

    it('reports a failed restore in result.failed and keeps the rest of the run going', async () => {
        const vault = makeVault();
        const broken = deviceFile('broken.note', 'never arrives');
        const healthy = deviceFile('healthy.note', 'fine');
        vi.mocked(scanDeviceSupernoteTree).mockResolvedValue([broken, healthy]);
        mockDeviceContents(new Map([['/healthy.note', 'fine']]), ['/broken.note']);
        const settings = settingsWith({
            '/broken.note': manifestRecord(broken, vaultPathFor('broken.note'), 'never arrives'),
            '/healthy.note': manifestRecord(healthy, vaultPathFor('healthy.note'), 'fine'),
        });

        const result = await runDeviceSync(vault.app, settings, async () => {});

        expect(result.failed).toEqual([{ file: '/broken.note', error: 'Supernote responded with status 500' }]);
        expect(result.unchanged).toBe(0); // not quietly counted as unchanged either
        expect(vault.exists(vaultPathFor('broken.note'))).toBe(false);
        expect(vault.readText(vaultPathFor('healthy.note'))).toBe('fine');
    });
});

// ---------------------------------------------------------------------------
// Review finding: the PR's re-partition pass calls currentHash() outside any
// try/catch, so one unreadable vault file now aborts the entire sync run.
// The toSync loop and the drift-check loop both isolate per-file failures;
// this skipped test encodes the behavior the pass should have (unskip once
// fixed).
// ---------------------------------------------------------------------------

describe('runDeviceSync: fault isolation', () => {
    it.skip('keeps syncing when an unchanged vault file cannot be read', async () => {
        const vault = makeVault();
        const unreadable = deviceFile('unreadable.note', 'device version');
        const healthy = deviceFile('healthy.note', 'fine');
        vi.mocked(scanDeviceSupernoteTree).mockResolvedValue([unreadable, healthy]);
        mockDeviceContents(new Map());
        vault.seedFile(vaultPathFor('unreadable.note'), 'device version');
        vault.seedFile(vaultPathFor('healthy.note'), 'fine');
        const origReadBinary = vault.vault.readBinary.bind(vault.vault);
        vault.vault.readBinary = async (file: TFile) => {
            if (file.path === vaultPathFor('unreadable.note')) throw new Error('EIO');
            return origReadBinary(file);
        };
        const settings = settingsWith({
            '/unreadable.note': manifestRecord(unreadable, vaultPathFor('unreadable.note'), 'device version'),
            '/healthy.note': manifestRecord(healthy, vaultPathFor('healthy.note'), 'fine'),
        });

        // Must not reject: one unreadable file degrades to a per-file failure
        // (like the toSync and drift-check loops) rather than aborting the run.
        const result = await runDeviceSync(vault.app, settings, async () => {});

        expect(result.synced).toBe(0);
        expect(vault.readText(vaultPathFor('healthy.note'))).toBe('fine');
    });
});
