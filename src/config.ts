import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface EnvConfig {
  id: string;
  label: string;
  baseUrl: string;
  publishUrl: string;
  /** Wartungsmodus: `true` oder ein kurzer Grund. Dann sendet das Dashboard keine Anfragen an die Umgebung. */
  maintenance?: boolean | string;
}

export interface Credentials {
  user: string;
  password: string;
}

const stripSlash = (u: string): string => u.replace(/\/+$/, '');

export function loadEnvironments(file = `${ROOT}config/environments.json`): EnvConfig[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { environments: EnvConfig[] };
  return raw.environments.map((e) => ({ ...e, baseUrl: stripSlash(e.baseUrl), publishUrl: stripSlash(e.publishUrl) }));
}

/** Liest AEM_USER/AEM_PASSWORD aus `.env` oder Prozess-Umgebung. Nennt nur fehlende Namen, nie Werte. */
export function loadCredentials(): Credentials {
  dotenv.config({ path: `${ROOT}.env`, quiet: true });
  const user = process.env.AEM_USER?.trim() ?? '';
  const password = process.env.AEM_PASSWORD?.trim() ?? '';
  const missing = [!user && 'AEM_USER', !password && 'AEM_PASSWORD'].filter(Boolean);
  if (missing.length) throw new Error(`Fehlende Umgebungsvariable(n): ${missing.join(', ')} (siehe .env.example).`);
  return { user, password };
}
