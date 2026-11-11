# Öffentliche API: Anmeldung für Maschinen, Vertrag, Ereignisse

Stand: 11.11.2026 · Konzeptnotiz, kein Code · Zunder LLH-1148
(`https://zunder.rubeen.dev/#/aufgabe/xezfcehktnh276zoal225in0`)

Dieses Dokument schließt LLH-1148 ab. Vorgaben dafür sind ADR-0014 (08.11.2026) und die
Entscheidungen E1, E2 und E12 aus [`2026-11-10-schnittstellen-ausbau.md`](2026-11-10-schnittstellen-ausbau.md).
Ruben hat am 11.11.2026 die Fragen D2 bis D4 und D9 entschieden. Bei D1 hat er nur die Richtung
vorgegeben: „möglichst zugänglich und vor allem sicher“. Die Regeln stehen in zwei ADRs mit Status
`vorgeschlagen`; akzeptiert werden sie mit der ersten Umsetzung:

- [ADR-0021](../architektur/entscheidungen/ADR-0021-fremdsysteme-sprechen-signiert-mit-der-oeffentlichen-api-v1.md):
  Fremdsysteme und öffentliche API
- [ADR-0022](../architektur/entscheidungen/ADR-0022-absender-ohne-signatur-werfen-ueber-einen-einwurf-zugang-ein.md):
  Einwurf-Zugang

## Ausgangslage im Code

- **Anmeldung für Maschinen gibt es nur für Instanzen** (`src/instanz/signatur.rs`,
  `src/instanz/extractor.rs`). Das Verfahren ist nicht unmittelbar übertragbar:
  - Die `typ`-Werte heißen `lifeline-instanz…`.
  - `pv` ist an das Kopplungsprotokoll gebunden.
  - Freigeschaltet wird erst durch `melden`.
  - Ein Widerruf hat Nebenwirkungen auf Spiegel, Stammdaten und Führung
    (`instanz::repo::org_widerrufen`).
  - Ein Rechtemodell gibt es nicht; was eine Instanz darf, legen zwei Handler fest.
- **Die signierten Routen sind nicht gedrosselt.** Ein unbekannter `kid` kostet einen DB-Zugriff
  und ergibt 401, zählt aber nicht in die IP-Sperre (`src/auth/rate_limit.rs`, LFH-604).
- **Zwei Lesewege von außen arbeiten mit Bearer:**
  - `GET /api/lagemonitor/v1/lage` mit `llh_lm_…` (`src/lagemonitor_zugang/mod.rs`). Diese
    Schlüssel laufen nie ab und werden nicht gedrosselt.
  - `GET /api/extern/v1/lagebild` mit `llh_lb_…` (`src/lagebild_extern/mod.rs`). Das ist ein Link
    für Menschen im Browser, mit Ablauf und IP-Sperre.
- **OpenAPI** (`src/api_doc.rs`) kennt nur `components/schemas`. Kein Handler trägt
  `#[utoipa::path]`, und `frontend/src/api/openapi.json` enthält `"paths": {}`.
- **Fehler** haben die Form `{"error": "<deutscher Text>"}` (`src/error.rs`), ohne
  maschinenlesbaren Code. CORS gibt es nicht. Jeder Body ist auf 256 KiB begrenzt
  (`JSON_BODY_MAX`, `src/app.rs`).
- **Hinaus** gibt es nur die zwei SSE-Ströme der eigenen Oberfläche (ADR-0003). Es fehlen eine
  Outbox, eine Webhook-Warteschlange und ein Wiederholungsdienst. Ausgehende Abrufe laufen über
  `src/ausgehend.rs` und `src/http_begrenzt.rs`.
- **Abrufprotokolle** gibt es nur einzeln: `lagebild_abruf`, `person_zugriff_audit`,
  `anhang_zugriff_audit` und beim Lagemonitor `zuletzt_genutzt_at`.

## Entscheidungen

