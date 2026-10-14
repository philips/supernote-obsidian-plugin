import type { App } from 'obsidian';
import {
    DEFAULT_SYNC_EXECUTION_STATE,
    SyncEngineId,
    SyncExecutionState,
    SyncExecutionStateStore,
} from './syncAbstraction';

const STORAGE_KEY = 'supernote-sync-execution-state';

function isSyncEngineId(value: unknown): value is SyncEngineId {
    return value === 'ip-device' || value === 'supernote-cloud';
}

export class ObsidianSyncExecutionStateStore implements SyncExecutionStateStore {
    constructor(private readonly app: App) {}

    load(): SyncExecutionState {
        const stored = this.app.loadLocalStorage(STORAGE_KEY) as (Partial<SyncExecutionState> & {
            cloudSessionToken?: unknown;
            cloudAccountId?: unknown;
        }) | null;
        if (stored?.version !== 1 || !isSyncEngineId(stored.activeSyncEngine)) {
            return { ...DEFAULT_SYNC_EXECUTION_STATE };
        }
        const state: SyncExecutionState = {
            ...DEFAULT_SYNC_EXECUTION_STATE,
            activeSyncEngine: stored.activeSyncEngine,
            autoSyncMinutes: stored.autoSyncMinutes ?? 0,
            lastAutomaticAttemptAt: stored.lastAutomaticAttemptAt ?? {},
            lastRunAt: stored.lastRunAt ?? {},
            lastRunOutcome: stored.lastRunOutcome ?? {},
        };
        if (Object.hasOwn(stored, 'cloudSessionToken') || Object.hasOwn(stored, 'cloudAccountId')) {
            this.save(state);
        }
        return state;
    }

    save(state: SyncExecutionState): void {
        this.app.saveLocalStorage(STORAGE_KEY, {
            version: 1,
            activeSyncEngine: state.activeSyncEngine,
            autoSyncMinutes: state.autoSyncMinutes,
            lastAutomaticAttemptAt: state.lastAutomaticAttemptAt,
            lastRunAt: state.lastRunAt,
            lastRunOutcome: state.lastRunOutcome,
        });
    }
}