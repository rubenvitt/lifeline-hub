# Öffentliche API: Anmeldung für Maschinen, Vertrag, Ereignisse

Stand: 11.11.2026 · Konzeptnotiz, kein Code · Zunder LLH-1148
(`https://zunder.rubeen.dev/#/aufgabe/xezfcehktnh276zoal225in0`)

Dieses Dokument schließt LLH-1148 ab. Grundlage sind ADR-0014 (08.11.2026) und die Entscheidungen
E1, E2 und E12 aus [`2026-11-10-schnittstellen-ausbau.md`](2026-11-10-schnittstellen-ausbau.md).
Am 11.11.2026 hat Ruben D2 bis D4 und D9 entschieden; für D1 hat er die Richtung vorgegeben:
„möglichst zugänglich und vor allem sicher“. Die Regeln stehen in zwei ADRs mit Status
`vorgeschlagen`. Akzeptiert werden sie mit der ersten Umsetzung.

- [ADR-0022](../architektur/entscheidungen/ADR-0022-fremdsysteme-sprechen-signiert-mit-der-oeffentlichen-api-v1.md):
  Fremdsysteme und öffentliche API
- [ADR-0023](../architektur/entscheidungen/ADR-0023-absender-ohne-signatur-werfen-ueber-einen-einwurf-zugang-ein.md):
  Einwurf-Zugang

## Ausgangslage im Code

**Anmeldung für Maschinen** gibt es nur für Instanzen (`src/instanz/signatur.rs`,
`src/instanz/extractor.rs`). Für Fremdsysteme lässt sie sich nicht unmittelbar übernehmen:

- Die `typ`-Werte heißen `lifeline-instanz…`.
- `pv` ist an das Kopplungsprotokoll gebunden.
- Freigeschaltet wird erst durch `melden`.
- Ein Widerruf hat Nebenwirkungen auf Spiegel, Stammdaten und Führung
  (`instanz::repo::org_widerrufen`).
- Ein Rechtemodell fehlt; was eine Instanz darf, legen zwei Handler fest.

Weitere Befunde:

- **Signierte Routen sind nicht gedrosselt.** Ein unbekannter `kid` kostet einen DB-Zugriff und
  ergibt 401.
- **Die IP-Sperre gehört der Anmeldung** (`src/auth/rate_limit.rs`, LFH-249): 10 Fehlversuche in
  5 Minuten je Quelle. Hinter einer NAT-IP sitzt oft eine ganze Wache.
- **Zwei Lesewege von außen nutzen Bearer:**
  - `GET /api/lagemonitor/v1/lage` mit `llh_lm_…` (`src/lagemonitor_zugang/mod.rs`): ohne Ablauf
    und ohne Drosselung.
  - `GET /api/extern/v1/lagebild` mit `llh_lb_…` (`src/lagebild_extern/mod.rs`): ein Link für
    Menschen im Browser, mit Ablauf und IP-Sperre.
- **OpenAPI** (`src/api_doc.rs`) kennt nur `components/schemas` (LFH-120). Kein Handler trägt
  `#[utoipa::path]`, `frontend/src/api/openapi.json` enthält `"paths": {}`.
- **Fehler** haben die Form `{"error": "<Text>"}` (`src/error.rs`), ohne maschinenlesbaren Code.
  CORS gibt es nicht. Jeder Body ist auf 256 KiB begrenzt (`JSON_BODY_MAX`, `src/app.rs`).
- **Zeitpunkte** reisen als UTC im Format `zeit::FORMAT` ohne Zonenkennung (ADR-0012).
- **Hinaus** gibt es nur die zwei SSE-Ströme der eigenen Oberfläche (ADR-0003). Sie senden nach dem
  Commit (`src/live/org.rs`). Es gibt keine Outbox und keine Webhook-Zustellung.
  - Ausgehende Abrufe laufen über `src/ausgehend.rs` und `src/http_begrenzt.rs`.
  - Den Schutz vor internen Zielen kennen nur Kartenabruf und Web Push
    (`karte::download::ip_ist_intern`, `src/AGENTS.md`).
- **Abrufprotokolle** gibt es nur einzeln: `lagebild_abruf`, `person_zugriff_audit`,
  `anhang_zugriff_audit` und beim Lagemonitor `zuletzt_genutzt_at`.
- **Eine öffentliche Basis-URL** kennt die Konfiguration nicht (`src/config.rs`).

## Entscheidungen

