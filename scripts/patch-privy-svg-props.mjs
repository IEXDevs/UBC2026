/**
 * Privy's login icons pass SVG attributes as hyphenated JSX props
 * (`fill-rule`, `clip-rule`). React warns on those names. The published
 * package is already at the latest 3.x and still emits them, so rewrite the
 * installed bundle to the camelCase props React expects.
 *
 * The DOM output stays `fill-rule` / `clip-rule`. Only the React prop keys change.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SVG_PROP_REWRITES = Object.freeze([
  [/"fill-rule"\s*:/g, 'fillRule:'],
  [/"clip-rule"\s*:/g, 'clipRule:'],
]);

export function rewriteSvgDomProps(source) {
  let next = String(source);
  for (const [pattern, replacement] of SVG_PROP_REWRITES) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, replacement);
  }
  return next;
}

function walkJsFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return out;
    throw error;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      walkJsFiles(full, out);
      continue;
    }
    if (/\.(?:js|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

export function patchPrivySvgProps(repoRoot) {
  const dist = path.join(repoRoot, 'node_modules', '@privy-io', 'react-auth', 'dist');
  const files = walkJsFiles(dist, []);
  let patched = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const next = rewriteSvgDomProps(source);
    if (next === source) continue;
    writeFileSync(file, next);
    patched += 1;
  }
  return { dist, scanned: files.length, patched };
}

function isDirectRun() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = patchPrivySvgProps(repoRoot);
  if (result.scanned === 0) {
    console.log('patch-privy-svg-props: @privy-io/react-auth dist not installed, skipped');
  } else {
    console.log(`patch-privy-svg-props: rewrote ${result.patched} file(s)`);
  }
}
