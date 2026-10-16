import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { ObsidianSyncExecutionStateStore } from './syncExecutionState';
import type { LoadedMirrorManifest } from './sharedMirrorManifestStore';
import type { SharedMirrorManifest } from './sharedMirrorManifest';
import { hashBytes } from './directIP/deviceSync';
import { MirrorRecoveryAttentionError } from './mirrorOperationExecutor';
import {
    formatSyncSummary,
    SingleEngineSyncCoordinator,
    SyncEngine,
    SyncEngineId,
    SyncExecutionState,
    SyncExecutionStateStore,
    SyncRunResult,
} from './syncAbstraction';

function result(engineId: 'ip-device' | 'supernote-cloud'): SyncRunResult {
    return { engineId, synced: 1, unchanged: 0, excluded: 0, removed: 0, issues: [] };
}

function engine(id: 'ip-device' | 'supernote-cloud', ready = true): SyncEngine {
    return createEngineHarness(id, ready).syncEngine;
}

function createEngineHarness(id: 'ip-device' | 'supernote-cloud', ready = true) {
    const run = vi.fn(async () => result(id));
    const clearHistory = vi.fn(async () => {});
    const syncEngine: SyncEngine = {
        id,
        name: id,
        getReadiness: () => ready ? { ready: true } : { ready: false, reason: `${id} is not configured` },
        run,
        clearHistory,
    };
    return { syncEngine, run, clearHistory };
}

function stateStore(activeSyncEngine: 'ip-device' | 'supernote-cloud' = 'ip-device') {
    let state: SyncExecutionState = {
        version: 1,
        activeSyncEngine,
        autoSyncEnabled: false,
        autoSyncMinutes: 15,
        lastAutomaticAttemptAt: {},
        lastRunAt: {},
        lastRunOutcome: {},
    };
    const store: SyncExecutionStateStore = {
        load: () => state,
        save: (next) => { state = next; },
    };
    return { store, current: () => state };
}

it('pauses automatic sync on pending recovery and blocks shared actions until it is resolved', async () => {
    const store = stateStore();
    const path = 'Mirror/Note/Test.note';
    const bytes = new TextEncoder().encode('edited');
    const beforeHash = hashBytes(new TextEncoder().encode('old'));
    const manifest: SharedMirrorManifest = {
        version: 1, cloudAccountFingerprint: null,
        records: { [path]: { contentHash: beforeHash, source: {
            engineId: 'ip-device', deviceUri: '/Test.note', deviceDate: '', deviceSize: 3,
        } } },
        pendingOperation: { kind: 'write', root: 'Mirror', path, beforeHash,
            after: { contentHash: hashBytes(new TextEncoder().encode('new')), source: {
                engineId: 'ip-device', deviceUri: '/Test.note', deviceDate: '', deviceSize: 3,
            } } },
    };
    const service = { load: vi.fn(async () => ({ manifest, revision: 1, slot: 'primary' as const })),
        commit: vi.fn(async () => { throw new Error('should not commit'); }) };
    const attention = vi.fn(async (_error: MirrorRecoveryAttentionError) => { throw new Error('log unavailable'); });
    const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': engine('ip-device') }, store.store,
        service, async () => {}, undefined, { root: () => 'Mirror', read: async () => bytes, attention });
    coordinator.setAutoSyncEnabled(true);
    await coordinator.recoverOnStartup();
    expect(store.current().autoSyncEnabled).toBe(false);
    expect(attention).toHaveBeenCalledOnce();
    await expect(coordinator.assertNoPendingOperation()).rejects.toThrow('blocks sync folder changes');
    await expect(coordinator.clearActiveHistory()).rejects.toThrow('blocks history clearing');
    await expect(coordinator.runActive({ kind: 'manual', commandId: 'sync-now' }))
        .rejects.toBeInstanceOf(MirrorRecoveryAttentionError);
});

