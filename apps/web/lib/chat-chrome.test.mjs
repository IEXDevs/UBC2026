import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
const rail = readFileSync(join(root, 'components/AnimatedList.css'), 'utf8');
const bubbles = readFileSync(join(root, 'components/ChatBubbles.js'), 'utf8');
const page = readFileSync(join(root, 'app/page.js'), 'utf8');
const composer = readFileSync(join(root, 'components/Composer.js'), 'utf8');
const promptBar = readFileSync(join(root, 'components/PromptBar.jsx'), 'utf8');

/**
 * Achieves: verifies the edit button stays hidden until the message is hovered or focused.
 * Fails when: the edit button stays hidden until the message is hovered or focused no longer holds.
 * Oracle: assert.match(block, /button\.chat-edit \{\s*[^}]*opacity: 0;/); assert.match(block, /button\.chat-edit:disabled \{\s*opacity: 0;/); assert.match(block, /\[data-slot='message'\]:hover button\.chat-edit/); assert.match(block, /\[data-slot='message'\]:focus button\.chat-edit/); assert.match(block, /\[data-slot='message'\]:focus-within button\.chat-edit/); assert.match(block, /button\.chat-edit:focus/)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('the edit button stays hidden until the message is hovered or focused', () => {
  const start = css.indexOf('button.chat-edit {');
  const block = css.slice(start, css.indexOf('.chat-revise {', start));
  assert.match(block, /button\.chat-edit \{\s*[^}]*opacity: 0;/);
  assert.match(block, /button\.chat-edit:disabled \{\s*opacity: 0;/);
  assert.doesNotMatch(block, /@media \(hover: hover\)/);
  assert.match(block, /\[data-slot='message'\]:hover button\.chat-edit/);
  assert.match(block, /\[data-slot='message'\]:focus button\.chat-edit/);
  assert.match(block, /\[data-slot='message'\]:focus-within button\.chat-edit/);
  assert.match(block, /button\.chat-edit:focus/);
  assert.match(block, /button\.chat-edit:focus-visible/);
  assert.match(bubbles, /className="chat-edit"/);
  assert.match(bubbles, /aria-label="Edit message"/);
  assert.match(bubbles, /tabIndex=\{onEdit && !editing \? 0 : undefined\}/);
});

/**
 * Achieves: verifies chat message lists reuse the agent rail scrollbar.
 * Fails when: chat message lists reuse the agent rail scrollbar no longer holds.
 * Oracle: assert.match(rail, /scrollbar-width: thin;/); assert.match(rail, /scrollbar-color: var\(--al-thumb\); assert.match(rail, /::-webkit-scrollbar \{\s*width: 6px;/); assert.match(rail, /::-webkit-scrollbar-track \{\s*background: transparent;/); assert.match(rail, /::-webkit-scrollbar-thumb \{\s*border-radius: 3px;\s*background: var\(--al-thumb\); assert.match(chat, /\.voice-script \{/)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('chat message lists reuse the agent rail scrollbar', () => {
  assert.match(rail, /scrollbar-width: thin;/);
  assert.match(rail, /scrollbar-color: var\(--al-thumb\) transparent;/);
  assert.match(rail, /::-webkit-scrollbar \{\s*width: 6px;/);
  assert.match(rail, /::-webkit-scrollbar-track \{\s*background: transparent;/);
  assert.match(rail, /::-webkit-scrollbar-thumb \{\s*border-radius: 3px;\s*background: var\(--al-thumb\);/);
  const chat = css.slice(css.indexOf('.thread.is-chat,'), css.indexOf('.thread.is-book'));
  assert.match(chat, /\.voice-script \{/);
  assert.match(chat, /--al-thumb: rgba\(255, 255, 255, 0\.16\);/);
  assert.match(chat, /scrollbar-width: thin;/);
  assert.match(chat, /scrollbar-color: var\(--al-thumb\) transparent;/);
  assert.match(chat, /\.thread\.is-chat::-webkit-scrollbar,\s*\.voice-script::-webkit-scrollbar \{\s*width: 6px;/);
  assert.match(chat, /background: transparent;/);
  assert.match(chat, /border-radius: 3px;\s*background: var\(--al-thumb\);/);
  assert.match(page, /pane === 'Main' \? ' is-chat'/);
  assert.doesNotMatch(css, /\.voice-script,\s*\.voice-script \.chat-log/);
});

/**
 * Achieves: verifies the chat top bar does not cover messages or the scrollbar.
 * Fails when: the chat top bar does not cover messages or the scrollbar no longer holds.
 * Oracle: assert.match(topbar, /position: absolute;/); assert.match(topbar, /background: transparent;/); assert.match(topbar, /pointer-events: none;/); assert.match(css, /\.stage:not\(\.is-book\); assert.match(chat, /background: transparent;/); assert.match(bubble, /background: transparent;/)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('the chat top bar does not cover messages or the scrollbar', () => {
  const topbar = css.slice(css.indexOf('.stage:not(.is-book) .topbar {'), css.indexOf('.stage:not(.is-book) .topbar .dock-slot'));
  assert.match(topbar, /position: absolute;/);
  assert.match(topbar, /background: transparent;/);
  assert.match(topbar, /pointer-events: none;/);
  assert.match(css, /\.stage:not\(\.is-book\) \.topbar \.dock-slot \{\s*pointer-events: auto;/);
  const chat = css.slice(css.indexOf('.thread.is-chat {'), css.indexOf('.thread.is-chat::-webkit-scrollbar'));
  assert.match(chat, /background: transparent;/);
  assert.doesNotMatch(chat, /background:\s*#000/);
  const bubble = css.slice(css.indexOf('.thread.is-chat .bubble {'), css.indexOf('.thread.is-chat::-webkit-scrollbar'));
  assert.match(bubble, /background: transparent;/);
  assert.doesNotMatch(bubble, /background:\s*#000/);
});

/**
 * Achieves: verifies a chat message stays on its own side of the midline.
 * Fails when: a chat message stays on its own side of the midline no longer holds.
 * Oracle: assert.match(block, /\.agent-thread \[data-slot='message-content'\] \{\s*width: auto;\s*max-width: 50%;/); assert.match(block, /\[data-align='end'\] \[data-slot='message-content'\] \{\s*margin-left: auto;/); assert.match(block, /\.agent-thread \[data-slot='bubble'\] \{\s*max-width: 100%;/); assert.match(promptBar, /aria-label=\{listening \? 'Stop dictation' : 'Dictate'\}/); assert.match(composer, /onDictate=\{live \? undefined : runDictation\}/); assert.match(composer, /startBrowserDictation/)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('a chat message stays on its own side of the midline', () => {
  const block = css.slice(
    css.indexOf(".agent-thread [data-slot='message-content']"),
    css.indexOf('.voice-dock'),
  );
  assert.match(block, /\.agent-thread \[data-slot='message-content'\] \{\s*width: auto;\s*max-width: 50%;/);
  assert.match(block, /\[data-align='end'\] \[data-slot='message-content'\] \{\s*margin-left: auto;/);
  assert.match(block, /\.agent-thread \[data-slot='bubble'\] \{\s*max-width: 100%;/);
  assert.doesNotMatch(block, /max-width: min\(72%/);
});

/**
 * Achieves: verifies the prompt bar exposes both dictation and live voice mode.
 * Fails when: the prompt bar exposes both dictation and live voice mode breaks (e.g. expected /aria-label=\{listening \? 'Stop dictation' : 'Dictate'\}/, /onDictate=\{live \? undefined : runDictation\}/, /startBrowserDictation/); failure/null paths flip.
 * Oracle: assert.equal(privyRoot.includes('installPrivySessionMirror'), false); assert.equal(privyRoot.includes('restorePrivySessionIfMissing'), false); assert.equal(privyRoot.includes('localStorage.setItem'), false); assert.equal(privySession.includes('maelstrom:privy'), false); assert.equal(privySession.includes('removeItem'), false); assert.match(promptBar, /aria-label=\{listening \? 'Stop dictation' : 'Dictate'\}/)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: source snapshot only — runtime UI/HTTP not executed.
 */
