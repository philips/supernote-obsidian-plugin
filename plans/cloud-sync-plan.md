# Cloud Sync Implementation Plan

**Status:** Manual and scheduled Cloud mirroring, guarded cleanup, interactive
Cloud sign-in/sign-out, session prompts, and shared sync reporting are
implemented and synthetically tested. The user reports completing live
logout/login; scheduled-sync checks, including signed-out handling and
main-window notices, are user-reported rather than independently captured. The
read-only username lookup was separately validated against the existing session.
The explicit Cloud mirror reset workflow remains unimplemented and is deferred
until after shared sync reporting. Updated October 15, 2026.

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
- Implemented a desktop-only Cloud mirror engine for manual and scheduled runs.
  The explicit reset workflow for clearing Cloud mirror history and account
  binding remains unimplemented and is deferred to a later sprint.
- Signed-in Cloud settings fetch the current `userName` through the existing
  account-identity route and display it only when the returned account ID
  matches the active session. Neither the username nor its response is stored; a
  missing name or failed lookup leaves the status as Signed in. A read-only
  October 15, 2026 hosted check confirmed the name matched the value supplied by
  the user.
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
- The Cloud completion notice counts successful empty-folder Trash moves
  separately from file Trash moves, displaying the folder count when nonzero.
- On October 14, 2026, a user-triggered Cloud sync removed an already-empty
  local mirror folder as expected. That observation confirms the folder
  disappeared; the subsequent controlled checks below addressed Trash placement
  and folder-safety scenarios.
- On October 14, 2026, validated guarded deletion in the Marie vault using a
  unique synthetic destination and a filter that matched no Cloud files. One
  unchanged fixture moved to Obsidian system Trash; a locally edited fixture and
  an unmanaged fixture stayed intact. The synthetic destination was then
  removed, leaving the system Trash item. No login/OTP or Cloud mutation was
  performed. The local debugger attached to a Marie-targeted Obsidian launch.

### Implementation Decisions

- Keep Cloud sync desktop-only and dispatch only the active engine. Scheduled
  runs use the same readiness and mirror safeguards as manual runs. The user
  reported scheduled-sync validation on October 15, 2026; this is distinct from
  automated coverage and independently captured diagnostics.
- Keep all mirror writes non-destructive until the complete-inventory,
  account-binding, canonical-path, shared-manifest, and unchanged-local-hash
  protections are in place.
- Keep IP and Cloud on the shared manifest contract. Do not allow IP sync to
  overwrite Cloud-managed destinations until IP history is migrated.
- Preserve the current manifest and local-edit protection rules for both engines
  during the shared reporting sprint. A change to which files Cloud may
  overwrite or move to Trash requires a separate design and implementation.
- Put each operational limit in one authoritative Cloud policy/constants module;
  request, inventory, transfer, and test code should reference those
  declarations rather than repeat numeric literals. The required defaults are
  specified in Section 11.1 of the external design.
- Never persist credentials, tokens, OTP values, signed URLs, raw response
  bodies, account data, or raw Cloud errors in logs, fixtures, or reports.
  Protected and failed file paths may be written to the user-owned sync log, as
  they are for IP sync. Retain the harness cache unless separately authorized
  for cleanup.

## Completed Sprints

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

### Sprint 3: Empty Mirror Folder Cleanup

- After each successful file Trash and manifest commit, the adapter moves only
  empty ancestors to Obsidian Trash, stopping at a nonempty folder or before the
  configured sync root. An inventory-verified pass also removes already-empty
  local folders when the Cloud subtree has no in-scope files, whether that
  remote folder exists or not.
- Both cleanup paths require matching complete inventories. A failed or
  suppressed file deletion does not trigger its parent cleanup; the separate
  scan can still consider other already-empty folders when the inventory is
  verified and there are no per-file failures. Local files of any type, local
  subfolders, in-scope Cloud files, the sync root, and mirror metadata prevent
  removal. Folder Trash failures warn without undoing a committed file deletion.
- Synthetic tests cover nested and single empty parents, occupied parents
  containing Markdown, JPEG, PNG, or PDF files, root protection, excluded and
  in-scope remote files, edited files, changed/incomplete inventories, failed
  file Trash, and failed manifest commits. The final notice reports successful
  folder moves separately from file moves without double-counting.

### Sprint 4: Controlled Folder Cleanup Validation

- On October 14, 2026, the user reported completing the four controlled-vault
  handoff checks: scoped synthetic fixtures without new login/OTP or Cloud
  mutations; file and empty-parent Trash placement after manifest commit with
  the root retained; already-empty folder cleanup with absent or out-of-scope
  Cloud contents while preserving occupied, in-scope, and metadata folders; and
  separate completion-notice counts without double-counting.
- These checks are user-reported outcomes, not a new automated test run or an
  independently captured Obsidian diagnostic. No additional code change was
  reported as necessary during validation.

### Sprint 5: Active-Engine Automatic Sync

- Added a shared coordinator-owned one-minute poller and an opt-in interval
  setting (off by default). Valid persisted attempt timestamps allow at most one
  due catch-up run on restart; missing, malformed, or future timestamps
  initialize without running. Changing engines or interval choices rebases the
  active clock rather than dispatching a run.
