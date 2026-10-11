# Raster-overlay worker integration plan

## Goal

Adopt `supernote-typescript` PR #118 (`5a07da8`,
`fix/raster-text-overlay-api`) in the plugin's worker render pipelines. When
vector ink replaces ordinary raster ink, preserve `DISABLE` text-box and Digest
regions as a transparent raster overlay painted **after** the vector paths.

This must apply to every plugin presentation that currently replaces bitmap ink
with vectors:

1. normal on-screen/image-export SVG rendering (`rasterize.worker.ts`),
2. PDF export (`pdfBuild.worker.ts`), and
3. write-on playback, whose background-only renderer currently removes the
   bitmap-only regions altogether.

Pages which remain raster (vector ink disabled or an unsuccessful vector decode)
must retain their existing single-raster rendering unchanged. Do not render or
transfer an overlay for ordinary vector pages with no `DISABLE` data.

## Upstream dependency

- Advance the `supernote-typescript` gitlink to PR #118's merged commit.
- Replace the legacy `buildRenderNoteForVectorInk()` use in worker preparation
  with the public pair:
  - `buildVectorInkBackgroundNote(note, vectorInkPages)` for the raster below
    paths; and
  - `buildRasterInkOverlayNote(note, vectorInkPages)` for text-box/Digest-only
    pixels above paths.
- Keep `prepareVectorInkPages()` on the main thread. Worker slices deliberately
  omit `TOTALPATH` and note titles, so decoding there is invalid.

## Raster/SVG worker path

### `src/render/imageConverter.ts`

1. Generalize the worker-pool input from `SupernoteX` where necessary to the
   structural note type accepted by `extractPageRenderData()`, so it can slice
   the derived background and overlay notes without reconstructing a parsed
   note instance.
2. In `convertToImages(..., vectorInk: true)`, prepare per-page vector data as
   today, derive a background note, and pass that background note to the pool.
   The background helper, unlike the legacy helper, removes even retained
   `DISABLE` pixels from the base image.
3. Detect the small subset of requested vectorized pages whose source `DISABLE`
   field can require a bitmap overlay. Only for that subset, derive the raster
   overlay note and extract matching worker-safe page slices. Preserve both the
   original requested-page order and local chunk indexes so a returned overlay
   cannot be applied to the wrong page.
4. Extend `processPages()`/`processChunk()` and `RasterizeWorkerMessage` with an
   optional overlay payload containing (a) the sliced overlay note and (b) the
   indexes of its pages in the base chunk. This avoids cloning or rasterizing a
   transparent full-page overlay for every normal handwritten page.
5. Retire the worker's hand-written `INK_LAYER_NAMES` mutation for vector
   rendering: the main-thread background note is now the authoritative,
   PR-#118-defined split. The worker rasterizes the supplied base slice; when
   an overlay payload exists, it rasterizes that smaller note once and maps the
   images back to their base-page indexes.
6. For `useVectorInk` pages, pass the base image, strokes/styles, and mapped
   `overlayImage` to `addSvgPage(..., { includeText: false, ... })`. This keeps
   SVG order as background `<image>` → vector paths →
   `data-raster-ink-overlay` `<image>`. Raster fallback pages continue to
   return a PNG data URL.

## PDF worker path

### `src/main.ts`

1. In `buildPdfInWorker()`, derive background slices from
   `buildVectorInkBackgroundNote()` instead of the legacy render note.
2. Build and slice the raster-overlay note only for vectorized `DISABLE` pages.
   Add the overlay pages plus their original global page indexes to the PDF
   worker message, alongside the existing parallel strokes/style arrays.
3. Leave non-vector and vector-disabled exports on their current raster path;
   omit the optional overlay payload when no page needs it.

### `src/pdfBuild.worker.ts`

1. Extend `PdfBuildWorkerMessage` with the optional overlay page slices and
   their global indexes. Define/document that both arrays are parallel.
