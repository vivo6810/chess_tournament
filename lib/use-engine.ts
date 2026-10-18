'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type EngineScore = {
  depth: number;
  /** Centipawns, from the point of view of the side to move. */
  cp: number | null;
  /** Moves to mate, negative when the side to move is being mated. */
  mate: number | null;
  best: string | null;
  pv: string[];
};

const EMPTY: EngineScore = { depth: 0, cp: null, mate: null, best: null, pv: [] };

/**
 * Reads one UCI `info` line. The engine emits these continuously while it
 * searches, so the panel can show the score climbing as depth increases rather
 * than freezing until `bestmove`.
 */
function parseInfo(line: string): EngineScore | null {
  const depth = /\bdepth (\d+)/.exec(line);
  if (!depth) return null;

  const cp = /\bscore cp (-?\d+)/.exec(line);
  const mate = /\bscore mate (-?\d+)/.exec(line);
  const pv = /\bpv (.+)$/.exec(line);

  return {
    depth: Number(depth[1]),
    cp: cp ? Number(cp[1]) : null,
    mate: mate ? Number(mate[1]) : null,
    best: null,
    pv: pv ? pv[1].trim().split(/\s+/) : [],
  };
}

type Pending = {
  resolve: (score: EngineScore) => void;
  onUpdate?: (score: EngineScore) => void;
  last: EngineScore;
};

/**
 * Runs one Stockfish worker for the life of the component.
 *
 * The worker is *scheduled*, not created inline: it is a 1.8 MB WebAssembly
 * binary plus its glue, and fetching that during the first paint puts it in a
 * race with the stylesheet, the fonts and the page's own animations. Nobody can
 * move a piece before the page is usable, so the engine is started once the
 * browser reports it is idle — with a timer for browsers that lack
 * `requestIdleCallback`.
 */
export function useEngine() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const handleMessage = (event: MessageEvent) => {
      const line = String(event.data);

      if (line === 'uciok') {
        workerRef.current?.postMessage('isready');
        return;
      }
      if (line === 'readyok') {
        setReady(true);
        return;
      }

      const pending = pendingRef.current;
      if (!pending) return;

      if (line.startsWith('bestmove')) {
        const best = line.split(/\s+/)[1] ?? null;
        const final = { ...pending.last, best };
        pendingRef.current = null;
        pending.resolve(final);
        return;
      }

      if (line.startsWith('info ')) {
        const parsed = parseInfo(line);
        if (parsed) {
          pending.last = parsed;
          pending.onUpdate?.(parsed);
        }
      }
    };

    const boot = () => {
      if (cancelled) return;
      try {
        /* The engine is served from /public/engine and instantiated by a
           same-origin URL rather than bundled. The emscripten glue is the
           worker entry point itself, so wrapping it in another worker breaks
           it. */
        const worker = new Worker('/engine/stockfish-19-lite-single.js');
        workerRef.current = worker;
        worker.onmessage = handleMessage;
        worker.onerror = () => setError('The engine failed to start.');
        worker.postMessage('uci');
      } catch {
        setError('The engine could not be loaded in this browser.');
      }
    };

    const schedule = (callback: () => void) => {
      if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(callback, { timeout: 2000 });
        return () => window.cancelIdleCallback(id);
      }
      const id = window.setTimeout(callback, 400);
      return () => window.clearTimeout(id);
    };

    const cancelBoot = schedule(boot);

    return () => {
      cancelled = true;
      cancelBoot();
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingRef.current = null;
    };
  }, []);

  /** Searches one position to a fixed depth and resolves with the final score. */
  const analyse = useCallback(
    (fen: string, depth: number, onUpdate?: (score: EngineScore) => void) =>
      new Promise<EngineScore>((resolve) => {
        const worker = workerRef.current;
        if (!worker) {
          resolve(EMPTY);
          return;
        }
        pendingRef.current = { resolve, onUpdate, last: EMPTY };
        // A new search must not race the previous one.
        worker.postMessage('stop');
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go depth ${depth}`);
      }),
    [],
  );

  const stop = useCallback(() => {
    workerRef.current?.postMessage('stop');
  }, []);

  return { ready, error, analyse, stop };
}

/** Score converted to a White-relative pawn value, for an eval bar. */
export function toWhitePawns(score: EngineScore, turn: 'w' | 'b'): number | null {
  if (score.mate != null) {
    const mateForWhite = turn === 'w' ? score.mate : -score.mate;
    return mateForWhite > 0 ? 10 : -10;
  }
  if (score.cp == null) return null;
  const cpForWhite = turn === 'w' ? score.cp : -score.cp;
  return cpForWhite / 100;
}

export function formatScore(score: EngineScore, turn: 'w' | 'b'): string {
  if (score.mate != null) {
    const mateForWhite = turn === 'w' ? score.mate : -score.mate;
    return `M${Math.abs(mateForWhite)}`;
  }
  if (score.cp == null) return '—';
  const cpForWhite = turn === 'w' ? score.cp : -score.cp;
  const pawns = cpForWhite / 100;
  return `${pawns > 0 ? '+' : pawns < 0 ? '' : ' '}${pawns.toFixed(2)}`;
}
