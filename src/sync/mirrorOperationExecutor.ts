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
    if (pending.kind === 'move') {
        let source: Uint8Array | null;
        let destination: Uint8Array | null;
        try {
            [source, destination] = await Promise.all([read(pending.path), read(pending.destination!)]);
        } catch {
            throw new MirrorRecoveryAttentionError(pending.path, 'move vault bytes cannot be read; inspect both paths');
        }
        const oldHash = source === null ? null : hashBytes(source);
        const newHash = destination === null ? null : hashBytes(destination);
        if (oldHash === pending.beforeHash && newHash === null) {
            const { pendingOperation: _pendingOperation, ...manifest } = loaded.manifest;
            try { await service.commit(loaded, manifest); } catch {
                throw new MirrorRecoveryAttentionError(pending.path, 'move reconciliation failed; retry when storage is available');
            }
            return;
        }
        if (oldHash !== null || newHash !== pending.after?.contentHash) {
            throw new MirrorRecoveryAttentionError(pending.path, 'move outcome is uncertain; inspect both paths before retrying');
        }
        const records = { ...loaded.manifest.records };
        delete records[pending.path];
        records[pending.destination!] = pending.after!;
        const { pendingOperation: _pendingOperation, ...manifest } = loaded.manifest;
        try { await service.commit(loaded, { ...manifest, records }); } catch {
            throw new MirrorRecoveryAttentionError(pending.path, 'move reconciliation failed; retry when storage is available');
        }
        return;
    }
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

    async move(path: string, destination: string, record: SharedMirrorRecord,
        renameFile: (path: string, destination: string) => Promise<void>): Promise<void> {
        if (this.manifest.pendingOperation) throw new Error('Pending mirror operation requires recovery');
        const previous = this.manifest.records[path];
        if (!path.startsWith(`${this.root}/`) || !destination.startsWith(`${this.root}/`)
            || path === destination || !previous || this.manifest.records[destination]
            || previous.source.engineId !== 'supernote-cloud' || record.source.engineId !== 'supernote-cloud'
            || !previous.source.fileId || previous.source.fileId !== record.source.fileId
            || previous.contentHash !== record.contentHash) throw new Error('Cloud move requires a unique managed identity');
        const source = await this.read(path);
        if (source === null || hashBytes(source) !== previous.contentHash || await this.read(destination) !== null) {
            throw new Error('Cloud move source changed or destination is occupied');
        }
        try {
            this.loaded = await this.service.commit(this.loaded, { ...this.manifest,
                pendingOperation: { kind: 'move', root: this.root, path, destination,
                    beforeHash: previous.contentHash, after: record },
            });
            const guarded = await this.read(path);
            if (guarded === null || hashBytes(guarded) !== previous.contentHash
                || await this.read(destination) !== null) throw new Error('Cloud move paths changed after intent commit');
            await renameFile(path, destination);
            const records = { ...this.manifest.records };
            delete records[path];
            records[destination] = record;
            const { pendingOperation: _pendingOperation, ...manifest } = this.manifest;
            this.loaded = await this.service.commit(this.loaded, { ...manifest, records });
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