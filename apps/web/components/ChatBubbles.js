'use client';

import { useEffect, useRef } from 'react';
import { withHeads } from '../lib/voice-float.mjs';
import MentionText from './MentionText';
import { Reasoning, Sources } from './ai/elements';
import { Bubble, BubbleContent } from './ui/bubble';
import { Message, MessageContent, MessageGroup } from './ui/message';

function urlsIn(text) {
  return [...String(text || '').matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0]);
}

export default function ChatBubbles({ lines, className = '', thinking = false, onParty }) {
  const tailRef = useRef(null);
  const rows = withHeads(lines);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [lines, thinking]);

  if (rows.length === 0 && !thinking) return null;

  return (
    <MessageGroup className={className}>
      {rows.map((line) => {
        if (line.role === 'user') {
          return (
            <Message key={line.id} align="end">
              <MessageContent>
                <Bubble align="end" variant="secondary">
                  <BubbleContent>
                    <MentionText text={line.text} onParty={onParty} />
                  </BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
          );
        }
        const urls = urlsIn(line.text);
        return (
          <Message key={line.id}>
            <MessageContent>
              <div className="text-sm leading-relaxed text-foreground">
                <MentionText text={line.text} onParty={onParty} />
              </div>
              <Sources urls={urls} />
            </MessageContent>
          </Message>
        );
      })}
      {thinking ? <Reasoning streaming /> : null}
      <span ref={tailRef} />
    </MessageGroup>
  );
}
