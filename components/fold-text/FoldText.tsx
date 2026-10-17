'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import './FoldText.css';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export type FoldHinge = 'top' | 'bottom' | 'left' | 'right';
export type FoldStyle = 'paper' | 'blinds' | 'flip';
export type FoldSplit = 'char' | 'word' | 'line';
export type FoldTrigger = 'mount' | 'scroll' | 'hover' | 'loop';

const HINGES: Record<FoldHinge, { origin: string; axis: 'rotateX' | 'rotateY'; sign: number }> = {
  top: { origin: '50% 0%', axis: 'rotateX', sign: -1 },
  bottom: { origin: '50% 100%', axis: 'rotateX', sign: 1 },
  left: { origin: '0% 50%', axis: 'rotateY', sign: 1 },
  right: { origin: '100% 50%', axis: 'rotateY', sign: -1 },
};

const SLATS: Record<'rotateX' | 'rotateY', { origins: string[]; clips: string[] }> = {
  rotateX: {
    origins: ['50% 25%', '50% 75%'],
    clips: ['inset(-40% -20% 50% -20%)', 'inset(50% -20% -40% -20%)'],
  },
  rotateY: {
    origins: ['25% 50%', '75% 50%'],
    clips: ['inset(-40% 50% -40% -20%)', 'inset(-40% -20% -40% 50%)'],
  },
};

const FOLD_STYLES: FoldStyle[] = ['paper', 'blinds', 'flip'];
/** The second blind lags the first by this fraction of the fold. */
const SLAT_DELAY = 0.24;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/* The four curves this component needs, written out rather than pulled in.
   The whole animation library is 70kB for what amounts to four polynomials and
   one requestAnimationFrame loop, and the timing here is already computed by
   hand — there was nothing left for it to drive. */
type Ease = (t: number) => number;

