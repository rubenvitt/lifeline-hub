# Spec Delta

## Purpose

S2 bereitet die Lagebesprechung vor (FwDV 100 Anl. 2). Die Stab-Seite zeigt dafür den Lagestand
zur nächsten Besprechung aus denselben Zahlen wie das Lage-Dashboard, mit Quelle je Angabe, und
übernimmt ihn auf Wunsch in einen Lagebericht.

## ADDED Requirements

### Requirement: Paneel „Vorbereitung“ auf der Stab-Seite
Die Stab-Seite SHALL unter dem Paneel „Lagebesprechung“ ein Paneel „Vorbereitung“ zeigen. Es
enthält den Lagestand für die nächste Besprechung:
- Betroffene mit Zahl der Vermissten;
- Sichtungsverteilung;
- Kräfte (Stärke in BOS-Schreibweise);
- höchste Warnstufe mit Zahl der Gebiete;
- Aufträge offen mit überfälligen;
- Meldungen offen mit neuen und mit überfälliger Bestätigung;
- der jüngste Lagebericht mit Stand und Status;
- die letzte Lagebesprechung mit Nummer und Zeit, und der nächste Termin.

Jede Zahl MUST denselben Wert haben, den das Lage-Dashboard für diesen Einsatz zur selben Zeit
zeigt. Das Paneel MUST keine Zahl selbst rechnen, die das Dashboard schon zeigt. Der Lagestand
MUST den Zeitpunkt nennen, auf dem er beruht („Stand HH:MM“, den ältesten Stand seiner Quellen).
Er MUST sich live aktualisieren wie das Dashboard.

#### Scenario: Gleiche Zahlen wie das Dashboard
- **WHEN** das Lage-Dashboard 248 Betroffene, davon 3 vermisst, und 5 offene Aufträge, davon 1
  überfällig, zeigt
- **THEN** zeigt die Vorbereitung dieselben Werte

#### Scenario: Neue Meldung während der Vorbereitung
- **WHEN** eine andere Person eine Meldung erfasst, während die Stab-Seite offen ist
- **THEN** steigt „Meldungen offen“ in der Vorbereitung ohne Neuladen

### Requirement: Quelle je Angabe
Jede Zeile der Vorbereitung SHALL das Modul nennen, aus dem ihre Angabe stammt, zum Beispiel
„Quelle: Betroffene“. Die Reihenfolge der Zeilen MUST der Reihenfolge des Lage-Dashboards folgen
und MUST NOT eine Vortragsfolge nach Sachgebieten oder nach Lehrmeinung nachbilden. Die
Vorbereitung MUST NOT Zeilen Sprechern oder Sachgebieten zuordnen.

#### Scenario: Quellenangabe
- **WHEN** die Vorbereitung die Kräfte zeigt
- **THEN** nennt die Zeile ihre Quelle, und die übernommene Fassung trägt dieselbe Quellenangabe

### Requirement: Rechteweiche je Quelle in der Vorbereitung
Die Vorbereitung SHALL jede Quelle einzeln laden. Wird eine Quelle abgelehnt oder scheitert ihr
Abruf, MUST die Zeile „—“ mit dem Grund zeigen, „nicht freigegeben“ bzw. „nicht geladen“. Die
übrigen Zeilen MUST sie weiter zeigen. Eine fehlende Quelle MUST NOT als 0 erscheinen. Die Seite
Stab prüft ihre eigene Freigabe; die Vorbereitung ist keine Freigabe für die Quellmodule.

#### Scenario: Betroffene gesperrt
- **WHEN** die Person das Modul Betroffene nicht sehen darf
- **THEN** zeigen die Zeilen Betroffene und Sichtung „—“ mit „nicht freigegeben“, und die übrigen
  Zeilen zeigen ihre Werte

### Requirement: In Lagebericht übernehmen
Personen mit Schreibrecht im Einsatz SHALL den Lagestand der Vorbereitung mit einer Aktion in
einen neuen Lagebericht übernehmen können. Der Bericht hat die Vorlage Freitext und den Titel
„Vorbereitung Lagebesprechung <DTG>“.
- Der Text MUST jede Zeile mit Wert und Quelle wiedergeben. Eine fehlende Quelle MUST mit Grund
  erscheinen. Der Stand MUST im Text stehen.
- Die Übernahme MUST in einem einzigen Schritt geschehen, nach `dokument-uebernahme`.
- Die Aktion MUST gesperrt sein, solange eine Quelle noch lädt.
- Die Aktion MUST fehlen, wenn das Modul Lageberichte für die Person nicht freigegeben ist oder
  ihr das Schreibrecht fehlt.
- Nach dem Erfolg SHALL der neue Lagebericht geöffnet werden.
- Scheitert die Übernahme, MUST der Fehler an der Seite stehen, und es MUST kein leerer Entwurf
  entstehen.

#### Scenario: Übernahme gelingt
- **WHEN** eine Person mit Schreibrecht „In Lagebericht übernehmen“ wählt
- **THEN** entsteht genau ein Lagebericht „Vorbereitung Lagebesprechung <DTG>“ mit dem Lagestand
  als Text, und er wird geöffnet

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht die Stab-Seite öffnet
- **THEN** zeigt die Vorbereitung den Lagestand, und die Aktion „In Lagebericht übernehmen“ fehlt

### Requirement: Nichts wird eingefroren
Die Vorbereitung SHALL keinen Lagestand speichern. Das Abschließen einer Lagebesprechung MUST
unverändert bleiben und MUST NOT Zahlen der Vorbereitung festhalten. Ein fester Stand entsteht nur
durch die Übernahme in einen Lagebericht.

#### Scenario: Abschluss ohne Zahlen
- **WHEN** eine Lagebesprechung abgeschlossen wird
- **THEN** enthält der gespeicherte Datensatz wie bisher Zeit, Entschluss und nächsten Termin und
  keine Zahlen des Lagestands
