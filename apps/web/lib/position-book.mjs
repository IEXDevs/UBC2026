/** Places live positions on an open plane, one cluster per venue. */

import { describePositions, formatAmount, formatBaseUnits, shortAddress } from './money-views.mjs';
import { withAssignedWallet } from './wallet-assign.mjs';

export const VENUE_LOGOS = Object.freeze({
  Kamino: '/venues/kamino.webp',
  Jupiter: '/venues/jupiter.webp',
  Drift: '/venues/drift.webp',
  Meteora: '/venues/meteora.webp',
  Marginfi: '/venues/marginfi.webp',
});

function addMicro(rows, key) {
  let sum = 0n;
  for (const row of rows) {
    const value = row[key];
    if (typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value)) sum += BigInt(value);
  }
  return sum;
}

function walletFor(position, bots) {
  if (typeof position.walletId === 'string' && position.walletId) return position.walletId;
  return bots.find(bot => bot.id === position.botId)?.walletId ?? null;
}

function holdingUsd(value) {
  if (value > 0n && value < 10000n) return '<$0.01';
  return `$${formatAmount((value / 10000n).toString(), 2)}`;
}

function walletBubbles(rows, width, height) {
  const circles = rows.filter(row => row.notionalMicroUsdc != null && BigInt(row.notionalMicroUsdc) > 0n)
    .map(row => ({
      id: row.id ?? row.asset,
      asset: row.asset,
      value: BigInt(row.notionalMicroUsdc),
      amountLabel: typeof row.amount === 'string' && Number.isInteger(row.decimals)
        ? `${formatAmount(row.amount, row.decimals)} ${row.asset}`
        : '',
    }))
    .sort((left, right) => left.value === right.value ? 0 : left.value > right.value ? -1 : 1);
  if (!circles.length) return [];
  const maximum = Number(circles[0].value);
  const largest = circles.slice(0, 11);
  if (circles.length > largest.length) {
    const rest = circles.slice(largest.length);
    const value = rest.reduce((sum, circle) => sum + circle.value, 0n);
    largest.push({ id: 'other', asset: 'Other', value, amountLabel: `${rest.length} ${rest.length === 1 ? 'asset' : 'assets'}` });
  }
  const gap = 3;
  const inset = 2;
  const lines = Array.from({ length: largest.length > 2 ? 2 : 1 }, () => ({ sum: 0, tallest: 0, circles: [] }));
  for (const circle of largest) {
    const radius = Math.sqrt(Number(circle.value) / maximum);
    const line = lines.length === 2 && lines[1].sum < lines[0].sum ? lines[1] : lines[0];
    line.sum += radius * 2;
    line.tallest = Math.max(line.tallest, radius * 2);
    line.circles.push({ ...circle, radius });
  }
  const bubbleHeight = lines.reduce((sum, line) => sum + line.tallest, 0);
  const scale = Math.min((height - inset * 2 - gap * (lines.length - 1)) / bubbleHeight,
    ...lines.map(line => (width - inset * 2 - gap * Math.max(0, line.circles.length - 1)) / line.sum));
  if (scale <= 0) return [];
  let y = (height - bubbleHeight * scale - gap * (lines.length - 1)) / 2;
  return lines.flatMap(line => {
    let x = (width - line.sum * scale - gap * (line.circles.length - 1)) / 2;
    const centerY = y + line.tallest * scale / 2;
    y += line.tallest * scale + gap;
    return line.circles.map(circle => {
      const r = circle.radius * scale;
      const bubble = {
        id: circle.id, asset: circle.asset, valueLabel: holdingUsd(circle.value), amountLabel: circle.amountLabel,
        x: x + r, y: centerY, r,
      };
      x += 2 * r + gap;
      return bubble;
    });
  });
}

export function positionSceneKey(book) {
  const geometry = item => [item.id, item.x, item.y, item.width, item.height, item.walletId];
  return JSON.stringify([
    book.wallets.map(geometry), book.agents.map(geometry), book.accounts.map(geometry),
    book.cards.map(geometry), book.venues, book.links,
  ]);
}

const AGENT_HEIGHT = 36;
const AGENT_GAP = 14;
const AGENT_RAIL = 16;
const WALLET_GAP = 28;