describe('stored automatic sync settings', () => {
    it('migrates old enabled and disabled intervals without changing the selected engine', () => {
        let stored: Record<string, unknown> = { version: 1, activeSyncEngine: 'supernote-cloud', autoSyncMinutes: 5 };
        const app = {
            loadLocalStorage: () => stored,
            saveLocalStorage: (_key: string, next: Record<string, unknown>) => { stored = next; },
        } as unknown as App;
        const store = new ObsidianSyncExecutionStateStore(app);
        expect(store.load()).toMatchObject({ activeSyncEngine: 'supernote-cloud', autoSyncEnabled: true, autoSyncMinutes: 5 });
        stored = { version: 1, activeSyncEngine: 'supernote-cloud', autoSyncMinutes: 0 };
        expect(store.load()).toMatchObject({ autoSyncEnabled: false, autoSyncMinutes: 15 });
        stored = { version: 1, activeSyncEngine: 'supernote-cloud', autoSyncEnabled: true, autoSyncMinutes: 'invalid' };
        expect(store.load()).toMatchObject({ autoSyncEnabled: false, autoSyncMinutes: 15 });
        store.save({ ...store.load(), autoSyncEnabled: true });
        expect(stored).toMatchObject({ autoSyncEnabled: true, autoSyncMinutes: 15 });
    });
});

describe('Cloud completion summary', () => {
    it('includes every secret-free count even when no files change', () => {
        expect(formatSyncSummary(result('supernote-cloud'))).toBe(
            'Supernote sync: 1 downloaded, 0 unchanged, 0 out of scope, 0 files moved to Trash, 0 skipped (locally edited), 0 failed',
        );
        expect(formatSyncSummary({ engineId: 'supernote-cloud', synced: 2, unchanged: 3,
            excluded: 4, removed: 1, issues: [
                { kind: 'protected', message: 'Local edit' },
                { kind: 'failure', message: 'Transfer failed' },
                { kind: 'warning', message: 'Deletion skipped' },
            ] })).toBe(
            'Supernote sync: 2 downloaded, 3 unchanged, 4 out of scope, 1 file moved to Trash, 1 skipped (locally edited), 1 failed, 1 warning',
        );
    });

    it('shows successful empty-folder moves separately from file moves', () => {
        expect(formatSyncSummary({ ...result('supernote-cloud'), synced: 0, removedFolders: 1 })).toBe(
            'Supernote sync: 0 downloaded, 0 unchanged, 0 out of scope, 0 files moved to Trash, 1 empty folder moved to Trash, 0 skipped (locally edited), 0 failed',
        );
        expect(formatSyncSummary({ ...result('supernote-cloud'), removed: 1, removedFolders: 2 })).toContain(
            '1 file moved to Trash, 2 empty folders moved to Trash',
        );
    });
});

