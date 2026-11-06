# Automatic Markdown Export Design and Implementation Plan

**Status:** Implementation started November 1, 2026. Settings model, staged
mapping controls in both settings surfaces, and initial mapping validation are
in place. Vault-event conversion, ownership protection, reporting, and
end-to-end UI validation are not implemented yet. Branch facts checked October
31, 2026.

The implementation target is `obsidian-journal-companion` at
`C:\Code\SolerSoft\obsidian-journal-companion`. Petrify at
`C:\Code\jo-minjun\petrify` is a reference implementation, not the target
project. This feature converts vault files; it does not mirror device files.

## Baseline and provenance

- `feat/auto-markdown-export` and local/remote `main` all point to `ed73d37`;
  the worktree was clean before this plan was added.
- `feat/old-auto-markdown-export` exists locally and on `origin`, at `66ebd0e`.
  It forked from `main` at `855b08b` (September 21, 2026). Its four unique
  commits include the original Markdown-export change from July 26, 2026; its
  tip is dated October 11, 2026. The branch comparison changes only
  `src/main.ts` and `src/settings.ts` (191 additions, 9 deletions).
- Multi-sync functionality is on current `main`: shared manifest, IP and Cloud
  engines, one active-engine coordinator, scheduled dispatch, and recovery.
  `origin/feat/multi-sync` exists at `a86c3fc` (October 17, 2026), but that
  exact commit is **not** an ancestor of `main`; no local `feat/multi-sync` ref
  exists. This is integration of the work, not a literal merge of that branch
  tip. Do not merge or cherry-pick either old branch wholesale.

## Reference implementations and approach

The old branch opts into exporting Markdown when a vault `.note` file is created
or modified, optionally limits watching to one folder, and can mirror the
watched relative directory structure under one output folder. Retain its
event-driven conversion, the existing Markdown-only writer and text processors,
debouncing, quiet success behavior, and safe folder creation. It does not do
startup scanning or deletion/rename cleanup.

The old implementation mixes automatic-output paths into the general
`writeMarkdownFile` path, so manual attach/export commands would also use the
mirror folder and lose their existing destination semantics. It exports
immediately on `create` but debounces only `modify`; overlapping conversions can
write out of order. Its overwrite option unconditionally modifies any existing
Markdown file at the derived path, including a user's own edits. These are
behaviors to redesign, not carry forward.

Petrify's `packages/obsidian-plugin/src/settings.ts` and `settings-tab.ts`
provide the better model for multiple mappings: an opt-in list of independently
enabled watch/output pairs with Add, Remove, per-pair toggles, directory inputs,
and staged Save. Adapt that UI pattern to vault-relative paths and this plugin's
declarative and legacy settings surfaces. Its `WatcherPort` separates file
events from conversion, while its parser registry suggests a future format
boundary. But Petrify's `ChokidarWatcher` watches OS paths at depth zero rather
than indexed Obsidian vault files; its scanner deletes orphans, and its
conversion saver does not enforce our local-edit guard. Do not import those
runtime components, cleanup, or Google Drive polling here. Use Obsidian vault
events and this plugin's `.note` renderer instead. Petrify is MIT licensed; if
substantial code is copied verbatim later, retain its license notice as required
by that license.

## Mapping and conversion design

- Store a disabled-by-default global toggle and a list of mappings with a stable
  ID, vault-relative `watchDir` and `outputDir`, and per-pair `enabled`. An
  empty watch directory means the whole vault; an empty output directory means
  Markdown beside each source. An empty list does nothing. Do not add the old
  branch's single-folder keys to new settings.
- For a matching source, strip the watch directory prefix and put its relative
  path under that pair's output directory, changing `.note` to `.md`. For
  example, `Notes/Journal/day.note` under `Notes` maps to
  `Exports/Journal/day.md` if the output is `Exports`. If `outputDir` is empty,
  do not strip the watch prefix: write beside the source at
  `Notes/Journal/day.md`, including for nested folders and vault-root files. The
  empty output is an explicit "same folder as source" option in each pair, not a
  separate shared output directory. Ignore generated `.md` events.
