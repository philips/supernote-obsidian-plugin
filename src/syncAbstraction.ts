export type SyncEngineId = 'ip-device' | 'supernote-cloud';

export type SyncTrigger =
    | { kind: 'manual'; commandId: string }
    | { kind: 'scheduled' };

export interface SyncReadiness {
    ready: boolean;
    reason?: string;
}

export interface SyncIssue {
    kind: 'protected' | 'failure' | 'warning';
    item?: string;
    message: string;
}

export interface SyncRunResult {
    engineId: SyncEngineId;
    synced: number;
    unchanged: number;
    excluded: number;
    removed: number;
    removedFolders?: number;
    issues: SyncIssue[];
}

export function formatSyncSummary(result: SyncRunResult): string {
    const protectedCount = result.issues.filter((issue) => issue.kind === 'protected').length;
    const failureCount = result.issues.filter((issue) => issue.kind === 'failure').length;
    const warningCount = result.issues.filter((issue) => issue.kind === 'warning').length;
    const cloud = result.engineId === 'supernote-cloud';
    const parts = [`${result.synced} ${cloud ? 'downloaded' : 'synced'}`, `${result.unchanged} unchanged`];
    if (cloud || result.excluded > 0) parts.push(`${result.excluded} out of scope`);
    if (cloud || result.removed > 0) parts.push(cloud
        ? `${result.removed} ${result.removed === 1 ? 'file' : 'files'} moved to Trash`
        : `${result.removed} removed`);
    if (cloud && result.removedFolders) parts.push(`${result.removedFolders} empty ${result.removedFolders === 1 ? 'folder' : 'folders'} moved to Trash`);
    if (cloud || protectedCount > 0) parts.push(`${protectedCount} skipped (locally edited)`);
    if (cloud || failureCount > 0) parts.push(`${failureCount} failed`);
    if (warningCount > 0) parts.push(`${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`);
    return `Supernote sync: ${parts.join(', ')}`;
}

export interface SyncEngine {
    readonly id: SyncEngineId;
    readonly name: string;
    getReadiness(): SyncReadiness;
    run(trigger: SyncTrigger): Promise<SyncRunResult>;
    clearHistory(): Promise<void>;
}

export interface SyncExecutionState {
    version: 1;
    activeSyncEngine: SyncEngineId;
    autoSyncEnabled: boolean;
    autoSyncMinutes: number;
    lastAutomaticAttemptAt: Partial<Record<SyncEngineId, string>>;
    lastRunAt: Partial<Record<SyncEngineId, string>>;
    lastRunOutcome: Partial<Record<SyncEngineId, 'succeeded' | 'attention' | 'failed'>>;
}

export const DEFAULT_SYNC_EXECUTION_STATE: SyncExecutionState = {
    version: 1,
    activeSyncEngine: 'ip-device',
    autoSyncEnabled: false,
    autoSyncMinutes: 15,
    lastAutomaticAttemptAt: {},
    lastRunAt: {},
    lastRunOutcome: {},
};

export interface SyncExecutionStateStore {
    load(): SyncExecutionState;
    save(state: SyncExecutionState): void;
}

export interface SyncCoordinator {
    getActiveEngine(): SyncEngine;
    getActiveEngineId(): SyncEngineId;
    setActiveEngine(engineId: SyncEngineId): Promise<void>;
    isAutoSyncEnabled(): boolean;
    setAutoSyncEnabled(enabled: boolean): void;
    getAutoSyncMinutes(): number;
    setAutoSyncMinutes(minutes: number): void;
    pollAutomatic(now?: number, onUnready?: (engineId: SyncEngineId, reason?: string) => void): Promise<SyncRunResult | null>;
    runActive(trigger: SyncTrigger): Promise<SyncRunResult | null>;
    isRunning(): boolean;
    clearActiveHistory(): Promise<void>;
}

export class SingleEngineSyncCoordinator implements SyncCoordinator {
    private running = false;
    private executionState: SyncExecutionState;

    constructor(
        private readonly engines: Partial<Record<SyncEngineId, SyncEngine>>,
        private readonly stateStore: SyncExecutionStateStore,
    ) {
        this.executionState = stateStore.load();
        if (!this.engines[this.executionState.activeSyncEngine]) {
            this.executionState = DEFAULT_SYNC_EXECUTION_STATE;
            this.stateStore.save(this.executionState);
        }
    }

