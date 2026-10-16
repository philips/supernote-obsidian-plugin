# Shared Manifest Strategy and Implementation Plan

**Status:** Planned. Cloud uses the versioned two-slot vault manifest; Direct IP
still plans from `noteSyncState` in plugin settings. The coordinator currently
serializes runs but delegates history clearing to the active engine. No shared
root-change operation exists. This plan covers both engine integration and an
explicit, common destination-change workflow; it does not claim either is
implemented.

## Product Contract

- One active engine at a time, one manifest for the current sync root. Both
  engines use the coordinator's manifest lifecycle, irrespective of which engine
  last wrote a file. A record means sync last wrote or safely adopted that
  destination, not that the recorded engine owns it permanently.
- The last-written content hash is the baseline for local-edit protection: a
  locally changed file is never overwritten or moved to Trash merely because its
  current bytes differ from the remote bytes. A remote checksum or device
  date/size helps avoid unnecessary transfers but is not the local-edit
  baseline. An untracked existing file can only be adopted if it matches the
  verified incoming bytes; otherwise it is protected.
- IP stays additive/update-only; Cloud cleanup still requires complete, matching
  inventories, current scope, and an unchanged managed local file. Account
  fingerprints remain bound across IP runs and non-destructive history clearing.
  Cloud account changes continue to use their separately confirmed sign-in
  workflow.
- `Forget sync history` is one coordinator action for both engines: clear
  per-file records without moving vault files or clearing the Cloud account
  binding. Subsequent runs may re-adopt byte-identical local files, but cannot
  delete an untracked file on the strength of its absence from Cloud.

## Current State and Boundaries

- `IpSyncEngine` invokes `runDeviceSync`, whose planning and saves use
  `settings.noteSyncState`. A guard currently prevents IP from running over
  Cloud-recorded destinations. The Cloud engine already uses
  `loadMirrorManifest` / `saveMirrorManifest` in `.supernote-sync`.
- Retain the store's two-slot integrity, readback checks, revision comparison,
  and fail-closed invalid-manifest handling. Reject stale writes; automatic
  three-way reconciliation across machines is not part of this plan.
- Account-change-specific recovery already exists. A general pending-operation
  journal for ordinary transfers, overwrites, or remote-deletion Trash is a
  separate decision, not a prerequisite to sharing the manifest. On ambiguous
  vault/manifest state, protect the file or stop rather than guessing.

## Shared Manifest Integration

1. Introduce a coordinator-owned manifest service for the selected root:
   load/validate, commit with revision checks, and clear shared history. Give
   both engines access to this service; keep source inventory, transfer, and
   engine-specific reconciliation policy inside the respective engines. The
   coordinator's existing in-flight guard also excludes root changes and
   account-change cleanup from manual and scheduled runs.
2. Migrate `noteSyncState` entries by their recorded vault paths into the shared
   store. If a shared manifest already exists, reconcile legacy entries without
   replacing newer Cloud records or the account binding; protect conflicting
   paths instead of choosing a winner. Verify the shared commit before marking
   migration complete or removing legacy settings state. Make retries idempotent
   so interrupted migration cannot drop either history.
3. Adapt IP planning to use shared records, preserving URI/date/size shortcuts,
   the last-written hash guard, locally deleted file restoration, deterministic
   paths, per-file error isolation, and `Sync Log.md`. On engine switch, an
   identical verified source may update the replaceable source snapshot without
   rewriting local bytes; a different source still needs the local-edit guard.
   Remove the temporary IP block only after these safeguards work end to end.
4. Keep Cloud planning, verified transfers, guarded Trash, and account binding
   intact while routing its manifest access through the shared service. Make
   history clearing common to both engines. Migrate old installations without
   changing the default active engine, automatic scheduling, or command IDs.

## Explicit Change Sync Folder

Replace the immediately saved `syncFolder` text control with a **Change sync
folder** action. Folder selection is a draft until the user confirms a choice;
cancel does not change settings, files, or manifest. Apply the same operation
regardless of active engine, under the coordinator's exclusive lock. Scheduled
sync must not prompt or run during a pending change.

Obsidian 1.13's declarative settings API offers a `folder` control with a vault
folder suggester, but its ordinary binding saves the value directly. Use a
custom settings action/modal that stages a selected vault folder without binding
it to `syncFolder`. Its folder list can come from Obsidian's Vault API, using
`SuggestModal<TFolder>` or `AbstractInputSuggest` for the picker. The plugin's
existing `FileListModal` is also a `SuggestModal`, but fetches folders from the
Supernote device; reuse only its UI pattern, not its HTTP listing or device
navigation. Support a new destination by selecting an existing parent and
entering a new child-folder name. Never open an OS filesystem picker or accept a
destination outside the vault.

- **Move existing mirror:** explain that the _whole_ old root moves, including
  user-created or edited files, `Sync Log.md`, and `.supernote-sync`. Require a
  distinct, safe, not-yet-existing destination outside the old root. Under the
  coordinator lock, checkpoint the old/new root intent, rename the folder
  through the Vault API, then update any path-bearing manifest records and
  `syncFolder`. Retain hashes, remote snapshots, and Cloud account binding.
  Resume an interrupted move only when the old/new folder state identifies a
  single safe outcome; otherwise stop sync for manual resolution. Do not copy
  files one by one or merge into an occupied destination.
- **Leave files and start fresh:** warn that old files stay in place, become
  unmanaged, and new in-scope remote files will be downloaded under the new
  root. The old folder, user content, and log are not moved or trashed. Drop the
  old root's plugin manifest slots rather than archiving history or silently
  reactivating it on a later return to that folder. Initialize an empty manifest
  at the new root, retaining the verified Cloud account binding but no per-file
  records. The destination may be a new path or an existing empty vault folder;
  reject occupied folders rather than overwriting or claiming their contents.
  Make the switch and old-metadata retirement recoverable or stop further sync
  if interrupted; never guess which root is active. This is an explicit history
  reset for the old files, not a request to remove them.

If the current root has no managed history and no files to move, allow a
straightforward confirmed destination selection without offering a misleading
"move" choice. Validate path segments, nested/overlapping roots, conflicts,
current settings, pending account change, and manifest health before any
mutation. An invalid or cancelled change leaves the previous root in use.

## Verification and Delivery

- Test new-vault and existing-vault migration, both slots present, Cloud/IP path
  collision, retry after an interrupted commit, and removal of legacy settings
  only after a verified save. Cover IP unchanged/change/restoration, local
  edits, switching engines, Cloud cleanup, account binding, and shared history
  clearing with synthetic vault fixtures.
- Test the folder picker and confirmation/cancellation for both engines.
  Exercise move and leave-behind with managed, locally edited, and unrelated
  files, occupied destinations, overlapping roots, pending account change,
  failures between folder/manifest/settings changes, and restart. Verify that
  old files remain untouched and untracked after leave-behind, including if the
  former root is selected again.
- Run focused tests, full `npm test`, `npm run build`, `npm run lint`, and
  `git diff --check`; visually check the settings flow in a test Obsidian vault.
  Use only synthetic replaceable fixtures for any actual move or Trash
  validation. Do not initiate Cloud login/OTP, modify Cloud content, or change
  real user vault files without separate approval.

## Deferred Decisions

General crash recovery for ordinary per-file writes/Trash and automatic
cross-device manifest merging remain independent proposals. The shared store
continues to reject stale revisions and protect ambiguous local files; neither
deferred feature is silently included in this migration or root-change work.
