'use client';

import * as React from 'react';
import { ViewTransition } from 'react';

import { cn } from 'ui-web/lib/utils';

type PageTransitionProps = {
  children: React.ReactNode;
  className?: string;
};

function useHydrated() {
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}

/**
 * Route pages opt into directional view transitions here instead of each page
 * inventing its own animation. Untyped navigations intentionally do nothing, so
 * initial renders and cache-backed pages do not fade just because they mounted.
 */
function PageTransition({ children, className }: PageTransitionProps) {
  const hydrated = useHydrated();
  const content = <div className={cn('min-w-0', className)}>{children}</div>;

  if (!hydrated) {
    return content;
  }

  return (
    <ViewTransition
      enter={{
        'nav-forward': 'nav-forward',
        'nav-back': 'nav-back',
        'nav-lateral': 'nav-lateral',
        default: 'none',
      }}
      exit={{
        'nav-forward': 'nav-forward',
        'nav-back': 'nav-back',
        'nav-lateral': 'nav-lateral',
        default: 'none',
      }}
      default="none"
    >
      {content}
    </ViewTransition>
  );
}

type SuspenseRevealProps = {
  children: React.ReactNode;
};

/**
 * Suspense reveals use a separate transition type from route navigation. This
 * avoids the white-frame feeling when a route suspends while still keeping
 * already-cached content instant.
 */
function SuspenseReveal({ children }: SuspenseRevealProps) {
  const hydrated = useHydrated();
  if (!hydrated) return children;

  return (
    <ViewTransition enter="slide-up" default="none">
      {children}
    </ViewTransition>
  );
}

function SuspenseFallback({ children }: SuspenseRevealProps) {
  const hydrated = useHydrated();
  if (!hydrated) return children;

  return (
    <ViewTransition exit="slide-down" default="none">
      {children}
    </ViewTransition>
  );
}

export { PageTransition, SuspenseFallback, SuspenseReveal };
