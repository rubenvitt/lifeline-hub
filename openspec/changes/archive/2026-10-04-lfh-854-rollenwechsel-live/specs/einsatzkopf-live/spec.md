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
  **anderen** Wert setzt (auch auf „kein Termin"),
- dem erfolgreichen Setzen, Ändern oder Entfernen einer Mitgliedschaft
  (`PUT`/`DELETE /api/einsaetze/{id}/mitglieder/{benutzer_id}`, LFH-854).

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

#### Scenario: Rolle eines Mitglieds geändert
- **WHEN** die Einsatzleitung ein Mitglied vom Beobachter auf Führungspersonal setzt
- **THEN** erhalten alle Abonnenten des Einsatzes genau ein Ereignis `einsatz` mit genau der Einsatzkennung als Nutzlast

#### Scenario: Mitglied entfernt
- **WHEN** die Einsatzleitung ein Mitglied aus dem Einsatz entfernt
- **THEN** erhalten alle Abonnenten des Einsatzes ein Ereignis `einsatz`

#### Scenario: Abgelehnte Mitgliedschaftsänderung
- **WHEN** das Herabstufen oder Entfernen der letzten Einsatzleitung (409), das Setzen eines unbekannten Benutzers (404) oder eine Mitgliedschaftsänderung ohne Leitungsrecht (403) abgelehnt wird
- **THEN** wird kein Ereignis `einsatz` verteilt

#### Scenario: Schreibrecht der betroffenen Person ohne Neuladen
- **WHEN** die betroffene Person den Einsatz offen hat und die Einsatzleitung sie vom Beobachter auf Führungspersonal setzt
- **THEN** zeigt ihr Schirm die zuvor gesperrte Primäraktion ohne Neuladen der Seite als frei

### Requirement: Bewusst nicht live
Die benutzerbezogenen Felder des Einsatzkopfs aus der Stab-Besetzung (`meine_sachgebiete`) und
`lagekennzahlen` SHALL nicht über `einsatz` angestoßen werden. Sie werden erst beim nächsten Abruf
des Kopfs frisch, auch dann, wenn ein Ereignis `einsatz` aus anderem Anlass eintrifft. Eine
Stab-Besetzung MUST kein Ereignis `einsatz` auslösen. Die mitgliedschaftsbezogenen Felder
(`meine_rolle`, `meine_fuehrungsstelle`, `meine_funktion`) werden über die Mitgliedschaftsänderung frisch.

#### Scenario: Besetzung eines Sachgebiets
- **WHEN** im Stab ein Sachgebiet besetzt wird
- **THEN** wird `stab` verteilt, aber kein `einsatz`
