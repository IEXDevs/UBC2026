'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import MoneyPane from '../components/MoneyPane';
import BotRail from '../components/BotRail';
import AgentThread from '../components/AgentThread';
import SecurityPanel from '../components/SecurityPanel';
import LogsPanel from '../components/LogsPanel';
import AccountMenu from '../components/AccountMenu';
import PaneDock from '../components/PaneDock';
import Composer from '../components/Composer';
import CreateBotDialog from '../components/CreateBotDialog';
import ProfileSheet from '../components/ProfileSheet';
import WalletsSheet from '../components/WalletsSheet';
import PartySheet from '../components/PartySheet';
import PluginsSheet from '../components/PluginsSheet';
import StatisticsSheet from '../components/StatisticsSheet';
import AgentDetail from '../components/AgentDetail';
import ComputerSheet from '../components/ComputerSheet';
import { getDemoShellState } from '../lib/demo-state.mjs';
import { formatBaseUnits, moneyPane, walletGlance } from '../lib/money-views.mjs';
import { parsePlatformSend } from '../lib/platform-send.mjs';
import { compactLines, contextUsage } from '../lib/context-usage.mjs';
import { applyLooks } from '../lib/bot-look.mjs';
import {
  adoptLegacyRoster,
  mergeRoster,
  readLooks,
  readRoster,
  reorderIds,
  withoutId,
  writeLooks,
  writeRoster,
} from '../lib/roster.mjs';
import { ownerIdFromPrivyUser, privyAccountLabel, privyProviderProps, sessionReadyForWallets } from '../lib/privy-config.mjs';
import { profileRailLabel } from '../lib/profile.mjs';
import { withAssignedWallet } from '../lib/wallet-assign.mjs';
import { parseRecipient, privyAvatarUrl } from '@ubc2026/contracts';
import { addVoiceMs, readVoiceMs, voiceTimeKey } from '../lib/voice-time.mjs';
import { walletConfigNote, walletProvisionNote, walletsFromPrivyUser } from '../lib/wallet-provision.mjs';
import { readTalks, writeTalks } from '../lib/talk-store.mjs';
import { withPrivyLogout } from '../lib/accept-terms-auth.mjs';
import { useToast } from '../components/bits/SwipeToast';

const base = getDemoShellState();
const privyConfigured = privyProviderProps({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  clientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
}) !== null;

export default function HomePage() {
  if (!privyConfigured) {
    return (
      <Shell
        ownerId={null}
        accountLabel="You"
        signedIn={false}
        loginDisabled
      />
    );
  }
  return <AuthedShell />;
}

function linkedAccountsKey(user) {
  if (!user) return '';
  const accounts = Array.isArray(user.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user.linked_accounts) ? user.linked_accounts : []);
  return accounts
    .map((account) => {
      if (!account || typeof account !== 'object') return '';
      const chain = account.chainType ?? account.chain_type ?? '';
      const address = typeof account.address === 'string' ? account.address : '';
      return `${account.type || ''}:${chain}:${address}`;
    })
    .filter(Boolean)
    .join('|');
}

function applyWalletFallback(user, body, setLiveWallets, setWalletNote) {
  const ownerId = ownerIdFromPrivyUser(user, true);
  const fallback = walletsFromPrivyUser(user, ownerId);
  const note = walletProvisionNote(body || {}, { ok: false });
  if (fallback.length > 0) {
    setLiveWallets(fallback);
    setWalletNote(`${note} Showing the Privy client wallet until server create succeeds.`);
    return;
  }
  setLiveWallets([]);
  setWalletNote(note);
}

