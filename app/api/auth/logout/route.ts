import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ADMIN_HINT_COOKIE } from '@/lib/admin';
import { SESSION_COOKIE, destroySession } from '@/lib/auth';
import { handleError } from '@/lib/api';

export async function POST() {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    // Delete the row as well as the cookie: clearing the cookie alone would
    // leave a valid session token usable by anyone who had captured it.
    if (token) destroySession(token);

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    response.cookies.set(ADMIN_HINT_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return handleError(error);
  }
}
