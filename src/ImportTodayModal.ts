import { App, Modal, Notice, Editor } from 'obsidian';
import SupernotePlugin from './main';
import { SupernoteFile, scanDeviceSupernoteTree } from './FileListModal';
import { fetchFromDevice, DEVICE_TRANSFER_TIMEOUT_MS } from './deviceFetch';
import { parseDeviceDate, isSameLocalDay, todayLocalMidnight, formatDateInputValue, parseDateInputValue } from './deviceDate';
import { ImportFormat, IMPORT_FORMAT_LABELS } from './settings';

interface ScannedNote {
    file: SupernoteFile;
    date: Date;
}

export class ImportTodayModal extends Modal {
    plugin: SupernotePlugin;
    editor: Editor;
    targetPath: string;
    allNotes: ScannedNote[] = [];
    files: SupernoteFile[] = [];
    selected: Set<string> = new Set();
    selectedDate: Date = todayLocalMidnight();
    importFormat: ImportFormat;
    listEl!: HTMLElement;
    resultsEl!: HTMLElement;
    importBtn!: HTMLButtonElement;

    constructor(app: App, plugin: SupernotePlugin, editor: Editor, targetPath: string) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        this.targetPath = targetPath;
        this.importFormat = plugin.settings.importFormat;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        // Scopes styles.css's button.mod-cta display:block rule to just this
        // modal, instead of it applying to every CTA button in Obsidian (see
        // issue #74 — an unscoped rule shifted button text down app-wide).
        contentEl.addClass('supernote-import-modal');
        contentEl.createEl('h2', { text: 'Import supernote pages and drawings' });
        const status = contentEl.createEl('p', { text: 'Scanning device for notes…' });

        try {
            this.allNotes = await this.scanAllNotes();
        } catch (err) {
            status.setText(`Failed to scan device: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }

        status.remove();

        const dateRow = contentEl.createDiv({ cls: 'supernote-import-date-row' });
        dateRow.createEl('label', { text: 'Import notes from: ', attr: { for: 'supernote-import-date' } });
        const dateInput = dateRow.createEl('input', {
            type: 'date',
            attr: { id: 'supernote-import-date' },
        });
        dateInput.value = formatDateInputValue(this.selectedDate);
        dateInput.max = formatDateInputValue(todayLocalMidnight());
        dateInput.addEventListener('change', () => {
            const parsed = parseDateInputValue(dateInput.value);
            if (parsed) {
                this.selectedDate = parsed;
                this.renderForSelectedDate();
            }
        });

        const formatRow = contentEl.createDiv({ cls: 'supernote-import-format-row' });
        formatRow.createEl('label', { text: 'Import as: ', attr: { for: 'supernote-import-format' } });
        const formatSelect = formatRow.createEl('select', { attr: { id: 'supernote-import-format' } });
        for (const [value, label] of Object.entries(IMPORT_FORMAT_LABELS)) {
            const option = formatSelect.createEl('option', { text: label, value });
            if (value === this.importFormat) {
                option.selected = true;
            }
        }
        formatSelect.addEventListener('change', () => {
            this.importFormat = formatSelect.value as ImportFormat;
            // Remember the choice as the new default for next time, same as
            // the settings tab's dropdown would (see issue #104).
            this.plugin.settings.importFormat = this.importFormat;
            void this.plugin.saveSettings();
        });

        this.resultsEl = contentEl.createDiv();
        this.renderForSelectedDate();
    }

    private renderForSelectedDate() {
        this.resultsEl.empty();

        this.files = this.allNotes
            .filter(n => isSameLocalDay(n.date, this.selectedDate))
            .map(n => n.file);
        this.selected = new Set(this.files.map(f => f.uri));

        if (this.files.length === 0) {
            this.resultsEl.createEl('p', {
                text: `No notes created or modified on ${this.selectedDate.toLocaleDateString()} were found on the device.`,
            });
            return;
        }

        const controls = this.resultsEl.createDiv({ cls: 'supernote-import-controls' });
        controls.createEl('button', { text: 'Select all' }).addEventListener('click', () => {
            this.files.forEach(f => this.selected.add(f.uri));
            this.renderList();
        });
        controls.createEl('button', { text: 'Select none' }).addEventListener('click', () => {
            this.selected.clear();
            this.renderList();
        });

        this.listEl = this.resultsEl.createDiv({ cls: 'supernote-import-list' });
        this.renderList();

        this.importBtn = this.resultsEl.createEl('button', { text: 'Import selected', cls: 'mod-cta' });
        this.importBtn.addEventListener('click', () => { void this.importSelected(); });
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

    // Walks the whole device tree once and records every .note/.spd file's
    // parsed date, so switching the date picker only needs to re-filter in
    // memory instead of re-fetching the device's directory tree over HTTP
    // each time.
    private async scanAllNotes(): Promise<ScannedNote[]> {
        const files = await scanDeviceSupernoteTree(this.plugin.settings.directConnectIP);
        const results: ScannedNote[] = [];
        for (const file of files) {
            const modified = parseDeviceDate(file.date);
            if (modified) {
                results.push({ file, date: modified });
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
                const response = await fetchFromDevice(ip, file.uri, `Failed to download ${file.name}`, {
                    timeoutMs: DEVICE_TRANSFER_TIMEOUT_MS,
                    pathLeafName: file.name,
                    pathDirectoryNames: file.directoryNames,
                });
                if (!response.ok) {
                    throw new Error(`Failed to download ${file.name}: Supernote responded with an error (status ${response.status}).`);
                }
                const buffer = await response.arrayBuffer();
                combined += await this.plugin.vaultWriter.buildInsertableContent(file.name, buffer, this.targetPath, this.importFormat);
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
