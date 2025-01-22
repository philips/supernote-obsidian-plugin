import { App, SuggestModal, Notice, MarkdownView } from 'obsidian';
import { SupernotePluginSettings } from './main';

interface SupernoteFile {
    name: string;
    size: number;
    date: string;
    uri: string;
    extension: string;
    isDirectory: boolean;
}

interface SupernoteResponse {
    deviceName: string;
    fileList: SupernoteFile[];
    routeList: { name: string; path: string; }[];
    totalByteSize: number;
    totalMemory: number;
    usedMemory: number;
}

export class FileListModal extends SuggestModal<SupernoteFile> {
    settings: SupernotePluginSettings;
    files: SupernoteFile[] = [];
    currentPath: string = '/';

    constructor(app: App, settings: SupernotePluginSettings) {
        super(app);
        this.settings = settings;
        this.setPlaceholder("Select a file to download or directory to open");
    }

    private async loadFiles() {
        try {
            const response = await fetch(`http://${this.settings.mirrorIP}:8089${this.currentPath}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch file list: ${response.statusText}`);
            }
            const html = await response.text();

            // Extract the JSON data from the script tag
            const match = html.match(/const json = '(.+?)'/);
            if (!match) {
                throw new Error("Could not find file list data");
            }

            const data: SupernoteResponse = JSON.parse(match[1]);
            this.files = data.fileList;
        } catch (err) {
            new Notice(`Failed to load files: ${err.message}`);
            this.close();
        }
    }

    async getSuggestions(query: string): Promise<SupernoteFile[]> {
        if (this.files.length === 0) {
            await this.loadFiles();
        }
        return this.files.filter(file =>
            file.name.toLowerCase().includes(query.toLowerCase())
        );
    }

    renderSuggestion(file: SupernoteFile, el: HTMLElement) {
        const container = el.createDiv({ cls: "suggestion-item" });

        // Add directory icon or file icon
        const iconEl = container.createSpan({ cls: "suggestion-icon" });
        iconEl.innerHTML = file.isDirectory ? "📁" : "📄";

        const contentEl = container.createDiv({ cls: "suggestion-content" });
        contentEl.createDiv({ text: file.name, cls: "suggestion-title" });

        if (!file.isDirectory) {
            contentEl.createDiv({
                text: `${this.formatSize(file.size)} - ${file.date}`,
                cls: "suggestion-note"
            });
        } else {
            contentEl.createDiv({
                text: file.date,
                cls: "suggestion-note"
            });
        }
    }

    private formatSize(bytes: number): string {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
        return (bytes / 1073741824).toFixed(2) + ' GB';
    }

    async onChooseSuggestion(file: SupernoteFile) {
        if (file.isDirectory) {
            // Navigate into directory
            this.currentPath = file.uri;
            await this.loadFiles();
            // Reopen the modal to show new directory contents
            this.open();
        } else {
            try {
                const fileResponse = await fetch(`http://${this.settings.mirrorIP}:8089${file.uri}`);
                if (!fileResponse.ok) {
                    throw new Error(`Failed to download file: ${fileResponse.statusText}`);
                }

                const buffer = await fileResponse.arrayBuffer();
                const filename = await this.app.fileManager.getAvailablePathForAttachment(file.name);
                const tfile = await this.app.vault.createBinary(filename, buffer);
                new Notice(`Downloaded ${file.name}`);
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view) {
                    const link = this.app.fileManager.generateMarkdownLink(tfile, filename);
                    view.editor.replaceSelection(link);
                }
            } catch (err) {
                new Notice(`Failed to download file: ${err.message}`);
            }
        }
    }
}
