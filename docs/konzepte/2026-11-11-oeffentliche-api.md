# Öffentliche API: Anmeldung für Maschinen, Vertrag, Ereignisse

Stand: 11.11.2026 · Konzeptnotiz, kein Code · Zunder LLH-1148
(`https://zunder.rubeen.dev/#/aufgabe/xezfcehktnh276zoal225in0`)

Dieses Dokument schließt LLH-1148 ab. Vorgaben dafür sind ADR-0014 (08.11.2026) und die
Entscheidungen E1, E2 und E12 aus [`2026-11-10-schnittstellen-ausbau.md`](2026-11-10-schnittstellen-ausbau.md).
Die Fragen D2 bis D4 hat Ruben am 11.11.2026 entschieden. Bei D1 hat er die Richtung vorgegeben:
„möglichst zugänglich und vor allem sicher“. Die Regeln stehen in zwei ADRs mit Status
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
  - Ein Widerruf hat Nebenwirkungen auf Spiegel, Stammdaten und Führung (`instanz::repo::org_widerrufen`).
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
- **Fehler** haben die Form `{"error": "<deutscher Text>"}` (`src/error.rs`), ohne maschinenlesbaren
  Code. CORS gibt es nicht, und jeder Body ist auf 256 KiB begrenzt (`JSON_BODY_MAX`, `src/app.rs`).
- **Hinaus** gibt es nur die zwei SSE-Ströme der eigenen Oberfläche (ADR-0003). Eine Outbox, eine
  Webhook-Warteschlange und einen Wiederholungsdienst gibt es nicht. Ausgehende Abrufe laufen über
  `src/ausgehend.rs` und `src/http_begrenzt.rs`.
- **Abrufprotokolle** gibt es nur einzeln: `lagebild_abruf`, `person_zugriff_audit`,
  `anhang_zugriff_audit` und beim Lagemonitor `zuletzt_genutzt_at`.

## Entscheidungen

| Nr. | Frage | Entscheidung |
| --- | --- | --- |
| D1 | Form der Anmeldung | **Ein JWS je Anfrage nach ADR-0014**, kein Token-Endpunkt und kein Bearer. Zugänglich wird es durch das Drumherum (Abschnitt „Zugänglichkeit“). Wer gar nicht signieren kann, nutzt den Einwurf (D5). |
| D2 | Rechte | **Feste Zwecke je Zugang.** Ein Zugang gehört genau einer Org. Ein Lesezweck mit Einsatzbezug braucht zusätzlich die Freigabe der Einsatzleitung, wie heute beim Lagemonitor. |
| D3 | Vertrag | **Alles Öffentliche liegt unter `/api/v1/`** und hat ein eigenes OpenAPI-Dokument mit Pfaden und eigenem Drift-Test. Nur dort gilt eine Stabilitätszusage. Die interne API bleibt ohne Zusage. |
| D4 | Hinaus | **Zuerst als Abruf:** ein Ereignis-Feed `GET /api/v1/ereignisse`. Webhooks kommen später über den Ausgang (LLH-1197) und werden mit dem Instanzschlüssel signiert, nicht per HMAC. |
| D5 | Absender ohne Signatur | **Einwurf-Zugang** (E1 vom 10.11.): ein geheimer Schlüssel im Pfad, der nur in eine Ablage schreibt. Festgehalten als **ADR-0022**; die Nummer 0015 war schon vergeben. |
| D6 | Lagemonitor | Er wird auf D1 umgestellt (E2, LLH-1638) und zieht nach `/api/v1/lage` um. Der alte Pfad bleibt eine Übergangszeit. |
| D7 | Lagebild-Link | Der Lagebild-Link (`llh_lb_`) ist **kein Maschinenzugang**, sondern ein Link für Menschen ohne Konto. Er bleibt, wie er ist, und gehört nicht zu `/api/v1`. |
| D8 | Mehrere Instanzen | Eingehendes kommt am Hub an. Eine ungekoppelte Instanz verhält sich wie ein Hub (G5, Entscheidung 12 der Instanzkopplung). An einem Spiegel antwortet ein Schreibweg wie bisher mit 409. |

