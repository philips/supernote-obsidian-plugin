import { App, TFile } from 'obsidian';
import { CloudMirrorVault } from './cloudMirrorWrite';

export class ObsidianCloudMirrorVault implements CloudMirrorVault {
    constructor(private readonly app: App) {}

    async read(path: string): Promise<Uint8Array | null> {
        const entry = this.app.vault.getAbstractFileByPath(path);
        if (entry === null) return null;
        if (!(entry instanceof TFile)) throw new Error('Cloud mirror destination is not a file');
        return new Uint8Array(await this.app.vault.readBinary(entry));
    }

    async write(path: string, bytes: Uint8Array): Promise<void> {
        const parentPath = path.slice(0, path.lastIndexOf('/'));
        let parent = '';
        for (const segment of parentPath.split('/')) {
            parent = parent ? `${parent}/${segment}` : segment;
            const entry = this.app.vault.getAbstractFileByPath(parent);
            if (entry instanceof TFile) throw new Error('Cloud mirror parent is not a folder');
            if (entry === null) await this.app.vault.createFolder(parent);
        }
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            await this.app.vault.modifyBinary(existing, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        } else if (existing === null) {
            await this.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        } else {
            throw new Error('Cloud mirror destination is not a file');
        }
    }
}