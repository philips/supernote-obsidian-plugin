import { App } from 'obsidian';
import { MIRROR_METADATA_DIRECTORY } from './sharedMirrorManifest';
import { MirrorManifestSlot, MirrorManifestStorage } from './sharedMirrorManifestStore';

// This adapter owns only the two manifest files. It deliberately does not
// delete, rename, or overwrite unrelated vault entries in the reserved folder.
export class ObsidianMirrorManifestStorage implements MirrorManifestStorage {
    private readonly directory: string;

    constructor(private readonly app: App, syncFolder: string) {
        const root = syncFolder.replace(/^\/+|\/+$/g, '');
        if (!root || root.split('/').some((segment) => !segment || segment === '.' || segment === '..'
            || /[\\:*?"<>|]/.test(segment) || segment.endsWith('.') || segment.endsWith(' ')
            || [...segment].some((character) => character.charCodeAt(0) < 32))) {
            throw new Error('Unsafe shared mirror destination root');
        }
        this.directory = `${root}/${MIRROR_METADATA_DIRECTORY}`;
    }

    private path(slot: MirrorManifestSlot): string {
        return `${this.directory}/${slot}.json`;
    }

    async read(slot: MirrorManifestSlot): Promise<string | null> {
        const path = this.path(slot);
        const entry = await this.app.vault.adapter.stat(path);
        if (entry === null) return null;
        if (entry.type !== 'file') throw new Error('Mirror manifest slot is not a file');
        return this.app.vault.adapter.read(path);
    }

    async write(slot: MirrorManifestSlot, contents: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        const existing = await adapter.stat(this.path(slot));
        if (existing?.type === 'folder') throw new Error('Mirror manifest slot is not a file');
        let parent = '';
        // Create each parent explicitly so a file occupying any directory
        // segment is reported as a collision instead of being papered over.
        for (const segment of this.directory.split('/')) {
            parent = parent ? `${parent}/${segment}` : segment;
            const folder = await adapter.stat(parent);
            if (folder?.type === 'file') throw new Error('Mirror metadata directory is not a folder');
            if (folder === null) await adapter.mkdir(parent);
        }
        await adapter.write(this.path(slot), contents);
    }
}