# Supernote Obsidian Plugin (Unofficial)

I use my Supernote for capturing hand written notes and reading documents.

But, I already use Obsidian for organizing and capturing all of my digital notes.

This plugin enables me (and now you!) to import handwritten notes into Obsidian and view them on a desktop, phone or tablet.

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

[![Watch the video](https://img.youtube.com/vi/tEoW35fYVew/hqdefault.jpg)](https://www.youtube.com/watch?v=tEoW35fYVew)

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

- Building a custom AI/OCR companion plugin? See [`ocr-plugins.md`](ocr-plugins.md)
  for the `registerPageTextProcessor` hook and a working example.
- Using the `<supernote-viewer>` or `<supernote-atelier-viewer>` web components in your own app? See
  [`webcomponent-usage.md`](webcomponent-usage.md). Publishing a new version of one? See
  [`webcomponent-publishing.md`](webcomponent-publishing.md).
- Make sure your NodeJS is at least v16 (`node --version`).
- Clone this repo.
- Setup the deps

```
git submodule init && git submodule update
npm run build
npm install
```

### `<supernote-viewer>` web component (experimental)

[Issue #183](https://github.com/philips/supernote-obsidian-plugin/issues/183) tracks pulling the note
viewer out into a standalone `<supernote-viewer>` custom element that runs on any page, with no Obsidian
involved - useful for previewing a `.note` file's rendering pipeline outside the plugin, or eventually for
publishing notes as static web pages.

**Try it live:** https://philips.github.io/supernote-web-component/ - pick a `.note` file from your device
to view it in the browser, no install required. That page is built and hosted from
[philips/supernote-web-component](https://github.com/philips/supernote-web-component), which clones this
repo at deploy time; it isn't published or bundled with the plugin release itself. To build it yourself
instead:

```
npm run build:webcomponent   # writes dist/supernote-viewer.js (gitignored)
npx serve .                  # any static file server works - module scripts need http(s), not file://
```

Then open `/demo/` in a browser and pick a `.note` file to view it. See
[`webcomponent-usage.md`](webcomponent-usage.md) for the full API (attributes, properties, events,
styling, framework notes) and [`webcomponent-publishing.md`](webcomponent-publishing.md) for how to
actually ship a version of this for others to depend on - nothing is published with a stable URL/version
yet, so don't point production code at the live demo above.

Note that this can't literally run embedded in this README on GitHub - GitHub sanitizes rendered Markdown
and strips `<script>` tags and custom elements, so there's no way to load a live, interactive component
directly on a GitHub-rendered page. A hosted demo (e.g. GitHub Pages) linked from here would work; that's
left for a future pass once the component is further along (it's read-only for now - no save/export, see
the issue for why that's a separate piece of work).

### `<supernote-atelier-viewer>` web component (experimental)

The `.spd` (Supernote Atelier app) equivalent of `<supernote-viewer>` above - same standalone, no-Obsidian
custom element, this time for Atelier's layered-canvas files instead of `.note`'s paged ones, with a
layer-visibility toggle sidebar instead of a page-thumbnail one. Same experimental/unstable status as its
`.note` sibling. Build and try it the same way:

```
npm run build:atelier-webcomponent   # writes dist/supernote-atelier-viewer.js (gitignored)
npx serve .
```

Then open `/demo/atelier.html` and pick a `.spd` file. See [`webcomponent-usage.md`](webcomponent-usage.md)
for its full API and [`webcomponent-publishing.md`](webcomponent-publishing.md) for publishing - both docs
now cover this component alongside `<supernote-viewer>`.

- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.

**Android Debugging**

- Ensure `npm run dev` is running above
- Create a vault called "SupernoteTest"
- Install the supernote plugin from the community store
- Run `npm run push-android` to push main.js to the device
- Run "Reload App without Saving" on Obsidian command palette

**Releasing**

Pushing a tag is the only manual step; [`.github/workflows/release.yml`](.github/workflows/release.yml)
builds the plugin and publishes the GitHub release with `main.js`, `manifest.json` and
`styles.css` attached. The tag's format decides the release channel:

- A plain `X.Y.Z` tag is a **stable** release. The tag must exactly match the version
  already committed in `manifest.json` — the workflow fails instead of publishing if it
  doesn't.
- A tag with a semver pre-release suffix, e.g. `X.Y.Z-beta.1`, is a **beta** release,
  published as a GitHub pre-release.

`manifest.json` committed to the repo must only ever hold the last **stable** version.
Obsidian's own update-checker (for regular Community Store users, not BRAT) reads
`manifest.json` straight from this repo to decide whether a newer version exists — it does
not go through GitHub's "latest release" API, so if a beta version ever landed in the
committed `manifest.json`, every installed user's client would offer it as an update. To
keep betas invisible to them, a beta tag is never preceded by a commit that bumps
`manifest.json`: the release workflow stamps the tag's version into `manifest.json` only
inside its own build, purely for the release asset, and that change is never merged back
into the repo. [BRAT](https://tfthacker.com/BRAT) fetches `manifest.json` from that release
asset (not from the repo), so it still sees the right beta version.

To cut a stable release:

```
npm version <major|minor|patch>
git push --follow-tags
```

To cut a beta release, no commit is needed — just tag and push:

```
git tag <version>-beta.<n>
git push origin <version>-beta.<n>
```

(`git tag -l '*-beta*' --sort=-v:refname` shows the last beta tag, to pick the next `<n>`.)

To promote a beta that's already been tested to a full release, bump `manifest.json` to
that (or a newer) version with `npm version` as above and tag/push as usual — the same tag
can't be reused for two different releases, so promoting a beta means cutting a new stable
tag on top of it rather than editing the old pre-release in place.
