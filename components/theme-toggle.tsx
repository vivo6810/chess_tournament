'use client';

import { useEffect, useState } from 'react';

import { THEME_STORAGE_KEY, useTheme } from '@/lib/use-theme';

/** Long enough for the 200ms cross-fade in globals.css to finish. */
const TRANSITION_MS = 220;

/**
 * A two-state switch between the light and dark palettes.
 *
 * Both icons are always in the DOM and the *attribute on `<html>`* decides
 * which one is lit — never React state. That is deliberate: state does not
 * exist until hydration, so a state-driven icon would render as light and
 * then snap to dark on every single load in dark mode. The CSS reads an
 * attribute the pre-paint script already set, so there is nothing to snap.
 *
 * React's only job here is the click.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme();
  /* Hydration-safe flag: the server cannot know the theme, so `aria-pressed`
     only appears once the client can answer honestly. It is a state attribute,
     not a visual one, so the extra render costs nothing on screen. */
  const [known, setKnown] = useState(false);

  useEffect(() => setKnown(true), []);

  const isDark = theme === 'dark';

  const toggle = () => {
    const root = document.documentElement;
    /* Read the current theme off the element rather than out of React state.
       The attribute is the single source of truth, and going through it means
       a stale render can never turn a click into a no-op. */
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';

    /* The transition flag has to be live *before* the attribute flips,
       otherwise there is no transition declared at the moment the colour
       changes and the switch lands as a hard cut. The forced reflow makes
       that ordering explicit instead of hopeful. */
    root.dataset.themeTransition = '';
    void root.offsetHeight;
    root.dataset.theme = next;

    window.setTimeout(() => {
      delete root.dataset.themeTransition;
    }, TRANSITION_MS);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Private mode or storage disabled. The switch still works for this
         page view, the choice just will not survive a reload. */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={`theme-toggle press ${className}`.trim()}
      role="switch"
      aria-checked={known ? isDark : undefined}
      aria-label="Dark mode"
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span className="theme-toggle__track">
        <span className="theme-toggle__thumb" aria-hidden="true" />
        <span className="theme-toggle__icon theme-toggle__icon--sun" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4.4" />
            <path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
          </svg>
        </span>
        <span className="theme-toggle__icon theme-toggle__icon--moon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.5 15.2A8.9 8.9 0 0 1 8.8 3.5a8.8 8.8 0 1 0 11.7 11.7Z" />
          </svg>
        </span>
      </span>
    </button>
  );
}
