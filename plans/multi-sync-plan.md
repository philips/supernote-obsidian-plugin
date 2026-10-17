# Multi-Sync Implementation Plan

**Status:** Single-active-engine coordination, Cloud/IP shared-manifest access,
shared non-destructive history clearing, explicit sync-folder changes, and
ordinary-operation intent recovery are implemented with synthetic tests. The
move, leave-behind, cancel, recovery-attention, identical-byte adoption, and
uncertain-Trash recovery paths were checked in Marie with local fixtures and
synthetic source state. Synthetic Cloud pipeline tests cover post-mutation
manifest commit failures; interruption inside a running Obsidian engine, live
cross-account switching, and real-device smoke testing remain unvalidated. Sync
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
- Added one validated pending operation in the two-slot shared manifest and a
  shared intent-first executor for IP per-file writes/adoption and Cloud writes
  and verified-inventory Trash. Startup and manual sync reconcile only known
  byte states; missing files require a complete fresh source inventory on manual
  retry. Uncertain Trash and unexpected bytes remain pending, pause scheduled
  sync persistently, and block folder changes and history clearing. Synthetic
  tests cover interruption, missing source, incomplete inventory, restart
  gating, and failed logging. No live interruption was performed. Final
  verification: `npm test` (514 passing), `npm run build`, `npm run lint` (0
  errors, 14 existing warnings), and `git diff --check`.
- In the disposable Marie vault, staged a synthetic pending overwrite on a
  uniquely named test file. The first pre-write restart retained the intent;
  calling the recovery hook after Obsidian finished loading cleared it. Changed
  startup recovery reads to use the vault adapter rather than the file index. A
  second staged after-write/before-record-commit intent then reconciled on
  normal startup: the latest manifest had no pending intent and recorded the new
  bytes. Removed the test file and its record under the coordinator lock; all
  five pre-existing records matched before and after cleanup. Terminating the
  renderer made the Obsidian app unresponsive, so this did not validate a
  reliable crash-interruption workflow or live adoption/Trash recovery.
  Adapter-only startup reads have a regression test for an unindexed file.
  Verification after the fix: `npm test` (515 passing), `npm run build`,
  `npm run lint` (0 errors, 14 existing warnings), and `git diff --check`.
- Exercised recovery attention in Marie without stopping the renderer or
  starting a Cloud transfer: committed a synthetic pending write for a unique
  `.txt` path whose actual bytes matched neither expected hash, then invoked the
  coordinator's manual run. Recovery stopped before the engine ran, wrote the
  path-specific hash mismatch and next step to `Sync Log.md`, and left the
  intent pending. Cleared only that intent and deleted its fixture under the
  coordinator lock. Final live check found no pending intent or test file or
  record, five original records, an idle ready Cloud engine, and auto-sync still
  off. The test log entry remains as history, not an active failure. This was
  not an interruption inside an actual engine operation.
- Replaced ambiguous-byte and uncertain-Trash advice to "inspect this file" with
  an actionable backup-first step: move the file outside the sync folder to keep
  a backup, then run a manual sync. This preserves unexpected local bytes while
  the missing-path recovery checks a fresh source inventory. The historical
  Marie log entry retains the older wording. The focused recovery tests (7
  passing), build, lint (0 errors, 14 existing warnings), and `git diff --check`
  passed after the change.
- Tested interrupted identical-byte adoption and post-Trash manifest commit
  failure in the executor with one-shot commit failures: recovery adopted
  without rewriting bytes and did not repeat Trash. In Marie, staged a synthetic
  identical-byte intent; recovery recorded the unchanged file and cleared the
  intent. For a separate managed `.txt` fixture, moved the original into local
  Obsidian Trash with an intent pending, created a different file at the path,
  and verified recovery preserved both copies and logged uncertainty. Moving the
  replacement aside and retrying through the coordinator with a temporary mocked
  absent-source check and stubbed engine run cleared the intent without Cloud
  requests. Removed only the synthetic files, local Trash item, and records;
  five original records remain and auto-sync is off. This checked local
  vault/manifest recovery, not a real Cloud pipeline transfer, source inventory,
  or process interruption.
- Latest verification after recovery validation: `npm test` (517 passing),
  `npm run build`, `npm run lint` (0 errors, 14 existing warnings), and
  `git diff --check`.
- Added synthetic Cloud mirror pipeline tests that fail the final manifest
  commit once after a successful write or Trash. Both retain a pending intent;
  recovery reconciles the manifest and a later pipeline run makes no duplicate
  change. No headless vault, live Cloud transfer, or renderer crash was used.
  Verification: focused pipeline tests (43 passing), `npm test` (519 passing),
  `npm run build`, `npm run lint` (0 errors, 14 existing warnings), and
  `git diff --check`.

## Outstanding

### Ordinary-operation recovery

The intent-first per-file executor, coordinator restart reconciliation,
path-specific attention logging, and history/root-change gates are implemented.
Adoption and uncertain-Trash recovery were checked in Marie with synthetic
intents and local fixtures. Cloud pipeline write/Trash interruptions were tested
with synthetic ports, but a fault inside a running Obsidian engine remains
untested. Marie is the designated disposable test vault. Do not terminate the
Obsidian renderer, which made it unresponsive, or mutate Cloud/device contents.

### Remaining validation

- Live Cloud account-switch validation still needs a consenting volunteer with a
  second account. The Marie checks did not switch accounts.
- The real-device IP smoke test still needs a dedicated device test directory
  and explicit approval for its fixture upload.
- The next handoff is in [`multi-sync-next-steps.md`](multi-sync-next-steps.md).

### Open scope decisions

- Automatic cross-device manifest reconciliation remains a separate proposal.
  The shared-manifest work retains stale-revision rejection instead of silently
  merging concurrent changes from multiple machines. A two-instance
  reject-and-manual-retry scenario has not yet been exercised end to end.

The standalone Cloud reset is not outstanding: confirmed account change occurs
during interactive sign-in. Live account-switch validation remains unresolved
until a volunteer with a second Cloud account can test it with explicit consent;
the current user has no second account. This does not block work on the
shared-manifest block. The Cloud validation record is in
[`cloud-sync-next-steps.md`](cloud-sync-next-steps.md).

## Suggested Further Validation

The following checks were not performed in this iteration; they are
recommendations for future validation, not blockers to normal sync:

- If further live validation is warranted, exercise a controlled fault inside a
  running Obsidian engine with a local fixture. The synthetic Cloud pipeline
  tests already check its mirror-pipeline wiring; do not terminate the renderer
  or mutate Cloud/device data.
- Check live Cloud inventory and transfer behavior only when a safe, controlled
  remote fixture is available. The Marie adoption/Trash checks used synthetic
  records and a mocked source result, so they do not establish this behavior.

The next bounded sprint can verify stale-revision rejection and safe manual
retry with two synthetic instances; see
[`multi-sync-next-steps.md`](multi-sync-next-steps.md). Keep real-device upload
and second-account tests outside that sprint until their prerequisites and
explicit approval are available.

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
