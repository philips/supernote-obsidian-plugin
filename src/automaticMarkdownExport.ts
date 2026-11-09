import { App, TFile } from 'obsidian';
import { hashBytes } from './sync/directIP/deviceSync';
import { markdownExportDestination, validateMarkdownExportMappings } from './settings';
import type { MarkdownExportMapping, MarkdownExportRecord, NoteConversion, SupernotePluginSettings } from './settings';
import { retainSyncLogEntries } from './sync/syncReporting';

const hash = (content: string): string => hashBytes(new TextEncoder().encode(content));

function renamedContentHash(content: string, from: MarkdownExportRecord, to: MarkdownExportRecord): string | undefined {
    const currentHash = hash(content);
    if (currentHash === from.hash) return currentHash;
    const oldParts = from.source.split('/');
    const newParts = to.source.split('/');
    let original = content;
    for (let count = Math.min(oldParts.length, newParts.length); count > 0; count--) {
        const oldSuffix = oldParts.slice(-count).join('/');
        const newSuffix = newParts.slice(-count).join('/');
        if (newSuffix !== oldSuffix) original = original.replaceAll(newSuffix, oldSuffix);
    }
    return original !== content && hash(original) === from.hash ? currentHash : undefined;
}

class ExportConflictError extends Error {}

export interface AutomaticMarkdownAttachment {
    path: string;
    content: ArrayBuffer;
}

