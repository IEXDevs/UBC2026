'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
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
import HoldButton from '../components/HoldButton';
import ComputerSheet from '../components/ComputerSheet';
import FileStage from '../components/FileStage';
import RecallSearch from '../components/RecallSearch';
import { formatBaseUnits, moneyPane, registeredHoldingsLabel, walletGlance } from '../lib/money-views.mjs';
import { assignedWalletAddress, devnetSpendableLabel } from '../lib/devnet-balance.mjs';
import { parsePlatformSend } from '../lib/platform-send.mjs';
import { netChangeSummary, readAcceptanceAck, readReviewThreshold, readStoredPermission, writeAcceptance } from '../lib/spend-permission.mjs';
import { compactLines, contextUsage, contextWindowFor } from '../lib/context-usage.mjs';
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
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
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
import {
  mergeObservedWallets,
  walletConfigNote,
  walletProvisionNote,
  walletProvisionPaths,
  walletProvisionSucceeded,
  walletsFromPrivyUser,
} from '../lib/wallet-provision.mjs';
import { SETUP_CARD_MS, accountSetupStep, clipAddress, readQuoteOut, readRecoveryAck, swapSendSettlement, writeRecoveryAck } from '../lib/wallet-desk.mjs';
import { readTalks, writeTalks } from '../lib/talk-store.mjs';
import { catalogAddition, catalogForChat, readCatalog, writeCatalog } from '../lib/file-catalog.mjs';
import { STORAGE_FILE_TOO_BIG } from '../lib/file-quota.mjs';
import { ensureAccountCode } from '../lib/account-code.mjs';
import { accountStorage, bindAccountState, hydrateAccountState } from '../lib/account-state.mjs';
import { applyStoredFile, dropCatalogFile, storeAttachedFile, uploadNotice } from '../lib/store-file.mjs';
import { searchRecall } from '../lib/recall-search.mjs';
import { reviseThread } from '../lib/talk-edit.mjs';
import { useToast } from '../components/bits/SwipeToast';
import SignInPage from '../components/SignInPage';
import SpendAcceptance from '../components/SpendAcceptance';
import DeskLock from '../components/DeskLock';
import { useHostedPreview } from '../components/HostedPreview';
import { usePrivyPublic } from '../components/PrivyRoot';
import { developerPreviewAllowed, hasStoredPrivySession, showSessionHold, showSignInGate } from '../lib/sign-in-gate.mjs';
import { DEV_PREVIEW_OWNER, previewBot, previewWallets } from '../lib/dev-preview.mjs';
import { clearDeskGrant, clearDeskSession, deskSessionUntil, hotkeyTypingTarget, readDeskGrant, readDeskSession, walletHotkey, writeDeskSession } from '../lib/desk-lock.mjs';
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

