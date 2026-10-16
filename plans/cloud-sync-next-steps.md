# Cloud Sync Sprint Hand-Off

## Remaining Validation

1. With separate approval and replaceable synthetic fixtures, verify the
   account-change confirmation and cancellation in a test vault. Check Trash
   placement and retained edited, out-of-scope, unmanaged, and IP-managed files.
   No live login/OTP or destructive vault validation is authorized by this
   handoff alone.
2. Verify interrupted account-change recovery in the same controlled setting if
   a non-destructive interruption can be staged. Review the preserved-file
   report and confirm scheduled sync never opens a confirmation dialog.
3. Keep the non-destructive history workflow separate. Follow up on broader
   manifest pending-operation recovery for ordinary Cloud downloads and
   remote-deletion cleanup, which is not part of this account-change change.

See [`cloud-sync-plan.md`](cloud-sync-plan.md) for implementation status and
[`multi-sync-design.md`](multi-sync-design.md) for the existing reset safety
requirements; the account-change trigger above supersedes its standalone-reset
UI proposal.
