import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

/**
 * The design system keeps every colour in two blocks of `app/globals.css`:
 * `@theme static` for light and `[data-theme='dark']` for dark.
 *
 * That arrangement has two failure modes that are invisible in code review and
 * only show up as a broken-looking page in whichever mode the reviewer was not
 * using:
 *
 *   1. A token added to one block and forgotten in the other. The missing side
 *      silently keeps the light value, which is how you get an invisible
 *      element in dark mode.
 *   2. A token that exists in both but drifts too pale to read.
 *
 * Both are assertions here rather than things to notice by eye.
 */

const ROOT = new URL('../app/globals.css', import.meta.url);
const css = readFileSync(ROOT, 'utf8');

const block = (pattern: RegExp, label: string) => {
  const match = css.match(pattern);
  assert.ok(match, `could not find the ${label} colour block in globals.css`);
  return match[1];
};

const lightBlock = block(/@theme static \{([\s\S]*?)\n\}/, 'light');
const darkBlock = block(/\[data-theme='dark'\] \{([\s\S]*?)\n\}/, 'dark');

/** All declared `--color-*` names, ignoring non-colour tokens like fonts. */
const allKeys = (source: string) =>
  new Set(Array.from(source.matchAll(/(--color-[a-z-]+)\s*:/g), (m) => m[1]));

