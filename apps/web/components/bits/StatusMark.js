'use client';

export default function StatusMark({ state = 'done', label = 'Tool' }) {
  return <span className={`status-mark is-${state}`} role="img" aria-label={`${label} ${state}`} />;
}
