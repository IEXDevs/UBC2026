import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseEnvFile(text) {
  const env = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (/^[A-Z0-9_]+$/.test(name)) env[name] = value;
  }
  return env;
}

let cached;

export function findEnvRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(path.join(dir, '.env.local')) && fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.workspaces) return dir;
      } catch {
        /* A package.json that is not the workspace root is not the env root. */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

function envStarts() {
  const starts = [process.cwd(), process.env.INIT_CWD].filter(Boolean);
  try {
    starts.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* A bundled module may not have a file URL. */
  }
  return starts;
}

function rootEnv() {
  if (cached) return cached;
  let root = findEnvRoot(process.cwd());
  for (const start of envStarts()) {
    const found = findEnvRoot(start);
    if (fs.existsSync(path.join(found, '.env.local'))) {
      root = found;
      break;
    }
  }
  const file = path.join(root, '.env.local');
  cached = fs.existsSync(file) ? parseEnvFile(fs.readFileSync(file, 'utf8')) : {};
  return cached;
}

export function readRootEnv(name, env = rootEnv()) {
  const value = env?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Copy root `.env.local` NEXT_PUBLIC_* into `process.env` when unset.
 * Next only auto-loads `apps/web/.env*`; the monorepo keeps secrets at the repo root.
 */
export function applyRootPublicEnv(target = process.env, env = rootEnv()) {
  const applied = [];
  for (const [name, raw] of Object.entries(env || {})) {
    if (!name.startsWith('NEXT_PUBLIC_')) continue;
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    const existing = typeof target[name] === 'string' ? target[name].trim() : '';
    if (existing) continue;
    target[name] = value;
    applied.push(name);
  }
  return applied;
}
