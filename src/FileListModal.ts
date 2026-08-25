import { App, SuggestModal, Notice, MarkdownView, TFile } from 'obsidian';
import SupernotePlugin from './main';
import { SupernotePluginSettings, IP_VALIDATION_PATTERN, FileBrowserSortOrder } from './settings';
import { parseDeviceDate } from './deviceDate';
import { fetchFromDevice, buildMultipartBody, DEVICE_TRANSFER_TIMEOUT_MS } from './deviceFetch';
import { decodeDeviceFormPathSegment, decodeDevicePathSegment, normalizeDeviceFileName } from './devicePath';
import { ErrorModal } from './ErrorModal';

export interface SupernoteFile {
    name: string;
    size: number;
    date: string;
    uri: string;
    extension: string;
    isDirectory: boolean;
    /** Display names of the file's containing folders, from the device root. */
    directoryNames?: string[];
}

interface SupernoteResponse {
    deviceName: string;
    fileList: SupernoteFile[];
    routeList: { name: string; path: string; }[];
    totalByteSize: number;
    totalMemory: number;
    usedMemory: number;
}

// Fetches and parses one directory listing from the Supernote "Browse and
// Access" HTTP server. Shared by the file-browsing modals below and by
// ImportTodayModal, which walks the whole tree looking for today's notes.
export async function fetchSupernoteDirectory(ip: string, path: string, pathLeafName?: string): Promise<SupernoteFile[]> {
    const response = await fetchFromDevice(ip, path, 'Failed to load file list', { pathLeafName });
    if (!response.ok) {
        throw new Error(`Failed to load file list: Supernote responded with an error (status ${response.status}).`);
    }
    const html = await response.text();

    // Extract the JSON data from the script tag
    const match = html.match(/const json = '(.+?)'/);
    if (!match) {
        throw new Error("Could not find file list data");
    }

    const data = JSON.parse(match[1]) as SupernoteResponse;
    return data.fileList.sort(compareByDirectoryThenNameThenDate);
}

const SYNCABLE_EXTENSION_PATTERN = /\.(note|spd)$/i;

// Recursively walks the whole device tree starting at `path`, collecting
// every `.note`/`.spd` file found. Shared by ImportTodayModal (which further
// filters by date) and the device auto-sync engine (which filters by the
// configured path patterns) — both need the same "list everything once"
// traversal, just with different downstream filtering.
export async function scanDeviceSupernoteTree(
    ip: string,
    path = '/',
    visited: Set<string> = new Set(),
    pathLeafName?: string,
    directoryNames: string[] = [],
    directoryNamesByUri: Map<string, string[]> = new Map(),
): Promise<SupernoteFile[]> {
    if (visited.has(path)) return [];
    visited.add(path);
    if (!directoryNamesByUri.has(path)) directoryNamesByUri.set(path, directoryNames);

    const entries = await fetchSupernoteDirectory(ip, path, pathLeafName);
    const results: SupernoteFile[] = [];

    for (const entry of entries) {
        const parentNames = directoryNamesByUri.get(parentUri(entry.uri))
            ?? decodeUriDirectorySegments(entry.uri);
        if (entry.isDirectory) {
            const entryDirectoryNames = [...parentNames, entry.name];
            directoryNamesByUri.set(entry.uri, entryDirectoryNames);
            results.push(...await scanDeviceSupernoteTree(
                ip,
                entry.uri,
                visited,
                entry.name,
                entryDirectoryNames,
                directoryNamesByUri,
            ));
        } else if (SYNCABLE_EXTENSION_PATTERN.test(entry.name) && isTrustedListingEntry(entry)) {
            results.push({ ...entry, directoryNames: parentNames });
        }
    }
    return results;
}

function parentUri(uri: string): string {
    const lastSlash = uri.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : uri.slice(0, lastSlash);
}

// Fallback for malformed/non-hierarchical listings: a normal scan has display
// names for every parent in directoryNamesByUri, which is required to tell a
// literal `+` from Supernote's `+`-for-space representation.
function decodeUriDirectorySegments(uri: string): string[] {
    return uri.split('/').filter((segment) => segment.length > 0).slice(0, -1).map(decodeDevicePathSegment);
}

// Defense in depth against a device listing whose `name` and `uri` fields
// disagree (e.g. a crafted `uri` carrying `../` traversal segments while
// `name` still passes the syncable-extension filter): only trust entries
// where `uri`'s own filename matches `name`, since every downstream
// consumer of `uri` (deviceUriToVaultPath) assumes the two describe the
// same file.
function uriMatchesName(uri: string, name: string): boolean {
    const segments = uri.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) return false;
    const leaf = segments[segments.length - 1];
    const normalizedName = normalizeDeviceFileName(name);
    return decodeDevicePathSegment(leaf) === normalizedName
        || decodeDeviceFormPathSegment(leaf) === normalizedName;
}

