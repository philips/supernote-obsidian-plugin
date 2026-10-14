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
    issues: SyncIssue[];
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
    autoSyncMinutes: number;
    lastAutomaticAttemptAt: Partial<Record<SyncEngineId, string>>;
    lastRunAt: Partial<Record<SyncEngineId, string>>;
    lastRunOutcome: Partial<Record<SyncEngineId, 'succeeded' | 'attention' | 'failed'>>;
}

export const DEFAULT_SYNC_EXECUTION_STATE: SyncExecutionState = {
    version: 1,
    activeSyncEngine: 'ip-device',
    autoSyncMinutes: 0,
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
        this.executionState = { ...this.executionState, activeSyncEngine: engineId };
        this.stateStore.save(this.executionState);
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