| Nr. | Frage | Entscheidung |
| --- | --- | --- |
| D1 | Form der Anmeldung | **Ein JWS je Anfrage nach ADR-0014.** Es gibt weder Token-Endpunkt noch Bearer. Die Zugänglichkeit leisten die Hilfen rundherum (Abschnitt „Zugänglichkeit“). Wer gar nicht signieren kann, nutzt den Einwurf (D5). |
| D2 | Rechte | **Feste Scopes je Zugang.** Ein Zugang gehört genau einer Org. Ein Lese-Scope mit Einsatzbezug braucht zusätzlich die Freigabe der Einsatzleitung, wie heute beim Lagemonitor. |
| D3 | Vertrag | **Alles Öffentliche liegt unter `/api/v1/`.** Es hat ein eigenes OpenAPI-Dokument mit Pfaden und eigenem Drift-Test. Nur dort gilt eine Stabilitätszusage; die interne API bleibt ohne Zusage. |
| D4 | Hinaus | **Eine Outbox von Anfang an.** Ausgangsereignisse werden in derselben Transaktion wie die Änderung geschrieben. Erster Leser ist der Abruf `GET /api/v1/events`. Zweiter Leser sind Webhooks; sie kommen direkt danach und werden mit dem Instanzschlüssel signiert, nicht per HMAC. |
| D5 | Absender ohne Signatur | **Einwurf-Zugang** (E1 vom 10.11.): ein geheimer Schlüssel im Pfad, der nur in eine Ablage schreibt. Festgehalten als **ADR-0023**, weil die Nummer 0015 schon vergeben war. |
| D6 | Lagemonitor | Er wird auf D1 umgestellt (E2, LLH-1638) und zieht nach `GET /api/v1/lage` um. Der alte Pfad bleibt eine Übergangszeit lang. |
| D7 | Lagebild-Link | Der Lagebild-Link (`llh_lb_`) ist **kein Maschinenzugang**, sondern ein Link für Menschen ohne Konto. Er bleibt, wie er ist, und gehört nicht zu `/api/v1`. |
| D8 | Mehrere Instanzen | Eingehendes kommt am Hub an. Eine ungekoppelte Instanz verhält sich wie ein Hub (G5, Entscheidung 12 der Instanzkopplung). An einem Spiegel antwortet ein Schreibweg wie bisher mit 409. |
| D9 | Sprache | **Auf dem Wire gilt dieselbe Regel wie im Code**, siehe Wurzel-`AGENTS.md`, „Bezeichner-Sprache“ (LFH-1312): Fachbegriffe deutsch, alles andere englisch. Fehlertexte sind Prosa und bleiben deutsch; Vertrag ist der englische `code`. |

## Namen auf dem Wire (D9)

| Art | Deutsch, weil Fachbegriff | Englisch, weil Technik |
| --- | --- | --- |
| Pfade | `lage`, `einsaetze`, `alarmmeldungen`, `positionen`, `rechner/unterkunft`, `einwurf`, `zugang`, `instanz` | `v1`, `me`, `events`, `redeem`, `jwks.json`, `openapi.json` |
| Scopes | `lage`, `einsaetze`, `alarmmeldungen`, `positionen`, `rechner` | `:read`, `:write`, `:use`, `events` |
| Ereignisse | `einsatz`, `lage`, `alarmmeldung` | `.created`, `.updated`, `.closed`, `.changed`, `.accepted`, `.rejected` |
| Felder | `stichwort`, `meldung`, `einsatznummer`, `meldender`, `einsatzmittel`, `einsatz_id`, `alarmiert_at` | `id`, `external_id`, `is_test`, `cursor`, `type`, `occurred_at`, `state`, `kind` |
| Abfrage | – | `after`, `wait` |
| Kopf, `typ` | – | `Authorization: Machine`, `lifeline-machine+jwt`, `Lifeline-Signature` |
| Fehler | Text (Prosa) | `code` |

Im Zweifel gilt dasselbe wie im Code: deutsch, wenn die Oberfläche dasselbe Wort zeigt. Die
Tabelle kommt als Kurzfassung in die Beschreibung des v1-Dokuments.

## Zweck und Abgrenzung

**Was die API trägt (v1):**

| Scope | Richtung | Route (Entwurf) | Prüfstein |
| --- | --- | --- | --- |
| `lage:read` | hinaus | `GET /api/v1/lage` (Inhalt wie heute `lagemonitor_v1`) | Lagemonitor (Rust), LLH-1638 |
| `einsaetze:read` | hinaus | `GET /api/v1/einsaetze`, `GET /api/v1/einsaetze/{id}` | Einsatzkopf fürs Einsatzbuch der iuk-suite (TypeScript) |
| `events:read` | hinaus | `GET /api/v1/events?after=…` | iuk-suite |
| `alarmmeldungen:write` | herein | `POST /api/v1/alarmmeldungen` (Normalform aus dem Schnittstellen-Ausbau) | Adapter, LLH-1192 |
| `positionen:write` | herein | `POST /api/v1/positionen` | Traccar/Brücke, LLH-1199 |
| `rechner:use` | beides | `POST /api/v1/rechner/unterkunft` | LLH-1524 |

