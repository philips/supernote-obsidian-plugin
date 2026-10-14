import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupernotePluginSettings } from '../settings';
import { validateCloudProtocolSession } from '../../scripts/cloudProtocolSession';
import { collectCloudInventory, queryCloudPath, verifyCloudInventoryPaths } from './cloudInventory';
import { runVerifiedCloudMirror } from './cloudMirrorPipeline';
import { downloadCloudBytes } from './cloudDownload';
import { cloudAccountFingerprint } from './sharedMirrorManifest';
import { loadMirrorManifest, saveMirrorManifest } from './sharedMirrorManifestStore';
import { CloudSyncEngine } from './cloudSyncEngine';

const post = vi.hoisted(() => vi.fn());
vi.mock('obsidian', () => ({ Platform: { isDesktop: true }, requestUrl: vi.fn(), TFile: class TFile {} }));
vi.mock('../../scripts/cloudProtocolSession', () => ({ validateCloudProtocolSession: vi.fn() }));
vi.mock('../../scripts/cloudProtocolTransport', () => ({
    CloudRequestBudget: class CloudRequestBudget {},
    NodeCloudProtocolTransport: class NodeCloudProtocolTransport { post = post; },
}));
vi.mock('./cloudInventory', () => ({
    collectCloudInventory: vi.fn(), queryCloudPath: vi.fn(), verifyCloudInventoryPaths: vi.fn(),
}));
vi.mock('./cloudMirrorPipeline', () => ({ runVerifiedCloudMirror: vi.fn() }));
vi.mock('./cloudDownload', () => ({ downloadCloudBytes: vi.fn() }));
vi.mock('./sharedMirrorManifestStore', () => ({ loadMirrorManifest: vi.fn(), saveMirrorManifest: vi.fn() }));

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
    vi.mocked(validateCloudProtocolSession).mockResolvedValue({ token: 'synthetic-token', accountId: '42' });
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
        return { synced: 1, unchanged: 0, excluded: 0, protected: [], failed: [], failureCategories: [] };
    });
});

describe('manual Cloud engine', () => {
    it('refuses scheduled runs without touching the account', async () => {
        const engine = new CloudSyncEngine(app, settings);
        await expect(engine.run({ kind: 'scheduled' })).rejects.toThrow('Automatic Cloud mirror');
        expect(validateCloudProtocolSession).not.toHaveBeenCalled();
    });

    it('blocks a rejected account before inventory or vault access', async () => {
        vi.mocked(validateCloudProtocolSession).mockRejectedValue(new Error('Account mismatch'));
        const engine = new CloudSyncEngine(app, settings);
        await expect(engine.run({ kind: 'manual', commandId: 'sync-now' })).rejects.toThrow('Account mismatch');
        expect(collectCloudInventory).not.toHaveBeenCalled();
        expect(loadMirrorManifest).not.toHaveBeenCalled();
    });

    it('binds the validated account and downloads the descriptor bytes', async () => {
        const engine = new CloudSyncEngine(app, settings);
        await expect(engine.run({ kind: 'manual', commandId: 'sync-now' })).resolves.toMatchObject({
            engineId: 'supernote-cloud', synced: 1, removed: 0,
        });
        expect(saveMirrorManifest).toHaveBeenCalledWith(expect.anything(), expect.anything(),
            expect.objectContaining({ cloudAccountFingerprint: fingerprint }));
        expect(queryCloudPath).toHaveBeenCalledWith(expect.anything(), 'synthetic-token', '123');
        expect(downloadCloudBytes).toHaveBeenCalledWith(expect.anything(), item.md5,
            expect.any(Number));
        expect(setSecret).not.toHaveBeenCalled();
    });

});