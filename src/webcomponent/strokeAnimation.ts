// Write-on stroke animation — the "Tom Riddle's diary / SwapNote" mode:
// replay a note's handwriting as if someone is writing it, stroke by stroke,
// in the order the pen actually moved.
//
// Built entirely on the same vector-ink decode the vectorInk display setting
// already uses (prepareVectorInkPages): strokes arrive in TOTALPATH record
// order, which is the device's own write order, with each stroke's real
// color, tool, and thickness. Each stroke becomes an SVG element laid over
// the page's background-only raster (the ink layers stripped, the same way
// the vector-ink render path strips them — see rasterize.worker.ts), and a
// StrokeAnimator below walks the per-page timelines with a single
// requestAnimationFrame clock:
//   - centerline strokes: the classic SVG dash-reveal (pathLength="1" +
//     animated stroke-dashoffset), duration proportional to the stroke's
//     own length so short ticks and long flourishes both read as writing
//   - pressure-varying contour fills: a dash-revealed *mask* stroke that
//     follows the record's own centerline, so the filled outline (the
//     device's real pressure-varying shape) is exposed as the pen moves —
//     falling back to a short fade-in only when the record carries no
//     centerline to trace at all
//   - filled Heading rects: a short fade-in at their write position
//
// Z-order vs. time order: the DOM (what covers what) follows
// supernote-typescript's buildVectorInkPrimitives grouping — rects first,
// highlighter passes second, the rest of the ink last, each group in write
// order — so the *finished* page looks exactly like the static vector
// render (a Heading's background behind its label, a highlighter wash
// beneath the ink it crosses). The *timeline* (when each element reveals)
// is pure write order instead, which is the whole point of the effect.
//
// The classification below deliberately mirrors buildVectorInkPrimitives'
// logic stroke-by-stroke (it isn't imported: the submodule only exports it
// pre-flattened, and this module needs each stroke's own index to keep the
// two orders separate). If that function's rules change, change these too.
//
// Prototype-scope, deliberately: no per-stroke pressure/velocity
// modulation (TOTALPATH stores no timestamps, only order), no audio, no
// export. See SupernoteViewerElement.ts's animation-mode integration for
// the toolbar controls (play/pause, replay, speed).
import { SupernoteX, prepareVectorInkPages } from 'supernote-typescript';
import type { IStroke, IStrokePoint, StrokeStyle } from 'supernote-typescript';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Pacing, in real milliseconds and page pixels (native note coordinates —
// a page is 1404–1920px wide, and a typical handwriting stroke measures
// 50–300px of that). Calibrated against the fixture corpus (median stroke
// ~90–110px): at the default speed a median stroke takes ~400ms, which
// reads as deliberate handwriting rather than a dash, and a dense page
// (10k–20k total stroke pixels) plays in roughly 40s–2min at 1×.
export const WRITE_SPEED_PX_PER_SEC = 250;
// Dots and flicks mustn't vanish in a single frame; long flourishes
// (measured up to ~2500px) mustn't hog a minute by themselves.
const MIN_STROKE_MS = 80;
const MAX_STROKE_MS = 1200;
// The pen lifts between strokes. A flat gap (write order has no timing
// data to vary it by) is enough to keep strokes from blurring into each
// other; it lands between strokes, not at the start of the page.
const STROKE_GAP_MS = 30;
const CONTOUR_FADE_MS = 250;
const RECT_FADE_MS = 350;

// Rings shorter than this enclose no area (same constant and reasoning as
// MIN_CONTOUR_RING_POINTS in the submodule's vector-ink.ts).
const MIN_CONTOUR_RING_POINTS = 3;

// Grey level of an `rgb(g,g,g)` ink color — every color parseStrokes
// produces is a grey, so the red channel alone orders them (identical to
// greyLevel in the submodule's vector-ink.ts, re-implemented here rather
// than imported since it isn't part of the package's public API).
function greyLevel(color: string): number {
    return Number(/rgb\((\d+)/.exec(color)?.[1] ?? '0');
}

// Same threshold as the submodule's WHITE_INK_MIN_GREY: at or above this,
// ink is the palette's white — a cover-up, never a highlighter pass.
const WHITE_INK_MIN_GREY = 250;
// Same as the submodule's SAME_GREY_TOLERANCE: how far apart two grey
// levels must sit to count as different shades.
const SAME_GREY_TOLERANCE = 16;

interface StrokeBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

// A stroke's own extent from its sampled centerline or, for a record with
// none, its rendered outline — mirrors strokeBounds in the submodule.
function strokeBounds(stroke: IStroke): StrokeBounds | null {
    const points = stroke.points.length > 0 ? stroke.points : (stroke.contour ?? []).flat();
    if (points.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
    }
    return { minX, maxX, minY, maxY };
}

// Mirrors boundsOverlap in the submodule.
function boundsOverlap(a: StrokeBounds, b: StrokeBounds): boolean {
    return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

// Mirrors isHighlighterPass in the submodule (same darkness rule, same
// "only ink recorded before this stroke counts"): a marker stroke that
// crosses ink at least as dark as itself is a wash the device paints
// *beneath* that ink, and needs to sit beneath it here too — in the DOM,
// not in the timeline (it still reveals at its own write position).
function isHighlighterPass(
    index: number,
    boundsList: (StrokeBounds | null)[],
    greys: number[],
    drawable: boolean[],
): boolean {
    const bounds = boundsList[index];
    if (!bounds) return false;
    const grey = greys[index];
    if (grey >= WHITE_INK_MIN_GREY) return false;
    for (let i = 0; i < index; i++) {
        const other = boundsList[i];
        if (!other || !drawable[i]) continue;
        if (greys[i] + SAME_GREY_TOLERANCE >= grey) continue;
        if (boundsOverlap(bounds, other)) return true;
    }
    return false;
}

function polylineLength(points: IStrokePoint[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return total;
}

// Mask ids must be unique *document-wide* (inline SVGs share the document's
// id namespace, and a note's pages all live in one document).
let contourMaskCounter = 0;

// Twice the largest distance from any ring point to the nearest centerline
// point, plus a little slack — the width a mask stroke needs so that
// sweeping it along the centerline fully exposes the ring everywhere, its
// terminal caps included. The centerline is subsampled to at most
// MAX_MASK_SAMPLES points first: the distance to the nearest *sample* is
// always at least the distance to the nearest true point, so the result is
// a safe overestimate (a slightly fatter mask) at O(rings × samples) cost.
const MAX_MASK_SAMPLES = 500;
function maskWidthForRings(rings: IStrokePoint[][], centerline: IStrokePoint[]): number {
    const step = Math.max(1, Math.ceil(centerline.length / MAX_MASK_SAMPLES));
    const samples: IStrokePoint[] = [];
    for (let i = 0; i < centerline.length; i += step) samples.push(centerline[i]);
    let maxSq = 0;
    for (const ring of rings) {
        for (const point of ring) {
            // Width is derived from this point's *nearest* sampled
            // centerline point, then maximized across the ring. Taking the
            // farthest point instead would make a long stroke's mask span
            // most of the page, exposing unrelated-looking ink as soon as
            // even a tiny dash segment became visible.
            let nearestSq = Infinity;
            for (const sample of samples) {
                const dx = point.x - sample.x;
                const dy = point.y - sample.y;
                nearestSq = Math.min(nearestSq, dx * dx + dy * dy);
            }
            maxSq = Math.max(maxSq, nearestSq);
        }
    }
    return Math.sqrt(maxSq) * 2 + 2;
}

// `M x,y L x,y ...` — the same path data renderPrimitiveToSvg in the
// submodule's svg.ts emits for a strokedPath, so the animated strokes are
// geometrically identical to the static vector-ink render.
function pointsToPath(points: IStrokePoint[]): string {
    return points.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

// One closed ring per contour polygon, closed with Z — same as
// renderPrimitiveToSvg's filledPath branch.
function ringsToPath(rings: IStrokePoint[][]): string {
    return rings
        .map((ring) => ring.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ') + ' Z')
        .join(' ');
}

// Hatch pattern ids must be unique *document-wide* (inline SVGs share the
// document's id namespace, and a note's pages all live in one document),
// so these come from a module-level counter, not a fixed string.
let hatchPatternCounter = 0;

// A 'rect' stroke with fill: 'hatch' — Heading backgrounds the device
// renders as diagonal hatching, not a solid block (see the submodule's
// buildHatchPatternDef for the source of these exact values). Returns the
// pattern's unique id so the rect can reference it with fill: url(#id).
function buildHatchPattern(color: string): { defs: SVGElement; id: string } {
    const id = `supernote-viewer-hatch-${++hatchPatternCounter}`;
    const pattern = document.createElementNS(SVG_NS, 'pattern');
    pattern.setAttribute('id', id);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '10');
    pattern.setAttribute('height', '10');
    pattern.setAttribute('patternTransform', 'rotate(45)');
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', '10');
    bg.setAttribute('height', '10');
    bg.setAttribute('fill', 'white');
    pattern.appendChild(bg);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '10');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '5');
    pattern.appendChild(line);
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.appendChild(pattern);
    return { defs, id };
}

// How this stroke reveals. 'draw' = dash-reveal along a path — its own for
// a centerline stroke, the mask's for a masked contour (see
// StrokeSegment.revealEl); 'fade' = opacity-in (Heading rects and
// centerline-less contour silhouettes).
export type StrokeSegmentKind = 'draw' | 'fade';

export interface StrokeSegment {
    el: SVGElement;
    // The element the animator actually drives, when that isn't the
    // visible one: a masked contour's dash reveal lives on its mask's
    // stroke, while el is the filled path that gets exposed by it.
    revealEl?: SVGElement;
    kind: StrokeSegmentKind;
    // Page-local timeline offsets — the StrokeAnimator below stitches
    // pages' segments into one global timeline in page order.
    start: number;
    duration: number;
}

export interface PageStrokeAnimation {
    pageNumber: number;
    // One <svg> per page, viewBox in native page pixels. Sized by the
    // host (position: absolute, inset: 0, 100%/100% over the page image —
    // see the .stroke-animation-svg rule in SupernoteViewerElement.ts);
    // the container's aspect ratio matches the viewBox, so the default
    // preserveAspectRatio is an exact fit.
    svg: SVGSVGElement;
    segments: StrokeSegment[];
    // Sum of this page's own segment times + gaps.
    duration: number;
}

/**
 * Decodes `pageNumber`'s ink and builds its write-on overlay: an SVG with
 * one element per surviving stroke, all hidden, plus the per-stroke
 * timeline. Returns `null` when the page has no decodable strokes
 * (prepareVectorInkPages's useVectorInk says the raster ink should stay as
 * the page's ink source — there's nothing to animate there).
 */
export function buildPageStrokeAnimation(sn: SupernoteX, pageNumber: number): PageStrokeAnimation | null {
    const vip = prepareVectorInkPages(sn, [pageNumber], 1)[0];
    if (!vip || !vip.useVectorInk) return null;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${sn.pageWidth} ${sn.pageHeight}`);
    svg.classList.add('stroke-animation-svg');

    // DOM order — the submodule's grouping, each group in write order:
    // rects (Heading/badge backgrounds) first so the ink written on top of
    // them stays visible even though the rect's own record often comes
    // after it; highlighter passes next, beneath the rest of the ink; the
    // remaining ink last.
    const rects: { el: SVGElement; revealEl?: SVGElement; kind: StrokeSegmentKind; duration: number }[] = [];
    const highlighters: { el: SVGElement; revealEl?: SVGElement; kind: StrokeSegmentKind; duration: number }[] = [];
    const ink: { el: SVGElement; revealEl?: SVGElement; kind: StrokeSegmentKind; duration: number }[] = [];
    // Write order (the strokes' own array order) → element, for the
    // timeline below.
    const byWriteOrder = new Map<number, { el: SVGElement; revealEl?: SVGElement; kind: StrokeSegmentKind; duration: number }>();

    const boundsList = vip.strokes.map(strokeBounds);
    const greys = vip.strokes.map((_, i) => {
        const style = vip.styles[i];
        return style && style.shape !== 'skip' ? greyLevel(style.color) : 0;
    });
    const drawable = vip.strokes.map((_, i) => vip.styles[i]?.shape === 'path');

    vip.strokes.forEach((stroke, i) => {
        const style: StrokeStyle | undefined = vip.styles[i];
        if (!style || style.shape === 'skip') return;

        if (style.shape === 'rect') {
            // Same guard as buildVectorInkPrimitives: two points are
            // opposite corners, and a rect missing either is nothing.
            if (stroke.points.length < 2) return;
            const [p0, p1] = stroke.points;
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', String(Math.min(p0.x, p1.x).toFixed(2)));
            rect.setAttribute('y', String(Math.min(p0.y, p1.y).toFixed(2)));
            rect.setAttribute('width', String(Math.abs(p1.x - p0.x).toFixed(2)));
            rect.setAttribute('height', String(Math.abs(p1.y - p0.y).toFixed(2)));
            if (style.fill === 'hatch') {
                const { defs, id } = buildHatchPattern(style.color);
                svg.appendChild(defs);
                rect.setAttribute('fill', `url(#${id})`);
            } else {
                rect.setAttribute('fill', style.color);
            }
            const entry = { el: rect, kind: 'fade' as const, duration: RECT_FADE_MS };
            rects.push(entry);
            byWriteOrder.set(i, entry);
            return;
        }

        const rings = (stroke.contour ?? []).filter((ring) => ring.length >= MIN_CONTOUR_RING_POINTS);
        if (rings.length > 0) {
            // The device's own rendered outline (pressure-varying width) —
            // a filled region, exposed as the pen moves when the record
            // carries a centerline to trace (masked branch below), or
            // faded in at its write position otherwise.
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', ringsToPath(rings));
            path.setAttribute('fill', style.color);
            const bucket =
                style.tier === 'marker' && isHighlighterPass(i, boundsList, greys, drawable) ? highlighters : ink;
            if (stroke.points.length >= 2) {
                // The record carries its own centerline: instead of fading
                // the filled ring in, expose it with a dash-revealed mask
                // stroke that follows that centerline — the ink appears to
                // be *written* with the device's own pressure-varying
                // outline, and once fully revealed the element is exactly
                // the static render's filled path. The mask stroke is what
                // the animator drives (StrokeSegment.revealEl); the visible
                // path itself never moves.
                const maskId = `supernote-viewer-anim-mask-${++contourMaskCounter}`;
                const mask = document.createElementNS(SVG_NS, 'mask');
                mask.setAttribute('id', maskId);
                // The default mask region is a percentage of the
                // *referencing* element's bbox — a thin ring's box would
                // clip the mask stroke's round caps, so use a full-page
                // user-space region (browsers rasterize only the part the
                // element actually draws).
                mask.setAttribute('maskUnits', 'userSpaceOnUse');
                mask.setAttribute('x', '0');
                mask.setAttribute('y', '0');
                mask.setAttribute('width', String(sn.pageWidth));
                mask.setAttribute('height', String(sn.pageHeight));
                const reveal = document.createElementNS(SVG_NS, 'path');
                reveal.setAttribute('d', pointsToPath(stroke.points));
                reveal.setAttribute('fill', 'none');
                reveal.setAttribute('stroke', 'white');
                reveal.setAttribute('stroke-width', String(maskWidthForRings(rings, stroke.points).toFixed(2)));
                reveal.setAttribute('stroke-linecap', 'round');
                reveal.setAttribute('stroke-linejoin', 'round');
                // Same pathLength=1 normalization as the plain draw path
                // below: one dash value reveals the whole trace without a
                // per-element getTotalLength() measurement.
                reveal.setAttribute('pathLength', '1');
                reveal.style.strokeDasharray = '1';
                reveal.style.strokeDashoffset = '1';
                mask.appendChild(reveal);
                svg.appendChild(mask);
                path.setAttribute('mask', `url(#${maskId})`);
                const length = polylineLength(stroke.points);
                const duration = Math.min(MAX_STROKE_MS, Math.max(MIN_STROKE_MS, (length / WRITE_SPEED_PX_PER_SEC) * 1000));
                const entry = { el: path, revealEl: reveal, kind: 'draw' as const, duration };
                bucket.push(entry);
                byWriteOrder.set(i, entry);
                return;
            }
            // No centerline to trace (e.g. a sticker plugin's silhouette
            // outline) — fall back to a short fade at the write position.
            const entry = { el: path, kind: 'fade' as const, duration: CONTOUR_FADE_MS };
            bucket.push(entry);
            byWriteOrder.set(i, entry);
            return;
        }

        if (stroke.points.length === 0) return;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', pointsToPath(stroke.points));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', style.color);
        path.setAttribute('stroke-width', String(style.width));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        // Normalize every path's length to 1 so one dash value
        // (stroke-dasharray: 1, stroke-dashoffset: 1 → 0) reveals any
        // stroke with no per-element getTotalLength() measurement —
        // and works in test DOMs that don't implement it at all.
        path.setAttribute('pathLength', '1');
        path.style.strokeDasharray = '1';
        path.style.strokeDashoffset = '1';
        const length = polylineLength(stroke.points);
        const duration = Math.min(MAX_STROKE_MS, Math.max(MIN_STROKE_MS, (length / WRITE_SPEED_PX_PER_SEC) * 1000));
        const entry = { el: path, kind: 'draw' as const, duration };
        (style.tier === 'marker' && isHighlighterPass(i, boundsList, greys, drawable) ? highlighters : ink).push(entry);
        byWriteOrder.set(i, entry);
    });

    if (byWriteOrder.size === 0) return null;

    for (const entry of [...rects, ...highlighters, ...ink]) svg.appendChild(entry.el);

    // Timeline: pure write order (the strokes' own array order — Maps
    // iterate in insertion order, so the index-keyed map above is the
    // write-ordered list), each element revealing at the moment the pen
    // made it.
    const segments: StrokeSegment[] = [];
    let t = 0;
    for (const entry of byWriteOrder.values()) {
        if (t > 0) t += STROKE_GAP_MS;
        segments.push({ el: entry.el, revealEl: entry.revealEl, kind: entry.kind, start: t, duration: entry.duration });
        t += entry.duration;
    }

    return { pageNumber, svg, segments, duration: t };
}

