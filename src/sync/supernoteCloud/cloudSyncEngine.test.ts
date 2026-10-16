import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupernotePluginSettings } from '../../settings';
import { validateCloudProtocolSession } from '../../../scripts/cloudProtocolSession';
import { collectCloudInventory, queryCloudPath, verifyCloudInventoryPaths } from './cloudInventory';
import { runVerifiedCloudMirror } from './cloudMirrorPipeline';
import { downloadCloudBytes } from './cloudDownload';
import { cloudAccountFingerprint } from '../sharedMirrorManifest';
import { loadMirrorManifest, saveMirrorManifest } from '../sharedMirrorManifestStore';
import { CloudSignInRequiredError, CloudSyncEngine } from './cloudSyncEngine';

const post = vi.hoisted(() => vi.fn());
const notice = vi.hoisted(() => vi.fn());
vi.mock('obsidian', () => ({ Platform: { isDesktop: true }, Notice: notice,
    requestUrl: vi.fn(), TFile: class TFile {} }));
vi.mock('../../../scripts/cloudProtocolSession', () => ({ validateCloudProtocolSession: vi.fn() }));
vi.mock('../../../scripts/cloudProtocolTransport', () => ({
    CloudRequestBudget: class CloudRequestBudget {},
    NodeCloudProtocolTransport: class NodeCloudProtocolTransport { post = post; },
}));
vi.mock('./cloudInventory', () => ({
    collectCloudInventory: vi.fn(), queryCloudPath: vi.fn(), verifyCloudInventoryPaths: vi.fn(),
}));
vi.mock('./cloudMirrorPipeline', () => ({ runVerifiedCloudMirror: vi.fn() }));
vi.mock('./cloudDownload', () => ({ downloadCloudBytes: vi.fn() }));
vi.mock('../sharedMirrorManifestStore', () => ({ loadMirrorManifest: vi.fn(), saveMirrorManifest: vi.fn() }));

const item = {
    id: '123', fileName: 'Test.note', directoryId: '0', isFolder: false,
    size: '3', md5: '0123456789abcdef0123456789abcdef', depth: 1,
    parentPath: '/', parentDerivedPath: '/Test.note',
};
const candidate = { item, canonicalPath: '/Note/Test.note', vaultPath: 'Mirror/Note/Test.note' };
const fingerprint = cloudAccountFingerprint('42');
const settings = { syncFolder: 'Mirror', syncPathFiltersRaw: '', syncFileExtensionsRaw: '.note', noteSyncState: {} } as unknown as SupernotePluginSettings;
const setSecret = vi.fn();
const app = { secretStorage: {
    getSecret: (id: string) => id.endsWith('account-id') ? '42' : 'synthetic-token',
    setSecret,
}, vault: {} } as unknown as App;

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(validateCloudProtocolSession).mockResolvedValue({ token: 'synthetic-token', userId: '42' });
    vi.mocked(collectCloudInventory).mockResolvedValue({ directories: [], items: [item] });
    vi.mocked(queryCloudPath).mockResolvedValue({ path: 'Note/Test.note/', idPath: '1/123/' });
    vi.mocked(verifyCloudInventoryPaths).mockReturnValue(new Map([['123', '/Note/Test.note']]));
    vi.mocked(loadMirrorManifest).mockResolvedValue({
        manifest: { version: 1, cloudAccountFingerprint: null, records: {} }, revision: 1, slot: 'primary',
    });
    vi.mocked(saveMirrorManifest).mockImplementation(async (_storage, _previous, manifest) => ({
        manifest, revision: 2, slot: 'backup',
    }));
    post.mockResolvedValue({ status: 200, body: JSON.stringify({
        success: true, url: 'https://download.test/signed?secret=hidden', md5: item.md5,
    }) });
    vi.mocked(downloadCloudBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(runVerifiedCloudMirror).mockImplementation(async (options) => {
        await options.transfer.download(candidate);
        return { synced: 1, unchanged: 0, excluded: 0, removed: 0, removedFolders: 2, protected: [], failed: [],
            failureCategories: [], warningCategories: [] };
    });
});

