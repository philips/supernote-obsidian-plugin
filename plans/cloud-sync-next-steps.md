# Cloud Sync: Next Steps

**Status (November 8, 2026):** Cloud rename/move propagation is not
implemented. Directory listings provide file IDs and verified path queries,
but the shared mirror manifest saves only destination paths and Cloud checksums.
No observed or documented test yet proves a file ID survives a Cloud rename.
See `cloud-sync-plan.md` for completed work and other outstanding validation.

## Recommended next sprint: Cloud rename identity and local moves

1. Establish the API prerequisite with an explicitly approved, replaceable
   Cloud fixture: compare its file ID, verified path, and checksum before and
   after a rename, and separately across a folder move if in scope. Record only
   whether the ID and checksum remained equal and the path changed; do not
   retain or print remote IDs, paths, tokens, or response bodies. Use the
   existing account-bound session and protocol safety gates; do not mutate the
   user's real Cloud notes or request a login/OTP without consent. If a safe
   fixture or approval is unavailable, stop at synthetic tests and leave this
   prerequisite unverified. An unchanged ID is evidence for the tested
   operation, not a universal service guarantee.
2. Conditional on that evidence, design a backward-compatible, account-bound
   file-ID field in shared Cloud manifest records and preserve it through
   writes, migration, account changes, and recovery. Existing path-only/IP
   records cannot be matched to an old ID retroactively; baseline them without
   guessing or automatically deleting their Markdown exports.
3. Pair an old managed path and a new verified in-scope path only on the same
   persisted ID under the same bound account. Require an unchanged old local
   file, vacant destination, consistent checksum/content rules, and a stable
   inventory before mutating. Define behavior for concurrent changes, filtered
   or out-of-scope paths, conflicting IDs/paths, case-only moves, missing old
   files, and destinations occupied by unrelated or edited content. On
   uncertainty, protect both paths and report a conflict; never infer a move
   solely from names or hashes.
4. Add a recoverable local rename operation to the mirror executor and vault
   adapter, including parent creation and restart reconciliation. Integrate
   move planning before downloads and missing-file Trash so a recognized rename
   does not first create its destination. Use Obsidian's vault/file manager
   rename path so the auto-export vault rename listener can move managed
   Markdown; Cloud sync must not edit the exporter's separate ownership records.
   If an image-bearing export blocks its own rename, preserve its conflict and
   report it without undoing a successful raw-note move.
5. Test synthetic ID-preserving rename and move, ID-changing replacement,
   legacy manifests, edited source/destination, filters, duplicate/colliding
   paths, interrupted moves and stale manifests, repeated runs, and verified
   deletion behavior. Check the vault rename event and Markdown-only export
   handoff with focused integration tests. Then run focused tests, `npm test`,
   `npm run build`, `npm run lint`, and `git diff --check`; validate in the
   designated disposable Test Vault only with controlled fixtures. Keep Cloud
   remote-read-only and IP behavior unchanged.

If the API changes IDs on rename, do not implement speculative move matching:
keep the current create/verified-Trash behavior and document that Cloud-driven
Markdown rename is unavailable without a reliable identity signal.