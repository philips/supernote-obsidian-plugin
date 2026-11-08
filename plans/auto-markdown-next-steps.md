# Automatic Markdown Export: Next Steps

**Status (November 8, 2026):** Existing watch folders can now be edited from a
pencil action, with prefilled fields and their original ID and enabled state
retained. Folder terminology, a persisted `.Note conversion` choice
(Markdown-only default, PNG or SVG page attachments), and guarded image
creation/refresh have been implemented. Automated export/settings tests and a
production build passed; the full suite passed (563 tests), lint reported 0
errors and 20 existing warnings, and `git diff --check` passed. Live PNG/SVG
output and settings UI still need checking. Image-bearing renames are currently
blocked with a conflict rather than partially moving the export. Live Marie
checks from the previous sprint passed for Markdown-only nested/watch-root
creation, source links, page headings, managed refresh, edit protection,
error-only logging, and repeat events. The earlier Obsidian-driven rename,
explicit resume, manual export, and sync-originated writes still need
validation. Cloud-side renames currently arrive as raw-note create/Trash, not
vault rename events; their guarded local move is deferred to
`cloud-sync-next-steps.md` and does not block completing local auto-export. See
`auto-markdown.md` for completed work and safety rules.

The user manually removed the previous disposable source folder and its
auto-exported Markdown on November 8, 2026. Do not assume those fixtures or
their managed outputs still exist. Create fresh, uniquely named local `.note`
copies and output fixtures for the remaining checks; keep the original notes
under `Supernote sync` and all sync records untouched. Any historical entries in
`Supernote Markdown/Markdown Export Log.md` are not evidence of a current
fixture or conflict.

## Remaining before auto-export completion

1. Finish the attachment lifecycle before relying on automatic image exports:
   specify and test restart-safe image/Markdown writes, failed settings saves,
   changed page counts and format switches, edited/deleted images, and the
   non-atomic `modifyBinary` race. Implement verified attachment moves and
   updated links on source rename (or retain a documented, actionable conflict
   workflow that can actually be resolved). Do not delete user-edited or
   unmanaged files. Add focused integration tests for PNG and SVG rendering,
   link resolution, ownership, recovery and resume.
2. In running Obsidian, inspect the Automatic Markdown Export settings and
   folder controls, including editing an existing folder and all three
   `.Note conversion` choices, the conflict notice, and processed text in the
   disposable output. Recreate fresh, uniquely named local `.note` copies for
   Markdown-only and PNG/SVG output and link checks. Check the legacy settings
   surface separately where available; on Obsidian 1.13+ the deprecated
   `display()` surface is bypassed. Windows testing does not require the
   Linux/Xvfb headless harness.
3. Create a fresh nested local `.note` fixture with a managed Markdown-only
   output, then rename it **inside Obsidian** and confirm the output moves and
   its source link updates. For the resume check, create a separate managed
   output, make a deliberate local edit, trigger a source change, and confirm
   the resulting conflict before running **Resume automatic export for this
   file**. Review and confirm the modal, and check that the edit remains until a
   subsequent source change. Test manual Markdown export without altering
   existing files.
4. Check a live sync-originated vault write only if it can be initiated without
   changing device or Cloud contents; otherwise report it separately. Confirm
   scheduled sync remains independent and no Markdown-export timer was added.
   After UI checks, remove only the newly created test source/output folders;
   preserve the shared error log and all other vault files and sync records.
5. Fix any issues discovered and recheck focused tests, `npm test`,
   `npm run build`, `npm run lint`, and `git diff --check` before release.