| Nr. | Frage | Entscheidung |
| --- | --- | --- |
| D1 | Form der Anmeldung | **Ein JWS je Anfrage nach ADR-0014**, kein Token-Endpunkt und kein Bearer. Zugänglich wird es durch Hilfen rundherum (Abschnitt „Zugänglichkeit“). Wer gar nicht signieren kann, nutzt den Einwurf (D5). |
| D2 | Rechte | **Feste Scopes je Zugang.** Ein Zugang gehört genau einer Org. Ein Lese-Scope mit Einsatzbezug braucht zusätzlich die Freigabe der Einsatzleitung, wie heute beim Lagemonitor. |
| D3 | Vertrag | **Alles Öffentliche liegt unter `/api/v1/`.** Es hat ein eigenes OpenAPI-Dokument mit Pfaden und eigenem Drift-Test. Nur dort gilt eine Stabilitätszusage; die interne API bleibt ohne Zusage. |
| D4 | Hinaus | **Eine Outbox von Anfang an.** Ausgangsereignisse werden in derselben Transaktion wie die Änderung geschrieben. Ihr erster Leser ist der Abruf `GET /api/v1/events`, ihr zweiter Webhooks, die gleich danach kommen und mit dem Instanzschlüssel signiert werden, nicht per HMAC. |
| D5 | Absender ohne Signatur | **Einwurf-Zugang** (E1 vom 10.11.): ein geheimer Schlüssel im Pfad, der nur in eine Ablage schreibt. Festgehalten als **ADR-0022**, weil die Nummer 0015 schon vergeben war. |
| D6 | Lagemonitor | Er wird auf D1 umgestellt (E2, LLH-1638) und zieht nach `GET /api/v1/situation` um, mit englischen Feldern. Der alte Pfad bleibt für eine Übergangszeit unverändert. |
| D7 | Lagebild-Link | Der Lagebild-Link (`llh_lb_`) ist **kein Maschinenzugang**, sondern ein Link für Menschen ohne Konto. Er bleibt, wie er ist, und gehört nicht zu `/api/v1`. |
| D8 | Mehrere Instanzen | Eingehendes kommt am Hub an. Eine ungekoppelte Instanz verhält sich wie ein Hub (G5, Entscheidung 12 der Instanzkopplung). An einem Spiegel antwortet ein Schreibweg wie bisher mit 409. |
| D9 | Sprache | **Die öffentliche API ist englisch.** Pfade, Felder, Werte, Scopes, Ereignisarten, Fehlercodes, Fehlertexte und Kopfzeilen unter `/api/v1` sind englisch, auch für Fachbegriffe. Die Übersetzung legt das Glossar unten fest. Die interne API, die Oberfläche und die Bezeichner im Code bleiben bei LFH-1312 („Fachbegriffe deutsch, Technik englisch“). |

## Glossar (D9)

Ein Fachbegriff hat auf dem Wire genau eine englische Entsprechung. Das OpenAPI-Dokument übernimmt
diese Tabelle in `info.description`. Ein neuer Begriff kommt zuerst hierher bzw. in das Dokument,
dann in eine Route.

| Fachbegriff (Oberfläche, Code) | API v1 |
| --- | --- |
| Einsatz | `incident` |
| Lage, Lagebild | `situation` |
| Lagemeldung | `situation_report` |
| Einsatzleitung | `incident_command` |
| Einsatzvorschlag | `incident_proposal` |
| Alarmmeldung | `alarm` |
| Stichwort | `keyword` |
| Einsatznummer der Leitstelle (`leitstellen_nr`) | `dispatch_number` |
| Einsatzort | `location` |
| Meldender | `caller` |
| Einsatzmittel | `resource` |
| Betroffene (Zahlen) | `affected` |
| Unterkunft und Zelte (Rechner) | `shelter` (`calculators/shelter`) |
| Organisation | `organization` |
| Zugang, Maschinenzugang | `client` |
| Zweck | `scope` |
| Freigabe der Einsatzleitung | `grant` |
| Einwurf | `ingest` |

## Zweck und Abgrenzung

**Was die API trägt (v1):**

| Scope | Richtung | Route (Entwurf) | Prüfstein |
| --- | --- | --- | --- |
| `situation:read` | hinaus | `GET /api/v1/situation` (Inhalt wie heute `lagemonitor_v1`, Felder englisch) | Lagemonitor (Rust), LLH-1638 |
| `incidents:read` | hinaus | `GET /api/v1/incidents`, `GET /api/v1/incidents/{id}` | Einsatzkopf fürs Einsatzbuch der iuk-suite (TypeScript) |
| `events:read` | hinaus | `GET /api/v1/events?after=…` | iuk-suite |
| `alarms:write` | herein | `POST /api/v1/alarms` (Normalform aus dem Schnittstellen-Ausbau, Felder englisch) | Adapter, LLH-1192 |
| `positions:write` | herein | `POST /api/v1/positions` | Traccar/Brücke, LLH-1199 |
| `calculator:use` | beides | `POST /api/v1/calculators/shelter` | LLH-1524 |