function AuthedShell() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const signedIn = ready && authenticated;
  const [liveWallets, setLiveWallets] = useState(null);
  const [walletNote, setWalletNote] = useState('');
  const accountsKey = linkedAccountsKey(user);

  const onLogout = useCallback(async () => {
    await withPrivyLogout(typeof window !== 'undefined' ? window : globalThis, async () => {
      await logout?.();
    });
  }, [logout]);

  useEffect(() => {
    if (!signedIn) {
      setLiveWallets(null);
      setWalletNote('');
      return undefined;
    }
    // getAccessToken() can erase the Privy session while the terms screen is open.
    if (!sessionReadyForWallets(signedIn, user)) return undefined;
    let stopped = false;
    setWalletNote('Provisioning Solana wallets…');
    (async () => {
      try {
        const configResponse = await fetch('/api/wallets', { method: 'GET', cache: 'no-store' });
        const config = await configResponse.json().catch(() => ({}));
        if (stopped) return;
        const configNote = walletConfigNote(config);
        if (configNote && Array.isArray(config.missing) && config.missing.length > 0) {
          applyWalletFallback(user, { error: 'missing_config', missing: config.missing }, setLiveWallets, setWalletNote);
          return;
        }

        const token = await getAccessToken();
        if (stopped) return;
        if (!token) {
          applyWalletFallback(user, { error: 'token_missing' }, setLiveWallets, setWalletNote);
          return;
        }

        const response = await fetch('/api/wallets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(user?.id ? { 'x-owner-id': user.id } : {}),
          },
        });
        const body = await response.json().catch(() => ({}));
        if (stopped) return;
        const ok = response.ok && Array.isArray(body.wallets) && body.wallets.length > 0;
        if (!ok) {
          console.error('[wallets] provision failed', response.status, {
            error: body.error,
            detail: body.detail,
            missing: body.missing,
          });
          applyWalletFallback(user, body, setLiveWallets, setWalletNote);
          if (configNote && !body.error) {
            setWalletNote(current => (current ? `${current} ${configNote}` : configNote));
          }
          return;
        }
        setLiveWallets(body.wallets);
        setWalletNote(walletProvisionNote(body, { ok: true }));
      } catch {
        if (!stopped) {
          applyWalletFallback(user, {}, setLiveWallets, setWalletNote);
        }
      }
    })();
    return () => { stopped = true; };
  }, [signedIn, user, user?.id, user?.hasAcceptedTerms, accountsKey, getAccessToken]);

  return (
    <Shell
      ownerId={ownerIdFromPrivyUser(user, signedIn)}
      user={signedIn ? user : null}
      accountLabel={signedIn ? privyAccountLabel(user) : 'You'}
      signedIn={signedIn}
      loginDisabled={!ready}
      onLogin={login}
      onLogout={onLogout}
      liveWallets={liveWallets}
      walletNote={walletNote}
      getAccessToken={getAccessToken}
    />
  );
}

function profileKey(ownerId) {
  return ownerId ? `maelstrom.profile.${ownerId}` : '';
}

