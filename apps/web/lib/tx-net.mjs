/**
 * Net token movement for one wallet across a whole Solana transaction.
 * Pre/post balances cancel every inner hop. A four-step swap is one net.
 */

const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;

function add(map, mint, amount) {
  if (!mint || !AMOUNT.test(amount)) return;
  map.set(mint, (map.get(mint) ?? 0n) + BigInt(amount));
}

function balanceAmount(row) {
  const raw = row?.uiTokenAmount?.amount ?? row?.amount;
  return typeof raw === 'string' ? raw : null;
}

function collectBalances(rows, owner) {
  const totals = new Map();
  const decimals = new Map();
  for (const row of rows || []) {
    if (!row || row.owner !== owner) continue;
    const amount = balanceAmount(row);
    add(totals, row.mint, amount);
    const places = row.uiTokenAmount?.decimals ?? row.decimals;
    if (Number.isInteger(places) && places >= 0 && places <= 18) decimals.set(row.mint, places);
  }
  return { totals, decimals };
}

function legsFromMaps(pre, post) {
  const mints = new Set([...pre.totals.keys(), ...post.totals.keys()]);
  const legs = [];
  for (const mint of mints) {
    const delta = (post.totals.get(mint) ?? 0n) - (pre.totals.get(mint) ?? 0n);
    if (delta === 0n) continue;
    const negative = delta < 0n;
    legs.push({
      mint,
      delta: delta.toString(),
      decimals: post.decimals.get(mint) ?? pre.decimals.get(mint) ?? 0,
      direction: negative ? 'out' : 'in',
    });
  }
  legs.sort((a, b) => {
    const left = BigInt(a.delta.startsWith('-') ? a.delta.slice(1) : a.delta);
    const right = BigInt(b.delta.startsWith('-') ? b.delta.slice(1) : b.delta);
    return left === right ? 0 : left > right ? -1 : 1;
  });
  return legs;
}

function walkInstructions(nodes, depth, found) {
  if (!nodes || depth > 8) return;
  const list = Array.isArray(nodes) ? nodes : [nodes];
  for (const node of list) {
    if (!node || typeof node !== 'object') continue;
    const type = node.parsed?.type;
    if (type === 'transfer' || type === 'transferChecked') found.push(node.parsed.info || {});
    walkInstructions(node.instructions, depth + 1, found);
    walkInstructions(node.innerInstructions, depth + 1, found);
  }
}

function legsFromInstructions(owner, instructions, innerInstructions) {
  const found = [];
  walkInstructions(instructions, 0, found);
  for (const group of innerInstructions || []) {
    walkInstructions(group?.instructions || group, 0, found);
  }
  const flows = new Map();
  const decimals = new Map();
  for (const info of found) {
    const mint = info.mint || null;
    const raw = info.tokenAmount?.amount ?? info.amount;
    if (typeof raw !== 'string' || !AMOUNT.test(raw) || raw === '0') continue;
    const places = info.tokenAmount?.decimals;
    if (mint && Number.isInteger(places)) decimals.set(mint, places);
    const amount = BigInt(raw);
    const source = info.authority || info.sourceOwner || null;
    const destination = info.destinationOwner || null;
    if (source === owner && mint) flows.set(mint, (flows.get(mint) ?? 0n) - amount);
    if (destination === owner && mint) flows.set(mint, (flows.get(mint) ?? 0n) + amount);
  }
  const pre = { totals: new Map(), decimals };
  const post = { totals: new Map(), decimals };
  for (const [mint, delta] of flows) {
    if (delta >= 0n) post.totals.set(mint, delta);
    else pre.totals.set(mint, -delta);
  }
  return legsFromMaps(pre, post);
}

/** Net legs for `owner`. Balance meta wins. Otherwise nested transfer instructions are summed. */
export function netTransactionFlows(tx, owner) {
  if (!tx || typeof owner !== 'string' || !owner) return [];
  const meta = tx.meta || tx;
  const pre = collectBalances(meta.preTokenBalances, owner);
  const post = collectBalances(meta.postTokenBalances, owner);
  if (pre.totals.size || post.totals.size) return legsFromMaps(pre, post);
  return legsFromInstructions(owner, tx.transaction?.message?.instructions || tx.instructions, meta.innerInstructions);
}
