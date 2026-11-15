'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import MentionText from '../MentionText';
import StatusMark from './StatusMark';

export default function ThoughtLine({ text, tool = false, state = 'done', onParty }) {
  const [open, setOpen] = useState(false);
  const body = typeof text === 'string' ? text : '';

  function toggle(event) {
    if (event.target.closest('button.party-link')) return;
    setOpen(value => !value);
  }

  return (
    <div className={`thought-line${open ? ' is-open' : ''}${tool ? ' is-tool' : ''}`}>
      <button type="button" className="thought-line-hit" aria-expanded={open} aria-label={open ? 'Collapse thought' : 'Expand thought'} onClick={() => setOpen(value => !value)}>
        {tool ? <StatusMark state={state} label="Tool call" /> : <span className="thought-dot" aria-hidden="true" />}
        <ChevronRight size={14} strokeWidth={1.75} />
      </button>
      <div className="thought-line-body" onClick={toggle}>
        <MentionText text={body} onParty={onParty} />
      </div>
    </div>
  );
}
