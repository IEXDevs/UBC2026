'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { loopStepsFromRun } from '../lib/loop-steps.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import LiveViewPanel from './LiveViewPanel';
import LoopSteps from './LoopSteps';
import { usePresence } from './usePresence';

export default function ComputerSheet({ open, onClose, bot, ownerId = null }) {
  const { mounted, leaving } = usePresence(open, 180);
  const [shown, setShown] = useState(false);
  const [steps, setSteps] = useState(() => loopStepsFromRun(null));
  const [loopNote, setLoopNote] = useState('');
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    if (!mounted) {
      setShown(false);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [mounted, onClose]);

  useEffect(() => {
    if (!mounted || !bot?.id) return undefined;
    const url = shellRuntimeUrl(`/bots/${encodeURIComponent(bot.id)}/status`);
    if (!ownerId || !url) {
      setSteps(loopStepsFromRun(null));
      setLoopNote(ownerId ? 'This bot id cannot be loaded from the runtime.' : 'Sign in to load this bot’s loop.');
      return undefined;
    }
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: { 'x-owner-id': ownerId },
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (stop) return;
        if (!response.ok) {
          setHasRun(false);
          setLoopNote('Could not load the loop from the Worker.');
          return;
        }
        setSteps(loopStepsFromRun(data.run));
        setHasRun(Boolean(data.run));
        setLoopNote('');
      } catch {
        if (!stop) setLoopNote('Could not reach the Worker for the loop.');
      }
    }
    load();
    const timer = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [mounted, bot?.id, ownerId]);

  if (!mounted || !bot || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`browser-preview${shown && !leaving ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${bot.name} computer`}
      onMouseDown={onClose}
    >
      <button type="button" className="browser-preview-close" aria-label="Close computer" onMouseDown={event => event.stopPropagation()} onClick={onClose}>
        <X size={18} strokeWidth={1.75} />
      </button>
      <div className="browser-preview-stage" onMouseDown={event => event.stopPropagation()}>
        {hasRun ? <LoopSteps steps={steps} note={loopNote} /> : null}
        <LiveViewPanel botId={bot.id} ownerId={ownerId} fill autoStart />
      </div>
    </div>,
    document.body,
  );
}