describe('Cloud engine', () => {
    it('uses the same guarded mirror pipeline for manual and scheduled runs', async () => {
        const engine = new CloudSyncEngine(app, settings);
        const manual = await engine.run({ kind: 'manual', commandId: 'sync-now' });
        const scheduled = await engine.run({ kind: 'scheduled' });
        expect(scheduled).toEqual(manual);
        expect(validateCloudProtocolSession).toHaveBeenCalledTimes(2);
        expect(collectCloudInventory).toHaveBeenCalledTimes(2);
        expect(runVerifiedCloudMirror).toHaveBeenCalledTimes(2);
        expect(saveMirrorManifest).toHaveBeenCalledTimes(2);
    });

    it('blocks a rejected account before inventory or vault access', async () => {
        vi.mocked(validateCloudProtocolSession).mockRejectedValue(new Error('Account mismatch'));
        const engine = new CloudSyncEngine(app, settings);
        await expect(engine.run({ kind: 'manual', commandId: 'sync-now' })).rejects.toThrow('Account mismatch');
        expect(collectCloudInventory).not.toHaveBeenCalled();
        expect(loadMirrorManifest).not.toHaveBeenCalled();
        expect(notice).not.toHaveBeenCalled();
    });

    it('clears a token rejected by account identity but retains it for unknown errors', async () => {
        const engine = new CloudSyncEngine(app, settings);
        vi.mocked(validateCloudProtocolSession).mockRejectedValueOnce(new Error('Supernote Cloud request failed (HTTP 401)'));
        await expect(engine.run({ kind: 'scheduled' })).rejects.toBeInstanceOf(CloudSignInRequiredError);
        expect(setSecret).toHaveBeenCalledWith('supernote-cloud-access-token', '');
        expect(setSecret).toHaveBeenCalledWith('supernote-cloud-account-id', '');
        setSecret.mockClear();
        vi.mocked(validateCloudProtocolSession).mockRejectedValueOnce(new Error('Supernote Cloud error E0000'));
        await expect(engine.run({ kind: 'manual', commandId: 'sync-now' })).rejects.toThrow('E0000');
        expect(setSecret).not.toHaveBeenCalled();
        expect(collectCloudInventory).not.toHaveBeenCalled();
    });

    it('does not run without a session', () => {
        const signedOut = { ...app, secretStorage: {
            getSecret: () => null, setSecret,
        } } as unknown as App;
        expect(new CloudSyncEngine(signedOut, settings).getReadiness()).toEqual({
            ready: false, reason: 'Sign in to Supernote Cloud in settings to resume sync',
        });
    });

    it('binds the validated account and downloads the descriptor bytes', async () => {
        const engine = new CloudSyncEngine(app, settings);
        await expect(engine.run({ kind: 'manual', commandId: 'sync-now' })).resolves.toMatchObject({
            engineId: 'supernote-cloud', synced: 1, removed: 0, removedFolders: 2,
        });
        expect(saveMirrorManifest).toHaveBeenCalledWith(expect.anything(), expect.anything(),
            expect.objectContaining({ cloudAccountFingerprint: fingerprint }));
        expect(queryCloudPath).toHaveBeenCalledWith(expect.anything(), 'synthetic-token', '123');
        expect(downloadCloudBytes).toHaveBeenCalledWith(expect.anything(), item.md5,
            expect.any(Number));
        expect(notice.mock.calls).toEqual([
            ['Supernote cloud mirror started'],
            ['Supernote Cloud downloading: Mirror/Note/Test.note'],
        ]);
        expect(setSecret).not.toHaveBeenCalled();
    });

    it('does not announce downloads when every file is unchanged or excluded', async () => {
        vi.mocked(runVerifiedCloudMirror).mockResolvedValue({ synced: 0, unchanged: 1, excluded: 1, removed: 0, removedFolders: 0,
            protected: [], failed: [], failureCategories: [], warningCategories: [] });
        await new CloudSyncEngine(app, settings).run({ kind: 'manual', commandId: 'sync-now' });
        expect(notice.mock.calls).toEqual([['Supernote cloud mirror started']]);
        expect(downloadCloudBytes).not.toHaveBeenCalled();
    });

    it('carries protected and failed paths in memory for shared reporting', async () => {
        vi.mocked(runVerifiedCloudMirror).mockResolvedValue({ synced: 0, unchanged: 0, excluded: 0, removed: 0, removedFolders: 0,
            protected: ['Mirror/Note/edited.note'], failed: ['Mirror/Note/failed.note'],
            failureCategories: ['Missing Cloud checksum'], warningCategories: [] });
        const result = await new CloudSyncEngine(app, settings).run({ kind: 'scheduled' });
        expect(result.issues).toEqual([
            { kind: 'protected', item: 'Mirror/Note/edited.note', message: 'Vault copy was edited locally' },
            { kind: 'failure', item: 'Mirror/Note/failed.note', message: 'Missing Cloud checksum' },
        ]);
    });

});