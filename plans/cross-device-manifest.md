# Cross-Device Manifest Reconciliation: Bounded Rebase

**Status:** Optional proposal, not required to finish multi-sync. Keep the
current two-slot vault manifest and reject-and-manual-retry behavior unless
stale-revision failures become a practical nuisance for people using the same
vault on multiple devices. No server, HTTP service, database, new credentials,
or distributed lock is proposed.

## Goal and Limits

When one device's newer manifest revision is already visible, let a second
device automatically retry a _compatible_ per-file manifest change while
preserving the first device's records. For example, A records `NoteA.note` and
B, which loaded the preceding revision, records `NoteB.note`: B should refresh
and retain both records rather than stop for a manual retry. This improves
observed stale-revision handling; it is not a guarantee that all concurrent
edits are preserved.

The existing `saveMirrorManifest` reads both slots, rejects a caller whose
revision/slot/content is stale, writes the other slot, and verifies the write.
Those steps are **not atomic across devices**. If A and B both check before
either write is visible, both can proceed, and vault sync may deliver the slots
or note files in a different order. A rebase cannot detect an unseen commit or
guarantee when another device's file bytes arrive. Do not claim linearizable
commits, a cross-device lock, lossless simultaneous updates, or automatic repair
of Obsidian Sync file conflicts.

## Small Implementation

1. Keep the current `MirrorManifestService`, two-slot format, and intent-first
   `MirrorOperationExecutor`. Add a bounded conflict handler at the per-file
   **pre-intent** commit boundary. Distinguish the store's stale-revision error
   from corruption, I/O failures, and readback failures; those continue to fail
   closed. Do not automatically retry a failed final commit after a vault
   mutation: leave the pending intent for existing recovery. Do not silently
   retry account changes, root changes, history clearing, or legacy migration.
2. On an observed stale revision, reload the latest valid manifest and compare
   the original baseline, the intended record change, and the latest state by
   normalized vault path. Rebase only when account binding, root context,
   history-retirement state, and other non-record fields are unchanged; no
   pending operation or account/root checkpoint needs attention; and the
   intended path's latest record still equals its baseline value. Preserve every
   other latest record and header. Incompatible same-path changes stop; do not
   choose a winner by timestamp.
3. Before committing a rebased intent, re-plan against the latest manifest and
   recheck local vault bytes and the active engine's relevant source state using
   its normal verification rules. A changed source, an edited or not-yet-arrived
   local file, a pending intent, or a failed guard stops or protects the path;
   do not carry an old plan through the refresh. After a successful intent
   commit, preserve the existing guarded write/Trash and recovery flow. Bound
   the number of re-plans/retries so contention cannot spin indefinitely; if the
   bound is reached, report the existing manual-retry path.
4. Keep the change local to shared per-file operations used by both IP and
   Cloud. Avoid a broad merge framework or vault-file sync changes. If
   simultaneous lost updates emerge despite this improvement, separately
   evaluate per-device immutable change records; do not claim the two mutable
   slots can serialize writers.

## Acceptance and Decision Gate

- With two synthetic instances sharing fake vault and manifest storage, A's
  disjoint update becomes visible before B's intent commit; B rebases without a
  manual restart and both records survive. A further update during B's retry
  stops after the bounded number of attempts.
- Same-path changes, changed account/root or other global state, a pending
  operation, missing or edited local bytes, and changed source state do not
  silently merge or overwrite files. A failure _after_ intent commit uses the
  existing recovery path, never a blind rebase or repeated Trash.
- Cover the store/executor and Cloud/IP pipeline boundaries with synthetic
  tests. Run focused tests, `npm test`, `npm run build`, `npm run lint`, and
  `git diff --check`. No headless vault or live Cloud/device mutation is needed.
  State that passing tests cover **visible** stale revisions, not unseen
  simultaneous writes or vault replication timing.

Implement only if multi-device users encounter stale-revision retries often
enough to justify additional per-file re-planning and recovery complexity.
Otherwise retain the existing tested fail-closed behavior.
