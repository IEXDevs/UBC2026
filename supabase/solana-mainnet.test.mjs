import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const proposal = {
  id: 'p', botId: 'b', cluster: 'mainnet-beta', asset: 'USDC', recipient: 'r', quoteId: 'q',
  outflow: '1', expectedReceive: '1', expectedReceiveAsset: 'USDC', maxFee: '1', expiresAt: 9007199254740000,
};

test('database proposal guard defaults to mainnet and rejects empty, inactive and malformed proposals', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(schema);
    const validate = p => db.query('select policy_assert_proposal($1::jsonb)', [JSON.stringify(p)]);
    assert.equal((await db.query('select policy_execution_cluster() as cluster')).rows[0].cluster, 'mainnet-beta');
    await validate(proposal);
    await assert.rejects(validate(null), /Incomplete transaction preview/);
    await assert.rejects(validate({ ...proposal, cluster: 'devnet' }), /configured Solana cluster/);
    await assert.rejects(validate({ ...proposal, cluster: 'testnet' }), /configured Solana cluster/);
    await assert.rejects(validate({ ...proposal, outflow: '-1' }));
    await db.exec("set app.solana_cluster = 'devnet'");
    await validate({ ...proposal, cluster: 'devnet' });
    await assert.rejects(validate(proposal), /configured Solana cluster/);
    await db.exec("set app.solana_cluster = 'invalid'");
    await assert.rejects(validate(proposal), /Unsupported app.solana_cluster/);
  } finally {
    await db.close();
  }
});
