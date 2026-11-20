'use client';

import { createElement, Fragment } from 'react';
import { replyMarkdownParts } from '../lib/reply-markdown.mjs';

export default function ChatMarkdown({ text, renderText = value => value }) {
  const render = parts => parts.map((part, index) => {
    if (part.type === 'break') return createElement('br', { key: index });
    if (part.type === 'strong') return createElement('strong', { key: index }, render(part.children));
    if (part.type === 'link') return createElement('a', {
      key: index, className: 'chat-link', href: part.href, target: '_blank', rel: 'noopener',
    }, part.value);
    return createElement(Fragment, { key: index }, renderText(part.value));
  });
  return createElement(Fragment, null, render(replyMarkdownParts(text)));
}
