/**
 * Live /api/* data routes backed by Supabase + Privy when secrets exist.
 * Without secrets, returns empty items with source: 'unconfigured' (not a fake DB).
 */
import { createPrivyWalletClientFromEnv } from '@ubc2026/wallets/privy';
import {
  ConfigError,
  httpsAvatarUrl,
  normalizeDisplayName,
  normalizeHandle,
  parseRecipient,
} from '@ubc2026/contracts';
import { createSnsResolver, SnsError } from '@ubc2026/sns';
import { WalletError } from '@ubc2026/wallets';
import {
  amountText,
  createSupabaseRpc,
  mapBotRow,
  mapWalletRow,
  supabaseConfig,
  supabaseGet,
  supabaseWrite,
} from './supabase-rest.mjs';
import { createOpenRouterFromEnv, OpenRouterError } from './openrouter.mjs';
import {
  mapTransferRow,
  platformProposal,
  transferErrorCode,
  transferRequest,
} from './platform-transfer.mjs';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function ownerHeader(request) {
  const value = request.headers.get('x-owner-id');
  if (typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)) return value;
  return null;
}

function bearerToken(request) {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

function privyClient(env) {
  if (env.transferClient) return env.transferClient;
  try {
    return createPrivyWalletClientFromEnv(env, { fetcher: env.fetch ?? fetch });
  } catch (error) {
    if (error instanceof ConfigError || error?.code === 'missing_secrets') return null;
    throw error;
  }
}

async function resolveOwner(request, env) {
  const header = ownerHeader(request);
  const token = bearerToken(request);
  if (!token) return { ownerId: header, user: null, token: '' };

  const client = privyClient(env);
  if (!client?.acceptLogin) return { ownerId: header, user: null, token };

  try {
    const result = await client.acceptLogin({ accessToken: token, ownerId: header || undefined });
    const ownerId = header || result?.main?.ownerId || result?.userId || null;
    return { ownerId, user: result, token };
  } catch (error) {
    if (error instanceof WalletError) {
      return { ownerId: header, user: null, token, error: error.code || 'privy_failed' };
    }
    return { ownerId: header, user: null, token, error: 'privy_failed' };
  }
}

function publicWallet(wallet) {
  return {
    id: wallet.id,
    ownerId: wallet.ownerId,
    kind: wallet.kind,
    label: wallet.label,
    address: wallet.address,
    provider: wallet.provider || 'privy',
    frozen: wallet.frozen === true,
  };
}

async function persistLogin(env, login, ownerId) {
  if (!supabaseConfig(env) || !login?.main) return;
  const owner = ownerId || login.main.ownerId;
  const fetcher = env.fetch ?? fetch;
  await supabaseWrite(env, {
    path: 'users',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: owner, privy_user_id: login.main.ownerId || owner },
    fetcher,
  });
  const rows = [login.main, ...(login.additional || [])].filter(Boolean).map((wallet) => ({
    id: wallet.id,
    owner_id: owner,
    kind: wallet.kind,
    label: wallet.label,
    address: wallet.address,
    provider: wallet.provider || 'privy',
    frozen: wallet.frozen === true,
  }));
  if (rows.length) {
    await supabaseWrite(env, {
      path: 'wallets',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: rows,
      fetcher,
    });
  }
}

