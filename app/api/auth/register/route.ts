import { NextResponse } from 'next/server';

import { ADMIN_HINT_COOKIE } from '@/lib/admin';
import { jsonError, handleError, readJson } from '@/lib/api';
import {
  SESSION_COOKIE,
  createSession,
  hashPassword,
  normalizeUsername,
  sessionCookieOptions,
  toPublicUser,
} from '@/lib/auth';
import { db, now, type UserRow } from '@/lib/db';

const USERNAME_PATTERN = /^[a-z0-9_-]{3,24}$/;
const MIN_PASSWORD = 8;

export async function POST(request: Request) {
  try {
    const body = await readJson<{ username: string; password: string }>(request);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const key = normalizeUsername(username);

    if (!USERNAME_PATTERN.test(key)) {
      return jsonError(
        'Usernames must be 3 to 24 characters, using letters, numbers, hyphens or underscores.',
      );
    }
    if (password.length < MIN_PASSWORD) {
      return jsonError(`Passwords must be at least ${MIN_PASSWORD} characters.`);
    }

    if (db.prepare('SELECT 1 FROM users WHERE username_key = ?').get(key)) {
      return jsonError('That username is taken.', 409);
    }

    const info = db
      .prepare(
        'INSERT INTO users (username, username_key, password_hash, rating, created_at) VALUES (?, ?, ?, 1200, ?)',
      )
      .run(username, key, hashPassword(password), now());

    const user = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as UserRow;

    const { token } = createSession(user.id);
    const response = NextResponse.json({ user: toPublicUser(user) });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    /* Signing up always lands on a normal account, so drop any admin nav hint. */
    response.cookies.set(ADMIN_HINT_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return handleError(error);
  }
}
