# Supernote internal links: field semantics in practice

`supernote-typescript` exposes Supernote's own internal note-linking feature
(the tappable link tags you can place on a page, e.g. for table-of-contents
style navigation) as `SupernoteX.links: Record<string, ILink[]>`. This
documents what building `SupernoteView`'s clickable link overlay
([main.ts](../src/main.ts), [linkOverlay.ts](../src/linkOverlay.ts)) found
about how that data actually behaves, since some of it doesn't match the
library's own doc comments. Verified against two real notes: this repo's
submodule test fixture (`supernote-typescript/tests/input/nomad-3.26.40-link-tag-3p.note`)
and a second, independently device-created note with two internal links on
different pages.

## What's reliable

- **`LINKRECT`** — `"x,y,w,h"`, the link's clickable region in the page's own
  native pixel coordinate space (same space as `pageWidth`/`pageHeight`).
  Parsed by `parseLinkRect()`.
- **`LINKFILE`** — base64-encoded absolute device path to the target `.note`
  file (e.g. `/storage/emulated/0/Note/Folder/MyNote.note`). The library
  already decodes this into a plain basename via `text`, which is what this
  plugin resolves against the vault rather than decoding `LINKFILE` itself
  (see "Resolution recipe" below).
- **`PAGEID`** — matches `IPage.PAGEID`. For a same-document target, the
  library already resolves this into a `#Page N` suffix on `text`; for a
  cross-file target it doesn't (it can't, without opening the other file), so
  `text` stays a bare basename.
- **`sn.links`' Record key** — its first 4 characters, parsed as an integer,
  are the **1-indexed page the link is physically drawn on**. Not documented
  anywhere we could find, but it's what's actually reliable — see
  "Verification" below. (The remaining characters appear to be the link's own
  `LINKRECT` `y,x,h,w` digits, zero-padded to 4 each, concatenated — cosmetic,
  just enough to make the key unique.)

## What's not reliable

- **`LINKTYPE`** (doc comment: "1 = internal note link") — filtering to
  `LINKTYPE === '1'` drops real, genuine internal links. In the submodule's
  own fixture, 2 of its 3 links have `LINKTYPE: '0'`; the second real note
  checked had `LINKTYPE: '0'` on both of its links. Whatever this field
  actually distinguishes, it isn't "is this a real internal link" — anything
  present in `sn.links` was already resolved as a genuine link by the parser,
  so `bucketLinksByPage()` doesn't filter on it at all.
- **`OBJPAGE`** (doc comment: "0-indexed page number this link appears on")
  — does not match the link's actual source page. See below.

## Verification: why OBJPAGE looked right but wasn't

The submodule's own fixture wasn't enough to catch this: all 3 of its links
share the same `sn.links` key prefix (`0002`), i.e. they're all on the same
page, so both the OBJPAGE-based and key-prefix-based bucketing schemes
happened to look plausible against it in isolation.

A second real note (4 pages, one link on page array-index 0, one on array-index 3)
settled it. Rendered both pages via `toImage()`, drew each link's `LINKRECT`
as a box on every page, and measured ink coverage under each box to find
where each link is *actually* drawn:

| link | `OBJPAGE` | `LINKRECT` | verified source page (array index) | `sn.links` key prefix |
|---|---|---|---|---|
| A | `4` | `672,220,800,87` | `0` (12.8% ink under the box) | `0001` |
| B | `1` | `564,500,791,87` | `3` (12.7% ink under the box) | `0004` |

`OBJPAGE` doesn't match the verified page under any indexing convention —
`4` and `1` aren't `0` and `3` whether you read them as 0- or 1-indexed. The
key prefix matches exactly (`1` → index `0`, `4` → index `3`). Best guess:
`OBJPAGE` tracks something closer to the page's own template/display label,
which can drift from its current position in the `pages` array (e.g. after
page reordering) — unconfirmed, filed as
[philips/supernote-typescript#32](https://github.com/philips/supernote-typescript/issues/32).

**Takeaway for future changes here**: don't trust a single fixture (or a
field's doc comment) for page-bucketing logic like this — a fixture where
every link happens to land on one page can't distinguish between a correct
and an incorrect theory. Cross-check against a note with links on more than
one page, ideally by rendering and measuring pixel content the way this was
verified, not just by checking that bucketed indices are merely in-bounds.

## Resolution recipe (as implemented)

1. **Bucket by source page**: `bucketLinksByPage(sn.links)` — keys by the
   `sn.links` Record key's page-prefix convention above.
2. **Resolve target, same-file vs cross-file**: `handleLinkClick()` in
   `main.ts` compares `link.text`'s basename against the currently open
   file's basename (matching `VaultWriter.resolvePageAnchor()`'s export-time
   resolution, from PR #122, so a link resolves to the same note whether
   you're viewing it live or exporting it).
   - **Same-file**: match `link.PAGEID` against this file's own
     `sn.pages.map(p => p.PAGEID)` to get a page number, then jump in place.
   - **Cross-file**: find a vault `.note` file with a matching basename
     (ambiguous if two vault notes share a basename in different folders —
     an accepted, known limitation, same one PR #122 already has). Load and
     parse it, match `PAGEID` against *its* `pages` array to get a target
     page number, then open it via the existing `#page=N` ephemeral-state
     anchor — the same mechanism a regular `[[note#page=N]]` link already
     uses.

This deliberately doesn't decode `LINKFILE` itself for resolution — matching
by basename (already decoded into `text` by the library) is simpler and
works regardless of whether the note was synced from a device or imported
some other way. If you do need the raw device path (e.g. to cross-reference
against device-sync's `deviceUriToVaultPath()`), note that `LINKFILE` decodes
to a full Android filesystem path (`/storage/emulated/0/Note/...`), not the
browser-relative form (`/Note/...`) that `SupernoteFile.uri`/device-sync use
— it needs that storage-root prefix stripped first.

## Code pointers

- `src/linkOverlay.ts` — pure bucketing/rect-parsing logic, obsidian-free so
  it's unit tested (including a real-fixture check) in `linkOverlay.test.ts`.
- `src/main.ts` — `SupernoteView.handleLinkClick()`/`positionLinkOverlay()`
  for the actual rendering and click navigation.
- `supernote-typescript/src/parsing.ts` — `_parseLinks()`/`_parseLink()`,
  where `ILink` is built from the raw footer/buffer data.
