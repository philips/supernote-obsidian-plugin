# Cloud Sync Sprint Hand-Off

## Recommended Next Sprint: Shared Sync Protection Reporting and Log

Share protection reporting and the existing IP `Sync Log.md` infrastructure
across both sync engines. This sprint changes reporting only: keep the shared
manifest, account binding, local-edit protection, and guarded Cloud cleanup
unchanged. See [`cloud-sync-plan.md`](cloud-sync-plan.md) for current status.

1. Preserve protected-item details in the Cloud engine's `SyncIssue` mapping;
   normalize both engines' protected and failure issues for shared reporting.
   Keep Cloud identifiers out of persisted output by default.
2. Move the IP log formatter and append-only writer to shared reporting code.
   Keep the existing `<sync root>/Sync Log.md` path, label entries by engine,
   and route manual and scheduled results through one reporter. Create the log
   on clean IP runs but append only reportable events, at most once per run.
   Remove duplicate IP log writes while retaining its error-modal behavior.
3. Reconcile the Cloud design's separate log location with this shared log and
   decide whether Cloud per-file paths may ever be persisted. Until the privacy
   rule is explicitly revised, log only secret-free counts and safe categories
   for Cloud; never log credentials, account data, raw errors, signed URLs, or
   identifying file paths. Keep the log and `.supernote-sync` outside Cloud
   cleanup even with a `*` extension allowlist.
4. Test IP log continuity, both engines' protected results, shared Notice and
   log behavior for manual/scheduled runs, log-write failures, and Cloud
   redaction. Run focused tests, then the full test/build/lint and diff checks.
   No live login/OTP, Cloud mutation, or destructive vault validation is needed
   for this reporting-only sprint.

## Following Sprint: Explicit Cloud Mirror Reset

Defer the confirmed destructive account/device-binding reset to the sprint after
shared reporting. Its confirmation, pending-operation recovery, guarded Trash,
manifest/binding cleanup, and controlled-fixture verification remain in scope
for that later sprint under [`multi-sync-design.md`](multi-sync-design.md).
