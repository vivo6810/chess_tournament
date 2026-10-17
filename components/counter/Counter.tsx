'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import './Counter.css';

const ROOT = 'counter';
const SR = 'counter__sr';
const ROW = 'counter__row';
const AFFIX = 'counter__affix';
const DIGIT = 'counter__digit';
const SIZER = 'counter__sizer';
const VIEWPORT = 'counter__window';
const STRIP = 'counter__strip';
const NUMERAL = 'counter__numeral';
const SYMBOL = 'counter__symbol';
const SYMBOL_TEXT = 'counter__symbol-text';
const BLUR = 'counter__blur';
const MEASURE = 'counter__measure';

const TAU = Math.PI * 2;
const NUMERIC = new Set(['integer', 'group', 'decimal', 'fraction']);
const DIRECTIONS = ['auto', 'up', 'down', 'shortest'] as const;

export type CounterDirection = (typeof DIRECTIONS)[number];

export type CounterProps = {
  value?: number;
  locale?: string;
  format?: Intl.NumberFormatOptions;
  decimals?: number;
  minDigits?: number;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  direction?: CounterDirection;
  duration?: number;
  bounce?: number;
  stagger?: number;
  motionBlur?: boolean;
  intro?: boolean;
  fade?: number;
  fontSize?: number | string;
  fontWeight?: CSSProperties['fontWeight'];
  textColor?: string;
  gap?: number;
  padding?: number;
  tabular?: boolean;
  digitStyle?: CSSProperties;
  className?: string;
  style?: CSSProperties;
};

/* Edge-to-edge fade for the digit window: the numeral leaving the top and the
   one arriving from the bottom both dissolve instead of being clipped by a
   hard line. Sampled from a smoothstep at each 1/6 step. */
const MASK =
  'linear-gradient(to bottom, rgba(0, 0, 0, 0) 0, rgba(0, 0, 0, 0.0355) calc(var(--counter-fade, 0em) * 0.1667), rgba(0, 0, 0, 0.2099) calc(var(--counter-fade, 0em) * 0.3333), rgba(0, 0, 0, 0.5) calc(var(--counter-fade, 0em) * 0.5), rgba(0, 0, 0, 0.7901) calc(var(--counter-fade, 0em) * 0.6667), rgba(0, 0, 0, 0.9645) calc(var(--counter-fade, 0em) * 0.8333), #000 var(--counter-fade, 0em), #000 calc(100% - var(--counter-fade, 0em)), rgba(0, 0, 0, 0.9645) calc(100% - var(--counter-fade, 0em) * 0.8333), rgba(0, 0, 0, 0.7901) calc(100% - var(--counter-fade, 0em) * 0.6667), rgba(0, 0, 0, 0.5) calc(100% - var(--counter-fade, 0em) * 0.5), rgba(0, 0, 0, 0.2099) calc(100% - var(--counter-fade, 0em) * 0.3333), rgba(0, 0, 0, 0.0355) calc(100% - var(--counter-fade, 0em) * 0.1667), rgba(0, 0, 0, 0) 100%)';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const mod = (value: number, base: number) => ((value % base) + base) % base;

/** Keep a wheel position within five slots of the digit it represents. */
const wrap = (offset: number) => mod(offset + 5, 10) - 5;

const prefersReduced = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/**
 * How far a wheel turns. `up`/`down` take the literal route, so an 8 rolling to
 * a 1 goes forward through 9 and 0; `shortest` backs up instead. Direction is
 * a reading matter — a score going up should look like it is going up, even
 * when the last digit happens to pass backwards.
 */
const stepBetween = (from: number, to: number, direction: CounterDirection) => {
  const up = mod(to - from, 10);
  if (direction === 'up') return up;
  if (direction === 'down') return up === 0 ? 0 : up - 10;
  return up > 5 ? up - 10 : up;
};

const createFormatter = (locale: string, options: Intl.NumberFormatOptions) => {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat('en-US');
  }
};

/* The strip is the same ten glyphs for every digit, so they are read back from
   Intl rather than hardcoded — an Arabic-Indic or Devanagari locale gets its
   own numerals without a second code path. */
const digitsFor = (formatter: Intl.NumberFormat) => {
  const { locale, numberingSystem } = formatter.resolvedOptions();
  const plain = createFormatter(locale, { numberingSystem, useGrouping: false });
  return Array.from({ length: 10 }, (_, digit) => plain.format(digit));
};

type SlotKind = 'digit' | 'symbol';

type Slot = {
  key: string;
  kind: SlotKind;
  digit: number;
  text: string;
  /** Sort key: place value. Higher rank sits further left. */
  rank: number;
};

