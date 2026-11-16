'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import ClaimHandle from '../components/ClaimHandle';
import RecoveryCeremony from '../components/RecoveryCeremony';
import SlideCommit from '../components/bits/SlideCommit';
import PartySheet from '../components/PartySheet';
import PluginsSheet from '../components/PluginsSheet';
import StatisticsSheet from '../components/StatisticsSheet';
import AgentDetail from '../components/AgentDetail';
import AgentEdit from '../components/AgentEdit';
import HoldButton from '../components/HoldButton';
import ComputerSheet from '../components/ComputerSheet';
import { formatBaseUnits, moneyPane, walletGlance } from '../lib/money-views.mjs';
import { parsePlatformSend } from '../lib/platform-send.mjs';
import { netChangeSummary, readStoredPermission } from '../lib/spend-permission.mjs';
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
import { ownerIdFromPrivyUser, privyAccountLabel, sessionReadyForWallets } from '../lib/privy-config.mjs';
import { profileAfterDirectoryRead, profileRailLabel, profileSaveResult } from '../lib/profile.mjs';
import { pickWalletList, withAssignedWallet } from '../lib/wallet-assign.mjs';
import {
  deleteOwnerBot,
  emptyMoneyState,
  fetchOwnerLists,
  firstAssignableWalletId,
  shellBotFromRemote,
  shellRuntimeUrl,
  upsertOwnerBot,
} from '../lib/runtime-data.mjs';
import { isPlaceholderBotId, SHELL_PANES, shellConnectors, withoutPlaceholderBots } from '../lib/shell-chrome.mjs';
import { buildPermissionedSpendRequest, parseRecipient, privyAvatarUrl } from '@ubc2026/contracts';
import { addVoiceMs, readVoiceMs, voiceTimeKey } from '../lib/voice-time.mjs';
import { mergeObservedWallets, walletConfigNote, walletProvisionNote, walletsFromPrivyUser } from '../lib/wallet-provision.mjs';
import { accountSetupStep, clipAddress, readRecoveryAck, writeRecoveryAck } from '../lib/wallet-desk.mjs';
import { readTalks, writeTalks } from '../lib/talk-store.mjs';
import { reviseThread } from '../lib/talk-edit.mjs';
import { useToast } from '../components/bits/SwipeToast';
import { createVoiceClientTools } from '../lib/voice-client-tools.mjs';
import SignInPage from '../components/SignInPage';
import DeskLock from '../components/DeskLock';
import { usePrivyPublic } from '../components/PrivyRoot';
import { developerPreviewAllowed, hasStoredPrivySession, showSessionHold, showSignInGate } from '../lib/sign-in-gate.mjs';
import { clearDeskSession, deskSessionUntil, hotkeyTypingTarget, readDeskSession, walletHotkey, writeDeskSession } from '../lib/desk-lock.mjs';
import { getPrivyAccessToken } from '../lib/privy-session.mjs';

function readAccessToken(getAccessToken) {
  return getPrivyAccessToken(getAccessToken, window.localStorage);
}

const CONNECTORS = shellConnectors();

export default function HomePage() {
  const { configured } = usePrivyPublic();
  if (!configured) {
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

function SessionHold() {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (hasStoredPrivySession(window.localStorage)) setLabel('Restoring your session');
  }, []);
  return <div className="sign-in" aria-busy="true" role="status">{label}</div>;
}

function AuthedShell() {
  const { ready, authenticated, user, login, logout, getAccessToken: privyGetAccessToken } = usePrivy();
  const signedIn = ready && authenticated;
  const devAllowed = developerPreviewAllowed();
  const [devPreview, setDevPreview] = useState(false);
  const [liveWallets, setLiveWallets] = useState(null);
  const [walletNote, setWalletNote] = useState('');
  const accountsKey = linkedAccountsKey(user);

  const getAccessToken = useCallback(() => readAccessToken(privyGetAccessToken), [privyGetAccessToken]);

  const onLogout = useCallback(async () => {
    await logout?.();
  }, [logout]);

  useEffect(() => {
    if (!devAllowed) return undefined;
    const params = new URLSearchParams(window.location.search);
    if (params.get('dev') === '1') setDevPreview(true);
    return undefined;
  }, [devAllowed]);

  function enterDevPreview() {
    const url = new URL(window.location.href);
    url.searchParams.set('dev', '1');
    window.history.replaceState(null, '', url);
    setDevPreview(true);
  }

  function leaveDevPreview() {
    const url = new URL(window.location.href);
    url.searchParams.delete('dev');
    window.history.replaceState(null, '', url);
    setDevPreview(false);
  }

  useEffect(() => {
    if (!signedIn) {
      setLiveWallets(null);
      setWalletNote('');
      return undefined;
    }
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

        // Prefer Next Privy provision (Workers strip Origin on outbound Privy).
        // Next mirrors wallets into Supabase via /api/wallets/persist.
        const runtimeWallets = shellRuntimeUrl('/api/wallets');
        const provisionUrls = runtimeWallets ? ['/api/wallets', runtimeWallets] : ['/api/wallets'];
        let body = {};
        let ok = false;
        for (const url of provisionUrls) {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              ...(user?.id ? { 'x-owner-id': user.id } : {}),
            },
          });
          body = await response.json().catch(() => ({}));
          if (stopped) return;
          ok = response.ok && Array.isArray(body.wallets) && body.wallets.length > 0;
          if (ok) break;
          console.error('[wallets] provision failed', url, response.status, {
            error: body.error,
            detail: body.detail,
            missing: body.missing,
          });
        }
        if (!ok) {
          applyWalletFallback(user, body, setLiveWallets, setWalletNote);
          if (configNote && !body.error) {
            setWalletNote(current => (current ? `${current} ${configNote}` : configNote));
          }
          return;
        }
        setLiveWallets(mergeObservedWallets(body.wallets, user, ownerIdFromPrivyUser(user, true)));
        setWalletNote(walletProvisionNote(body, { ok: true }));
      } catch {
        if (!stopped) {
          applyWalletFallback(user, {}, setLiveWallets, setWalletNote);
        }
      }
    })();
    return () => { stopped = true; };
  }, [signedIn, user, user?.id, user?.hasAcceptedTerms, accountsKey, getAccessToken]);

  if (devPreview && devAllowed) {
    return (
      <Shell
        devPreview
        ownerId=""
        user={null}
        accountLabel="Developer"
        signedIn
        loginDisabled={false}
        onLogin={login}
        onLogout={leaveDevPreview}
        liveWallets={[]}
        walletNote="Developer preview. Sample balances. Live prices come from DexScreener."
        getAccessToken={async () => null}
      />
    );
  }

  if (showSessionHold({ privyConfigured: true, ready })) {
    return <SessionHold />;
  }

  if (showSignInGate({ privyConfigured: true, ready, authenticated })) {
    return <SignInPage onLogin={login} onDeveloperPreview={devAllowed ? enterDevPreview : null} />;
  }

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

