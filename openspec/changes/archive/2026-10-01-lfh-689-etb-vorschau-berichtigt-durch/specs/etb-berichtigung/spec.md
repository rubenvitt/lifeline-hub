# Spec Delta

## Purpose

Ein ETB-Eintrag wird nie geändert, sondern durch einen neuen Eintrag vom Typ Berichtigung
korrigiert. Diese Fähigkeit legt fest, wie die API die Verknüpfung zwischen Berichtigung und
Grundeintrag in beiden Richtungen am Eintrag ausliefert, damit jede Ansicht einen überholten
Eintrag als überholt erkennen kann.

## ADDED Requirements

### Requirement: ETB-Eintrag führt seine Berichtigungen auf dem Wire
Jede API-Antwort, die einen ETB-Eintrag ausliefert (Liste, Einzelladen, Antwort auf das
Erfassen), SHALL das Feld `berichtigt_durch` tragen: alle Einträge vom Typ Berichtigung,
deren `berichtigt_eintrag_id` auf diesen Eintrag zeigt, je mit `id` und `lfd_nr`,
aufsteigend nach `lfd_nr`. Ohne Berichtigung SHALL das Feld leer sein, nicht fehlend.

#### Scenario: Eintrag ohne Berichtigung
- **WHEN** ein ETB-Eintrag abgefragt wird, auf den keine Berichtigung zeigt
- **THEN** trägt er `berichtigt_durch: []`

#### Scenario: Zwei Berichtigungen eines Eintrags
- **WHEN** Eintrag Nr. 7 durch Nr. 9 und Nr. 12 berichtigt wurde und die ETB-Liste abgefragt wird
- **THEN** trägt Nr. 7 `berichtigt_durch` mit Nr. 9 und Nr. 12 in dieser Reihenfolge, je mit `id` und `lfd_nr`
- **AND** die Berichtigungen selbst tragen `berichtigt_durch: []`, solange sie nicht ihrerseits berichtigt wurden

#### Scenario: Antwort auf das Erfassen
- **WHEN** ein Eintrag erfasst wird
- **THEN** trägt die Antwort `berichtigt_durch: []`

### Requirement: Berichtigungen unabhängig von Seite und Filter
Das Feld `berichtigt_durch` SHALL vollständig sein, unabhängig davon, auf welcher Seite der
Abfrage die Berichtigung stünde und ob sie zum aktiven Listenfilter passt. Es SHALL nur
Berichtigungen desselben Einsatzes nennen.

#### Scenario: Berichtigung auf einer anderen Seite
- **WHEN** die ETB-Liste mit Cursor und `limit: 1` so abgefragt wird, dass nur der Grundeintrag auf der Seite steht
- **THEN** trägt der Grundeintrag seine Berichtigung trotzdem in `berichtigt_durch`

#### Scenario: Gefilterte Liste
- **WHEN** die ETB-Liste nur nach Typ Meldung gefiltert abgefragt wird und eine Meldung berichtigt wurde
- **THEN** trägt diese Meldung ihre Berichtigung in `berichtigt_durch`, obwohl die Berichtigung selbst nicht in der Liste steht

### Requirement: Archiv-ETB bleibt ohne abgeleitete Verweise
Die ETB-Liste des Aufbewahrungsarchivs SHALL das Feld `berichtigt_durch` nicht tragen, so wie
sie die übrigen nachgeladenen Verweise nicht trägt. Die Vorwärtsrichtung
`berichtigt_eintrag_id` SHALL dort erhalten bleiben.

#### Scenario: Archivierter Einsatz
- **WHEN** das ETB eines archivierten Einsatzes über das Archiv abgefragt wird
- **THEN** trägt kein Eintrag `berichtigt_durch`, und die Berichtigung trägt weiter `berichtigt_eintrag_id`