**Was bewusst draußen bleibt:**

- **Kein Einsatz ohne Menschen (G1).** Eine Maschine legt keinen Einsatz an und schreibt nicht in
  Einsatzdaten. Herein kommen nur Vorschläge in eine Ablage, die ein Mensch übernimmt.
- **Keine Personen- und Gesundheitsdaten hinaus.** Dazu zählen Namen, Personenkennungen, freie
  Notizen, Sichtung, Verletzungen und Maßnahmen. Ein Export für die Personenauskunft (LLH-1198) ist
  eine Datei für Menschen, kein API-Weg. Herein gilt G6: Was Lifeline Hub nicht braucht, nimmt es
  nicht an.
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
| `aud` | UUID der Instanz | ebenfalls UUID der Instanz, mitgeteilt beim Einlösen |
| Claims | `iss aud iat exp jti htm htu bh pv` | `iss aud iat exp jti htm htu bh`; die Version steckt im Pfad, `pv` entfällt |
| Antwortsignatur | Pflicht | wird immer mitgeschickt, Prüfung durch den Client freiwillig; der Schlüssel kommt beim Einlösen und steht unter `GET /api/v1/instanz/jwks.json` |
| Lebensdauer, Uhr, `jti` | ≤ 60 s, ± 5 min, Wiederholschutz in der DB | gleich, aber eigene Tabelle |

Geprüft wird in einem Extractor nach `FromRequest`, weil `bh` den Body braucht. Muster ist
`GekoppelteInstanz`.

**Einstieg per Einmal-Code** (ADR-0014):

1. Ein Org-Admin legt unter „Anbindungen“ einen Zugang an: Name, Scopes, optional „gültig bis“.
   Er bekommt einen Einmal-Code mit 16 Zeichen, 15 Minuten gültig, nur einmal einlösbar.
2. Das Fremdsystem erzeugt sein Ed25519-Paar und löst den Code mit `POST /api/v1/zugang/redeem`
   ein. Es schickt den Suchwert, seinen öffentlichen Schlüssel (JWK) und einen Prüfwert über
   beides. Die Ableitung entspricht `src/instanz/code.rs`, nur mit eigenem Salt
   `lifeline-machine-client/1`. Der Code selbst geht nie über die Leitung.
3. Die Antwort enthält `zugang_id` (= `kid`), die Instanz-UUID (= `aud`), den öffentlichen
   Schlüssel der Instanz und deren Prüfwert. Der Client legt diesen Schlüssel fest ab. Der Admin
   sieht danach den Fingerabdruck des gebundenen Schlüssels.
4. Schlüsselwechsel: über einen neuen Code für denselben Zugang. Der alte Schlüssel ist gesperrt,
   sobald der neue zum ersten Mal signiert hat.

**Rechte (D2):**

- Die Scopes stehen in einem `wire_enum!`: `lage:read`, `einsaetze:read`, `events:read`,
  `alarmmeldungen:write`, `positionen:write`, `rechner:use`.
- Der Extractor prüft vor dem Handler, in dieser Reihenfolge: Signatur, Widerruf und Ablauf, Scope
  der Route, Org.
- Eine gescheiterte Anmeldung ergibt immer 401 ohne Grund, ein fehlender Scope 403.
- Lese-Scopes mit Einsatzbezug sehen nur Einsätze, die die Einsatzleitung für diesen Zugang
  freigegeben hat, sonst 404. Die Freigabe endet mit dem Abschluss des Einsatzes.

**Widerruf:**

- Er wirkt sofort und ohne Nebenwirkungen, weil die Zugänge in einer eigenen Tabelle liegen, nicht
  in `instanz_kopplung`.
- Der Zugang bleibt mit Spur sichtbar. Ein abgelaufener Zugang verhält sich wie ein widerrufener.

**Audit und Abrufprotokoll:**

- `admin_audit` bekommt neue Aktionen für Anlegen, Schlüsselbindung, Änderung und Widerruf. Die
  Migration baut den CHECK neu, nach dem Muster von 0269 und 0301.
- Jeder Abruf zählt je Zugang, Route und Tag: Anzahl, erster und letzter Zeitpunkt. Aufbewahrt wird
  das wie `admin_audit` 365 Tage.
- Herein kommende Meldungen tragen die Zugangs-ID als Herkunft.

**Drosselung:**

- **Je Zugang** ein Token-Bucket, Vorschlag 60 Anfragen je Minute (Einwurf 30). Darüber kommt 429
  mit `Retry-After`.
- **Je IP ein eigener Zähler für Maschinen**, getrennt von der Anmeldesperre (LFH-249). Er zählt
  nur unbekannte `kid`, unbekannte Einwurf-Schlüssel und gescheiterte Einlösungen.
  - Eine falsche Signatur oder Uhr eines *bekannten* Zugangs zählt dort nicht, sondern nur am
    Zugang (Ablehnungsgrund). Sonst sperrte ein Gerät mit falscher Uhr die ganze Wache hinter
    derselben NAT-IP von der Anmeldung aus.
