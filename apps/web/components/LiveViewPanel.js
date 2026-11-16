'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { browserErrorNote, browserStatusNote } from '../lib/browser-status.mjs';
import { browserSessionUrl, liveViewFrame, pickOpenSession } from '../lib/live-view.mjs';
import LatticeLoader from './bits/LatticeLoader';

const runtimeBase = 'shell';

async function ownerFetch(url, ownerId, method, body) {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-owner-id': ownerId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : 'browser_request_failed';
    throw new Error(code);
  }
  return data;
}

/**
 * Owner Live View. The viewer URL is a bearer credential: it is an iframe src
 * or a link href, never copied into the timeline or button text.
 * Chat-opened sessions live in the same Worker store — adopt them on load.
 */
export default function LiveViewPanel({ botId, ownerId = null, fill = false, screen = false, autoStart = false, onExpand = null }) {
  const [sessionRecordId, setSessionRecordId] = useState(null);
  const [openCount, setOpenCount] = useState(0);
  const [frame, setFrame] = useState(null);
  const [control, setControl] = useState('agent');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = useRef(null);
  const started = useRef(false);
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
      setSessionRecordId(null);
      setOpenCount(0);
      return null;
    }
    const listed = await ownerFetch(sessionUrl, ownerId, 'GET');
    const sessions = Array.isArray(listed.sessions) ? listed.sessions : [];
    setOpenCount(sessions.length);
    const picked = pickOpenSession(listed);
    if (picked?.sessionRecordId) {
      setSessionRecordId(picked.sessionRecordId);
      return picked.sessionRecordId;
    }
    setSessionRecordId(null);
    return null;
  }, [ownerId, sessionUrl]);

  useEffect(() => {
    let stopped = false;
    (async () => {
      let id = null;
      try {
        if (stopped) return;
        id = await syncSessions();
      } catch {
        /* Listing is best-effort until the owner opens or views. */
      }
      if (stopped || !autoStart || id || started.current) return;
      started.current = true;
      run('open');
    })();
    const timer = setInterval(() => {
      syncSessions().catch(() => {});
    }, 8000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [syncSessions]);

  useEffect(() => {
    if (!sessionRecordId || shown.current === sessionRecordId) return undefined;
    shown.current = sessionRecordId;
    run('view');
    return undefined;
  }, [sessionRecordId]);

  async function run(action) {
    setError('');
    setBusy(true);
    try {
      if (action === 'open') {
        const existing = await syncSessions().catch(() => sessionRecordId);
        if (existing) {
          setSessionRecordId(existing);
          return;
        }
        try {
          const url = browserSessionUrl(runtimeBase, botId);
          const opened = await ownerFetch(url, ownerId, 'POST', { purpose: 'browse' });
          setSessionRecordId(opened.sessionRecordId);
          setOpenCount(current => Math.max(current, 1));
          setFrame(null);
          return;
        } catch (caught) {
          const code = caught instanceof Error ? caught.message : 'browser_request_failed';
          if (code === 'concurrency_limit') {
            const adopted = await syncSessions().catch(() => null);
            if (adopted) {
              setSessionRecordId(adopted);
              return;
            }
          }
          throw caught;
        }
      }
      if (action === 'view' || action === 'owner' || action === 'agent') {
        let id = sessionRecordId;
        if (!id) {
          id = await syncSessions();
        }
        if (!id) throw new Error('session_not_found');
        const next = action === 'view' ? undefined : action;
        const url = browserSessionUrl(runtimeBase, botId, { sessionRecordId: id, action: 'live-view' });
        const view = await ownerFetch(url, ownerId, 'POST', next ? { control: next } : {});
        setSessionRecordId(id);
        setControl(view.control === 'owner' ? 'owner' : 'agent');
        setFrame(liveViewFrame(view));
        return;
      }
      let id = sessionRecordId;
      if (!id) {
        id = await syncSessions();
      }
      if (!id) throw new Error('session_not_found');
      const url = browserSessionUrl(runtimeBase, botId, { sessionRecordId: id, action: 'release' });
      await ownerFetch(url, ownerId, 'POST', {});
      setSessionRecordId(null);
      setOpenCount(0);
      setFrame(null);
      await syncSessions().catch(() => null);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : 'browser_request_failed';
      setError(browserErrorNote(code));
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(ownerId) && Boolean(sessionUrl);
  const driving = control === 'owner';
  const framed = Boolean(frame?.embed && frame.src);

  if (screen) {
    return (
      <div className="live-view is-screen">
        <div className={`computer-screen${framed ? '' : ' is-off'}`}>
          {framed ? (
            <iframe
              className="live-frame"
              title="Browser live view"
              src={frame.src}
              referrerPolicy={frame.referrerPolicy}
            />
          ) : (busy ? <LatticeLoader label="Browser" /> : null)}
          <button
            type="button"
            className="computer-screen-hit"
            aria-label={framed ? 'Watch' : 'Start Browser'}
            disabled={busy}
            onClick={() => {
              if (!framed) run('open');
              onExpand?.();
            }}
          >
            {busy ? null : <span className="computer-screen-label">{framed ? 'Watch' : 'Start Browser'}</span>}
          </button>
          {error ? <p className="preview-note" role="alert">{error}</p> : null}
        </div>
      </div>
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
          />
        ) : frame?.src ? null : (
          <div className="live-row">
            {busy ? <LatticeLoader label="Browser" /> : <p className="live-status">{status}</p>}
            <div className="live-actions">
              <button className="cta" type="button" disabled={!ready || busy || Boolean(sessionRecordId)} onClick={() => run('open')}>
                Open browser session
              </button>
              {sessionRecordId ? (
                <button className="ghost" type="button" disabled={!ready || busy} onClick={() => run('release')}>
                  Release session
                </button>
              ) : null}
            </div>
          </div>
        )}
        {error ? <p className="preview-note" role="alert">{error}</p> : null}
      </div>
      {frame?.src ? (
        <div className="live-dock">
          <span className="live-control-note">{driving ? 'You can interact' : 'Agent has control'}</span>
          <button
            className="cta"
            type="button"
            disabled={!ready || busy}
            onClick={() => run(driving ? 'agent' : 'owner')}
          >
            {driving ? 'Return control' : 'Take control'}
          </button>
          <button className="ghost" type="button" disabled={!ready || busy} onClick={() => run('release')}>
            Release
          </button>
        </div>
      ) : null}
    </div>
  );
}
