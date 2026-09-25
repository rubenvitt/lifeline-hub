# Spec Delta

## MODIFIED Requirements

### Requirement: Fußzeile und Zeilenmarke kündigen die Wege an
Die Fußzeile der Palette SHALL den Hinweis für den neuen Tab tragen (macOS: `⌘↵`, sonst
`Strg+↵`). Innerhalb eines Einsatzes SHALL sie zusätzlich den Hinweis `→ Vorschau` tragen.
Jede Zeile mit Vorschau MUST das Vorschau-Ziel zeigen, auch wenn sie nicht markiert ist; es
ist die Zeilenmarke für die Vorschau und tritt an die Stelle der `→`-Marke aus LFH-645.
Neben dem Ziel MUST keine zweite →-Marke stehen. Die Fußzeile MUST für ⇧↵ keinen Hinweis tragen.
Solange die Vorschau offen ist, MUST die Fußzeile die dort gültigen Wege nennen: öffnen,
neuer Tab und zurück.

#### Scenario: Marke an der Personenzeile
- **WHEN** die Trefferliste eine Person und ein Modul zeigt
- **THEN** trägt die Personenzeile das Vorschau-Ziel, markiert oder nicht, und die Modulzeile trägt keins

#### Scenario: Kein zweiter Pfeil
- **WHEN** eine Zeile mit Vorschau markiert ist
- **THEN** steht in ihr neben dem Vorschau-Ziel keine →-Marke

#### Scenario: Kein Vorschauhinweis außerhalb eines Einsatzes
- **WHEN** die Palette auf der Einsatzauswahl geöffnet wird
- **THEN** nennt die Fußzeile den neuen Tab, aber keine Vorschau

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

Zeilen ohne Datensatz tragen weiterhin keine Vorschau. Dazu gehören Module, Aktionen, der
ETB-Sammeltreffer „Alle Einträge zu …“ und der Koordinatensprung.

#### Scenario: ETB-Eintrag
- **WHEN** ein ETB-Eintrag als Treffer markiert ist, der Cursor am Textende steht und → gedrückt wird
- **THEN** zeigt die Palette Nummer, Ereigniszeit, Typ, von/an, Meldeweg, Verfasser und den Inhalt dieses Eintrags

#### Scenario: Berichtigung verweist auf den Grundeintrag
- **WHEN** die Vorschau eines ETB-Eintrags geöffnet wird, der einen älteren Eintrag berichtigt
- **THEN** sagt sie, dass er einen älteren Eintrag berichtigt, und trägt einen Verweis auf diesen Grundeintrag

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

## ADDED Requirements

### Requirement: Ein Tippziel öffnet die Vorschau
Ein Tipp oder Klick auf das Vorschau-Ziel einer Zeile SHALL die Vorschau dieser Zeile öffnen
und MUST weder den Datensatz öffnen noch die Palette schließen, auch nicht mit Strg/⌘. Ein
Tipp auf die übrige Zeile SHALL wie bisher den Datensatz öffnen. Das Ziel MUST in Höhe und
Breite den Boden der aktiven Dichtestufe tragen (30/48/72 px), bündig an der rechten
Zeilenkante enden und die volle Zeilenhöhe füllen. Der Fokus MUST dabei im Suchfeld bleiben.
Das Ziel ist für Hilfstechnik verborgen; deren Weg in die Vorschau bleibt →.

#### Scenario: Tipp aufs Ziel auf dem Tablet
- **WHEN** auf dem Führungs-Tablet in der Stufe Handschuh das Vorschau-Ziel einer Person getippt wird
- **THEN** zeigt die Palette deren Vorschau, die Seite darunter bleibt stehen und der Fokus steht im Suchfeld

#### Scenario: Tipp auf die übrige Zeile
- **WHEN** auf dem Führungs-Tablet das Label derselben Zeile getippt wird
- **THEN** öffnet die App die Detailseite der Person und die Palette schließt sich

#### Scenario: Ziel an einer nicht markierten Zeile
- **WHEN** das Vorschau-Ziel einer Zeile getippt wird, die nicht markiert ist
- **THEN** öffnet sich die Vorschau dieser Zeile, ohne dass vorher gezeigt oder gepfeilt werden muss

#### Scenario: Boden in jeder Stufe
- **WHEN** die Palette in den Stufen kompakt, komfortabel und Handschuh geöffnet wird
- **THEN** misst das Vorschau-Ziel in Höhe und Breite mindestens 30, 48 und 72 px und sitzt bündig an der rechten Kante über die volle Höhe der Zeile
