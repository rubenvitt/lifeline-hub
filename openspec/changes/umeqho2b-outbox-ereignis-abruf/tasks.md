# Tasks

Jede Aufgabe entsteht per TDD: zuerst der Test, der rot ist, dann der Code. Rust-Tests laufen im
eigenen `target/` des Checkouts; Node und pnpm nur über `mise exec --`.

Die Gruppen 1 und 2 brauchen LLH-1638 nicht und entstehen sofort (Entscheidung Ruben,
12.11.2026). Ab Gruppe 3 muss LLH-1638 (Change `f658d8o6-lage-fuer-maschinenzugaenge`) auf
`alpha` liegen.

## 1. Outbox: Tabellen

- [x] 1.1 Erste Migration mit Nummer über allen auf `origin/alpha`: `maschine_ereignis`,
  `maschine_ereignis_stand` und die zwei Indizes (D4), ohne Trigger. Einordnung nach D13:
  `TabellenRegel` in `schwaerzung_registry`, Eintrag in `spiegel::art::AUSGENOMMEN`. Verifizieren:
  `scripts/check-migrationen.sh`, `cargo test db::tests`, `cargo test schwaerzung_registry` und
  `cargo test instanz::spiegel::art` sind grün.

## 2. Abruf GET /api/v1/events (ohne Freigabe)

Bis zum Merge von LLH-1638 fügen die Tests Zeilen direkt in `maschine_ereignis` ein, und zwar nur
unter `tests/` (die ADR aus 5.1 verbietet es unter `src/`). Die Tests rufen die Funktionen aus
`public_api::events` auf; die Tests über HTTP mit Signatur folgen in Gruppe 4, sobald die Helfer
in `tests/common` liegen (LLH-1638, dort Aufgabe 3.2).

- [x] 2.1 `wire_enum!` `EventType` in `src/public_api/events.rs` mit den vier Werten.
  Verifizieren: Eintrag in `tests/enum_wire_kontrakt.rs`; ein Test vergleicht die Werte mit dem
  CHECK von `maschine_ereignis`.
- [x] 2.2 Lesen ohne Warten (D8) als Funktion in `public_api::events`: Höchststand, Löschgrenze,
  Arten aus den Scopes, Seite von 500, Cursor. Verifizieren mit `tests/public_api_events.rs`:
  - ohne `after` kommt der Höchststand ohne Ereignisse;
  - Zeilen eines Zugangs kommen aufsteigend ab dem Cursor; Zeilen eines anderen Zugangs nie;
  - 600 Zeilen kommen in zwei Seiten, der Cursor der ersten ist die `id` der 500.;
  - mit `lage:read` ohne `einsaetze:read` kommt nur `lage.changed`, umgekehrt nur `einsatz.*`;
  - ein Zugang ohne eigene Zeilen bekommt den Höchststand als Cursor, auch wenn nur andere
    Zugänge Zeilen haben;
  - ein Cursor unter `purged_until` und ein Cursor über dem Höchststand ergeben `cursor_expired`.
- [x] 2.3 Long-Poll (D9): Nachfragen im Sekundentakt, keine gehaltene Verbindung. Verifizieren:
  - ein wartender Abruf kehrt binnen zwei Sekunden zurück, nachdem eine Zeile entstanden ist;
  - ohne Zeile kehrt er nach der Wartezeit leer mit dem Cursor zurück (verkürztes Intervall im
    Test);
  - mit einem Pool der Größe 1 kann während des Wartens geschrieben werden.
- [x] 2.4 Wartegrenzen (D10): 32 gesamt, einer je Zugang. Verifizieren:
  - der zweite wartende Abruf desselben Zugangs kehrt sofort zurück und meldet „nicht gewartet“,
    der erste wartet weiter;
  - bei belegten Plätzen kehrt ein weiterer Zugang sofort zurück (Grenze im Test verkleinert);
  - ein abgebrochener wartender Abruf gibt seinen Platz frei.
