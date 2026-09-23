# Spec Delta

## Purpose

Die Führung sieht und steuert, wann welche Einheit im Einsatz abgelöst werden muss. Das
umfasst den Rhythmus je Abschnitt oder Einheit, Vorwarnung und Überfälligkeit, den Vollzug
mit Folgeschicht und seine Rücknahme. Jeder Schritt ist im Einsatztagebuch nachgewiesen.

## ADDED Requirements

### Requirement: Schicht einer Einheit

Das System SHALL je Einheit eines Einsatzes Schichten führen. Eine Schicht trägt Beginn
(Einsatzbeginn der Einheit), Rhythmus in Minuten, die daraus berechnete Fälligkeit
(Beginn + Rhythmus), optional eine geplante ablösende Einheit und einen Status
(`laufend` oder `abgeloest`). Je Einheit MUST höchstens eine Schicht `laufend` sein.

#### Scenario: Schicht beginnen mit eigenem Rhythmus
- **WHEN** eine Person mit Schreibrecht für Einheit „Florian 1“ eine Schicht mit Beginn 09:30 und Rhythmus 360 min anlegt
- **THEN** entsteht eine laufende Schicht mit Fälligkeit 15:30

#### Scenario: Beginn fehlt
- **WHEN** eine Schicht ohne Beginn angelegt wird
- **THEN** gilt der Zeitpunkt der Anlage als Beginn

#### Scenario: Zweite laufende Schicht
- **WHEN** für eine Einheit mit laufender Schicht eine weitere angelegt wird
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Einheit eines anderen Einsatzes
- **WHEN** die angegebene Einheit nicht zum Einsatz gehört
- **THEN** antwortet das System mit 404

#### Scenario: Ungültiger Rhythmus
- **WHEN** der Rhythmus fehlt und der Abschnitt der Einheit keine Vorgabe hat, oder der Rhythmus ≤ 0 oder > 7 Tage ist
- **THEN** antwortet das System mit 400

### Requirement: Rhythmus-Vorgabe am Abschnitt

Das System SHALL am Einsatzabschnitt eine optionale Rhythmus-Vorgabe führen. Eine neue
Schicht ohne eigenen Rhythmus MUST die Vorgabe des Abschnitts ihrer Einheit übernehmen und
ihr folgen. Ändert sich die Vorgabe, MUST das System Rhythmus und Fälligkeit aller laufenden
Schichten neu berechnen, die ihr folgen. Schichten mit eigenem Rhythmus bleiben unverändert.
Jede Änderung der Vorgabe MUST als ETB-Eintrag vom Typ Entscheidung festgehalten werden.

#### Scenario: Vorgabe verkürzt
- **WHEN** die Vorgabe von Abschnitt „Deichwache Nord“ von 480 auf 360 min gesetzt wird und dort zwei laufende Schichten der Vorgabe folgen
- **THEN** sind beide Schichten 120 min früher fällig
- **AND** das ETB enthält einen Entscheidungseintrag, der Abschnitt und neuen Rhythmus nennt

#### Scenario: Eigener Rhythmus bleibt
- **WHEN** die Vorgabe geändert wird und eine Schicht im Abschnitt einen eigenen Rhythmus trägt
- **THEN** bleibt deren Fälligkeit unverändert

#### Scenario: Vorgabe entfernen
- **WHEN** die Vorgabe entfernt wird
- **THEN** behalten laufende Schichten ihren zuletzt gültigen Rhythmus

### Requirement: Schicht bearbeiten

Das System SHALL an einer laufenden Schicht Beginn, Rhythmus (eigener Wert oder zurück zur
Abschnittsvorgabe) und geplante ablösende Einheit änderbar machen. Eine Änderung von Beginn
oder Rhythmus MUST die Fälligkeit und die zugehörigen Fristen neu setzen. Eine abgelöste
Schicht MUST NOT änderbar sein.

#### Scenario: Ablösende Einheit planen
- **WHEN** an der laufenden Schicht von „Florian 1“ die Einheit „Florian 2“ als ablösende Einheit gesetzt wird
- **THEN** zeigt die Schicht „Florian 2“ als geplante Ablösung

#### Scenario: Ablösende Einheit ist dieselbe Einheit
- **WHEN** die Einheit der Schicht als ihre eigene ablösende Einheit gesetzt wird
- **THEN** antwortet das System mit 422

#### Scenario: Abgelöste Schicht ändern
- **WHEN** eine abgelöste Schicht geändert werden soll
- **THEN** antwortet das System mit 422

### Requirement: Fälligkeit, Vorwarnung und Überfälligkeit

Das System SHALL eine laufende Schicht als `vorwarnung` einstufen, wenn ihre Fälligkeit
höchstens 30 min entfernt ist, und als `ueberfaellig`, wenn sie erreicht oder überschritten
ist. Andernfalls ist sie `planmaessig`. Die Einstufung MUST bei jedem Lesen gegen die
aktuelle Zeit berechnet werden und darf nicht davon abhängen, ob ein Hintergrundlauf
stattgefunden hat.