function arrangeAgents(bots, measureName) {
  const nodes = bots.map(bot => {
    const name = typeof bot.name === 'string' ? bot.name.trim().replace(/\s+/g, ' ') : '';
    const text = name || 'Agent';
    const labelWidth = measureName?.(text) ?? Array.from(text).length * 12;
    return { ...bot, name: text, width: Math.max(56, Math.ceil(labelWidth) + 50), height: AGENT_HEIGHT };
  });
  if (nodes.length <= 3) {
    const width = nodes.reduce((sum, node) => sum + node.width, 0) + Math.max(0, nodes.length - 1) * AGENT_GAP;
    let left = -width / 2;
    for (const node of nodes) {
      Object.assign(node, { x: left + node.width / 2, y: 28 + node.height / 2, attach: 'bottom' });
      left += node.width + AGENT_GAP;
    }
    return { nodes, width };
  }

  const width = 2 * (AGENT_RAIL + Math.max(...nodes.map(node => node.width)));
  nodes.forEach((node, index) => {
    const right = index % 2 === 1;
    const offset = AGENT_RAIL + node.width / 2;
    Object.assign(node, {
      x: right ? offset : -offset,
      y: 26 + node.height / 2 + Math.floor(index / 2) * (node.height + AGENT_GAP),
      attach: right ? 'left' : 'right',
    });
  });
  return { nodes, width };
}

/** Shared branches run through the gaps between the wallet and its agent cards. */
export function agentWireSegments(links) {
  if (links.length === 0) return [];
  const [{ from, to, attach }] = links;
  if (attach !== 'bottom') {
    return [
      [from, { x: from.x, y: Math.max(...links.map(link => link.to.y)) }],
      ...links.map(link => [{ x: from.x, y: link.to.y }, link.to]),
    ];
  }
  if (links.length === 1) return [[from, to]];
  const y = (from.y + to.y) / 2;
  return [
    [from, { x: from.x, y }],
    [{ x: to.x, y }, { x: links.at(-1).to.x, y }],
    ...links.map(link => [{ x: link.to.x, y }, link.to]),
  ];
}

export function walletGroupBounds(wallet, agents) {
  const bounds = { minX: -wallet.width / 2, maxX: wallet.width / 2, minY: -wallet.height / 2, maxY: wallet.height / 2 };
  for (const agent of agents) {
    bounds.minX = Math.min(bounds.minX, agent.x - wallet.x - agent.width / 2);
    bounds.maxX = Math.max(bounds.maxX, agent.x - wallet.x + agent.width / 2);
    bounds.maxY = Math.max(bounds.maxY, agent.y - wallet.y + agent.height / 2);
  }
  return bounds;
}

export function translatedBounds(bounds, { x, y }) {
  return { minX: bounds.minX + x, maxX: bounds.maxX + x, minY: bounds.minY + y, maxY: bounds.maxY + y };
}

export function placeWalletGroup(bounds, requested, occupied) {
  const fits = ({ x, y }) => occupied.every(other => (
    x <= other.minX - WALLET_GAP - bounds.maxX || x >= other.maxX + WALLET_GAP - bounds.minX
    || y <= other.minY - WALLET_GAP - bounds.maxY || y >= other.maxY + WALLET_GAP - bounds.minY
  ));
  if (fits(requested)) return requested;

  const candidates = occupied.flatMap(other => [
    { x: other.minX - WALLET_GAP - bounds.maxX, y: requested.y },
    { x: other.maxX + WALLET_GAP - bounds.minX, y: requested.y },
    { x: requested.x, y: other.minY - WALLET_GAP - bounds.maxY },
    { x: requested.x, y: other.maxY + WALLET_GAP - bounds.minY },
  ]);
  let nearest = requested;
  let distance = Infinity;
  for (const point of candidates) {
    const delta = Math.abs(point.x - requested.x) + Math.abs(point.y - requested.y);
    if (delta >= distance || !fits(point)) continue;
    distance = delta;
    nearest = point;
  }
  return nearest;
}