- [x] 2.5 Purge (D12): `public_api::events::purge` in Phase C von `purge_scheduler`, Modulkopf
  dort nachgetragen. Verifizieren: Ein Test mit acht und sechs Tage alten Zeilen löscht nach
  einem Lauf nur die alten und setzt `purged_until`; danach ergibt der alte Cursor
  `cursor_expired`.
- [x] 2.6 Route: Handler mit `#[utoipa::path]`, Schemas `EventsResponse` und `Event`, Prüfung
  von `after` und `wait` (0 bis 25, sonst `invalid_field`), `Retry-After: 10` an der leeren
  Antwort ohne Warteplatz, Eintrag in `public_api::router()` mit
  `ScopeAnforderung::Scope(Scope::EventsRead)`, Antwort über `client.antwort(..)`. Verifizieren:
  - Unit-Tests der Parameterprüfung (`abc`, `-1`, `60`, `x`, fehlend);
  - `cargo test --test maschinenzugang` (Inventar der Scope-Angaben), `cargo test --test
    public_api` und `cargo test --test zulassung_guard` sind grün; die Route steht nicht in
    `OHNE_ZULASSUNGSGRENZE`.
- [x] 2.7 Vertrag: `src/public_api/description.md` um die Ereignisarten, `after`, `wait` und das
  Verhalten bei 410 ergänzen; `cargo test --test public_api_spec_aktuell` und
  `docs/api/public-v1.json` committen. Verifizieren: `scripts/check-typ-codegen.sh` ist grün.

## 3. Trigger (nach LLH-1638)

- [ ] 3.1 `git fetch origin alpha` und `origin/alpha` in den Branch mergen (LLH-1638 liegt
  darauf); das erzeugte `docs/api/public-v1.json` neu erzeugen statt zusammenführen. Am gemergten
  Stand design.md D1 prüfen:
  - Tabelle `maschinenzugang_freigabe` mit den Spalten aus D1;
  - der Upsert in `public_api::freigabe::freigeben_tx` ist kein `INSERT OR REPLACE`;
  - die Zeile endet durch `DELETE` beim Abschluss, Zurücknehmen, Widerruf und Scope-Entzug.

  Verifizieren: Die Fundstellen stehen als Kommentar an LLH-1655, und `cargo test` der Gruppen 1
  und 2 ist am gemergten Stand grün. Weicht ein Punkt ab, läuft `/opsx:update`, bevor 3.2
  beginnt.
- [ ] 3.2 Zweite Migration (Nummer über allen auf `origin/alpha`) mit den Triggern an der
  Freigabe (D5): `…_freigabe_ereignis_i`, `…_freigabe_ereignis_d`, `…_freigabe_ereignis_u`.
  Verifizieren mit Tests in `tests/public_api_events.rs` über `public_api::freigabe`:
  - Freigabe eines laufenden Einsatzes schreibt `einsatz.created` und `lage.changed` für genau
    diesen Zugang;
  - Zurücknehmen schreibt `einsatz.closed` nur für diesen Zugang;
  - Umstellen auf einen anderen Einsatz schreibt `einsatz.closed` für den alten und
    `einsatz.created` für den neuen;
  - Löschen eines Zugangs samt Freigabe scheitert nicht und hinterlässt keine Zeile.
- [ ] 3.3 Trigger am Kopf (D7): `einsatz_ereignis_kopf` und die Konstante `KOPF_SPALTEN`.
  Verifizieren:
  - je Spalte aus `KOPF_SPALTEN` ergibt eine Änderung ein `einsatz.updated` je Freigabe;
  - eine Änderung nur an `sachverhalt` ergibt keines, ebenso ein UPDATE mit gleichen Werten;
  - ohne Freigabe entsteht nichts;
  - ein Test vergleicht `KOPF_SPALTEN` mit dem Trigger-Text aus `sqlite_master`.
