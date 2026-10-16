# Multi-Sync Next Steps

**Status:** Recovery and attention logging are implemented; real-engine
interruption, identical-byte adoption, and uncertain Trash remain untested live.
Updated October 16, 2026.

Use [`multi-sync-plan.md`](multi-sync-plan.md) for overall implementation
status, [`shared-manifest-plan.md`](shared-manifest-plan.md) for the detailed
product contract and acceptance cases, and
[`multi-sync-design.md`](multi-sync-design.md) for architecture. This handoff
contains only remaining validation; completed checks are recorded in the plan.

## Remaining Validation

- End-to-end interruption at a real engine operation, identical-byte adoption,
  and uncertain Trash need controlled, replaceable fixtures. Use a narrowly
  scoped fault at the operation boundary and verify the manifest, vault bytes,
  backup/Trash outcome, and log before and after manual recovery. Do not
  terminate the Obsidian renderer or change a user's real sync. Clean up only
  the test fixtures after verifying the original records and account binding.
- The real-device IP smoke test needs a dedicated device test directory and
  explicit approval. Do not run `npm run test:device-sync` without approval: it
  uploads a fixture that the device API cannot remove.
- Live Cloud account-switch testing awaits a consenting volunteer with a second
  account. The Marie checks did not switch accounts.

## Recommended Next Sprint

Focus on a controlled, disposable-vault real-engine write interruption first:
introduce a test-only fault at a single per-file operation boundary, validate
recovery after a normal restart, then exercise identical-byte adoption and
uncertain Trash only with independent replaceable fixtures. Run focused tests,
the full test suite, build, lint, and diff check. Keep the device upload and
second-account scenarios separate until their prerequisites and approval are
available.

## Separate Decisions

- Automatic cross-device manifest reconciliation is deferred. Stale revisions
  continue to fail rather than silently merging histories.

The completed implementation and Marie-vault results are recorded in
[`multi-sync-plan.md`](multi-sync-plan.md).
