# Multi-Sync Implementation Plan

**Status:** Core single-active-engine coordination, manual Cloud mirroring,
shared automatic scheduling, and Cloud cleanup are implemented. The confirmed
Cloud account-change flow is implemented; live account-switch validation remains
pending. IP migration to the coordinator-owned shared manifest and an explicit
shared sync-folder change workflow remain outstanding. Sync implementation files
are now organized under `src/sync/`, with shared, `directIP/`, and
`supernoteCloud/` modules. Updated October 16, 2026.

The architecture and product behavior are defined in
[`multi-sync-design.md`](multi-sync-design.md). Cloud protocol facts and
user-observable requirements are defined in
[`cloud-sync-design.md`](cloud-sync-design.md). This file tracks implementation
progress and verification. The focused strategy, staged work, and acceptance
criteria for both engines and root changes live in
[`shared-manifest-plan.md`](shared-manifest-plan.md).

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
- Organized sync implementation and co-located tests under `src/sync/`,
  separating shared coordination and manifest code from `directIP/` and
  `supernoteCloud/` engine code.

## Outstanding

### Shared manifest and sync-folder change (recommended next sprint)

- Follow [`shared-manifest-plan.md`](shared-manifest-plan.md) for the
  coordinator-owned lifecycle, safe `noteSyncState` migration, IP and Cloud
  integration, common history clearing, and regression gates.
- Replace immediate text-setting changes with a folder selection and an explicit
  choice: move the entire existing mirror and update its paths, or leave the old
  files untouched/unmanaged and start with an empty manifest at the new root. Do
  not archive or automatically reuse old history.
- The root-change operation is shared by both engines. Implement and verify its
  confirmation, conflict checks, and interrupted-change handling separately from
  ordinary per-file crash recovery.
- The sprint handoff and ordered acceptance checklist are in
  [`multi-sync-next-steps.md`](multi-sync-next-steps.md).

### Open scope decisions

- **Ordinary-operation crash recovery (deferred Multi-Sync decision):** the
  account-change checkpoint covers only confirmed account changes, and the next
  shared-manifest block does not make file mutations atomic with manifest
  commits. An interruption after a new file is written can leave it untracked;
  after an overwrite, the new bytes can look like a local edit against the old
  hash; after Cloud Trash, the old record can still claim a missing file. Decide
  in a separate sprint whether to persist a before/after checkpoint for creates,
  overwrites, safe adoptions or moves, and Cloud Trash, or retain the current
  protect/stop-and-resolve behavior. If approved, test interruption at each
  file/manifest boundary and restart with mutation not started, completed, and
  ambiguous; recover only when hashes and paths prove the outcome, never
  overwrite a user edit or repeat an uncertain Trash. Small file size and cheap
  retransfer alone do not resolve these ownership ambiguities.
- Automatic cross-device manifest reconciliation remains a separate proposal.
  The shared-manifest work retains stale-revision rejection instead of silently
  merging concurrent changes from multiple machines.

The standalone Cloud reset is not outstanding: confirmed account change occurs
during interactive sign-in. Live account-switch validation remains unresolved
until a volunteer with a second Cloud account can test it with explicit consent;
the current user has no second account. This does not block work on the
shared-manifest block. The Cloud validation record is in
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