## Zweck und Abgrenzung

**Was die API trägt (v1):**

| Zweck | Richtung | Route (Entwurf) | Prüfstein |
| --- | --- | --- | --- |
| `lage_lesen` | hinaus | `GET /api/v1/lage` (heutiger Inhalt von `lagemonitor_v1`) | Lagemonitor (Rust), LLH-1638 |
| `einsatz_lesen` | hinaus | `GET /api/v1/einsaetze`, `GET /api/v1/einsaetze/{id}/kopf` | Einsatzkopf fürs Einsatzbuch der iuk-suite (TypeScript) |
| `ereignisse_lesen` | hinaus | `GET /api/v1/ereignisse?seit=…` | iuk-suite |
| `alarm_melden` | herein | `POST /api/v1/alarmmeldungen` (Normalform aus dem Schnittstellen-Ausbau) | Adapter, LLH-1192 |
| `position_melden` | herein | `POST /api/v1/positionen` | Traccar/Brücke, LLH-1199 |
| `rechnen` | beides | `POST /api/v1/rechner/unterkunft` | LLH-1524 |

**Was bewusst draußen bleibt:**

- **Kein Einsatz ohne Menschen (G1).** Eine Maschine legt keinen Einsatz an und schreibt nicht in
  Einsatzdaten. Herein kommen nur Vorschläge in eine Ablage, die ein Mensch übernimmt.
- **Keine Personen- und Gesundheitsdaten hinaus** (G6). Das gilt für Namen, Personenkennungen,
  freie Notizen, Sichtung, Verletzungen und Maßnahmen. Ein Export für die Personenauskunft
  (LLH-1198) ist eine Datei für Menschen, kein API-Weg.
- **Keine Verwaltung über die API:** Benutzer, Rollen, Anmeldewege, Zugänge und Aufbewahrung bleiben
  Sache der Oberfläche.
- **Kein Lesen abgeschlossener oder archivierter Einsätze.** Das Archiv liest nur
  `/api/aufbewahrung` mit Sitzung.

## Anmeldung für Maschinen (D1, D2)

**Verfahren:** ADR-0014 mit einem eigenen Profil für Fremdsysteme.

| Teil | Instanz (heute) | Fremdsystem (neu) |
| --- | --- | --- |
| Kopf | `Authorization: Instanz <jws>` | `Authorization: Maschine <jws>` |
| `typ` | `lifeline-instanz+jwt` | `lifeline-maschine+jwt` |
| `kid` | Kennung der Instanz | Kennung des Zugangs (UUID) |
| `aud` | UUID der Instanz | öffentliche Basis-URL der Instanz (`https://hub.example/`) |
| Claims | `iss aud iat exp jti htm htu bh pv` | `iss aud iat exp jti htm htu bh`; die Version steckt im Pfad, `pv` entfällt |
| Antwortsignatur | Pflicht | wird immer mitgeschickt, prüfen ist für den Client freiwillig; Schlüssel unter `GET /api/v1/instanz/schluessel` (JWKS) |
| Lebensdauer, Uhr, `jti` | ≤ 60 s, ± 5 min, Wiederholschutz in der DB | gleich, eigene Tabelle |

**Einstieg per Einmal-Code** (ADR-0014):

1. Ein Org-Admin legt unter „Anbindungen“ einen Zugang an. Er vergibt Name, Zwecke und optional
   „gültig bis“ und bekommt einen Einmal-Code (16 Zeichen, 15 Minuten, einmal einlösbar).
2. Das Fremdsystem erzeugt sein Ed25519-Paar und löst den Code mit
   `POST /api/v1/zugang/einloesen` ein. Es schickt den Suchwert, seinen öffentlichen Schlüssel
   (JWK) und einen Prüfwert über beide. Die Ableitung ist dieselbe wie in `src/instanz/code.rs`,
   nur mit eigenem Salt `lifeline-maschinenzugang/1`. Der Code selbst geht nie über die Leitung.
