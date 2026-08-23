// @vitest-environment happy-dom
//
// Unit tests for the write-on animation prototype (strokeAnimation.ts):
// the per-page overlay/timeline builder against real fixture notes, and
// the StrokeAnimator driven by an injected fake clock (the exact reason
// its clock is injectable — requestAnimationFrame timing is not
// meaningfully testable under vitest).
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SupernoteX, prepareVectorInkPages } from 'supernote-typescript';
import { buildPageStrokeAnimation, StrokeAnimator } from './strokeAnimation';
import type { StrokeAnimatorClock, StrokeSegment } from './strokeAnimation';

const FIXTURES_DIR = path.join(import.meta.dirname, '..', '..', 'supernote-typescript', 'tests', 'input');

function readFixture(name: string): Uint8Array {
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, name));
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

// The injected clock: tick(dtMs) advances the fake "now" and runs the one
// pending frame callback (the animator schedules exactly one per frame, so
// one outstanding callback at a time is the whole protocol).
function makeFakeClock(): {
    tick: (dtMs: number) => void;
    now: () => number;
    frameQueued: () => boolean;
    options: StrokeAnimatorClock;
} {
    let now = 0;
    let frameCb: ((t: number) => void) | null = null;
    let nextId = 1;
    return {
        tick: (dtMs: number) => {
            now += dtMs;
            const cb = frameCb;
            frameCb = null;
            cb?.(now);
        },
        now: () => now,
        frameQueued: () => frameCb !== null,
        options: {
            now: () => now,
            requestFrame: (cb) => { frameCb = cb; return nextId++; },
            cancelFrame: () => { frameCb = null; },
        },
    };
}

function tag(el: Element): string {
    return el.tagName.toLowerCase();
}

// 0 = fully hidden, 1 = fully revealed — read back off whichever element
// the animator drives for that kind (a masked contour's reveal stroke,
// its own path/element otherwise).
function progressOf(seg: StrokeSegment): number {
    const el = seg.revealEl ?? seg.el;
    return seg.kind === 'draw' ? 1 - parseFloat(el.style.strokeDashoffset) : parseFloat(el.style.opacity);
}

// How many segments this page *should* produce, straight from the decoded
// strokes (the same drawable rules the builder mirrors, applied here
// independently of the builder's own code path).
function expectedSegmentCount(sn: SupernoteX, pageNumber: number): number {
    const vip = prepareVectorInkPages(sn, [pageNumber], 1)[0];
    let count = 0;
    vip.strokes.forEach((stroke, i) => {
        const style = vip.styles[i];
        if (!style || style.shape === 'skip') return;
        if (style.shape === 'rect') {
            if (stroke.points.length >= 2) count++;
            return;
        }
        const rings = (stroke.contour ?? []).filter((ring) => ring.length >= 3);
        if (rings.length > 0 || stroke.points.length > 0) count++;
    });
    return count;
}

