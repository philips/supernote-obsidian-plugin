# Plan — `autoplay="<num>x"` attribute for `<supernote-viewer>`

## Goal

A declarative, HTML-only way to open a note already blanked and replaying its
write-on stroke animation at a chosen speed:

```html
<supernote-viewer src="note.note" autoplay="8x"></supernote-viewer>
```

The existing machinery already covers ~90% of this: the `presentation`
property accepts `'write-on-playing'` (blank pages + immediate playback), and
playback speed is a multiplier (`animSpeedMult`, default 4). The attribute is
just the missing declarative front door for both.

## Attribute contract (deliberately strict)

- Format: `<num>x` — one or more digits, optionally followed by a decimal
  part and more digits, then a lowercase `x`. Nothing else.
  Regex: `/^(\d+(?:\.\d+)?)x$/`
- Accepted examples: `1x`, `4x`, `8x`, `2.5x`, `0.5x`.
- Rejected (attribute treated as absent — no autoplay, no console noise):
  `8` (no `x`), `8X` (capital), `8×` (multiplication sign), ` x8`, `8x `,
  `½x`, `fast`, empty string.
  No trimming, no unicode normalization, no aliases. Parse is one regex;
  anything that doesn't match simply doesn't autoplay.
- Value is clamped to `[0.25, 16]` after parsing (the animator's frame
  stepping is calibrated for roughly this range; `8x` in the example is
  within it).
- Boolean-ish misuse (`autoplay` with no value) does not autoplay — the
  value fails the regex, which is treated as absent. Speed always comes
  from the attribute value; there is no implicit default-speed autoplay.

## Behavior

1. On note load, if `autoplay` parses: initial presentation becomes
   `write-on-playing` and the speed multiplier is the parsed value.
   The user sees blank pages, then handwriting starts immediately at that
   speed — same path as setting both properties in JS today.
2. The attribute sets the **initial** speed multiplier (shown in the
   toolbar speed button). After that the button behaves exactly as today
   — the user can cycle speeds freely during playback.
3. Removing/changing the attribute **after** load does nothing to a run in
   progress — same live-vs-build-time split `src`/`invert-dark` already
   have. It takes effect on the next note load. (Keeps
   `attributeChangedCallback` trivial; no live seeking/speed-racing.)
4. `single-page` mode: ignored, exactly like `presentation` (write-on is a
   multi-page timeline feature; single-page deliberately stays static).
5. Interaction with the `presentation` **property**: last writer wins, and
   there is nothing to race — the attribute is only read once per note
   load (step 4 of implementation below), before any property-driven
   `applyRequestedPresentation()` could have run. A host that sets
   `viewer.presentation = 'static'` before `noteData` overrides the
   attribute; a host that sets nothing gets autoplay. A host that sets
   `presentation` *after* load overrides the already-started playback,
   same as clicking the pen button would.

## Implementation

All changes in `src/webcomponent/SupernoteViewerElement.ts` unless noted.
No changes to `strokeAnimation.ts` — the animator already takes `speed` as
a plain settable field.

1. **Parse helper** (small, near the other anim helpers):
   ```ts
   private static readonly AUTOPLAY_RE = /^(\d+(?:\.\d+)?)x$/;

   /** Parsed `autoplay` attribute: speed multiplier, or null if absent or
    *  not exactly `<num>x` (strict by design — no trimming, no `×`, no
    *  bare numbers). Clamped to [0.25, 16]. */
   private get autoplaySpeed(): number | null {
       const m = SupernoteViewerElement.AUTOPLAY_RE.exec(this.getAttribute('autoplay') ?? '');
       if (!m) return null;
       const speed = Number(m[1]);
       return Math.min(16, Math.max(0.25, speed));
   }
   ```
2. **`observedAttributes`**: add `'autoplay'`. In
   `attributeChangedCallback`, route it with the build-time group
   (`src`/`single-page`/`invert-dark`) → `queueRender()`. Per contract
   item 3 this rebuilds on change; that is the existing semantic of that
   group and keeps the callback one line.
3. **State init in `teardownForRerender()`** (the reset block next to
   `animSpeedMult = 4`): derive from the attribute so a fresh note starts
   clean:
   ```ts
   const autoplay = this.autoplaySpeed;
   this.animSpeedMult = autoplay ?? 4;
   this.requestedPresentation = autoplay !== null ? 'write-on-playing' : 'static';
   ```
   (`activePresentation` is already reset to `'static'` there;
   `requestedPresentation` currently *isn't* reset at all — setting it
   here fixes that latent staleness for everyone, and is exactly where
   the autoplay default wants to live.)