function applyWalletFallback(user, body, setLiveWallets, setWalletNote, setWalletError) {
  const ownerId = ownerIdFromPrivyUser(user, true);
  const fallback = walletsFromPrivyUser(user, ownerId);
  const note = walletProvisionNote(body || {}, { ok: false });
  const message = fallback.length > 0
    ? `${note} Showing the Privy client wallet until server create succeeds.`
    : note;
  setLiveWallets(fallback.length > 0 ? fallback : []);
  setWalletNote(message);
  setWalletError?.(message);
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
  const hostedPreview = useHostedPreview();
  const devAllowed = developerPreviewAllowed() || hostedPreview;
  const [devPreview, setDevPreview] = useState(false);
  const [signInHold, setSignInHold] = useState(false);
  const [liveWallets, setLiveWallets] = useState(null);
  const [walletNote, setWalletNote] = useState('');
  const [walletError, setWalletError] = useState('');
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
      setWalletError('');
      return undefined;
    }
    let stopped = false;
    const release = setTimeout(() => {
      if (stopped) return;
      setLiveWallets((current) => (current == null ? [] : current));
    }, SETUP_CARD_MS);
    if (!sessionReadyForWallets(signedIn, user)) {
      return () => {
        stopped = true;
        clearTimeout(release);
      };
    }
    setWalletNote('Provisioning Solana wallets…');
    (async () => {
      try {
        const configResponse = await fetch('/api/wallets', {
          method: 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(SETUP_CARD_MS),
        });
        const config = await configResponse.json().catch(() => ({}));
        if (stopped) return;
        const configNote = walletConfigNote(config);
        if (configNote && Array.isArray(config.missing) && config.missing.length > 0) {
          applyWalletFallback(user, { error: 'missing_config', missing: config.missing }, setLiveWallets, setWalletNote, setWalletError);
          return;
        }

        const token = await Promise.race([
          getAccessToken(),
          new Promise((resolve) => setTimeout(() => resolve(''), SETUP_CARD_MS)),
        ]);
        if (stopped) return;
        if (!token) {
          applyWalletFallback(user, { error: 'token_missing' }, setLiveWallets, setWalletNote, setWalletError);
          return;
        }

        // Provision only via Next `/api/wallets` (see walletProvisionPaths).
        // Next already mirrors rows to Supabase with /api/wallets/persist.
        let body = {};
        let ok = false;
        const provisionPath = walletProvisionPaths()[0];
        try {
          const response = await fetch(provisionPath, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              ...(user?.id ? { 'x-owner-id': user.id } : {}),
            },
            signal: AbortSignal.timeout(SETUP_CARD_MS),
          });
          body = await response.json().catch(() => ({}));
          if (stopped) return;
          ok = walletProvisionSucceeded(response.ok, body);
          if (!ok) {
            console.error('[wallets] provision failed', provisionPath, response.status, {
              error: body.error,
              detail: body.detail,
              missing: body.missing,
            });
          }
        } catch (error) {
          if (stopped) return;
          console.error('[wallets] provision failed', provisionPath, {
            error: error?.name || 'fetch_failed',
            detail: typeof error?.message === 'string' ? error.message.slice(0, 180) : undefined,
          });
        }
        if (!ok) {
          applyWalletFallback(user, body, setLiveWallets, setWalletNote, setWalletError);
          if (configNote && !body.error) {
            const addNote = (current) => (current ? `${current} ${configNote}` : configNote);
            setWalletNote(addNote);
            setWalletError(addNote);
          }
          return;
        }
        setLiveWallets(mergeObservedWallets(body.wallets, user, ownerIdFromPrivyUser(user, true)));
        setWalletNote(walletProvisionNote(body, { ok: true }));
        setWalletError('');
      } catch {
        if (!stopped) {
          applyWalletFallback(user, {}, setLiveWallets, setWalletNote, setWalletError);
        }
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(release);
    };
  }, [signedIn, user, user?.id, user?.hasAcceptedTerms, accountsKey, getAccessToken]);

  if (devPreview && devAllowed) {
    return (
      <Shell
        devPreview
        ownerId={DEV_PREVIEW_OWNER}
        user={null}
        accountLabel="Developer"
        signedIn
        loginDisabled={false}
        onLogin={login}
        onLogout={leaveDevPreview}
        liveWallets={previewWallets()}
        walletNote="Developer preview. Sample balances. Live prices come from DexScreener."
        getAccessToken={async () => null}
      />
    );
  }

  if (showSessionHold({ privyConfigured: true, ready })) {
    return <SessionHold />;
  }

  if (signInHold || showSignInGate({ privyConfigured: true, ready, authenticated })) {
    return (
      <SignInPage
        onLogin={login}
        onDeveloperPreview={devAllowed ? enterDevPreview : null}
        onHoldChange={setSignInHold}
      />
    );
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
      walletError={walletError}
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

function Shell({ ownerId, user = null, accountLabel, signedIn, devPreview = false, loginDisabled, onLogin, onLogout, liveWallets = null, walletNote = '', walletError = '', getAccessToken = null }) {
  const toast = useToast();
  const [looks, setLooks] = useState({});
  const [roster, setRoster] = useState({ order: [], extra: [] });
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [sideWidth, setSideWidth] = useState(300);
  const [detailWidth, setDetailWidth] = useState(280);
  const [paneDrag, setPaneDrag] = useState(false);
  const [activeBot, setActiveBot] = useState(null);
  const [pendingSend, setPendingSend] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const unlockedRef = useRef(false);
  const unlockUntilRef = useRef(0);
  const lockIntentRef = useRef(null);
  const deskLockOnRef = useRef(false);
    deskLockOnRef.current = signedIn && Boolean(ownerId) && !devPreview;
  const [pane, setPane] = useState('Main');
  const [slide, setSlide] = useState('right');
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [walletFocus, setWalletFocus] = useState('');
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [talks, setTalks] = useState({});
  const talksRef = useRef(talks);
  talksRef.current = talks;
  const [talksReady, setTalksReady] = useState(false);
  const [rosterReady, setRosterReady] = useState(false);
  const [thinkingBot, setThinkingBot] = useState(null);
  const [botRecords, setBotRecords] = useState([]);
  const [loopOverrides, setLoopOverrides] = useState({});
  const [listsTick, setListsTick] = useState(0);
  const [remoteLists, setRemoteLists] = useState(() => emptyMoneyState());
  const [profile, setProfile] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [recoveryAck, setRecoveryAck] = useState(null);
  const [acceptanceAck, setAcceptanceAck] = useState(null);
  // Account state (roster, chats, permissions, account id) loads before the desk reads it.
  const [hydratedOwner, setHydratedOwner] = useState(null);
  const stateReady = !ownerId || hydratedOwner === ownerId;
  const accessTokenRef = useRef(getAccessToken);
  accessTokenRef.current = getAccessToken;
  const [hideWalletError, setHideWalletError] = useState(false);
  const [claimWelcome, setClaimWelcome] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const [devnetBalance, setDevnetBalance] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const pushReceipt = useCallback((receipt) => {
    if (!receipt || typeof receipt.id !== 'string' || !receipt.id) return;
    setReceipts(current => [receipt, ...current.filter(item => item.id !== receipt.id)].slice(0, 40));
  }, []);
  const [party, setParty] = useState(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [computerOpen, setComputerOpen] = useState(false);
  const [library, setLibrary] = useState({});
  const [catalogReady, setCatalogReady] = useState(false);
  const [recall, setRecall] = useState('');
  const [contextLimit, setContextLimit] = useState(() => contextWindowFor('muse-spark-1.3-contributor'));
  const [focusLine, setFocusLine] = useState(null);
  const [viewFile, setViewFile] = useState(null);
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
      try { accountStorage.setItem(voiceTimeKey(ownerId), String(next)); } catch { /* keep the session total in memory */ }
      return next;
    });
  }, [ownerId]);
  function onEditLine(lineId, text) {
    if (!bot || thinkingBot === bot.id) return;
    const revised = reviseThread(talksRef.current[bot.id] ?? [], lineId, text);
    if (!revised) return;
    setTalks(current => ({
      ...current,
      [bot.id]: compactLines(revised.lines, contextLimit),
    }));
  }
  const appendTalk = useCallback((botId, line) => {
    setTalks(current => ({
      ...current,
      [botId]: compactLines([...(current[botId] ?? []), line], contextLimit),
    }));
  }, [contextLimit]);
  useEffect(() => {
    setLooks({});
    setRoster({ order: [], extra: [] });
    setActiveBot(null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ownerId) {
      bindAccountState({});
      return undefined;
    }
    let stop = false;
    bindAccountState({ ownerId, getAccessToken: () => accessTokenRef.current?.() });
    hydrateAccountState().finally(() => { if (!stop) setHydratedOwner(ownerId); });
    return () => { stop = true; };
  }, [ownerId]);

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
    if (!stateReady) return undefined;
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
  }, [ownerId, ready, stateReady]);

  useEffect(() => {
    if (!ready || !rosterReady || !ownerId) return;
    writeLooks(accountStorage, ownerId, looks);
    writeRoster(accountStorage, ownerId, roster);
  }, [looks, roster, ready, rosterReady, ownerId]);

  useEffect(() => {
    setTalksReady(false);
    if (!ownerId) {
      setTalks({});
      setTalksReady(true);
      return;
    }
    if (!stateReady) return;
    try {
      setTalks(readTalks(localStorage, ownerId));
    } catch {
      setTalks({});
    }
    setTalksReady(true);
  }, [ownerId, stateReady]);

  useEffect(() => {
    if (!talksReady || !ownerId) return;
    writeTalks(accountStorage, ownerId, talks);
  }, [talks, talksReady, ownerId]);

  useEffect(() => {
    setCatalogReady(false);
    setViewFile(null);
    if (!ownerId) {
      setLibrary({});
      setCatalogReady(true);
      return;
    }
    try {
      setLibrary(readCatalog(localStorage, ownerId));
    } catch {
      setLibrary({});
    }
    setCatalogReady(true);
  }, [ownerId]);

  useEffect(() => {
    if (!catalogReady || !ownerId) return;
    writeCatalog(localStorage, ownerId, library);
  }, [library, catalogReady, ownerId]);

  useEffect(() => {
    if (!stateReady) return;
    try {
      setVoiceMs(readVoiceMs(localStorage.getItem(voiceTimeKey(ownerId))));
    } catch {
      setVoiceMs(0);
    }
  }, [ownerId, stateReady]);

  useEffect(() => {
    if (!stateReady) return;
    try {
      // Acceptance follows the account. The seed flag stays per device: a new
      // browser has to restore the seed it already saved before the desk opens.
      setRecoveryAck(ownerId ? readRecoveryAck(localStorage, ownerId) : false);
      setAcceptanceAck(ownerId ? readAcceptanceAck(localStorage, ownerId) : false);
    } catch {
      setRecoveryAck(false);
      setAcceptanceAck(false);
    }
  }, [ownerId, stateReady]);

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
        const headers = await ownerAuthHeaders(ownerId, getAccessToken);
        const [response] = await Promise.all([
          fetch(profileUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(SETUP_CARD_MS) }),
          accountUrl ? fetch(accountUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(SETUP_CARD_MS) }).catch(() => null) : null,
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
  }, [ownerId, getAccessToken]);

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
        if (!stop && lists) {
          setRemoteLists(lists);
          setLoopOverrides((current) => {
            const next = { ...current };
            for (const row of lists.bots || []) {
              if (row?.loop?.active) delete next[row.id];
            }
            return next;
          });
        }
      } catch {
        if (!stop) setRemoteLists(emptyMoneyState());
      }
    })();
    return () => { stop = true; };
  }, [ownerId, signedIn, user, getAccessToken, liveWallets, listsTick]);

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
        if (body.recipient?.kind === 'handle' && body.recipient.missing === false) return body.recipient;
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
  const styled = useMemo(() => {
    const looked = applyLooks(seedBots, looks);
    if (!devPreview || looked.length > 0) return looked;
    const sample = previewBot();
    return sample ? [sample] : looked;
  }, [seedBots, looks, devPreview]);
  const assigned = useMemo(() => withAssignedWallet(styled, liveWallets), [styled, liveWallets]);
  const bots = assigned.bots.map((bot) => (
    Object.prototype.hasOwnProperty.call(loopOverrides, bot.id)
      ? { ...bot, loop: loopOverrides[bot.id] }
      : bot
  ));
  const onMissingFile = useCallback((id) => {
    if (typeof id !== 'string' || !id) return;
    setLibrary(current => dropCatalogFile(current, id));
    setViewFile(current => (current?.id === id ? null : current));
  }, []);
  const onBreakLoop = useCallback(async (id) => {
    if (typeof id !== 'string' || !id) return;
    setLoopOverrides((current) => ({ ...current, [id]: null }));
    const url = shellRuntimeUrl(`/bots/${encodeURIComponent(id)}/card-loop/break`);
    if (!url || !ownerId) return;
    let accessToken = '';
    try { accessToken = (await getAccessToken?.()) || ''; } catch { accessToken = ''; }
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-owner-id': ownerId,
          'x-loop-break': 'owner-asked',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: '{}',
        cache: 'no-store',
      });
    } catch {
      // The mark is already gone. The next list refresh keeps it gone if the break landed.
    }
  }, [ownerId, getAccessToken]);
  useEffect(() => {
    if (!devPreview || bots.length === 0) return;
    if (bots.some(item => item.id === activeBot)) return;
    setActiveBot(bots[0].id);
  }, [devPreview, activeBot, bots]);
  const wallets = pickWalletList(assigned.wallets, remoteLists.wallets);
  const walletAddress = assignedWalletAddress(wallets);
  useEffect(() => {
    if (devPreview || !signedIn || !walletAddress) {
      setDevnetBalance(null);
      return undefined;
    }
    let stop = false;
    (async () => {
      let token = '';
      try { token = (await getAccessToken?.()) || ''; } catch { token = ''; }
      if (stop) return;
      if (!token) {
        setDevnetBalance(null);
        return;
      }
      try {
        const response = await fetch(`/api/devnet-balance?address=${encodeURIComponent(walletAddress)}`, {
          headers: {
            authorization: `Bearer ${token}`,
            ...(ownerId ? { 'x-owner-id': ownerId } : {}),
          },
          cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        if (stop) return;
        if (response.ok && body?.ok === true && body.cluster === 'devnet' && body.address === walletAddress) {
          setDevnetBalance({ ...body, asOf: new Date().toISOString(), stale: false });
        } else if (body && typeof body === 'object') {
          // Keep failed reads distinct from an empty funded wallet (0 SOL / 0 USDC).
          setDevnetBalance({
            ok: false,
            code: typeof body.code === 'string' ? body.code : `http_${response.status}`,
            cluster: 'devnet',
            address: walletAddress,
            solLamports: null,
            usdcAmount: null,
            tokens: [],
            asOf: typeof body.asOf === 'string' ? body.asOf : null,
            stale: body.stale === true,
          });
        } else {
          setDevnetBalance({
            ok: false,
            code: `http_${response.status}`,
            cluster: 'devnet',
            address: walletAddress,
            solLamports: null,
            usdcAmount: null,
            tokens: [],
          });
        }
      } catch {
        if (!stop) {
          setDevnetBalance({
            ok: false,
            code: 'rpc_failed',
            cluster: 'devnet',
            address: walletAddress,
            solLamports: null,
            usdcAmount: null,
            tokens: [],
          });
        }
      }
    })();
    return () => { stop = true; };
  }, [walletAddress, signedIn, ownerId, getAccessToken, devPreview, walletsOpen]);
  const payments = remoteLists.payments || [];
  const paymentCrossCheck = remoteLists.paymentCrossCheck || [];
  const positions = remoteLists.positions || [];
  const visible = bots.filter(bot => bot.name.toLowerCase().includes(query.trim().toLowerCase()));
  const fileCatalog = useMemo(() => catalogForChat(library, bots), [library, bots]);
  const recallHits = useMemo(
    () => searchRecall({ query: recall, bots, talks, files: library }),
    [recall, bots, talks, library],
  );
  const bot = bots.find(item => item.id === activeBot) ?? null;
  const money = moneyPane(pane);
  const chainLabel = devnetSpendableLabel(devnetBalance);
  const glance = walletGlance(wallets, positions, transfers, chainLabel, devnetBalance);
  const setupStep = devPreview ? null : accountSetupStep({
    signedIn,
    profileReady,
    handle: profile?.handle || '',
    walletsReady: liveWallets !== null,
    walletCount: Array.isArray(liveWallets) ? liveWallets.length : 0,
    acceptanceConfirmed: acceptanceAck === true,
    recoveryConfirmed: recoveryAck === true,
    stateReady,
  });
  useEffect(() => {
    setHideWalletError(false);
  }, [walletError]);
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
  const openWallet = useCallback((walletId) => {
    setCreateOpen(false);
    setProfileOpen(false);
    setPluginsOpen(false);
    setStatsOpen(false);
    setWalletFocus(typeof walletId === 'string' ? walletId : '');
    if (deskLockOnRef.current && !unlockedRef.current) {
      lockIntentRef.current = { type: 'wallet' };
      setWalletsOpen(false);
      setLockOpen(true);
      return;
    }
    setWalletsOpen(true);
  }, []);
  function moneyHeaders(token) {
    const grant = typeof sessionStorage === 'undefined'
      ? null
      : readDeskGrant(sessionStorage, ownerId, Date.now());
    return {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-owner-id': ownerId,
      ...(grant ? { 'x-desk-grant': grant.grant } : {}),
    };
  }
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
    if (target?.kind === 'wallet') {
      const list = Array.isArray(liveWallets) ? liveWallets : wallets;
      const from = list.find(item => item?.id === pending.fromWalletId) || null;
      const dest = list.find(item => item?.id === target.id && item?.address === target.address) || null;
      if (!from || !dest) return { ok: false, message: 'That wallet is not on this desk.' };
      if (pending.asset !== 'USDC') return { ok: false, message: 'Wallet sends are USDC.' };
      try {
        if (!sessionReadyForWallets(signedIn, user)) return { ok: false, message: 'Sign in again, then send.' };
        const token = await getAccessToken?.();
        const response = await fetch('/api/wallets/move', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            'x-owner-id': ownerId,
          },
          body: JSON.stringify({ from, to: dest, amount: pending.amount }),
        });
        const body = await response.json().catch(() => ({}));
        const where = target.caption || clipAddress(target.address);
        if (body.error === 'missing_config') {
          const names = Array.isArray(body.missing) ? body.missing.join(', ') : 'QUICKNODE_DEVNET_RPC_URL';
          return { ok: false, message: `The devnet send needs ${names}.` };
        }
        if (body.error === 'wallet_frozen') return { ok: false, message: 'That wallet is frozen.' };
        if (body.error === 'invalid_destination') return { ok: false, message: 'Pick a different wallet.' };
        if (!response.ok || !body.signature) return { ok: false, message: `The send to ${where} did not post.` };
        const amountLabel = `${formatBaseUnits(pending.amount)} USDC`;
        return {
          ok: true,
          message: `Sent ${amountLabel} to ${where}.`,
          signature: body.signature,
          receipt: {
            id: `move_${body.signature}`,
            at: new Date().toISOString(),
            title: `Send ${amountLabel}`,
            lines: [
              { label: 'To', value: where },
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
    if (target?.kind !== 'handle') {
      return { ok: false, message: 'Platform sends go to a @handle.' };
    }
    let settleAmount = pending.asset === 'USDC' ? pending.amount : null;
    let pricedFrom = null;
    if (pending.asset !== 'USDC') {
      const quote = pending.quote;
      if (!quote?.url || quote.broadcast !== false) {
        return { ok: false, message: 'That quote cannot authorize a send.' };
      }
      let quoted = null;
      try {
        const response = await fetch(quote.url);
        const payload = await response.json().catch(() => ({}));
        if (response.ok) quoted = readQuoteOut(payload);
      } catch {
        return { ok: false, message: 'The quote did not load. Nothing was sent.' };
      }
      const settlement = swapSendSettlement({
        inputSymbol: pending.asset,
        quoteOut: quoted,
        quote,
      });
      if (settlement.error || settlement.authorizesTransaction !== false || settlement.broadcast !== false) {
        return { ok: false, message: 'That quote cannot authorize a send.' };
      }
      settleAmount = settlement.amount;
      pricedFrom = settlement.inputSymbol;
    }
    if (!settleAmount) return { ok: false, message: 'Platform sends are USDC to a @handle.' };
    const transfersUrl = shellRuntimeUrl('/api/transfers');
    if (!transfersUrl) return { ok: false, message: 'Platform sends need the agent runtime.' };
    try {
      if (!sessionReadyForWallets(signedIn, user)) return { ok: false, message: 'Sign in again, then send.' };
      const token = await getAccessToken?.();
      const idempotencyKey = `wallet_${target.handle}_${settleAmount}_${Date.now()}`.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 128);
      const response = await fetch(transfersUrl, {
        method: 'POST',
        headers: moneyHeaders(token),
        body: JSON.stringify({
          handle: target.handle,
          amount: settleAmount,
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
        message: pricedFrom
          ? `Priced ${pricedFrom} and sent ${amountLabel} to @${body.transfer.handle}. The quote was not broadcast.`
          : `Sent ${amountLabel} to @${body.transfer.handle}.`,
        receipt: {
          id: body.transfer.id,
          at: body.transfer.createdAt || new Date().toISOString(),
          title: `Sent ${amountLabel}`,
          lines: [
            { label: 'To', value: `@${body.transfer.handle}` },
            { label: 'Amount', value: amountLabel },
            ...(pricedFrom ? [{ label: 'Priced from', value: `${pricedFrom} · quote not broadcast` }] : []),
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
  const accessRef = useRef(null);
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
    try { clearDeskGrant(sessionStorage, ownerId); } catch { /* the in-memory lock still applies */ }
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

  function onRecall(hit) {
    if (!hit) return;
    if (hit.kind === 'file' && hit.file) setViewFile(hit.file);
    if (hit.botId) openChat(hit.botId);
    setFocusLine(hit.kind === 'message' && hit.lineId ? { botId: hit.botId, lineId: hit.lineId } : null);
    setRecall('');
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
    const startSide = sideWidth;
    const startDetail = detailWidth;
    setPaneDrag(true);
    function move(next) {
      const delta = next.clientX - startX;
      if (side === 'left') {
        setSideWidth(Math.min(480, Math.max(240, startSide + delta)));
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
        ...(permission === 'review'
          ? { reviewCap: readReviewThreshold(typeof localStorage === 'undefined' ? null : localStorage) }
          : {}),
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
        headers: moneyHeaders(token),
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
      headers: moneyHeaders(token),
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

  const noAgents = bots.length === 0;
  return (
    <>
    <div
      className={`shell${noAgents ? ' is-empty' : ''}${pane === 'Positions' ? ' is-book' : ''}${pane === 'Main' && bot ? ' has-detail' : ''}${paneDrag ? ' is-dragging-pane' : ''}${setupStep === 'handle' || claimWelcome ? ' is-claim' : ''}`}
      style={{ '--side-w': `${sideWidth}px`, '--detail-w': `${detailWidth}px`, '--pill-detail': bot ? `${detailWidth}px` : '0px' }}
    >
      <aside className="side">
        <div
          className="pane-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agents"
          onPointerDown={event => dragPane(event, 'left')}
        />
        <div className="side-tools">
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
        <RecallSearch query={recall} hits={recallHits} onQuery={setRecall} onSelect={onRecall} />
        <BotRail
          bots={visible}
          activeId={bot?.id}
          canDrag={!query.trim()}
          onSelect={openChat}
          onReorder={onReorder}
          onDelete={onDelete}
          onEdit={onEditLook}
          onCreate={() => setCreateOpen(true)}
          onBreakLoop={onBreakLoop}
        />
        <footer className="you">
          <AccountMenu
            accountLabel={profileRailLabel({
              handle: profile?.handle,
              displayName: profile?.displayName,
              fallback: accountLabel,
            })}
            avatarUrl={avatarUrl}
            signedIn={signedIn}
            loginDisabled={loginDisabled}
            walletUnlocked={unlocked}
            holdingsLabel={registeredHoldingsLabel({ wallets, positions, transfers, bots, chainLabel })}
            onLogin={onLogin}
            onPick={onAccount}
          />
        </footer>
      </aside>

      <section className={`stage${pane === 'Positions' ? ' is-book' : ''}`}>
        {noAgents ? null : (
        <header className="topbar">
          <span className="topbar-side" />
          <PaneDock panes={SHELL_PANES} pane={pane} onChange={choosePane} />
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
                  getAccessToken={getAccessToken}
                  lines={talks[bot.id] ?? []}
                  thinking={thinkingBot === bot.id}
                  onParty={setParty}
                  onEdit={onEditLine}
                  onAccess={(line, accepted) => accessRef.current?.(line, accepted)}
                  focusLine={focusLine?.botId === bot.id ? focusLine.lineId : null}
                />
            ) : null}
            {!noAgents && money ? (
              <MoneyPane
                pane={money}
                state={{ bots, wallets, payments, positions, transfers, paymentCrossCheck }}
                onParty={setParty}
                ownerId={ownerId}
                getAccessToken={getAccessToken}
                onWallet={openWallet}
              />
            ) : null}
            {!noAgents && pane === 'Logs' ? (
              <LogsPanel
                bots={bots}
                ownerId={ownerId}
                getAccessToken={getAccessToken}
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
                getAccessToken={getAccessToken}
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
            fileCatalog={fileCatalog}
            getAccessToken={getAccessToken}
            lines={talks[bot.id] ?? []}
            onLine={(line, forBot) => {
              const id = forBot || bot.id;
              appendTalk(id, line);
              if (line.role === 'agent') setListsTick((tick) => tick + 1);
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
            onContextWindow={setContextLimit}
            usage={contextUsage(talks[bot.id] ?? [], contextLimit)}
            onEditLine={onEditLine}
            onPatchLine={(lineId, patch, forBot) => {
              const id = forBot || bot.id;
              setTalks(current => ({
                ...current,
                [id]: (current[id] ?? []).map(item => (item.id === lineId ? { ...item, ...patch } : item)),
              }));
            }}
            onConfirm={askSlideConfirm}
            onBindAccess={(handler) => { accessRef.current = handler; }}
            onAttach={items => {
              setLibrary(current => {
                const result = catalogAddition(current, bot.id, items);
                if (result.rejected.length > 0) {
                  toast?.({ id: 'storage-file-too-big', title: STORAGE_FILE_TOO_BIG, duration: 7000, closeButton: true, error: true });
                }
                if (result.warning) {
                  toast?.({ id: 'storage-cap', title: result.warning, duration: 7000, closeButton: true, error: true });
                }
                return result.library;
              });
              for (const item of items) {
                if (!item.blob || !ownerId) continue;
                void (async () => {
                  const token = await getAccessToken?.();
                  const accountCode = ensureAccountCode(accountStorage, ownerId);
                  const saved = await storeAttachedFile({ ownerId, accountCode, token, item });
                  const notice = uploadNotice(saved);
                  if (notice) {
                    toast?.({
                      id: saved?.ok ? 'storage-cap' : 'storage-save',
                      title: notice,
                      duration: 7000,
                      closeButton: true,
                      error: true,
                    });
                  }
                  if (saved?.ok) setLibrary(current => applyStoredFile(current, item.id, saved));
                })();
              }
            }}
          />
        ) : pane === 'Positions' ? null : (
          <div className="composer-wait" role="status">
            <p>Create an agent before sending.</p>
          </div>
        )}
      </section>
      {pane === 'Main' && bot ? (
        <AgentDetail
          bot={bot}
          files={library[bot.id] ?? []}
          ownerId={ownerId}
          getAccessToken={getAccessToken}
          onResize={event => dragPane(event, 'right')}
          onMissingFile={onMissingFile}
          onComputer={() => setComputerOpen(true)}
        />
      ) : null}
      <CreateBotDialog open={createOpen} onClose={closeCreate} onCreate={onCreate} first={bots.length === 0} />
      {walletError && !hideWalletError ? (
        <div className="backdrop is-center">
          <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-label="Wallet setup">
            <h2>Wallet setup did not finish</h2>
            <p className="quiet">{walletError}</p>
            <button type="button" className="solid" onClick={() => setHideWalletError(true)}>Continue</button>
          </section>
        </div>
      ) : null}
      {setupStep === 'acceptance' && !claimWelcome ? (
        <SpendAcceptance
          onContinue={({ permission, reviewCap }) => {
            try {
              writeAcceptance(accountStorage, ownerId, { permission, reviewCap });
              setAcceptanceAck(true);
            } catch {
              /* the sheet stays until the threshold is stored */
            }
          }}
        />
      ) : null}
      {setupStep === 'recovery' && !claimWelcome ? (
        <RecoveryCeremony
          wallets={liveWallets || []}
          handle={profile?.handle || ''}
          ownerId={ownerId || ''}
          getAccessToken={getAccessToken}
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
        focusId={walletFocus}
        onSend={onWalletSend}
        onReceipt={pushReceipt}
        getAccessToken={getAccessToken}
        resolveRecipient={resolveMention}
        devnetBalance={devnetBalance}
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
      <ComputerSheet open={computerOpen} onClose={closeComputer} bot={bot} ownerId={ownerId} getAccessToken={getAccessToken} />
      {viewFile ? <FileStage file={viewFile} ownerId={ownerId} getAccessToken={getAccessToken} onMissing={onMissingFile} onClose={() => setViewFile(null)} /> : null}
      <StatisticsSheet
        open={statsOpen}
        onClose={closeStats}
        bots={bots}
        ownerId={ownerId}
        getAccessToken={getAccessToken}
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
        onWallet={() => { setProfileOpen(false); openWallet(); }}
      />
    </div>
    {/* Claim stays outside the shell. .shell.is-claim sets opacity 0. */}
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
    {lockOpen ? (
      <DeskLock
        ownerId={ownerId}
        getAccessToken={getAccessToken}
        onUnlock={grantDesk}
        onClose={dismissLock}
      />
    ) : null}
    </>
  );
}
