# Spec Delta

## ADDED Requirements

### Requirement: Jede Datensatzsorte hat eine Vorschau
Die Palette SHALL für jeden Datensatztreffer eine Lese-Vorschau anbieten, nicht nur für
Personen. Das gilt für ETB-Eintrag, Meldung, Auftrag, Fahrzeug, Personal, Einheit, Schaden,
Unfallhilfsstelle, Lagebericht, Gefahrengebiet und Einsatzabschnitt. Jede dieser Zeilen MUST
im markierten Zustand die →-Marke tragen, und → MUST unter den Bedingungen aus LFH-645
(Cursor am Textende, keine Auswahl) ihre Vorschau öffnen. Rückweg, Öffnen aus der Vorschau
und Fußzeile gelten für jede Sorte wie für die Person.

Die Vorschau MUST den Status des Datensatzes mit Wort zeigen, nicht allein über Farbe, und
die Angaben, die seine Fachseite zum Lesen zeigt. Angaben, für die es keine Datenquelle
gibt, MUST sie weglassen, statt einen Platzhalter zu zeigen. Sie MUST nur lesen: Sie trägt
keine Aktion, die einen Datensatz verändert.

Zeilen ohne Datensatz tragen weiterhin keine Vorschau. Dazu gehören Module, Aktionen, der
ETB-Sammeltreffer „Alle Einträge zu …“ und der Koordinatensprung.

#### Scenario: ETB-Eintrag
- **WHEN** ein ETB-Eintrag als Treffer markiert ist, der Cursor am Textende steht und → gedrückt wird
- **THEN** zeigt die Palette Nummer, Ereigniszeit, Typ, von/an, Meldeweg, Verfasser und den Inhalt dieses Eintrags

#### Scenario: Meldung
- **WHEN** eine Meldung als Treffer markiert ist und → gedrückt wird
- **THEN** zeigt die Palette Nummer, Status, Priorität, Absender und Empfänger, Inhalt und Bestätigungsstand der Meldung, ohne Knöpfe zum Sichten, Bestätigen oder Erledigen

#### Scenario: Fahrzeug
- **WHEN** ein Fahrzeug als Treffer markiert ist und → gedrückt wird
- **THEN** zeigt die Palette Funkrufname, Status mit Wort, Fahrzeugtyp, Kennzeichen und Trägerorganisation, ohne Statuswahl

#### Scenario: Marke an jeder Datensatzzeile
- **WHEN** nacheinander ein Treffer jeder der zwölf Datensatzsorten markiert wird
- **THEN** trägt jede dieser Zeilen die →-Marke

#### Scenario: Sammeltreffer ohne Vorschau
- **WHEN** der ETB-Sammeltreffer „Alle Einträge zu …“ markiert ist und → gedrückt wird
- **THEN** bleibt die Trefferliste stehen und die Zeile trägt keine →-Marke

### Requirement: Die Vorschau liest den Stand der Trefferliste
Die Vorschau SHALL denselben Datenstand zeigen, aus dem der Treffer entstanden ist. Ist
dieser Stand bereits geladen, MUST das Öffnen der Vorschau ohne zusätzlichen Abruf beim
Server auskommen. Ändert sich der Datensatz während der offenen Vorschau durch eine
Live-Aktualisierung, MUST die Vorschau den neuen Stand zeigen.

#### Scenario: Kein zusätzlicher Abruf
- **WHEN** eine Meldung soeben als Treffer geladen wurde und ihre Vorschau geöffnet wird
- **THEN** geht für die Vorschau keine weitere Anfrage an den Server

#### Scenario: Live-Änderung während der Vorschau
- **WHEN** die Vorschau eines Fahrzeugs offen ist und sein Status von anderer Stelle geändert wird
- **THEN** zeigt die Vorschau den neuen Status, ohne dass sie neu geöffnet werden muss

### Requirement: Ein nicht mehr vorhandener Datensatz wird benannt
Findet die Vorschau den gezeigten Datensatz in ihrer Quelle nicht mehr, etwa weil er
gelöscht oder aufgelöst wurde, SHALL sie das mit einem Satz sagen. Sie MUST nicht leer
bleiben und MUST keinen anderen Datensatz an seiner Stelle zeigen. Ein Ladefehler MUST als
Fehler mit Wiederholen-Möglichkeit erscheinen, nicht als leere Fläche.

#### Scenario: Datensatz verschwunden
- **WHEN** die Vorschau eines Einsatzabschnitts offen ist und der Abschnitt aufgelöst wird
- **THEN** zeigt die Vorschau, dass der Abschnitt nicht mehr vorhanden ist

#### Scenario: Nummernlücke im ETB
- **WHEN** die Vorschau eines ETB-Eintrags geladen wird und die Abfrage über die laufende Nummer einen anderen Eintrag liefert
- **THEN** zeigt die Vorschau nicht diesen anderen Eintrag, sondern dass der gesuchte Eintrag nicht mehr vorhanden ist

#### Scenario: Ladefehler
- **WHEN** der Abruf für eine Vorschau scheitert
- **THEN** zeigt die Vorschau eine Fehlermeldung mit der Möglichkeit, es erneut zu versuchen

### Requirement: Verweise in der Vorschau schließen die Palette
Enthält eine Vorschau einen Verweis auf einen anderen Datensatz oder eine andere Seite, SHALL
ein Klick darauf das Ziel öffnen und die Palette schließen. Die App MUST nicht unter der
offenen Palette auf eine andere Seite wechseln.

#### Scenario: Verweis aus der Meldungsvorschau
- **WHEN** in der Vorschau einer Meldung auf den Verweis zum zugehörigen Auftrag geklickt wird
- **THEN** zeigt die App die Aufträge mit diesem Auftrag und die Palette ist geschlossen
