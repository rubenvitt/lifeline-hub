# Design

## Context

Motivation: `proposal.md`, Why. Die Auslöser der Lagekennzahlen sind zwei `EXISTS`-Spalten, die
`einsatz::repo::laden` und `liste_fuer` wortgleich führen (`lagekennzahl::ableiten`):
ein Eintrag in `einsatz_pegel` und ein Bezirk mit `storniert_at IS NULL AND raeumung <> 'aufgehoben'`.

Geschrieben werden die Auslöser an genau fünf Stellen, alle unter `write_retry!` (`BEGIN IMMEDIATE`):
`pegel::repo::ersetzen` und `anfuegen` (die Repo-Funktion öffnet die Transaktion selbst) sowie
`betreuung::repo::bezirk_anlegen_tx`, `bezirk_aendern_tx` und `bezirk_stornieren_tx` (die Route
öffnet sie). Die Prognose (`setze_prognose`) und die Standmeldungen berühren keinen Auslöser.

`einsatz` hat eine leere Gate-Menge und erreicht jeden Leser des Stroms (LFH-555 D2). Der Kopf-GET
liefert `lagekennzahlen` jedem Leser, auch ohne Modul Betreuung: auf Platz 3 steht dann „Evakuiert“
ohne Zahl (Spec `lage-dashboard-kennzahlreihe`).

## Goals / Non-Goals

**Goals:**
- `einsatz` genau dann, wenn sich die Menge der Lagekennzahlen durch eine Nutzeraktion ändert.
- Der Abwesenheitsfall ist per Test belegt (Ticket-Akzeptanzkriterium 2).

**Non-Goals:**
- Scheduler-Wege (Soft-Delete, Purge, Schwärzung) und der Demo-Import: sie laufen an
  abgeschlossenen bzw. neu angelegten Einsätzen (LFH-555 D5, letzter Punkt).
- Die eigenen Invalidierungen im Frontend bleiben. Die Spec `lage-dashboard-kennzahlreihe`
  verlangt sie („Eigene Anordnung“), und sie wirken auch bei gestörtem Strom.

## Decisions

### D1 — Vorher/nachher in derselben Transaktion

`einsatz::lagekennzahl` bekommt `lesen(conn, einsatz_id) -> Vec<Lagekennzahl>`: eine Abfrage mit
denselben zwei `EXISTS`-Ausdrücken, ausgewertet über `ableiten`. Jeder Schreibweg ruft sie zu
Beginn und am Ende seiner Transaktion und meldet `umgeschaltet = vorher != nachher`. Unter
`BEGIN IMMEDIATE` schreibt niemand dazwischen; der Vergleich ist exakt. Das ist die Technik aus
LFH-555 D3 (Zustand vor und nach vergleichen), nur über eine abgeleitete Menge statt eine Spalte.

**Verworfen:**
- *Aus der Operation schließen* (z. B. „anfügen bei leerer Liste“, „Räumung wechselt über
  `aufgehoben`“): verteilt das Prädikat der Kennzahl auf fünf Stellen, und ein künftiger dritter
  Auslöser oder ein geändertes Bezirksprädikat liefe still auseinander.
- *Bei jeder Änderung feuern*: das Ticket schließt es aus, und jeder zweite Pegel oder jede
  Bezirksänderung riefe den Kopf auf allen Schirmen ab.

Die `EXISTS`-Ausdrücke stehen damit an drei Stellen (sqlx nimmt nur `&'static str`, vgl. Kommentar
an `ableiten`). Der Abgleich bleibt testgetragen: die bestehenden Tests in `tests/pegel.rs` und
`tests/betreuung.rs` prüfen Detail und Liste, die neuen Tests prüfen das Ereignis — läuft `lesen`
auseinander, fehlt das Ereignis oder kommt zu oft.

### D2 — Wer vergleicht

- **Pegel:** `repo::ersetzen` und `repo::anfuegen` öffnen die Transaktion selbst; sie geben
  `umgeschaltet` zurück (`ersetzen` → `bool`, `anfuegen` → ein kleines Ergebnis mit `neu` und
  `umgeschaltet`).
- **Bezirke:** Die Route öffnet die Transaktion. Sie liest `lesen` vor und nach dem `_tx`-Aufruf
  im selben `write_retry!`-Block; die Repo-Funktionen bleiben unverändert.

Die Route ruft nach dem Commit `routes::einsatz::kopf_geaendert`, wenn `umgeschaltet`. Das meldet
zugleich `einsatzliste` (LFH-734): die Liste trägt dieselben `lagekennzahlen`.

### D3 — Kein Leck

Ein Leser ohne Modul Betreuung erfährt aus `einsatz` nichts, was der Kopf-GET ihm nicht ohnehin
zeigt: dass `evakuiert` hinzukam oder wegfiel. Bezirksänderungen ohne Umschalten bleiben für ihn
unsichtbar, weil dann kein `einsatz` fällt — dieselbe Abwägung wie LFH-555 D3. Die Gate-Menge
von `einsatz` bleibt leer, `betreuung` bleibt gegatet.

### D4 — Frontend

Kein Code. `EINSATZ_STREAM_EVENTS.einsatz` frischt den Kopf auf; das Lage-Dashboard hält den
Zuschnitt und bietet den neuen per Sammelbanner an (`LageDashboardPage.tsx`, gehaltener
Zuschnitt). Die Kommentare, die das Gegenteil sagen (`queryKeys.ts` am Eintrag `einsatz`,
`BetreuungPage.tsx` an `invalidiereBezirk`, Modulkopf von `routes/pegel.rs`), werden
nachgezogen. Ein e2e-Fall belegt Akzeptanzkriterium 1 über den echten Strom.

## Risks / Trade-offs

- [Zwei zusätzliche Leseabfragen je Schreibweg] → zwei `EXISTS` über indizierte Fremdschlüssel in
  einer ohnehin offenen Transaktion; die Wege sind selten (Festlegung, Anordnung).
- [Prädikat an drei Stellen] → D1; die Tests decken Detail, Liste und Ereignis ab.
- [Mehr Kopf-Abrufe] → nur beim Umschalten, also wenige Male je Einsatz.

## Migration Plan

Keine Daten- oder Wire-Änderung. Ein PR: Backend mit Tests, Kommentare, e2e-Fall, Archiv.
