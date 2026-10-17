// Minimal ambient declarations for the handful of Node.js builtins a test
// needs (see linkOverlay.test.ts's real-fixture read) — deliberately not the
// full @types/node package: enabling "types": ["node"] project-wide pulls in
// its global scope augmentation, which collides with the DOM lib's
// Window.setTimeout typing that deviceFetch.ts/main.ts rely on
// (window.setTimeout's return type goes ambiguous between DOM's `number` and
// Node's `NodeJS.Timeout` once both are in scope).

declare module 'fs' {
	export function readFileSync(path: string): Uint8Array;
}

declare module 'path' {
	export function join(...segments: string[]): string;
}

declare module 'node:fs/promises' {
	export function chmod(path: string, mode: number): Promise<void>;
	export function mkdir(path: string, options: { recursive?: boolean }): Promise<string | undefined>;
	export function mkdtemp(prefix: string): Promise<string>;
	export function readFile(path: string, encoding: 'utf8'): Promise<string>;
	export function rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
	export function writeFile(
		path: string,
		data: string,
		options: { encoding: 'utf8'; mode?: number },
	): Promise<void>;
}

declare module 'node:os' {
	export function tmpdir(): string;
}

declare module 'node:path' {
	export function dirname(path: string): string;
	export function resolve(...segments: string[]): string;
}

declare module 'node:process' {
	export const env: Record<string, string | undefined>;
}

interface ImportMeta {
	// Node 20.11+ extension, not part of TS's built-in ImportMeta type.
	dirname: string;
}
