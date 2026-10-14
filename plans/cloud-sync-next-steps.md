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
  writing, and re-baselines identical IP bytes without rewriting. Production
  transport, vault adapter, manifest persistence, and manual Cloud engine wiring
  followed in later steps below.
- Added an offline two-slot shared-manifest store and Obsidian vault storage
  adapter under `.supernote-sync`. First load copies valid legacy IP history
  without deleting settings, later writes alternate slots and verify the new
  copy, and loading can recover the previous valid revision after an interrupted
  update. Invalid or colliding legacy records and fully corrupt storage fail
  closed. Cloud uses this store; IP history has not yet been migrated to it.
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
  tests cover these cases. The manual Cloud engine now supplies its verified
  path map to the offline planning pipeline.
- Moved the dated production observations into Section 12, "Resolved Unknowns
  and Undocumented Behaviors," of the external specification. Release acceptance
  criteria are now Section 13; unresolved development gates remain in Section
  11.3.
- Added a descriptor-to-bytes transfer boundary with synthetic tests: it checks
  descriptor MD5 against inventory metadata, uses a credential-free Obsidian
  `requestUrl` GET, and rejects returned bytes over the size limit. Obsidian
  handles redirects without plugin host approval.
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
  allowed by that harness. The harness did not record a redirect count, so
  production redirect behavior remains unknown. The remote ID, checksum value,
  signed URL, and contents were not committed or included in the report.
- Added an offline, non-deleting Cloud mirror runner that connects verified
  inventory planning, guarded byte writes, and per-file durable manifest
  commits. Synthetic tests cover first write, unchanged second run, local edit
  protection, checksum failure, account mismatch, and fatal manifest write
  failure. An Obsidian binary vault adapter has synthetic tests for nested
  folders, exact bytes, and folder collisions. The runner is now called by the
  manual Cloud engine and passed a fixture-scoped run in the test vault.
- With approval, raised the minimum Obsidian version to 1.11.5 for encrypted
  SecretStorage and added a device-local Cloud token/account store. Execution
  state no longer carries Cloud session fields and scrubs legacy plaintext
  fields if encountered. The active window in the tested vault reports Obsidian
  1.14.4 even though the executable metadata reports 1.10.6. The import command
  now opens a generic paste prompt for an access token or cached session JSON;
  it reads no cache file from Obsidian. It verifies the canonical account
  identity before saving to SecretStorage, with a readback check and no login or
  OTP. Synthetic tests pass. On October 13, 2026, the live import completed and
  the prompt reported "Cloud access token validated and stored securely,"
  confirming the account identity validation and SecretStorage token/account
  readback through the Obsidian requestUrl adapter. No login or OTP was
  initiated. The harness cache has not been removed.
- On October 13, 2026, an earlier running-vault diagnostic attempt passed the
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
- Added a desktop-only, manual Cloud mirror engine selectable in the plugin's
  sync settings. It checks the stored session's account identity, binds the
  shared manifest to a versioned account fingerprint, verifies each inventory
  path, and runs the existing non-deleting guarded mirror. The signed-download
  adapter uses Obsidian `requestUrl` with no Cloud authentication headers and
  leaves redirect handling to Obsidian; no per-host confirmation is required.
  Cloud automatic sync and history reset remain disabled. IP sync refuses to run
  over Cloud-owned shared-manifest destinations until IP history uses that same
  manifest. Synthetic tests and the plugin build pass.
- On October 13, 2026, the manual test-vault run scoped to
  `/Document/TestFile.note` wrote one fixture and committed one Cloud record at
  manifest revision 3. A second manual run left the fixture hash and manifest
  revision unchanged. No login, OTP, remote deletion, or cache cleanup was
  performed; this confirms the current desktop fixture, not general host or
  redirect behavior across other environments.

## Current Status

- The manual Cloud mirror is implemented and passed a fixture-scoped test-vault
  transfer followed by an unchanged second run on October 13, 2026. A later run
  with the path allowlist cleared mirrored the matching note files from nested
  folders; the existing `.note, .spd` extension allowlist still limits the file
  types. Empty directories are not mirrored as standalone entries.
- Narrowing the path allowlist afterward (for example, to `/Document/**`) did
  not remove copies outside that path. Cloud should match IP behavior: filters
  limit transfer/update work, while previously mirrored files remain in the
  vault. Remote-deletion cleanup is separately specified but not implemented.
- Sync currently reports a completion summary. Start-of-run and per-file
  download-start notifications are not implemented; the external specification
  now requires all three lifecycle notices.
- Transfer uses an unauthenticated Obsidian `requestUrl` GET, leaving redirect
  handling to Obsidian. Account binding, checksum/size verification, local-edit
  protection, and non-deleting writes remain in place. No login, OTP, or
  cached-session cleanup is authorized by this work.

## Recommended Next Steps

1. Implement Cloud sync lifecycle notifications: notify after readiness passes
   when the run starts, immediately before each actual file download, and at
   completion with the existing secret-free counts. Do not notify for unchanged
   or excluded files; never include signed URLs, IDs, tokens, or raw responses.
2. Implement remote-deletion cleanup for previously managed files absent from
   the Cloud inventory. Require two complete inventories with identical
   fingerprints and an unchanged local hash before moving a copy to Obsidian
   Trash. Preserve locally edited copies and unrelated/unmanaged files. Filter
   exclusions must remain non-destructive, matching IP behavior.
3. Add focused tests for start/download/completion notices and remote-deletion
   candidates, including changed or incomplete inventories, local edits,
   unmanaged files, and current in-scope files. Then run `npm test`,
   `npm run build`, `npm run lint`, and `git diff --check`.
4. Validate remote-deletion behavior in the test vault only after the guarded
   code is implemented. Keep the current fixture/file scope controlled; verify
   both the Obsidian Trash result and that locally edited files remain
   untouched.

The `Obsidian-assisted checks` section in `AGENTS.md` now documents attaching VS
Code's JavaScript debugger to the Electron renderer at localhost port 9222; use
`npm run dev` for inline source maps and fully quit Obsidian before relaunch.

The opt-in protocol harness remains separate from product sync. Keep its
fixture-host check and consent requirements; do not initiate login/OTP or clear
the harness cache without separate explicit authorization. Never place tokens,
signed URLs, IDs, or response bodies in notes, logs, or diagnostics.