3. Die Antwort enthält `kid`, den öffentlichen Schlüssel der Instanz und deren Prüfwert. Der Admin
   sieht danach den Fingerabdruck des gebundenen Schlüssels.
4. Ein **Schlüsselwechsel** läuft über einen neuen Code für denselben Zugang. Der alte Schlüssel ist
   gesperrt, sobald der neue zum ersten Mal signiert hat.

**Rechte (D2):**

- Die Zwecke stehen in einem `wire_enum!`: `lage_lesen`, `einsatz_lesen`, `ereignisse_lesen`,
  `alarm_melden`, `position_melden`, `rechnen`.
- Ein Extractor `Maschine` prüft vor dem Handler, in dieser Reihenfolge: Signatur, Widerruf und
  Ablauf, Zweck der Route, Org. Ein fehlender Zweck ergibt 403.
- Lesezwecke mit Einsatzbezug sehen nur die Einsätze, die die Einsatzleitung für diesen Zugang
  freigegeben hat, sonst 404. Die Freigabe endet mit dem Abschluss des Einsatzes.

**Widerruf:**

- Wirkt sofort und hat keine Nebenwirkungen: eigene Tabelle `maschinenzugang`, nicht
  `instanz_kopplung`.
- Der Zugang bleibt mit Spur sichtbar. Ein abgelaufener Zugang verhält sich wie ein widerrufener.

**Audit und Abrufprotokoll:**

- Neue `AdminAktion`-Werte: `maschinenzugang_angelegt`, `maschinenzugang_schluessel_gebunden`,
  `maschinenzugang_geaendert`, `maschinenzugang_widerrufen`. Dafür baut eine Migration den
  CHECK neu, nach dem Muster von 0269/0301.
- Jeder Abruf zählt in `maschine_abruf` je Zugang, Route und Tag: Anzahl, erster und letzter
  Zeitpunkt. Aufbewahrt wird das wie `admin_audit` 365 Tage.
- Herein kommende Meldungen tragen die Zugangs-ID als Herkunft.

**Drosselung:**

- Je Zugang ein Token-Bucket. Der Vorschlag ist 60 Anfragen je Minute, beim Einwurf 30. Wer darüber
  liegt, bekommt 429 mit `Retry-After`.
- Ein unbekannter `kid` und eine falsche Signatur zählen als Fehlversuch der IP (LFH-604).
- Die Zähler liegen wie die Anmeldesperre im Prozessspeicher (R10).

## Zugänglichkeit (D1)

Sicher heißt hier: kein Geheimnis im Umlauf und jede Anfrage einzeln gebunden. Das kostet den Client
etwa 40 Zeilen Code. Damit dieser Aufwand nicht zur Hürde wird, gibt es:

- **Eine Prüfroute** `GET /api/v1/ich`. Sie antwortet mit Zugang, Org, Zwecken und Serverzeit. Das
  ist der erste Aufruf jeder Anbindung, und er zeigt eine falsch gehende Uhr sofort.
- **Den Ablehnungsgrund im Admin-Bereich.** Nach außen gibt es immer nur ein schlichtes 401. Am
  Zugang zeigt die Seite „Anbindungen“ den letzten Fehlschlag, etwa „Uhr weicht 7 min ab“, „Body
  passt nicht zu `bh`“ oder „`htu` falsch“ (G7).
- **Referenz-Clients:**
  - eine kleine Rust-Bibliothek, auf der der Lagemonitor aufsetzt;
  - ein TypeScript-Modul für die iuk-suite;
  - ein Python-Beispiel mit etwa 30 Zeilen auf Basis von `cryptography`.
- **Testvektoren in der Doku:** fester Schlüssel, feste Uhrzeit, Anfrage und erwartetes JWS.
- **Kurzer Weg zum Einlösen:** ein Kommando `lifeline-hub zugang einloesen <url> <code>` im Binary.
  Es erzeugt das Schlüsselpaar, löst den Code ein und legt eine Schlüsseldatei ab.

