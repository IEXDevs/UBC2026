/**
 * Privy's login icons pass SVG attributes as hyphenated JSX props
 * (`fill-rule`, `clip-rule`). React warns on those names. The published
 * package is already at the latest 3.x and still emits them, so rewrite the
 * installed bundle to the camelCase props React expects.
 *
 * The DOM output stays `fill-rule` / `clip-rule`. Only the React prop keys change.
 *
 * The same pass drops two login-console warnings that are not failures:
 * Privy logs AbortError when React Strict Mode cancels the first app-config
 * fetch, and Turnstile warns when Privy calls execute() on a render-mode widget.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SVG_PROP_REWRITES = Object.freeze([
  [/"fill-rule"\s*:/g, 'fillRule:'],
  [/"clip-rule"\s*:/g, 'clipRule:'],
]);

const APP_CONFIG_WARN = 'p(t),console.warn("Error generating app config: ",t)';
const APP_CONFIG_WARN_FIXED = 'p(t);if(t.name!=="AbortError")console.warn("Error generating app config: ",t)';

const TURNSTILE_EXECUTE_WARN = 'console.warn(`Execution mode is not set to "execute"`)';

export function rewriteSvgDomProps(source) {
  let next = String(source);
  for (const [pattern, replacement] of SVG_PROP_REWRITES) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, replacement);
  }
  return next.replaceAll(APP_CONFIG_WARN, APP_CONFIG_WARN_FIXED);
}

export function silenceTurnstileExecuteWarning(source) {
  return String(source).replaceAll(TURNSTILE_EXECUTE_WARN, 'void 0');
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

function patchTree(dir, rewrite) {
  const files = walkJsFiles(dir, []);
  let patched = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const next = rewrite(source);
    if (next === source) continue;
    writeFileSync(file, next);
    patched += 1;
  }
  return { dir, scanned: files.length, patched };
}

export function patchPrivySvgProps(repoRoot) {
  const privy = patchTree(
    path.join(repoRoot, 'node_modules', '@privy-io', 'react-auth', 'dist'),
    rewriteSvgDomProps,
  );
  const turnstile = patchTree(
    path.join(repoRoot, 'node_modules', '@marsidev', 'react-turnstile'),
    silenceTurnstileExecuteWarning,
  );
  return {
    dist: privy.dir,
    scanned: privy.scanned + turnstile.scanned,
    patched: privy.patched + turnstile.patched,
    privy,
    turnstile,
  };
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