#### Scenario: Überfällig
- **WHEN** eine laufende Schicht um 15:30 fällig ist und um 15:31 gelesen wird
- **THEN** trägt sie die Einstufung `ueberfaellig`

#### Scenario: Vorwarnzeit
- **WHEN** dieselbe Schicht um 15:05 gelesen wird
- **THEN** trägt sie die Einstufung `vorwarnung`

### Requirement: Kopplung an den Erinnerungs-Scheduler

Das System SHALL für jede laufende Schicht eine offene Auto-Frist zur Fälligkeit führen und,
solange die Vorwarnzeit noch in der Zukunft liegt, eine zweite 30 min vor Fälligkeit.
Beim Anlegen einer Schicht und bei Änderungen von Beginn oder Rhythmus MUST das System diese
Fristen anlegen oder verschieben. Bei Vollzug MUST es sie schließen. Erreicht der Scheduler
eine dieser Fristen, MUST er genau einmal ein Live-Ereignis an alle Leser des Moduls
Ablösung senden, das die Schicht und die Art (`vorwarnung` oder `faellig`) nennt.

#### Scenario: Fristen beim Anlegen
- **WHEN** um 09:30 eine Schicht mit Fälligkeit 15:30 angelegt wird
- **THEN** gibt es für sie je eine offene Frist zu 15:00 und zu 15:30

#### Scenario: Vorwarnzeit schon vorbei
- **WHEN** eine Schicht angelegt wird, deren Fälligkeit weniger als 30 min entfernt ist
- **THEN** wird nur die Frist zur Fälligkeit angelegt

#### Scenario: Frist wandert mit
- **WHEN** der Rhythmus einer laufenden Schicht geändert wird
- **THEN** stehen ihre offenen Fristen auf den neuen Zeitpunkten, und eine schon ausgelöste Frist wird zum neuen Zeitpunkt erneut ausgelöst

#### Scenario: Einmaliges Auslösen
- **WHEN** der Scheduler die Fälligkeit einer Schicht erreicht und danach weiterläuft
- **THEN** geht genau ein Live-Ereignis `abloesung` mit Art `faellig` an die Leser des Moduls, und es wiederholt sich nicht

#### Scenario: Einheit wird aufgelöst
- **WHEN** eine Einheit mit laufender Schicht aufgelöst wird
- **THEN** sind Schicht und offene Fristen danach nicht mehr offen, und der Scheduler löst für sie nichts mehr aus

### Requirement: Vollzug mit Folgeschicht

Das System SHALL eine laufende Schicht mit Zeitpunkt (Vorgabe: jetzt) und optionaler
ablösender Einheit vollziehen. Beim Vollzug MUST die Schicht `abgeloest` werden, ihre offenen
Fristen MUST geschlossen werden, und ein ETB-Eintrag MUST Einheit, ablösende Einheit und
Zeitpunkt nennen. Ist eine ablösende Einheit angegeben, MUST für sie in derselben
Transaktion eine laufende Folgeschicht mit Beginn = Vollzugszeitpunkt und dem Rhythmus der
abgelösten Schicht entstehen, samt eigener Fristen. Hat die ablösende Einheit schon eine
laufende Schicht, MUST der Vollzug mit 422 scheitern und nichts ändern.

#### Scenario: Vollzug mit ablösender Einheit
- **WHEN** die Schicht von „Florian 1“ (Rhythmus 360 min) um 15:40 durch „Florian 2“ vollzogen wird
- **THEN** ist die Schicht von „Florian 1“ abgelöst
- **AND** „Florian 2“ hat eine laufende Schicht mit Beginn 15:40 und Fälligkeit 21:40
- **AND** das ETB enthält einen Eintrag „Ablösung vollzogen“ mit beiden Einheiten und der Uhrzeit

#### Scenario: Vollzug ohne ablösende Einheit
- **WHEN** eine Schicht ohne ablösende Einheit vollzogen wird
- **THEN** ist sie abgelöst, und es entsteht keine Folgeschicht

#### Scenario: Ablösende Einheit hat schon eine Schicht
- **WHEN** die ablösende Einheit bereits eine laufende Schicht hat
- **THEN** antwortet das System mit 422, und die ursprüngliche Schicht bleibt laufend

#### Scenario: Doppelter Vollzug
- **WHEN** eine bereits abgelöste Schicht erneut vollzogen werden soll
- **THEN** antwortet das System mit 422

### Requirement: Rücknahme eines Vollzugs

Das System SHALL einen Vollzug zurücknehmen, solange die daraus entstandene Folgeschicht
unberührt ist, also noch laufend und ohne eigenen Vollzug. Bei der Rücknahme MUST die
Folgeschicht samt ihrer Fristen entfernt werden, die abgelöste Schicht MUST wieder laufend
sein, ihre Fristen MUST wieder offen sein, ohne dass eine schon erfolgte Auslösung
wiederholt wird, und ein ETB-Eintrag vom Typ Berichtigung MUST auf den Vollzugseintrag
verweisen.

