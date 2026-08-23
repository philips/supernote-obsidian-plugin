# Using `<supernote-viewer>`/`<supernote-atelier-viewer>` in your own web app

This project ships two standalone custom elements — no Obsidian, no plugin install, just a `<script>` tag:

- `<supernote-viewer>` renders a Supernote `.note` file's pages. See
  [issue #183](https://github.com/philips/supernote-obsidian-plugin/issues/183) for the background, and
  [`src/webcomponent/SupernoteViewerElement.ts`](src/webcomponent/SupernoteViewerElement.ts) for the actual
  implementation most of this doc describes.
- `<supernote-atelier-viewer>` renders a Supernote Atelier `.spd` file's layered canvas, with a
  layer-visibility toggle sidebar in place of `.note`'s page-thumbnail one. See
  [`src/webcomponent/SupernoteAtelierViewerElement.ts`](src/webcomponent/SupernoteAtelierViewerElement.ts)
  and its own section near the end of this doc.

Everything below through "Current limitations" describes `<supernote-viewer>`; jump to
["`<supernote-atelier-viewer>`"](#supernote-atelier-viewer) for its `.spd` sibling.

**Is this stable?** No — it's marked experimental for a reason (see the main README). It hasn't shipped a
1.0 yet, and the attribute/property/event names below can still change. Pin an exact version once it's
published (see [`webcomponent-publishing.md`](webcomponent-publishing.md)) rather than tracking `main`.

That said, this isn't just a demo artifact: the plugin's own `![[file.note]]` embed (`SupernoteEmbed` in
`src/main.ts`) is a thin wrapper around this exact element - Obsidian's renderer is a real Chromium/WebView
browsing context, so the same standalone component runs there unmodified. The `single-page`/`invert-dark`/
`bare` attributes below exist specifically because that embed needed them.

## Getting it into your page

Nothing is published anywhere yet (see the publishing doc). Until then, build it yourself and self-host the
result:

```
git clone --recurse-submodules https://github.com/philips/supernote-obsidian-plugin
cd supernote-obsidian-plugin
npm run build:webcomponent   # writes dist/supernote-viewer.js
```

Copy `dist/supernote-viewer.js` into your own project and load it as an ES module — it's only ever built as
ESM, so this needs `type="module"` and needs to be served over http(s), not opened as a `file://` URL:

For a local Chromium smoke test of the standalone component, run the following (once per machine, install
Playwright's browser first with `npx playwright install chromium`):

```
npm run test:webcomponent:playwright
```

It builds the bundle, serves the demo and opens a real `.note` fixture in paused write-on mode.

```html
<script type="module" src="/path/to/supernote-viewer.js"></script>
```

Once it's published (see the publishing doc), this same tag works pointed at a CDN URL instead, or you can
`npm install` it and `import` it into a bundler-based app - the element registers itself
(`customElements.define('supernote-viewer', ...)`) as a side effect of that one import, nothing else to
call.

## Minimal example

```html
<supernote-viewer src="path/to/file.note" style="height: 600px; display: block;"></supernote-viewer>
```

`:host` has no default height - without one set (inline style, a CSS rule, or a flex/grid parent that
gives it one), the element collapses to whatever its content naturally takes up. See
[`demo/index.html`](demo/index.html) for a complete working page (it uses a portrait page aspect ratio with a `100vh` minimum height).

If you have the file's bytes already (a `<input type="file">` picker, a `fetch()` you made yourself, a File
System Access API handle) rather than a fetchable URL, use the `noteData` property instead of `src`:

```html
<supernote-viewer id="viewer"></supernote-viewer>
<input type="file" id="picker" accept=".note">
<script type="module">
    document.getElementById('picker').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        document.getElementById('viewer').noteData = await file.arrayBuffer();
    });
</script>
```

`noteData` takes priority over `src` when both are set.

To open a note blank and let the user start its write-on replay explicitly:

```js
viewer.presentation = 'write-on-paused';
viewer.noteData = bytes;
```

## API reference

### Attributes / properties

| Name | Type | Notes |
|---|---|---|
| `src` | attribute, string (URL) | Fetched via `fetch()` - the response needs CORS headers if it's cross-origin. Ignored if `noteData` is also set. |
| `page` | attribute, number (1-indexed) | Normally: jumps to this page once the note has loaded (re-setting it after load jumps again). In `single-page` mode: selects *which* page to build instead (see below) - there's no separate page list to jump within. |
| `single-page` | boolean attribute | Renders only the page selected by `page` (default 1, clamped to the note's actual range) - no toolbar, no other pages built or loaded at all. For "this page only" use cases (a deep link to one page, a thumbnail-style preview) rather than a scrollable multi-page viewer. |
| `invert-dark` | boolean attribute | Tags every page image so it's colour-inverted (`filter: invert(1)`) whenever this element is actually in dark mode (see `dark` below) - the attribute alone doesn't force inversion, matching the two-part "setting + actual theme" condition the Obsidian plugin's own equivalent setting uses. Useful for handwriting scanned on a white background that would otherwise look like a bright rectangle in an otherwise-dark page. |
| `dark` | tri-state attribute | Overrides this element's own default guess (the OS-level `prefers-color-scheme: dark` media feature) for its default colours (border/background/text) and `invert-dark`'s filter. **Not a plain boolean** - three distinct states: attribute absent entirely → follow the OS-level guess; present with any value other than the string `"false"` (including with no value at all) → force dark; present with value exactly `"false"` → force light. Getting this wrong (treating it as an OR with the OS guess rather than an override) is a real bug this project hit: on a system whose OS-level scheme is dark, a host actually rendering *light* still had its images inverted underneath it. Only needed if your page's actual dark/light state doesn't reliably track the OS setting - which is exactly why Obsidian's `SupernoteEmbed` always explicitly sets `"true"` or `"false"` (never just adds/removes the attribute) from Obsidian's own theme, rather than relying on the OS guess in either direction. Pure CSS attribute selector - no rebuild needed to toggle it. |
| `bare` | boolean attribute | Drops this element's own border/background/rounded corners - pure CSS, takes effect immediately, no rebuild. For embedding inside a host page/component that already provides its own frame around it (this is what Obsidian's `SupernoteEmbed` sets, since its container already has a border). |
| `.noteData` | property, `ArrayBuffer \| Uint8Array \| null` | Set the file's bytes directly. JS-only - there's no string form of this, so it can't be set as an HTML attribute (see the framework note below). |
| `.presentation` | property, `'static' \| 'write-on-paused' \| 'write-on-playing'` | Chooses the page-image renderer. Default `'static'` lazily loads ordinary full-ink PNGs. `'write-on-paused'` opens background-only at `0:00`, with hidden SVG ink until Play; `'write-on-playing'` does the same setup and begins playback. Set it before `src`/`noteData` for the initial renderer or after load to switch. `single-page` deliberately remains static. |

Setting `src`/`page`/`noteData`/`single-page`/`invert-dark` after the element is already showing a note
tears down and rebuilds the whole thing from scratch (a fresh fetch if using `src`) - there's no in-place
diffing. `presentation` is different: changing it transfers the existing page shells between the static
and write-on renderers without reparsing the note. `dark` and `bare` are also live CSS-only changes.

### Methods

| Method | Notes |
|---|---|
| `goToPage(pageNumber: number)` | Scrolls to the given 1-indexed page and forces its image to rasterize immediately, without waiting for it to naturally scroll into view. Clamped to the note's actual page range. No-op before a note has loaded. |

### Events

Both bubble and are `CustomEvent`s (not that bubbling matters unless you're listening on an ancestor rather
than the element itself).

| Event | `detail` | Fires |
|---|---|---|
| `supernote-load` | `{ pageCount: number, pageWidth: number, pageHeight: number }` | Once a note has been fetched and parsed successfully. `pageWidth`/`pageHeight` are the note's native page dimensions (pixels) - handy if a host wants to replicate its own "keep at least one full page visible" sizing without reaching into the component's internals, which is exactly what Obsidian's `SupernoteEmbed` wrapper does with them. |
| `supernote-error` | `{ error: unknown, pageNumber?: number }` | On a fetch/parse failure (no `pageNumber`), or when a specific page fails to rasterize (`pageNumber` set - that one page just stays blank, and will retry the next time it's asked to load). |

```js
viewer.addEventListener('supernote-load', (e) => console.log(`${e.detail.pageCount} pages`));
viewer.addEventListener('supernote-error', (e) => console.error(e.detail.error));
```

## Styling

The element's internal markup lives in a shadow root, so ordinary CSS selectors from your page's own
stylesheet can't reach into it. Two ways to customize it anyway:

**CSS custom properties** (set from outside, inherited in through `:host`):

```css
supernote-viewer {
    --supernote-viewer-border: #888;
    --supernote-viewer-bg: #fafafa;
    --supernote-viewer-fg: #111;
    --supernote-viewer-muted: #777;
}
```

These already have light/dark-aware defaults (via `prefers-color-scheme`) if you don't set them.

**`::part()`** for deeper structural styling:

```css
supernote-viewer::part(toolbar) { /* the page-nav toolbar */ }
supernote-viewer::part(button) { /* every toolbar button */ }
supernote-viewer::part(page-indicator) { /* the "N / M" label */ }
supernote-viewer::part(pages) { /* the scrollable page list */ }
supernote-viewer::part(root) { /* the outermost wrapper */ }
```

## Using it from React, Vue, etc.

Custom elements work in any framework, but `noteData` is a JS property, not an HTML attribute (there's no
string encoding of an `ArrayBuffer`) - so setting it through JSX-style props (`<supernote-viewer noteData={buf}>`)
won't work, since frameworks that don't know about this element's specific properties fall back to setting
plain HTML attributes. Get a ref/element handle and set the property directly instead:

```jsx
const ref = useRef(null);
useEffect(() => {
    if (ref.current) ref.current.noteData = bytes;
}, [bytes]);
return <supernote-viewer ref={ref} />;
```

`src` and `page` are plain strings, so they work fine as regular JSX/template attributes either way.

## Current limitations

- **Browser floor.** The component styles its shadow root with a constructable
  stylesheet (`adoptedStyleSheets`, issue #229), which needs Chrome/Edge 99+ (Jan 2022),
  Firefox 101+ (Aug 2022), or Safari 16.4+ (Mar 2023). Older WebViews (e.g. iOS 16.0–16.3)
  won't render it styled - everything else it relies on (custom elements v1, `ResizeObserver`,
  web workers, ES2020 modules) is older than that, so this is the binding requirement.
- **Read-only.** No save/export/download UI - see issue #183 for why (needs a browser-native Blob/download
  story, not built yet).
- **No selectable/searchable image text layer.** The recognized-text toggle shows the note's recognized
  text as plain reflowed text (selectable, copyable), not an invisible overlay positioned over the
  handwriting image the way the Obsidian plugin's full view does - that needs pdf.js, which isn't part of
  this bundle.
- **No built-in loading skeleton beyond a text status message** ("Loading…") while a note is being
  fetched/parsed.

## `<supernote-atelier-viewer>`

`<supernote-atelier-viewer>` is the `.spd` (Supernote Atelier app) equivalent of everything above -
standalone, no Obsidian dependency, same experimental/unstable status (attribute/property/event names can
still change; pin an exact version once published). Simpler than `<supernote-viewer>` in one respect: a
`.spd` file has no page concept, just layered tiles flattened onto one canvas, so there's no page-jump
toolbar, no find bar, no text mode - and a layer-visibility toggle sidebar where `<supernote-viewer>` has a
page-thumbnail one. Obsidian's own `![[file.spd]]` embed (`SupernoteAtelierEmbed` in `src/atelierView.ts`)
is a thin wrapper around this exact element, the same relationship `SupernoteEmbed` has to
`<supernote-viewer>`.

### Getting it into your page

```
git clone --recurse-submodules https://github.com/philips/supernote-obsidian-plugin
cd supernote-obsidian-plugin
npm run build:atelier-webcomponent   # writes dist/supernote-atelier-viewer.js
```

```html
<script type="module" src="/path/to/supernote-atelier-viewer.js"></script>
```

### Minimal example

```html
<supernote-atelier-viewer src="path/to/file.spd" style="height: 600px; display: block;"></supernote-atelier-viewer>
```

Same `noteData` property (in place of `src`) for bytes you already have in memory - see the `.note`
example above; it applies here unchanged, just with a `.spd` file's bytes instead.

### Attributes / properties

| Name | Type | Notes |
|---|---|---|
| `src` | attribute, string (URL) | Fetched via `fetch()`. Ignored if `noteData` is also set. |
| `invert-dark` | boolean attribute | Same "opt in to inversion, not always invert" contract as `<supernote-viewer>`'s identical attribute - see that entry above. |
| `dark` | tri-state attribute | Same override-not-OR contract as `<supernote-viewer>`'s identical attribute - see that entry above for the full explanation. |
| `bare` | boolean attribute | Drops this element's own border/background/rounded corners, for embedding inside a host that already provides its own frame - this is what `SupernoteAtelierEmbed` sets. |
| `.noteData` | property, `ArrayBuffer \| Uint8Array \| null` | Set the file's bytes directly. JS-only, same reason as `<supernote-viewer>`'s identical property. |

Setting `src`/`noteData`/`invert-dark` after the element is already showing a file tears down and rebuilds
the whole thing from scratch. `dark`/`bare` toggle live via plain CSS attribute selectors, no rebuild.

### Events

| Event | `detail` | Fires |
|---|---|---|
| `supernote-atelier-load` | `{ width: number, height: number, layerCount: number }` | Once a `.spd` file has been fetched and parsed successfully (`width`/`height` are the composited image's native pixel size). |
| `supernote-atelier-error` | `{ error: unknown, recomposite?: boolean }` | On a fetch/parse failure (no `recomposite`), or when a layer-toggle re-composite fails (`recomposite: true` - the image just stays at its last-good state). |

```js
viewer.addEventListener('supernote-atelier-load', (e) => console.log(`${e.detail.width}x${e.detail.height}, ${e.detail.layerCount} layer(s)`));
viewer.addEventListener('supernote-atelier-error', (e) => console.error(e.detail.error));
```

### Styling

Same shadow-root encapsulation as `<supernote-viewer>`, and deliberately the *same* CSS custom property
names (`--supernote-viewer-border`/`-bg`/`-fg`/`-muted`) - reusing them means one set of theme overrides
covers both elements:

```css
supernote-viewer, supernote-atelier-viewer {
    --supernote-viewer-border: #888;
    --supernote-viewer-bg: #fafafa;
    --supernote-viewer-fg: #111;
    --supernote-viewer-muted: #777;
}
```

`::part()` targets: `root`, `toolbar`, `button`, `image-wrapper`, `layer-sidebar`.

### Current limitations

Same as `<supernote-viewer>`'s own list above (read-only, no built-in loading skeleton beyond a text
status), minus the recognized-text item - `.spd` has no recognized/OCR text at all.
