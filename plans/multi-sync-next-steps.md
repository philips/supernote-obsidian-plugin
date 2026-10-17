# Multi-Sync Next Steps

**Status:** The synthetic cross-device reject-and-manual-retry verification is
complete. No further in-repo reject-and-retry sprint is planned. Live engine,
Cloud account-switch, and device checks need controlled fixtures or approval and
are not release blockers. Updated October 16, 2026.

Use [`multi-sync-plan.md`](multi-sync-plan.md) for overall implementation
status, [`shared-manifest-plan.md`](shared-manifest-plan.md) for the detailed
product contract and acceptance cases, and
[`multi-sync-design.md`](multi-sync-design.md) for architecture. This handoff
contains only remaining work; completed checks are recorded in the plan.

## Remaining Validation

- The real-device IP smoke test needs a dedicated device test directory and
  explicit approval. Do not run `npm run test:device-sync` without approval: it
  uploads a fixture that the device API cannot remove.
- Live Cloud account-switch testing awaits a consenting volunteer with a second
  account. The Marie checks did not switch accounts.
- A fault inside a running Obsidian engine and live Cloud inventory/transfer
  remain optional validation only when controlled fixtures are available. Do not
  crash the renderer or mutate Cloud/device contents for these checks.

## Separate Decisions

- Automatic cross-device manifest reconciliation is deferred. Stale revisions
  visible to the current run continue to fail rather than silently merging
  histories. The check is not an atomic distributed lock: truly simultaneous
  cross-device commits can race. Avoid relying on concurrent device runs to
  preserve independent changes until a separately scoped coordination design
  addresses that limit.
