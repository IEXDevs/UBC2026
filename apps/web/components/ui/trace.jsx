'use client';

import { createContext, useContext, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const OpenContext = createContext(null);

export function Trace({ className, ...props }) {
  return (
    <div
      data-slot="trace"
      className={cn('flex w-full min-w-0 flex-col gap-2 text-sm', className)}
      {...props}
    />
  );
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

export function TraceIcon({ className, ...props }) {
  return (
    <span
      data-slot="trace-icon"
      aria-hidden="true"
      className={cn('flex size-4 shrink-0 items-center justify-center [&_svg]:size-4', className)}
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

export function TraceCollapsible({
  className,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}) {
  const [local, setLocal] = useState(Boolean(defaultOpen));
  const expanded = typeof open === 'boolean' ? open : local;
  const setExpanded = (next) => {
    if (typeof open !== 'boolean') setLocal(next);
    onOpenChange?.(next);
  };
  return (
    <OpenContext.Provider value={{ expanded, setExpanded }}>
      <div
        data-slot="trace-collapsible"
        data-state={expanded ? 'open' : 'closed'}
        className={cn('flex w-full min-w-0 flex-col', className)}
        {...props}
      >
        {children}
      </div>
    </OpenContext.Provider>
  );
}

export function TraceCollapsibleTrigger({ className, children, ...props }) {
  const ctx = useContext(OpenContext);
  return (
    <button
      type="button"
      data-slot="trace-collapsible-trigger"
      aria-expanded={Boolean(ctx?.expanded)}
      className={cn(
        'group/trace-collapsible-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md text-left text-muted-foreground hover:text-foreground',
        className,
      )}
      onClick={() => ctx?.setExpanded(!ctx.expanded)}
      {...props}
    >
      {children}
      <ChevronRight
        className={cn('size-3.5 shrink-0 transition-transform duration-200', ctx?.expanded && 'rotate-90')}
      />
    </button>
  );
}

export function TraceCollapsibleContent({ className, children, ...props }) {
  const ctx = useContext(OpenContext);
  if (!ctx?.expanded) return null;
  return (
    <div
      data-slot="trace-collapsible-content"
      className={cn(
        'mt-2 mb-1 ml-[7px] min-w-0 border-l border-border pr-1 pl-4 text-sm leading-relaxed wrap-break-word text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
