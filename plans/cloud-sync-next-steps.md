# Cloud Sync Sprint Hand-Off

## Recommended Next Sprint: Active-Engine Automatic Sync

1. Add one shared coordinator-owned interval poller that dispatches only the
   selected engine (IP or Cloud) when enabled. Do not run immediately on startup
   or in response to sign-in, destination changes, or filter changes; these
   events must not trigger surprising reconciliation or automatic setup/auth
   flows. On startup, let the first poll dispatch at most one run when a valid
   persisted attempt timestamp shows the active engine's interval elapsed while
   Obsidian was closed; do not run unconditionally or replay multiple missed
   intervals. Initialize missing/invalid timestamps without a run. Skip
   overlapping ticks instead of queuing them, and preserve manual sync behavior.
2. Allow scheduled Cloud runs through the coordinator's existing readiness and
   overlap gates. Reuse the manual Cloud inventory, account-binding, download,
   and guarded file/folder Trash behavior without a separate destructive path;
   keep IP scheduling on this same coordinator-owned poller.
3. Add focused tests for disabled intervals, active-engine selection (including
   IP), readiness failures, overlapping triggers, restart catch-up (one run only
   when due, none for missing/invalid timestamps), and manual/scheduled Cloud
   parity. Run `npm test`, `npm run build`, `npm run lint`, and
   `git diff --check`.
4. Before any live scheduled run, agree on a controlled synthetic fixture scope
   and required permissions. Do not initiate login/OTP, mutate Cloud contents,
   or broaden the fixture scope without explicit authorization. Record only
   non-sensitive validation results in
   [`cloud-sync-plan.md`](cloud-sync-plan.md).
