import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { blockCopy } from './block-copy.mjs';

const web = new URL('../', import.meta.url);

/**
 * Achieves: verifies login and onboarding refuse selection copy, while copy buttons still call the clipboard.
 * Fails when: a gate drops no-copy, the wordmark effect returns, or SecretDraft/AddressCopy stop writing the clipboard.
 * Oracle: blockCopy prevents the event; each gate wires onCopy; CSS sets user-select none; copy buttons keep clipboard.writeText.
 * Side effects / state checked: one prevented event.
 * Gaps: browser selection is not driven here.
 */
test('login and onboarding block selection copy and keep explicit copy buttons', () => {
  let prevented = false;
  blockCopy({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);

  const css = readFileSync(new URL('app/globals.css', web), 'utf8');
  assert.match(css, /\.no-copy,\s*\.no-copy \* \{[\s\S]*user-select: none;/);

  const files = [
    'components/SignInPage.js',
    'components/SpendAcceptance.js',
    'components/RecoveryCeremony.js',
    'components/ClaimHandle.js',
    'components/DeskLock.js',
    'app/page.js',
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, web), 'utf8');
    assert.match(source, /no-copy/);
    assert.match(source, /onCopy=\{blockCopy\}/);
    assert.match(source, /onCut=\{blockCopy\}/);
  }

  const signIn = readFileSync(new URL('components/SignInPage.js', web), 'utf8');
  assert.match(signIn, /<h1 className="sign-in-mark">Maelstrom<\/h1>/);
  assert.doesNotMatch(signIn, /WarpWordmark|TechWordmark/);

  const draft = readFileSync(new URL('components/SecretDraft.js', web), 'utf8');
  const address = readFileSync(new URL('components/AddressCopy.js', web), 'utf8');
  assert.match(draft, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(draft, /aria-label="Copy"/);
  assert.match(address, /navigator\.clipboard\.writeText\(address\)/);
});
