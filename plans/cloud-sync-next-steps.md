# Cloud Sync Validation Hand-Off

Cloud implementation is complete; live different-account switching remains
**unresolved**. The current user has one Supernote Cloud account and cannot
create a second without another device. Do not treat synthetic tests as a live
account-switch check or hold up Multi-Sync implementation while waiting for a
community volunteer with another account.

## Deferred Account-Change Validation

When a volunteer with a second account is available, obtain separate explicit
approval and use replaceable test-vault fixtures to check the different-account
confirmation and cancellation, Trash placement, preserved edited/out-of-scope/
unmanaged/IP-managed files, and the preserved-file report. If safely stageable,
also check interrupted cleanup recovery. This handoff does not authorize live
login/OTP, account switching, or destructive vault validation.

The user confirmed on October 16, 2026 that scheduled sync did not open a login
dialog. This supports no background sign-in; it does not test whether a
different-account confirmation could appear, since that flow requires an
interactive sign-in to a second verified account. Synthetic tests cover that
branch, but live confirmation behavior remains unverified.

General recovery for ordinary downloads, overwrites, and remote-deletion Trash
is a separate deferred decision in [`multi-sync-plan.md`](multi-sync-plan.md),
not remaining Cloud implementation. Non-destructive history clearing remains
distinct from account change.

See [`cloud-sync-plan.md`](cloud-sync-plan.md) for implementation status and
[`cloud-sync-design.md`](cloud-sync-design.md) for Cloud behavior and residual
service unknowns.
