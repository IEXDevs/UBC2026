import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { proposalDigest } from '../packages/bot-policy/policy.mjs';
import { ledgerCases, proposal, shoppingFixture } from '../packages/bot-policy/ledger-cases.mjs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

function intText(value) {
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,39})(?:\.0+)?$/.test(text)) throw new Error(`Unexpected numeric ${text}`);
  return text.replace(/\.0+$/, '');
}

function parseResult(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function createPgLedger(db) {
  async function call(fn, payload) {
    const result = await db.query(`select ${fn}($1::jsonb) as result`, [JSON.stringify(payload)]);
    return parseResult(result.rows[0].result);
  }
  return {
    async reset(fixture) {
      await db.exec(`
        delete from timeline_events;
        delete from budget_reservations;
        delete from approvals;
        delete from spend_ledgers;
        delete from bots;
        delete from wallets;
        delete from users;
      `);
      for (const user of fixture.users ?? []) {
        await db.query('insert into users (id, privy_user_id) values ($1, $2)', [user.id, user.privyUserId]);
      }
      for (const wallet of fixture.wallets ?? []) {
        await db.query(
          `insert into wallets (id, owner_id, kind, label, address, provider, frozen)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [wallet.id, wallet.ownerId, wallet.kind, wallet.label, wallet.address, wallet.provider, wallet.frozen === true],
        );
      }
      for (const bot of fixture.bots ?? []) {
        const cap = bot.cap ?? {};
        await db.query(
          `insert into bots (
             id, owner_id, wallet_id, name, goal, type, approval_mode, auto_approve_cap,
             enabled, frozen, policy_version, cap_mode, cap_asset, max_outflow, max_per_transaction, max_loss
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13,$14::numeric,$15::numeric,$16::numeric
           )`,
          [
            bot.id, bot.ownerId, bot.walletId, bot.name, bot.goal, bot.type, bot.approvalMode,
            bot.autoApproveCap ?? null, bot.enabled !== false, bot.frozen === true, bot.policyVersion,
            cap.mode, cap.asset, cap.maxOutflow ?? null, cap.maxPerTransaction ?? null, cap.maxLoss ?? null,
          ],
        );
      }
      for (const row of fixture.ledgers ?? []) {
        await db.query(
          `insert into spend_ledgers (bot_id, asset, spent, reserved, realized_loss)
           values ($1, $2, $3::numeric, $4::numeric, $5::numeric)`,
          [row.botId, row.asset, row.spent, row.reserved, row.realizedLoss],
        );
      }
      for (const row of fixture.approvals ?? []) {
        await db.query(
          `insert into approvals (id, owner_id, bot_id, digest, policy_version, action, expires_at, used_at)
           values ($1,$2,$3,$4,$5,$6, to_timestamp($7::numeric / 1000.0), null)`,
          [row.id, row.ownerId, row.botId, row.digest, row.policyVersion, row.action, row.expiresAt],
        );
      }
    },
    preview: payload => call('policy_assess_spend', payload),
    reserveBudget: payload => call('policy_reserve_budget', payload),
    pauseBot: payload => call('policy_pause_bot', payload),
    resumeBot: payload => call('policy_resume_bot', payload),
    stopAll: payload => call('policy_stop_all', payload),
    freezeBot: payload => call('policy_freeze_bot', payload),
    unfreezeBot: payload => call('policy_unfreeze_bot', payload),
    freezeWallet: payload => call('policy_freeze_wallet', payload),
    unfreezeWallet: payload => call('policy_unfreeze_wallet', payload),
    async snapshot() {
      const bots = await db.query('select id, owner_id, wallet_id, enabled, frozen from bots order by id');
      const wallets = await db.query('select id, owner_id, frozen from wallets order by id');
      const ledgers = await db.query('select bot_id, asset, spent, reserved, realized_loss from spend_ledgers order by bot_id');
      const reservations = await db.query(
        'select idempotency_key, bot_id, owner_id, digest, debit, approval_id, status from budget_reservations order by idempotency_key',
      );
      const events = await db.query('select bot_id, owner_id, kind, summary from timeline_events order by bot_id, kind, summary');
      return {
        bots: bots.rows.map(row => ({ id: row.id, ownerId: row.owner_id, walletId: row.wallet_id, enabled: row.enabled, frozen: row.frozen })),
        wallets: wallets.rows.map(row => ({ id: row.id, ownerId: row.owner_id, frozen: row.frozen })),
        ledgers: ledgers.rows.map(row => ({
          botId: row.bot_id, asset: row.asset, spent: intText(row.spent), reserved: intText(row.reserved), realizedLoss: intText(row.realized_loss),
        })),
        reservations: reservations.rows.map(row => ({
          idempotencyKey: row.idempotency_key,
          botId: row.bot_id,
          ownerId: row.owner_id,
          digest: row.digest,
          debit: intText(row.debit),
          approvalId: row.approval_id,
          status: row.status,
        })),
        events: events.rows.map(row => ({ botId: row.bot_id, ownerId: row.owner_id, kind: row.kind, summary: row.summary })),
      };
    },
  };
}

test('postgres policy ledger matches the bot-policy contract', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(schema);
  const ledger = createPgLedger(db);
  try {
    for (const spec of ledgerCases) {
      try {
        await spec.run(ledger, assert);
      } catch (error) {
        throw new Error(`${spec.name}: ${error.message}`);
      }
    }

    const quote = proposal();
    const digest = await db.query('select policy_proposal_digest($1::jsonb) as digest', [JSON.stringify(quote)]);
    assert.equal(digest.rows[0].digest, proposalDigest(quote));

    await ledger.reset(shoppingFixture({ approvalMode: 'fully-automatic' }));
    await db.query(`select set_config('request.jwt.claims', '{"owner_id":"user_2"}', false)`);
    await assert.rejects(
      () => ledger.reserveBudget({
        ownerId: 'user_1',
        now: 1000,
        idempotencyKey: 'idem_forbidden',
        proposal: quote,
      }),
      /forbidden/,
    );
    assert.equal((await ledger.snapshot()).ledgers[0].reserved, '0');
  } finally {
    await db.close();
  }
});
