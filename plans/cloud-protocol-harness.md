# Cloud Protocol Harness Plan

**Status:** Opt-in protocol validation and compatibility plan. **Scope date:**
October 12-13, 2026.

This document defines an opt-in, secret-redacting local harness for resolving
the production-protocol validation gates in Section 11.3 of the
[Cloud Sync External Specification](cloud-sync-spec.md). The harness is a
development and maintenance instrument, not a product feature or a general
integration-test fixture. Retain it under `scripts/` after the Cloud engine is
implemented: synthetic tests establish what the plugin accepts, but cannot
detect changes to the undocumented hosted service. As with the opt-in device
sync and browser smoke scripts, ordinary tests and releases never run it.

## 1. Objectives

Use an authorized Supernote Cloud test account to resolve these gates:

1. Password sign-in request and session requirements.
2. Directory-list response and pagination shape.
3. Canonical Cloud path construction.
4. Download descriptor and transfer behavior.
5. Canonical account identity.
6. Email-code sign-in, if the optional branch is tested for the first release.

For each gate, record the test date, request shape, response category, and a
secret-free result. A successful observation establishes only the production
behavior exercised on that date; it is not a general service guarantee.

## 2. Diagnostic Test Account

Prepare a dedicated account through an official Supernote client. Do not add
undocumented Cloud write operations to the harness merely to arrange fixtures.
The account should contain:

- A file directly under each root category presented by the service.
- At least two nested directory levels.
- Duplicate filenames in different directories.
- Names containing spaces, `+`, parentheses, and non-ASCII characters.
- An empty directory.
- A file whose local bytes, length, MD5, and SHA-256 are known.
- At least 101 direct entries (files or folders) in one directory so a page size
  of 100 requires a real second page.

Use only synthetic names and content that may safely appear in a redacted test
report. Keep personal files out of the account.

## 3. Harness Shape

Follow the repository's existing opt-in integration-script pattern:

- Expose an explicit command such as `npm run test:cloud-protocol`.
- Bundle a small entry point that imports the real Cloud protocol and parsing
  modules intended for the plugin.
- Read credentials from an interactive prompt or environment variables, never
  command-line arguments or tracked files.
- Reuse `SUPERNOTE_CLOUD_ACCESS_TOKEN` when supplied; otherwise reuse the
  harness-only session cache in the OS temporary directory. Validate every
  reused token with fresh CSRF state and `/api/user/query` before using it.
- Never fall back from a missing, expired, or rejected reusable token to
  password login automatically. Require the separate
  `SUPERNOTE_CLOUD_ALLOW_LOGIN=I_ACKNOWLEDGE_OTP_MAY_BE_SENT` acknowledgement
  before prompting for credentials or requesting an email code.
- Maintain an explicit cookie jar and CSRF state for each sign-in attempt.
- Follow download redirects manually so every target can be inspected before it
  is requested.
- Apply an absolute request count and traversal bound in addition to the Cloud
  policy limits.
- Require an explicit opt-in acknowledgement before contacting production.
- Fail closed when a response cannot be safely classified or redacted.

Do not make remote upload, replace, move, copy, rename, delete, recycle, share,
or other write requests. The harness may call only the read-only and
authentication routes permitted by the external specification.

## 4. Secret Handling And Reports

The harness must never persist or print:

- Passwords or verification codes.
- Session, pre-auth, or CSRF token values.
- Cookie values.
- Complete signed download URLs or URL query strings.
- Raw production response bodies.
- Personal account paths, profile values, or file contents.

The temporary session cache is the one narrow exception for the bearer token: it
exists specifically to avoid repeatedly generating email OTP challenges. It
stores only the production origin, token, canonical account ID, and save time;
it is outside the repository, written with owner-only mode where the operating
system supports it, never copied into an observation, and deleted after the
plugin is fully developed and the account owner is ready for an end-to-end login
test through the options-panel UI, with explicit approval for cleanup. Do not
remove the cache merely because protocol validation is complete. Cache retention
does not guarantee that the service will keep the token valid.
`SUPERNOTE_CLOUD_SESSION_FILE` may point it at another device-local temporary
path. `SUPERNOTE_CLOUD_ACCOUNT_ID` may accompany an environment token to enforce
the same account-binding check.

The harness may report only the minimum structural evidence needed for review:

- HTTP method and route, excluding sensitive query values.
- Request field names and the type or fixed enum value of non-secret fields.
- HTTP status and service success category.
- Response field names and observed JSON types.
- Cookie names without values.
- Download URL scheme, hostname or reviewed host pattern, port, and sanitized
  redirect origins.
- File byte counts and cryptographic hashes for synthetic fixtures.
- Stable per-run hashes in place of remote IDs, except for the assertion that
  `userId` has a canonical decimal-string representation.

The output should be suitable for direct inclusion in a dated protocol
observation without further secret removal. The harness must not write raw data
first and attempt to redact it afterward.

## 5. Execution Order And Pass Criteria

Run the gates in dependency order so one authenticated session can establish the
identity, inventory, path, and download observations.

### 5.1 Password sign-in

Start with the strongest request shape supported by compatible-client evidence:
fresh CSRF bootstrap, retained cookies, CSRF header, the specified password
derivation, and the known compatible client-identification fields. Do not run a
large combinatorial search over login parameters. Change one field at a time
only when the evidence-backed request fails.

Pass when the same recorded request shape returns a non-empty session token in
two fresh sessions. Record the required field names, fixed enum values, cookie
names, and CSRF placement without recording secret values. A consistently
accepted request may retain apparently optional fields; proving the absolutely
minimal request is not required.

This gate passed in two fresh sessions on October 12, 2026. Later inventory,
path, and download probes should reuse the validated session cache rather than
repeat this gate. A new login is justified only when no reusable token remains
valid and the account owner is available for a possible OTP challenge.