describe('buildPageStrokeAnimation', () => {
    it('returns null for a page with no decodable vector ink', () => {
        const sn = new SupernoteX(readFixture('blank-a6x-3.26.40-two-pages.note'));
        expect(buildPageStrokeAnimation(sn, 1)).toBeNull();
        expect(buildPageStrokeAnimation(sn, 2)).toBeNull();
    });

    it('builds one element per surviving stroke, in the static render\'s DOM order but on a write-order timeline', () => {
        // Heading page: 38 filled strokes, then 4 Heading rects (one
        // hatched) written *after* the ink they back — the exact
        // z-order-vs-time-order split this module exists to get right
        // (the finished page must look like the static vector render:
        // rects beneath the ink; the animation must reveal them at their
        // own write position: after the ink).
        const sn = new SupernoteX(readFixture('heading-n5-20260016-backgrounds-marker.note'));
        const anim = buildPageStrokeAnimation(sn, 2);
        expect(anim).not.toBeNull();
        expect(anim!.pageNumber).toBe(2);
        expect(anim!.svg.getAttribute('viewBox')).toBe(`0 0 ${sn.pageWidth} ${sn.pageHeight}`);
        expect(anim!.segments).toHaveLength(expectedSegmentCount(sn, 2));
        expect(anim!.segments).toHaveLength(42);
        // Every element appears exactly once (across both orders).
        expect(new Set(anim!.segments.map((s) => s.el)).size).toBe(42);

        const children = Array.from(anim!.svg.children);
        const rectEls = children.filter((el) => tag(el) === 'rect');
        expect(rectEls).toHaveLength(4);
        // DOM: all 4 rects before any of the 38 fill paths (a <defs> for
        // the hatched rect may precede them - it holds no geometry).
        const firstPathIndex = children.findIndex((el) => tag(el) === 'path');
        for (const rectEl of rectEls) {
            expect(children.indexOf(rectEl)).toBeLessThan(firstPathIndex);
        }
        // The hatched rect references its own unique pattern.
        const hatched = rectEls.find((el) => (el.getAttribute('fill') ?? '').startsWith('url(#'));
        expect(hatched).toBeTruthy();
        const patternId = (hatched!.getAttribute('fill') ?? '').replace(/^url\(#/, '').replace(/\)$/, '');
        expect(anim!.svg.querySelector(`pattern#${patternId}`)).not.toBeNull();

        // Timeline: pure write order — the 4 rects (written last) sit at
        // the *end* of the segment list, the 38 fills before them.
        const segmentTags = anim!.segments.map((s) => tag(s.el));
        expect(segmentTags.slice(0, 38).every((t) => t === 'path')).toBe(true);
        expect(segmentTags.slice(38)).toEqual(['rect', 'rect', 'rect', 'rect']);
    });

    it('lays each page\'s timeline out from t=0, monotonically, with the page duration as the last stroke\'s end', () => {
        const sn = new SupernoteX(readFixture('turkish-a6x-20230015-handwriting-erase.note'));
        const anim = buildPageStrokeAnimation(sn, 1)!;
        expect(anim.segments).toHaveLength(expectedSegmentCount(sn, 1));
        expect(anim.segments[0].start).toBe(0);
        for (let i = 1; i < anim.segments.length; i++) {
            // Each stroke begins after the previous one finished (the pen
            // lift gap is between strokes, not at the page's start).
            expect(anim.segments[i].start).toBeGreaterThan(anim.segments[i - 1].start + anim.segments[i - 1].duration);
        }
        const last = anim.segments[anim.segments.length - 1];
        expect(anim.duration).toBe(last.start + last.duration);
        expect(anim.duration).toBeGreaterThan(0);
    });

    it('uses a cheap centerline preview for contours, then retains their exact final fills', () => {
        const sn = new SupernoteX(readFixture('turkish-a6x-20230015-handwriting-erase.note'));
        const anim = buildPageStrokeAnimation(sn, 1)!;
        const previews = anim.segments.filter((s) => s.swapOnComplete);
        const plainDraws = anim.segments.filter((s) => s.kind === 'draw' && !s.revealEl);
        // This note is mostly pressure-varying contour fills. They get a
        // normal dashed centerline during playback, not an SVG mask.
        expect(previews.length).toBeGreaterThan(0);
        expect(plainDraws.length).toBeGreaterThan(0);
        expect(anim.segments.every((s) => s.kind === 'draw')).toBe(true);
        expect(anim.svg.querySelector('mask')).toBeNull();

        for (const { el, revealEl } of previews) {
            // The initially-hidden element is still the exact static fill.
            expect(tag(el)).toBe('path');
            expect(el.getAttribute('fill')!.startsWith('rgb(')).toBe(true);
            expect(el.getAttribute('d')!.includes('Z')).toBe(true);
            expect(el.getAttribute('mask')).toBeNull();
            expect(el.style.display).toBe('none');
            // Its temporary visible preview is just a cheap dashed path.
            const reveal = revealEl!;
            expect(tag(reveal)).toBe('path');
            expect(reveal.getAttribute('pathLength')).toBe('1');
            expect(reveal.getAttribute('fill')).toBe('none');
            expect(reveal.getAttribute('stroke')).toBe(el.getAttribute('fill'));
            expect(parseFloat(reveal.getAttribute('stroke-width') ?? '')).toBeGreaterThan(0);
            expect(reveal.style.strokeDasharray).toBe('1');
            expect(reveal.style.strokeDashoffset).toBe('1');
            expect(reveal.getAttribute('d')!.startsWith('M')).toBe(true);
            expect(reveal.getAttribute('d')).not.toContain('Z');
        }
        for (const { el } of plainDraws) {
            expect(tag(el)).toBe('path');
            expect(el.getAttribute('pathLength')).toBe('1');
            expect(el.getAttribute('fill')).toBe('none');
            expect(el.getAttribute('stroke')).not.toBeNull();
            expect(el.style.strokeDasharray).toBe('1');
            expect(el.style.strokeDashoffset).toBe('1');
            expect(el.getAttribute('d')!.startsWith('M')).toBe(true);
            expect(el.getAttribute('d')).not.toContain('Z');
        }
    });
});

describe('StrokeAnimator', () => {
    it('starts everything hidden, plays the whole timeline on the injected clock, and finishes', () => {
        const sn = new SupernoteX(readFixture('turkish-a6x-20230015-handwriting-erase.note'));
        const page = buildPageStrokeAnimation(sn, 1)!;
        const clock = makeFakeClock();
        const activePages: number[] = [];
        let finished = 0;
        const animator = new StrokeAnimator([page], {
            onActivePage: (p) => activePages.push(p),
            onFinish: () => { finished++; },
        }, clock.options);

        expect(animator.totalDuration).toBe(page.duration);
        expect(animator.isPlaying).toBe(false);
        expect(animator.currentTime).toBe(0);
        for (const seg of page.segments) expect(progressOf(seg)).toBe(0);
        const contour = page.segments.find((seg) => seg.swapOnComplete)!;
        expect(contour.el.style.display).toBe('none');
        expect(contour.revealEl!.style.display).toBe('');
        expect(activePages).toEqual([]); // nothing has started; no page yet

        animator.play();
        expect(animator.isPlaying).toBe(true);
        expect(clock.frameQueued()).toBe(true);
        // The first animated page is reported as soon as playback starts.
        expect(activePages).toEqual([0]);

        clock.tick(100);
        expect(animator.currentTime).toBe(100);
        expect(finished).toBe(0);

        // One big frame (a seek / fast-forward / coalesced background-tab
        // rAF): everything lands at its end state in a single pass.
        clock.tick(animator.totalDuration + 1000);
        expect(animator.currentTime).toBe(animator.totalDuration);
        expect(animator.isPlaying).toBe(false);
        expect(animator.isFinished).toBe(true);
        expect(finished).toBe(1);
        expect(clock.frameQueued()).toBe(false);
        for (const seg of page.segments) expect(progressOf(seg)).toBe(1);
        expect(contour.el.style.display).toBe('');
        expect(contour.revealEl!.style.display).toBe('none');

        // Playing again from the finished state restarts the whole run.
        animator.play();
        expect(animator.isPlaying).toBe(true);
        expect(animator.currentTime).toBe(0);
        for (const seg of page.segments) expect(progressOf(seg)).toBe(0);
        expect(contour.el.style.display).toBe('none');
        expect(contour.revealEl!.style.display).toBe('');
        animator.pause();
    });

    it('pausing stops the clock; resuming continues from the paused time', () => {
        const sn = new SupernoteX(readFixture('turkish-a6x-20230015-handwriting-erase.note'));
        const page = buildPageStrokeAnimation(sn, 1)!;
        const clock = makeFakeClock();
        const animator = new StrokeAnimator([page], {}, clock.options);

        animator.play();
        clock.tick(100);
        expect(animator.currentTime).toBe(100);
        animator.pause();
        expect(clock.frameQueued()).toBe(false);

        // No frame callback is pending, so advancing the clock does
        // nothing while paused.
        clock.tick(500);
        expect(animator.currentTime).toBe(100);

        animator.play();
        clock.tick(50);
        expect(animator.currentTime).toBe(150);
        animator.pause();
    });

    it('speed multiplies real-time deltas (both faster and slower than 1×)', () => {
        const sn = new SupernoteX(readFixture('turkish-a6x-20230015-handwriting-erase.note'));
        const page = buildPageStrokeAnimation(sn, 1)!;
        const clock = makeFakeClock();
        const animator = new StrokeAnimator([page], {}, clock.options);

        animator.play();
        animator.speed = 2;
        clock.tick(50);
        expect(animator.currentTime).toBe(100);
        animator.speed = 0.5;
        clock.tick(50);
        expect(animator.currentTime).toBe(125);
        animator.pause();
    });

    it('limits visual updates to 30 FPS while retaining elapsed timeline time', () => {
        const sn = new SupernoteX(readFixture('turkish-a6x-20230015-handwriting-erase.note'));
        const page = buildPageStrokeAnimation(sn, 1)!;
        const clock = makeFakeClock();
        const animator = new StrokeAnimator([page], {}, clock.options);

        animator.play();
        clock.tick(20);
        // A 20ms rAF is retained for the next visual update instead of
        // changing an SVG dash offset immediately.
        expect(animator.currentTime).toBe(0);
        expect(clock.frameQueued()).toBe(true);
        clock.tick(14);
        // The following update absorbs all elapsed time; pacing has not
        // slowed, only the number of expensive SVG paints.
        expect(animator.currentTime).toBe(34);
        animator.pause();
    });

    it('seek applies every segment to its state at that instant — and seeking to the end does not claim "finished"', () => {
        const sn = new SupernoteX(readFixture('turkish-a6x-20230015-handwriting-erase.note'));
        const page = buildPageStrokeAnimation(sn, 1)!;
        const clock = makeFakeClock();
        let finished = 0;
        const animator = new StrokeAnimator([page], { onFinish: () => { finished++; } }, clock.options);

        const first = page.segments[0];
        animator.seek(first.duration / 2);
        expect(animator.currentTime).toBeCloseTo(first.duration / 2);
        // A seek while not playing applies the in-flight segment partially
        // and leaves everything after it untouched (still hidden).
        expect(progressOf(first)).toBeCloseTo(0.5, 5);
        expect(progressOf(page.segments[1])).toBe(0);
        expect(finished).toBe(0);

        animator.seek(animator.totalDuration);
        expect(animator.isFinished).toBe(true);
        expect(finished).toBe(0); // a seek lands the end state without firing onFinish
        for (const seg of page.segments) expect(progressOf(seg)).toBe(1);

        // reset() goes back to the blank page and stops.
        animator.reset();
        expect(animator.currentTime).toBe(0);
        expect(animator.isPlaying).toBe(false);
        for (const seg of page.segments) expect(progressOf(seg)).toBe(0);
    });

    it('stitches pages into one timeline in page order, skips null pages, and reports active page changes', () => {
        const sn = new SupernoteX(readFixture('demo-a5x-20230015-1to10.note'));
        const p1 = buildPageStrokeAnimation(sn, 1)!; // 2 strokes
        const p3 = buildPageStrokeAnimation(sn, 3)!; // 1 stroke
        expect(p1.segments).toHaveLength(2);
        expect(p3.segments).toHaveLength(1);

        const clock = makeFakeClock();
        const activePages: number[] = [];
        // Index 1 is a deliberately-null page: it must contribute nothing
        // to the timeline and never be reported as active.
        const animator = new StrokeAnimator([p1, null, p3], {
            onActivePage: (p) => activePages.push(p),
        }, clock.options);
        expect(animator.totalDuration).toBe(p1.duration + p3.duration);

        animator.play();
        clock.tick(1);
        expect(activePages).toEqual([0]);

        // The page-3 stroke starts exactly where page 1's duration ends.
        clock.tick(p1.duration + 1);
        expect(activePages).toEqual([0, 2]);
        expect(progressOf(p3.segments[0])).toBeGreaterThan(0);

        clock.tick(animator.totalDuration + 1000);
        expect(animator.isFinished).toBe(true);
        expect(progressOf(p3.segments[0])).toBe(1);
    });

    it('reports the same active page across a page boundary gap without re-firing', () => {
        const sn = new SupernoteX(readFixture('demo-a5x-20230015-1to10.note'));
        const p1 = buildPageStrokeAnimation(sn, 1)!;
        const clock = makeFakeClock();
        const activePages: number[] = [];
        const animator = new StrokeAnimator([p1], {
            onActivePage: (p) => activePages.push(p),
        }, clock.options);

        animator.play();
        clock.tick(1);
        // Step through the whole page frame by frame: the page can only
        // ever *change* to a different value, so the single page index is
        // reported exactly once no matter how many frames pass.
        for (let i = 0; i < 50; i++) clock.tick(10);
        expect(activePages).toEqual([0]);
        expect(activePages).toHaveLength(1);
    });
});
