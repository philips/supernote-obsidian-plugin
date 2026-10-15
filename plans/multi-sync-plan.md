# Multi-Sync Implementation Plan

**Status:** Core single-active-engine coordination and manual Cloud mirroring
are implemented. Shared automatic scheduling and Cloud cleanup are implemented;
IP manifest migration and the destination-root move workflow remain outstanding.
The explicit Cloud mirror reset is also outstanding. Updated October 15, 2026.

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

### Shared manifest migration and IP compatibility

- Migrate legacy `noteSyncState` records to the shared vault manifest without
  losing existing IP change-detection or local-edit protection.
- Remove the legacy settings field only after verified migration succeeds.
- Preserve Cloud account binding across IP runs and ensure IP cannot overwrite
  Cloud-managed destinations until it uses the shared manifest.
- Validate migration recovery and IP regression behavior with focused tests and
  the existing device-sync smoke-test surface.

### Shared destination-root move

- Implement the confirmed root-rename workflow from the design: reject moves
  during a run or unsafe source/destination conditions, persist a pending move,
  rename the root, update manifest paths/settings, then clear the pending
  record.
- Recover only the supported old-root-only and new-root-only states; stop with a
  protected error if both or neither root exists.
- Test interrupted moves and preservation of user-created and locally edited
  files. Do not replace this with per-file copying.

### Explicit Cloud mirror reset

- Implement the confirmed destructive account/device-binding reset described in
  [`multi-sync-design.md`](multi-sync-design.md) and tracked in
  [`cloud-sync-next-steps.md`](cloud-sync-next-steps.md). Preserve edited files,
  trash only unchanged managed files, and clear the Cloud binding and shared
  manifest without disturbing unrelated content or IP settings.

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
