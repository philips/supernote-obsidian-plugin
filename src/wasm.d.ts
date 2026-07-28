// esbuild's "binary" loader (see esbuild.config.mjs) turns a `.wasm` import
// into a decoded Uint8Array at bundle time.
declare module '*.wasm' {
	const bytes: Uint8Array;
	export default bytes;
}