Ein Token-Endpunkt (OAuth2 `private_key_jwt` → kurzlebiges Access-Token) bleibt möglich, braucht
aber eine eigene ADR. Er kommt erst, wenn ein konkretes Fremdsystem nur OAuth kann.

## Vertrag (D3)

- **Präfix:** `/api/v1/`. Fremdsysteme dürfen nur diesen Bereich nutzen. Der Extractor `Maschine`
  wirkt nur dort, und `CurrentUser` nimmt kein `Authorization: Maschine` an.
- **OpenAPI:**
  - Ein eigenes Dokument, etwa `src/api_doc_v1.rs` mit `#[utoipa::path]` an den v1-Handlern.
    Ausgeliefert wird es unter `GET /api/v1/openapi.json`, versioniert als `docs/api/oeffentlich-v1.json`.
  - Ein Drift-Test nach dem Muster von `tests/openapi_spec_aktuell.rs` läuft als Schritt in
    `scripts/check-typ-codegen.sh`.
  - `src/api_doc.rs` bleibt ohne Pfade (ADR-0004 unverändert). Gemeinsame Schemas werden in beide
    Dokumente aufgenommen.
- **Stabilitätszusage:**
  - Innerhalb von v1 kommt nur hinzu: neue Routen, neue optionale Felder, neue Zwecke.
  - Neue Enum-Werte sind erlaubt. Der Vertrag verlangt deshalb, dass Clients unbekannte Werte
    überspringen. Das steht im Dokument.
  - Entfernen oder Umdeuten heißt `/api/v2/`. v1 bleibt danach mindestens sechs Monate erreichbar
    und meldet `Deprecation` und `Sunset` im Kopf.
- **Fehler:** `{"error": "<Text>", "code": "<stabiler_code>"}`.
  - `code` gibt es nur unter `/api/v1`; der Text ist nicht Vertrag.
  - Statuscodes nach `src/AGENTS.md`, „Statuscode-Konvention“, und `tests/fehler_vertrag.rs` wird
    um v1 ergänzt.
  - Codes: `zugang_ungueltig` (401), `zweck_fehlt` (403), `nicht_gefunden` (404), `feld_ungueltig`
    (400), `inhalt_unbrauchbar` (422), `zu_gross` (413), `zu_viele` (429), `cursor_abgelaufen`
    (410), `fuehrung_woanders` (409).
- **Sonst:**
  - Zeiten in UTC (ADR-0012).
  - Bodies höchstens 64 KiB.
  - Kein CORS, also keine Browser-Clients von fremden Seiten.
  - Die Routen kommen in die Liste der `Zulassung` (`tests/zulassung_guard.rs`).

## Richtung herein (Beispiel: generische Alarmmeldung)

Der Zugang hat den Zweck `alarm_melden`. Die Normalform steht im Schnittstellen-Ausbau, Abschnitt
„Alarmübernahme“.

```http
POST /api/v1/alarmmeldungen
Authorization: Maschine eyJhbGciOiJFZERTQSIsInR5cCI6ImxpZmVsaW5lLW1hc2NoaW5lK2p3dCIsImtpZCI6Ii4uLiJ9.…
Content-Type: application/json

{"externe_id": "LS-2026-118833", "art": "neu", "test": false,
 "einsatznummer": "2026118833", "stichwort": "RD 2", "meldung": "Person gestürzt",
 "ort": {"strasse": "Hauptstraße 4", "ort": "Musterstadt"},
 "koordinate": {"system": "wgs84", "lat": 52.1, "lon": 9.3},
 "alarmzeit": "2026-11-11T19:02:11Z"}
```

Die Claims des JWS:

```json
{"iss": "<kid>", "aud": "https://hub.example/", "iat": 1794423731,
 "exp": 1794423791, "jti": "q3L…", "htm": "POST",
 "htu": "/api/v1/alarmmeldungen", "bh": "<SHA-256 des Bodys, base64url>"}
```

**Antworten:**

