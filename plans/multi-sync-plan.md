# Multi-Sync Implementation Plan

**Status:** Core single-active-engine coordination and manual Cloud mirroring
are implemented. Shared automatic scheduling, IP manifest migration, and the
destination-root move workflow remain outstanding. Updated October 14, 2026.

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
- Kept automatic sync disabled by default. The coordinator supports scheduled
  triggers as a type, but no shared interval poller is wired.

## Outstanding

### Shared scheduler

- Implement one registered 60-second poll for the selected engine and shared
  interval setting.
- Track per-engine automatic-attempt timestamps. Initialize missing/invalid
  timestamps without an immediate run; record an attempt before dispatch so a
  failure cannot retry every poll.
- Do not overlap or queue runs. Manual runs must not reset automatic cadence.
- Keep scheduled failures non-blocking and prevent automatic login/modal flows.
- Test active-engine-only dispatch, cadence, startup initialization, failure
  behavior, engine switching, and polling while a run is active.

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

### Cloud follow-up

- Implement start and per-download lifecycle notices and retain the completion
  summary. See [`cloud-sync-next-steps.md`](cloud-sync-next-steps.md).
- Implement two-complete-inventory remote-deletion cleanup with unchanged-local
  hash protection and Obsidian Trash, under the constraints in
  [`cloud-sync-design.md`](cloud-sync-design.md).
- Keep these separately scoped from shared scheduler and migration work.

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