export function layoutPositionBook(positions, bots, wallets = [], holdings = [], measureName) {
  const source = Array.isArray(positions) ? positions : [];
  const assignedBots = withAssignedWallet(bots, wallets).bots;
  const rows = describePositions(source, assignedBots).map((row, index) => ({
    ...row,
    walletId: walletFor(source[index], assignedBots),
    mint: typeof source[index].mint === 'string' ? source[index].mint : null,
  }));
  const cards = [];
  const venues = [];
  const links = [];
  const walletNodes = [];
  const agents = [];
  const accounts = [];
  const LEAF = 236;
  const BRANCH = 28;
  const WALLET_SPAN = 240;
  const agentsByWallet = new Map(wallets.map(wallet => [wallet.id, []]));
  for (const bot of assignedBots) agentsByWallet.get(bot.walletId)?.push(bot);
  const holdingsByWallet = new Map(wallets.map(wallet => [wallet.id, []]));
  for (const row of holdings) holdingsByWallet.get(row.walletId)?.push(row);
  const totals = new Map([...holdingsByWallet].map(([id, rows]) => [id, addMicro(rows, 'notionalMicroUsdc')]));
  const maximum = Math.max(1, ...[...totals.values()].map(Number));
  let cursor = 0;
  wallets.forEach(wallet => {
    const owned = rows.filter(row => row.walletId === wallet.id);
    const venueNames = [...new Set(owned.map(row => row.venue))];
    const branches = venueNames.map(name => {
      const leaves = owned.filter(row => row.venue === name);
      const width = leaves.length ? (leaves.length - 1) * LEAF + 220 : 160;
      return { name, leaves, width };
    });
    const total = branches.reduce((sum, branch) => sum + branch.width, 0) + Math.max(0, branches.length - 1) * BRANCH;
    const assigned = arrangeAgents(agentsByWallet.get(wallet.id), measureName);
    const span = Math.max(total, WALLET_SPAN, assigned.width);
    const rootX = cursor + span / 2;
    const rootY = 220;
    const walletHoldings = holdingsByWallet.get(wallet.id);
    const holdingTotal = totals.get(wallet.id);
    const scale = Math.sqrt(Number(holdingTotal) / maximum);
    const width = Math.round(146 + 86 * scale);
    const height = Math.round(90 + 54 * scale);
    const unpriced = walletHoldings.filter(row => row.notionalMicroUsdc == null).length;
    const bubbleWidth = width - 20;
    const bubbleHeight = height - 62;
    walletNodes.push({
      id: wallet.id,
      kind: 'wallet',
      label: wallet.label,
      accountKind: wallet.kind,
      address: shortAddress(wallet.address),
      fullAddress: wallet.address,
      frozen: wallet.frozen === true,
      readOnly: wallet.readOnly === true,
      x: rootX,
      y: rootY,
      width,
      height,
      bubbleWidth,
      bubbleHeight,
      bubbles: walletBubbles(walletHoldings, bubbleWidth, bubbleHeight),
      unpriced,
      holdingsLabel: unpriced > 0 && unpriced === walletHoldings.length ? 'Unpriced' : holdingUsd(holdingTotal),
      venues: venueNames,
      notionalLabel: `${formatBaseUnits(addMicro(owned, 'notionalMicroUsdc').toString())} USDC`,
      count: owned.length,
    });
    for (const bot of assigned.nodes) {
      const agent = {
        ...bot,
        id: `agent:${bot.id}`,
        walletId: wallet.id,
        x: rootX + bot.x,
        y: rootY + height / 2 + bot.y,
      };
      agents.push(agent);
      const to = bot.attach === 'bottom'
        ? { x: agent.x, y: agent.y - agent.height / 2 }
        : { x: agent.x + (bot.attach === 'right' ? agent.width / 2 : -agent.width / 2), y: agent.y };
      links.push({
        id: `${wallet.id}-${agent.id}`,
        fromId: wallet.id,
        toId: agent.id,
        walletId: wallet.id,
        kind: 'agent',
        attach: bot.attach,
        from: { x: rootX, y: rootY + height / 2 },
        to,
      });
    }
    let branchX = cursor + (span - total) / 2;
    branches.forEach(branch => {
      const center = branchX + branch.width / 2;
      const accountId = `${wallet.id}_${branch.name}`;
      const account = {
        id: accountId,
        kind: 'account',
        walletId: wallet.id,
        venue: branch.name,
        logo: VENUE_LOGOS[branch.name] ?? null,
        x: center,
        y: rootY - 118,
        count: branch.leaves.length,
      };
      accounts.push(account);
      links.push({
        id: `${wallet.id}-${accountId}`,
        fromId: wallet.id,
        toId: accountId,
        kind: 'account',
        walletId: wallet.id,
        from: { x: rootX, y: rootY },
        to: { x: account.x, y: account.y },
        lift: 0,
      });
      branch.leaves.forEach((row, slot) => {
        const x = center + (slot - (branch.leaves.length - 1) / 2) * LEAF;
        const y = account.y - 210;
        cards.push({ ...row, logo: account.logo, x, y });
        links.push({
          id: `${accountId}-${row.id}`,
          fromId: accountId,
          toId: row.id,
          cardId: row.id,
          walletId: wallet.id,
          kind: 'spoke',
          from: { x: account.x, y: account.y },
          to: { x, y: y + 88 },
          lift: 0,
        });
      });
      branchX += branch.width + BRANCH;
    });
    cursor += span + 96;
  });

  for (let left = 0; left < walletNodes.length; left += 1) {
    for (let right = left + 1; right < walletNodes.length; right += 1) {
      const shared = walletNodes[left].venues.filter(name => walletNodes[right].venues.includes(name));
      if (!shared.length) continue;
      links.push({
        id: `${walletNodes[left].id}-${walletNodes[right].id}`,
        fromId: walletNodes[left].id,
        toId: walletNodes[right].id,
        kind: 'shared',
        walletIds: [walletNodes[left].id, walletNodes[right].id],
        venues: shared,
        from: { x: walletNodes[left].x, y: walletNodes[left].y },
        to: { x: walletNodes[right].x, y: walletNodes[right].y },
        lift: 70,
      });
    }
  }

  const webs = walletNodes.map(wallet => {
    const nodes = new Set([wallet.id]);
    const linkIds = new Set();
    for (const account of accounts) {
      if (account.walletId === wallet.id) nodes.add(account.id);
    }
    for (const card of cards) {
      if (card.walletId === wallet.id) nodes.add(card.id);
    }
    for (const agent of agents) {
      if (agent.walletId === wallet.id) nodes.add(agent.id);
    }
    for (const link of links) {
      const owns = link.walletId === wallet.id || (link.walletIds ?? []).includes(wallet.id);
      if (!owns) continue;
      linkIds.add(link.id);
      if (link.kind === 'shared') {
        for (const id of link.walletIds) nodes.add(id);
      }
      if (link.kind === 'spoke' && link.walletId === wallet.id) linkIds.add(link.id);
    }
    for (const link of links) {
      if (link.kind === 'spoke' && link.walletId === wallet.id) linkIds.add(link.id);
    }
    return { id: wallet.id, nodes: [...nodes], links: [...linkIds] };
  });
  const pnl = addMicro(rows, 'pnlMicroUsdc');
  const notional = addMicro(rows, 'notionalMicroUsdc');
  return {
    cards,
    venues,
    wallets: walletNodes,
    agents,
    accounts,
    links,
    webs,
    summary: {
      count: rows.length,
      venues: new Set(rows.map(row => row.venue)).size,
      pnlLabel: rows.some(row => row.pnlMicroUsdc != null) ? `${formatBaseUnits(pnl.toString())} USDC` : null,
      notionalLabel: `${formatBaseUnits(notional.toString())} USDC`,
    },
  };
}

