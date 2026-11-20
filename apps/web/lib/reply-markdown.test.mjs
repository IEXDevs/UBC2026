import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatMarkdown from '../components/ChatMarkdown.mjs';
import { replyLinks, replyMarkdownParts, replySpeechText } from './reply-markdown.mjs';

const render = text => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

test('chat renders bold, labeled HTTP(S) links and explicit line breaks', () => {
  assert.equal(render('**Latest model** From $1199\n[Apple](https://www.apple.com/iphone/)'),
    '<strong>Latest model</strong> From $1199<br/><a class="chat-link" href="https://www.apple.com/iphone/" target="_blank" rel="noopener">Apple</a>');
  assert.match(render('http://example.com'), /href="http:\/\/example.com" target="_blank" rel="noopener"/);
  assert.equal(render('first\r\nsecond\nthird'), 'first<br/>second<br/>third');
});

test('raw HTML is escaped and unsafe or relative links are never anchors', () => {
  for (const href of ['javascript:alert', 'data:text/html,boom', 'file:///etc/passwd', 'ftp://example.com', '//example.com', '/relative']) {
    assert.equal(render(`[Click](${href})`), 'Click');
    assert.deepEqual(replyLinks(`[Click](${href})`), []);
  }
  assert.equal(render('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.match(render('[<script>alert</script>](https://example.com)'), />&lt;script&gt;alert&lt;\/script&gt;<\/a>/);
});

test('empty, invalid and unfinished markdown stays harmless text', () => {
  for (const value of ['', null, undefined, {}]) {
    assert.equal(render(value), '');
    assert.deepEqual(replyMarkdownParts(value), []);
    assert.equal(replySpeechText(value), '');
  }
  assert.equal(render('**unfinished [link]('), '**unfinished [link](');
});

test('source links deduplicate markdown labels and strip prose punctuation', () => {
  assert.deepEqual(replyLinks('[https://apple.com/](https://apple.com/) **https://apple.com/**\nSee https://example.com.'),
    ['https://apple.com/', 'https://example.com']);
  assert.equal(render('(https://example.com/path).'), '(<a class="chat-link" href="https://example.com/path" target="_blank" rel="noopener">https://example.com/path</a>).');
});

test('speech keeps words and prices, not markdown markers or URLs', () => {
  assert.equal(replySpeechText('**Latest model** From $1199\n[Read Apple](https://apple.com/) https://example.com'),
    'Latest model From $1199 Read Apple');
  assert.equal(replySpeechText('[https://apple.com/](https://apple.com/)'), '');
  assert.equal(replySpeechText('[Read](javascript:alert)'), 'Read');
  assert.equal(replySpeechText('**A bold sentence.'), 'A bold sentence.');
  assert.equal(replySpeechText('[Read more.'), 'Read more.');
  assert.equal(replySpeechText('Latest](https://apple.com/)'), 'Latest');
});

test('chat renderer preserves the address and mention rendering hook inside bold text', () => {
  assert.equal(renderToStaticMarkup(createElement(ChatMarkdown, {
    text: '**@owner** sent it', renderText: value => createElement('span', null, value),
  })), '<strong><span>@owner</span></strong><span> sent it</span>');
});
