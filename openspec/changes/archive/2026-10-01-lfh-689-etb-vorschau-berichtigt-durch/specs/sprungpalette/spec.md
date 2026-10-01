# Spec Delta

## MODIFIED Requirements

### Requirement: Jede Datensatzsorte hat eine Vorschau
Die Palette SHALL für jeden Datensatztreffer eine Lese-Vorschau anbieten, nicht nur für
Personen. Das gilt für ETB-Eintrag, Meldung, Auftrag, Fahrzeug, Personal, Einheit, Schaden,
Unfallhilfsstelle, Lagebericht, Gefahrengebiet und Einsatzabschnitt. Jede dieser Zeilen MUST
das Vorschau-Ziel tragen, markiert oder nicht, und → MUST unter den Bedingungen aus LFH-645
(Cursor am Textende, keine Auswahl) ihre Vorschau öffnen. Rückweg, Öffnen aus der Vorschau
und Fußzeile gelten für jede Sorte wie für die Person.

Die Vorschau MUST den Status des Datensatzes mit Wort zeigen, nicht allein über Farbe, und
die Angaben, die seine Fachseite zum Lesen zeigt. Angaben, für die es keine Datenquelle
gibt, MUST sie weglassen, statt einen Platzhalter zu zeigen. Sie MUST nur lesen: Sie trägt
keine Aktion, die einen Datensatz verändert.

Die Vorschau eines ETB-Eintrags MUST jede Berichtigung, die auf diesen Eintrag zeigt, mit
ihrer laufenden Nummer und einem Verweis auf sie nennen, auch wenn die Berichtigung nicht
zur Trefferliste gehört. Ein Eintrag ohne Berichtigung MUST keinen solchen Hinweis tragen.

Zeilen ohne Datensatz tragen weiterhin keine Vorschau. Dazu gehören Module, Aktionen, der
ETB-Sammeltreffer „Alle Einträge zu …“ und der Koordinatensprung.

#### Scenario: ETB-Eintrag
- **WHEN** ein ETB-Eintrag als Treffer markiert ist, der Cursor am Textende steht und → gedrückt wird
- **THEN** zeigt die Palette Nummer, Ereigniszeit, Typ, von/an, Meldeweg, Verfasser und den Inhalt dieses Eintrags

#### Scenario: Berichtigung verweist auf den Grundeintrag
- **WHEN** die Vorschau eines ETB-Eintrags geöffnet wird, der einen älteren Eintrag berichtigt
- **THEN** sagt sie, dass er einen älteren Eintrag berichtigt, und trägt einen Verweis auf diesen Grundeintrag

#### Scenario: Berichtigter Eintrag nennt seine Berichtigungen
- **WHEN** die Vorschau von ETB-Eintrag Nr. 7 geöffnet wird und Nr. 9 und Nr. 12 Berichtigungen von Nr. 7 sind
- **THEN** trägt sie die Verweise „berichtigt durch Nr. 9“ und „berichtigt durch Nr. 12“ in aufsteigender Reihenfolge, und ein Klick auf einen davon zeigt diese Berichtigung im ETB und schließt die Palette

#### Scenario: Eintrag ohne Berichtigung
- **WHEN** die Vorschau eines ETB-Eintrags geöffnet wird, auf den keine Berichtigung zeigt
- **THEN** trägt sie keinen Hinweis „berichtigt durch“

#### Scenario: Berichtigung kommt während der offenen Vorschau dazu
- **WHEN** die Vorschau eines ETB-Eintrags offen ist und an anderer Stelle eine Berichtigung dieses Eintrags erfasst wird
- **THEN** nennt die Vorschau die neue Berichtigung, ohne dass sie neu geöffnet werden muss

#### Scenario: Meldung
- **WHEN** eine Meldung als Treffer markiert ist und → gedrückt wird
- **THEN** zeigt die Palette Nummer, Status, Priorität, Absender und Empfänger, Inhalt und Bestätigungsstand der Meldung, ohne Knöpfe zum Sichten, Bestätigen oder Erledigen

#### Scenario: Fahrzeug
- **WHEN** ein Fahrzeug als Treffer markiert ist und → gedrückt wird
- **THEN** zeigt die Palette Funkrufname, Status mit Wort, Fahrzeugtyp, Kennzeichen und Trägerorganisation, ohne Statuswahl

#### Scenario: Gefahrengebiet mit bewerteten Gefahren
- **WHEN** ein Gefahrengebiet als Treffer markiert ist, dessen Matrix Bewertungen über „keine“ trägt, und → gedrückt wird
- **THEN** zeigt die Palette Name und höchste Warnstufe des Gebiets und eine Gefahrenmatrix nur mit den Gefahren, die mindestens eine solche Bewertung haben; jede Zelle nennt ihre Warnstufe mit Kürzel, nicht allein über Farbe

#### Scenario: Gefahrengebiet ohne bewertete Gefahren
- **WHEN** ein Gefahrengebiet ohne Bewertung über „keine“ in der Vorschau geöffnet wird
- **THEN** steht statt der Matrix der Satz, dass keine Gefahren bewertet sind

#### Scenario: Ziel an jeder Datensatzzeile
- **WHEN** Treffer jeder der zwölf Datensatzsorten in der Liste stehen
- **THEN** trägt jede dieser Zeilen das Vorschau-Ziel

#### Scenario: Sammeltreffer ohne Vorschau
- **WHEN** der ETB-Sammeltreffer „Alle Einträge zu …“ markiert ist und → gedrückt wird
- **THEN** bleibt die Trefferliste stehen und die Zeile trägt kein Vorschau-Ziel
