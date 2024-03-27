import { App, Modal, TFolder, TFile, Plugin, PluginSettingTab, Editor, Setting, MarkdownView, WorkspaceLeaf, FileView } from 'obsidian';
import { SupernoteX, toImage, fetchMirrorFrame } from 'supernote-typescript';
import * as path from 'path';

interface SupernotePluginSettings {
	mirrorIP: string;
}

const DEFAULT_SETTINGS: SupernotePluginSettings = {
	mirrorIP: '',
}


function toBuffer(arrayBuffer: ArrayBuffer) {
	const buffer = Buffer.alloc(arrayBuffer.byteLength);
	const view = new Uint8Array(arrayBuffer);
	for (let i = 0; i < buffer.length; ++i) {
		buffer[i] = view[i];
	}
	return buffer;
}

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

export const VIEW_TYPE_SUPERNOTE = "supernote-view";

export class SupernoteView extends FileView {
constructor(leaf: WorkspaceLeaf) {
	super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_SUPERNOTE;
	}

	getDisplayText() {
		return "Example view";
	}

	async onLoadFile(file: TFile): Promise<void> {
		const container = this.containerEl.children[1];
		container.innerHTML = '';
		container.createEl("h1", { text: file.name });

		const note = await this.app.vault.readBinary(file as TFile);
		let sn = new SupernoteX(toBuffer(note));

		let images = await toImage(sn);
		if (images.length > 1) {
			container.createEl("h2", { text: "Table of Contents" });
			const ul = container.createEl("ul");
			for (let i = 0; i < images.length; i++) {
				const a = container.createEl("li").createEl("a");
				a.href = `#page${i+1}`
				a.text = `Page ${i+1}`

			}
		}

		for (let i = 0; i < images.length; i++) {
			const imageDataUrl = images[i].toDataURL();

			if (images.length > 1) {
				const a = container.createEl("a");
				a.id = `page${i+1}`;
				a.createEl("h3", { text: `Page ${i+1}` });
			}

			// Show the text of the page, if any
			if (sn.pages[i].text !== undefined && sn.pages[i].text.length > 0) {
				const text = container.createEl("div");
				text.setAttr('style', 'user-select: text; white-space: pre-line;');
				text.textContent = sn.pages[i].text;
			}

			// Show the img of the page
			const imgElement = container.createEl("img");
			imgElement.src = imageDataUrl;
			imgElement.draggable = true;
			// Create a button to save image to vault
			const saveButton = container.createEl("button", {
				text: "Save Image to Vault",
				cls: "mod-cta",
			});

			saveButton.addEventListener("click", async () => {
				const filename = `${file.path}-${i}.png`; // Set desired filename for the saved image
				await this.app.vault.createBinary(filename, images[i].toBuffer());
			});
		}

	}

	async onClose() {	}
}

export default class SupernotePlugin extends Plugin {
	settings: SupernotePluginSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new SupernoteSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_SUPERNOTE,
			(leaf) => new SupernoteView(leaf)
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
					if (this.settings.mirrorIP.length == 0) {
						throw new Error("IP is unset, please set in Supernote plugin settings")
					}
					let image = await fetchMirrorFrame(`${this.settings.mirrorIP}:8080`);

					this.app.vault.createBinary(filename, image.toBuffer());
					editor.replaceRange(`![[${filename}]]`, editor.getCursor());
				} catch (err: any) {
					new ErrorModal(this.app, this.settings, err).open();
				}
			},
		});

		this.addCommand({
			id: 'attach-all-supernote-note-contents-as-files',
			name: 'Attach all of this Supernote note\'s contents as individual markdown and PNG files',
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
						this.attachNoteFiles(file);
					} catch (err: any) {
						new ErrorModal(this.app, this.settings, err).open();
					}
					return true;
				}

				return false;
			},
		});
	}

	onunload() {

	}

	async attachNoteFiles(file: TFile) {
		const note = await this.app.vault.readBinary(file);
		let sn = new SupernoteX(toBuffer(note));
		let images = await toImage(sn);
		for (let i = 0; i < images.length; i++) {
			let filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.path}-${i}.png`);
			if (this.app.vault.getFileByPath(filename)) {
				continue;
			}
			this.app.vault.createBinary(filename, images[i].toBuffer());
		}

		for (let i = 0; i < sn.pages.length; i++) {
			let filename = await this.app.fileManager.getAvailablePathForAttachment(`${file.path}-${i}.md`);
			if (this.app.vault.getFileByPath(filename)) {
				continue;
			}
			if (sn.pages[i].text !== undefined && sn.pages[i].text.length > 0) {
				this.app.vault.create(filename, sn.pages[i].text);
			}
		}
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


class ErrorModal extends Modal {
	error: Error;
	settings: SupernotePluginSettings;

	constructor(app: App, settings: SupernotePluginSettings, error: Error) {
		super(app);
		this.error = error;
		this.settings = settings;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText(`Error: ${this.error.message}. Is the Supernote connected to Wifi on IP ${this.settings.mirrorIP} and running Screen Mirroring?`);
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SupernoteSettingTab extends PluginSettingTab {
	plugin: SupernotePlugin;

	constructor(app: App, plugin: SupernotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Supernote Mirror IP')
			.setDesc('See Supernote Screen Mirroring documentation for how to enable')
			.addText(text => text
				.setPlaceholder('IP e.g. 192.168.1.2')
				.setValue(this.plugin.settings.mirrorIP)
				.onChange(async (value) => {
					this.plugin.settings.mirrorIP = value;
					await this.plugin.saveSettings();
				}));
	}
}