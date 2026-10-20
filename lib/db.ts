import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ADMIN_PASSWORD_FALLBACK, ADMIN_USERNAME, OWNER_PASSWORD_FALLBACK, OWNER_USERNAME, type Role } from './admin';
import { hashPassword } from './password';

/**
 * Storage is local SQLite through Node's built-in `node:sqlite`, so the app
 * runs with no external service, no API key, and no native compilation step.
 * Everything below is written against plain SQL, so swapping to Postgres later
 * means changing this file and the queries, not the domain logic.
 */

/**
 * Where the database file lives.
 *
 * A serverless host mounts the deployment itself read-only — the repo's
 * `data/arbiter.db` is readable but not writable, and creating a new file
 * beside it fails with "unable to open database file". The only writable
 * directory in such a runtime is the OS temp directory, so on a hosted
 * function we keep the database there. That directory is per instance: the
 * data survives as long as the instance does, which keeps every page working
 * and a game in progress playable, but it is not durable storage. A durable
 * deployment sets `DATABASE_PATH` to a mounted volume or swaps this file for a
 * hosted database client.
 */
function defaultDbPath(): string {
  const hosted = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (hosted) return path.join(os.tmpdir(), 'arbiter-data', 'arbiter.db');
  return path.join(process.cwd(), 'data', 'arbiter.db');
}

const DB_PATH = process.env.DATABASE_PATH ?? defaultDbPath();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL,
  username_key  TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rating        INTEGER NOT NULL DEFAULT 1200,
  /* 'user' is everybody; 'admin' runs tournaments and may settle any board;
     'owner' manages the people who use the app. */
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'owner')),
  /* 1 means the owner has stopped this account signing in. Sessions are deleted
     at the same moment, so the block takes effect on the next request. */
  blacklisted   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS tournaments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  host_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  format        TEXT NOT NULL CHECK (format IN ('swiss', 'round_robin')),
  time_control  TEXT NOT NULL,
  total_rounds  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'finished')),
  current_round INTEGER NOT NULL DEFAULT 0,
  /* A suspended event is frozen: no moves, no new round, no edits. Only the
     owner sets this — see /owner. */
  suspended     INTEGER NOT NULL DEFAULT 0,
  /* Created from /lab. Sandbox games let an admin play both seats. */
  sandbox       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER
);

CREATE TABLE IF NOT EXISTS tournament_players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  seed          INTEGER NOT NULL,
  withdrawn     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  UNIQUE (tournament_id, name)
);
CREATE INDEX IF NOT EXISTS idx_players_tournament ON tournament_players(tournament_id);

