'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ADMIN_HINT_COOKIE } from '@/lib/admin';

type HintedRole = 'admin' | 'owner' | null;

function readRole(): HintedRole {
  const prefix = `${ADMIN_HINT_COOKIE}=`;
  const part = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!part) return null;

  const value = part.slice(prefix.length);
  if (value === 'owner') return 'owner';
  /* '1' is the value the first version of this cookie used; treat it as admin so
     a session that predates roles still gets its link. */
  if (value === 'admin' || value === '1') return 'admin';
  return null;
}

/**
 * The way into `/lab` and `/owner`.
 *
 * Both routes answer 404 to anyone whose role does not match, so they do not
 * belong in the navigation for everyone. The header is a client component and
 * the session cookie is httpOnly, so the only thing it can read is the readable
 * role hint the login route sets — see `ADMIN_HINT_COOKIE`. Nothing is
 * authorised by it: a forged value reveals links and then a 404.
 *
 * It starts empty and appears after mount, because the server cannot render the
 * same answer and a mismatch would hydrate wrong. It re-reads on navigation:
 * the header survives a client-side sign-in, so the effect that ran on `/login`
 * would otherwise never see the cookie that login just set.
 */
export default function RoleLinks({
  className = '',
  asListItem = false,
}: {
  className?: string;
  asListItem?: boolean;
}) {
  const [role, setRole] = useState<HintedRole>(null);
  const pathname = usePathname();

  useEffect(() => {
    setRole(readRole());
  }, [pathname]);

  if (!role) return null;

  const links =
    role === 'owner'
      ? [
          { href: '/lab', label: 'Test lab' },
          { href: '/owner', label: 'Owner' },
        ]
      : [{ href: '/lab', label: 'Test lab' }];

  if (asListItem) {
    return (
      <>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={className}>
              {link.label}
            </Link>
          </li>
        ))}
      </>
    );
  }

  return (
    <>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={className}>
          {link.label}
        </Link>
      ))}
    </>
  );
}