- Replaced the fixed interval dropdown with an Automatic sync toggle and a
  conditional numeric Interval field in minutes. The selected interval is
  retained when disabled and re-enabling starts a fresh wait. Positive safe
  integers are accepted without an arbitrary upper limit; values under five
  minutes display a Cloud throttling advisory because the service limit is
  unknown. Existing positive saved intervals remain enabled; legacy zero remains
  off with 15 minutes as the default saved choice.
- Due polls select only the active engine, skip overlap and unready engines, and
  record the attempt before dispatch. Cloud scheduled runs reuse the manual
  account validation, inventory, manifest, download, and guarded Trash path.
- No live scheduled run was initiated during the implementation sprint. The user
  later reported completing manual scheduled-sync checks, including signed-out
  sessions and main-window notices; see Sprint 7.

### Sprint 6: Cloud Sign-In and Session UX (implemented; live sign-in user-reported)

- Added Cloud Engine settings with status and Sign in / Sign out controls.
  Interactive sign-in uses the verified password flow and requests an email code
  only when required; cancelled and failed attempts do not persist credentials.
- The validated token and account identity alone are written to device-local
  SecretStorage. Sign-out invalidates both locally and attempts remote logout
  without relying on it. Existing mirror binding blocks a different account.
- Manual sync prompts for sign-in; scheduled sync reports sign-in or account
  binding problems in the main window without background authentication. A
  notice appears for each due failed attempt, paced by the configured interval.
  Account-identity HTTP 401 clears the token; unknown errors do not.
- Added synthetic coverage for session storage, rejected/cancelled sign-in,
  binding, sign-out, 401 retention policy, manual prompt classification, and
  scheduled attempt pacing. The user subsequently reported verifying the live
  logout/login flow. A separate authorized read-only profile query verified the
  username field; no new login or OTP was initiated for that lookup.

## Planned Work

### Shared Sync Protection Reporting and Log (implemented)

- Both engines map protected and failed items into `SyncIssue`. Manual and
  scheduled results use one reporting path. IP creates the shared log on clean
  runs, appends at most once per reportable run, and retains its manual error
  modal. Log-write failures do not mask sync results.
- `<syncFolder>/Sync Log.md` is shared, append-only, and engine-labeled. Cloud
  entries persist counts, protected/failed file paths, and allowlisted
  categories, but not account data, signed URLs, or raw errors. The separate
  Cloud log proposal was superseded in the design. Cloud planning and deletion
  exclude the log and `.supernote-sync` even under the `*` extension allowlist.
- Focused reporting tests and the full suite (453 tests), build, and lint passed
  on October 15, 2026. The Cloud per-file logging revision also passed the
  focused and full suites, build, and lint on that date. Lint reported 12
  warnings and zero errors. The final `git diff --check` remains blocked by one
  trailing blank line in `src/deviceSync.ts`; no live Cloud session, OTP, or
  destructive validation was used.

### Next: Explicit Cloud Mirror Reset

- Implement the separately confirmed destructive account/device-binding reset
  after the shared reporting sprint. Retain its existing scope and safety
  requirements in [`multi-sync-design.md`](multi-sync-design.md); do not change
  binding or reset history as part of reporting work.

### Sprint 7: User-Reported Scheduled Sync Validation

- On October 15, 2026, the user reported that manual testing over the prior two
  days provided confidence in scheduled sync, including signed-out sessions and
  main-window notice messages.
- Record this as user-reported validation, not an automated test run or an
  independently captured diagnostic. The existing synthetic scheduler tests
  remain the reproducible automated evidence.

## Validation Gates

The sprint gates were run on October 14, 2026:

1. Focused Cloud lifecycle and deletion tests during development.
2. `npm test`.
3. `npm run build`.
4. `npm run lint`.
5. `git diff --check`.
6. Controlled Marie-vault validation of remote deletion, using only replaceable
   synthetic fixtures. The vault's Trash option was `system`.

For Sprint 3, focused synthetic tests, `npm test` (423 passing),
`npm run build`, `npm run lint` (0 errors, 1 unrelated warning), and
`git diff --check` passed. Sprint 4's controlled-vault checks were subsequently
reported complete by the user; no new automated gates were run for that
validation-only sprint.

For Sprint 5 on October 15, 2026, focused coordinator and Cloud-engine tests,
`npm test` (428 passing), `npm run build`, and `npm run lint` (0 errors, 2
pre-existing warnings) passed. No live scheduled run was initiated during that
sprint; the user later reported manual scheduled-sync validation as recorded in
Sprint 7.

The interval-control follow-up passed `npm test` (430 passing), `npm run build`,
and `npm run lint` (0 errors, 2 existing warnings). It was not exercised in a
live scheduled Cloud run.

Sprint 6 passed focused synthetic tests, `npm test` (439 passing),
`npm run build`, `npm run lint` (0 errors; warnings include UI sentence-case and
settings fallback notices), and `git diff --check` on October 15, 2026. The user
later reported completing the live logout/login flow. A read-only October 15
profile query using the existing session confirmed the returned username matched
the value supplied by the user; it was not retained. The username UI changes
passed `npm test` (449 passing), `npm run build`, `npm run lint` (0 errors, 12
warnings), and `git diff --check`. Scheduled-sync outcomes are user-reported as
recorded in Sprint 7, not independently captured.

Do not use production login/OTP, delete or clear harness cache, or broaden the
test-vault fixture scope without separate explicit authorization. Keep protocol
observations secret-free and update the dated evidence in the external design
only when a new observation is made.
