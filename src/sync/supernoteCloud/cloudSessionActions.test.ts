import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupernotePluginSettings } from '../../settings';
import { authenticateCloudPassword } from './cloudAuth';
import { CLOUD_ROUTES } from './cloudPolicy';
import { signInCloud, signOutCloud } from './cloudSessionActions';
import { CloudSessionStorage } from './cloudSessionStorage';
import { cloudAccountFingerprint } from '../sharedMirrorManifest';
import { loadMirrorManifest } from '../sharedMirrorManifestStore';
import { changeCloudMirrorAccount } from './cloudAccountChange';

vi.mock('obsidian', () => ({ TFile: class TFile {} }));
vi.mock('./cloudAuth', () => ({ authenticateCloudPassword: vi.fn() }));
vi.mock('../sharedMirrorManifestStore', () => ({ loadMirrorManifest: vi.fn() }));
vi.mock('./cloudAccountChange', () => ({ changeCloudMirrorAccount: vi.fn() }));

const secrets = new Map<string, string>();
const app = { secretStorage: {
    getSecret: (id: string) => secrets.get(id) ?? null,
    setSecret: (id: string, value: string) => { secrets.set(id, value); },
} } as unknown as App;
const settings = { syncFolder: 'Mirror', noteSyncState: {}, syncPathFiltersRaw: '',
    syncFileExtensionsRaw: '.note' } as SupernotePluginSettings;
const transport = { bootstrapCsrf: vi.fn(async () => {}), post: vi.fn(async () => ({ status: 200, body: '{"success":true}' })) };
const credentials = { email: 'test@example.com', password: 'private-password' };
const getCode = vi.fn(async () => 'private-code');

beforeEach(() => {
    vi.clearAllMocks();
    secrets.clear();
    vi.mocked(authenticateCloudPassword).mockResolvedValue({ token: 'private-token', userId: '42', emailVerificationUsed: false });
    vi.mocked(loadMirrorManifest).mockResolvedValue({
        manifest: { version: 1, cloudAccountFingerprint: null, records: {} }, revision: 0, slot: 'primary',
    });
    vi.mocked(changeCloudMirrorAccount).mockResolvedValue({ protectedPaths: [] });
});

