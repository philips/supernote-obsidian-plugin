import { App, Modal, Setting, TFolder } from 'obsidian';
import type { MarkdownExportMapping } from './settings';
import { VaultFolderPickerModal } from './VaultFolderPickerModal';

export interface MarkdownExportPairChoice {
    name: string;
    watchDir: string;
    outputDir: string;
}

export class MarkdownExportPairModal extends Modal {
    private finish: ((choice: MarkdownExportPairChoice | null) => void) | null = null;
    private choice: MarkdownExportPairChoice | null = null;

    constructor(
        app: App,
        private readonly existing: MarkdownExportMapping[],
        private readonly validate: (choice: MarkdownExportPairChoice) => string | undefined,
    ) {
        super(app);
    }

    choose(): Promise<MarkdownExportPairChoice | null> {
        return new Promise((resolve) => {
            this.finish = resolve;
            this.open();
        });
    }

    onOpen(): void {
        this.setTitle('Add automatic Markdown export pair');
        this.contentEl.empty();
        const choice: MarkdownExportPairChoice = { name: '', watchDir: '', outputDir: '' };
        let besideSource = true;
        let lastOutputDir = '';
        const warning = this.contentEl.createEl('p', { cls: 'supernote-sync-folder-warning' });
        let confirmButton: { setDisabled(disabled: boolean): unknown };
        const validate = () => {
            const name = choice.name.trim().toLocaleLowerCase();
            const missingFolder = (path: string) => !!path && !this.app.vault.getFolderByPath(path);
            const error = !name ? 'Enter a name for this pair'
                : this.existing.some((pair) => pair.name?.trim().toLocaleLowerCase() === name)
                    ? 'A pair with that name already exists'
                    : !besideSource && !choice.outputDir ? 'Select an output folder or choose Beside source'
                    : missingFolder(choice.watchDir) || missingFolder(choice.outputDir)
                        ? 'Selected folder no longer exists'
                    : this.existing.some((pair) => pair.watchDir === choice.watchDir && pair.outputDir === choice.outputDir)
                        ? 'A pair with those watch and output folders already exists'
                        : this.validate(choice);
            warning.setText(error ?? '');
            warning.hidden = !error;
            confirmButton?.setDisabled(!!error);
            return !error;
        };

        new Setting(this.contentEl).setName('Name').addText((text) => text
            .setPlaceholder('Pair name').onChange((name) => { choice.name = name; validate(); }));
        const watchSetting = new Setting(this.contentEl).setName('Watch folder').setDesc('/')
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
            .onChange((value) => {
                besideSource = value === 'beside';
                choice.outputDir = besideSource ? '' : lastOutputDir;
                outputSetting.settingEl.toggleClass('supernote-export-output-hidden', besideSource);
                outputSetting.setDesc(choice.outputDir || 'Select a folder');
                validate();
            }));
        outputSetting = new Setting(this.contentEl).setName('Output folder').setDesc('Select a folder');
        outputSetting.settingEl.addClass('supernote-export-output-hidden');
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