import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

test('Live View expiration clears the selected record, count and viewer before enabling a fresh open', () => {
  const panel = source('components/LiveViewPanel.js');
  const block = panel.match(/if \(code === 'browser_session_expired'\) \{([^}]+)\}/)?.[1];
  assert.ok(block);
  let session = { id: 'old', frame: { src: 'old-viewer' } };
  let count = 1;
  const shown = { current: 'old' };
  new Function('setSession', 'setOpenCount', 'shown', block)(value => { session = value; }, value => { count = value; }, shown);
  assert.equal(session, null);
  assert.equal(count, 0);
  assert.equal(shown.current, null);
  assert.match(panel, /disabled=\{!ready \|\| busy \|\| Boolean\(sessionRecordId\)\}/);
});

/**
 * Achieves: verifies the right pane mirrors the active agent and keeps a computer + files stack,
 * while the full browser controls stay in the computer sheet.
 * Fails when: AgentThread embeds LiveViewPanel, FileLibrary embeds LiveViewPanel, AgentDetail
 * drops the agent head / computer / files stack, or the computer sheet loses its controls.
 * Oracle: the sidebar Computer section stays visible; ComputerSheet keeps fill autoStart.
 * Side effects / state checked: component source text.
 * Gaps: source snapshot only — browser session HTTP not exercised.
 */
test('the right pane mirrors the agent and the computer sheet keeps the browser', () => {
  const thread = source('components/AgentThread.js');
  const detail = source('components/AgentDetail.js');
  const library = source('components/FileLibrary.js');
  const sheet = source('components/ComputerSheet.js');
  const panel = source('components/LiveViewPanel.js');

  assert.equal(thread.includes('LiveViewPanel'), false);
  assert.equal(library.includes('LiveViewPanel'), false);
  assert.equal(library.includes('library-filters'), false);
  assert.match(library, /FileScroll/);
  assert.match(library, /selectOnScroll/);
  assert.match(library, /library-panes__pill/);
  assert.match(detail, /BotMark/);
  assert.match(detail, /FileLibrary/);
  assert.match(detail, /LiveViewPanel/);
  assert.match(detail, /bot\.record && ownerId \? \(\s*<LiveViewPanel/);
  assert.match(detail, /screen/);
  assert.doesNotMatch(detail, /side-option/);
  assert.doesNotMatch(detail, /'s computer/);
  assert.match(detail, /permissionById|readStoredPermission/);
  assert.match(library, /library-empty/);
  const css = source('app/globals.css');
  assert.match(css, /100cqw \/ 1280px/);
  assert.match(css, /\.library-empty \{[^}]*place-items: center/);
  assert.match(sheet, /browser-preview/);
  assert.match(sheet, /autoStart/);
  assert.match(sheet, /LiveViewPanel/);
  assert.match(sheet, /LoopSteps/);
  assert.match(sheet, /const syncedBotId = bot\?\.record \? bot\.id : null/);
  assert.match(sheet, /if \(!mounted \|\| !syncedBotId\) return/);
  assert.match(sheet, /syncedBotId \? \([\s\S]*?botId=\{syncedBotId\}/);
  assert.match(panel, /computer-screen/);
  assert.match(panel, /if \(screen\) \{\s*return \(\s*<section className="side-computer"/);
  assert.match(panel, /is-off/);
  assert.match(panel, /framed \? 'Watch' : 'Open Computer'/);
  assert.doesNotMatch(source('components/AccountMenu.js'), /id: 'computer', label: 'Computer'/);
  assert.match(panel, /Take control/);
  assert.match(panel, /Return control/);
  assert.match(panel, /Force stop/);
  assert.match(panel, /live-idle-bar/);
  assert.match(panel, /live-chip/);
  assert.match(panel, /Open browser session/);
  assert.doesNotMatch(detail, /Run the goal/);
  assert.doesNotMatch(detail, />Wake</);
  assert.match(css, /\.library-panes \{[^}]*margin:\s*0 auto 8px/);
  assert.doesNotMatch(panel, /live-row/);
  assert.doesNotMatch(panel, /You can interact/);
});

test('sidebar Computer stays visible and opens the sheet for healthy, idle and failed sessions', () => {
  const panel = source('components/LiveViewPanel.js');
  const screenBranch = panel.slice(panel.indexOf('  if (screen) {'), panel.indexOf('\n  return (\n    <div className={`live-view'));
  const { code } = transformSync(`function renderScreen({ sessionRecordId, frame, error = '', busy = false, onExpand }) {
    const screen = true;
    const framed = Boolean(frame?.embed && frame.src);
    const status = 'No browser session is open.';
    ${screenBranch}
  }`, { loader: 'jsx', jsx: 'transform' });
  const renderScreen = new Function('React', 'LatticeLoader', `${code}; return renderScreen;`)(React, () => null);
  for (const state of [
    { sessionRecordId: 'active', frame: { embed: true, src: 'https://live.browser.run/ui/view' } },
    {},
    { error: 'That browser session ended. Open a new one.' },
    { error: 'Browser request failed.' },
  ]) {
    let expanded = false;
    const tree = renderScreen({ ...state, onExpand: () => { expanded = true; } });
    const html = renderToStaticMarkup(tree);
    assert.match(html, /aria-label="Computer"/);
    assert.match(html, state.frame ? /aria-label="Watch"/ : /aria-label="Open Computer"/);
    if (state.error) assert.ok(html.includes(state.error));
    if (!state.sessionRecordId && !state.error) assert.match(html, /No browser session is open/);
    const screen = tree.props.children[1].props.children;
    const button = screen.props.children.find(child => child?.type === 'button');
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    assert.equal(expanded, true);
  }
});
