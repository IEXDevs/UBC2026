'use client';

import AddressText from './AddressText';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, LockKeyhole, Pencil, X } from 'lucide-react';
import { motion } from 'motion/react';
import { normalizeDisplayName, normalizeHandle } from '@ubc2026/contracts';
import AccountStats from './AccountStats';
import { readAgentImage } from './AgentEdit';
import ModalClose from './ModalClose';
import ProfileMark from './ProfileMark';
import { copyText } from '../lib/copy-text.mjs';
import { claimLookupVerdict, profileSaveNote } from '../lib/profile.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import { profileStats } from '../lib/statistics.mjs';
import { profilePhoto, PROFILE_LOOK_KEY } from '../lib/profile-photo.mjs';
import { usePresence } from './usePresence';

export default function ProfileSheet({
  open, onClose, accountLabel, accountAddress = '', avatarUrl = null, profile = null,
  voiceMs = 0, talks = {}, payments = [], transfers = [],
  signedIn, loginDisabled, onLogin, onLogout, onSave,
  ownerId, getAccessToken, connections,
}) {
  const { mounted, leaving } = usePresence(open);
  const [displayName, setDisplayName] = useState('');
  const [photo, setPhoto] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [copyNote, setCopyNote] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [handleDraft, setHandleDraft] = useState('');
  const [availability, setAvailability] = useState({ handle: '', verdict: 'idle' });
  const photoInput = useRef(null);
  const copyTimer = useRef(null);
  const handle = profile?.handle || '';
  const initialName = profile?.displayName || accountLabel || '';
  const dirty = displayName.trim() !== initialName || photo !== avatarUrl || claiming;
  const typedHandle = normalizeHandle(handleDraft);

  // Do not erase an unsaved draft when a background profile read completes.
  useEffect(() => {
    if (!open) return;
    setDisplayName(initialName);
    setPhoto(avatarUrl);
    setEditingName(false);
    setNote('');
    setCopyNote('');
    setClaiming(false);
    setHandleDraft('');
  }, [open]);

  useEffect(() => {
    if (!open || !claiming || !typedHandle) return undefined;
    const controller = new AbortController();
    setAvailability({ handle: typedHandle, verdict: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(shellRuntimeUrl(`/api/profiles/lookup?q=${encodeURIComponent(`@${typedHandle}`)}`), {
          headers: await ownerAuthHeaders(ownerId, getAccessToken), cache: 'no-store', signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!controller.signal.aborted) setAvailability({ handle: typedHandle, verdict: claimLookupVerdict(response.status, body) });
      } catch { if (!controller.signal.aborted) setAvailability({ handle: typedHandle, verdict: 'error' }); }
    }, 420);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, claiming, typedHandle, ownerId, getAccessToken]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(copyTimer.current); };
  }, [open, onClose]);

  async function save(event) {
    event.preventDefault();
    if (saving || !dirty) return;
    const name = normalizeDisplayName(displayName);
    if (!name) { setNote('Use a display name between 1 and 64 characters.'); return; }
    if (claiming && (!typedHandle || availability.handle !== typedHandle || availability.verdict !== 'open')) { setNote('Choose an available handle first.'); return; }
    setSaving(true);
    setNote('');
    try {
      const saved = await onSave({ editOnly: !claiming, displayName: name, handle: claiming ? typedHandle : handle, ...(photo !== avatarUrl ? { photo } : {}) });
      if (saved?.ok !== true) throw saved || new Error('profile_save_failed');
      setDisplayName(saved.profile?.displayName || name);
      setEditingName(false);
      setClaiming(false);
      setNote(saved.photoSync === 'failed' ? 'Your name was saved, but the photo could not be saved. Try again.' : 'Profile saved.');
    } catch (error) {
      if (claiming && error?.code === 'handle_taken') setAvailability({ handle: typedHandle, verdict: 'taken' });
      setNote(profileSaveNote(error));
    }
    finally { setSaving(false); }
  }

  async function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) { setNote('Choose an image smaller than 5 MB.'); return; }
    const image = await readAgentImage(file).catch(() => '');
    if (!profilePhoto({ [PROFILE_LOOK_KEY]: { image } })) { setNote('That image could not be used. Try another photo.'); return; }
    setPhoto(image);
    setNote('');
  }

  async function copyHandle() {
    const copied = await copyText(`@${handle}`).catch(() => false);
    setCopyNote(copied ? 'Copied' : 'Copy failed');
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyNote(''), 1600);
  }

  if (!mounted) return null;
  return createPortal(
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <motion.section className="profile-modal" role="dialog" aria-modal="true" aria-label="Profile" onMouseDown={event => event.stopPropagation()}
        initial={leaving ? false : { opacity: 0, y: 36, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
        <ModalClose label="Close profile" onClick={onClose} />
        <form className="profile-identity profile-form" onSubmit={save}>
          <p className="plugin-kicker">Profile</p>
          <div className="agent-photo profile-photo">
            <ProfileMark src={photo} label={displayName || accountLabel} />
            {signedIn ? <>
              <button type="button" className="agent-pencil" aria-label="Change profile photo" disabled={saving} onClick={() => photoInput.current?.click()}><Pencil size={15} /></button>
              <input ref={photoInput} className="agent-file" type="file" accept="image/*" aria-label="Profile photo" tabIndex={-1} disabled={saving} onChange={choosePhoto} />
            </> : null}
          </div>
          <div className="profile-name-row">
            {editingName ? <>
              <input className="profile-name-input" aria-label="Display name" value={displayName} maxLength={64} autoFocus disabled={saving} onChange={event => setDisplayName(event.target.value)} />
              <button type="submit" className="icon-btn" aria-label="Save display name" disabled={saving || !dirty}><Check size={18} /></button>
              <button type="button" className="icon-btn" aria-label="Cancel name edit" disabled={saving} onClick={() => { setDisplayName(initialName); setEditingName(false); setNote(''); }}><X size={17} /></button>
            </> : <>
              <h2><AddressText text={displayName || accountLabel} addresses={[accountAddress]} /></h2>
              {signedIn ? <button type="button" className="icon-btn" aria-label="Edit display name" disabled={saving} onClick={() => setEditingName(true)}><Pencil size={16} /></button> : null}
            </>}
          </div>
          <div className="profile-handle">
            {claiming ? <>
              <label className="profile-claim-input">@<input aria-label="Choose handle" value={handleDraft} maxLength={32} autoFocus disabled={saving} onChange={event => setHandleDraft(event.target.value.replace(/^@+/, ''))} autoComplete="off" spellCheck={false} /></label>
              <button type="button" className="icon-btn" aria-label="Cancel handle claim" disabled={saving} onClick={() => setClaiming(false)}><X size={16} /></button>
            </> : <span>{handle ? `@${handle}` : 'No handle yet'}</span>}
            {handle ? <>
              <LockKeyhole size={13} aria-label="Handle cannot be changed" />
              <button type="button" className={`icon-btn handle-copy${copyNote === 'Copied' ? ' is-copied' : ''}`} aria-label="Copy handle" title="Copy handle" onClick={copyHandle}>{copyNote === 'Copied' ? <Check size={16} /> : <Copy size={16} />}</button>
              <small role="status">{copyNote}</small>
            </> : null}
            {!handle && signedIn && !claiming ? <button type="button" className="ghost profile-claim" onClick={() => { setClaiming(true); setNote(''); }}><Pencil size={13} />Claim handle</button> : null}
          </div>
          {claiming && typedHandle ? <p className="voice-note" role="status">{availability.handle !== typedHandle || availability.verdict === 'checking' ? 'Checking availability…' : availability.verdict === 'open' ? 'Available — your handle cannot be changed once claimed.' : availability.verdict === 'taken' ? 'That handle is taken.' : 'Could not check availability. Try again.'}</p> : null}
          {signedIn && dirty && !editingName ? <button type="submit" className="solid profile-save" disabled={saving || (claiming && (!typedHandle || availability.handle !== typedHandle || availability.verdict !== 'open'))}>{saving ? 'Saving…' : claiming ? 'Claim handle' : 'Save changes'}</button> : null}
          {note ? <p className="voice-note profile-note" role="status">{note}</p> : null}
          {!signedIn ? <button type="button" className="solid" disabled={loginDisabled} onClick={() => onLogin?.()}>Connect</button> : null}
          {signedIn ? connections : null}
        </form>
        <div className="profile-settings">
          <p className="plugin-kicker">Activity</p>
          <AccountStats rows={profileStats({ voiceMs, talks, payments, transfers })} />
          {signedIn ? <button type="button" className="ghost" onClick={onLogout}>Log out</button> : null}
        </div>
      </motion.section>
    </div>, document.body,
  );
}