**Was bewusst draußen bleibt:**

- **Kein Einsatz ohne Menschen (G1).** Eine Maschine legt keinen Einsatz an und schreibt nicht in
  Einsatzdaten. Herein kommen nur Vorschläge in eine Ablage, die ein Mensch übernimmt.
- **Keine Personen- und Gesundheitsdaten hinaus** (G6). Das gilt für Namen, Personenkennungen,
  freie Notizen, Sichtung, Verletzungen und Maßnahmen. Ein Export für die Personenauskunft
  (LLH-1198) ist eine Datei für Menschen, kein API-Weg.
- **Keine Verwaltung über die API:** Benutzer, Rollen, Anmeldewege, Zugänge und Aufbewahrung
  bleiben Sache der Oberfläche.
- **Kein Lesen abgeschlossener oder archivierter Einsätze.** Das Archiv liest nur
  `/api/aufbewahrung` mit Sitzung.

## Anmeldung für Maschinen (D1, D2)

**Verfahren:** ADR-0014 mit einem eigenen Profil für Fremdsysteme.

| Teil | Instanz (heute) | Fremdsystem (neu) |
| --- | --- | --- |
| Kopf | `Authorization: Instanz <jws>` | `Authorization: Machine <jws>` |
| `typ` | `lifeline-instanz+jwt` | `lifeline-machine+jwt` |
| `kid` | Kennung der Instanz | Kennung des Zugangs (UUID) |
| `aud` | UUID der Instanz | öffentliche Basis-URL der Instanz (`https://hub.example/`) |
| Claims | `iss aud iat exp jti htm htu bh pv` | `iss aud iat exp jti htm htu bh`; die Version steckt im Pfad, `pv` entfällt |
| Antwortsignatur | Pflicht | wird immer mitgeschickt; prüfen ist für den Client freiwillig. Der Schlüssel liegt unter `GET /api/v1/instance/jwks.json`. |
| Lebensdauer, Uhr, `jti` | ≤ 60 s, ± 5 min, Wiederholschutz in der DB | gleich, aber eigene Tabelle |

**Einstieg per Einmal-Code** (ADR-0014):

1. Ein Org-Admin legt unter „Anbindungen“ einen Zugang an. Er vergibt Name, Scopes und optional
   „gültig bis“ und bekommt einen Einmal-Code: 16 Zeichen, 15 Minuten gültig, einmal einlösbar.
2. Das Fremdsystem erzeugt sein Ed25519-Paar und löst den Code mit
   `POST /api/v1/clients/redeem` ein. Es schickt den Suchwert, seinen öffentlichen Schlüssel (JWK)
   und einen Prüfwert über beides. Die Ableitung ist dieselbe wie in `src/instanz/code.rs`, nur mit
   eigenem Salt `lifeline-machine-client/1`. Der Code selbst geht nie über die Leitung.
3. Die Antwort enthält `client_id` (= `kid`), den öffentlichen Schlüssel der Instanz und deren
   Prüfwert. Der Admin sieht danach den Fingerabdruck des gebundenen Schlüssels.
4. **Schlüsselwechsel:** über einen neuen Code für denselben Zugang. Der alte Schlüssel ist
   gesperrt, sobald der neue zum ersten Mal signiert hat.

**Rechte (D2):**

- Die Scopes stehen in einem `wire_enum!`: `situation:read`, `incidents:read`, `events:read`,
  `alarms:write`, `positions:write`, `calculator:use`.
- Ein Extractor prüft vor dem Handler, in dieser Reihenfolge: Signatur, Widerruf und Ablauf, Scope
  der Route, Org. Fehlt der Scope, kommt 403.
- Lese-Scopes mit Einsatzbezug sehen nur die Einsätze, die die Einsatzleitung für diesen Zugang
  freigegeben hat; sonst 404. Die Freigabe endet mit dem Abschluss des Einsatzes.

**Widerruf:**

- Wirkt sofort und ohne Nebenwirkungen, denn der Zugang liegt in einer eigenen Tabelle, nicht in
  `instanz_kopplung`.
- Der Zugang bleibt mit seiner Spur sichtbar. Ein abgelaufener Zugang verhält sich wie ein
  widerrufener.

