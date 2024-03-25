import { App, Modal, TFolder, TFile, Plugin, PluginSettingTab, Editor, Setting, MarkdownView } from 'obsidian';
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

export default class SupernotePlugin extends Plugin {
	settings: SupernotePluginSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new SupernoteSettingTab(this.app, this));

		this.addCommand({
			id: 'insert-supernote-mirror-image',
			name: 'Insert a Supernote mirror image',
			editorCallback: async (editor: Editor, view: MarkdownView) => {

				// generate a unique filename for the mirror based on the current note path
				let ts = generateTimestamp();
				const f = this.app.workspace.activeEditor?.file;
				const p = f?.parent?.path || '';
				const b = f?.basename || '';
				const fp = path.join(p, b);
				let filename = `${fp}-supernote-mirror-${ts}.png`;

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

		this.registerEvent(this.app.vault.on("create", async (file) => {
			if (file instanceof TFolder) {
				return;
			}

			if (file.path.endsWith('.note')) {
				console.log(`got ${file.path}`);
				const note = await this.app.vault.readBinary(file as TFile);
				let sn = new SupernoteX(toBuffer(note));
				let images = await toImage(sn);
				for (let i = 0; i < images.length; i++) {
					let filename = `${file.path}-${i}.png`
					if (this.app.vault.getFileByPath(filename)) {
						console.log(`skipped ${filename}`);
						continue;
					}
					this.app.vault.createBinary(filename, images[i].toBuffer());
					console.log(`wrote ${filename}`);
				}

				for (let i = 0; i < sn.pages.length; i++) {
					let filename = `${file.path}-${i}.md`
					if (this.app.vault.getFileByPath(filename)) {
						console.log(`skipped ${filename}`);
						continue;
					}
					if (sn.pages[i].text !== undefined && sn.pages[i].text.length > 0) {
						this.app.vault.create(filename, sn.pages[i].text);
						console.log(`wrote ${filename}`);
					}
				}
			}
		}));
	}

	onunload() {

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