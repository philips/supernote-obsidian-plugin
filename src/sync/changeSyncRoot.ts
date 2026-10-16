import { App, TAbstractFile } from 'obsidian';
import { hashBytes, SyncManifest } from './directIP/deviceSync';
import { ObsidianMirrorManifestStorage } from './obsidianMirrorManifestStorage';
import { MIRROR_METADATA_DIRECTORY, SharedMirrorManifest } from './sharedMirrorManifest';
import { loadMirrorManifest, saveMirrorManifest } from './sharedMirrorManifestStore';

const CHECKPOINT_KEY = 'supernote-sync-root-change';
type RootChangeMode = 'move' | 'fresh';
interface RootCheckpoint {
    version: 2;
    oldRoot: string;
    newRoot: string;
    mode: RootChangeMode;
    fingerprint: string | null;
    oldExisted: boolean;
    entries: { name: string; signature: string }[];
    manifestHash: string | null;
}

function validRoot(root: string): boolean {
    return root.length > 0 && root === root.trim() && !root.startsWith('/') && !root.endsWith('/')
        && root.split('/').every((segment) => segment && segment !== '.' && segment !== '..'
            && segment !== MIRROR_METADATA_DIRECTORY && !/[\\:*?"<>|]/.test(segment)
            && !segment.endsWith('.') && !segment.endsWith(' ')
            && ![...segment].some((character) => character.charCodeAt(0) < 32));
}

export class SyncRootChange {
    constructor(
        private readonly app: App,
        private readonly getRoot: () => string,
        private readonly legacy: () => SyncManifest,
        private readonly saveRoot: (root: string) => Promise<void>,
    ) {}

    private checkpoint(): RootCheckpoint | null {
        const value: unknown = this.app.loadLocalStorage(CHECKPOINT_KEY);
        if (value === null || value === undefined) return null;
        if (!value || typeof value !== 'object') throw new Error('Invalid sync folder change checkpoint');
        const entry = value as Partial<RootCheckpoint>;
        if (entry.version !== 2 || !validRoot(entry.oldRoot ?? '') || !validRoot(entry.newRoot ?? '')
            || (entry.mode !== 'move' && entry.mode !== 'fresh')
            || (entry.fingerprint !== null && typeof entry.fingerprint !== 'string')
            || typeof entry.oldExisted !== 'boolean' || !Array.isArray(entry.entries)
            || !entry.entries.every((item) => item && typeof item.name === 'string'
                && item.name !== '.' && item.name !== '..' && !item.name.includes('/')
                && typeof item.signature === 'string')
            || (entry.manifestHash !== null && typeof entry.manifestHash !== 'string')) {
            throw new Error('Invalid sync folder change checkpoint');
        }
        return entry as RootCheckpoint;
    }

    assertReady(): void {
        if (this.checkpoint()) throw new Error('Sync folder change is pending; resolve it before syncing');
    }

    async hasContent(): Promise<boolean> {
        const root = this.getRoot();
        const entry = await this.app.vault.adapter.stat(root);
        if (entry === null) return false;
        if (entry.type !== 'folder') throw new Error('Sync folder is not a folder');
        const listing = await this.app.vault.adapter.list(root);
        const metadataPath = `${root}/${MIRROR_METADATA_DIRECTORY}`;
        const metadata = await this.app.vault.adapter.stat(metadataPath);
        const metadataContents = metadata?.type === 'folder'
            ? await this.app.vault.adapter.list(metadataPath) : null;
        return Object.keys(this.legacy()).length > 0 || listing.files.length > 0
            || listing.folders.some((path) => path !== metadataPath)
            || !!metadataContents && (metadataContents.folders.length > 0 || metadataContents.files.some((path) =>
                path !== `${metadataPath}/primary.json` && path !== `${metadataPath}/backup.json`));
    }

    private async directEntries(root: string): Promise<string[]> {
        const listing = await this.app.vault.adapter.list(root);
        return [...listing.files, ...listing.folders].map((path) => path.slice(root.length + 1)).sort();
    }

    private async signature(path: string, metadata = false): Promise<string> {
        const adapter = this.app.vault.adapter;
        const entry = await adapter.stat(path);
        if (entry?.type === 'file') return `file:${hashBytes(new Uint8Array(await adapter.readBinary(path)))}`;
        if (entry?.type !== 'folder') throw new Error('Sync folder entry disappeared during move');
        const children = await this.directEntries(path);
        const signatures: string[] = [];
        for (const name of children) {
            if (metadata && (name === 'primary.json' || name === 'backup.json')) continue;
            signatures.push(`${name}:${await this.signature(`${path}/${name}`)}`);
        }
        return `folder:${hashBytes(new TextEncoder().encode(JSON.stringify(signatures)))}`;
    }

    private manifestHash(manifest: SharedMirrorManifest, oldRoot: string, newRoot: string): string {
        const records = Object.fromEntries(Object.entries(manifest.records).map(([path, record]) => [
            path.startsWith(`${newRoot}/`) ? `${oldRoot}${path.slice(newRoot.length)}` : path, record,
        ]));
        return hashBytes(new TextEncoder().encode(JSON.stringify({
            cloudAccountFingerprint: manifest.cloudAccountFingerprint, records,
        })));
    }

    async change(newRoot: string, mode: RootChangeMode): Promise<void> {
        this.assertReady();
        const oldRoot = this.getRoot();
        if (!validRoot(oldRoot) || !validRoot(newRoot) || oldRoot === newRoot
            || oldRoot.startsWith(`${newRoot}/`) || newRoot.startsWith(`${oldRoot}/`)) {
            throw new Error('Sync folders must be safe, distinct, and non-overlapping');
        }
        const adapter = this.app.vault.adapter;
        const destination = await adapter.stat(newRoot);
        if (destination?.type !== 'folder') throw new Error('Choose an existing empty destination folder');
        if ((await this.directEntries(newRoot)).length) throw new Error('Destination folder is occupied');
        const old = await adapter.stat(oldRoot);
        if (mode === 'move' && old?.type !== 'folder') throw new Error('Current sync folder does not exist');
        if (old?.type === 'file') throw new Error('Current sync folder is not a folder');
        const manifest = old ? (await loadMirrorManifest(
            new ObsidianMirrorManifestStorage(this.app, oldRoot), this.legacy())).manifest
            : { version: 1 as const, cloudAccountFingerprint: null, records: {} };
        if (manifest.accountChange) throw new Error('Cloud account change must finish before changing folders');
        if (Object.keys(manifest.records).some((path) => !path.startsWith(`${oldRoot}/`))) {
            throw new Error('Shared mirror manifest contains destinations outside the current sync folder');
        }
        const entries = mode === 'move' ? await Promise.all((await this.directEntries(oldRoot)).map(async (name) => ({
            name, signature: await this.signature(`${oldRoot}/${name}`, name === MIRROR_METADATA_DIRECTORY),
        }))) : [];
        const checkpoint: RootCheckpoint = { version: 2, oldRoot, newRoot, mode,
            fingerprint: manifest.cloudAccountFingerprint, oldExisted: old !== null,
            entries, manifestHash: mode === 'move' ? this.manifestHash(manifest, oldRoot, newRoot) : null };
        this.app.saveLocalStorage(CHECKPOINT_KEY, checkpoint);
        await this.resume(checkpoint);
    }

    async recover(): Promise<void> {
        const checkpoint = this.checkpoint();
        if (checkpoint) await this.resume(checkpoint);
    }

    private async resume(checkpoint: RootCheckpoint): Promise<void> {
        const { oldRoot, newRoot, mode, fingerprint } = checkpoint;
        if (this.getRoot() !== oldRoot && this.getRoot() !== newRoot) {
            throw new Error('Sync folder changed independently of pending operation');
        }
        const adapter = this.app.vault.adapter;
        const old = await adapter.stat(oldRoot);
        const next = await adapter.stat(newRoot);
        if (mode === 'move') {
            if (old?.type !== 'folder' || next?.type !== 'folder' || !checkpoint.manifestHash) {
                throw new Error('Ambiguous sync folder move; resolve manually');
            }
            const expected = new Set(checkpoint.entries.map((entry) => entry.name));
            if ((await this.directEntries(oldRoot)).some((name) => !expected.has(name))
                || (await this.directEntries(newRoot)).some((name) => !expected.has(name))) {
                throw new Error('Ambiguous sync folder move; resolve manually');
            }
            for (const { name, signature } of checkpoint.entries) {
                const source = `${oldRoot}/${name}`;
                const destination = `${newRoot}/${name}`;
                const from = await adapter.stat(source);
                const to = await adapter.stat(destination);
                if (from === null && to === null || from !== null && to !== null
                    || await this.signature(from ? source : destination, name === MIRROR_METADATA_DIRECTORY) !== signature) {
                    throw new Error('Ambiguous sync folder move; resolve manually');
                }
            }
            const metadataRoot = await adapter.stat(`${oldRoot}/${MIRROR_METADATA_DIRECTORY}`) ? oldRoot : newRoot;
            const current = await loadMirrorManifest(new ObsidianMirrorManifestStorage(this.app, metadataRoot), {});
            if (current.manifest.accountChange || current.manifest.cloudAccountFingerprint !== fingerprint
                || this.manifestHash(current.manifest, oldRoot, newRoot) !== checkpoint.manifestHash) {
                throw new Error('Moved sync manifest does not match checkpoint');
            }
            if (this.getRoot() !== oldRoot && checkpoint.entries.some(({ name }) =>
                this.app.vault.getAbstractFileByPath(`${oldRoot}/${name}`))) {
                throw new Error('Ambiguous sync folder move; resolve manually');
            }
            for (const { name } of checkpoint.entries) {
                const source = `${oldRoot}/${name}`;
                if (await adapter.stat(source) === null) continue;
                const file = this.app.vault.getAbstractFileByPath(source);
                if (!(file instanceof TAbstractFile)) throw new Error('Sync folder entry is not in the vault');
                await this.app.vault.rename(file, `${newRoot}/${name}`);
            }
            const storage = new ObsidianMirrorManifestStorage(this.app, newRoot);
            const loaded = await loadMirrorManifest(storage, {});
            if (loaded.manifest.cloudAccountFingerprint !== fingerprint || loaded.manifest.accountChange
                || this.manifestHash(loaded.manifest, oldRoot, newRoot) !== checkpoint.manifestHash) {
                throw new Error('Moved sync manifest does not match checkpoint');
            }
            const records: SharedMirrorManifest['records'] = {};
            for (const [path, record] of Object.entries(loaded.manifest.records)) {
                if (path.startsWith(`${oldRoot}/`)) records[`${newRoot}${path.slice(oldRoot.length)}`] = record;
                else if (path.startsWith(`${newRoot}/`)) records[path] = record;
                else throw new Error('Moved sync manifest contains an unrelated destination');
            }
            if (!loaded.manifest.legacyHistoryRetired || Object.keys(records).some((path) => !Object.hasOwn(loaded.manifest.records, path))) {
                await saveMirrorManifest(storage, loaded, { ...loaded.manifest, records, legacyHistoryRetired: true });
            }
        } else {
            if ((checkpoint.oldExisted ? (!old || old.type !== 'folder') : old !== null) || next?.type === 'file') {
                throw new Error('Ambiguous sync folder change; resolve manually');
            }
            const storage = new ObsidianMirrorManifestStorage(this.app, newRoot);
            if (next) {
                const contents = await adapter.list(newRoot);
                if (contents.files.length || contents.folders.some((path) => path !== `${newRoot}/${MIRROR_METADATA_DIRECTORY}`)) {
                    throw new Error('Destination folder is occupied');
                }
            }
            const existing = next ? await Promise.all(['primary', 'backup'].map((slot) =>
                storage.read(slot as 'primary' | 'backup'))) : [null, null];
            if (existing.some((contents) => contents !== null)) {
                const loaded = await loadMirrorManifest(storage, {});
                if (loaded.manifest.cloudAccountFingerprint !== fingerprint
                    || !loaded.manifest.legacyHistoryRetired || Object.keys(loaded.manifest.records).length) {
                    throw new Error('New sync manifest does not match checkpoint');
                }
            } else {
                await saveMirrorManifest(storage, null, {
                    version: 1, cloudAccountFingerprint: fingerprint, records: {}, legacyHistoryRetired: true,
                });
            }
            for (const slot of ['primary', 'backup'] as const) {
                const path = `${oldRoot}/${MIRROR_METADATA_DIRECTORY}/${slot}.json`;
                const entry = await adapter.stat(path);
                if (entry?.type === 'file') await adapter.remove(path);
                else if (entry) throw new Error('Old sync manifest slot is not a file');
            }
        }
        if (this.getRoot() !== newRoot || Object.keys(this.legacy()).length) await this.saveRoot(newRoot);
        this.app.saveLocalStorage(CHECKPOINT_KEY, null);
    }
}