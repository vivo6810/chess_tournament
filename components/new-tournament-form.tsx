'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import PlayerEntry from '@/components/player-entry';
import { GROUPED_TIME_CONTROLS, describeTimeControl } from '@/lib/time-controls';

const FORMATS = [
  { id: 'swiss', title: 'Swiss', detail: 'Pairs by score. Any number of players.' },
  { id: 'round_robin', title: 'Round robin', detail: 'Everyone meets everyone once.' },
] as const;

export default function NewTournamentForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<'swiss' | 'round_robin'>('swiss');
  const [timeControl, setTimeControl] = useState('5+3');
  const [players, setPlayers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suggested = players.length >= 2 ? Math.max(1, Math.ceil(Math.log2(players.length))) : 0;
  const controls = GROUPED_TIME_CONTROLS.flatMap((group) => group.controls);
  const selected = controls.find((control) => control.id === timeControl);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, format, timeControl, players }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload.error ?? 'Could not create the tournament.');
      setBusy(false);
      return;
    }

    router.push(`/tournaments/${payload.tournament.slug}`);
  };

  return (
    <form onSubmit={submit} className="max-w-2xl">
      <label className="block">
        <span className="field-label">Tournament name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={80}
          placeholder="Riverside Spring Blitz"
          className="field mt-1.5"
        />
      </label>

      <fieldset className="mt-8">
        <legend className="field-label">Format</legend>
        <div className="mt-2 grid gap-0 sm:grid-cols-2">
          {FORMATS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFormat(option.id)}
              className={`press border-2 border-ink px-4 py-3.5 text-left ${
                format === option.id ? 'bg-ink text-canvas' : 'bg-surface text-ink'
              }`}
            >
              <span className="block text-[14px] font-bold">{option.title}</span>
              <span
                className={`mt-0.5 block text-[12px] ${format === option.id ? 'text-canvas/70' : 'text-muted'}`}
              >
                {option.detail}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="mt-8 block">
        <span className="field-label">Time control</span>
        <select
          value={timeControl}
          onChange={(event) => setTimeControl(event.target.value)}
          className="field mt-1.5"
        >
          {GROUPED_TIME_CONTROLS.map((group) => (
            <optgroup key={group.category} label={group.label}>
              {group.controls.map((control) => (
                <option key={control.id} value={control.id}>
                  {control.id} — {control.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="mt-1.5 block text-[12px] text-muted">
          {selected ? describeTimeControl(selected) : ''}
        </span>
      </label>

      <div className="mt-8">
        <PlayerEntry
          names={players}
          onChange={setPlayers}
          hint="Type one name or email, then press Enter. The box clears for the next."
        />
      </div>

      <p className="mt-3 text-[13px] text-muted">
        {players.length < 2
          ? `Two players minimum. ${2 - players.length} to go.`
          : format === 'swiss'
            ? `${players.length} entered · ${suggested} round${suggested === 1 ? '' : 's'}`
            : `${players.length} entered · ${players.length % 2 === 0 ? players.length - 1 : players.length} rounds`}
      </p>

      {error ? (
        <p className="mt-4 border-2 border-loss-fg bg-loss-bg px-3 py-2 text-[13px] font-medium text-loss-fg">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || players.length < 2 || !name.trim()}
        className="press mt-6 border-2 border-ink bg-accent px-5 py-3 text-[14px] font-bold text-on-accent shadow-brut"
      >
        {busy ? 'Creating…' : 'Create tournament'}
      </button>
    </form>
  );
}
