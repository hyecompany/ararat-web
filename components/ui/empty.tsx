import * as React from 'react';

import { cn } from 'ui-web/lib/utils';

function Empty({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty"
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-4 rounded-md border border-dashed p-8 text-center',
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-header"
      className={cn('flex flex-col items-center gap-2', className)}
      {...props}
    />
  );
}

function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'icon';
}) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn(
        'flex items-center justify-center text-muted-foreground',
        variant === 'icon' && 'size-10 rounded-full bg-muted [&_svg]:size-5',
        className,
      )}
      {...props}
    />
  );
}

function EmptyTitle({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="empty-title"
      className={cn('text-sm font-medium', className)}
      {...props}
    />
  );
}

function EmptyDescription({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="empty-description"
      className={cn('max-w-sm text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function EmptyContent({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-content"
      className={cn('flex flex-col items-center gap-2', className)}
      {...props}
    />
  );
}

export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
};
