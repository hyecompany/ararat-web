'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const NORMALIZE_ATTEMPT_KEY = 'ararat:route-normalize-attempt';

export default function Router({ children }: { children: React.ReactNode }) {
  const runRef = useRef(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined' || runRef.current) return;

    runRef.current = true;

    const browserPathname = window.location.pathname;
    const withoutBasePath = browserPathname.startsWith('/ui')
      ? browserPathname.slice('/ui'.length) || '/'
      : browserPathname;

    const search = window.location.search;
    const targetPath = search ? `${withoutBasePath}${search}` : withoutBasePath;
    const currentPath = search ? `${pathname}${search}` : pathname;

    if (targetPath === currentPath) {
      try {
        sessionStorage.removeItem(NORMALIZE_ATTEMPT_KEY);
      } catch {
        // Ignore storage failures (private mode / blocked storage).
      }
      return;
    }

    try {
      const previousAttempt = sessionStorage.getItem(NORMALIZE_ATTEMPT_KEY);
      if (previousAttempt === targetPath) {
        return;
      }
      sessionStorage.setItem(NORMALIZE_ATTEMPT_KEY, targetPath);
    } catch {
      // Ignore storage failures and continue with a single in-memory attempt.
    }

    router.replace(targetPath);
  }, [pathname, router]);

  return <>{children}</>;
}
