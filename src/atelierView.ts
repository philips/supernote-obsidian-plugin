import { App, Component, FileView, TFile } from 'obsidian';
import { SupernoteAtelier } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';
// esbuild's "binary" loader (see esbuild.config.mjs) embeds the wasm file as
// a base64 string and decodes it to a Uint8Array at load time, so sql.js
// never needs to fetch()/readFileSync() a sibling file at runtime — the one
// thing that would otherwise differ between desktop (Node/Electron) and
// mobile (browser) Obsidian.
import sqlWasmBinary from 'sql.js/dist/sql-wasm.wasm';

export const VIEW_TYPE_SUPERNOTE_ATELIER = "supernote-atelier-view";

// Opens a `.spd` file (Supernote Atelier app) and flattens every layer into
// one composite image via SupernoteAtelier.toCompositeImage()
// (supernote-typescript#33), pre-encoded as a data URL for an <img> src.
// Shared by SupernoteAtelierView, SupernoteAtelierEmbed, and VaultWriter's
// .spd export commands (see main.ts). Returns null if the file has no drawn
// content anywhere (an empty canvas).
export async function renderAtelierCompositeDataUrl(app: App, file: TFile): Promise<string | null> {
	const buffer = await app.vault.readBinary(file);
	// Uint8Array.buffer is typed ArrayBufferLike (could be a SharedArrayBuffer
	// view) but sql.js's wasmBinary wants a plain ArrayBuffer; slice() always
	// returns one sized to exactly this array's bytes.
	const wasmBinary = sqlWasmBinary.buffer.slice(
		sqlWasmBinary.byteOffset,
		sqlWasmBinary.byteOffset + sqlWasmBinary.byteLength,
	) as ArrayBuffer;
	const spd = await SupernoteAtelier.open(new Uint8Array(buffer), { wasmBinary });
	const image = await spd.toCompositeImage();
	return image ? encodeDataURL(image) : null;
}

function renderAtelierError(container: HTMLElement, err: unknown): void {
	container.empty();
	container.createDiv({
		cls: 'supernote-embed-error',
		text: `Failed to render Supernote Atelier file: ${err instanceof Error ? err.message : String(err)}`,
	});
}

// Viewer for `.spd` files (Supernote Atelier app). Deliberately minimal
// compared to SupernoteView (the `.note` viewer): `.spd` has no page
// concept, just layered tiles on one canvas, so this just shows the
// flattened composite as a single image. No zoom/find/thumbnail toolbar, no
// layer on/off toggle, no vault-writing commands yet — see
// https://github.com/philips/supernote-obsidian-plugin/issues/138.
export class SupernoteAtelierView extends FileView {
	declare file: TFile;

	getViewType() {
		return VIEW_TYPE_SUPERNOTE_ATELIER;
	}

	getDisplayText() {
		return this.file ? this.file.basename : "Supernote Atelier";
	}

	getIcon() {
		return "image";
	}

	async onLoadFile(file: TFile): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('supernote-atelier-view-content');

		let dataUrl: string | null;
		try {
			dataUrl = await renderAtelierCompositeDataUrl(this.app, file);
		} catch (err) {
			renderAtelierError(container, err);
			return;
		}

		if (dataUrl === null) {
			container.createDiv({ cls: 'supernote-atelier-empty', text: 'This .spd file has no drawn content.' });
			return;
		}
		container.createEl('img', { cls: 'supernote-atelier-image', attr: { src: dataUrl } });
	}
}

// Renders a `.spd` file into an `![[example.spd]]` embed via Obsidian's
// undocumented app.embedRegistry API (see registration in
// SupernotePlugin.onload, and SupernoteEmbed's doc comment in main.ts for
// why this internal API is the only option). Simpler than SupernoteEmbed:
// `.spd` has no pages to navigate, so this is just the composite image, no
// toolbar.
export class SupernoteAtelierEmbed extends Component {
	private destroyed = false;

	constructor(
		private app: App,
		private containerEl: HTMLElement,
		private file: TFile,
	) {
		super();
	}

	// Called by Obsidian's embed system once this component has been mounted
	// into context.containerEl (separate from Component's own load(), since
	// the same embed component can be asked to loadFile() again if the
	// underlying link changes without being recreated).
	loadFile(): void {
		void this.render();
	}

	onunload(): void {
		this.destroyed = true;
	}

	private async render(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass('supernote-atelier-embed');

		let dataUrl: string | null;
		try {
			dataUrl = await renderAtelierCompositeDataUrl(this.app, this.file);
		} catch (err) {
			if (!this.destroyed) renderAtelierError(this.containerEl, err);
			return;
		}
		if (this.destroyed) return;

		if (dataUrl === null) {
			this.containerEl.createDiv({ cls: 'supernote-atelier-empty', text: 'This .spd file has no drawn content.' });
			return;
		}
		this.containerEl.createEl('img', { cls: 'supernote-atelier-image', attr: { src: dataUrl } });
	}
}
