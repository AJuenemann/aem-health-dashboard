import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Minimaler AEM-Ersatz für Tests: Login per Formular + Cookie, Routen mit festen Antworten. */
export interface Route {
  status?: number;
  body?: string;
  delayMs?: number;
  /** Nur mit gültigem Cookie erreichbar (sonst 401). */
  auth?: boolean;
}

export interface FakeAem {
  url: string;
  routes: Map<string, Route>;
  /** Alle Requests als "METHOD /pfad". */
  log: string[];
  /** Login gelingt, solange true; sonst 403. */
  loginOk: boolean;
  close(): Promise<void>;
}

export async function startFakeAem(routes: Record<string, Route> = {}): Promise<FakeAem> {
  const state: FakeAem = { url: '', routes: new Map(Object.entries(routes)), log: [], loginOk: true, close: async () => {} };
  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/';
    state.log.push(`${req.method} ${path}`);
    if (req.method === 'POST' && path.includes('j_security_check')) {
      req.resume();
      if (!state.loginOk) return void res.writeHead(403).end();
      return void res.writeHead(200, { 'Set-Cookie': 'login-token=abc; Path=/' }).end('ok');
    }
    const route = state.routes.get(path);
    if (!route) return void res.writeHead(404).end('nicht gefunden');
    if (route.auth && !(req.headers.cookie ?? '').includes('login-token=abc')) return void res.writeHead(401).end();
    setTimeout(() => res.writeHead(route.status ?? 200).end(route.body ?? ''), route.delayMs ?? 0);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
  return state;
}