- [ ] 3.4 Trigger für das Ende (D5): `einsatz_ereignis_ende` und `einsatz_ereignis_d`.
  Verifizieren:
  - `einsatz::repo::abschliessen` ergibt je Zugang genau ein `einsatz.closed`;
  - ein Statuswechsel ohne Löschen der Freigabe (Weg der Spiegel-Übernahme) ebenso;
  - hartes Löschen eines laufenden freigegebenen Einsatzes lässt genau ein `einsatz.closed` je
    Zugang und keine frühere Zeile zurück;
  - Löschen eines abgeschlossenen Einsatzes lässt keine Zeile zurück (`cargo test
    skelett_loeschung` grün).
- [ ] 3.5 Trigger für die Lage (D6): `einsatz_aenderung_ereignis_i`, `einsatz_ereignis_lage` und
  die Konstante `LAGE_ARTEN`. Verifizieren:
  - zwanzig Einfügungen in `einsatz_person` ergeben je Zugang eine Zeile `lage.changed`, deren
    `id` mit jeder Änderung steigt;
  - ein neuer ETB-Eintrag ergibt keine;
  - eine geänderte `bezeichnung` ergibt `einsatz.updated` und `lage.changed`;
  - ein Test vergleicht `LAGE_ARTEN` mit dem Trigger-Text und prüft, dass jede Art in
    `spiegel::art::GESPIEGELT` steht; die Quellen von `public_api::lage` sind gegen die Liste
    gelesen, das Ergebnis steht im Kommentar an `LAGE_ARTEN`.
- [ ] 3.6 Die Tests aus Gruppe 2 fügen nicht mehr direkt ein, wo ein Trigger dasselbe leistet.
  Verifizieren: `git grep -n 'INSERT INTO maschine_ereignis' -- src tests` zeigt nur noch Tests,
  die eine Menge oder ein Alter brauchen (Seiten, Purge), jeweils mit Kommentar.
- [ ] 3.7 Die Ereignisse entstehen auf den Wegen neben der Oberfläche. Verifizieren:
  - ein Test in `tests/` übernimmt für einen freigegebenen Spiegel einen geänderten Kopf und
    findet `einsatz.updated` (Muster der bestehenden Spiegel-Tests);
  - eine zurückgerollte Transaktion hinterlässt keine Zeile;
  - `cargo test --test demo_daten` ist unverändert grün.
- [ ] 3.8 Schreiblast messen: Demo-Import der größten Lage vor und nach der Trigger-Migration, je
  drei Läufe. Verifizieren: Die Zahlen stehen als Kommentar an LLH-1655; liegt der Import mehr
  als 10 % langsamer, wird der Befund vor Gruppe 4 mit Ruben besprochen.

## 4. Abruf über HTTP und Leserouten (nach LLH-1638)

- [ ] 4.1 `Scope::braucht_einsatzfreigabe()` gilt auch für `EinsaetzeRead` (D15). Verifizieren:
  - Unit-Test: wahr für `lage:read` und `einsaetze:read`, falsch für `events:read` und die
    übrigen;
  - ein Zugang nur mit `einsaetze:read` steht in `GET /api/einsaetze/{id}/anbindungen` und lässt
    sich freigeben; einer nur mit `events:read` nicht;
  - Entzug von `einsaetze:read` als letztem solchen Scope löscht die Freigabe und ergibt
    `einsatz.closed`;
  - Texte im Paneel „Anbindungen“ der Seite „Geräte“, die nur von „Lage“ sprechen, sind
    angepasst (Vitest des Paneels grün).
