import { App, Component, FileView, TFile } from 'obsidian';
import { SupernoteAtelier, IAtelierSurfaceName } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';
// esbuild's "binary" loader (see esbuild.config.mjs) embeds the wasm file as
// a base64 string and decodes it to a Uint8Array at load time, so sql.js
// never needs to fetch()/readFileSync() a sibling file at runtime — the one
// thing that would otherwise differ between desktop (Node/Electron) and
// mobile (browser) Obsidian.
import sqlWasmBinary from 'sql.js/dist/sql-wasm.wasm';

export const VIEW_TYPE_SUPERNOTE_ATELIER = "supernote-atelier-view";

// Opens a `.spd` file (Supernote Atelier app) via SupernoteAtelier.open()
// (supernote-typescript#33). Shared by every entry point below — parsing the
// sqlite database is the expensive part, so SupernoteAtelierView's layer
// toggle (which needs to re-composite on every checkbox click) does this
// once per file load and reuses the parsed SupernoteAtelier, rather than
// re-parsing on every toggle.
async function openAtelierFile(app: App, file: TFile): Promise<SupernoteAtelier> {
	const buffer = await app.vault.readBinary(file);
	// Uint8Array.buffer is typed ArrayBufferLike (could be a SharedArrayBuffer
	// view) but sql.js's wasmBinary wants a plain ArrayBuffer; slice() always
	// returns one sized to exactly this array's bytes.
	const wasmBinary = sqlWasmBinary.buffer.slice(
		sqlWasmBinary.byteOffset,
		sqlWasmBinary.byteOffset + sqlWasmBinary.byteLength,
	) as ArrayBuffer;
	return SupernoteAtelier.open(new Uint8Array(buffer), { wasmBinary });
}

// Flattens (a subset of) a parsed .spd file's layers via
// SupernoteAtelier.toCompositeImage() (supernote-typescript#37 for the
// `visibleSurfaces` filter), pre-encoded as a data URL for an <img> src.
// `visibleSurfaces` omitted composites every layer; returns null if nothing
// ends up visible (an empty canvas, or every layer toggled off).
async function compositeDataUrl(spd: SupernoteAtelier, visibleSurfaces?: Iterable<IAtelierSurfaceName>): Promise<string | null> {
	const image = await spd.toCompositeImage(visibleSurfaces);
	return image ? encodeDataURL(image) : null;
}

// Opens a `.spd` file and flattens every layer in one step. Used by
// SupernoteAtelierEmbed and VaultWriter's .spd export commands (see
// main.ts), neither of which need repeated re-composites the way
// SupernoteAtelierView's layer toggle does.
export async function renderAtelierCompositeDataUrl(app: App, file: TFile): Promise<string | null> {
	const spd = await openAtelierFile(app, file);
	return compositeDataUrl(spd);
}

// A layer entry to show in the toggle UI. Backed by SupernoteAtelier.layers
// (id + name, best-effort decoded from `ls`) when available; falls back to
// the raw surface table names (e.g. "surface_1") when `ls` didn't decode, so
// the toggle still works, just with less friendly labels.
interface AtelierLayerOption {
	surfaceName: IAtelierSurfaceName;
	label: string;
}

function atelierLayerOptions(spd: SupernoteAtelier): AtelierLayerOption[] {
	if (spd.layers && spd.layers.length > 0) {
		return spd.layers.map((layer) => ({ surfaceName: `surface_${layer.id}`, label: layer.name }));
	}
	return Object.keys(spd.surfaces).map((surfaceName) => ({ surfaceName, label: surfaceName }));
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
// concept, just layered tiles on one canvas. Shows the flattened composite
// as a single image, with a checkbox per layer to show/hide it (skipped
// entirely for a single-layer file — nothing to toggle). No zoom/find
// toolbar yet — see https://github.com/philips/supernote-obsidian-plugin/issues/138.
export class SupernoteAtelierView extends FileView {
	declare file: TFile;

	// Guards against a stale re-composite: if the file is reloaded (or the
	// view closed) while a toggle's re-render is still in flight, its result
	// is discarded instead of overwriting the newer load's image.
	private loadRequestId = 0;
	private imageEl: HTMLImageElement | null = null;

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
		const requestId = ++this.loadRequestId;
		const container = this.contentEl;
		container.empty();
		container.addClass('supernote-atelier-view-content');
		this.imageEl = null;

		let spd: SupernoteAtelier;
		try {
			spd = await openAtelierFile(this.app, file);
		} catch (err) {
			if (requestId === this.loadRequestId) renderAtelierError(container, err);
			return;
		}
		if (requestId !== this.loadRequestId) return;

		const layers = atelierLayerOptions(spd);
		// Every layer starts visible, keyed by surface name so toggling
		// doesn't depend on layers[]/surfaces staying in a stable order.
		const visible = new Set(layers.map((l) => l.surfaceName));

		if (layers.length > 1) {
			this.buildLayerToggle(container, layers, visible, () => { void this.updateImage(spd, visible, requestId); });
		}

		this.imageEl = container.createEl('img', { cls: 'supernote-atelier-image' });
		await this.updateImage(spd, visible, requestId);
	}

	private buildLayerToggle(
		container: HTMLElement,
		layers: AtelierLayerOption[],
		visible: Set<IAtelierSurfaceName>,
		onChange: () => void,
	): void {
		const panel = container.createDiv({ cls: 'supernote-atelier-layers' });
		panel.createSpan({ cls: 'supernote-atelier-layers-label', text: 'Layers' });
		for (const layer of layers) {
			const item = panel.createEl('label', { cls: 'supernote-atelier-layer-item' });
			const checkbox = item.createEl('input', { attr: { type: 'checkbox' } });
			checkbox.checked = true;
			item.createSpan({ text: layer.label });
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					visible.add(layer.surfaceName);
				} else {
					visible.delete(layer.surfaceName);
				}
				onChange();
			});
		}
	}

	// Re-composites just the visible surfaces and swaps the <img> src.
	// Reused for both the initial render and every toggle click, so a toggle
	// mid-render can't leave the image out of sync with the checkboxes.
	private async updateImage(spd: SupernoteAtelier, visible: Set<IAtelierSurfaceName>, requestId: number): Promise<void> {
		let dataUrl: string | null;
		try {
			dataUrl = await compositeDataUrl(spd, visible);
		} catch (err) {
			if (requestId === this.loadRequestId) renderAtelierError(this.contentEl, err);
			return;
		}
		if (requestId !== this.loadRequestId || !this.imageEl) return;

		if (dataUrl === null) {
			this.imageEl.hide();
			this.contentEl.querySelector('.supernote-atelier-empty')?.remove();
			this.contentEl.createDiv({
				cls: 'supernote-atelier-empty',
				text: visible.size === 0 ? 'No layers selected.' : 'This .spd file has no drawn content.',
			});
			return;
		}
		this.contentEl.querySelector('.supernote-atelier-empty')?.remove();
		this.imageEl.show();
		this.imageEl.src = dataUrl;
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