2. For each bounded assembly batch, select only overlay slices belonging to
   that batch, rasterize them as a compact overlay note, and map their images
   back to the batch's global page indexes.
3. Continue flattening only the opaque background image for `addPdfPage()`.
   Pass the transparent overlay image separately as `overlayImage`; flattening
   it would destroy its alpha and cover the page.
4. Call `addPdfPage()` with its existing vector strokes/styles and the mapped
   overlay. Its established draw order is base raster → vector primitives →
   overlay → invisible recognition text.

## Write-on playback

### Worker/image-converter contract

1. Add a dedicated animation-layer conversion method (or equivalent typed
   result) which returns an ordered `{ backgroundUrl, overlayUrl? }` pair for
   each requested animatable page. Keep the existing simple background-only
   method if other callers require its `string[]` contract.
2. Use the same vector-page preparation and PR-#118 background/filtered-overlay
   note split as static SVG rendering. Mark the base pages `backgroundOnly` so
   the raster worker returns PNG bases instead of constructing static SVGs.
3. Extend `RasterizeWorkerResponse` to return optional overlay data aligned to
   the requested page indexes. It must omit absent overlays rather than return
   a transparent image for every page.

### `src/webcomponent/SupernoteViewerElement.ts`

1. Change the overridable write-on rasterizer hook and its tests to consume the
   background/overlay pairs.
2. Keep the background in the existing page `<img>`, append the animated SVG,
   then append an optional raster-overlay `<img>` above that SVG. Give the
   overlay the same absolute sizing, `pointer-events: none`, and dark-mode
   inversion class behavior as the stroke SVG.
3. Bitmap-only text/Digest content is static rather than time-addressable, so
   show it from playback start. Its position above the SVG preserves the
   device's layering when an animated marker/highlighter passes behind it.
4. Track and remove these overlay elements when switching back to static mode,
   rerendering, or cancelling write-on preparation so the normal lazy image
   lifecycle remains the sole owner in static presentation.

## Tests

Use the upstream `textbox-n5-20260016-digest.note` fixture, especially page 4
(the large text box) and page 5 (Digest rectangles), in addition to the
existing ordinary vector-ink fixture.

1. Update `src/rasterizeVectorInk.test.ts` to replay the new worker contract:
   derive the background and overlay notes, rasterize slices, and pass both to
   `addSvgPage()`. Assert the page vectorizes, contains paths and
   `data-raster-ink-overlay="true"`, and emits the overlay after the paths.
   Retain the vector-off/fallback assertions to prove the ordinary raster path
   did not change.
2. Update `src/pdfBuild.test.ts` to verify derived background slices remove
   vectorizable ink while the overlay slice retains the `DISABLE` region, and
   that worker-bound strokes/styles and overlay indexes stay aligned. Include a
   no-overlay vector fixture assertion so normal pages do not opt into the
   second render.
3. Extend the web-component write-on tests with a fake layer result containing
   an overlay URL. Assert DOM order (base image, animation SVG, overlay image),
   dark-mode tagging, and cleanup after returning to static presentation. Keep
   existing no-overlay assertions working with no extra `<img>`.
4. Run the plugin suite (`npm test`), typecheck/bundles (`npm run build` and
   `npm run build:webcomponent`), and `npm run lint`. Run the submodule suite
   at the pinned commit before recording its gitlink update.
5. Manually inspect the textbox/Digest fixture in normal vector mode, exported
   PDF, and write-on mode: text must remain visible, vector highlighter/ink
   must stay crisp, and the text must sit above any crossing vector path.

## Completion criteria

- The outer repository pins the PR #118 commit.
- Static SVG and PDF workers use the public background/overlay builders, not
  ad-hoc bitmap-layer clearing.
- Overlay work is conditional and index-safe across worker chunks/batches.
- A `DISABLE` text box/Digest survives static vector rendering, PDF export,
  and write-on playback in the correct paint order.
- Existing raster fallback, thumbnail/downsample, and vector-disabled behavior
  remains byte-for-byte/functionally unchanged.
