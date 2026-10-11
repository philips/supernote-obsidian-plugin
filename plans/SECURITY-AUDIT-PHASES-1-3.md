# Security Audit — Phases 1–3 Results (static, data-flow, dependency/bundle)

**Status:** Phases 1–3 complete. Phase 4 (runtime verification) and Phases 5–6
(guards / final report) pending.

**Audited at:**
- Plugin: `49f6518ec954ba1504bf9466228623acdcea8152`
- Submodule `supernote-typescript`: `b95d1fdf2e7b3b037f0343c948572aa237c422f1` (v0.5.4-85-gb95d1fd)
- Bundle: rebuilt fresh via `./scripts/build` (production, minified) during this audit.

## Phase 1 — Static source scan: result

Every network-capable API hit in `src/`, `supernote-typescript/src/`,
`scripts/`, and the esbuild configs is accounted for by the allowlist (details
under Phase 2 / Phase 3). No unlisted hits.

| API | Hits | Verdict |
|---|---|---|
| `requestUrl` | `src/deviceFetch.ts` only | Allowlist #1 ✓ |
| `fetch(` | `supernote-typescript/src/mirror.ts:8`; `src/webcomponent/SupernoteViewerElement.ts:1082`; `src/webcomponent/SupernoteAtelierViewerElement.ts:438` | Allowlist #2 + the two known web-component `src` loads ✓ (fetch path unreachable in plugin — see below) |
| `XMLHttpRequest` / `WebSocket` / `EventSource` / `sendBeacon` | 0 in source | ✓ |
| Dynamic `import(` / `importScripts` / `<script>`/`<link>` DOM injection | 0 | ✓ (no dynamic code loading at runtime) |
| `http(s)://` / `ws://` literals | `deviceFetch.ts:80` (`http://${ip}:8089${path}`), `mirror.ts:4` (`http://${ipAddress}/screencast.mjpeg`), plus `w3.org` SVG-namespace strings | ✓ |
| `new URL(` | 0 | ✓ |
| `img.src` / media elements | `noteRenderer.ts`, `sidebarList.ts`, web components — all assigned `imageDataUrl`/`composite.dataUrl` (data URLs from local renders) | ✓ |
| Workers (`rasterize`, `pdfBuild`, `atelierComposite`) | no `fetch`/`importScripts`/XHR in any worker | ✓ |
| `postMessage` surfaces | only dedicated bundled Workers (`self.onmessage` ↔ `worker.onmessage` pairs); no window-level `message` listener, no iframes, no `window.open` | ✓ |
| `navigator.*` | `navigator.hardwareConcurrency` reads only | ✓ |

Reproducible commands (rerun verbatim for re-audit):

```bash
grep -rn --include='*.ts' --include='*.mts' --include='*.mjs' -E \
  '\bfetch\s*\(|requestUrl|XMLHttpRequest|WebSocket|EventSource|sendBeacon' \
  src/ supernote-typescript/src/ scripts/ esbuild*.mjs
grep -rn --include='*.ts' -E '\bimport\s*\(|importScripts|createElement\(\s*.script.' src/ supernote-typescript/src/
grep -rn --include='*.ts' -E 'https?://|wss?://' src/ supernote-typescript/src/ scripts/
grep -rn --include='*.ts' -E 'new URL\(|\.src\s*=|new Audio|navigator\.' src/ supernote-typescript/src/
grep -rn --include='*.ts' -E 'postMessage|onmessage|iframe|window\.open|FormData' src/ supernote-typescript/src/
```

Non-issues re-confirmed:
- **Web-component `fetch(src)`**: all four plugin-side instantiations
  (`main.ts:824`, `main.ts:1081`, `atelierView.ts:145`, `atelierView.ts:224`)
  set `viewer.noteData = bytes` and never set a `src` attribute;
  `loadBytes()` returns `_noteData` before reaching `getAttribute('src')`.
  The fetch path only runs in the standalone bundles. (CSP note for
  standalone docs: deferred to Phase 6.)
- **Scripts**: `scripts/setup-obsidian-test-env` curls
  `api.github.com/repos/obsidianmd/obsidian-releases` — dev-time only,
  developer-initiated, not part of the shipped artifact.

## Phase 2 — Data-flow review of allowlisted call sites

### #1 `fetchFromDevice()` — `requestUrl` → `http://{ip}:8089{path}`

