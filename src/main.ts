import { installAtPolyfill } from './polyfills';
import { App, Modal, TFile, Plugin, Editor, MarkdownView, WorkspaceLeaf, FileView } from 'obsidian';
import { SupernotePluginSettings, SupernoteSettingTab, DEFAULT_SETTINGS } from './settings';
import { SupernoteX, fetchMirrorFrame } from 'supernote-typescript';
import { DownloadListModal, UploadListModal } from './FileListModal';
import { jsPDF } from 'jspdf';
import { SupernoteWorkerMessage, SupernoteWorkerResponse } from './myworker.worker';
import Worker from 'myworker.worker';
import { replaceTextWithCustomDictionary } from './customDictionary';

function generateTimestamp(): string {
	const date = new Date();
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0'); // Add leading zero for single-digit months
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');

	const timestamp = `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
	return timestamp;
}

function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
    // Remove data URL prefix (e.g., "data:image/png;base64,")
    const base64 = dataUrl.split(',')[1];
    // Convert base64 to binary string
    const binaryString = atob(base64);
    // Create buffer and view
    const bytes = new Uint8Array(binaryString.length);
    // Convert binary string to buffer
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Processes the Supernote text based on the provided settings.
 * 
 * @param text - The input text to be processed.
 * @param settings - The settings for the Supernote plugin.
 * @returns The processed text.
 */
function processSupernoteText(text: string, settings: SupernotePluginSettings): string {
	let processedText = text;
	if (settings.isCustomDictionaryEnabled) {
		processedText = replaceTextWithCustomDictionary(processedText, settings.customDictionary);
	}
	return processedText;
}

export class WorkerPool {
    private workers: Worker[];

    constructor(private maxWorkers: number = navigator.hardwareConcurrency) {
        this.workers = Array(maxWorkers).fill(null).map(() =>
            new Worker()
        );
    }

    private processChunk(worker: Worker, note: SupernoteX, pageNumbers: number[]): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            worker.onmessage = (e: MessageEvent<SupernoteWorkerResponse>) => {
                const duration = Date.now() - startTime;
                //console.log(`Processed pages ${pageNumbers.join(',')} in ${duration}ms`);

                if (e.data.error) {
                    reject(new Error(e.data.error));
                } else {
                    resolve(e.data.images);
                }
            };

            worker.onerror = (error) => {
                console.error('Worker error:', error);
                reject(error);
            };

            const message: SupernoteWorkerMessage = {
                type: 'convert',
                note,
                pageNumbers
            };

            worker.postMessage(message);
        });
    }

    async processPages(note: SupernoteX, allPageNumbers: number[]): Promise<any[]> {
        //console.time('Total processing time');

        // Split pages into chunks based on number of workers
        const chunkSize = Math.ceil(allPageNumbers.length / this.workers.length);
        const chunks: number[][] = [];

        for (let i = 0; i < allPageNumbers.length; i += chunkSize) {
            chunks.push(allPageNumbers.slice(i, i + chunkSize));
        }

        //console.log(`Processing ${allPageNumbers.length} pages in ${chunks.length} chunks`);

        // Process chunks in parallel using available workers
        const results = await Promise.all(
            chunks.map((chunk, index) =>
                this.processChunk(this.workers[index % this.workers.length], note, chunk)
            )
        );

        //console.timeEnd('Total processing time');
        return results.flat();
    }

    terminate() {
        this.workers.forEach(worker => worker.terminate());
        this.workers = [];
    }
}

export class ImageConverter {
    private workerPool: WorkerPool;

    constructor(maxWorkers = navigator.hardwareConcurrency) {  // Default to 4 workers
        this.workerPool = new WorkerPool(maxWorkers);
    }

    async convertToImages(note: SupernoteX, pageNumbers?: number[]): Promise<any[]> {
        const pages = pageNumbers ?? Array.from({length: note.pages.length}, (_, i) => i+1);
        const results = await this.workerPool.processPages(note, pages);
        return results;
    }

    terminate() {
        this.workerPool.terminate();
    }
}

class VaultWriter {
	app: App;
	settings: SupernotePluginSettings;

	constructor(app: App, settings: SupernotePluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	async writeMarkdownFile(file: TFile, sn: SupernoteX, imgs: TFile[] | null) {
		let content = '';

		// Generate a non-conflicting filename - it has a bit of a race but that is OK
		let filename = `${file.parent?.path}/${file.basename}.md`;
		let i = 0;
		while (this.app.vault.getFileByPath(filename) !== null) {
			filename = `${file.parent?.path}/${file.basename} ${++i}.md`;
		}

		content = this.app.fileManager.generateMarkdownLink(file, filename);
		content += '\n';

		for (let i = 0; i < sn.pages.length; i++) {
			content += `## Page ${i + 1}\n\n`
			if (sn.pages[i].text !== undefined && sn.pages[i].text.length > 0) {
				content += `${processSupernoteText(sn.pages[i].text, this.settings)}\n`;
			}
			if (imgs) {
				let subpath = '';
				if (this.settings.invertColorsWhenDark) {
					subpath = '#supernote-invert-dark';
				}

				const link = this.app.fileManager.generateMarkdownLink(imgs[i], filename, subpath);
				content += `${link}\n`;
			}
		}

		this.app.vault.create(filename, content);
	}

	async writeImageFiles(file: TFile, sn: SupernoteX): Promise<TFile[]> {
		let images: string[] = [];

		const converter = new ImageConverter();
		try {
			images = await converter.convertToImages(sn);
		} finally {
			// Clean up the worker when done
			converter.terminate();
		}

		let imgs: TFile[] = [];
		for (let i = 0; i < images.length; i++) {
			let filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}-${i}.png`);
			const buffer = dataUrlToBuffer(images[i]);
			imgs.push(await this.app.vault.createBinary(filename, buffer));
		}
		return imgs;
	}

	async attachMarkdownFile(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		let sn = new SupernoteX(new Uint8Array(note));

		this.writeMarkdownFile(file, sn, null);
	}

	async attachNoteFiles(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		let sn = new SupernoteX(new Uint8Array(note));

		const imgs = await this.writeImageFiles(file, sn);
		this.writeMarkdownFile(file, sn, imgs);
	}

	async exportToPDF(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		let sn = new SupernoteX(new Uint8Array(note));

		// Create PDF document
		const pdf = new jsPDF({
			orientation: 'portrait',
			unit: 'px',
			format: [sn.pageWidth, sn.pageHeight] // A4 size in pixels
		});

		// Convert note pages to images
		const converter = new ImageConverter();
		let images: string[] = [];
		try {
			images = await converter.convertToImages(sn);
		} finally {
			converter.terminate();
		}

		// Add each page to PDF
		for (let i = 0; i < images.length; i++) {
			if (i > 0) {
				pdf.addPage();
			}

			if (sn.pages[i].text !== undefined && sn.pages[i].text.length > 0) {
				pdf.setFontSize(100);
				pdf.setTextColor(0, 0, 0, 0); // Transparent text
				pdf.text(processSupernoteText(sn.pages[i].text, this.settings), 20, 20, { maxWidth: sn.pageWidth });
				pdf.setTextColor(0, 0, 0, 1);
			}

			// Add image first
			pdf.addImage(images[i], 'PNG', 0, 0, sn.pageWidth, sn.pageHeight);
		}

		// Generate filename and save
		let filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}.pdf`);
		const pdfOutput = pdf.output('arraybuffer');
		await this.app.vault.createBinary(filename, pdfOutput);
	}
}

