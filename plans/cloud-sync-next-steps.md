# Cloud Sync Sprint Hand-Off

**Completed October 14, 2026:** Lifecycle notifications and guarded
remote-deletion cleanup are implemented. Focused tests and a synthetic
Marie-vault Trash check passed. See [`cloud-sync-plan.md`](cloud-sync-plan.md)
for the result and safety gates.

**Next:** Prune empty local mirror folders left behind by successful Cloud
file deletions, subject to the sync-root and nonempty-folder safeguards below.

## Completed Sprint

1. Implement Cloud sync lifecycle notifications: notify after readiness checks
   pass when a run starts, immediately before each actual file download, and at
   completion with the existing secret-free counts. Do not notify for unchanged
   or excluded files. Never include signed URLs, IDs, tokens, or raw responses.
2. Implement remote-deletion cleanup for previously managed files absent from
   Cloud. Require two complete inventories with identical fingerprints and an
   unchanged local hash before moving a copy to Obsidian Trash. Preserve locally
   edited copies and unmanaged files; filter exclusions remain non-destructive.
3. Add focused tests for lifecycle notices and deletion candidates, including
   changed or incomplete inventories, local edits, unmanaged files, filtered
   paths, and current in-scope files. Then run `npm test`, `npm run build`,
   `npm run lint`, and `git diff --check`.
4. After the guarded deletion implementation and tests pass, validate in the
   controlled test vault only. Confirm both the Obsidian Trash result and that
   locally edited files remain untouched.

## Recommended Next Sprint

1. After a guarded Cloud file deletion and successful manifest commit, move
   its empty parent folder to Obsidian Trash. Repeat upward only while each
   folder is empty; never remove the configured sync root.
2. Leave folders with any remaining contents untouched, including unmanaged,
   locally edited, filtered-out, or metadata files and subfolders. Do not
   prune after failed or suppressed deletion, and do not sweep unrelated
   pre-existing empty folders.
3. Test empty and nested parents, nonempty parents, sync-root protection, and
   failed or skipped deletions. Run `npm test`, `npm run build`, `npm run lint`,
   and `git diff --check`; validate with replaceable synthetic fixtures only.

See [`cloud-sync-plan.md`](cloud-sync-plan.md) for implementation status,
completed work, design decisions, and validation gates. The external behavior
and protocol contract is in [`cloud-sync-design.md`](cloud-sync-design.md).
