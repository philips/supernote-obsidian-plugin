# Releasing this example

This plugin is a prototype/example (see README.md), not a published Obsidian
community plugin, so its "release process" is intentionally lighter-weight
than the main Supernote plugin's: no build step, no CI pipeline, no
community-store submission. `.github/workflows/release.yml` at the repo root
only packages the root plugin's `main.js`/`manifest.json`/`styles.css` — it
never touches this directory, and nothing here needs to.

## When to bump the version

Bump `manifest.json`'s `version` (semver) whenever you change this plugin's
*behavior* in a way a user copying/pulling this folder would notice:

- Settings added, removed, or changed meaning (e.g. a new default prompt)
- Request/response handling changes (endpoint path, payload shape, error
  handling)
- UI changes (Test connection button, progress notice, settings layout)

Skip the bump for pure comments/docs/internal refactors with no observable
change.

There's no enforced scheme (no CI check like the root plugin's "tag must
match manifest.json" gate) — just increment sensibly:

- **Patch** (`0.1.0` -> `0.1.1`): bug fixes, wording/prompt tweaks, no new
  settings or behavior a user has to opt into.
- **Minor** (`0.1.0` -> `0.2.0`): new settings or capabilities, backwards
  compatible.
- **Major** (`0.x.y` -> `1.0.0`): only if this ever graduates from prototype
  to something more official — not expected while it lives under `examples/`.

## How to bump it

Manual, no script (the root `scripts/build`/`version-bump.mjs` are specific
to the root plugin's own `manifest.json`/`versions.json` and don't apply
here — this folder has no `versions.json` at all):

1. Edit `manifest.json`'s `version` field directly.
2. Update README.md if the change affects setup steps, settings, or behavior
   described there.
3. Commit the version bump in the same PR as the change it corresponds to
   — don't queue up multiple changes under one bump.

## Compatibility with the Supernote plugin's hook

This plugin depends on `SupernotePlugin.registerPageTextProcessor` and the
`PageTextProcessorContext` shape (`src/main.ts` at the repo root). That hook
is explicitly undocumented/unstable — see the comment above
`PageTextProcessorContext` in `src/main.ts` — so there's no version-pinning
mechanism between this example and the main plugin today. If a change to
`src/main.ts` alters that contract (field renamed/removed, semantics
changed), update this plugin in the *same* PR, and call it out in the PR
description so both sides land together.

## Pre-release checklist

No build step means "release" is really just "commit," but confirm before
tagging a version bump:

- `node --check main.js` passes (catches syntax errors; there's no
  bundler/TS to catch anything else).
- Manual smoke test in a real vault:
  - Fresh install (or reload) registers with the Supernote plugin —
    `app.plugins.plugins['supernote'].pageTextProcessors.size` is 1.
  - **Test connection** button reports success against a real local server.
  - Running an export/import that produces page text shows the progress
    notice and comes back with transcribed, reflowed Markdown text.
  - Disabling the plugin cleanly unregisters (no errors on next export).

## Distribution

There's no GitHub Release, zip, or community-store listing for this example
— it's distributed by copying or symlinking this folder into a vault's
`.obsidian/plugins/`, tracking whatever's on `main` (see README.md's Setup
section). If you want a stable snapshot to point someone at instead of a
moving `main`, a lightweight git tag (e.g. `llm-page-ocr-v0.2.0`) on the
commit that bumped `manifest.json` is enough — no release workflow needed.