type VisualSlot = Slot & { start: number };

/**
 * Turns a formatted number into positioned slots. Digits are keyed by place
 * value (`i0`, `i1`, `f0`, …) so the same column survives a change in digit
 * count, and separators are keyed by the place value they precede so a group
 * mark does not re-animate when an unrelated column changes.
 */
const slotsFor = (formatter: Intl.NumberFormat, digits: string[], value: number): Slot[] => {
  const parts = formatter.formatToParts(value);
  let first = -1;
  let last = -1;
  let place = 0;

  parts.forEach((part, index) => {
    if (!NUMERIC.has(part.type)) return;
    if (first < 0) first = index;
    last = index;
    if (part.type === 'integer') place += [...part.value].length;
  });

  let fraction = 0;
  const counts: Record<string, number> = {};
  const slots: Slot[] = [];

  parts.forEach((part, index) => {
    if (part.type === 'integer' || part.type === 'fraction') {
      [...part.value].forEach((char) => {
        const digit = Math.max(0, digits.indexOf(char));
        if (part.type === 'integer') {
          place -= 1;
          slots.push({ key: `i${place}`, kind: 'digit', digit, text: '', rank: -2 * place });
        } else {
          slots.push({ key: `f${fraction}`, kind: 'digit', digit, text: '', rank: 1 + fraction });
          fraction += 1;
        }
      });
      return;
    }

    if (part.type === 'group') {
      slots.push({ key: `g${place}`, kind: 'symbol', digit: 0, text: part.value, rank: 1 - 2 * place });
      return;
    }

    if (part.type === 'decimal') {
      slots.push({ key: 'd', kind: 'symbol', digit: 0, text: part.value, rank: 0.5 });
      return;
    }

    /* Literals and the sign/currency parts: everything outside the numerals
       sits on the outside, so it is ranked beyond the highest place value. */
    const before = first < 0 || index < first;
    const name = `${before ? 'p' : 's'}-${part.type}`;
    counts[name] = (counts[name] || 0) + 1;
    slots.push({
      key: `${name}-${counts[name]}`,
      kind: 'symbol',
      digit: 0,
      text: part.value,
      rank: before ? -10000 - (first - index) : 10000 + (index - last),
    });
  });

  return slots;
};

type Item = {
  kind: SlotKind;
  rank: number;
  pos: number;
  vel: number;
  target: number;
  shown: number;
  shownVel: number;
  shownTarget: number;
  wait: number;
  exiting: boolean;
  natural: number;
  el: HTMLSpanElement | null;
  numerals: HTMLSpanElement[] | null;
  strip: HTMLSpanElement | null;
  blur: SVGFEGaussianBlurElement | null;
  filter: string;
  blurred: boolean;
};

const makeItem = (slot: Slot, position: number, shown: number): Item => ({
  kind: slot.kind,
  rank: slot.rank,
  pos: position,
  vel: 0,
  target: position,
  shown,
  shownVel: 0,
  shownTarget: shown,
  wait: 0,
  exiting: false,
  natural: 0,
  el: null,
  numerals: null,
  strip: null,
  blur: null,
  filter: '',
  blurred: false,
});

/**
 * An odometer that counts to a number.
 *
 * Each digit is a strip of ten numerals translated on Y, so a wheel never
 * re-renders while it spins — one transform per frame, written straight to the
 * DOM. The motion is a damped spring per digit, integrated on a fixed sub-step
 * so a dropped frame cannot overshoot the target, with `bounce` setting the
 * damping ratio rather than an invented overshoot curve.
 *
 * Column widths are interpolated between the two numerals the wheel is passing
 * through, so a proportional face does not jump width mid-roll, and the SVG
 * blur is vertical only — a rolling digit streaks, it does not smear.
 */
