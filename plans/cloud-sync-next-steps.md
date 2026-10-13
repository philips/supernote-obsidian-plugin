# Cloud Sync Next Steps

## Completed

- Implemented and synthetically tested the read-only Cloud authentication flow.
- Verified production password login, email verification, CSRF refresh, token
  completion, and account identity in two fresh sessions on October 12, 2026.
- Confirmed that OTP submission may return HTTP 403 and requires one CSRF
  refresh followed by one retry.
- Recorded the result in
  `plans/cloud-protocol-observations/2026-10-12-auth-identity.md`.
- Updated the specification so password sign-in, CSRF handling, email-code
  completion, and canonical account identity reflect the dated production
  observation.
- Added lossless, bounded Cloud directory pagination and recursive inventory
  parsing with synthetic tests for int64 IDs, duplicate detection, pagination
  consistency, traversal, and path-query parsing.
- Extended the production harness to reuse `SUPERNOTE_CLOUD_ACCESS_TOKEN` or a
  harness-only session cache under the OS temporary directory. Login and any
  possible OTP request now require the additional explicit acknowledgement
  `SUPERNOTE_CLOUD_ALLOW_LOGIN=I_ACKNOWLEDGE_OTP_MAY_BE_SENT`.
- Added a redacted two-pass inventory report that retains only aggregate counts,
  salted fingerprints, structural path relationships, and request/response field
  types.
- On October 13, 2026, inspected local history and saved workspace chats for a
  previous Cloud session without exposing secret values. One Cloud-linked
  candidate was tested using only CSRF bootstrap (HTTP 200) and account identity
  (HTTP 401). It was not cached; no password login or OTP request was made.
- The settings groundwork has been organized for future sync-engine selection;
  the Cloud engine itself, shared Cloud manifest integration, and Cloud product
  authentication UI have not been implemented.
- Added a pure, synthetic-tested Cloud mirror planner that accepts only
  caller-verified canonical paths, compares Cloud checksums with manifest
  snapshots, protects locally edited copies, re-queues missing copies, and
  applies shared path and extension filters. It does not fetch or write files.
- Added an offline, synthetic-tested inventory-to-manifest boundary: complete
  inventories require explicit per-ID canonical paths, vault-local hashes feed
  planning, and a versioned destination-keyed manifest can adapt existing IP
  records without inventing Cloud checksums. `.supernote-sync` is reserved for
  mirror metadata. Planning and writes reject a mismatched account binding.
- Added a fake-transfer/fake-vault byte-write boundary that checks size and MD5
  through an injected digest provider, protects local edits immediately before
  writing, and re-baselines identical IP bytes without rewriting. No production
  download transport, vault adapter, manifest persistence, or Cloud engine is
  wired up yet.

## Next

- Rotate the diagnostic account password because it was previously entered
  directly in terminal history, after the remaining protocol probes no longer
  need a fresh login.
- Default while the account owner is unavailable: continue offline with
  synthetic Cloud protocol fixtures and a fake transport. Next offline work is
  to define safe manifest persistence and IP migration, the Obsidian vault
  adapter, and the verified-path provider contract. The production Cloud engine
  must remain disabled until canonical paths, account binding, and transfer
  behavior pass their authorized protocol gates. Do not make production requests
  as part of offline work.
- OTP interruption point: if the account owner becomes available at any time,
  pause offline work immediately. Proceed with authentication only after the
  user explicitly authorizes the attempt and the account owner is present to
  receive the possible email code. The harness only reads the consent variables
  and never clears or changes them. Login consent is used only when no reusable
  session is available.
- Retain the cached token throughout plugin development, until the account owner
  is ready for an end-to-end options-panel login test and explicitly approves
  cleanup. Completing protocol probes is not permission to remove it; service
  expiry or revocation can still require another authorized login.
- After authorized authentication, immediately validate the token with the
  account-identity query and bind the resulting canonical account identity to
  the local session. Then run the two-pass inventory and path probe against the
  current two-file account, recording only redacted aggregate/path-shape
  evidence and no filenames, paths, IDs, or contents.
- The real second-page pagination gate remains blocked until the account owner
  prepares at least 101 synthetic files in one directory through an official
  client. The harness remains read-only and will not manufacture this fixture.
- Once listing and path behavior are understood, validate download descriptors,
  redirect hosts, and checksum-protected transfers using an authorized synthetic
  fixture. Never forward Cloud credentials or cookies to a download host.
- After the protocol gates pass, implement the shared manifest integration and
  one-way Cloud mirror. Keep sync as raw-byte mirroring; date-based import and
  format conversions remain separate work.

No production inventory observation, download validation, Cloud sync engine,
shared manifest integration, or Cloud authentication UI has been completed.
