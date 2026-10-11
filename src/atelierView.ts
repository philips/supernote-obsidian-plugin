import { App, Component, FileView, Platform, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { SupernotePluginSettings } from './settings';
import { ErrorModal } from './ErrorModal';
import { compositeImage, openAtelierBuffer } from './render/atelierRenderer';
// Side-effect import: registers <supernote-atelier-viewer>
// (customElements.define) - mirrors main.ts's identical import of
// SupernoteViewerElement for <supernote-viewer>.
import './webcomponent/SupernoteAtelierViewerElement';
import type { SupernoteAtelierViewerElement } from './webcomponent/SupernoteAtelierViewerElement';

export const VIEW_TYPE_SUPERNOTE_ATELIER = "supernote-atelier-view";

// Opens a `.spd` file already in the vault and flattens every layer into one
// composite data URL - used by VaultWriter's `.spd` export commands (PNG/PDF
// attach in main.ts), which need one flattened image, not the interactive
// layer-toggle viewer SupernoteAtelierView/SupernoteAtelierEmbed below
// provide. Built on render/atelierRenderer.ts's Obsidian-free
// openAtelierBuffer/compositeImage - the same functions
// SupernoteAtelierViewerElement.ts itself uses - with just the vault read
// added on top.
export async function renderAtelierCompositeDataUrl(app: App, file: TFile): Promise<string | null> {
	const buffer = await app.vault.readBinary(file);
	const spd = await openAtelierBuffer(new Uint8Array(buffer));
	const composite = await compositeImage(spd);
	return composite ? composite.dataUrl : null;
}

// Same as renderAtelierCompositeDataUrl, but from raw bytes rather than a
// vault TFile - used by VaultWriter.buildInsertableContent's .spd import
// path, where the file has just been fetched from a device and isn't (yet,
// or ever, depending on the chosen import format) written into the vault.
export async function renderAtelierCompositeFromBuffer(buffer: Uint8Array): Promise<string | null> {
	const spd = await openAtelierBuffer(buffer);
	const composite = await compositeImage(spd);
	return composite ? composite.dataUrl : null;
}

// A thin adapter around <supernote-atelier-viewer> (src/webcomponent/), not
// its own rendering implementation - Obsidian's renderer is a real
// Chromium/WebView browsing context, so the same standalone custom element
// runs here unmodified. Mirrors SupernoteView's own relationship to
// <supernote-viewer> in main.ts: this class's whole job is bridging
// Obsidian specifics the component has no way to know about (reading the
// file's bytes from the vault, the plugin's invertColorsWhenDark setting,
// Obsidian's own icon set, and turning a fatal supernote-atelier-error into
// a real ErrorModal) - everything else (toolbar, zoom, the layer-toggle
// sidebar) now lives in the component, shared with SupernoteAtelierEmbed
// below and with any non-Obsidian consumer of the same element.
export class SupernoteAtelierView extends FileView {
	declare file: TFile;
	settings: SupernotePluginSettings;

	private viewerEl: SupernoteAtelierViewerElement | null = null;

	constructor(leaf: WorkspaceLeaf, settings: SupernotePluginSettings) {
		super(leaf);
		this.settings = settings;
		// Mirrors SupernoteView's own identical registration/reasoning
		// (main.ts) - without this, <supernote-atelier-viewer>'s own
		// light/dark default (the OS-level prefers-color-scheme media
		// feature) is the only thing driving it, independent of
		// Obsidian's own theme setting.
		this.registerEvent(this.app.workspace.on('css-change', () => this.updateDarkAttribute()));
	}

	private updateDarkAttribute(): void {
		this.viewerEl?.setAttribute('dark', document.body.classList.contains('theme-dark') ? 'true' : 'false');
	}

	getViewType() {
		return VIEW_TYPE_SUPERNOTE_ATELIER;
	}

	getDisplayText() {
		if (!this.file) {
			return "Supernote Atelier";
		}
		return this.file.basename;
	}

	getIcon() {
		return "image";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('supernote-atelier-view-content');

		// Same fix, same reason, as SupernoteView's identical assignment
		// (main.ts, issue #148): Obsidian's .view-content has its own top
		// padding, leaving a gap above <supernote-atelier-viewer>'s own
		// sticky toolbar - a negative margin on the toolbar itself would
		// fight position: sticky's positioning math, so this zeroes the
		// ancestor's padding directly instead. On mobile, that same
		// ancestor padding on the left/right/bottom sides is real, wasted
		// width on a screen already tight for legibility.
		this.contentEl.setCssStyles(
			Platform.isMobile
				? { paddingTop: '0', paddingLeft: '0.25em', paddingRight: '0.25em', paddingBottom: '0.25em' }
				: { paddingTop: '0' },
		);
	}

	async onLoadFile(file: TFile): Promise<void> {
		const container = this.contentEl;
		container.empty();
		this.viewerEl = null;

		const bytes = await this.app.vault.readBinary(file);

		const viewer = container.createEl('supernote-atelier-viewer');
		// Obsidian's own icon set (setIcon()/Lucide) instead of the
		// component's own baked-in inline SVGs - same reasoning as
		// SupernoteView's identical assignment (main.ts): the component
		// picked its icon names to already equal Lucide's own, so a host
		// with a real icon system can wire this up with no translation
		// table.
		viewer.iconRenderer = (name, el) => setIcon(el, name);
		if (this.settings.invertColorsWhenDark) {
			viewer.setAttribute('invert-dark', '');
		}
		this.viewerEl = viewer;
		this.updateDarkAttribute();

		// A whole-file failure (recompositing after a layer toggle isn't -
		// see the `recomposite` flag) is worth surfacing as a hard error,
		// the same "pageNumber === undefined means fatal" distinction
		// SupernoteView's own supernote-error listener makes for a `.note`
		// page that fails to rasterize versus the whole note failing to
		// parse.
		viewer.addEventListener('supernote-atelier-error', ((e: CustomEvent<{ error: unknown; recomposite?: boolean }>) => {
			if (!e.detail.recomposite) {
				new ErrorModal(this.app, e.detail.error instanceof Error ? e.detail.error : new Error(String(e.detail.error))).open();
			}
		}) as EventListener);

		// Awaited so this method doesn't resolve until the component has
		// actually reached a stable state (loaded or fatally errored) -
		// mirrors SupernoteView's identical `loaded` await in main.ts.
		const loaded = new Promise<void>((resolve) => {
			viewer.addEventListener('supernote-atelier-load', () => resolve(), { once: true });
			viewer.addEventListener('supernote-atelier-error', ((e: CustomEvent<{ recomposite?: boolean }>) => {
				if (!e.detail.recomposite) resolve();
			}) as EventListener, { once: true });
		});
		viewer.noteData = bytes;
		await loaded;
	}

	async onClose() {
		this.viewerEl = null;
	}
}

// A thin adapter around <supernote-atelier-viewer>, mirroring SupernoteEmbed
// (main.ts) exactly - see that class's own header comment for the full
// rationale, which applies here unchanged. Sizing stays simpler than that
// sibling's: no per-note "always show one full page" ResizeObserver
// tracking, just the existing fixed max-height + resize: vertical frame
// (.supernote-atelier-embed in styles.css) the original hand-rolled version
// of this class already used - `.spd` files are usually small single
// canvases, not multi-page documents, so that fixed-frame behavior was
// never a reported problem worth the extra tracking machinery.
export class SupernoteAtelierEmbed extends Component {
	private viewerEl: SupernoteAtelierViewerElement | null = null;

	constructor(
		private app: App,
		private settings: SupernotePluginSettings,
		private containerEl: HTMLElement,
		private file: TFile,
	) {
		super();
		this.registerEvent(this.app.workspace.on('css-change', () => this.updateDarkAttribute()));
	}

	private updateDarkAttribute(): void {
		this.viewerEl?.setAttribute('dark', document.body.classList.contains('theme-dark') ? 'true' : 'false');
	}

	// Called by Obsidian's embed system once this component has been
	// mounted into context.containerEl - see SupernoteEmbed's identical
	// method (main.ts) for why this is separate from Component's own
	// load().
	loadFile(): void {
		void this.render();
	}

	private async render(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass('supernote-atelier-embed');

		let bytes: ArrayBuffer;
		try {
			bytes = await this.app.vault.readBinary(this.file);
		} catch (err) {
			this.renderError(err);
			return;
		}

		const viewer = this.containerEl.createEl('supernote-atelier-viewer');
		// The outer .supernote-atelier-embed container (styles.css) already
		// supplies a bordered, resizable frame - `bare` drops the
		// component's own default chrome so the two don't visually double
		// up, same as SupernoteEmbed's identical use of `bare`.
		viewer.setAttribute('bare', '');
		if (this.settings.invertColorsWhenDark) {
			viewer.setAttribute('invert-dark', '');
		}
		viewer.iconRenderer = (name, el) => setIcon(el, name);
		this.viewerEl = viewer;
		this.updateDarkAttribute();

		viewer.addEventListener('supernote-atelier-error', ((e: CustomEvent<{ error: unknown; recomposite?: boolean }>) => {
			if (!e.detail.recomposite) this.renderError(e.detail.error);
		}) as EventListener);

		// createEl() above already appended (and thus connected) it -
		// matters for its own queueRender() (see
		// SupernoteAtelierViewerElement.ts), which this kicks off via the
		// fetch-free "bytes already in hand" path. Fire-and-forget, unlike
		// SupernoteAtelierView's own awaited equivalent - nothing here
		// needs to know once loading settles (no ephemeral-state anchor to
		// apply afterward, unlike a `.note` page jump).
		viewer.noteData = bytes;
	}

	private renderError(err: unknown): void {
		this.containerEl.empty();
		this.containerEl.createDiv({
			cls: 'supernote-embed-error',
			text: `Failed to render Supernote Atelier file: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
}