- Validate each pair on Save and before writing: vault-relative canonical paths,
  directory/file collisions, traversal, and overlapping enabled watch
  directories (including an empty watch covering all). Reject configurations
  that can produce the same destination from different sources, including
  output/log path collisions; do not silently choose a pair or overwrite.
  Multiple pairs may share an output directory only if their derived output
  paths cannot collide. Disabling, removing, or changing a pair cancels its
  pending jobs and leaves old exports untouched.
- Route each vault event to exactly one mapping, then to a converter for its
  file type. **Only `.note` -> Markdown is supported now**, using the current
  `VaultWriter` text/processor path. Keep event routing, mapping identity,
  destination selection, write protection, and reporting independent of the
  `.note` converter. A future mapping could opt into `.jpg` -> OCR -> Markdown
  through another converter without replacing this pipeline; do not add JPG
  watching, OCR UI/settings, dependencies, or OCR behavior yet.
- Keep conversion ownership keyed by mapping ID, source path, and destination
  with the hash of last generated Markdown, separate from the raw-note shared
  sync manifest. A new destination after a mapping edit is unmanaged until
  safely created or deliberately adopted; changing settings must not bypass an
  existing conflict.

## Integration decisions to review

1. **Keep scheduling in current code.** `SingleEngineSyncCoordinator` and
   `pollAutomaticSync()` remain the sole owners of timed IP/Cloud sync,
   readiness, in-flight suppression, and recovery. Markdown export is a separate
   opt-in, vault-event-driven conversion of local `.note` files; it is not a
   third sync engine, does not use the sync interval, and never initiates a
   network run. Label its setting **Automatic Markdown export** rather than
   reusing the existing **Automatic sync** name. A scheduled mirror write
   naturally emits a vault event and can trigger conversion, regardless of which
   engine wrote the file; unchanged notes do not need conversion. Never let
   Markdown files become sync-engine managed records.
2. **Preserve manual exports.** Keep existing uniquified filenames, image
   attachments, notices, and destinations for viewer/command exports. Add a
   dedicated automatic Markdown-only path that shares text rendering and
   registered page text processors, but selects a deterministic destination and
   performs a guarded update. Fix vault-root path handling within that path
   without changing unrelated manual behavior.
3. **Define opt-in scope per pair.** Add the disabled-by-default global toggle
   and independently enabled watch/output mappings above to
   `SupernotePluginSettings` and `DEFAULT_SETTINGS`. Use segment-boundary
   matching, preserve relative subdirectories (or the full source path when
   writing beside it), and keep these controls independent of `syncFolder`,
   engine selection, and raw sync path/extension allowlists.
4. **Protect Markdown edits.** A repeatable destination is not permission to
   overwrite arbitrary content. Persist the per-mapping export records above in
   plugin settings or a dedicated local store. On refresh, modify only if the
   current destination matches the last generated hash; skip and report a
   conflict for pre-existing unmanaged files or local edits. Record an initial
   write only after successful creation, and do not claim ownership after a
   failed save. If a setting or source path changes, treat the new destination
   as new and leave the former output in place. Define a recoverable
   record/write sequence so a restart between file creation and record
   persistence cannot silently overwrite an untracked file. Do not mix this
   record with the raw-note shared mirror manifest or its recovery protocol. On
   conflict, show a notice that opens the affected Markdown file and points to
   the log in that pair's output root when error logging is enabled. The log
   entry must identify the pair, source, and destination and say why the update
   was skipped. To resolve it, the user can run the existing manual Markdown
   export to create a separate copy, compare/merge it into their edited file,
   then explicitly select **Resume automatic export for this file** (from a
   per-file action or settings conflict list). That action confirms the
   destination and records its current hash as the new baseline without
   overwriting it immediately; only a subsequent source change may update it.
   Never clear a conflict or replace the destination merely because another
   vault event arrived.
