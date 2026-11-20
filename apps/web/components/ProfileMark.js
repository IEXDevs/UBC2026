'use client';

import { useState } from 'react';
import { profileInitials } from '@ubc2026/contracts';

export default function ProfileMark({ src, label, className = 'you-mark' }) {
  const [failedSrc, setFailedSrc] = useState(null);
  if (src && failedSrc !== src) {
    return <img className={className} src={src} alt="" onError={() => setFailedSrc(src)} />;
  }
  return <span className={className} aria-hidden="true">{profileInitials(label)}</span>;
}
