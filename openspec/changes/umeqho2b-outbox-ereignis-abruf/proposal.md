# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/umeqho2br5quv1xabnsnqp46 (LLH-1655)

## Why

Ein Fremdsystem erfährt heute nicht, dass sich an einem Einsatz etwas geändert hat. Hinaus gibt es
nur die zwei SSE-Ströme der eigenen Oberfläche (ADR-0003), und die öffentliche API kennt bisher
nur die Anmeldung (`GET /api/v1/me`). Das Einsatzbuch der iuk-suite braucht den Einsatzkopf und
ein Signal, wann es ihn neu lesen soll. Das Konzept zur öffentlichen API
(`docs/konzepte/2026-11-11-oeffentliche-api.md`, D4) und ADR-0022 legen dafür eine Outbox fest:
Ausgangsereignisse entstehen in derselben Transaktion wie die Änderung, erster Leser ist ein
Abruf, zweiter sind die Webhooks (LLH-1656).

## What Changes

- **Outbox:** Eine Tabelle `maschine_ereignis` mit fortlaufender Nummer. Eine Zeile gehört genau
  einem Maschinenzugang und trägt Art, Zeitpunkt und Einsatz-ID, sonst nichts. Sie entsteht per
  Trigger in der Transaktion, die die Änderung schreibt, auf jedem Schreibweg: Oberfläche,
  Spiegel-Übernahme, Verwahrung, Demo-Import.
- **Ereignisarten in v1:**
  - `einsatz.created`: Der Einsatz ist für den Zugang lesbar geworden (die Einsatzleitung hat ihn
    freigegeben).
  - `einsatz.updated`: Ein Feld des Einsatzkopfs hat sich geändert.
  - `einsatz.closed`: Der Einsatz ist für den Zugang nicht mehr lesbar (abgeschlossen, Freigabe
    zurückgenommen oder gelöscht).
  - `lage.changed`: Die Lage des Einsatzes kann sich geändert haben. Je Zugang und Einsatz steht
    davon höchstens eine Zeile in der Outbox; eine neue ersetzt die alte mit höherer Nummer.
- **Abruf `GET /api/v1/events?after=<cursor>&wait=<0…25>`** (Scope `events:read`):
  - Antwort `{cursor, events: [{id, type, occurred_at, einsatz_id}]}`, aufsteigend nach `id`,
    höchstens 500 je Antwort.
  - Ohne `after` kommt der aktuelle Stand ohne Ereignisse.
  - `wait` hält den Abruf höchstens 25 s offen, bis ein Ereignis da ist (Long-Poll).
  - Höchstens 32 Abrufe warten gleichzeitig, je Zugang einer. Darüber antwortet der Abruf sofort
    und setzt `Retry-After: 10`.
  - Ein Cursor unter der Löschgrenze oder über dem Höchststand ergibt `410 cursor_expired`.
  - Welche Arten ein Zugang sieht, hängt an seinen Scopes: `einsatz.*` braucht `einsaetze:read`,
    `lage.changed` braucht `lage:read`.
- **Leserouten** (Scope `einsaetze:read`):
  - `GET /api/v1/einsaetze`: die laufenden, für den Zugang freigegebenen Einsätze, dazu der
    Cursor für den Neuaufbau.
  - `GET /api/v1/einsaetze/{id}`: ein Einsatz, sonst `404 not_found`.
  - Felder: `id`, `einsatznummer`, `bezeichnung`, `stichwort`, `einsatzart`, `leitstellen_nr`,
    `einsatzort`, `koordinate`, `begonnen_at`. Sachverhalt, meldende Stelle und Betroffenenzahl
    bleiben draußen.
- **Aufbewahrung:** Ereignisse werden nach sieben Tagen gelöscht (Phase C des Purge-Laufs). Die
  Löschgrenze bleibt festgehalten, damit ein alter Cursor erkannt wird.
- **Neue ADR:** Die Outbox wird per Trigger und je Zugang geschrieben; kein Rust-Schreibweg
  schreibt hinein.
