import { readFileSync, writeFileSync } from 'node:fs';

const edits = [
  ['app/analysis/page.tsx',
   `        <p className="mt-3 text-[15px] text-muted">\n          Finished games, ready for a full Stockfish review. The engine runs in your browser, so\n          there is no queue and no cost — open a game and run the review.\n        </p>\n`,
   ``],
  ['app/analysis/page.tsx',
   `        <div className="mt-12 border-2 border-line bg-surface px-7 py-10 shadow-brut">\n          <p className="text-[15px] text-ink">No finished games yet.</p>\n          <p className="mt-1.5 text-[14px] text-muted">\n            Play a tournament game through to the end and it will show up here.\n          </p>\n        </div>`,
   `        <p className="mt-10 border-2 border-ink bg-surface px-5 py-4 text-[14px] text-muted shadow-brut">\n          No finished games yet.\n        </p>`],
  ['app/tournaments/new/page.tsx',
   `        <h1 className="mt-5 font-editorial text-[36px] leading-[1.12] tracking-[-0.03em] text-ink">\n          Set the field, then let the draw run itself.\n        </h1>\n        <p className="mt-3 text-[15px] text-muted">\n          Round one pairs the moment you start. Each later round re-scores the field and pairs it\n          again, so you never touch a pairing sheet.\n        </p>`,
   `        <h1 className="mt-4 text-[clamp(2rem,4vw,2.75rem)] leading-[1.02] font-extrabold tracking-[-0.04em] text-ink">\n          Set the field. The draw runs itself.\n        </h1>`],
  ['app/tournaments/new/page.tsx',
   `          <p className="text-[15px] text-ink">You need an account to host.</p>\n          <p className="mt-1.5 text-[14px] text-muted">\n            Hosting needs a name attached to the tournaments you run.\n          </p>`,
   `          <p className="text-[15px] font-bold text-ink">You need an account to host.</p>`],
  ['components/auth-form.tsx',
   `      <p className="mt-2 text-[14px] text-muted">\n        {isRegister\n          ? 'You only need an account to host a tournament or manage its draw.'\n          : 'Sign in to host a tournament and control its rounds.'}\n      </p>\n\n`,
   ``],
];

for (const [file, from, to] of edits) {
  const before = readFileSync(file, 'utf8');
  if (!before.includes(from)) {
    console.log(`MISS  ${file}: pattern not found`);
    continue;
  }
  writeFileSync(file, before.replace(from, to));
  console.log(`ok    ${file}`);
}