function Shell({ ownerId, user = null, accountLabel, signedIn, loginDisabled, onLogin, onLogout, liveWallets = null, walletNote = '', getAccessToken = null }) {
  const toast = useToast();
  const [looks, setLooks] = useState({});
  const [roster, setRoster] = useState({ order: base.bots.map(bot => bot.id), extra: [] });
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [sideWidth, setSideWidth] = useState(300);
  const [detailWidth, setDetailWidth] = useState(280);
  const [paneDrag, setPaneDrag] = useState(false);
  const [activeBot, setActiveBot] = useState(base.bots[0].id);
  const [pane, setPane] = useState('Main');
  const [slide, setSlide] = useState('right');
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [talks, setTalks] = useState({});
  const [talksReady, setTalksReady] = useState(false);
  const [rosterReady, setRosterReady] = useState(false);
  const [thinkingBot, setThinkingBot] = useState(null);
  const [botRecords, setBotRecords] = useState(base.bots);
  const [profile, setProfile] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [party, setParty] = useState(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [computerOpen, setComputerOpen] = useState(false);
  const [library, setLibrary] = useState({});
  const [voiceMs, setVoiceMs] = useState(0);
  const avatarUrl = profile?.avatarUrl || privyAvatarUrl(user);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const closeWallets = useCallback(() => setWalletsOpen(false), []);
  const closePlugins = useCallback(() => setPluginsOpen(false), []);
  const closeStats = useCallback(() => setStatsOpen(false), []);
  const closeComputer = useCallback(() => setComputerOpen(false), []);
  const addVoice = useCallback((delta) => {
    setVoiceMs((current) => {
      const next = addVoiceMs(current, delta);
      try { localStorage.setItem(voiceTimeKey(ownerId), String(next)); } catch { /* keep the session total in memory */ }
      return next;
    });
  }, [ownerId]);
  const appendTalk = useCallback((botId, line) => {
    setTalks(current => ({
      ...current,
      [botId]: compactLines([...(current[botId] ?? []), line].slice(-80)),
    }));
  }, []);
  useEffect(() => {
    // Seed chrome only until we know the signed-in owner; custom agents are per-account.
    const merged = mergeRoster(base.bots, null);
    setLooks({});
    setRoster({ order: merged.order, extra: merged.extra });
    setActiveBot(merged.order[0] ?? null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    setRosterReady(false);
    if (!ownerId) {
      // Logged out: demo seeds only — never the previous account's custom agents.
      const merged = mergeRoster(base.bots, null);
      setLooks({});
      setRoster({ order: merged.order, extra: [] });
      setActiveBot(merged.order[0] ?? null);
      setRosterReady(true);
      return undefined;
    }
    const adopted = adoptLegacyRoster(localStorage, ownerId);
    const savedRoster = adopted.adopted ? adopted.roster : readRoster(localStorage, ownerId);
    const savedLooks = adopted.adopted ? adopted.looks : readLooks(localStorage, ownerId);
    const hasSaved = savedRoster.order.length > 0 || savedRoster.extra.length > 0;
    const merged = mergeRoster(base.bots, hasSaved ? savedRoster : null);
    setLooks(savedLooks);
    setRoster({ order: merged.order, extra: merged.extra });
    setActiveBot((current) => (
      merged.order.includes(current) ? current : (merged.order[0] ?? null)
    ));
    setRosterReady(true);
    return undefined;
  }, [ownerId, ready]);

  useEffect(() => {
    if (!ready || !rosterReady || !ownerId) return;
    writeLooks(localStorage, ownerId, looks);
    writeRoster(localStorage, ownerId, roster);
  }, [looks, roster, ready, rosterReady, ownerId]);

  useEffect(() => {
    setTalksReady(false);
    if (!ownerId) {
      setTalks({});
      setTalksReady(true);
      return;
    }
    try {
      setTalks(readTalks(localStorage, ownerId));
    } catch {
      setTalks({});
    }
    setTalksReady(true);
  }, [ownerId]);

  useEffect(() => {
    if (!talksReady || !ownerId) return;
    writeTalks(localStorage, ownerId, talks);
  }, [talks, talksReady, ownerId]);

  useEffect(() => {
    try {
      setVoiceMs(readVoiceMs(localStorage.getItem(voiceTimeKey(ownerId))));
    } catch {
      setVoiceMs(0);
    }
  }, [ownerId]);

  useEffect(() => {
    const key = profileKey(ownerId);
    if (!key) {
      setProfile(null);
      return undefined;
    }
    try {
      const raw = localStorage.getItem(key);
      const local = raw ? JSON.parse(raw) : null;
      if (local?.handle && local?.displayName) setProfile(local);
    } catch {
      setProfile(null);
    }
    const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';
    if (!runtimeBase) return undefined;
    let stop = false;
    (async () => {
      try {
        const response = await fetch(`${runtimeBase.replace(/\/$/, '')}/api/profiles/me`, {
          headers: { 'x-owner-id': ownerId },
          cache: 'no-store',
        });
        const body = await response.json();
        if (!stop && body.profile?.handle) {
          setProfile(body.profile);
          localStorage.setItem(key, JSON.stringify(body.profile));
        }
      } catch {
        // Keep the profile stored on this device.
      }
    })();
    return () => { stop = true; };
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId) {
      setTransfers([]);
      return undefined;
    }
    if (!sessionReadyForWallets(signedIn, user)) return undefined;
    const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';
    if (!runtimeBase) return undefined;
    let stop = false;
    (async () => {
      try {
        const token = await getAccessToken?.();
        const response = await fetch(`${runtimeBase.replace(/\/$/, '')}/api/transfers`, {
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            'x-owner-id': ownerId,
          },
          cache: 'no-store',
        });
        const body = await response.json().catch(() => ({}));
        if (!stop && Array.isArray(body.items)) setTransfers(body.items);
      } catch {
        // Keep transfers already loaded for this owner.
      }
    })();
    return () => { stop = true; };
  }, [ownerId, getAccessToken, signedIn, user]);

  const saveProfile = useCallback(async (next) => {
    const stored = { ...next, avatarUrl: next.avatarUrl || privyAvatarUrl(user) || null };
    const key = profileKey(ownerId);
    const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';
    if (runtimeBase && ownerId) {
      const response = await fetch(`${runtimeBase.replace(/\/$/, '')}/api/profiles/me`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-owner-id': ownerId },
        body: JSON.stringify(stored),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409) return { error: 'handle_taken' };
      if (!response.ok) throw new Error('profile_save_failed');
      setProfile(stored);
      if (key) localStorage.setItem(key, JSON.stringify(stored));
      return body;
    }
    setProfile(stored);
    if (key) localStorage.setItem(key, JSON.stringify(stored));
    return { ok: true, source: 'local' };
  }, [ownerId, user]);

  const resolveMention = useCallback(async (token) => {
    const parsed = parseRecipient(token);
    if (!parsed) return null;
    const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';
    if (runtimeBase && ownerId) {
      try {
        const url = new URL(`${runtimeBase.replace(/\/$/, '')}/api/profiles/lookup`);
        url.searchParams.set('q', token);
        const response = await fetch(url, { headers: { 'x-owner-id': ownerId }, cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (body.recipient) return body.recipient;
        if (parsed.kind === 'sns') return { ...parsed, error: body.error || 'sns_not_found' };
      } catch {
        // Fall through to the profile stored on this device.
      }
    }
    if (parsed.kind === 'handle' && profile?.handle === parsed.handle) {
      return { kind: 'handle', handle: profile.handle, displayName: profile.displayName, self: true };
    }
    if (parsed.kind === 'sns') return parsed;
    return { kind: 'handle', handle: parsed.handle, missing: true };
  }, [ownerId, profile]);

  const seedBots = useMemo(() => {
    const byId = new Map(botRecords.map((bot) => [bot.id, bot]));
    return base.bots.map((bot) => ({ ...bot, ...(byId.get(bot.id) || {}) }));
  }, [botRecords]);
  const merged = useMemo(() => mergeRoster(seedBots, roster), [roster, seedBots]);
  const styled = useMemo(() => applyLooks(merged.bots, looks), [merged, looks]);
  const assigned = useMemo(() => withAssignedWallet(styled, liveWallets), [styled, liveWallets]);
  const bots = assigned.bots;
  const wallets = assigned.wallets ?? base.wallets;
  const visible = bots.filter(bot => bot.name.toLowerCase().includes(query.trim().toLowerCase()));
  const bot = bots.find(item => item.id === activeBot) ?? null;
  const money = moneyPane(pane);
  const glance = walletGlance(wallets, base.positions, transfers);

  function choosePane(next, direction) {
    if (next === pane) return;
    setPluginsOpen(false);
    setSlide(direction);
    setPane(next);
    if (next === 'Main') setActiveBot(current => current ?? bots[0]?.id ?? null);
  }

  function openChat(id) {
    setCreateOpen(false);
    setWalletsOpen(false);
    setPluginsOpen(false);
    setProfileOpen(false);
    setStatsOpen(false);
    setActiveBot(id);
    if (pane !== 'Main') {
      setSlide('left');
      setPane('Main');
    }
  }

  function onCreate(created) {
    if (!ownerId) {
      toast?.('Sign in to create an agent.');
      setCreateOpen(false);
      return;
    }
    setRoster(current => ({
      order: [created.id, ...current.order.filter(id => id !== created.id)],
      extra: [created, ...current.extra.filter(item => item.id !== created.id)],
    }));
    setLooks(current => ({
      ...current,
      [created.id]: { name: created.name, shape: created.shape, color: created.color },
    }));
    setActiveBot(created.id);
    setQuery('');
    setSlide('right');
    setPane('Main');
    setCreateOpen(false);
  }

  function onReorder(fromId, toId) {
    setRoster(current => ({ ...current, order: reorderIds(current.order, fromId, toId) }));
  }

  function onDelete(id) {
    const name = bots.find(item => item.id === id)?.name ?? 'Agent';
    toast?.(`${name} removed`);
    setRoster(current => ({
      order: withoutId(current.order, id),
      extra: current.extra.filter(item => item.id !== id),
    }));
    setLooks(current => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setTalks(current => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setThinkingBot(current => (current === id ? null : current));
    setActiveBot(current => {
      if (current !== id) return current;
      return bots.find(item => item.id !== id)?.id ?? null;
    });
  }

  function onAccount(id) {
    setCreateOpen(false);
    setComputerOpen(id === 'computer');
    if (id === 'profile') {
      setWalletsOpen(false);
      setPluginsOpen(false);
      setStatsOpen(false);
      setProfileOpen(true);
      return;
    }
    if (id === 'computer') {
      setProfileOpen(false);
      setWalletsOpen(false);
      setPluginsOpen(false);
      setStatsOpen(false);
      setComputerOpen(true);
      return;
    }
    if (id === 'statistics') {
      setProfileOpen(false);
      setWalletsOpen(false);
      setPluginsOpen(false);
      setStatsOpen(true);
      return;
    }
    if (id === 'wallet') {
      setProfileOpen(false);
      setPluginsOpen(false);
      setStatsOpen(false);
      setWalletsOpen(true);
      return;
    }
    if (id === 'plugins') {
      setProfileOpen(false);
      setWalletsOpen(false);
      setStatsOpen(false);
      setPluginsOpen(true);
      return;
    }
    setProfileOpen(false);
    setWalletsOpen(false);
    setPluginsOpen(false);
    setStatsOpen(false);
    if (id === 'security') choosePane('Security', 'right');
    if (id === 'logs') choosePane('Logs', 'right');
  }

  function dragPane(event, side) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startSide = railCollapsed ? 88 : sideWidth;
    const startDetail = detailWidth;
    setPaneDrag(true);
    function move(next) {
      const delta = next.clientX - startX;
      if (side === 'left') {
        const width = startSide + delta;
        if (width <= 168) {
          setRailCollapsed(true);
          return;
        }
        setRailCollapsed(false);
        setSideWidth(Math.min(480, Math.max(200, width)));
        return;
      }
      setDetailWidth(Math.min(520, Math.max(220, startDetail - delta)));
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPaneDrag(false);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const sideColumn = railCollapsed ? 88 : sideWidth;

  return (
    <div
      className={`shell${railCollapsed ? ' is-collapsed' : ''}${pane === 'Main' && bot ? ' has-detail' : ''}${paneDrag ? ' is-dragging-pane' : ''}`}
      style={{ '--side-w': `${sideColumn}px`, '--detail-w': `${detailWidth}px` }}
    >
      <aside className={`side${railCollapsed ? ' is-collapsed' : ''}`}>
        <div
          className="pane-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agents"
          onPointerDown={event => dragPane(event, 'left')}
        />
        <div className="side-tools">
          <button
            type="button"
            className="icon-btn rail-toggle"
            aria-pressed={railCollapsed}
            aria-label={railCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
            onClick={() => setRailCollapsed(current => !current)}
          >
            {railCollapsed
              ? <PanelLeftOpen size={16} strokeWidth={1.75} />
              : <PanelLeftClose size={16} strokeWidth={1.75} />}
          </button>
          <label className="search">
            <Search size={16} strokeWidth={1.75} />
            <input
              value={query}
              placeholder="Search agents"
              aria-label="Search agents"
              onChange={event => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className="add-agent" aria-label="Add agent" onClick={() => { setProfileOpen(false); setWalletsOpen(false); setPluginsOpen(false); setStatsOpen(false); setCreateOpen(true); }}>
            <Plus size={16} strokeWidth={1.75} />
          </button>
        </div>
        <BotRail
          bots={visible}
          activeId={bot?.id}
          canDrag={!query.trim()}
          collapsed={railCollapsed}
          onSelect={openChat}
          onReorder={onReorder}
          onDelete={onDelete}
          onCreate={() => setCreateOpen(true)}
        />
        <footer className="you">
          <AccountMenu
            accountLabel={profileRailLabel({
              handle: profile?.handle,
              displayName: profile?.displayName,
              fallback: accountLabel,
            })}
            avatarUrl={avatarUrl}
            collapsed={railCollapsed}
            signedIn={signedIn}
            loginDisabled={loginDisabled}
            onLogin={onLogin}
            onPick={onAccount}
          />
        </footer>
      </aside>

      <section className="stage">
        <header className="topbar">
          <span className="topbar-side" />
          <PaneDock panes={base.panes} pane={pane} onChange={choosePane} />
          <span />
        </header>
        <div key={`${pane}-${slide}`} className={`thread slide-${slide}${pane === 'Positions' ? ' is-book' : ''}`}>
          <article className={`bubble${pane === 'Positions' ? ' is-book' : ''}`} aria-label={pane}>
            {pane === 'Main' ? (
              bot ? (
                <AgentThread
                  key={bot.id}
                  bot={bot}
                  ownerId={ownerId}
                  lines={talks[bot.id] ?? []}
                  thinking={thinkingBot === bot.id}
                  onParty={setParty}
                />
              ) : (
                <>
                  <h1>Make your first Agent!</h1>
                  <p>The list stays empty until you create one.</p>
                  <button type="button" className="solid" onClick={() => setCreateOpen(true)}>Create</button>
                </>
              )
            ) : null}
            {money ? <MoneyPane pane={money} state={{ ...base, bots, wallets, transfers }} onParty={setParty} /> : null}
            {pane === 'Logs' ? <LogsPanel bots={bots} ownerId={ownerId} onParty={setParty} /> : null}
            {pane === 'Security' ? (
              <SecurityPanel
                bots={bots}
                ownerId={ownerId}
                accountLabel={accountLabel}
                onBotsChange={(next) => setBotRecords(next)}
              />
            ) : null}
          </article>
        </div>
        {bot ? (
          <Composer
            key={bot.id}
            hidden={pane !== 'Main'}
            botId={bot.id}
            botName={bot.name}
            botGoal={bot.goal}
            botType={bot.type}
            ownerId={ownerId}
            lines={talks[bot.id] ?? []}
            onLine={line => {
              appendTalk(bot.id, line);
              if (line.role !== 'user') return;
              const command = parsePlatformSend(line.text);
              if (!command || !ownerId) return;
              const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';
              const reply = (text) => appendTalk(bot.id, { id: `${line.id}-send`, role: 'assistant', text });
              if (!runtimeBase) {
                reply('Platform sends need the agent runtime.');
                toast?.('Platform sends need the agent runtime.');
                return;
              }
              void (async () => {
                try {
                  if (!sessionReadyForWallets(signedIn, user)) return;
                  const token = await getAccessToken?.();
                  const response = await fetch(`${runtimeBase.replace(/\/$/, '')}/api/transfers`, {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json',
                      ...(token ? { authorization: `Bearer ${token}` } : {}),
                      'x-owner-id': ownerId,
                    },
                    body: JSON.stringify({
                      ...command,
                      botId: bot.id,
                      idempotencyKey: `send_${bot.id}_${command.handle}_${command.amount}`.replace(/[^a-zA-Z0-9:_-]/g, '_'),
                    }),
                  });
                  const body = await response.json().catch(() => ({}));
                  if (!response.ok || !body.transfer) {
                    const reason = body.error === 'handle_missing'
                      ? `@${command.handle} is not on Maelstrom.`
                      : body.error === 'wallet_frozen'
                        ? 'That wallet is frozen.'
                        : body.error === 'recipient_wallet_missing'
                          ? `@${command.handle} does not have a wallet yet.`
                          : body.error === 'policy_blocked'
                            ? 'The agent policy blocked this send.'
                            : 'The send did not post.';
                    reply(reason);
                    toast?.(reason);
                    return;
                  }
                  setTransfers(current => [body.transfer, ...current.filter(item => item.id !== body.transfer.id)]);
                  reply(`Sent ${formatBaseUnits(body.transfer.amount)} USDC to @${body.transfer.handle}. It is in their wallet.`);
                  toast?.(`Sent ${formatBaseUnits(body.transfer.amount)} USDC to @${body.transfer.handle}`);
                } catch {
                  reply('The send did not post.');
                  toast?.('The send did not post.');
                }
              })();
            }}
            onThinking={on => setThinkingBot(on ? bot.id : null)}
            onVoiceSpan={addVoice}
            resolveMention={resolveMention}
            usage={contextUsage(talks[bot.id] ?? [])}
            onAttach={items => {
              setLibrary(current => {
                const prev = current[bot.id] ?? [];
                const seen = new Set(prev.map(file => file.id));
                const added = items.filter(file => !seen.has(file.id));
                if (added.length === 0) return current;
                return { ...current, [bot.id]: [...added, ...prev] };
              });
            }}
          />
        ) : pane === 'Positions' ? null : <div className="composer-gap" />}
      </section>
      {pane === 'Main' && bot ? (
        <AgentDetail
          bot={bot}
          files={library[bot.id] ?? []}
          balanceLabel={glance.balanceLabel}
          onResize={event => dragPane(event, 'right')}
          onWallet={() => { setCreateOpen(false); setProfileOpen(false); setPluginsOpen(false); setStatsOpen(false); setWalletsOpen(true); }}
          onComputer={() => onAccount('computer')}
        />
      ) : null}
      <CreateBotDialog open={createOpen} onClose={closeCreate} onCreate={onCreate} />
      <WalletsSheet open={walletsOpen} onClose={closeWallets} state={{ ...base, bots, wallets }} note={walletNote} transfers={transfers} bot={bot} onParty={setParty} signedIn={signedIn} />
      <PartySheet
        open={Boolean(party)}
        party={party}
        transfers={transfers}
        payments={base.payments}
        onClose={() => setParty(null)}
        resolve={resolveMention}
      />
      <PluginsSheet open={pluginsOpen} onClose={closePlugins} connectors={base.connectors} />
      <ComputerSheet open={computerOpen} onClose={closeComputer} bot={bot} ownerId={ownerId} />
      <StatisticsSheet
        open={statsOpen}
        onClose={closeStats}
        bots={bots}
        ownerId={ownerId}
        voiceMs={voiceMs}
      />
      <ProfileSheet
        open={profileOpen}
        onClose={closeProfile}
        accountLabel={profile?.displayName || accountLabel}
        avatarUrl={avatarUrl}
        profile={profile}
        glance={glance}
        wallets={wallets}
        signedIn={signedIn}
        loginDisabled={loginDisabled}
        onLogin={onLogin}
        onLogout={onLogout}
        onSave={saveProfile}
      />
    </div>
  );
}
