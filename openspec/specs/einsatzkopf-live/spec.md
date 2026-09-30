# einsatzkopf-live Specification

## Purpose
Der Einsatzkopf (Stammdaten, Status, Termin der nächsten Lagebesprechung) wird auf jedem Schirm
frisch, sobald eine Nutzeraktion ihn ändert. Die Spec legt fest, welche Wege das SSE-Ereignis
`einsatz` auslösen, wer es empfängt und was bewusst nicht live ist (LFH-555).

## Requirements

### Requirement: Ereignis für den Einsatzkopf
Das System SHALL ein SSE-Ereignis mit dem Wire-Namen `einsatz` verteilen, sobald eine Nutzeraktion
eine Spalte des Einsatzkopfs ändert. Das Ereignis MUST erst nach dem Commit der schreibenden
Transaktion verteilt werden. Seine Nutzlast MUST nur die Kennung des Einsatzes tragen
(`{"einsatz_id": <id>}`) und keine Kopfdaten.

Das Ereignis MUST verteilt werden nach
- einer erfolgreichen Änderung der Kopfdaten (`PATCH /api/einsaetze/{id}`),
- dem Abschluss des Einsatzes (`POST /api/einsaetze/{id}/abschliessen`),
- dem Setzen, Ändern oder Aufheben der Aufbewahrungsfrist (`PUT /api/einsaetze/{id}/aufbewahrungsfrist`),
- dem Abschluss einer Lagebesprechung, der den Termin der nächsten Lagebesprechung auf einen
  **anderen** Wert setzt (auch auf „kein Termin").

#### Scenario: Termin auf der Einsatzdaten-Seite gepflegt
- **WHEN** eine Person mit Schreibrecht den Termin der nächsten Lagebesprechung per PATCH ändert
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
- **WHEN** ein PATCH der Kopfdaten abgelehnt wird (400, 403, 409)
- **THEN** wird kein Ereignis `einsatz` verteilt

### Requirement: Wer vom Einsatzkopf erfährt
Das Ereignis `einsatz` MUST jeden Abonnenten erreichen, der den Live-Strom des Einsatzes öffnen darf,
unabhängig von seinen Modulfreigaben. Die Tür des Stroms und die des Einsatzkopfs sind dieselbe
(Lesezugriff auf den Einsatz ohne Modul). Außer `einsatz` und dem Kontrollereignis `lagged` MUST
jedes Ereignis mindestens einem Modul zugeordnet bleiben.

#### Scenario: Leser ohne jedes ausblendbare Modul
- **WHEN** ein Mitglied, dem jedes ausblendbare Modul des Einsatzes entzogen ist, den Strom geöffnet hat und der Kopf geändert wird
- **THEN** erhält es das Ereignis `einsatz`

#### Scenario: Leser ohne Stab-Recht bei einer Besprechung ohne neuen Termin
- **WHEN** ein Mitglied ohne Stab-Recht den Strom geöffnet hat und eine Lagebesprechung ohne Terminänderung abgeschlossen wird
- **THEN** erhält es weder `stab` noch `einsatz`

### Requirement: Der Kopf wird auf jedem Schirm frisch
Das Frontend SHALL beim Ereignis `einsatz` den Einsatzkopf und die Stab-Anzeige des Einsatzes neu
abrufen. Der Einsatzkopf MUST dazu in der Live-Partition der Query-Key-Registry stehen und nicht
mehr unter den nicht-live-Keys. Der Termin der nächsten Lagebesprechung MUST dabei aus genau einer
Quelle kommen, der Spalte am Einsatz. Der Stab-GET liefert sie mit. Einen zweiten gespeicherten Termin
gibt es nicht.

#### Scenario: Zweiter Schirm sieht den neuen Termin
- **WHEN** auf Schirm A der Stab eine Lagebesprechung mit neuem Termin abschließt und Schirm B die Einsatzdaten-Seite offen hat
- **THEN** zeigt Schirm B den neuen Termin ohne Neuladen der Seite

#### Scenario: Stab-Kopfblock folgt der Einsatzdaten-Seite
- **WHEN** auf Schirm A der Termin auf der Einsatzdaten-Seite geändert wird und Schirm B die Stab-Seite offen hat
- **THEN** zeigt der Stab-Kopfblock auf Schirm B den neuen Termin ohne Neuladen

#### Scenario: Offenes Bearbeitungsformular
- **WHEN** auf Schirm B das Formular „Einsatzdaten bearbeiten" offen ist und ein Ereignis `einsatz` eintrifft
- **THEN** behält das Formular die Eingaben von Schirm B

### Requirement: Bewusst nicht live
Die benutzerbezogenen Felder des Einsatzkopfs (`meine_rolle`, `meine_fuehrungsstelle`,
`meine_sachgebiete`, `meine_funktion`) und `lagekennzahlen` SHALL nicht über `einsatz` angestoßen
werden. Sie werden erst beim nächsten Abruf des Kopfs frisch, auch dann, wenn ein Ereignis
`einsatz` aus anderem Anlass eintrifft. Eine Stab-Besetzung MUST kein Ereignis `einsatz` auslösen.

#### Scenario: Besetzung eines Sachgebiets
- **WHEN** im Stab ein Sachgebiet besetzt wird
- **THEN** wird `stab` verteilt, aber kein `einsatz`
