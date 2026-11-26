# Endpunkte und Messwerte (Probe 25.11.2026)

Ermittelt mit `npm run probe -- --env dev|test --save` (rein lesend, ein Login, sequenziell, ca. 25 Requests je Umgebung).
Zugang: der vorhandene Test-Benutzer. Der Login per `j_security_check` funktioniert auf DEV und TEST.
Rohantworten liegen lokal unter `data/probe/<env>/` (gitignoriert).

## Tragfähige Endpunkte

| Kriterium | Endpunkt | Auswertung | Dauer DEV/TEST | Größe |
|---|---|---|---|---|
| Author erreichbar | `GET /libs/granite/core/content/login.html` (anonym) | HTTP 200 | 1,4–2,3 s (Erstaufruf) | 11 KB |
| Replication-Agents | `GET /etc/replication/agents.author.2.json` | je Agent `jcr:content.enabled == "true"`; Publish-Agent: `transportUri` enthält `/bin/receive` | 70–160 ms (TEST einmal 2,4 s) | 18 KB |
| Queue je aktivem Agent | `GET /etc/replication/agents.author/<id>/jcr:content.queue.json` | `metaData.queueStatus.isBlocked/isPaused`, `queue[].time` (ältester Eintrag), Länge | 70–90 ms | 0,5–16 KB |
| Bundles | `GET /system/console/bundles.json` | Feld `s` = `[gesamt, aktiv, fragment, resolved, installed]`; nicht aktiv = `s[3] + s[4]`, Details in `data[]` | 120–175 ms | 122 KB |
| Heap | `GET /system/console/jmx/java.lang%3Atype%3DMemory` (HTML) | Tabelle: `HeapMemoryUsage` → `max`, `used` | 70–95 ms | 17 KB |
| Disk | `GET /system/console/jmx/com.adobe.granite%3Aname%3DDISK_USABLE_SPACE%2Ctype%3DMetrics` und `…DISK_TOTAL_SPACE…` (HTML) | Zeile `Value` → Zahl in Byte | 55–65 ms | 13 KB je |
| Job-Queues | `GET /system/console/slingevent.json` (HTML trotz Namen) | Zeilen `Queued Jobs`, `Active Jobs`, `Failed Jobs`, `Cancelled Jobs` (Gesamtstatistik) | 70–90 ms | 65–78 KB |
| Java-Version | `GET /system/console/jmx/java.lang%3Atype%3DRuntime` (HTML) | Zeile `java.version` (System-Properties), z. B. `1.8.0_513` | 205–240 ms | 25 KB |
| Oak-Version | kein eigener Aufruf: aus `bundles.json` (siehe oben), Bundle `org.apache.jackrabbit.oak-core`, Feld `version` | z. B. `1.22.24` | – | – |
| Produkt/Version | `GET /system/console/status-productinfo.json` | Zeile `Adobe Experience Manager (x.y.z)` | 55–70 ms | 246 B |
| Samples Author | `GET /content/samples/de.json`, `/content/dam/samples.json` | HTTP 200 | 60–105 ms | 0,15 KB |
| Publish Startseite | `GET /content/zv/de.html` (anonym, Publish) | HTTP 200 | 1,4–2,4 s | 173 KB |
| Fehlerseite | `GET /content/zv/de/qa-seite-gibt-es-nicht.html` (Publish) | HTTP 404 und Titel „Fehlerseite 404“ | 0,55 s | 77 KB |
| Samples Publish | `GET /content/samples/de.html` (Publish) | HTTP 200 | 0,16–0,4 s | 47 KB |

## Nicht tragfähig

- `/system/health.json`, `/system/health?format=json`: HTTP 404 (Health-Check-Servlet nicht aktiv).
- `/system/sling/monitoring/mbeans/...` (JSON-Sicht auf JMX): HTTP 404. Heap und Disk deshalb aus dem HTML der JMX-Konsole lesen.
- `/system/console/healthcheck?tags=systemalive`: führt 0 Checks aus. Health Checks per Konsole auszuführen bringt hier nichts; die Gesundheit wird über eigene Checks bewertet.
- Publish-Version: `/system/console/status-productinfo.json` und `/system/console/bundles.json` liefern anonym auf Publish HTTP 500 (Fehlerseite), die Login-Seite nennt keine Version, der `Server`-Header nur `Apache`. Die Publish-Version ist anonym nicht lesbar und wird nicht angezeigt (25.11.2026, DEV).
- `/system/console/jmx` (Übersicht, 840 KB) und `/sites.html/...` (294 KB): zu schwer für den Takt, nicht verwenden.
- `/etc/workflow/instances.json`: auf TEST 4574 Einträge, 411 KB. Nicht im schnellen Takt. Für hängende Workflows in Task 4 mit `instances.RUNNING.json` bzw. Status-Filter prüfen.

## Normalzustand (25.11.2026)

DEV:
- AEM 6.5.25.0. Aktive Agents: `publish_aem-publish1-dev` (Publish, Queue leer, nicht blockiert), `scene7`.
- Versionen: AEM 6.5.25.0, Java 1.8.0_513 (HotSpot 25.513-b04), Oak 1.22.24. TEST: AEM und Java gleich.
- Bundles: 654 gesamt, 645 aktiv, 9 Fragmente, 0 nicht aktiv.
- Heap: 18,0 GB von 33,9 GB (53 %).
- Disk: 1,14 TB frei von 4,40 TB (74 % belegt).
- Jobs: 0 queued, 0 active, 4 failed, 40 cancelled (seit Start 22.11.2026).
- Samples: Author und Publish vorhanden.

TEST (Befund, kein Fehler der Probe):
- Agents `publish_aem-publish1-test` und `flush_aem-publish1-dispatcher-test`: **blockiert**, je 50 Einträge, ältester ca. 24,5 h. Das passt zu den bekannten Problemen auf TEST (JET 24.11.2026). Das Dashboard soll genau das rot anzeigen.
- Die Queue-Liste scheint bei 50 Einträgen zu enden. „50“ ist deshalb „mindestens 50“, nicht die genaue Länge.
- Workflow-Instanzen: 4574 (inkl. beendeter).
- Samples: Author und Publish fehlen (HTTP 404), bekannt.

## Last der Probe

Ein Probe-Lauf = 1 Login + ca. 22 GET auf Author und 3 auf Publish, sequenziell, in unter 20 s. Der Client zählt Requests/min (Author 19–23, Publish 3 im Probe-Lauf).
Ein Dashboard-Zyklus braucht nur die oben genannten Endpunkte. Schnell (30 s): Login-Seite, Agents-Liste, Queues, Publish-Startseite. Langsam (5 min): Produktinfo (Version), JMX Runtime (Java), Bundles (auch Oak-Version), JMX (Heap, 2× Disk), Jobs, Samples, Fehlerseite. Das Ergebnis wird in Task 4 gemessen.

## Offene Punkte für Task 4

- Hängende Workflows: passenden, leichten Endpunkt prüfen (`instances.RUNNING.json`).
- Login-Dauer: der erste Aufruf braucht 1,4–2,4 s, danach 60–160 ms. Timeout 5 s reicht, das Antwortzeit-Messgerät nutzt deshalb eine schnelle Seite und nicht die Login-Seite.