- [ ] 4.2 Abruf über HTTP mit signierten Anfragen (Helfer aus `tests/common`). Verifizieren:
  - nach Freigabe, zwei Kopfänderungen und Abschluss liefert der alte Cursor die Ereignisse in
    Reihenfolge (Akzeptanzkriterium „zehn Minuten offline“);
  - `after=abc` und `wait=60` ergeben 400 `invalid_field`, ohne `events:read` 403
    `missing_scope`;
  - ein Zugang einer anderen Org und ein Zugang ohne Freigabe sehen nichts;
  - ein Abruf mit `wait=25` antwortet binnen zwei Sekunden nach einer Kopfänderung;
  - der zweite wartende Abruf desselben Zugangs antwortet sofort mit 200 und `Retry-After: 10`;
  - nach dem Purge ergibt der alte Cursor 410 `cursor_expired`;
  - die Antwort trägt nur `id`, `type`, `occurred_at`, `einsatz_id` und eine gültige
    Antwortsignatur.
- [ ] 4.3 Schema `Einsatz` und `Koordinate` in `src/public_api/einsaetze.rs`, `SELECT` aus
  `KOPF_SPALTEN` (D11). Verifizieren: Ein Unit-Test serialisiert einen Einsatz mit Sachverhalt
  und meldender Stelle und findet beides nicht; ohne Koordinate fehlt das Feld.
- [ ] 4.4 `GET /api/v1/einsaetze` mit `ScopeAnforderung::Scope(Scope::EinsaetzeRead)`.
  Verifizieren mit `tests/public_api_einsaetze.rs`:
  - nur der laufende, freigegebene Einsatz der eigenen Org steht in der Liste;
  - ohne Freigabe kommt eine leere Liste mit Cursor;
  - ein abgeschlossener Einsatz fehlt;
  - ein Ereignis nach dem Lesen der Liste kommt beim Abruf ab dem gelieferten Cursor
    (Neuaufbau nach 410).
- [ ] 4.5 `GET /api/v1/einsaetze/{id}`. Verifizieren:
  - freigegeben und laufend ergibt 200;
  - nicht freigegeben, fremde Org, abgeschlossen, unbekannt und `id` ohne Zahl ergeben dieselbe
    404 `not_found`;
  - ohne `einsaetze:read` 403 `missing_scope`;
  - der Test aus LLH-1638 über `braucht_einsatzfreigabe()` deckt beide Leserouten.
- [ ] 4.6 Vertrag nachziehen: `cargo test --test public_api_spec_aktuell`,
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
  hinausgeht. Der Satz „Heute nutzt ein Fremdsystem nur die Prüfung seiner Anmeldung“ fällt,
  soweit LLH-1638 ihn stehen ließ. Zeigt ein Bild des Kapitels das Paneel aus 4.1, wird es neu
  erzeugt. Verifizieren: `mise exec -- pnpm -C frontend test anwenderdoku` ist grün.
- [ ] 5.6 Konzept `docs/konzepte/2026-11-11-oeffentliche-api.md`: im Abschnitt „Richtung hinaus“
  ein Satz mit Verweis auf die ADR, dass Trigger und Sichtbarkeit je Zugang den Wortlaut dort
  ablösen. Verifizieren: Der Verweis löst auf.

## 6. Abschluss über alles

- [ ] 6.1 `./scripts/check-all.sh --geaendert` lokal. Verifizieren: grün, die Ausgabe steht
  ungekürzt bereit.
- [ ] 6.2 Durchspiel am laufenden Stack mit Demo-Daten: Zugang mit `events:read` und
  `einsaetze:read` anlegen und einlösen, Einsatz freigeben, Kopf ändern, abschließen; dazwischen
  `GET /api/v1/events` mit `wait=25`. Verifizieren: Die Ereignisse kommen in Reihenfolge, die
  Antworten stehen im PR; ändert 4.1 das Paneel sichtbar, kommt davon ein Bild dazu.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive umeqho2b-outbox-ereignis-abruf` im selben Branch, vor dem PR.
- PR gegen `alpha`, Aufgabe auf `review`; LLH-1656 wird mit dem Merge frei.
