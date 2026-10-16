import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { CloudSessionStorage } from './cloudSessionStorage';
import { ObsidianSyncExecutionStateStore } from '../syncExecutionState';

describe('Cloud session storage', () => {
    it('reads an existing session from the original SecretStorage keys', () => {
        const secrets = new Map([
            ['supernote-cloud-access-token', 'existing-token'],
            ['supernote-cloud-account-id', '9223372036854775807'],
        ]);
        const storage = new CloudSessionStorage({
            getSecret: (id: string) => secrets.get(id) ?? null,
            setSecret: (id: string, value: string) => { secrets.set(id, value); },
        } as App['secretStorage']);
        expect(storage.load()).toEqual({ token: 'existing-token', userId: '9223372036854775807' });
    });

    it('keeps token and account binding only in SecretStorage', () => {
        const secrets = new Map<string, string>();
        const saveLocalStorage = vi.fn();
        const app = {
            secretStorage: {
                getSecret: (id: string) => secrets.get(id) ?? null,
                setSecret: (id: string, value: string) => { secrets.set(id, value); },
            },
            loadLocalStorage: vi.fn(() => null),
            saveLocalStorage,
        } as unknown as App;
        const store = new CloudSessionStorage(app.secretStorage);
        expect(store.load()).toBeNull();
        store.save({ token: 'test-token', userId: '9223372036854775807' });
        expect(store.load()).toEqual({ token: 'test-token', userId: '9223372036854775807' });
        expect(secrets.get('supernote-cloud-account-id')).toBe('9223372036854775807');
        expect(saveLocalStorage).not.toHaveBeenCalled();
        expect(() => store.save({ token: 'different', userId: '2' })).toThrow('another account');
        expect(store.load()?.token).toBe('test-token');
        store.clear();
        expect(store.load()).toBeNull();
        expect([...secrets.values()]).toEqual(['', '']);
        expect(saveLocalStorage).not.toHaveBeenCalled();
    });

    it('does not propagate legacy plaintext session fields into execution state', () => {
        const saveLocalStorage = vi.fn();
        const app = {
            loadLocalStorage: () => ({ version: 1, activeSyncEngine: 'ip-device',
                cloudSessionToken: 'legacy-token', cloudAccountId: '17' }),
            saveLocalStorage,
        } as unknown as App;
        const stateStore = new ObsidianSyncExecutionStateStore(app);
        const state = stateStore.load();
        expect(JSON.stringify(state)).not.toContain('legacy-token');
        expect(saveLocalStorage).toHaveBeenCalledOnce();
        stateStore.save(state);
        expect(JSON.stringify(saveLocalStorage.mock.calls)).not.toContain('legacy-token');
    });
});