interface AnimatorEntry {
    el: SVGElement;
    revealEl?: SVGElement;
    kind: StrokeSegmentKind;
    page: number;
    start: number; // global (across all pages)
    duration: number;
    lastApplied: number;
}

export interface StrokeAnimatorCallbacks {
    // The page (index into the constructor's `pages`) the pen is currently
    // on, fired once per change (the first call reports the first page as
    // soon as playback starts) — for auto-scrolling the active page into
    // view.
    onActivePage?: (page: number) => void;
    // Current global time (ms), once per animation frame — for a
    // time-remaining label.
    onTime?: (timeMs: number) => void;
    onFinish?: () => void;
}

export interface StrokeAnimatorClock {
    now?: () => number;
    requestFrame?: (cb: (t: number) => void) => number;
    cancelFrame?: (id: number) => void;
}

// One global clock over every page's segments, in page order. Deliberately
// tiny: a monotonically-advancing pointer (strokes never overlap, so a
// frame only ever touches the one in-flight segment plus whatever a large
// delta — a seek, a fast-forward, a background tab's coalesced rAF — let
// finish at once), and no per-segment timers.
export class StrokeAnimator {
    readonly totalDuration: number;
    speed = 1;

    private entries: AnimatorEntry[] = [];
    private pointer = 0;
    private time = 0;
    private playing = false;
    private lastActivePage = -1;
    private rafId: number | undefined;
    private lastNow = 0;
    private callbacks: StrokeAnimatorCallbacks;
    private clock: { now: () => number; frame: (cb: (t: number) => void) => number; unframe: (id: number) => void };

