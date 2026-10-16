import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { IpSyncEngine } from './syncEngine';
import { scanDeviceSupernoteTreeWithExtensions } from './FileListModal';
import { fetchFromDevice } from './deviceFetch';
import { buildSyncRecord, hashBytes } from './deviceSync';
import type { DeviceNoteListing, SyncManifest, SyncedNoteRecord } from './deviceSync';
import type { SupernotePluginSettings } from '../../settings';
import { ALL_FILE_EXTENSIONS } from '../syncFilters';
import { ObsidianMirrorManifestStorage } from '../obsidianMirrorManifestStorage';
import { loadMirrorManifest, saveMirrorManifest } from '../sharedMirrorManifestStore';
import { reportSyncFailure, reportSyncResult, retainSyncLogEntries, trimSyncLog } from '../syncReporting';
import type { SyncRunResult } from '../syncAbstraction';

vi.mock('obsidian', () => ({
    // syncEngine only uses TFile at runtime (instanceof checks in
    // writeBinaryAt / currentHash / ensureSyncLogFile); everything else in
    // its import graph is either type-only or mocked out below.
    TFile: class TFile {
        path = '';
    },
}));

vi.mock('./FileListModal', () => ({
    scanDeviceSupernoteTreeWithExtensions: vi.fn(),
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
        adapter: {
            stat: async (path: string) => {
                const entry = entries.get(path);
                return entry ? { type: entry.kind === 'file' ? 'file' : 'folder' } : null;
            },
            read: async (path: string) => {
                const entry = entries.get(path);
                if (entry?.kind !== 'file') throw new Error('missing metadata');
                return entry.text;
            },
            mkdir: async (path: string) => { entries.set(path, { kind: 'folder' }); },
            write: async (path: string, text: string) => {
                const file = Object.assign(new TFile(), { path });
                entries.set(path, { kind: 'file', file, bytes: new TextEncoder().encode(text), text });
            },
        },
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
            if (entry?.kind === 'file') {
                entry.bytes = new Uint8Array(buffer);
                entry.text = decoder.decode(entry.bytes);
            }
        },
        async readBinary(file: TFile) {
            const entry = entries.get(file.path);
            if (entry?.kind !== 'file') throw new Error(`not a file: ${file.path}`);
            return entry.bytes.slice().buffer;
        },
        async read(file: TFile) {
            const entry = entries.get(file.path);
            if (entry?.kind !== 'file') throw new Error(`not a file: ${file.path}`);
            return entry.text;
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
        async process(file: TFile, update: (text: string) => string) {
            const entry = entries.get(file.path);
            if (entry?.kind !== 'file') throw new Error(`not a file: ${file.path}`);
            entry.text = update(entry.text);
            entry.bytes = new TextEncoder().encode(entry.text);
            return entry.text;
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

function settingsWith(
    noteSyncState: SyncManifest,
    syncPathFiltersRaw = '',
    syncFileExtensionsRaw = '.note, .spd',
): SupernotePluginSettings {
    return {
        directConnectIP: '10.11.12.13',
        syncFolder: SYNC_FOLDER,
        syncPathFiltersRaw,
        syncFileExtensionsRaw,
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

it('syncs IP files alongside Cloud history and replaces an unchanged Cloud-owned destination', async () => {
    const vault = makeVault();
    const cloudPath = vaultPathFor('shared.note');
    const cloudBytes = 'cloud version';
    const cloudHash = hashBytes(new TextEncoder().encode(cloudBytes));
    const cloudOnlyPath = vaultPathFor('cloud-only.note');
    const settings = settingsWith({});
    vault.seedFile(cloudPath, cloudBytes);
    const storage = new ObsidianMirrorManifestStorage(vault.app, settings.syncFolder);
    await saveMirrorManifest(storage, null, {
        version: 1, cloudAccountFingerprint: 'v1:synthetic', records: {
            [cloudPath]: {
                contentHash: cloudHash,
                source: { engineId: 'supernote-cloud', md5: '0'.repeat(32) },
            },
            [cloudOnlyPath]: {
                contentHash: 'cloud-only-hash',
                source: { engineId: 'supernote-cloud', md5: '1'.repeat(32) },
            },
        },
    });
    const shared = deviceFile('shared.note', 'device version');
    const fresh = deviceFile('fresh.note', 'new device file');
    vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([shared, fresh]);
    mockDeviceContents(new Map([
        ['/shared.note', 'device version'],
        ['/fresh.note', 'new device file'],
    ]));

    const result = await new IpSyncEngine(vault.app, settings, async () => {}).run({
        kind: 'manual', commandId: 'sync-now',
    });
    const manifest = (await loadMirrorManifest(storage, {})).manifest;

    expect(result.synced).toBe(2);
    expect(result.issues).toEqual([]);
    expect(vault.readText(cloudPath)).toBe('device version');
    expect(vault.readText(vaultPathFor('fresh.note'))).toBe('new device file');
    expect(manifest.cloudAccountFingerprint).toBe('v1:synthetic');
    expect(manifest.records[cloudPath]).toMatchObject({
        contentHash: hashBytes(new TextEncoder().encode('device version')),
        source: { engineId: 'ip-device', deviceUri: '/shared.note' },
    });
    expect(manifest.records[cloudOnlyPath].source.engineId).toBe('supernote-cloud');
    expect(manifest.records[vaultPathFor('fresh.note')].source.engineId).toBe('ip-device');
    expect(settings.noteSyncState).toEqual({});
});

it('restores a missing Cloud-owned file with IP bytes and records the new baseline', async () => {
    const vault = makeVault();
    const path = vaultPathFor('shared.note');
    const settings = settingsWith({});
    const storage = new ObsidianMirrorManifestStorage(vault.app, settings.syncFolder);
    await saveMirrorManifest(storage, null, {
        version: 1, cloudAccountFingerprint: 'v1:synthetic', records: {
            [path]: { contentHash: 'old-cloud-hash', source: { engineId: 'supernote-cloud', md5: '0'.repeat(32) } },
        },
    });
    vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([deviceFile('shared.note', 'device version')]);
    mockDeviceContents(new Map([['/shared.note', 'device version']]));

    const result = await runIpSync(vault.app, settings);
    const manifest = (await loadMirrorManifest(storage, {})).manifest;

    expect(result.synced).toBe(1);
    expect(vault.readText(path)).toBe('device version');
    expect(manifest.records[path]).toMatchObject({
        contentHash: hashBytes(new TextEncoder().encode('device version')),
        source: { engineId: 'ip-device', deviceUri: '/shared.note' },
    });
    expect(manifest.cloudAccountFingerprint).toBe('v1:synthetic');
});

it('adopts identical Cloud-owned bytes as an IP source without rewriting the vault file', async () => {
    const vault = makeVault();
    const path = vaultPathFor('shared.note');
    const bytes = 'shared version';
    const settings = settingsWith({});
    vault.seedFile(path, bytes);
    const storage = new ObsidianMirrorManifestStorage(vault.app, settings.syncFolder);
    await saveMirrorManifest(storage, null, {
        version: 1, cloudAccountFingerprint: 'v1:synthetic', records: {
            [path]: { contentHash: hashBytes(new TextEncoder().encode(bytes)),
                source: { engineId: 'supernote-cloud', md5: '0'.repeat(32) } },
        },
    });
    vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([deviceFile('shared.note', bytes)]);
    mockDeviceContents(new Map([['/shared.note', bytes]]));
    const modifyBinary = vi.spyOn(vault.vault, 'modifyBinary');

    const result = await runIpSync(vault.app, settings);

    expect(result.issues).toEqual([]);
    expect(modifyBinary).not.toHaveBeenCalled();
    expect((await loadMirrorManifest(storage, {})).manifest.records[path].source).toMatchObject({
        engineId: 'ip-device', deviceUri: '/shared.note',
    });
});

it('protects a locally edited Cloud-owned destination from IP writes', async () => {
    const vault = makeVault();
    const path = vaultPathFor('shared.note');
    const settings = settingsWith({});
    vault.seedFile(path, 'local edit');
    const storage = new ObsidianMirrorManifestStorage(vault.app, settings.syncFolder);
    await saveMirrorManifest(storage, null, {
        version: 1, cloudAccountFingerprint: 'v1:synthetic', records: {
            [path]: { contentHash: hashBytes(new TextEncoder().encode('old cloud bytes')),
                source: { engineId: 'supernote-cloud', md5: '0'.repeat(32) } },
        },
    });
    vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([deviceFile('shared.note', 'device version')]);
    mockDeviceContents(new Map([['/shared.note', 'device version']]));

    const result = await runIpSync(vault.app, settings);

    expect(result.issues).toContainEqual({
        kind: 'protected', item: path, message: 'Skipped because the vault copy was edited locally',
    });
    expect(vault.readText(path)).toBe('local edit');
    expect((await loadMirrorManifest(storage, {})).manifest.records[path].source.engineId).toBe('supernote-cloud');
});

it('does not scan or change files while a Cloud account change is pending', async () => {
    const vault = makeVault();
    const legacy = manifestRecord(deviceFile('legacy.note', 'legacy'), vaultPathFor('legacy.note'), 'legacy');
    const settings = settingsWith({ [legacy.deviceUri]: legacy });
    const storage = new ObsidianMirrorManifestStorage(vault.app, settings.syncFolder);
    const pending = {
        version: 1 as const, cloudAccountFingerprint: 'v1:synthetic', records: {},
        accountChange: { targetFingerprint: `v1:${'a'.repeat(64)}`, pendingPath: null, protectedPaths: [] },
    };
    await saveMirrorManifest(storage, null, pending);
    vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockClear();

    await expect(runIpSync(vault.app, settings)).rejects.toThrow('Cloud account change must finish before sync');
    expect(scanDeviceSupernoteTreeWithExtensions).not.toHaveBeenCalled();
    expect((await loadMirrorManifest(storage, {})).manifest).toEqual(pending);
    expect(settings.noteSyncState).toEqual({ [legacy.deviceUri]: legacy });
});

it('retries legacy settings retirement after a verified shared commit when settings saving fails', async () => {
    const vault = makeVault();
    const record = manifestRecord(deviceFile('legacy.note', 'legacy'), vaultPathFor('legacy.note'), 'legacy');
    const settings = settingsWith({ [record.deviceUri]: record });
    const storage = new ObsidianMirrorManifestStorage(vault.app, settings.syncFolder);
    await saveMirrorManifest(storage, null, { version: 1, cloudAccountFingerprint: 'v1:synthetic', records: {
        [vaultPathFor('cloud.note')]: { contentHash: 'cloud-hash',
            source: { engineId: 'supernote-cloud', md5: '0'.repeat(32) } },
    } });
    vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([]);
    const failSave = vi.fn(async () => { throw new Error('settings failed'); });

    await expect(new IpSyncEngine(vault.app, settings, failSave).run({ kind: 'manual', commandId: 'sync-now' }))
        .rejects.toThrow('settings failed');
    expect(settings.noteSyncState).toEqual({ [record.deviceUri]: record });
    const committed = await loadMirrorManifest(storage, {});
    expect(committed.manifest.records[vaultPathFor('legacy.note')].source.engineId).toBe('ip-device');
    expect(committed.manifest.records[vaultPathFor('cloud.note')].source.engineId).toBe('supernote-cloud');

    await new IpSyncEngine(vault.app, settings, async () => {}).run({ kind: 'manual', commandId: 'sync-now' });
    expect(settings.noteSyncState).toEqual({});
    expect((await loadMirrorManifest(storage, {})).revision).toBe(committed.revision);
});

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

async function runIpSync(app: App, settings: SupernotePluginSettings) {
    const engine = new IpSyncEngine(app, settings, async () => {});
    return engine.run({ kind: 'manual', commandId: 'test-sync' });
}

beforeEach(() => {
    vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockReset();
    vi.mocked(fetchFromDevice).mockReset();
});

describe('shared sync reporting', () => {
    const result = (engineId: SyncRunResult['engineId'], issues: SyncRunResult['issues'] = []): SyncRunResult => ({
        engineId, synced: 0, unchanged: 0, excluded: 0, removed: 0, issues,
    });

    it('creates the IP log on a clean run and prepends only once for each reportable run', async () => {
        const vault = makeVault();
        const log = `${SYNC_FOLDER}/Sync Log.md`;
        await reportSyncResult(vault.app, SYNC_FOLDER, result('ip-device'), 'Direct IP');
        expect(vault.readText(log)).toBe('');
        const process = vi.spyOn(vault.vault, 'process');
        await reportSyncResult(vault.app, SYNC_FOLDER, result('ip-device', [
            { kind: 'protected', item: 'Mirror/edited.note', message: 'edited' },
            { kind: 'failure', item: '/failed.note', message: 'timed out' },
        ]), 'Direct IP');
        await reportSyncFailure(vault.app, SYNC_FOLDER, 'ip-device', new Error('connection lost'), 'Direct IP');
        expect(process).toHaveBeenCalledTimes(2);
        expect(vault.readText(log)).toMatch(/^## .*\(Direct IP\)\n- Sync failed: connection lost/);
        expect(vault.readText(log)).toContain('Skipped (edited locally since last sync): `Mirror/edited.note`');
        expect(vault.readText(log)).toContain('Failed: `/failed.note` — timed out');
        expect(vault.readText(log)).toContain('Sync failed: connection lost');
        expect(vault.readText(log).match(/\(Direct IP\)/g)).toHaveLength(2);
    });

    it('logs Cloud file paths like IP without persisting raw errors or account secrets', async () => {
        const vault = makeVault();
        const protectedPath = `${SYNC_FOLDER}/Note/Temp.jpg`;
        const failedPath = `${SYNC_FOLDER}/Note/Failed.note`;
        const secret = 'https://cloud.example/download?token=signed';
        await reportSyncResult(vault.app, SYNC_FOLDER, {
            ...result('supernote-cloud', [
                { kind: 'protected', item: protectedPath, message: 'Vault copy was edited locally' },
                { kind: 'failure', item: failedPath, message: 'Cloud transfer or vault write failed' },
                { kind: 'warning', message: 'Cloud inventory changed; deletion skipped' },
                { kind: 'failure', item: failedPath, message: secret },
                { kind: 'warning', message: secret },
            ]), removed: 1,
        }, 'Supernote cloud');
        await reportSyncFailure(vault.app, SYNC_FOLDER, 'supernote-cloud', new Error(secret), 'Supernote cloud');
        const text = vault.readText(`${SYNC_FOLDER}/Sync Log.md`);
        expect(text).toContain('(Supernote cloud)');
        expect(text).toContain('1 skipped (locally edited), 2 failed, 2 warnings');
        expect(text).toContain(`Skipped (edited locally since last sync): \`${protectedPath}\``);
        expect(text).toContain(`Failed: \`${failedPath}\` — Cloud transfer or vault write failed`);
        expect(text).toContain(`Failed: \`${failedPath}\` — Cloud sync failure`);
        expect(text).toContain('Warning: Cloud inventory changed; deletion skipped');
        expect(text).toContain('Warning: Cloud sync warning');
        expect(text).not.toContain(secret);
        expect(text.match(/## /g)).toHaveLength(2);
    });

    it('surfaces log-write failures without altering the underlying sync result', async () => {
        const vault = makeVault();
        vault.vault.process = vi.fn().mockRejectedValue(new Error('disk full'));
        await expect(reportSyncResult(vault.app, SYNC_FOLDER, result('ip-device', [
            { kind: 'protected', item: 'edited.note', message: 'edited' },
        ]), 'Direct IP')).rejects.toThrow('disk full');
        expect(vault.readText(`${SYNC_FOLDER}/Sync Log.md`)).toBe('');
    });

    it('keeps the latest reportable sections across engines while preserving the preamble', async () => {
        const vault = makeVault();
        const log = `${SYNC_FOLDER}/Sync Log.md`;
        vault.seedFile(log, '# Notes\nKeep this preamble.\n\n## 2026-01-01 00:00:00 (Direct IP)\nold\n\n## user heading\nuser text\n\n## 2026-02-01 00:00:00 (Supernote cloud)\nolder\n\n');
        await reportSyncResult(vault.app, SYNC_FOLDER, result('ip-device'), 'Direct IP', 2);
        expect(vault.readText(log)).toContain('## 2026-01-01');
        await reportSyncResult(vault.app, SYNC_FOLDER, result('ip-device', [
            { kind: 'protected', item: 'edited.note', message: 'edited' },
        ]), 'Direct IP', 2);
        expect(vault.readText(log)).not.toContain('## 2026-01-01');
        expect(vault.readText(log)).toContain('## 2026-02-01');
        await reportSyncFailure(vault.app, SYNC_FOLDER, 'supernote-cloud', new Error('secret'), 'Supernote cloud', 2);
        expect(vault.readText(log)).toMatch(/^# Notes\nKeep this preamble\.\n\n## 20/);
        expect(vault.readText(log)).not.toContain('## user heading');
        expect(vault.readText(log)).toContain('edited.note');
        expect(vault.readText(log)).toContain('(Supernote cloud)');
        expect(vault.readText(log).match(/^## /gm)).toHaveLength(2);
        expect(vault.readText(log).indexOf('Cloud sync failed')).toBeLessThan(vault.readText(log).indexOf('edited.note'));
    });

    it('trims existing logs on a limit change or resumption without creating a missing log', async () => {
        const vault = makeVault();
        const log = `${SYNC_FOLDER}/Sync Log.md`;
        await trimSyncLog(vault.app, SYNC_FOLDER, 1);
        expect(vault.exists(log)).toBe(false);
        vault.seedFile(log, 'Intro\n## 2026-01-01 00:00:00 (Direct IP)\nA\n## 2026-02-01 00:00:00 (Direct IP)\nB\n## 2026-03-01 00:00:00 (Supernote cloud)\nC\n');
        await trimSyncLog(vault.app, SYNC_FOLDER, 2);
        expect(vault.readText(log)).toBe('Intro\n## 2026-03-01 00:00:00 (Supernote cloud)\nC\n## 2026-02-01 00:00:00 (Direct IP)\nB\n');
        await trimSyncLog(vault.app, SYNC_FOLDER, 1);
        expect(vault.readText(log)).toBe('Intro\n## 2026-03-01 00:00:00 (Supernote cloud)\nC\n');
    });

    it('keeps newest-first logs in order and inserts a valid heading after an unterminated preamble', async () => {
        const vault = makeVault();
        const log = `${SYNC_FOLDER}/Sync Log.md`;
        vault.seedFile(log, 'Intro\n## 2026-03-01 00:00:00 (Direct IP)\nnewer\n## 2026-02-01 00:00:00 (Direct IP)\nolder\n');
        await trimSyncLog(vault.app, SYNC_FOLDER, 1);
        expect(vault.readText(log)).toBe('Intro\n## 2026-03-01 00:00:00 (Direct IP)\nnewer\n');
        vault.seedFile(log, 'Keep this preamble');
        await reportSyncFailure(vault.app, SYNC_FOLDER, 'ip-device', new Error('offline'), 'Direct IP', 1);
        expect(vault.readText(log)).toMatch(/^Keep this preamble\n## .*\(Direct IP\)\n- Sync failed: offline/);
    });

    it('does not create or write a log while disabled for either engine or failure path', async () => {
        const vault = makeVault();
        const log = `${SYNC_FOLDER}/Sync Log.md`;
        await reportSyncResult(vault.app, SYNC_FOLDER, result('ip-device'), 'Direct IP', 8, false);
        await reportSyncFailure(vault.app, SYNC_FOLDER, 'supernote-cloud', new Error('failed'), 'Supernote cloud', 8, false);
        await reportSyncResult(vault.app, SYNC_FOLDER, result('supernote-cloud', [
            { kind: 'protected', item: 'edited.note', message: 'edited' },
        ]), 'Supernote cloud', 8, false);
        expect(vault.exists(log)).toBe(false);
        vault.seedFile(log, '## existing\nRetain me.\n');
        await reportSyncFailure(vault.app, SYNC_FOLDER, 'ip-device', new Error('failed'), 'Direct IP', 8, false);
        expect(vault.readText(log)).toBe('## existing\nRetain me.\n');
    });

    it('retains all lines in a section and ignores non-H2 headings', () => {
        expect(retainSyncLogEntries('Preamble\n# H1\n## first\n- item\n### child\n## second\n- item\n', 1))
            .toBe('Preamble\n# H1\n## first\n- item\n### child\n');
    });

    it('does not overwrite a log when pruning fails', async () => {
        const vault = makeVault();
        const log = `${SYNC_FOLDER}/Sync Log.md`;
        vault.seedFile(log, '## first\nA\n## second\nB\n');
        vault.vault.process = vi.fn().mockRejectedValue(new Error('disk full'));
        await expect(reportSyncFailure(vault.app, SYNC_FOLDER, 'ip-device', new Error('connection lost'), 'Direct IP', 2))
            .rejects.toThrow('disk full');
        expect(vault.readText(log)).toBe('## first\nA\n## second\nB\n');
    });
});

// ---------------------------------------------------------------------------
// The PR #258 fix: restoring locally deleted files whose device copy is
// unchanged (previously stranded in plan.unchanged forever).
// ---------------------------------------------------------------------------

describe('runDeviceSync: restoring locally deleted files (PR #258)', () => {
    it('re-downloads an unchanged device file whose vault copy was deleted', async () => {
        const vault = makeVault();
        const listing = deviceFile('foo.note', 'device content');
        vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([listing]);
        mockDeviceContents(new Map([['/foo.note', 'device content']]));
        const settings = settingsWith({
            '/foo.note': manifestRecord(listing, vaultPathFor('foo.note'), 'device content'),
        });

        const result = await runIpSync(vault.app, settings);

        // Restored: fetched, rewritten at the exact same path, counted as synced.
        expect(fetchedUris()).toContain('/foo.note');
        expect(vault.readText(vaultPathFor('foo.note'))).toBe('device content');
        expect(result.synced).toBe(1);
        expect(result.unchanged).toBe(0);
        const manifest = (await loadMirrorManifest(
            new ObsidianMirrorManifestStorage(vault.app, settings.syncFolder), {},
        )).manifest;
        expect(manifest.records[vaultPathFor('foo.note')].contentHash)
            .toBe(hashBytes(new TextEncoder().encode('device content')));
    });

    it('recreates missing parent folders when restoring a nested deleted file', async () => {
        const vault = makeVault();
        const listing = deviceFile('deep.note', 'nested', { uri: '/Projects/Deep/deep.note' });
        vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([listing]);
        mockDeviceContents(new Map([['/Projects/Deep/deep.note', 'nested']]));
        const settings = settingsWith({
            '/Projects/Deep/deep.note': manifestRecord(listing, vaultPathFor('Projects/Deep/deep.note'), 'nested'),
        });

        await runIpSync(vault.app, settings);

        expect(vault.readText(vaultPathFor('Projects/Deep/deep.note'))).toBe('nested');
    });

    it('leaves intact unchanged files untouched and un-fetched', async () => {
        const vault = makeVault();
        const listing = deviceFile('foo.note', 'device content');
        vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([listing]);
        mockDeviceContents(new Map());
        vault.seedFile(vaultPathFor('foo.note'), 'device content');
        const settings = settingsWith({
            '/foo.note': manifestRecord(listing, vaultPathFor('foo.note'), 'device content'),
        });

        const result = await runIpSync(vault.app, settings);

        expect(fetchedUris()).not.toContain('/foo.note');
        expect(result.synced).toBe(0);
        expect(result.unchanged).toBe(1);
        expect(vault.readText(vaultPathFor('foo.note'))).toBe('device content');
    });

    it('still flags locally edited unchanged files as conflicts instead of restoring over them', async () => {
        const vault = makeVault();
        const listing = deviceFile('foo.note', 'device content');
        vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([listing]);
        mockDeviceContents(new Map());
        vault.seedFile(vaultPathFor('foo.note'), 'user edited this');
        const settings = settingsWith({
            '/foo.note': manifestRecord(listing, vaultPathFor('foo.note'), 'device content'),
        });

        const result = await runIpSync(vault.app, settings);

        expect(result.issues).toContainEqual({
            kind: 'protected',
            item: vaultPathFor('foo.note'),
            message: 'Skipped because the vault copy was edited locally',
        });
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
        vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([newFile, restored, intact, edited, hidden]);
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

        const result = await runIpSync(vault.app, settings);

        expect(result).toMatchObject({
            engineId: 'ip-device',
            synced: 2,
            unchanged: 2,
            excluded: 1,
            removed: 0,
            issues: [{
                kind: 'protected',
                item: vaultPathFor('Notes/edited.note'),
                message: 'Skipped because the vault copy was edited locally',
            }],
        });
        expect(vault.readText(vaultPathFor('Notes/new.note'))).toBe('brand new');
        expect(vault.readText(vaultPathFor('Notes/restored.note'))).toBe('restore me');
        expect(vault.readText(vaultPathFor('Notes/intact.note'))).toBe('same bytes');
        expect(vault.readText(vaultPathFor('Notes/edited.note'))).toBe('locally edited');
        expect(vault.exists(vaultPathFor('Secret/hidden.note'))).toBe(false);
    });

    it('applies the shared extension allowlist and counts other files as excluded', async () => {
        const vault = makeVault();
        const note = deviceFile('journal.note', 'note bytes');
        const pdf = deviceFile('reference.pdf', 'pdf bytes', { uri: '/reference.pdf' });
        vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([note, pdf]);
        mockDeviceContents(new Map([['/reference.pdf', 'pdf bytes']]));
        const settings = settingsWith({}, '', '.pdf');

        const result = await runIpSync(vault.app, settings);

        expect(scanDeviceSupernoteTreeWithExtensions).toHaveBeenCalledWith(
            '10.11.12.13',
            ALL_FILE_EXTENSIONS,
        );
        expect(result).toMatchObject({ synced: 1, excluded: 1 });
        expect(fetchedUris()).toEqual(['/reference.pdf']);
        expect(vault.readText(vaultPathFor('reference.pdf'))).toBe('pdf bytes');
        expect(vault.exists(vaultPathFor('journal.note'))).toBe(false);
    });

    it('reports a failed restore in result.failed and keeps the rest of the run going', async () => {
        const vault = makeVault();
        const broken = deviceFile('broken.note', 'never arrives');
        const healthy = deviceFile('healthy.note', 'fine');
        vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([broken, healthy]);
        mockDeviceContents(new Map([['/healthy.note', 'fine']]), ['/broken.note']);
        const settings = settingsWith({
            '/broken.note': manifestRecord(broken, vaultPathFor('broken.note'), 'never arrives'),
            '/healthy.note': manifestRecord(healthy, vaultPathFor('healthy.note'), 'fine'),
        });

        const result = await runIpSync(vault.app, settings);

        expect(result.issues).toEqual([{
            kind: 'failure',
            item: '/broken.note',
            message: 'Supernote responded with status 500',
        }]);
        expect(result.unchanged).toBe(0); // not quietly counted as unchanged either
        expect(vault.exists(vaultPathFor('broken.note'))).toBe(false);
        expect(vault.readText(vaultPathFor('healthy.note'))).toBe('fine');
    });
});

// ---------------------------------------------------------------------------
// Fault isolation: every pass over vault files (toSync download, the
// deleted-file restore check, the drift check) must degrade per-file when one
// file can't be read — a single unreadable file must never abort the whole
// sync run.
// ---------------------------------------------------------------------------

describe('runDeviceSync: fault isolation', () => {
    it('keeps syncing when an unchanged vault file cannot be read', async () => {
        const vault = makeVault();
        const unreadable = deviceFile('unreadable.note', 'device version');
        const healthy = deviceFile('healthy.note', 'fine');
        vi.mocked(scanDeviceSupernoteTreeWithExtensions).mockResolvedValue([unreadable, healthy]);
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
        const result = await runIpSync(vault.app, settings);

        expect(result.synced).toBe(0);
        // Conservatively kept in the unchanged bucket on error — never
        // restored over a file we couldn't inspect.
        expect(result.unchanged).toBe(2);
        expect(vault.readText(vaultPathFor('healthy.note'))).toBe('fine');
    });
});
