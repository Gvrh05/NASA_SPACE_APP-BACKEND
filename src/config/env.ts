import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AI_KEYS = [
  'AI_PROVIDER',
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'AI_TIMEOUT_MS',
] as const;

export function loadBackendEnv(): void {
  applyFile(resolve(process.cwd(), '.env'));
  const sibling = resolve(process.cwd(), '../astrodeepspacenasa/.env');
  if (!existsSync(sibling)) return;
  const parsed = parseEnv(readFileSync(sibling, 'utf8'));
  for (const key of AI_KEYS) {
    if (process.env[key] === undefined && parsed[key]) process.env[key] = parsed[key];
  }
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
