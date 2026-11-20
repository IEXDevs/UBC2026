'use client';

import AddressText from './AddressText';

export default function TxnPreview({ preview, folded = false, onToggle }) {
  if (!preview) return null;
  if (folded) {
    return (
      <button type="button" className="txn-preview is-min" onClick={onToggle}>
        {preview.title}
      </button>
    );
  }
  return (
    <section className="txn-preview" aria-label="Transaction preview">
      <h3>{preview.title}</h3>
      <dl>
        {preview.lines.map(row => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd><AddressText text={row.value} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
