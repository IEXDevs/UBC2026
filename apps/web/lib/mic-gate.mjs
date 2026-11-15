/**
 * Hard mute for a call's microphone tracks.
 * The voice SDK mute flag can reset. A locked track cannot be turned back on
 * while this gate is muted, including tracks opened later in the same call.
 */

function enabledDescriptor(track) {
  let proto = Object.getPrototypeOf(track);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, 'enabled');
    if (desc?.get && desc?.set) return desc;
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

function lockTrack(track, isMuted) {
  if (!track || track.readyState === 'ended') return;
  if (!track.__maelstromLock) {
    const desc = enabledDescriptor(track);
    if (desc && desc.configurable !== false) {
      try {
        Object.defineProperty(track, 'enabled', {
          configurable: true,
          enumerable: true,
          get() {
            return desc.get.call(track);
          },
          set(value) {
            desc.set.call(track, isMuted() ? false : Boolean(value));
          },
        });
        track.__maelstromLock = desc;
      } catch {
        /* the assignment below still forces the current state */
      }
    }
  }
  track.enabled = !isMuted();
}

function unlockTrack(track) {
  const desc = track?.__maelstromLock;
  if (!desc) return;
  const current = desc.get.call(track);
  try {
    delete track.enabled;
    Object.defineProperty(track, 'enabled', desc);
  } catch {
    /* leave the lock if the platform refuses to restore it */
    return;
  }
  delete track.__maelstromLock;
  track.enabled = current;
}

export function missingMicrophoneError(error) {
  const name = String(error?.name || '');
  return name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError';
}

function browserSilentStream() {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof Ctx !== 'function') {
    throw new Error('No microphone is available.');
  }
  const context = new Ctx();
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0;
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();
  return destination.stream;
}

export function createMicGate({ silentStream = browserSilentStream } = {}) {
  const tracks = new Set();
  let muted = false;
  let generation = 0;
  let original = null;
  let devices = null;

  function isMuted() {
    return muted;
  }

  function hold(stream) {
    const audio = stream?.getAudioTracks?.() ?? [];
    for (const track of audio) {
      tracks.add(track);
      lockTrack(track, isMuted);
      if (typeof track.addEventListener === 'function') {
        track.addEventListener('ended', () => tracks.delete(track), { once: true });
      }
    }
  }

  return {
    get muted() {
      return muted;
    },
    get generation() {
      return generation;
    },
    hold,
    arm(mediaDevices) {
      generation += 1;
      if (original || !mediaDevices?.getUserMedia) return generation;
      const raw = mediaDevices.getUserMedia;
      const native = raw.bind(mediaDevices);
      const wrapped = (constraints) => Promise.resolve()
        .then(() => native(constraints))
        .catch((error) => {
          if (!missingMicrophoneError(error)) throw error;
          return silentStream();
        })
        .then((stream) => {
          hold(stream);
          return stream;
        });
      try {
        mediaDevices.getUserMedia = wrapped;
        original = raw;
        devices = mediaDevices;
      } catch {
        original = null;
        devices = null;
      }
      return generation;
    },
    disarm(generationAtClose = generation) {
      if (generationAtClose !== generation) return;
      if (devices && original) {
        try {
          devices.getUserMedia = original;
        } catch {
          /* the page keeps the wrapper until the next successful arm */
        }
      }
      original = null;
      devices = null;
      for (const track of tracks) unlockTrack(track);
      tracks.clear();
    },
    stop() {
      for (const track of tracks) {
        try {
          track.stop?.();
        } catch {
          /* the track is already gone */
        }
      }
    },
    setMuted(next) {
      muted = Boolean(next);
      for (const track of tracks) {
        if (track.readyState === 'ended') tracks.delete(track);
        else lockTrack(track, isMuted);
      }
      return muted;
    },
    enforce() {
      for (const track of [...tracks]) {
        if (track.readyState === 'ended') tracks.delete(track);
        else lockTrack(track, isMuted);
      }
    },
  };
}