/** Only the tokens whose value is a hex colour we can measure. */
const hexes = (source: string) => {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(/(--color-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    found[match[1]] = match[2].toLowerCase();
  }
  return found;
};

const light = hexes(lightBlock);
const dark = hexes(darkBlock);

/* ── WCAG relative luminance and contrast ─────────────────────── */

const channel = (srgb: number) =>
  srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;

const luminance = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const round = (n: number) => Math.round(n * 100) / 100;

/* Thresholds. Body-copy pairs hold AAA (7:1); captions hold the 4.5:1 that
   the old #787774 muted grey failed at 4.4:1. */
const AA = 4.5;
const AAA = 7;

const PALETTES = [
  { name: 'light', tokens: light },
  { name: 'dark', tokens: dark },
] as const;

/* ── Structure ────────────────────────────────────────────────── */

test('both themes declare exactly the same colour tokens', () => {
  const lightKeys = allKeys(lightBlock);
  const darkKeys = allKeys(darkBlock);

  const missingFromDark = [...lightKeys].filter((key) => !darkKeys.has(key)).sort();
  const missingFromLight = [...darkKeys].filter((key) => !lightKeys.has(key)).sort();

  assert.deepEqual(
    missingFromDark,
    [],
    `these tokens have no dark value, so they keep their light one: ${missingFromDark.join(', ')}`,
  );
  assert.deepEqual(
    missingFromLight,
    [],
    `these tokens only exist in dark mode: ${missingFromLight.join(', ')}`,
  );
});

test('every declared colour is a plain six-digit hex', () => {
  for (const { name, tokens } of PALETTES) {
    for (const key of allKeys(name === 'light' ? lightBlock : darkBlock)) {
      const value = tokens[key];
      assert.ok(value, `${name}: ${key} is not a hex colour (got ${value ?? 'nothing parseable'})`);
    }
  }
});

/* ── Contrast ─────────────────────────────────────────────────── */

test('body copy clears AAA on the canvas', () => {
  for (const { name, tokens } of PALETTES) {
    assert.ok(
      contrast(tokens['--color-ink'], tokens['--color-canvas']) >= AAA,
      `${name}: ink on canvas is ${round(contrast(tokens['--color-ink'], tokens['--color-canvas']))}:1, needs ${AAA}:1`,
    );
    assert.ok(
      contrast(tokens['--color-ink-soft'], tokens['--color-canvas']) >= AAA,
      `${name}: ink-soft on canvas is ${round(contrast(tokens['--color-ink-soft'], tokens['--color-canvas']))}:1, needs ${AAA}:1`,
    );
  }
});

test('muted captions clear AA on the canvas', () => {
  for (const { name, tokens } of PALETTES) {
    const ratio = contrast(tokens['--color-muted'], tokens['--color-canvas']);
    assert.ok(
      ratio >= AA,
      `${name}: muted on canvas is ${round(ratio)}:1, needs ${AA}:1. This is the grey used for 12-13px captions, so a miss here is unreadable rather than merely soft.`,
    );
  }
});

test('the solid button keeps its label readable in both modes', () => {
  for (const { name, tokens } of PALETTES) {
    const ratio = contrast(tokens['--color-on-solid'], tokens['--color-solid']);
    assert.ok(
      ratio >= AAA,
      `${name}: on-solid on solid is ${round(ratio)}:1, needs ${AAA}:1. These two tokens must always move together — if solid flips to cream in dark mode without on-solid following, every button loses its label.`,
    );
  }
});

test('the accent is readable in both directions', () => {
  for (const { name, tokens } of PALETTES) {
    /* Label on the button, and the accent used as text on the page (links,
       the focus ring's neighbours). A complement is chosen for contrast, so
       it has to survive being measured as a foreground too. */
    const onButton = contrast(tokens['--color-on-accent'], tokens['--color-accent']);
    const onPage = contrast(tokens['--color-accent'], tokens['--color-canvas']);

    assert.ok(
      onButton >= AA,
      `${name}: on-accent on accent is ${round(onButton)}:1, needs ${AA}:1`,
    );
    assert.ok(
      onPage >= AA,
      `${name}: accent on canvas is ${round(onPage)}:1, needs ${AA}:1 — the accent is used for links and the focus ring, not only as a fill`,
    );
  }
});

test('inverted surfaces hand their own ink to headings', () => {
  /* `h1..h4` are coloured globally to `--color-ink`, which wins over
     inheritance. So on a surface that does not follow the palette, the
     heading keeps the *page* colour: cream on the cream slab in dark mode,
     near-black on the dark band in light mode. Both shipped, one per mode.

     The fix is a selector per inverted surface, which only works if the
     markup actually carries the class — hence the second half of this test. */
  const rule = css.match(/\.band :is\(h1, h2, h3, h4\),[\s\S]*?\{[\s\S]*?color: inherit;[\s\S]*?\}/);
  assert.ok(rule, 'globals.css must hand the surface ink to headings inside .band and .slab');

  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.ok(
    /className="band\b/.test(page),
    'the band section must carry the `band` class, or the rule above is dead CSS',
  );
  assert.ok(/className="slab\b/.test(page), 'the inverted cell must carry the `slab` class');
});

test('the glass panels separate from the band behind them', () => {
  /* A frosted panel is only a panel if you can see its edge. The first
     version mixed 8% white over the band, which composited to 1.28:1 —
     invisible, so the whole section read as one black rectangle. */
  const block = css.match(/\.glass--on-ink \{([\s\S]*?)\n  \}/);
  assert.ok(block, 'could not find the .glass--on-ink block in globals.css');

  const pct = block![1].match(/#ffffff (\d+)%/);
  assert.ok(pct, '.glass--on-ink must tint with a literal white percentage');
  const fill = Number(pct![1]) / 100;

  const composite = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const base = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return 255 * fill + base * 255 * (1 - fill);
    });
    return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  };

  for (const { name, tokens } of PALETTES) {
    const band = tokens['--color-band'];
    const card = composite(band);
    const ratio = contrast(card, band);
    assert.ok(
      ratio >= 1.4,
      `${name}: glass over the band is ${round(ratio)}:1 — raise the tint in .glass--on-ink until the panel has an edge`,
    );
  }
});

test('the band stays dark, and everything on it stays readable', () => {
  /* The band is the one section that does not follow the palette: it is a
     physical slab in both themes. These three pairs are the ones that would
     silently invert if someone "fixed" it by reusing `solid` / `on-solid`. */
  for (const { name, tokens } of PALETTES) {
    assert.ok(
      contrast(tokens['--color-band-fg'], tokens['--color-band']) >= AAA,
      `${name}: band-fg on band is ${round(contrast(tokens['--color-band-fg'], tokens['--color-band']))}:1, needs ${AAA}:1`,
    );
    assert.ok(
      contrast(tokens['--color-band-slab-ink'], tokens['--color-band-slab']) >= AAA,
      `${name}: slab ink on slab is ${round(
        contrast(tokens['--color-band-slab-ink'], tokens['--color-band-slab']),
      )}:1, needs ${AAA}:1`,
    );
    assert.ok(
      contrast(tokens['--color-band-slab'], tokens['--color-band']) >= 7,
      `${name}: the slab is only ${round(contrast(tokens['--color-band-slab'], tokens['--color-band']))}:1 against the band, so the inverted cell stops reading as a separate object`,
    );
  }
});

