import { hashBytes } from './directIP/deviceSync';
import { PendingMirrorOperation, SharedMirrorRecord } from './sharedMirrorManifest';
import { LoadedMirrorManifest, MirrorManifestService } from './sharedMirrorManifestStore';

export class MirrorOperationError extends Error {
    constructor(cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause));
    }
}

export class MirrorRecoveryAttentionError extends Error {
    constructor(readonly path: string, detail: string) {
        super(`Mirror recovery for ${path}: ${detail}`);
    }
}

export async function recoverMirrorOperation(service: MirrorManifestService, loaded: LoadedMirrorManifest,
    root: string, read: (path: string) => Promise<Uint8Array | null>,
    checkSource?: (pending: PendingMirrorOperation) => Promise<'present' | 'absent'>): Promise<void> {
    const pending = loaded.manifest.pendingOperation;
    if (!pending) return;
    if (pending.root !== root) throw new MirrorRecoveryAttentionError(pending.path,
        'sync root changed; restore the original root before retrying');
    let current: Uint8Array | null;
    try { current = await read(pending.path); } catch {
        throw new MirrorRecoveryAttentionError(pending.path, 'vault bytes cannot be read; inspect the file and retry manually');
    }
    const hash = current === null ? null : hashBytes(current);
    let record: SharedMirrorRecord | null | undefined;
    if (pending.kind === 'write' && hash === pending.after?.contentHash) record = pending.after;
    else if (pending.kind === 'write' && hash !== null && hash === pending.beforeHash) {
        record = loaded.manifest.records[pending.path] ?? null;
    } else if (hash === null) {
        if (!checkSource) throw new MirrorRecoveryAttentionError(pending.path,
            `${pending.kind} left the vault file missing; run a manual sync with a complete source inventory`);
        try { await checkSource(pending); } catch {
            throw new MirrorRecoveryAttentionError(pending.path,
                `${pending.kind} left the vault file missing; source inventory is unavailable or incomplete; retry manual sync when connected`);
        }
        record = null;
    } else {
        throw new MirrorRecoveryAttentionError(pending.path,
            pending.kind === 'trash' ? `Trash outcome is uncertain (vault hash ${hash}); move this file out of the sync folder to keep a backup, then run a manual sync`
                : `vault hash ${hash} does not match the old or new version; move this file out of the sync folder to keep a backup, then run a manual sync`);
    }
    const records = { ...loaded.manifest.records };
    if (record) records[pending.path] = record;
    else delete records[pending.path];
    const { pendingOperation: _pendingOperation, ...manifest } = loaded.manifest;
    try { await service.commit(loaded, { ...manifest, records }); } catch {
        throw new MirrorRecoveryAttentionError(pending.path,
            'manifest reconciliation failed; retry manual sync when storage is available');
    }
}

export class MirrorOperationExecutor {
    constructor(
        private readonly service: MirrorManifestService,
        private readonly root: string,
        private loaded: LoadedMirrorManifest,
        private readonly read: (path: string) => Promise<Uint8Array | null>,
    ) {}

    get manifest() { return this.loaded.manifest; }

    async write(path: string, bytes: Uint8Array, record: SharedMirrorRecord,
        writeBytes: (path: string, bytes: Uint8Array) => Promise<void>): Promise<void> {
        if (this.manifest.pendingOperation) throw new Error('Pending mirror operation requires recovery');
        if (!path.startsWith(`${this.root}/`) || hashBytes(bytes) !== record.contentHash) {
            throw new Error('Mirror operation path or bytes do not match the record');
        }
        const current = await this.read(path);
        const beforeHash = current === null ? null : hashBytes(current);
        const previous = this.manifest.records[path];
        if (beforeHash !== null && beforeHash !== record.contentHash
            && beforeHash !== previous?.contentHash) throw new Error(`Vault copy was edited locally: ${path}`);
        try {
            this.loaded = await this.service.commit(this.loaded, {
                ...this.manifest,
                pendingOperation: { kind: 'write', root: this.root, path, beforeHash, after: record },
            });
            const guarded = await this.read(path);
            if ((guarded === null ? null : hashBytes(guarded)) !== beforeHash) {
                throw new Error(`Vault copy changed after intent commit: ${path}`);
            }
            if (beforeHash !== record.contentHash) await writeBytes(path, bytes);
            await this.finish(path, record);
        } catch (error) { throw new MirrorOperationError(error); }
    }

    async trash(path: string, trashFile: (path: string) => Promise<void>): Promise<void> {
        if (this.manifest.pendingOperation) throw new Error('Pending mirror operation requires recovery');
        const record = this.manifest.records[path];
        if (!path.startsWith(`${this.root}/`) || !record) {
            throw new Error('Cloud Trash requires a managed path');
        }
        const bytes = await this.read(path);
        if (bytes === null || hashBytes(bytes) !== record.contentHash) throw new Error(`Vault copy changed: ${path}`);
        try {
            this.loaded = await this.service.commit(this.loaded, {
                ...this.manifest,
                pendingOperation: { kind: 'trash', root: this.root, path, beforeHash: record.contentHash, after: null },
            });
            const guarded = await this.read(path);
            if (guarded === null || hashBytes(guarded) !== record.contentHash) {
                throw new Error(`Vault copy changed after intent commit: ${path}`);
            }
            await trashFile(path);
            await this.finish(path, null);
        } catch (error) { throw new MirrorOperationError(error); }
    }

    async retire(path: string): Promise<void> {
        if (this.manifest.pendingOperation) throw new Error('Pending mirror operation requires recovery');
        await this.finish(path, null);
    }

    private async finish(path: string, record: SharedMirrorRecord | null): Promise<void> {
        const records = { ...this.manifest.records };
        if (record) records[path] = record;
        else delete records[path];
        const { pendingOperation: _pendingOperation, ...manifest } = this.manifest;
        this.loaded = await this.service.commit(this.loaded, { ...manifest, records });
    }
}