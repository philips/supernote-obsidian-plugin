# Building a custom AI/OCR plugin

This plugin exposes an in-process hook, `registerPageTextProcessor`, that
lets a separate Obsidian plugin enrich or replace a page's text before it's
written into generated markdown — most usefully, to run OCR or an LLM
transcription over pages the Supernote device's own on-device handwriting
recognition missed or left empty. Background/design discussion:
[issue #124](https://github.com/philips/supernote-obsidian-plugin/issues/124).

A complete, working reference implementation lives at
[supernote-obsidian-ocr-llm](https://github.com/philips/supernote-obsidian-ocr-llm)
— a companion plugin that sends each page to a local OpenAI-compatible
server (Jan.ai, LM Studio, Ollama, llama.cpp server, etc.). Read this doc
for the contract, then copy patterns from that plugin rather than starting
from nothing.

## Is this stable?

No — deliberately not. There's no formal Obsidian mechanism for one plugin
to depend on another's API, so this follows the same "reach into another
plugin's loaded instance" pattern Templater and Dataview use for their own
APIs. It can change shape across versions of this plugin without a major
version bump or advance notice. Feature-detect it every time (see below)
rather than assuming it exists or won't change.

## When does it run?

A processor is called once per page, for any export or import that produces
page text:

- "Export this note as a Markdown file attachment"
- "Export this note as a Markdown and PNG files as attachments"
- "Import notes edited today" with an "Images and text" format

Notably, the first of those doesn't otherwise rasterize or save any images —
the Supernote plugin rasterizes pages in memory on demand *specifically*
because a processor is registered, purely to hand it an image, without
writing an attachment to the vault. If nothing is registered, that export
stays text-only and skips rasterization entirely, so registering a processor
you don't need has a real (if page-count-bounded) cost.

Formats with no per-page text output at all — "Note link", "Embedded note",
"PDF" — never call processors; there's nowhere in their output for a
processor's result to go.

## Registering

```js
const SUPERNOTE_PLUGIN_ID = 'supernote';

class MyOcrPlugin extends Plugin {
	async onload() {
		this.registerWithSupernote();
	}

	// `workspace.onLayoutReady()` fires once, the first time layout finishes
	// restoring after app startup — it does NOT mean "every enabled plugin
	// has finished loading," and it's a no-op (fires immediately) if you
	// call it after that point, which is exactly what happens when a user
	// enables/reloads your plugin later rather than at Obsidian startup.
	// Retry instead of checking once, so load order between your plugin and
	// the Supernote plugin doesn't matter.
	registerWithSupernote(attempt = 0) {
		const supernote = this.app.plugins.plugins[SUPERNOTE_PLUGIN_ID];
		if (supernote && typeof supernote.registerPageTextProcessor === 'function') {
			this.unregisterProcessor = supernote.registerPageTextProcessor((ctx) => this.processPage(ctx));
			return;
		}
		if (attempt < 20) {
			this.retryTimer = window.setTimeout(() => this.registerWithSupernote(attempt + 1), 500);
		}
	}

	onunload() {
		window.clearTimeout(this.retryTimer);
		this.unregisterProcessor?.();
	}

	async processPage(ctx) {
		// see below
	}
}
```

`registerPageTextProcessor` returns an unregister function — call it from
`onunload()`.

## The context object

Your processor is called as `(ctx) => Promise<string | null | undefined>`
with:

| Field | Type | Meaning |
|---|---|---|
| `pageNumber` | `number` | 1-indexed, matches the `## Page N` headings in the generated markdown |
| `totalPages` | `number` | Total pages in this export/import |
| `sourceName` | `string` | The source `.note` file's name (e.g. `"2026-01-15.note"`). Not necessarily saved into the vault — some import paths rasterize without ever writing the raw `.note` |
| `text` | `string` | This page's text so far: the device's own recognized text, if any, already run through any earlier-registered processors. Empty string if none |
| `imageMimeType` | `string` | MIME type of what `readImage()` resolves to. Currently always `"image/png"` — read it rather than assuming, in case that changes |
| `readImage()` | `() => Promise<ArrayBuffer>` | This page's rasterized image bytes. Raw bytes, not a vault `TFile` — this runs whether or not the export actually wants images saved into the vault, so there may be no `TFile` backing it at all |
| `keywords` | `string[]` | This page's starred keywords, exactly as the device's own recognition read them. Raw OCR'd text, deduplicated — not sanitized into Obsidian tag form; that's a choice for your processor to make. Most starred keywords never appear as literal text elsewhere on the page, so this is the only way to see them at all |
| `links` | `ILink[]` (from `supernote-typescript`) | This page's own internal links (Supernote's link feature). Same-file page anchors are already resolved (`ILink.text` gets `#Page N` appended). Cross-file anchors are not — `ILink.LINKFILE` is the base64-encoded absolute device path of the target `.note` file if you want to resolve that yourself |
| `pageId` | `string` | This page's own `PAGEID`, if any (empty string otherwise) — the identifier other notes' links resolve against |
| `orientation` | `string` | This page's orientation, exactly as recorded in the `.note` file |
| `recognitionStatus` | `RecognitionStatuses` (from `supernote-typescript`) | Whether the device's own handwriting recognition ran on this page, and whether it completed. Distinguishes "never ran" and "ran, found nothing" from `text` alone, which conflates both with "ran and found nothing" |

Pages are processed one at a time, in order — `pageNumber` reliably starts
at 1 and counts up for a given run, with no concurrent calls to interleave.
That's what lets a single, updating progress `Notice` track a whole run (see
the example plugin).