CREATE TABLE IF NOT EXISTS games (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id   INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  round_no        INTEGER,
  board           INTEGER,
  white_player_id INTEGER NOT NULL REFERENCES tournament_players(id) ON DELETE CASCADE,
  black_player_id INTEGER NOT NULL REFERENCES tournament_players(id) ON DELETE CASCADE,
  time_control    TEXT NOT NULL,
  fen             TEXT NOT NULL,
  moves           TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  result          TEXT,
  termination     TEXT,
  white_ms        INTEGER NOT NULL,
  black_ms        INTEGER NOT NULL,
  increment_ms    INTEGER NOT NULL DEFAULT 0,
  per_move_ms     INTEGER NOT NULL DEFAULT 0,
  turn_started_at INTEGER NOT NULL,
  /* Who last offered a draw, by user id. NULL means no offer is standing.
     A draw is an agreement between the two players, so it needs a place to
     hold the half-finished agreement; the board position alone cannot. */
  draw_offer_by   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_tournament ON games(tournament_id, round_no, board);

CREATE TABLE IF NOT EXISTS pairings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_no      INTEGER NOT NULL,
  board         INTEGER NOT NULL,
  white_id      INTEGER REFERENCES tournament_players(id) ON DELETE CASCADE,
  black_id      INTEGER REFERENCES tournament_players(id) ON DELETE CASCADE,
  game_id       INTEGER REFERENCES games(id) ON DELETE SET NULL,
  result        TEXT,
  is_bye        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tournament_id, round_no, board)
);
CREATE INDEX IF NOT EXISTS idx_pairings_round ON pairings(tournament_id, round_no);
`;

/* Columns added after a database already existed. `CREATE TABLE IF NOT EXISTS`
   is a no-op there, so the schema above is not enough to migrate a running
   instance — each entry is applied only when the column is missing. */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'games', column: 'draw_offer_by', definition: 'INTEGER' },
  { table: 'users', column: 'role', definition: "TEXT NOT NULL DEFAULT 'user'" },
  { table: 'users', column: 'blacklisted', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tournaments', column: 'suspended', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tournaments', column: 'sandbox', definition: 'INTEGER NOT NULL DEFAULT 0' },
];

function migrate(database: DatabaseSync): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.length === 0) continue;
    if (columns.some((existing) => existing.name === column)) continue;
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  /* Events created from /lab before the sandbox flag existed are still lab
     events. The slug is what the lab generated them with, so it is the only
     evidence available; without this they would behave like real events and the
     admin could no longer drive both seats at their boards. */
  database
    .prepare("UPDATE tournaments SET sandbox = 1 WHERE sandbox = 0 AND slug LIKE 'lab-%'")
    .run();
}

/**
 * Creates the built-in accounts the first time a database is opened.
 *
 * Doing it here rather than in a migration or a script means every instance has
 * them — including the short-lived one a serverless host hands out — and that
 * the names are taken before anyone can register them. Existing rows are left
 * alone except for their role, which is raised to the seeded role so a database
 * that predates roles does not leave the admin as an ordinary user.
 */
function seedAccount(
  database: DatabaseSync,
  username: string,
  fallbackPassword: string,
  passwordEnv: string,
  role: Role,
): void {
  const taken = database.prepare('SELECT 1 FROM users WHERE username_key = ?').get(username);
  if (!taken) {
    const password = process.env[passwordEnv]?.trim() || fallbackPassword;
    /* `Date.now()` rather than the `now` helper below: this runs while the module
       is still evaluating `db`, and `now` is declared after it. */
    database
      .prepare(
        `INSERT INTO users (username, username_key, password_hash, rating, role, blacklisted, created_at)
         VALUES (?, ?, ?, 1200, ?, 0, ?)`,
      )
      .run(username, username, hashPassword(password), role, Date.now());
    return;
  }

  /* The account exists. Only its role is enforced, never its password: an
     operator who changed the password should not have it rewritten to the
     published default on the next boot. */
  database.prepare('UPDATE users SET role = ? WHERE username_key = ? AND role != ?').run(role, username, role);
}

function seedAccounts(database: DatabaseSync): void {
  seedAccount(database, ADMIN_USERNAME, ADMIN_PASSWORD_FALLBACK, 'ADMIN_PASSWORD', 'admin');
  seedAccount(database, OWNER_USERNAME, OWNER_PASSWORD_FALLBACK, 'OWNER_PASSWORD', 'owner');
}

function openAt(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = ON;');
  /* Two concurrent requests on the same instance can reach the file at once.
     Waiting for the lock beats failing the request. */
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec(SCHEMA);
  migrate(database);
  seedAccounts(database);
  return database;
}

/**
 * Opening the file is the step that can fail on a read-only host. Falling back
 * to an in-memory database keeps the app rendering instead of turning every
 * data-backed page into a 500, so a misconfigured deployment degrades to empty
 * pages that still work rather than to an error screen.
 */
function open(): DatabaseSync {
  if (DB_PATH === ':memory:') return openAt(':memory:');
  try {
    return openAt(DB_PATH);
  } catch (error) {
    console.error(
      `[db] cannot open ${DB_PATH} (${(error as Error).message}); falling back to an in-memory database for this instance.`,
    );
    return openAt(':memory:');
  }
}

/* Next re-evaluates modules on every hot reload in development, which would
   otherwise leave a pile of open handles to the same file. */
const globalForDb = globalThis as unknown as { __arbiterDb?: DatabaseSync };
export const db: DatabaseSync = globalForDb.__arbiterDb ?? (globalForDb.__arbiterDb = open());

export type UserRow = {
  id: number;
  username: string;
  username_key: string;
  password_hash: string;
  rating: number;
  role: Role;
  blacklisted: number;
  created_at: number;
};

export type TournamentRow = {
  id: number;
  slug: string;
  name: string;
  host_id: number;
  format: 'swiss' | 'round_robin';
  time_control: string;
  total_rounds: number;
  status: 'draft' | 'running' | 'finished';
  current_round: number;
  suspended: number;
  sandbox: number;
  created_at: number;
  started_at: number | null;
};

export type PlayerRow = {
  id: number;
  tournament_id: number;
  name: string;
  user_id: number | null;
  seed: number;
  withdrawn: number;
  created_at: number;
};

export type PairingRow = {
  id: number;
  tournament_id: number;
  round_no: number;
  board: number;
  white_id: number | null;
  black_id: number | null;
  game_id: number | null;
  result: string | null;
  is_bye: number;
};

export type MoveRecord = {
  san: string;
  uci: string;
  fen: string;
  at: number;
  whiteMs: number;
  blackMs: number;
};

export type GameRow = {
  id: number;
  tournament_id: number | null;
  round_no: number | null;
  board: number | null;
  white_player_id: number;
  black_player_id: number;
  time_control: string;
  fen: string;
  moves: string;
  status: 'active' | 'finished';
  result: string | null;
  termination: string | null;
  white_ms: number;
  black_ms: number;
  increment_ms: number;
  per_move_ms: number;
  turn_started_at: number;
  draw_offer_by: number | null;
  created_at: number;
  updated_at: number;
};

export function parseMoves(json: string): MoveRecord[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as MoveRecord[]) : [];
  } catch {
    return [];
  }
}

export const now = () => Date.now();

/** Turns a tournament name into a URL-safe, collision-free slug. */
export function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tournament';

  let candidate = base;
  let suffix = 2;
  const exists = db.prepare('SELECT 1 FROM tournaments WHERE slug = ?');
  while (exists.get(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
