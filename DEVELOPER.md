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