**Host provenance — verified.** All callers pass `settings.directConnectIP`
verbatim: `FileListModal.ts:30/177/253/351`, `ImportTodayModal.ts:166-170`,
`syncEngine.ts:105/130`. `directConnectIP` is constrained by
`IP_VALIDATION_PATTERN` (`settings.ts:6` — strict dotted-quad IPv4, no scheme,
port, `/`, `@`, or credentials) in both the declarative settings control
(`settings.ts:140`) and the classic settings tab (`settings.ts:257`), plus
`FileListModal.ts:331` before uploads. A hand-edited `data.json` could bypass
the pattern — that is user choice, not plugin exfiltration (recorded).

**Path construction — finding F1 below.** `path` is interpolated unvalidated;
sources are the constant `/` or device-supplied `uri` fields from directory
listings.

**Redirects — finding F2 below.** `requestUrl` follows redirects by default.

**Write side (path traversal, GHSA-3gx3-r874-5pp4):**
- `syncEngine` ✓ — writes only through `deviceUriToVaultPath()`
  (`deviceSync.ts`), which drops `.`/`..` segments and strips
  `\\:*?"<>|` chars; regression tests present in `deviceSync.test.ts`.
- `ImportTodayModal` ✓ — files come via `scanDeviceSupernoteTree()`, whose
  `uriMatchesName` gate requires `name` to equal a single `uri` segment;
  since segments cannot contain `/`, a name reaching
  `buildInsertableContent()` cannot contain slashes, so
  `getAvailablePathForAttachment(name)` is traversal-safe here.
- `DownloadListModal` — finding F3 below (browse listing bypasses the
  `uriMatchesName` gate).

### #2 Screen mirroring — `fetch()` → `http://{ip}:8080/screencast.mjpeg`

**Verified.** Sole call site `main.ts:1248`:
`fetchMirrorFrame(\`${this.settings.directConnectIP}:8080\`)`. No other URL
shape reaches `fetchMirrorFrame`. The WKWebView/CORS rationale comment at
`main.ts:1223-1229` matches reality (mobile fails fast with an actionable
error; only desktop issues the fetch). Response handling parses MJPEG parts
and decodes JPEG bytes locally — no URL/HTML from the response is ever
followed or executed. Same redirect caveat as F2 applies to this `fetch`.

### Settings hygiene

Covered above: IP shape validated at every settings entry point; stored
locally; used as-is. Optional hardening (validating on load, not just on
save) noted but not required by the threat model.

## Phase 3 — Dependency & bundle audit

**Bundle network surface (fresh production `main.js`):** exactly two request
URLs are ever constructed:

```
http://${t}:8089${e}          (deviceFetch — allowlist #1)
http://${t}/screencast.mjpeg  (mirror — allowlist #2)
```

Other occurrences in the bundle, all accounted for:
- `fetch(` ×5: 1 mirror, 2 web-component `src` loads (dead in plugin), 2
  sql.js emscripten-glue wasm fallbacks (dead — see below).
- `XMLHttpRequest` ×9: 7 image-js `Image.load()` URL loaders (bundled but
  never called — plugin only uses `decode(bytes)`), 2 sql.js sync-XHR wasm
  fallbacks (dead).
- `locateFile` ×4 (2 unique × 2 sql.js copies): default-arg glue, never
  evaluated to a fetch when `wasmBinary` is set.
- `eval("require")` ×4: sql.js node-builtin probe (`stream`), inert in the
  renderer, never remote code.
- All `https://…` strings are error-message / PDF-producer text, not
  requests. No `ws://`, no `importScripts`.

**sql.js wasm — verified a data blob, not a runtime fetch.**
`atelierRenderer.ts:18` imports `sql.js/dist/sql-wasm.wasm` (esbuild
`.wasm: 'binary'` loader, inlined in the bundle — same config repeated for
the inline-worker build) and passes `wasmBinary` at both call sites
(`atelierRenderer.ts:33`, worker equivalent). In the bundled minified glue,
the fetch fallback is gated behind `if(!wasmBinary)` and the instantiate path
short-circuits `if (file==wasmBinaryFile && wasmBinary) → new
Uint8Array(wasmBinary)` — confirmed by direct inspection of the minified
code. No CDN URL survives.

**esbuild externals — verified.** `main` config: `obsidian`, `electron`,
codemirror/lezer packages, node builtins — all Obsidian-runtime-provided.
Web-component configs: node builtins only. Nothing externalizes to a CDN or
runtime loader.

**npm audit — 4 high, all dev-only.** `brace-expansion` (×5 paths),
`fast-uri`, `js-yaml`, `nanoid` — every occurrence resolves under the
eslint/typescript-eslint toolchain (`npm ls` verified); none are reachable
from `main.js` (runtime deps: `fast-png`, `image-js`, `pdf-lib`, `sql.js` —
see F4 for the one mislabel).