**Audit und Abrufprotokoll:**

- `admin_audit` bekommt neue Aktionen für Anlegen, Schlüsselbindung, Änderung und Widerruf. Eine
  Migration baut dafür den CHECK neu, nach dem Muster von 0269 und 0301.
- Jeder Abruf zählt je Zugang, Route und Tag: Anzahl sowie erster und letzter Zeitpunkt. Die
  Zählung wird wie `admin_audit` 365 Tage aufbewahrt.
- Herein kommende Meldungen tragen die Zugangs-ID als Herkunft.

**Drosselung:**

- Jeder Zugang hat einen eigenen Token-Bucket. Vorschlag: 60 Anfragen je Minute, beim Einwurf 30.
  Darüber kommt 429 mit `Retry-After`.
- Ein unbekannter `kid` und eine falsche Signatur zählen als Fehlversuch der IP (LFH-604).
- Die Zähler liegen wie die Anmeldesperre im Prozessspeicher (R10).

## Zugänglichkeit (D1)

Sicher heißt hier: kein Geheimnis im Umlauf, und jede Anfrage ist einzeln gebunden. Das kostet den
Client etwa 40 Zeilen Code. Damit das keine Hürde wird, gibt es:

- **Eine Prüfroute** `GET /api/v1/me`. Sie antwortet mit Zugang, Org, Scopes und Serverzeit. Das
  ist der erste Aufruf jeder Anbindung und zeigt eine falsch gehende Uhr sofort.
- **Den Ablehnungsgrund im Admin-Bereich.** Nach außen gibt es immer nur ein schlichtes 401. Die
  Seite „Anbindungen“ zeigt am Zugang den letzten Fehlschlag, etwa „Uhr weicht 7 min ab“, „Body
  passt nicht zu `bh`“ oder „`htu` falsch“ (G7).
- **Referenz-Clients:**
  - eine kleine Rust-Bibliothek, auf der der Lagemonitor aufsetzt;
  - ein TypeScript-Modul für die iuk-suite;
  - ein Python-Beispiel mit etwa 30 Zeilen auf Basis von `cryptography`.
- **Testvektoren in der Doku:** fester Schlüssel, feste Uhrzeit, Anfrage und erwartetes JWS.
- **Kurzer Weg zum Einlösen:** Das Kommando `lifeline-hub client redeem <url> <code>` im Binary
  erzeugt das Schlüsselpaar, löst den Code ein und legt eine Schlüsseldatei ab.

Ein Token-Endpunkt (OAuth2 `private_key_jwt` mit kurzlebigem Access-Token) bleibt möglich, braucht
aber eine eigene ADR. Er kommt erst, wenn ein konkretes Fremdsystem nur OAuth kann.

## Vertrag (D3, D9)

**Präfix:** `/api/v1/`.

- Fremdsysteme nutzen nur diesen Bereich.
- Die Anmeldung für Maschinen wirkt nur dort.
- `CurrentUser` nimmt kein `Authorization: Machine` an.

**OpenAPI:**

- Ein eigenes Dokument (etwa `src/api_doc_v1.rs`) mit `#[utoipa::path]` an den v1-Handlern.
- Ausgeliefert unter `GET /api/v1/openapi.json`, versioniert als `docs/api/public-v1.json`.
- Ein Drift-Test nach dem Muster von `tests/openapi_spec_aktuell.rs` läuft als Schritt in
  `scripts/check-typ-codegen.sh`.
- `src/api_doc.rs` bleibt ohne Pfade (ADR-0004 unverändert).
- Die v1-Typen sind eigene, englisch benannte Schemas. Sie werden nicht aus den internen Typen
  übernommen. So bleibt eine Änderung der internen API ohne Wirkung auf v1.

**Stabilitätszusage:**

- Innerhalb von v1 kommen nur hinzu: neue Routen, neue optionale Felder, neue Scopes.
- Neue Enum-Werte sind erlaubt. Der Vertrag verlangt deshalb, dass Clients unbekannte Werte
  überspringen; das steht im Dokument.
- Entfernen oder Umdeuten heißt `/api/v2/`. v1 bleibt danach mindestens sechs Monate erreichbar und
  meldet `Deprecation` und `Sunset` im Kopf.

**Fehler:** `{"error": "<English message>", "code": "<stable_code>"}`.

