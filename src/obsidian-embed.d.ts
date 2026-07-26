// app.embedRegistry is how Obsidian core wires up `![[file.ext]]` embeds for
// non-markdown file types (images, PDF, canvas, and now, via this plugin,
// .note) — but it's an internal API, undocumented and absent from the public
// obsidian.d.ts shipped in node_modules/obsidian. This augmentation declares
// just the members this plugin actually calls; shapes taken from
// obsidian-typings (github.com/obsidian-typings/obsidian-typings), the
// community project that reverse-engineers Obsidian's internal API surface,
// and cross-checked against real plugins (e.g. tldraw/obsidian-plugin) that
// already rely on it. Obsidian could change or remove this without notice —
// see the open feature request asking for it to be made official:
// https://forum.obsidian.md/t/fr-new-api-this-app-embedregistry-registerextension-to-allow-embedding-custom-files-inside-our-notes/115280
import type { Component, Events, TFile } from 'obsidian';

declare module 'obsidian' {
	interface EmbedContext {
		app: App;
		containerEl: HTMLElement;
		depth?: number;
		displayMode?: boolean;
		linktext?: string;
		showInline?: boolean;
		sourcePath?: string;
		state?: unknown;
	}

	interface EmbedComponent extends Component {
		loadFile(): void;
	}

	type EmbedCreator = (context: EmbedContext, file: TFile, subpath?: string) => EmbedComponent;

	interface EmbedRegistry extends Events {
		embedByExtension: Record<string, EmbedCreator>;
		registerExtension(extension: string, embedCreator: EmbedCreator): void;
		registerExtensions(extensions: string[], embedCreator: EmbedCreator): void;
		unregisterExtension(extension: string): void;
		unregisterExtensions(extensions: string[]): void;
		getEmbedCreator(file: TFile): EmbedCreator | null;
		isExtensionRegistered(extension: string): boolean;
	}

	interface App {
		embedRegistry?: EmbedRegistry;
	}
}
