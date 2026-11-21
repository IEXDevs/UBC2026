'use client';
import { SOLANA_CLUSTER, SOLANA_PRIVY_CHAIN } from '@ubc2026/contracts/solana';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuthorizationSignature, useConnectWallet, usePrivy, useSigners } from '@privy-io/react-auth';
import { useSignTransaction, useWallets, useStandardWallets } from '@privy-io/react-auth/solana';
import MoneyPane from '../components/MoneyPane';
import BotRail from '../components/BotRail';
import AgentThread from '../components/AgentThread';
import SecurityPanel from '../components/SecurityPanel';
import LogsPanel from '../components/LogsPanel';
import AccountMenu from '../components/AccountMenu';
import AccountValue from '../components/AccountValue';
import AddressText from '../components/AddressText';
import PaneDock from '../components/PaneDock';
import Composer from '../components/Composer';
import CreateBotDialog from '../components/CreateBotDialog';
import ProfileSheet from '../components/ProfileSheet';
import LasoCardsSheet from '../components/LasoCardsSheet';
import ProfileConnections, { LiveProfileConnections } from '../components/ProfileConnections';
import WalletsSheet from '../components/WalletsSheet';
import ClaimHandle from '../components/ClaimHandle';
import RecoveryCeremony from '../components/RecoveryCeremony';
import SlideCommit from '../components/bits/SlideCommit';
import PartySheet from '../components/PartySheet';
import AIProvidersSheet from '../components/AIProvidersSheet';
import StatisticsSheet from '../components/StatisticsSheet';
import AgentDetail from '../components/AgentDetail';
import HoldButton from '../components/HoldButton';
import ComputerSheet from '../components/ComputerSheet';
import FileStage from '../components/FileStage';
import RecallSearch from '../components/RecallSearch';
import { formatBaseUnits, moneyPane, walletGlance } from '../lib/money-views.mjs';
import { mentionSuggestions } from '../lib/mention-handles.mjs';
import { assignedWalletAddress, solanaSpendableLabel } from '../lib/solana-balance.mjs';
import { parsePlatformSend } from '../lib/platform-send.mjs';
import { walletSendFailure } from '../lib/wallet-send-failure.mjs';
import { clearAcceptanceDraft, netChangeSummary, readAcceptanceAck, readReviewThreshold, readStoredPermission, writeAcceptance } from '../lib/spend-permission.mjs';
import { CONFIRM_HOLD_MS } from '../lib/confirm-hold.mjs';
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
import { profilePhoto, withProfilePhoto, saveProfilePhoto } from '../lib/profile-photo.mjs';
import { agentWalletChoices, mainAgentWallet, mergeWalletDirectory, withAssignedWallet } from '../lib/wallet-assign.mjs';
import {
  forgetRetiredWallet,
  readRetiredWalletIds,
  rememberRetiredWallet,
  resolveRetireId,
  withoutRetiredWallets,
} from '../lib/wallet-retire.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { browserCanSign, createOwnerAuthorizationSigner, waitForBrowserSigner, withLinkedSolanaWallets, signSelectedWalletTransaction, signWalletMoveTransaction } from '../lib/wallet-signing.mjs';
import { executeClientSignedSwap } from '../lib/swap-client-sign.mjs';
import { createAgentRemoval } from '../lib/agent-removal.mjs';
import {
  checkDueCardLoops,
  deleteOwnerBot,
  emptyMoneyState,
  fetchOwnerLists,
  shellBotFromRemote,
  shellRuntimeUrl,
  upsertOwnerBot,
} from '../lib/runtime-data.mjs';
import { isPlaceholderBotId, SHELL_PANES, withoutPlaceholderBots } from '../lib/shell-chrome.mjs';
import { buildPermissionedSpendRequest, lookupHandleKey, parseLookupQuery, privyAvatarUrl } from '@ubc2026/contracts';
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
import { readRecoveryState, staleRecoveryAck } from '../lib/recovery-vault.mjs';
import { readTalks, writeTalks } from '../lib/talk-store.mjs';
import { latestInlineAllow } from '../lib/voice-allow.mjs';
import { catalogAddition, catalogForChat, readCatalog, writeCatalog } from '../lib/file-catalog.mjs';
import { STORAGE_FILE_TOO_BIG } from '../lib/file-quota.mjs';
import { ensureAccountCode } from '../lib/account-code.mjs';
import { accountStorage, bindAccountState, flushAccountState, hydrateAccountState } from '../lib/account-state.mjs';
import { applyStoredFile, dropCatalogFile, storeAttachedFile, uploadNotice } from '../lib/store-file.mjs';
import { searchRecall } from '../lib/recall-search.mjs';
import { GOAL_QUESTION, hasGeneralGoal, proposedGeneralGoal, reviewGeneralGoal, taskFromRequest, taskLabel } from '../lib/agent-task.mjs';
import { reviseThread } from '../lib/talk-edit.mjs';
import { useToast } from '../components/bits/SwipeToast';
import SignInPage from '../components/SignInPage';
import SpendAcceptance from '../components/SpendAcceptance';
import DeskLock from '../components/DeskLock';
import { useHostedPreview } from '../components/HostedPreview';
import { usePrivyPublic } from '../components/PrivyRoot';
import { developerPreviewAllowed, hasRestorablePrivySession, showSessionHold, showSignInGate } from '../lib/sign-in-gate.mjs';
import { blockCopy } from '../lib/block-copy.mjs';
import { DEV_PREVIEW_OWNER, previewBot, previewWallets } from '../lib/dev-preview.mjs';
import { clearDeskGrant, clearDeskSession, hotkeyTypingTarget, readDeskGrant, readDeskSession, walletHotkey, writeDeskSession } from '../lib/desk-lock.mjs';
import { restoreDeskEntry } from '../lib/desk-grant-client.mjs';
import { getPrivyAccessToken } from '../lib/privy-session.mjs';
import { serverSignerFailure, walletsNeedingSigner } from '../lib/privy-signers.mjs';
import { withPrivyLogout } from '../lib/accept-terms-auth.mjs';
import { logoutAfterFlush } from '../lib/profile-logout.mjs';

function readAccessToken(getAccessToken) {
  return getPrivyAccessToken(getAccessToken, window.localStorage);
}

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
    if (hasRestorablePrivySession(window.localStorage, document.cookie)) setLabel('Restoring your session');
  }, []);
  return <div className="sign-in no-copy" aria-busy="true" role="status" onCopy={blockCopy} onCut={blockCopy}>{label}</div>;
}