// A "plain" filename: non-empty, not a dot segment, and containing no path
// separators. Complements uriMatchesName (which can't see "\\" — device
// uris are only ever split on "/"): a device-supplied name carrying "/",
// "\\", or being "."/".." is the path-traversal primitive once it reaches
// getAvailablePathForAttachment/vault.createBinary, because Obsidian's path
// normalization turns "\\" into "/" and does not strip ".." segments
// (same class of bug as GHSA-3gx3-r874-5pp4, which fixed the sync write
// path; this guards every path that writes a device-supplied name).
function isPlainFileName(name: string): boolean {
    return name.length > 0 && name !== '.' && name !== '..'
        && !name.includes('/') && !name.includes('\\');
}

// Guard for any consumer about to write a device-listing entry into the
// vault under its own name: the entry must be self-consistent (name matches
// the uri's final segment) *and* the name must be a plain filename.
function isTrustedListingEntry(file: SupernoteFile): boolean {
    return uriMatchesName(file.uri, file.name) && isPlainFileName(file.name);
}

function compareByDirectoryThenNameThenDate(a: SupernoteFile, b: SupernoteFile): number {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

    const nameCompare = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;

    const aDate = parseDeviceDate(a.date);
    const bDate = parseDeviceDate(b.date);
    return (aDate?.getTime() ?? 0) - (bDate?.getTime() ?? 0);
}

export abstract class FileListModal extends SuggestModal<SupernoteFile> {
    settings: SupernotePluginSettings;
    files: SupernoteFile[] = [];
    currentPath = '/';
    protected currentPathLeafName: string | undefined;
    sortOrder: FileBrowserSortOrder;
    private nameSortButton!: HTMLButtonElement;
    private dateSortButton!: HTMLButtonElement;

    constructor(app: App, plugin: SupernotePlugin) {
        super(app);
        this.settings = plugin.settings;
        this.sortOrder = this.settings.fileBrowserSortOrder;
        this.setPlaceholder("Select a file to download or directory to open");
        this.buildSortToolbar();
    }

    onOpen() {
        void super.onOpen();
        this.inputEl.focus();
    }

    private buildSortToolbar() {
        const toolbarEl = createDiv({ cls: 'supernote-toolbar supernote-file-list-toolbar' });
        this.modalEl.prepend(toolbarEl);

        const groupEl = toolbarEl.createDiv({ cls: 'supernote-toolbar-group' });
        groupEl.createSpan({ text: 'Sort by:' });
        this.nameSortButton = groupEl.createEl('button', { type: 'button' });
        this.nameSortButton.addEventListener('click', () => this.toggleSort('name'));
        this.dateSortButton = groupEl.createEl('button', { type: 'button' });
        this.dateSortButton.addEventListener('click', () => this.toggleSort('date'));

        this.updateSortButtons();
    }

    private toggleSort(field: 'name' | 'date') {
        const currentField = this.sortOrder.startsWith('name') ? 'name' : 'date';
        const currentlyAscending = !this.sortOrder.endsWith('desc');
        if (currentField === field) {
            this.sortOrder = `${field}-${currentlyAscending ? 'desc' : 'asc'}` as FileBrowserSortOrder;
        } else {
            // Switching fields: default to the most useful direction for that field.
            this.sortOrder = field === 'name' ? 'name-asc' : 'date-desc';
        }
        this.updateSortButtons();
        this.sortFiles();
        // SuggestModal has no public API to refresh its results; re-dispatching the
        // input event is the standard way plugins trigger it to re-run getSuggestions.
        this.inputEl.dispatchEvent(new Event('input'));
    }

    private updateSortButtons() {
        const field = this.sortOrder.startsWith('name') ? 'name' : 'date';
        const ascending = !this.sortOrder.endsWith('desc');
        const arrow = ascending ? '↑' : '↓';
        this.nameSortButton.textContent = field === 'name' ? `Name ${arrow}` : 'Name';
        this.nameSortButton.toggleClass('is-active', field === 'name');
        this.dateSortButton.textContent = field === 'date' ? `Date ${arrow}` : 'Date';
        this.dateSortButton.toggleClass('is-active', field === 'date');
    }

    private sortFiles() {
        this.files = [...this.files].sort((a, b) => this.compareFiles(a, b));
    }

