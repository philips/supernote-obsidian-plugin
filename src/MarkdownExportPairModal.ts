import { App, Modal, Setting, TFolder } from 'obsidian';
import type { MarkdownExportMapping } from './settings';

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
        const folders = this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder && !!file.path)
            .sort((left, right) => left.path.localeCompare(right.path));
        const choice: MarkdownExportPairChoice = { name: '', watchDir: '', outputDir: '' };
        const warning = this.contentEl.createEl('p', { cls: 'supernote-sync-folder-warning' });
        let confirmButton: { setDisabled(disabled: boolean): unknown };
        const validate = () => {
            const name = choice.name.trim().toLocaleLowerCase();
            const error = !name ? 'Enter a name for this pair'
                : this.existing.some((pair) => pair.name?.trim().toLocaleLowerCase() === name)
                    ? 'A pair with that name already exists'
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
        const addFolderDropdown = (name: string, emptyLabel: string, update: (path: string) => void) => {
            new Setting(this.contentEl).setName(name).addDropdown((dropdown) => {
                dropdown.addOption('', emptyLabel);
                for (const folder of folders) dropdown.addOption(folder.path, folder.path);
                dropdown.onChange((path) => { update(path); validate(); });
            });
        };
        addFolderDropdown('Watch folder', '(Whole vault)', (path) => { choice.watchDir = path; });
        addFolderDropdown('Output folder', '(Beside source)', (path) => { choice.outputDir = path; });
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