'use client';

import { useState } from 'react';
import { profileInitials } from '@ubc2026/contracts';

export default function ProfileMark({ src, label, className = 'you-mark' }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img className={className} src={src} alt="" onError={() => setFailed(true)} />;
  }
  return <span className={className} aria-hidden="true">{profileInitials(label)}</span>;
}
