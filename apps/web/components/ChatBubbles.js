'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { formatAgentOutput, linkParts } from '../lib/agent-output.mjs';
import AddressCopy from './AddressCopy';
import AddressText from './AddressText';
import { withHeads } from '../lib/voice-float.mjs';
import MentionText from './MentionText';
import { AgentTrace, Reasoning, Sources } from './ai/elements';
import { sanitizeActivity } from '../lib/chat-activity.mjs';
import { MESSAGE_CHAR_CAP } from '../lib/context-usage.mjs';
import { Bubble, BubbleContent } from './ui/bubble';
import { Message, MessageContent, MessageGroup } from './ui/message';

function urlsIn(text) {
  return [...String(text || '').matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0]);
}

export default function ChatBubbles({
  lines,
  className = '',
  thinking = false,
  onParty,
  onEdit,
  onAccess,
  focusId = null,
  hideAccessActions = false,
}) {
  const tailRef = useRef(null);
  const known = useRef(new Set());
  const fresh = useRef(new Set());
  const booted = useRef(false);
  const rows = withHeads(lines);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const ids = [];
  for (const line of rows) if (line?.id) ids.push(line.id);

  if (!booted.current) {
    if (ids.length > 1) {
      known.current = new Set(ids);
      booted.current = true;
    } else if (ids.length === 1) {
      fresh.current.add(ids[0]);
      known.current.add(ids[0]);
      booted.current = true;
    }
  } else if (ids.length > 1 && !known.current.has(ids[0])) {
    known.current = new Set(ids);
    fresh.current = new Set();
  } else {
    for (const id of ids) {
      if (known.current.has(id)) continue;
      fresh.current.add(id);
      known.current.add(id);
    }
  }

  useEffect(() => {
    if (focusId) {
      document.getElementById(`chat-line-${focusId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    tailRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [lines, thinking, focusId]);

  if (rows.length === 0 && !thinking) return null;

  return (
    <MessageGroup className={className}>
      {rows.map((line) => {
        if (line.role === 'note') {
          return <p key={line.id} id={`chat-line-${line.id}`} className="chat-note" data-hit={focusId === line.id ? '' : undefined} role="status">{line.text}</p>;
        }
        if (line.role === 'user') {
          const editing = editingId === line.id;
          return (
            <Message key={line.id} id={`chat-line-${line.id}`} align="end" className={fresh.current.has(line.id) ? 'is-fresh' : undefined} data-hit={focusId === line.id ? '' : undefined} tabIndex={onEdit && !editing ? 0 : undefined}>
              <MessageContent>
                {editing ? (
                  <form
                    className="chat-revise"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const next = draft.trim().slice(0, MESSAGE_CHAR_CAP);
                      if (!next) return;
                      setEditingId(null);
                      onEdit?.(line.id, next);
                    }}
                  >
                    <textarea
                      aria-label="Edit message"
                      maxLength={MESSAGE_CHAR_CAP}
                      value={draft}
                      rows={Math.min(8, Math.max(2, draft.split('\n').length))}
                      autoFocus
                      onChange={(event) => setDraft(event.target.value.slice(0, MESSAGE_CHAR_CAP))}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingId(null);
                        }
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <div className="chat-revise-actions">
                      <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      <button type="submit" disabled={!draft.trim()}>Save</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <Bubble align="end" variant="secondary">
                      <BubbleContent className={line.mentionAddress ? 'overflow-visible' : undefined}>
                        <MentionText text={line.text} onParty={onParty} />
                        {line.mentionAddress ? <AddressCopy address={line.mentionAddress} inline className="chat-address" /> : null}
                      </BubbleContent>
                    </Bubble>
                    {onEdit ? (
                      <button
                        type="button"
                        className="chat-edit"
                        aria-label="Edit message"
                        disabled={thinking}
                        onClick={() => {
                          setDraft(line.text);
                          setEditingId(line.id);
                        }}
                      >
                        <Pencil size={14} strokeWidth={1.75} />
                      </button>
                    ) : null}
                  </>
                )}
              </MessageContent>
            </Message>
          );
        }
        const urls = urlsIn(line.text);
        const steps = sanitizeActivity(line.activity);
        const text = line.role === 'agent' || line.role === 'assistant'
          ? formatAgentOutput(line.text)
          : line.text;
        return (
          <Message key={line.id} id={`chat-line-${line.id}`} className={fresh.current.has(line.id) ? 'is-fresh' : undefined} data-hit={focusId === line.id ? '' : undefined}>
            <MessageContent>
              <AgentTrace steps={steps} />
              <Bubble align="start" variant="secondary">
                <BubbleContent className={line.mentionAddress || line.access?.args?.destination ? 'overflow-visible' : undefined}>
                  {linkParts(text).map((part, index) => (
                    part.type === 'link'
                      ? <a key={`${line.id}-link-${index}`} className="chat-link" href={part.value} target="_blank" rel="noreferrer">{part.value}</a>
                      : <AddressText key={`${line.id}-text-${index}`} text={part.value} addresses={[line.mentionAddress, line.access?.args?.destination]} renderText={value => <MentionText text={value} onParty={onParty} />} />
                  ))}
                </BubbleContent>
              </Bubble>
              <Sources urls={urls} />
              {line.access?.kind === 'inline' ? (
                <div className="access-request" role="group" aria-label={line.access.label}>
                  <p><AddressText text={line.access.label} addresses={[line.access.args?.destination]} /></p>
                  {hideAccessActions ? null : (
                    <>
                      <button type="button" onClick={() => onAccess?.(line, true)}>Allow</button>
                      <button type="button" onClick={() => onAccess?.(line, false)}>Not now</button>
                    </>
                  )}
                </div>
              ) : null}
            </MessageContent>
          </Message>
        );
      })}
      {thinking ? <Reasoning streaming /> : null}
      <span ref={tailRef} />
    </MessageGroup>
  );
}
