# Journal Companion

Journal Companion is an Obsidian plugin for working with handwritten journals.
These may be stored on digital devices or scanned from physical media. It was
intentionally forked from
[Supernote (Unofficial)](https://github.com/philips/supernote-obsidian-plugin)
to support my partner's journaling workflow, including notes from her Supernote
device now, and eventually scanned copies of the journals she kept growing up.
Scanned-journal support is a goal, not a feature in the current release.

## Compared with the original project, Journal Companion adds

- ☁️ Supernote Cloud sync while keeping direct-IP device sync. When a verified
  Cloud file keeps its persisted ID and checksum after a path change, sync can
  rename its unchanged local copy; ambiguous moves protect both paths. Hosted ID
  stability across rename has not yet been validated with a live fixture.

- 🧩 An engine-neutral sync layer designed to accommodate other devices.

- 🕒 Scheduled automatic sync.

- 📄 Automatic Markdown export that watches vault folders and converts new or
  changed `.note` files, including those brought in by either sync method.
  Export is triggered by vault changes, not by the sync schedule.

- 🛡️ Conflict protection for generated Markdown and optional export error logs.

## Other features carried forward

- 📝 View Supernote `*.note` files in your Obsidian Vault. You can link to these
  notes from your Markdown notes too `[My Note](example.note)`.

- 🔗 Embed a note inline in another note with `![[example.note]]` (scrollable,
  with page nav), or just one page with `![[example.note#page=2]]`.

- ➡️ Export Supernote `*.note` files as PNGs, SVGs, PDFs and/or markdown files
  and attach them to your Vault.

- 📅 Attach all of today's modified Supernote notes and text to the current
  Obsidian note with the "Import notes edited today" command (great when paired
  with [daily notes](https://obsidian.md/help/plugins/daily-notes))

- 🎨 View Supernote Atelier `.spd` files with a layer-visibility sidebar.

- ✒️ Render note ink as sharp vector paths in the viewer and PDF/SVG exports,
  with a raster fallback if a note renders differently from the device.

- 📺 Copy an image from a Supernote via
  [screen mirroring](https://support.supernote.com/en_US/organizing-managing/1791924-screen-mirroring)
  into your current note with the "Insert Supernote mirror image" command.

- 📥 Download and upload files directly from your device via the Supernote
  [Browse & Access](https://support.supernote.com/en_US/Tools-Features/wi-fi-transfer)
  feature. Or sync all your Supernote files to your vault with the sync command.

- 🔍 Extensible OCR: (**beta**) build a companion plugin to customize OCR pages
  during conversion to markdown. See [`ocr-plugins.md`](ocr-plugins.md).

See [`SCREENSHOTS.md`](SCREENSHOTS.md) for a screenshot gallery of each of these
features.

## Automatic Markdown Export

In **Settings → Journal Companion → Automatic Markdown Export**, enable
automatic export and add one or more enabled watch folders. Each folder monitors
vault `.note` files and exports new or modified notes as Markdown. Choose
**.Note conversion** when adding or editing a folder (pencil icon): Markdown
with no page attachment, Markdown with PNG page attachments, or Markdown with
SVG page attachments. Existing folders without a saved conversion choice keep
the Markdown-only behavior. `.spd` files are not automatically converted. Choose
an output folder to preserve the watched folder's relative subdirectories there,
or choose **Beside source** to write Markdown beside each note. Nothing is
exported retroactively; create or modify a watched note to start an export.
Manual exports still create separate copies with their usual destinations and
attachments.

Editing a watch folder keeps its identity and enabled state. Changing its watch
or output location leaves prior exports in place; a newly selected destination
is treated as unmanaged and will not overwrite an existing file.

Page attachments use a `<markdown-name>-pages` folder beside the Markdown
output. Edited or unmanaged page files are not deliberately overwritten; a
format/page-count change or a source rename with managed page attachments
currently requires review rather than moving or deleting those files. The
original Markdown-only rename behavior is unchanged. Binary page updates use
Obsidian's `modifyBinary`, which has no atomic compare-and-write equivalent to
the Markdown text guard; avoid editing generated page images during conversion.

Automatic export is separate from **Automatic sync**: it reacts to vault file
events (including notes written by IP or Cloud sync) and never runs on the sync
timer or contacts a device. It does not delete Markdown when a note is deleted
or moved out of scope.

An existing unmanaged Markdown file or one edited since its last automatic
export is not overwritten. Open the affected destination from the conflict
notice, review or merge your changes (a manual Markdown export can make a
separate comparison copy), then run **Resume automatic export for this file**
from the command palette while viewing that Markdown file. Confirm the mapping,
source, and destination. This records the file's current contents as the new
baseline without rewriting it; the next source change can update it. Renames
with conflicts remain blocked until you explicitly resume.

If the managed Markdown file is missing instead, open the affected `.note` and
run **Regenerate missing Markdown export for this note** from the command
palette. Confirm to discard only that note's missing export record and related
pending rename history, then queue a fresh export. The command is unavailable if
a related destination or source still exists, or the export has page
attachments; it never deletes files. Review any edited Markdown you have
elsewhere before discarding its ownership history.

With **Markdown export error log** enabled, failures and conflicts are recorded
in `Markdown Export Log.md` in each folder's output location, or at the vault
root for beside-source output. Folders using the same output root share a log.
Entries include the folder, source, destination, reason, and resolution hint;
only the eight newest entries are kept. Successful exports never touch the log.
Disabling the error log leaves existing logs intact and does not disable notices
or conflict protection. This log is separate from the raw-file sync log.

## Installation

Journal Companion has its own plugin ID, `journal-companion`. It is separate
from the original plugin and should be installed in its own plugin folder.

## Install via BRAT

To install builds through BRAT:

- Install the BRAT plugin via Community Plugin Search
- [Read the docs](https://tfthacker.com/BRAT)
- Add `https://github.com/SolerSoft/obsidian-journal-companion`

If you are testing a Beta for a bug fix please close and re-open your Obsidian
vault OR run the Obsidian command "Reload app without saving". Otherwise, not
all of the code will be reloaded and your testing will not work.

## Manually installing the plugin

- Copy over `main.js`, `manifest.json` to your vault
  `VaultFolder/.obsidian/plugins/journal-companion/` from
  [Journal Companion releases](https://github.com/SolerSoft/obsidian-journal-companion/releases).
  Copy `styles.css` into the same folder as well.

## Known Issues

There are a handful of known issues. Please check the
[issue list](https://github.com/SolerSoft/obsidian-journal-companion/issues). If
you don't see a matching issue please
[create a new issue](https://github.com/SolerSoft/obsidian-journal-companion/issues)?

## Project Direction

This project will evolve primarily around my partner's journaling workflow. Pull
requests are welcome when they align with that goal. We also encourage others to
fork and adapt the project to their own needs: today's AI coding tools make it
easier to build software tailored to the people who use it.

## Attribution

Journal Companion builds on the work of Brandon Philips and other contributors
to the
[original Supernote plugin](https://github.com/philips/supernote-obsidian-plugin).
Thank you also to [Tiemen Schuijbroek](https://gitlab.com/Tiemen/supernote) for
the original Supernote TypeScript library. The MIT license preserves the
original copyright notice. To thank the original author, visit his
[project](https://github.com/philips/supernote-obsidian-plugin) for ways to
support his work.

## FAQ

**Q** Why isn't there a table of contents in the generated Markdown file?

**A** Because the [Obsidian Outline](https://help.obsidian.md/Plugins/Outline)
sidebar accomplishes this same feature.

**Q** The on-screen note's or exported PDF's ink looks different from the device
/ renders wrong. Can I turn vector ink off?

**A** Yes. The note viewer and exported PDFs/SVGs draw pen strokes as crisp
vector paths by default (instead of rasterizing the ink), so they stay sharp at
any zoom. If ink renders incorrectly or differently from your device, disable
**Settings → Journal Companion → Vector ink** — the view and exports then fall
back to the original rasterized ink. The setting is on by default. (PNG export
and the thumbnail sidebar stay rasterized either way, since a PNG is pixels and
a tiny preview gains nothing from vector paths.)

## Relevant Resources

- [Obsidian and Supernote by Organizing for Change](https://www.youtube.com/watch?v=2zKD79e-V_U)
- [E-Ink notes in Obsidian / Notion? by Brandon Boswell](https://www.youtube.com/watch?v=kW8I8B-eCRk)
- [Academic HANDWRITTEN notes in OBSIDIAN ft. Supernote by pixel leaves](https://www.youtube.com/watch?v=lzYCPkVnqIM)

## Developer Notes

For notes on building, releasing, OCR plugins, supernote-webcomponent, etc see
[DEVELOPER.md](DEVELOPER.md)
