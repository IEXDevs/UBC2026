'use client';

import { useEffect } from 'react';
import './SoftTouch.css';

const SKIP = '.prompt-bar, .dock, .dock-item, .hold-button, .sling-button, .wake-slider, .stepper, .call-chip, .code-slots, .agent-pause, .swipe-toast, .ledger-hit';

export default function SoftTouch() {
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let pressed = null;

    const eligible = (node) => {
      if (!(node instanceof Element)) return null;
      if (node.closest('input, textarea, select, [contenteditable="true"]')) return null;
      const button = node.closest('button');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
      if (button.closest(SKIP)) return null;
      if (button.style.transform) return null;
      if (button.querySelector('input, textarea, select')) return null;
      return button;
    };

    const clearPop = (button) => {
      button.removeAttribute('data-pop');
      button.removeEventListener('animationend', button.__softDone);
      button.__softDone = null;
    };

    const sheen = (button) => {
      if (motion.matches || !button.isConnected) return;
      clearPop(button);
      if (getComputedStyle(button).position === 'static') button.setAttribute('data-pop-shift', '');
      void button.offsetWidth;
      button.setAttribute('data-pop', '');
      const done = (event) => {
        if (event.animationName !== 'soft-sheen') return;
        clearPop(button);
      };
      button.__softDone = done;
      button.addEventListener('animationend', done);
      window.setTimeout(() => {
        if (button.getAttribute('data-pop') != null) clearPop(button);
      }, 700);
    };

    const release = () => {
      pressed = null;
    };

    const onDown = (event) => {
      if (event.button != null && event.button !== 0) return;
      pressed = eligible(event.target);
    };

    const onUp = (event) => {
      const button = pressed;
      pressed = null;
      if (!button) return;
      if (event.type === 'pointercancel') return;
      sheen(button);
    };

    const onKeyDown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.repeat) return;
      const button = eligible(event.target);
      if (!button || document.activeElement !== button) return;
      button.setAttribute('data-press', '');
    };

    const onKeyUp = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button) return;
      button.removeAttribute('data-press');
      if (eligible(button)) sheen(button);
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', release, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  return null;
}
