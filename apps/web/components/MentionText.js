'use client';

import { AGENT_SKILLS, AVAILABLE_SKILLS } from '@ubc2026/agent-tools';
import { partyFromToken } from '../lib/party-book.mjs';

const SPLIT = /(@[A-Za-z0-9][A-Za-z0-9_.-]{0,80})/g;
const SLASH_TOKEN = /(^|\s)(\/[a-z0-9-]+)/gi;
const COMMANDS = new Set(
  [...AGENT_SKILLS, ...AVAILABLE_SKILLS].map(skill => skill.command.toLowerCase()),
);

function paintSlash(text, keyPrefix) {
  const value = typeof text === 'string' ? text : '';
  const nodes = [];
  let last = 0;
  let match;
  SLASH_TOKEN.lastIndex = 0;
  while ((match = SLASH_TOKEN.exec(value))) {
    const at = match.index + match[1].length;
    if (at > last) nodes.push(<span key={`${keyPrefix}-t-${last}`}>{value.slice(last, at)}</span>);
    const token = match[2].toLowerCase();
    nodes.push(COMMANDS.has(token)
      ? <span key={`${keyPrefix}-s-${at}`} className="slash-token">{match[2]}</span>
      : <span key={`${keyPrefix}-s-${at}`}>{match[2]}</span>);
    last = at + match[2].length;
  }
  if (last < value.length) nodes.push(<span key={`${keyPrefix}-t-${last}`}>{value.slice(last)}</span>);
  return nodes;
}

export default function MentionText({ text, onParty }) {
  const source = typeof text === 'string' ? text : '';
  const parts = source.split(SPLIT);
  return parts.map((part, index) => {
    const party = index % 2 === 1 ? partyFromToken(part) : null;
    if (!party || typeof onParty !== 'function') return <span key={index}>{paintSlash(part, index)}</span>;
    return (
      <button key={index} type="button" className="party-link" onClick={() => onParty(party)}>
        {part}
      </button>
    );
  });
}