test('the prompt bar exposes both dictation and live voice mode', () => {
  assert.match(promptBar, /aria-label=\{listening \? 'Stop dictation' : 'Dictate'\}/);
  assert.match(composer, /onDictate=\{live \? undefined : runDictation\}/);
  assert.match(composer, /startBrowserDictation/);
  assert.match(composer, /aria-label=\{live \? `Stop voice mode with \$\{callName \|\| botName\}` : 'Voice mode'\}/);
  assert.match(composer, /className=\{`voice-mode\$\{live \? ' is-on' : ''\}`\}/);
  const dictation = readFileSync(join(root, 'lib/dictation.mjs'), 'utf8');
  assert.match(dictation, /scribe_v2_realtime/);
  assert.match(dictation, /CommitStrategy\.VAD/);
  assert.match(dictation, /PARTIAL_TRANSCRIPT/);
  assert.match(dictation, /\/api\/voice\/scribe-token/);
  assert.match(composer, /Keep returning `job` so PromptBar can call job\.cancel/);
  assert.match(promptBar, /onPartial:/);
  const privyRoot = readFileSync(join(root, 'components/PrivyRoot.js'), 'utf8');
  assert.match(privyRoot, /PrivyProvider/);
  assert.equal(privyRoot.includes('installPrivySessionMirror'), false);
  assert.equal(privyRoot.includes('restorePrivySessionIfMissing'), false);
  assert.equal(privyRoot.includes('localStorage.setItem'), false);
  const privySession = readFileSync(join(root, 'lib/privy-session.mjs'), 'utf8');
  assert.match(privySession, /getPrivyAccessToken/);
  assert.equal(privySession.includes('maelstrom:privy'), false);
  assert.equal(privySession.includes('removeItem'), false);
});