describe('SingleEngineSyncCoordinator', () => {
    it('keeps disabled intervals idle and initializes missing or invalid timestamps without a run', async () => {
        const ip = createEngineHarness('ip-device');
        const state = stateStore();
        const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': ip.syncEngine }, state.store);
        await coordinator.pollAutomatic(60_000);
        expect(ip.run).not.toHaveBeenCalled();
        state.store.save({ ...state.current(), autoSyncEnabled: true, autoSyncMinutes: 1 });
        const restarted = new SingleEngineSyncCoordinator({ 'ip-device': ip.syncEngine }, state.store);
        await restarted.pollAutomatic(60_000);
        expect(state.current().lastAutomaticAttemptAt['ip-device']).toBe(new Date(60_000).toISOString());
        await restarted.pollAutomatic(60_001);
        expect(ip.run).not.toHaveBeenCalled();
        state.store.save({ ...state.current(), lastAutomaticAttemptAt: { 'ip-device': 'not-a-date' } });
        const invalidRestart = new SingleEngineSyncCoordinator({ 'ip-device': ip.syncEngine }, state.store);
        await invalidRestart.pollAutomatic(120_000);
        expect(ip.run).not.toHaveBeenCalled();
        state.store.save({ ...state.current(), lastAutomaticAttemptAt: { 'ip-device': new Date(300_000).toISOString() } });
        const futureRestart = new SingleEngineSyncCoordinator({ 'ip-device': ip.syncEngine }, state.store);
        await futureRestart.pollAutomatic(180_000);
        expect(state.current().lastAutomaticAttemptAt['ip-device']).toBe(new Date(180_000).toISOString());
        expect(ip.run).not.toHaveBeenCalled();
    });

    it('runs one due catch-up on the active engine and never replays missed intervals', async () => {
        const ip = createEngineHarness('ip-device');
        const cloud = createEngineHarness('supernote-cloud');
        const state = stateStore('supernote-cloud');
        state.store.save({ ...state.current(), autoSyncEnabled: true, autoSyncMinutes: 5,
            lastAutomaticAttemptAt: { 'supernote-cloud': new Date(0).toISOString() } });
        const coordinator = new SingleEngineSyncCoordinator(
            { 'ip-device': ip.syncEngine, 'supernote-cloud': cloud.syncEngine }, state.store);
        await coordinator.pollAutomatic(3_600_000);
        await coordinator.pollAutomatic(3_600_001);
        expect(cloud.run).toHaveBeenCalledExactlyOnceWith({ kind: 'scheduled' });
        expect(ip.run).not.toHaveBeenCalled();
        expect(state.current().lastAutomaticAttemptAt['supernote-cloud']).toBe(new Date(3_600_000).toISOString());
    });

    it('schedules IP too, and paces unready engines at the configured interval', async () => {
        const ip = createEngineHarness('ip-device', false);
        const state = stateStore();
        state.store.save({ ...state.current(), autoSyncEnabled: true, autoSyncMinutes: 1,
            lastAutomaticAttemptAt: { 'ip-device': new Date(0).toISOString() } });
        const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': ip.syncEngine }, state.store);
        await coordinator.pollAutomatic(60_000);
        expect(ip.run).not.toHaveBeenCalled();
        expect(state.current().lastAutomaticAttemptAt['ip-device']).toBe(new Date(60_000).toISOString());
        const readyIp = createEngineHarness('ip-device');
        const restarted = new SingleEngineSyncCoordinator({ 'ip-device': readyIp.syncEngine }, state.store);
        await restarted.pollAutomatic(60_001);
        expect(readyIp.run).not.toHaveBeenCalled();
        await restarted.pollAutomatic(120_000);
        expect(readyIp.run).toHaveBeenCalledExactlyOnceWith({ kind: 'scheduled' });
    });

    it('reports an unready cloud engine only when the automatic interval is due', async () => {
        const cloud = createEngineHarness('supernote-cloud', false);
        const state = stateStore('supernote-cloud');
        state.store.save({ ...state.current(), autoSyncEnabled: true, autoSyncMinutes: 5,
            lastAutomaticAttemptAt: { 'supernote-cloud': new Date(0).toISOString() } });
        const coordinator = new SingleEngineSyncCoordinator({ 'supernote-cloud': cloud.syncEngine }, state.store);
        const onUnready = vi.fn();

        await coordinator.pollAutomatic(60_000, onUnready);
        expect(onUnready).not.toHaveBeenCalled();
        await coordinator.pollAutomatic(300_000, onUnready);
        expect(onUnready).toHaveBeenCalledExactlyOnceWith('supernote-cloud', 'supernote-cloud is not configured');
        await coordinator.pollAutomatic(360_000, onUnready);
        expect(onUnready).toHaveBeenCalledTimes(1);
        await coordinator.pollAutomatic(600_000, onUnready);
        expect(onUnready).toHaveBeenCalledTimes(2);
        expect(cloud.run).not.toHaveBeenCalled();
        expect(state.current().lastAutomaticAttemptAt['supernote-cloud']).toBe(new Date(600_000).toISOString());
    });

    it('skips overlapping polls while preserving manual sync', async () => {
        let finishRun: ((value: SyncRunResult) => void) | undefined;
        const ip = engine('ip-device');
        const run = vi.fn(() => new Promise<SyncRunResult>((resolve) => { finishRun = resolve; }));
        ip.run = run;
        const state = stateStore();
        state.store.save({ ...state.current(), autoSyncEnabled: true, autoSyncMinutes: 1,
            lastAutomaticAttemptAt: { 'ip-device': new Date(0).toISOString() } });
        const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': ip }, state.store);
        const manual = coordinator.runActive({ kind: 'manual', commandId: 'sync-now' });
        await expect(coordinator.pollAutomatic(60_000)).resolves.toBeNull();
        expect(state.current().lastAutomaticAttemptAt['ip-device']).toBe(new Date(0).toISOString());
        finishRun?.(result('ip-device'));
        await manual;
        const scheduled = coordinator.pollAutomatic(60_000);
        expect(run).toHaveBeenCalledTimes(2);
        finishRun?.(result('ip-device'));
        await scheduled;
    });

    it('rebases the clock on enabling the interval or switching engines', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
            const state = stateStore();
            const coordinator = new SingleEngineSyncCoordinator({
                'ip-device': engine('ip-device'), 'supernote-cloud': engine('supernote-cloud'),
            }, state.store);
            coordinator.setAutoSyncMinutes(5);
            coordinator.setAutoSyncEnabled(true);
            await coordinator.setActiveEngine('supernote-cloud');
            expect(state.current().lastAutomaticAttemptAt).toEqual({
                'ip-device': '2026-10-15T12:00:00.000Z', 'supernote-cloud': '2026-10-15T12:00:00.000Z',
            });
            await coordinator.pollAutomatic(Date.now());
            expect(state.current().lastAutomaticAttemptAt['supernote-cloud']).toBe('2026-10-15T12:00:00.000Z');
            coordinator.setAutoSyncEnabled(false);
            expect(coordinator.getAutoSyncMinutes()).toBe(5);
            vi.setSystemTime(new Date('2026-10-15T13:00:00.000Z'));
            await coordinator.pollAutomatic();
            coordinator.setAutoSyncEnabled(true);
            expect(state.current().lastAutomaticAttemptAt['supernote-cloud']).toBe('2026-10-15T13:00:00.000Z');
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects zero, fractional, and imprecise intervals without changing the saved value', () => {
        const state = stateStore();
        const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': engine('ip-device') }, state.store);
        for (const minutes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
            expect(() => coordinator.setAutoSyncMinutes(minutes)).toThrow('Invalid automatic sync interval');
        }
        expect(state.current().autoSyncMinutes).toBe(15);
        coordinator.setAutoSyncMinutes(Number.MAX_SAFE_INTEGER);
        expect(state.current().autoSyncMinutes).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('runs only the selected engine and persists selection changes', async () => {
        const ip = createEngineHarness('ip-device');
        const cloud = createEngineHarness('supernote-cloud');
        const state = stateStore();
        const coordinator = new SingleEngineSyncCoordinator(
            { 'ip-device': ip.syncEngine, 'supernote-cloud': cloud.syncEngine },
            state.store,
        );

        await coordinator.setActiveEngine('supernote-cloud');
        const syncResult = await coordinator.runActive({ kind: 'manual', commandId: 'sync-now' });

        expect(state.current().activeSyncEngine).toBe('supernote-cloud');
        expect(cloud.run).toHaveBeenCalledOnce();
        expect(ip.run).not.toHaveBeenCalled();
        expect(syncResult?.engineId).toBe('supernote-cloud');
    });

    it('lists registered engines and looks them up without changing the active engine', () => {
        const ip = engine('ip-device');
        const cloud = engine('supernote-cloud');
        const coordinator = new SingleEngineSyncCoordinator(
            { 'ip-device': ip, 'supernote-cloud': cloud }, stateStore().store,
        );
        expect(coordinator.getSyncEngines()).toEqual([ip, cloud]);
        expect(coordinator.getSyncEngine('supernote-cloud')).toBe(cloud);
        expect(coordinator.getActiveEngine()).toBe(ip);
        expect(() => coordinator.getSyncEngine('missing' as SyncEngineId)).toThrow('Sync engine is unavailable: missing');
    });

    it('rejects an unready engine before dispatch', async () => {
        const ip = createEngineHarness('ip-device', false);
        const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': ip.syncEngine }, stateStore().store);

        await expect(coordinator.runActive({ kind: 'manual', commandId: 'test' }))
            .rejects.toThrow('ip-device is not configured');
        expect(ip.run).not.toHaveBeenCalled();
    });

    it('prevents overlapping runs and engine switches', async () => {
        let finishRun: ((value: SyncRunResult) => void) | undefined;
        const ip = engine('ip-device');
        ip.run = vi.fn(() => new Promise<SyncRunResult>((resolve) => { finishRun = resolve; }));
        const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': ip }, stateStore().store);

        const firstRun = coordinator.runActive({ kind: 'manual', commandId: 'first' });

        expect(coordinator.isRunning()).toBe(true);
        await expect(coordinator.runActive({ kind: 'manual', commandId: 'second' })).resolves.toBeNull();
        await expect(coordinator.setActiveEngine('ip-device')).rejects.toThrow('while a sync is running');

        finishRun?.(result('ip-device'));
        await firstRun;
        expect(coordinator.isRunning()).toBe(false);
    });

    it('clears history only on the active engine', async () => {
        const ip = createEngineHarness('ip-device');
        const cloud = createEngineHarness('supernote-cloud');
        const coordinator = new SingleEngineSyncCoordinator(
            { 'ip-device': ip.syncEngine, 'supernote-cloud': cloud.syncEngine },
            stateStore('supernote-cloud').store,
        );

        await coordinator.clearActiveHistory();

        expect(cloud.clearHistory).toHaveBeenCalledOnce();
        expect(ip.clearHistory).not.toHaveBeenCalled();
    });

    it.each(['ip-device', 'supernote-cloud'] as const)('clears shared history from %s without losing binding', async (active) => {
        const original = { version: 1 as const, cloudAccountFingerprint: 'v1:synthetic',
            records: { 'Mirror/file.note': { contentHash: 'hash', source: {
                engineId: 'ip-device' as const, deviceUri: '/file.note', deviceDate: '', deviceSize: 4,
            } } } };
        const loaded = { manifest: original, revision: 1, slot: 'primary' as const };
        const service = { load: vi.fn(async () => loaded), commit: vi.fn(async (_previous: LoadedMirrorManifest,
            manifest: SharedMirrorManifest) => ({
            manifest, revision: 2, slot: 'backup' as const,
        })) };
        const retire = vi.fn(async () => {});
        const coordinator = new SingleEngineSyncCoordinator({
            'ip-device': engine('ip-device'), 'supernote-cloud': engine('supernote-cloud'),
        }, stateStore(active).store, service, retire);

        await coordinator.clearActiveHistory();

        expect(service.commit).toHaveBeenCalledWith(loaded, {
            ...original, records: {}, legacyHistoryRetired: true,
        });
        expect(retire).toHaveBeenCalledOnce();
    });

    it('does not retire legacy settings when commit fails or an account change is pending', async () => {
        const loaded: LoadedMirrorManifest = { manifest: { version: 1, cloudAccountFingerprint: null, records: {} },
            revision: 1, slot: 'primary' };
        const service = { load: vi.fn(async () => loaded), commit: vi.fn(async () => { throw new Error('write failed'); }) };
        const retire = vi.fn(async () => {});
        const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': engine('ip-device') },
            stateStore().store, service, retire);
        await expect(coordinator.clearActiveHistory()).rejects.toThrow('write failed');
        expect(retire).not.toHaveBeenCalled();
        expect(coordinator.isRunning()).toBe(false);
        service.load.mockResolvedValue({ ...loaded, manifest: { ...loaded.manifest,
            accountChange: { targetFingerprint: `v1:${'a'.repeat(64)}`, pendingPath: null, protectedPaths: [] },
        } });
        await expect(coordinator.clearActiveHistory()).rejects.toThrow('Cloud account change');
        expect(service.commit).toHaveBeenCalledTimes(1);
    });

    it('falls back to IP when persisted state names an unavailable future engine', () => {
        const state = stateStore('supernote-cloud');
        const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': engine('ip-device') }, state.store);

        expect(coordinator.getActiveEngineId()).toBe('ip-device');
        expect(state.current().activeSyncEngine).toBe('ip-device');
    });
});

