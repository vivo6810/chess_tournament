/**
 * Morphy's Opera Game, 1858 — a queen sacrifice into mate in seventeen moves.
 * It is the longest piece of real chess this site can show without running an
 * engine, which is exactly what a decorative strip wants.
 */
const MOVES = [
  'e4', 'e5',
  'Nf3', 'd6',
  'd4', 'Bg4',
  'dxe5', 'Bxf3',
  'Qxf3', 'dxe5',
  'Bc4', 'Nf6',
  'Qb3', 'Qe7',
  'Nc3', 'c6',
  'Bg5', 'b5',
  'Nxb5', 'cxb5',
  'Bxb5+', 'Nbd7',
  'O-O-O', 'Rd8',
  'Rxd7', 'Rxd7',
  'Rd1', 'Qe6',
  'Bxd7+', 'Nxd7',
  'Qb8+', 'Nxb8',
  'Rd8#',
];

/**
 * Renders the move list twice so the CSS translate can loop seamlessly at -50%:
 * the second copy is already in place exactly when the first scrolls out. The
 * duplicate is hidden from assistive tech.
 */
export default function NotationMarquee({ className = '' }: { className?: string }) {
  const line = MOVES.map((san, index) => (index % 2 === 0 ? `${index / 2 + 1}. ${san}` : san));

  const strip = (
    <ol className="flex shrink-0 items-center gap-6 pr-6">
      {line.map((token, index) => (
        <li
          key={`${token}-${index}`}
          className={`font-mono text-[12px] whitespace-nowrap ${
            token.endsWith('#') ? 'text-ink' : 'text-muted'
          }`}
        >
          {token}
        </li>
      ))}
    </ol>
  );

  return (
    <div className={`relative overflow-hidden border-t-2 border-line py-5 ${className}`}>
      {/* The mask is on the viewport, not the track, so the fade stays put
          while the notation scrolls underneath it. */}
      <div className="marquee-mask">
        <div className="marquee-track" aria-hidden="true">
          {strip}
          {strip}
        </div>
      </div>
      <span className="sr-only">Morphy&rsquo;s Opera Game, 1858: {MOVES.join(', ')}</span>
    </div>
  );
}
