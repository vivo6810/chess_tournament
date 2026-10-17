'use client';

import { useRef, useState } from 'react';

const MAX_NAME = 60;
const MAX_FIELD = 64;

/**
 * One name per press.
 *
 * This replaced a textarea you pasted into. A textarea is only read when the
 * whole form is submitted, so a duplicate on line seven of nine surfaced at the
 * end with nothing to point at. Here each name is committed on its own, the box
 * empties so the next can be typed straight away, and a duplicate is refused at
 * the moment it is typed rather than a page later.
 *
 * The box is **not** a nested `<form>`, which it used to be: this component is
 * rendered inside the tournament form, and a form inside a form is invalid
 * HTML that React reports as a hydration mismatch on every load of the page.
 * Enter is handled on the key instead, which is the only thing the inner form
 * was providing.
 */
export default function PlayerEntry({
  names,
  onChange,
  label = 'Players',
  hint,
  busy = false,
}: {
  names: string[];
  onChange: (names: string[]) => void;
  label?: string;
  hint?: string;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commit = () => {
    const name = draft.trim().replace(/\s+/g, ' ');
    if (!name) return;

    if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      setError(`${name} is already in the field.`);
      return;
    }
    if (names.length >= MAX_FIELD) {
      setError(`${MAX_FIELD} players is the limit.`);
      return;
    }

    onChange([...names, name.slice(0, MAX_NAME)]);
    setDraft('');
    setError(null);
    inputRef.current?.focus();
  };

  const remove = (name: string) => {
    onChange(names.filter((existing) => existing !== name));
    setError(null);
  };

  return (
    <div>
      <span className="field-label">{label}</span>
      {hint ? <p className="mt-1 text-[12px] text-muted">{hint}</p> : null}

      <div className="mt-2 flex gap-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commit();
          }}
          maxLength={MAX_NAME}
          autoComplete="off"
          spellCheck={false}
          placeholder="Name, email or handle"
          aria-label="Add a player"
          className="field"
        />
        <button
          type="button"
          onClick={commit}
          disabled={busy || !draft.trim()}
          className="press flex-none border-2 border-ink bg-accent px-4 py-2 text-[13px] font-bold text-on-accent shadow-brut-sm"
        >
          Enter
        </button>
      </div>

      {error ? <p className="mt-2 text-[12px] font-medium text-loss-fg">{error}</p> : null}

      {names.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {names.map((name, index) => (
            <li
              key={name}
              className="flex items-center gap-2 border-2 border-line bg-surface-sunken py-1 pr-1 pl-2.5 text-[13px] text-ink"
            >
              <span className="font-mono text-[11px] text-muted tabular-nums">{index + 1}</span>
              <span className="max-w-[16rem] truncate" title={name}>
                {name}
              </span>
              <button
                type="button"
                onClick={() => remove(name)}
                aria-label={`Remove ${name}`}
                className="press grid h-5 w-5 flex-none place-items-center border-2 border-line bg-surface text-[13px] leading-none text-muted hover:border-ink hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-muted">Nobody entered yet. Two minimum.</p>
      )}
    </div>
  );
}
