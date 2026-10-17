import { App, TFile, TFolder } from 'obsidian';
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

    async trash(path: string): Promise<void> {
        const entry = this.app.vault.getAbstractFileByPath(path);
        if (!(entry instanceof TFile)) throw new Error('Cloud mirror Trash target is not a file');
        await this.app.fileManager.trashFile(entry);
    }

    async trashEmptyFolder(path: string): Promise<boolean> {
        const entry = this.app.vault.getAbstractFileByPath(path);
        if (!(entry instanceof TFolder)) return false;
        if (entry.children.length > 0) return false;
        await this.app.fileManager.trashFile(entry);
        return true;
    }

    async listFolders(root: string): Promise<string[]> {
        const entry = this.app.vault.getAbstractFileByPath(root);
        if (!(entry instanceof TFolder)) return [];
        const folders: string[] = [];
        const visit = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    folders.push(child.path);
                    visit(child);
                }
            }
        };
        visit(entry);
        return folders;
    }
}