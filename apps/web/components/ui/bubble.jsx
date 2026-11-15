'use client';

import { cn } from '../../lib/cn.js';

const VARIANTS = {
  secondary: '*:data-[slot=bubble-content]:bg-secondary *:data-[slot=bubble-content]:text-secondary-foreground',
  ghost: '*:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0',
};

export function Bubble({ variant = 'secondary', align = 'start', className, ...props }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(
        'group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end',
        VARIANTS[variant] || VARIANTS.secondary,
        className,
      )}
      {...props}
    />
  );
}

export function BubbleContent({ className, ...props }) {
  return (
    <div
      data-slot="bubble-content"
      className={cn(
        'w-fit max-w-full min-w-0 overflow-hidden rounded-3xl border border-transparent px-3 py-2.5 text-sm leading-relaxed wrap-break-word',
        className,
      )}
      {...props}
    />
  );
}
