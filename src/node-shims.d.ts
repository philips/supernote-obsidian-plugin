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

interface ImportMeta {
	// Node 20.11+ extension, not part of TS's built-in ImportMeta type.
	dirname: string;
}