- Die Zähler liegen wie die Anmeldesperre im Prozessspeicher (R10).

## Zugänglichkeit (D1)

„Sicher“ heißt hier: Kein Geheimnis ist im Umlauf, und jede Anfrage ist einzeln gebunden. Das kostet
den Client etwa 40 Zeilen Code. Damit das keine Hürde wird, gibt es:

- **Eine Prüfroute** `GET /api/v1/me`. Sie antwortet mit Zugang, Org, Scopes und Serverzeit. Sie
  ist der erste Aufruf jeder Anbindung und zeigt eine falsch gehende Uhr sofort.
- **Den Ablehnungsgrund im Admin-Bereich.** Nach außen gibt es nur ein schlichtes 401. Am Zugang
  zeigt die Seite „Anbindungen“ den letzten Fehlschlag (G7), etwa „Uhr weicht 7 min ab“, „Body passt
  nicht zu `bh`“ oder „`htu` falsch“.
- **Referenz-Clients:** eine kleine Rust-Bibliothek (Grundlage des Lagemonitors), ein
  TypeScript-Modul für die iuk-suite und ein Python-Beispiel mit etwa 30 Zeilen auf `cryptography`.
- **Testvektoren in der Doku:** fester Schlüssel, feste Uhrzeit, Anfrage und erwartetes JWS.
- **Kurzer Weg zum Einlösen:** Das Kommando `lifeline-hub zugang redeem <url> <code>` im Binary
  erzeugt das Schlüsselpaar, löst den Code ein und legt eine Schlüsseldatei ab.

Ein Token-Endpunkt (OAuth2 `private_key_jwt` → kurzlebiges Access-Token) bleibt möglich. Er braucht
eine eigene ADR und kommt erst, wenn ein konkretes Fremdsystem nur OAuth kann.

## Vertrag (D3, D9)

**Präfix:** `/api/v1/`.

- Fremdsysteme nutzen nur diesen Bereich, und die Anmeldung für Maschinen wirkt nur dort.
- `CurrentUser` nimmt kein `Authorization: Machine` an.
- Ohne Anmeldung erreichbar sind nur:
  - `POST /api/v1/zugang/redeem`, mit dem Maschinenzähler je IP;
  - `GET /api/v1/instanz/jwks.json`;
  - `GET /api/v1/openapi.json`;
  - der Einwurf (ADR-0023).

**OpenAPI:**

- Es gibt ein eigenes Dokument, etwa `src/api_doc_v1.rs`, mit `#[utoipa::path]` an den
  v1-Handlern.
  - Ausgeliefert unter `GET /api/v1/openapi.json`.
  - Versioniert als `docs/api/public-v1.json`.
  - Ein Drift-Test nach dem Muster von `tests/openapi_spec_aktuell.rs` läuft als Schritt in
    `scripts/check-typ-codegen.sh`.
- `src/api_doc.rs` bleibt die Typquelle des Frontends ohne Pfade (LFH-120).
- Die v1-Typen sind eigene Schemas. So wirkt eine Änderung der internen API nicht auf v1.

**Stabilitätszusage:**

- Innerhalb von v1 kommen nur hinzu: neue Routen, neue optionale Felder und neue Scopes.
- Neue Enum-Werte sind erlaubt. Der Vertrag verlangt deshalb, dass Clients unbekannte Werte
  überspringen; das steht im Dokument.
- Entfernen oder Umdeuten heißt `/api/v2/`. v1 bleibt dann mindestens sechs Monate erreichbar und
  meldet `Deprecation` und `Sunset` im Kopf.

**Fehler:** `{"error": "<Text>", "code": "<stable_code>"}`.

- Die Form bleibt die von `tests/fehler_vertrag.rs`; neu ist nur `code`.
- Vertrag ist `code`. Der Text ist Prosa wie bisher.
- Statuscodes nach `src/AGENTS.md`, „Statuscode-Konvention“.

| `code` | Status |
| --- | --- |
| `unauthorized` | 401 |
| `missing_scope` | 403 |
| `tls_required` | 403 (Einwurf ohne TLS) |
| `not_found` | 404 |
| `invalid_field` | 400 |
| `unprocessable` | 422 |
| `payload_too_large` | 413 |
| `rate_limited` | 429 |
| `cursor_expired` | 410 |
| `fuehrung_elsewhere` | 409 (eine andere Instanz führt den Einsatz) |

**Sonst:**

