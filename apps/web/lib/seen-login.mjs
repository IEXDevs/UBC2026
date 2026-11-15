export const SEEN_LOGIN_KEY = 'maelstrom.seenLogin';

export function hasSeenLogin(storage) {
  try {
    return storage?.getItem(SEEN_LOGIN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSeenLogin(storage) {
  try {
    storage?.setItem(SEEN_LOGIN_KEY, '1');
  } catch {
    /* Private mode can reject storage writes. */
  }
}
