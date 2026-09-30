# Design

## Context

Motivation und Entscheidung: siehe `proposal.md`. Anforderungen: siehe `specs/`.

Bestand am 30.09.2026:

- **Lage-Dashboard** (`pages/lage-dashboard/LageDashboardPage.tsx:149-222`): Die Seite stellt rund
  16 Abfragen, eine je Liste. `baueLagebild` (`lagebild.ts:350`) verdichtet daraus alles im
  Client. Den Führungsstand (Aufträge, Meldungen) zählt `lagebild.ts:455-463` selbst über die
  Listen. Nicht erlaubte oder gescheiterte Listen gehen als `[]` hinein. Den Zustand der Kennzahl
  setzt `zFuehrung(query)` getrennt davon.
- **Führungsüberblick** (`pages/fuehrung/ueberblickDaten.ts`): `auftraegeKennzahl` zählt offen, in
  Arbeit und überfällig mit einem eigenen `istOffen`. Die Stärke rechnet er über `verdichte`,
  dieselbe Funktion wie das Dashboard.
- **Modulzähler** (`src/einsatz/zaehler.rs`): zählt Aufträge und Meldungen über die
  Listenfunktionen des Servers. Er liegt schon im Cache des Navigationsrahmens, wird bei jedem
  Auftrags- und Meldungsereignis invalidiert und steht in `LAGEBILD_OFFLINE`.
- **Stärke:**
  - Der Server kumuliert je Einheit über die Unterstellung (`einheit/repo.rs:219`, `ist_kumuliert`).
  - Der Client summiert Mengen mit `summiereStaerke` (`anzeige/staerke.ts`). Er ruft sie auf für
    Abschnitte (`abschnittStaerke.ts`) und für Bereitstellungsräume (`BrDetailPage.tsx:162`).
  - Das Meldebild (`kraeftebild.ts:558`) baut einen eigenen Baum. Oberste Einheiten hängen dort am
    Abschnitt, Untereinheiten an ihrer Elterneinheit.
  - `abschnitt_id` und `ueber_einheit_id` sind unabhängig voneinander (`einheit/repo.rs:446-463`).
- **Stab** (`pages/StabPage.tsx`): Paneele „Lagebesprechung“ und „Besetzung S1–S6“; `GET …/stab`
  liefert die letzte Besprechung und den nächsten Termin.
- **Muster für eine Übernahme in einen Lagebericht:** Funkplan (LFH-548). Er hat eine
  Rechteweiche je Quelle über `api/abrufZustand.ts` und legt den Bericht mit einem Aufruf
  `POST …/lageberichte` mit Startinhalt an.

## Goals / Non-Goals

**Goals:**
- Jede Zahl in Dashboard, Überblick und Vorbereitung hat genau eine Heimat.
- Die zwei gemessenen Abweichungen verschwinden: überfällige Aufträge und überfällige
  Meldungen.
- Die Doppelzählung der Abschnittsstärke verschwindet.
- Die Vorbereitung ist eine reine Darstellung des Lagebilds, das das Dashboard ohnehin berechnet.

**Non-Goals:**
- Es kommt kein serverseitiger Lagebild-Endpunkt (Entscheidung 30.09.2026, Option „Eine Heimat je
  Zahl“).
- Kein Einfrieren von Zahlen beim Beginn oder Abschluss einer Besprechung, kein Datenmodell
  „Lagebesprechung-Vorbereitung“, kein Vortragsschema (LFH-46 §2.3, §5).