export default function Counter({
  value = 0,
  locale = 'en-US',
  format,
  decimals,
  minDigits = 1,
  prefix,
  suffix,
  direction = 'auto',
  duration = 0.7,
  bounce = 0.2,
  stagger = 0.04,
  motionBlur = true,
  intro = true,
  fade = 0.3,
  fontSize = 100,
  fontWeight = 'inherit',
  textColor = 'inherit',
  gap = 0,
  padding = 0,
  tabular = true,
  digitStyle,
  className = '',
  style,
}: CounterProps) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const rowRef = useRef<HTMLSpanElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const blurId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const amount = typeof value === 'number' ? (Object.is(value, -0) ? 0 : value) : Number(value);
  const formatKey = JSON.stringify(format ?? {});

  const formatter = useMemo(() => {
    const options: Intl.NumberFormatOptions = { ...(JSON.parse(formatKey) as Intl.NumberFormatOptions) };
    if (decimals !== undefined) {
      const fixed = clamp(Math.round(decimals), 0, 20);
      options.minimumFractionDigits = fixed;
      options.maximumFractionDigits = fixed;
    }
    if (minDigits > 1) options.minimumIntegerDigits = clamp(Math.round(minDigits), 1, 21);
    return createFormatter(locale, options);
  }, [locale, formatKey, decimals, minDigits]);

  const digits = useMemo(() => digitsFor(formatter), [formatter]);
  const slots = useMemo(() => slotsFor(formatter, digits, amount), [formatter, digits, amount]);
  const label = useMemo(() => formatter.format(amount), [formatter, amount]);

  const [list, setList] = useState<VisualSlot[]>(() =>
    slots.map((slot) => ({ ...slot, start: slot.kind === 'digit' ? slot.digit : 0 })),
  );

  const engine = useRef({
    items: new Map<string, Item>(),
    raf: 0,
    last: 0,
    ready: false,
    value: amount,
    widths: [] as number[],
    em: 16,
  });

  const settings = {
    direction: DIRECTIONS.includes(direction) ? direction : 'auto',
    duration: Math.max(0.05, duration),
    bounce: clamp(bounce, 0, 0.9),
    stagger: Math.max(0, stagger),
    motionBlur,
    tabular,
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const paint = (item: Item) => {
    const el = item.el;
    if (!el) return;
    const e = engine.current;
    const s = settingsRef.current;
    const shown = clamp(item.shown, 0, 1);
    const resting = item.pos === item.target && item.vel === 0;

    if (item.kind === 'digit') {
      /* Every numeral on the strip keeps its offset from the current position,
         so a whole scroll is one write per glyph and no layout work. */
      item.numerals?.forEach((numeral, n) => {
        numeral.style.transform = `translateY(${(wrap(n - item.pos) * 100).toFixed(3)}%)`;
      });

      if (shown >= 1 && (s.tabular || resting)) {
        el.style.width = '';
      } else {
        const at = mod(item.pos, 10);
        const low = Math.floor(at);
        const from = e.widths[low % 10] ?? 0;
        const to = e.widths[(low + 1) % 10] ?? from;
        el.style.width = `${((from + (to - from) * (at - low)) * shown).toFixed(2)}px`;
      }

      if (item.blur && item.strip) {
        /* Vertical-only blur, scaled by speed. Below the threshold the filter
           is detached entirely rather than left at zero — an active SVG filter
           forces the strip onto its own raster for no visible benefit. */
        const radius = s.motionBlur ? clamp((Math.abs(item.vel) - 3) * 0.006, 0, 0.09) * e.em : 0;
        if (radius > 0.25) {
          item.blur.setAttribute('stdDeviation', `0 ${radius.toFixed(2)}`);
          if (!item.blurred) {
            item.strip.style.filter = `url(#${item.filter})`;
            item.blurred = true;
          }
        } else if (item.blurred) {
          item.strip.style.filter = '';
          item.blurred = false;
        }
      }
    } else {
      el.style.width = shown >= 1 ? '' : `${(item.natural * shown).toFixed(2)}px`;
    }

    el.style.setProperty('--counter-shown', shown >= 1 ? '' : shown.toFixed(3));
  };

  const frame = (now: number) => {
    const e = engine.current;
    e.raf = 0;
    const s = settingsRef.current;
    const elapsed = clamp((now - e.last) / 1000, 0, 1 / 20);
    e.last = now;
    const reduced = prefersReduced();
    const omega = TAU / s.duration;
    const zeta = 1 - s.bounce;
    const presence = TAU / (s.duration * 0.85);
    const done: string[] = [];
    let busy = false;

    e.items.forEach((item, key) => {
      if (reduced) {
        item.wait = 0;
        item.pos = item.target;
        item.vel = 0;
        item.shown = item.shownTarget;
        item.shownVel = 0;
      } else {
        let left = elapsed;
        if (item.wait > 0) {
          const used = Math.min(item.wait, left);
          item.wait -= used;
          left -= used;
        }
        if (left > 0) {
          /* Fixed sub-steps: a spring integrated with one big step after a
             stall would jump past the digit and bounce back through it. */
          const steps = Math.ceil(left * 240);
          const dt = left / steps;
          for (let i = 0; i < steps; i += 1) {
            item.vel += (-omega * omega * (item.pos - item.target) - 2 * zeta * omega * item.vel) * dt;
            item.pos += item.vel * dt;
            item.shownVel +=
              (-presence * presence * (item.shown - item.shownTarget) - 2 * presence * item.shownVel) * dt;
            item.shown += item.shownVel * dt;
          }
        }
      }

      const settled =
        item.wait <= 0 &&
        Math.abs(item.pos - item.target) < 0.002 &&
        Math.abs(item.vel) < 0.02 &&
        Math.abs(item.shown - item.shownTarget) < 0.002 &&
        Math.abs(item.shownVel) < 0.02;

      if (settled) {
        item.target = mod(Math.round(item.target), 10);
        item.pos = item.target;
        item.vel = 0;
        item.shown = item.shownTarget;
        item.shownVel = 0;
        if (item.exiting) done.push(key);
      } else {
        busy = true;
      }

      paint(item);
    });

    if (done.length) {
      done.forEach((key) => e.items.delete(key));
      setList((previous) => previous.filter((slot) => !done.includes(slot.key)));
    }
    if (busy) e.raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    const e = engine.current;
    if (e.raf || typeof window === 'undefined') return;
    e.last = performance.now();
    e.raf = requestAnimationFrame(frame);
  };

  const kickRef = useRef(kick);
  kickRef.current = kick;

  useIsoLayoutEffect(() => {
    const e = engine.current;
    const s = settingsRef.current;

    if (!e.ready) {
      slots.forEach((slot) => e.items.set(slot.key, makeItem(slot, slot.kind === 'digit' ? slot.digit : 0, 1)));
      e.ready = true;
      e.value = amount;
      return;
    }

    const previous = e.value;
    e.value = amount;

    /* `auto` reads the sign of the change in magnitude, which is what the
       viewer means: a score going up rolls forward even when a particular
       wheel would have been shorter backwards. */
    const trend: CounterDirection =
      s.direction !== 'auto'
        ? s.direction
        : Math.abs(amount) > Math.abs(previous)
          ? 'up'
          : Math.abs(amount) < Math.abs(previous)
            ? 'down'
            : 'shortest';

    const next = new Set(slots.map((slot) => slot.key));
    const moving: Item[] = [];

    slots.forEach((slot) => {
      let item = e.items.get(slot.key);
      if (!item) {
        item = makeItem(slot, 0, 0);
        e.items.set(slot.key, item);
      }
      item.exiting = false;
      item.shownTarget = 1;
      item.rank = slot.rank;
      if (slot.kind !== 'digit') return;
      const step = stepBetween(mod(Math.round(item.target), 10), slot.digit, trend);
      if (step !== 0 || item.shown < 1) {
        item.target += step;
        moving.push(item);
      }
    });

    /* Slots that no longer exist still have to play out: a thousands column
       leaving the number fades and rolls to zero rather than vanishing, which
       is the difference between a number changing and the layout twitching. */
    e.items.forEach((item, key) => {
      if (next.has(key) || item.exiting) return;
      item.exiting = true;
      item.shownTarget = 0;
      if (item.kind !== 'digit') return;
      item.target += stepBetween(mod(Math.round(item.target), 10), 0, trend);
      moving.push(item);
    });

    moving
      .sort((a, b) => b.rank - a.rank)
      .forEach((item, order) => {
        item.wait = order * s.stagger;
      });

    /* A group mark travels with the column it precedes, so the comma does not
       arrive ahead of the digit that asked for it. */
    e.items.forEach((item, key) => {
      if (item.kind !== 'symbol' || key[0] !== 'g') return;
      const owner = e.items.get(`i${key.slice(1)}`);
      if (owner && (owner.shown < 1 || owner.shownTarget < 1)) item.wait = owner.wait;
    });

    setList((previousList) => {
      const known = new Map(previousList.map((slot) => [slot.key, slot]));
      const merged: VisualSlot[] = slots.map((slot) => ({ ...slot, start: known.get(slot.key)?.start ?? 0 }));
      previousList.forEach((slot) => {
        if (!next.has(slot.key)) merged.push(slot);
      });
      merged.sort((a, b) => a.rank - b.rank);
      const same =
        merged.length === previousList.length &&
        merged.every(
          (slot, index) =>
            slot.key === previousList[index].key &&
            slot.digit === previousList[index].digit &&
            slot.text === previousList[index].text,
        );
      return same ? previousList : merged;
    });

    kick();
  }, [slots]);

  /* Hand the DOM nodes to the engine after every list change. The engine is a
     ref, so it is populated after render but before paint. */
  useIsoLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const e = engine.current;
    row.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
      const item = e.items.get(el.dataset.slot ?? '');
      if (!item) return;
      item.el = el as HTMLSpanElement;
      if (item.kind === 'digit') {
        item.numerals = [...el.querySelectorAll<HTMLSpanElement>('[data-numeral]')];
        item.strip = el.querySelector<HTMLSpanElement>('[data-strip]');
        item.blur = el.querySelector<SVGFEGaussianBlurElement>('feGaussianBlur');
        item.filter = el.querySelector('filter')?.id ?? '';
        if (!item.blur && item.strip) item.strip.style.filter = '';
        item.blurred = Boolean(item.blur && item.strip?.style.filter);
      } else if (item.shown < 1 || item.shownTarget < 1) {
        item.natural = el.firstElementChild?.getBoundingClientRect().width ?? 0;
      }
      paint(item);
    });
  }, [list, motionBlur]);

  /* A hidden copy of all ten numerals is the only reliable way to know how wide
     each one is; measuring the numerals on the strip would return the width of
     the digit currently in view. */
  useIsoLayoutEffect(() => {
    const row = measureRef.current;
    const root = rootRef.current;
    if (!row || !root) return undefined;
    let alive = true;

    const measure = () => {
      if (!alive) return;
      const e = engine.current;
      e.widths = [...row.children].map((child) => child.getBoundingClientRect().width);
      e.em = parseFloat(getComputedStyle(root).fontSize) || 16;
    };

    measure();
    document.fonts?.ready?.then(measure).catch(() => {});
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        alive = false;
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, []);

  /* `intro` spins every wheel a full turn on first appearance — the number
     arrives rather than simply being there. Triggered on intersection so it is
     not spent below the fold. */
  useEffect(() => {
    const root = rootRef.current;
    if (!intro || !root || prefersReduced()) return undefined;

    const spin = () => {
      const e = engine.current;
      const s = settingsRef.current;
      const turn = s.direction === 'down' ? -10 : 10;
      [...e.items.values()]
        .filter((item) => item.kind === 'digit' && !item.exiting)
        .sort((a, b) => a.rank - b.rank)
        .forEach((item, order) => {
          item.target += turn;
          item.wait = order * s.stagger;
        });
      kickRef.current();
    };

    if (typeof IntersectionObserver === 'undefined') {
      spin();
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        spin();
      },
      { threshold: 0.5 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [intro]);

  useEffect(() => {
    const e = engine.current;
    return () => cancelAnimationFrame(e.raf);
  }, []);

  const affix = (node: React.ReactNode) =>
    node === undefined || node === null || node === false ? null : <span className={AFFIX}>{node}</span>;

  return (
    <span
      ref={rootRef}
      className={[ROOT, className].filter(Boolean).join(' ')}
      style={
        {
          fontSize: typeof fontSize === 'number' ? `${fontSize}px` : fontSize,
          fontWeight,
          color: textColor,
          fontVariantNumeric: tabular ? 'tabular-nums' : undefined,
          '--counter-fade': `${Math.max(0, fade)}em`,
          '--counter-gap': `${Math.max(0, gap)}px`,
          '--counter-padding': `${Math.max(0, padding)}px`,
          ...style,
        } as CSSProperties
      }
    >
      <span className={SR}>
        {prefix}
        {label}
        {suffix}
      </span>
      <span ref={rowRef} className={ROW} aria-hidden="true">
        {affix(prefix)}
        {list.map((slot) =>
          slot.kind === 'digit' ? (
            <span key={slot.key} data-slot={slot.key} className={DIGIT} style={digitStyle}>
              <span className={SIZER}>{digits[slot.digit]}</span>
              <span className={VIEWPORT} style={{ maskImage: MASK, WebkitMaskImage: MASK }}>
                <span className={STRIP} data-strip="">
                  {digits.map((char, n) => (
                    <span
                      key={n}
                      className={NUMERAL}
                      data-numeral=""
                      style={{ transform: `translateY(${wrap(n - slot.start) * 100}%)` }}
                    >
                      {char}
                    </span>
                  ))}
                </span>
              </span>
              {motionBlur && (
                <svg className={BLUR} aria-hidden="true">
                  <filter
                    id={`${blurId}-${slot.key}`}
                    x="-10%"
                    y="-50%"
                    width="120%"
                    height="200%"
                    colorInterpolationFilters="sRGB"
                  >
                    <feGaussianBlur stdDeviation="0 0" />
                  </filter>
                </svg>
              )}
            </span>
          ) : (
            <span key={slot.key} data-slot={slot.key} className={SYMBOL}>
              <span className={SYMBOL_TEXT}>{slot.text}</span>
            </span>
          ),
        )}
        {affix(suffix)}
      </span>
      <span ref={measureRef} className={MEASURE} aria-hidden="true">
        {digits.map((char, n) => (
          <span key={n}>{char}</span>
        ))}
      </span>
    </span>
  );
}
