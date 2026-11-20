import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../components/MentionText.js', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  loader: { '.js': 'jsx' },
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const MentionText = module.exports.default;

function render(text, onParty = () => {}) {
  return renderToStaticMarkup(createElement(MentionText, { text, onParty }));
}

test('only captured mentions become buttons, leaving preceding whitespace in inline text', () => {
  for (const gap of ['', ' ', '  ']) {
    assert.equal(render(`Hello${gap}@alice`), `<span><span>Hello${gap}</span></span><button type="button" class="party-link">@alice</button><span></span>`);
  }
  assert.equal(render('Hello'), '<span><span>Hello</span></span>');
  const parties = [];
  const nodes = MentionText({ text: 'Hello @alice @bob', onParty: party => parties.push(party) });
  const buttons = nodes.filter(node => node.type === 'button');
  assert.deepEqual(buttons.map(node => node.props.children), ['@alice', '@bob']);
  buttons[0].props.onClick();
  assert.equal(parties[0].handle, 'alice');
});

test('empty, invalid and noninteractive text renders without mention buttons', () => {
  for (const text of ['', null, undefined, 42]) assert.equal(render(text), '<span></span>');
  assert.equal(render('Hello @alice', null), '<span><span>Hello </span></span><span><span>@alice</span></span><span></span>');
});
