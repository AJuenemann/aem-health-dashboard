# AEM Health Dashboard

Zeigt im Browser den Gesundheitszustand von AEM-Umgebungen (Author und Publish) als analoge Messgeräte:
Zeigerinstrumente, Kontrollleuchten, Rollenzählwerke, Pegelbalken und Schreiber-Kurven.
Die Prüfungen sind rein lesend, schnell (alle 30 s) und schonen die Instanzen.
Optik wie das Cockpit der Testautomatisierung (eggs-Farben, Hell- und Dunkelmodus).

## Schnellstart

```bash
cp .env.example .env        # AEM_USER und AEM_PASSWORD eintragen
npm install
npm start                   # http://127.0.0.1:4400/
```

Mit Docker (Verlauf bleibt im Volume `dashboard-data`):

```bash
docker compose up -d --build
```

Der Dienst hört nur auf `127.0.0.1`. Er hat **keine eigene Anmeldung**. Für den Betrieb auf einem Server im Netz
gehört ein Reverse Proxy mit Anmeldung davor.

## Was geprüft wird

| Takt | Kriterium | Anzeige |
|---|---|---|
| 30 s | VPN / Netzwerk (TCP-Verbindung zum Author-Host, ohne HTTP), Author erreichbar, Anmeldung, Publish erreichbar (inkl. Fraunhofer-Header) | Lampe |
| 30 s | Publish-Agent aktiv und nicht blockiert/pausiert | Lampe |
| 30 s | Blockierte Agents, Einträge in der Warteschlange | Zählwerk |
| 30 s | Alter des ältesten Queue-Eintrags | Zeigerinstrument |
| 30 s | Antwortzeit Author und Publish | Zeigerinstrument |
| 5 min | Inaktive OSGi-Bundles, wartende Sling-Jobs | Zählwerk |
| 5 min | Versionen der Author-Instanz: AEM, Java, Oak (nur Anzeige, kein Kriterium; Publish ist anonym nicht lesbar) | Text neben dem Umgebungsnamen |
| 5 min | Heap-Auslastung | Schauglas |
| 5 min | Disk-Belegung | Schauglas |
| 5 min | Fehlerseite 404, Samples Author, Samples Publish | Lampe |

Oben in jeder Umgebung steht das Hauptinstrument (Score 0–100). Ein rotes **kritisches** Kriterium setzt die
Gesamtbewertung auf Rot (Score höchstens 30). Nicht messbare Werte gelten als „unbekannt“, nie als grün.
Ist mindestens ein Kriterium unbekannt, gibt es keinen Score („Score nicht berechenbar“). Bekanntes Rot oder Gelb bleibt sichtbar, sonst steht dort „Unvollständig“ und der Hinweis, wie viele Kriterien fehlen.
Ein Klick oder Enter auf ein Instrument öffnet den Verlauf (24 Stunden oder 7 Tage).

Die Endpunkte und der Normalzustand von DEV und TEST stehen in [`docs/ENDPOINTS.md`](docs/ENDPOINTS.md).

## Konfiguration

| Datei | Inhalt |
|---|---|
| `.env` | `AEM_USER`, `AEM_PASSWORD` (Pflicht), optional `PORT` (4400), `HOST` (127.0.0.1), `DATA_DIR` (data) |
| `config/environments.json` | Umgebungen: Id, Anzeigename, Author-URL, Publish-URL. Optional `"maintenance": true` oder ein kurzer Grund (`"maintenance": "Upgrade"`): Wartungsmodus, das Dashboard sendet dann keine Anfragen und zeigt ein Banner. Einfacher geht es im Dashboard mit dem Knopf „Wartung“ je Umgebung (Grund optional). Der Zustand liegt in `data/maintenance.json` und gilt vor der Konfiguration. |
| `config/checks.json` | Takte, Gruppen, je Check: Anzeigeelement, Takt, Gewicht, `critical`, Schwellen (`warn`, `crit`), Skala |

