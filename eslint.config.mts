import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'supernote-typescript',
		'scripts',
		// Local Claude Code state (worktrees, etc.) — already gitignored, so
		// a fresh checkout never has it, but a local `eslint .` run in a
		// sandbox with leftover worktrees would otherwise sweep in whatever
		// unrelated projects happen to live under there.
		'.claude',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'manifest.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'vitest.config.ts'],
				},
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- import.meta.dirname types as `any` under the ad hoc single-file program that projectService.allowDefaultProject builds for this file
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// obsidianmd/no-global-this exists for popout-window compatibility in
		// plugin runtime code; it doesn't apply to test setup, where `globalThis`
		// is the only thing available to stand in for the `window` Vitest's node
		// environment doesn't provide. Likewise obsidianmd/no-nodejs-modules
		// (mobile has no Node APIs) doesn't apply here either — test files run
		// under Vitest's real Node process and are never bundled into the
		// plugin (see linkOverlay.test.ts's fs-based fixture read).
		files: ['**/*.test.ts'],
		rules: {
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	{
		// src/render/ is deliberately free of any `obsidian` import - see its
		// files' own header comments and issue #183 (pulling SupernoteView out
		// into a standalone web component) - so it builds DOM with plain
		// document.createElement/.style, not Obsidian's createDiv/createEl/
		// setCssProps helpers these two rules otherwise enforce everywhere
		// else in this plugin.
		files: ['src/render/**/*.ts'],
		rules: {
			'obsidianmd/prefer-create-el': 'off',
			'obsidianmd/no-static-styles-assignment': 'off',
		},
	},
);
