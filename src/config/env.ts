import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as tls from 'node:tls';

export function loadBackendEnv(): void {
  applyFile(resolve(process.cwd(), '.env'));
  configureSystemTrust();
}

function applyFile(file: string): void {
  if (!existsSync(file)) return;
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseEnv(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

/** Opt-in for managed networks whose CA is trusted by the operating system. */
export function configureSystemTrust(env: NodeJS.ProcessEnv = process.env): void {
  if (env.AI_USE_SYSTEM_CA !== 'true') return;
  const trust = tls as typeof tls & {
    getCACertificates?: (type: string) => string[];
    setDefaultCACertificates?: (certs: string[]) => void;
  };
  if (!trust.getCACertificates || !trust.setDefaultCACertificates)
    throw new Error('AI_USE_SYSTEM_CA requires a Node runtime with system certificate support.');
  trust.setDefaultCACertificates([...new Set([
    ...trust.getCACertificates('default'), ...trust.getCACertificates('system'),
  ])]);
}
