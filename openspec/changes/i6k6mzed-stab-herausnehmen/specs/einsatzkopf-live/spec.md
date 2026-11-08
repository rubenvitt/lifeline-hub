# Spec Delta

## MODIFIED Requirements

### Requirement: Wer vom Einsatzkopf erfährt
Das Ereignis `einsatz` MUST jeden Abonnenten erreichen, der den Live-Strom des Einsatzes öffnen darf,
unabhängig von seinen Modulfreigaben. Die Tür des Stroms und die des Einsatzkopfs sind dieselbe
(Lesezugriff auf den Einsatz ohne Modul). Außer `einsatz` und dem Kontrollereignis `lagged` MUST
jedes Einsatz-Ereignis mindestens einem Modul zugeordnet bleiben. Die Org-Ereignisse `einsatzliste`
und `stammdaten`, die derselbe Strom mitträgt (LFH-734), sind keine Einsatz-Ereignisse: sie gehören
keinem Modul und folgen den Gates der Fähigkeit `org-live`. Ihre Wire-Namen MUST sich von allen
Einsatz-Ereignissen unterscheiden.

#### Scenario: Leser ohne jedes ausblendbare Modul
- **WHEN** ein Mitglied, dem jedes ausblendbare Modul des Einsatzes entzogen ist, den Strom geöffnet hat und der Kopf geändert wird
- **THEN** erhält es das Ereignis `einsatz`

#### Scenario: Leser ohne Stab-Recht bei einer Besprechung ohne neuen Termin
- **WHEN** ein Mitglied mit Freigabe der Lagebesprechung den Strom geöffnet hat und eine Lagebesprechung ohne Terminänderung abgeschlossen wird
- **THEN** erhält es `lagebesprechung`, aber kein `einsatz`

#### Scenario: Leser ohne Lagebesprechungs-Recht bei einer Besprechung ohne neuen Termin
- **WHEN** ein Mitglied ohne Freigabe der Lagebesprechung den Strom geöffnet hat und eine Lagebesprechung ohne Terminänderung abgeschlossen wird
- **THEN** erhält es weder `lagebesprechung` noch `einsatz`

#### Scenario: Org-Ereignis auf dem Einsatz-Strom
- **WHEN** ein Mitglied den Strom eines Einsatzes geöffnet hat und der System-Admin seiner Organisation ein Fahrzeug im Katalog ändert
- **THEN** erhält es auf demselben Strom das Ereignis `stammdaten`, unabhängig von seinen Modulfreigaben

### Requirement: Der Kopf wird auf jedem Schirm frisch
Das Frontend SHALL beim Ereignis `einsatz` den Einsatzkopf, die eigene Führungsstelle und die
Lagebesprechungs-Anzeige des Einsatzes neu abrufen. Einsatzkopf und Führungsstelle MUST dazu in der
Live-Partition der Query-Key-Registry stehen und nicht unter den nicht-live-Keys. Der Termin der
nächsten Lagebesprechung MUST dabei aus genau einer Quelle kommen, der Spalte am Einsatz. Die
Lagebesprechungs-Anzeige liefert sie mit. Einen zweiten gespeicherten Termin gibt es nicht.

#### Scenario: Zweiter Schirm sieht den neuen Termin
- **WHEN** auf Schirm A eine Lagebesprechung mit neuem Termin abgeschlossen wird und Schirm B den Führungsüberblick offen hat
- **THEN** zeigt die Marke „Lagebesprechung“ auf Schirm B den neuen Termin ohne Neuladen der Seite

#### Scenario: Stab-Kopfblock folgt der Einsatzdaten-Seite
- **WHEN** auf Schirm A der Termin per Schnellwahl auf der Seite Lagebesprechung geändert wird und Schirm B dieselbe Seite offen hat
- **THEN** zeigt der Kopf der Seite Lagebesprechung auf Schirm B den neuen Termin ohne Neuladen

#### Scenario: Führungsstelle auf dem zweiten Schirm
- **WHEN** auf Schirm A die Sprechgruppen der Führungsstelle geändert werden und Schirm B die Einsatzdaten-Seite offen hat
- **THEN** zeigt das Paneel „Eigene Führungsstelle“ auf Schirm B die neuen Sprechgruppen ohne Neuladen

#### Scenario: Offenes Bearbeitungsformular
- **WHEN** auf Schirm B die Zeile „Sachverhalt / Meldebild“ der Einsatzdaten in Bearbeitung ist und ein Ereignis `einsatz` eintrifft
- **THEN** behält die Eingabe den Text von Schirm B, und die übrigen Angaben zeigen den neuen Stand

## REMOVED Requirements

### Requirement: Bewusst nicht live
**Reason**: Die Stab-Besetzung, aus der `meine_sachgebiete` ohne Ereignis `einsatz` entstand, entfällt mit dem Modul Stab (LLH-722, Entscheidung 08.11.2026; design.md D1, D2). Alle benutzerbezogenen Felder des Kopfs folgen nun der Mitgliedschaft.
**Migration**: Requirement „Funktionsfelder folgen der Mitgliedschaft“ dieser Fähigkeit; `meine_sachgebiete` und `meine_funktion` werden über die Mitgliedschaftsänderung frisch, `lagekennzahlen` weiter über „Umschalten einer Lagekennzahl“.

## ADDED Requirements

### Requirement: Funktionsfelder folgen der Mitgliedschaft
Die benutzerbezogenen Felder des Einsatzkopfs (`meine_rolle`, `meine_fuehrungsstelle`,
`meine_funktion`, `meine_sachgebiete`) SHALL allein aus der eigenen Mitgliedschaft folgen;
`meine_sachgebiete` enthält höchstens das Sachgebiet der eigenen Führungsfunktion. Sie MUST über das
Ereignis `einsatz` der Mitgliedschaftsänderung frisch werden, `lagekennzahlen` über ihr Umschalten.

#### Scenario: Führungsfunktion gesetzt
- **WHEN** die Einsatzleitung einem Mitglied, das den Einsatz offen hat, die Führungsstelle `s2` setzt
- **THEN** wird `einsatz` verteilt, und der Kopf des Mitglieds trägt ohne Neuladen `meine_sachgebiete` mit S2 und die Funktion „S2 Lage“

#### Scenario: Höchstens ein Sachgebiet
- **WHEN** ein Mitglied die Führungsstelle `fachberater` mit der Bezeichnung „THW“ trägt
- **THEN** ist `meine_sachgebiete` leer
