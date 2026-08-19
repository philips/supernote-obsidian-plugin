# Security Audit Plan — Outbound Network Connections

**Primary objective:** verify the plugin makes **no outbound network connections**
except to the user's own Supernote device for the "attach file from device"
features (Wi-Fi file transfer / auto-sync / screen mirroring).

**Secondary objectives** (covered where they fall out of the same work):
path-traversal safety of device-supplied filenames on import (prior art:
GHSA-3gx3), and confirming no dynamic code loading at runtime.

## Scope

Audit the **shipped artifact**, not just source:

- `src/**` (plugin code)
- `supernote-typescript/src/**` (submodule — bundled into `main.js`)
- Built bundles: `main.js`, plus the standalone web-component bundles if
  audited in the same pass (they have intentionally different rules, see below)
- `scripts/**`, `esbuild*.mjs` (build-time only, but verify nothing sneaks
  network code in), `manifest.json`
- `package-lock.json` dependency review

Record the audited commit SHA before starting; re-run the bundle-level checks
after any merge that lands mid-audit.

## Pre-audit recon: current network surface (as of this writing)

A first pass already located every network-capable call site. Verify each is
still accurate, then treat this as the candidate allowlist:

| # | Call site | API | Destination | Feature |
|---|-----------|-----|-------------|---------|
| 1 | `src/deviceFetch.ts` — `fetchFromDevice()` | Obsidian `requestUrl` | `http://{settings.directConnectIP}:8089{path}` | Device "Browse and Access": file list, download, upload |
| 2 | `src/main.ts` (~L1248) → submodule `supernote-typescript/src/mirror.ts` — `fetchMirrorFrame()` | raw `fetch()` | `http://{settings.directConnectIP}:8080/screencast.mjpeg` | Screen mirroring view |

Callers of #1 (must be the only transport for all of these):
`FileListModal.ts` (browse/download/upload), `ImportTodayModal.ts` (today's
notes import), `syncEngine.ts` (auto-sync download), `deviceSync.ts`.

Known non-issues to re-confirm rather than rediscover:

- **`sql.js` WASM** is embedded as base64 at build time
  (`src/render/atelierRenderer.ts` imports `sql.js/dist/sql-wasm.wasm`);
  `wasmBinary` is passed explicitly, so sql.js never fetches it from a CDN.
  Verify no `locateFile`/CDN URL survives in the built bundle.
- **Web components** (`SupernoteViewerElement.ts` ~L1082,
  `SupernoteAtelierViewerElement.ts` ~L438) call `fetch(src)` on their own
  `src` attribute. In the plugin, every instantiation sets
  `viewer.noteData = bytes` directly, short-circuiting `loadBytes()` before
  the fetch — the fetch path only runs in the *standalone* web component,
  where the page author chooses `src`. Verify the plugin never sets a `src`
  attribute, and decide separately whether standalone bundles need a CSP note
  in their docs.
- No `WebSocket` / `EventSource` / `XMLHttpRequest` / `sendBeacon` found in
  `src/`, `scripts/`, or the submodule (re-verify, including bundles).

## Phase 1 — Static source scan

Exhaustive grep over `src/`, `supernote-typescript/src/`, `scripts/`, and
esbuild configs for every network-capable API and indirect channel:

- `fetch(`, `requestUrl`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `sendBeacon`, `navigator.sendBeacon`
- Remote module loading: `import(` with non-static specifier, `importScripts`
  (workers!), `<script>`/`<link>` DOM injection
- String-built URLs: `http://` / `https://` / `ws://` literals, `new URL(`
- Image/media elements assigned remote URLs (`img.src`, `Audio`, etc.)
- Workers (`rasterize.worker.ts`, `pdfBuild.worker.ts`,
  `atelierComposite.worker.ts`): workers have their own `fetch`/`importScripts`
  globals — grep them explicitly
- `postMessage` surfaces that could be reached by other frames/origins

Compare the hit list against the allowlist table above. **Any hit not in the
table is a finding**, including in the submodule (it ships inside `main.js`).

## Phase 2 — Data-flow review of each allowlisted call site

For each entry in the table, trace destination construction and response
handling:

1. **Host provenance:** every host must derive from
   `settings.directConnectIP` (user setting) and nothing else — no device-
   response-supplied host, no link following. `requestUrl` follows redirects
   by default: confirm the device server (or a LAN attacker impersonating it)
   can't cause a redirect to an arbitrary origin. If it can, that's a finding
   (mitigation: none needed for the threat model? document it — an on-LAN
   attacker is already in a strong position — but *record* the decision).
