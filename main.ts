import { App, Modal, TFolder, TFile, Plugin, Editor, MarkdownView } from 'obsidian';
import { SupernoteX, toImage, fetchMirrorFrame } from 'supernote-typescript';

// Remember to rename these classes and interfaces!

interface SupernotePluginSettings {
}

const DEFAULT_SETTINGS: SupernotePluginSettings = {
}


function toBuffer(arrayBuffer: ArrayBuffer) {
	const buffer = Buffer.alloc(arrayBuffer.byteLength);
	const view = new Uint8Array(arrayBuffer);
	for (let i = 0; i < buffer.length; ++i) {
		buffer[i] = view[i];
	}
	return buffer;
}

export default class SupernotePlugin extends Plugin {
	settings: SupernotePluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'insert-supernote-mirror-image',
			name: 'Insert a Supernote mirror image',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				try {
					let image = await fetchMirrorFrame('192.168.86.243:8080');
					let filename = 'mirror.png';
					editor.getDoc();
					this.app.vault.createBinary(filename, image.toBuffer());
					editor.replaceRange(`![[${filename}]]`, editor.getCursor());
				} catch (err: any) {
					new ErrorModal(this.app, err).open();
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

	constructor(app: App, error: Error) {
		super(app);
		this.error = error;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText(this.error.message);
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}