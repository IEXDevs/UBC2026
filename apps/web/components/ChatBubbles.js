'use client';

import { useEffect, useRef } from 'react';
import { withHeads } from '../lib/voice-float.mjs';

export default function ChatBubbles({ lines, botName, className = '' }) {
  const tailRef = useRef(null);
  const rows = withHeads(lines);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [lines]);

  if (rows.length === 0) return null;

  return (
    <div className={`chat-log${className ? ` ${className}` : ''}`}>
      {rows.map((line, index) => (
        <div
          key={line.id}
          className={`chat-row${line.role === 'user' ? ' is-you' : ''}${line.head ? '' : ' is-follow'}${index === rows.length - 1 ? ' is-fresh' : ''}`}
        >
          <div className="chat-bubble">
            {line.head ? <small>{line.role === 'user' ? 'You' : botName}</small> : null}
            <p>{line.text}</p>
          </div>
        </div>
      ))}
      <span ref={tailRef} />
    </div>
  );
}
