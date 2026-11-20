import { Check, CircleAlert } from 'lucide-react';

export default function PasswordFeedback({ id, state = '', children }) {
  const Icon = state === 'ok' ? Check : CircleAlert;
  return (
    <p id={id} className={`password-feedback${state ? ` is-${state}` : ''}`} role="status" aria-live="polite" aria-atomic="true">
      {state ? <Icon size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
      <span>{children}</span>
    </p>
  );
}
