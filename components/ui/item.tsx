'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from 'ui-web/lib/utils';

const itemVariants = cva(
  'flex w-full items-start gap-3 text-left transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline:
          'border border-transparent bg-background hover:bg-accent/35 focus-visible:bg-accent/35',
        muted: 'bg-muted/50 hover:bg-muted',
      },
      size: {
        default: 'rounded-lg px-4 py-3.5',
        sm: 'rounded-lg px-3 py-2.5',
        xs: 'rounded-md px-2.5 py-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function ItemGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-group"
      className={cn('flex flex-col', className)}
      {...props}
    />
  );
}

function ItemSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-separator"
      className={cn('bg-border h-px w-full', className)}
      {...props}
    />
  );
}

function Item({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof itemVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'div';

  return (
    <Comp
      data-slot="item"
      className={cn(itemVariants({ variant, size }), className)}
      {...props}
    />
  );
}

function ItemHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-header"
      className={cn(
        'text-muted-foreground px-2 text-[11px] font-semibold uppercase tracking-[0.18em]',
        className,
      )}
      {...props}
    />
  );
}

function ItemMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'icon' | 'image' | 'avatar';
}) {
  return (
    <div
      data-slot="item-media"
      className={cn(
        'shrink-0',
        variant === 'icon' &&
          'bg-muted/55 text-muted-foreground flex size-9 items-center justify-center rounded-md',
        variant === 'default' && 'pt-0.5',
        className,
      )}
      {...props}
    />
  );
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-content"
      className={cn('min-w-0 flex-1 space-y-1', className)}
      {...props}
    />
  );
}

function ItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-title"
      className={cn('text-sm font-medium leading-tight', className)}
      {...props}
    />
  );
}

function ItemDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-description"
      className={cn('text-muted-foreground text-xs leading-relaxed', className)}
      {...props}
    />
  );
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-actions"
      className={cn('flex shrink-0 items-center gap-2', className)}
      {...props}
    />
  );
}

function ItemFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-footer"
      className={cn('text-muted-foreground text-xs', className)}
      {...props}
    />
  );
}

export {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
};
