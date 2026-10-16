# Multi-Sync Next Steps

**Remaining after the Marie-vault folder-change validation:** Close bounded
live-check gaps, then choose any new implementation scope separately. Updated
October 16, 2026.

Use [`multi-sync-plan.md`](multi-sync-plan.md) for overall implementation
status, [`shared-manifest-plan.md`](shared-manifest-plan.md) for the detailed
product contract and acceptance cases, and
[`multi-sync-design.md`](multi-sync-design.md) for architecture. This handoff
contains only work remaining after synthetic and Marie-vault validation.

## Recommended Next Sprint

- In the disposable Marie vault, test **Cancel** with a pre-created empty
  destination: confirm no settings, files, or manifest change. Check the
  selected root and manifest again after a normal Obsidian restart. The
  completed move/leave sequence did not test either live behavior. A normal
  restart is not an interrupted-operation recovery test; do not simulate a
  mid-move crash without a separate controlled fixture and approval.
- Keep the real-device IP smoke test for a dedicated device test directory. Do
  not run `npm run test:device-sync` without explicit approval: it uploads a
  fixture that the device API cannot remove. Live Cloud account-switch
  validation awaits a consenting volunteer with a second account. Neither is
  a prerequisite for the bounded Marie checks above.

## Separate Decisions

- Ordinary per-file write/adoption/Trash crash recovery is deferred. Decide
  separately whether to add an operation journal; until then ambiguous file
  states remain protected rather than guessed.
- Automatic cross-device manifest reconciliation is deferred. Stale revisions
  continue to fail rather than silently merging histories.
- Decide whether ordinary-operation recovery or cross-device reconciliation
  should be the following implementation sprint; this handoff does not approve
  either change.

The completed implementation and Marie-vault results are recorded in
[`multi-sync-plan.md`](multi-sync-plan.md). Do not treat deferred operations as
part of the completed root-change checkpoint.