Schwellen und Anzeigeelement lassen sich je Kriterium in `config/checks.json` ändern. `element` ist `lamp`, `gauge`,
`counter`, `bar` oder `glass` (Schauglas). Ohne `thresholds` ist ein Check eine Ja/Nein-Lampe (1 = ok, 0 = rot).

## Lastschutz

Gemessen im Dauerbetrieb mit DEV und TEST: etwa 4–10 Requests/min auf den Author und 1–2 auf Publish je Umgebung.
Der Container braucht rund 0,2 % CPU und 50 MiB RAM.

- Einmal anmelden, dann nur GET mit Sitzungs-Cookie. Publish wird anonym abgefragt.
- Timeout 5 s, höchstens 2 parallele Anfragen pro Host, Umgebungen starten versetzt, Takte mit Zufallsversatz.
- Läuft ein Lauf noch, startet kein zweiter (kein Aufstauen).
- **Schutz vor Kontosperre:** Lehnt AEM die Anmeldung ab (401/403), sperrt das Dashboard weitere Anmeldungen. Es zeigt
  „Zugang gesperrt“ und sendet nichts mehr, bis jemand im Dashboard „Erneut versuchen“ wählt oder den Dienst neu startet.
  Nach einem Passwortwechsel zuerst `.env` korrigieren, dann erst entsperren.
- Der Zähler „Anfragen/min“ steht im Dashboard und unter `/api/stats`.
- **Wiederholung und Entprellung:** Schlägt ein GET mit Netzwerkfehler oder Timeout fehl, fragt der Client einmal erneut an
  (HTTP-Fehler nicht). Die Kachel zeigt dann „↻ Wiederholt angefragt“. Liefert ein Check einmal keinen Wert, zeigt die Kachel
  noch den vorherigen Wert mit Hinweis; erst die zweite Fehlmessung in Folge gilt als „unbekannt“ (nicht bei Sperre).
  Ab 3 Läufen mit Wiederholung in der letzten Stunde steht dort „bitte genauer prüfen“. Der Zähler liegt im Speicher und
  beginnt nach einem Neustart neu. Im Verlauf (`data/history`) steht bei Wiederholung ein drittes Feld `"r"`.

## API

`GET /api/state`, `GET /api/stream` (Server-Sent Events), `GET /api/history?env=&id=&hours=`, `GET /api/stats`,
`GET /healthz`, `POST /api/unlock?env=` (nur mit Header `X-Requested-With: dashboard`).

## Verlauf

Je Lauf eine Zeile in `data/history/JJJJ-MM-TT.jsonl` (im Container `/data/history`). Aufbewahrung 7 Tage,
Aufräumen beim Start und alle 6 Stunden.

## Tests

```bash
npm test          # Unit-Tests (node:test), inkl. Fake-AEM-Server und Farbkontrast
npm run typecheck
npm run probe -- --env dev [--save]   # testet Kandidaten-Endpunkte (nur GET)
npm run check -- --env dev [--watch]  # führt die Checks im Terminal aus
```

## In ein anderes Projekt übernehmen

Das Projekt hat keine Abhängigkeit zu anderen Repositories.

1. Repository kopieren oder klonen, `npm install`.
2. `.env` mit dem Lese-Zugang der neuen Umgebung anlegen (nie committen).
3. `config/environments.json` auf die neuen Hosts setzen.
4. `npm run probe -- --env <id> --save` ausführen und `docs/ENDPOINTS.md` mit den Ergebnissen abgleichen.
   Antwortformate und Pfade von AEM-Instanzen können abweichen (z. B. Agent-Ids, Publish-Startseite).
5. Projektspezifisch anpassen: Publish-Seite und Fehlerseite in `src/checks.ts`
   (`PUBLISH_PAGE`, `MISSING_PAGE`, Header-Marker `fhg-header`), Samples-Pfade, Schwellen in `config/checks.json`,
   Farben in `public/tokens.css`.
6. `npm test` und `npm run check -- --env <id>`.
