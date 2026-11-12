# Tasks

Vor 1.1: LLH-1638 liegt auf `alpha`. Jede Aufgabe entsteht per TDD: zuerst der Test, der rot
ist, dann der Code. Rust-Tests laufen im eigenen `target/` des Checkouts; Node und pnpm nur über
`mise exec --`.

## 1. Voraussetzung einholen

- [ ] 1.1 `git fetch origin alpha` und `origin/alpha` in den Branch mergen. Am gemergten Stand
  die Freigabe aus LLH-1638 gegen design.md D1 prüfen:
  - Tabelle mit je einer Zeile je (Zugang, Einsatz);
  - Ende als gelöschte Zeile, beim Abschluss und beim Zurücknehmen;
  - Beginn per `INSERT`, kein `INSERT OR REPLACE`, kein UPDATE von `einsatz_id`.

  Verifizieren: Tabellenname, Spalten und die Fundstellen der drei Punkte stehen als Kommentar an
  LLH-1655. Weicht einer ab, läuft `/opsx:update`, bevor 2.1 beginnt.
- [ ] 1.2 Test-Helfer für signierte Anfragen (`schluessel`, `senden`, `einloesen`, `signiert`,
  `angebunden` aus `tests/maschinenzugang.rs`) aus `tests/common/` nutzbar machen, falls LLH-1638
  das nicht schon getan hat; als eigener `refactor`-Commit. Verifizieren:
  `cargo test --test maschinenzugang` ist ohne inhaltliche Änderung grün.

## 2. Outbox: Tabellen und Trigger

- [ ] 2.1 Migration mit Nummer über allen auf `origin/alpha`: `maschine_ereignis`,
  `maschine_ereignis_stand`, die zwei Indizes (D4), noch ohne Trigger. Einordnung nach D13:
  `TabellenRegel` in `schwaerzung_registry`, Eintrag in `spiegel::art::AUSGENOMMEN`. Verifizieren:
  `scripts/check-migrationen.sh`, `cargo test db::tests`, `cargo test schwaerzung_registry` und
  `cargo test instanz::spiegel::art` sind grün.
- [ ] 2.2 Trigger an der Freigabe (D5): `…_freigabe_ereignis_i` und `…_freigabe_ereignis_d`.
  Verifizieren mit Tests in `src/public_api/events.rs`:
  - Freigabe eines laufenden Einsatzes schreibt `einsatz.created` und `lage.changed` für genau
    diesen Zugang;
  - Zurücknehmen schreibt `einsatz.closed` nur für diesen Zugang;
  - Löschen eines Zugangs samt Freigabe scheitert nicht und hinterlässt keine Zeile.
- [ ] 2.3 Trigger am Kopf (D7): `einsatz_ereignis_kopf` und die Konstante `KOPF_SPALTEN`.
  Verifizieren:
  - je Spalte aus `KOPF_SPALTEN` ergibt eine Änderung ein `einsatz.updated` je Freigabe;
  - eine Änderung nur an `sachverhalt` ergibt keines, ebenso ein UPDATE mit gleichen Werten;
  - ohne Freigabe entsteht nichts;
  - ein Test vergleicht `KOPF_SPALTEN` mit dem Trigger-Text aus `sqlite_master`.
- [ ] 2.4 Trigger für das Ende (D5): `einsatz_ereignis_ende` und `einsatz_ereignis_d`.
  Verifizieren:
  - `einsatz::repo::abschliessen` ergibt je Zugang genau ein `einsatz.closed`;
  - ein Statuswechsel ohne Löschen der Freigabe (Weg der Spiegel-Übernahme) ebenso;
  - hartes Löschen eines laufenden freigegebenen Einsatzes lässt genau ein `einsatz.closed` je
    Zugang und keine frühere Zeile zurück;
  - Löschen eines abgeschlossenen Einsatzes lässt keine Zeile zurück (`cargo test
    skelett_loeschung` grün).
- [ ] 2.5 Trigger für die Lage (D6): `einsatz_aenderung_ereignis_i`, `einsatz_ereignis_lage` und
  die Konstante `LAGE_ARTEN`. Verifizieren:
  - zwanzig Einfügungen in `einsatz_person` ergeben je Zugang eine Zeile `lage.changed`, deren
    `id` mit jeder Änderung steigt;
  - ein neuer ETB-Eintrag ergibt keine;
  - eine geänderte `bezeichnung` ergibt `einsatz.updated` und `lage.changed`;
  - ein Test vergleicht `LAGE_ARTEN` mit dem Trigger-Text und prüft, dass jede Art in
    `spiegel::art::GESPIEGELT` steht.
- [ ] 2.6 Die Ereignisse entstehen auf den Wegen neben der Oberfläche. Verifizieren:
  - ein Test in `tests/` übernimmt für einen freigegebenen Spiegel einen geänderten Kopf und
    findet `einsatz.updated` (Muster der bestehenden Spiegel-Tests);
  - eine zurückgerollte Transaktion hinterlässt keine Zeile;
  - `cargo test --test demo_daten` ist unverändert grün.
