'use client';

import { cn } from '../../lib/cn.js';

export function Trace({ className, ...props }) {
  return <div data-slot="trace" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />;
}

export function TraceLine({ className, status, ...props }) {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn(
        'flex w-fit max-w-full min-w-0 items-center gap-2 text-sm text-muted-foreground data-[status=error]:text-destructive data-[status=pending]:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export function TraceTitle({ className, ...props }) {
  return <span data-slot="trace-title" className={cn('min-w-0 truncate', className)} {...props} />;
}

export function TraceDescription({ className, ...props }) {
  return (
    <span data-slot="trace-description" className={cn('shrink-0 text-muted-foreground/70 tabular-nums', className)} {...props} />
  );
}
