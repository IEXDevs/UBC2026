/**
 * Public ids the server already has at request time.
 * The OpenNext client bundle reads `process.env.NEXT_PUBLIC_*` as an empty
 * runtime object, so the logged-out landing has to receive these as props.
 */
export function publicEnv(name, env = process.env) {
  const value = env?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function publicPrivyIds(env = process.env) {
  return {
    appId: publicEnv('NEXT_PUBLIC_PRIVY_APP_ID', env),
    clientId: publicEnv('NEXT_PUBLIC_PRIVY_CLIENT_ID', env),
  };
}
