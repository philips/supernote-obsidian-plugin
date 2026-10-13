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
        const stored = this.app.loadLocalStorage(STORAGE_KEY) as Partial<SyncExecutionState> | null;
        if (stored?.version !== 1 || !isSyncEngineId(stored.activeSyncEngine)) {
            return { ...DEFAULT_SYNC_EXECUTION_STATE };
        }
        return {
            ...DEFAULT_SYNC_EXECUTION_STATE,
            ...stored,
            version: 1,
            activeSyncEngine: stored.activeSyncEngine,
        };
    }

    save(state: SyncExecutionState): void {
        this.app.saveLocalStorage(STORAGE_KEY, state);
    }
}