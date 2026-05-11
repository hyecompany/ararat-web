'use client';

import * as React from 'react';
import { ViewTransition } from 'react';

import { cn } from 'ui-web/lib/utils';

type PageTransitionProps = {
  children: React.ReactNode;
  className?: string;
};

type ViewTransitionSurface = 'page' | 'dialog';

type KeyedTransitionProps = {
  children: React.ReactNode;
  transitionKey: React.Key;
  className?: string;
  enabled?: boolean;
  variant?: TabContentTransitionVariant;
};

type TabContentTransitionVariant =
  | 'default'
  | 'tab'
  | 'side-tab-body';

const tabContentTransitions = {
  default: {
    enter: {
      'nav-lateral': 'tab-content-enter',
      'tab-lateral': 'tab-content-enter',
      default: 'none',
    },
    exit: {
      'nav-lateral': 'tab-content-exit',
      'tab-lateral': 'tab-content-exit',
      default: 'none',
    },
  },
  tab: {
    enter: {
      'tab-next': 'tab-next-enter',
      'tab-prev': 'tab-prev-enter',
      default: 'none',
    },
    exit: {
      'tab-next': 'tab-next-exit',
      'tab-prev': 'tab-prev-exit',
      default: 'none',
    },
  },
  'side-tab-body': {
    enter: {
      'side-tab-select': 'side-tab-body-enter',
      default: 'none',
    },
    exit: {
      'side-tab-select': 'side-tab-body-exit',
      default: 'none',
    },
  },
} as const;

const ViewTransitionSurfaceContext =
  React.createContext<ViewTransitionSurface>('page');

function ViewTransitionSurfaceProvider({
  children,
  surface,
}: {
  children: React.ReactNode;
  surface: ViewTransitionSurface;
}) {
  return (
    <ViewTransitionSurfaceContext.Provider value={surface}>
      {children}
    </ViewTransitionSurfaceContext.Provider>
  );
}

function useViewTransitionSurface() {
  return React.useContext(ViewTransitionSurfaceContext);
}

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

function TabContentTransition({
  children,
  transitionKey,
  className,
  enabled = true,
  variant = 'default',
}: KeyedTransitionProps) {
  const hydrated = useHydrated();
  const surface = useViewTransitionSurface();
  const useLocalTransition = surface === 'dialog' && enabled;
  const content = (
    <div
      key={useLocalTransition ? transitionKey : undefined}
      className={cn(
        'min-h-0 min-w-0',
        useLocalTransition && 'local-tab-content-enter',
        className,
      )}
    >
      {children}
    </div>
  );
  const transition = tabContentTransitions[variant];

  if (!hydrated || !enabled || useLocalTransition) {
    return content;
  }

  return (
    <ViewTransition
      key={transitionKey}
      enter={transition.enter}
      exit={transition.exit}
      default="none"
    >
      {content}
    </ViewTransition>
  );
}

function ListItemTransition({
  children,
  transitionKey,
  enabled = true,
}: KeyedTransitionProps) {
  const hydrated = useHydrated();
  const surface = useViewTransitionSurface();

  if (!hydrated || !enabled || surface === 'dialog') {
    return <>{children}</>;
  }

  return (
    <ViewTransition
      key={transitionKey}
      enter="list-item-enter"
      exit="list-item-exit"
      default="none"
    >
      {children}
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

export {
  ListItemTransition,
  PageTransition,
  SuspenseFallback,
  SuspenseReveal,
  TabContentTransition,
  ViewTransitionSurfaceProvider,
};
