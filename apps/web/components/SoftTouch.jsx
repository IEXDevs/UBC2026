'use client';

import { useEffect } from 'react';
import './SoftTouch.css';

const SKIP = '.prompt-bar, .dock, .dock-item, .hold-button, .sling-button, .wake-slider, .stepper, .call-chip, .code-slots, .agent-pause, .swipe-toast, .ledger-hit';

export default function SoftTouch() {
  useEffect(() => {
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
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  return null;
}
