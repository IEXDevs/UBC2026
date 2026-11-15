'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import { bookFrame, layoutPositionBook, stepBubbleFollow } from '../lib/position-book.mjs';

const PLACE_KEY = 'maelstrom.cardPlaces';
const DRAG_PX = 7;
const HOME_Z = 2300;

function readPlaces() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLACE_KEY));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writePlace(id, x, y) {
  const places = readPlaces();
  places[id] = { x, y };
  localStorage.setItem(PLACE_KEY, JSON.stringify(places));
}

function placedSpot(places, card) {
  const spot = places[card.id];
  if (spot && Number.isFinite(spot.x) && Number.isFinite(spot.y)) return spot;
  return { x: card.x, y: card.y };
}

function usdLabel(notionalLabel) {
  if (!notionalLabel) return '';
  const amount = notionalLabel.replace(/ USDC$/, '');
  return amount.startsWith('-') ? `-$${amount.slice(1)}` : `$${amount}`;
}

function metric(parent, label, value, extra) {
  if (!value) return;
  const row = document.createElement('div');
  row.className = `book-metric${extra ? ` ${extra}` : ''}`;
  const name = document.createElement('span');
  name.textContent = label;
  const amount = document.createElement('b');
  amount.textContent = value;
  row.append(name, amount);
  parent.append(row);
}

function face(className) {
  const side = document.createElement('div');
  side.className = `book-face ${className}`;
  const spot = document.createElement('span');
  spot.className = 'book-spot';
  const glare = document.createElement('span');
  glare.className = 'book-glare';
  side.append(spot, glare);
  return side;
}

function sparks(parent) {
  for (let i = 0; i < 6; i += 1) {
    const spark = document.createElement('span');
    spark.className = 'book-spark';
    spark.style.setProperty('--sx', `${18 + ((i * 37) % 70)}%`);
    spark.style.setProperty('--sy', `${16 + ((i * 23) % 68)}%`);
    parent.append(spark);
  }
}

function cardElement(card) {
  const article = document.createElement('article');
  article.className = 'book-card';
  article.dataset.positionId = card.id;
  article.dataset.kind = 'position';
  article.dataset.walletId = card.walletId ?? '';

  const tilt = document.createElement('div');
  tilt.className = 'book-tilt';
  const flip = document.createElement('div');
  flip.className = 'book-flip';
  const glow = document.createElement('span');
  glow.className = 'book-glow';

  const front = face('book-front');
  const heading = document.createElement('div');
  heading.className = 'book-glance';
  const mark = logoImage(card.logo);
  if (mark) heading.append(mark);
  const names = document.createElement('div');
  const asset = document.createElement('strong');
  asset.textContent = card.asset;
  names.append(asset);
  if (card.side) {
    const side = document.createElement('span');
    side.textContent = card.side;
    names.append(side);
  }
  heading.append(names);

  const size = document.createElement('p');
  size.className = 'book-size';
  size.textContent = card.amountLabel;
  const usd = document.createElement('p');
  usd.className = 'book-usd';
  usd.textContent = usdLabel(card.notionalLabel);
  front.append(heading, size, usd);
  sparks(front);

  const back = face('book-back');
  const top = document.createElement('div');
  top.className = 'book-card-top';
  const market = document.createElement('strong');
  market.textContent = card.market;
  top.append(market);
  if (card.venue) {
    const venue = document.createElement('span');
    venue.className = 'book-side';
    venue.textContent = card.venue;
    top.append(venue);
  }
  const body = document.createElement('div');
  metric(body, 'Entry', card.entry);
  metric(body, 'Mark', card.mark);
  metric(body, 'Leverage', card.leverage);
  metric(body, 'Health', card.healthLabel);
  metric(body, 'APY', card.apyLabel);
  metric(body, 'PnL', card.pnlLabel, card.pnlDown ? 'book-pnl is-down' : 'book-pnl is-up');
  const agent = document.createElement('small');
  agent.textContent = card.botName;
  back.append(top, body, agent);

  flip.append(front, back);
  tilt.append(flip, glow);
  article.append(tilt);
  return article;
}

