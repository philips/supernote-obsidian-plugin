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
// (supernote-typescript#33), from raw bytes — a device fetch not yet
// written into the vault (see renderAtelierCompositeFromBuffer), as well as
// openAtelierFile below (an already-in-vault TFile).
async function openAtelierBuffer(buffer: Uint8Array): Promise<SupernoteAtelier> {
	// Uint8Array.buffer is typed ArrayBufferLike (could be a SharedArrayBuffer
	// view) but sql.js's wasmBinary wants a plain ArrayBuffer; slice() always
	// returns one sized to exactly this array's bytes.
	const wasmBinary = sqlWasmBinary.buffer.slice(
		sqlWasmBinary.byteOffset,
		sqlWasmBinary.byteOffset + sqlWasmBinary.byteLength,
	) as ArrayBuffer;
	return SupernoteAtelier.open(buffer, { wasmBinary });
}

// Opens a `.spd` file already in the vault. Shared by SupernoteAtelierView,
// SupernoteAtelierEmbed, and VaultWriter's .spd export commands — parsing
// the sqlite database is the expensive part, so SupernoteAtelierView's
// layer toggle (which needs to re-composite on every checkbox click) does
// this once per file load and reuses the parsed SupernoteAtelier, rather
// than re-parsing on every toggle.
async function openAtelierFile(app: App, file: TFile): Promise<SupernoteAtelier> {
	const buffer = await app.vault.readBinary(file);
	return openAtelierBuffer(new Uint8Array(buffer));
}

interface AtelierComposite {
	dataUrl: string;
	// Native pixel width of the composited image — every surface in a file
	// shares the same tile-grid bounds (see SupernoteAtelier.toImage()'s doc
	// comment), so this doesn't change across a layer toggle's re-composites,
	// only the pixels do. SupernoteAtelierView uses it to size zoom/fit-width
	// without waiting on the <img>'s own (async) decode of the data URL.
	width: number;
}

// Flattens (a subset of) a parsed .spd file's layers via
// SupernoteAtelier.toCompositeImage() (supernote-typescript#37 for the
// `visibleSurfaces` filter), pre-encoded as a data URL for an <img> src.
// `visibleSurfaces` omitted composites every layer; returns null if nothing
// ends up visible (an empty canvas, or every layer toggled off).
async function compositeImage(spd: SupernoteAtelier, visibleSurfaces?: Iterable<IAtelierSurfaceName>): Promise<AtelierComposite | null> {
	const image = await spd.toCompositeImage(visibleSurfaces);
	return image ? { dataUrl: encodeDataURL(image), width: image.width } : null;
}

// Opens a `.spd` file already in the vault and flattens every layer in one
// step. Used by SupernoteAtelierEmbed and VaultWriter's .spd export
// commands, neither of which need repeated re-composites the way
// SupernoteAtelierView's layer toggle does.
export async function renderAtelierCompositeDataUrl(app: App, file: TFile): Promise<string | null> {
	const spd = await openAtelierFile(app, file);
	const composite = await compositeImage(spd);
	return composite ? composite.dataUrl : null;
}

