# Cloud Sync Sprint Hand-Off

## Recommended Next Sprint: Active-Engine Automatic Sync

1. Wire the shared interval state to a scheduler that runs only the selected
   engine when enabled. Never run on startup, sign-in, destination changes, or
   filter changes; skip overlapping ticks instead of queuing them. Preserve
   manual sync and IP behavior.
2. Allow scheduled Cloud runs through the existing coordinator and readiness
   gates. Reuse the manual Cloud inventory, account-binding, download, and
   guarded file/folder Trash behavior without a separate destructive path.
3. Add focused tests for disabled intervals, active-engine selection, readiness
   failures, overlapping triggers, restart timing, and manual/scheduled Cloud
   parity. Run `npm test`, `npm run build`, `npm run lint`, and
   `git diff --check`.
4. Before any live scheduled run, agree on a controlled synthetic fixture scope
   and required permissions. Do not initiate login/OTP, mutate Cloud contents,
   or broaden the fixture scope without explicit authorization. Record only
   non-sensitive validation results in
   [`cloud-sync-plan.md`](cloud-sync-plan.md).
