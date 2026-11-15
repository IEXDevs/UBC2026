const COMMAND = /^send\s+(\d+(?:\.\d{1,6})?)\s*(?:usdc\s+)?to\s+@([a-z0-9][a-z0-9_]{1,31})$/i;

function baseUnits(display) {
  const [whole, fraction = ''] = display.split('.');
  if (!/^(0|[1-9][0-9]*)$/.test(whole)) return null;
  const padded = `${fraction}000000`.slice(0, 6);
  const units = (BigInt(whole) * 1000000n) + BigInt(padded);
  if (units <= 0n || units > 9999999999999999999999999999999999999999n) return null;
  return units.toString();
}

/** "send 5 USDC to @bob" becomes a platform transfer command. */
export function parsePlatformSend(text) {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(COMMAND);
  if (!match) return null;
  const amount = baseUnits(match[1]);
  if (!amount) return null;
  const handle = match[2].toLowerCase();
  return {
    handle,
    amount,
    idempotencyKey: `send_${handle}_${amount}`,
  };
}

export function platformBalance(transfers) {
  let net = 0n;
  for (const row of transfers) {
    if (!row || row.asset !== 'USDC') continue;
    if (typeof row.amount !== 'string' || !/^[1-9][0-9]{0,39}$/.test(row.amount)) continue;
    const units = BigInt(row.amount);
    net += row.direction === 'in' ? units : -units;
  }
  return net.toString();
}
