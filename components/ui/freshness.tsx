'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import type { ResourceStatus } from '@/app/_incus/types';
import { isStaleResourceStatus } from '@/app/_incus/status';
import { cn } from '@/lib/utils';

function freshnessState(status?: ResourceStatus | boolean) {
  if (status === true) return 'refreshing';
  if (status && isStaleResourceStatus(status)) return 'refreshing';
  return 'ready';
}

function FreshnessSurface({
  status,
  active,
  asChild,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  status?: ResourceStatus;
  active?: boolean;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : 'div';
  const state = freshnessState(active ?? status);

  return (
    <Comp
      data-freshness={state}
      aria-busy={state === 'refreshing' || undefined}
      className={cn('freshness-surface', className)}
      {...props}
    />
  );
}

function StaleShimmer({
  active,
  asChild,
  className,
  ...props
}: React.ComponentProps<'span'> & {
  active?: boolean;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp
      data-freshness={active ? 'refreshing' : 'ready'}
      className={cn(active && 'freshness-shimmer rounded-sm', className)}
      {...props}
    />
  );
}

export { FreshnessSurface, StaleShimmer };
