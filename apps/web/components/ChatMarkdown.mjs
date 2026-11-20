'use client';

import { createElement, Fragment } from 'react';
import { replyMarkdownParts } from '../lib/reply-markdown.mjs';

function renderParts(parts, renderText) {
  return parts.map((part, index) => {
    if (part.type === 'break') return createElement('br', { key: index });
    if (part.type === 'strong') return createElement('strong', { key: index }, renderParts(part.children, renderText));
    if (part.type === 'link') return createElement('a', {
      key: index, className: 'chat-link', href: part.href, target: '_blank', rel: 'noopener',
    }, part.value);
    return createElement(Fragment, { key: index }, renderText(part.value));
  });
}

export default function ChatMarkdown({ text, renderText = value => value }) {
  const parts = replyMarkdownParts(text);
  const blocks = parts.some(part => part.type === 'paragraph' || part.type === 'heading' || part.type === 'list');
  if (!blocks) return createElement(Fragment, null, renderParts(parts, renderText));
  return createElement(Fragment, null, parts.map((part, index) => {
    if (part.type === 'heading') {
      return createElement('p', { key: index, className: 'chat-heading' }, renderParts(part.children, renderText));
    }
    if (part.type === 'paragraph') {
      return createElement('p', { key: index, className: 'chat-paragraph' }, renderParts(part.children, renderText));
    }
    if (part.type === 'list') {
      return createElement(part.ordered ? 'ol' : 'ul', { key: index, className: 'chat-list' },
        part.children.map((item, itemIndex) => createElement('li', { key: itemIndex }, renderParts(item.children, renderText))));
    }
    return createElement(Fragment, { key: index }, renderParts([part], renderText));
  }));
}
