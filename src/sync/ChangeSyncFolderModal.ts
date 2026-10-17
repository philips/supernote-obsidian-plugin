import { App, Modal, Setting, TFolder } from 'obsidian';

export interface SyncFolderChoice {
    root: string;
    mode: 'move' | 'fresh';
}

export class ChangeSyncFolderModal extends Modal {
    private finish: ((choice: SyncFolderChoice | null) => void) | null = null;
    private choice: SyncFolderChoice | null = null;

    constructor(app: App, private readonly currentRoot: string, private readonly hasContent: boolean) {
        super(app);
    }

    choose(): Promise<SyncFolderChoice | null> {
        return new Promise((resolve) => {
            this.finish = resolve;
            this.open();
        });
    }

    onOpen(): void {
        this.setTitle('Change sync location');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('p', { text: `Current folder: ${this.currentRoot}` });
        const folders = this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder)
            .sort((left, right) => left.path.localeCompare(right.path));
        let destination = '';
        let warningEl: HTMLParagraphElement;
        const buttons: { setDisabled(disabled: boolean): unknown }[] = [];
        const validDestination = (path: string) => {
            const folder = this.app.vault.getAbstractFileByPath(path);
            return folder instanceof TFolder && folder.children.length === 0
                && path !== this.currentRoot
                && !path.startsWith(`${this.currentRoot}/`)
                && !this.currentRoot.startsWith(`${path}/`);
        };
        const updateSelection = (path: string) => {
            destination = path;
            const valid = validDestination(path);
            warningEl.hidden = !path || valid;
            if (!warningEl.hidden) warningEl.setText('Select an empty vault folder');
            for (const button of buttons) button.setDisabled(!valid);
        };
        new Setting(contentEl).setName('New folder').addDropdown((dropdown) => {
            dropdown.addOption('', 'Select a folder');
            for (const folder of folders) {
                if (folder.path) dropdown.addOption(folder.path, folder.path);
            }
            dropdown.onChange(updateSelection);
        });
        warningEl = contentEl.createEl('p', { cls: 'supernote-sync-folder-warning' });
        warningEl.hidden = true;
        contentEl.createEl('p', { text: this.hasContent
            ? 'Select an empty folder for the new location. \'Move\' transfers all files from the current folder, including edited, unrelated files and sync metadata. \'Leave\' keeps old files in place but stops tracking them and starts over in the new location.'
            : 'Confirm a new destination. Existing files will not be changed.' });
        const confirm = (mode: SyncFolderChoice['mode']) => {
            if (!validDestination(destination)) {
                updateSelection(destination);
                return;
            }
            this.choice = { root: destination, mode };
            this.close();
        };
        if (this.hasContent) {
            new Setting(contentEl).addButton((button) => {
                buttons.push(button);
                button.setButtonText('Move files').setDisabled(true).onClick(() => confirm('move'));
            }).addButton((button) => {
                buttons.push(button);
                button.setButtonText('Leave files and start fresh').setDisabled(true).onClick(() => confirm('fresh'));
            });
        } else {
            new Setting(contentEl).addButton((button) => {
                buttons.push(button);
                button.setButtonText('Change destination').setCta().setDisabled(true).onClick(() => confirm('fresh'));
            });
        }
        new Setting(contentEl).addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
        this.finish?.(this.choice);
        this.finish = null;
    }
}