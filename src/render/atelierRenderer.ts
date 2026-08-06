// Bytes-to-composite helpers with zero `obsidian` dependency - the `.spd`
// (Supernote Atelier) equivalent of noteRenderer.ts's role for `.note`
// files (see that file's own header comment). Obsidian-side callers
// (SupernoteAtelierView/SupernoteAtelierEmbed in atelierView.ts) only add
// the vault-read (app.vault.readBinary) on top; everything else - parsing
// the sqlite database, compositing layers, encoding a data URL - lives here
// so it's shared with SupernoteAtelierViewerElement.ts (the standalone
// `<supernote-atelier-viewer>` web component, which has no Obsidian
// dependency at all) instead of being duplicated between them.
import { SupernoteAtelier, IAtelierSurfaceName } from 'supernote-typescript';
import { encodeDataURL } from 'image-js';
// esbuild's "binary" loader (see esbuild.config.mjs / esbuild.atelier-
// webcomponent.config.mjs) embeds the wasm file as a base64 string and
// decodes it to a Uint8Array at load time, so sql.js never needs to
// fetch()/readFileSync() a sibling file at runtime - the one thing that
// would otherwise differ between desktop (Node/Electron) and mobile
// (browser) Obsidian, or a plain browser hosting the standalone component.
import sqlWasmBinary from 'sql.js/dist/sql-wasm.wasm';

// Opens a `.spd` file (Supernote Atelier app) via SupernoteAtelier.open()
// (supernote-typescript#33), from raw bytes. Obsidian-side callers pass
// bytes already read from the vault or fetched from a device; the
// standalone web component passes bytes from its own `src` fetch or
// `noteData` property.
export async function openAtelierBuffer(buffer: Uint8Array): Promise<SupernoteAtelier> {
	// Uint8Array.buffer is typed ArrayBufferLike (could be a SharedArrayBuffer
	// view) but sql.js's wasmBinary wants a plain ArrayBuffer; slice() always
	// returns one sized to exactly this array's bytes.
	const wasmBinary = sqlWasmBinary.buffer.slice(
		sqlWasmBinary.byteOffset,
		sqlWasmBinary.byteOffset + sqlWasmBinary.byteLength,
	) as ArrayBuffer;
	return SupernoteAtelier.open(buffer, { wasmBinary });
}

export interface AtelierComposite {
	dataUrl: string;
	// Native pixel size of the composited image - every surface in a file
	// shares the same tile-grid bounds (see SupernoteAtelier.toImage()'s doc
	// comment), so these don't change across a layer toggle's re-composites,
	// only the pixels do. Callers use this to size zoom/fit-width without
	// waiting on an <img>'s own (async) decode of the data URL, and (height)
	// to size the layer sidebar's thumbnail boxes (see sidebarList.ts's
	// thumbnailAspectRatio) before any thumbnail has actually loaded.
	width: number;
	height: number;
}

// Flattens (a subset of) a parsed .spd file's layers via
// SupernoteAtelier.toCompositeImage() (supernote-typescript#37 for the
// `visibleSurfaces` filter), pre-encoded as a data URL for an <img> src.
// `visibleSurfaces` omitted composites every layer; returns null if nothing
// ends up visible (an empty canvas, or every layer toggled off/excluded).
export async function compositeImage(spd: SupernoteAtelier, visibleSurfaces?: Iterable<IAtelierSurfaceName>): Promise<AtelierComposite | null> {
	const image = await spd.toCompositeImage(visibleSurfaces);
	return image ? { dataUrl: encodeDataURL(image), width: image.width, height: image.height } : null;
}

// A layer entry to show in a toggle UI. Backed by SupernoteAtelier.layers
// (id + name, best-effort decoded from `ls`) when available; falls back to
// the raw surface table names (e.g. "surface_1") when `ls` didn't decode, so
// the toggle still works, just with less friendly labels.
export interface AtelierLayerOption {
	surfaceName: IAtelierSurfaceName;
	label: string;
}

export function atelierLayerOptions(spd: SupernoteAtelier): AtelierLayerOption[] {
	if (spd.layers && spd.layers.length > 0) {
		return spd.layers.map((layer) => ({ surfaceName: `surface_${layer.id}`, label: layer.name }));
	}
	return Object.keys(spd.surfaces).map((surfaceName) => ({ surfaceName, label: surfaceName }));
}
