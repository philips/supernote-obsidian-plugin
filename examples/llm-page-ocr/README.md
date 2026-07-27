# LLM Page OCR (example)

Reference implementation of a companion plugin against the Supernote plugin's
`registerPageTextProcessor` hook (`src/main.ts`). Demonstrates plugging any
local, OpenAI-compatible model server — Jan.ai, LM Studio, Ollama, llama.cpp
server, vLLM, etc. — into note conversion to transcribe pages the Supernote's
own on-device handwriting recognition missed or left empty. See
[issue #124](https://github.com/philips/supernote-obsidian-plugin/issues/124).

This is a prototype/example, not a published or supported plugin. See
[RELEASING.md](RELEASING.md) for how versioning/changes to this folder work.

## What it does

For every page of a Supernote export or import that produces page text (this
includes the plain "Export this note as a Markdown file" command, which
doesn't save any images to the vault at all — the Supernote plugin
rasterizes pages in memory on demand whenever a processor is registered,
just to hand them to it), this plugin flattens the page's PNG onto a white
background (the vault's own copy is transparent, by design — see Notes
below — but that confuses some vision backends into reporting a blank/black
page) and sends the result to your local server's `/chat/completions`
endpoint with a vision-capable model, using the response as that page's text
in the generated markdown.

## Setup

1. In your local LLM app (Jan.ai, LM Studio, Ollama, etc.), load a
   **vision-capable** model (e.g. a LLaVA/Moondream/Qwen-VL build — most
   default text-only chat models will silently ignore the image) and start
   its OpenAI-compatible local API server. The default below matches Jan.ai's
   own default port (`http://127.0.0.1:1337/v1`); change it in settings for
   other apps.
2. Copy this folder into `<your vault>/.obsidian/plugins/llm-page-ocr/`
   (folder name doesn't need to match; `manifest.json`'s `id` is what
   matters).
3. Enable both **Supernote (Unofficial)** and **Supernote LLM Page OCR
   (example)** in Obsidian's Community plugins settings.
4. Open this plugin's settings and set **API base URL** and **Model** to
   match your server.
5. Click **Test connection** at the top of this plugin's settings. It
   checks both halves of the pipeline in one click — that it's actually
   registered with the Supernote plugin, and that the server is reachable
   with the configured model loaded — and reports the result as a toast, no
   console or real export needed. Fix whatever it flags before moving on.
6. Run any Supernote export/import that produces page text — "Export this
   note as a Markdown file attachment", "Export this note as a Markdown and
   PNG files as attachments", or "Import new or edited pages by date" with
   the "Images and text" format — and the pages should come back
   transcribed.

## Progress while converting

A sticky notice in the bottom-right tracks the export live — "LLM Page OCR:
page 2/5 — contacting server…", updating in place as each page is skipped,
sent, transcribed, or fails, then flashing "done" and dismissing itself once
the last page finishes. That's the visible sign a slow/large export (or a
slow local model) is still working rather than stuck.

## Troubleshooting

Start with the **Test connection** button in settings — it catches the two
most common issues (not registered with the Supernote plugin; server
unreachable or the configured model not loaded) without digging through the
console.

If pages still come back untranscribed after that passes, open the
developer console (Ctrl/Cmd+Shift+I) and re-run the export — every page logs
`LLM Page OCR: ...` there, either why it was skipped or the request/response
outcome. Note that the actual OCR request goes through Obsidian's
`requestUrl` (needed to reach `127.0.0.1` without CORS issues), which
bypasses the renderer's network stack — it will **not** show up in DevTools'
Network tab even when working correctly, so rely on the console logs there,
not Network.

## Notes

- **Desktop only** (`isDesktopOnly: true`) — it assumes your local server is
  running on the same machine at `127.0.0.1`.
- Rasterized pages are transparent (so the vault's own attachment can invert
  colors in Obsidian's dark mode without a visible box around it). This
  plugin flattens onto white before sending, purely for the outbound
  request — the vault's PNG attachment is never touched.
- "Only fill missing text" (on by default) skips pages the device already
  transcribed via its own recognition, so this only fills gaps rather than
  overwriting text you may have hand-corrected.
- No build step: `main.js` is plain, hand-written CommonJS, loaded by
  Obsidian directly — there's nothing to compile.
- Errors (server unreachable, non-2xx response, empty model name) fail a
  page silently (logged to the console) rather than blocking the export —
  a slow/misconfigured local server shouldn't break note conversion.
