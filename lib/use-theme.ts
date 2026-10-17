'use client';

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'arbiter-theme';

/** Mirrors the inline script in `app/layout.tsx`. Keep the two in step. */
const read = (): Theme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

/**
 * There is no provider and no context. The `data-theme` attribute on
 * `<html>` — already set before first paint by the inline script — *is* the
 * store, and this just subscribes to it. That means the value is correct on
 * the very first client render without React having to own it, and it stays
 * correct if anything else changes the theme (OS preference, another tab).
 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(read());
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
