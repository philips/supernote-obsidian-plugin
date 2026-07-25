import { App, Modal, Notice, Editor } from 'obsidian';
import SupernotePlugin from './main';
import { SupernoteFile, fetchSupernoteDirectory } from './FileListModal';
import { parseDeviceDate, isSameLocalDay } from './deviceDate';

export class ImportTodayModal extends Modal {
    plugin: SupernotePlugin;
    editor: Editor;
    targetPath: string;
    files: SupernoteFile[] = [];
    selected: Set<string> = new Set();
    listEl!: HTMLElement;
    importBtn!: HTMLButtonElement;

    constructor(app: App, plugin: SupernotePlugin, editor: Editor, targetPath: string) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        this.targetPath = targetPath;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: "Import today's Supernote pages" });
        const status = contentEl.createEl('p', { text: 'Scanning device for notes created or modified today…' });

        let found: SupernoteFile[];
        try {
            found = await this.scanForTodaysNotes('/', new Set());
        } catch (err) {
            status.setText(`Failed to scan device: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }

        status.remove();

        if (found.length === 0) {
            contentEl.createEl('p', { text: "No notes created or modified today were found on the device." });
            return;
        }

        this.files = found;
        found.forEach(f => this.selected.add(f.uri));

        const controls = contentEl.createDiv({ cls: 'supernote-import-controls' });
        controls.createEl('button', { text: 'Select all' }).addEventListener('click', () => {
            this.files.forEach(f => this.selected.add(f.uri));
            this.renderList();
        });
        controls.createEl('button', { text: 'Select none' }).addEventListener('click', () => {
            this.selected.clear();
            this.renderList();
        });

        this.listEl = contentEl.createDiv({ cls: 'supernote-import-list' });
        this.renderList();

        this.importBtn = contentEl.createEl('button', { text: 'Import selected', cls: 'mod-cta' });
        this.importBtn.addEventListener('click', () => this.importSelected());
    }

    private renderList() {
        this.listEl.empty();
        for (const file of this.files) {
            const row = this.listEl.createDiv({ cls: 'supernote-import-row' });
            const label = row.createEl('label');
            const checkbox = label.createEl('input', { type: 'checkbox' });
            checkbox.checked = this.selected.has(file.uri);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selected.add(file.uri);
                } else {
                    this.selected.delete(file.uri);
                }
            });
            label.createSpan({ text: ` ${file.name} — ${file.date}` });
        }
    }

    private async scanForTodaysNotes(path: string, visited: Set<string>): Promise<SupernoteFile[]> {
        if (visited.has(path)) return [];
        visited.add(path);

        const entries = await fetchSupernoteDirectory(this.plugin.settings.directConnectIP, path);
        const now = new Date();
        const results: SupernoteFile[] = [];

        for (const entry of entries) {
            if (entry.isDirectory) {
                results.push(...await this.scanForTodaysNotes(entry.uri, visited));
            } else if (entry.name.toLowerCase().endsWith('.note')) {
                const modified = parseDeviceDate(entry.date);
                if (modified && isSameLocalDay(modified, now)) {
                    results.push(entry);
                }
            }
        }
        return results;
    }

    private async importSelected() {
        const chosen = this.files.filter(f => this.selected.has(f.uri));
        if (chosen.length === 0) {
            new Notice('No notes selected');
            return;
        }

        this.importBtn.disabled = true;
        this.importBtn.setText('Importing…');

        const ip = this.plugin.settings.directConnectIP;
        let combined = '';
        try {
            for (const file of chosen) {
                const response = await fetch(`http://${ip}:8089${file.uri}`);
                if (!response.ok) {
                    throw new Error(`Failed to download ${file.name}: ${response.statusText}`);
                }
                const buffer = await response.arrayBuffer();
                combined += await this.plugin.vaultWriter.buildInsertableMarkdown(file.name, buffer, this.targetPath);
                combined += '\n';
            }

            this.editor.replaceRange(combined, this.editor.getCursor());
            new Notice(`Imported ${chosen.length} note${chosen.length === 1 ? '' : 's'}`);
            this.close();
        } catch (err) {
            new Notice(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
            this.importBtn.disabled = false;
            this.importBtn.setText('Import selected');
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
