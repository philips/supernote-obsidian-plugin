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
- Added an offline descriptor-to-bytes transfer boundary with synthetic tests:
  it checks descriptor MD5 against inventory metadata, requires explicitly
  reviewed HTTPS hosts at every redirect, limits redirects and streamed bytes,
  and omits ambient credentials and referrers. No hosts are approved by default;
  this is not wired to descriptor retrieval or the Cloud mirror engine.
- Added an opt-in, descriptor-only harness mode and a synthetic test. It
  requires an explicitly designated replaceable file ID and a bound reusable
  session, validates account identity first, requests only a `type: "0"`
  descriptor, and prints only scheme class, host class, and checksum format. It
  never fetches the returned URL, logs in, or saves descriptor values.
- On October 13, 2026, an explicitly approved descriptor-only probe for a
  disposable test file passed cached-session account validation and returned an
  HTTPS URL on a host outside the Cloud API origin with a well-formed MD5 field.
  The URL and checksum value were not retained or printed. This does not
  establish an approved download host, redirect behavior, byte integrity, or
  whether the descriptor checksum matches the inventory checksum.
- On October 13, 2026, with explicit approval, a host-review pass identified a
  single HTTPS S3 bucket hostname for that disposable file. A subsequent
  descriptor request to the bound account returned that same exact host; the
  in-memory GET succeeded with the listed byte length and MD5. The harness sent
  no Cloud token, cookies, CSRF header, or referrer to the transfer host, and
  discarded the bytes without vault writes. Only the exact observed host was
  allowed; unreviewed redirect hosts fail closed. The harness did not record a
  redirect count, so production redirect behavior remains unknown. The remote
  ID, checksum value, signed URL, and contents were not committed or included in
  the report.
- Added an offline, non-deleting Cloud mirror runner that connects verified
  inventory planning, guarded byte writes, and per-file durable manifest
  commits. Synthetic tests cover first write, unchanged second run, local edit
  protection, checksum failure, account mismatch, and fatal manifest write
  failure. An Obsidian binary vault adapter has synthetic tests for nested
  folders, exact bytes, and folder collisions. This runner is not registered as
  a plugin sync engine and has not run in the Marie test vault.
- With approval, raised the minimum Obsidian version to 1.11.5 for encrypted
  SecretStorage and added a device-local Cloud token/account store. Execution
  state no longer carries Cloud session fields and scrubs legacy plaintext
  fields if encountered. Marie's active window reports Obsidian 1.14.4 even
  though the executable metadata reports 1.10.6. The import command now opens a
  generic paste prompt for an access token or cached session JSON; it reads no
  cache file from Obsidian. It verifies the canonical account identity before
  saving to SecretStorage, with a readback check and no login or OTP. Synthetic
  tests pass. On October 13, 2026, the live import completed and the prompt
  reported "Cloud access token validated and stored securely," confirming the
  account identity validation and SecretStorage token/account readback through
  the Obsidian requestUrl adapter. No login or OTP was initiated. The harness
  cache has not been removed.
- On October 13, 2026, an earlier running-Marie diagnostic attempt passed the
  vault, SecretStorage availability, bound-cache, and local account guards, but
  Cloud identity validation failed before any SecretStorage save. DevTools later
  identified the original renderer `fetch` receiver error; after that was fixed,
  renderer `fetch` still failed during CSRF bootstrap. The temporary diagnostic
  commands and marker writer were removed. A subsequent import using Obsidian's
  `requestUrl` adapter succeeded, as recorded above.
- On October 13, 2026, the read-only production inventory harness completed with
  the cached session and with login disabled. Two inventories matched: 113
  directories and 117 items (5 files, 112 folders), with a second page observed.
  All 234 path queries returned a stable verified hierarchy, including the
  tested encoding and duplicate-name cases. Neither the 5,000-request harness
  limit nor the 256-query limit was reached. The raw observation report was
  suppressed and deleted; no names, paths, IDs, or credentials were retained.

## Next

- The initial interactive import failed because the renderer's native `fetch`
  was invoked with the transport instance as `this` (`Illegal invocation`);
  binding it exposed a subsequent renderer-level `TypeError: Failed to fetch`
  during CSRF bootstrap. The importer was then switched to Obsidian's
  `requestUrl` through a local adapter. On October 13, 2026, the prompt reported
  successful account validation and SecretStorage readback. Synthetic build and
  test checks pass. The live success establishes this account's import path
  works in the current Obsidian runtime, but does not characterize redirect
  behavior, cookie behavior across redirect hops, or portability to other
  Obsidian platforms.
- In the next implementation phase, retain `requestUrl` for interactive Cloud
  API calls and review its implicit redirect behavior and response-header/cookie
  semantics against the existing CSRF session requirements. Do not claim
  redirect-hop validation: `requestUrl` exposes no redirect control. Keep
  credentials scoped to the fixed Cloud API origin in constructed requests, and
  keep Cloud file-download redirects on their separate credential-free,
  explicitly reviewed-host path. Add only bounded, token-free diagnostics if
  needed; never record URLs, headers, cookies, response bodies, tokens, or IDs.
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
- Keep the reviewed host narrowly scoped to the observed fixture; any new
  descriptor or redirect host must be reviewed separately before it is added to
  a product allowlist. Never forward Cloud credentials or cookies to a download
  host. Synthetic redirect tests do not establish which future production
  redirect destinations, if any, are legitimate.
- After the protocol gates pass, implement the shared manifest integration and
  one-way Cloud mirror. Keep sync as raw-byte mirroring; date-based import and
  format conversions remain separate work.
- To run the mirror through the plugin in the Marie test vault, add a
  product-side Cloud mirror transport integration, establish an explicit
  shared-manifest account binding, then register the Cloud engine with the sync
  coordinator. The guarded one-time import and device-local SecretStorage store
  are implemented and live import succeeded. Keep the harness cache; never put a
  token in vault files or enable remote deletion for this test.

The disposable fixture download was validated. The paste-based Cloud import UI
and device-local session store are implemented, but no plugin Cloud sync engine,
shared manifest integration, or general download host allowlist has been
completed.
