# Multi-Sync Implementation Plan

**Status:** Core single-active-engine coordination, manual Cloud mirroring,
shared automatic scheduling, and Cloud cleanup are implemented. The confirmed
Cloud account-change flow is implemented; live account-switch validation remains
pending. IP migration to the coordinator-owned shared manifest and the
destination-root move workflow remain outstanding. Updated October 16, 2026.

The architecture and product behavior are defined in
[`multi-sync-design.md`](multi-sync-design.md). Cloud protocol facts and
user-observable requirements are defined in
[`cloud-sync-design.md`](cloud-sync-design.md). This file tracks implementation
progress and verification.

## Completed

- Added shared path and extension allowlist behavior used by the sync engines,
  retaining the `.note, .spd` default and existing IP path handling.
- Added versioned device-local `SyncExecutionState`, defaulting to the IP engine
  and a disabled automatic interval.
- Added common engine/result types, `IpSyncEngine`, and
  `SingleEngineSyncCoordinator` with active-engine selection, readiness checks,
  one in-flight guard, and manual run routing.
- Added the generic `sync-now` command and retained the legacy IP command with
  active-engine gating. Added engine-selection and shared sync settings UI.
- Implemented Cloud account/session storage, read-only inventory/transfer,
  shared-manifest-backed manual mirror, account binding, local edit protection,
  and synthetic test coverage. See [`cloud-sync-plan.md`](cloud-sync-plan.md)
  for Cloud-specific details.
- Implemented shared scheduled dispatch for the active engine, due-attempt
  pacing, readiness handling, and overlap suppression. User-reported live Cloud
  checks include signed-out handling and main-window notices; see
  [`cloud-sync-plan.md`](cloud-sync-plan.md).
- Implemented Cloud lifecycle notices and guarded remote-deletion cleanup with
  unchanged-local-hash protection, Obsidian Trash, and empty-folder cleanup;
  synthetic tests and controlled-vault validation are recorded in
  [`cloud-sync-plan.md`](cloud-sync-plan.md).
- Kept automatic sync disabled by default. The coordinator supports scheduled
  triggers through a shared interval poller.

## Outstanding

### Coordinator-owned shared manifest for IP and Cloud (next sprint)

- Make the coordinator the common owner and entry point for the shared manifest
  lifecycle used by both engines, rather than having Cloud use the shared store
  while IP continues to use `noteSyncState`.
- Migrate existing `noteSyncState` records into the shared vault manifest and
  remove the legacy settings field only after migration is verified and
  recoverable.
- Route IP reads and writes through the shared manifest, preserving device
  date/size change detection, byte hashes, local-edit protection, restoration
  behavior, and IP's additive/update-only semantics.
- Make the shared history action operate on manifest records for both engines;
  preserve Cloud account binding and ensure an IP run cannot overwrite a
  Cloud-managed destination.
- Add focused tests for migration, interrupted migration, shared history
  behavior, and switching between engines without losing protection. Keep this
  sprint limited to common manifest ownership and IP integration; do not assume
  that general per-file crash recovery is included.

### Shared destination-root move

- Implement the confirmed root-rename workflow from the design: reject moves
  during a run or unsafe source/destination conditions, persist a pending move,
  rename the root, update manifest paths/settings, then clear the pending
  record.
- Recover only the supported old-root-only and new-root-only states; stop with a
  protected error if both or neither root exists.
- Test interrupted moves and preservation of user-created and locally edited
  files. Do not replace this with per-file copying.

### Open scope decisions

- General recovery for ordinary sync operations is not part of the account-
  change checkpointing already implemented. Decide whether to schedule a durable
  recovery record for routine downloads, overwrites, moves, and Trash operations
  as its own sprint, or retain the current fail-closed behavior.
- Cross-device manifest reconciliation and the destination-root move workflow
  remain separate design proposals, not part of the next shared-manifest sprint.
  Decide whether both are still wanted and whether they should be separate
  future sprints. See the design's concurrent-update and destination sections
  for the detailed behavior under consideration.

The standalone Cloud reset is not outstanding: confirmed account change occurs
during interactive sign-in. Its controlled-vault/live account-switch validation
remains pending separate approval, as recorded in
[`cloud-sync-next-steps.md`](cloud-sync-next-steps.md).

## Verification

For each work slice, run focused tests first. Before completion, run `npm test`,
`npm run build`, `npm run lint`, and `git diff --check`. UI changes also require
headless Obsidian verification where the test environment is available; IP
integration must retain existing real-device smoke-test coverage. Cloud
destructive behavior must be validated only with controlled replaceable test
fixtures after its safety tests pass.

Compatibility requirements: IP remains the default engine; only one engine runs
at a time; the legacy IP command ID remains stable; automatic sync remains
disabled by default; Cloud remains remote-read-only; credentials remain
device-local; and both engines retain the shared destination and filters.
