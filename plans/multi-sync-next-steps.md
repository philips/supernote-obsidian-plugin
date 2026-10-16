# Multi-Sync Next Steps

**Remaining after the Marie-vault cancel and restart checks:** Choose any new
implementation scope separately; live checks requiring external access remain
gated. Updated October 16, 2026.

Use [`multi-sync-plan.md`](multi-sync-plan.md) for overall implementation
status, [`shared-manifest-plan.md`](shared-manifest-plan.md) for the detailed
product contract and acceptance cases, and
[`multi-sync-design.md`](multi-sync-design.md) for architecture. This handoff
contains only work remaining after synthetic and Marie-vault validation; the
completed live Cancel and normal-restart checks are recorded in the plan.

## Recommended Next Sprint

- Decide whether ordinary-operation crash recovery or cross-device manifest
  reconciliation is the next implementation scope. Agree on the safety contract
  and acceptance cases before changing either behavior; neither is authorized by
  this validation handoff.
- Keep the real-device IP smoke test for a dedicated device test directory. Do
  not run `npm run test:device-sync` without explicit approval: it uploads a
  fixture that the device API cannot remove. Live Cloud account-switch
  validation awaits a consenting volunteer with a second account.

## Separate Decisions

- Ordinary per-file write/adoption/Trash crash recovery is deferred. Decide
  separately whether to add an operation journal; until then ambiguous file
  states remain protected rather than guessed.
- Automatic cross-device manifest reconciliation is deferred. Stale revisions
  continue to fail rather than silently merging histories.
- Live interrupted-operation recovery testing needs a controlled replaceable
  fixture and separate approval; the normal restart checked only persistence.

The completed implementation and Marie-vault results are recorded in
[`multi-sync-plan.md`](multi-sync-plan.md). Do not treat deferred operations as
part of the completed root-change checkpoint.