| Status | Wann |
| --- | --- |
| `201` | `{"id": "…", "zustand": "offen"}` |
| `200` | derselbe Schlüssel (Zugang, `externe_id`) noch einmal: Nachtrag oder Wiederholung, der Vorschlag wird aktualisiert |
| `401 zugang_ungueltig` | Anmeldung gescheitert |
| `403 zweck_fehlt` | dem Zugang fehlt der Zweck |
| `413 zu_gross` | Body zu groß |
| `422 inhalt_unbrauchbar` | weder Stichwort noch Meldung |
| `429 zu_viele` | gedrosselt |

**Fehlerstrategie für den Absender:**

- Bei `5xx`, `429` und Zeitüberschreitung wiederholt er mit Backoff, aber mit neuem `jti`, weil die
  Idempotenz am Schlüssel hängt, nicht am `jti`.
- Bei `4xx` außer `429` wiederholt er nicht.
- Die Uhr prüft er mit `GET /api/v1/ich`.

## Richtung hinaus (Beispiel: Ereignis-Feed)

Der Zugang hat den Zweck `ereignisse_lesen`.

```http
GET /api/v1/ereignisse?seit=4711&warten=25
Authorization: Maschine …
```

```json
{"cursor": 4714,
 "ereignisse": [
   {"id": 4712, "art": "einsatz.angelegt", "zeit": "2026-11-11T19:04:00Z", "einsatz_id": "…"},
   {"id": 4713, "art": "lage.geaendert",   "zeit": "2026-11-11T19:05:30Z", "einsatz_id": "…"},
   {"id": 4714, "art": "einsatz.beendet",  "zeit": "2026-11-11T21:40:12Z", "einsatz_id": "…"}]}
```

**Inhalt der Ereignisse:**

- Sie sind schmal: Art, Zeit und IDs. Die Inhalte holt der Client über die Leserouten, wie in der
  eigenen Oberfläche (ADR-0003).
- Arten in v1: `einsatz.angelegt`, `einsatz.geaendert` (Kopffelder), `einsatz.beendet`,
  `lage.geaendert` und `alarmmeldung.angenommen`/`.verworfen` (für den meldenden Zugang).

**Sichtbarkeit und Speicher:**

- Gefiltert wird nach Org, Zweck und Freigabe.
- Gespeichert wird in einer Tabelle mit fortlaufender Nummer, sieben Tage lang.

**Abruf:**

- `warten` hält den Abruf höchstens 25 s offen, bis etwas Neues da ist. Das ist ein Long-Poll,
  kein dritter Strom.
- Ist der Cursor älter als sieben Tage, kommt `410 cursor_abgelaufen`. Der Client liest dann den
  Stand neu über `GET /api/v1/einsaetze` und fängt mit dem gelieferten Cursor wieder an.
- Ohne Netz holt der Abrufer später nach (G8). Verloren geht nichts innerhalb der sieben Tage.

**Webhooks (später, LLH-1197):**

- Derselbe Inhalt als Body, als JWS mit dem Instanzschlüssel signiert
  (`typ lifeline-ereignis+jwt`). Geprüft wird über `GET /api/v1/instanz/schluessel`.
- Wiederholt wird mit Backoff aus dem Ausgangskorb.
- Ein HMAC-Geheimnis gibt es nicht (G3).

## Einwurf (D5, ADR-0022)

Gedacht für Absender, die nicht signieren können: BOSWatch 3 (nur GET mit Platzhaltern), FE2 „URL
öffnen“, der Divera-Webhook und OsmAnd. Ein Beispiel für BOSWatch:

```text
GET https://hub.example/api/v1/einwurf/llh_ew_Q2x…/alarm?ric={RIC}&sub={SRIC}&text={MSG}
```

- **Der Schlüssel** besteht aus `llh_ew_` und 32 Zufallsbytes. Gespeichert wird nur sein SHA-256.
- **Er schreibt nur:** genau in die Ablage seines Zwecks (Alarmmeldung oder Position) und nur für
  seine Org.
