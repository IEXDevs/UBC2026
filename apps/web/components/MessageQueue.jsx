'use client';

import { useEffect, useRef } from 'react';

export default function MessageQueue({ items, onEdit, onSendNow }) {
  const scroller = useRef(null);
  const count = Array.isArray(items) ? items.length : 0;

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [count]);

  if (count === 0) return null;

  return (
    <div ref={scroller} className="message-queue" role="list" aria-label="Queued messages">
      {items.map((item) => (
        <div key={item.id} className="message-queue-row" role="listitem">
          <p className="message-queue-text" title={item.text}>{item.text}</p>
          <button type="button" className="message-queue-edit" onClick={() => onEdit?.(item.id)}>
            Edit
          </button>
          <button type="button" className="message-queue-send" onClick={() => onSendNow?.(item.id)}>
            Send now
          </button>
        </div>
      ))}
    </div>
  );
}
