# Cloud Sync External Specification

**Status:** Draft for implementation planning only. **Scope date:** October
12, 2026.

This document specifies the externally observable contract for the proposed
Cloud engine in `obsidian-supernote-companion`. It is a behavior-and-protocol
specification, not an implementation design. It does not describe source code,
algorithms, module layout, or internal data structures.

## 1. Scope

The Cloud engine supports exactly these user-facing capabilities:

- Sign in to a Supernote Cloud account with account credentials.
- Complete an email verification-code step when the verified protocol requires
  it.
- Store a Cloud session token and stable account identity in device-local
  Obsidian storage.
- Manually mirror Cloud content into one configured vault folder.
- Automatically run that same one-way mirror on the plugin's shared interval
  when Cloud is the active engine.
- Filter Cloud paths with the established `*`, `**`, and `?` path-mask syntax.
- Download new or changed Cloud files.
- Preserve a locally edited mirrored file instead of silently overwriting or
  removing it.
- Move an unchanged local mirror copy to Obsidian Trash after its Cloud source
  is confirmed absent by a complete inventory.
- Sign out and forget only the local session token.

Exactly one sync engine is active in the plugin. When Cloud is inactive, Cloud
setup can be edited and sign-in can be performed, but Cloud mirroring cannot run
manually or automatically.

## 2. Non-Goals

This specification prohibits the Cloud engine from calling or exposing behavior
for:

- Uploading, replacing, moving, copying, renaming, deleting, or recycling Cloud
  content.
- A Paired folder or any other two-way synchronization.
- Sending files to Supernote.
- Cloud browsing or Cloud-folder selection UI.
- A simultaneous or combined run of multiple sync engines.

Remote API operations outside the endpoint table in this document are out of
scope, even where public references describe them.

## 3. Evidence Classes

Every statement in this document has one of these labels:

| Label                   | Meaning                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| **Documented fact**     | Directly published by a cited public API/documentation source.                |
| **Product requirement** | Required behavior of this plugin. It is not a claim about the remote service. |
| **Assumption**          | A planned interpretation that must be validated before release.               |
| **Unknown**             | Not documented by the reviewed public sources. Do not guess or depend on it.  |

The exact production behavior of the Supernote service may differ from
community-maintained API descriptions. A documented fact in a third-party public
OpenAPI document is not a vendor guarantee.

## 4. Public Sources and Attribution

This specification is an original summary of public protocol facts. It does not
copy source code, test fixtures, implementation structure, or prose from any
project.

