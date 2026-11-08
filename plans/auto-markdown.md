# Automatic Markdown Export Design and Implementation Plan

**Status (November 8, 2026):** Settings, event-driven runtime, per-output-root
error-only logs, coalesced notices, explicit conflict resume, and user
documentation are implemented. Guarded ownership and restart-aware rename
transfer protect edited and unmanaged outputs. Live Marie checks confirmed
nested/root output, source links, guarded refresh, conflict logging, and
repeat-event coalescing; UI rename/resume and sync-originated writes remain
unverified. The next sprint adds a per-folder .note conversion format without
changing .spd support; see `auto-markdown-next-steps.md`. Branch facts below
were checked October 31, 2026.

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
startup scanning or deletion/rename cleanup. Unlike the old branch, the new
implementation must also follow a reliably detected `.note` rename by renaming
its unchanged, managed Markdown export.

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
and staged Save. The current UI instead uses a named Add pair modal and saves
changes immediately. Adapt the mapping model to vault-relative paths and this
plugin's declarative and legacy settings surfaces. Its `WatcherPort` separates
file events from conversion, while its parser registry suggests a future format
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
- Validate each pair before saving and before writing: vault-relative canonical
  paths, directory/file collisions, traversal, and overlapping enabled watch
  directories (including an empty watch covering all). Reject configurations
  that can produce the same destination from different sources, including
  output/log path collisions; do not silently choose a pair or overwrite.
  Multiple pairs may share an output directory only if their derived output
  paths cannot collide. Disabling, removing, or changing a pair cancels its
  pending jobs and leaves old exports untouched.
- Route each vault event to exactly one mapping, then to a converter for its
  file type. **Only `.note` -> Markdown is in scope for the initial runtime**,
  using the current `VaultWriter` text/processor path. Keep event routing,
  mapping identity, destination selection, write protection, and reporting
  independent of the `.note` converter. A future mapping could opt into `.jpg`
  -> OCR -> Markdown through another converter without replacing this pipeline;
  do not add JPG watching, OCR UI/settings, dependencies, or OCR behavior yet.
- Keep conversion ownership keyed by mapping ID, source path, and destination
  with the hash of last generated Markdown, separate from the raw-note shared
  sync manifest. A new destination after a mapping edit is unmanaged until
  safely created or deliberately adopted; changing settings must not bypass an
  existing conflict.
- A reliably detected `.note` rename cancels old-path jobs and resolves both
  paths against current enabled mappings. When both paths are watched and the
  old destination has an ownership record for that source whose last-generated
  hash still matches its content, move the managed Markdown to the new derived
  destination only if that destination is vacant. Transfer its ownership record
  to the new mapping ID, source, and destination; regenerate path-dependent
  content (including source links) there, then keep refreshing it on subsequent
  source changes while the hash still matches. Make the move, content refresh,
  and record update restart-safe; never claim a path after an incomplete write.
  If the old output was locally edited, missing, or unmanaged, or the new
  destination is occupied, do not move or overwrite either file: report a
  conflict requiring review. If no old export exists because this source has not
  yet been converted, treat a rename into watched scope as a new guarded
  creation. Renaming out of scope leaves the old Markdown untouched. Changing
  pair settings alone is not a source rename and must not move old exports.

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
   as new and leave the former output in place, except for a verified source
   rename that qualifies for the guarded move above. Define a recoverable
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
5. **Handle event bursts as one latest-file job.** Listen for `create`,
   `modify`, and `rename` of `.note` files. Debounce generation at the new path,
   serialize per pair/source, and re-read/check the source when work executes. A
   verified rename moves only unchanged managed output and transfers its
   ownership before future updates; a conflicting rename never overwrites local
   edits. A rename cancels old-path jobs and prevents in-flight work from
   writing stale output. If the source changes during conversion, queue a final
   refresh rather than let an old conversion win. Clear pending timers and stop
   queued work on unload or when the option is turned off or a pair changes.
   Write conversion failures and protected destinations to
   `<outputDir>/Markdown Export Log.md` for that pair, or vault-root
   `Markdown Export Log.md` when it has no output directory. Pairs sharing an
   output root share the log; identify the pair and source in each entry. Keep
   it separate from `Sync Log.md`; use dated, bounded entries similar to the
   sync log, with source/destination, a useful reason, and a resolution hint.
   Provide a separate **Markdown export error log** toggle (enabled by default),
   independent of the sync-log setting. Only on an error or protected
   destination, and only when this toggle is on, create or append to the log;
   never create, touch, or append to it for a successful export. Turning the
   toggle off preserves any existing log and suppresses new log writes, but does
   not suppress notices or conflict protection. Show a notice for new
   failures/conflicts, but coalesce repeated notifications for the same
   unresolved issue. If the log cannot be written, notify the user of that
   failure without masking the original conversion error; never overwrite a
   non-log file at the log path. If an output root is invalid or unwritable, do
   not log in a different directory; notify the user. These issues must not be
   reported as failures of the IP/Cloud sync run. No initial backfill, automatic
   deletion, or Trash operation is implied by the old feature.

## Implementation sequence

1. **Completed (settings sprint):** Add the global toggle, independent error-log
   toggle, and stable-ID watch/output mappings in `src/settings.ts` with
   Add/Remove, per-pair enable, vault-folder dropdowns in a named Add pair
   modal, validation, and immediate saves. The declarative and legacy settings
   surfaces have a separate Automatic Markdown Export group whose dependent
   settings hide when disabled. Names are labels, not paths; blank, duplicate,
   control-character, and over-80-character names are rejected.
   `src/settings.test.ts` covers persistence and mapping validation; real
   Obsidian UI validation remains outstanding.