let vw: VaultWriter;
export const VIEW_TYPE_SUPERNOTE = "supernote-view";

export class SupernoteView extends FileView {
	file: TFile;
	settings: SupernotePluginSettings;
	constructor(leaf: WorkspaceLeaf, settings: SupernotePluginSettings) {
		super(leaf);
		this.settings = settings;
	}

	getViewType() {
		return VIEW_TYPE_SUPERNOTE;
	}

	getDisplayText() {
		if (!this.file) {
			return "Supernote View"
		}
		return this.file.basename;
	}

	async onLoadFile(file: TFile): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl("h1", { text: file.name });

		const note = await this.app.vault.readBinary(file);
		let sn = new SupernoteX(new Uint8Array(note));
		let images: string[] = [];

		const converter = new ImageConverter();
		try {
			images = await converter.convertToImages(sn);
		} finally {
			// Clean up the worker when done
			converter.terminate();
		}

		if (this.settings.showExportButtons) {
			const exportNoteBtn = container.createEl("p").createEl("button", {
				text: "Attach markdown to vault",
				cls: "mod-cta",
			});

			exportNoteBtn.addEventListener("click", async () => {
				vw.attachMarkdownFile(file);
			});

			const exportAllBtn = container.createEl("p").createEl("button", {
				text: "Attach markdown and images to vault",
				cls: "mod-cta",
			});

			exportAllBtn.addEventListener("click", async () => {
				vw.attachNoteFiles(file);
			});

			const exportPDFBtn = container.createEl("p").createEl("button", {
				text: "Attach as PDF",
				cls: "mod-cta",
			});

			exportPDFBtn.addEventListener("click", async () => {
				vw.exportToPDF(file);
			});
		}

