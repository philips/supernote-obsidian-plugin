# Supernote Obsidian Plugin

I use my Supernote for capturing hand written notes and reading documents.

But, I already use Obsidian for organizing and capturing all of my digital notes.

This plugin enables me (and now you!) to import handwritten notes into Obsidian and view them on a desktop, phone or tablet.

This plugin has five main features:

- 📝 View Supernote `*.note` files in your Obsidian Vault. You can link to these notes from your Markdown notes too `[My Note](example.note)`.

- 🔗 Embed a note inline in another note with `![[example.note]]` (scrollable, with page nav), or just one page with `![[example.note#page=2]]`.

- ➡️  Export Supernote `*.note` files as PNGs and/or markdown files and attach them to your Vault.

- 🧠 Attach all of today's modified Supernote notes and text to the current Obsidian note (great when paired with [daily notes](https://obsidian.md/help/plugins/daily-notes))

- 📺 Copy an image from a Supernote via [screen mirroring](https://support.supernote.com/en_US/organizing-managing/1791924-screen-mirroring) into your current note with the "Insert Supernote mirror image" command ([demo video](https://youtu.be/Ih_NW-z_aLw))

- ⬇️  Download & Upload files directly from your device via the Supernote [Browse & Access](https://support.supernote.com/en_US/Tools-Features/wi-fi-transfer) feature. ([demo video](https://www.youtube.com/watch?v=SEkp395hbBM))

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

## Roadmap / Ideas

- 🔗 Note linking
- 🎛️ Settings panel to control file layout, linking, and more

## Thank You

Thank you to [Tiemen Schuijbroek](https://gitlab.com/Tiemen/supernote) for developing the initial supernote Typescript library I forked.

## FAQ

**Q** Why isn't there a table of contents in the generated Markdown file? 

**A** Because the [Obsidian Outline](https://help.obsidian.md/Plugins/Outline) sidebar accomplishes this same feature.

## Other Helpful Plugins

These are not endorsements but might be useful to pair with this plugin.

- [Mousewheel Image Zoom](https://obsidian.md/plugins?id=mousewheel-image-zoom)
- [Image Toolkit](https://obsidian.md/plugins?id=obsidian-image-toolkit)

## Relevant Resources

- [Obsidian and Supernote by Organizing for Change](https://www.youtube.com/watch?v=2zKD79e-V_U)
- [E-Ink notes in Obsidian / Notion? by Brandon Boswell](https://www.youtube.com/watch?v=kW8I8B-eCRk)
- [Academic HANDWRITTEN notes in OBSIDIAN ft. Supernote by pixel leaves](https://www.youtube.com/watch?v=lzYCPkVnqIM)

## Funding

I personally don't accept funding or donations for this project. However, if you feel inclined, consider donating to the [Signal Foundation](https://signal.org/donate/).

## Developer Notes

- Make sure your NodeJS is at least v16 (`node --version`).
- Clone this repo.
- Setup the deps

```
git submodule init && git submodule update
npm run build
npm install
```

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
`styles.css` attached. [BRAT](https://tfthacker.com/BRAT) and Obsidian's own updater both
fetch `manifest.json` straight from the release assets (not from the repo), so the tag must
exactly match the version in `manifest.json` at that commit — the workflow fails instead of
publishing if it doesn't.

The tag's format decides the release channel:

- A plain `X.Y.Z` tag is published as a full/latest release.
- A tag with a semver pre-release suffix, e.g. `X.Y.Z-beta.1`, is published as a GitHub
  pre-release. Obsidian's updater only ever looks at the "latest" (non-prerelease) release,
  so this is invisible to regular Community Store users; BRAT is what beta testers use to
  pick it up.

To cut a stable release:

```
npm version <major|minor|patch>
git push --follow-tags
```

To cut a beta release:

```
npm version prerelease --preid=beta
git push --follow-tags
```

Running `npm version prerelease --preid=beta` again bumps `3.0.2-beta.0` to
`3.0.2-beta.1`, etc. To promote a beta that's already been tested to a full release, drop
the suffix with `npm version patch` (or `npm version <exact version>` to match the beta
exactly) and tag/push as usual — the same tag can't be reused for two different releases,
so promoting a beta means cutting a new stable tag on top of it rather than editing the old
pre-release in place.
