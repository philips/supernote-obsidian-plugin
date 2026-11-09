# Cloud Sync: Next Steps

## Recommended next sprint: Optional hosted identity validation

No further rename implementation is planned. If direct hosted identity evidence
is needed, obtain approval for a replaceable file in the hosted Cloud account
and an authorized client workflow. Compare its file ID, checksum, and verified
path before and after a remote rename, recording only whether the ID and
checksum remained equal while the path changed. A working end-to-end rename does
not itself establish that hosted IDs remain stable. Check file-bearing folder
moves separately only if a replaceable folder is approved; empty folders have no
file identity. Do not add unreviewed remote write routes to the read-only
harness or infer IDs from names or matching hashes. If IDs change, retain
conservative download and verified-Trash behavior.

Different-account switch and destructive cleanup remain a separate live
validation gap tracked in [`cloud-sync-plan.md`](cloud-sync-plan.md). Marie is
the designated test vault; preserve its existing data and obtain separate
authorization before login, OTP, destructive validation, or hosted writes.
Shared download/write and remote-deletion crash recovery belongs to the
Multi-Sync plan, not another Cloud rename sprint. Keep Cloud sync
remote-read-only and IP behavior unchanged.
