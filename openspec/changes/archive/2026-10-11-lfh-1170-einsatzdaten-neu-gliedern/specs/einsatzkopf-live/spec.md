## MODIFIED Requirements

### Requirement: Der Kopf wird auf jedem Schirm frisch
Das Frontend SHALL beim Ereignis `einsatz` den Einsatzkopf, die eigene Führungsstelle und die
Stab-Anzeige des Einsatzes neu abrufen. Einsatzkopf und Führungsstelle MUST dazu in der
Live-Partition der Query-Key-Registry stehen und nicht unter den nicht-live-Keys. Der Termin der
nächsten Lagebesprechung MUST dabei aus genau einer Quelle kommen, der Spalte am Einsatz. Der
Stab-GET liefert sie mit. Einen zweiten gespeicherten Termin gibt es nicht.

#### Scenario: Zweiter Schirm sieht den neuen Termin
- **WHEN** auf Schirm A der Stab eine Lagebesprechung mit neuem Termin abschließt und Schirm B die Einsatzdaten-Seite offen hat
- **THEN** zeigt Schirm B den neuen Termin ohne Neuladen der Seite

#### Scenario: Stab-Kopfblock folgt der Einsatzdaten-Seite
- **WHEN** auf Schirm A der Termin auf der Einsatzdaten-Seite geändert wird und Schirm B die Stab-Seite offen hat
- **THEN** zeigt der Stab-Kopfblock auf Schirm B den neuen Termin ohne Neuladen

#### Scenario: Führungsstelle auf dem zweiten Schirm
- **WHEN** auf Schirm A die Sprechgruppen der Führungsstelle geändert werden und Schirm B die Einsatzdaten-Seite offen hat
- **THEN** zeigt das Paneel „Eigene Führungsstelle“ auf Schirm B die neuen Sprechgruppen ohne Neuladen

#### Scenario: Offenes Bearbeitungsformular
- **WHEN** auf Schirm B die Zeile „Sachverhalt / Meldebild“ der Einsatzdaten in Bearbeitung ist und ein Ereignis `einsatz` eintrifft
- **THEN** behält die Eingabe den Text von Schirm B, und die übrigen Angaben zeigen den neuen Stand
