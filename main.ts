import { App, TFolder, TFile, Plugin, PluginSettingTab, Setting, TAbstractFile } from 'obsidian';
import { SupernoteX, toImage } from 'supernote-typescript';

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
		this.registerEvent(this.app.vault.on("create", async (file) => {
			if (file instanceof TFolder) {
				return;
			}

			if (file.path.endsWith('.note')) {
				console.log(`got ${file.path}`);
				const note = await this.app.vault.readBinary(file as TFile);
				let sn = new SupernoteX(toBuffer(note));
				let images = await toImage(sn);
				console.log(`image.length ${images.length}`)
				for (let i = 0; i < images.length; i++) {
					let filename = `${file.path}-${i}.png`
					if (this.app.vault.getFileByPath(filename)) {
						console.log(`skipped ${filename}`);
						continue;
					}
					this.app.vault.createBinary(filename, images[i].toBuffer());
					console.log(`wrote ${filename}`);
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