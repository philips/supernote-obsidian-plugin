import { FileView, TFile } from 'obsidian';
import { SupernoteAtelier } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';
// esbuild's "binary" loader (see esbuild.config.mjs) embeds the wasm file as
// a base64 string and decodes it to a Uint8Array at load time, so sql.js
// never needs to fetch()/readFileSync() a sibling file at runtime — the one
// thing that would otherwise differ between desktop (Node/Electron) and
// mobile (browser) Obsidian.
import sqlWasmBinary from 'sql.js/dist/sql-wasm.wasm';

export const VIEW_TYPE_SUPERNOTE_ATELIER = "supernote-atelier-view";

// Prototype viewer for `.spd` files (Supernote Atelier app), built on top of
// supernote-typescript's SupernoteAtelier parser
// (https://github.com/philips/supernote-typescript/pull/33). Deliberately
// minimal compared to SupernoteView (the `.note` viewer): `.spd` has no page
// concept, just layered tiles on one canvas, so this just flattens every
// layer with toCompositeImage() and shows the result as a single image. No
// zoom/find/thumbnail toolbar, no embed registration, no vault-writing
// commands yet.
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

		let buffer: ArrayBuffer;
		try {
			buffer = await this.app.vault.readBinary(file);
		} catch (err) {
			this.renderError(container, err);
			return;
		}

		try {
			const wasmBinary = sqlWasmBinary.buffer.slice(
				sqlWasmBinary.byteOffset,
				sqlWasmBinary.byteOffset + sqlWasmBinary.byteLength,
			) as ArrayBuffer;
			const spd = await SupernoteAtelier.open(new Uint8Array(buffer), { wasmBinary });
			const image = await spd.toCompositeImage();
			if (!image) {
				container.createDiv({ cls: 'supernote-atelier-empty', text: 'This .spd file has no drawn content.' });
				return;
			}
			container.createEl('img', { cls: 'supernote-atelier-image', attr: { src: encodeDataURL(image) } });
		} catch (err) {
			this.renderError(container, err);
		}
	}

	private renderError(container: HTMLElement, err: unknown): void {
		container.createDiv({
			cls: 'supernote-embed-error',
			text: `Failed to render Supernote Atelier file: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
}
