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

## Next

- Rotate the diagnostic account password because it was previously entered
  directly in terminal history, after the remaining protocol probes no longer
  need a fresh login.
- When the account owner is available for a possible OTP, run one explicitly
  authorized login to populate the temporary session cache. The harness only
  reads the consent variables and never clears or changes them. If login consent
  is enabled, it is used only when no reusable session is available.
- Retain the cached token throughout plugin development, until the account owner
  is ready for an end-to-end options-panel login test and explicitly approves
  cleanup. Completing protocol probes is not permission to remove it; service
  expiry or revocation can still require another authorized login.
- Run the two-pass inventory and path probe against the current two-file account
  to establish partial production response and path-shape evidence without
  recording filenames, paths, IDs, or contents.
- The real second-page pagination gate remains blocked until the account owner
  prepares at least 101 synthetic files in one directory through an official
  client. The harness remains read-only and will not manufacture this fixture.
- Validate download descriptors, redirect hosts, and checksum-protected
  transfers.
- Then implement the shared manifest and one-way Cloud mirror.

No production inventory observation, download validation, manifest, or product
UI work has completed yet.
