import { App, TFile } from 'obsidian';
import { hashBytes } from './sync/directIP/deviceSync';
import { markdownExportDestination, validateMarkdownExportMappings } from './settings';
import type { MarkdownExportMapping, MarkdownExportRecord, SupernotePluginSettings } from './settings';

const hash = (content: string): string => hashBytes(new TextEncoder().encode(content));

class ExportConflictError extends Error {}

export class AutomaticMarkdownExport {
    private readonly timers = new Map<string, ReturnType<typeof window.setTimeout>>();
    private readonly versions = new Map<string, number>();
    private readonly reported = new Set<string>();
    private readonly renamedPaths = new Map<string, string>();
    private queue: Promise<void> = Promise.resolve();
    private stopped = false;
    private config: string;
    private configVersion = 0;

    constructor(private readonly app: App, private readonly settings: SupernotePluginSettings,
        private readonly save: () => Promise<void>, private readonly convert: (file: TFile, path: string, bytes: ArrayBuffer) => Promise<string>,
        private readonly report: (source: string, destination: string, reason: string) => void) {
        this.config = this.configuration();
    }

    private configuration(): string {
        return JSON.stringify([this.settings.automaticMarkdownExportEnabled, this.settings.markdownExportMappings]);
    }

    settingsChanged(): void {
        const next = this.configuration();
        if (this.config === next) return;
        this.config = next;
        this.configVersion++;
        for (const source of this.versions.keys()) this.invalidate(source);
        this.reported.clear();
    }

    stop(): void {
        this.stopped = true;
        for (const source of this.versions.keys()) this.invalidate(source);
    }

    private invalidate(source: string): void {
        window.clearTimeout(this.timers.get(source));
        this.timers.delete(source);
        this.versions.set(source, (this.versions.get(source) ?? 0) + 1);
    }

    private mapping(source: string): MarkdownExportMapping | undefined {
        if (!this.settings.automaticMarkdownExportEnabled || validateMarkdownExportMappings(this.settings.markdownExportMappings, this.app)) return;
        return this.settings.markdownExportMappings.find((pair) => pair.enabled &&
            (!pair.watchDir || source.startsWith(`${pair.watchDir}/`)));
    }

    private enqueue(job: () => Promise<void>): void {
        this.queue = this.queue.then(job).catch((error: unknown) => {
            console.error('Automatic Markdown export failed:', error);
        });
    }

    schedule(file: TFile): void {
        if (this.stopped || file.extension.toLowerCase() !== 'note') return;
        this.settingsChanged();
        this.invalidate(file.path);
        const pair = this.mapping(file.path);
        if (!pair) return;
        const version = this.versions.get(file.path);
        const config = this.config;
        this.timers.set(file.path, window.setTimeout(() => {
            this.timers.delete(file.path);
            this.enqueue(() => this.refresh(file.path, version, config));
        }, 250));
    }

    private current(source: string, version: number | undefined, config: string): boolean {
        return !this.stopped && this.configuration() === config && this.versions.get(source) === version && !!this.mapping(source);
    }

    private issue(source: string, destination: string, reason: string): void {
        const key = `${source}:${destination}:${reason}`;
        if (this.reported.has(key)) return;
        this.reported.add(key);
        this.report(source, destination, reason);
    }

    private async persist(): Promise<void> {
        await this.save();
    }

