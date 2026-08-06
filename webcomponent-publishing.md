# Publishing `<supernote-viewer>` for others to depend on

This covers how to actually ship the standalone web component (see
[`webcomponent-usage.md`](webcomponent-usage.md) for how consumers use it once it's out there) somewhere
people can depend on with a stable URL/version. Background: [issue #183](https://github.com/philips/supernote-obsidian-plugin/issues/183).

Written against `<supernote-viewer>`, but the same steps apply unchanged to its `.spd` sibling
`<supernote-atelier-viewer>` (`npm run build:atelier-webcomponent`, writing
`dist/supernote-atelier-viewer.js`) - treat it as its own separately-versioned package under its own name
(e.g. `supernote-atelier-viewer`), published independently of `<supernote-viewer>`'s own version, following
the same steps below with that name/output substituted in.

## Nothing is published yet - don't point production code at the demo

Today, the only two things that exist are:

- `npm run build:webcomponent`, which writes `dist/supernote-viewer.js` locally (gitignored, never
  committed - same policy as `main.js`).
- [philips/supernote-web-component](https://github.com/philips/supernote-web-component), a GitHub Pages
  demo whose [deploy workflow](https://github.com/philips/supernote-web-component/blob/main/.github/workflows/deploy.yml)
  rebuilds from a specific git ref of this repo (currently a feature branch, eventually `main`) every time
  it's manually triggered.

Neither of those is a published artifact with a version number - the demo in particular is built to
*intentionally* track a moving ref, so its exact contents can change (or the workflow re-run and briefly
break) at any time with no notice. It's fine to link to as a live demo; it is **not** fine for anyone to
`<script src="https://philips.github.io/supernote-web-component/supernote-viewer.js">` from their own app
and expect stability. If that starts happening, it's a sign this doc's advice below is overdue.

## Recommended: publish to npm

This is the path that gets consumers both `npm install` (for bundler-based apps) and, for free, CDN URLs
via jsDelivr/unpkg (both mirror the npm registry directly, no separate upload step) for plain `<script>`
tag use - see the usage doc's "Getting it into your page" section.

1. **Pick a name and check it's free.** `supernote-viewer` was unclaimed on the npm registry as of this
   writing (`npm view supernote-viewer` returns 404) - a scoped name like `@philips/supernote-viewer` is
   the safer bet long-term (doesn't depend on an unscoped name staying free, and scopes are cheap to
   create), but either works.

2. **Give the published package its own `package.json`, separate from this repo's root one** (which
   describes the Obsidian plugin, not this component - different `main`, different consumers, different
   release cadence). The simplest way: generate it at build time right into `dist/`, next to the bundle,
   rather than hand-maintaining a second `package.json` in the repo that could drift out of sync with the
   real build. Something like:

   ```json
   {
     "name": "supernote-viewer",
     "version": "0.1.0",
     "description": "Standalone <supernote-viewer> web component for rendering Supernote .note files in a browser",
     "type": "module",
     "main": "supernote-viewer.js",
     "files": ["supernote-viewer.js"],
     "repository": "github:philips/supernote-obsidian-plugin",
     "license": "MIT"
   }
   ```

   Add a step to `esbuild.webcomponent.config.mjs` (or a small wrapper script) that writes this file into
   `dist/` alongside the bundle, with `version` coming from wherever you're tracking it (see versioning
   below) - not committed to the repo, generated same as the bundle itself.

3. **Publish from the build output directory, not the repo root** - this is what actually keeps
   `node_modules`, source, tests, and the plugin's own devDependencies out of the published tarball:

   ```
   npm run build:webcomponent
   cd dist
   npm publish --access public   # omit --access public for a private scoped package
   ```

4. **Tag the release in git** (`git tag supernote-viewer-v0.1.0 && git push --tags`) so the exact source
   that produced a given published version is always findable later - use a prefixed tag name like this
   rather than a bare `vX.Y.Z`, since this repo's own plugin releases likely already use bare version tags
   for the Obsidian plugin itself (check `versions.json`/existing tags before picking a scheme, to avoid
   colliding with those).

Once published, consumers get:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/supernote-viewer@0.1.0/supernote-viewer.js"></script>
```

or

```
npm install supernote-viewer
```
```js
import 'supernote-viewer';
```

## Alternative: GitHub Releases only, no npm account needed

If npm publishing (registry account, 2FA, ongoing ownership) isn't worth it yet, a lighter option:

1. `npm run build:webcomponent`
2. `gh release create supernote-viewer-v0.1.0 dist/supernote-viewer.js --title "supernote-viewer v0.1.0"`

Consumers then load a specific version via the release asset's stable URL:

```html
<script type="module"
  src="https://github.com/philips/supernote-obsidian-plugin/releases/download/supernote-viewer-v0.1.0/supernote-viewer.js">
</script>
```

This skips jsDelivr/unpkg's CDN caching and npm's `npm install` ergonomics, but is a real, versioned,
stable URL with zero extra infrastructure - a reasonable first step before committing to the npm path
above.

(jsDelivr can also serve files straight from a GitHub tag without any of this, e.g.
`cdn.jsdelivr.net/gh/user/repo@tag/path/to/file.js` - but only for a tagged path that actually exists in
git, and `dist/` is deliberately gitignored, so that specific shortcut doesn't apply here without either
un-ignoring the built file for tagged commits or committing the build output some other way. Not
recommended - it reintroduces exactly the "committed build artifact" problem `main.js` already avoids.)

## Versioning

Treat this as its own package with its own version number, independent of the Obsidian plugin's version in
`manifest.json` - they're different consumable artifacts with different audiences and different rates of
change. Suggested policy:

- Start at `0.x` while the API in `webcomponent-usage.md` is still explicitly marked experimental - a
  `0.x` version signals to consumers that breaking changes can happen on a minor bump, which is honest
  about where this actually is right now.
- Move to `1.0.0` once you're willing to commit to the attribute/property/event names in the usage doc not
  changing without a major version bump.
- Bump on every published change, even small ones - nothing else enforces that a given npm/CDN version tag
  actually matches what's live, so treat the tag as the source of truth once cut.

## Before publishing any given version

There's no automated end-to-end/browser test suite for this yet (the vitest suite uses happy-dom, which
has no real layout engine or Worker - see the test files' own header comments). Manually confirm a build
actually works in a real browser before publishing it:

1. `npm run build:webcomponent`
2. Serve `dist/` plus `demo/index.html` locally (`npx serve .` from the repo root, then open `/demo/`) and
   load a real `.note` file through the file picker.
3. Confirm pages actually rasterize (not just that the element mounts without erroring) and that the
   `supernote-load`/`supernote-error` events fire as expected.

This is exactly what was done manually (via a throwaway Playwright script, not part of the repo) before
[PR #185](https://github.com/philips/supernote-obsidian-plugin/pull/185) shipped and before
https://philips.github.io/supernote-web-component/ went live - repeat that level of check before cutting a
real published version, since a broken publish is a lot more consequential than a broken demo.

## Later: automate it

Once the process above has been done manually at least once, a natural follow-up is a GitHub Actions
workflow triggered on pushing a `supernote-viewer-v*` tag that runs the build, the manual-check steps above
(as real Playwright tests instead of a throwaway script), and `npm publish` using an `NPM_TOKEN` repo
secret - not set up yet, and not worth building before the manual process has been exercised for real at
least once.
