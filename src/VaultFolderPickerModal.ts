import { App, Modal, Setting, TFolder, setIcon } from 'obsidian';

export class VaultFolderPickerModal extends Modal {
    private selectedPath: string | null = null;
    private readonly expanded = new Set<string>();
    private query = '';
    private treeEl!: HTMLDivElement;
    private warningEl!: HTMLParagraphElement;
    private selectButton!: { setDisabled(disabled: boolean): unknown };

    constructor(
        app: App,
        private readonly initialPath: string | null,
        private readonly allowRoot: boolean,
        private readonly onSelect: (folder: TFolder) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle('Select vault folder');
        this.contentEl.empty();
        const initial = this.initialPath === '' ? this.app.vault.getRoot()
            : this.initialPath === null ? null : this.app.vault.getFolderByPath(this.initialPath);
        this.selectedPath = initial && (this.allowRoot || initial.path) ? initial.path : null;
        this.expanded.clear();
        for (let parent = initial?.parent; parent; parent = parent.parent) this.expanded.add(parent.path);
        this.expanded.add(this.app.vault.getRoot().path);
        this.query = '';

        new Setting(this.contentEl).setName('Search folders').addText((text) => text
            .setPlaceholder('Folder name or path').onChange((value) => {
                this.query = value.trim().toLocaleLowerCase();
                if (this.query) {
                    for (const folder of this.app.vault.getAllFolders()) {
                        if (folder.path.toLocaleLowerCase().includes(this.query)) {
                            for (let parent = folder.parent; parent; parent = parent.parent) this.expanded.add(parent.path);
                        }
                    }
                }
                this.renderTree();
            }));
        this.treeEl = this.contentEl.createDiv({ cls: 'supernote-folder-picker-tree' });
        this.warningEl = this.contentEl.createEl('p', { cls: 'supernote-sync-folder-warning' });
        this.warningEl.hidden = true;
        new Setting(this.contentEl).addButton((button) => {
            this.selectButton = button;
            button.setButtonText('Select').setCta().onClick(() => {
                const folder = this.selectedPath === null ? null
                    : this.selectedPath === '' ? this.app.vault.getRoot()
                        : this.app.vault.getFolderByPath(this.selectedPath);
                if (!folder || (!this.allowRoot && !folder.path)) {
                    this.warningEl.setText('Folder no longer exists. Select another folder.');
                    this.warningEl.hidden = false;
                    this.selectedPath = null;
                    this.renderTree();
                    return;
                }
                this.onSelect(folder);
                this.close();
            });
        }).addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
        this.renderTree();
    }

    private renderTree(): void {
        this.treeEl.empty();
        const visible = new Set<string>();
        if (this.query) {
            for (const folder of this.app.vault.getAllFolders()) {
                if (!folder.path.toLocaleLowerCase().includes(this.query)
                    && !folder.name.toLocaleLowerCase().includes(this.query)) continue;
                for (let parent: TFolder | null = folder; parent; parent = parent.parent) visible.add(parent.path);
            }
        }
        const renderFolder = (folder: TFolder, container: HTMLElement) => {
            if (this.query && !visible.has(folder.path) && folder.path) return;
            const children = folder.children.filter((child): child is TFolder => child instanceof TFolder)
                .filter((child) => !this.query || visible.has(child.path))
                .sort((left, right) => left.name.localeCompare(right.name));
            const row = container.createDiv({ cls: 'supernote-folder-picker-entry' });
            if (children.length) {
                const toggle = row.createEl('button', { cls: 'supernote-folder-picker-toggle',
                    attr: { type: 'button', 'aria-label': `Toggle ${folder.path || 'vault root'}` } });
                setIcon(toggle, this.expanded.has(folder.path) ? 'chevron-down' : 'chevron-right');
                toggle.setAttribute('aria-expanded', String(this.expanded.has(folder.path)));
                toggle.addEventListener('click', () => {
                    if (this.expanded.has(folder.path)) this.expanded.delete(folder.path);
                    else this.expanded.add(folder.path);
                    this.renderTree();
                    this.focusRow(folder.path);
                });
            } else row.createSpan({ cls: 'supernote-folder-picker-spacer' });
            const choice = row.createEl('button', { cls: 'supernote-folder-picker-row',
                text: folder.path || '/', attr: { type: 'button', 'aria-pressed': String(this.selectedPath === folder.path) } });
            if (this.selectedPath === folder.path) choice.addClass('is-selected');
            if (!folder.path && !this.allowRoot) choice.disabled = true;
            choice.addEventListener('click', () => {
                this.selectedPath = folder.path;
                this.warningEl.hidden = true;
                this.renderTree();
                this.focusRow(folder.path);
            });
            choice.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowRight' && children.length) {
                    this.expanded.add(folder.path);
                    this.renderTree();
                    this.focusRow(folder.path);
                } else if (event.key === 'ArrowLeft') {
                    const wasExpanded = this.expanded.delete(folder.path);
                    const focusPath = wasExpanded || !folder.parent ? folder.path : folder.parent.path;
                    this.renderTree();
                    this.focusRow(focusPath);
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    const rows = [...this.treeEl.querySelectorAll<HTMLButtonElement>('.supernote-folder-picker-row:not(:disabled)')];
                    rows[rows.indexOf(choice) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
                } else return;
                event.preventDefault();
            });
            if (children.length && this.expanded.has(folder.path)) {
                const branch = container.createDiv({ cls: 'supernote-folder-picker-branch' });
                for (const child of children) renderFolder(child, branch);
            }
        };
        renderFolder(this.app.vault.getRoot(), this.treeEl);
        if (this.query && !visible.size) this.treeEl.createEl('p', { text: 'No folders found.' });
        this.selectButton.setDisabled(this.selectedPath === null);
    }

    private focusRow(path: string): void {
        this.treeEl.querySelectorAll<HTMLButtonElement>('.supernote-folder-picker-row')
            .forEach((button) => {
                if (button.textContent === (path || '/')) {
                    if (button.disabled) (button.previousElementSibling as HTMLElement | null)?.focus();
                    else button.focus();
                }
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}