import Link from 'next/link';

import Counter from '@/components/counter/Counter';
import HeroArena from '@/components/hero-arena';
import NotationMarquee from '@/components/notation-marquee';
import { CATEGORY_LABEL, TIME_CONTROLS } from '@/lib/time-controls';

/* Every board on this page is either the real app or a fact about it. There
   are no sample players, no invented pairings and no illustrative score line:
   if a value here is not derived from `lib/` it does not belong on the page. */
const PAIRING_RULES = [
  { rule: 'No rematches', detail: 'The draw backtracks until no board is a repeat.' },
  { rule: 'Byes to the bottom', detail: 'The lowest score without one sits out.' },
  { rule: 'Colours balanced', detail: 'A third colour in a row is refused when it can be avoided.' },
];

const CATEGORIES = Array.from(new Set(TIME_CONTROLS.map((control) => control.category)));

/**
 * The landing page.
 *
 * A **server component**, deliberately: every heading, paragraph and link on
 * this page is in the HTML that arrives from the server, and the only
 * JavaScript it ships for itself is the four animated leaves — the arena, the
 * odometer, the folding word and the proximity type. Everything a reader (or a
 * reader that does not run scripts) needs is already text.
 *
 * The composition is built on one rule: **no two adjacent surfaces share a
 * value.** Sand page, ink band, cream cards, flat panels. Nothing here is a
 * gradient any more: the page reads as ink, sand and paper, which is both the
 * brutalist brief and a lot easier to look at than four blurred blooms.
 */
