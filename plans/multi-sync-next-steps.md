# Multi-Sync Next Steps

**Next sprint: minimal ordinary-operation crash recovery.** Design agreed;
implementation and validation remain. Updated October 16, 2026.

Use [`multi-sync-plan.md`](multi-sync-plan.md) for overall implementation
status, [`shared-manifest-plan.md`](shared-manifest-plan.md) for the detailed
product contract and acceptance cases, and
[`multi-sync-design.md`](multi-sync-design.md) for architecture. This handoff
contains only work remaining after the Marie-vault validation; the completed
checks are recorded in the plan.

## Recommended Next Sprint

- Implement the single pending-operation field in the two-slot shared manifest
  and one coordinator-provided executor for IP and Cloud. Commit intent before a
  vault mutation and commit each resulting file record with intent removal;
  change IP from end-of-run to per-file commits. Preserve engine-specific
  inventory, verification, and Cloud's deletion gate.
- Recover before either engine runs, and gate root change and shared history
  clearing while an intent remains. Reconcile only proved old/new states;
  protect unexpected existing bytes and never repeat uncertain Trash. Missing
  vault files warn rather than permanently block: on manual sync, check a fresh
  complete source inventory, download through the normal guarded path if the
  source exists, or retire the record if confirmed absent. An unavailable or
  incomplete source leaves the intent pending. Ordinary IP disappearance stays
  additive outside recovery.
- Disable automatic sync persistently on recovery attention. Write the affected
  path, observed state, and brief next step to the sync log; show a short notice
  pointing to it, or an informative notice when logging is unavailable. Manual
  retries can repeat log entries. `Forget sync history` is blocked while an
  intent is pending; no settings recovery panel or separate recheck command.
- Cover interruption boundaries, ambiguous file states, missing local and source
  files, incomplete inventories, restart, log failure, and shared-action gating
  in focused synthetic tests; then run `npm test`, `npm run build`,
  `npm run lint`, and `git diff --check`. Any live interruption test needs a
  separately approved controlled fixture, not a user's real sync.

## Separate Decisions

- Automatic cross-device manifest reconciliation is deferred. Stale revisions
  continue to fail rather than silently merging histories.
- Keep the real-device IP smoke test for a dedicated device test directory. Do
  not run `npm run test:device-sync` without explicit approval: it uploads a
  fixture that the device API cannot remove. Live Cloud account-switch testing
  awaits a consenting volunteer with a second account; neither is part of the
  recovery implementation sprint.

The completed implementation and Marie-vault results are recorded in
[`multi-sync-plan.md`](multi-sync-plan.md). Do not treat deferred operations as
part of the completed root-change checkpoint.
