'use client';

import { useRef, useState } from 'react';
import { startBrowserDictation } from '../../lib/dictation.mjs';

export default function VoicePill({ onText }) {
  const [live, setLive] = useState(false);
  const [heard, setHeard] = useState('');
  const session = useRef(null);

  function stop() {
    session.current?.cancel?.();
    session.current = null;
    setLive(false);
  }

  function toggle() {
    if (live) {
      stop();
      return;
    }
    setHeard('');
    setLive(true);
    const job = startBrowserDictation();
    session.current = job;
    Promise.resolve(job).then(
      (text) => {
        if (session.current !== job) return;
        session.current = null;
        setLive(false);
        if (text) {
          setHeard(text);
          onText?.(text);
        }
      },
      () => {
        if (session.current === job) stop();
      },
    );
  }

  return (
    <button type="button" className={`voice-pill${live ? ' is-on' : ''}`} aria-pressed={live} aria-label={live ? (heard || 'Listening') : 'Dictate'} onClick={toggle}>
      <span className="voice-pill-bars" aria-hidden="true"><i /><i /><i /></span>
    </button>
  );
}