- Felder in `snake_case`.
- Zeitpunkte in UTC im Format `zeit::FORMAT` (`2026-11-11 19:02:11`) mit Suffix `_at` (ADR-0012).
  Das Dokument nennt die Zone ausdrücklich. Ein Absender mit Zonenangabe rechnet im Adapter um.
- Bodies höchstens 64 KiB.
- Antworten tragen `Cache-Control: no-store`.
- Kein CORS, also keine Browser-Clients von fremden Seiten.
- Die v1-Routen unterliegen der Zulassung wie jede Route. Der Long-Poll liegt mit 25 s unter
  `REQUEST_BUDGET` (`src/zulassung.rs`) und braucht keine Ausnahme.

## Richtung herein (Beispiel: generische Alarmmeldung)

Der Zugang hat den Scope `alarmmeldungen:write`. Die Felder stammen aus der Normalform des
Schnittstellen-Ausbaus (Abschnitt „Alarmübernahme“). Technische Namen sind englisch:

| Normalform 10.11. | API v1 |
| --- | --- |
| `externe_id` | `external_id` |
| – (neu) | `message_id` je Meldung, `sequence` optional |
| `art` mit `neu`, `nachtrag`, `abbruch`, `abschluss` | `kind` mit denselben Werten |
| `test` | `is_test` |
| `einsatznummer`, `stichwort`, `meldung`, `meldebild` | unverändert |
| `ort` | `ort` (`text`, `strasse`, `hausnummer`, `plz`, `gemeinde`) |
| `koordinate` | `koordinate` (`system`: `wgs84`, `utm`, `gk`; benannte Achsen) |
| `alarmzeit` | `alarmiert_at` |
| `meldender` | `meldender` (`name`, `telefon`) |
| `einsatzmittel[]` | `einsatzmittel[]` (`funkrufname`, `issi`, `opta`, `fms`, `ric`) |
| `zusatz[]` | `zusatz[]` (`bezeichnung`, `wert`) |
| `quelle` | kommt aus dem Zugang, nicht aus dem Body |
| `rohdaten` | bleibt am Server, nicht im Body |

```http
POST /api/v1/alarmmeldungen
Authorization: Machine eyJhbGciOiJFZERTQSIsInR5cCI6ImxpZmVsaW5lLW1hY2hpbmUrand0Iiwia2lkIjoiLi4uIn0.…
Content-Type: application/json

{"external_id": "LS-2026-118833", "kind": "neu", "is_test": false,
 "einsatznummer": "2026118833", "stichwort": "RD 2", "meldung": "Person gestürzt",
 "ort": {"strasse": "Hauptstraße", "hausnummer": "4", "gemeinde": "Musterstadt"},
 "koordinate": {"system": "wgs84", "lat": 52.1, "lon": 9.3},
 "alarmiert_at": "2026-11-11 19:02:11"}
```

Claims des JWS (`aud` ist die Instanz-UUID aus dem Einlösen):

```json
{"iss": "<zugang_id>", "aud": "<instanz_id>", "iat": 1794423731,
 "exp": 1794423791, "jti": "q3L…", "htm": "POST",
 "htu": "/api/v1/alarmmeldungen", "bh": "<SHA-256 des Bodys, base64url>"}
```

**Antworten:**

| Status | Bedeutung |
| --- | --- |
| `201` | neu: `{"id": "…", "state": "offen"}` |
| `200` | bekannter Vorschlag (Zugang, `external_id`): Nachtrag übernommen oder Wiederholung erkannt, siehe unten |
| `401 unauthorized` | Anmeldung gescheitert |
| `403 missing_scope` | Scope fehlt |
| `413 payload_too_large` | Body zu groß |
| `422 unprocessable` | weder `stichwort` noch `meldung` |
| `429 rate_limited` | gedrosselt |

**Idempotenz und Reihenfolge:**

- Der Vorschlag hängt am Schlüssel (Zugang, `external_id`).
- Jede einzelne Meldung dazu erkennt der Server an ihrer `message_id`, die der Absender bei
  Retries gleich lässt. Eine wiederholte Meldung ändert nichts und antwortet `200`. Damit
  überschreibt ein verspäteter Retry der Erstmeldung keinen inzwischen verarbeiteten Nachtrag.
  Eine neue Meldung mit gleichem Inhalt, aber neuer `message_id` wird übernommen.
- Ohne `message_id` dient der Hash des Bodys als Ersatz. Dann ist ein Fall mehrdeutig: Kommt nach
  den Meldungen A und B wieder A, kann der Server einen späten Retry nicht von einer bewussten
  Rückkehr zu A unterscheiden. Er übernimmt A dann nicht, vermerkt sie aber im Verlauf und zeigt am
  Vorschlag den Hinweis „Meldung entspricht einer früheren“. So entscheidet ein Mensch, nichts
  geht still verloren. Die Doku empfiehlt Absendern deshalb `message_id` oder `sequence`.
