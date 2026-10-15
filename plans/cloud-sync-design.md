# Cloud Sync External Design

**Status:** Draft behavior and acceptance specification; some specified
capabilities remain unimplemented. **Scope date:** October 12-14, 2026.

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
- Filter Cloud files with the plugin's shared file-extension allowlist.
- Download new or changed Cloud files.
- Preserve a locally edited mirrored file instead of silently overwriting or
  removing it.
- Move an unchanged local mirror copy to Obsidian Trash after its Cloud source
  is confirmed absent by a complete inventory.
- Move empty local mirror folders to Obsidian Trash when no in-scope Cloud files
  remain beneath them, without touching any local folder that has contents.
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
- Applying the custom dictionary to mirrored files. The dictionary transforms
  recognized text during Markdown generation; Cloud sync preserves source file
  bytes.

Remote API operations outside the endpoint table in this document are out of
scope, even where public references describe them.

## 3. Evidence Classes

Every statement in this document has one of these labels:

| Label                   | Meaning                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Documented fact**     | Directly published by a cited public API/documentation source.                                                          |
| **Compatible behavior** | Implemented by a cited compatible client against the hosted or Private Cloud service, but not guaranteed by the vendor. |
| **Product requirement** | Required behavior of this plugin. It is not a claim about the remote service.                                           |
| **Assumption**          | A planned interpretation that must be validated before release.                                                         |
| **Unknown**             | Not documented by the reviewed public sources. Do not guess or depend on it.                                            |

The exact production behavior of the Supernote service may differ from
community-maintained API descriptions. A documented fact in a third-party public
OpenAPI document is not a vendor guarantee.

## 4. Public Sources and Attribution

This specification is an original summary of public protocol facts. It does not
copy source code, test fixtures, implementation structure, or prose from any
project.

