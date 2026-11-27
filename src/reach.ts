import net from 'node:net';

export interface Reach {
  ok: boolean;
  ms: number;
  /** Grund, wenn nicht erreichbar (z. B. ENOTFOUND, Timeout). */
  error?: string;
}

/** Prüft nur den Verbindungsaufbau (DNS + TCP). Es wird kein Byte gesendet, auch kein HTTP. */
export function tcpReach(baseUrl: string, timeoutMs = 3000): Promise<Reach> {
  const u = new URL(baseUrl);
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  const start = performance.now();
  return new Promise((resolve) => {
    const s = net.connect({ host: u.hostname, port, timeout: timeoutMs });
    const done = (r: Omit<Reach, 'ms'>) => {
      s.destroy();
      resolve({ ...r, ms: Math.round(performance.now() - start) });
    };
    s.once('connect', () => done({ ok: true }));
    s.once('timeout', () => done({ ok: false, error: `Timeout nach ${timeoutMs} ms` }));
    s.once('error', (e: NodeJS.ErrnoException) => done({ ok: false, error: e.code ?? e.message }));
  });
}
