import { NextResponse } from 'next/server';

import { jsonError, handleError, readJson } from '@/lib/api';
import {
  SESSION_COOKIE,
  createSession,
  normalizeUsername,
  sessionCookieOptions,
  toPublicUser,
  verifyPassword,
} from '@/lib/auth';
import { db, type UserRow } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await readJson<{ username: string; password: string }>(request);
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';

    const user = db
      .prepare('SELECT * FROM users WHERE username_key = ?')
      .get(normalizeUsername(username)) as UserRow | undefined;

    /* One message for both "no such user" and "wrong password", so the response
       cannot be used to enumerate who has an account. */
    if (!user || !verifyPassword(password, user.password_hash)) {
      return jsonError('Incorrect username or password.', 401);
    }

    const { token } = createSession(user.id);
    const response = NextResponse.json({ user: toPublicUser(user) });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch (error) {
    return handleError(error);
  }
}