function AuthedShell() {
  const { ready, authenticated, user, login, logout, getAccessToken: privyGetAccessToken, unlinkWallet } = usePrivy();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const signedIn = ready && authenticated;
  const hostedPreview = useHostedPreview();
  const devAllowed = developerPreviewAllowed() || hostedPreview;
  const [devPreview, setDevPreview] = useState(false);
  const [signInHold, setSignInHold] = useState(false);
  const [liveWallets, setLiveWallets] = useState(null);
  const [walletNote, setWalletNote] = useState('');
  const [walletError, setWalletError] = useState('');
  const [deskEntry, setDeskEntry] = useState(null);
  const ownerId = ownerIdFromPrivyUser(user, signedIn);
  const deskOwner = devPreview && devAllowed ? null : ownerId;
  const deskChecked = Boolean(deskOwner && deskEntry?.ownerId === deskOwner);
  const deskEntered = deskChecked && deskEntry.until > 0;
  const accountsKey = linkedAccountsKey(user);

  const getAccessToken = useCallback(() => readAccessToken(privyGetAccessToken), [privyGetAccessToken]);
  const deskToken = useRef(getAccessToken);
  deskToken.current = getAccessToken;
  const { signerId } = usePrivyPublic();
  const { addSigners } = useSigners();
  const signerTried = useRef(new Set());
  const signerUpdates = useRef(new Map());
  const attachSwapSigner = useCallback(({ address, signerId: requestedSigner }) => {
    const key = `${address}:${requestedSigner}`;
    const pending = signerUpdates.current.get(key);
    if (pending) return pending;
    const update = addSigners({ address, signers: [{ signerId: requestedSigner, policyIds: [] }] })
      .finally(() => signerUpdates.current.delete(key));
    signerUpdates.current.set(key, update);
    return update;
  }, [addSigners]);

  useEffect(() => {
    if (!signedIn) return undefined;
    const pending = walletsNeedingSigner(user, signerId).filter((address) => !signerTried.current.has(address));
    if (!pending.length) return undefined;
    (async () => {
      for (const address of pending) {
        signerTried.current.add(address);
        try {
          await attachSwapSigner({ address, signerId });
        } catch (error) {
          console.error('[wallets] server signer not added', serverSignerFailure(error), error);
        }
      }
    })();
    return undefined;
  }, [signedIn, accountsKey, signerId, attachSwapSigner]);

  useEffect(() => {
    if (!deskOwner) {
      setDeskEntry(null);
      return undefined;
    }
    let stopped = false;
    (async () => {
      let until = 0;
      try {
        until = await restoreDeskEntry({
          localStorage: window.localStorage,
          sessionStorage: window.sessionStorage,
          ownerId: deskOwner,
          getAccessToken: () => deskToken.current(),
        });
      } catch (err) {
        console.error('[desk] restoreDeskEntry error:', err);
      }
      if (!stopped) setDeskEntry({ ownerId: deskOwner, until });
    })();
    return () => { stopped = true; };
  }, [deskOwner]);

  const onLogout = useCallback(async () => {
    if (ownerId) {
      try { clearDeskSession(window.localStorage, ownerId); } catch (err) { console.error('[desk] clearDeskSession error:', err); }
      try { clearDeskGrant(window.sessionStorage, ownerId); } catch (err) { console.error('[desk] clearDeskGrant error:', err); }
      setDeskEntry({ ownerId, until: 0 });
    }
    await withPrivyLogout(window, () => logout());
  }, [logout, ownerId]);

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
    if (!deskEntered) {
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
      } catch (error) {
        console.error('[wallets] wallet setup/refresh error:', error);
        if (!stopped) {
          applyWalletFallback(user, {}, setLiveWallets, setWalletNote, setWalletError);
        }
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(release);
    };
  }, [deskEntered, signedIn, user, user?.id, user?.hasAcceptedTerms, accountsKey, getAccessToken]);

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
        privyLive
        liveWallets={null}
        onRetireWallet={(id, address) => {
          setLiveWallets((current) => (Array.isArray(current) ? current.filter((wallet) => wallet?.id !== id && (!address || wallet?.address !== address)) : current));
        }}
        unlinkWallet={unlinkWallet}
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
        disabled={!ready || signInHold || authenticated}
        onLogin={login}
        onDeveloperPreview={devAllowed ? enterDevPreview : null}
        onHoldChange={setSignInHold}
      />
    );
  }

  if (!deskChecked) return <SessionHold />;

  if (!deskEntered) {
    return (
      <DeskLock
        key={deskOwner}
        ownerId={deskOwner}
        accountLabel={privyAccountLabel(user)}
        getAccessToken={getAccessToken}
        onSignOut={onLogout}
        onUnlock={until => {
          try { writeDeskSession(window.localStorage, deskOwner, until); } catch { /* this tab can still enter */ }
          setDeskEntry({ ownerId: deskOwner, until });
        }}
      />
    );
  }

  return (
    <Shell
      key={deskOwner}
      ownerId={deskOwner}
      initialDeskUntil={deskEntry.until}
      user={signedIn ? user : null}
      accountLabel={signedIn ? privyAccountLabel(user) : 'You'}
      signedIn={signedIn}
      loginDisabled={!ready}
      onLogin={login}
      onLogout={onLogout}
      privyLive
      liveWallets={liveWallets}
      walletNote={walletNote}
      walletError={walletError}
      getAccessToken={getAccessToken}
      authorizeSpend={generateAuthorizationSignature}
      attachSwapSigner={attachSwapSigner}
      onRetireWallet={(id, address) => {
        setLiveWallets((current) => (Array.isArray(current) ? current.filter((wallet) => wallet?.id !== id && (!address || wallet?.address !== address)) : current));
      }}
      unlinkWallet={unlinkWallet}
      onWalletCreated={(wallet) => {
        const incoming = Array.isArray(wallet) ? wallet : [wallet];
        const unretire = incoming.flatMap((item) => [item?.id, item?.address]).filter(Boolean);
        if (unretire.length && deskOwner) {
          forgetRetiredWallet(window.localStorage, deskOwner, ...unretire);
        }
        setLiveWallets((current) => {
          const list = Array.isArray(current) ? [...current] : [];
          for (const item of incoming) {
            if (!item?.address || list.some((row) => row?.id === item.id || row?.address === item.address)) continue;
            list.push(item);
          }
          return list.length ? list : incoming.filter((item) => item?.address);
        });
        setWalletError('');
      }}
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

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 12000) return null;
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function DepositSigner({ signerRef, signWithOwnerAuthorization }) {
  const { signTransaction } = useSignTransaction();
  const { wallets, ready } = useWallets();
  const { wallets: standardWallets, ready: standardReady } = useStandardWallets();
  const { user } = usePrivy();
  const { connectWallet } = useConnectWallet();
  useEffect(() => {
    signerRef.current = { signTransaction, wallets: withLinkedSolanaWallets(wallets, standardWallets, user),
      ready: ready || standardReady, connectWallet, signWithOwnerAuthorization };
  }, [signTransaction, wallets, ready, standardWallets, standardReady, user, connectWallet, signerRef, signWithOwnerAuthorization]);
  return null;
}

const EMPTY_DESK_LOG_PANES = Object.freeze(['Main', 'Logs']);

