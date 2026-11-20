import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Achieves: the document root carries the colors Privy’s export iframe copies.
 * Fails when: Continue renders on an empty palette (a white bar with no label).
 * Oracle: :root sets the variables EmbeddedWalletKeyExportScreen reads.
 * Side effects / state checked: globals.css and the postinstall patch wiring.
 * Gaps: does not open the iframe.
 */
test('the document root supplies Privy export colors and the token patch is installed', () => {
  const web = join(dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(join(web, 'app/globals.css'), 'utf8');
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('.no-copy'));
  for (const name of [
    '--privy-color-background:',
    '--privy-color-background-2:',
    '--privy-color-foreground-3:',
    '--privy-color-foreground-accent:',
    '--privy-color-accent:',
    '--privy-color-accent-dark:',
    '--privy-color-success:',
  ]) {
    assert.match(rootBlock, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*#[0-9a-fA-F]{6}'));
  }
  const patch = readFileSync(join(web, '../../scripts/patch-privy-svg-props.mjs'), 'utf8');
  assert.match(patch, /patchPrivyExportAccessToken/);
});