2. **Completed (event-driven runtime sprint):** `VaultWriter` renders Markdown
   for a supplied destination while manual export retains its existing filename
   and attachment path. `src/automaticMarkdownExport.ts` routes enabled mappings
   for `.note` only, derives root/nested and beside-source paths, debounces
   events, rechecks source bytes, guards updates with `vault.process`, and
   stores mapping/source/destination hashes separately from sync state. Vault
   create, modify, and rename events are registered after writer initialization.
   A verified rename transfers unchanged managed Markdown to a vacant
   destination with a pending-move recovery record and refreshes path-dependent
   links; conflicts leave outputs alone. Focused tests cover paths, edits,
   unmanaged files, remapping, in-flight changes, rename bursts, and
   write/restart failures. Full tests, build, lint (warnings only), and diff
   check passed. Later Marie checks verified Markdown-only nested/watch-root
   generated files and guarded updates; settings UI and a sync-engine-originated
   vault write remain unverified.
3. **Completed (reporting and conflict sprint):** Error-only, eight-entry
   bounded Markdown Export Logs live in each pair's output root (vault root for
   beside-source output); occupied paths and write failures leave the original
   error visible. Coalesced notices open the destination, and the
   command-palette resume action confirms the pair/source/destination before
   adopting the current destination and source hashes. An unchanged source event
   cannot overwrite reviewed Markdown. The README describes the opt-in workflow
   and its separation from timed raw-file sync. Focused tests, full tests,
   build, lint (warnings only), and diff check passed.
4. **Remaining from the original sprint:** Inspect both settings surfaces,
   notices, Obsidian-driven rename, manual export and explicit resume in Marie.
   Verify a sync-originated vault write if possible without changing device or
   Cloud contents. Preserve existing vault files and sync records.
5. **In progress (folder/format sprint, November 8, 2026):** The Add folder
   dialog and both settings surfaces use folder terminology; the renamed modal
   saves `.Note conversion` as `markdown`, `png`, or `svg`, with absent values
   continuing to mean Markdown-only. The automatic writer builds page PNGs or
   SVGs with deterministic paths and links. Export records track attachment
   hashes and block unmanaged/edited files. Renaming a source with managed page
   attachments stops with a conflict to avoid moving Markdown alone; full
   multi-file rename/recovery and live UI/rendering checks remain. Focused
   settings/export tests and a production build passed in this session.

## Next sprint: folder terminology and .note conversion

- **Started:** Replace user-facing "pair" terminology with "folder": **Watch
  folders**, **Add folder**, and **Add monitored export folder** (including the
  modal's filename and type). Update the settings description and validation
  messages. Keep the existing `markdownExportMappings` persistence key, `id`,
  `watchDir`, and `outputDir` so existing saved exports and ownership records
  retain their identity; no stored structure or field should use "pair". Rename
  local variables and types that describe these entries to export/folder
  terminology.
- **Implemented, pending live checks:** Add a **.Note conversion** dropdown to
  the add-folder dialog, saved with each folder: **Markdown, no page
  attachment** (default, including legacy entries without a format), **Markdown
  with a PNG page attachment**, and **Markdown with a SVG page attachment**. Do
  not watch or change `.spd`. The automatic event path must generate the
  selected output and links while manual export remains unchanged. A format
  change must not silently claim unmanaged files or erase old attachments.
- **Partially implemented:** Design attachment ownership before writing images:
  deterministic per-page destinations, collision checks, content hashes, and an
  explicit update/ rename/restart policy. An edited, missing, or unmanaged image
  must not be overwritten or silently replaced; report an actionable conflict.
  Preserve the Markdown guard and avoid partial Markdown links or orphaned files
  if a page write or settings save fails. Test create/modify/rename, page-count
  and format changes, interruption and resume, as well as successful image
  embeds.
- Recheck documentation and focused tests, full `npm test`, `npm run build`,
  `npm run lint`, and `git diff --check`; validate the new controls and outputs
  in Marie with uniquely named local copies only. The remaining earlier manual
  UI and sync-originated checks remain separate until verified.

## Acceptance criteria

- Off by default: existing manual exports and scheduled IP/Cloud runs behave
  exactly as on `main`. Turning on Markdown export does not enable a timer.
- A new, updated, or renamed watched `.note` produces one latest Markdown-only
  output under its matching pair's output directory, or beside the source when
  it is empty, preserving relative paths, source links, and processed text.
  Multiple independent pairs work; JPG/OCR conversion is not active.
- Repeated events do not create numbered duplicates; unmanaged or locally edited
  Markdown is never overwritten, and changing folder settings leaves old output
  untouched. Conflicts and failures produce actionable notices and entries in
  each pair's output-root `Markdown Export Log.md` (vault root for an empty
  output directory) only while the separate error-log toggle is enabled.
  Successful exports never touch that log; notices and conflict protection
  continue when logging is off. Resolving a conflict requires a deliberate
  resume action after review.
- Vault-root and nested paths, multiple sync events, reloads, failed writes, and
  stopping the plugin do not produce incorrect paths or stale overwrites. A
  reliably detected rename of a watched source moves its unchanged managed
  Markdown to the new derived path, updates its links, and continues guarded
  updates there. An edited old output or occupied new destination is never moved
  or overwritten; a rename out of scope leaves the old output alone.
