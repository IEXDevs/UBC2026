'use client';

import { useState } from 'react';
import { browserErrorNote, browserStatusNote } from '../lib/browser-status.mjs';
import { browserSessionUrl, liveViewFrame } from '../lib/live-view.mjs';
import GlassSurface from './GlassSurface';

const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';

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
 */
export default function LiveViewPanel({ botId, ownerId = null }) {
  const [sessionRecordId, setSessionRecordId] = useState(null);
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sessionUrl = browserSessionUrl(runtimeBase, botId);
  const status = browserStatusNote({ ownerId, runtimeBase, sessionUrl });

  async function run(action) {
    setError('');
    setBusy(true);
    try {
      if (action === 'open') {
        const url = browserSessionUrl(runtimeBase, botId);
        const opened = await ownerFetch(url, ownerId, 'POST', { purpose: 'browse' });
        setSessionRecordId(opened.sessionRecordId);
        setFrame(null);
        return;
      }
      if (action === 'view') {
        const url = browserSessionUrl(runtimeBase, botId, { sessionRecordId, action: 'live-view' });
        const view = await ownerFetch(url, ownerId, 'POST', {});
        setFrame(liveViewFrame(view));
        return;
      }
      const url = browserSessionUrl(runtimeBase, botId, { sessionRecordId, action: 'release' });
      await ownerFetch(url, ownerId, 'POST', {});
      setSessionRecordId(null);
      setFrame(null);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : 'browser_request_failed';
      setError(browserErrorNote(code));
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(ownerId) && Boolean(sessionUrl);

  return (
    <div className="live-view">
      <h3>Live View</h3>
      <p className="preview-note" role="status">{status}</p>
      <div className="live-actions">
        <button className="cta" type="button" disabled={!ready || busy || Boolean(sessionRecordId)} onClick={() => run('open')}>
          Open browser session
        </button>
        <button className="ghost" type="button" disabled={!ready || busy || !sessionRecordId} onClick={() => run('view')}>
          Show live view
        </button>
        <button className="ghost" type="button" disabled={!ready || busy || !sessionRecordId} onClick={() => run('release')}>
          Release session
        </button>
      </div>
      {error ? <p className="preview-note" role="alert">{error}</p> : null}
      {frame?.embed && frame.src && (
        <GlassSurface
          className="live-glass"
          width="100%"
          height={280}
          borderRadius={18}
          borderWidth={0.08}
          brightness={48}
          opacity={0.94}
          blur={10}
          backgroundOpacity={0.18}
          saturation={1.4}
          distortionScale={-36}
        >
          <iframe
            className="live-frame"
            title="Browser live view"
            src={frame.src}
            referrerPolicy={frame.referrerPolicy}
          />
        </GlassSurface>
      )}
      {frame?.src && (
        <a href={frame.src} target="_blank" rel="noopener noreferrer">Open in tab</a>
      )}
    </div>
  );
}