// Same as renderAtelierCompositeDataUrl, but from raw bytes rather than a
// vault TFile — used by VaultWriter.buildInsertableContent's .spd import
// path, where the file has just been fetched from a device and isn't (yet,
// or ever, depending on the chosen import format) written into the vault.
export async function renderAtelierCompositeFromBuffer(buffer: Uint8Array): Promise<string | null> {
	const spd = await openAtelierBuffer(buffer);
	const composite = await compositeImage(spd);
	return composite ? composite.dataUrl : null;
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
// as a single image, with a checkbox per layer to show/hide it (skipped for
// a single-layer file — nothing to toggle) and zoom controls (ctrl+scroll,
// buttons, fit-width). Unlike SupernoteView's zoom, which re-rasterizes each
// page at the new scale for crispness, `.spd`'s composite is already a fixed
// bitmap (no vector/text source to re-render from) — zooming is just a CSS
// width change on the <img>, no debounce or redraw needed.
export class SupernoteAtelierView extends FileView {
	declare file: TFile;

	// Guards against a stale re-composite: if the file is reloaded (or the
	// view closed) while a toggle's re-render is still in flight, its result
	// is discarded instead of overwriting the newer load's image.
	private loadRequestId = 0;
	private imageEl: HTMLImageElement | null = null;

	// Native pixel size of the current composite (see AtelierComposite);
	// invariant across layer toggles, so this is only (re)set on first load,
	// not every re-composite. 0 until the first successful render.
	private nativeWidth = 0;

	// 1 = one image pixel per CSS pixel, same "100%" meaning SupernoteView's
	// zoom uses.
	private zoomScale = 1;
	private fitWidthEnabled = true;
	private zoomLabelEl: HTMLElement | null = null;
	private fitWidthBtn: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;

	getViewType() {
		return VIEW_TYPE_SUPERNOTE_ATELIER;
	}

	getDisplayText() {
		return this.file ? this.file.basename : "Supernote Atelier";
	}

	getIcon() {
		return "image";
	}

	async onOpen(): Promise<void> {
		// Ctrl+scroll to zoom, same gesture/rationale as SupernoteView's (see
		// its own onOpen for why plain scroll is left alone and metaKey isn't
		// treated as a zoom gesture). contentEl persists across file loads, so
		// this only needs registering once.
		this.registerDomEvent(this.contentEl, 'wheel', (evt: WheelEvent) => {
			if (!evt.ctrlKey) return;
			evt.preventDefault();
			const factor = Math.min(1.05, Math.max(0.95, 1 - evt.deltaY * 0.01));
			this.setZoom(this.zoomScale * factor);
		}, { passive: false });

		// No debounce needed here (unlike SupernoteView's resize handling):
		// re-fitting is just recomputing one CSS width, not re-rasterizing.
		this.resizeObserver = new ResizeObserver(() => {
			if (this.fitWidthEnabled) this.applyFitWidth();
		});
		this.resizeObserver.observe(this.contentEl);
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
	}

	async onLoadFile(file: TFile): Promise<void> {
		const requestId = ++this.loadRequestId;
		const container = this.contentEl;
		container.empty();
		container.addClass('supernote-atelier-view-content');
		this.imageEl = null;
		this.nativeWidth = 0;
		this.zoomScale = 1;
		this.fitWidthEnabled = true;

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

		this.buildToolbar(container);
		if (layers.length > 1) {
			this.buildLayerToggle(container, layers, visible, () => { void this.updateImage(spd, visible, requestId); });
		}

		this.imageEl = container.createEl('img', { cls: 'supernote-atelier-image' });
		await this.updateImage(spd, visible, requestId);
	}

	private buildToolbar(container: HTMLElement): void {
		const toolbar = container.createDiv({ cls: 'supernote-toolbar' });
		const zoomGroup = toolbar.createDiv({ cls: 'supernote-toolbar-group' });

		const zoomOutBtn = zoomGroup.createEl('button', { text: '−', cls: 'clickable-icon', attr: { 'aria-label': 'Zoom out' } });
		this.zoomLabelEl = zoomGroup.createSpan({ cls: 'supernote-zoom-label', text: '100%' });
		const zoomInBtn = zoomGroup.createEl('button', { text: '+', cls: 'clickable-icon', attr: { 'aria-label': 'Zoom in' } });
		const zoomResetBtn = zoomGroup.createEl('button', { text: 'Reset zoom', cls: 'clickable-icon' });
		this.fitWidthBtn = zoomGroup.createEl('button', { text: 'Fit width', cls: 'clickable-icon', attr: { 'aria-label': 'Fit image to viewport width' } });

		zoomOutBtn.addEventListener('click', () => this.setZoom(this.zoomScale / 1.25));
		zoomInBtn.addEventListener('click', () => this.setZoom(this.zoomScale * 1.25));
		zoomResetBtn.addEventListener('click', () => this.setZoom(1));
		this.fitWidthBtn.addEventListener('click', () => {
			this.fitWidthEnabled = !this.fitWidthEnabled;
			if (this.fitWidthEnabled) this.applyFitWidth();
			this.updateFitWidthButton();
		});
		this.updateFitWidthButton();
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

	private setZoom(newScale: number, opts: { manual?: boolean } = {}): void {
		const isManual = opts.manual !== false;
		if (isManual) {
			this.fitWidthEnabled = false;
			this.updateFitWidthButton();
		}

		// Same split SupernoteView's setZoom uses: fit-width can legitimately
		// need a wide range (a small native image on a large/high-DPI
		// display), while manual zoom gets a tighter sanity cap.
		const ceiling = isManual ? 5 : 20;
		this.zoomScale = Math.min(ceiling, Math.max(0.05, newScale));
		this.zoomLabelEl?.setText(`${Math.round(this.zoomScale * 100)}%`);

		if (this.imageEl && this.nativeWidth > 0) {
			this.imageEl.setCssStyles({ width: `${this.nativeWidth * this.zoomScale}px`, maxWidth: 'none' });
		}
	}

	// Scales the image so its rendered width matches however much horizontal
	// space is actually available in the view's content area.
	private applyFitWidth(): void {
		if (this.nativeWidth <= 0) return;
		const container = this.contentEl;
		const style = getComputedStyle(container);
		const availableWidth = container.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
		if (availableWidth <= 0) return;
		this.setZoom(availableWidth / this.nativeWidth, { manual: false });
	}

	private updateFitWidthButton(): void {
		this.fitWidthBtn?.toggleClass('is-active', this.fitWidthEnabled);
	}

	// Re-composites just the visible surfaces and swaps the <img> src.
	// Reused for both the initial render and every toggle click, so a toggle
	// mid-render can't leave the image out of sync with the checkboxes.
	private async updateImage(spd: SupernoteAtelier, visible: Set<IAtelierSurfaceName>, requestId: number): Promise<void> {
		let composite: AtelierComposite | null;
		try {
			composite = await compositeImage(spd, visible);
		} catch (err) {
			if (requestId === this.loadRequestId) renderAtelierError(this.contentEl, err);
			return;
		}
		if (requestId !== this.loadRequestId || !this.imageEl) return;

		if (composite === null) {
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
		this.imageEl.src = composite.dataUrl;

		// Composite dimensions are shared across every surface in the file
		// (see AtelierComposite's doc comment), so this only needs setting —
		// and fit-width only needs applying — once, on the load that first
		// discovers them, not on every subsequent layer-toggle re-composite.
		if (this.nativeWidth === 0) {
			this.nativeWidth = composite.width;
			this.applyFitWidth();
		}
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
