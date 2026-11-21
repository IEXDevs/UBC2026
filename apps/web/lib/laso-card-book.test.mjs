import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLasoCards, readLasoClaim, rememberLasoCard, stampBilling, writeLasoBilling, writeLasoClaim } from './laso-card-book.mjs';

test('the card book keeps one billing address and drops card numbers', () => {
  const storage = new Map();
  const memory = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
  };
  const billing = writeLasoBilling(memory, 'owner_1', {
    name: 'Ada Lovelace', line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US',
  });
  rememberLasoCard(memory, 'owner_1', {
    id: 'card_123', pan: '4111111111111111', cvv: '123', expiry: '07/31', status: 'ready',
  });
  const saved = readLasoCards(memory, 'owner_1');
  assert.equal(saved.length, 1);
  assert.equal(JSON.stringify(saved).includes('4111'), false);
  const claim = 'https://laso.finance/agent/dashboard/auth?token=owner-only';
  assert.equal(writeLasoClaim(memory, 'owner_1', claim), claim);
  assert.equal(readLasoClaim(memory, 'owner_1'), claim);
  assert.equal(writeLasoClaim(memory, 'owner_1', 'https://example.invalid/card'), '');
  const face = stampBilling(saved[0], billing);
  assert.equal(face.holder, 'Ada Lovelace');
  assert.equal(face.billing.line1, '1 Main St');
  assert.match(face.number, /••••/);
});
