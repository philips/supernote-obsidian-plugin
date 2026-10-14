import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importCloudSession } from './importCloudSession';
import { validateCloudProtocolSession } from '../../scripts/cloudProtocolSession';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));
vi.mock('../../scripts/cloudProtocolSession', () => ({
    validateCloudProtocolSession: vi.fn(),
}));
vi.mock('../../scripts/cloudProtocolTransport', () => ({
    CloudRequestBudget: class CloudRequestBudget {}, NodeCloudProtocolTransport: class NodeCloudProtocolTransport {},
}));

function fakeApp(secretsAvailable = true) {
    const secrets = new Map<string, string>();
    const app = {
        vault: {},
        secretStorage: secretsAvailable ? {
            getSecret: (id: string) => secrets.get(id) ?? null,
            setSecret: (id: string, value: string) => { secrets.set(id, value); },
        } : undefined,
    } as unknown as App;
    return { app, secrets };
}

beforeEach(() => {
    vi.mocked(validateCloudProtocolSession).mockReset();
});

describe('Cloud session import', () => {
    it('rejects missing SecretStorage and empty tokens before remote validation', async () => {
        await expect(importCloudSession(fakeApp(false).app, 'cached-token')).rejects.toThrow('SecretStorage');
        await expect(importCloudSession(fakeApp().app, '  ')).rejects.toThrow('access token');
        expect(validateCloudProtocolSession).not.toHaveBeenCalled();
    });

    it('stores only a remotely validated pasted token and retains its account binding', async () => {
        const { app, secrets } = fakeApp();
        vi.mocked(validateCloudProtocolSession).mockResolvedValue({ token: 'cached-token', accountId: '123' });
        await importCloudSession(app, ' cached-token ');
        expect(validateCloudProtocolSession).toHaveBeenCalledOnce();
        expect(vi.mocked(validateCloudProtocolSession).mock.calls[0][1]).toMatchObject({
            token: 'cached-token', accountId: null,
        });
        expect([...secrets.values()]).toContain('cached-token');
        expect([...secrets.values()]).toContain('123');
        vi.mocked(validateCloudProtocolSession).mockRejectedValue(new Error('Account mismatch'));
        await expect(importCloudSession(app, 'cached-token')).rejects.toThrow('Account mismatch');
        expect([...secrets.values()]).toContain('cached-token');
    });

    it('checks the pasted cache origin and account binding before saving', async () => {
        const { app, secrets } = fakeApp();
        const cache = { version: 1, origin: 'https://cloud.supernote.com', token: 'cached-token', accountId: '123' };
        vi.mocked(validateCloudProtocolSession).mockResolvedValue({ token: 'cached-token', accountId: '123' });
        await importCloudSession(app, JSON.stringify(cache));
        expect(vi.mocked(validateCloudProtocolSession).mock.calls[0][1]).toMatchObject({
            token: 'cached-token', accountId: '123',
        });
        expect([...secrets.values()]).toContain('cached-token');

        vi.mocked(validateCloudProtocolSession).mockClear();
        await expect(importCloudSession(app, JSON.stringify({ ...cache, origin: 'https://other.example' })))
            .rejects.toThrow('cache is invalid');
        await expect(importCloudSession(app, JSON.stringify({ ...cache, accountId: '456' })))
            .rejects.toThrow('another account');
        await expect(importCloudSession(app, '{invalid json')).rejects.toThrow('cache is invalid');
        expect(validateCloudProtocolSession).not.toHaveBeenCalled();
    });

    it('does not store a token when account validation fails', async () => {
        const { app, secrets } = fakeApp();
        vi.mocked(validateCloudProtocolSession).mockRejectedValue(new Error('Request failed'));
        await expect(importCloudSession(app, 'cached-token')).rejects.toThrow('Request failed');
        expect(secrets.size).toBe(0);
    });

    it('rejects a token that SecretStorage does not retain accurately', async () => {
        const { app, secrets } = fakeApp();
        vi.mocked(validateCloudProtocolSession).mockResolvedValue({ token: 'cached-token', accountId: '123' });
        vi.spyOn(app.secretStorage, 'getSecret').mockImplementation((id) => {
            const stored = secrets.get(id) ?? null;
            return stored === 'cached-token' ? 'incorrect-token' : stored;
        });
        await expect(importCloudSession(app, 'cached-token')).rejects.toThrow('SecretStorage did not retain');
    });
});