- Liefert der Absender eine fortlaufende `sequence` je `external_id`, wird eine Meldung mit
  kleinerer `sequence` als die zuletzt übernommene nur in den Verlauf gelegt und nicht übernommen.
  Ohne `sequence` gilt die Reihenfolge des Eingangs.
- Jede Meldung bleibt im Verlauf des Vorschlags, bis die Fristen aus E5 sie löschen.
- Hash, Verlauf und Änderung des Vorschlags werden in einer Transaktion geschrieben.
- Ohne `external_id` gilt die Regel des Einwurfs (siehe unten): Wiederholungen werden am Vorschlag
  vermerkt, nie still verworfen.

**Fehlerstrategie für den Absender:**

- Bei `5xx`, `429` und Zeitüberschreitung wiederholt er mit Backoff und neuem `jti`. Die
  Idempotenz hängt an `external_id` und `message_id`, nicht am `jti`. Deshalb gilt sie auch für
  Retries nach Stunden.
- Ein Absender ohne `external_id` hat keine dauerhafte Idempotenz. Er wiederholt höchstens
  2 Minuten lang (siehe Einwurf).
- Bei `4xx` außer `429` wiederholt er nicht.
- Die Uhr prüft er mit `GET /api/v1/me`.

## Richtung hinaus: Outbox, Abruf, Webhooks (D4)

**Outbox:**

- Jede Änderung, die ein Ausgangsereignis auslöst, schreibt es **in derselben Transaktion** in
  eine Outbox-Tabelle mit fortlaufender Nummer. Damit geht kein Ereignis verloren, und keines
  entsteht für eine zurückgerollte Änderung.
- Geschrieben wird in den `_tx`-Funktionen der Repos. Die Stellen, die heute nach dem Commit
  `LiveEvent` oder `OrgLiveEvent` senden, sind dafür zu spät.
- Die Outbox steht neben den Live-Strömen und ersetzt sie nicht (ADR-0003). Sie bewahrt Einträge
  sieben Tage auf.

**Ereignisse:**

- Sie sind schmal: Art, Zeit und IDs. Die Inhalte holt der Client über die Leserouten, wie die
  eigene Oberfläche (ADR-0003).
- Arten in v1: `einsatz.created`, `einsatz.updated` (Kopffelder), `einsatz.closed`,
  `lage.changed`, `alarmmeldung.accepted` und `alarmmeldung.rejected` (die beiden letzten nur für
  den meldenden Zugang).
- Sichtbar ist ein Ereignis nach Org, Scope und Freigabe.

**Erster Leser, der Abruf** (Scope `events:read`):

```http
GET /api/v1/events?after=4711&wait=25
Authorization: Machine …
```

```json
{"cursor": 4714,
 "events": [
   {"id": 4712, "type": "einsatz.created", "occurred_at": "2026-11-11 19:04:00", "einsatz_id": "…"},
   {"id": 4713, "type": "lage.changed",    "occurred_at": "2026-11-11 19:05:30", "einsatz_id": "…"},
   {"id": 4714, "type": "einsatz.closed",  "occurred_at": "2026-11-11 21:40:12", "einsatz_id": "…"}]}
```

- `wait` hält den Abruf höchstens 25 s offen, bis etwas Neues da ist. Das ist ein Long-Poll, kein
  dritter Strom.
- **Begrenzung der wartenden Abrufe:** Jeder wartende Abruf belegt einen Platz der Zulassung
  (`MAX_GLEICHZEITIGE_REQUESTS`, `src/zulassung.rs`).
  - Höchstens 32 Abrufe warten gleichzeitig, je Zugang höchstens einer.
  - Darüber antwortet der Abruf sofort, ohne zu warten, und setzt `Retry-After: 10`. Der Client
    wartet so lange vor dem nächsten Abruf und läuft nicht in seine Drosselung. Schreibanfragen
    behalten so ihre Plätze.
- Ist der Cursor älter als sieben Tage, kommt `410 cursor_expired`. Der Client liest dann den
  Stand über `GET /api/v1/einsaetze` neu und fängt mit dem gelieferten Cursor wieder an.
- Ohne Netz holt der Abrufer später nach (G8). Innerhalb der sieben Tage geht nichts verloren.

**Zweiter Leser, die Webhooks** (direkt nach dem Abruf):

- **Abo:** Ein Admin legt es am Zugang an, mit Ziel-URL (nur HTTPS) und Ereignisarten.
- **Zustellung:** Ein Hintergrundlauf liefert je Abo der Reihe nach aus der Outbox. Der Body ist
  dasselbe Ereignis wie im Feed.