test('cards and borders separate from the surface they sit on', () => {
  /* A deliberately low bar. Soft borders are the house style, so this is not
     asking for a 3:1 outline — it exists to stop a border being set to
     something indistinguishable from the surface behind it, which is how the
     interface ends up looking like one flat sheet of paper. */
  for (const { name, tokens } of PALETTES) {
    const ratio = contrast(tokens['--color-line'], tokens['--color-surface']);
    assert.ok(
      ratio >= 1.25,
      `${name}: border is only ${round(ratio)}:1 against the surface, needs 1.25:1`,
    );
  }
});

test('the two square colours are far enough apart to read as a board', () => {
  for (const { name, tokens } of PALETTES) {
    const ratio = contrast(tokens['--color-board-light'], tokens['--color-board-dark']);
    assert.ok(
      ratio >= 2,
      `${name}: board squares are only ${round(ratio)}:1 apart, needs 2:1. Light squares at #efebe2 against #c3b9a8 were 1.57:1, which is why the board read as white-on-white.`,
    );
  }
});

test('the board separates from the page behind it', () => {
  for (const { name, tokens } of PALETTES) {
    const ratio = contrast(tokens['--color-board-dark'], tokens['--color-canvas']);
    assert.ok(
      ratio >= 1.5,
      `${name}: darkest square is ${round(ratio)}:1 against the canvas, needs 1.5:1. The hero heading is board colour clipped to letterforms, so this ratio is the headline's contrast.`,
    );
  }
});

/* There is deliberately no piece-contrast assertion any more. The app used to
   ship its own SVG piece set for the decorative boards, and this file defended
   the outline that kept a white piece visible on a light square. Those boards
   are gone, `react-chessboard` draws the pieces on the two boards that remain,
   and its glyphs are not ours to colour — so the tokens those assertions
   measured were deleted and the assertions with them. The square colours they
   sat on are still measured above. */

/* ── The pre-paint script ─────────────────────────────────────────
   `app/layout.tsx` inlines a short script that sets the palette before the
   first frame is composited. It is the highest-risk code in the theme
   system — a bug there either flashes the wrong theme on every load or
   throws on the critical render path — and it is also completely invisible
   to every other kind of test, since it only runs inside a browser.

   So we pull the exact string out of the layout and execute it against a
   stubbed environment. That tests the real shipped code, not a copy. */

const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const scriptSource = layout.match(/const themeScript = `([\s\S]*?)`;/)?.[1];

assert.ok(scriptSource, 'could not extract themeScript from app/layout.tsx');

const runScript = ({
  stored,
  prefersDark,
  storageThrows = false,
}: {
  stored: string | null;
  prefersDark: boolean;
  storageThrows?: boolean;
}) => {
  const attributes: Record<string, string> = {};
  const context = {
    localStorage: {
      getItem: () => {
        if (storageThrows) throw new Error('storage blocked');
        return stored;
      },
    },
    window: { matchMedia: () => ({ matches: prefersDark }) },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attributes[name] = value;
        },
      },
    },
  };
  vm.createContext(context);
  new vm.Script(scriptSource).runInContext(context);
  return attributes['data-theme'];
};

const hookSource = readFileSync(new URL('../lib/use-theme.ts', import.meta.url), 'utf8');

const STORAGE_CASES = [
  { label: 'an explicit dark choice beats a light OS', stored: 'dark', prefersDark: false, expected: 'dark' },
  { label: 'an explicit light choice beats a dark OS', stored: 'light', prefersDark: true, expected: 'light' },
  { label: 'no stored choice follows a dark OS', stored: null, prefersDark: true, expected: 'dark' },
  { label: 'no stored choice follows a light OS', stored: null, prefersDark: false, expected: 'light' },
] as const;

