'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { rateLimitCopy, requestUrl } from '../../lib/dex-token.mjs';
import './SwipeToast.css';

const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

function SwipeCard({ title, description, duration = 4000, closeButton = false, fuseColor = '#f5a524', onClose }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const drag = useRef(null);
  const remain = useRef(duration);
  const started = useRef(Date.now());
  const timer = useRef(null);
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const finish = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    clearTimeout(timer.current);
    setLeaving(true);
    window.setTimeout(() => onCloseRef.current?.(), 280);
  }, []);

  useEffect(() => {
    started.current = Date.now();
    remain.current = duration;
    timer.current = window.setTimeout(finish, duration);
    return () => clearTimeout(timer.current);
  }, [duration, finish]);

  function pause() {
    if (paused || closed.current) return;
    setPaused(true);
    clearTimeout(timer.current);
    remain.current = Math.max(0, remain.current - (Date.now() - started.current));
  }

  function resume() {
    if (!paused || closed.current) return;
    setPaused(false);
    started.current = Date.now();
    timer.current = window.setTimeout(finish, remain.current);
  }

  function pointerDown(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    drag.current = { y: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, event.clientY - drag.current.y);
    event.currentTarget.style.transform = `translateY(${drag.current.dy}px)`;
  }

  function pointerUp(event) {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (current.dy > 40) {
      finish();
      return;
    }
    event.currentTarget.style.transform = '';
  }

  return (
    <div
      className={`swipe-toast${leaving ? ' is-leaving' : ''}${paused ? ' is-paused' : ''}`}
      style={{ '--st-duration': `${duration}ms`, '--st-fuse': fuseColor }}
      role="status"
    >
      <div className="swipe-toast__lift">
        <div
          className="swipe-toast__card"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onMouseEnter={pause}
          onMouseLeave={resume}
          onKeyDown={event => {
            if (event.key === 'Escape') finish();
          }}
          tabIndex={0}
        >
          <span className="swipe-toast__body">
            <span className="swipe-toast__title">{title}</span>
            {description ? <span className="swipe-toast__desc">{description}</span> : null}
          </span>
          {closeButton ? (
            <button type="button" className="swipe-toast__close" aria-label="Dismiss" onClick={finish}>
              ×
            </button>
          ) : null}
          <span className="swipe-toast__fuse" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const pushRef = useRef(null);

  const remove = useCallback((id) => {
    setItems(current => current.filter(item => item.id !== id));
  }, []);

  const push = useCallback((message) => {
    const item = typeof message === 'string'
      ? { title: message, description: '' }
      : {
        id: message?.id,
        title: message?.title || 'Notice',
        description: message?.description || '',
        duration: message?.duration,
        closeButton: message?.closeButton === true,
        fuseColor: message?.fuseColor,
      };
    const id = item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems(current => {
      if (current.some(row => row.id === id)) return current;
      return [...current, { ...item, id }].slice(-4);
    });
  }, []);

  pushRef.current = push;

  useEffect(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (response?.status === 429) pushRef.current?.(rateLimitCopy(requestUrl(args[0])));
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack">
        {items.map(item => (
          <SwipeCard
            key={item.id}
            title={item.title}
            description={item.description}
            duration={item.duration || 4000}
            closeButton={item.closeButton}
            fuseColor={item.fuseColor}
            onClose={() => remove(item.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
