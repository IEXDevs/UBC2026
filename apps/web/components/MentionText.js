'use client';

import { partyFromToken } from '../lib/party-book.mjs';

const SPLIT = /(@[A-Za-z0-9][A-Za-z0-9_.-]{0,80})/g;

export default function MentionText({ text, onParty }) {
  const source = typeof text === 'string' ? text : '';
  const parts = source.split(SPLIT);
  return parts.map((part, index) => {
    const party = partyFromToken(part);
    if (!party || typeof onParty !== 'function') return <span key={index}>{part}</span>;
    return (
      <button key={index} type="button" className="party-link" onClick={() => onParty(party)}>
        {part}
      </button>
    );
  });
}
