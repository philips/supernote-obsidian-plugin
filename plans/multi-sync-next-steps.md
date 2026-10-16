# Multi-Sync Next Steps

**Recommended scope:** Complete coordinator-owned shared manifest integration
for Direct IP and Cloud, then add the explicit shared sync-folder change
workflow. This is the next Multi-Sync implementation block as of October
16, 2026.

Use [`multi-sync-plan.md`](multi-sync-plan.md) for overall implementation
status, [`shared-manifest-plan.md`](shared-manifest-plan.md) for the detailed
product contract and acceptance cases, and
[`multi-sync-design.md`](multi-sync-design.md) for architecture. This handoff
contains only remaining work; completed coordination, Cloud mirroring/cleanup,
and source-file organization are not sprint deliverables.

## Recommended Scope

1. **Introduce the coordinator-owned manifest lifecycle.** Provide load,
   validation, revision-checked commit, and shared history clearing for the
   selected sync root. Both engines use this lifecycle while retaining their own
   inventory, transfer, and reconciliation policies. Keep two-slot integrity,
   readback verification, fail-closed handling, and stale-revision rejection.
2. **Migrate and integrate Direct IP.** Migrate legacy `noteSyncState` records
   using their recorded vault paths. Make migration retry-safe; when shared and
   legacy records conflict, protect the path rather than replacing newer Cloud
   history or account binding. Remove legacy state only after a verified shared
   commit. Preserve IP URI/date/size shortcuts, last-written-hash protection,
   restoration of locally deleted managed files, deterministic paths, per-file
   error isolation, and `Sync Log.md`. Remove the temporary IP/Cloud ownership
   block only after cross-engine behavior is safe.
3. **Route Cloud and history clearing through the shared lifecycle.** Preserve
   Cloud account binding, verified transfers, local-edit protection, and guarded
   cleanup. Make “Forget sync history” coordinator-owned and non-destructive:
   clear per-file records without deleting vault files or clearing the Cloud
   account binding. Preserve the default engine, command IDs, and disabled-by-
   default automatic sync during migration.
4. **Implement explicit Change sync folder.** Replace immediate text-setting
   persistence with a staged vault-folder selection and a clear confirmation
   choice. Cancel must leave settings, files, and manifest unchanged. Run the
   operation under the coordinator's exclusive lock; scheduled and manual runs
   must not overlap a pending change.
   - **Move mirror:** require a safe, distinct, unoccupied destination outside
     the current root. Move the whole root, including user-created/edited files,
     `Sync Log.md`, and `.supernote-sync`; update manifest paths and settings,
     retaining hashes, source snapshots, and Cloud binding. Use a root-change
     checkpoint and resume only when the old/new state proves one safe outcome.
   - **Leave files and start fresh:** keep old files untouched and unmanaged;
     initialize an empty manifest at the new root and retire old-root metadata
     without archiving it for automatic reuse. Retain verified Cloud account
     binding. Reject occupied destinations rather than claiming or overwriting
     their contents.
   - If there is no managed history or content to move, offer a simple confirmed
     destination change rather than a misleading move choice. Support a new
     child folder under a selected existing vault folder.

## Safety Boundaries

- Treat the manifest hash as the baseline for local-edit protection. Never
  overwrite, move, or trash a locally changed file based only on a remote
  checksum, device date/size, or missing manifest entry.
- Reject unsafe, nested/overlapping, or conflicting roots and unhealthy
  manifests before mutation. Ambiguous interrupted root changes must stop sync
  for manual resolution; do not guess which root is active.
- Keep ordinary per-file crash recovery for downloads, overwrites, adoptions,
  and Cloud Trash deferred as a separate decision. Do not add its operation
  journal to this sprint.
- Keep automatic cross-device manifest reconciliation deferred; stale revisions
  continue to be rejected rather than silently merged.
- Live account-switch validation remains pending until a second-account
  volunteer is available and explicitly consents. It is not a blocker or
  deliverable for this sprint; retain existing account-change safeguards and
  cover them with synthetic regression tests.
- Do not initiate Cloud login/OTP, modify Cloud content, or move files in a real
  user vault as part of implementation validation. Use synthetic fixtures and a
  controlled test vault.

## Acceptance and Verification

- Migration tests cover new and existing vaults, both manifest slots, IP/Cloud
  path collisions, conflicts, retries after interruption, and removal of legacy
  state only after verified commit.
- Engine tests cover IP unchanged/changed/restored files, local edits, engine
  switching, Cloud cleanup/account binding, and common non-destructive history
  clearing.
- Folder-change tests cover picker/confirmation/cancellation, both choices,
  managed/edited/unrelated files, existing and occupied destinations, unsafe or
  overlapping roots, pending account change, failures at each settings/folder/
  manifest boundary, and restart. Confirm leave-behind files remain untouched
  and untracked even if the old root is selected again.
- Run focused tests after each slice, then `npm test`, `npm run build`,
  `npm run lint`, and `git diff --check`. Visually verify the settings flow in a
  test Obsidian vault when the headless environment is available. Retain the
  existing real-device IP smoke-test coverage; do not run it against user data
  without explicit approval.

## Handoff Exit

Update [`multi-sync-plan.md`](multi-sync-plan.md) with verified implementation
status and leave this file listing only work still outstanding. If ordinary
file-operation crash recovery or cross-device reconciliation becomes desirable,
record it as a separate proposal rather than expanding this sprint implicitly.
