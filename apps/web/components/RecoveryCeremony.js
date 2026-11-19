'use client';

import { useEffect, useMemo, useState } from 'react';
import AddressCopy from './AddressCopy';
import SlideCommit from './bits/SlideCommit';
import SecretDraft from './SecretDraft';
import { secretAcceptAllowed } from '../lib/secret-generate.mjs';
import {
  createRecoveryPhrase,
  normalizePassphrase,
  phraseComplete,
  recoveryCard,
  shuffledPhrase,
  verifyRecoveryPhrase,
} from '../lib/wallet-desk.mjs';

function downloadRecoveryCard(text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'maelstrom-recovery.txt';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RecoveryCeremony({ wallets = [], handle = '', onDone }) {
  const [words, setWords] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [retype, setRetype] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState('');
  const [step, setStep] = useState('pass');
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slideReset, setSlideReset] = useState(0);
  const joined = words ? words.join(' ') : '';
  const bank = useMemo(() => (joined ? shuffledPhrase(joined) : []), [joined]);
  const phraseReady = words ? phraseComplete(picked, words.length) : false;
  const passReady = normalizePassphrase(retype) === passphrase && passphrase.length > 0;

  function makePhrase() {
    createRecoveryPhrase()
      .then(phrase => { setWords(phrase); setNote(''); })
      .catch(() => { setNote('This browser could not create a recovery phrase. Reload and try again.'); });
  }

  useEffect(() => {
    makePhrase();
  }, []);

  function download() {
    if (!words || !revealed) {
      setNote('Show the phrase, then download it.');
      return;
    }
    try {
      downloadRecoveryCard(recoveryCard({
        words,
        passphrase,
        wallets,
        handle,
        at: new Date().toISOString(),
      }));
      setDownloaded(true);
      setNote('Downloaded. Keep that file offline.');
    } catch {
      setNote('Download failed. Show the phrase and copy it by hand, then try again.');
    }
  }

  function pick(index) {
    if (picked.includes(index)) return;
    if (index !== picked.length) {
      setNote('That is not the next word.');
      return;
    }
    const next = [...picked, index];
    setPicked(next);
    setNote(phraseComplete(next, words.length) ? 'Phrase confirmed.' : '');
  }

  function finish() {
    verifyRecoveryPhrase(words).then(valid => {
      if (!valid || !passReady) {
        setNote('The phrase did not check out. Download a new copy and try again.');
        setSlideReset(value => value + 1);
        return;
      }
      let saved = false;
      try {
        saved = onDone?.() === true;
      } catch {
        saved = false;
      }
      if (!saved) {
        setNote('Could not save that you finished. Allow storage for this site and try the slider again.');
        setSlideReset(value => value + 1);
        return;
      }
      setWords(null);
      setPassphrase('');
      setAgain('');
      setRetype('');
    }).catch(() => {
      setNote('The phrase did not check out.');
      setSlideReset(value => value + 1);
    });
  }

  return (
    <div className="backdrop is-center">
      <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <h2 id="recovery-title">Save your recovery phrase</h2>
        <p className="quiet">
          This 12-word phrase and passphrase are created in your browser. Download them before the wallet opens.
          Maelstrom does not keep a copy. Privy still signs these wallets.
        </p>
        <ul className="recovery-wallets">
          {wallets.map(wallet => (
            <li key={wallet.id || wallet.address}>
              <span>{wallet.label || 'Wallet'}</span>
              <AddressCopy address={wallet.address} />
            </li>
          ))}
        </ul>
        {step === 'pass' ? (
          <form
            className="field"
            onSubmit={(event) => {
              event.preventDefault();
              const left = normalizePassphrase(passphrase);
              if (!left || left !== again) {
                setNote('Use the same passphrase, 8 to 64 characters.');
                return;
              }
              if (!secretAcceptAllowed({ generated, copied })) {
                setNote('Copy the generated passphrase before you continue.');
                return;
              }
              if (!words) {
                setNote('Wait for the recovery phrase, or tap Retry.');
                return;
              }
              setPassphrase(left);
              setNote('');
              setStep('save');
            }}
          >
            <SecretDraft
              kind="passphrase"
              label="Passphrase"
              name="recovery-passphrase"
              value={passphrase}
              generated={generated}
              copied={copied}
              onValue={setPassphrase}
              onFill={(next) => {
                setPassphrase(next);
                setAgain(next);
              }}
              onGenerated={setGenerated}
              onCopied={setCopied}
            />
            <label>
              Confirm passphrase
              <input type="password" value={again} autoComplete="new-password" onChange={event => setAgain(event.target.value)} />
            </label>
            {!words ? (
              <button type="button" className="ghost" onClick={makePhrase}>Retry phrase</button>
            ) : null}
            <button type="submit" className="solid" disabled={!words || !secretAcceptAllowed({ generated, copied })}>Continue</button>
          </form>
        ) : null}
        {step === 'save' ? (
          <>
            <ol className={`phrase-grid${revealed ? '' : ' is-hidden'}`} aria-hidden={revealed ? undefined : true}>
              {(words || []).map((word, index) => (
                <li key={`${word}-${index}`}>
                  <span>{index + 1}</span>
                  <b>{word}</b>
                </li>
              ))}
            </ol>
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={() => { setRevealed(true); setDownloaded(false); setNote('Download the phrase before you continue.'); }}>Show phrase</button>
              <button type="button" className="ghost" onClick={download} disabled={!revealed}>Download</button>
              <button
                type="button"
                className="solid"
                disabled={!revealed || !downloaded}
                onClick={() => { setPicked([]); setRetype(''); setNote(''); setStep('confirm'); }}
              >
                I saved it
              </button>
            </div>
          </>
        ) : null}
        {step === 'confirm' && words ? (
          <>
            <p className="quiet">Tap the words in order, then type the passphrase again.</p>
            <div className="phrase-built" aria-live="polite">
              {picked.map((index, position) => (
                <span key={`${index}-${position}`}>{words[index]}</span>
              ))}
            </div>
            <div className="phrase-pick">
              {bank.map(item => (
                <button
                  key={item.index}
                  type="button"
                  className={picked.includes(item.index) ? 'is-used' : ''}
                  disabled={picked.includes(item.index)}
                  onClick={() => pick(item.index)}
                >
                  {item.word}
                </button>
              ))}
            </div>
            <button type="button" className="ghost" onClick={() => setPicked(current => current.slice(0, -1))}>Undo</button>
            <label className="field">
              Passphrase
              <input type="password" value={retype} autoComplete="new-password" onChange={event => setRetype(event.target.value)} />
            </label>
            <SlideCommit
              label="Slide to finish"
              doneLabel="Saved"
              disabled={!phraseReady || !passReady}
              resetKey={`${slideReset}:${picked.join('-')}`}
              onCommit={finish}
            />
          </>
        ) : null}
        {note ? <p className="quiet" role="status">{note}</p> : null}
      </section>
    </div>
  );
}
