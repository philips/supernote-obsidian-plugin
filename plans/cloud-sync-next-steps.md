# Cloud Sync Sprint Hand-Off

## Recommended Next Sprint: Cloud Account Change

1. Compare the verified Cloud `userId`, not the display-only username, with the
   shared manifest's account fingerprint before saving a new session or starting
   sync. Sign-out and sign-in to the same account leave the manifest and
   mirrored files untouched. A different account blocks sync until the user
   explicitly confirms the change; cancellation preserves the old binding and
   does not save the new session. Scheduled sync must never prompt or reset in
   the background.
2. Make the confirmed account-change flow the entry point to the guarded Cloud
   mirror reset, not a general-purpose "start over" button. Explain that
   unchanged managed files move to Obsidian Trash, while edited, unmanaged, and
   out-of-scope files are preserved and protected items are reported. Resolve
   pending operations first, persist recoverable progress across Trash and
   manifest updates, release the old binding only after safe cleanup, and then
   allow the new verified account to establish its binding. An unbound manifest
   with shared IP records is not an empty mirror; do not discard those records
   or Trash their files just because there is no Cloud fingerprint.
3. Keep any non-destructive "forget history" workflow distinct from account
   change. Test same-account re-entry, different-ID confirmation/cancellation,
   guarded cleanup and crash recovery with synthetic fixtures, including IP
   records and locally edited files. Run full tests, build, lint, and diff
   checks. No live Cloud login, OTP, mutation, or destructive vault validation
   without separate approval.

See [`cloud-sync-plan.md`](cloud-sync-plan.md) for implementation status and
[`multi-sync-design.md`](multi-sync-design.md) for the existing reset safety
requirements; the account-change trigger above supersedes its standalone-reset
UI proposal.