- **Er liest nichts:** Die Antwort ist `204` oder ein Fehler, ohne Daten.
- **Drosselung:** 30 je Minute je Zugang. Ein unbekannter Schlüssel zählt in die IP-Sperre.
- **Schlüssel im Protokoll:** Der Pfad trägt das Geheimnis. Deshalb maskiert
  `pfad_fuer_protokoll` (`src/app.rs`) den Abschnitt nach `/einwurf/`. Die Betriebsdoku verlangt
  dasselbe vom Reverse-Proxy.
- **Widerruf und Wechsel:** sofort widerrufbar; ein Wechsel heißt neuer Schlüssel, alter widerrufen.
- **Audit** mit denselben Aktionen wie beim Maschinenzugang, Art `einwurf`.

## Datenschutz und Aufbewahrung

- **Hinaus:**
  - Für `/api/v1` gilt die Regel des Lagemonitors (`src/routes/lagemonitor_v1.rs`, Kopf): keine
    Namen, keine Personenkennungen, keine freien Notizen, Zahlen statt Personen.
  - Schwärzungen wirken, weil die Lesewege nur aus verdichteten Werten bauen (`verdichte`) und
    abgeschlossene Einsätze gar nicht liefern.
- **Herein:**
  - Rohdaten von Alarmmeldungen können Art.-9-Daten enthalten. Für sie gelten die Fristen aus E5:
    12 h offen, Löschung nach 7 Tagen, Rohdaten bei Annahme sofort löschen.
  - Positionen gibt es nur im Einsatz und ohne Verlauf (LLH-1199).
- **Nachweis:** Wer was abgerufen hat, steht im Abrufprotokoll (je Zugang, Route und Tag). Wer
  einen Zugang angelegt, geändert oder widerrufen hat, steht in `admin_audit`.

## Betrieb

- **Erreichbarkeit:**
  - Am Hub öffentlich über TLS hinter dem Reverse-Proxy.
  - Am ELW nur im LAN oder Tailnet; ein gekoppelter ELW nimmt keine Fremdsysteme an, das macht der
    Hub (D8).
  - Die Basis-URL für `aud` ist dieselbe wie die öffentliche Adresse aus der Konfiguration.
- **Uhr:** ± 5 min wie bei Instanzen. `GET /api/v1/ich` zeigt die Abweichung.
- **Mehrere Prozesse:** Drosselung und Long-Poll liegen im Prozessspeicher (R10). Ein Lauf hinter
  einem Lastverteiler mit mehreren Prozessen ist nicht vorgesehen.

## Folgeaufgaben

Angelegt am 11.11.2026 als Unteraufgaben von LLH-1148, in dieser Reihenfolge:

1. **LLH-1652 Maschinenzugang** (Route `entwurf`). Umfang:
   - Tabelle und Einlösen per Code
   - Extractor `Maschine` mit Zwecken
   - Drosselung, Audit und Abrufprotokoll
   - Seite „Anbindungen“ mit Ablehnungsgrund
   - `GET /api/v1/ich`
   - Referenz-Clients und Testvektoren

   ADR-0021 wird damit akzeptiert.
2. **LLH-1653 Öffentliches OpenAPI-Dokument und Fehlercode** für `/api/v1` mit Drift-Test.
3. **LLH-1638 Lagemonitor** auf den Maschinenzugang umstellen, Umzug nach `/api/v1/lage`,
   Übergang für `llh_lm_`.
4. **LLH-1654 Einwurf-Zugang** (ADR-0022) mit Maskierung im Protokoll. Ihn brauchen BOSWatch,
   FE2, Divera und OsmAnd.
5. **LLH-1655 Ereignis-Feed** `GET /api/v1/ereignisse` samt Leserouten für Einsätze.
6. **LLH-1524 Rechner-API** unter `/api/v1/rechner/unterkunft`, ohne anonymen Zugang.

Zwei weitere Aufgaben hängen daran:

- **LLH-1192** (Alarmübernahme) hängt jetzt an LLH-1652 und LLH-1654 statt an LLH-1148.
- **LLH-1197** (Ausgang) hat einen Hinweis für Webhooks bekommen.
