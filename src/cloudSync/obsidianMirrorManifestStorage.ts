import { App, TFile } from 'obsidian';
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
        const entry = this.app.vault.getAbstractFileByPath(this.path(slot));
        if (entry === null) return null;
        if (!(entry instanceof TFile)) throw new Error('Mirror manifest slot is not a file');
        return this.app.vault.read(entry);
    }

    async write(slot: MirrorManifestSlot, contents: string): Promise<void> {
        const existing = this.app.vault.getAbstractFileByPath(this.path(slot));
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, contents);
            return;
        }
        if (existing !== null) throw new Error('Mirror manifest slot is not a file');
        let parent = '';
        // Create each parent explicitly so a file occupying any directory
        // segment is reported as a collision instead of being papered over.
        for (const segment of this.directory.split('/')) {
            parent = parent ? `${parent}/${segment}` : segment;
            const folder = this.app.vault.getAbstractFileByPath(parent);
            if (folder instanceof TFile) throw new Error('Mirror metadata directory is not a folder');
            if (folder === null) await this.app.vault.createFolder(parent);
        }
        await this.app.vault.create(this.path(slot), contents);
    }
}