### 5.2 Account identity

Immediately call `/api/user/query` with the authenticated token and repeat the
query after the second fresh sign-in.

Pass when `userId` is present, can be consumed without conversion through a
JavaScript `number`, has a canonical decimal-string representation, and is the
same in both sessions. Persist only a hash of the observed value in the report.

### 5.3 Inventory response shape

List the root and diagnostic directories with `pageNo: 1`, `pageSize: 100`,
`order: "filename"`, and `sequence: "asc"`. Traverse a 101+-entry directory
through its second page, then perform a second unchanged inventory.

Pass when the harness identifies the actual item-list, total, and page-count or
page-size fields needed by the bounded inventory policy; validates their
observed types; reaches every expected synthetic item exactly once; and produces
identical inventory fingerprints for two unchanged passes. The October 13 hosted
envelope used `pages` and `size` but omitted `pageNum` and `pageSize`; an absent
current-page field is not a failure when the bounded requested page and
accumulated total can be verified.

An empty second page, inconsistent total outside the exact documented six-folder
root exception, duplicate ID, conflicting metadata, unexpected supplied page
number, or unclassified pagination field fails this gate.

On October 13, the authorized account yielded a real second page and two
matching complete inventories after the account owner created direct folders
through the official client. The read-only harness must not add undocumented
write calls to manufacture or remove fixtures.

### 5.4 Canonical paths

For representative root, nested, duplicate-name, unusual-name, file, and folder
entries, compare:

- Root and recursive listing names and parent IDs.
- Parent-derived paths.
- Flattened root-category presentation.
- `/api/file/path/query` `path` and `idPath` results.

The sanitized report should contain a table with per-run item and parent hashes,
synthetic listing names, returned path forms, and the proposed normalized path.
It should explicitly settle leading and trailing slashes, category flattening,
percent decoding, `+` handling, Unicode normalization, duplicate leaf names, and
whether the path query describes the item or only its parent.

On October 13, relative trailing-slash query paths were stable across two passes
after reconciling known root-category casing; a nested `.note` file agreed with
its queried parent. A second two-pass run verified two same-named folders under
different parents containing literal `%`, `+`, Unicode, spaces, and parentheses
(116 items, 232 path queries). The tested path gate passed: one deterministic
normalization produced unique stable leading-slash paths. This does not
establish every Unicode representation or authorize deletion without the other
safety gates. Any unexplained path disagreement keeps filtering and path-based
deletion unavailable.

### 5.5 Download transfer

Request a type `"0"` descriptor for the known synthetic fixture. Parse the URL
without logging it, then issue a credential-free `GET`. Handle redirects one hop
at a time and validate each target before following it.

Pass when every hop uses HTTPS and a narrowly recordable hostname or host
pattern; the harness sends no Cloud token, cookies, CSRF header, URL-embedded
credentials, or other Cloud authorization to descriptor hosts; and the final
bytes match the known length and descriptor MD5. Record the fixture SHA-256 as
additional evidence.

### 5.6 Optional email-code sign-in

Test this branch only with an account that naturally receives login `E1760`.
Confirm code request, one rejected or expired code, resend or restart behavior,
successful use of a current code, OTP login, final `/api/user/query/token`, and
account identity retrieval in the same session.

Pass only when the complete sequence succeeds and the observed failure cases can
be handled without guessing at unrelated error-code meanings. Do not create
repeated failures merely to enumerate undocumented errors.

## 6. Obsidian Runtime Confirmation

Node execution can establish response and redirect behavior, but it does not
prove that the plugin's Obsidian/Electron runtime exposes the same cookie,
header, and redirect controls. After the Node probe passes, repeat the smallest
successful password-sign-in, identity, one-page listing, and fixture-download
flow in the headless Obsidian test environment using the intended production
transport.

If the production transport cannot inspect redirect targets, the implementation
must disable redirects for that transport as required by the external
specification. A Node-only redirect result must not be used to bypass that
constraint.

## 7. Evidence And Automated Tests

For each meaningful new production finding, review the temporary harness output
and update the dated "Resolved Unknowns and Undocumented Behaviors" section of
[Cloud Sync External Specification](cloud-sync-spec.md), rather than keeping
per-run observation files. Where applicable, record:

- Production base origin and test date.
- Harness and Cloud implementation commit identifiers.
- Secret-free request shapes and response schemas.
- Reviewed download hosts and redirect origins.
- Synthetic fixture counts and inventory fingerprints.
- Pass, fail, or unavailable status for the relevant Section 11.3 gate.
- Capabilities that must remain disabled.

After review, create synthetic JSON and transfer fixtures that reproduce the
observed structures without production values. Parser, inventory, path,
transfer, and failure-policy tests must use those synthetic fixtures, never
captured production responses.

## 8. Retention And Sharing Review

Keep the harness and synthetic tests as separate tools: the former checks the
current hosted protocol with explicit account-owner authorization, and the
latter runs without credentials or network access in ordinary CI. The harness
stays opt-in, read-only apart from expressly authorized authentication, bounded,
credential-external, secret-redacting, and excluded from CI, release builds, and
automatic schedules. Do not ship token caches or recovery files; their separate
cleanup timing remains governed by Section 4.

Before publishing or sharing a harness run, review the output for account names,
file paths, remote IDs, profile fields, tokens, cookies, raw responses, signed
URLs, and stable account-identifying hashes. Publish only a dated, manually
reviewed, secret-free observation and synthetic fixtures, not the live output by
default. Re-review the route allowlist, consent gates, request budget,
redaction, cache permissions, and documentation whenever the hosted protocol or
the harness changes. Remove the harness only after an explicit maintainer
decision that its compatibility value no longer justifies its credential-bearing
production surface.
