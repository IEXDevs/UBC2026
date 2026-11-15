import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { patchPrivySvgProps, rewriteSvgDomProps, silenceTurnstileExecuteWarning } from './patch-privy-svg-props.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('rewrites hyphenated svg props to React camelCase', () => {
  const source = 't("path",{"fill-rule":"evenodd","clip-rule":"evenodd",d:"M"})';
  assert.equal(
    rewriteSvgDomProps(source),
    't("path",{fillRule:"evenodd",clipRule:"evenodd",d:"M"})',
  );
  assert.equal(rewriteSvgDomProps(rewriteSvgDomProps(source)), rewriteSvgDomProps(source));
});

test('keeps Privy app-config failures and skips the strict-mode abort warning', () => {
  const source = 'catch(e){let t=e instanceof Error?e:Error(String(e));p(t),console.warn("Error generating app config: ",t)}';
  const next = rewriteSvgDomProps(source);
  assert.equal(next.includes('console.warn("Error generating app config: ",t)'), true);
  assert.match(next, /t\.name!=="AbortError"/);
  assert.equal(rewriteSvgDomProps(next), next);
});

test('drops the Turnstile execute-mode warning', () => {
  const source = 'd.execution===`execute`?e.execute(z.current):console.warn(`Execution mode is not set to "execute"`)';
  const next = silenceTurnstileExecuteWarning(source);
  assert.equal(next.includes('Execution mode is not set'), false);
  assert.equal(silenceTurnstileExecuteWarning(next), next);
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

test('installed Privy GitHub login icon renders without invalid DOM props', async () => {
  const result = patchPrivySvgProps(repoRoot);
  assert.ok(result.scanned > 0, 'expected @privy-io/react-auth to be installed');

  const dist = path.join(repoRoot, 'node_modules', '@privy-io', 'react-auth', 'dist');
  const bundled = walk(dist).map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.equal(bundled.includes('"fill-rule"'), false);
  assert.equal(bundled.includes('"clip-rule"'), false);

  const iconFile = walk(path.join(dist, 'esm')).find((file) => {
    const source = readFileSync(file, 'utf8');
    return source.includes('M16.5083') && source.includes('as G');
  });
  assert.ok(iconFile, 'expected the Privy social icon chunk that exports the GitHub mark');

  const mod = await import(`${pathToFileURL(iconFile).href}?svg-props=${result.patched}`);
  const errors = [];
  const original = console.error;
  console.error = (...args) => {
    errors.push(args.map((part) => String(part)).join(' '));
  };
  let html = '';
  try {
    html = renderToStaticMarkup(createElement(mod.G));
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.match(html, /fill-rule="evenodd"/);
  assert.match(html, /clip-rule="evenodd"/);

  const privySource = walk(dist).map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.equal(privySource.includes('p(t),console.warn("Error generating app config: ",t)'), false);
  const turnstile = path.join(repoRoot, 'node_modules', '@marsidev', 'react-turnstile', 'dist', 'index.js');
  assert.equal(readFileSync(turnstile, 'utf8').includes('Execution mode is not set to "execute"'), false);
});
