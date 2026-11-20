'use client';

import { X } from 'lucide-react';

export default function ModalClose({ onClick, label = 'Close', className = '', onMouseDown }) {
  return (
    <button type="button" className={`icon-btn modal-close ${className}`.trim()} aria-label={label} onClick={onClick} onMouseDown={onMouseDown}>
      <X size={18} strokeWidth={1.75} />
    </button>
  );
}