const EASES: Record<string, Ease> = {
  none: (t) => t,
  linear: (t) => t,
  'power1.in': (t) => t * t,
  'power1.out': (t) => 1 - (1 - t) ** 2,
  'power1.inOut': (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  'power2.in': (t) => t ** 3,
  'power2.out': (t) => 1 - (1 - t) ** 3,
  'power2.inOut': (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  'power3.in': (t) => t ** 4,
  'power3.out': (t) => 1 - (1 - t) ** 4,
  'power3.inOut': (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  'power4.out': (t) => 1 - (1 - t) ** 5,
  back: (t) => t * t * (2.7 * t - 1.7),
};

const easeOf = (name: string, fallback: string): Ease => EASES[name] ?? EASES[fallback] ?? EASES['power3.out'];

/** A character mid-fold: how far it has unfolded, and how far it is folding back. */
type Piece = {
  element: HTMLElement;
  parts: HTMLElement[];
  t: number;
  f: number;
  r: number;
  aim: number;
};

export type FoldTextProps = {
  text?: string;
  splitBy?: FoldSplit;
  hinge?: FoldHinge;
  foldStyle?: FoldStyle;
  duration?: number;
  stagger?: number;
  staggerFrom?: string;
  foldAngle?: number;
  ease?: string;
  perspective?: number;
  creaseShading?: number;
  trigger?: FoldTrigger;
  loopDelay?: number;
  hoverRefold?: boolean;
  refoldRadius?: number;
  refoldAngle?: number;
  fontSize?: number | string;
  fontWeight?: number | string;
  color?: string;
  className?: string;
  style?: CSSProperties;
  /* Off for a purely decorative line: the caller handles the accessible
     text, so the same sentence is not announced (or extracted) twice. */
  announce?: boolean;
};

/**
 * Text that unfolds into place, character by character.
 *
 * Each glyph is hinged along one edge and rotated from flat-on to upright with
 * a crease shading on its face, so the word reads as printed on slats rather
 * than as a fade. Three mechanisms, all on the same rig: `paper` hinges the
 * whole glyph, `blinds` splits it into two slats with the second lagging the
 * first, and `flip` turns it a full 180° through a lift.
 *
 * There is a real text node next to the animated one — the visual half is
 * `aria-hidden`, and everything the user reads is in the plain span. So the
 * sentence is in the served HTML whether or not a script ever runs.
 */
export default function FoldText({
  text = 'Design unfolds',
  splitBy = 'char',
  hinge = 'top',
  foldStyle = 'paper',
  duration = 0.65,
  stagger = 0.045,
  staggerFrom = 'start',
  foldAngle = 92,
  ease = 'power3.out',
  perspective = 700,
  creaseShading = 0.55,
  trigger = 'mount',
  loopDelay = 1.4,
  hoverRefold = false,
  refoldRadius = 140,
  refoldAngle = 45,
  fontSize = 80,
  fontWeight = 800,
  color = 'currentColor',
  className = '',
  style = {},
  announce = true,
}: FoldTextProps) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const safeHinge: FoldHinge = HINGES[hinge] ? hinge : 'top';
  const hingeConfig = HINGES[safeHinge];
  const safeStyle: FoldStyle = FOLD_STYLES.includes(foldStyle) ? foldStyle : 'paper';
  const safeCrease = clamp(creaseShading, 0, 1);
  const safeAngle = clamp(foldAngle, 0, 180);
  const safeStagger = Math.max(0, stagger);
  const safeDelay = Math.max(0, loopDelay);
  const safeRadius = Math.max(1, refoldRadius);
  const safeRefold = clamp(refoldAngle, 0, 180);
  const startsFolded = trigger !== 'hover';

  const segments = useMemo(() => {
    const renderPiece = (content: string, key: string, isLine = false): ReactNode => (
      <span className="fold-text-segment" data-fold-split={isLine ? 'line' : undefined} key={key}>
        {safeStyle === 'blinds' ? (
          <span
            className="fold-text-piece"
            data-fold-hinge={safeHinge}
            data-fold-style="blinds"
            style={startsFolded ? { opacity: 0 } : undefined}
          >
            <span className="fold-text-slat" data-fold-text={content}>
              {content}
            </span>
            <span className="fold-text-slat" data-fold-slat="b" data-fold-text={content}>
              {content}
            </span>
          </span>
        ) : (
          <span
            className="fold-text-piece"
            data-fold-hinge={safeHinge}
            data-fold-style={safeStyle}
            data-fold-text={content}
            style={startsFolded ? { opacity: 0 } : undefined}
          >
            {content}
          </span>
        )}
      </span>
    );

    if (splitBy === 'line') {
      return text
        .split('\n')
        .map((line, index) => renderPiece(line || '\u00a0', `line-${index}`, true));
    }

    return text.split(/(\s+)/).flatMap((part, partIndex): ReactNode[] => {
      if (!part) return [];

      if (/^\s+$/.test(part)) {
        return part
          .split('\n')
          .flatMap((spaces, lineIndex) => [
            lineIndex > 0 ? <br key={`br-${partIndex}-${lineIndex}`} /> : null,
            spaces,
          ])
          .filter(Boolean) as ReactNode[];
      }

      if (splitBy === 'word') return [renderPiece(part, `word-${partIndex}`)];

      return [
        <span className="fold-text-word" key={`word-${partIndex}`}>
          {Array.from(part).map((char, charIndex) => renderPiece(char, `char-${partIndex}-${charIndex}`))}
        </span>,
      ];
    });
  }, [text, splitBy, safeHinge, safeStyle, startsFolded]);

  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const elements = Array.from(root.querySelectorAll<HTMLElement>('.fold-text-piece'));
    if (!elements.length) return undefined;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const { axis, sign, origin } = hingeConfig;
    const slats = SLATS[axis];
    const unfoldEase = easeOf(reduceMotion ? 'power1.out' : ease, 'power3.out');
    const foldEase = easeOf(reduceMotion ? 'power1.in' : 'power2.in', 'power2.in');
    const angle = reduceMotion ? 0 : safeStyle === 'flip' ? 180 : safeAngle;
    const crease = reduceMotion ? 0 : safeCrease;
    const refold = hoverRefold && !reduceMotion ? safeRefold : 0;
    const lift = safeStyle === 'flip' && !reduceMotion ? 0.45 : 0;
    const unfoldDuration = reduceMotion ? Math.min(duration, 0.22) : duration;
    const staggerEach = reduceMotion ? Math.min(safeStagger, 0.02) : safeStagger;

    const pieces: Piece[] = elements.map((element) => {
      const parts = safeStyle === 'blinds' ? Array.from(element.children as HTMLCollectionOf<HTMLElement>) : [element];
      if (safeStyle === 'blinds') {
        element.style.opacity = '1';
        parts.forEach((part, index) => {
          part.style.transformOrigin = slats.origins[index];
          if (index > 0) part.style.clipPath = slats.clips[index];
        });
      } else {
        element.style.transformOrigin = safeStyle === 'flip' ? '50% 50%' : origin;
        element.style.backfaceVisibility = safeStyle === 'flip' ? 'visible' : '';
      }
      return { element, parts, t: startsFolded ? 0 : 1, f: 0, r: 0, aim: 0 };
    });

    const shade = (progress: number, tilt: number) =>
      String(crease * clamp(1 - progress + tilt / 90, 0, 1));

    const render = () => {
      pieces.forEach((piece) => {
        const tilt = piece.r * refold;

        if (safeStyle === 'blinds') {
          let resting = tilt < 0.05;
          piece.parts.forEach((part, index) => {
            const offset = index * SLAT_DELAY;
            const open = unfoldEase(clamp((piece.t - offset) / (1 - SLAT_DELAY), 0, 1));
            const close = foldEase(clamp((piece.f - offset) / (1 - SLAT_DELAY), 0, 1));
            const progress = open * (1 - close);
            if (Math.abs(1 - progress) > 0.002) resting = false;
            part.style.transform = `${axis}(${sign * ((1 - progress) * angle + tilt)}deg)`;
            part.style.opacity = String(clamp(progress, 0, 1));
            part.style.setProperty('--fold-crease', shade(progress, tilt));
          });
          /* While the blinds are shut the second slat is a duplicate of the
             first and would render on top of it. It only exists mid-fold. */
          piece.parts[0].style.clipPath = resting ? 'none' : slats.clips[0];
          piece.parts[1].style.visibility = resting ? 'hidden' : 'visible';
          return;
        }

        const progress = unfoldEase(piece.t) * (1 - foldEase(piece.f));
        const rise = lift * Math.sin(Math.PI * clamp(progress, 0, 1));
        const turn = `${axis}(${sign * ((1 - progress) * angle + tilt)}deg)`;
        piece.element.style.transform = rise > 0.001 ? `translateZ(${rise}em) ${turn}` : turn;
        piece.element.style.opacity = String(clamp(progress, 0, 1));
        piece.element.style.setProperty('--fold-crease', shade(progress, tilt));
      });
    };

    /* ── The scheduler ───────────────────────────────────────────
       One loop drives both halves of the effect: the fold-in timing and the
       pointer-driven refold. They used to be a timeline plus a separate
       ticker, which meant two clocks that had to agree about the same pieces.

       Each piece has a delay derived from its position in the line, so the
       cascade is a spatial ordering rather than a second animation. `t` and
       `f` are raw 0-1 progress; the easing happens in `render`, which is what
       lets one piece be mid-unfold while its neighbour is mid-fold. */
    const total = pieces.length;
    const randomOrder = pieces.map(() => Math.random());

    const orderOf = (index: number) => {
      if (staggerFrom === 'end') return total - 1 - index;
      if (staggerFrom === 'center') return Math.abs(index - (total - 1) / 2);
      if (staggerFrom === 'random') return randomOrder[index] * total;
      return index;
    };

    const delays = pieces.map((_, index) => orderOf(index) * staggerEach);
    const spread = delays.length ? Math.max(...delays) : 0;
    /* A loop repeats from `t`/`f` back at zero, which is the same frame as a
       fully folded piece — so the seam is invisible. */
    const REVEAL_HOLD = 0.35;
    const unfoldSpan = spread + unfoldDuration;
    const foldDuration = unfoldDuration * 0.75;
    const foldStart = unfoldSpan + safeDelay;
    const cycle = foldStart + spread + foldDuration + REVEAL_HOLD;

    let scrollObserver: IntersectionObserver | null = null;
    let raf = 0;
    let animated = false;
    let looped = false;
    let started = 0;
    let lastNow = 0;

    const advance = (now: number) => {
      let elapsed = (now - started) / 1000;

      if (looped && elapsed >= cycle) {
        /* Keep the remainder so a slow frame does not shorten the new cycle. */
        started += cycle * 1000;
        elapsed = (now - started) / 1000;
      }

      pieces.forEach((piece, index) => {
        piece.t = clamp((elapsed - delays[index]) / unfoldDuration, 0, 1);
        if (looped) piece.f = clamp((elapsed - (foldStart + delays[index])) / foldDuration, 0, 1);
      });

      return looped || elapsed < unfoldSpan;
    };

    const tick = (now: number) => {
      raf = 0;
      const step = lastNow ? Math.min(now - lastNow, 64) / 1000 : 0;
      lastNow = now;

      let busy = false;
      if (animated) {
        busy = advance(now);
        if (!busy) animated = false;
      }

      /* Critically-damped-ish chase toward the aim, faster on the way in than
         out, so a pointer sweeping across reads as a wave rather than a
         flicker. */
      let moving = false;
      if (refold) {
        pieces.forEach((piece) => {
          const rate = piece.aim > piece.r ? 14 : 6;
          piece.r += (piece.aim - piece.r) * (1 - Math.exp(-rate * step));
          if (Math.abs(piece.aim - piece.r) > 0.001) moving = true;
          else piece.r = piece.aim;
        });
      }

      render();

      if (busy || moving) {
        raf = requestAnimationFrame(tick);
      } else {
        lastNow = 0;
      }
    };

    const kick = () => {
      if (raf) return;
      lastNow = 0;
      raf = requestAnimationFrame(tick);
    };

    const play = (loop: boolean) => {
      animated = true;
      looped = loop;
      started = performance.now();
      pieces.forEach((piece) => {
        piece.t = 0;
        piece.f = 0;
      });
      kick();
    };

    const handleEnter = () => play(false);

    if (trigger === 'hover') {
      render();
      root.addEventListener('mouseenter', handleEnter);
    } else if (trigger === 'scroll') {
      render();
      /* IntersectionObserver rather than `gsap/ScrollTrigger`: this is one
         one-shot reveal, and the plugin is ~30kB of scroll maths for a single
         "has it arrived yet". The margin puts the trigger about the same
         distance up the viewport as ScrollTrigger's `top 82%`. */
      scrollObserver = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          scrollObserver?.disconnect();
          handleEnter();
        },
        { rootMargin: '0px 0px -18% 0px' },
      );
      scrollObserver.observe(root);
    } else {
      play(trigger === 'loop');
    }

    let pointer: { x: number; y: number } | null = null;
    let centers: { x: number; y: number }[] | null = null;
    let measured: { width: number; height: number } | null = null;

    const measure = (box: DOMRect) => {
      centers = pieces.map((piece) => {
        const rect = piece.element.parentElement!.getBoundingClientRect();
        return { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 };
      });
      measured = { width: box.width, height: box.height };
    };

    const aim = () => {
      const box = root.getBoundingClientRect();
      const near =
        pointer !== null &&
        pointer.x > box.left - safeRadius &&
        pointer.x < box.right + safeRadius &&
        pointer.y > box.top - safeRadius &&
        pointer.y < box.bottom + safeRadius;

      if (
        near &&
        pointer &&
        (!centers || Math.abs(box.width - measured!.width) + Math.abs(box.height - measured!.height) > 1)
      ) {
        measure(box);
      }

      let changed = false;
      pieces.forEach((piece, index) => {
        let value = 0;
        if (near && pointer && centers) {
          const center = centers[index];
          const distance =
            Math.hypot(box.left + center.x - pointer.x, box.top + center.y - pointer.y) / safeRadius;
          if (distance < 1) value = 1 - distance * distance * (3 - 2 * distance);
        }
        if (value !== piece.aim) changed = true;
        piece.aim = value;
      });

      if (changed) kick();
    };

    const handleMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      aim();
    };

    const handleLeave = () => {
      pointer = null;
      aim();
    };

    const handleScroll = () => {
      if (pointer) aim();
    };

    if (refold) {
      window.addEventListener('pointermove', handleMove, { passive: true });
      window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
      document.documentElement.addEventListener('pointerleave', handleLeave);
    }

    return () => {
      root.removeEventListener('mouseenter', handleEnter);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('scroll', handleScroll, { capture: true });
      document.documentElement.removeEventListener('pointerleave', handleLeave);
      cancelAnimationFrame(raf);
      scrollObserver?.disconnect();
    };
  }, [
    segments,
    hingeConfig,
    safeStyle,
    duration,
    safeStagger,
    staggerFrom,
    safeAngle,
    ease,
    safeCrease,
    trigger,
    safeDelay,
    hoverRefold,
    safeRadius,
    safeRefold,
    startsFolded,
  ]);

  const rootStyle = {
    '--fold-text-font-size': typeof fontSize === 'number' ? `${fontSize}px` : fontSize,
    '--fold-text-font-weight': fontWeight,
    '--fold-text-color': color,
    '--fold-perspective': `${Math.max(120, perspective)}px`,
    ...style,
  } as CSSProperties;

  return (
    <span ref={rootRef} className={`fold-text ${className}`.trim()} style={rootStyle}>
      {announce ? <span className="fold-text-sr-only">{text}</span> : null}
      <span className="fold-text-visual" aria-hidden="true">
        {segments}
      </span>
    </span>
  );
}
