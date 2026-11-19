import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_UPDATED, PRIVACY, TERMS } from './legal-copy.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const textOf = (doc) => [doc.intro, ...doc.sections.flatMap(section => [section.heading, ...section.paragraphs])].join('\n');

test('privacy and terms name the product rules and the liability limit', () => {
  const privacy = textOf(PRIVACY);
  const terms = textOf(TERMS);
  assert.equal(PRIVACY.updated, LEGAL_UPDATED);
  assert.equal(TERMS.updated, LEGAL_UPDATED);
  assert.match(privacy, /does not keep your seed phrase or private keys after you confirm them/);
  assert.match(privacy, /one seed phrase/);
  assert.match(privacy, /never a new one/);
  assert.match(privacy, /5 GB/);
  assert.match(privacy, /512 MB/);
  assert.match(privacy, /devnet execution, mainnet pricing/);
  assert.match(terms, /AI is not proven to be accurate all the time/);
  assert.match(terms, /not treat it as financial advice from the creators/);
  assert.match(terms, /provided as-is/);
  assert.match(terms, /best effort to reduce risk/);
  assert.match(terms, /can never be truly mitigated/);
  assert.match(terms, /no liability for losses, harm, injury, or other forms of damage/);
  assert.equal(/google|drive/i.test(`${privacy}\n${terms}`), false);
  assert.equal(/\bbot\b/i.test(`${privacy}\n${terms}`), false);
});

test('privacy and terms routes render the shared page', () => {
  const privacy = readFileSync(join(root, '../app/privacy/page.js'), 'utf8');
  const terms = readFileSync(join(root, '../app/tos/page.js'), 'utf8');
  assert.match(privacy, /LegalPage/);
  assert.match(privacy, /PRIVACY/);
  assert.match(terms, /LegalPage/);
  assert.match(terms, /TERMS/);
  assert.match(readFileSync(join(root, '../components/SignInPage.js'), 'utf8'), /href="\/privacy"/);
  assert.match(readFileSync(join(root, '../components/SignInPage.js'), 'utf8'), /href="\/tos"/);
});
