'use client';

import * as React from 'react';
import { ViewTransition, addTransitionType, startTransition } from 'react';

import type { ResourceStatus } from '@/app/_incus/types';
import {
  isUnavailableResourceStatus,
  isStaleResourceStatus,
} from '@/app/_incus/status';
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
  immediateViews?: LoadableView[];
  transitionEnter?: Record<string, string>;
  transitionExit?: Record<string, string>;
  className?: string;
};

type LoadableView = 'skeleton' | 'empty' | 'error' | 'content';

const DEFAULT_IMMEDIATE_VIEWS: LoadableView[] = [];

function getLoadableView({
  status,
  hasData,
}: {
  status: ResourceStatus;
  hasData: boolean;
}): LoadableView {
  if (hasData) return 'content';
  if (isUnavailableResourceStatus(status) || isStaleResourceStatus(status)) {
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
  immediateViews = DEFAULT_IMMEDIATE_VIEWS,
  transitionEnter,
  transitionExit,
  className,
}: LoadableSurfaceProps) {
  const [hydrated, setHydrated] = React.useState(false);
  const view = getLoadableView({ status, hasData });
  const [displayedView, setDisplayedView] = React.useState(view);
  const latestViewRef = React.useRef(view);
  const latestContentRef = React.useRef(children);
  latestViewRef.current = view;

  if (view === 'content') {
    latestContentRef.current = children;
  }

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (displayedView === view) return;
    const targetView = view;

    if (immediateViews.includes(targetView)) {
      setDisplayedView(targetView);
      return;
    }

    // React ViewTransition only runs for transition updates. Keep cache updates
    // immediate, then transition just the lifecycle view handoff when the app
    // truly moves between skeleton/content/empty/error. The explicit transition
    // type prevents route changes from fading cached content that never showed a
    // skeleton in the first place.
    let cancelled = false;
    startTransition(() => {
      if (cancelled || latestViewRef.current !== targetView) return;
      addTransitionType('loadable-swap');
      setDisplayedView(targetView);
    });
    return () => {
      cancelled = true;
    };
  }, [displayedView, immediateViews, view]);

  /**
   * Keep the last content branch alive while transitioning away from content.
   * File/resource tables often derive their rows from the newly selected cache
   * key before the loading surface has swapped, which otherwise produces a
   * one-frame local "No results" render between old content and skeleton/empty.
   */
  const renderedView = immediateViews.includes(view) ? view : displayedView;

  const contentForRenderedView =
    renderedView === 'skeleton'
      ? skeleton
      : renderedView === 'error'
        ? (error ?? empty)
        : renderedView === 'empty'
          ? empty
          : view === 'content'
            ? children
            : latestContentRef.current;

  const stage = (
    <div
      className="loadable-surface__stage"
      data-loadable-view={renderedView}
    >
      {contentForRenderedView}
    </div>
  );

  const content = freshness && renderedView === 'content' ? (
    <FreshnessSurface status={status}>{stage}</FreshnessSurface>
  ) : (
    stage
  );

  const vtProps = {
    default: 'none',
    enter: {
      ...transitionEnter,
      'loadable-swap': 'loadable-reveal',
      default: 'none',
    },
    exit: {
      ...transitionExit,
      'loadable-swap': 'loadable-exit',
      default: 'none',
    },
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

  if (renderedView === view) {
    return (
      <ViewTransition key={renderedView} {...vtProps}>
        {surface}
      </ViewTransition>
    );
  }

  // While waiting for the transition update, keep rendering the last stable
  // view. The content branch is snapshotted above so newly selected cache keys
  // cannot briefly render a child-level empty state before the surface swaps.
  return (
    <ViewTransition key={renderedView} {...vtProps}>
      {surface}
    </ViewTransition>
  );
}

export { LoadableSurface };