export function bookFrame(book, position = item => item) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const add = (item, halfX, halfY) => {
    const { x, y } = position(item);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x - halfX);
    maxX = Math.max(maxX, x + halfX);
    minY = Math.min(minY, y - halfY);
    maxY = Math.max(maxY, y + halfY);
  };
  for (const card of book.cards ?? []) add(card, 130, 110);
  for (const venue of book.venues ?? []) add(venue, 90, 36);
  for (const wallet of book.wallets ?? []) add(wallet, wallet.width / 2, wallet.height / 2);
  for (const agent of book.agents ?? []) add(agent, agent.width / 2, agent.height / 2);
  for (const account of book.accounts ?? []) add(account, 80, 30);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, minX: -200, maxX: 200, minY: -200, maxY: 200 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, minX, maxX, minY, maxY };
}

/** Slide linked nodes after a pinned one. Farther nodes use a longer follow, so they trail. */
export function stepBubbleFollow(nodes, dtMs) {
  const dt = Math.min(34, Math.max(0, Number(dtMs) || 0));
  const pinned = nodes?.find(node => node.pin);
  if (!dt || !pinned) return 0;
  let remain = 0;
  for (const node of nodes) {
    if (node.pin || node.lag == null) continue;
    const tau = 110 + node.lag * 150;
    const k = 1 - Math.exp(-dt / tau);
    const tx = pinned.x + (node.ox || 0);
    const ty = pinned.y + (node.oy || 0);
    node.x += (tx - node.x) * k;
    node.y += (ty - node.y) * k;
    remain = Math.max(remain, Math.hypot(tx - node.x, ty - node.y));
  }
  return remain;
}