- **Doku:** Anleitung für den Abruf unter `docs/api/`, Beschreibung im v1-Dokument, das
  Anwender-Kapitel „Anbindungen“, Architektur Kapitel 6, 8 und 11, ein Abschnitt in
  `src/AGENTS.md`.

**Abweichungen vom Konzept** (mit Ruben am 12.11.2026 abgestimmt):

- Das Konzept schreibt die Outbox „in den `_tx`-Funktionen der Repos“. Diese Change nimmt
  Trigger. Die Regel aus ADR-0022 (dieselbe Transaktion) bleibt erfüllt.
- Das Konzept filtert die Sichtbarkeit beim Lesen. Diese Change legt sie beim Schreiben fest, je
  freigegebenem Zugang.

**Nicht in dieser Change:**

- Die Einsatzfreigabe für Maschinenzugänge selbst (Tabelle, Bedienung der Einsatzleitung). Sie
  kommt aus LLH-1638 und ist Voraussetzung.
- `alarmmeldung.accepted` und `alarmmeldung.rejected`. Alarmmeldungen gibt es erst mit LLH-1192;
  neue Ereignisarten erlaubt der Vertrag.
- Webhooks (LLH-1656).
- Ein Ereignis-Helfer in den Referenz-Clients. Die Anleitung zeigt die Schleife.

## Capabilities

### New Capabilities

- `ereignis-abruf`: Ausgangsereignisse für Fremdsysteme. Dazu gehören die Outbox mit ihrer
  Bindung an die Transaktion der Änderung, die Ereignisarten und ihre Sichtbarkeit je Zugang, der
  Abruf mit Cursor und Long-Poll, die Wartegrenzen, die Aufbewahrung mit `410 cursor_expired` und
  die Leserouten für Einsätze samt ihrem Feldumfang.

### Modified Capabilities

Keine. `maschinenzugang` und `oeffentliche-api-vertrag` gelten unverändert; die neuen Routen
erfüllen deren Anforderungen (Scope, Signatur, Drosselung, Dokument, Fehlercode). Die
Einsatzfreigabe steht in der Spec, die LLH-1638 anlegt oder ändert.

## Impact

- **Backend:**
  - neu: `src/public_api/events.rs` (Abruf, Wartegrenzen, Purge, Ereignisart als `wire_enum!`)
    und `src/public_api/einsaetze.rs` (Leserouten, Schema `Einsatz`);
  - `src/public_api/mod.rs` (Routen mit `ScopeAnforderung`), `src/public_api/description.md`;
  - `src/einsatz/purge_scheduler.rs` (Phase C);
  - `src/einsatz/schwaerzung_registry.rs` und `src/instanz/spiegel/art.rs` (Einordnung der neuen
    Tabelle);
  - kein Eingriff in `src/einsatz/repo.rs`, `src/live/` oder die Spiegel-Übernahme.
- **Migration:** eine Datei mit zwei Tabellen und den Triggern an `einsatz`,
  `einsatz_aenderung` und der Freigabe-Tabelle aus LLH-1638. Die Nummer liegt über allen auf
  `alpha`, also auch über der von LLH-1638.
- **Vertrag:** `docs/api/public-v1.json` wächst um drei Routen und ihre Schemas
  (`cargo test --test public_api_spec_aktuell`); `tests/enum_wire_kontrakt.rs` bekommt die
  Ereignisart.
- **Frontend:** keine Änderung.
- **Doku:** `docs/api/ereignisse.md` (neu), `docs/api/maschinenzugang.md`,
  `docs/anwender/kapitel/anbindungen.md`, `docs/architektur/` (Kapitel 6, 8, 11, neue ADR),
  `src/AGENTS.md`.
- **Abhängigkeit:** LLH-1638 muss vor `/opsx:apply` auf `alpha` liegen. Diese Change hängt
  Trigger an dessen Freigabe-Tabelle und liest sie in den Leserouten.
