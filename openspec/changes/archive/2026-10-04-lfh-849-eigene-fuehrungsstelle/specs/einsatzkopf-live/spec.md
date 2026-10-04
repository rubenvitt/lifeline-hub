# Spec Delta

## MODIFIED Requirements

### Requirement: Ereignis für den Einsatzkopf
Das System SHALL ein SSE-Ereignis mit dem Wire-Namen `einsatz` verteilen, sobald eine Nutzeraktion
eine Spalte des Einsatzkopfs ändert. Das Ereignis MUST erst nach dem Commit der schreibenden
Transaktion verteilt werden. Seine Nutzlast MUST nur die Kennung des Einsatzes tragen
(`{"einsatz_id": <id>}`) und keine Kopfdaten.

Das Ereignis MUST verteilt werden nach
- einer erfolgreichen Änderung der Kopfdaten (`PATCH /api/einsaetze/{id}`),
- einer erfolgreichen Änderung der eigenen Führungsstelle (`PATCH /api/einsaetze/{id}/fuehrungsstelle`),
- dem Abschluss des Einsatzes (`POST /api/einsaetze/{id}/abschliessen`),
- dem Setzen, Ändern oder Aufheben der Aufbewahrungsfrist (`PUT /api/einsaetze/{id}/aufbewahrungsfrist`),
- dem Abschluss einer Lagebesprechung, der den Termin der nächsten Lagebesprechung auf einen
  **anderen** Wert setzt (auch auf „kein Termin").

#### Scenario: Termin auf der Einsatzdaten-Seite gepflegt
- **WHEN** eine Person mit Schreibrecht den Termin der nächsten Lagebesprechung per PATCH ändert
- **THEN** erhält jeder Abonnent des Einsatzes ein Ereignis `einsatz` mit genau der Einsatzkennung als Nutzlast

#### Scenario: Führungsstelle gepflegt
- **WHEN** eine Person mit Schreibrecht den Rufnamen der Führungsstelle ändert
- **THEN** erhält jeder Abonnent des Einsatzes ein Ereignis `einsatz` mit genau der Einsatzkennung als Nutzlast

#### Scenario: Einsatz abgeschlossen
- **WHEN** die Einsatzleitung den Einsatz abschließt
- **THEN** erhalten alle Abonnenten des Einsatzes ein Ereignis `einsatz`

#### Scenario: Lagebesprechung setzt einen neuen Termin
- **WHEN** eine Lagebesprechung mit einem Termin abgeschlossen wird, der vom bisherigen abweicht
- **THEN** wird neben `stab` und `etb` auch `einsatz` verteilt

#### Scenario: Lagebesprechung ohne Terminänderung
- **WHEN** eine Lagebesprechung ohne den Schlüssel `naechste_at` oder mit dem bisherigen Termin abgeschlossen wird
- **THEN** wird kein Ereignis `einsatz` verteilt

#### Scenario: Abgelehnte Änderung
- **WHEN** ein PATCH der Kopfdaten oder der Führungsstelle abgelehnt wird (400, 403, 409, 422)
- **THEN** wird kein Ereignis `einsatz` verteilt

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
- **WHEN** auf Schirm B das Formular „Einsatzdaten bearbeiten" offen ist und ein Ereignis `einsatz` eintrifft
- **THEN** behält das Formular die Eingaben von Schirm B
