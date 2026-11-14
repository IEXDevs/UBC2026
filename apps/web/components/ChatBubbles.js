'use client';

import { useEffect, useRef } from 'react';
import { withHeads } from '../lib/voice-float.mjs';
import ThinkingDots from './ThinkingDots';

export default function ChatBubbles({ lines, botName, className = '', thinking = false }) {
  const tailRef = useRef(null);
  const rows = withHeads(lines);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [lines, thinking]);

  if (rows.length === 0 && !thinking) return null;

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
      {thinking ? (
        <div className="chat-row">
          <div className="chat-bubble is-think">
            <small>{botName}</small>
            <ThinkingDots />
          </div>
        </div>
      ) : null}
      <span ref={tailRef} />
    </div>
  );
}
