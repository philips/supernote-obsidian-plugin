# Supernote Obsidian plugin

## Project overview

- An Obsidian community plugin (TypeScript → bundled JavaScript) for viewing,
  exporting, and importing Supernote `*.note` files, plus device screen
  mirroring and Wi-Fi file transfer.
- Entry point: `src/main.ts`, compiled to `main.js` (esbuild bundle) and
  loaded by Obsidian.
- Release artifacts: `main.js`, `manifest.json`, `styles.css`.
- Plugin ID is `supernote` (see `manifest.json`) — never change this; it's
  Obsidian's stable identifier for installs, settings storage, and the
  community plugin listing.

## Environment & tooling

- Package manager: npm. Bundler: esbuild (`esbuild.config.mjs`).
- **This plugin depends on a git submodule, not a plain npm dependency** —
  see `CLAUDE.md` for the full explanation of why (`supernote-typescript/`,
  developed alongside this plugin) and exactly what not to do about it
  (no `node_modules` symlink, no `npm link`, no `file:` dependency — all three
  were tried and broke the build in confusing ways). Run `./scripts/build` to
  set everything up; it handles submodule init/update and both builds.
- Tests: vitest (`npm test`), scoped to `src/**/*.test.ts` only — the
  submodule has its own separate test suite.

### Common commands

```bash
./scripts/build   # first-time setup: submodule + full build
npm run dev       # esbuild watch mode
npm run build     # tsc typecheck + production esbuild bundle (minified)
npm run lint      # eslint .
npm test          # vitest run
```

## Linting

- ESLint 9 flat config (`eslint.config.mts`) with `eslint-plugin-obsidianmd`'s
  recommended (type-checked) rules — catches real Obsidian API misuse, not
  just generic TypeScript issues.
- `npm run lint` must exit clean (0 errors) for CI. A handful of rules are
  intentionally left as **warnings, not fixed**, because fixing them has a
  real cost or risk beyond what a lint pass should take on:
  - `obsidianmd/commands/no-plugin-id-in-command-id` (7 commands) — renaming
    a command ID changes its Obsidian-internal ID and orphans any user's
    saved hotkey bindings. Don't rename existing command IDs; this is a
    one-way door.
  - `no-restricted-globals` on `fetch` in `deviceFetch.ts` — this file
    implements its own timeout via `AbortController`, which
    `requestUrl` (Obsidian's suggested replacement) doesn't support the same
    way. Migrating needs its own design pass, not a mechanical swap.
  - `obsidianmd/settings-tab/prefer-setting-definitions` — adopting the
    declarative settings API (Obsidian 1.13+) is a real rewrite of
    `settings.ts`, not a lint fix.
- Obsidian's `loadPdfJs()` returns `any` by design (it exposes whatever pdf.js
  build is bundled with the user's Obsidian install, unpinned). `main.ts`
  defines local `PdfJs*` interfaces covering just the subset of that API this
  plugin uses, rather than depending on a specific `pdfjs-dist` version that
  may not match what's actually loaded at runtime. Extend those interfaces if
  you touch more of the pdf.js surface — don't reach back for `any`.

## File & folder conventions

- Source lives in `src/`, one concern per file:
  - `main.ts` — plugin entry point, the note-viewing `FileView` (PDF
    rendering, zoom, text layer, find-in-note), PDF/image export.
  - `settings.ts` / `customDictionary.ts` — settings tab and the custom
    dictionary sub-UI.
  - `FileListModal.ts` / `ImportTodayModal.ts` — device browse/upload/
    download and today's-notes import modals.
  - `deviceFetch.ts` / `deviceDate.ts` — device HTTP client and date parsing,
    each with a co-located `*.test.ts`.
  - `myworker.worker.ts` — the rasterization Web Worker (bundled via
    `esbuild-plugin-inline-worker`).
- Don't commit build artifacts (`main.js`, `node_modules/`) — `main.js` is
  gitignored and shipped only via GitHub releases.

## Manifest & versioning

- `manifest.json`: keep `minAppVersion` accurate to what the code actually
  calls — `eslint-plugin-obsidianmd`'s `no-unsupported-api` rule checks this
  against `@since` tags in Obsidian's own type declarations and will error on
  a mismatch.
- There's no separate beta manifest. BRAT and Obsidian's updater both fetch
  `manifest.json` from the release assets, not the repo, so beta releases
  just tag a `manifest.json` version with a semver pre-release suffix (e.g.
  `3.0.2-beta.1`) — see the "Releasing" section in `README.md`.
- `npm run version` bumps `manifest.json` and appends to `versions.json`
  (`version-bump.mjs`), skipping the write if that version is already
  present — don't hand-edit `versions.json` (a hand-edit is exactly what
  produced a bare syntax error there before; let the script own that file).

## Security, privacy, and compliance

Follow Obsidian's Developer Policies and Plugin Guidelines:
https://docs.obsidian.md/Developer+policies,
https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines. In particular
for this plugin: device IP/connection settings stay local (no telemetry),
and the only network calls are to the user's own Supernote device on their
own LAN.

## References

- `CLAUDE.md` — the submodule build setup, in full detail.
- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