- [ ] 2.7 Schreiblast messen: Demo-Import der größten Lage vor und nach der Migration, je drei
  Läufe. Verifizieren: Die Zahlen stehen als Kommentar an LLH-1655; liegt der Import mehr als
  10 % langsamer, wird der Befund vor Gruppe 3 mit Ruben besprochen.

## 3. Abruf GET /api/v1/events

- [ ] 3.1 `wire_enum!` `EventType` in `src/public_api/events.rs` mit den vier Werten.
  Verifizieren: Eintrag in `tests/enum_wire_kontrakt.rs`; ein Test vergleicht die Werte mit dem
  CHECK von `maschine_ereignis`.
- [ ] 3.2 Lesen ohne Warten (D8): Handler mit `#[utoipa::path]`, Schemas `EventsResponse` und
  `Event`, Route in `public_api::router()` mit `ScopeAnforderung::Scope(Scope::EventsRead)`,
  Antwort über `client.antwort(..)`. Verifizieren mit `tests/public_api_events.rs`:
  - ohne `after` kommt sofort `{cursor, events: []}`;
  - nach Freigabe, zwei Kopfänderungen und Abschluss liefert der alte Cursor die vier Ereignisse
    in Reihenfolge (Akzeptanzkriterium „zehn Minuten offline“);
  - 600 Ereignisse kommen in zwei Seiten;
  - `after=abc` ergibt 400 `invalid_field`;
  - ohne `events:read` 403 `missing_scope`;
  - ein Zugang einer anderen Org und ein Zugang ohne Freigabe sehen nichts;
  - mit `lage:read` ohne `einsaetze:read` kommt nur `lage.changed`;
  - die Antwort trägt nur `id`, `type`, `occurred_at`, `einsatz_id` und eine gültige
    Antwortsignatur.
- [ ] 3.3 Cursor ohne Ereignisse und 410 (D8). Verifizieren:
  - ein Zugang ohne eigene Ereignisse bekommt den Höchststand als Cursor, auch wenn nur andere
    Zugänge Ereignisse haben;
  - ein Cursor unter `purged_until` und ein Cursor über dem Höchststand ergeben je 410
    `cursor_expired`.
- [ ] 3.4 Long-Poll (D9): `wait` von 0 bis 25, Nachfragen im Sekundentakt, keine gehaltene
  Verbindung. Verifizieren:
  - `wait=60` und `wait=x` ergeben 400 `invalid_field`;
  - ein Abruf mit `wait=25` antwortet binnen zwei Sekunden nach einer Kopfänderung;
  - `wait=3` ohne Ereignis antwortet nach etwa drei Sekunden leer (mit verkürztem Intervall im
    Test);
  - ein Test mit einem Pool der Größe 1 zeigt, dass während des Wartens eine andere Anfrage
    schreiben kann.
- [ ] 3.5 Wartegrenzen (D10): 32 gesamt, einer je Zugang, sonst sofort mit `Retry-After: 10`.
  Verifizieren:
  - der zweite wartende Abruf desselben Zugangs antwortet sofort mit 200 und `Retry-After: 10`,
    der erste wartet weiter;
  - bei belegten 32 Plätzen antwortet ein weiterer Zugang sofort (Grenze im Test verkleinert);
  - ein abgebrochener wartender Abruf gibt seinen Platz frei;
  - `cargo test --test zulassung_guard` ist grün, die Route steht nicht in
    `OHNE_ZULASSUNGSGRENZE`.
- [ ] 3.6 Purge (D12): `public_api::events::purge` in Phase C von `purge_scheduler`, Modulkopf
  dort nachgetragen. Verifizieren: Ein Test mit acht und sechs Tage alten Zeilen löscht nach
  einem Lauf nur die alten und setzt `purged_until`; danach ergibt der alte Cursor 410.
- [ ] 3.7 Vertrag: `src/public_api/description.md` um die Ereignisarten, `after`, `wait` und das
  Verhalten bei 410 ergänzen; `cargo test --test public_api_spec_aktuell` und
  `docs/api/public-v1.json` committen. Verifizieren: `scripts/check-typ-codegen.sh`,
  `cargo test --test public_api` und `cargo test --test maschinenzugang` sind grün.

## 4. Leserouten für Einsätze

- [ ] 4.1 Schema `Einsatz` und `Koordinate` in `src/public_api/einsaetze.rs`, `SELECT` aus
  `KOPF_SPALTEN` (D11). Verifizieren: Ein Unit-Test serialisiert einen Einsatz mit Sachverhalt
  und meldender Stelle und findet beides nicht; ohne Koordinate fehlt das Feld.
