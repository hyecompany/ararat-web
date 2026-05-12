import { cn } from '@/lib/utils';

function Skeleton({
  className,
  shimmer = true,
  ...props
}: React.ComponentProps<'div'> & {
  shimmer?: boolean;
}) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        'bg-accent rounded-md',
        shimmer && 'freshness-shimmer',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
