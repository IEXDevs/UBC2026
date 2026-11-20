import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../components/ai/elements.jsx', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  loader: { '.css': 'empty' },
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { AgentTrace, ChainOfThought, Reasoning, Sources, TerminalBlock, ToolCall } = module.exports;
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

function assertCollapsed(component, props) {
  const html = render(component, props);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /aria-expanded="true"|data-slot="trace-collapsible-content"/);
}

test('restored tool and terminal blocks start collapsed, including running and failed records', () => {
  for (const status of [undefined, 'idle', 'running', 'error']) {
    assertCollapsed(ToolCall, { name: 'Read file', input: 'file contents', status });
    assertCollapsed(TerminalBlock, { command: 'ls', status });
  }
});

test('restored reasoning, tool failures, searches, sources and chain sections start collapsed', () => {
  assertCollapsed(Reasoning, { text: 'Reasoning content' });
  assertCollapsed(ChainOfThought, { sections: [{ value: 'one', label: 'Activity', children: [] }] });
  assertCollapsed(Sources, { urls: ['https://example.com'] });
  assertCollapsed(AgentTrace, { steps: [
    { kind: 'think', text: 'Reasoning content' },
    { kind: 'command', status: 'error', command: 'ls', error: 'Failed command' },
    { kind: 'search', query: 'example', sites: [{ url: 'https://example.com', host: 'example.com' }] },
  ] });
});

test('empty traces render nothing and live reasoning can still start expanded', () => {
  for (const component of [AgentTrace, ChainOfThought, Reasoning, Sources]) {
    assert.equal(render(component, {}), '');
  }
  assert.match(render(Reasoning, { text: 'Live reasoning', streaming: true }), /aria-expanded="true"/);
  assert.doesNotMatch(render(ToolCall, { name: 'Read file' }), /aria-expanded/);
});
