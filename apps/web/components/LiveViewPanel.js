'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { browserErrorNote, browserStatusNote } from '../lib/browser-status.mjs';
import { browserSessionUrl, liveViewFrame, liveSessionKey, reconcileLiveSession } from '../lib/live-view.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import LatticeLoader from './bits/LatticeLoader';
import HoldButton from './HoldButton';

const runtimeBase = 'shell';

async function ownerFetch(url, ownerId, getAccessToken, method, body) {
  const response = await fetch(url, {
    method,
    headers: await ownerAuthHeaders(ownerId, getAccessToken, {
      'content-type': 'application/json',
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : 'browser_request_failed';
    const error = new Error(code);
    error.providerStatus = data.providerStatus;
    error.providerReason = data.providerReason;
    throw error;
  }
  return data;
}

/**
 * Owner Live View. The viewer URL is a bearer credential: it is an iframe src
 * or a link href, never copied into the timeline or button text.
 * Chat-opened sessions live in the same Worker store — adopt them on load.
 */
export default function LiveViewPanel({
  botId,
  ownerId = null,
  getAccessToken = null,
  fill = false,
  screen = false,
  autoStart = false,
  onExpand = null,
}) {
  const [session, setSession] = useState(null);
  const sessionRecordId = session?.id;
  const sessionKey = liveSessionKey(session);
  const frame = session?.frame;
  const [openCount, setOpenCount] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = useRef(null);
  const started = useRef(false);
  const inFlight = useRef(false);
  const refreshAt = useRef(0);
  const resumeUrl = useRef(null);
  const activeSession = useRef(session);
  activeSession.current = session;
  const sessionUrl = browserSessionUrl(runtimeBase, botId);
  const status = browserStatusNote({
    ownerId,
    runtimeBase,
    sessionUrl,
    sessionRecordId,
    openCount,
  });

  const syncSessions = useCallback(async () => {
    if (!ownerId || !sessionUrl) {
      setSession(null);
      setOpenCount(0);
      return null;
    }
    const listed = await ownerFetch(sessionUrl, ownerId, getAccessToken, 'GET');
    const sessions = Array.isArray(listed.sessions) ? listed.sessions : [];
    setOpenCount(sessions.length);
    const next = reconcileLiveSession(null, listed);
    const id = next?.id ?? null;
    const row = sessions.find(item => item.sessionRecordId === id);
    if (typeof row?.url === 'string') resumeUrl.current = row.url;
    setSession(current => reconcileLiveSession(current, listed));
    return id;
  }, [ownerId, sessionUrl, getAccessToken]);

  useEffect(() => {
    let stopped = false;
    async function sync() {
      let id = null;
      try {
        if (stopped) return;
        id = await syncSessions();
      } catch (caught) {
        if (!stopped) {
          const code = caught instanceof Error ? caught.message : 'browser_request_failed';
          setError(browserErrorNote(code, caught?.providerStatus, caught?.providerReason));
        }
        return;
      }
      if (stopped) return;
      if (id) {
        if (activeSession.current?.id === id && (!activeSession.current.frame || Date.now() >= refreshAt.current)) run('view');
        return;
      }
      if (!autoStart || started.current) return;
      started.current = true;
      run('open');
    }
    sync();
    const timer = setInterval(sync, 8000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [syncSessions, sessionKey]);

  useEffect(() => {
    if (shown.current === sessionKey) return;
    shown.current = sessionKey;
    if (sessionRecordId) run('view');
  }, [sessionKey]);

  async function run(action) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError('');
    setBusy(true);
    try {
      if (action === 'open') {
        const existing = await syncSessions();
        if (existing) return;
        try {
          const url = browserSessionUrl(runtimeBase, botId);
          const opened = await ownerFetch(url, ownerId, getAccessToken, 'POST', {
            purpose: 'browse',
            ...(resumeUrl.current ? { url: resumeUrl.current } : {}),
          });
          setSession({ id: opened.sessionRecordId, revision: 0 });
          setOpenCount(current => Math.max(current, 1));
          return;
        } catch (caught) {
          const code = caught instanceof Error ? caught.message : 'browser_request_failed';
          if (code === 'concurrency_limit') {
            const adopted = await syncSessions().catch(() => null);
            if (adopted) return;
          }
          throw caught;
        }
      }
      if (action === 'view' || action === 'owner' || action === 'agent') {
        const viewingKey = liveSessionKey(activeSession.current);
        let id = activeSession.current?.id;
        if (!id) {
          id = await syncSessions();
        }
        if (!id) throw new Error('session_not_found');
        const next = action === 'view' ? undefined : action;
        const url = browserSessionUrl(runtimeBase, botId, { sessionRecordId: id, action: 'live-view' });
        const view = await ownerFetch(url, ownerId, getAccessToken, 'POST', next ? { control: next } : {});
        const nextFrame = liveViewFrame(view);
        if (!nextFrame.src) throw new Error('invalid_provider_response');
        refreshAt.current = Date.now() + 60_000;
        setSession(current => current?.id === id && liveSessionKey(current) === viewingKey
          ? { ...current, frame: nextFrame, control: view.control }
          : current);
        return;
      }
      let id = sessionRecordId;
      if (!id) {
        id = await syncSessions();
      }
      if (!id) throw new Error('session_not_found');
      const url = browserSessionUrl(runtimeBase, botId, { sessionRecordId: id, action: 'release' });
      await ownerFetch(url, ownerId, getAccessToken, 'POST', {});
      started.current = true;
      resumeUrl.current = null;
      setSession(current => current?.id === id ? null : current);
      setOpenCount(0);
      await syncSessions().catch(() => null);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : 'browser_request_failed';
      if (code === 'browser_session_expired') {
        setSession(null);
        setOpenCount(0);
        shown.current = null;
        started.current = false;
      }
      refreshAt.current = Date.now() + 60_000;
      setError(browserErrorNote(code, caught?.providerStatus, caught?.providerReason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const ready = Boolean(ownerId) && Boolean(sessionUrl);
  const driving = session?.control === 'owner';
  const framed = Boolean(frame?.embed && frame.src);

  if (screen) {
    return (
      <section className="side-computer" aria-label="Computer">
        <h3>Computer</h3>
        <div className="live-view is-screen">
          <div className={`computer-screen${framed ? '' : ' is-off'}`}>
            {framed ? (
              <iframe
                className="live-frame"
                title="Browser live view"
                src={frame.src}
                referrerPolicy={frame.referrerPolicy}
                onError={() => setError(browserErrorNote('browser_viewer_failed'))}
              />
            ) : (busy ? <LatticeLoader label="Browser" /> : null)}
            <button
              type="button"
              className="computer-screen-hit"
              aria-label={framed ? 'Watch' : 'Open Computer'}
              disabled={busy}
              onClick={onExpand}
            >
              {busy ? null : <span className="computer-screen-label">{framed ? 'Watch' : 'Open Computer'}</span>}
            </button>
            {error ? <p className="preview-note" role="alert">{error}</p> : (!sessionRecordId && !busy ? <p className="preview-note">{status}</p> : null)}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={`live-view${fill ? ' is-fill' : ''}`}>
      <div className="live-stage">
        {framed ? (
          <iframe
            className="live-frame"
            title="Browser live view"
            src={frame.src}
            referrerPolicy={frame.referrerPolicy}
            onError={() => setError(browserErrorNote('browser_viewer_failed'))}
          />
        ) : null}
        {frame?.src ? (
          error ? <p className="preview-note" role="alert">{error}</p> : null
        ) : (
          <>
            <div className="live-idle">
              {busy ? <LatticeLoader label="Browser" /> : <p className="live-status">{status}</p>}
            </div>
            <div className="live-idle-bar">
              {error ? <p className="preview-note" role="alert">{error}</p> : null}
              <div className="live-idle-actions">
                <button className="live-chip" type="button" disabled={!ready || busy || Boolean(sessionRecordId)} onClick={() => run('open')}>
                  Open browser session
                </button>
                {sessionRecordId ? (
                  <button className="live-chip" type="button" disabled={!ready || busy} onClick={() => run('release')}>
                    Release session
                  </button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
      {frame?.src ? (
        <div className="live-dock">
          <button
            className="cta"
            type="button"
            disabled={!ready || busy}
            onClick={() => run(driving ? 'agent' : 'owner')}
          >
            {driving ? 'Return control' : 'Take control'}
          </button>
          <HoldButton
            className="live-stop"
            doneLabel="Stopped"
            backgroundColor="#3a1414"
            fillColor="#e24b4b"
            textColor="#fecaca"
            fillTextColor="#ffffff"
            size="md"
            radius={999}
            holdTime={800}
            disabled={!ready}
            onHold={() => run('release')}
          >
            Force stop
          </HoldButton>
        </div>
      ) : null}
    </div>
  );
}
