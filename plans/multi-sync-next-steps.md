# Multi-Sync Next Steps

**Remaining after the shared lifecycle and folder-change sprint:** Validate the
settings workflow in the disposable Marie vault, then decide any new scope
separately. Updated October 16, 2026.

Use [`multi-sync-plan.md`](multi-sync-plan.md) for overall implementation
status, [`shared-manifest-plan.md`](shared-manifest-plan.md) for the detailed
product contract and acceptance cases, and
[`multi-sync-design.md`](multi-sync-design.md) for architecture. This handoff
contains only work remaining after synthetic lifecycle and root-change tests.

## Next Validation

- Use the currently open, disposable Marie vault and replaceable test folders.
  Build and reload the plugin, create an empty target folder, then exercise
  destination selection, cancel, contents move, and leave-behind in Obsidian
  settings. Drive and inspect the app through the available CLI or VS Code
  Obsidian MCP; ask the user for any interaction those tools cannot perform. No
  Linux headless host is required.
- Check vault files, settings, and manifest slots before and after each choice:
  cancel changes nothing; move carries all content and managed history into the
  selected folder while leaving the old folder itself; leave-behind preserves
  old files while starting with empty managed history at the new path. Use only
  disposable data and restart Obsidian to check the selected root and recovery
  state.
- Keep the existing real-device IP smoke test for a dedicated device test
  directory. No device is available now. Do not run `npm run test:device-sync`
  without explicit approval: it uploads a fixture that the device API cannot
  remove. Live Cloud account-switch validation awaits a consenting volunteer
  with a second account.

## Separate Decisions

- Ordinary per-file write/adoption/Trash crash recovery is deferred. Decide
  separately whether to add an operation journal; until then ambiguous file
  states remain protected rather than guessed.
- Automatic cross-device manifest reconciliation is deferred. Stale revisions
  continue to fail rather than silently merging histories.

The completed implementation and test status are recorded in
[`multi-sync-plan.md`](multi-sync-plan.md). Do not treat deferred operations as
part of the completed root-change checkpoint.