- **Signatur:**
  - Ein losgelöstes JWS im Kopf `Lifeline-Signature` (`typ lifeline-event+jwt`), signiert mit dem
    Instanzschlüssel.
  - Claims: `iss` (Instanz), `aud` (Abo-ID), `iat`, `exp` (≤ 5 min), `jti` und `bh`.
  - Wegen `aud` kann ein Empfänger ein signiertes Ereignis nicht an einen anderen Empfänger
    weiterreichen, der es als echt annähme.
  - Der Empfänger prüft gegen den Schlüssel, den er beim Einlösen bekommen hat. `jwks.json` dient
    nur dem Schlüsselwechsel.
  - Ein HMAC-Geheimnis gibt es nicht (G3).
- **Wiederholung:**
  - Als Erfolg zählt jede `2xx`-Antwort. Sonst wiederholt der Lauf mit Backoff von 1 min bis 6 h.
  - Nach 24 h ohne Erfolg hält er das Abo an. Der Admin-Bereich zeigt den Zustand (G7), und der
    Empfänger holt per Abruf nach.
- **Schutz vor internen Zielen:**
  - Die Zieladresse wird aufgelöst, und interne Adressen werden abgelehnt
    (`karte::download::ip_ist_intern`, mit festgehaltener Auflösung wie im Kartenabruf).
  - Weiterleitungen folgt der Lauf nicht. Ausgehend geht es über `src/ausgehend.rs` und
    `src/http_begrenzt.rs`.
  - Ein Ziel im LAN gibt es nur als bewusste Ausnahme am Abo, wie im Adapter-Rahmen (LLH-1632).
- **Abgrenzung:** Der Ausgang an Menschen (E-Mail, Fax, Matrix; LLH-1197) ist ein anderer Weg.

## Einwurf (D5, ADR-0023)

Gedacht für Absender, die nicht signieren können: BOSWatch 3 (nur GET mit Platzhaltern), FE2 mit
„URL öffnen“, den Divera-Webhook und OsmAnd. Ein Beispiel für BOSWatch:

```text
GET https://hub.example/api/v1/einwurf/llh_ew_Q2x…/alarmmeldung?ric={RIC}&subric={SRIC}&text={MSG}
```

- **Schlüssel:**
  - Er besteht aus `llh_ew_` und 32 Zufallsbytes; gespeichert wird nur sein SHA-256.
  - Ein „gültig bis“ ist optional.
  - Widerruf wirkt sofort. Wechsel heißt: neuer Schlüssel, der alte wird widerrufen.
- **Rechte:**
  - Er schreibt nur in die Ablage seines Scopes (`alarmmeldungen:write` oder `positionen:write`)
    und nur für seine Org.
  - Er liest nichts. Die Antwort ist `204` oder ein Fehler, ohne Daten.
- **Doppelte Einwürfe:** Ein wiederholter Aufruf legt keinen zweiten Vorschlag an, verschwindet
  aber auch nicht still.
  - Fehlt eine `external_id`, gelten gleicher Zugang, gleicher Inhalt und höchstens 2 Minuten
    Abstand als Wiederholung. Sie wird am bestehenden Vorschlag als „erneut empfangen“ mit Zeit
    vermerkt (Zähler). POCSAG wiederholt Alarme absichtlich.
  - Zwei echte Alarme mit gleichem Inhalt lassen sich ohne Kennung nicht unterscheiden. Der
    Mensch sieht deshalb am Vorschlag, wie oft und wann er kam, und kann daraus einen zweiten
    Einsatz anlegen.
  - Kommt derselbe Inhalt erst nach mehr als 2 Minuten, etwa als später Retry, entsteht ein neuer
    Vorschlag mit dem Hinweis „möglicherweise derselbe Alarm“ und einem Verweis auf den früheren.
    Ein Mensch führt beide mit einem Klick zusammen. Ein nur ähnlicher Inhalt ergibt denselben
    Hinweis (Schnittstellen-Ausbau).
- **Nur über TLS:**
  - Der Einwurf nimmt Aufrufe nur an, wenn sie verschlüsselt ankommen: direkt mit `--tls` oder
    vom vertrauten Proxy mit `X-Forwarded-Proto: https` (`weitergeleitet_als_https`,
    `src/auth/session.rs`). Sonst antwortet er `403` mit dem Code `tls_required`.
  - Reines HTTP gibt es nur mit einem ausdrücklichen Schalter des Betreibers für ein Tailnet, das
    selbst verschlüsselt. Dann warnt der Admin-Bereich.
- **Kein Cache:** Antworten tragen `Cache-Control: no-store`. Sonst könnte ein Cache die
  `204`-Antwort eines GET wiederverwenden, und ein späterer Einwurf mit derselben URL ginge
  verloren.
- **Drosselung:** 30 Aufrufe je Minute und Zugang. Ein unbekannter Schlüssel zählt im
  Maschinenzähler je IP, nicht in der Anmeldesperre.