function Shell({ ownerId, user = null, accountLabel, signedIn, initialDeskUntil = 0, devPreview = false, loginDisabled, onLogin, onLogout, liveWallets = null, walletNote = '', walletError = '', getAccessToken = null, authorizeSpend = null, attachSwapSigner = null, onRetireWallet = null, onWalletCreated = null, privyLive = false, unlinkWallet = null }) {
  const toast = useToast();
  const depositSignerRef = useRef(null);
  const signChatTransaction = useCallback(async ({ walletAddress, transaction, requireWalletApproval }) => signSelectedWalletTransaction({
    from: { address: walletAddress }, transaction,
    signer: await waitForBrowserSigner(() => depositSignerRef.current, [{ address: walletAddress }]),
    requireWalletApproval,
  }), []);
  const executeChatSwap = useCallback(input => executeClientSignedSwap({ ...input, signer: depositSignerRef.current,
    readSigner: () => depositSignerRef.current, attachSwapSigner }), [attachSwapSigner]);
  const [looks, setLooks] = useState({});
  const [savedPhoto, setSavedPhoto] = useState(null);
  const [roster, setRoster] = useState({ order: [], extra: [] });
  const [ready, setReady] = useState(false);
  const [sideWidth, setSideWidth] = useState(300);
  const [detailWidth, setDetailWidth] = useState(280);
  const [paneDrag, setPaneDrag] = useState(false);
  const [activeBot, setActiveBot] = useState(null);
  const [pendingSend, setPendingSend] = useState(null);
  const [unlocked, setUnlocked] = useState(initialDeskUntil > 0);
  const [lockOpen, setLockOpen] = useState(false);
  const unlockedRef = useRef(initialDeskUntil > 0);
  const unlockUntilRef = useRef(initialDeskUntil);
  const lockIntentRef = useRef(null);
  const deskLockOnRef = useRef(false);
    deskLockOnRef.current = signedIn && Boolean(ownerId) && !devPreview;
  const [pane, setPane] = useState('Main');
  const [slide, setSlide] = useState('right');
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [walletFocus, setWalletFocus] = useState('');
  const [retiredIds, setRetiredIds] = useState([]);
  const [aiProvidersOpen, setAIProvidersOpen] = useState(false);
  const [talks, setTalks] = useState({});
  const talksRef = useRef(talks);
  talksRef.current = talks;
  const [talksReady, setTalksReady] = useState(false);
  const [rosterReady, setRosterReady] = useState(false);
  const [thinkingBot, setThinkingBot] = useState(null);
  const [removedAgents, setRemovedAgents] = useState(() => new Map());
  const [agentRemoval] = useState(() => createAgentRemoval(setRemovedAgents));
  const currentOwner = useRef(ownerId);
  currentOwner.current = ownerId;
  const [loopOverrides, setLoopOverrides] = useState({});
  const loopChecks = useRef(new Set());
  const [listsTick, setListsTick] = useState(0);
  const WALLET_REFRESH_MS = 5000;
  const [remoteLists, setRemoteLists] = useState(() => emptyMoneyState());
  const [profile, setProfile] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [recoveryAck, setRecoveryAck] = useState(null);
  const [localSeed, setLocalSeed] = useState(false);
  const [acceptanceAck, setAcceptanceAck] = useState(null);
  const [acceptanceClosing, setAcceptanceClosing] = useState(false);
  const acceptanceTimer = useRef(0);
  // Account state (roster, chats, permissions, account id) loads before the desk reads it.
  const [hydratedOwner, setHydratedOwner] = useState(null);
  const stateReady = !ownerId || hydratedOwner === ownerId;
  const accessTokenRef = useRef(getAccessToken);
  accessTokenRef.current = getAccessToken;
  const [hideWalletError, setHideWalletError] = useState(false);
  const [claimWelcome, setClaimWelcome] = useState(false);
  const [confirmedHandle, setConfirmedHandle] = useState(undefined);
  const [transfers, setTransfers] = useState([]);
  const [solanaBalance, setSolanaBalance] = useState(null);
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
  const [voiceLive, setVoiceLive] = useState(false);
  const avatarUrl = (savedPhoto?.ownerId === ownerId ? savedPhoto.image : '') || profilePhoto(looks) || profile?.avatarUrl || privyAvatarUrl(user);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const closeProfile = useCallback(() => {
    setProfileOpen(false);
  }, []);
  const closeWallets = useCallback(() => setWalletsOpen(false), []);
  const closeCards = useCallback(() => setCardsOpen(false), []);
  const closeAIProviders = useCallback(() => setAIProvidersOpen(false), []);
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
    if (devPreview) {
      // The preview has no account store. Bind local-only storage (no
      // runtime hydrate or push) and mark the desk ready for this browser.
      bindAccountState({});
      setHydratedOwner(ownerId);
      return undefined;
    }
    let stop = false;
    bindAccountState({ ownerId, getAccessToken: () => accessTokenRef.current?.() });
    hydrateAccountState().finally(() => { if (!stop) setHydratedOwner(ownerId); });
    return () => { stop = true; };
  }, [ownerId, devPreview]);

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
    const adopted = adoptLegacyRoster(accountStorage, ownerId);
    const savedRoster = withoutPlaceholderBots(adopted.adopted ? adopted.roster : readRoster(accountStorage, ownerId));
    const savedLooks = adopted.adopted ? adopted.looks : readLooks(accountStorage, ownerId);
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
      setTalks(readTalks(accountStorage, ownerId));
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
    let local = false;
    try {
      // Acceptance follows the account. The seed flag stays per device: a new
      // browser has to restore the seed it already saved before the desk opens.
      local = ownerId ? readRecoveryAck(localStorage, ownerId) : false;
      setAcceptanceAck(ownerId ? readAcceptanceAck(localStorage, ownerId) : false);
    } catch {
      setAcceptanceAck(false);
    }
    setRecoveryAck(local);
    setLocalSeed(local);
    if (!local || !ownerId || devPreview) return undefined;
    // A device flag alone does not prove the account holds the seed.
    let stop = false;
    (async () => {
      const token = typeof getAccessToken === 'function' ? await Promise.resolve().then(() => getAccessToken()).catch(() => null) : null;
      const state = await readRecoveryState((...args) => fetch(...args), { ownerId, token });
      if (!stop && staleRecoveryAck(state)) setRecoveryAck(false);
    })();
    return () => { stop = true; };
  }, [ownerId, stateReady, devPreview, getAccessToken]);

  const profileOwnerRef = useRef('');
  useEffect(() => {
    const key = profileKey(ownerId);
    if (!key) {
      profileOwnerRef.current = '';
      setProfile(null);
      setConfirmedHandle(undefined);
      setProfileReady(false);
      return undefined;
    }
    // A new access token must not tear down onboarding. That was dropping the amount mid-entry.
    const sameOwner = profileOwnerRef.current === ownerId;
    if (!sameOwner) {
      profileOwnerRef.current = ownerId;
      setConfirmedHandle(undefined);
      setProfileReady(false);
    }
    let local = null;
    try {
      const raw = localStorage.getItem(key);
      local = raw ? JSON.parse(raw) : null;
      if (local?.handle && local?.displayName) setProfile(local);
      else if (!sameOwner) setProfile(null);
    } catch {
      local = null;
      if (!sameOwner) setProfile(null);
    }
    const profileUrl = shellRuntimeUrl('/api/profiles/me');
    const accountUrl = shellRuntimeUrl('/api/me');
    if (!profileUrl || devPreview) {
      // The preview has no directory row. Keep the profile stored on this device.
      setProfileReady(true);
      return undefined;
    }
    let stop = false;
    (async () => {
      try {
        const headers = await ownerAuthHeaders(ownerId, accessTokenRef.current);
        const [response] = await Promise.all([
          fetch(profileUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(SETUP_CARD_MS) }),
          accountUrl ? fetch(accountUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(SETUP_CARD_MS) }).catch(() => null) : null,
        ]);
        const body = await response.json();
        if (stop) return;
        if (response.ok && body.source === 'supabase' && body.ok !== false) setConfirmedHandle(body.profile?.handle || null);
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
  }, [ownerId, devPreview]);

  useEffect(() => {
    if (!ownerId || devPreview) {
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
  }, [ownerId, getAccessToken, signedIn, user, devPreview]);

  useEffect(() => {
    if (!ownerId || devPreview) return undefined;
    const refresh = () => setListsTick(tick => tick + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const id = window.setInterval(refresh, WALLET_REFRESH_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ownerId, WALLET_REFRESH_MS]);

  useEffect(() => {
    if (!ownerId || devPreview) {
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
          if (signedIn) void checkDueCardLoops(ownerId, lists.bots, accessToken, loopChecks.current);
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
  }, [ownerId, signedIn, user, getAccessToken, liveWallets, listsTick, devPreview]);

  const savedAgentWallets = useMemo(() => agentWalletChoices(withoutRetiredWallets(remoteLists.wallets, retiredIds)),
    [remoteLists.wallets, retiredIds]);
  // Backfill old local agents when their wallet is available in the runtime.
  useEffect(() => {
    if (!ownerId || !rosterReady || !signedIn) return undefined;
    if (savedAgentWallets.length === 0) return undefined;
    const mainWalletId = mainAgentWallet(savedAgentWallets)?.id;
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
        const walletId = bot.walletId || mainWalletId;
        if (!savedAgentWallets.some(wallet => wallet.id === walletId)) continue;
        const saved = await agentRemoval.save(ownerId, bot.id, () => upsertOwnerBot(ownerId, bot, { walletId, accessToken }));
        if (saved.ok) wrote += 1;
      }
      if (!wrote || stop) return;
      try {
        const lists = await fetchOwnerLists(ownerId, { accessToken });
        if (!stop && lists) setRemoteLists(lists);
      } catch { /* keep local */ }
    })();
    return () => { stop = true; };
  }, [ownerId, rosterReady, signedIn, roster, remoteLists.bots, savedAgentWallets, getAccessToken, agentRemoval]);

  const saveProfile = useCallback(async (next) => {
    const { photo, editOnly, ...details } = next;
    const stored = { ...details, handle: editOnly ? (profile?.handle || details.handle) : details.handle, avatarUrl: profile?.avatarUrl || details.avatarUrl || privyAvatarUrl(user) || null };
    if (photo !== undefined && !withProfilePhoto({}, photo)) throw Object.assign(new Error('invalid_photo'), { code: 'invalid_photo' });
    const key = profileKey(ownerId);
    const profileUrl = ownerId ? shellRuntimeUrl('/api/profiles/me') : null;
    if (profileUrl && ownerId) {
      const response = await fetch(profileUrl, {
        method: 'PUT',
        headers: await ownerAuthHeaders(ownerId, getAccessToken, { 'content-type': 'application/json' }),
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ ...stored, ...(editOnly ? { editOnly: true } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      const saved = profileSaveResult(response.status, body, editOnly ? '' : stored.handle);
      if (currentOwner.current !== ownerId) throw Object.assign(new Error('account_changed'), { code: 'account_changed' });
      if (!saved.ok) {
        if (saved.error === 'profile_not_registered') setConfirmedHandle(null);
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
      setConfirmedHandle(confirmed.handle);
      try { if (key) localStorage.setItem(key, JSON.stringify(confirmed)); } catch { /* The directory confirmed the save. */ }
      let photoSync = null;
      if (photo !== undefined) {
        const synced = await saveProfilePhoto({ ownerId, getAccessToken, image: photo });
        if (currentOwner.current !== ownerId) throw Object.assign(new Error('account_changed'), { code: 'account_changed' });
        photoSync = synced ? 'synced' : 'failed';
        if (synced) {
          writeLooks(localStorage, ownerId, withProfilePhoto(readLooks(localStorage, ownerId), photo));
          setSavedPhoto({ ownerId, image: photo });
        }
      }
      return { ok: true, source: body.source || 'supabase', profile: confirmed, photoSync };
    }
    setProfile(stored);
    if (key) localStorage.setItem(key, JSON.stringify(stored));
    return { ok: true, source: 'local' };
  }, [ownerId, user, getAccessToken, profile]);

  const resolveMention = useCallback(async (token) => {
    const parsed = parseLookupQuery(token);
    if (!parsed) return null;
    const lookupPath = ownerId ? shellRuntimeUrl(`/api/profiles/lookup?q=${encodeURIComponent(token)}`) : null;
    if (lookupPath && ownerId) {
      try {
        const url = lookupPath;
        const response = await fetch(url, { headers: await ownerAuthHeaders(ownerId, getAccessToken), cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (body.recipient?.kind === 'handle' && body.recipient.missing === false) return body.recipient;
        if (body.recipient?.address) return body.recipient;
        if (parsed.kind === 'sns') return resolveSnsProxy(parsed.domain);
      } catch {
        // Fall through to the profile stored on this device.
      }
    }
    if (parsed.kind === 'handle' && lookupHandleKey(profile?.handle) === parsed.handle) {
      return { kind: 'handle', handle: profile.handle, displayName: profile.displayName, self: true };
    }
    if (parsed.kind === 'sns') return resolveSnsProxy(parsed.domain);
    return { kind: 'handle', handle: parsed.handle, missing: true };
  }, [ownerId, profile, getAccessToken]);

  const remoteBots = useMemo(
    () => (remoteLists.bots || [])
      .map((row) => shellBotFromRemote(row, looks))
      .filter((bot) => bot && !isPlaceholderBotId(bot.id)),
    [remoteLists.bots, looks],
  );
  const removedIds = removedAgents.get(ownerId);
  const localRoster = useMemo(() => mergeRoster([], withoutPlaceholderBots(roster)), [roster]);
  const seedBots = useMemo(() => {
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
    return order.filter(id => !removedIds?.has(id)).map(id => byId.get(id));
  }, [localRoster, remoteBots, removedIds]);
  const styled = useMemo(() => {
    const looked = applyLooks(seedBots, looks);
    if (!devPreview || looked.length > 0) return looked;
    const sample = previewBot();
    return sample && !removedIds?.has(sample.id) ? [sample] : looked;
  }, [seedBots, looks, devPreview, removedIds]);
  const wallets = useMemo(() => {
    const listed = withoutRetiredWallets(mergeWalletDirectory(liveWallets, remoteLists.wallets), retiredIds);
    return devPreview && listed.length === 0 ? previewWallets() : listed;
  }, [liveWallets, remoteLists.wallets, retiredIds, devPreview]);
  const assigned = useMemo(() => withAssignedWallet(styled, wallets), [styled, wallets]);
  const createWallets = devPreview ? wallets : savedAgentWallets;
  const bots = useMemo(() => assigned.bots.map(bot => {
    const saved = looks[bot.id];
    return {
      ...bot,
      goal: taskLabel(saved?.generalGoal) || bot.goal,
      currentTask: taskLabel(saved?.currentTask),
      goalProposal: saved?.goalProposal ?? null,
      ...(Object.prototype.hasOwnProperty.call(loopOverrides, bot.id) ? { loop: loopOverrides[bot.id] } : {}),
    };
  }), [assigned.bots, looks, loopOverrides]);
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
    if (bots.length === 0) return;
    if (bots.some(item => item.id === activeBot)) return;
    setActiveBot(bots[0].id);
  }, [activeBot, bots]);
  const walletAddress = assignedWalletAddress(wallets);
  useEffect(() => {
    if (devPreview || !signedIn || !walletAddress) {
      setSolanaBalance(null);
      return undefined;
    }
    let stop = false;
    (async () => {
      let token = '';
      try { token = (await getAccessToken?.()) || ''; } catch { token = ''; }
      if (stop) return;
      if (!token) {
        setSolanaBalance(null);
        return;
      }
      try {
        const response = await fetch(`/api/solana-balance?address=${encodeURIComponent(walletAddress)}`, {
          headers: {
            authorization: `Bearer ${token}`,
            ...(ownerId ? { 'x-owner-id': ownerId } : {}),
          },
          cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        if (stop) return;
        if (response.ok && body?.ok === true && body.cluster === SOLANA_CLUSTER && body.address === walletAddress) {
          setSolanaBalance({ ...body, asOf: new Date().toISOString(), stale: false });
        } else if (body && typeof body === 'object') {
          // Keep failed reads distinct from an empty funded wallet (0 SOL / 0 USDC).
          setSolanaBalance({
            ok: false,
            code: typeof body.code === 'string' ? body.code : `http_${response.status}`,
            cluster: SOLANA_CLUSTER,
            address: walletAddress,
            solLamports: null,
            usdcAmount: null,
            tokens: [],
            asOf: typeof body.asOf === 'string' ? body.asOf : null,
            stale: body.stale === true,
          });
        } else {
          setSolanaBalance({
            ok: false,
            code: `http_${response.status}`,
            cluster: SOLANA_CLUSTER,
            address: walletAddress,
            solLamports: null,
            usdcAmount: null,
            tokens: [],
          });
        }
      } catch {
        if (!stop) {
          setSolanaBalance({
            ok: false,
            code: 'rpc_failed',
            cluster: SOLANA_CLUSTER,
            address: walletAddress,
            solLamports: null,
            usdcAmount: null,
            tokens: [],
          });
        }
      }
    })();
    return () => { stop = true; };
  }, [walletAddress, signedIn, ownerId, getAccessToken, devPreview, walletsOpen, listsTick]);
  const payments = remoteLists.payments || [];
  const paymentCrossCheck = remoteLists.paymentCrossCheck || [];
  const positions = remoteLists.positions || [];
  const fileCatalog = useMemo(() => catalogForChat(library, bots), [library, bots]);
  const recallHits = useMemo(
    () => searchRecall({ query: recall, bots, talks, files: library }),
    [recall, bots, talks, library],
  );
  const recallNeedle = recall.trim().toLowerCase();
  const matchedBots = new Set(recallHits.map(hit => hit.botId).filter(Boolean));
  const visible = !recallNeedle
    ? bots
    : bots.filter(bot => bot.name.toLowerCase().includes(recallNeedle) || matchedBots.has(bot.id));
  const bot = bots.find(item => item.id === activeBot) ?? null;
  const activeGoal = bot?.goal;
  useEffect(() => {
    if (!ownerId || !talksReady || !activeBot || pane !== 'Main' || hasGeneralGoal(activeGoal)) return;
    setTalks(current => current[activeBot]?.length ? current : {
      ...current,
      [activeBot]: [{ id: `${activeBot}-goal-intro`, role: 'agent', text: GOAL_QUESTION }],
    });
  }, [ownerId, talksReady, activeBot, activeGoal, pane]);
  const money = moneyPane(pane);
  const chainLabel = solanaSpendableLabel(solanaBalance);
  const glance = walletGlance(wallets, positions, transfers, chainLabel, solanaBalance);
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
  const requestChatUnlock = useCallback((signal) => {
    if (!deskLockOnRef.current || signal.aborted || lockIntentRef.current) return Promise.resolve(false);
    unlockUntilRef.current = 0;
    unlockedRef.current = false;
    setUnlocked(false);
    try { clearDeskSession(localStorage, ownerId); } catch { /* this tab still locks */ }
    try { clearDeskGrant(sessionStorage, ownerId); } catch { /* the next unlock replaces the grant */ }
    return new Promise((resolve) => {
      const intent = { type: 'chat-spend', resolve: complete };
      function complete(value) {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      }
      function cancel() {
        if (lockIntentRef.current === intent) {
          lockIntentRef.current = null;
          setLockOpen(false);
        }
        complete(false);
      }
      lockIntentRef.current = intent;
      signal.addEventListener('abort', cancel, { once: true });
      setLockOpen(true);
    });
  }, [ownerId]);
  const grantDesk = useCallback((until) => {
    unlockUntilRef.current = until;
    try { writeDeskSession(localStorage, ownerId, until); } catch { /* this tab still unlocks */ }
    unlockedRef.current = true;
    setUnlocked(true);
    setLockOpen(false);
    const intent = lockIntentRef.current;
    lockIntentRef.current = null;
    if (intent?.type === 'wallet') setWalletsOpen(true);
    if (intent?.type === 'spend' && intent.pending) setPendingSend(intent.pending);
    if (intent?.type === 'chat-spend') intent.resolve(true);
  }, [ownerId]);
  const dismissLock = useCallback(() => {
    const intent = lockIntentRef.current;
    lockIntentRef.current = null;
    setLockOpen(false);
    if (intent?.type === 'chat-spend') intent.resolve(false);
    if (intent?.type === 'spend' && intent.pending) {
      appendTalk(intent.pending.botId, {
        id: `${intent.pending.lineId}-send`,
        role: 'assistant',
        text: 'The send stayed unsent.',
      });
    }
  }, [appendTalk]);
  useEffect(() => {
    setRetiredIds(readRetiredWalletIds(window.localStorage, ownerId));
  }, [ownerId]);
  const handleWalletCreated = useCallback((wallet) => {
    const incoming = Array.isArray(wallet) ? wallet : [wallet];
    const unretire = incoming.flatMap((item) => [item?.id, item?.address]).filter(Boolean);
    if (unretire.length && ownerId) {
      const next = forgetRetiredWallet(window.localStorage, ownerId, ...unretire);
      setRetiredIds(next);
    }
    setRemoteLists((current) => {
      const existing = current.wallets || [];
      const added = incoming.filter((item) => item?.address && !existing.some((row) => row.id === item.id || row.address === item.address));
      return added.length ? { ...current, wallets: [...existing, ...added] } : current;
    });
    onWalletCreated?.(wallet);
  }, [onWalletCreated, ownerId]);
  const retireWallet = useCallback(async (wallet) => {
    if (!wallet || wallet.kind !== 'additional' || typeof wallet.id !== 'string') {
      return { ok: false, message: 'The main wallet stays on the account.' };
    }
    if (devPreview) {
      const next = rememberRetiredWallet(window.localStorage, ownerId, wallet.id, wallet.address);
      setRetiredIds(next);
      onRetireWallet?.(wallet.id, wallet.address);
      setRemoteLists((current) => ({
        ...current,
        wallets: (current.wallets || []).filter((item) => item?.id !== wallet.id && (!wallet.address || item?.address !== wallet.address)),
      }));
      return { ok: true };
    }
    let unlinked = false;
    if (wallet.address) {
      try {
        await unlinkWallet?.(wallet.address);
        unlinked = true;
      } catch {
        // Embedded wallets cannot be unlinked from Privy; ignore
      }
    }
    let token = '';
    try { token = (await getAccessToken?.()) || ''; } catch { token = ''; }
    if (!token) return { ok: false, message: 'Sign in again, then unlink the wallet.' };
    const retireId = resolveRetireId(wallets, wallet);
    try {
      const response = await fetch('/api/wallets/retire', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          ...(ownerId ? { 'x-owner-id': ownerId } : {}),
        },
        body: JSON.stringify({ id: retireId, address: wallet.address }),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if ((!response.ok || body.ok !== true) && !(response.status === 404 && unlinked)) {
        return { ok: false, message: 'That wallet is still on the account.' };
      }
      const next = rememberRetiredWallet(window.localStorage, ownerId, wallet.id, wallet.address);
      setRetiredIds(next);
      onRetireWallet?.(wallet.id, wallet.address);
      setRemoteLists((current) => ({
        ...current,
        wallets: (current.wallets || []).filter((item) => item?.id !== wallet.id && (!wallet.address || item?.address !== wallet.address)),
      }));
      return { ok: true };
    } catch {
      return { ok: false, message: 'That wallet is still on the account.' };
    }
  }, [devPreview, getAccessToken, onRetireWallet, ownerId, unlinkWallet, wallets]);
  const openWallet = useCallback((walletId) => {
    setAIProvidersOpen(false);
    setCreateOpen(false);
    setProfileOpen(false);
    setCardsOpen(false);
    setStatsOpen(false);
    setWalletFocus(typeof walletId === 'string' ? walletId : '');
    if (deskLockOnRef.current && !unlockedRef.current) {
      lockIntentRef.current ??= { type: 'wallet' };
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
  const signWithOwnerAuthorization = createOwnerAuthorizationSigner({
    headers: async () => moneyHeaders(await getAccessToken?.()), authorize: authorizeSpend,
  });
  const onWalletSend = useCallback(async (pending) => {
    let failure = {};
    const failed = (message, detail = failure) => walletSendFailure(message, detail);
    const missingBrowserWallet = () => {
      const seen = depositSignerRef.current?.wallets || [];
      const addresses = seen.map(wallet => String(wallet?.address || '').slice(0, 5)).join(', ') || 'none';
      return failed(`Main isn't available to sign in this browser. Reload and sign in again. Browser sees ${seen.length} wallets: ${addresses}.`,
        { error: 'browser_wallet_missing' });
    };
    if (!pending?.walletAsset && pending?.target?.kind !== 'wallet' && deskLockOnRef.current && !unlockedRef.current) {
      lockIntentRef.current ??= { type: 'wallet' };
      setLockOpen(true);
      return failed('Enter your password to use the wallet.');
    }
    const target = pending?.target;
    if (pending?.walletAsset) {
      const list = Array.isArray(liveWallets) ? liveWallets : wallets;
      const from = list.find(item => item?.id === pending.fromWalletId);
      if (!from || from.frozen) return failed('That wallet cannot send.');
      try {
        if (!sessionReadyForWallets(signedIn, user)) return failed('Sign in again, then send.');
        const token = await getAccessToken?.();
        const headers = moneyHeaders(token);
        const payload = { from, asset: pending.walletAsset, destination: pending.destination, amount: pending.amount, decimals: pending.decimals };
        const post = async (extra) => {
          const response = await fetch('/api/wallets/move', { method: 'POST', headers, body: JSON.stringify({ ...payload, ...extra }) });
          return { response, body: await response.json().catch(() => ({})) };
        };
        let result;
        const signer = await waitForBrowserSigner(() => depositSignerRef.current, [from]);
        const requireBrowser = from.kind === 'main' || (from.spendable !== false && from.provider === 'privy');
        const browserEmbedded = from.spendable !== false && browserCanSign(signer, from);
        if (requireBrowser && !browserCanSign(signer, from)) return failed(from.kind === 'main'
          ? "Main isn't available to sign in this browser. Reload and sign in again."
          : 'Privy did not approve signing for this agent wallet in your browser. Sign in again, then slide once more.');
        if (browserEmbedded || from.spendable === false) {
          const prepared = await post({ phase: 'prepare' });
          failure = prepared.body;
          if (!prepared.response.ok || !prepared.body.transaction) return failed('The transfer was not prepared. Check the balance and SOL network fees.');
          const transaction = base64ToBytes(prepared.body.transaction);
          const signed = await signSelectedWalletTransaction({ from, transaction, signer });
          result = await post({ phase: 'broadcast', signedTransaction: bytesToBase64(signed) });
        } else result = await post({ phase: 'send' });
        const { response, body } = result;
        failure = body;
        if (!response.ok || !body.signature) {
          const messages = {
            insufficient_balance: 'Amount exceeds this wallet’s balance.',
            wallet_frozen: 'That wallet is frozen.',
            wallet_not_owned: 'That wallet is not ready to send. Sign out and sign in again.',
            unsupported_mint: 'This token’s transfer rules are not supported.',
            simulation_failed: 'The send could not be simulated. Check the token balance and SOL for fees or token-account rent.',
            asset_changed: 'Token details changed. Reload your wallet balances before sending.',
            wallet_authorization_failed: 'Privy did not sign the send. Sign in again, then slide once more.',
            privy_failed: 'Privy did not sign the send. Sign in again, then slide once more.',
          };
          return failed(messages[body.error] || 'The asset send did not post. Nothing was marked sent.');
        }
        const amountLabel = `${pending.amountText} ${pending.asset}`;
        setListsTick(tick => tick + 1);
        return {
          ok: true,
          message: `Sent ${amountLabel}.`,
          signature: body.signature,
          receipt: { id: `asset_${body.signature}`, at: new Date().toISOString(), title: `Send ${amountLabel}`, lines: [
            { label: 'To', value: pending.destination }, { label: 'Amount', value: amountLabel },
            { label: 'Asset', value: pending.walletAsset }, { label: 'Signature', value: body.signature },
          ], signature: body.signature, cluster: SOLANA_CLUSTER },
        };
      } catch (error) {
        failure = { error: error?.code, privy: error?.privyFailure };
        const messages = {
          wallet_owner_authorization_failed: 'Privy did not approve signing for this agent wallet in your browser. Sign in again, then slide once more.',
          wallet_connection_required: 'Connect the selected wallet, then slide again to approve the send.',
          wallet_approval_cancelled: 'The wallet did not approve the send. Nothing was sent.',
          invalid_signature: 'The wallet did not return a signed transfer. Nothing was sent.',
        };
        return failed(messages[error?.code] || 'The wallet send did not complete.');
      }
    }
    if (target?.kind === 'sns') {
      const main = (Array.isArray(liveWallets) ? liveWallets : wallets).find(item => item?.kind === 'main') || null;
      if (!main) return failed('The main wallet is not ready.');
      try {
        if (!sessionReadyForWallets(signedIn, user)) return failed('Sign in again, then send.');
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
        failure = body;
        const where = body.address ? clipAddress(body.address) : target.domain;
        if (body.error === 'missing_config') {
          const names = Array.isArray(body.missing) ? body.missing.join(', ') : 'SOLANA_RPC_URL';
          return failed(`${target.domain} is ${where}. This send needs ${names}.`);
        }
        if (body.error === 'sns_not_found' || body.error === 'sns_failed') {
          return failed('Failed.');
        }
        if (!response.ok || !body.signature) {
          return failed(`The send to ${where} did not post.`);
        }
        setListsTick(tick => tick + 1);
        const snsAmountLabel = `${formatBaseUnits(pending.amount)} USDC`;
        return {
          ok: true,
          message: `Sent ${snsAmountLabel} to ${target.domain} (${where}).`,
          signature: body.signature,
          receipt: {
            id: `sns_${body.signature}`,
            at: new Date().toISOString(),
            title: `Send ${snsAmountLabel}`,
            lines: [
              { label: 'To', value: `${target.domain} (${where})` },
              { label: 'Amount', value: snsAmountLabel },
              { label: 'Signature', value: body.signature },
            ],
            signature: body.signature,
            cluster: SOLANA_CLUSTER,
          },
        };
      } catch (error) {
        failure = { error: error?.code, privy: error?.privyFailure };
        return failed('The send did not post.');
      }
    }
    if (target?.kind === 'wallet') {
      const list = Array.isArray(liveWallets) ? liveWallets : wallets;
      const from = list.find(item => item?.id === pending.fromWalletId) || null;
      const dest = list.find(item => item?.id === target.id && item?.address === target.address) || null;
      if (!from || !dest) return failed('That wallet is not on this desk.');
      if (pending.asset !== 'USDC') return failed('Wallet sends are USDC.');
      try {
        if (!sessionReadyForWallets(signedIn, user)) return failed('Sign in again, then send.');
        const token = await getAccessToken?.();
        if (from.spendable === false) {
          if (dest.kind !== 'main') {
            return failed('A connected wallet sends USDC to the main wallet.');
          }
          const headers = {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            'x-owner-id': ownerId,
          };
          const depositBody = {
            fromId: from.id,
            toId: dest.id,
            fromAddress: from.address,
            toAddress: dest.address,
            amount: pending.amount,
          };
          const preparedResponse = await fetch('/api/wallets/deposit', {
            method: 'POST',
            headers,
            body: JSON.stringify({ phase: 'prepare', ...depositBody }),
          });
          const prepared = await preparedResponse.json().catch(() => ({}));
          failure = prepared;
          if (!preparedResponse.ok || typeof prepared.transaction !== 'string') {
            return failed('The transfer to the main wallet was not prepared.');
          }
          const signer = depositSignerRef.current;
          const wallet = (Array.isArray(signer?.wallets) ? signer.wallets : []).find(item => item?.address === from.address);
          const unsigned = base64ToBytes(prepared.transaction);
          if (!wallet || !unsigned || typeof signer?.signTransaction !== 'function') {
            return failed('Connect that wallet again, then send to the main wallet.');
          }
          let signedBytes;
          try {
            const signed = await signer.signTransaction({
              transaction: unsigned,
              wallet,
              chain: SOLANA_PRIVY_CHAIN,
            });
            signedBytes = signed?.signedTransaction;
          } catch (error) {
            failure = { error: error?.code, privy: error?.privyFailure };
            return failed('The connected wallet did not approve the transfer.');
          }
          if (!(signedBytes instanceof Uint8Array) || signedBytes.length <= 64) {
            return failed('The connected wallet did not return a signed transfer.');
          }
          const response = await fetch('/api/wallets/deposit', {
            method: 'POST',
            headers,
            body: JSON.stringify({ phase: 'broadcast', ...depositBody, signedTransaction: bytesToBase64(signedBytes) }),
          });
          const body = await response.json().catch(() => ({}));
          failure = body;
          const where = dest.label || clipAddress(dest.address);
          if (body.error === 'wallet_frozen') return failed('That wallet is frozen.');
          if (body.error === 'transaction_mismatch') return failed('The signed transfer did not match the deposit.');
          if (!response.ok || !body.signature) return failed(`The send to ${where} did not post.`);
          setListsTick(tick => tick + 1);
          const amountLabel = `${formatBaseUnits(pending.amount)} USDC`;
          return {
            ok: true,
            message: `Sent ${amountLabel} to the main wallet.`,
            signature: body.signature,
            receipt: {
              id: `deposit_${body.signature}`,
              at: new Date().toISOString(),
              title: `Send ${amountLabel}`,
              lines: [
                { label: 'To', value: 'Main wallet' },
                { label: 'Amount', value: amountLabel },
                { label: 'Signature', value: body.signature },
              ],
              signature: body.signature,
              cluster: SOLANA_CLUSTER,
            },
          };
        }
        const postMove = async (extra = {}) => {
          const response = await fetch('/api/wallets/move', {
            method: 'POST', headers: moneyHeaders(token),
            body: JSON.stringify({ from, to: dest, amount: pending.amount, ...extra }),
          });
          return { response, body: await response.json().catch(() => ({})) };
        };
        let signer = await waitForBrowserSigner(() => depositSignerRef.current, [from]);
        const requireBrowser = from.kind === 'main' || (from.spendable !== false && from.provider === 'privy');
        const available = wallet => browserCanSign(signer, wallet);
        if (requireBrowser && !available(from)) return from.kind === 'main' ? missingBrowserWallet()
          : failed('Privy did not approve signing for this agent wallet in your browser. Sign in again, then slide once more.');
        let result;
        if (available(from)) {
          const prepared = await postMove({ phase: 'prepare' });
          failure = prepared.body;
          if (!prepared.response.ok || !prepared.body.transaction || !Array.isArray(prepared.body.signerWallets)
              || !prepared.body.signerWallets.length) return failed('The transfer was not prepared. Check the balance and SOL network fees.');
          signer = await waitForBrowserSigner(() => depositSignerRef.current, prepared.body.signerWallets);
          if (prepared.body.signerWallets.every(available)) {
            const signed = await signWalletMoveTransaction({ wallets: prepared.body.signerWallets,
              transaction: base64ToBytes(prepared.body.transaction), signer });
            result = await postMove({ phase: 'broadcast', signedTransaction: bytesToBase64(signed) });
          } else if (requireBrowser) return missingBrowserWallet();
          else result = await postMove();
        } else result = await postMove();
        const { response, body } = result;
        failure = body;
        const where = target.caption || clipAddress(target.address);
        if (body.error === 'missing_config') {
          const names = Array.isArray(body.missing) ? body.missing.join(', ') : 'SOLANA_RPC_URL';
          return failed(`This send needs ${names}.`);
        }
        if (body.error === 'wallet_frozen') return failed('That wallet is frozen.');
        if (body.error === 'invalid_destination') return failed('Pick a different wallet.');
        if (!response.ok || !body.signature) return failed(`The send to ${where} did not post.`);
        setListsTick(tick => tick + 1);
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
            ],
            signature: body.signature,
            cluster: SOLANA_CLUSTER,
          },
        };
      } catch (error) {
        failure = { error: error?.code, privy: error?.privyFailure };
        if (error?.code === 'wallet_owner_authorization_failed') return failed('Privy did not approve signing for this agent wallet in your browser. Sign in again, then slide once more.');
        return failed('The send did not post.');
      }
    }
    if (target?.kind !== 'handle') {
      return failed('Platform sends go to a @handle.');
    }
    let settleAmount = pending.asset === 'USDC' ? pending.amount : null;
    let pricedFrom = null;
    if (pending.asset !== 'USDC') {
      const quote = pending.quote;
      if (!quote?.url || quote.broadcast !== false) {
        return failed('That quote cannot authorize a send.');
      }
      let quoted = null;
      try {
        const response = await fetch(quote.url);
        const payload = await response.json().catch(() => ({}));
        failure = payload;
        if (response.ok) quoted = readQuoteOut(payload);
      } catch (error) {
        failure = { error: error?.code, privy: error?.privyFailure };
        return failed('The quote did not load. Nothing was sent.');
      }
      const settlement = swapSendSettlement({
        inputSymbol: pending.asset,
        quoteOut: quoted,
        quote,
      });
      if (settlement.error || settlement.authorizesTransaction !== false || settlement.broadcast !== false) {
        return failed('That quote cannot authorize a send.', { error: settlement.error });
      }
      settleAmount = settlement.amount;
      pricedFrom = settlement.inputSymbol;
    }
    if (!settleAmount) return failed('Platform sends are USDC to a @handle.');
    const transfersUrl = shellRuntimeUrl('/api/transfers');
    if (!transfersUrl) return failed('Platform sends need the agent runtime.');
    try {
      if (!sessionReadyForWallets(signedIn, user)) return failed('Sign in again, then send.');
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
      failure = body;
      if (!response.ok || !body.transfer) {
        const message = body.error === 'handle_missing'
          ? `@${target.handle} is not on Maelstrom.`
          : body.error === 'recipient_wallet_missing'
            ? `@${target.handle} does not have a wallet yet.`
            : body.error === 'wallet_frozen'
              ? 'That wallet is frozen.'
              : 'The send did not post.';
        return failed(message);
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
            { label: 'Method', value: 'Platform ledger' },
          ],
          cluster: SOLANA_CLUSTER,
        },
      };
    } catch (error) {
      failure = { error: error?.code, privy: error?.privyFailure };
      return failed('The send did not post.');
    }
  }, [liveWallets, wallets, signedIn, user, getAccessToken, ownerId]);
  const confirmResolve = useRef(null);
  const accessRef = useRef(null);
  const [slideConfirm, setSlideConfirm] = useState(null);
  const askSlideConfirm = useCallback((prompt, address = '') => new Promise((resolve) => {
    confirmResolve.current = resolve;
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    setSlideConfirm({ text: text || 'Confirm this action?', address });
  }), []);
  const finishSlideConfirm = useCallback((accepted) => {
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    setSlideConfirm(null);
    if (resolve) resolve(accepted === true);
  }, []);
  function acceptSpokenConfirm(decision) {
    const accepted = decision === 'allow';
    if (!accepted && decision !== 'deny') return false;
    if (confirmResolve.current) {
      finishSlideConfirm(accepted);
      return true;
    }
    if (pendingSend) {
      const pending = pendingSend;
      setPendingSend(null);
      if (!accepted) {
        appendTalk(pending.botId, { id: `${pending.lineId}-send`, role: 'assistant', text: 'The send stayed unsent.' });
        return true;
      }
      if (deskLockOnRef.current && !unlockedRef.current) {
        lockIntentRef.current ??= { type: 'spend', pending };
        setLockOpen(true);
        return true;
      }
      void settleSpend(pending, true);
      return true;
    }
    const line = latestInlineAllow(talks[activeBot] ?? []);
    if (!line || typeof accessRef.current !== 'function') return false;
    return accessRef.current(line, accepted) === true;
  }
  const lockWallet = useCallback(() => {
    unlockUntilRef.current = 0;
    try { clearDeskSession(localStorage, ownerId); } catch { /* the in-memory lock still applies */ }
    try { clearDeskGrant(sessionStorage, ownerId); } catch { /* the in-memory lock still applies */ }
    unlockedRef.current = false;
    setUnlocked(false);
    setLockOpen(false);
    if (lockIntentRef.current?.type === 'chat-spend') lockIntentRef.current.resolve(false);
    lockIntentRef.current = null;
    setWalletsOpen(false);
    setCardsOpen(false);
    setPendingSend(null);
    finishSlideConfirm(false);
  }, [ownerId, finishSlideConfirm]);
  const logOut = useCallback(async () => {
    lockWallet();
    setProfileOpen(false);
    try {
      await logoutAfterFlush(flushAccountState, onLogout);
    } catch {
      toast?.('Could not log out. Please try again.');
    }
  }, [lockWallet, onLogout, toast]);
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
    const open = initialDeskUntil > Date.now();
    unlockUntilRef.current = open ? initialDeskUntil : 0;
    unlockedRef.current = open;
    setUnlocked(open);
    setLockOpen(false);
    if (lockIntentRef.current?.type === 'chat-spend') lockIntentRef.current.resolve(false);
    lockIntentRef.current = null;
    setPendingSend(null);
  }, [ownerId, initialDeskUntil]);
  useEffect(() => {
    if (!unlocked || !ownerId) return undefined;
    const tick = () => {
      if (!unlockedRef.current) return;
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
    setAIProvidersOpen(false);
    if (next === pane) return;
    setSlide(direction);
    setPane(next);
    if (next === 'Main') setActiveBot(current => current ?? bots[0]?.id ?? null);
  }

  function openChat(id) {
    setAIProvidersOpen(false);
    setCreateOpen(false);
    setWalletsOpen(false);
    setProfileOpen(false);
    setCardsOpen(false);
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

  async function onCreate(created) {
    if (!ownerId) return { ok: false, message: 'Sign in to create an agent.' };
    if (!createWallets.some(wallet => wallet.id === created.walletId)) {
      return { ok: false, message: 'Choose a wallet that is ready for agent spending.' };
    }
    if (!devPreview) {
      let accessToken = '';
      try { accessToken = (await getAccessToken?.()) || ''; } catch { accessToken = ''; }
      if (!accessToken || currentOwner.current !== ownerId) return { ok: false, message: 'Sign in again to create this agent.' };
      const saved = await agentRemoval.save(ownerId, created.id, () => upsertOwnerBot(ownerId, created, {
        accessToken, signal: AbortSignal.timeout(15000),
      }));
      if (!saved.ok) return { ok: false, message: 'Could not create the agent with this wallet. Check that the wallet is available and try again.' };
      if (currentOwner.current !== ownerId) return { ok: false };
      if (saved.bot) setRemoteLists(current => ({
        ...current,
        bots: [...current.bots.filter(item => item.id !== created.id), saved.bot],
      }));
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
    setRecall('');
    setSlide('right');
    setPane('Main');
    setCreateOpen(false);
    return { ok: true };
  }

  function onEditLook(id, patch) {
    const currentBot = bots.find(item => item.id === id);
    setLooks(current => {
      const prev = current[id] ?? {};
      const next = {
        ...prev,
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

  function onAgentTask({ agentTask, proposedGoal }, id, forOwner = ownerId) {
    const task = taskLabel(agentTask);
    if (!task || !forOwner || forOwner !== currentOwner.current || removedIds?.has(id)) return;
    const agent = bots.find(item => item.id === id);
    if (!agent) return;
    const goal = proposedGeneralGoal(proposedGoal, agent.goal, agent.goalProposal?.text);
    const proposal = goal ? { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: goal } : null;
    setLooks(current => ({
      ...current,
      [id]: { ...current[id], currentTask: task, ...(proposal ? { goalProposal: proposal } : {}) },
    }));
    if (proposal) appendTalk(id, {
      id: proposal.id,
      role: 'agent',
      text: `Do you want to ${hasGeneralGoal(agent.goal) ? 'change' : 'set'} my general goal to “${goal}”?`,
    });
  }

  function onGoalDecision(id, proposalId, accept) {
    const decision = reviewGeneralGoal(looks[id], proposalId, accept);
    if (!decision) return;
    setLooks(current => {
      const next = reviewGeneralGoal(current[id], proposalId, accept);
      return next ? { ...current, [id]: next } : current;
    });
    appendTalk(id, {
      id: `${proposalId}-decision`, role: 'agent',
      text: accept ? `My general goal is now “${decision.generalGoal}”.` : 'I’ll keep my general goal as it is.',
    });
  }

  function onReorder(fromId, toId) {
    setRoster(current => ({ ...current, order: reorderIds(current.order, fromId, toId) }));
  }

  async function onDelete(id) {
    if (!ownerId) return;
    const name = bots.find(item => item.id === id)?.name ?? 'Agent';
    const removal = agentRemoval.remove(ownerId, id, async () => {
      if (devPreview) return { ok: true };
      const accessToken = sessionReadyForWallets(signedIn, user) ? await getAccessToken?.() : '';
      return deleteOwnerBot(ownerId, id, { accessToken: accessToken || '' });
    });
    setThinkingBot(current => (current === id ? null : current));
    setActiveBot(current => current === id ? bots.find(item => item.id !== id)?.id ?? null : current);

    const result = await removal;
    if (!result || currentOwner.current !== ownerId) return;
    if (!result.ok) {
      toast?.(`Could not remove ${name}. Try again.`);
      return;
    }
    toast?.(`${name} removed`);
    setRemoteLists(current => ({ ...current, bots: current.bots.filter(item => item.id !== id) }));
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
  }

  function onAccount(id) {
    setAIProvidersOpen(id === 'ai-providers');
    if (id === 'logout') {
      void logOut();
      return;
    }
    setCreateOpen(false);
    setComputerOpen(id === 'computer');
    if (id === 'profile') {
      setWalletsOpen(false);
      setCardsOpen(false);
      setStatsOpen(false);
      setProfileOpen(true);
      return;
    }
    if (id === 'cards') {
      setProfileOpen(false);
      setWalletsOpen(false);
      setStatsOpen(false);
      setCardsOpen(true);
      return;
    }
    if (id === 'computer') {
      setProfileOpen(false);
      setWalletsOpen(false);
      setCardsOpen(false);
      setStatsOpen(false);
      setComputerOpen(true);
      return;
    }
    if (id === 'statistics') {
      setProfileOpen(false);
      setWalletsOpen(false);
      setCardsOpen(false);
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
    if (id === 'unlock-wallet') {
      setLockOpen(true);
      return;
    }
    if (id === 'ai-providers') {
      setProfileOpen(false);
      setWalletsOpen(false);
      setCardsOpen(false);
      setStatsOpen(false);
      return;
    }
    setProfileOpen(false);
    setWalletsOpen(false);
    setCardsOpen(false);
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
      lockIntentRef.current ??= { type: 'spend', pending };
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
        setListsTick(tick => tick + 1);
        pushReceipt({
          id: body.signature,
          at: new Date().toISOString(),
          title: `Sent ${amountLabel}`,
          lines: [
            { label: 'To', value: `@${pending.command.handle}` },
            { label: 'Amount', value: amountLabel },
          ],
          signature: body.signature,
          cluster: SOLANA_CLUSTER,
        });
        reply(`Sent ${amountLabel} to @${pending.command.handle} on solana.`);
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
          ? 'A price quote cannot authorize this send.'
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
        { label: 'Method', value: 'Platform ledger' },
      ],
      cluster: SOLANA_CLUSTER,
    });
    reply(`Sent ${amountLabel} to @${body.transfer.handle}. It is in their wallet.`);
    toast?.(`Sent ${amountLabel} to @${body.transfer.handle}`);
  }

  const noAgents = bots.length === 0;
  return (
    <>
    {privyLive ? <DepositSigner signerRef={depositSignerRef} signWithOwnerAuthorization={signWithOwnerAuthorization} /> : null}
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
          <RecallSearch query={recall} hits={recallHits} onQuery={setRecall} onSelect={onRecall} />
          <button type="button" className="add-agent" aria-label="Add agent" onClick={() => { setProfileOpen(false); setWalletsOpen(false); setCardsOpen(false); setStatsOpen(false); setCreateOpen(true); }}>
            <Plus size={16} strokeWidth={1.75} />
          </button>
        </div>
        <BotRail
          bots={visible}
          activeId={bot?.id}
          canDrag={!recall.trim()}
          onSelect={openChat}
          onReorder={onReorder}
          onDelete={onDelete}
          onEdit={onEditLook}
          onCreate={() => setCreateOpen(true)}
          onBreakLoop={onBreakLoop}
        />
        <footer className="you">
          <AccountMenu
            accountAddress={user?.wallet?.address || ''}
            accountLabel={profileRailLabel({
              handle: confirmedHandle === undefined ? profile?.handle : confirmedHandle,
              displayName: profile?.displayName,
              fallback: accountLabel,
            })}
            avatarUrl={avatarUrl}
            signedIn={signedIn}
            loginDisabled={loginDisabled}
            walletUnlocked={unlocked}
            walletLockAvailable={deskLockOnRef.current}
            holdingsLabel={<AccountValue key={ownerId} ownerId={ownerId} getAccessToken={getAccessToken} wallets={wallets} devPreview={devPreview} refreshKey={`${listsTick}:${transfers.length}:${walletsOpen}`} />}
            onLogin={onLogin}
            onPick={onAccount}
          />
        </footer>
      </aside>

      <section className={`stage${pane === 'Positions' ? ' is-book' : ''}`}>
        {noAgents && pane !== 'Logs' ? null : (
        <header className="topbar">
          <span className="topbar-side" />
          <PaneDock panes={noAgents ? EMPTY_DESK_LOG_PANES : SHELL_PANES} pane={pane} onChange={choosePane} />
        </header>
        )}
        <div key={`${pane}-${slide}`} className={`thread slide-${slide}${pane === 'Positions' ? ' is-book' : ''}${pane === 'Main' ? ' is-chat' : ''}`}>
          <article className={`bubble${pane === 'Positions' ? ' is-book' : ''}`} aria-label={pane}>
            {noAgents && pane !== 'Logs' ? (
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
                  onGoalDecision={(line, accepted) => onGoalDecision(bot.id, line.id, accepted)}
                  hideAccessActions={voiceLive}
                  focusLine={focusLine?.botId === bot.id ? focusLine.lineId : null}
                />
            ) : null}
            {!noAgents && money ? (
              <MoneyPane
                pane={money}
                state={{ bots, wallets, payments, positions, transfers, paymentCrossCheck, retiredIds }}
                onParty={setParty}
                ownerId={ownerId}
                getAccessToken={getAccessToken}
                onWallet={openWallet}
              />
            ) : null}
            {pane === 'Logs' ? (
              <LogsPanel
                key={ownerId}
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
                onPolicyChange={(items) => {
                  const byId = new Map(items.map(item => [item.botId, item]));
                  setRemoteLists(current => ({
                    ...current,
                    bots: current.bots.map(row => {
                      const item = byId.get(row.id);
                      return item ? { ...row, frozen: item.frozen ?? row.frozen, enabled: item.enabled } : row;
                    }),
                  }));
                }}
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
            authorizeSpend={authorizeSpend}
            signChatTransaction={signChatTransaction}
            executeChatSwap={executeChatSwap}
            lines={talks[bot.id] ?? []}
            onAgentTask={onAgentTask}
            onLine={(line, forBot) => {
              const id = forBot || bot.id;
              appendTalk(id, line);
              if (line.role === 'agent') setListsTick((tick) => tick + 1);
              if (line.role !== 'user') return;
              const task = taskFromRequest(line.text);
              if (task) onAgentTask({ agentTask: task }, id);
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
                lockIntentRef.current ??= { type: 'spend', pending };
                setLockOpen(true);
                return;
              }
              setPendingSend(pending);
            }}
            onThinking={on => setThinkingBot(on ? bot.id : null)}
            onVoiceSpan={addVoice}
            resolveMention={resolveMention}
            mentionHandles={mentionSuggestions({
              handle: profile?.handle,
              displayName: profile?.displayName,
              transfers,
              payments,
              lines: talks[bot.id] ?? [],
            })}
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
            onDeskUnlock={requestChatUnlock}
            onSpokenConfirm={acceptSpokenConfirm}
            onVoiceLive={setVoiceLive}
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
      <CreateBotDialog open={createOpen} onClose={closeCreate} onCreate={onCreate} wallets={createWallets} first={bots.length === 0} />
      {walletError && !hideWalletError ? (
        <div className="backdrop is-center">
          <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-label="Wallet setup">
            <h2>Wallet setup did not finish</h2>
            <p className="quiet">{walletError}</p>
            <button type="button" className="solid" onClick={() => setHideWalletError(true)}>Continue</button>
          </section>
        </div>
      ) : null}
      {(setupStep === 'acceptance' || acceptanceClosing) && !claimWelcome ? (
        <SpendAcceptance
          ownerId={ownerId || ''}
          onContinue={({ permission, reviewCap }) => {
            try {
              writeAcceptance(accountStorage, ownerId, { permission, reviewCap });
              if (readAcceptanceAck(localStorage, ownerId) !== true) return false;
              setAcceptanceClosing(true);
              window.clearTimeout(acceptanceTimer.current);
              acceptanceTimer.current = window.setTimeout(() => {
                try { clearAcceptanceDraft(sessionStorage, ownerId); } catch { /* the account copy is already stored */ }
                setAcceptanceAck(true);
                setAcceptanceClosing(false);
              }, CONFIRM_HOLD_MS);
              void flushAccountState();
              return true;
            } catch {
              return false;
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
          allowLocal={devPreview}
          hadLocalSeed={localSeed}
          onSessionExpired={devPreview ? null : onLogout}
          onDone={() => {
            try { writeRecoveryAck(localStorage, ownerId); } catch { /* the phrase stays in the download only */ }
            setRecoveryAck(true);
          }}
        />
      ) : null}
      <LasoCardsSheet
        open={cardsOpen}
        onClose={closeCards}
        ownerId={ownerId || ''}
        botId={activeBot || ''}
        getAccessToken={getAccessToken}
      />
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
        solanaBalance={solanaBalance}
        onRetire={retireWallet}
        onWalletCreated={handleWalletCreated}
      />
      <PartySheet
        open={Boolean(party)}
        party={party}
        transfers={transfers}
        payments={payments}
        onClose={() => setParty(null)}
        resolve={resolveMention}
      />
      <AIProvidersSheet ownerId={ownerId} open={aiProvidersOpen} onClose={closeAIProviders} />
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
      {slideConfirm && !voiceLive ? (
        <div className="backdrop is-center" onMouseDown={() => finishSlideConfirm(false)}>
          <section className="spend-confirm" role="dialog" aria-modal="true" aria-label="Confirm" onMouseDown={event => event.stopPropagation()}>
            <h2>Confirm</h2>
            <p className="quiet"><AddressText text={slideConfirm.text} addresses={[slideConfirm.address]} /></p>
            <p className="quiet">Say yes to confirm, or no to cancel.</p>
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
      {pendingSend && !voiceLive ? (
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
            <p className="quiet">Nothing is signed until you confirm. Say yes to confirm, or no to cancel.</p>
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
                  lockIntentRef.current ??= { type: 'spend', pending };
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
        key={ownerId || 'signed-out'}
        open={profileOpen}
        onClose={closeProfile}
        accountLabel={profile?.displayName || accountLabel}
        accountAddress={user?.wallet?.address || ''}
        avatarUrl={avatarUrl}
        profile={confirmedHandle === undefined ? profile : { ...profile, handle: confirmedHandle || '' }}
        ownerId={ownerId}
        getAccessToken={getAccessToken}
        connections={privyLive ? <LiveProfileConnections /> : <ProfileConnections user={user} />}
        voiceMs={voiceMs}
        talks={talks}
        payments={payments}
        transfers={transfers}
        signedIn={signedIn}
        loginDisabled={loginDisabled}
        onLogin={onLogin}
        onLogout={logOut}
        onSave={saveProfile}
      />
    </div>
    {/* Claim stays outside the shell. .shell.is-claim sets opacity 0. */}
    {setupStep === 'handle' || claimWelcome ? (
      <ClaimHandle
        accountLabel={profile?.displayName || accountLabel}
        ownerId={ownerId}
        getAccessToken={getAccessToken}
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
        key={ownerId}
        ownerId={ownerId}
        getAccessToken={getAccessToken}
        onUnlock={grantDesk}
        onClose={dismissLock}
      />
    ) : null}
    </>
  );
}