- Die Form bleibt die von `tests/fehler_vertrag.rs`; neu ist nur `code`, und der Text ist englisch.
- Vertrag ist nur `code`, nicht der Text.
- Statuscodes nach `src/AGENTS.md`, „Statuscode-Konvention“.

| `code` | Status |
| --- | --- |
| `unauthorized` | 401 |
| `missing_scope` | 403 |
| `not_found` | 404 |
| `invalid_field` | 400 |
| `unprocessable` | 422 |
| `payload_too_large` | 413 |
| `rate_limited` | 429 |
| `cursor_expired` | 410 |
| `not_leading` | 409 (eine andere Instanz führt den Einsatz) |

**Sonst:**

- Feldnamen in `snake_case`, Zeiten als RFC 3339 in UTC (ADR-0012), Zeitpunkte mit Suffix `_at`.
- Bodies höchstens 64 KiB.
- Kein CORS, also keine Browser-Clients von fremden Seiten.
- Die Routen kommen in die Liste der `Zulassung` (`tests/zulassung_guard.rs`).

## Richtung herein (Beispiel: generische Alarmmeldung)

Der Zugang hat den Scope `alarms:write`. Die Felder sind die Normalform aus dem
Schnittstellen-Ausbau (Abschnitt „Alarmübernahme“), mit Namen nach dem Glossar:

| Normalform 10.11. | API v1 |
| --- | --- |
| `externe_id` | `external_id` |
| `art`: `neu`, `nachtrag`, `abbruch`, `abschluss` | `kind`: `new`, `update`, `cancel`, `close` |
| `test` | `test` |
| `einsatznummer` | `dispatch_number` |
| `stichwort` | `keyword` |
| `meldung` | `message` |
| `meldebild` | `situation` |
| `ort` | `location` (`text`, `street`, `house_number`, `postal_code`, `city`) |
| `koordinate` | `coordinate` (`system`: `wgs84`, `utm`, `gk`; benannte Achsen) |
| `alarmzeit` | `alarmed_at` |
| `meldender` | `caller` (`name`, `phone`) |
| `einsatzmittel[]` | `resources[]` (`callsign`, `issi`, `opta`, `fms`, `ric`) |
| `zusatz[]` | `extra[]` (`label`, `value`) |
| `quelle` | aus dem Zugang, nicht im Body |
| `rohdaten` | bleibt am Server, nicht im Body |

```http
POST /api/v1/alarms
Authorization: Machine eyJhbGciOiJFZERTQSIsInR5cCI6ImxpZmVsaW5lLW1hY2hpbmUrand0Iiwia2lkIjoiLi4uIn0.…
Content-Type: application/json

{"external_id": "LS-2026-118833", "kind": "new", "test": false,
 "dispatch_number": "2026118833", "keyword": "RD 2", "message": "Person gestürzt",
 "location": {"street": "Hauptstraße", "house_number": "4", "city": "Musterstadt"},
 "coordinate": {"system": "wgs84", "lat": 52.1, "lon": 9.3},
 "alarmed_at": "2026-11-11T19:02:11Z"}
```

Die Werte bleiben, wie die Leitstelle sie liefert. Nur die Namen auf dem Wire sind englisch.

Claims des JWS:

```json
{"iss": "<client_id>", "aud": "https://hub.example/", "iat": 1794423731,
 "exp": 1794423791, "jti": "q3L…", "htm": "POST",
 "htu": "/api/v1/alarms", "bh": "<SHA-256 des Bodys, base64url>"}
```

Antworten:

| Status | Bedeutung |
| --- | --- |
| `201` | neu angelegt: `{"id": "…", "state": "open"}` |
| `200` | derselbe Schlüssel (Zugang, `external_id`) noch einmal: Nachtrag oder Wiederholung, der Vorschlag wird aktualisiert |
| `401 unauthorized` | Anmeldung gescheitert |
| `403 missing_scope` | Scope fehlt |
| `413 payload_too_large` | Body zu groß |
| `422 unprocessable` | weder `keyword` noch `message` |
| `429 rate_limited` | gedrosselt |

**Fehlerstrategie für den Absender:**

- Bei `5xx`, `429` und Zeitüberschreitung wiederholen, mit Backoff und mit neuem `jti`. Die
  Idempotenz hängt am Schlüssel, nicht am `jti`.
- Bei `4xx` außer `429` nicht wiederholen.
- Die Uhr mit `GET /api/v1/me` prüfen.