- **Protokolle:**
  - Der Pfad trägt das Geheimnis. `pfad_fuer_protokoll` (`src/app.rs`) maskiert deshalb den
    Abschnitt nach `/einwurf/`. Die Abfrage schreibt der Server ohnehin nicht ins Protokoll.
  - Bei GET stehen Schlüssel und Alarmtext (möglicherweise Art.-9-Daten) in der URL. Die
    Betriebsdoku verlangt deshalb vom Reverse-Proxy, Pfad und Abfrage unter `/api/v1/einwurf/` nicht
    zu protokollieren.
  - Wo der Absender POST kann, nimmt er POST.
- **Audit:** dieselben Aktionen wie beim Maschinenzugang.
- **Verhältnis zu ADR-0014:** Der Einwurf ist eine Ausnahme zu dessen Regel, dass jede Maschine ein
  Schlüsselpaar hat. ADR-0014 ist akzeptiert und damit unveränderlich. Wenn ADR-0023 akzeptiert
  wird (LLH-1654), braucht ADR-0014 deshalb eine Nachfolgerin mit `ersetzt: ADR-0014`, die den
  Einwurf als Ausnahme nennt.

## Datenschutz und Aufbewahrung

- **Hinaus:**
  - Für `/api/v1` gilt die Regel des Lagemonitors (`src/routes/lagemonitor_v1.rs`, Kopf): keine
    Namen, keine Personenkennungen, keine freien Notizen, Zahlen statt Personen.
  - Schwärzungen wirken, weil die Lesewege nur aus verdichteten Werten bauen (`verdichte`) und
    abgeschlossene Einsätze gar nicht liefern.
  - Ereignisse und Webhooks tragen nur IDs.
- **Herein:**
  - Rohdaten von Alarmmeldungen können Art.-9-Daten enthalten. Es gelten die Fristen aus E5:
    12 h offen, Löschung nach 7 Tagen, bei Annahme werden die Rohdaten sofort gelöscht.
  - Positionen gibt es nur im Einsatz und ohne Verlauf (LLH-1199).
- **Nachweis:**
  - Wer was abgerufen hat, steht im Abrufprotokoll.
  - Wer einen Zugang oder ein Abo angelegt, geändert oder widerrufen hat, steht in `admin_audit`.

## Betrieb

- **Erreichbarkeit:**
  - Am Hub öffentlich, über TLS hinter dem Reverse-Proxy.
  - Am ELW nur im LAN oder Tailnet. Der Einwurf verlangt auch dort TLS (siehe Einwurf).
    Signierte Anfragen verraten ohne TLS kein wiederverwendbares Geheimnis. Ihre Inhalte liest man
    dann aber mit, deshalb gilt auch für sie: TLS, wo es geht.
  - Ein gekoppelter ELW nimmt keine Fremdsysteme an; das übernimmt der Hub (D8).
- **Uhr:** ± 5 min wie bei Instanzen. `GET /api/v1/me` zeigt die Abweichung.
- **Mehrere Prozesse:** Drosselung, Long-Poll und Webhook-Lauf leben in einem Prozess (R10). Mehrere
  Prozesse hinter einem Lastverteiler sind nicht vorgesehen.

## Folgeaufgaben

Am 11.11.2026 als Unteraufgaben von LLH-1148 angelegt, in dieser Reihenfolge:

1. **LLH-1652 Maschinenzugang** (Route `entwurf`). ADR-0022 wird damit akzeptiert. Umfang:
   - Tabelle und Einlösen per Code
   - Extractor mit Scopes
   - Drosselung mit eigenem Zähler
   - Audit und Abrufprotokoll
   - Seite „Anbindungen“ mit Ablehnungsgrund
   - `GET /api/v1/me`
   - Referenz-Clients und Testvektoren
2. **LLH-1653 Öffentliches OpenAPI-Dokument und Fehlercode** für `/api/v1`, mit Drift-Test.
3. **LLH-1638 Lagemonitor:** Umstellung auf den Maschinenzugang, Umzug nach `/api/v1/lage`,
   Übergang für `llh_lm_`.
4. **LLH-1654 Einwurf-Zugang** (ADR-0023) mit Maskierung, Doppelerkennung und Nachfolgerin für
   ADR-0014. Ihn brauchen BOSWatch, FE2, Divera und OsmAnd.
5. **LLH-1655 Outbox und Ereignis-Abruf** `GET /api/v1/events`, samt Leserouten für Einsätze.
6. **LLH-1656 Webhooks aus der Outbox.**
7. **LLH-1524 Rechner-API** unter `/api/v1/rechner/unterkunft`, ohne anonymen Zugang.

Außerdem:

- **LLH-1192** (Alarmübernahme) hängt jetzt an LLH-1652 und LLH-1654 statt an LLH-1148.
- **LLH-1197** (Ausgang an Menschen) bleibt von den Webhooks getrennt.
