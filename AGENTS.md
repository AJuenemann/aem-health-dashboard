# Leitfaden für Agenten und Entwickler

Eigenständiges Projekt `aem-health-dashboard`. Keine Abhängigkeit zu `aem-test-automation`
(`public/tokens.css` ist eine Kopie, die Zugangsdaten stehen in der eigenen `.env`).

## Grundregeln

- **Rein lesend.** Gegen AEM nur GET. Einzige Ausnahme: die Anmeldung per `POST …/j_security_check` (Sitzung).
  Kein Schreibzugriff auf AEM, nie.
- **Lastschutz nicht aufweichen** (`src/aem-client.ts`): Sitzung wiederverwenden, Timeout 5 s, höchstens 2 parallele
  Anfragen je Host, Circuit-Breaker bei abgelehnter Anmeldung (401/403). Das falsche Passwort wird nie wiederholt gesendet.
  Neue Checks dürfen den Takt nicht spürbar erhöhen. Schwere Endpunkte (`/system/console/jmx`, Workflow-Liste, Sites-Konsole)
  nicht verwenden, siehe `docs/ENDPOINTS.md`.
- **Keine Secrets committen.** `.env` ist gitignoriert. Nie den Inhalt ausgeben. Fehlende Variablen nur beim Namen nennen.
- **Nicht messbar = unbekannt**, nie grün. Fehler, Timeout und Sperre ergeben `value: null`.
- **Keine geratenen Endpunkte oder Selektoren.** Neuen Endpunkt zuerst mit `npm run probe` gegen DEV und TEST prüfen
  (`scripts/probe.ts`, Ziele in `src/probe-lib.ts`), dann in `docs/ENDPOINTS.md` festhalten und erst dann einbauen.

## Aufbau

```
config/        environments.json (Hosts), checks.json (Takte, Schwellen, Anzeige)
src/           aem-client, checks (schnell/langsam), parsers, evaluate (Bewertung), scheduler,
               monitor (Zustand + Takte), history (JSONL), api (HTTP, SSE), server
public/        Frontend ohne Build: Vanilla-ES-Module + SVG; tokens.css (Marke), app.css
public/js/     logic (reine Logik), geometry und plot (reine Geometrie), instruments (Messgeräte),
               tile, dashboard, history-view
scripts/       probe.ts, check.ts
docs/          ENDPOINTS.md
```

Reine Logik gehört in `logic.js`, `geometry.js`, `plot.js`, `parsers.ts`, `evaluate.ts`: nur dort ist sie unter Node testbar.

## Neues Kriterium hinzufügen

1. Endpunkt per Probe prüfen und in `docs/ENDPOINTS.md` eintragen.
2. Parser in `src/parsers.ts` (mit Test in `parsers.test.ts`).
3. Check in `src/checks.ts` (`runFast` oder `runSlow`). Test mit dem Fake-AEM (`src/fake-aem.ts`) in `checks.test.ts`.
4. Eintrag in `config/checks.json`: `id`, `label`, `element`, `tempo`, `group`, `weight`, `critical`, `thresholds`, `scale`.
5. `npm test` und `npm run typecheck`.

## Frontend

- Texte stehen auf Deutsch. Dynamische Texte mit `textContent`, nie mit `innerHTML` (Werte stammen aus AEM).
- Status nie nur als Farbe: immer Text und Symbol (`STATUS_ICON`, `STATUS_TEXT`). Messgeräte sind für Screenreader
  ausgeblendet, die Kachel trägt den vollständigen `aria-label`.
- Farben nur über Tokens aus `tokens.css`. Neue Textpaare in `public/tokens.test.ts` aufnehmen (Kontrast ≥ 4,5).
- Animationen respektieren `prefers-reduced-motion` (in `app.css`).
- Änderungen im Browser prüfen: hell und dunkel, mit Screenshot. Das Dashboard hat bewusst keine Browser-Test-Abhängigkeit.

## Betrieb

- Lokal `npm start`, Port 4400, nur `127.0.0.1`. Docker: `docker compose up -d --build`, Port nur an `127.0.0.1` veröffentlicht.
- Das Dashboard hat keine eigene Anmeldung. Für Betrieb im Netz Reverse Proxy mit Anmeldung davorsetzen.
- `POST /api/unlock` erfordert den Header `X-Requested-With: dashboard` (Schutz vor Aufrufen aus fremden Webseiten).
- Die Docker-Variante braucht `tsx` zur Laufzeit (steht deshalb unter `dependencies`).

## Git

Keine Commits oder Pushes ohne ausdrückliche Anweisung. Erster Push legt `main` an. Vor jedem Commit `git status`
prüfen: keine `.env`, kein `data/`.