## Richtung hinaus: Outbox, Abruf, Webhooks (D4)

**Outbox:**

- Jede Änderung, die ein Ausgangsereignis auslöst, schreibt es **in derselben Transaktion** in
  eine Outbox-Tabelle mit fortlaufender Nummer. Damit geht kein Ereignis verloren, und keines
  entsteht für eine zurückgerollte Änderung.
- Die Outbox steht neben den Live-Strömen und ersetzt sie nicht (ADR-0003). Geschrieben wird an den
  Stellen, die heute `OrgLiveEvent` bzw. `LiveEvent` senden.
- Ereignisse werden sieben Tage aufbewahrt.

**Ereignisse:**

- Sie sind schmal: Art, Zeit und IDs. Die Inhalte holt der Client über die Leserouten, wie die
  eigene Oberfläche (ADR-0003).
- Arten in v1:
  - `incident.created`, `incident.updated` (Kopffelder), `incident.closed`
  - `situation.changed`
  - `alarm.accepted`, `alarm.rejected` (nur für den meldenden Zugang)
- Sichtbar ist ein Ereignis nach Org, Scope und Freigabe.

**Erster Leser: Abruf.** Der Zugang hat den Scope `events:read`.

```http
GET /api/v1/events?after=4711&wait=25
Authorization: Machine …
```

```json
{"cursor": 4714,
 "events": [
   {"id": 4712, "type": "incident.created",  "occurred_at": "2026-11-11T19:04:00Z", "incident_id": "…"},
   {"id": 4713, "type": "situation.changed", "occurred_at": "2026-11-11T19:05:30Z", "incident_id": "…"},
   {"id": 4714, "type": "incident.closed",   "occurred_at": "2026-11-11T21:40:12Z", "incident_id": "…"}]}
```

- `wait` hält den Abruf höchstens 25 s offen, bis etwas Neues da ist. Das ist ein Long-Poll, kein
  dritter Strom.
- Ist der Cursor älter als sieben Tage, antwortet der Server `410 cursor_expired`. Der Client liest
  dann den Stand über `GET /api/v1/incidents` neu ein und beginnt mit dem gelieferten Cursor.
- Ohne Netz holt der Abrufer später nach (G8). Innerhalb der sieben Tage geht nichts verloren.

**Zweiter Leser: Webhooks** (direkt nach dem Abruf):

- Ein Admin legt am Zugang ein Abo an: Ziel-URL über HTTPS, Ereignisarten.
- Ein Hintergrundlauf liefert aus der Outbox je Abo der Reihe nach. Der Body enthält dasselbe
  Ereignis wie der Feed.
- Signiert wird mit dem Instanzschlüssel, als losgelöstes JWS im Kopf `Lifeline-Signature`
  (`typ lifeline-event+jwt`, mit `bh` und `jti`). Geprüft wird über
  `GET /api/v1/instance/jwks.json`. Ein HMAC-Geheimnis gibt es nicht (G3).
- Zustellung:
  - Erfolg ist jede `2xx`-Antwort. Andernfalls wird wiederholt, mit Backoff von 1 min bis 6 h.
  - Nach 24 h ohne Erfolg wird das Abo angehalten. Der Zustand steht im Admin-Bereich (G7), und der
    Empfänger holt per Abruf nach.
- Ausgehende Anfragen laufen über `src/ausgehend.rs` und `src/http_begrenzt.rs`, ohne
  Weiterleitungen. Ziele im LAN gibt es nur als bewusste Ausnahme, wie im Adapter-Rahmen
  (LLH-1632).
- Der Ausgang an Menschen (E-Mail, Fax, Matrix; LLH-1197) ist ein anderer Weg und bleibt davon
  getrennt.

## Einwurf (D5, ADR-0022)

Für Absender, die nicht signieren können: BOSWatch 3 (nur GET mit Platzhaltern), FE2 „URL öffnen“,
der Divera-Webhook und OsmAnd. Ein Beispiel für BOSWatch:

```text
GET https://hub.example/api/v1/ingest/llh_in_Q2x…/alarm?ric={RIC}&subric={SRIC}&text={MSG}
```

- **Schlüssel:** `llh_in_` und 32 Zufallsbytes. Gespeichert wird nur sein SHA-256.
- **Er schreibt nur** in die Ablage seines Scopes (`alarms:write` oder `positions:write`) und nur
  für seine Org.
