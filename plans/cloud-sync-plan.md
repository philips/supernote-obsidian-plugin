# Cloud Sync Implementation Plan

**Status:** Manual Cloud mirroring, lifecycle notifications, and guarded
remote-deletion cleanup are implemented. Updated October 14, 2026.

This document tracks implementation sequencing, engineering decisions, and
validation status. The user-observable behavior, endpoint contract, protocol
evidence, and release acceptance criteria remain in the
[`cloud-sync-design.md`](cloud-sync-design.md). Harness procedures and consent
requirements remain in [`cloud-protocol-harness.md`](cloud-protocol-harness.md).

## Implementation Status

### Completed

- Implemented and synthetically tested Cloud authentication, device-local
  SecretStorage for token/account state, and account identity validation. The
  import flow accepts a user-supplied token/session and does not initiate login
  or email verification.
- Implemented bounded directory pagination, recursive inventory parsing,
  canonical path verification, narrow root-category casing reconciliation, and
  collision rejection. Synthetic coverage includes large decimal IDs, pagination
  consistency, hierarchy, and path encoding.
- Implemented the pure mirror planner and inventory-to-manifest boundary. The
  planner applies shared path/extension filters, compares Cloud checksums,
  protects locally edited files, and rejects account-binding mismatches.
- Implemented a two-slot shared manifest store in `.supernote-sync` with
  validation, alternating writes, readback verification, and recovery of the
  previous valid revision. Cloud uses this store; IP history migration is not
  complete, so IP sync currently refuses Cloud-owned destinations.
- Implemented guarded byte transfer and vault writes: credential-free Obsidian
  `requestUrl` GET, size and MD5 verification, local-edit checks immediately
  before writes, and no rewrite for identical bytes.
- Implemented a desktop-only manual Cloud mirror engine. Cloud automatic sync
  and history reset remain disabled/unimplemented.
- Implemented opt-in, redacted protocol-harness modes for account-bound
  inventory and descriptor checks. The harness remains separate from product
  sync and requires explicit consent for login/OTP and other approved probes.
- Verified a test-vault fixture transfer and unchanged second run on October
  13, 2026. A later run mirrored matching nested note files. Narrowing filters
  did not remove prior copies. No login/OTP, remote deletion, or harness-cache
  cleanup was performed as part of those mirror checks.
- Implemented start and per-download notices, with completion counts for Cloud
  downloads, unchanged and excluded files, Trash moves, local edits, and
  failures. Remote-deletion cleanup requires two matching complete, verified
  inventories and an unchanged local hash; filtered and unmanaged paths remain.
- On October 14, 2026, validated guarded deletion in the Marie vault using a
  unique synthetic destination and a filter that matched no Cloud files. One
  unchanged fixture moved to Obsidian system Trash; a locally edited fixture and
  an unmanaged fixture stayed intact. The synthetic destination was then
  removed, leaving the system Trash item. No login/OTP or Cloud mutation was
  performed. The local debugger attached to a Marie-targeted Obsidian launch.

### Implementation Decisions

- Keep Cloud sync manual and desktop-only until automatic scheduling is
  explicitly implemented and validated. Only the active engine may run.
- Keep all mirror writes non-destructive until the complete-inventory,
  account-binding, canonical-path, shared-manifest, and unchanged-local-hash
  protections are in place.
- Keep IP and Cloud on the shared manifest contract. Do not allow IP sync to
  overwrite Cloud-managed destinations until IP history is migrated.
- Put each operational limit in one authoritative Cloud policy/constants module;
  request, inventory, transfer, and test code should reference those
  declarations rather than repeat numeric literals. The required defaults are
  specified in Section 11.1 of the external design.
- Never persist credentials, tokens, OTP values, signed URLs, raw response
  bodies, or identifying account/file data in logs, fixtures, or reports. Retain
  the harness cache unless separately authorized for cleanup.

## Completed Sprint Checks

### Sprint 1: Lifecycle Notifications

- Start notices follow account readiness and binding; download notices precede
  actual byte transfer and omit unchanged or excluded files. The existing
  completion notice now includes every secret-free Cloud count.
- Focused engine tests cover the start and download notices, rejected account,
  and unchanged/excluded files. The coordinator's readiness gate prevents
  unready runs from entering the engine.

### Sprint 2: Remote-Deletion Cleanup

- Candidates are managed, currently in-scope paths missing from verified Cloud
  inventory. A second complete inventory follows the policy delay; differing
  fingerprints or failed verification suppress all cleanup.
- An unchanged local hash is required immediately before Obsidian Trash. Locally
  edited, unmanaged, filtered, and still-present files are retained. Manifest
  commit failure after Trash stops the run rather than continuing.
- Focused tests cover the safety gates and the Obsidian Trash adapter; the
  controlled-vault check above confirmed both Trash and local-edit protection.

## Next Sprint: Empty Mirror Folder Cleanup

- After a successful, guarded Cloud file deletion and manifest commit, inspect
  its parent directory. If it is empty, move it to Obsidian Trash; continue
  upward while each parent is empty, stopping before the configured sync root.
- Never remove a folder that contains any other file or folder, including
  unmanaged files, locally edited copies, filtered-out files, or metadata. Do
  not prune on an incomplete or changed inventory, failed Trash action, or
  failed manifest commit. Do not sweep unrelated pre-existing empty folders.
- Add focused tests for a single empty parent, nested empty ancestors, a
  nonempty parent, the sync-root boundary, and skipped or failed deletions. Then
  run `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
  Validate with replaceable synthetic fixtures only before relying on the
  behavior in the vault.

## Validation Gates

The sprint gates were run on October 14, 2026:

1. Focused Cloud lifecycle and deletion tests during development.
2. `npm test`.
3. `npm run build`.
4. `npm run lint`.
5. `git diff --check`.
6. Controlled Marie-vault validation of remote deletion, using only replaceable
   synthetic fixtures. The vault's Trash option was `system`.

Do not use production login/OTP, delete or clear harness cache, or broaden the
test-vault fixture scope without separate explicit authorization. Keep protocol
observations secret-free and update the dated evidence in the external design
only when a new observation is made.