    constructor(pages: (PageStrokeAnimation | null)[], callbacks: StrokeAnimatorCallbacks = {}, clock: StrokeAnimatorClock = {}) {
        this.callbacks = callbacks;
        this.clock = {
            now: clock.now ?? (() => performance.now()),
            frame: clock.requestFrame ?? ((cb) => window.requestAnimationFrame(cb)),
            unframe: clock.cancelFrame ?? ((id) => window.cancelAnimationFrame(id)),
        };

        let offset = 0;
        pages.forEach((page, pageIndex) => {
            if (!page) return;
            for (const segment of page.segments) {
                this.entries.push({
                    el: segment.el,
                    revealEl: segment.revealEl,
                    kind: segment.kind,
                    page: pageIndex,
                    start: offset + segment.start,
                    duration: segment.duration,
                    lastApplied: -1,
                });
            }
            offset += page.duration;
        });
        this.totalDuration = offset;

        // Everything starts hidden, regardless of what the host may have
        // left the elements at (lastApplied -1 forces the initial apply).
        for (const entry of this.entries) this.apply(entry, 0);
    }

    get currentTime(): number {
        return this.time;
    }

    get isPlaying(): boolean {
        return this.playing;
    }

    get isFinished(): boolean {
        return this.entries.length > 0 && this.time >= this.totalDuration;
    }