**Return value:** the page's new text, replacing `ctx.text` entirely — fold
in the existing text yourself if you want to keep it rather than overwrite
it. Return `null` or `undefined` to leave the page's text unchanged.
Multiple registered processors run in registration order, each seeing the
previous one's output as `ctx.text` — a pipeline, not a single winner.

A processor throwing is caught and logged by the Supernote plugin (the
export still completes, with that page's text left unchanged) — but don't
rely on that as your only error handling; a caught-and-swallowed exception
still means silent, hard-to-debug failures for whoever's using your plugin.

## Practical guidance

- **Feature-detect, don't assume.** Check
  `typeof supernote.registerPageTextProcessor === 'function'` before calling
  it, and handle it being absent (older Supernote plugin version, or not
  installed) with a clear message rather than throwing.
- **Respect existing text.** Check `ctx.text` before deciding to call out to
  your OCR/LLM backend at all — most users will want device-recognized text
  left alone by default, with your processor only filling gaps. Make this
  configurable, don't hardcode it.
- **Handle the transparency gotcha.** Rasterized pages are transparent (the
  Supernote plugin's own vault attachment relies on that, for its "invert
  colors in dark mode" CSS trick) — composited onto black by some vision
  backends, which then report the page as blank or unreadable. Flatten onto
  white yourself before sending, if you're passing the image to a vision
  model. See `flattenToWhiteBackground()` in the example plugin.
- **Show progress.** A page-by-page OCR/LLM pass over a multi-page note can
  take a while with no other visible feedback that anything is happening. A
  sticky `Notice` (`new Notice(message, 0)`, updated via `.setMessage()`,
  dismissed via `.hide()`) updated per page is enough — see
  `startProgress`/`updateProgress`/`finishProgress` in the example plugin.
- **Fail a page, don't fail the export.** A slow, unreachable, or
  misconfigured backend shouldn't block note conversion — catch errors per
  page, log them, and return `null` (leave the page's text as it was)
  instead of throwing.
- **Add a way to test the connection independent of running a real
  export.** Wiring this into your settings tab as a button (see "Test
  connection" in the example plugin) turns "is this working?" into a single
  click instead of a real export plus a trip through the developer console.

## A note on the developer console

If your processor calls out over the network via Obsidian's `requestUrl`
(the usual choice, since it can reach `127.0.0.1`/LAN addresses without the
CORS restrictions a page's own `fetch` is subject to), those requests will
**not** show up in Chrome DevTools' Network tab, success or failure —
`requestUrl` bypasses the renderer's network stack entirely. Log to the
console (`console.debug`/`console.error`) at the points that matter instead
of expecting Network tab visibility.
