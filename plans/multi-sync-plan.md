# Multi-Sync Implementation Plan

**Status:** Single-active-engine coordination, Cloud/IP shared-manifest access,
shared non-destructive history clearing, and the explicit sync-folder change
workflow are implemented with synthetic tests. The move, leave-behind, and
cancel flows and persistence across a normal restart were validated in the
disposable Marie vault. Minimal ordinary-operation recovery is designed but not
implemented. Live account-switch and device tests remain pending. Sync
implementation files are organized under `src/sync/`. Updated October 16, 2026.

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
- Added additive migration of legacy IP records into the two-slot shared
  manifest by recorded vault path. Existing shared records and Cloud binding
  take precedence on collisions. IP runs use shared destination hashes to
  protect local edits, preserve binding, update the source snapshot after safe
  writes or byte-identical adoption, and stop during pending Cloud account
  changes. The temporary IP/Cloud ownership block is removed. Synthetic tests
  cover edited, missing, unchanged, and identical-byte cross-engine paths.
- Last verified shared-manifest/IP slice: `npm test` (481 passing),
  `npm run build`, `npm run lint` (0 errors, 14 existing warnings), and
  `git diff --check`. No real-device or user-vault mutation was run.
- Both engines now use a root-bound manifest service. IP planning uses an
  in-memory map, leaving persisted `noteSyncState` for migration only. Shared
  history clearing runs under the coordinator lock, retains account binding and
  vault files, and records a retirement marker so a failed settings save cannot
  re-import cleared history on restart.
- The settings action stages vault-folder selection, offers move or leave-behind
  where appropriate, and holds the coordinator lock through confirmation. Root
  changes use a device-local checkpoint: move the old root's contents into an
  existing empty target while leaving the old folder in place, with record path
  rewrite; or start a fresh bound manifest with old slots retired. Ambiguous
  interrupted changes stop sync; synthetic tests cover restart, conflicts,
  locally edited and unrelated files, and settings/rename failures.
- Shared lifecycle/folder-change verification: `npm test` (499 passing),
  `npm run build`, `npm run lint` (0 errors, 14 existing warnings), and
  `git diff --check`. No real-device or user-vault mutation was run.
- Corrected move-contents workflow: `npm test` (502 passing), `npm run build`,
  `npm run lint` (0 errors, 14 existing warnings), and `git diff --check`.
  Folder changes were exercised with synthetic vault fixtures only.
- Fixed the live move failure caused by Obsidian not indexing the hidden
  `.supernote-sync` directory: the adapter renames that directory while indexed
  entries still use the Vault API. Checkpoint recovery covers the hidden entry.
  Verification: `npm test` (504 passing), `npm run build`, `npm run lint` (0
  errors, 14 existing warnings), and `git diff --check`.
- Validated the settings move/leave choices in the disposable Marie vault: moved
  the old root's contents to a pre-created empty B folder, leaving the original
  folder; verified nine files including both manifest slots and a current
  manifest with five paths rewritten to B. A manual Cloud sync from B returned
  five unchanged and no reported issues. Returned to the original empty folder
  with **Leave files and start fresh**; B retained seven user files, its old
  manifest slots were retired, and the new bound manifest began with zero
  records. A second manual Cloud sync downloaded five files with no reported
  issues and committed five records under the original root. An earlier generic
  `Cloud sync failed` log entry was not diagnosed; the later successful runs do
  not explain it. Interrupted-operation recovery was covered synthetically, but
  was not exercised in the live vault.
- Selected a pre-created empty folder in the live change-location modal and
  pressed **Cancel**. Saved plugin settings and all seven files under the
  original root, including hidden manifest data, matched their pre-test hashes;
  the new folder stayed empty. After a normal Obsidian restart, the plugin still
  selected the original root and settings and files still matched. The
  disposable empty folder was removed. This did not test interruption during a
  move or sync.

## Outstanding

### Next implementation: ordinary-operation recovery

1. Extend and validate the existing two-slot shared manifest with one pending
   create, overwrite, identical-byte adoption, or Cloud Trash intent. Keep its
   root, path, source identity, and before/after hashes sufficient to compare
   current bytes with either known state. Reject invalid or stale state; retain
   the existing root-change and account-change checkpoints separately.
2. Build one coordinator-supplied operation executor for both engines: commit
   intent before mutation, guard the vault path, then commit the per-file record
   and clear intent together. Convert IP from its end-of-run batch commit to
   per-file commits. Keep inventory and verified transfer decisions within each
   engine. Cloud's matching-inventory deletion gate remains mandatory.
3. Resolve pending operations under the coordinator lock before another sync,
   folder change, or history clear. Reconcile only proved old/new byte states;
   block on unexpected existing bytes without modifying them or repeating
   uncertain Trash. For a missing vault file, warn and use a fresh verified
   source check on manual sync: download normally if present; retire the record
   if confirmed absent; retain the intent on incomplete or unreachable source.
   Do not change IP's ordinary additive behavior outside recovery.
4. Persistently disable automatic sync when recovery needs attention. Log a
   useful path-specific explanation and next step and show a short notice;
   provide an informative notice when logging is off or unavailable. Allow
   repeated manual attempts and log entries without deduplication. Reject
   `Forget sync history` while an intent is pending. Do not add recovery
   controls to settings, a recheck command, or an automatic repair UI.
5. Test synthetic interruption before and after intent, file mutation, and
   manifest commit for both engines, including adoption, uncertain Trash,
   unexpected bytes, missing local/source files, incomplete inventory, a failed
   log write, restart, and history/root-change gating. Run the checks below. Any
   live interrupted-operation test needs a separate controlled replaceable
   fixture and approval; do not simulate a crash in a user's sync.

### Remaining validation

- Live interrupted-operation recovery remains untested. Do not force an
  interruption during a user's real sync; a controlled replaceable fixture and
  separate approval are required for that test.
- Live Cloud account-switch validation still needs a consenting volunteer with a
  second account. The Marie checks did not switch accounts.
- The real-device IP smoke test still needs a dedicated device test directory
  and explicit approval for its fixture upload.
- The next handoff is in [`multi-sync-next-steps.md`](multi-sync-next-steps.md).

### Open scope decisions

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
validation in Obsidian using disposable vault content; IP integration must
retain existing real-device smoke-test coverage. Cloud destructive behavior must
be validated only with controlled replaceable test fixtures after its safety
tests pass.

Compatibility requirements: IP remains the default engine; only one engine runs
at a time; the legacy IP command ID remains stable; automatic sync remains
disabled by default; Cloud remains remote-read-only; credentials remain
device-local; and both engines retain the shared destination and filters.