export async function handleApiData(request, env, matched) {
  const routeId = matched?.route?.id;
  if (!routeId) return null;

  const fetcher = env.fetch ?? fetch;

  if (routeId === 'me') {
    const { ownerId, user, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) {
      return json({ ok: true, source: 'unconfigured', user: { id: ownerId, privyUserId: user?.main?.ownerId || ownerId } });
    }
    const result = await supabaseGet(env, `users?id=eq.${encodeURIComponent(ownerId)}&select=*`, fetcher);
    const row = result.rows?.[0];
    return json({
      ok: true,
      source: result.configured ? 'supabase' : 'unconfigured',
      user: row
        ? { id: row.id, privyUserId: row.privy_user_id, createdAt: row.created_at }
        : { id: ownerId, privyUserId: user?.main?.ownerId || ownerId },
    });
  }

  if (routeId === 'wallets.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const result = await supabaseGet(
      env,
      `wallets?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.asc`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map(mapWalletRow).filter(Boolean).map(publicWallet),
    });
  }

  if (routeId === 'wallets.create') {
    const { ownerId, user, token, error } = await resolveOwner(request, env);
    if (error) return json({ error }, 502);
    if (!token) return json({ error: 'login_required' }, 401);
    const client = privyClient(env);
    if (!client) return json({ error: 'signer_not_configured' }, 503);
    try {
      const login = user || await client.acceptLogin({ accessToken: token, ownerId: ownerId || undefined });
      const owner = ownerId || login.main?.ownerId;
      await persistLogin(env, login, owner);
      return json({
        ok: true,
        created: login.created === true,
        wallets: [login.main, ...(login.additional || [])].filter(Boolean).map(publicWallet),
      });
    } catch (err) {
      const code = err instanceof WalletError ? err.code : 'wallet_failed';
      const status = code === 'missing_config' || code === 'missing_secrets' ? 503 : 502;
      return json({ error: code }, status);
    }
  }

  if (routeId === 'wallets.sign') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const client = privyClient(env);
    if (!client) return json({ error: 'signer_not_configured' }, 503);
    const walletId = matched.params?.walletId;
    const body = await request.json().catch(() => ({}));
    if (!body?.transaction || typeof body.transaction !== 'string') {
      return json({ error: 'transaction_required' }, 400);
    }
    let wallet = body.wallet || null;
    if (!wallet && supabaseConfig(env)) {
      const loaded = await supabaseGet(
        env,
        `wallets?id=eq.${encodeURIComponent(walletId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*`,
        fetcher,
      );
      wallet = mapWalletRow(loaded.rows?.[0]);
    }
    if (!wallet) return json({ error: 'wallet_not_found' }, 404);
    try {
      const sent = body.bot
        ? await client.signAndBroadcastDevnet({ bot: body.bot, wallet, transaction: body.transaction })
        : await client.signAndBroadcastOwnerDevnet({ ownerId, wallet, transaction: body.transaction });
      return json({ ok: true, ...sent });
    } catch (err) {
      const code = err instanceof WalletError ? err.code : err?.code || 'sign_failed';
      return json({ error: code }, 400);
    }
  }

  if (routeId === 'bots.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const result = await supabaseGet(
      env,
      `bots?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.asc`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map(mapBotRow).filter(Boolean),
    });
  }

  if (routeId === 'bots.create') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_body' }, 400);

    const botId = typeof body.id === 'string' ? body.id.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const goal = typeof body.goal === 'string' && body.goal.trim()
      ? body.goal.trim().slice(0, 2000)
      : 'Waiting for a goal.';
    const type = typeof body.type === 'string' ? body.type.trim() : 'trading';
    const walletId = typeof body.walletId === 'string' ? body.walletId.trim() : '';
    const approvalMode = typeof body.approvalMode === 'string' ? body.approvalMode.trim() : 'ask';
    const TYPES = new Set(['trading', 'shopping', 'position-management']);
    const MODES = new Set(['ask', 'fully-automatic', 'capped-automatic']);
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(botId) || !name || !TYPES.has(type) || !MODES.has(approvalMode)) {
      return json({ error: 'invalid_bot' }, 400);
    }
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(walletId)) return json({ error: 'wallet_required' }, 400);

    const walletLookup = await supabaseGet(
      env,
      `wallets?id=eq.${encodeURIComponent(walletId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id,frozen`,
      fetcher,
    );
    const walletRow = walletLookup.rows?.[0];
    if (!walletRow?.id) return json({ error: 'wallet_not_found' }, 404);
    if (walletRow.frozen === true) return json({ error: 'wallet_frozen' }, 400);

    await supabaseWrite(env, {
      path: 'users',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { id: ownerId, privy_user_id: ownerId },
      fetcher,
    });

    const capMode = body.cap?.mode === 'unlimited' ? 'unlimited' : 'limited';
    const capAsset = typeof body.cap?.asset === 'string' && body.cap.asset.trim()
      ? body.cap.asset.trim().slice(0, 32)
      : 'USDC';
    const row = {
      id: botId,
      owner_id: ownerId,
      wallet_id: walletId,
      name,
      goal,
      type,
      approval_mode: approvalMode,
      auto_approve_cap: body.autoApproveCap != null ? body.autoApproveCap : null,
      template_id: typeof body.templateId === 'string' ? body.templateId : null,
      enabled: body.enabled !== false,
      frozen: body.frozen === true,
      policy_version: 1,
      cap_mode: capMode,
      cap_asset: capAsset,
      max_outflow: capMode === 'limited' && type !== 'position-management'
        ? (body.cap?.maxOutflow ?? '1000000')
        : null,
      max_per_transaction: capMode === 'limited' && type !== 'position-management'
        ? (body.cap?.maxPerTransaction ?? '1000000')
        : null,
      max_loss: type === 'position-management'
        ? (body.cap?.maxLoss ?? '1000000')
        : null,
    };

    const written = await supabaseWrite(env, {
      path: 'bots',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: row,
      fetcher,
    });
    if (written.ok === false) return json({ error: 'persist_failed' }, 502);

    await supabaseWrite(env, {
      path: 'spend_ledgers',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        bot_id: botId,
        asset: capAsset,
        spent: 0,
        reserved: 0,
        realized_loss: 0,
      },
      fetcher,
    });

    const persisted = Array.isArray(written.rows) && written.rows[0]
      ? mapBotRow(written.rows[0])
      : mapBotRow(row);
    return json({ ok: true, source: 'supabase', bot: persisted });
  }

  if (routeId === 'bots.delete') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const botId = matched?.params?.botId;
    if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) {
      return json({ error: 'invalid_bot' }, 400);
    }
    if (!supabaseConfig(env)) return json({ error: 'unconfigured' }, 503);

    const existing = await supabaseGet(
      env,
      `bots?id=eq.${encodeURIComponent(botId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
      fetcher,
    );
    if (!Array.isArray(existing.rows) || existing.rows.length < 1) {
      return json({ error: 'not_found' }, 404);
    }

    // Child tables reference bots(id) without ON DELETE CASCADE — clear dependents first.
    const dependents = [
      `budget_reservations?bot_id=eq.${encodeURIComponent(botId)}`,
      `spend_ledgers?bot_id=eq.${encodeURIComponent(botId)}`,
      `approvals?bot_id=eq.${encodeURIComponent(botId)}`,
      `decision_records?bot_id=eq.${encodeURIComponent(botId)}`,
      `timeline_events?bot_id=eq.${encodeURIComponent(botId)}`,
      `payments?bot_id=eq.${encodeURIComponent(botId)}`,
      `metrics?bot_id=eq.${encodeURIComponent(botId)}`,
      `stream_events?bot_id=eq.${encodeURIComponent(botId)}`,
      `activity_logs?bot_id=eq.${encodeURIComponent(botId)}`,
    ];
    for (const path of dependents) {
      const cleared = await supabaseWrite(env, {
        path,
        method: 'DELETE',
        prefer: 'return=minimal',
        fetcher,
      });
      // 404 = table/row missing on older schemas; treat as already clear.
      if (cleared.configured && cleared.status >= 400 && cleared.status !== 404) {
        return json({ error: 'delete_failed', detail: path.split('?')[0] }, 502);
      }
    }

    const removed = await supabaseWrite(env, {
      path: `bots?id=eq.${encodeURIComponent(botId)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
      method: 'DELETE',
      prefer: 'return=minimal',
      fetcher,
    });
    if (removed.ok === false && removed.status !== 204) {
      return json({ error: 'delete_failed' }, 502);
    }
    return json({ ok: true, deleted: botId, source: 'supabase' });
  }

  if (routeId === 'bots.chat') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const botId = matched?.params?.botId;
    if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) {
      return json({ error: 'invalid_bot' }, 400);
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 4000) return json({ error: 'message_required' }, 400);
    const history = Array.isArray(body.history) ? body.history.slice(-16) : [];

    let botName = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : 'Agent';
    let botGoal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim().slice(0, 2000) : 'Waiting for a goal.';
    let botType = typeof body.type === 'string' && body.type.trim() ? body.type.trim().slice(0, 40) : 'trading';

    // Prefer Supabase identity when the bot is stored; otherwise use client name/goal
    // so locally created roster bots can still chat before they are persisted.
    if (supabaseConfig(env)) {
      const loaded = await supabaseGet(
        env,
        `bots?id=eq.${encodeURIComponent(botId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*`,
        fetcher,
      );
      const row = mapBotRow(loaded.rows?.[0]);
      if (row) {
        botName = row.name || botName;
        botGoal = row.goal || botGoal;
        botType = row.type || botType;
      }
    }

    const openrouter = typeof env.openRouter === 'object' && env.openRouter
      ? env.openRouter
      : createOpenRouterFromEnv(env, fetcher);
    try {
      const reply = await openrouter.chat({
        botName,
        botGoal,
        botType,
        history,
        message,
      });
      return json({
        ok: true,
        botId,
        reply: reply.text,
        model: reply.model,
      });
    } catch (err) {
      const code = err instanceof OpenRouterError ? err.code : 'chat_failed';
      const status = err instanceof OpenRouterError ? err.status : 502;
      return json({ error: code }, status);
    }
  }

  if (routeId === 'logs.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    const requested = Number(url.searchParams.get('limit'));
    const limit = Number.isInteger(requested) && requested >= 1 && requested <= 100 ? requested : 100;
    let path = `activity_logs?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.desc&limit=${limit}`;
    if (botId && /^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) {
      path += `&bot_id=eq.${encodeURIComponent(botId)}`;
    }
    const result = await supabaseGet(env, path, fetcher);
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        botId: row.bot_id,
        source: row.source,
        action: row.action,
        status: row.status,
        detail: row.detail ?? {},
        at: row.created_at,
      })),
    });
  }

  if (routeId === 'events.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    let path = `timeline_events?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=at.desc&limit=100`;
    if (botId) path = `timeline_events?owner_id=eq.${encodeURIComponent(ownerId)}&bot_id=eq.${encodeURIComponent(botId)}&select=*&order=at.desc&limit=100`;
    const result = await supabaseGet(env, path, fetcher);
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        botId: row.bot_id,
        ownerId: row.owner_id,
        kind: row.kind,
        summary: row.summary,
        prevHash: row.prev_hash,
        at: row.at,
      })),
    });
  }

  if (routeId === 'decisions.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    // decisions don't store owner_id — join via bots owned by this owner
    const bots = await supabaseGet(
      env,
      `bots?owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
      fetcher,
    );
    const ids = (bots.rows || []).map((row) => row.id).filter(Boolean);
    if (!ids.length) return json({ ok: true, source: 'supabase', items: [] });
    const filter = botId && ids.includes(botId) ? botId : ids.join(',');
    const path = botId && ids.includes(botId)
      ? `decision_records?bot_id=eq.${encodeURIComponent(botId)}&select=*&order=created_at.desc&limit=100`
      : `decision_records?bot_id=in.(${ids.map(encodeURIComponent).join(',')})&select=*&order=created_at.desc&limit=100`;
    const result = await supabaseGet(env, path, fetcher);
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        botId: row.bot_id,
        runId: row.run_id,
        cluster: row.cluster,
        factsDigest: row.facts_digest,
        proposalDigest: row.proposal_digest,
        status: row.status,
        memoSignature: row.memo_signature,
        createdAt: row.created_at,
      })),
      filter,
    });
  }

  if (routeId === 'payments.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const bots = await supabaseGet(
      env,
      `bots?owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
      fetcher,
    );
    const ids = (bots.rows || []).map((row) => row.id).filter(Boolean);
    if (!ids.length) return json({ ok: true, source: 'supabase', items: [] });
    const url = new URL(request.url);
    const botId = url.searchParams.get('botId');
    const path = botId && ids.includes(botId)
      ? `payments?bot_id=eq.${encodeURIComponent(botId)}&select=*&order=created_at.desc&limit=100`
      : `payments?bot_id=in.(${ids.map(encodeURIComponent).join(',')})&select=*&order=created_at.desc&limit=100`;
    const result = await supabaseGet(env, path, fetcher);
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        botId: row.bot_id,
        direction: row.direction,
        protocol: row.protocol,
        amount: amountText(row.amount),
        asset: row.asset,
        counterparty: row.counterparty,
        cluster: row.cluster,
        txSignature: row.tx_signature,
        createdAt: row.created_at,
      })),
    });
  }

  if (routeId === 'metrics.get') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const result = await supabaseGet(
      env,
      `metrics?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=updated_at.desc`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        botId: row.bot_id,
        decisions: row.decisions,
        transactionsExecuted: row.transactions_executed,
        mismatchesCaught: row.mismatches_caught,
        transactionsBlocked: row.transactions_blocked,
        approvalsRequested: row.approvals_requested,
        approvalsGranted: row.approvals_granted,
        x402Payments: row.x402_payments,
        pnlMicroUsdc: amountText(row.pnl_micro_usdc),
        updatedAt: row.updated_at,
      })),
    });
  }

  if (routeId === 'profiles.me' && request.method === 'GET') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', profile: null });
    const result = await supabaseGet(
      env,
      `profiles?owner_id=eq.${encodeURIComponent(ownerId)}&select=handle,display_name,avatar_url`,
      fetcher,
    );
    const row = result.rows?.[0];
    return json({
      ok: true,
      source: 'supabase',
      profile: row ? {
        handle: row.handle,
        displayName: row.display_name,
        avatarUrl: row.avatar_url || null,
      } : null,
    });
  }

  if (routeId === 'profiles.update') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const body = await request.json().catch(() => ({}));
    const handle = normalizeHandle(body.handle);
    const displayName = normalizeDisplayName(body.displayName);
    const avatarUrl = body.avatarUrl == null || body.avatarUrl === '' ? null : httpsAvatarUrl(body.avatarUrl);
    if (!handle || !displayName) return json({ error: 'invalid_profile' }, 400);
    if (body.avatarUrl && !avatarUrl) return json({ error: 'invalid_avatar' }, 400);
    if (!supabaseConfig(env)) {
      return json({ ok: true, source: 'unconfigured', profile: { handle, displayName, avatarUrl } });
    }
    await supabaseWrite(env, {
      path: 'users',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { id: ownerId, privy_user_id: ownerId },
      fetcher,
    });
    const saved = await supabaseWrite(env, {
      path: 'profiles?on_conflict=owner_id',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: {
        owner_id: ownerId,
        handle,
        display_name: displayName,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      },
      fetcher,
    });
    if (saved.status === 409) return json({ error: 'handle_taken' }, 409);
    if (saved.ok === false) return json({ error: 'profile_save_failed' }, 502);
    return json({ ok: true, source: 'supabase', profile: { handle, displayName, avatarUrl } });
  }

  if (routeId === 'profiles.lookup') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const query = new URL(request.url).searchParams.get('q') || '';
    const parsed = parseRecipient(query);
    if (!parsed) return json({ error: 'invalid_recipient' }, 400);
    if (parsed.kind === 'sns') {
      try {
        const resolver = createSnsResolver({
          resolveFn: typeof env.resolveSns === 'function'
            ? env.resolveSns
            : async (domain) => {
              const demo = env.SNS_DEMO_MAP && typeof env.SNS_DEMO_MAP === 'object' ? env.SNS_DEMO_MAP : {};
              if (demo[domain]) return demo[domain];
              throw new SnsError('sns_not_found');
            },
        });
        const resolved = await resolver(parsed.domain);
        return json({
          ok: true,
          recipient: { kind: 'sns', domain: resolved.domain, address: resolved.address },
        });
      } catch (err) {
        const code = err instanceof SnsError ? 'sns_not_found' : 'sns_failed';
        return json({ error: code, recipient: { kind: 'sns', domain: parsed.domain } }, 404);
      }
    }
    if (!supabaseConfig(env)) {
      return json({ ok: true, source: 'unconfigured', recipient: { kind: 'handle', handle: parsed.handle, missing: true } });
    }
    const found = await supabaseGet(
      env,
      `profiles?handle=eq.${encodeURIComponent(parsed.handle)}&select=owner_id,handle,display_name,avatar_url`,
      fetcher,
    );
    const row = found.rows?.[0];
    if (!row) return json({ ok: true, source: 'supabase', recipient: { kind: 'handle', handle: parsed.handle, missing: true } });
    const wallet = await supabaseGet(
      env,
      `wallets?owner_id=eq.${encodeURIComponent(row.owner_id)}&kind=eq.main&select=address&limit=1`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      recipient: {
        kind: 'handle',
        handle: row.handle,
        displayName: row.display_name,
        avatarUrl: row.avatar_url || null,
        address: wallet.rows?.[0]?.address || null,
      },
    });
  }

  if (routeId === 'transfers.list') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    if (!supabaseConfig(env)) return json({ ok: true, source: 'unconfigured', items: [] });
    const owner = encodeURIComponent(ownerId);
    const result = await supabaseGet(
      env,
      `platform_transfers?or=(from_owner_id.eq.${owner},to_owner_id.eq.${owner})&select=*&order=created_at.desc&limit=50`,
      fetcher,
    );
    return json({
      ok: true,
      source: 'supabase',
      items: (result.rows || []).map(row => mapTransferRow(row, ownerId)).filter(Boolean),
    });
  }

  if (routeId === 'transfers.create') {
    const { ownerId, error } = await resolveOwner(request, env);
    if (error && !ownerId) return json({ error }, 401);
    if (!ownerId) return json({ error: 'owner_required' }, 401);
    const body = await request.json().catch(() => ({}));
    const requestBody = transferRequest(body);
    if (!requestBody) return json({ error: 'invalid_transfer' }, 400);
    if (!supabaseConfig(env)) return json({ ok: false, error: 'unconfigured', source: 'unconfigured' }, 503);
    const rpc = createSupabaseRpc(env, fetcher);
    if (requestBody.botId) {
      const bot = await supabaseGet(
        env,
        `bots?id=eq.${encodeURIComponent(requestBody.botId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id`,
        fetcher,
      );
      if (bot.rows?.[0]) {
        let decision;
        try {
          decision = await rpc('policy_reserve_budget', {
            payload: platformProposal({
              ownerId,
              botId: requestBody.botId,
              handle: requestBody.handle,
              amount: requestBody.amount,
              idempotencyKey: requestBody.idempotencyKey,
              now: Date.now(),
            }),
          });
        } catch (err) {
          return json({ error: 'policy_failed' }, 502);
        }
        if (decision?.state !== 'reserved') {
          return json({
            ok: false,
            error: 'policy_blocked',
            state: decision?.state || 'blocked',
            reason: decision?.reason || null,
          }, 409);
        }
      }
    }
    try {
      const posted = await rpc('platform_post_transfer', {
        payload: {
          ownerId,
          handle: requestBody.handle,
          amount: requestBody.amount,
          idempotencyKey: requestBody.idempotencyKey,
          botId: requestBody.botId,
        },
      });
      const transfer = mapTransferRow(posted?.transfer, ownerId);
      if (!transfer) return json({ error: 'transfer_failed' }, 502);
      return json({ ok: true, source: 'supabase', replay: posted.replay === true, transfer });
    } catch (err) {
      return json({ error: transferErrorCode(err) }, 409);
    }
  }

  return null;
}