    private async ensureParent(path: string): Promise<void> {
        const parts = path.split('/').slice(0, -1);
        for (let index = 1; index <= parts.length; index++) {
            const parent = parts.slice(0, index).join('/');
            if (!this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
        }
    }

    private async refresh(source: string, version: number | undefined, config: string): Promise<void> {
        if (!this.current(source, version, config)) return;
        if (this.settings.markdownExportPendingMove?.to.source === source) return;
        const pair = this.mapping(source)!;
        const destination = markdownExportDestination(pair, source);
        if (this.settings.markdownExportBlockedSources?.[source] === destination) return;
        const file = this.app.vault.getFileByPath(source);
        if (!file) return;
        try {
            const original = new Uint8Array(await this.app.vault.readBinary(file));
            const content = await this.convert(file, destination, original.buffer);
            if (!this.current(source, version, config) || this.app.vault.getFileByPath(source) !== file) return;
            if (hashBytes(new Uint8Array(await this.app.vault.readBinary(file))) !== hashBytes(original)) {
                this.schedule(file);
                return;
            }
            if (!this.current(source, version, config)) return;
            const records = this.settings.markdownExportRecords ??= {};
            const previous = records[destination];
            const existing = this.app.vault.getAbstractFileByPath(destination);
            if (existing) {
                if (!(existing instanceof TFile) || !previous || previous.source !== source ||
                    previous.mappingId !== pair.id || previous.destination !== destination ||
                    hash(await this.app.vault.read(existing)) !== previous.hash) {
                    this.issue(source, destination, 'Destination is unmanaged or locally edited');
                    return;
                }
                if (!this.current(source, version, config)) return;
                if (hash(content) !== previous.hash) {
                    await this.app.vault.process(existing, (current) => {
                        if (hash(current) !== previous.hash || !this.current(source, version, config)) {
                            throw new ExportConflictError('Destination changed during export');
                        }
                        return content;
                    });
                }
            } else {
                if (previous) {
                    this.issue(source, destination, 'Managed destination is missing');
                    return;
                }
                await this.ensureParent(destination);
                if (!this.current(source, version, config)) return;
                await this.app.vault.create(destination, content);
            }
            records[destination] = { mappingId: pair.id, source, destination, hash: hash(content) };
            try {
                await this.persist();
            } catch (error) {
                if (previous) records[destination] = previous;
                else delete records[destination];
                throw error;
            }
            this.reported.delete(`${source}:${destination}:Destination is unmanaged or locally edited`);
        } catch (error) {
            this.issue(source, destination, error instanceof Error ? error.message : String(error));
        }
    }

    rename(file: TFile, oldPath: string): void {
        if (this.stopped || !/\.note$/i.test(oldPath)) return;
        this.settingsChanged();
        this.renamedPaths.set(oldPath, file.path);
        this.invalidate(oldPath);
        this.invalidate(file.path);
        if (file.extension.toLowerCase() !== 'note') return;
        const config = this.config;
        const configVersion = this.configVersion;
        const latestPath = () => {
            let path = this.renamedPaths.get(oldPath) ?? file.path;
            const seen = new Set<string>();
            while (this.renamedPaths.has(path) && !seen.has(path)) {
                seen.add(path);
                path = this.renamedPaths.get(path)!;
            }
            return path;
        };
        const renameCurrent = () => !this.stopped && this.configuration() === config &&
            this.configVersion === configVersion && file.path === latestPath() &&
            this.app.vault.getFileByPath(file.path) === file && !!this.mapping(file.path);
        this.enqueue(async () => {
            if (!renameCurrent()) return;
            const pair = this.mapping(file.path)!;
            if (this.settings.markdownExportBlockedSources?.[oldPath]) {
                const destination = markdownExportDestination(pair, file.path);
                await this.block(file.path, destination);
                this.issue(file.path, destination, 'Earlier rename conflict needs review');
                return;
            }
            const oldRecord = Object.values(this.settings.markdownExportRecords ?? {}).find((record) => record.source === oldPath);
            const oldPair = this.mapping(oldPath);
            if (oldRecord && oldPair?.id !== oldRecord.mappingId) {
                const destination = markdownExportDestination(pair, file.path);
                await this.block(file.path, destination);
                this.issue(file.path, destination, 'Previous managed export belongs to a different pair');
                return;
            }
            if (!oldRecord && oldPair) {
                const oldDestination = markdownExportDestination(oldPair, oldPath);
                if (this.app.vault.getAbstractFileByPath(oldDestination)) {
                    const destination = markdownExportDestination(pair, file.path);
                    await this.block(file.path, destination);
                    this.issue(file.path, destination, `Rename blocked by unmanaged old destination: ${oldDestination}`);
                    return;
                }
            }
            if (oldRecord && this.mapping(oldPath)?.id === oldRecord.mappingId) {
                const destination = markdownExportDestination(pair, file.path);
                if (destination === oldRecord.destination) {
                    const existing = this.app.vault.getFileByPath(destination);
                    if (!existing || hash(await this.app.vault.read(existing)) !== oldRecord.hash) {
                        await this.block(file.path, destination);
                        this.issue(file.path, destination, 'Rename blocked by edited or missing destination');
                        return;
                    }
                    this.settings.markdownExportRecords[destination] = { ...oldRecord, mappingId: pair.id, source: file.path };
                    try { await this.persist(); } catch (error) {
                        this.settings.markdownExportRecords[destination] = oldRecord;
                        this.issue(file.path, destination, error instanceof Error ? error.message : String(error));
                        return;
                    }
                } else {
                    try {
                        const oldFile = this.app.vault.getFileByPath(oldRecord.destination);
                        if (!oldFile || hash(await this.app.vault.read(oldFile)) !== oldRecord.hash ||
                            this.app.vault.getAbstractFileByPath(destination)) {
                            await this.block(file.path, destination);
                            this.issue(file.path, destination, 'Rename blocked by edited, missing, or occupied destination');
                            return;
                        }
                        if (!renameCurrent()) return;
                        const next: MarkdownExportRecord = { ...oldRecord, mappingId: pair.id, source: file.path, destination };
                        this.settings.markdownExportPendingMove = { from: oldRecord, to: next };
                        try {
                            await this.persist();
                        } catch (error) {
                            this.settings.markdownExportPendingMove = null;
                            throw error;
                        }
                        if (!renameCurrent()) {
                            await this.recover(false);
                            return;
                        }
                        await this.ensureParent(destination);
                        if (!renameCurrent() || this.app.vault.getAbstractFileByPath(destination) ||
                            hash(await this.app.vault.read(oldFile)) !== oldRecord.hash) {
                            await this.recover(renameCurrent());
                            this.issue(file.path, destination, 'Rename changed during move; review the destinations');
                            return;
                        }
                        await this.app.vault.rename(oldFile, destination);
                        delete this.settings.markdownExportRecords[oldRecord.destination];
                        this.settings.markdownExportRecords[destination] = next;
                        await this.persist();
                        this.settings.markdownExportPendingMove = null;
                        await this.persist();
                    } catch (error) {
                        if (this.settings.markdownExportPendingMove) {
                            try { await this.recover(); } catch (recoveryError) {
                                console.error('Automatic Markdown rename recovery failed:', recoveryError);
                            }
                        }
                        await this.block(file.path, destination);
                        this.issue(file.path, destination, error instanceof Error ? error.message : String(error));
                        return;
                    }
                }
            }
            if (renameCurrent()) this.schedule(file);
        });
    }

    private async block(source: string, destination: string): Promise<void> {
        this.settings.markdownExportBlockedSources ??= {};
        this.settings.markdownExportBlockedSources[source] = destination;
        try {
            await this.persist();
        } catch (error) {
            this.issue(source, destination, `Could not save export conflict: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async recover(retryMove = true): Promise<void> {
        const pending = this.settings.markdownExportPendingMove;
        if (!pending) return;
        const moved = this.app.vault.getFileByPath(pending.to.destination);
        const original = this.app.vault.getFileByPath(pending.from.destination);
        let needsRefresh = false;
        if (moved && !original && hash(await this.app.vault.read(moved)) === pending.from.hash) {
            this.settings.markdownExportRecords ??= {};
            delete this.settings.markdownExportRecords[pending.from.destination];
            this.settings.markdownExportRecords[pending.to.destination] = pending.to;
            await this.persist();
            needsRefresh = true;
        } else if (original && !moved && hash(await this.app.vault.read(original)) === pending.from.hash) {
            if (!retryMove) {
                this.settings.markdownExportPendingMove = null;
                await this.persist();
                return;
            }
            try {
                await this.ensureParent(pending.to.destination);
                if (this.app.vault.getAbstractFileByPath(pending.to.destination) ||
                    hash(await this.app.vault.read(original)) !== pending.from.hash) throw new Error('Destination changed during recovery');
                await this.app.vault.rename(original, pending.to.destination);
                this.settings.markdownExportRecords ??= {};
                delete this.settings.markdownExportRecords[pending.from.destination];
                this.settings.markdownExportRecords[pending.to.destination] = pending.to;
                await this.persist();
                needsRefresh = true;
            } catch (error) {
                await this.block(pending.to.source, pending.to.destination);
                this.issue(pending.to.source, pending.to.destination,
                    `Interrupted rename needs review: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
        } else {
            await this.block(pending.to.source, pending.to.destination);
            this.issue(pending.to.source, pending.to.destination, 'Interrupted rename needs review');
            return;
        }
        this.settings.markdownExportPendingMove = null;
        if (needsRefresh && this.settings.markdownExportBlockedSources) {
            delete this.settings.markdownExportBlockedSources[pending.to.source];
        }
        await this.persist();
        if (needsRefresh) {
            const source = this.app.vault.getFileByPath(pending.to.source);
            if (source) this.schedule(source);
        }
    }
}