it('checks Cloud for a missing pending Trash even when IP last wrote the shared record', async () => {
    const path = 'Mirror/Note/Shared.note';
    const manifest: SharedMirrorManifest = {
        version: 1, cloudAccountFingerprint: 'v1:synthetic',
        records: { [path]: { contentHash: hashBytes(new TextEncoder().encode('old')), source: {
            engineId: 'ip-device', deviceUri: '/Shared.note', deviceDate: '', deviceSize: 3,
        } } },
        pendingOperation: { kind: 'trash', root: 'Mirror', path,
            beforeHash: hashBytes(new TextEncoder().encode('old')), after: null },
    };
    const service = { load: vi.fn(async () => ({ manifest, revision: 1, slot: 'primary' as const })),
        commit: vi.fn(async () => { throw new Error('should not retire while Cloud has the source'); }) };
    const ip = createEngineHarness('ip-device');
    const cloud = createEngineHarness('supernote-cloud');
    const ipInventory = vi.fn(async () => 'absent' as const);
    const cloudInventory = vi.fn(async () => 'present' as const);
    ip.syncEngine.checkPendingSource = ipInventory;
    cloud.syncEngine.checkPendingSource = cloudInventory;
    const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': ip.syncEngine,
        'supernote-cloud': cloud.syncEngine }, stateStore().store, service, async () => {}, undefined,
    { root: () => 'Mirror', read: async () => null, attention: async () => {} });
    await expect(coordinator.runActive({ kind: 'manual', commandId: 'sync-now' }))
        .rejects.toThrow('source inventory is unavailable or incomplete');
    expect(cloudInventory).toHaveBeenCalledOnce();
    expect(ipInventory).not.toHaveBeenCalled();
    expect(service.commit).not.toHaveBeenCalled();
});