export interface AutomaticMarkdownResult {
    content: string;
    attachments: AutomaticMarkdownAttachment[];
}

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
        private readonly save: () => Promise<void>, private readonly convert: (file: TFile, path: string, bytes: ArrayBuffer, format: NoteConversion) => Promise<string | AutomaticMarkdownResult>,
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
        if (!this.settings.automaticMarkdownExportEnabled) return;
        const invalid = validateMarkdownExportMappings(this.settings.markdownExportMappings, this.app);
        if (invalid) {
            const reason = `Invalid automatic Markdown export settings: ${invalid}`;
            const key = `${file.path}:${reason}`;
            if (!this.reported.has(key)) {
                this.reported.add(key);
                this.report(file.path, file.path, reason);
            }
            return;
        }
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
        if (this.settings.markdownExportErrorLogEnabled) {
            void this.writeErrorLog(source, destination, reason).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                this.report(source, destination, `Could not write Markdown export log: ${message}`);
            });
        }
    }

    private async writeErrorLog(source: string, destination: string, reason: string): Promise<void> {
        const pair = this.mapping(source);
        if (!pair) throw new Error('No enabled mapping for source');
        const path = pair.outputDir ? `${pair.outputDir}/Markdown Export Log.md` : 'Markdown Export Log.md';
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const entry = `## ${timestamp} (Markdown export)\n- Mapping: ${pair.name ?? pair.id} (${pair.id})\n- Source: ${source}\n- Destination: ${destination}\n- Reason: ${reason}\n- Resolution: Review the destination and use Resume automatic export for this file after resolving the conflict.\n\n`;
        await this.ensureParent(path);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing && (!(existing instanceof TFile) || existing.extension.toLowerCase() !== 'md')) {
            throw new Error(`Log path is occupied: ${path}`);
        }
        if (existing) {
            await this.app.vault.process(existing, (current) => {
                if (!/^## \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \(Markdown export\)/.test(current)) {
                    throw new Error(`Log path is occupied: ${path}`);
                }
                return retainSyncLogEntries(entry + current, 8);
            });
        } else {
            await this.app.vault.create(path, entry);
        }
    }

    private async persist(): Promise<void> {
        await this.save();
    }

    missingExportCandidate(source: string): { mapping: string; source: string; destination: string } | undefined {
        const file = this.app.vault.getFileByPath(source);
        const pair = this.mapping(source);
        if (this.stopped || !file || file.extension.toLowerCase() !== 'note' || !pair) return;
        const destination = markdownExportDestination(pair, source);
        const pending = this.settings.markdownExportPendingMove;
        const related = pending && (pending.from.source === source || pending.to.source === source) ? pending : null;
        if (related) {
            const otherSource = related.from.source === source ? related.to.source : related.from.source;
            if (otherSource !== source && this.app.vault.getAbstractFileByPath(otherSource)) return;
        }
        const destinations = new Set([destination]);
        if (related) {
            destinations.add(related.from.destination);
            destinations.add(related.to.destination);
        }
        for (const path of [source, related?.from.source, related?.to.source]) {
            if (path && this.settings.markdownExportBlockedSources?.[path] &&
                !destinations.has(this.settings.markdownExportBlockedSources[path])) return;
        }
        for (const path of destinations) {
            if (this.app.vault.getAbstractFileByPath(path)) return;
            const record = this.settings.markdownExportRecords?.[path];
            if (record && (record.destination !== path || record.mappingId !== pair.id ||
                (record.source !== source && record.source !== related?.from.source && record.source !== related?.to.source) ||
                Object.keys(record.attachments ?? {}).length)) return;
        }
        if (related && (Object.keys(related.from.attachments ?? {}).length || Object.keys(related.to.attachments ?? {}).length)) return;
        if (!related && !destinations.has(this.settings.markdownExportBlockedSources?.[source]) &&
            !this.settings.markdownExportRecords?.[destination]) return;
        return { mapping: pair.name ?? pair.id, source, destination };
    }

    async restartMissingExport(source: string): Promise<void> {
        await this.queue;
        const candidate = this.missingExportCandidate(source);
        if (!candidate) throw new Error('The source, mapping, or missing export state changed; review it again');
        const pending = this.settings.markdownExportPendingMove;
        const related = pending && (pending.from.source === source || pending.to.source === source) ? pending : null;
        const records = this.settings.markdownExportRecords;
        const blocked = this.settings.markdownExportBlockedSources;
        const previousRecords = { ...records };
        const previousBlocked = { ...blocked };
        delete records[candidate.destination];
        delete blocked[source];
        if (related) {
            delete records[related.from.destination];
            delete records[related.to.destination];
            const otherSource = related.from.source === source ? related.to.source : related.from.source;
            if (otherSource !== source) delete blocked[otherSource];
            this.settings.markdownExportPendingMove = null;
        }
        try {
            await this.persist();
        } catch (error) {
            this.settings.markdownExportRecords = previousRecords;
            this.settings.markdownExportBlockedSources = previousBlocked;
            this.settings.markdownExportPendingMove = pending;
            throw error;
        }
        const file = this.app.vault.getFileByPath(source);
        if (file) this.schedule(file);
    }

    resumeCandidate(destination: string): { mapping: string; source: string; destination: string } | undefined {
        if (this.stopped) return;
        const matches = this.app.vault.getFiles().filter((file) => file.extension.toLowerCase() === 'note' &&
            this.mapping(file.path) && markdownExportDestination(this.mapping(file.path)!, file.path) === destination);
        if (matches.length !== 1 || !(this.app.vault.getAbstractFileByPath(destination) instanceof TFile)) return;
        const source = matches[0].path;
        const pair = this.mapping(source)!;
        return { mapping: pair.name ?? pair.id, source, destination };
    }

    async resume(destination: string): Promise<void> {
        await this.queue;
        const candidate = this.resumeCandidate(destination);
        if (!candidate) throw new Error('The source, mapping, or destination changed; review the conflict again');
        const pair = this.mapping(candidate.source)!;
        const file = this.app.vault.getFileByPath(destination);
        if (!file) throw new Error('The destination no longer exists');
        const previous = this.settings.markdownExportRecords[destination];
        const blocked = this.settings.markdownExportBlockedSources?.[candidate.source];
        const pending = this.settings.markdownExportPendingMove;
        if (pending?.to.source === candidate.source && pending.to.destination === destination &&
            this.app.vault.getAbstractFileByPath(pending.from.destination)) {
            throw new Error('The original Markdown export still exists; review and resolve the pending move before resuming at this destination');
        }
        const content = await this.app.vault.read(file);
        const sourceFile = this.app.vault.getFileByPath(candidate.source);
        if (!sourceFile) throw new Error('The source no longer exists');
        const sourceHash = hashBytes(new Uint8Array(await this.app.vault.readBinary(sourceFile)));
        const attachments: Record<string, string> = {};
        for (const path of Object.keys(previous?.attachments ?? {})) {
            const image = this.app.vault.getFileByPath(path);
            if (!image) throw new Error(`Page attachment is missing: ${path}; review the export before resuming`);
            attachments[path] = hashBytes(new Uint8Array(await this.app.vault.readBinary(image)));
        }
        if (!this.resumeCandidate(destination) || this.app.vault.getFileByPath(destination) !== file) {
            throw new Error('The destination changed; review the conflict again');
        }
        this.settings.markdownExportRecords[destination] = {
            mappingId: pair.id, source: candidate.source, destination, hash: hash(content), sourceHash, attachments,
        };
        if (blocked === destination) delete this.settings.markdownExportBlockedSources[candidate.source];
        if (pending?.to.source === candidate.source && pending.to.destination === destination) {
            this.settings.markdownExportPendingMove = null;
        }
        try {
            await this.persist();
        } catch (error) {
            if (previous) this.settings.markdownExportRecords[destination] = previous;
            else delete this.settings.markdownExportRecords[destination];
            if (blocked) this.settings.markdownExportBlockedSources[candidate.source] = blocked;
            this.settings.markdownExportPendingMove = pending;
            throw error;
        }
        this.invalidate(candidate.source);
        for (const key of this.reported) {
            if (key.startsWith(`${candidate.source}:${destination}:`)) this.reported.delete(key);
        }
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
            const previousRecord = this.settings.markdownExportRecords?.[destination];
            if (previousRecord?.mappingId === pair.id && previousRecord.source === source &&
                previousRecord.sourceHash === hashBytes(original)) {
                const existing = this.app.vault.getFileByPath(destination);
                if (!existing || hash(await this.app.vault.read(existing)) !== previousRecord.hash) {
                    this.issue(source, destination, 'Destination is missing or locally edited');
                }
                for (const [path, expected] of Object.entries(previousRecord.attachments ?? {})) {
                    const image = this.app.vault.getFileByPath(path);
                    if (!image || hashBytes(new Uint8Array(await this.app.vault.readBinary(image))) !== expected) {
                        this.issue(source, destination, `Page attachment is missing or locally edited: ${path}`);
                    }
                }
                return;
            }
            const converted = await this.convert(file, destination, original.buffer, pair.noteConversion ?? 'markdown');
            const { content, attachments } = typeof converted === 'string'
                ? { content: converted, attachments: [] } : converted;
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
            } else {
                if (previous) {
                    this.issue(source, destination, 'Managed destination is missing');
                    return;
                }
            }
            const nextAttachments: Record<string, string> = {};
            for (const attachment of attachments) {
                if (nextAttachments[attachment.path] || attachment.path === destination) throw new ExportConflictError('Duplicate page attachment path');
                nextAttachments[attachment.path] = hashBytes(new Uint8Array(attachment.content));
                const image = this.app.vault.getAbstractFileByPath(attachment.path);
                if (image && (!(image instanceof TFile) || previous?.attachments?.[attachment.path] !==
                    hashBytes(new Uint8Array(await this.app.vault.readBinary(image))))) {
                    this.issue(source, destination, `Page attachment is unmanaged or locally edited: ${attachment.path}`);
                    return;
                }
                if (!image && previous?.attachments?.[attachment.path]) {
                    this.issue(source, destination, `Managed page attachment is missing: ${attachment.path}`);
                    return;
                }
            }
            if (previous && Object.keys(previous.attachments ?? {}).some((path) => !nextAttachments[path])) {
                this.issue(source, destination, 'Page count or conversion format changed; review old attachments');
                return;
            }
            if (!this.current(source, version, config)) return;
            for (const attachment of attachments) {
                if (!this.current(source, version, config)) return;
                const image = this.app.vault.getFileByPath(attachment.path);
                if (image) {
                    if (nextAttachments[attachment.path] !== previous?.attachments?.[attachment.path]) {
                        const expected = previous?.attachments?.[attachment.path];
                        if (!expected) throw new ExportConflictError(`Page attachment is unmanaged: ${attachment.path}`);
                        if (hashBytes(new Uint8Array(await this.app.vault.readBinary(image))) !== expected) {
                            throw new ExportConflictError(`Page attachment changed during export: ${attachment.path}`);
                        }
                        await this.app.vault.modifyBinary(image, attachment.content);
                    }
                } else {
                    await this.ensureParent(attachment.path);
                    await this.app.vault.createBinary(attachment.path, attachment.content);
                }
            }
            if (existing instanceof TFile) {
                if (hash(content) !== previous?.hash) {
                    await this.app.vault.process(existing, (current) => {
                        if (hash(current) !== previous?.hash || !this.current(source, version, config)) {
                            throw new ExportConflictError('Destination changed during export');
                        }
                        return content;
                    });
                }
            } else {
                await this.ensureParent(destination);
                if (!this.current(source, version, config)) return;
                await this.app.vault.create(destination, content);
            }
            records[destination] = { mappingId: pair.id, source, destination, hash: hash(content), attachments: nextAttachments };
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
            if (oldRecord && Object.keys(oldRecord.attachments ?? {}).length) {
                const destination = markdownExportDestination(pair, file.path);
                await this.block(file.path, destination);
                this.issue(file.path, destination, 'Rename of an export with page attachments needs review; original files were left untouched');
                return;
            }
            if (oldRecord && oldPair?.id !== oldRecord.mappingId) {
                const destination = markdownExportDestination(pair, file.path);
                await this.block(file.path, destination);
                this.issue(file.path, destination, 'Previous managed export belongs to a different folder');
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
                    const next: MarkdownExportRecord = { ...oldRecord, mappingId: pair.id, source: file.path };
                    const currentHash = existing && renamedContentHash(await this.app.vault.read(existing), oldRecord, next);
                    if (!currentHash) {
                        await this.block(file.path, destination);
                        this.issue(file.path, destination, 'Rename blocked by edited or missing destination');
                        return;
                    }
                    this.settings.markdownExportRecords[destination] = { ...next, hash: currentHash };
                    try { await this.persist(); } catch (error) {
                        this.settings.markdownExportRecords[destination] = oldRecord;
                        this.issue(file.path, destination, error instanceof Error ? error.message : String(error));
                        return;
                    }
                } else {
                    try {
                        const oldFile = this.app.vault.getFileByPath(oldRecord.destination);
                        const next: MarkdownExportRecord = { ...oldRecord, mappingId: pair.id, source: file.path, destination };
                        const currentHash = oldFile && renamedContentHash(await this.app.vault.read(oldFile), oldRecord, next);
                        if (!currentHash || this.app.vault.getAbstractFileByPath(destination)) {
                            await this.block(file.path, destination);
                            this.issue(file.path, destination, 'Rename blocked by edited, missing, or occupied destination');
                            return;
                        }
                        if (!renameCurrent()) return;
                        this.settings.markdownExportPendingMove = {
                            from: { ...oldRecord, hash: currentHash }, to: { ...next, hash: currentHash },
                        };
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
                        if (!renameCurrent() || this.app.vault.getAbstractFileByPath(destination)) {
                            await this.recover(renameCurrent());
                            return;
                        }
                        const latestHash = renamedContentHash(await this.app.vault.read(oldFile), oldRecord, next);
                        if (!latestHash) {
                            await this.recover();
                            return;
                        }
                        await this.app.vault.rename(oldFile, destination);
                        delete this.settings.markdownExportRecords[oldRecord.destination];
                        this.settings.markdownExportRecords[destination] = { ...next, hash: latestHash };
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
        const movedHash = moved && !original && renamedContentHash(await this.app.vault.read(moved), pending.from, pending.to);
        const originalHash = original && !moved && renamedContentHash(await this.app.vault.read(original), pending.from, pending.to);
        if (movedHash) {
            this.settings.markdownExportRecords ??= {};
            delete this.settings.markdownExportRecords[pending.from.destination];
            this.settings.markdownExportRecords[pending.to.destination] = { ...pending.to, hash: movedHash };
            await this.persist();
            needsRefresh = true;
        } else if (original && originalHash) {
            if (!retryMove) {
                this.settings.markdownExportPendingMove = null;
                await this.persist();
                return;
            }
            const source = this.app.vault.getFileByPath(pending.to.source);
            if (!source || this.mapping(source.path)?.id !== pending.to.mappingId) {
                await this.block(pending.to.source, pending.to.destination);
                this.issue(pending.to.source, pending.to.destination,
                    'Interrupted rename needs review: source is missing or automatic export mapping changed');
                return;
            }
            try {
                await this.ensureParent(pending.to.destination);
                if (this.app.vault.getAbstractFileByPath(pending.to.destination)) throw new Error('Destination changed during recovery');
                const latestHash = renamedContentHash(await this.app.vault.read(original), pending.from, pending.to);
                if (!latestHash) throw new Error('Destination changed during recovery');
                await this.app.vault.rename(original, pending.to.destination);
                this.settings.markdownExportRecords ??= {};
                delete this.settings.markdownExportRecords[pending.from.destination];
                this.settings.markdownExportRecords[pending.to.destination] = { ...pending.to, hash: latestHash };
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
            this.issue(pending.to.source, pending.to.destination,
                'Interrupted rename needs review: managed Markdown changed or a destination is missing or occupied; review both locations before resuming');
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