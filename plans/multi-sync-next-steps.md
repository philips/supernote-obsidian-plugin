# Multi-Sync Next Steps

**Status:** The remaining in-repo work is optional cross-device
reject-and-manual-retry verification. Live engine, Cloud account-switch, and
device checks need controlled fixtures or approval and are not release blockers.
Updated October 16, 2026.

Use [`multi-sync-plan.md`](multi-sync-plan.md) for overall implementation
status, [`shared-manifest-plan.md`](shared-manifest-plan.md) for the detailed
product contract and acceptance cases, and
[`multi-sync-design.md`](multi-sync-design.md) for architecture. This handoff
contains only remaining work; completed checks are recorded in the plan.

## Recommended Next Sprint

Verify the existing reject-and-manual-retry policy with two synthetic plugin
instances sharing manifest storage and a fake vault. Have both load the same
revision, let A commit a path, and make B attempt an independent path from its
stale snapshot. Assert B stops without overwriting A's record or leaving an
unreconciled vault mutation. Then start a fresh manual B run: it must load the
newest revision, recheck local bytes and source state, and safely commit or
protect B's path. Cover an incompatible same-path change by failing closed. Keep
automatic retries, record merging, distributed locking, and live Cloud or device
mutation out of scope. Run focused tests, `npm test`, `npm run build`,
`npm run lint`, and `git diff --check`.

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
  continue to fail rather than silently merging histories.