function clusterHome(book) {
  const venue = book.venues[0]?.venue;
  const cards = book.cards.filter(card => card.venue === venue);
  if (!cards.length) return { x: 0, y: 0 };
  const xs = cards.map(card => card.x);
  const ys = cards.map(card => card.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function logoImage(src) {
  if (!src) return null;
  const mark = document.createElement('img');
  mark.className = 'book-logo';
  mark.alt = '';
  mark.draggable = false;
  mark.src = src;
  return mark;
}

function walletIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const body = document.createElementNS(svg.namespaceURI, 'path');
  body.setAttribute('d', 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1');
  const fold = document.createElementNS(svg.namespaceURI, 'path');
  fold.setAttribute('d', 'M3 5v14a2 2 0 0 0 2 2h15v-2');
  svg.append(body, fold);
  return svg;
}

function walletElement(wallet) {
  const article = document.createElement('article');
  article.className = 'book-card book-wallet';
  article.dataset.positionId = wallet.id;
  article.dataset.kind = 'wallet';
  const head = document.createElement('div');
  head.className = 'book-wallet-head';
  const title = document.createElement('strong');
  title.append(walletIcon());
  title.append(document.createTextNode(wallet.label));
  const size = document.createElement('b');
  size.textContent = wallet.notionalLabel.replace(' USDC', '');
  head.append(title, size);
  const sub = document.createElement('p');
  sub.textContent = wallet.frozen
    ? 'Frozen'
    : `${wallet.venues.length} providers · ${wallet.count} positions`;
  article.append(head, sub);
  return article;
}

function accountElement(account) {
  const article = document.createElement('article');
  article.className = 'book-card book-account';
  article.dataset.positionId = account.id;
  article.dataset.kind = 'account';
  article.dataset.walletId = account.walletId;
  const mark = logoImage(account.logo);
  const names = document.createElement('div');
  names.className = 'book-glance-copy';
  const title = document.createElement('strong');
  title.textContent = account.venue;
  const meta = document.createElement('span');
  meta.textContent = account.count === 1 ? '1 position' : `${account.count} positions`;
  names.append(title, meta);
  if (mark) article.append(mark);
  article.append(names);
  return article;
}

function venueElement(venue) {
  const label = document.createElement('div');
  label.className = 'book-venue';
  const mark = logoImage(venue.logo);
  const copy = document.createElement('div');
  copy.className = 'book-venue-copy';
  const name = document.createElement('strong');
  name.textContent = venue.venue;
  const count = document.createElement('span');
  count.textContent = venue.count === 1 ? '1 position' : `${venue.count} positions`;
  copy.append(name, count);
  if (mark) label.append(mark);
  label.append(copy);
  return label;
}

function starTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const draw = canvas.getContext('2d');
  const glow = draw.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  draw.fillStyle = glow;
  draw.fillRect(0, 0, 32, 32);
  return canvas;
}

export default function PositionBook({ positions, bots, wallets = [] }) {
  const book = useMemo(() => layoutPositionBook(positions, bots, wallets), [positions, bots, wallets]);
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const openRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [drifted, setDrifted] = useState(false);
  const driftedRef = useRef(false);
  const setDriftedRef = useRef(setDrifted);
  openRef.current = setDetail;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let alive = true;
    let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      const { CSS3DObject, CSS3DRenderer } = await import('three/examples/jsm/renderers/CSS3DRenderer.js');
      if (!alive) return;

      const home = { x: 0, y: 0, z: HOME_Z };
      const focus = { x: home.x, y: home.y, z: home.z };
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
      camera.position.set(home.x, home.y, home.z);

      function aim() {
        camera.lookAt(camera.position.x, camera.position.y, 0);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      }
      aim();

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 1);
      mount.appendChild(renderer.domElement);

      const labels = new CSS3DRenderer();
      labels.domElement.className = 'book-labels';
      labels.domElement.style.pointerEvents = 'none';
      mount.appendChild(labels.domElement);

      const texture = new THREE.CanvasTexture(starTexture());
      const starGeometries = [];
      function addStars(count, spreadX, spreadY, depth, size, opacity) {
        const coords = new Float32Array(count * 3);
        for (let i = 0; i < count; i += 1) {
          coords[i * 3] = home.x + (Math.random() - 0.5) * spreadX;
          coords[i * 3 + 1] = home.y + (Math.random() - 0.5) * spreadY;
          coords[i * 3 + 2] = -40 - Math.random() * depth;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(coords, 3));
        const material = new THREE.PointsMaterial({
          map: texture,
          color: 0xffffff,
          size,
          transparent: true,
          depthWrite: false,
          sizeAttenuation: true,
          opacity,
        });
        scene.add(new THREE.Points(geometry, material));
        starGeometries.push(geometry, material);
      }
      addStars(700, 5200, 3600, 700, 7, 0.55);
      addStars(180, 2800, 2000, 180, 12, 0.9);

      const linkGeometries = [];
      const linkMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
        vertexShader: `
          attribute float aT;
          varying float vT;
          void main() {
            vT = aT;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying float vT;
          uniform float uTime;
          uniform float uOpacity;
          void main() {
            float travel = fract(vT * 0.5 - uTime * 0.16);
            float pulse = smoothstep(0.0, 0.035, travel) * smoothstep(0.2, 0.035, travel);
            gl_FragColor = vec4(0.96, 0.96, 0.96, (0.18 + pulse * 0.75) * uOpacity);
          }
        `,
      });
      const joint = new THREE.CircleGeometry(5, 20);
      const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });

      function ribbonPositions(link) {
        const start = new THREE.Vector3(link.from.x, link.from.y, 0.2);
        const end = new THREE.Vector3(link.to.x, link.to.y, 0.2);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len = Math.hypot(dx, dy) || 1;
        const control = new THREE.Vector3(
          (start.x + end.x) / 2 - (dy / len) * link.lift,
          (start.y + end.y) / 2 + (dx / len) * link.lift,
          0.2,
        );
        const curve = new THREE.QuadraticBezierCurve3(start, control, end);
        const wide = link.kind === 'provider' || link.kind === 'shared';
        const points = curve.getPoints(wide ? 64 : 18);
        const width = wide ? 3.2 : 1.5;
        const positions = [];
        const progress = [];
        for (let i = 0; i < points.length; i += 1) {
          const prev = points[Math.max(0, i - 1)];
          const next = points[Math.min(points.length - 1, i + 1)];
          const tx = next.x - prev.x;
          const ty = next.y - prev.y;
          const mag = Math.hypot(tx, ty) || 1;
          positions.push(
            points[i].x + (-ty / mag) * width,
            points[i].y + (tx / mag) * width,
            0.2,
            points[i].x - (-ty / mag) * width,
            points[i].y - (tx / mag) * width,
            0.2,
          );
          const t = i / (points.length - 1);
          progress.push(t, t);
        }
        return { positions, progress };
      }

      const anchors = new Map();
      const bindings = [];
      const cardObjects = new Map();
      const nodeObjects = new Map();
      const linkMeshes = [];
      const tiltState = new Map();
      const places = readPlaces();
      const linkMaterials = [];

      function addLink(link) {
        const { positions, progress } = ribbonPositions(link);
        const ribbon = new THREE.BufferGeometry();
        ribbon.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        ribbon.setAttribute('aT', new THREE.Float32BufferAttribute(progress, 1));
        const indices = [];
        const count = positions.length / 6;
        for (let i = 0; i < count - 1; i += 1) {
          const a = i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        ribbon.setIndex(indices);
        const material = linkMaterial.clone();
        material.uniforms.uTime = linkMaterial.uniforms.uTime;
        material.uniforms.uOpacity = { value: 1 };
        linkMaterials.push(material);
        const mesh = new THREE.Mesh(ribbon, material);
        scene.add(mesh);
        linkGeometries.push(ribbon);
        linkMeshes.push({ id: link.id, material });
        bindings.push({ geometry: ribbon, link });
      }

      for (const link of book.links) addLink(link);
      for (const venue of book.venues) {
        const dot = new THREE.Mesh(joint, jointMaterial);
        dot.position.set(venue.x, venue.y, 0.3);
        scene.add(dot);
        const object = new CSS3DObject(venueElement(venue));
        object.element.style.pointerEvents = 'none';
        object.element.dataset.positionId = venue.id;
        object.position.set(venue.x, venue.y, 0);
        scene.add(object);
        nodeObjects.set(venue.id, object.element);
        anchors.set(venue.id, object.position);
      }
      for (const wallet of book.wallets) {
        const spot = placedSpot(places, wallet);
        const object = new CSS3DObject(walletElement(wallet));
        object.position.set(spot.x, spot.y, 0);
        scene.add(object);
        cardObjects.set(wallet.id, object);
        nodeObjects.set(wallet.id, object.element);
        anchors.set(wallet.id, object.position);
        tiltState.set(wallet.id, { rx: 0, ry: 0, s: 1, targetRx: 0, targetRy: 0, targetS: 1 });
      }
      for (const account of book.accounts) {
        const spot = placedSpot(places, account);
        const object = new CSS3DObject(accountElement(account));
        object.position.set(spot.x, spot.y, 0);
        scene.add(object);
        cardObjects.set(account.id, object);
        nodeObjects.set(account.id, object.element);
        anchors.set(account.id, object.position);
      }
      for (const card of book.cards) {
        const spot = placedSpot(places, card);
        const object = new CSS3DObject(cardElement(card));
        object.position.set(spot.x, spot.y, 0);
        scene.add(object);
        cardObjects.set(card.id, object);
        nodeObjects.set(card.id, object.element);
        anchors.set(card.id, object.position);
        tiltState.set(card.id, { rx: 0, ry: 0, s: 1, targetRx: 0, targetRy: 0, targetS: 1 });
      }

      function anchorPoint(id, role, kind) {
        const pos = anchors.get(id);
        if (!pos) return { x: 0, y: 0 };
        if (kind === 'spoke' && role === 'to') return { x: pos.x, y: pos.y + 88 };
        if (kind === 'account' && role === 'from') return { x: pos.x, y: pos.y + 36 };
        if (kind === 'provider' && role === 'from') return { x: pos.x, y: pos.y + 28 };
        return { x: pos.x, y: pos.y };
      }

      function refreshLinks(id) {
        for (const binding of bindings) {
          if (id && binding.link.fromId !== id && binding.link.toId !== id) continue;
          binding.link.from = anchorPoint(binding.link.fromId, 'from', binding.link.kind);
          binding.link.to = anchorPoint(binding.link.toId, 'to', binding.link.kind);
          const { positions } = ribbonPositions(binding.link);
          const attribute = binding.geometry.getAttribute('position');
          if (attribute.array.length !== positions.length) continue;
          attribute.array.set(positions);
          attribute.needsUpdate = true;
        }
      }
      refreshLinks();

      let frame = 0;
      let dragging = false;
      let gesture = null;
      let lastX = 0;
      let lastY = 0;

      function worldPerPixel() {
        const height = mount.clientHeight || 1;
        return (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z) / height;
      }

      const bodies = [];
      const bodyById = new Map();
      for (const [id, object] of cardObjects) {
        const body = { id, x: object.position.x, y: object.position.y, pin: false, lag: null, ox: 0, oy: 0, dirty: false };
        bodies.push(body);
        bodyById.set(id, body);
      }
      const neighbors = new Map();
      for (const link of book.links) {
        if (!bodyById.has(link.fromId) || !bodyById.has(link.toId)) continue;
        if (!neighbors.has(link.fromId)) neighbors.set(link.fromId, []);
        if (!neighbors.has(link.toId)) neighbors.set(link.toId, []);
        neighbors.get(link.fromId).push(link.toId);
        neighbors.get(link.toId).push(link.fromId);
      }
      let trailing = false;

      function applyBodies() {
        for (const body of bodies) {
          const object = cardObjects.get(body.id);
          if (!object) continue;
          object.position.x = body.x;
          object.position.y = body.y;
        }
        refreshLinks();
      }

      function flushPlaces() {
        for (const body of bodies) {
          if (!body.dirty) continue;
          writePlace(body.id, body.x, body.y);
          body.dirty = false;
        }
      }

      function pinOnly(id) {
        const origin = bodyById.get(id);
        const lag = new Map([[id, 0]]);
        const queue = [id];
        while (queue.length) {
          const current = queue.shift();
          const depth = lag.get(current);
          for (const next of neighbors.get(current) ?? []) {
            if (lag.has(next)) continue;
            lag.set(next, depth + 1);
            queue.push(next);
          }
        }
        for (const body of bodies) {
          const depth = lag.get(body.id);
          body.pin = body.id === id;
          body.lag = depth === undefined ? null : depth;
          body.ox = origin ? body.x - origin.x : 0;
          body.oy = origin ? body.y - origin.y : 0;
        }
      }

      function stepTrail(dt) {
        if (!trailing) return;
        const stretch = stepBubbleFollow(bodies, dt);
        let moved = false;
        for (const body of bodies) {
          const object = cardObjects.get(body.id);
          if (!object) continue;
          if (Math.hypot(object.position.x - body.x, object.position.y - body.y) > 0.05) {
            body.dirty = true;
            moved = true;
          }
        }
        if (moved) applyBodies();
        if (!(gesture && gesture.moved) && (stretch < 0.75 || !moved)) {
          for (const body of bodies) body.pin = false;
          flushPlaces();
          trailing = false;
        }
      }

      function detailPayload(id, point) {
        const wallet = book.wallets.find(item => item.id === id);
        if (wallet) {
          return {
            title: wallet.label,
            kicker: wallet.frozen ? 'Frozen wallet' : `${wallet.accountKind} wallet`,
            address: wallet.fullAddress,
            rows: [
              ['Notional', wallet.notionalLabel],
              ['Kind', wallet.frozen ? 'Frozen' : wallet.accountKind],
              ['Providers', wallet.venues.join(', ') || 'None'],
              ['Positions', String(wallet.count)],
            ],
            sections: [
              {
                title: 'Subaccounts',
                rows: book.accounts.filter(item => item.walletId === wallet.id).map(item => [
                  item.venue,
                  `${item.count} position${item.count === 1 ? '' : 's'}`,
                ]),
              },
              {
                title: 'Positions',
                rows: book.cards.filter(item => item.walletId === wallet.id).map(item => [
                  item.amountLabel,
                  [item.venue, item.side, item.market, item.pnlLabel].filter(Boolean).join(' · '),
                ]),
              },
            ],
            point,
          };
        }
        const account = book.accounts.find(item => item.id === id);
        if (account) {
          const owner = book.wallets.find(item => item.id === account.walletId);
          return {
            title: account.venue,
            kicker: 'Subaccount',
            rows: [
              ['Wallet', owner?.label ?? account.walletId],
              ['Address', owner?.address ?? ''],
              ['Positions', String(account.count)],
            ].filter(([, value]) => value),
            sections: [
              {
                title: 'Held here',
                rows: book.cards
                  .filter(item => item.walletId === account.walletId && item.venue === account.venue)
                  .map(item => [
                    item.amountLabel,
                    [item.side, item.market, item.entry && `entry ${item.entry}`, item.mark && `mark ${item.mark}`, item.pnlLabel]
                      .filter(Boolean)
                      .join(' · '),
                  ]),
              },
            ],
            point,
          };
        }
        const card = book.cards.find(item => item.id === id);
        if (!card) return null;
        const owner = book.wallets.find(item => item.id === card.walletId);
        return {
          title: card.amountLabel,
          kicker: `${card.venue} · ${card.side ?? card.asset}`,
          rows: [
            ['Asset', card.asset],
            ['Side', card.side],
            ['USD', card.notionalLabel],
            ['Market', card.market],
            ['Entry', card.entry],
            ['Mark', card.mark],
            ['Leverage', card.leverage],
            ['Health', card.healthLabel],
            ['APY', card.apyLabel],
            ['PnL', card.pnlLabel],
            ['Agent', card.botName],
            ['Wallet', owner?.label],
            ['Mint', card.mint],
          ].filter(([, value]) => value),
          note: card.note,
          point,
        };
      }

      function framedDistance() {
        const width = mount.clientWidth || 1;
        const height = mount.clientHeight || 1;
        const frame = bookFrame(book);
        const worldW = Math.max(frame.maxX - frame.minX, 1);
        const worldH = Math.max(frame.maxY - frame.minY, 1);
        const vHalf = (camera.fov * Math.PI) / 360;
        const distH = (worldH / 2) / Math.tan(vHalf);
        const hHalf = Math.atan((width / height) * Math.tan(vHalf));
        const distW = (worldW / 2) / Math.tan(hHalf);
        return THREE.MathUtils.clamp(Math.max(distH, distW) * 1.18, 700, 12000);
      }

      function applyHome(snap = true) {
        const frame = bookFrame(book);
        home.x = frame.x;
        home.y = frame.y;
        home.z = framedDistance();
        focus.x = home.x;
        focus.y = home.y;
        focus.z = home.z;
        if (snap) {
          camera.position.set(home.x, home.y, home.z);
          aim();
        }
      }

      function noteDrift() {
        if (driftedRef.current) return;
        driftedRef.current = true;
        setDriftedRef.current(true);
      }

      function fit() {
        const width = mount.clientWidth || 1;
        const height = mount.clientHeight || 1;
        camera.aspect = width / height;
        if (!driftedRef.current) applyHome();
        else aim();
        renderer.setSize(width, height, false);
        labels.setSize(width, height);
      }

      let lastFrame = performance.now();

      function render(now) {
        const dt = Math.min(48, Math.max(0, now - lastFrame));
        lastFrame = now;
        stepTrail(dt);
        if (!dragging && !(gesture && gesture.moved)) {
          const k = 1 - Math.exp(-dt / 88);
          const dx = focus.x - camera.position.x;
          const dy = focus.y - camera.position.y;
          const dz = focus.z - camera.position.z;
          if (dx * dx + dy * dy + dz * dz > 0.04) {
            camera.position.x += dx * k;
            camera.position.y += dy * k;
            camera.position.z += dz * k;
            aim();
          }
        }
        linkMaterial.uniforms.uTime.value = now * 0.001;
        for (const [id, state] of tiltState) {
          const lifting = gesture && gesture.id === id && gesture.moved;
          if (lifting) {
            state.targetRx = 0;
            state.targetRy = 0;
            state.targetS = 1.045;
          }
          state.rx += (state.targetRx - state.rx) * 0.18;
          state.ry += (state.targetRy - state.ry) * 0.18;
          state.s += (state.targetS - state.s) * 0.18;
          const tilt = cardObjects.get(id)?.element.querySelector('.book-tilt');
          if (!tilt) continue;
          tilt.style.transform = `rotateX(${state.rx.toFixed(2)}deg) rotateY(${state.ry.toFixed(2)}deg) scale(${state.s.toFixed(3)})`;
          tilt.style.setProperty('--tc-glare', Math.min(1, Math.hypot(state.rx, state.ry) / 12).toFixed(3));
        }
        renderer.render(scene, camera);
        labels.render(scene, camera);
      }

      function loop(now) {
        render(now);
        frame = requestAnimationFrame(loop);
      }

      function down(event) {
        if (event.button !== 0) return;
        if (event.target.closest('.book-tools, .book-caption, .book-modal')) return;
        const card = event.target.closest('.book-card');
        if (card) {
          gesture = {
            id: card.dataset.positionId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
          return;
        }
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        mount.classList.add('is-panning');
      }

      function move(event) {
        if (gesture) {
          const distance = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y);
          if (!gesture.moved && distance > DRAG_PX) {
            gesture.moved = true;
            cardObjects.get(gesture.id)?.element.classList.add('is-dragging');
          }
          if (gesture.moved) {
            const object = cardObjects.get(gesture.id);
            const body = bodyById.get(gesture.id);
            if (!object || !body) return;
            const scale = worldPerPixel();
            if (!body.pin) pinOnly(gesture.id);
            body.x += (event.clientX - gesture.x) * scale;
            body.y -= (event.clientY - gesture.y) * scale;
            body.dirty = true;
            object.position.x = body.x;
            object.position.y = body.y;
            gesture.x = event.clientX;
            gesture.y = event.clientY;
            trailing = true;
            refreshLinks(gesture.id);
          }
          return;
        }
        if (!dragging) return;
        const scale = worldPerPixel();
        focus.x -= (event.clientX - lastX) * scale;
        focus.y += (event.clientY - lastY) * scale;
        camera.position.x = focus.x;
        camera.position.y = focus.y;
        lastX = event.clientX;
        lastY = event.clientY;
        aim();
        noteDrift();
      }

      function up() {
        if (gesture) {
          const element = cardObjects.get(gesture.id)?.element;
          element?.classList.remove('is-dragging');
          if (!gesture.moved) {
            const body = bodyById.get(gesture.id);
            if (body) body.pin = false;
            const payload = detailPayload(gesture.id);
            if (payload) openRef.current?.(payload);
          }
          const state = tiltState.get(gesture.id);
          if (state) {
            state.targetRx = 0;
            state.targetRy = 0;
            state.targetS = 1;
          }
          gesture = null;
        }
        dragging = false;
        mount.classList.remove('is-panning');
      }

      function planePoint(event) {
        const rect = mount.getBoundingClientRect();
        const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const origin = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
        const direction = origin.sub(camera.position).normalize();
        const distance = -camera.position.z / direction.z;
        return camera.position.clone().add(direction.multiplyScalar(distance));
      }

      function wheelDelta(event) {
        let delta = event.deltaY;
        if (event.deltaMode === 1) delta *= 16;
        else if (event.deltaMode === 2) delta *= mount.clientHeight || 800;
        return Math.max(-120, Math.min(120, delta));
      }

      function wheel(event) {
        event.preventDefault();
        const before = planePoint(event);
        const savedZ = camera.position.z;
        focus.z = THREE.MathUtils.clamp(focus.z * Math.exp(wheelDelta(event) * 0.00135), 560, 12000);
        camera.position.z = focus.z;
        aim();
        const after = planePoint(event);
        focus.x += before.x - after.x;
        focus.y += before.y - after.y;
        camera.position.z = savedZ;
        aim();
        noteDrift();
      }

      cameraRef.current = { camera, aim, applyHome, focus };
      fit();
      const observer = new ResizeObserver(fit);
      observer.observe(mount);
      mount.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      mount.addEventListener('wheel', wheel, { passive: false });
      loop(performance.now());

      cleanup = () => {
        flushPlaces();
        cancelAnimationFrame(frame);
        observer.disconnect();
        mount.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        mount.removeEventListener('wheel', wheel);
        for (const item of starGeometries) item.dispose();
        texture.dispose();
        for (const ribbon of linkGeometries) ribbon.dispose();
        linkMaterial.dispose();
        for (const material of linkMaterials) material.dispose();
        joint.dispose();
        jointMaterial.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        labels.domElement.remove();
        cameraRef.current = null;
      };
    })();

    return () => {
      alive = false;
      cleanup();
    };
  }, [book]);

  function reset() {
    const view = cameraRef.current;
    if (!view) return;
    view.applyHome(false);
    driftedRef.current = false;
    setDrifted(false);
  }

  function zoomBy(factor) {
    const view = cameraRef.current;
    if (!view) return;
    view.focus.z = Math.min(12000, Math.max(560, view.focus.z * factor));
    driftedRef.current = true;
    setDrifted(true);
  }

  return (
    <section className="position-book" aria-label="Positions" ref={mountRef}>
      <p className="book-caption">
        {book.summary.count === 0 ? (
          <span>No positions yet.</span>
        ) : (
          <>
            <strong>{book.summary.notionalLabel}</strong>
            <span>{book.summary.count} positions · {book.summary.venues} venues · PnL {book.summary.pnlLabel}</span>
          </>
        )}
        <span>devnet execution, mainnet pricing</span>
      </p>
      <div className="book-tools">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(0.86)}>
          <Plus size={16} strokeWidth={1.75} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1.16)}>
          <Minus size={16} strokeWidth={1.75} />
        </button>
        {drifted ? (
          <button type="button" aria-label="Reset view" onClick={reset}>
            <LocateFixed size={16} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {detail ? (
        <div className="book-modal" onMouseDown={() => setDetail(null)}>
          <article
            className="book-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={detail.title}
            onMouseDown={event => event.stopPropagation()}
          >
            <p>{detail.kicker}</p>
            <h2>{detail.title}</h2>
            {detail.address ? <p className="book-modal-address">{detail.address}</p> : null}
            <dl>
              {detail.rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {detail.sections?.map(section => (
              <section key={section.title} className="book-modal-section">
                <h3>{section.title}</h3>
                <dl>
                  {section.rows.map(([label, value], index) => (
                    <div key={`${section.title}-${index}`}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            {detail.note ? <p className="book-modal-note">{detail.note}</p> : null}
            <button type="button" onClick={() => setDetail(null)}>Close</button>
          </article>
        </div>
      ) : null}
    </section>
  );
}