5. **Handle event bursts as one latest-file job.** Listen for `create` and
   `modify` of `.note` files, debounce both, serialize per pair/source, and
   re-read/check the source when work executes. If the source changes while a
   conversion is in flight, queue a final refresh rather than let an old
   conversion win. Clear pending timers and stop queued work on unload or when
   the option is turned off or a pair changes. Write conversion failures and
   protected destinations to `<outputDir>/Markdown Export Log.md` for that pair,
   or vault-root `Markdown Export Log.md` when it has no output directory. Pairs
   sharing an output root share the log; identify the pair and source in each
   entry. Keep it separate from `Sync Log.md`; use dated, bounded entries
   similar to the sync log, with source/destination, a useful reason, and a
   resolution hint. Provide a separate **Markdown export error log** toggle
   (enabled by default), independent of the sync-log setting. Only on an error
   or protected destination, and only when this toggle is on, create or append
   to the log; never create, touch, or append to it for a successful export.
   Turning the toggle off preserves any existing log and suppresses new log
   writes, but does not suppress notices or conflict protection. Show a notice
   for new failures/conflicts, but coalesce repeated notifications for the same
   unresolved issue. If the log cannot be written, notify the user of that
   failure without masking the original conversion error; never overwrite a
   non-log file at the log path. If an output root is invalid or unwritable, do
   not log in a different directory; notify the user. These issues must not be
   reported as failures of the IP/Cloud sync run. No initial backfill, automatic
   deletion, or Trash operation is implied by the old feature.

## Implementation sequence

1. Add the global toggle, independent error-log toggle, and stable-ID
   watch/output mappings in `src/settings.ts` with Add/Remove, per-pair enable,
   vault-folder inputs, validation, and staged Save inspired by Petrify's UI.
   Implement both the declarative settings definitions and the legacy
   `display()` fallback. Put these controls near Convert, not inside the active
   engine's schedule controls. Test defaults, persistence, invalid/overlapping
   mappings, destination/log collisions, and both settings surfaces in
   `src/settings.test.ts`.
2. Extract/reuse the Markdown-only rendering portion of `VaultWriter` in
   `src/main.ts` without changing manual `attachMarkdownFile`, image export, or
   `writeMarkdownFile` behavior. Add vault-event mapping resolution and a narrow
   extension-to-converter boundary with `.note` only, deterministic per-pair
   output paths, folder creation, guarded output ownership, and write state.
   Keep processor-on-demand rasterization behavior intact. Add focused tests for
   paths (including same-folder output for root and nested sources), pair
   isolation, ownership, resume-without-overwrite, restart/failure, and
   generated links from mirrored directories; place helpers/tests beside
   existing source rather than reshaping either sync engine.
3. Register vault event handling in `src/main.ts` after settings and writer
   initialization. Test create/modify burst coalescing, slow conversions,
   disable/unload, out-of-scope files, and a sync-engine write emitting a vault
   event. Add per-output-root Markdown export reporting with bounded log writes,
   conflict notices and the explicit resume action; test multiple output roots,
   shared-root entries, vault-root logging for an empty output directory,
   successful exports never creating or touching logs, the error-log toggle
   on/off, repeated failures, log-write failures, conflicts, and independence
   from the sync log settings. Confirm the existing coordinator timer and
   manual/scheduled sync command behavior remain unchanged.
4. Update user-facing documentation for the opt-in toggle, multiple watch/output
   pairs, same-folder output, error-only log toggle and log location per pair,
   conflict resolution, and the distinction from timed raw-file sync. Run
   focused tests, then `npm test`, `npm run build`, `npm run lint`, and
   `git diff --check`. For UI/rendering behavior, inspect both settings surfaces
   and representative generated files in a disposable Obsidian test vault; do
   not mutate real-device or Cloud contents.

## Acceptance criteria

- Off by default: existing manual exports and scheduled IP/Cloud runs behave
  exactly as on `main`. Turning on Markdown export does not enable a timer.
- A new or updated watched `.note` produces one latest Markdown-only output
  under its matching pair's output directory, or beside the source when it is
  empty, preserving relative paths, source links, and processed text. Multiple
  independent pairs work; JPG/OCR conversion is not active.
- Repeated events do not create numbered duplicates; unmanaged or locally edited
  Markdown is never overwritten, and changing folder settings leaves old output
  untouched. Conflicts and failures produce actionable notices and entries in
  each pair's output-root `Markdown Export Log.md` (vault root for an empty
  output directory) only while the separate error-log toggle is enabled.
  Successful exports never touch that log; notices and conflict protection
  continue when logging is off. Resolving a conflict requires a deliberate
  resume action after review.
- Vault-root and nested paths, multiple sync events, reloads, failed writes, and
  stopping the plugin do not produce incorrect paths or stale overwrites.
