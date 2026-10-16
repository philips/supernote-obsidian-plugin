# Multi-Sync Next Steps

**Status:** Ordinary-operation intent recovery is implemented with synthetic
tests. Live interruption validation remains. Updated October 16, 2026.

Use [`multi-sync-plan.md`](multi-sync-plan.md) for overall implementation
status, [`shared-manifest-plan.md`](shared-manifest-plan.md) for the detailed
product contract and acceptance cases, and
[`multi-sync-design.md`](multi-sync-design.md) for architecture. This handoff
contains only remaining validation; completed checks are recorded in the plan.

## Remaining Validation

- Live interrupted-operation recovery needs a controlled, replaceable fixture
  and separate approval. Do not force an interruption during a user's real sync.
  Include write, adoption, and uncertain Trash boundaries.
- The real-device IP smoke test needs a dedicated device test directory and
  explicit approval. Do not run `npm run test:device-sync` without approval: it
  uploads a fixture that the device API cannot remove.
- Live Cloud account-switch testing awaits a consenting volunteer with a second
  account. The Marie checks did not switch accounts.

## Separate Decisions

- Automatic cross-device manifest reconciliation is deferred. Stale revisions
  continue to fail rather than silently merging histories.

The completed implementation and Marie-vault results are recorded in
[`multi-sync-plan.md`](multi-sync-plan.md).
