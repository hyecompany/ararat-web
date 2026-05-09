'use client';

import * as React from 'react';
import { ViewTransition, addTransitionType, startTransition } from 'react';

import type { ResourceStatus } from '@/app/_incus/types';
import { FreshnessSurface } from './freshness';
import { cn } from 'ui-web/lib/utils';

type LoadableSurfaceProps = {
  status: ResourceStatus;
  hasData: boolean;
  skeleton: React.ReactNode;
  empty?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  freshness?: boolean;
  transitionMs?: number;
  className?: string;
};

type LoadableView = 'skeleton' | 'empty' | 'error' | 'content';

function getLoadableView({
  status,
  hasData,
}: {
  status: ResourceStatus;
  hasData: boolean;
}): LoadableView {
  if (hasData) return 'content';
  if (
    status === 'missing' ||
    status === 'loading' ||
    status === 'stale' ||
    status === 'refreshing'
  ) {
    return 'skeleton';
  }
  if (status === 'error') return 'error';
  return 'empty';
}

function LoadableSurface({
  status,
  hasData,
  skeleton,
  empty = null,
  error,
  children,
  freshness = false,
  transitionMs = 140,
  className,
}: LoadableSurfaceProps) {
  const [hydrated, setHydrated] = React.useState(false);
  const view = getLoadableView({ status, hasData });
  const [displayedView, setDisplayedView] = React.useState(view);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (displayedView === view) return;

    // React ViewTransition only runs for transition updates. Keep cache updates
    // immediate, then transition just the lifecycle view handoff when the app
    // truly moves between skeleton/content/empty/error. The explicit transition
    // type prevents route changes from fading cached content that never showed a
    // skeleton in the first place.
    startTransition(() => {
      addTransitionType('loadable-swap');
      setDisplayedView(view);
    });
  }, [displayedView, view]);

  const contentForDisplayedView =
    displayedView === 'skeleton'
      ? skeleton
      : displayedView === 'error'
        ? (error ?? empty)
        : displayedView === 'empty'
          ? empty
          : children;

  const stage = (
    <div
      className="loadable-surface__stage"
      data-loadable-view={displayedView}
    >
      {contentForDisplayedView}
    </div>
  );

  const content = freshness && displayedView === 'content' ? (
    <FreshnessSurface status={status}>{stage}</FreshnessSurface>
  ) : (
    stage
  );

  const vtProps = {
    default: 'none',
    enter: { 'loadable-swap': 'loadable-reveal', default: 'none' },
    exit: { 'loadable-swap': 'loadable-exit', default: 'none' },
  } as const;

  const surface = (
    <div
      className={cn('loadable-surface', className)}
      data-loadable-state={status}
      suppressHydrationWarning
      style={
        {
          '--loadable-transition-ms': `${transitionMs}ms`,
        } as React.CSSProperties
      }
    >
      {content}
    </div>
  );

  if (!hydrated) {
    return surface;
  }

  if (displayedView === view) {
    return (
      <ViewTransition key={displayedView} {...vtProps}>
        {surface}
      </ViewTransition>
    );
  }

  // While waiting for the transition update, keep rendering the previous view.
  // This avoids flashing an empty space between a fetch resolving and React
  // committing the view-transition handoff.
  return (
    <ViewTransition key={displayedView} {...vtProps}>
      {surface}
    </ViewTransition>
  );
}

export { LoadableSurface };
