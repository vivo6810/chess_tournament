import { NextResponse } from 'next/server';

import { getCurrentUser, type PublicUser } from './auth';
import { ServiceError } from './service';

export const jsonError = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function readJson<T>(request: Request): Promise<Partial<T>> {
  try {
    return ((await request.json()) as Partial<T>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Discriminated result rather than a thrown redirect, so each handler decides
 * how a missing session maps to a response.
 */
export async function requireUser(): Promise<{ user: PublicUser } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: jsonError('Sign in to do that.', 401) };
  return { user };
}

export function handleError(error: unknown): NextResponse {
  if (error instanceof ServiceError) return jsonError(error.message, 400);
  console.error('[api]', error);
  return jsonError('Something went wrong on our end.', 500);
}

export const parseId = (value: string | undefined): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
