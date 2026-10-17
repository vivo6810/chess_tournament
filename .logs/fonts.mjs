import { readFileSync, writeFileSync } from 'node:fs';

// The last editorial-serif headings, so every page title uses the one
// heading treatment the landing page introduced.
const targets = [
  'app/leaderboard/page.tsx',
  'app/analysis/page.tsx',
  'app/tournaments/[slug]/page.tsx',
  'app/tournaments/page.tsx',
  'components/auth-form.tsx',
];
for (const file of targets) {
  const before = readFileSync(file, 'utf8');
  const after = before.replaceAll('font-editorial', 'font-extrabold');
  if (after === before) console.log(`MISS ${file}`);
  else { writeFileSync(file, after); console.log(`ok   ${file}`); }
}

// Newsreader was only feeding `font-editorial`, which no longer exists.
const layout = readFileSync('app/layout.tsx', 'utf8');
let next = layout.replace(/\nconst newsreader = Newsreader\(\{[\s\S]*?\}\);\n/, '\n');
next = next.replace("const { Geist, Geist_Mono, Newsreader } = require", '');
next = next.replace("import { Geist, Geist_Mono, Newsreader } from 'next/font/google';", "import { Geist, Geist_Mono } from 'next/font/google';");
next = next.replace(/const newsreader = Newsreader\(\{[\s\S]*?\}\);\n/, '');
next = next.replace(/\s*\$\{newsreader\.variable\}/, '');
next = next.replace(/\/\* Three faces, each with a job[\s\S]*?\*\//, `/* Two faces, each with a job. Geist carries interface and body copy;
   Geist Mono handles notation and clocks, where digit widths must not
   shift. All three of the original faces were doing the same job the
   heading weight and tracking now do. */`);
writeFileSync('app/layout.tsx', next);
console.log('ok   app/layout.tsx');
