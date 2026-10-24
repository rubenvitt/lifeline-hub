## MODIFIED Requirements

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
- **WHEN** auf Schirm A der Termin auf der Seite Lagebesprechung geändert wird und im Stabsraum ein Stabsmonitor läuft
- **THEN** zeigt die Kopfzeile des Stabsmonitors den neuen Termin ohne Neuladen

#### Scenario: Führungsstelle auf dem zweiten Schirm
- **WHEN** auf Schirm A die Sprechgruppen der Führungsstelle geändert werden und Schirm B die Einsatzdaten-Seite offen hat
- **THEN** zeigt das Paneel „Eigene Führungsstelle“ auf Schirm B die neuen Sprechgruppen ohne Neuladen

#### Scenario: Offenes Bearbeitungsformular
- **WHEN** auf Schirm B die Zeile „Sachverhalt / Meldebild“ der Einsatzdaten in Bearbeitung ist und ein Ereignis `einsatz` eintrifft
- **THEN** behält die Eingabe den Text von Schirm B, und die übrigen Angaben zeigen den neuen Stand

