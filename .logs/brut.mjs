import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
const files = globSync(['app/**/*.tsx', 'components/**/*.tsx']);
const edits = [
  [/\brounded-(?:xs|sm|md|lg|xl|2xl|3xl|full)\b/g, 'rounded-none'],
  [/border-b border-line/g, 'border-b-2 border-line'],
  [/border-t border-line/g, 'border-t-2 border-line'],
  [/border-l border-line/g, 'border-l-2 border-line'],
  [/\bdivide-y\b(?!-)/g, 'divide-y-2'],
  [/\bborder\b(?![-a-zA-Z])/g, 'border-2'],
  [/\bborder-2 border-2\b/g, 'border-2'],
  [/border-2 border-2/g, 'border-2'],
  [/border-2 border-line bg-surface(?![-a-z])/g, 'border-2 border-line bg-surface shadow-brut'],
  [/border-2 border-line overflow-hidden/g, 'border-2 border-line shadow-brut overflow-hidden'],
];
let touched = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const [re, to] of edits) after = after.replace(re, to);
  if (after !== before) { writeFileSync(file, after); touched++; }
}
console.log('files rewritten:', touched);