- Keine neue Lagebericht-Vorlage; die Übernahme nimmt „freitext“ (LFH-46 §5, L317).
- **Nicht angeglichen wird der Warnton eines überfälligen Termins.** Die Stab-Seite zeigt
  `achtung`, die Fristenliste im Überblick `alarm`. Das ist eine Ton-Frage, keine Zahl. Sie steht
  als [LFH-859](https://app.clickup.com/t/123zgec60yw) und wird nicht hier entschieden.
- Keine Änderung an den Kennzahlen des Kennzahlenbands (LFH-640). Die Lageplätze bleiben Sache
  des Einsatzes.

## Decisions

### D1 — Eine Heimat je Zahl statt Endpunkt

| Zahl | Heimat |
|---|---|
| Aufträge offen / in Arbeit / überfällig | Server, Modulzähler |
| Meldungen offen / neu / Bestätigung überfällig | Server, Modulzähler |
| Betroffene, Vermisste, Sichtung | Client, `verdichtePersonen` (nutzt `sichtungsbild`) |
| Kräfte gesamt (Einsatz) | Client, `verdichte` |
| Stärke eines Abschnitts oder BR | Client, `summiereStaerke` über die kumulierte Server-Stärke |
| Warnstufe | Client, `verdichteGefahrengebiete` |

- **Warum:** Die Kräfteübersicht filtert die Stärke im Client (Abschnitt, Träger, Status). Ein
  Server-Endpunkt bräuchte dafür Filterparameter oder bliebe ein zweiter Weg. Umgekehrt zählt der
  Modulzähler die Handlungsmengen ohnehin schon, für das Modulpanel. Jede Zahl kommt also dorthin,
  wo sie schon gezählt wird.
- **Verworfen:** `GET …/lagebild`, also alle Zahlen in Rust. Das ist der größte Umbau: Rechtefilter
  je Feld, Live-Fan-out auf etwa zehn Ereignisse, ein neuer Offline-Prefix. Und die gefilterte
  Stärke bliebe trotzdem ein zweiter Weg.
- **Verworfen:** eine rein clientseitige Zählung der Handlungsmengen. Das Modulpanel bliebe
  serverseitig, und es gäbe weiter zwei Wege.

### D2 — „überfällig“ heißt „davon überfällig“

Der Führungsstand zeigt „Aufträge offen“ mit der Notiz „N überfällig“. Das liest sich als „davon“,
und so zählen der Modulzähler und der Überblick schon heute.
- Der Sonderfall im Dashboard entfällt: Ein vollzogener Auftrag mit unquittiertem Empfänger und
  abgelaufener Frist zählte dort als überfällig. Er ist eine Quittungslücke und kein offener
  Handlungsbedarf der Führung. Er bleibt auf der Auftragsseite sichtbar (`ist_ueberfaellig` in
  der Liste unverändert).
- **Verworfen:** den Modulzähler auf die weite Zählung umstellen. Das hätte die Badge-Bedeutung
  verändert (Spec `modul-zaehler`) und zwei Oberflächen statt einer bewegt.

### D3 — „Bestätigung überfällig“ der Meldungen = `bestaetigung_ueberfaellig`

Das Dashboard zählte bisher `ist_ueberfaellig`, also Frist abgelaufen ohne „eskaliert“. Der
Modulzähler und die Warnsperre des Helligkeitsreglers (LFH-397) zählen auch eskalierte mit.
Die Notiz heißt künftig „N Bestätigung überfällig“. Das Wort „Bestätigung“ macht die Menge
kenntlich.

### D4 — Ein Hook `useLagebild` für Dashboard und Vorbereitung

- Die Abfragen wandern aus `LageDashboardPage` in `pages/lage-dashboard/useLagebild.ts`. Der
  Hook liefert:
  - die Abfragen (`q`), darunter den Modulzähler;
  - den Abrufzustand je Quelle (`zustand`, über `abrufZustand`: daten, laden, fehler, gesperrt);
  - die `basis` für `baueLagebild` (Rohdaten ohne die Seitenteile Pegel-Ziel und Evakuierung).

  Das Lagebild baut jede Seite selbst mit `baueLagebild`, der einen Funktion. Das Dashboard gibt
  seine gehaltene Kennzahlreihe mit. Die Vorbereitung nimmt die Reihe ohne Lagekennzahlen
  (`kennzahlReihe([])`), denn sie zeigt keine Lageplätze; die Kern-Kennzahlen sind dieselben. Den
  Stand rechnet `standDer(...)` (ältester `dataUpdatedAt`).
- Dashboard und Stab-Vorbereitung rufen denselben Hook. Gleiche Werte sind damit durch
  Konstruktion gesichert und nicht durch einen Vergleichstest.
- Die Listen `auftraege` und `meldungen` verlassen den Hook. Der Führungsstand liest
  `modulZaehler`, damit entfallen zwei Abfragen. Das Feld `Lagebild.fuehrung` behält nur Bericht
  und UHS; Aufträge und Meldungen kommen als eigene, schmale Ableitung aus dem Zähler.
- **Kosten:** Die Stab-Seite stellt dieselben Abfragen wie das Dashboard. Die Schlüssel sind
  geteilt, also greift der Cache, und die Live-Invalidierung trifft beide. Die Pegel-Abfrage
  (5 min) läuft nur auf dem Dashboard (`mitPegel`).
- **Verworfen:** eine Vorbereitung mit eigenen Abfragen, die dieselben Funktionen aufruft. Das
  wäre derselbe Code, aber zwei Zusammenstellungen der Eingaben, und genau dort driftet es.

### D5 — Stärke: Wurzeln der Menge, Abschnitte nach Unterstellung

- `summiereStaerke(einheiten, alle)` addiert `ist_kumuliert` nur für Einheiten, von denen kein
  Vorfahr (nicht nur der direkte) in der übergebenen Menge liegt; die Kette läuft über `alle`,
  damit ein fehlendes Zwischenglied sie nicht abreißt (Review-Befund: A und Enkel G ohne B zählten
  G doppelt). Ein korrupter Zyklus zählt über seine kleinste Kennung genau einmal. Das ist die Regel für den
  Bereitstellungsraum: Wer dort mit seiner Untereinheit steht, zählt einmal.
- `abschnittStaerken` übergibt nur die **obersten Einheiten** (`ueber_einheit_id` leer), genau
  wie `baueKraeftebild` seine Abschnitte bestückt. Damit zählt eine unterstellte Einheit beim
  Abschnitt ihrer obersten Einheit, wie im Meldebaum. Verwaiste Einheiten gibt es nicht: Der
  Fremdschlüssel `ueber_einheit_id` hat kein `ON DELETE` (Migration 0016), eine Elterneinheit
  mit Unterstellten lässt sich nicht löschen.
- Hat ein Abschnitt zugeordnete Einheiten, aber keine oberste, ist seine Stärke 0/0/0 und nicht
  „—“: Eine Einheit steht dort, ihre Kräfte zählen beim Abschnitt ihrer obersten Einheit. „—“
  bleibt „keine Einheit zugeordnet“.
- **Verworfen:** „jede Einheit bei ihrem eigenen Abschnitt, mit ihrer eigenen Stärke `ist`“. Das
  wiche vom Meldebild und von der kumulierten Server-Stärke ab, also eine dritte Zuordnung.

### D6 — Zusammenlegen ohne Verhaltensänderung

- **`staerkeText`:** Es bleibt eine Formatierung in `anzeige/staerke.ts`. Sie nimmt `Staerke` und
  berechnet Σ selbst. `kraeftebild.ts` importiert sie; `StaerkeSumme` ist strukturell `Staerke`
  plus `gesamt`.
- **Sichtung:** `verdichtePersonen` zählt die SK über `personenBilanz.sichtungsbild` und bildet nur
  die Schlüssel ab. Beide Tests bleiben unverändert grün.
- **Meldungen:** `meldungKennzahlen.istAlarmiert` bleibt die Client-Heimat der Regel
  (MeldungenPage). Das Fixture bindet sie an `zaehler.rs`, und der Kommentar „wer eine ändert,
  ändert beide“ wird durch den Test ersetzt.

### D7 — Gemeinsames Fixture

- **Datei:** `tests/fixtures/verdichtung/regeln.json`, außerhalb von `frontend/`. Prettier prüft
  sie deshalb nicht. Drei Abschnitte:
  1. `auftraege`: Zeilen mit `bearbeitungsstatus` und `ist_ueberfaellig`. Erwartet werden
     `offen`, `in_arbeit` und `ueberfaellig`.
  2. `meldungen`: Zeilen mit `status`, `ist_offen`, `bestaetigung_pflicht`, `ist_bestaetigt`,
     `ist_ueberfaellig` und `eskaliert`. Erwartet werden `offen`, `ungesehen` und
     `bestaetigung_ueberfaellig`.
  3. `staerke`: Einheiten (`id`, `ueber_einheit_id`, `abschnitt_id`, eigene Stärke), Abschnitte
     (`id`, `ueber_abschnitt_id`) und BR-Mengen. Erwartet werden `ist_kumuliert` je Einheit, die
     Stärke je Abschnitt (eigene, inkl. Unterabschnitte) und je BR.
- **Rust:**
  - `zaehler.rs` bekommt die reinen Funktionen `zaehle_auftraege` und `zaehle_meldungen` über die
    Prädikatsfelder. `berechne` ruft sie; das Verhalten bleibt gleich.
  - `einheit/repo.rs` bekommt eine reine Funktion `kumuliere(eigene, kinder, wurzel)`.
    `Anreicherung::ist_kumuliert` ruft sie.
  - Der Test `tests/verdichtung_fixture.rs` liest die Datei mit `include_str!` und prüft
    Abschnitt 1, 2 und `ist_kumuliert`.
- **Vitest:** `frontend/src/lage/verdichtungFixture.test.ts` liest die Datei per
  `readFileSync`, nach dem Vorbild von `test/huelle.ts`. Er prüft:
  - `istOffen` und das Überfällig-Prädikat des Überblicks gegen Abschnitt 1;
  - `istAlarmiert` gegen Abschnitt 2;
  - `abschnittStaerken` und `summiereStaerke` gegen Abschnitt 3, gespeist mit den **erwarteten**
    `ist_kumuliert` der Datei;
  - die Abschnittsstärke des Meldebaums (`baueKraeftebild`) gegen dieselben Erwartungen.
- **Grenze:** Die SQL-berechneten Zeilenflags (`ist_ueberfaellig` usw.) stehen als Eingaben in der
  Datei. Ihre SQL-Herleitung sichern weiter die Repo-Tests (`auftrag/repo.rs:963`,
  `meldung/repo.rs:1304`). Das Fixture pinnt die Schicht darüber, und genau dort lagen die
  Abweichungen.
- **Verworfen:** Das Fixture in eine SQLite-Testdatenbank laden und `berechne` aufrufen. Das wäre
  näher am Endpunkt, aber Vitest könnte dieselbe Eingabe nicht lesen, und das AK verlangt eine
  gemeinsame Eingabe.

### D8 — Vorbereitung als Paneel, Übernahme wie der Funkplan

- **Ort:** Das Paneel „Vorbereitung“ auf der Stab-Seite, unter „Lagebesprechung“.
  - Es bekommt keine eigene Route und keine Arbeitsplatzachse (LFH-456); der Einstieg ist die
    Stab-Seite.
  - Die Primäraktion im Kopf bleibt „Lagebesprechung abschließen“. „In Lagebericht übernehmen“
    steht als sekundärer Knopf im Paneel.
- **Aufbau:**
  - Die Zeilen entstehen aus der reinen Funktion `stab/vorbereitung.ts:
    vorbereitungsZeilen(quellen, konv)` (Lagebild, Zustand je Quelle, Zählstände, Stab). Jede Zeile trägt `titel`, `wert`, `notiz`, `quelle` und `zustand`.
    Die Funktion formatiert nur; jede Zahl liest sie aus dem Lagebild oder dem Zähler.
  - Die Reihenfolge ist fest: Kennzahlenband des Dashboards (ohne Einsatzdauer und die
    Lageplätze), dann der Führungsstand. Danach folgen letzte Besprechung und nächster Termin.
  - Darstellung über `PaneelZeile`; Zahlen in Mono mit `tabular-nums`.
- **Text:** `vorbereitungMarkdown(zeilen, stand, konv)` erzeugt den Text. Namen und Titel werden
  maskiert wie im Funkplan. Eine Kopfzeile nennt den Stand, eine Fußzeile die Herkunft
  („zusammengestellt aus den Modulen des Einsatzes, keine Vortragsgliederung“).
- **Übernahme:**
  - Mutation wie im Funkplan: `POST …/lageberichte` mit `vorlage: 'freitext'`, `abschnitte:
    [{ schluessel: 'text', text }]`.
  - Nach Erfolg geht es zur Detailseite des neuen Berichts, ein Fehler landet über `SpeicherFehler`
    an der Seite.
  - Die Rechte-Riegel folgen dem Funkplan (`darfUebernehmen`).
- **Lageplätze Pegel und Evakuiert:** Sie kommen nicht in die Vorbereitung. Sie sind
  Entscheidungen am Einsatz mit eigener Abfrage. Wer sie braucht, liest sie auf dem Dashboard.
  Das hält den Umfang klein; die Wiedervorlage steht unter Open Questions.

## Risks / Trade-offs

- **[Sichtbare Zahländerung]** Überfällige Aufträge können sinken, überfällige Meldungen steigen.
  → In den Release-Notizen und der Abschlussmeldung als bewusste Angleichung benennen. Der Test
  „vollzogen mit Quittungslücke zählt nicht“ steht im Spec.
- **[Modulzähler und Liste laufen kurz auseinander]** Der Überblick zeigt die Zahl aus dem Zähler
  und die Auftragsliste daneben aus der Liste. Nach einem Ereignis werden beide invalidiert und
  kommen kurz nacheinander an. → Das kann einen Takt lang abweichen; derselbe Fall besteht schon
  heute zwischen Modulpanel und Liste.
- **[Last auf der Stab-Seite]** Die Stab-Seite stellt etwa 14 Abfragen. → Die Schlüssel sind mit
  dem Dashboard geteilt und über SSE live; es gibt kein Polling. Die Pegel-Abfrage läuft auf der
  Stab-Seite nicht.
- **[Vitest liest außerhalb von `frontend/`]** → Es gibt einen Vorgänger (`test/huelle.ts`), und
  der Pfad ist relativ zu `import.meta.url`. Die CI hat das ganze Repo ausgecheckt.
- **[Stärke-Umstellung ändert gezeigte Werte]** Betroffen sind nur Einsätze mit unterstellten
  Einheiten im selben Abschnitt oder BR, und dort war der alte Wert zu hoch. → Das Fixture deckt
  „gleicher Abschnitt“, „anderer Abschnitt“ und „BR mit Untereinheit“ ab.

## Migration Plan

Keine Datenmigration. `auftraege.in_arbeit` ist ein additives Feld (Codegen mitcommitten). Rückweg
ist ein Revert des PR.

## Open Questions

- Sollen die Lageplätze (Pegel, Evakuiert) später in die Vorbereitung? Das berührt weder Specs
  noch Schnitt dieser Change. Es wäre eine zusätzliche Zeile aus `kennzahlReihe`, sobald ein
  Feldbefund es verlangt.