		if (images.length > 1 && this.settings.showTOC) {
			const atoc = container.createEl("a");
			atoc.id = "toc";
			atoc.createEl("h2", { text: "Table of contents" });
			const ul = container.createEl("ul");
			for (let i = 0; i < images.length; i++) {
				const a = container.createEl("li").createEl("a");
				a.href = `#page${i + 1}`
				a.text = `Page ${i + 1}`
			}
		}

		for (let i = 0; i < images.length; i++) {
			const imageDataUrl = images[i];

			const pageContainer = container.createEl("div", {
				cls: 'page-container',
			})
			pageContainer.setAttr('style', 'max-width: ' + this.settings.noteImageMaxDim + 'px;')

			if (images.length > 1 && this.settings.showTOC) {
				const a = pageContainer.createEl("a");
				a.id = `page${i + 1}`;
				a.href = "#toc";
				a.createEl("h3", { text: `Page ${i + 1}` });
			}

			// Show the text of the page, if any
			if (sn.pages[i].text !== undefined && sn.pages[i].text.length > 0) {
				let text;

				// If Collapse Text setting is enabled, place the text into an HTML `details` element
				if (this.settings.collapseRecognizedText) {
					text = pageContainer.createEl('details', {
						text: '\n' + processSupernoteText(sn.pages[i].text,this.settings),
						cls: 'page-recognized-text',
					});
					text.createEl('summary', { text: `Page ${i + 1} Recognized Text` });
				} else {
					text = pageContainer.createEl('div', {
						text: processSupernoteText(sn.pages[i].text, this.settings),
						cls: 'page-recognized-text',
					});
				}
			}

			// Show the img of the page
			const imgElement = pageContainer.createEl("img");
			imgElement.src = imageDataUrl;
			if (this.settings.invertColorsWhenDark) {
				imgElement.addClass("supernote-invert-dark");
			}
			imgElement.setAttr('style', 'max-height: ' + this.settings.noteImageMaxDim + 'px;')
			imgElement.draggable = true;

			// Create a button to save image to vault
			if (this.settings.showExportButtons) {
				const saveButton = pageContainer.createEl("button", {
					text: "Save image to vault",
					cls: "mod-cta",
				});

				saveButton.addEventListener("click", async () => {
					const filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.basename}-${i}.png`);
					const buffer = dataUrlToBuffer(imageDataUrl);
					await this.app.vault.createBinary(filename, buffer);
				});
			}
		}
	}

	async onClose() { }
}

export default class SupernotePlugin extends Plugin {
	settings: SupernotePluginSettings;

	async onload() {
        // Install polyfills before any other code runs
        installAtPolyfill();

		await this.loadSettings();
		vw = new VaultWriter(this.app, this.settings);

		this.addSettingTab(new SupernoteSettingTab(this.app, this));

		this.addCommand({
			id: 'attach-supernote-file-from-device',
			name: 'Attach Supernote file from device',
			callback: () => {
				if (this.settings.directConnectIP.length === 0) {
					new DirectConnectErrorModal(this.app, this.settings, new Error("IP is unset")).open();
					return;
				}
				new DownloadListModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'upload-file-to-supernote',
			name: 'Upload the current file to a Supernote device',
			callback: () => {
				if (this.settings.directConnectIP.length === 0) {
					new DirectConnectErrorModal(this.app, this.settings, new Error("IP is unset")).open();
					return;
				}
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					new UploadListModal(this.app, this, activeFile).open();
				}
			}
		});

		this.registerView(
			VIEW_TYPE_SUPERNOTE,
			(leaf) => new SupernoteView(leaf, this.settings)
		);
		this.registerExtensions(['note'], VIEW_TYPE_SUPERNOTE);

		this.addCommand({
			id: 'insert-supernote-screen-mirror-image',
			name: 'Insert a Supernote screen mirroring image as attachment',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				// generate a unique filename for the mirror based on the current note path
				let ts = generateTimestamp();
				const f = this.app.workspace.activeEditor?.file?.basename || '';
				const filename = await this.app.fileManager.getAvailablePathForAttachment(`supernote-mirror-${f}-${ts}.png`);

				try {
					if (this.settings.directConnectIP.length == 0) {
						throw new Error("IP is unset, please set in Supernote plugin settings")
					}
					let image = await fetchMirrorFrame(`${this.settings.directConnectIP}:8080`);

					const file = await this.app.vault.createBinary(filename, image.toBuffer());
					const path = this.app.workspace.activeEditor?.file?.path;
					if (!path) {
						throw new Error("Active file path is null")
					}
					const link = this.app.fileManager.generateMarkdownLink(file, path);
					editor.replaceRange(link, editor.getCursor());
				} catch (err: any) {
					new DirectConnectErrorModal(this.app, this.settings, err).open();
				}
			},
		});

		this.addCommand({
			id: 'export-supernote-note-as-files',
			name: 'Export this Supernote note as a markdown and PNG files as attachments',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "note") {
					if (checking) {
						return true
					}
					try {
						if (!file) {
							throw new Error("No file to attach");
						}
						vw.attachNoteFiles(file);
					} catch (err: any) {
						new ErrorModal(this.app, err).open();
					}
					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: 'export-supernote-note-as-pdf',
			name: 'Export this Supernote note as PDF',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "note") {
					if (checking) {
						return true
					}
					try {
						if (!file) {
							throw new Error("No file to attach");
						}
						vw.exportToPDF(file);
					} catch (err: any) {
						new ErrorModal(this.app, err).open();
					}
					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: 'export-supernote-note-as-markdown',
			name: 'Export this Supernote note as a markdown file attachment',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const ext = file?.extension;

				if (ext === "note") {
					if (checking) {
						return true
					}
					try {
						if (!file) {
							throw new Error("No file to attach");
						}
						vw.attachMarkdownFile(file);
					} catch (err: any) {
						new ErrorModal(this.app, err).open();
					}
					return true;
				}

				return false;
			},
		});
	}

	onunload() {

	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SUPERNOTE);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			if (!leaf) {
				throw new Error("leaf is null");
			}
			await leaf.setViewState({ type: VIEW_TYPE_SUPERNOTE, active: true });
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


class DirectConnectErrorModal extends Modal {
	error: Error;
	public settings: SupernotePluginSettings;

	constructor(app: App, settings: SupernotePluginSettings, error: Error) {
		super(app);
		this.error = error;
		this.settings = settings;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(`Error: ${this.error.message}. Is the Supernote connected to Wifi on IP ${this.settings.directConnectIP} and running Screen Mirroring?`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ErrorModal extends Modal {
	error: Error;
	settings: SupernotePluginSettings;

	constructor(app: App, error: Error) {
		super(app);
		this.error = error;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(`Error: ${this.error.message}.`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
