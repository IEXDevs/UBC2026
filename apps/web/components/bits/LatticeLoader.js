'use client';

export default function LatticeLoader({ label = 'Thinking' }) {
  return (
    <span className="lattice" role="status" aria-label={label}>
      <span className="lattice-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ animationDelay: `${(index % 3) * 90 + Math.floor(index / 3) * 70}ms` }} />)}
      </span>
      <span>{label}</span>
    </span>
  );
}