| Source                                                                                                                                      | License                          | Use in this specification                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`allenporter/supernote` OpenAPI specification](https://github.com/allenporter/supernote/blob/main/api-spec/openapi.yaml)                   | Apache-2.0                       | Primary public source for the published server base URL, route names, request/response fields, and `x-access-token` declaration.  |
| [`allenporter/supernote`](https://github.com/allenporter/supernote) and its [published Python package](https://pypi.org/project/supernote/) | Apache-2.0                       | Corroborating context for the project's documented private-cloud compatibility and list/download capabilities.                    |
| [`ddulic.github.io/supernote/supernote.html`](https://ddulic.github.io/supernote/supernote.html)                                            | Apache-2.0 project documentation | Context only for a third-party self-hosted Private Cloud implementation; it is not evidence for hosted Supernote Cloud endpoints. |
| [`adrianba/supernote-cloud-api`](https://github.com/adrianba/supernote-cloud-api)                                                           | MIT                              | Independent corroboration that a public Cloud workflow can include login, folder listing, and obtaining a file URL.               |

Attribution in implementation documentation should acknowledge these public
references where their protocol facts are used. Do not copy their source files
or treat their implementation choices as requirements. If any Apache-2.0 or MIT
licensed material is incorporated verbatim or substantially, comply with that
source's notice requirements separately.

## 5. Transport Baseline

| Item                                                            | Classification  | Specification                                                                                          |
| --------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| Published production server                                     | Documented fact | `https://cloud.supernote.com` is listed as the production server by the reviewed third-party OpenAPI.  |
| Request format                                                  | Documented fact | Listed control-plane endpoints accept JSON request bodies and return JSON responses.                   |
| Protected endpoint header                                       | Documented fact | The OpenAPI declares `x-access-token` as an API-key header for protected endpoints.                    |
| Success envelope                                                | Documented fact | Published responses use `success` (boolean); they may also contain `errorCode` and `errorMsg` strings. |
| Non-200 status codes                                            | Unknown         | The reviewed OpenAPI documents `200` responses but does not enumerate HTTP error statuses.             |
| Request timeouts, retry policy, rate limits, pagination limits  | Unknown         | No reviewed public source defines them.                                                                |
| TLS, redirects, download-host allowlist, and certificate policy | Unknown         | The service base URL is HTTPS, but detailed download-transfer rules are not published.                 |

**Product requirement:** the Cloud engine sends credentials and session tokens
only over HTTPS. Tokens, passwords, verification codes, and full download URLs
must never be written to plugin logs, notices, diagnostics, or synced settings.

## 6. Required Read-Only Endpoint Catalogue

All routes below are relative to the published production server. A request that
requires a token sends `x-access-token: <session token>`.

### 6.1 Obtain login nonce

| Item             | Classification  | Specification                                                                                    |
| ---------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| Method and route | Documented fact | `POST /api/official/user/query/random/code`                                                      |
| Authentication   | Documented fact | No token requirement is declared in the reviewed OpenAPI.                                        |
| Request JSON     | Documented fact | `account` string is required. `countryCode` string is optional.                                  |
| Success JSON     | Documented fact | Common response fields plus `randomCode` string and `timestamp` integer (int64).                 |
| Purpose          | Documented fact | The published schema describes the random code as a server-side nonce/salt for password hashing. |

### 6.2 Account login

| Item                  | Classification  | Specification                                                                                                                                                                                                                                  |
| --------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and route      | Documented fact | `POST /api/official/user/account/login/new`                                                                                                                                                                                                    |
| Authentication        | Documented fact | No token requirement is declared in the reviewed OpenAPI.                                                                                                                                                                                      |
| Content type          | Documented fact | `application/json`                                                                                                                                                                                                                             |
| Required request JSON | Documented fact | `account` string, `password` string, `equipment` integer, and `loginMethod` string.                                                                                                                                                            |
| `account`             | Documented fact | The published schema describes it as an email address or phone number.                                                                                                                                                                         |
| `password`            | Documented fact | The published schema requires a derived password value, not a plaintext password, and describes two accepted derivations based on MD5, the plaintext password, and the nonce/random value.                                                     |
| `equipment`           | Documented fact | One of `1` (web), `2` (app), `3` (terminal/device), or `4` (platform).                                                                                                                                                                         |
| `loginMethod`         | Documented fact | One of `"1"` (phone/account), `"2"` (email), or `"3"` (WeChat).                                                                                                                                                                                |
| Optional request JSON | Documented fact | `countryCode`, `browser`, `language`, `equipmentNo`, and `timestamp` are published optional fields.                                                                                                                                            |
| Success JSON          | Documented fact | Common response fields plus a `token` string. The published schema describes it as a JWT access token. Optional published fields include account-binding indicators, a user name, avatar URL, last-update time, error count, and logout count. |

**Product requirement:** the user-facing sign-in form supports email-based
credentials only in the first release. It does not present phone or WeChat
sign-in choices.

**Unknown:** which of the two published password derivations a production
account accepts, whether additional client-identification fields are required,
and the service behavior when either derivation is rejected. These must be
verified against a dedicated test account before this feature is released.

### 6.3 Request an email verification code

| Item             | Classification  | Specification                                                                                                  |
| ---------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| Method and route | Documented fact | `POST /api/user/mail/validcode`                                                                                |
| Authentication   | Documented fact | No token requirement is declared in the reviewed OpenAPI.                                                      |
| Request JSON     | Documented fact | `email` string is required; `language` string is optional.                                                     |
| Response         | Unknown         | The route refers to an `EmailVO`, but that response schema was not present in the reviewed public schema file. |

### 6.4 Validate an email verification code

| Item             | Classification  | Specification                                              |
| ---------------- | --------------- | ---------------------------------------------------------- |
| Method and route | Documented fact | `POST /api/user/check/validcode`                           |
| Authentication   | Documented fact | No token requirement is declared in the reviewed OpenAPI.  |
| Request JSON     | Documented fact | `validCodeKey` string and `validCode` string are required. |
| Success JSON     | Documented fact | Common response envelope.                                  |

**Unknown:** whether this validation route is part of the account-login flow,
how `validCodeKey` is obtained for email verification, whether successful
validation produces a session token, and which login response condition signals
that verification is required. The engine must not claim verification-code
support until those facts are recorded from a permitted public protocol test.

### 6.5 Token/session check

| Item                       | Classification  | Specification                                                                                    |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| Method and route           | Documented fact | `POST /api/user/query/token`                                                                     |
| Success JSON               | Documented fact | Common response fields plus `token` string.                                                      |
| Authentication requirement | Unknown         | The reviewed OpenAPI does not declare an `x-access-token` requirement for this route.            |
| Product use                | Assumption      | It may be used only after a test confirms its request requirements and token-validity semantics. |

### 6.6 Query current account identity

| Item             | Classification      | Specification                                                                                                |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Method and route | Documented fact     | `POST /api/user/query`                                                                                       |
| Authentication   | Documented fact     | Requires `x-access-token`.                                                                                   |
| Request JSON     | Documented fact     | No request body is declared.                                                                                 |
| Success JSON     | Documented fact     | Common response fields plus `userId` (int64), profile fields, and account status.                            |
| Product use      | Product requirement | On first successful Cloud setup, retain the returned stable `userId` as the account binding for that mirror. |

**Assumption:** `userId` is stable for the account and suitable for preventing
cross-account mirror ownership. Validate this before release. If it is not
stable, the feature must remain blocked until a stable public identifier is
identified.

### 6.7 List a directory

| Item              | Classification  | Specification                                                                                                                             |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Method and route  | Documented fact | `POST /api/file/list/query`                                                                                                               |
| Authentication    | Documented fact | Requires `x-access-token`.                                                                                                                |
| Request JSON      | Documented fact | `directoryId` int64, `order` string, `sequence` string, `pageNo` int32, and `pageSize` int32 are required.                                |
| Root directory    | Documented fact | The published schema specifies `directoryId: 0` for the root.                                                                             |
| Sort values       | Documented fact | The published schema lists `filename`, `time`, and `size` for `order`, and `asc` or `desc` for `sequence`.                                |
| Success JSON      | Documented fact | Common response fields, `total` int64, and `userFileVOList`.                                                                              |
| Entry fields      | Documented fact | Each published entry may include `id`, `directoryId`, `fileName`, `size`, `md5`, `isFolder` (`Y` or `N`), `createTime`, and `updateTime`. |
| Root presentation | Documented fact | The published schema warns that the web listing can flatten internal root folders in its presentation.                                    |

**Unknown:** pagination origin, permitted page sizes, whether the full `total`
is stable during a multi-page inventory, whether item IDs can exceed JavaScript
safe integers, and the exact treatment of inaccessible or deleted entries.

### 6.8 Query a file path

| Item             | Classification  | Specification                                                                                                                                                 |
| ---------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and route | Documented fact | `POST /api/file/path/query`                                                                                                                                   |
| Authentication   | Documented fact | Requires `x-access-token`.                                                                                                                                    |
| Request JSON     | Documented fact | `id` int64 is required.                                                                                                                                       |
| Success JSON     | Documented fact | Common response fields plus `path` and `idPath` strings. The public schema describes both as slash-separated and trailing-slash-terminated.                   |
| Product use      | Assumption      | It may be required to reconcile filter paths with the root's flattened presentation. Its relationship to recursive listing paths must be verified before use. |

### 6.9 Obtain a download descriptor

| Item                | Classification      | Specification                                                                                                             |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Method and route    | Documented fact     | `POST /api/file/download/url`                                                                                             |
| Authentication      | Documented fact     | Requires `x-access-token`.                                                                                                |
| Request JSON        | Documented fact     | `id` int64 and `type` string are required. The published schema defines `type: "0"` as download and `type: "1"` as share. |
| Product requirement | Product requirement | The Cloud engine uses only `type: "0"`. It must never request a share descriptor.                                         |
| Success JSON        | Documented fact     | Common response fields plus `url` string and `md5` string.                                                                |

### 6.10 Transfer file bytes from a descriptor URL

| Item                    | Classification  | Specification                                                                                                                                 |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| URL source              | Documented fact | The previous endpoint returns a URL string for file content.                                                                                  |
| HTTP method             | Unknown         | The reviewed public sources do not specify whether the descriptor URL is fetched with `GET`, which headers it needs, or whether it redirects. |
| Authorization           | Unknown         | The reviewed public sources do not specify whether the descriptor URL requires `x-access-token`, another credential, or no additional header. |
| Content type and length | Unknown         | The reviewed public sources do not specify response MIME types or transfer-length guarantees.                                                 |
| Integrity field         | Documented fact | The descriptor response contains an `md5` string.                                                                                             |

**Product requirement:** downloaded bytes must match the documented MD5 value
before being treated as a successful Cloud file transfer. A mismatch is a
per-file failure and must not overwrite or remove a locally protected copy.

### 6.11 Logout

| Item             | Classification      | Specification                                                                                                                                                                |
| ---------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and route | Documented fact     | `POST /api/user/logout`                                                                                                                                                      |
| Authentication   | Documented fact     | Requires `x-access-token`.                                                                                                                                                   |
| Success JSON     | Documented fact     | Common response envelope.                                                                                                                                                    |
| Product behavior | Product requirement | Local sign-out clears the device-local session token even when remote logout fails or cannot be reached. It does not delete mirrored vault files or their ownership history. |

## 7. Data Acceptance Rules

These rules describe the externally visible validity boundary, not an internal
implementation method.

### 7.1 Common response envelope

A JSON control-plane response is usable only when all of the following are true:

- It is syntactically valid JSON.
- It has a boolean `success` field.
- `success` is `true`.
- Every field needed for the requested operation has the published type.

An `errorCode` or `errorMsg` may be shown in a secret-free error detail if
present. Their values and meanings are otherwise **unknown**; the product must
not branch on undocumented numeric or string codes without a recorded public
verification.

### 7.2 File metadata

For a file selected for mirroring, the engine requires a usable remote ID, file
name, parent relation or verified canonical path, folder/file indicator, and
checksum. The published `md5` field is the remote checksum field.

**Assumption:** an item with `isFolder: "N"` is downloadable after a valid
download descriptor is obtained. The behavior for other values is unknown and
must be treated as unsupported rather than coerced.

### 7.3 Path masks

**Product requirement:** filters operate on normalized full Cloud paths with a
leading slash, for example `/Note/Work/Journal.note`.

- A blank filter set includes every discovered file.
- `*` matches within one path segment.
- `**` crosses directory boundaries.
- `?` matches one character.
- Matching is against the entire normalized path.
- A file excluded by a current filter remains outside the current transfer and
  deletion decision. It is not treated as remotely deleted.

The exact relationship between public web-listing paths and a canonical Cloud
path is **unknown** until validated with a test account. The feature must not
enable destructive cleanup until this normalization is verified.

### 7.4 Local destination safety

**Product requirement:** every mirrored destination remains below the configured
Cloud vault root. A remote name or path that cannot be represented safely below
that root is a protected per-file failure. It must not create, overwrite, move,
or delete a file outside that root.

The Cloud metadata directory is reserved beneath the root. A remote path that
collides with reserved metadata is not mirrored until the collision has a
documented, safe user-visible resolution.

## 8. Authentication User Experience

### 8.1 Sign in

1. The user chooses **Sign in to Supernote Cloud** and enters an email address
   and password.
2. The plugin obtains any documented nonce required for password login.
3. The plugin attempts account login using the published account-login route.
4. On a successful token-bearing response, the plugin retrieves and records the
   account binding before enabling Cloud sync.
5. The plugin reports the connected account without displaying the token.

### 8.2 Verification code

If a validated protocol test establishes that email verification is required:

1. The plugin requests a code for the entered email address.
2. The user enters the code in a modal dialog.
3. The plugin validates the code using the published verification route.
4. The plugin continues only through the documented follow-up that produces a
   usable session token.

Until the service's verification branch and `validCodeKey` source are verified,
the UI must report **Email verification is not yet supported by the verified
Cloud protocol** rather than prompt for a code that cannot complete sign-in.

### 8.3 Session lifecycle

- A session token is device-local and is never added to synced plugin settings.
- Account identity is stored with the token only to protect mirror ownership.
- The password and verification code are used only for the active sign-in
  attempt and are never persisted.
- A verified authentication failure clears the local token and changes Cloud
  status to **Sign in required**.
- A transport failure or an unknown service error does not clear a token solely
  because its meaning is unknown.
- Signing out removes the local token, retains local mirror ownership history,
  and prevents future Cloud runs until a user signs in.
- Signing in as a different account is blocked while the Cloud mirror is bound
  to another account. The user must select a different empty destination or
  explicitly reset the existing Cloud mirror.

## 9. Mirror User-Observable Behavior

### 9.1 Triggering

- The generic **Sync Supernote now** command runs only the active engine.
- When Cloud is active, that command starts one Cloud-to-vault mirror.
- When IP is active, no Cloud control-plane or download request is made.
- Automatic sync uses the same Cloud behavior only when Cloud is active and the
  shared interval is enabled.
- No sync begins on plugin startup, vault events, workspace events, sign-in,
  sign-out, destination changes, or filter changes.
- A second manual or scheduled trigger while any sync is running is skipped; it
  is not queued as another run.

### 9.2 Inventory and download outcomes

- The Cloud engine scans the Cloud account from its root, subject to the
  verified listing contract.
- A new in-scope file is downloaded into the configured Cloud vault root.
- A remote file whose published checksum still matches the recorded Cloud
  checksum is reported as unchanged and is not downloaded again.
- A changed remote file replaces its local mirror copy only when the local copy
  still matches the last successfully mirrored content.
- A locally changed mirror copy is protected; it is not silently overwritten.
- A remote rename or move preserves the local file only when its ownership and
  unchanged local content are established. Otherwise it is reported as protected
  rather than duplicated or removed silently.
- A current path filter can exclude a remote file from the run. It does not
  delete the previously mirrored local copy.

### 9.3 Remote deletion outcomes

- Remote absence can affect a local mirror copy only after the entire required
  remote inventory completed successfully.
- If a Cloud-missing file's local copy is unchanged since its last successful
  mirror, it moves to Obsidian Trash.
- If that local copy was edited, it remains in the vault and is reported as a
  protected item.
- Any incomplete inventory, pagination uncertainty, authentication failure,
  malformed result, or unknown path-normalization condition suppresses all
  remote-deletion cleanup for that run.

### 9.4 Completion feedback

Every completed run reports secret-free counts for:

- Downloaded files.
- Unchanged files.
- Excluded files.
- Local copies moved to Obsidian Trash.
- Protected files and per-file failures.

No completion message may expose credentials, session tokens, verification
codes, full signed download URLs, or remote error payloads that contain secrets.

## 10. Error Conditions and Required User Behavior

| Condition                                                    | Classification                           | Required user-visible behavior                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No active Cloud token                                        | Product requirement                      | Cloud status reads **Sign in required**. A manual Cloud run does not start.                                                                                              |
| Login request rejected                                       | Product requirement                      | Show sign-in failure without echoing password, nonce, or token. Preserve any existing valid token until the rejection is established as an authentication-expiry result. |
| Verification branch cannot be completed from verified facts  | Product requirement                      | Explain that verified email-code login support is unavailable; do not fabricate a continuation.                                                                          |
| Protected endpoint returns a verified authentication failure | Product requirement                      | Clear the local token, stop the run, and require sign-in.                                                                                                                |
| Protected endpoint returns an unknown error response         | Product requirement                      | Stop the affected operation, retain the token, show a secret-free failure, and record the response category only.                                                        |
| Network, DNS, TLS, timeout, or malformed JSON failure        | Product requirement                      | Stop the affected operation. Do not remove local files or clear the token solely for this condition.                                                                     |
| `success: false` response                                    | Documented fact plus product requirement | Treat the operation as failed. Show `errorMsg` only when it is safe to display; do not rely on an undocumented `errorCode` meaning.                                      |
| Missing/invalid file metadata                                | Product requirement                      | Treat the item as a per-file failure. Continue unrelated items when inventory completeness remains established.                                                          |
| Download URL cannot be retrieved                             | Product requirement                      | Treat the item as a per-file failure. Do not modify its existing local copy.                                                                                             |
| Download bytes fail integrity verification                   | Product requirement                      | Treat the item as a per-file failure. Do not replace or delete an existing local copy.                                                                                   |
| Local destination collision or unsafe path                   | Product requirement                      | Protect the item, make no destructive local change, and report the path conflict.                                                                                        |
| Local file differs from last mirrored content                | Product requirement                      | Protect the local file; do not overwrite or trash it.                                                                                                                    |
| Incomplete remote inventory                                  | Product requirement                      | Disable all remote-deletion cleanup for that run.                                                                                                                        |
| Attempt to use a different Cloud account with a bound mirror | Product requirement                      | Block mirroring until the user selects a different empty root or explicitly resets the Cloud mirror.                                                                     |
| Concurrent manual or automatic trigger                       | Product requirement                      | Skip the new trigger and leave the active run unchanged.                                                                                                                 |

## 11. Unknowns That Block Release Decisions

The following must be resolved from a permitted public protocol test, supported
vendor documentation, or a newly published vendor contract before the relevant
behavior is released:

1. The accepted password derivation for the current production service.
2. The login response condition that requires email verification.
3. The origin and lifecycle of `validCodeKey` for email verification.
4. The complete verified sequence from email-code validation to session token.
5. Pagination origin, maximum page size, and inventory consistency guarantees.
6. The relationship between listing hierarchy, flattened root presentation, and
   canonical paths for path-mask matching.
7. The HTTP method, redirect behavior, headers, allowed hosts, and content
   semantics of a returned download URL.
8. The stability and suitability of `userId` as an account-binding identifier.
9. The service's published authentication-expiry indicator, if any.
10. Published rate limits, timeouts, retry guidance, and file-size limits.
11. Exact behavior for Cloud items whose identifiers or sizes exceed local
    runtime limits.

Until an unknown is resolved, the product must use the non-destructive outcome
defined above or keep that capability unavailable.

## 12. Release Acceptance Criteria

The first Cloud release is acceptable only when all of these are true:

- It calls only the required read-only routes and the optional logout route in
  this specification.
- It does not make remote write, share, move, copy, rename, delete, recycle, or
  upload requests.
- Every endpoint and field used in production has a recorded evidence class and
  public-source reference.
- Email verification is either fully verified end-to-end or visibly unavailable.
- No destructive local cleanup occurs unless the complete remote inventory,
  account binding, path normalization, and local ownership checks are valid.
- Every downloaded file passes the published checksum comparison before it is
  treated as mirrored.
- User-facing behavior matches Sections 8 through 10.
- Automated tests cover documented success cases, every stated non-destructive
  error outcome, and every unresolved-unknown gate.
