'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const drag = useRef(null);

  const push = useCallback((message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems(current => [...current, { id, message }].slice(-4));
    window.setTimeout(() => {
      setItems(current => current.filter(item => item.id !== id));
    }, 4200);
  }, []);

  function pointerDown(event, id) {
    drag.current = { id, x: event.clientX, dx: 0 };
  }

  function pointerMove(event) {
    if (!drag.current) return;
    drag.current.dx = event.clientX - drag.current.x;
    const node = document.querySelector(`[data-toast="${drag.current.id}"]`);
    if (node) node.style.transform = `translateX(${drag.current.dx}px)`;
  }

  function pointerUp() {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (Math.abs(current.dx) > 80) {
      setItems(list => list.filter(item => item.id !== current.id));
      return;
    }
    const node = document.querySelector(`[data-toast="${current.id}"]`);
    if (node) node.style.transform = '';
  }

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" onPointerMove={pointerMove} onPointerUp={pointerUp}>
        {items.map(item => (
          <p
            key={item.id}
            className="swipe-toast"
            data-toast={item.id}
            onPointerDown={event => pointerDown(event, item.id)}
          >
            {item.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
