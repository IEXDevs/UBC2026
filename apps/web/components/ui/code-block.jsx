'use client';

import { cn } from '../../lib/cn.js';

export function CodeBlock({ className, size = 'default', variant = 'default', ...props }) {
  return (
    <div
      data-slot="code-block"
      data-size={size}
      data-variant={variant}
      className={cn(
        'relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-sm text-foreground',
        size === 'sm' && 'text-xs',
        variant === 'destructive' && 'border-destructive/40 text-destructive',
        className,
      )}
      {...props}
    />
  );
}

export function CodeBlockContent({ className, children, wrap = false, ...props }) {
  return (
    <pre
      data-slot="code-block-content"
      data-wrap={wrap || undefined}
      className={cn(
        'm-0 min-w-0 overflow-auto px-3 py-3 text-start font-mono leading-relaxed outline-none',
        wrap && 'whitespace-pre-wrap wrap-break-word',
        className,
      )}
      {...props}
    >
      <code>{children}</code>
    </pre>
  );
}