    play(): void {
        if (this.playing || this.entries.length === 0) return;
        if (this.time >= this.totalDuration) this.seek(0);
        this.playing = true;
        this.lastNow = this.clock.now();
        // Report the active page right away (a host auto-scrolls to the
        // first page the moment the pen starts, not on the first frame).
        // The replay-from-end case's seek(0) above already reported its
        // page, so this only fires when the page actually changed.
        this.updateState(this.time, false);
        this.rafId = this.clock.frame(this.frame);
    }

    pause(): void {
        if (!this.playing) return;
        this.playing = false;
        if (this.rafId !== undefined) this.clock.unframe(this.rafId);
    }

    toggle(): void {
        if (this.playing) this.pause();
        else this.play();
    }

    // Jumps to `time` (clamped), applying every segment to its state at
    // that instant — including the ones after it, which must go back to
    // hidden on a backward seek. O(n) attribute writes on a rare,
    // deliberate action, which is fine.
    seek(time: number): void {
        const clamped = Math.max(0, Math.min(time, this.totalDuration));
        let pointer = this.entries.length;
        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            const progress =
                clamped >= entry.start + entry.duration
                    ? 1
                    : clamped <= entry.start
                        ? 0
                        : (clamped - entry.start) / entry.duration;
            this.apply(entry, progress);
            // Strokes never overlap, so at most one is partially in flight;
            // the first such segment is where the frame walk resumes.
            if (pointer === this.entries.length && progress < 1) pointer = i;
        }
        this.pointer = pointer;
        this.lastNow = this.clock.now();
        this.updateState(clamped, false);
    }

    reset(): void {
        this.pause();
        this.seek(0);
    }

    destroy(): void {
        this.pause();
    }

    private frame = (now: number): void => {
        if (!this.playing) return;
        const delta = (now - this.lastNow) * this.speed;
        this.lastNow = now;
        const time = Math.min(this.time + delta, this.totalDuration);
        // updateState() owns the end-of-run transition: it stops playback
        // and fires onFinish when the timeline is exhausted, so this frame
        // handler only decides whether there is a next frame to ask for.
        this.updateState(time, true);
        if (this.playing) this.rafId = this.clock.frame(this.frame);
    };

    // Advances the pointer over everything finished by `time`, applies the
    // one in-flight segment, and fires the page/time callbacks. `playing`
    // only decides whether the end-of-run transition (stop + onFinish) can
    // happen this pass (a seek to the end lands every segment at 1 without
    // claiming "finished" to the UI).
    private updateState(time: number, playing: boolean): void {
        this.time = time;
        for (let i = this.pointer; i < this.entries.length; i++) {
            const entry = this.entries[i];
            if (entry.start >= time) break;
            const progress = Math.min(1, (time - entry.start) / entry.duration);
            this.apply(entry, progress);
            // A still-in-flight stroke keeps the pointer on itself so the
            // next frame re-applies it at its new progress; only finished
            // strokes are left behind, never touched again.
            if (progress < 1) {
                this.pointer = i;
                break;
            }
            this.pointer = i + 1;
        }

        // The pen is "on" the page of the most recent stroke that has
        // started — the in-flight stroke itself (sitting at `pointer`) as
        // well as the last finished one (a stroke finishing mid-gap keeps
        // its page active until the next one begins). Scanning from
        // `pointer` down covers both, and entries before the pointer are
        // finished, so one of them always starts at or before `time`
        // (clamped: `pointer` can be one past the end once everything is
        // finished).
        let active: number | null = null;
        for (let i = Math.min(this.pointer, this.entries.length - 1); i >= 0; i--) {
            if (this.entries[i].start <= time) {
                active = this.entries[i].page;
                break;
            }
        }
        if (active === null) active = this.entries.length > 0 ? this.entries[0].page : -1;
        if (active !== this.lastActivePage) {
            this.lastActivePage = active;
            if (active >= 0) this.callbacks.onActivePage?.(active);
        }

        this.callbacks.onTime?.(time);
        if (playing && time >= this.totalDuration) {
            this.playing = false;
            this.callbacks.onFinish?.();
        }
    }

    private apply(entry: AnimatorEntry, progress: number): void {
        if (progress === entry.lastApplied) return;
        entry.lastApplied = progress;
        const el = entry.revealEl ?? entry.el;
        if (entry.kind === 'draw') el.style.strokeDashoffset = String(1 - progress);
        else el.style.opacity = String(progress);
    }
}
