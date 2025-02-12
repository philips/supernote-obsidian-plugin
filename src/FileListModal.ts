import { App, SuggestModal, Notice, MarkdownView, TFile } from 'obsidian';
import SupernotePlugin from './main';
import { SupernotePluginSettings, IP_VALIDATION_PATTERN } from 'settings';

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

export abstract class FileListModal extends SuggestModal<SupernoteFile> {
    settings: SupernotePluginSettings;
    files: SupernoteFile[] = [];
    currentPath: string = '/';

    constructor(app: App, plugin: SupernotePlugin) {
        super(app);
        this.settings = plugin.settings;
        this.setPlaceholder("Select a file to download or directory to open");
    }

    async loadFiles() {
        try {
            const response = await fetch(`http://${this.settings.directConnectIP}:8089${this.currentPath}`);
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
        iconEl.textContent = file.isDirectory ? "📁" : "📄";

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
        }
    }
}


export class DownloadListModal extends FileListModal {
    constructor(app: App, plugin: SupernotePlugin) {
        super(app, plugin);
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
                const fileResponse = await fetch(`http://${this.settings.directConnectIP}:8089${file.uri}`);
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
export class UploadListModal extends FileListModal {
    private sanitizePath(path: string): string {
        return path.replace(/\/+/g, '/').replace(/\/$/, '') + '/';
    }
    private currentFile: TFile;

    constructor(app: App, plugin: SupernotePlugin, file: TFile) {
        super(app, plugin);
        this.currentFile = file;
    }

    override async getSuggestions(query: string): Promise<SupernoteFile[]> {
        const suggestions = await super.getSuggestions(query);

        // Add "Upload here" option when not at root
        if (this.currentPath !== '/') {
            return [{
                name: '[UPLOAD HERE]',
                size: 0,
                date: '',
                uri: this.currentPath,
                extension: '',
                isDirectory: false
            }, ...suggestions];
        }
        return suggestions;
    }

    override renderSuggestion(file: SupernoteFile, el: HTMLElement) {
        if (file.name === '[UPLOAD HERE]') {
            el.createDiv({ cls: "suggestion-item upload-here" }, container => {
                container.createSpan({
                    cls: "suggestion-icon",
                    text: "⬆️"
                });
                const content = container.createDiv({ cls: "suggestion-content" });
                content.createDiv({
                    cls: "suggestion-title",
                    text: "Upload to current directory"
                });
            });
        } else {
            super.renderSuggestion(file, el);
            if (file.isDirectory) {
                const noteEl = el.querySelector(".suggestion-note");
                if (noteEl) {
                    noteEl.textContent = "Select to enter directory";
                }
            }
        }
    }

    override async onChooseSuggestion(file: SupernoteFile) {
        if (file.name === '[UPLOAD HERE]') {
            try {
                if (!IP_VALIDATION_PATTERN.test(this.settings.directConnectIP)) {
                    new Notice("Invalid Supernote IP address configured");
                    return;
                }

                const uploadURL = `http://${this.settings.directConnectIP}:8089${this.currentPath}`;

                // Create FormData with file payload
                // Generate filename with .txt extension for markdown files
                const uploadFilename = this.currentFile.extension === "md"
                    ? `${this.currentFile.basename}.txt`  // Change extension to .txt
                    : this.currentFile.name;

                const formData = new FormData();
                const fileContent = this.currentFile.extension === "md"
                    ? await this.app.vault.read(this.currentFile)
                    : await this.app.vault.readBinary(this.currentFile);

                const mimeType = this.currentFile.extension === "md"
                    ? 'text/plain'  // Use text/plain for compatibility
                    : 'application/octet-stream';

                // Use modified filename in the FormData
                formData.append('file', new Blob([fileContent], { type: mimeType }), uploadFilename);

                const response = await fetch(uploadURL, {
                    method: "POST",
                    mode: 'cors',
                    body: formData
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Upload failed: ${errorText}`);
                }

                new Notice(`Successfully uploaded ${uploadFilename} to Supernote`);
                this.close();
            } catch (err) {
                new Notice(`Upload failed: ${err.message}`);
                console.error('Upload error:', err);
            }
        } else if (file.isDirectory) {
            // Navigate into directory using parent behavior
            await super.onChooseSuggestion(file);
        }
    }
}
