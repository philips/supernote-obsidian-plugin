import { App, Modal, Setting, TFolder } from 'obsidian';
import type { MarkdownExportMapping, NoteConversion } from './settings';
import { NOTE_CONVERSION_LABELS } from './settings';
import { VaultFolderPickerModal } from './VaultFolderPickerModal';

export interface MarkdownExportFolderChoice {
    name: string;
    watchDir: string;
    outputDir: string;
    noteConversion: NoteConversion;
}

export class MarkdownExportFolderModal extends Modal {
    private finish: ((choice: MarkdownExportFolderChoice | null) => void) | null = null;
    private choice: MarkdownExportFolderChoice | null = null;

    constructor(
        app: App,
        private readonly existing: MarkdownExportMapping[],
        private readonly validate: (choice: MarkdownExportFolderChoice) => string | undefined,
        private readonly initial?: MarkdownExportMapping,
    ) {
        super(app);
    }

    choose(): Promise<MarkdownExportFolderChoice | null> {
        return new Promise((resolve) => {
            this.finish = resolve;
            this.open();
        });
    }

    onOpen(): void {
        this.setTitle(this.initial ? 'Edit monitored export folder' : 'Add monitored export folder');
        this.contentEl.empty();
        const choice: MarkdownExportFolderChoice = {
            name: this.initial?.name ?? '', watchDir: this.initial?.watchDir ?? '',
            outputDir: this.initial?.outputDir ?? '', noteConversion: this.initial?.noteConversion ?? 'markdown',
        };
        let besideSource = !choice.outputDir;
        let lastOutputDir = choice.outputDir;
        const warning = this.contentEl.createEl('p', { cls: 'supernote-sync-folder-warning' });
        let confirmButton: { setDisabled(disabled: boolean): unknown };
        const validate = () => {
            const name = choice.name.trim().toLocaleLowerCase();
            const missingFolder = (path: string) => !!path && !this.app.vault.getFolderByPath(path);
            const error = !name ? 'Enter a name for this folder'
                : this.existing.some((folder) => folder.name?.trim().toLocaleLowerCase() === name)
                    ? 'A folder with that name already exists'
                    : !besideSource && !choice.outputDir ? 'Select an output folder or choose Beside source'
                    : missingFolder(choice.watchDir) || missingFolder(choice.outputDir)
                        ? 'Selected folder no longer exists'
                    : this.existing.some((folder) => folder.watchDir === choice.watchDir && folder.outputDir === choice.outputDir)
                        ? 'A folder with those watch and output folders already exists'
                        : this.validate(choice);
            warning.setText(error ?? '');
            warning.hidden = !error;
            confirmButton?.setDisabled(!!error);
            return !error;
        };

        new Setting(this.contentEl).setName('Name').addText((text) => text
            .setPlaceholder('Folder name').setValue(choice.name).onChange((name) => { choice.name = name; validate(); }));
        const watchSetting = new Setting(this.contentEl).setName('Watch folder').setDesc(choice.watchDir || '/')
            .addButton((button) => button.setButtonText('Browse…').onClick(() => {
                new VaultFolderPickerModal(this.app, choice.watchDir, true, (folder: TFolder) => {
                    choice.watchDir = folder.path;
                    watchSetting.setDesc(folder.path || '/');
                    validate();
                }).open();
            }));
        let outputSetting: Setting;
        new Setting(this.contentEl).setName('Output location').addDropdown((dropdown) => dropdown
            .addOption('beside', 'Beside source')
            .addOption('folder', 'Specific folder')
            .setValue(besideSource ? 'beside' : 'folder')
            .onChange((value) => {
                besideSource = value === 'beside';
                choice.outputDir = besideSource ? '' : lastOutputDir;
                outputSetting.settingEl.toggleClass('supernote-export-output-hidden', besideSource);
                outputSetting.setDesc(choice.outputDir || 'Select a folder');
                validate();
            }));
        outputSetting = new Setting(this.contentEl).setName('Output folder').setDesc(choice.outputDir || 'Select a folder');
        if (besideSource) outputSetting.settingEl.addClass('supernote-export-output-hidden');
        outputSetting.addButton((button) => {
            button.setButtonText('Browse…').onClick(() => {
                new VaultFolderPickerModal(this.app, choice.outputDir || null, false, (folder: TFolder) => {
                    choice.outputDir = folder.path;
                    lastOutputDir = folder.path;
                    outputSetting.setDesc(folder.path);
                    validate();
                }).open();
            });
        });
        new Setting(this.contentEl).setName('.Note conversion').addDropdown((dropdown) => dropdown
            .addOption('markdown', NOTE_CONVERSION_LABELS.markdown)
            .addOption('png', NOTE_CONVERSION_LABELS.png)
            .addOption('svg', NOTE_CONVERSION_LABELS.svg)
            .setValue(choice.noteConversion)
            .onChange((value) => { choice.noteConversion = value as NoteConversion; validate(); }));
        new Setting(this.contentEl).addButton((button) => {
            confirmButton = button;
            button.setButtonText('OK').setCta().setDisabled(true).onClick(() => {
                if (!validate()) return;
                this.choice = { ...choice, name: choice.name.trim() };
                this.close();
            });
        }).addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
        validate();
    }

    onClose(): void {
        this.contentEl.empty();
        this.finish?.(this.choice);
        this.finish = null;
    }
}