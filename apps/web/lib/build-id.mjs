import { execFileSync } from 'node:child_process';

const SHA = /^[0-9a-f]{7,40}$/i;

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** Id for this build. A new commit changes it, so an open tab can tell a push apart from the copy it loaded. */
export function resolveBuildId({ env = process.env, head = gitHead } = {}) {
  const sha = typeof head === 'function' ? head() : '';
  if (typeof sha === 'string' && SHA.test(sha.trim())) return sha.trim();
  const fromEnv = typeof env.NEXT_PUBLIC_BUILD_ID === 'string' ? env.NEXT_PUBLIC_BUILD_ID.trim() : '';
  if (fromEnv) return fromEnv;
  return 'dev';
}
