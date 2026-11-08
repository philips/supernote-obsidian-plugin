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
validation. See `auto-markdown.md` for the design and safety rules.

Disposable local fixtures were left for the UI checks: source folder
`Supernote/__copilot_auto_md_sprint_87b1e7d99c` and output folder
`Supernote Markdown/__copilot_auto_md_sprint_87b1e7d99c`. The nested source
`Nested/sample.note` has a managed output; `root-sample.md` contains a
deliberate local edit and a conflict is recorded in
`Supernote Markdown/Markdown Export Log.md`. Keep the original notes under
`Supernote sync` and all sync records untouched.

## Recommended next sprint: finish image lifecycle and live validation

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
   `.Note
   conversion` choices, the conflict notice, and processed text in the
   disposable output. Use new uniquely named local `.note` copies for PNG/SVG
   output and link checks. Check the legacy settings surface separately where
   available; on Obsidian 1.13+ the deprecated `display()` surface is bypassed.
   Windows testing does not require the Linux/Xvfb headless harness.
3. Rename `Supernote/__copilot_auto_md_sprint_87b1e7d99c/Nested/sample.note` to
   `renamed.note` **inside Obsidian**, then confirm the managed output moves and
   its source link updates. Open the disposable `root-sample.md` output, run
   **Resume automatic export for this file**, review and confirm the modal, and
   check that the local edit remains until a subsequent source change. Test
   manual Markdown export without altering existing files.
4. Check a live sync-originated vault write only if it can be initiated without
   changing device or Cloud contents; otherwise report it separately. Confirm
   scheduled sync remains independent and no Markdown-export timer was added.
   After UI checks, remove only the uniquely named test source/output folders;
   preserve the shared error log and all other vault files and sync records.
5. Fix any issues discovered and recheck focused tests, `npm test`,
   `npm run build`, `npm run lint`, and `git diff --check` before release.