| Source                                                                                                                                      | License                          | Use in this specification                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [Supernote Cloud support guide](https://support.supernote.com/en_US/Tools-Features/supernote-cloud)                                         | Vendor documentation             | Official user-facing confirmation of Cloud account, file-management, and download capabilities; it does not publish a protocol contract.  |
| [`allenporter/supernote` OpenAPI specification](https://github.com/allenporter/supernote/blob/main/api-spec/openapi.yaml)                   | Apache-2.0                       | Primary public source for the published server base URL, route names, request/response fields, and `x-access-token` declaration.          |
| [`allenporter/supernote`](https://github.com/allenporter/supernote) and its [published Python package](https://pypi.org/project/supernote/) | Apache-2.0                       | Corroborating context for the project's documented private-cloud compatibility and list/download capabilities.                            |
| [`ddulic.github.io/supernote/supernote.html`](https://ddulic.github.io/supernote/supernote.html)                                            | Apache-2.0 project documentation | Context only for a third-party self-hosted Private Cloud implementation; it is not evidence for hosted Supernote Cloud endpoints.         |
| [`adrianba/supernote-cloud-api`](https://github.com/adrianba/supernote-cloud-api)                                                           | MIT                              | Independent corroboration that a public Cloud workflow can include login, folder listing, and obtaining a file URL.                       |
| [`rnbennett/supernote-cloud`](https://github.com/rnbennett/supernote-cloud)                                                                 | Apache-2.0                       | Maintained hosted-Cloud client used as compatibility evidence for CSRF handling, password login, email OTP, listing, and downloads.       |
| [`dylanmazurek/supernote-sync`](https://github.com/dylanmazurek/supernote-sync)                                                             | MIT                              | Independent hosted-Cloud client used as compatibility evidence for string identifiers, pagination fields, account queries, and downloads. |
| [`nickian/Supernote-Private-Cloud-PHP-Client`](https://github.com/nickian/Supernote-Private-Cloud-PHP-Client)                               | Unspecified in reviewed files    | Private Cloud compatibility evidence for password derivation, 1-based listing requests, JWT claims, and large decimal identifiers.        |

Attribution in implementation documentation should acknowledge these public
references where their protocol facts are used. Do not copy their source files
or treat their implementation choices as requirements. If any Apache-2.0 or MIT
licensed material is incorporated verbatim or substantially, comply with that
source's notice requirements separately.

### 4.1 Compatible-client research findings

The following findings were reviewed on October 12, 2026. They narrow several
implementation unknowns, but they remain **compatible behavior**, not vendor
contract terms:

| Finding                     | Evidence                                                                                                                                                               | Specification disposition                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Password derivation         | Three hosted-Cloud clients and one Private Cloud client independently use `SHA256(MD5(plaintext password) + randomCode)`.                                              | Use this derivation for the first login attempt. Do not implement the alternative derivation unless later evidence requires it.        |
| Email identity verification | `rnbennett/supernote-cloud` implements a complete branch: login error `E1760`; pre-auth token; signed email-code request; `validCodeKey`; OTP login; then token query. | The branch passed an authorized hosted-service test in two fresh sessions on October 12, 2026; this remains dated compatible behavior. |
| CSRF/session state          | The maintained hosted-Cloud client obtains `/api/csrf`, retains cookies, sends `X-XSRF-TOKEN`, refreshes it after OTP, and retries once after HTTP 403.                | The October 12, 2026 test observed one CSRF refresh and one OTP retry after HTTP 403 in both fresh sessions.                           |
| Identifier precision        | Compatible clients represent file and directory IDs as strings, and published examples include values above JavaScript's safe-integer limit.                           | Store and transmit identifiers as canonical decimal strings; never round-trip them through JavaScript `number`.                        |
| Pagination origin           | Hosted and Private Cloud clients begin with `pageNo: 1`; compatible models expose `pages`, `pageNum`, and page-size fields.                                            | Use 1 as the first page. Maximum size and cross-page consistency remain unknown.                                                       |
| Download transfer           | Three hosted-Cloud clients request `type: 0`, then perform an unauthenticated HTTP `GET` of the returned URL.                                                          | `GET` without `x-access-token` is the compatibility baseline. Obsidian handles redirects; validate returned bytes before writing.      |
| Path presentation           | The compatible Private Cloud server deliberately flattens category containers such as `NOTE/Note` to `Note` for web APIs, while device APIs retain the physical path.  | Do not infer hosted-Cloud canonical paths from listing parent IDs alone. Verify path normalization before deletion cleanup.            |
| Operational guarantees      | No reviewed source publishes hosted-service rate limits, retry guidance, timeout guidance, inventory snapshot guarantees, or identifier/file-size ceilings.            | Use the conservative product defaults in Section 11.1 and keep every limit centrally adjustable.                                       |

Exact implementation locations reviewed for these observations include:

- [`rnbennett/supernote-cloud` authentication and transport](https://github.com/rnbennett/supernote-cloud/blob/main/supernote_cloud/api.py)
  and its
  [endpoint catalogue](https://github.com/rnbennett/supernote-cloud/blob/main/supernote_cloud/endpoints.py).
- [`dylanmazurek/supernote-sync` authentication](https://github.com/dylanmazurek/supernote-sync/blob/main/pkg/supernote-cloud/auth.go),
  [file operations](https://github.com/dylanmazurek/supernote-sync/blob/main/pkg/supernote-cloud/files.go),
  and
  [file models](https://github.com/dylanmazurek/supernote-sync/blob/main/pkg/supernote-cloud/models/files.go).
- [`adrianba/supernote-cloud-api` hosted-Cloud API](https://github.com/adrianba/supernote-cloud-api/blob/main/src/api.ts)
  and
  [download transfer](https://github.com/adrianba/supernote-cloud-api/blob/main/src/sync.ts).
- [`allenporter/supernote` Private Cloud client](https://github.com/allenporter/supernote/blob/main/supernote/client/web.py)
  and
  [web listing, path, and signed-download behavior](https://github.com/allenporter/supernote/blob/main/supernote/server/routes/file_web.py).
- [`nickian/Supernote-Private-Cloud-PHP-Client` client](https://github.com/nickian/Supernote-Private-Cloud-PHP-Client/blob/master/SupernotePrivateCloud.php)
  and
  [reverse-engineering notes and examples](https://github.com/nickian/Supernote-Private-Cloud-PHP-Client/blob/master/README.md).

A general web search found no official hosted-Cloud API contract. The vendor
support guide describes user-facing Cloud operations, not authentication,
pagination, identity stability, transfer-host policy, rate limits, or retries.

## 5. Transport Baseline

| Item                                                           | Classification      | Specification                                                                                                                                                         |
| -------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published production server                                    | Documented fact     | `https://cloud.supernote.com` is listed as the production server by the reviewed third-party OpenAPI.                                                                 |
| Request format                                                 | Documented fact     | Listed control-plane endpoints accept JSON request bodies and return JSON responses.                                                                                  |
| Protected endpoint header                                      | Documented fact     | The OpenAPI declares `x-access-token` as an API-key header for protected endpoints.                                                                                   |
| CSRF bootstrap and cookies                                     | Compatible behavior | A maintained hosted-Cloud client first requests `GET /api/csrf`, retains the response cookies, and sends the returned `X-XSRF-TOKEN` value on control-plane requests. |
| Success envelope                                               | Documented fact     | Published responses use `success` (boolean); they may also contain `errorCode` and `errorMsg` strings.                                                                |
| Non-200 status codes                                           | Unknown             | The reviewed OpenAPI documents `200` responses but does not enumerate HTTP error statuses.                                                                            |
| Request timeouts, retry policy, rate limits, pagination limits | Unknown             | No reviewed public source defines them.                                                                                                                               |
| TLS, redirects, and certificate policy                         | Unknown             | The service base URL is HTTPS, but detailed download-transfer rules are not published.                                                                                |

**Product requirement:** the Cloud engine sends credentials and session tokens
only over HTTPS. Tokens, passwords, verification codes, and full download URLs
must never be written to plugin logs, notices, diagnostics, or synced settings.

**Product requirement:** requests belonging to one sign-in attempt share one
cookie jar and CSRF state. A CSRF refresh must not silently repeat a
credential-bearing or verification-code request more than once.

## 6. Required Read-Only Endpoint Catalogue

All routes below are relative to the published production server. A request that
requires a token sends `x-access-token: <session token>`.

### 6.0 Obtain CSRF/session state

| Item              | Classification      | Specification                                                                                                                                                   |
| ----------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and route  | Compatible behavior | `GET /api/csrf`                                                                                                                                                 |
| Response state    | Compatible behavior | The hosted-Cloud client retains response cookies and reads an `X-XSRF-TOKEN` response header or cookie value.                                                   |
| Subsequent use    | Compatible behavior | JSON control-plane requests send `X-XSRF-TOKEN` and the retained cookies. The client refreshes CSRF state and retries once after HTTP 403.                      |
| Production status | Compatible behavior | Two fresh sessions on October 12, 2026 required this shared cookie/CSRF state; both OTP requests succeeded after one HTTP 403, one CSRF refresh, and one retry. |

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

**Compatible behavior:** independently implemented hosted-Cloud clients use
`SHA256(MD5(plaintext password) + randomCode)`. This is the specified first
release derivation. The request profile in Section 4.1, including
`loginMethod: "1"`, the recorded browser/equipment/language fields, retained
cookies, and CSRF state, succeeded in two fresh sessions on October 12, 2026.
This remains dated compatible behavior rather than a vendor guarantee or proof
that every accepted optional field is required.

### 6.3 Request an email verification code

| Item             | Classification  | Specification                                                                                                  |
| ---------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| Method and route | Documented fact | `POST /api/user/mail/validcode`                                                                                |
| Authentication   | Documented fact | No token requirement is declared in the reviewed OpenAPI.                                                      |
| Request JSON     | Documented fact | `email` string is required; `language` string is optional.                                                     |
| Response         | Unknown         | The route refers to an `EmailVO`, but that response schema was not present in the reviewed public schema file. |

The published route above is not the route used by the reviewed compatible
hosted-Cloud login flow. That flow uses these additional operations:

| Item                    | Classification      | Specification                                                                                                                                                                             |
| ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-auth route          | Compatible behavior | `POST /api/user/validcode/pre-auth` with JSON `{ "account": <email> }`. A successful response supplies a token used only to authorize sending the code.                                   |
| Pre-auth key derivation | Compatible behavior | Interpret the final character of the pre-auth token as a decimal index and select that hyphen-separated token component as the signing key. Reject malformed tokens rather than guessing. |
| Send-code route         | Compatible behavior | `POST /api/user/mail/validcode/send`.                                                                                                                                                     |
| Send-code JSON          | Compatible behavior | `email`, the original login `timestamp`, the pre-auth `token`, and `sign = SHA256(email + extracted key)`.                                                                                |
| Send-code success       | Compatible behavior | The response supplies `validCodeKey`, which must remain in memory only for the active sign-in attempt.                                                                                    |

### 6.4 Validate an email verification code

| Item             | Classification  | Specification                                              |
| ---------------- | --------------- | ---------------------------------------------------------- |
| Method and route | Documented fact | `POST /api/user/check/validcode`                           |
| Authentication   | Documented fact | No token requirement is declared in the reviewed OpenAPI.  |
| Request JSON     | Documented fact | `validCodeKey` string and `validCode` string are required. |
| Success JSON     | Documented fact | Common response envelope.                                  |

**Compatible behavior:** the reviewed hosted-Cloud client does not use the
generic validation route above for login. It treats login `errorCode: "E1760"`
as identity verification required, obtains `validCodeKey` through Section 6.3,
and then performs this sequence:

| Item                  | Classification      | Specification                                                                                                                                                                                 |
| --------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OTP login route       | Compatible behavior | `POST /api/official/user/sms/login`. Despite the route name, the compatible request supplies an `email` field.                                                                                |
| OTP login JSON        | Compatible behavior | `email`, `validCode`, `validCodeKey`, the original login `timestamp`, `browser`, and `equipment`. The compatible client uses equipment `4`.                                                   |
| Expired/rejected code | Compatible behavior | The compatible client treats `E1756`, `E0101`, and `E1760` as reasons to restart the code flow. These meanings are not vendor-documented and must not be generalized to unrelated operations. |
| Token completion      | Compatible behavior | After OTP login succeeds, call `POST /api/user/query/token` in the same cookie/CSRF session and require a non-empty `token`.                                                                  |

This sequence passed a permitted hosted-Cloud test on October 12, 2026 in two
fresh sessions. Rejected, expired, or otherwise unclassified codes must still
use the specification's fail-closed behavior.

### 6.5 Token/session check

| Item                       | Classification      | Specification                                                                                                                                                                                              |
| -------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and route           | Documented fact     | `POST /api/user/query/token`                                                                                                                                                                               |
| Success JSON               | Documented fact     | Common response fields plus `token` string.                                                                                                                                                                |
| Authentication requirement | Unknown             | The reviewed OpenAPI does not declare an `x-access-token` requirement for this route.                                                                                                                      |
| Product use                | Compatible behavior | A hosted-Cloud OTP flow calls this route without an access-token header, but with the active cookie/CSRF session, to obtain the final bearer token. Its general token-validation semantics remain unknown. |

### 6.6 Query current account identity

| Item             | Classification      | Specification                                                                                                |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Method and route | Documented fact     | `POST /api/user/query`                                                                                       |
| Authentication   | Documented fact     | Requires `x-access-token`.                                                                                   |
| Request JSON     | Documented fact     | No request body is declared.                                                                                 |
| Success JSON     | Documented fact     | Common response fields plus `userId` (int64), profile fields, and account status.                            |
| Product use      | Product requirement | On first successful Cloud setup, retain the returned stable `userId` as the account binding for that mirror. |

**Product assumption:** the canonical `userId` is stable and unique for as long
as its account exists. The plugin uses it to prevent cross-account mirror reuse.
The raw ID remains in secure device-local storage; the shared vault manifest
stores only a versioned SHA-256 account fingerprint derived from the canonical
decimal ID. A fingerprint mismatch blocks the mirror until the user explicitly
resets it.

**Compatible behavior:** hosted and Private Cloud clients expose `userId` as a
decimal string in JWT claims or as an int64-shaped profile field. The plugin
must store the account binding as an opaque decimal string; this evidence does
not establish lifetime stability or non-reuse by the hosted service.

### 6.7 List a directory

| Item                       | Classification      | Specification                                                                                                                                                   |
| -------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and route           | Documented fact     | `POST /api/file/list/query`                                                                                                                                     |
| Authentication             | Documented fact     | Requires `x-access-token`.                                                                                                                                      |
| Request JSON               | Documented fact     | `directoryId` int64, `order` string, `sequence` string, `pageNo` int32, and `pageSize` int32 are required.                                                      |
| Root directory             | Documented fact     | The published schema specifies `directoryId: 0` for the root.                                                                                                   |
| Sort values                | Documented fact     | The published schema lists `filename`, `time`, and `size` for `order`, and `asc` or `desc` for `sequence`.                                                      |
| Success JSON               | Documented fact     | Common response fields, `total` int64, and `userFileVOList`.                                                                                                    |
| Entry fields               | Documented fact     | Each published entry may include `id`, `directoryId`, `fileName`, `size`, `md5`, `isFolder` (`Y` or `N`), `createTime`, and `updateTime`.                       |
| Root presentation          | Documented fact     | The published schema warns that the web listing can flatten internal root folders in its presentation.                                                          |
| First page                 | Compatible behavior | Reviewed hosted and Private Cloud clients use `pageNo: 1`.                                                                                                      |
| Response pagination fields | Compatible behavior | Compatible clients and models recognize `pages`, `pageNum`, and a page-size field in addition to `total`. Field presence must be validated rather than assumed. |

**Product requirement:** treat all `id` and `directoryId` values as canonical
decimal strings at the JSON boundary. Compatible examples contain IDs above
JavaScript's `Number.MAX_SAFE_INTEGER`; parsing them as `number` can silently
change the requested object.

**Unknown:** the service does not publish a snapshot guarantee for multi-page
inventory or define the exact treatment of concurrently changed, inaccessible,
or deleted entries. The plugin assumes listings are live paginated queries and
uses the consistency policy in Section 11.1 instead of depending on snapshot
semantics.

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

**Compatible behavior:** three hosted-Cloud clients fetch the descriptor URL
with HTTP `GET` and no `x-access-token` header. Their HTTP libraries follow
ordinary redirects by default. This supports `GET` without an API token as the
compatibility baseline, but does not establish a vendor redirect contract,
allowed download hosts, credential-forwarding rules, URL lifetime, or MIME and
length guarantees.

**Product requirement:** downloaded bytes must match the documented MD5 value
before being treated as a successful Cloud file transfer. A mismatch is a
per-file failure and must not overwrite or remove a locally protected copy.

**Product requirement:** request the descriptor URL through Obsidian's
`requestUrl` with no Cloud authentication headers. Obsidian handles redirects;
the plugin does not inspect or approve each host or hop. Verify the descriptor
checksum against inventory and the returned byte count and MD5 before writing. A
transfer or integrity failure is per-file and must not overwrite a locally
protected copy.

### 6.11 Logout

| Item             | Classification      | Specification                                                                                                                                                                  |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Method and route | Documented fact     | `POST /api/user/logout`                                                                                                                                                        |
| Authentication   | Documented fact     | Requires `x-access-token`.                                                                                                                                                     |
| Success JSON     | Documented fact     | Common response envelope.                                                                                                                                                      |
| Product behavior | Product requirement | Local sign-out clears the device-local session token even when remote logout fails or cannot be reached. It does not delete mirrored vault files or their shared sync history. |

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
verification. An unknown service code is reported as
`Supernote Cloud error
<code>`; an unknown HTTP status is reported as
`Supernote Cloud request failed
(HTTP <status>)`. Unknown errors retain the
local token unless that specific operation and signal are verified as
authentication expiry.

### 7.2 File metadata

For a file selected for mirroring, the engine requires a usable remote ID, file
name, parent relation or verified canonical path, folder/file indicator, and
checksum. The published `md5` field is the remote checksum field.

Remote IDs and parent IDs are opaque decimal strings. The engine may validate
that they contain only decimal digits, but it must not convert them to
JavaScript `number`, perform arithmetic on them, or normalize away leading
zeroes unless the service contract later requires that normalization.

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
- A file excluded by a current filter remains outside the current transfer.
  Changing or narrowing a filter does not delete a previously mirrored local
  copy; filter exclusion is not treated as remote deletion.

The tested relationship between web-listing paths and the relative, trailing-
slash path-query result is recorded under "Resolved Unknowns and Undocumented
Behaviors" in Section 12. Root category casing is reconciled narrowly; a query
that fails the verified parent/child and ID-path rules is not usable as a
canonical path. Path validation alone does not enable destructive cleanup; the
independent complete-inventory and local-content protections still apply.

### 7.4 File extension allowlist

**Product requirement:** Cloud and IP use the same comma- or newline-separated
file-extension allowlist.

- Entries are case-insensitive and may include or omit a leading dot.
- The default is `.note, .spd`.
- `*` explicitly includes every supported regular file.
- A blank value includes no files; clearing the setting must not broaden scope.
- A file excluded by the current extension allowlist remains outside transfer.
  Changing the extension allowlist does not delete a previously mirrored local
  copy; filter exclusion is not treated as remote deletion.

### 7.5 Local destination safety

**Product requirement:** every mirrored destination remains below the configured
shared sync destination root. A remote name or path that cannot be represented
safely below that root is a protected per-file failure. It must not create,
overwrite, move, or delete a file outside that root.

The `.supernote-sync` Cloud metadata directory is reserved beneath the root. A
remote path that collides with reserved metadata is not mirrored until the
collision has a documented, safe user-visible resolution.

IP and Cloud use one shared mirror manifest. An entry means the sync system
manages that vault path; its engine-specific source metadata is a replaceable
change-detection snapshot, not permanent ownership. Cloud may adopt, overwrite,
move, or trash a managed path only under the shared hash and complete-inventory
safety rules in this specification.

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

Compatible hosted-Cloud evidence identifies login `errorCode: "E1760"` as the
identity-verification branch. The end-to-end sequence in Sections 6.3 through
6.5 passed a permitted production protocol test in two fresh sessions on October
12, 2026:

1. The plugin obtains a pre-auth token and requests a code for the entered email
   address using the signed send-code request.
2. The user enters the code in a modal dialog.
3. The plugin submits the code, `validCodeKey`, and original login timestamp to
   the compatible OTP-login route.
4. In the same cookie/CSRF session, the plugin queries the resulting bearer
   token and then retrieves the account binding.

Rejected, expired, resend, and restart production cases remain unobserved. The
UI must fail closed for those cases rather than infer broader meanings from the
compatible error-code evidence.

### 8.3 Session lifecycle

- The minimum supported Obsidian version was raised to 1.11.5 from 1.8.7 with
  approval on October 13, 2026 and is now 1.13.0 per `manifest.json`.
  SecretStorage became available to plugins in
  1.11.4, and desktop 1.11.5 added OS-backed encryption at rest. This avoids
  storing Cloud tokens in plugin settings or vault files, at the cost of
  dropping support for older Obsidian installations. The tested Windows desktop
  executable reports 1.10.6, but the downloaded runtime package on October 13 is
  `obsidian-1.14.4.asar`; confirm the active runtime has SecretStorage before
  attempting an import rather than treating the installer version as the running
  application version.
- A session token is device-local and is never added to synced plugin settings.
- The raw account ID is stored securely with the token only to protect the
  shared mirror from cross-account reconciliation. Synced mirror metadata
  contains only the versioned account fingerprint defined in Section 11.1.
- The password and verification code are used only for the active sign-in
  attempt and are never persisted.
- A verified authentication failure clears the local token and changes Cloud
  status to **Sign in required**.
- A transport failure or an unknown service error does not clear a token solely
  because its meaning is unknown.
- Signing out removes the local token, retains shared sync history, and prevents
  future Cloud runs until a user signs in.
- Obsidian's public SecretStorage API exposes `setSecret` and `getSecret`, but no
  deletion operation. Local sign-out overwrites the token and account ID with
  empty values, which the plugin treats as signed out; it cannot remove their
  secret IDs through the public API. Remote logout is best effort after local
  invalidation.
- The account-identity endpoint returned HTTP 401 for a rejected token in the
  October 13, 2026 observation. Cloud sync clears a stored token for this
  specific identity-query outcome. Other HTTP and service errors retain the
  token because their authentication meaning has not been established.
- Signing in as a different account is blocked while the Cloud mirror is bound
  to another account. The user must explicitly reset the existing Cloud mirror.

## 9. Mirror User-Observable Behavior

### 9.1 Triggering

- The generic **Sync Supernote now** command runs only the active engine.
- When Cloud is active, that command starts one Cloud-to-vault mirror.
- When IP is active, no Cloud control-plane or download request is made.
- Automatic sync uses the same Cloud behavior only when Cloud is active and the
  shared interval is enabled.
- Plugin startup does not unconditionally begin a sync. The shared coordinator's
  first scheduler poll may dispatch at most one scheduled run for the active
  engine if its valid persisted attempt timestamp shows the configured interval
  elapsed while Obsidian was closed. Missing or invalid timestamps initialize
  without a run. No sync begins in response to vault events, workspace events,
  sign-in, sign-out, destination changes, or filter changes.
- A second manual or scheduled trigger while any sync is running is skipped; it
  is not queued as another run.

### 9.2 Inventory and download outcomes

- The Cloud engine scans the Cloud account from its root, subject to the
  verified listing contract.
- A new in-scope file is downloaded into the configured shared sync destination
  root.
- A remote file whose published checksum still matches the recorded Cloud
  checksum is reported as unchanged and is not downloaded again.
- If an entry was last observed through IP and has no comparable Cloud checksum,
  Cloud obtains enough source evidence to compare its bytes with the last
  successfully mirrored bytes. Identical bytes re-baseline the entry to Cloud
  metadata without rewriting the vault file.
- A changed remote file replaces its local mirror copy only when the local copy
  still matches the last successfully mirrored content.
- A locally changed mirror copy is protected; it is not silently overwritten.
- A remote rename or move preserves the local file only when its shared manifest
  entry and unchanged local content are established. Otherwise it is reported as
  protected rather than duplicated or removed silently.
- A current path or file-extension filter excludes a remote file from
  download/update work. Previously mirrored local copies remain in the vault
  when filters change, matching the IP engine's non-destructive behavior.
- Downloaded source bytes are mirrored unchanged. The custom dictionary is not
  applied because it operates only on recognized text converted to Markdown.

### 9.3 Remote deletion outcomes

- A file excluded by the current path or extension filter is not a remote
  deletion candidate. Changing or narrowing either filter leaves existing local
  mirror copies in place, matching the IP engine's behavior.
- Remote absence can affect a local mirror copy only after the entire required
  remote inventory completed successfully.
- Cloud is authoritative while it is the active engine. A managed in-scope file
  absent from the stable Cloud inventory is a deletion candidate even when its
  latest source snapshot came from IP.
- A run that finds one or more deletion candidates performs a second complete
  inventory after the configured stability delay. Deletion cleanup proceeds only
  when both inventory fingerprints match exactly.
- If a Cloud-missing file's local copy is unchanged since its last successful
  mirror, it moves to Obsidian Trash.
- If that local copy was edited, it remains in the vault and is reported as a
  protected item.
- Any incomplete inventory, pagination uncertainty, authentication failure,
  malformed result, or unknown path-normalization condition suppresses all
  remote-deletion cleanup for that run.

### 9.3.1 Empty local folder outcomes

- After an unchanged managed file is moved to Trash and its removal is recorded,
  empty local parents may be moved to Obsidian Trash, up to but not including
  the configured sync root.
- A later run also checks already-empty local folders beneath the sync root,
  even when no managed file is deleted in that run. Folder cleanup requires two
  complete, identical verified Cloud inventories, just like file deletion.
- An empty local folder is eligible when its Cloud subtree contains no files
  matching the current path and extension allowlists. The remote folder may be
  absent, empty, or contain only excluded files; excluded local files are never
  removed by this rule.
- A folder with any local file or subfolder is never moved to Trash, regardless
  of filename, extension, origin, or filter status. Folders with in-scope Cloud
  files, the sync root, and the mirror metadata folder remain in place.
- A failed folder Trash action is reported as a warning; it does not undo a
  previously committed file deletion or count as a successful folder move.

On October 14, 2026, the user reported completing controlled-vault checks of
folder and file Trash placement, sync-root and nonempty-folder protection,
filter and metadata safeguards, and the separate completion counts. This is
user-reported product validation, not evidence of a general Cloud protocol
guarantee or an independently recorded test run.

### 9.4 Completion feedback

Every Cloud mirror run provides Obsidian notifications at these lifecycle
points:

- When the run starts, after readiness checks pass.
- Immediately before downloading each new or changed file. Identify the file by
  its safe display name or vault-relative mirror path; never include a signed
  URL, account ID, token, or raw response data.
- When the run completes, with secret-free counts for:

  - Downloaded files.
  - Unchanged files.
  - Excluded files.
  - Local files moved to Obsidian Trash.
  - Empty local folders moved to Obsidian Trash, separately from files and only
    when at least one folder was successfully moved.
  - Protected files and per-file failures.

Files that are unchanged or excluded do not produce a download-start notice. No
notification may expose credentials, session tokens, verification codes, full
signed download URLs, or remote error payloads that contain secrets.

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
| Attempt to use a different Cloud account with a bound mirror | Product requirement                      | Block mirroring until the user explicitly resets the shared mirror.                                                                                                      |
| Concurrent manual or automatic trigger                       | Product requirement                      | Skip the new trigger and leave the active run unchanged.                                                                                                                 |

## 11. Policy and Residual Unknowns

Implementation sequencing and current development status are tracked in the
[`cloud-sync-plan.md`](cloud-sync-plan.md). This section defines product policy
for behavior under unresolved service guarantees.

### 11.1 Design assumptions to address unknowns

The following assumptions and outcomes are product decisions. They are used
because the hosted service does not publish the corresponding operational
guarantees. They remain centrally adjustable implementation policy rather than
claims about the remote service.

#### Inventory consistency

The plugin assumes paginated directory listings are live queries, not
server-side snapshots. It requests pages in `filename` ascending order and marks
an inventory incomplete if it observes duplicate remote IDs, conflicting
metadata for one ID, a changing reported total, an empty page before the total
is reached, an unexpected page number, a configured safety limit, or any request
or validation failure.

A single complete inventory is sufficient for downloads and updates. When it
would cause any local deletion, the plugin waits one second and performs a
second complete inventory. Each pass computes an inventory fingerprint from the
remote ID, parent ID, normalized path, folder/file type, and checksum of every
item. Deletion cleanup proceeds only when both fingerprints match. A difference
suppresses all deletion cleanup for that run without undoing safe downloads or
updates.

#### Account binding

The plugin assumes a canonical `userId` remains stable and unique while its
account exists. The raw decimal ID is stored only in secure device-local state.
The shared manifest stores a versioned SHA-256 fingerprint derived from a domain
prefix and that canonical ID. Every Cloud run compares the authenticated account
fingerprint with the manifest binding. A mismatch never reassigns the mirror; it
requires an explicit reset.

The plugin does not require a guarantee that an ID can never be reused after an
account has ceased to exist. An inaccessible or deleted bound account leaves the
mirror bound until the user explicitly resets it.

#### Download hosts and redirects

The plugin requests the descriptor URL with a credential-free Obsidian
`requestUrl` GET. It does not supply the Cloud token, cookies, or CSRF headers
to the download request, nor maintain a host allowlist or inspect individual
redirect hops. Obsidian handles redirects according to its request behavior. The
separate opt-in fixture harness retains its own explicit host review.

#### Unknown errors

An exhaustive error-code catalogue is not required. Only an operation-specific
signal with recorded evidence may trigger special behavior such as OTP or
clearing the local token. Other non-success responses use the generic messages
defined in Section 7.1, retain the token, stop the affected operation, and
suppress deletion cleanup when inventory completeness may be affected. Raw
response bodies are never shown to the user.

#### Operational defaults

The first implementation uses these centrally maintained constants. They are
safety defaults, not statements of service limits:

| Policy                                         | Default     | Reasoning                                              |
| ---------------------------------------------- | ----------- | ------------------------------------------------------ |
| Listing page size                              | `100` items | Limits request count without oversized responses.      |
| Maximum pages per directory                    | `1,000`     | Bounds runaway or inconsistent pagination.             |
| Maximum items in one account inventory         | `100,000`   | Caps memory and processing work per run.               |
| Maximum directory depth                        | `128`       | Prevents pathological or cyclic traversal.             |
| Control-plane request timeout                  | `20,000 ms` | Allows normal latency without hanging a run.           |
| Concurrent directory-list requests             | `2`         | Improves traversal speed without bursty load.          |
| Concurrent file downloads                      | `1`         | Limits bandwidth, memory use, and service pressure.    |
| Idempotent retry count after the first attempt | `1`         | Recovers one transient failure without retry storms.   |
| Base retry delay                               | `1,000 ms`  | Gives brief transient failures time to clear.          |
| Maximum honored `Retry-After` delay            | `60,000 ms` | Respects throttling without stalling indefinitely.     |
| Inventory passes before deletion               | `2`         | Requires repeated evidence before destructive cleanup. |
| Delay between deletion-confirmation passes     | `1,000 ms`  | Gives concurrent remote changes time to surface.       |
| Maximum desktop file size                      | `256 MiB`   | Bounds memory and disk use on desktop systems.         |
| Maximum mobile file size                       | `128 MiB`   | Uses a lower ceiling for constrained mobile devices.   |

The one automatic retry applies only to read-only operations after a network
failure, HTTP `408`, HTTP `429`, or HTTP `5xx`. A valid `Retry-After` value is
honored up to the configured maximum; otherwise the base delay is used.
Credential submission, verification-code submission, and code-send requests are
not automatically retried, apart from the separately specified one-time CSRF
refresh behavior. A checksum mismatch obtains a fresh descriptor and retries the
download once; a second mismatch is a per-file failure.

Both advertised metadata size and received byte length must remain within the
platform file-size limit. Exceeding a safety limit is a reported per-file or
inventory failure, never a reason to make a destructive local change.

### 11.2 Product decisions already resolved

The following questions no longer block implementation planning:

- The first release may expose a non-destructive subset. A capability whose
  protocol gate is unresolved remains visibly unavailable; it does not hold back
  independently verified sign-in or download behavior.
- Email-code sign-in is optional for the first release. It remains visibly
  unavailable until its complete production flow is verified.
- After all deletion gates are satisfied, a Cloud-deleted file's locally
  unchanged managed copy moves to Obsidian Trash. A locally edited copy remains
  protected.
- Cloud inventory starts at the account root. The plugin applies the shared path
  and file-extension allowlists; it does not require a Cloud folder picker in
  the first release.
- A dedicated, secret-redacting local protocol harness may be used with an
  authorized test account according to the safety and maintenance plan in
  [`cloud-protocol-harness.md`](cloud-protocol-harness.md). Credentials and
  complete signed download URLs must not enter fixtures, source control, logs,
  diagnostics, or test reports.
- Retain the protocol harness as an opt-in compatibility and documentation
  instrument after implementation: the hosted API is undocumented, so synthetic
  tests alone cannot detect later service changes. Keep it in `scripts/`,
  outside routine CI and releases, and require explicit production consent and
  review of redacted output before sharing observations. Never commit cached
  sessions or use fixture creation as a reason to add Cloud write routes.

These decisions define what to do when evidence is incomplete. They do not
convert compatible behavior into a documented service guarantee.

### 11.3 Residual runtime uncertainty

Production behavior may later move outside the observations used during
development. That possibility is runtime uncertainty, not a release blocker. The
Section 11.1 policies define the required response: suppress deletion on an
unstable inventory, block an account mismatch, reject an unrecognized download
host, report an unknown error generically, and stop at a configured safety
limit. New behavior may be reviewed and accommodated by changing the centralized
policy without weakening existing local-content protections.

Until a gate is resolved, the product must use the non-destructive outcome
defined above or keep that capability unavailable. A later production behavior
that falls outside the recorded evidence reopens the relevant gate; it must not
be silently accepted as equivalent.

## 12. Resolved Unknowns and Undocumented Behaviors

These are **dated hosted-production observations**, not vendor API guarantees.
They describe only the authorized account, requests, and fixtures tested on
October 12-13, 2026. The tested production origin was
`https://cloud.supernote.com`. The local harness records aggregate counts,
response field names/types, and salted fingerprints; no account paths, remote
IDs, credentials, tokens, signed URLs, or raw bodies belong in a published
observation.

**Authentication and identity (October 12).** Two fresh sessions began with
`GET /api/csrf` and retained cookies and CSRF state through the login attempt.
After the nonce request and compatible password derivation, the password-login
route returned the `E1760` verification-required branch for the tested account.
`POST /api/user/validcode/pre-auth` and `POST /api/user/mail/validcode/send`
supplied the email-code continuation. In both sessions the first
`POST /api/official/user/sms/login` returned HTTP 403; one CSRF refresh and one
retry of that request succeeded. The same session then obtained a bearer token
from `POST /api/user/query/token` and a usable canonical decimal `userId` from
`POST /api/user/query`; the account ID agreed across the two sessions. This does
not establish how rejected or expired codes, resends, or other accounts behave.
A previously recovered token candidate was rejected by the account-identity
query (HTTP 401) on October 13; it was not treated as a reusable session or as
proof of a general token-expiry signal.

Each fresh October 12 session followed this observed order:

1. `GET /api/csrf`.
2. `POST /api/official/user/query/random/code`.
3. `POST /api/official/user/account/login/new` (verification required).
4. `POST /api/user/validcode/pre-auth`.
5. `POST /api/user/mail/validcode/send`.
6. `POST /api/official/user/sms/login` (HTTP 403).
7. `GET /api/csrf` (refresh).
8. Retry `POST /api/official/user/sms/login` once (success).
9. `POST /api/user/query/token`.
10. `POST /api/user/query` (same canonical account identity in both sessions).

The October 12 record preserved only route shapes, response categories, field
types, cookie names, and confirmation of matching identities. Passwords,
verification codes, session/CSRF/pre-auth tokens, valid-code keys, cookie
values, profile values, the raw account ID, and response bodies were not
retained. This is evidence for those two sessions, not a service-wide guarantee.

**Directory listing and pagination (October 13).** With a separately validated
cached, account-bound token and no login/OTP consent, requests used
`POST /api/file/list/query` with `directoryId`, `order: "filename"`,
`sequence: "asc"`, `pageNo` starting at 1, and `pageSize: 100`. The hosted
response returned `success`, `errorCode`/`errorMsg` (null in the tested
successes), `pages`, `size`, `total`, and `userFileVOList`. It omitted `pageNum`
and `pageSize`, so the requested page number is used only when the response
omits `pageNum`; a supplied unexpected page number still fails. The first
observed root response presented six folders (Note, Document, Screenshot,
Export, Inbox, Mystyle) on one page with `total: 5`. All six were also visible
in the web UI. Three root entries reported parent IDs other than `0` (two
distinct internal parents, neither an ID of another displayed root folder),
consistent with a flattened root presentation. The implementation accepts the
count and parent discrepancy **only** for that exact six-folder root shape; all
other directory totals and parent relations remain strict. Child directory
listings observed exact totals of 2/2, 1/1, and 0/0, so `total` is not generally
zero-based. A later one-page Note listing held 80 direct entries with
`total: 80`; after additional direct folders were created, the harness observed
a real second page. Two complete inventory passes then matched (111 directories,
114 items, including 110 folders and 4 files; maximum page count 2). The service
has not been shown to provide a snapshot across pages; inconsistent totals,
counts, or IDs must still fail closed.

**Path queries (October 13).** For each of 114 items, the read-only harness
queried `POST /api/file/path/query` by opaque ID twice. Observed `path` and
`idPath` values were relative (no initial slash) and trailing-slash-terminated.
All 114 ID paths ended in their queried item's ID; all 108 child ID paths
extended the queried parent's ID path. Every child path extended its queried
parent's path by exactly its listed name, including a `.note` file in a nested
Note folder. All six root path leaves matched the web-listing name ignoring
case; four differed in case, and one descendant inherited that difference.
Adding a leading slash matched 109/114 listing-derived item paths exactly;
reconciling only the known root-category casing explained the other five. Both
inventory and queried-path passes were stable (228 path queries total). This
supports a deterministic normalized path for the tested items, not an
unrestricted case-folding or percent-decoding rule. A subsequent authorized
fixture run on October 13 created the same `Path%+é (test)` folder name in two
different parent folders through the official Cloud interface. Two complete
inventories were stable (113 directories, 116 items: 112 folders and 4 files),
and all 232 read-only path queries across two passes verified the parent/child
path and ID-path hierarchy, with no collisions. Literal `%` and `+`, the
fixture's Unicode spelling, spaces, parentheses, and duplicate leaf names across
parents passed the tested **canonical-path gate**. The probe used the validated
cached session without login or OTP. This does not establish how the service
handles decomposed Unicode spellings or every possible path form; unknown or
colliding forms must still fail closed. Passing this path gate alone does not
enable deletion cleanup, which also requires the other inventory, account, and
mirror safety gates.

**Fixture download (October 13).** With explicit approval, a bound cached
session requested a fresh `type: "0"` descriptor for a disposable test file.
Host review identified an HTTPS virtual-hosted S3 bucket endpoint. A second
descriptor named the same exact reviewed host, and an unauthenticated GET
without cookies, CSRF headers, token, or referrer returned bytes matching the
listed size and MD5. The opt-in harness used only that reviewed host and did not
record whether same-host redirects occurred. Bytes were held in memory and
discarded without a vault write. The signed URL, account ID, file ID, checksum
value, and contents were not recorded. This verifies the tested host and
fixture, not an exhaustive host policy, future redirects, or the plugin's mirror
workflow.

**Still unknown.** Other download hosts and production redirect behavior have
not been validated. The hosted API's pagination snapshot semantics and its
behavior for unsupported path forms, other root configurations, rejected OTPs,
and future token expiry are not established by these observations.

## 13. Release Acceptance Criteria

The first Cloud release is acceptable only when all of these are true:

- It calls only the required read-only routes and the optional logout route in
  this specification.
- It does not make remote write, share, move, copy, rename, delete, recycle, or
  upload requests.
- Every endpoint and field used in production has a recorded evidence class and
  public-source reference.
- Every enabled capability that depends on compatible production behavior has a
  dated, secret-free local protocol-test record covering its required request
  shape and successful result.
- Email verification is either fully verified end-to-end or visibly unavailable.
- No destructive local cleanup occurs unless the complete remote inventory,
  account binding, path normalization, and shared manifest checks are valid.
- Every downloaded file passes the published checksum comparison before it is
  treated as mirrored.
- User-facing behavior matches Sections 8 through 10 and the approved
  assumptions in Section 11.1.
- Automated tests cover documented success cases, every stated non-destructive
  error outcome, every unresolved release gate, and the fail-closed handling of
  residual service unknowns.