    private compareFiles(a: SupernoteFile, b: SupernoteFile): number {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

        switch (this.sortOrder) {
            case 'name-desc':
                return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
            case 'date-asc':
            case 'date-desc': {
                const aDate = parseDeviceDate(a.date)?.getTime() ?? 0;
                const bDate = parseDeviceDate(b.date)?.getTime() ?? 0;
                return this.sortOrder === 'date-asc' ? aDate - bDate : bDate - aDate;
            }
            case 'name-asc':
            default:
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        }
    }

    async loadFiles() {
        try {
            this.files = await fetchSupernoteDirectory(this.settings.directConnectIP, this.currentPath, this.currentPathLeafName);
            this.sortFiles();
        } catch (err) {
            this.close();
            new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
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
        // `el` is already the `.suggestion-item` row created by SuggestModal;
        // rendering into a nested `.suggestion-item` div collapses the
        // clickable/hoverable area to just the icon in some themes.
        const iconEl = el.createSpan({ cls: "suggestion-icon" });
        iconEl.textContent = file.isDirectory ? "📁" : "📄";

        const contentEl = el.createDiv({ cls: "suggestion-content" });
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

    onChooseSuggestion(file: SupernoteFile): void {
        if (file.isDirectory) {
            void (async () => {
                // Navigate into directory
                this.currentPath = file.uri;
                this.currentPathLeafName = file.name;
                await this.loadFiles();
                // Reopen the modal to show new directory contents
                this.open();
            })();
        }
    }
}


export class DownloadListModal extends FileListModal {
    constructor(app: App, plugin: SupernotePlugin) {
        super(app, plugin);
    }

    onChooseSuggestion(file: SupernoteFile): void {
        void (async () => {
            if (file.isDirectory) {
                // Navigate into directory
                this.currentPath = file.uri;
                this.currentPathLeafName = file.name;
                await this.loadFiles();
                // Reopen the modal to show new directory contents
                this.open();
            } else {
                try {
                    // Unlike sync/import-today (whose files all pass through
                    // scanDeviceSupernoteTree's isTrustedListingEntry gate),
                    // this browse path hands the listing entry straight to
                    // getAvailablePathForAttachment under its own name — refuse
                    // entries that could smuggle a traversal segment through it
                    // before fetching anything.
                    if (!isTrustedListingEntry(file)) {
                        throw new Error(
                            `Device listing returned inconsistent data for "${file.name}" — refusing to download it.`
                        );
                    }
                    const fileResponse = await fetchFromDevice(this.settings.directConnectIP, file.uri, 'Failed to download file', {
                        timeoutMs: DEVICE_TRANSFER_TIMEOUT_MS,
                        pathLeafName: file.name,
                    });
                    if (!fileResponse.ok) {
                        throw new Error(`Failed to download file: Supernote responded with an error (status ${fileResponse.status}).`);
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
                    new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
                }
            }
        })();
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
            el.addClass("upload-here");
            el.createSpan({
                cls: "suggestion-icon",
                text: "⬆️"
            });
            const content = el.createDiv({ cls: "suggestion-content" });
            content.createDiv({
                cls: "suggestion-title",
                text: "Upload to current directory"
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

    override onChooseSuggestion(file: SupernoteFile): void {
        if (file.name === '[UPLOAD HERE]') {
            void (async () => {
                try {
                    if (!IP_VALIDATION_PATTERN.test(this.settings.directConnectIP)) {
                        new Notice("Invalid supernote IP address configured");
                        return;
                    }

                    // Generate filename with .txt extension for markdown files
                    const uploadFilename = this.currentFile.extension === "md"
                        ? `${this.currentFile.basename}.txt`  // Change extension to .txt
                        : this.currentFile.name;

                    const fileContent = this.currentFile.extension === "md"
                        ? new TextEncoder().encode(await this.app.vault.read(this.currentFile)).buffer
                        : await this.app.vault.readBinary(this.currentFile);

                    const mimeType = this.currentFile.extension === "md"
                        ? 'text/plain'  // Use text/plain for compatibility
                        : 'application/octet-stream';

                    const { body, contentType } = buildMultipartBody('file', uploadFilename, mimeType, fileContent);

                    const response = await fetchFromDevice(this.settings.directConnectIP, this.currentPath, 'Upload failed', {
                        method: "POST",
                        contentType,
                        body,
                        timeoutMs: DEVICE_TRANSFER_TIMEOUT_MS,
                        pathLeafName: this.currentPathLeafName,
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Upload failed: ${errorText}`);
                    }

                    new Notice(`Successfully uploaded ${uploadFilename} to Supernote`);
                    this.close();
                } catch (err) {
                    new ErrorModal(this.app, err instanceof Error ? err : new Error(String(err))).open();
                }
            })();
        } else if (file.isDirectory) {
            // Navigate into directory using parent behavior
            super.onChooseSuggestion(file);
        }
    }
}
