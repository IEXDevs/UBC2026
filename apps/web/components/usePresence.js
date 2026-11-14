'use client';

import { useEffect, useState } from 'react';

export function usePresence(open, ms = 420) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return undefined;
    }
    if (!mounted) return undefined;
    setLeaving(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, ms);
    return () => clearTimeout(timer);
  }, [open, mounted, ms]);

  return { mounted, leaving };
}
