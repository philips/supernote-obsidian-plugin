# Cloud Sync Implementation Plan

**Status:** Manual, non-deleting Cloud mirroring is implemented. Lifecycle
notifications and guarded remote-deletion cleanup remain. Updated October 14,
2026.

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
- Implemented a desktop-only manual Cloud mirror engine. Cloud automatic sync,
  history reset, and remote-deletion cleanup remain disabled/unimplemented.
- Implemented opt-in, redacted protocol-harness modes for account-bound
  inventory and descriptor checks. The harness remains separate from product
  sync and requires explicit consent for login/OTP and other approved probes.
- Verified a test-vault fixture transfer and unchanged second run on October
  13, 2026. A later run mirrored matching nested note files. Narrowing filters
  did not remove prior copies. No login/OTP, remote deletion, or harness-cache
  cleanup was performed as part of those mirror checks.

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

## Remaining Work

### Sprint 1: Lifecycle Notifications

- Notify when a run starts, only after readiness checks pass.
- Notify immediately before each actual new/changed file download, using only a
  safe display name or vault-relative mirror path.
- Keep the existing completion summary and ensure it includes the secret-free
  counts required by the external spec.
- Do not issue download-start notices for unchanged or filtered-out files.
- Add focused tests for start, per-download, and completion notices, including
  readiness failure and unchanged/excluded files.

### Sprint 2: Remote-Deletion Cleanup

- Identify deletion candidates only from previously managed paths that remain in
  the current filter scope and are absent from a complete Cloud inventory.
- When candidates exist, collect a second complete inventory after the policy
  delay and require an identical inventory fingerprint before cleanup.
- Recheck the local hash immediately before action. Move unchanged managed
  copies to Obsidian Trash; retain and report locally edited copies.
- Never remove unmanaged files or treat current path/extension exclusions as
  remote deletions. Any incomplete or inconsistent inventory suppresses all
  cleanup for that run.
- Add focused tests for incomplete/changed inventories, local edits, unmanaged
  files, filtered paths, and in-scope missing files.
- Validate only in the controlled test vault after the guarded code and tests
  pass. Confirm both the Obsidian Trash result and preservation of a locally
  edited file.

## Validation Gates

After the two work slices are implemented, run:

1. Focused Cloud lifecycle and deletion tests during development.
2. `npm test`.
3. `npm run build`.
4. `npm run lint`.
5. `git diff --check`.
6. Controlled test-vault validation of remote deletion, using replaceable test
   fixtures only.

Do not use production login/OTP, delete or clear harness cache, or broaden the
test-vault fixture scope without separate explicit authorization. Keep protocol
observations secret-free and update the dated evidence in the external design
only when a new observation is made.
