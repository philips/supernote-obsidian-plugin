import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupernotePluginSettings } from '../settings';
import { authenticateCloudPassword } from './cloudAuth';
import { CLOUD_ROUTES } from './cloudPolicy';
import { signInCloud, signOutCloud } from './cloudSessionActions';
import { CloudSessionStorage } from './cloudSessionStorage';
import { cloudAccountFingerprint } from './sharedMirrorManifest';
import { loadMirrorManifest } from './sharedMirrorManifestStore';

vi.mock('obsidian', () => ({ TFile: class TFile {} }));
vi.mock('./cloudAuth', () => ({ authenticateCloudPassword: vi.fn() }));
vi.mock('./sharedMirrorManifestStore', () => ({ loadMirrorManifest: vi.fn() }));

const secrets = new Map<string, string>();
const app = { secretStorage: {
    getSecret: (id: string) => secrets.get(id) ?? null,
    setSecret: (id: string, value: string) => { secrets.set(id, value); },
} } as unknown as App;
const settings = { syncFolder: 'Mirror', noteSyncState: {} } as SupernotePluginSettings;
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
        await expect(signInCloud(app, settings, credentials, getCode, () => false, transport))
            .rejects.toThrow('binding does not match');
        expect(secrets.size).toBe(0);
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