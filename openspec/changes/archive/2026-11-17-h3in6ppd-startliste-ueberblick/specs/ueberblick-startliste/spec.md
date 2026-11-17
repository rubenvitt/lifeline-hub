# Spec Delta

## Purpose

Führt die Einsatzleitung nach dem Anlegen eines Einsatzes durch die ersten Erfassungen, damit
Einsatzort, Einsatzleiter, Gliederung, Kräfte und Lage nicht vergessen werden.

## ADDED Requirements

### Requirement: Fünf Punkte der Startliste

Der Überblick eines aktiven Einsatzes SHALL ein Paneel „Einsatz starten“ mit den Punkten
Einsatzort, Einsatzleiter, Einsatzabschnitte, Kräfte und erste Lagefeststellung in dieser
Reihenfolge zeigen, solange mindestens ein Punkt offen ist. Jeder Punkt MUST erledigt oder offen
zeigen; das Paneel MUST keine Zahl zeigen.

#### Scenario: Leerer Einsatz

- **WHEN** die Einsatzleitung den Überblick eines gerade angelegten Einsatzes öffnet
- **THEN** zeigt das Paneel „Einsatz starten“ alle fünf Punkte als offen

#### Scenario: Teilweise erledigt

- **WHEN** ein Einsatz einen Einsatzleiter und einen Abschnitt hat, sonst nichts
- **THEN** stehen Einsatzleiter mit seinem Namen und Einsatzabschnitte als erledigt, die übrigen
  drei als offen

### Requirement: Wann ein Punkt erledigt ist

Ein Punkt SHALL als erledigt gelten: Einsatzort, sobald ein Ortstext eingetragen ist;
Einsatzleiter, sobald einer erfasst ist; Einsatzabschnitte, sobald es einen gibt; Kräfte, sobald
der Einsatz eine Einheit oder eine Einsatzkraft führt; erste Lagefeststellung, sobald das ETB einen
Eintrag vom Typ „Lage“ hat. Hat der Einsatzort keine Koordinate, MUST der erledigte Punkt den
Zusatz „nicht verortet“ tragen.

#### Scenario: Einsatzort ohne Koordinate

- **WHEN** der Einsatzort „Deich West“ ohne Koordinate eingetragen ist
- **THEN** ist der Punkt Einsatzort erledigt, zeigt „Deich West“ und den Zusatz „nicht verortet“

#### Scenario: Kräfte nur als Personal

- **WHEN** der Einsatz keine Einheit, aber eine Einsatzkraft führt
- **THEN** ist der Punkt Kräfte erledigt

#### Scenario: Entscheidung ist keine Lagefeststellung

- **WHEN** das ETB nur einen Eintrag vom Typ „Entscheidung“ hat
- **THEN** ist der Punkt erste Lagefeststellung offen

### Requirement: Offene Punkte springen in ihre Erfassung

Jeder offene Punkt SHALL mit einem Klick dorthin führen, wo er erfasst wird: Einsatzort und
Einsatzleiter auf die Einsatzdaten zum jeweiligen Paneel, Einsatzabschnitte in die geöffnete
Erfassung eines neuen Abschnitts, Kräfte in die Einheiten, erste Lagefeststellung in die
geöffnete Erfassung des ETB.

#### Scenario: Einsatzleiter eintragen

- **WHEN** die Einsatzleitung auf den offenen Punkt Einsatzleiter klickt
- **THEN** öffnen sich die Einsatzdaten mit dem Paneel „Eigene Führungsstelle“ im Blick

#### Scenario: Abschnitt anlegen

- **WHEN** die Einsatzleitung auf den offenen Punkt Einsatzabschnitte klickt
- **THEN** öffnet sich die Seite Einsatzabschnitte mit der Erfassung eines neuen Abschnitts

### Requirement: Gesperrter Punkt gilt nicht als offen

Ist das Modul eines Punkts für die Person gesperrt oder ausgeblendet, MUST der Punkt „—“ mit dem
Grund zeigen, ohne Sprung, und MUST beim Verschwinden des Paneels nicht als offen zählen. Konnte
eine Quelle noch nie geladen werden, MUST der Punkt als unbekannt stehen, nie als offen oder
erledigt, und MUST einen Weg „Erneut abrufen“ tragen. Scheitert nur ein Neuabruf, MUST der Punkt
nach den zuletzt geladenen Daten stehen.

#### Scenario: ETB gesperrt

- **WHEN** das ETB für die Person gesperrt ist und alle anderen Punkte erledigt sind
- **THEN** zeigt der Überblick das Paneel „Einsatz starten“ nicht

#### Scenario: Quelle ausgefallen

- **WHEN** die Abschnitte nicht geladen werden können
- **THEN** steht der Punkt Einsatzabschnitte als unbekannt mit „Erneut abrufen“, und das Paneel
  bleibt stehen

#### Scenario: Neuabruf scheitert nach „alles erledigt“

- **WHEN** alle Punkte erledigt sind, das Paneel also fehlt, und ein späterer Neuabruf der
  Einheiten scheitert
- **THEN** fehlt das Paneel weiter

### Requirement: Sichtbarkeit der Startliste

Das Paneel SHALL nur Personen mit Schreibrecht in einem aktiven Einsatz erscheinen, für jede
Einsatzart gleich. Ohne Schreibrecht, am abgeschlossenen Einsatz und am Spiegel MUST es fehlen.

#### Scenario: Beobachter

- **WHEN** ein Beobachter den Überblick eines leeren aktiven Einsatzes öffnet
- **THEN** fehlt das Paneel „Einsatz starten“

#### Scenario: Übung

- **WHEN** die Einsatzleitung den Überblick einer leeren Übung öffnet
- **THEN** zeigt er das Paneel „Einsatz starten“ mit denselben fünf Punkten

### Requirement: Startliste verschwindet und lässt sich ausblenden

Sind alle Punkte erledigt oder gesperrt, MUST das Paneel fehlen, ohne Speicher und auf jedem
Bildschirm gleich. Zusätzlich SHALL jede Person es für diesen Einsatz in ihrem Browser ausblenden
können; das wirkt nur in diesem Browser und auch, wenn der Browserspeicher nicht schreibbar ist,
bis zum Neuladen.

#### Scenario: Letzter Punkt erledigt

- **WHEN** die Einsatzleitung die erste Lagefeststellung im ETB erfasst und das der letzte offene
  Punkt war
- **THEN** fehlt das Paneel beim nächsten Blick auf den Überblick

#### Scenario: Ausgeblendet

- **WHEN** die Einsatzleitung das Paneel ausblendet und den Überblick später im selben Browser
  wieder öffnet
- **THEN** fehlt das Paneel, auf einem anderen Gerät steht es weiter

### Requirement: Kein Layoutsprung durch die Startliste

Das Paneel MUST erst gezeichnet werden, wenn alle seine Quellen geladen sind, und MUST in derselben
Ladephase erscheinen wie die übrigen Paneele des Überblicks, damit nichts nachträglich verrutscht.

#### Scenario: Langsame ETB-Abfrage

- **WHEN** die Abfrage der Lagefeststellungen später antwortet als die übrigen Quellen
- **THEN** erscheinen Startliste und Paneelreihen zusammen, und keine Reihe verschiebt sich danach

#### Scenario: Quelle startet mitten in der Sitzung

- **WHEN** eine Person auf dem Überblick live Schreibrecht bekommt und die Lagefeststellungen zum
  ersten Mal geladen werden
- **THEN** bleiben Führungsstand und Paneelreihen dabei stehen, und die Startliste erscheint erst
  mit ihren Quellen