async function resolveSnsProxy(domain) {
  try {
    const response = await fetch(`/api/sns/resolve?domain=${encodeURIComponent(domain)}`, { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (typeof body.address === 'string' && body.address) {
      return { kind: 'sns', domain: body.domain || domain, address: body.address };
    }
    return { kind: 'sns', domain, error: body.error || 'sns_not_found' };
  } catch {
    return { kind: 'sns', domain, error: 'sns_failed' };
  }
}

function transferFailure(body, handle) {
  if (body?.error === 'handle_missing') return `@${handle} is not on Maelstrom.`;
  if (body?.error === 'wallet_frozen') return 'That wallet is frozen.';
  if (body?.error === 'recipient_wallet_missing') return `@${handle} does not have a wallet yet.`;
  if (body?.error === 'policy_blocked') return 'The agent policy blocked this send.';
  return 'The send did not post.';
}

function Shell({ ownerId, user = null, accountLabel, signedIn, devPreview = false, loginDisabled, onLogin, onLogout, liveWallets = null, walletNote = '', getAccessToken = null }) {
  const toast = useToast();
  const [looks, setLooks] = useState({});
  const [roster, setRoster] = useState({ order: [], extra: [] });
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railIcons, setRailIcons] = useState(false);
  const [sideWidth, setSideWidth] = useState(300);
  const [detailWidth, setDetailWidth] = useState(280);
  const [paneDrag, setPaneDrag] = useState(false);
  const [activeBot, setActiveBot] = useState(null);
  const [cornerEdit, setCornerEdit] = useState(null);
  const [pendingSend, setPendingSend] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const unlockedRef = useRef(false);
  const unlockUntilRef = useRef(0);
  const lockIntentRef = useRef(null);
  const deskLockOnRef = useRef(false);
  deskLockOnRef.current = signedIn && Boolean(ownerId);
  const [pane, setPane] = useState('Main');
  const [slide, setSlide] = useState('right');
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [talks, setTalks] = useState({});
  const talksRef = useRef(talks);
  talksRef.current = talks;
  const [talksReady, setTalksReady] = useState(false);
  const [rosterReady, setRosterReady] = useState(false);
  const [thinkingBot, setThinkingBot] = useState(null);
  const [botRecords, setBotRecords] = useState([]);
  const [remoteLists, setRemoteLists] = useState(() => emptyMoneyState());
  const [profile, setProfile] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [recoveryAck, setRecoveryAck] = useState(null);
  const [claimWelcome, setClaimWelcome] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const pushReceipt = useCallback((receipt) => {
    if (!receipt || typeof receipt.id !== 'string' || !receipt.id) return;
    setReceipts(current => [receipt, ...current.filter(item => item.id !== receipt.id)].slice(0, 40));
  }, []);
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
  function onEditLine(lineId, text) {
    if (!bot || thinkingBot === bot.id) return;
    const revised = reviseThread(talksRef.current[bot.id] ?? [], lineId, text);
    if (!revised) return;
    setTalks(current => ({
      ...current,
      [bot.id]: compactLines(revised.lines),
    }));
  }
  const appendTalk = useCallback((botId, line) => {
    setTalks(current => ({
      ...current,
      [botId]: compactLines([...(current[botId] ?? []), line].slice(-80)),
    }));
  }, []);
  useEffect(() => {
    setLooks({});
    setRoster({ order: [], extra: [] });
    setActiveBot(null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    setRosterReady(false);
    if (!ownerId) {
      setLooks({});
      setRoster({ order: [], extra: [] });
      setActiveBot(null);
      setRosterReady(true);
      return undefined;
    }
    const adopted = adoptLegacyRoster(localStorage, ownerId);
    const savedRoster = withoutPlaceholderBots(adopted.adopted ? adopted.roster : readRoster(localStorage, ownerId));
    const savedLooks = adopted.adopted ? adopted.looks : readLooks(localStorage, ownerId);
    const merged = mergeRoster([], savedRoster);
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
    try {
      setRecoveryAck(ownerId ? readRecoveryAck(localStorage, ownerId) : false);
    } catch {
      setRecoveryAck(false);
    }
  }, [ownerId]);

  useEffect(() => {
    const key = profileKey(ownerId);
    if (!key) {
      setProfile(null);
      setProfileReady(false);
      return undefined;
    }
    setProfileReady(false);
    let local = null;
    try {
      const raw = localStorage.getItem(key);
      local = raw ? JSON.parse(raw) : null;
      if (local?.handle && local?.displayName) setProfile(local);
      else setProfile(null);
    } catch {
      local = null;
      setProfile(null);
    }
    const profileUrl = shellRuntimeUrl('/api/profiles/me');
    const accountUrl = shellRuntimeUrl('/api/me');
    if (!profileUrl) {
      setProfileReady(true);
      return undefined;
    }
    let stop = false;
    (async () => {
      try {
        const headers = { 'x-owner-id': ownerId };
        const [response] = await Promise.all([
          fetch(profileUrl, { headers, cache: 'no-store' }),
          accountUrl ? fetch(accountUrl, { headers, cache: 'no-store' }).catch(() => null) : null,
        ]);
        const body = await response.json();
        if (stop) return;
        const next = profileAfterDirectoryRead(local, body);
        if (next.persist === 'write' && next.profile) {
          setProfile(next.profile);
          localStorage.setItem(key, JSON.stringify(next.profile));
        } else if (next.persist === 'clear') {
          setProfile(null);
          localStorage.removeItem(key);
        } else if (next.profile) {
          setProfile(next.profile);
        }
      } catch {
        // Keep the profile stored on this device.
      } finally {
        if (!stop) setProfileReady(true);
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
    const transfersUrl = shellRuntimeUrl('/api/transfers');
    if (!transfersUrl) return undefined;
    let stop = false;
    (async () => {
      try {
        const token = await getAccessToken?.();
        const response = await fetch(transfersUrl, {
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

  useEffect(() => {
    if (!ownerId) {
      setRemoteLists(emptyMoneyState());
      return undefined;
    }
    let stop = false;
    (async () => {
      let accessToken = '';
      if (sessionReadyForWallets(signedIn, user)) {
        try { accessToken = (await getAccessToken?.()) || ''; } catch { accessToken = ''; }
      }
      try {
        const lists = await fetchOwnerLists(ownerId, { accessToken });
        if (!stop && lists) setRemoteLists(lists);
      } catch {
        if (!stop) setRemoteLists(emptyMoneyState());
      }
    })();
    return () => { stop = true; };
  }, [ownerId, signedIn, user, getAccessToken, liveWallets]);

  // Backfill local-only roster bots into Supabase once a Supabase wallet exists.
  // Do not use liveWallets-only ids — bots.create 404s with wallet_not_found.
  useEffect(() => {
    if (!ownerId || !rosterReady || !signedIn) return undefined;
    const walletId = firstAssignableWalletId(remoteLists.wallets);
    if (!walletId) return undefined;
    const remoteIds = new Set((remoteLists.bots || []).map((bot) => bot?.id).filter(Boolean));
    const localBots = mergeRoster([], withoutPlaceholderBots(roster)).bots
      .filter((bot) => bot?.id && !isPlaceholderBotId(bot.id));
    const missing = localBots.filter((bot) => bot?.id && !remoteIds.has(bot.id));
    if (missing.length === 0) return undefined;
    let stop = false;
    (async () => {
      let accessToken = '';
      try { accessToken = (await getAccessToken?.()) || ''; } catch { accessToken = ''; }
      let wrote = 0;
      for (const bot of missing.slice(0, 20)) {
        if (stop) return;
        const saved = await upsertOwnerBot(ownerId, bot, { walletId, accessToken });
        if (saved.ok) wrote += 1;
        // Stop hammering when the wallet is not in Supabase yet.
        if (!saved.ok && (saved.error === 'wallet_not_found' || saved.status === 404)) break;
      }
      if (!wrote || stop) return;
      try {
        const lists = await fetchOwnerLists(ownerId, { accessToken });
        if (!stop && lists) setRemoteLists(lists);
      } catch { /* keep local */ }
    })();
    return () => { stop = true; };
  }, [ownerId, rosterReady, signedIn, roster, remoteLists.bots, remoteLists.wallets, getAccessToken]);

  const saveProfile = useCallback(async (next) => {
    const stored = { ...next, avatarUrl: next.avatarUrl || privyAvatarUrl(user) || null };
    const key = profileKey(ownerId);
    const profileUrl = ownerId ? shellRuntimeUrl('/api/profiles/me') : null;
    if (profileUrl && ownerId) {
      const response = await fetch(profileUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-owner-id': ownerId },
        body: JSON.stringify(stored),
      });
      const body = await response.json().catch(() => ({}));
      const saved = profileSaveResult(response.status, body, stored.handle);
      if (!saved.ok) {
        const error = new Error(saved.error);
        error.code = saved.error;
        error.status = saved.status;
        throw error;
      }
      const confirmed = {
        ...stored,
        handle: saved.profile.handle,
        displayName: saved.profile.displayName || stored.displayName,
        avatarUrl: saved.profile.avatarUrl || stored.avatarUrl || null,
      };
      setProfile(confirmed);
      if (key) localStorage.setItem(key, JSON.stringify(confirmed));
      return { ok: true, source: body.source || 'supabase', profile: confirmed };
    }
    setProfile(stored);
    if (key) localStorage.setItem(key, JSON.stringify(stored));
    return { ok: true, source: 'local' };
  }, [ownerId, user]);

  const resolveMention = useCallback(async (token) => {
    const parsed = parseRecipient(token);
    if (!parsed) return null;
    const lookupPath = ownerId ? shellRuntimeUrl(`/api/profiles/lookup?q=${encodeURIComponent(token)}`) : null;
    if (lookupPath && ownerId) {
      try {
        const url = lookupPath;
        const response = await fetch(url, { headers: { 'x-owner-id': ownerId }, cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (body.recipient?.address) return body.recipient;
        if (parsed.kind === 'sns') return resolveSnsProxy(parsed.domain);
      } catch {
        // Fall through to the profile stored on this device.
      }
    }
    if (parsed.kind === 'handle' && profile?.handle === parsed.handle) {
      return { kind: 'handle', handle: profile.handle, displayName: profile.displayName, self: true };
    }
    if (parsed.kind === 'sns') return resolveSnsProxy(parsed.domain);
    return { kind: 'handle', handle: parsed.handle, missing: true };
  }, [ownerId, profile]);

  const remoteBots = useMemo(
    () => (remoteLists.bots || [])
      .map((row) => shellBotFromRemote(row, looks))
      .filter((bot) => bot && !isPlaceholderBotId(bot.id)),
    [remoteLists.bots, looks],
  );
  const localRoster = useMemo(() => mergeRoster([], withoutPlaceholderBots(roster)), [roster]);
  const seedBots = useMemo(() => {
    const overlay = new Map(botRecords.map((bot) => [bot.id, bot]));
    const byId = new Map();
    for (const bot of remoteBots) byId.set(bot.id, bot);
    for (const bot of localRoster.bots) {
      const prior = byId.get(bot.id);
      byId.set(bot.id, prior
        ? { ...prior, name: bot.name, shape: bot.shape, color: bot.color }
        : bot);
    }
    const order = [];
    for (const id of localRoster.order) if (byId.has(id)) order.push(id);
    for (const bot of remoteBots) if (!order.includes(bot.id)) order.push(bot.id);
    return order.map((id) => ({ ...byId.get(id), ...(overlay.get(id) || {}) }));
  }, [botRecords, localRoster, remoteBots]);
  const styled = useMemo(() => applyLooks(seedBots, looks), [seedBots, looks]);
  const assigned = useMemo(() => withAssignedWallet(styled, liveWallets), [styled, liveWallets]);
  const bots = assigned.bots;
  const wallets = pickWalletList(assigned.wallets, remoteLists.wallets);
  const payments = remoteLists.payments || [];
  const paymentCrossCheck = remoteLists.paymentCrossCheck || [];
  const positions = remoteLists.positions || [];
  const visible = bots.filter(bot => bot.name.toLowerCase().includes(query.trim().toLowerCase()));
  const bot = bots.find(item => item.id === activeBot) ?? null;
  const money = moneyPane(pane);
  const glance = walletGlance(wallets, positions, transfers);
  const setupStep = devPreview ? null : accountSetupStep({
    signedIn,
    profileReady,
    handle: profile?.handle || '',
    walletsReady: liveWallets !== null,
    walletCount: Array.isArray(liveWallets) ? liveWallets.length : 0,
    recoveryConfirmed: recoveryAck === true,
  });
  const grantDesk = useCallback(() => {
    const until = deskSessionUntil(Date.now());
    unlockUntilRef.current = until;
    try { writeDeskSession(localStorage, ownerId, until); } catch { /* this tab still unlocks */ }
    unlockedRef.current = true;
    setUnlocked(true);
    setLockOpen(false);
    const intent = lockIntentRef.current;
    lockIntentRef.current = null;
    if (intent?.type === 'wallet') setWalletsOpen(true);
    if (intent?.type === 'spend' && intent.pending) setPendingSend(intent.pending);
  }, [ownerId]);
  const dismissLock = useCallback(() => {
    const intent = lockIntentRef.current;
    lockIntentRef.current = null;
    setLockOpen(false);
    if (intent?.type === 'spend' && intent.pending) {
      appendTalk(intent.pending.botId, {
        id: `${intent.pending.lineId}-send`,
        role: 'assistant',
        text: 'The send stayed unsent.',
      });
    }
  }, [appendTalk]);
  const openWallet = useCallback(() => {
    setCreateOpen(false);
    setProfileOpen(false);
    setPluginsOpen(false);
    setStatsOpen(false);
    if (deskLockOnRef.current && !unlockedRef.current) {
      lockIntentRef.current = { type: 'wallet' };
      setWalletsOpen(false);
      setLockOpen(true);
      return;
    }
    setWalletsOpen(true);
  }, []);
  const onWalletSend = useCallback(async (pending) => {
    if (deskLockOnRef.current && !unlockedRef.current) {
      lockIntentRef.current = { type: 'wallet' };
      setLockOpen(true);
      return { ok: false, message: 'Enter your password to use the wallet.' };
    }
    const target = pending?.target;
    if (target?.kind === 'sns') {
      const main = (Array.isArray(liveWallets) ? liveWallets : wallets).find(item => item?.kind === 'main') || null;
      if (!main) return { ok: false, message: 'The main wallet is not ready.' };
      try {
        if (!sessionReadyForWallets(signedIn, user)) return { ok: false, message: 'Sign in again, then send.' };
        const token = await getAccessToken?.();
        const response = await fetch('/api/sns/send', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            'x-owner-id': ownerId,
          },
          body: JSON.stringify({ domain: target.domain, amount: pending.amount, wallet: main }),
        });
        const body = await response.json().catch(() => ({}));
        const where = body.address ? clipAddress(body.address) : target.domain;
        if (body.error === 'missing_config') {
          const names = Array.isArray(body.missing) ? body.missing.join(', ') : 'QUICKNODE_DEVNET_RPC_URL';
          return { ok: false, message: `${target.domain} is ${where}. The devnet send needs ${names}.` };
        }
        if (body.error === 'sns_not_found' || body.error === 'sns_failed') {
          return { ok: false, message: 'Failed.' };
        }
        if (!response.ok || !body.signature) {
          return { ok: false, message: `The send to ${where} did not post.` };
        }
        const amountLabel = `${formatBaseUnits(pending.amount)} USDC`;
        return {
          ok: true,
          message: `Sent ${amountLabel} to ${target.domain}(${where}).`,
          signature: body.signature,
          receipt: {
            id: `sns_${body.signature}`,
            at: new Date().toISOString(),
            title: `Send ${amountLabel}`,
            lines: [
              { label: 'To', value: `${target.domain} (${where})` },
              { label: 'Amount', value: amountLabel },
              { label: 'Signature', value: body.signature },
              { label: 'Network', value: 'devnet execution, mainnet pricing' },
            ],
            signature: body.signature,
            cluster: 'devnet',
          },
        };
      } catch {
        return { ok: false, message: 'The send did not post.' };
      }
    }
    if (target?.kind !== 'handle' || pending?.asset !== 'USDC') {
      return { ok: false, message: 'Platform sends are USDC to a @handle.' };
    }
    const transfersUrl = shellRuntimeUrl('/api/transfers');
    if (!transfersUrl) return { ok: false, message: 'Platform sends need the agent runtime.' };
    try {
      if (!sessionReadyForWallets(signedIn, user)) return { ok: false, message: 'Sign in again, then send.' };
      const token = await getAccessToken?.();
      const idempotencyKey = `wallet_${target.handle}_${pending.amount}_${Date.now()}`.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 128);
      const response = await fetch(transfersUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-owner-id': ownerId,
        },
        body: JSON.stringify({
          handle: target.handle,
          amount: pending.amount,
          idempotencyKey,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.transfer) {
        const message = body.error === 'handle_missing'
          ? `@${target.handle} is not on Maelstrom.`
          : body.error === 'recipient_wallet_missing'
            ? `@${target.handle} does not have a wallet yet.`
            : body.error === 'wallet_frozen'
              ? 'That wallet is frozen.'
              : 'The send did not post.';
        return { ok: false, message };
      }
      setTransfers(current => [body.transfer, ...current.filter(item => item.id !== body.transfer.id)]);
      const amountLabel = `${formatBaseUnits(body.transfer.amount)} USDC`;
      return {
        ok: true,
        message: `Sent ${amountLabel} to @${body.transfer.handle}.`,
        receipt: {
          id: body.transfer.id,
          at: body.transfer.createdAt || new Date().toISOString(),
          title: `Sent ${amountLabel}`,
          lines: [
            { label: 'To', value: `@${body.transfer.handle}` },
            { label: 'Amount', value: amountLabel },
            { label: 'Network', value: 'Platform ledger · devnet execution, mainnet pricing' },
          ],
          cluster: 'devnet',
        },
      };
    } catch {
      return { ok: false, message: 'The send did not post.' };
    }
  }, [liveWallets, wallets, signedIn, user, getAccessToken, ownerId]);
  const confirmResolve = useRef(null);
  const [slideConfirm, setSlideConfirm] = useState(null);
  const askSlideConfirm = useCallback((prompt) => new Promise((resolve) => {
    confirmResolve.current = resolve;
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    setSlideConfirm(text || 'Confirm this action?');
  }), []);
  const finishSlideConfirm = useCallback((accepted) => {
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    setSlideConfirm(null);
    if (resolve) resolve(accepted === true);
  }, []);
  const lockWallet = useCallback(() => {
    unlockUntilRef.current = 0;
    try { clearDeskSession(localStorage, ownerId); } catch { /* the in-memory lock still applies */ }
    unlockedRef.current = false;
    setUnlocked(false);
    setLockOpen(false);
    lockIntentRef.current = null;
    setWalletsOpen(false);
    setPendingSend(null);
    finishSlideConfirm(false);
  }, [ownerId, finishSlideConfirm]);
  useEffect(() => {
    if (!signedIn || !ownerId) return undefined;
    function onKey(event) {
      const action = walletHotkey(event);
      if (!action || hotkeyTypingTarget(event.target)) return;
      event.preventDefault();
      if (action === 'lock') {
        lockWallet();
        toast?.('Wallet locked');
        return;
      }
      setLockOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [signedIn, ownerId, lockWallet, toast]);
  useEffect(() => {
    let open = false;
    unlockUntilRef.current = 0;
    if (ownerId) {
      try {
        const session = readDeskSession(localStorage, ownerId, Date.now());
        open = Boolean(session);
        if (session) unlockUntilRef.current = session.until;
      } catch { open = false; }
    }
    unlockedRef.current = open;
    setUnlocked(open);
    setLockOpen(false);
    lockIntentRef.current = null;
    setPendingSend(null);
  }, [ownerId]);
  useEffect(() => {
    if (!unlocked || !ownerId) return undefined;
    const tick = () => {
      if (Date.now() < unlockUntilRef.current) return;
      let session = null;
      try { session = readDeskSession(localStorage, ownerId, Date.now()); } catch { session = null; }
      if (session) {
        unlockUntilRef.current = session.until;
        return;
      }
      lockWallet();
    };
    const id = window.setInterval(tick, 1000);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
    };
  }, [unlocked, ownerId, lockWallet]);
  const clientTools = useMemo(() => createVoiceClientTools({
    bots,
    wallets,
    activeBotId: activeBot,
    pane,
    setActiveBotId: setActiveBot,
    setPane,
    focusLiveView: () => {
      setPane('Main');
      setComputerOpen(true);
    },
    confirm: askSlideConfirm,
  }), [bots, wallets, activeBot, pane, askSlideConfirm]);

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
      [created.id]: { name: created.name, shape: created.shape, color: created.color, image: created.image || '' },
    }));
    setActiveBot(created.id);
    setQuery('');
    setSlide('right');
    setPane('Main');
    setCreateOpen(false);
    // Shell create is local-first; persist so voice/text list_bots can see the bot.
    const walletId = firstAssignableWalletId(remoteLists.wallets) || firstAssignableWalletId(wallets);
    if (walletId) {
      void (async () => {
        let accessToken = '';
        try { accessToken = (await getAccessToken?.()) || ''; } catch { accessToken = ''; }
        const saved = await upsertOwnerBot(ownerId, created, { walletId, accessToken });
        if (!saved.ok) return;
        try {
          const lists = await fetchOwnerLists(ownerId, { accessToken });
          if (lists) setRemoteLists(lists);
        } catch { /* keep local roster */ }
      })();
    }
  }

  function onEditLook(id, patch) {
    const currentBot = bots.find(item => item.id === id);
    setLooks(current => {
      const prev = current[id] ?? {};
      const next = {
        ...prev,
        name: patch.name ?? currentBot?.name,
        shape: patch.shape ?? currentBot?.shape,
        color: patch.color ?? currentBot?.color,
        image: patch.image ?? currentBot?.image ?? '',
      };
      return { ...current, [id]: next };
    });
    if (patch.name) {
      setRoster(current => ({
        ...current,
        extra: current.extra.map(item => (item.id === id ? { ...item, name: patch.name, color: patch.color, shape: patch.shape } : item)),
      }));
    }
  }

  function onReorder(fromId, toId) {
    setRoster(current => ({ ...current, order: reorderIds(current.order, fromId, toId) }));
  }

  function onDelete(id) {
    const name = bots.find(item => item.id === id)?.name ?? 'Agent';
    if (ownerId) {
      const tokenPromise = sessionReadyForWallets(signedIn, user)
        ? Promise.resolve(getAccessToken?.()).catch(() => '')
        : Promise.resolve('');
      void tokenPromise.then((accessToken) => deleteOwnerBot(ownerId, id, { accessToken: accessToken || '' }));
    }
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
      openWallet();
      return;
    }
    if (id === 'lock-wallet') {
      lockWallet();
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

  async function settleSpend(pending, confirmed) {
    const reply = (text) => appendTalk(pending.botId, { id: `${pending.lineId}-send`, role: 'assistant', text });
    if (deskLockOnRef.current && !unlockedRef.current) {
      lockIntentRef.current = { type: 'spend', pending };
      setLockOpen(true);
      return;
    }
    const permission = pending.permission || readStoredPermission(typeof localStorage === 'undefined' ? null : localStorage);
    let requestBody;
    try {
      requestBody = buildPermissionedSpendRequest({
        botId: pending.botId,
        permission,
        action: 'spend',
        amount: pending.command.amount,
        handle: pending.command.handle,
        asset: 'USDC',
        confirmed: confirmed === true,
        idempotencyKey: pending.command.idempotencyKey,
      });
    } catch {
      reply('The send did not post.');
      return;
    }
    const spendUrl = shellRuntimeUrl(requestBody.path);
    if (!spendUrl) {
      reply('Platform sends need the agent runtime.');
      toast?.('Platform sends need the agent runtime.');
      return;
    }
    try {
      if (!sessionReadyForWallets(signedIn, user)) return;
      const token = await getAccessToken?.();
      const response = await fetch(spendUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-owner-id': ownerId,
        },
        body: JSON.stringify(requestBody.body),
      });
      const body = await response.json().catch(() => ({}));
      if (body.state === 'approval-needed' && !confirmed) {
        setPendingSend({ ...pending, permission });
        return;
      }
      if (body.signed === true && body.signature) {
        const amountLabel = `${formatBaseUnits(pending.command.amount)} USDC`;
        pushReceipt({
          id: body.signature,
          at: new Date().toISOString(),
          title: `Sent ${amountLabel}`,
          lines: [
            { label: 'To', value: `@${pending.command.handle}` },
            { label: 'Amount', value: amountLabel },
            { label: 'Network', value: 'Solana devnet' },
          ],
          signature: body.signature,
          cluster: 'devnet',
        });
        reply(`Sent ${amountLabel} to @${pending.command.handle} on devnet.`);
        toast?.(`Sent ${amountLabel} to @${pending.command.handle}`);
        return;
      }
      if (body.state === 'signer-not-configured' || body.state === 'recipient_address_missing') {
        await postPlatformTransfer(pending, reply);
        return;
      }
      const reason = body.state === 'blocked' && body.reason === 'spend-frozen'
        ? 'That wallet is frozen.'
        : body.state === 'quote-not-authorization'
          ? 'A mainnet quote cannot authorize this send.'
          : body.state === 'approval-needed'
            ? 'The send still needs you to confirm it.'
            : 'The send did not post.';
      reply(reason);
      toast?.(reason);
    } catch {
      reply('The send did not post.');
      toast?.('The send did not post.');
    }
  }

  async function postPlatformTransfer(pending, reply) {
    const transfersUrl = shellRuntimeUrl('/api/transfers');
    if (!transfersUrl) {
      reply('Platform sends need the agent runtime.');
      toast?.('Platform sends need the agent runtime.');
      return;
    }
    const token = await getAccessToken?.();
    const response = await fetch(transfersUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-owner-id': ownerId,
      },
      body: JSON.stringify({
        ...pending.command,
        botId: pending.botId,
        idempotencyKey: `send_${pending.botId}_${pending.command.handle}_${pending.command.amount}`.replace(/[^a-zA-Z0-9:_-]/g, '_'),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.transfer) {
      const reason = body.error === 'handle_missing'
        ? `@${pending.command.handle} is not on Maelstrom.`
        : body.error === 'wallet_frozen'
          ? 'That wallet is frozen.'
          : body.error === 'recipient_wallet_missing'
            ? `@${pending.command.handle} does not have a wallet yet.`
            : body.error === 'policy_blocked'
              ? 'The agent policy blocked this send.'
              : 'The send did not post.';
      reply(reason);
      toast?.(reason);
      return;
    }
    setTransfers(current => [body.transfer, ...current.filter(item => item.id !== body.transfer.id)]);
    const amountLabel = `${formatBaseUnits(body.transfer.amount)} USDC`;
    pushReceipt({
      id: body.transfer.id,
      at: body.transfer.createdAt || new Date().toISOString(),
      title: `Sent ${amountLabel}`,
      lines: [
        { label: 'To', value: `@${body.transfer.handle}` },
        { label: 'Amount', value: amountLabel },
        { label: 'Network', value: 'Platform ledger · devnet execution, mainnet pricing' },
      ],
      cluster: 'devnet',
    });
    reply(`Sent ${amountLabel} to @${body.transfer.handle}. It is in their wallet.`);
    toast?.(`Sent ${amountLabel} to @${body.transfer.handle}`);
  }

  useEffect(() => {
    if (!railCollapsed) {
      setRailIcons(false);
      return undefined;
    }
    const timer = setTimeout(() => setRailIcons(true), 420);
    return () => clearTimeout(timer);
  }, [railCollapsed]);

  const sideColumn = railCollapsed ? 88 : sideWidth;
  const noAgents = bots.length === 0;
  return (
    <>
    <div
      className={`shell${noAgents ? ' is-empty' : ''}${pane === 'Positions' ? ' is-book' : ''}${railCollapsed ? ' is-collapsed' : ''}${pane === 'Main' && bot ? ' has-detail' : ''}${paneDrag ? ' is-dragging-pane' : ''}${setupStep === 'handle' || claimWelcome ? ' is-claim' : ''}`}
      style={{ '--side-w': `${sideColumn}px`, '--detail-w': `${detailWidth}px`, '--pill-detail': bot ? `${detailWidth}px` : '0px' }}
    >
      <aside className={`side${railIcons ? ' is-collapsed' : ''}`}>
        {noAgents ? null : (
        <div
          className="pane-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agents"
          onPointerDown={event => dragPane(event, 'left')}
        />
        )}
        {noAgents ? null : <div className="side-tools">
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
        </div>}
        {noAgents ? null : <BotRail
          bots={visible}
          activeId={bot?.id}
          canDrag={!query.trim()}
          collapsed={railIcons}
          onSelect={openChat}
          onReorder={onReorder}
          onDelete={onDelete}
          onEdit={onEditLook}
          onCreate={() => setCreateOpen(true)}
        />}
        {noAgents ? null : <footer className="you">
          <AccountMenu
            accountLabel={profileRailLabel({
              handle: profile?.handle,
              displayName: profile?.displayName,
              fallback: accountLabel,
            })}
            avatarUrl={avatarUrl}
            collapsed={railIcons}
            signedIn={signedIn}
            loginDisabled={loginDisabled}
            walletUnlocked={unlocked}
            onLogin={onLogin}
            onPick={onAccount}
          />
        </footer>}
      </aside>

      <section className={`stage${pane === 'Positions' ? ' is-book' : ''}`}>
        {noAgents ? null : (
        <header className="topbar">
          <span className="topbar-side" />
          <PaneDock panes={SHELL_PANES} pane={pane} onChange={choosePane} />
          <span />
        </header>
        )}
        <div key={`${pane}-${slide}`} className={`thread slide-${slide}${pane === 'Positions' ? ' is-book' : ''}${pane === 'Main' ? ' is-chat' : ''}`}>
          <article className={`bubble${pane === 'Positions' ? ' is-book' : ''}`} aria-label={pane}>
            {noAgents ? (
                <div className={`empty-hold${createOpen ? ' is-away' : ''}`}>
                  <p className="empty-hold__title">Create your first agent</p>
                  <div className="empty-hold__control">
                  <HoldButton
                    className="empty-create"
                    doneLabel="Create"
                    backgroundColor="#f4f1fb"
                    fillColor="#7c5cff"
                    textColor="#120f17"
                    fillTextColor="#f7f4ff"
                    size="lg"
                    radius={999}
                    holdTime={1200}
                    onHold={() => setCreateOpen(true)}
                  >
                    Create
                  </HoldButton>
                  <span className="empty-hold__hint">Hold to create</span>
                  </div>
                </div>
            ) : pane === 'Main' && bot ? (
                <AgentThread
                  key={bot.id}
                  bot={bot}
                  ownerId={ownerId}
                  lines={talks[bot.id] ?? []}
                  thinking={thinkingBot === bot.id}
                  onParty={setParty}
                  onEdit={onEditLine}
                />
            ) : null}
            {!noAgents && money ? (
              <MoneyPane
                pane={money}
                state={{ bots, wallets, payments, positions, transfers, paymentCrossCheck }}
                onParty={setParty}
                ownerId={ownerId}
                getAccessToken={getAccessToken}
              />
            ) : null}
            {!noAgents && pane === 'Logs' ? (
              <LogsPanel
                bots={bots}
                ownerId={ownerId}
                onParty={setParty}
                receipts={receipts}
                payments={payments}
                transfers={transfers}
              />
            ) : null}
            {!noAgents && pane === 'Security' ? (
              <SecurityPanel
                bots={bots}
                ownerId={ownerId}
                accountLabel={accountLabel}
                wallets={wallets}
                walletUnlocked={unlocked}
                onWalletLocked={() => setLockOpen(true)}
                onBotsChange={(next) => setBotRecords(next)}
              />
            ) : null}
          </article>
        </div>
        {bot ? (
          <Composer
            hidden={pane !== 'Main'}
            botId={bot.id}
            botName={bot.name}
            botGoal={bot.goal}
            botType={bot.type}
            ownerId={ownerId}
            shellBots={bots}
            shellWallets={wallets}
            shellBalanceLabel={glance.balanceLabel}
            clientTools={clientTools}
            lines={talks[bot.id] ?? []}
            onLine={(line, forBot) => {
              const id = forBot || bot.id;
              appendTalk(id, line);
              if (line.role !== 'user') return;
              const command = parsePlatformSend(line.text);
              if (!command || !ownerId) return;
              const permission = readStoredPermission(typeof localStorage === 'undefined' ? null : localStorage);
              const pending = {
                botId: id,
                lineId: line.id,
                command,
                permission,
                summary: netChangeSummary({ amount: command.amount, asset: 'USDC', handle: command.handle }),
              };
              if (deskLockOnRef.current && !unlockedRef.current) {
                lockIntentRef.current = { type: 'spend', pending };
                setLockOpen(true);
                return;
              }
              setPendingSend(pending);
            }}
            onThinking={on => setThinkingBot(on ? bot.id : null)}
            onVoiceSpan={addVoice}
            resolveMention={resolveMention}
            usage={contextUsage(talks[bot.id] ?? [])}
            onEditLine={onEditLine}
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
          ownerId={ownerId}
          onResize={event => dragPane(event, 'right')}
          onWallet={openWallet}
          onComputer={() => onAccount('computer')}
          onEdit={(event) => setCornerEdit({ x: event.clientX, y: event.clientY })}
        />
      ) : null}
      {cornerEdit && bot ? (
        <AgentEdit
          bot={bot}
          x={cornerEdit.x}
          y={cornerEdit.y}
          onClose={() => setCornerEdit(null)}
          onSave={onEditLook}
          onDelete={(id) => { onDelete(id); setCornerEdit(null); }}
        />
      ) : null}
      <CreateBotDialog open={createOpen} onClose={closeCreate} onCreate={onCreate} first={bots.length === 0} />
      {setupStep === 'loading' ? (
        <div className="backdrop is-center">
          <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-label="Setting up your account">
            <h2>Setting up your account</h2>
            <p className="quiet">Checking your handle and wallet.</p>
          </section>
        </div>
      ) : null}
      {setupStep === 'handle' || claimWelcome ? (
        <ClaimHandle
          accountLabel={profile?.displayName || accountLabel}
          ownerId={ownerId}
          onSave={async (next) => {
            const saved = await saveProfile(next);
            if (saved?.ok) setClaimWelcome(true);
            return saved;
          }}
          onContinue={() => setClaimWelcome(false)}
        />
      ) : null}
      {setupStep === 'recovery' && !claimWelcome ? (
        <RecoveryCeremony
          wallets={liveWallets || []}
          handle={profile?.handle || ''}
          onDone={() => {
            try { writeRecoveryAck(localStorage, ownerId); } catch { /* the phrase stays in the download only */ }
            setRecoveryAck(true);
          }}
        />
      ) : null}
      <WalletsSheet
        open={walletsOpen}
        onClose={closeWallets}
        state={{ bots, wallets, payments, positions }}
        note={walletNote}
        transfers={transfers}
        bot={bot}
        onParty={setParty}
        signedIn={signedIn}
        devPreview={devPreview}
        ownerId={ownerId || ''}
        handle={profile?.handle || ''}
        onSend={onWalletSend}
        onReceipt={pushReceipt}
      />
      <PartySheet
        open={Boolean(party)}
        party={party}
        transfers={transfers}
        payments={payments}
        onClose={() => setParty(null)}
        resolve={resolveMention}
      />
      <PluginsSheet open={pluginsOpen} onClose={closePlugins} connectors={CONNECTORS} />
      <ComputerSheet open={computerOpen} onClose={closeComputer} bot={bot} ownerId={ownerId} />
      <StatisticsSheet
        open={statsOpen}
        onClose={closeStats}
        bots={bots}
        ownerId={ownerId}
        voiceMs={voiceMs}
        talks={talks}
        payments={payments}
        transfers={transfers}
      />
      {slideConfirm ? (
        <div className="backdrop is-center" onMouseDown={() => finishSlideConfirm(false)}>
          <section className="spend-confirm" role="dialog" aria-modal="true" aria-label="Confirm" onMouseDown={event => event.stopPropagation()}>
            <h2>Confirm</h2>
            <p className="quiet">{slideConfirm}</p>
            <div className="spend-actions">
              <button type="button" className="ghost" onClick={() => finishSlideConfirm(false)}>Cancel</button>
            </div>
            <SlideCommit
              label="Slide to confirm"
              doneLabel="Confirmed"
              onCommit={() => finishSlideConfirm(true)}
            />
          </section>
        </div>
      ) : null}
      {pendingSend ? (
        <div className="backdrop is-center" onMouseDown={() => setPendingSend(null)}>
          <section className="spend-confirm" role="dialog" aria-modal="true" aria-label="Transaction summary" onMouseDown={event => event.stopPropagation()}>
            <h2>{pendingSend.summary.title}</h2>
            <ul>
              {pendingSend.summary.lines.map(row => (
                <li key={`${row.label}-${row.signed}`}>
                  <span>{row.label}</span>
                  <strong>{row.signed}</strong>
                </li>
              ))}
            </ul>
            <p className="spend-net"><span>Net</span><span>{pendingSend.summary.net}</span></p>
            <p className="quiet">Nothing is signed until you confirm.</p>
            <div className="spend-actions">
              <button type="button" className="ghost" onClick={() => {
                appendTalk(pendingSend.botId, { id: `${pendingSend.lineId}-send`, role: 'assistant', text: 'The send stayed unsent.' });
                setPendingSend(null);
              }}
              >
                Cancel
              </button>
            </div>
            <SlideCommit
              label="Slide to send"
              doneLabel="Sending"
              onCommit={() => {
                const pending = pendingSend;
                setPendingSend(null);
                if (deskLockOnRef.current && !unlockedRef.current) {
                  lockIntentRef.current = { type: 'spend', pending };
                  setLockOpen(true);
                  return;
                }
                void settleSpend(pending, true);
              }}
            />
          </section>
        </div>
      ) : null}
      <ProfileSheet
        open={profileOpen}
        onClose={closeProfile}
        accountLabel={profile?.displayName || accountLabel}
        avatarUrl={avatarUrl}
        profile={profile}
        glance={glance}
        wallets={wallets}
        voiceMs={voiceMs}
        talks={talks}
        payments={payments}
        transfers={transfers}
        signedIn={signedIn}
        loginDisabled={loginDisabled}
        onLogin={onLogin}
        onLogout={onLogout}
        onSave={saveProfile}
      />
    </div>
    {lockOpen ? (
      <DeskLock
        ownerId={ownerId}
        onUnlock={grantDesk}
        onClose={dismissLock}
      />
    ) : null}
    </>
  );
}