export default function LandingPage() {
  return (
    <div>
      {/* ═══ Hero ═══════════════════════════════════════════════════
          The one place the page can be loud. Copy left, a real board right. */}
      <section className="relative border-b-2 border-ink bg-canvas">
        <div className="relative grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="relative px-5 py-12 sm:px-10 sm:py-14 lg:py-24 lg:pr-24">
            <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
              Swiss &amp; round robin
            </p>

            <h1 className="mt-6 max-w-[15ch] text-[clamp(2.7rem,6.4vw,5rem)] leading-[0.94] font-extrabold tracking-[-0.045em] text-ink">
              Host the tournament. We draw the rounds.
            </h1>

            <p className="mt-7 max-w-[42ch] text-[17px] leading-relaxed text-ink-soft">
              Add your players, pick a time control, and start. Arbiter seeds every round,
              runs the clocks on the server, and puts Stockfish over each finished game.
            </p>

            <div className="mt-8 flex flex-wrap gap-3 sm:gap-4">
              <Link
                href="/tournaments/new"
                className="press border-2 border-ink bg-accent px-6 py-3.5 text-[15px] font-bold text-on-accent shadow-brut"
              >
                Host a tournament
              </Link>
              <Link
                href="/tournaments"
                className="press border-2 border-ink bg-surface px-6 py-3.5 text-[15px] font-bold text-ink shadow-brut"
              >
                Browse tournaments
              </Link>
            </div>

            <p className="mt-6 font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
              No account needed to watch · {TIME_CONTROLS.length} time controls
            </p>
          </div>

          {/* A hard rule, not a wedge: the split is a border on the layout
              grid, so it lands at the same place at every viewport width
              without an absolutely-positioned shape to drift. */}
          <div className="relative border-t-2 border-ink px-5 py-10 sm:px-10 sm:py-12 lg:border-t-0 lg:border-l-2 lg:py-20 lg:pr-12 lg:pl-24">
            <HeroArena />
          </div>
        </div>
      </section>

      <NotationMarquee />

      {/* ═══ The room ═══════════════════════════════════════════════
          An ink band. This is the tonal anchor the page was missing: after a
          sand hero, one full-bleed near-black section makes both of them read
          as deliberate. The bento grid lives here, on flat panels. */}
      <section className="band relative border-b-2 border-ink bg-band text-band-fg">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-band-fg/25 pb-6">
            <h2 className="max-w-[26ch] text-[clamp(1.6rem,3.4vw,2.3rem)] font-extrabold tracking-[-0.035em] text-band-fg">
              Pairings, clocks and review, run by the server.
            </h2>
            <p className="font-mono text-[11px] tracking-[0.14em] text-band-fg/80 uppercase">
              What Arbiter does per round
            </p>
          </div>

          {/* ── Bento ───────────────────────────────────────────────
              Six cells, three tracks, uneven spans. Deliberately not a row of
              equal cards: the shapes carry the hierarchy, so the copy does not
              have to. */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {/* 1 — the pairing claim, widest cell */}
            <article className="panel-on-ink flex flex-col justify-between gap-6 p-6 sm:p-7 sm:col-span-2 lg:col-span-3">
              <div>
                <p className="font-mono text-[11px] tracking-[0.16em] text-band-fg/80 uppercase">
                  01 — Pairings
                </p>
                <h3 className="mt-3 text-[26px] font-extrabold tracking-[-0.03em] text-band-fg">
                  Swiss, seeded by score.
                </h3>
                <p className="mt-3 max-w-[42ch] text-[14px] leading-relaxed text-band-fg/80">
                  Players meet the nearest score they have not already played. No repeat
                  pairings, no manual bracket.
                </p>
              </div>

              <ul className="flex flex-col gap-2.5">
                {PAIRING_RULES.map((item) => (
                  <li
                    key={item.rule}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-band-fg/35 pt-2.5"
                  >
                    <span className="font-mono text-[11px] tracking-[0.08em] text-band-fg uppercase">
                      {item.rule}
                    </span>
                    <span className="text-[12px] text-band-fg/80">{item.detail}</span>
                  </li>
                ))}
              </ul>
            </article>

            {/* 2 — the odometer. A real number from the app's own table. */}
            <article className="panel-on-ink flex flex-col justify-between gap-4 p-6 sm:p-7 sm:col-span-2 lg:col-span-3">
              <div>
                <p className="font-mono text-[11px] tracking-[0.16em] text-band-fg/80 uppercase">
                  02 — Time controls
                </p>
                <div className="mt-2 flex items-end gap-3">
                  <Counter
                    value={TIME_CONTROLS.length}
                    fontSize="clamp(3.4rem,7vw,5rem)"
                    fontWeight={800}
                    textColor="var(--color-band-fg)"
                    duration={1.1}
                    bounce={0.28}
                    stagger={0.06}
                    fade={0.22}
                  />
                  <span className="mb-3 font-mono text-[12px] tracking-[0.14em] text-band-fg/80 uppercase">
                    presets
                  </span>
                </div>
                <p className="mt-2 max-w-[38ch] text-[14px] leading-relaxed text-band-fg/80">
                  From one minute with no increment to a day per move. The bank and the
                  Fischer bonus are enforced on the server, per game.
                </p>
              </div>

              <ul className="flex flex-wrap gap-2">
                {CATEGORIES.map((category) => (
                  <li
                    key={category}
                    className="border border-band-fg/35 px-2 py-1 font-mono text-[11px] text-band-fg/80"
                  >
                    {CATEGORY_LABEL[category]}
                  </li>
                ))}
              </ul>
            </article>

            {/* 3 */}
            <article className="panel-on-ink flex flex-col gap-3 p-6 sm:col-span-1 lg:col-span-2">
              <p className="font-mono text-[11px] tracking-[0.16em] text-band-fg/80 uppercase">
                03 — Clocks
              </p>
              <h3 className="text-[19px] font-extrabold tracking-[-0.02em] text-band-fg">
                Server time, not vibes.
              </h3>
              <p className="text-[13px] leading-relaxed text-band-fg/80">
                Every move is timestamped and validated against the bank. A client that lies
                about its clock loses on time.
              </p>
            </article>

            {/* 4 */}
            <article className="panel-on-ink flex flex-col gap-3 p-6 sm:col-span-1 lg:col-span-2">
              <p className="font-mono text-[11px] tracking-[0.16em] text-band-fg/80 uppercase">
                04 — Review
              </p>
              <h3 className="text-[19px] font-extrabold tracking-[-0.02em] text-band-fg">
                Stockfish on every game.
              </h3>
              <p className="text-[13px] leading-relaxed text-band-fg/80">
                Finish a game and the analysis is one click. Blunders are marked where they
                were played.
              </p>
            </article>

            {/* 5 — the one inverted cell. A cream slab on the ink band, so the
                eye lands where the action is. */}
            <article className="slab flex flex-col justify-between gap-4 p-6 lg:col-span-2">
              <div>
                <p className="font-mono text-[11px] tracking-[0.16em] text-band-slab-ink/75 uppercase">
                  05 — Your move
                </p>
                <h3 className="mt-2 text-[19px] font-extrabold tracking-[-0.02em] text-band-slab-ink">
                  Start a bracket in a minute.
                </h3>
              </div>
              <Link
                href="/tournaments/new"
                className="press inline-flex items-center justify-between gap-3 border-2 border-band-slab-ink bg-accent px-4 py-3 text-[13px] font-bold text-on-accent"
              >
                Host a tournament
                <span aria-hidden="true">→</span>
              </Link>
            </article>
          </div>
        </div>
      </section>

      {/* ═══ How it works ═══════════════════════════════════════════
          Three cards, hard borders, offset shadows — the neobrutalist half of
          the brief, kept to the part of the page that is pure instruction. */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="max-w-[20ch] text-[clamp(1.7rem,3.4vw,2.6rem)] font-extrabold tracking-[-0.035em] text-ink">
              Three steps, then the app does the work.
            </h2>
            <Link
              href="/analysis"
              className="press border-2 border-ink bg-surface px-4 py-2.5 text-[13px] font-bold text-ink shadow-brut-sm"
            >
              Try the review board
            </Link>
          </div>

          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Name the tournament',
                body: 'Pick a format, a round count and a time control. Nothing else is required.',
              },
              {
                step: '02',
                title: 'Paste your players',
                body: 'One per line, in any order. They link to their accounts by username.',
              },
              {
                step: '03',
                title: 'Start round one',
                body: 'Pairings generate instantly. Results feed the next round, and the standings.',
              },
            ].map((item) => (
              <li
                key={item.step}
                className="step-card flex flex-col gap-3 border-2 border-ink bg-surface p-7 shadow-brut"
              >
                <span className="step-card__index font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
                  {item.step}
                </span>
                <h3 className="text-[20px] font-extrabold tracking-[-0.02em] text-ink">
                  {item.title}
                </h3>
                <p className="text-[14px] leading-relaxed text-ink-soft">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