2. **Path construction:** `fetchFromDevice` builds `http://{ip}:8089{path}`
   where `path` comes from parsed device directory listings. Confirm `path`
   can only be a path suffix (it can't escape the host), and audit the
   *write* side: filenames/paths from device listings must be sanitized
   before creating vault files (path traversal history: GHSA-3gx3 — check the
   fix still covers `ImportTodayModal`, `syncEngine`, `FileListModal`
   downloads).
3. **Mirroring:** confirm the raw-`fetch` rationale comment (WKWebView CORS)
   still matches reality and that `directConnectIP:8080` is the only URL
   shape ever passed to `fetchMirrorFrame`.
4. **Settings hygiene:** `directConnectIP` is stored locally and used as-is;
   document that the user pointing it at a non-device host is user choice,
   not plugin exfiltration. Optionally validate its shape (IP/host, no
   scheme or embedded credentials) to prevent footguns.

## Phase 3 — Dependency & bundle audit

- Build `main.js` fresh (`./scripts/build`) and grep the **bundle** for the
  same API list as Phase 1 — this catches network code arriving via
  transitive dependencies (`pdf-lib`, `image-js`, `fast-png`, `sql.js`).
- Confirm `esbuild.config.mjs` externals are exactly `['obsidian', ...]` and
  nothing pulls a runtime CDN loader.
- `npm audit` + review anything it flags for reachability from plugin code.
- Confirm the sql.js wasm is a data blob in the bundle, not a runtime fetch.

## Phase 4 — Runtime verification (headless Obsidian)

Use the existing tooling (`scripts/setup-obsidian-test-env`,
`scripts/obsidian-headless`). Add a preload/patched harness that monkey-patches
*all* egress APIs before the plugin loads and logs every attempt:
`window.fetch`, `XMLHttpRequest.prototype.open`, `WebSocket`,
`EventSource`, and Obsidian's `requestUrl` (patch the module export the
plugin imports — e.g. via a test copy of `main.js` with an instrumented
`obsidian` shim, or a console-injected wrapper before plugin load).

Run a local **mock device server** (plain HTTP on 127.0.0.1:8089/8080) so the
device features can be exercised for real. Scenarios:

1. Plugin load & idle startup (with auto-sync **disabled**) — expect zero
   egress attempts.
2. Auto-sync enabled, interval firing — attempts to `{ip}:8089` only.
3. Open a `.note` / `.spd` file, all export paths (PDF, PNG, markdown) —
   zero egress.
4. File browser modal: list, download, upload — `{ip}:8089` only.
5. Import-today modal — `{ip}:8089` only.
6. Screen mirror view against mock on `:8080` — `{ip}:8080` only.
7. Web-component embed of a vault note (`![[note.note]]`) — zero egress.

Pass criteria: the only logged destinations are the mock device IP on ports
8089/8080, and each appears only in its feature's scenario.

## Phase 5 — Regression guards (recommended follow-ups)

Turn the audit into standing enforcement so this stays true:

- ESLint: `no-restricted-globals`/`no-restricted-properties` banning `fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource` repo-wide, with targeted
  overrides for `deviceFetch.ts` and the submodule mirror path (extend the
  existing pattern that already warns on `fetch`).
- A vitest "network surface" test: build the bundle (or scan `src/` + submodule
  sources if bundle building in CI is too slow) and assert the set of
  network-API occurrences equals the allowlist file list — fails CI when
  someone adds a new egress path without updating it deliberately.
- A short `SECURITY.md` documenting the network posture ("the only hosts this
  plugin contacts are the user-configured device IP on ports 8089/8080, over
  plain HTTP on the LAN") — also useful for the Obsidian plugin review.

## Phase 6 — Report

Findings table: severity / file:line / description / remediation. Explicitly
list granted exceptions (device transfer, mirroring, standalone web-component
`src`). Keep the Phase-1 grep command list in the report so the audit is
reproducible.

## Estimated effort

- Phases 1–3 (static + bundle): a focused half-day.
- Phase 4 (runtime harness + mock device): the harness is most of the work,
  ~a day; scenarios themselves are quick with the existing headless scripts.
- Phases 5–6: half-day to a day depending on how many guards are adopted.
