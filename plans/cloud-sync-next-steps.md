# Cloud Sync Sprint Hand-Off

## Recommended Next Sprint: Controlled Scheduled Cloud Validation

1. Agree on a synthetic test-vault destination, replaceable Cloud fixtures,
   allowed operations, and whether an existing authorized session may be used.
   Do not initiate live login or OTP without separate explicit permission.
2. Exercise signed-in status and controls in a running Obsidian desktop UI, then
   validate a due scheduled tick, unchanged repeat, inactive-engine gate,
   overlap suppression, and signed-out/rejected-session notices without
   accessing unrelated account data.
3. Verify that file and folder Trash behavior remains guarded. Do not mutate
   Cloud contents or expand the fixture scope without explicit authorization.
   Record only non-sensitive observations in
   [`cloud-sync-plan.md`](cloud-sync-plan.md), separating observed behavior
   from synthetic test results.
