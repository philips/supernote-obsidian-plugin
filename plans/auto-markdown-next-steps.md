# Automatic Markdown Export: Next Steps

**Status (November 6, 2026):** The settings and safe event-driven export runtime
are implemented. This handoff lists only remaining work. See `auto-markdown.md`
for the design and safety rules. The runtime has unit coverage but has not been
validated in a running Obsidian test vault.

## Recommended next sprint: reporting and conflict resolution

1. Add bounded, error-only `Markdown Export Log.md` reporting per output root
   (vault root for beside-source mappings), independent of `Sync Log.md` and the
   IP/Cloud coordinator. Log the mapping, source, destination, failure reason,
   and resolution hint. Honor the existing `markdownExportErrorLogEnabled`
   toggle: successful exports never create or touch a log, and disabling logging
   preserves existing logs without suppressing conflicts or notices. Handle
   occupied log paths, invalid roots, and log-write failures without hiding the
   original error or falling back to a different root. Test shared/separate
   roots, vault-root output, toggle on/off, repeated failures, and bounded
   history.
2. Make conflict notices actionable and coalesced. Provide **Resume automatic
   export for this file** for a reviewed destination: confirm the mapping,
   source, and actual destination; store its current hash as the new ownership
   baseline without writing Markdown immediately. Clear the relevant rename
   conflict block only after a successful explicit resume. Keep unmanaged or
   locally edited files protected until then, including after reload; test
   repeat events, failed persistence, remappings, and the next source change.
3. Check the integration with a synthetic `.note` fixture in the designated
   disposable Obsidian test vault. Verify both settings surfaces, root and
   nested outputs, generated source links, processor text, create/modify/rename,
   a sync-engine-originated vault write using mocked or synthetic source data,
   notices, logs, and resume. Do not mutate real device, Cloud, or existing
   vault files. Confirm manual exports and scheduled sync still behave as
   before, without adding a Markdown-export timer.

## After runtime validation

4. Update user-facing documentation for the opt-in toggle, watch/output pairs,
   beside-source output, error-only log and its per-pair location, explicit
   conflict resolution, and the distinction from timed raw-file sync. Run
   focused tests, then `npm test`, `npm run build`, `npm run lint`, and
   `git diff --check`.