**Standalone web-component bundles (`dist/supernote-viewer.js`,
`dist/supernote-atelier-viewer.js`):** contain only the intended
`fetch(src)` load plus the same dead image-js/sql.js glue described above.

## Findings

**Remediation status (post-audit pass):** F1, F3, and F4 fixed (see below);
F2 and F5 remain accepted-as-documented. The F3 fix also tightened the
`scanDeviceSupernoteTree` gate with `isPlainFileName` — while implementing it
we noticed the GHSA-3gx3 backstop (`uriMatchesName`, which splits only on
`/`) did not block backslash-laden names (e.g. `..\..\evil.note`) reaching
`getAvailablePathForAttachment` via the import-today flow, since Obsidian's
path normalization turns `\` into `/`; the new gate closes that for sync,
import-today, and the interactive browse/download path alike. Covered by
regression tests in `src/deviceFetch.test.ts` (host pinning) and
`src/FileListModal.test.ts` (entry trust).

| ID | Severity | Location | Description | Remediation |
|---|---|---|---|---|
| F1 | Low (requires hostile device/impersonator) | `src/deviceFetch.ts:80` | Device-supplied `path` is interpolated into `http://${ip}:8089${path}` without enforcing a leading `/`. A crafted listing `uri` like `@evil.example/x` yields `http://ip:8089@evil.example/x`, which WHATWG URL parsing reads as userinfo `ip:8089` + host `evil.example` — the request leaves the device host. Violates the "host derives only from settings" rule even though the attacker needs the device's LAN position. | **Fixed:** `fetchFromDevice` now normalizes `path` to a leading `/` (prefix, so odd-but-benign listings keep working); a leading `/` terminates the URL authority right after the port, pinning the host. Regression tests in `deviceFetch.test.ts`. |
| F2 | Info (documented exception) | `deviceFetch.ts` (requestUrl), `mirror.ts` (fetch) | Both transports follow redirects by default; a hostile "device" could 302 anywhere (notably: exfiltrating an upload's POST body off-LAN). **Decision recorded:** an on-LAN attacker who can impersonate the device is already in a strong position (it can serve arbitrary file bytes that land in the vault; user pointed the plugin at it deliberately). Accept and document; no mitigation planned. Revisit only if a `redirect: 'manual'`-equivalent becomes available in `requestUrl`. | None (documented). Consider noting in future `SECURITY.md`. |
| F3 | Low (defense-in-depth) | `src/FileListModal.ts` `DownloadListModal.onChooseSuggestion` | Interactive browse/download writes via `getAvailablePathForAttachment(file.name)` where `name` comes straight from the listing — this path does **not** pass through `scanDeviceSupernoteTree`'s `uriMatchesName` gate (the GHSA-3gx3 fix covers sync + import-today only). Unknown whether Obsidian's `getAvailablePathForAttachment` sanitizes `../` in the supplied name. | **Fixed:** `isTrustedListingEntry` (uri/name consistency + `isPlainFileName`: non-empty, not `.`/`..`, no `/` or `\`) guards `DownloadListModal` before fetch, and now also strengthens the `scanDeviceSupernoteTree` gate (closing the backslash-name gap noted above for import-today). Regression tests in `FileListModal.test.ts`. |
| F4 | Info (hygiene) | `package.json` | `esbuild-plugin-inline-worker` is listed under `dependencies` but is build-time only (imported solely by `esbuild.config.mjs`); never bundled. | **Fixed:** moved to `devDependencies`, lockfile regenerated. Runtime deps are now exactly `fast-png`, `image-js`, `pdf-lib`, `sql.js`. |
| F5 | Info (verified non-issue) | `npm audit` | 4 high advisories all resolve under devDependency eslint toolchain; none reachable from shipped code. | None. Re-run per release. |

## Conclusions

- **Primary objective (phases 1–3 scope): confirmed.** The only outbound
  network connections constructible from source or bundle are to
  `{settings.directConnectIP}:8089` (browse/download/upload/sync/import) and
  `{settings.directConnectIP}:8080` (screen mirror), with the sole caveats
  F1 (path interpolation, hostile-device-only) and F2 (redirect following,
  accepted).
- No dynamic code loading, no `eval` beyond sql.js's inert node probe, no
  postMessage surfaces reachable cross-origin, wasm embedded as build-time
  data.
- Phase 4 (runtime egress logging + mock device) should specifically cover:
  F3's `getAvailablePathForAttachment` traversal question, and the zero-egress
  scenarios (idle load, note viewing/export, embeds).