- **Er liest nichts:** Die Antwort ist `204` oder ein Fehler, ohne Daten.
- **Drosselung:** 30 Anfragen je Minute und Zugang. Ein unbekannter Schlüssel zählt in die
  IP-Sperre.
- **Protokoll:** Der Pfad trägt das Geheimnis. `pfad_fuer_protokoll` (`src/app.rs`) maskiert
  deshalb den Abschnitt nach `/ingest/`. Die Betriebsdoku verlangt dasselbe vom Reverse-Proxy.
- **Widerruf und Wechsel:** Der Zugang ist sofort widerrufbar. Ein Wechsel heißt: neuer Schlüssel,
  der alte wird widerrufen.
- **Audit:** dieselben Aktionen wie beim Maschinenzugang.

## Datenschutz und Aufbewahrung

**Hinaus:**

- Für `/api/v1` gilt die Regel des Lagemonitors (`src/routes/lagemonitor_v1.rs`, Kopf): keine
  Namen, keine Personenkennungen, keine freien Notizen, Zahlen statt Personen.
- Schwärzungen wirken, weil die Lesewege nur aus verdichteten Werten bauen (`verdichte`) und
  abgeschlossene Einsätze gar nicht liefern.
- Ereignisse und Webhooks tragen nur IDs.

**Herein:**

- Rohdaten von Alarmmeldungen können Art.-9-Daten enthalten. Für sie gelten die Fristen aus E5:
  12 h offen, Löschung nach 7 Tagen, bei Annahme werden die Rohdaten sofort gelöscht.
- Positionen gibt es nur im Einsatz und ohne Verlauf (LLH-1199).

**Nachweis:**

- Wer was abgerufen hat, steht im Abrufprotokoll (je Zugang, Route und Tag).
- Wer einen Zugang oder ein Abo angelegt, geändert oder widerrufen hat, steht in `admin_audit`.

## Betrieb

- **Erreichbarkeit:**
  - Am Hub ist die API öffentlich, über TLS hinter dem Reverse-Proxy.
  - Am ELW ist sie nur im LAN oder Tailnet erreichbar. Ein gekoppelter ELW nimmt keine
    Fremdsysteme an; das übernimmt der Hub (D8).
  - Die Basis-URL für `aud` ist die öffentliche Adresse aus der Konfiguration.
- **Uhr:** ± 5 min wie bei Instanzen. `GET /api/v1/me` zeigt die Abweichung.
- **Mehrere Prozesse:** Drosselung, Long-Poll und der Webhook-Lauf liegen im Prozessspeicher bzw.
  in einem Prozess (R10). Ein Betrieb mit mehreren Prozessen hinter einem Lastverteiler ist nicht
  vorgesehen.

## Folgeaufgaben

Angelegt am 11.11.2026 als Unteraufgaben von LLH-1148, in dieser Reihenfolge:

1. **LLH-1652 Maschinenzugang** (Route `entwurf`). Umfang:
   - Tabelle und Einlösen per Code
   - Extractor mit Scopes
   - Drosselung, Audit und Abrufprotokoll
   - Seite „Anbindungen“ mit Ablehnungsgrund
   - `GET /api/v1/me`
   - Referenz-Clients und Testvektoren

   ADR-0021 wird damit akzeptiert.
2. **LLH-1653 Öffentliches OpenAPI-Dokument und Fehlercode** für `/api/v1`, mit Drift-Test und
   Glossar.
3. **LLH-1638 Lagemonitor:** Umstellung auf den Maschinenzugang, Umzug nach
   `/api/v1/situation`, Übergang für `llh_lm_`.
4. **LLH-1654 Einwurf-Zugang** (ADR-0022) mit Maskierung im Protokoll. Ihn brauchen BOSWatch, FE2,
   Divera und OsmAnd.
5. **LLH-1655 Outbox und Ereignis-Abruf** `GET /api/v1/events`, samt Leserouten für Einsätze.
6. **LLH-1656 Webhooks aus der Outbox.**
7. **LLH-1524 Rechner-API** unter `/api/v1/calculators/shelter`, ohne anonymen Zugang.

Außerdem:

- **LLH-1192** (Alarmübernahme) hängt jetzt an LLH-1652 und LLH-1654 statt an LLH-1148.
- **LLH-1197** (Ausgang an Menschen) bleibt von den Webhooks getrennt.