4. **Speed button label**: in `buildToolbar()`'s anim-controls section,
   initialize `animSpeedBtn.textContent` from `this.animSpeedMult`
   (`next < 1 ? '½×' : \`${next}×\`` — same formatting `cycleAnimSpeed()`
   uses, hoisted into a tiny `formatAnimSpeed()` used by both) instead of
   the hardcoded `'4×'`.
5. **No pinning, no guards**: the attribute only ever sets the initial
   multiplier (step 3) and the initial label (step 4). `cycleAnimSpeed()`
   is untouched.
6. **Docs** — `webcomponent-usage.md`: add `autoplay` to the attributes
   table (attribute, string, strict `<num>x`, example, clamping, ignored
   in `single-page`, build-time like `src`), and add the one-line example
   near the `write-on-paused` JS example showing the attribute form.

## Tests (`src/webcomponent/SupernoteViewerElement.test.ts`)

Reuse `createAnimationViewer()` / the write-on describe block's faked
`rasterizeBackgrounds` (its `vi.fn` also lets tests assert the background
path ran).

- `autoplay="8x"` set before `noteData`: after `supernote-load` + one
  timer tick, `el.presentation` is `'write-on-playing'`, the
  stroke-animation SVGs are in the page containers, the pause-glyph
  button is present, and the speed button reads `8×`.
- `autoplay="0.5x"`: speed button reads `½×`, presentation playing.
- Rejected forms (`8`, `8X`, `8×`, `½x`, bare `autoplay`): presentation
  stays `'static'`, no SVG overlay, pen button unpressed.
- Clamping: `autoplay="99x"` → button reads `16×`; `autoplay="0.01x"` →
  `0.25×` equivalent (label formatting for 0.25 reuses `½×`'s branch —
  assert on `animSpeedMult` via the button label `0.25×` or expose
  nothing new; keep to label assertions).
- Cycling still works from an attribute-set start (`8×` → next in
  `ANIM_SPEEDS` from... note: `8` isn't in `ANIM_SPEEDS`;
  `indexOf` → -1 → next is `speeds[0]` = 4 — acceptable, assert `4×`).
- `single-page` + `autoplay="8x"`: static, no toolbar, no SVG.

## Verification

`npm test` (new cases), `npm run lint`, `npm run build`. Visual check
optional via `./scripts/obsidian-headless` — not required: no new render
paths, only wiring into existing ones.

## Non-goals

- No changes to `StrokeAnimator` (speed is already a settable field).
- No live speed updates on attribute change mid-playback.
- No autoplay for the atelier viewer or the Obsidian embed (follow-up if
  ever wanted; the embed has a settings UI of its own).
- No per-attribute speed entry inserted into the cycle list.

---

## Implementation notes (as landed)

Step 3 gained one refinement over the sketch above: a
`presentationSetByHost` flag, set by the `presentation` property's setter
(even on a redundant assignment) and never reset. Autoplay only seeds
`requestedPresentation` while it's false, which is what actually delivers
the contract's "a host that sets `viewer.presentation = 'static'` before
`noteData` overrides the attribute" — plain teardown-derivation would have
let the attribute clobber a pre-set property, since a `'static'`
assignment early-returns in the setter. The speed seed stays
unconditional (`animSpeedMult = autoplay ?? 4`), so a host combining the
property with `autoplay` still gets the attribute's speed. The flag is
deliberately sticky across rebuilds, and the toolbar's pen/play buttons
route through the property, so a user exiting the mode also wins over the
attribute on subsequent loads.

Two smaller deltas:

- `formatAnimSpeed()` renders only exactly `0.5` as `½×`; other sub-1
  values (e.g. clamped `0.25`) print as digits, so a clamped label never
  lies.
- `buildViewer()`'s single-page branch now resets
  `requestedPresentation` to `'static'`, keeping the public
  `presentation` getter truthful when `autoplay` is present.

Files touched: `src/webcomponent/SupernoteViewerElement.ts`,
`src/webcomponent/SupernoteViewerElement.test.ts` (8 new tests),
`webcomponent-usage.md`. `strokeAnimation.ts` untouched, as planned.
