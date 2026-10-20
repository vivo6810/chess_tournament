'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ADMIN_HINT_COOKIE } from '@/lib/admin';

/**
 * The way into `/lab`.
 *
 * The lab is a hidden route: it answers 404 to everyone who is not the built-in
 * admin, so it should not sit in the navigation for everyone either. The header
 * is a client component and the session cookie is httpOnly, so the only thing it
 * can read is the readable hint cookie the login route sets for the admin — see
 * `ADMIN_HINT_COOKIE`. Nothing is authorised by it: if it is missing the link is
 * hidden, and if it is forged the link only leads to a 404.
 *
 * It starts hidden and appears after mount, because the server has no way to
 * render the same answer and a mismatch would hydrate wrong.
 */
export default function AdminLink({
  className = '',
  asListItem = false,
}: {
  className?: string;
  asListItem?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  /* The header survives client-side navigation, so signing in would otherwise
     not reveal it: the login response sets the cookie after this component has
     already mounted. Re-reading on every route change is the cheap fix. */
  const pathname = usePathname();

  useEffect(() => {
    const hint = `${ADMIN_HINT_COOKIE}=1`;
    setVisible(
      document.cookie
        .split(';')
        .some((part) => part.trim() === hint),
    );
  }, [pathname]);

  if (!visible) return null;

  const link = (
    <Link href="/lab" className={className}>
      Test lab
    </Link>
  );

  /* The mobile menu is a list, and a list item that is only sometimes there
     should not leave an empty `<li>` behind when it is not. */
  return asListItem ? <li>{link}</li> : link;
}
