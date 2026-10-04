# Spec Delta

## ADDED Requirements

### Requirement: Umschalten einer Lagekennzahl
Das System SHALL `einsatz` nach dem Commit verteilen, wenn eine Nutzeraktion die Menge der aktiven
Lagekennzahlen des Einsatzes ändert. Das gilt für das Festlegen, Ersetzen und Leeren der
maßgeblichen Pegel sowie für das Anlegen, Ändern und Stornieren eines Evakuierungsbezirks. Bleibt
die Menge gleich, MUST kein `einsatz` verteilt werden, auch wenn der Weg Daten ändert.

#### Scenario: Erster Pegel festgelegt
- **WHEN** an einem Einsatz ohne festgelegten Pegel der erste maßgebliche Pegel festgelegt wird
- **THEN** erhalten alle Abonnenten des Einsatzes ein Ereignis `einsatz`

#### Scenario: Weiterer Pegel ohne Umschalten
- **WHEN** an einem Einsatz mit festgelegtem Pegel ein zweiter Pegel angefügt oder die Liste umgeordnet wird
- **THEN** wird kein Ereignis `einsatz` verteilt

#### Scenario: Letzter Pegel entfernt
- **WHEN** die Pegelliste eines Einsatzes geleert wird
- **THEN** wird `einsatz` verteilt

#### Scenario: Erste Evakuierung angeordnet
- **WHEN** am Einsatz ohne aktiven Bezirk ein Evakuierungsbezirk angelegt wird
- **THEN** wird neben `betreuung` auch `einsatz` verteilt

#### Scenario: Zweiter Bezirk ohne Umschalten
- **WHEN** am Einsatz mit aktivem Bezirk ein weiterer Bezirk angelegt oder ein Bezirk ohne Wechsel der Räumung von oder nach „aufgehoben“ geändert wird
- **THEN** wird `betreuung`, aber kein `einsatz` verteilt

#### Scenario: Letzte Evakuierung zurückgenommen
- **WHEN** der einzige aktive Bezirk storniert oder seine Räumung auf „aufgehoben“ gesetzt wird
- **THEN** wird `einsatz` verteilt

#### Scenario: Zweiter Schirm bekommt den neuen Zuschnitt angeboten
- **WHEN** Schirm B das Lage-Dashboard eines Einsatzes ohne Pegel offen hat und Schirm A den ersten Pegel festlegt
- **THEN** bietet Schirm B ohne Neuladen per Sammelbanner „Pegel statt Verbleib offen“ an und hält die bisherige Reihe bis „übernehmen“

## MODIFIED Requirements

### Requirement: Bewusst nicht live
Die benutzerbezogenen Felder des Einsatzkopfs aus der Stab-Besetzung (`meine_sachgebiete`) SHALL
nicht über `einsatz` angestoßen werden. Sie werden erst beim nächsten Abruf des Kopfs frisch, auch
dann, wenn ein Ereignis `einsatz` aus anderem Anlass eintrifft. Eine Stab-Besetzung MUST kein
Ereignis `einsatz` auslösen. Die mitgliedschaftsbezogenen Felder (`meine_rolle`,
`meine_fuehrungsstelle`, `meine_funktion`) werden über die Mitgliedschaftsänderung frisch,
`lagekennzahlen` über ihr Umschalten.

#### Scenario: Besetzung eines Sachgebiets
- **WHEN** im Stab ein Sachgebiet besetzt wird
- **THEN** wird `stab` verteilt, aber kein `einsatz`