describe('Cloud session actions', () => {
    it('saves only the validated token and account after checking mirror binding', async () => {
        await signInCloud(app, settings, credentials, getCode, () => false, transport);
        expect(authenticateCloudPassword).toHaveBeenCalledWith(transport, credentials, { getVerificationCode: getCode });
        expect(new CloudSessionStorage(app.secretStorage).load()).toEqual({ token: 'private-token', userId: '42' });
        expect([...secrets.values()]).not.toContain(credentials.password);
        expect([...secrets.values()]).not.toContain('private-code');
        expect([...secrets.keys()]).toHaveLength(2);
    });

    it('does not persist failures or cancelled attempts, including after verification', async () => {
        vi.mocked(authenticateCloudPassword).mockRejectedValueOnce(new Error('Rejected code'));
        await expect(signInCloud(app, settings, credentials, getCode, () => false, transport)).rejects.toThrow('Rejected code');
        expect(secrets.size).toBe(0);
        await signInCloud(app, settings, credentials, getCode, () => true, transport);
        expect(secrets.size).toBe(0);
        expect(loadMirrorManifest).not.toHaveBeenCalled();
    });

    it('blocks a different mirror account even after local sign-out', async () => {
        vi.mocked(loadMirrorManifest).mockResolvedValue({
            manifest: { version: 1, cloudAccountFingerprint: cloudAccountFingerprint('17'), records: {} },
            revision: 1, slot: 'primary',
        });
        expect(await signInCloud(app, settings, credentials, getCode, () => false, transport)).toBeNull();
        expect(secrets.size).toBe(0);
    });

    it('re-enters the same bound account without confirmation or cleanup', async () => {
        vi.mocked(loadMirrorManifest).mockResolvedValue({
            manifest: { version: 1, cloudAccountFingerprint: cloudAccountFingerprint('42'), records: {} },
            revision: 1, slot: 'primary',
        });
        const confirm = vi.fn(async () => true);
        expect(await signInCloud(app, settings, credentials, getCode, () => false, transport, confirm)).toEqual([]);
        expect(confirm).not.toHaveBeenCalled();
        expect(changeCloudMirrorAccount).not.toHaveBeenCalled();
    });

    it('changes a bound account only after confirmation and preserves cancellation', async () => {
        vi.mocked(loadMirrorManifest).mockResolvedValue({
            manifest: { version: 1, cloudAccountFingerprint: cloudAccountFingerprint('17'), records: {} },
            revision: 1, slot: 'primary',
        });
        const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        expect(await signInCloud(app, settings, credentials, getCode, () => false, transport, confirm)).toBeNull();
        expect(changeCloudMirrorAccount).not.toHaveBeenCalled();
        vi.mocked(changeCloudMirrorAccount).mockResolvedValue({ protectedPaths: ['Mirror/Note/edited.note'] });
        expect(await signInCloud(app, settings, credentials, getCode, () => false, transport, confirm))
            .toEqual(['Mirror/Note/edited.note']);
        expect(changeCloudMirrorAccount).toHaveBeenCalledOnce();
        expect(new CloudSessionStorage(app.secretStorage).load()?.userId).toBe('42');
    });

    it('does not repeat cleanup when the new binding is already committed but the old session remains', async () => {
        new CloudSessionStorage(app.secretStorage).save({ token: 'previous-token', userId: '17' });
        vi.mocked(loadMirrorManifest).mockResolvedValue({
            manifest: { version: 1, cloudAccountFingerprint: cloudAccountFingerprint('42'), records: {} },
            revision: 4, slot: 'backup',
        });
        const confirm = vi.fn(async () => true);
        expect(await signInCloud(app, settings, credentials, getCode, () => false, transport, confirm)).toEqual([]);
        expect(confirm).toHaveBeenCalledOnce();
        expect(changeCloudMirrorAccount).not.toHaveBeenCalled();
        expect(new CloudSessionStorage(app.secretStorage).load()?.userId).toBe('42');
    });

    it('preserves unbound shared IP history when replacing an old local session', async () => {
        new CloudSessionStorage(app.secretStorage).save({ token: 'previous-token', userId: '17' });
        const ipRecord = { contentHash: 'synthetic', source: {
            engineId: 'ip-device' as const, deviceUri: '/Note/ip.note', deviceDate: '2026-01-01', deviceSize: 1,
        } };
        vi.mocked(loadMirrorManifest).mockResolvedValue({
            manifest: { version: 1, cloudAccountFingerprint: null, records: { 'Mirror/Note/ip.note': ipRecord } },
            revision: 2, slot: 'primary',
        });
        const confirm = vi.fn(async () => true);
        expect(await signInCloud(app, settings, credentials, getCode, () => false, transport, confirm)).toEqual([]);
        expect(changeCloudMirrorAccount).not.toHaveBeenCalled();
        expect(new CloudSessionStorage(app.secretStorage).load()?.userId).toBe('42');
    });

    it('preserves an existing session if the replacement token fails readback', async () => {
        new CloudSessionStorage(app.secretStorage).save({ token: 'previous-token', userId: '42' });
        const originalGetSecret = app.secretStorage.getSecret.bind(app.secretStorage);
        const transientApp = { secretStorage: {
            setSecret: app.secretStorage.setSecret.bind(app.secretStorage),
            getSecret: vi.fn((id: string) => id.endsWith('access-token') && secrets.get(id) === 'private-token'
                ? 'previous-token' : originalGetSecret(id)),
        } } as unknown as App;
        await expect(signInCloud(transientApp, settings, credentials, getCode, () => false, transport))
            .rejects.toThrow('did not retain');
        expect(new CloudSessionStorage(app.secretStorage).load()).toEqual({ token: 'previous-token', userId: '42' });
    });

    it('clears local credentials even if remote logout fails', async () => {
        new CloudSessionStorage(app.secretStorage).save({ token: 'private-token', userId: '42' });
        transport.post.mockRejectedValueOnce(new Error('offline'));
        await signOutCloud(app, transport);
        expect(new CloudSessionStorage(app.secretStorage).load()).toBeNull();
        expect([...secrets.values()]).toEqual(['', '']);
        expect(transport.post).toHaveBeenCalledWith(CLOUD_ROUTES.logout, {}, { accessToken: 'private-token' });
    });
});