'use client';

export default function ThinkingDots({ label = 'Thinking' }) {
  return (
    <span className="think-dots" role="status" aria-label={label}>
      <span className="think-squares" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>{label}</span>
    </span>
  );
}
