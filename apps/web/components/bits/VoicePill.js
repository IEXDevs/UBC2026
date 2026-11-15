'use client';

import { useRef, useState } from 'react';

export default function VoicePill({ onText }) {
  const [live, setLive] = useState(false);
  const [heard, setHeard] = useState('');
  const session = useRef(null);

  function stop() {
    session.current?.stop?.();
    session.current = null;
    setLive(false);
  }

  function toggle() {
    if (live) {
      stop();
      return;
    }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) return;
    const recognition = new Speech();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = [...event.results].map(result => result[0]?.transcript || '').join(' ').trim();
      setHeard(text);
      if ([...event.results].some(result => result.isFinal) && text) onText?.(text);
    };
    recognition.onend = () => {
      setLive(false);
      session.current = null;
    };
    recognition.onerror = () => stop();
    session.current = recognition;
    setHeard('');
    setLive(true);
    recognition.start();
  }

  return (
    <button type="button" className={`voice-pill${live ? ' is-on' : ''}`} aria-pressed={live} aria-label={live ? (heard || 'Listening') : 'Voice'} onClick={toggle}>
      <span className="voice-pill-bars" aria-hidden="true"><i /><i /><i /></span>
    </button>
  );
}
