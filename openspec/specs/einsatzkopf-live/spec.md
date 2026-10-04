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
- **WHEN** ein Mitglied ohne Stab-Recht den Strom geöffnet hat und eine Lagebesprechung ohne Terminänderung abgeschlossen wird
- **THEN** erhält es weder `stab` noch `einsatz`

#### Scenario: Org-Ereignis auf dem Einsatz-Strom
- **WHEN** ein Mitglied den Strom eines Einsatzes geöffnet hat und der System-Admin seiner Organisation ein Fahrzeug im Katalog ändert
- **THEN** erhält es auf demselben Strom das Ereignis `stammdaten`, unabhängig von seinen Modulfreigaben

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
