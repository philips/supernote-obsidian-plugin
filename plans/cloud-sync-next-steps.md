# Cloud Sync Sprint Hand-Off

## Recommended Next Sprint: Controlled Scheduled Cloud Validation

1. Agree on a synthetic test-vault destination, replaceable Cloud fixtures,
   allowed operations, and whether the existing authorized session may be used
   for scheduled validation. Do not initiate another login or OTP without
   separate explicit permission.
2. In a running Obsidian desktop test vault, validate a due scheduled Cloud
   tick, unchanged repeat, inactive-engine gate, overlap suppression, and the
   main-window notice on each due signed-out or rejected-session attempt. Avoid
   unrelated account data and do not expose account or file identifiers.
3. Confirm file and folder Trash behavior remains guarded; do not mutate Cloud
   contents or expand the fixture scope without explicit authorization. Record
   only non-sensitive observations in
   [`cloud-sync-plan.md`](cloud-sync-plan.md), separating live results from
   synthetic tests and user-reported checks.