    getActiveEngine(): SyncEngine {
        const engine = this.engines[this.executionState.activeSyncEngine];
        if (!engine) {
            throw new Error(`Sync engine is unavailable: ${this.executionState.activeSyncEngine}`);
        }
        return engine;
    }

    getActiveEngineId(): SyncEngineId {
        return this.executionState.activeSyncEngine;
    }

    async setActiveEngine(engineId: SyncEngineId): Promise<void> {
        if (this.running) {
            throw new Error('Cannot change sync engine while a sync is running');
        }
        if (!this.engines[engineId]) {
            throw new Error(`Unknown sync engine: ${engineId}`);
        }
        if (engineId === this.executionState.activeSyncEngine) return;
        this.executionState = { ...this.executionState, activeSyncEngine: engineId,
            lastAutomaticAttemptAt: { ...this.executionState.lastAutomaticAttemptAt, [engineId]: new Date().toISOString() } };
        this.stateStore.save(this.executionState);
    }

    isAutoSyncEnabled(): boolean {
        return this.executionState.autoSyncEnabled;
    }

    setAutoSyncEnabled(enabled: boolean): void {
        if (enabled === this.executionState.autoSyncEnabled) return;
        this.executionState = { ...this.executionState, autoSyncEnabled: enabled,
            lastAutomaticAttemptAt: enabled ? {
                ...this.executionState.lastAutomaticAttemptAt,
                [this.getActiveEngineId()]: new Date().toISOString(),
            } : this.executionState.lastAutomaticAttemptAt };
        this.stateStore.save(this.executionState);
    }

    getAutoSyncMinutes(): number {
        return this.executionState.autoSyncMinutes;
    }

    setAutoSyncMinutes(minutes: number): void {
        if (!Number.isSafeInteger(minutes) || minutes < 1) throw new Error('Invalid automatic sync interval');
        const changed = this.executionState.autoSyncMinutes !== minutes && this.executionState.autoSyncEnabled;
        this.executionState = { ...this.executionState, autoSyncMinutes: minutes,
            lastAutomaticAttemptAt: changed ? {
                ...this.executionState.lastAutomaticAttemptAt,
                [this.getActiveEngineId()]: new Date().toISOString(),
            } : this.executionState.lastAutomaticAttemptAt };
        this.stateStore.save(this.executionState);
    }

    async pollAutomatic(now = Date.now(), onUnready?: (engineId: SyncEngineId, reason?: string) => void): Promise<SyncRunResult | null> {
        const minutes = this.executionState.autoSyncMinutes;
        if (!this.executionState.autoSyncEnabled || !Number.isSafeInteger(minutes) || minutes < 1
            || !Number.isFinite(now) || this.running) return null;
        const engineId = this.getActiveEngineId();
        const timestamp = this.executionState.lastAutomaticAttemptAt[engineId];
        const previous = typeof timestamp === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp)
            ? Date.parse(timestamp) : NaN;
        if (!Number.isFinite(previous) || new Date(previous).toISOString() !== timestamp || previous > now) {
            this.executionState = { ...this.executionState, lastAutomaticAttemptAt: {
                ...this.executionState.lastAutomaticAttemptAt, [engineId]: new Date(now).toISOString(),
            } };
            this.stateStore.save(this.executionState);
            return null;
        }
        if (now - previous < minutes * 60_000) return null;
        const engine = this.getActiveEngine();
        this.executionState = { ...this.executionState, lastAutomaticAttemptAt: {
            ...this.executionState.lastAutomaticAttemptAt, [engineId]: new Date(now).toISOString(),
        } };
        this.stateStore.save(this.executionState);
        const readiness = engine.getReadiness();
        if (!readiness.ready) {
            onUnready?.(engineId, readiness.reason);
            return null;
        }
        return this.runActive({ kind: 'scheduled' });
    }

    async runActive(trigger: SyncTrigger): Promise<SyncRunResult | null> {
        if (this.running) return null;

        const engine = this.getActiveEngine();
        const readiness = engine.getReadiness();
        if (!readiness.ready) {
            throw new Error(readiness.reason ?? `${engine.name} is not ready`);
        }

        this.running = true;
        try {
            return await engine.run(trigger);
        } finally {
            this.running = false;
        }
    }

    isRunning(): boolean {
        return this.running;
    }

    async clearActiveHistory(): Promise<void> {
        if (this.running) {
            throw new Error('Cannot clear sync history while a sync is running');
        }
        await this.getActiveEngine().clearHistory();
    }
}