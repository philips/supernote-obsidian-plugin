import { describe, expect, it, vi } from 'vitest';
import {
    SingleEngineSyncCoordinator,
    SyncEngine,
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
        autoSyncMinutes: 0,
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

describe('SingleEngineSyncCoordinator', () => {
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

    it('falls back to IP when persisted state names an unavailable future engine', () => {
        const state = stateStore('supernote-cloud');
        const coordinator = new SingleEngineSyncCoordinator({ 'ip-device': engine('ip-device') }, state.store);

        expect(coordinator.getActiveEngineId()).toBe('ip-device');
        expect(state.current().activeSyncEngine).toBe('ip-device');
    });
});