- [ ] 4.2 `GET /api/v1/einsaetze` mit `ScopeAnforderung::Scope(Scope::EinsaetzeRead)`.
  Verifizieren mit `tests/public_api_einsaetze.rs`:
  - nur laufende, freigegebene Einsätze der eigenen Org stehen in der Liste;
  - ohne Freigabe kommt eine leere Liste mit Cursor;
  - ein abgeschlossener Einsatz fehlt;
  - ein Ereignis nach dem Lesen der Liste kommt beim Abruf ab dem gelieferten Cursor
    (Neuaufbau nach 410).
- [ ] 4.3 `GET /api/v1/einsaetze/{id}`. Verifizieren:
  - freigegeben und laufend ergibt 200;
  - nicht freigegeben, fremde Org, abgeschlossen, unbekannt und `id` ohne Zahl ergeben dieselbe
    404 `not_found`;
  - ohne `einsaetze:read` 403 `missing_scope`.
- [ ] 4.4 Vertrag nachziehen: `cargo test --test public_api_spec_aktuell`,
  `docs/api/public-v1.json` committen. Verifizieren: `scripts/check-typ-codegen.sh` und
  `cargo test --test maschinenzugang` (Inventar der Scope-Angaben) sind grün.

## 5. Regeln und Doku

- [ ] 5.1 Neue ADR nach D14 mit der nächsten freien Nummer (`git fetch origin alpha`,
  `scripts/adr-fuer.sh --alle`, offene PRs). Verifizieren: `scripts/check-architektur.sh` ist
  grün, die Prüfung der ADR läuft durch.
- [ ] 5.2 `src/AGENTS.md`: Abschnitt „Ausgangsereignisse für Fremdsysteme (LLH-1655)“ mit den
  drei Regeln aus D14; Wurzel-`AGENTS.md` nur, wenn die Inhaltsangabe der Tabelle es braucht.
  Verifizieren: Die Wurzeldatei bleibt unter 200 Zeilen; Prettier und die Gates der
  Arbeitsanleitungen sind grün.
- [ ] 5.3 Architektur: Kapitel 6 (Ablauf vom Schreiben bis zum Abruf als Mermaid), Kapitel 8
  (Konzept mit Verweis auf Spec `ereignis-abruf` und die ADR), Kapitel 11 (Sicherung und Cursor,
  Liste der Lage-Tabellen), Kapitel 5, falls der Wächter es verlangt. Verifizieren:
  `scripts/check-architektur.sh` ist grün.
- [ ] 5.4 `docs/api/ereignisse.md` (neu): Schleife des Abrufs mit Beispiel, Neuaufbau nach 410,
  Bedeutung der vier Arten, Empfehlungen aus den Risiken (Einsatzliste regelmäßig neu lesen,
  nach `lage.changed` nicht öfter als alle paar Sekunden nachlesen, unbekannte Arten
  überspringen). `docs/api/maschinenzugang.md`: Scope-Tabelle mit den Pfaden und Verweis.
  Verifizieren: Das Beispiel ist gegen den laufenden Server mit dem Rust-Referenz-Client oder dem
  Kommando einmal durchgespielt; die Ausgabe steht im PR.
- [ ] 5.5 `docs/anwender/kapitel/anbindungen.md`: Abschnitt „Rechte“ sagt, was „Einsätze lesen“
  und „Ereignisse abrufen“ heute öffnen, und dass ohne Freigabe der Einsatzleitung nichts
  hinausgeht. Der Satz „Heute nutzt ein Fremdsystem nur die Prüfung seiner Anmeldung“ fällt.
  Verifizieren: `mise exec -- pnpm -C frontend test anwenderdoku` ist grün.
- [ ] 5.6 Konzept `docs/konzepte/2026-11-11-oeffentliche-api.md`: im Abschnitt „Richtung hinaus“
  ein Satz mit Verweis auf die ADR, dass Trigger und Sichtbarkeit je Zugang den Wortlaut dort
  ablösen. Verifizieren: Der Verweis löst auf.

## 6. Abschluss über alles

- [ ] 6.1 `./scripts/check-all.sh --geaendert` lokal. Verifizieren: grün, die Ausgabe steht
  ungekürzt bereit.
- [ ] 6.2 Durchspiel am laufenden Stack mit Demo-Daten: Zugang mit `events:read` und
  `einsaetze:read` anlegen und einlösen, Einsatz freigeben, Kopf ändern, abschließen; dazwischen
  `GET /api/v1/events` mit `wait=25`. Verifizieren: Die vier Ereignisse kommen in Reihenfolge,
  die Antworten stehen im PR (statt Bildern: die Änderung hat keine Oberfläche).

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive umeqho2b-outbox-ereignis-abruf` im selben Branch, vor dem PR.
- PR gegen `alpha`, Aufgabe auf `review`; LLH-1656 wird mit dem Merge frei.
