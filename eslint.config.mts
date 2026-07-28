import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'supernote-typescript',
		'scripts',
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
);
