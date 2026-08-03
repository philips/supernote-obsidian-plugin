# Using `<supernote-viewer>` in your own web app

`<supernote-viewer>` is a standalone custom element that renders a Supernote `.note` file's pages in a
browser — no Obsidian, no plugin install, just a `<script>` tag. See
[issue #183](https://github.com/philips/supernote-obsidian-plugin/issues/183) for the background, and
[`src/webcomponent/SupernoteViewerElement.ts`](src/webcomponent/SupernoteViewerElement.ts) for the actual
implementation this doc describes.

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
[`demo/index.html`](demo/index.html) for a complete working page (it sets `height: 80vh`).

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

## API reference

### Attributes / properties

| Name | Type | Notes |
|---|---|---|
| `src` | attribute, string (URL) | Fetched via `fetch()` - the response needs CORS headers if it's cross-origin. Ignored if `noteData` is also set. |
| `page` | attribute, number (1-indexed) | Normally: jumps to this page once the note has loaded (re-setting it after load jumps again). In `single-page` mode: selects *which* page to build instead (see below) - there's no separate page list to jump within. |
| `single-page` | boolean attribute | Renders only the page selected by `page` (default 1, clamped to the note's actual range) - no toolbar, no other pages built or loaded at all. For "this page only" use cases (a deep link to one page, a thumbnail-style preview) rather than a scrollable multi-page viewer. |
| `invert-dark` | boolean attribute | Tags every page image so it's colour-inverted (`filter: invert(1)`) whenever this element is actually in dark mode (see `dark` below) - the attribute alone doesn't force inversion, matching the two-part "setting + actual theme" condition the Obsidian plugin's own equivalent setting uses. Useful for handwriting scanned on a white background that would otherwise look like a bright rectangle in an otherwise-dark page. |
| `dark` | boolean attribute | Explicitly declares this element as being in a dark environment right now, overriding its own default guess (the OS-level `prefers-color-scheme: dark` media feature). Affects both its own default colours (border/background/text) and `invert-dark`'s filter. Only needed if your page's actual dark/light state doesn't reliably track the OS setting - which is exactly why Obsidian's `SupernoteEmbed` sets it directly from Obsidian's own theme rather than relying on the OS guess, since the two are set independently and frequently don't match. Pure CSS attribute selector - no rebuild needed to toggle it. |
| `bare` | boolean attribute | Drops this element's own border/background/rounded corners - pure CSS, takes effect immediately, no rebuild. For embedding inside a host page/component that already provides its own frame around it (this is what Obsidian's `SupernoteEmbed` sets, since its container already has a border). |
| `.noteData` | property, `ArrayBuffer \| Uint8Array \| null` | Set the file's bytes directly. JS-only - there's no string form of this, so it can't be set as an HTML attribute (see the framework note below). |

Setting `src`/`page`/`noteData`/`single-page`/`invert-dark` after the element is already showing a note
tears down and rebuilds the whole thing from scratch (a fresh fetch if using `src`) - there's no in-place
diffing. `dark` and `bare` are the exception: both are applied via plain CSS attribute selectors
internally, so toggling either live just restyles the existing content, no rebuild.

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

- **Read-only.** No save/export/download UI - see issue #183 for why (needs a browser-native Blob/download
  story, not built yet).
- **No selectable/searchable image text layer.** The recognized-text toggle shows the note's recognized
  text as plain reflowed text (selectable, copyable), not an invisible overlay positioned over the
  handwriting image the way the Obsidian plugin's full view does - that needs pdf.js, which isn't part of
  this bundle.
- **No built-in loading skeleton beyond a text status message** ("Loading…") while a note is being
  fetched/parsed.