test('the pre-paint script always sets a data-theme attribute', () => {
  for (const { label, stored, prefersDark } of STORAGE_CASES) {
    const result = runScript({ stored, prefersDark });
    assert.ok(
      result === 'light' || result === 'dark',
      `${label}: script produced ${JSON.stringify(result)} instead of a theme. An unset attribute means the site renders in whichever palette the CSS default happens to be.`,
    );
  }
});

test('the pre-paint script resolves theme in the documented order', () => {
  for (const { label, stored, prefersDark, expected } of STORAGE_CASES) {
    assert.equal(runScript({ stored, prefersDark }), expected, label);
  }
});

test('a blocked localStorage does not break the first paint', () => {
  /* Safari private mode and hardened browsers throw on storage access. If
     this is not caught inside the script, the exception escapes on the
     critical render path and the theme attribute is never set at all. */
  assert.equal(
    runScript({ stored: null, prefersDark: true, storageThrows: true }),
    'light',
    'the script must swallow storage errors and still set a theme',
  );
});

test('the script and the hook agree on the storage key', () => {
  /* Two independent literals that must match forever. If they drift, the
     toggle writes a preference the pre-paint script never reads, so the
     choice appears to be forgotten on every reload. */
  const key = hookSource.match(/THEME_STORAGE_KEY = '([^']+)'/)?.[1];
  assert.ok(key, 'could not read THEME_STORAGE_KEY from lib/use-theme.ts');
  assert.ok(
    scriptSource.includes(`'${key}'`),
    `lib/use-theme.ts stores under '${key}' but the inline script in app/layout.tsx reads a different key`,
  );
});

test('the split-flap clock stays readable in both palettes', () => {
  /* The clock is the one element that does not follow the page: it keeps dark
     boards and bright digits in both themes, because it is a display rather
     than a surface. That decision has to be defended numerically, or dark mode
     quietly becomes a near-black display on a near-black page. */
  for (const { name, tokens } of PALETTES) {
    const board = tokens['--color-flap-bg'];

    const active = contrast(tokens['--color-flap-fg'], board);
    assert.ok(
      active >= AAA,
      `${name}: the running clock is ${round(active)}:1 on its own board, needs ${AAA}:1`,
    );

    // The idle side is dimmer on purpose, but its digits are large text and a
    // clock you cannot read is worse than no clock.
    const idle = contrast(tokens['--color-flap-idle'], board);
    assert.ok(idle >= 3, `${name}: the idle clock is ${round(idle)}:1, needs 3:1`);

    const alert = contrast(tokens['--color-flap-alert'], board);
    assert.ok(alert >= 4.5, `${name}: the time-pressure colour is ${round(alert)}:1, needs 4.5:1`);

    // And the display itself must separate from the page it is bolted to.
    const object = contrast(board, tokens['--color-canvas']);
    assert.ok(
      object >= 1.25,
      `${name}: the clock is only ${round(object)}:1 against the canvas, so it reads as a smudge rather than an object`,
    );
  }
});

test('the offset shadow is visible against the page', () => {
  /* A neobrutalist surface is a border plus an offset shadow. If the shadow is
     the same value as the canvas it disappears and every card loses its depth
     — which is what a black shadow does on a near-black page. */
  for (const { name, tokens } of PALETTES) {
    const ratio = contrast(tokens['--color-brut'], tokens['--color-canvas']);
    assert.ok(
      ratio >= 1.3,
      `${name}: the offset shadow is ${round(ratio)}:1 against the canvas, needs 1.3:1`,
    );
  }
});

test('status badges carry readable text', () => {
  const PAIRS = [
    ['win', '--color-win-fg', '--color-win-bg'],
    ['loss', '--color-loss-fg', '--color-loss-bg'],
    ['draw', '--color-draw-fg', '--color-draw-bg'],
    ['scheduled', '--color-info-fg', '--color-info-bg'],
  ] as const;

  for (const { name, tokens } of PALETTES) {
    for (const [label, fg, bg] of PAIRS) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      assert.ok(
        ratio >= AA,
        `${name}: ${label} badge is ${round(ratio)}:1, needs ${AA}:1. In dark mode these are pastel-on-dark-transparent, which is easy to get too dim by reusing the light foreground.`,
      );
    }
  }
});