#### Scenario: Rücknahme direkt nach Vollzug
- **WHEN** ein Vollzug von „Florian 1“ durch „Florian 2“ zurückgenommen wird
- **THEN** ist die Schicht von „Florian 1“ wieder laufend mit ihrer alten Fälligkeit
- **AND** „Florian 2“ hat keine laufende Schicht mehr
- **AND** das ETB enthält eine Berichtigung zum Vollzugseintrag

#### Scenario: Folgeschicht schon vollzogen
- **WHEN** die Folgeschicht ihrerseits schon vollzogen ist
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Schicht ohne Vollzug
- **WHEN** eine laufende Schicht zurückgenommen werden soll
- **THEN** antwortet das System mit 422

### Requirement: Rechte und Modulsichtbarkeit

Lesende Endpunkte MUST Lesezugriff auf den Einsatz und das Modul Ablösung verlangen,
schreibende Endpunkte Schreibrecht im Einsatz, einen aktiven Einsatz und das Modul. Ist das
Modul im Einsatz ausgeblendet, MUST das System 403 liefern. Live-Ereignisse `abloesung` MUST
nur Abonnenten mit Zugriff auf das Modul erreichen.

#### Scenario: Beobachter liest
- **WHEN** eine Person ohne Schreibrecht die Schichten abruft
- **THEN** erhält sie die Liste

#### Scenario: Beobachter vollzieht
- **WHEN** eine Person ohne Schreibrecht einen Vollzug absendet
- **THEN** antwortet das System mit 403

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul Ablösung im Einsatz ausgeblendet ist und die Schichten abgerufen werden
- **THEN** antwortet das System mit 403

### Requirement: Anzeige im Modul

Die Seite des Moduls SHALL die laufenden Schichten nach Fälligkeit geordnet zeigen, jeweils
mit Einheit, Abschnitt, Beginn, Rhythmus (mit Kennzeichnung Vorgabe oder eigener Wert),
Fälligkeit als Uhrzeit, Einstufung als Wort und Farbe sowie der geplanten ablösenden
Einheit. Die Einstufung MUST einen zweiten Kanal neben der Farbe tragen (Wort), und nichts
davon darf blinken. Ohne Schreibrecht MUST die Seite den Grund nennen und die Aktionen
gesperrt statt entfernt zeigen. Abgelöste Schichten MUST in einer eigenen Ansicht
nachlesbar sein.

#### Scenario: Überfällige Schicht in der Liste
- **WHEN** eine Schicht überfällig ist
- **THEN** zeigt ihre Zeile die Fälligkeitsuhrzeit, das Wort „überfällig“ und die Alarmfarbe am Rand, ohne Animation

#### Scenario: Vollzug mit Rückgängig
- **WHEN** eine Person eine Ablösung über den Dialog vollzieht
- **THEN** zeigt die Seite einen Hinweis mit der Aktion „Rückgängig“, die die Rücknahme auslöst

### Requirement: Hinweis in der AlarmZentrale

Die Oberfläche SHALL auf ein Live-Ereignis `abloesung` mit Art `vorwarnung` oder `faellig`
genau einen Hinweis in der AlarmZentrale zeigen, mit Einheit, Uhrzeit und einem Sprung zur
Seite Ablösung. Der Hinweis MUST dem bestehenden Budget der AlarmZentrale unterliegen
(höchstens drei sichtbar, der Rest gebündelt) und quittierbar sein. Dieselbe Fälligkeit
darf nicht zusätzlich als allgemeine Erinnerung alarmieren.

#### Scenario: Fälligkeit erreicht
- **WHEN** das Live-Ereignis für die Fälligkeit der Schicht von „Florian 1“ eintrifft
- **THEN** erscheint ein Hinweis „Ablösung fällig: Florian 1, 15:30“ mit Sprung zur Seite Ablösung

#### Scenario: Kein Doppelalarm
- **WHEN** zur selben Fälligkeit auch ein Erinnerungs-Ereignis mit Bezug Ablösung eintrifft
- **THEN** entsteht dafür kein zweiter Hinweis

### Requirement: Marke im Überblick und Modulzähler

Der Überblick SHALL laufende Schichten als Marken unter „Nächste Marken“ führen. Schichten
desselben Abschnitts mit gleicher Fälligkeit (minutengenau) MUST zu einer Marke
„Ablösung <Abschnitt>, <n> Einheiten“ zusammengefasst werden, eine einzelne Schicht als
„Ablösung <Einheit>“. Das Modulpanel SHALL am Modul Ablösung die Zahl der Schichten mit
Einstufung `vorwarnung` oder `ueberfaellig` zeigen. Die Marken und der Zähler MUST nur
erscheinen, wenn das Modul für die Person sichtbar ist.

#### Scenario: Zusammengefasste Marke
- **WHEN** zwei Einheiten im Abschnitt „Deichwache Nord“ beide um 15:30 fällig sind
- **THEN** zeigt der Überblick eine Marke „15:30 Ablösung Deichwache Nord, 2 Einheiten“

#### Scenario: Zähler
- **WHEN** eine Schicht überfällig ist, eine in 20 min fällig und eine in 3 h
- **THEN** zeigt das Modulpanel am Modul Ablösung die Zahl 2
