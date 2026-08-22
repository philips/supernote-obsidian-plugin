# Supernote (Unofficial)

I use my Supernote for capturing hand written notes and reading documents.

But, I also use Obsidian for organizing and capturing all of my digital notes.

This plugin enables me (and now you!) to import handwritten notes directly from your device (no cloud!) into Obsidian and view/export/organize them on a desktop, phone or tablet.

This plugin has seven main features:

- 📝 View Supernote `*.note` files in your Obsidian Vault. You can link to these notes from your Markdown notes too `[My Note](example.note)`.

- 🔗 Embed a note inline in another note with `![[example.note]]` (scrollable, with page nav), or just one page with `![[example.note#page=2]]`.

- ➡️  Export Supernote `*.note` files as PNGs, SVGs, PDFs and/or markdown files and attach them to your Vault.

- 🧠 Attach all of today's modified Supernote notes and text to the current Obsidian note with the "Import notes edited today" command (great when paired with [daily notes](https://obsidian.md/help/plugins/daily-notes))

- 📺 Copy an image from a Supernote via [screen mirroring](https://support.supernote.com/en_US/organizing-managing/1791924-screen-mirroring) into your current note with the "Insert Supernote mirror image" command ([demo video](https://youtu.be/Ih_NW-z_aLw))

- ⬇️  Download & Upload files directly from your device via the Supernote [Browse & Access](https://support.supernote.com/en_US/Tools-Features/wi-fi-transfer) feature. ([demo video](https://www.youtube.com/watch?v=SEkp395hbBM)). Or sync all your Supernote files to your vault with the sync command.

- ✏️ Extensible OCR: (**beta**) build a companion plugin to customize OCR pages during conversion to markdown. See [`ocr-plugins.md`](ocr-plugins.md).

See [`SCREENSHOTS.md`](SCREENSHOTS.md) for a screenshot gallery of each of these features.

**Video Demo**

[![Watch the video](https://img.youtube.com/vi/tEoW35fYVew/hqdefault.jpg)](https://www.youtube.com/watch?v=ihRh_F43-iQ)

## Install via Community Plugin Store

This plugin is available via the [Obsidian Community Plugin Store](https://obsidian.md/plugins?id=supernote). Click the previous link or search for "Supernote (Unofficial)". 

## Install via BRAT

To test Beta builds of this plugin follow these steps:

- Install the BRAT plugin via Community Plugin Search
- [Read the docs](https://tfthacker.com/BRAT)
- Add `https://github.com/philips/supernote-obsidian-plugin`

## Manually installing the plugin

- Copy over `main.js`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/obsidian-plugin-supernote/` from [https://github.com/philips/supernote-obsidian-plugin/releases](https://github.com/philips/supernote-obsidian-plugin)

## Known Issues

There are a handful of known issues. Please check the [issue list](https://github.com/philips/supernote-obsidian-plugin/issues). If you don't see a matching issue please [create a new issue](https://github.com/philips/supernote-obsidian-plugin/issues)?

## Thank You

Thank you to [Tiemen Schuijbroek](https://gitlab.com/Tiemen/supernote) for developing the initial supernote Typescript library I forked.

## FAQ

**Q** Why isn't there a table of contents in the generated Markdown file? 

**A** Because the [Obsidian Outline](https://help.obsidian.md/Plugins/Outline) sidebar accomplishes this same feature.

**Q** The on-screen note's or exported PDF's ink looks different from the device / renders wrong. Can I turn vector ink off?

**A** Yes. The note viewer and exported PDFs/SVGs draw pen strokes as crisp vector paths by default (instead of rasterizing the ink), so they stay sharp at any zoom. If ink renders incorrectly or differently from your device, disable **Settings → Supernote → Vector ink** — the view and exports then fall back to the original rasterized ink. The setting is on by default. (PNG export and the thumbnail sidebar stay rasterized either way, since a PNG is pixels and a tiny preview gains nothing from vector paths.)

## Relevant Resources

- [Obsidian and Supernote by Organizing for Change](https://www.youtube.com/watch?v=2zKD79e-V_U)
- [E-Ink notes in Obsidian / Notion? by Brandon Boswell](https://www.youtube.com/watch?v=kW8I8B-eCRk)
- [Academic HANDWRITTEN notes in OBSIDIAN ft. Supernote by pixel leaves](https://www.youtube.com/watch?v=lzYCPkVnqIM)

## Funding

I personally don't accept funding or donations for this project. However, if you feel inclined, consider donating to the [Signal Foundation](https://signal.org/donate/) or [Internet Security Research Group (ISRG)](https://www.abetterinternet.org). Open an issue or send me an email to let me know about your donation. It will make my day.

## Developer Notes

For notes on building, releasing, OCR plugins, supernote-webcomponent, etc see [DEVELOPER.md](DEVELOPER.md)
