'use client';

import { Check } from 'lucide-react';

export default function SpringCheck({ label = 'Updated' }) {
  return (
    <span className="spring-check" role="status" aria-label={label}>
      <Check size={14} strokeWidth={2.25} />
    </span>
  );
}
