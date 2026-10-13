# Cloud Sync Next Steps

## Completed

- Implemented and synthetically tested the read-only Cloud authentication flow.
- Verified production password login, email verification, CSRF refresh, token
  completion, and account identity in two fresh sessions on October 12, 2026.
- Confirmed that OTP submission may return HTTP 403 and requires one CSRF
  refresh followed by one retry.
- Recorded the dated, secret-free result under "Resolved Unknowns and
  Undocumented Behaviors" in the Cloud Sync External Specification.
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
- Added an offline two-slot shared-manifest store and Obsidian vault storage
  adapter under `.supernote-sync`. First load copies valid legacy IP history
  without deleting settings, later writes alternate slots and verify the new
  copy, and loading can recover the previous valid revision after an interrupted
  update. Invalid or colliding legacy records and fully corrupt storage fail
  closed. The store is not yet called by the IP or Cloud engine.
- On October 13, 2026, a validated cached token supported two stable hosted
  inventories with a real second page and two stable path-query passes. The
  observed `pages`/`size` listing envelope omits `pageNum`/`pageSize`; the six
  displayed root folders report `total: 5` and some have internal parent IDs.
  Other tested directory totals were exact, not zero-based. Relative
  trailing-slash path queries matched the queried parent/child hierarchy after
  reconciling only standard root-category casing. These dated facts and their
  limits are recorded in the external specification.
- A later October 13 read-only run verified two same-named folders under
  different parents containing literal `%`, `+`, Unicode, spaces, and
  parentheses. Two stable inventories and two path-query passes covered all 116
  items; the tested canonical-path gate passed. The result and its untested
  Unicode variants are recorded in the external specification.
- Inventory code now verifies queried path and ID-path hierarchy, reconciles
  only the observed root-category casing, and rejects path collisions. Listing
  parsing accepts the observed six-folder flattened root and omitted response
  `pageNum`/`pageSize` while keeping other directory checks strict; synthetic
  tests cover these cases. The verifier is not yet connected to the offline
  planning pipeline, which still requires a caller-supplied verified path map.
- Moved the dated production observations into Section 12, "Resolved Unknowns
  and Undocumented Behaviors," of the external specification. Release acceptance
  criteria are now Section 13; unresolved development gates remain in Section
  11.3.

## Next

- If the cached session is rejected or expires, do not initiate a new login or
  OTP request without explicit user authorization and the account owner present
  to receive a possible email code. The harness only reads the consent variables
  and never clears or changes them. Login consent is used only when no reusable
  session is available.
- Retain the cached token throughout plugin development, until the account owner
  is ready for an end-to-end options-panel login test and explicitly approves
  cleanup. Completing protocol probes is not permission to remove it; service
  expiry or revocation can still require another authorized login.
- On future cached-token runs, first validate the token with the
  account-identity query and require its canonical account identity to match the
  local session. Record only redacted aggregate/path-shape evidence from
  two-pass inventory and path probes, never filenames, paths, IDs, or contents.
- Continue to fail closed on unrecognized or colliding path forms. The tested
  canonical-path gate now passes, but that does not complete the independent
  download, account-safety, Obsidian runtime, or deletion gates. Never create or
  remove production fixtures through harness writes.
- Retain the harness under `scripts/` as an opt-in, bounded compatibility probe
  outside CI and releases; review redacted observations before sharing. Its
  retention does not authorize clearing the separately cached token.
- Validate download descriptors, redirect hosts, and checksum-protected
  transfers using an authorized synthetic fixture. Never forward Cloud
  credentials or cookies to a download host.
- After the protocol gates pass, implement the shared manifest integration and
  one-way Cloud mirror. Keep sync as raw-byte mirroring; date-based import and
  format conversions remain separate work.

No production download validation, Cloud sync engine, shared manifest
integration, or Cloud authentication UI has been completed.
