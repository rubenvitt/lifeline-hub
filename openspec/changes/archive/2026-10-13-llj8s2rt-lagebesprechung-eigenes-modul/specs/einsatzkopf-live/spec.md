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
- dem Setzen des Termins der nächsten Lagebesprechung am Modul Lagebesprechung oder dem Abschluss
  einer Lagebesprechung, sofern der Termin dadurch einen **anderen** Wert bekommt (auch „kein
  Termin"),
- dem erfolgreichen Setzen, Ändern oder Entfernen einer Mitgliedschaft
  (`PUT`/`DELETE /api/einsaetze/{id}/mitglieder/{benutzer_id}`, LFH-854).

#### Scenario: Termin am Modul Lagebesprechung gesetzt
- **WHEN** eine Person mit Schreibrecht den Termin der nächsten Lagebesprechung per Schnellwahl auf einen neuen Wert setzt
- **THEN** erhält jeder Abonnent des Einsatzes ein Ereignis `einsatz` mit genau der Einsatzkennung als Nutzlast

#### Scenario: Termin auf der Einsatzdaten-Seite gepflegt
- **WHEN** ein PATCH der Kopfdaten den Termin der nächsten Lagebesprechung enthält (die Einsatzdaten-Seite pflegt ihn nicht mehr)
- **THEN** antwortet der Server mit 400, und es wird kein Ereignis `einsatz` verteilt

#### Scenario: Termin unverändert gesetzt
- **WHEN** eine Person den Termin auf den Wert setzt, den er schon hat
- **THEN** wird kein Ereignis `einsatz` verteilt

#### Scenario: Führungsstelle gepflegt
- **WHEN** eine Person mit Schreibrecht den Rufnamen der Führungsstelle ändert
- **THEN** erhält jeder Abonnent des Einsatzes ein Ereignis `einsatz` mit genau der Einsatzkennung als Nutzlast

#### Scenario: Einsatz abgeschlossen
- **WHEN** die Einsatzleitung den Einsatz abschließt
- **THEN** erhalten alle Abonnenten des Einsatzes ein Ereignis `einsatz`

#### Scenario: Lagebesprechung setzt einen neuen Termin
- **WHEN** eine Lagebesprechung mit einem Termin abgeschlossen wird, der vom bisherigen abweicht
- **THEN** wird neben `lagebesprechung` und `etb` auch `einsatz` verteilt

#### Scenario: Lagebesprechung ohne Terminänderung
- **WHEN** eine Lagebesprechung ohne den Schlüssel `naechste_at` oder mit dem bisherigen Termin abgeschlossen wird
- **THEN** wird kein Ereignis `einsatz` verteilt

#### Scenario: Abgelehnte Änderung
- **WHEN** ein PATCH der Kopfdaten oder der Führungsstelle oder ein Setzen des Termins abgelehnt wird (400, 403, 409, 422)
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
- **WHEN** ein Mitglied ohne Stab-Recht, aber mit Freigabe der Lagebesprechung den Strom geöffnet hat und eine Lagebesprechung ohne Terminänderung abgeschlossen wird
- **THEN** erhält es `lagebesprechung`, aber weder `stab` noch `einsatz`

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
- **WHEN** auf Schirm A der Termin auf der Seite Lagebesprechung geändert wird (die Einsatzdaten-Seite pflegt ihn nicht mehr) und Schirm B die Stab-Seite offen hat
- **THEN** zeigt die Termin-Zeile der Stab-Seite auf Schirm B den neuen Termin ohne Neuladen

#### Scenario: Führungsstelle auf dem zweiten Schirm
- **WHEN** auf Schirm A die Sprechgruppen der Führungsstelle geändert werden und Schirm B die Einsatzdaten-Seite offen hat
- **THEN** zeigt das Paneel „Eigene Führungsstelle“ auf Schirm B die neuen Sprechgruppen ohne Neuladen

#### Scenario: Offenes Bearbeitungsformular
- **WHEN** auf Schirm B die Zeile „Sachverhalt / Meldebild“ der Einsatzdaten in Bearbeitung ist und ein Ereignis `einsatz` eintrifft
- **THEN** behält die Eingabe den Text von Schirm B, und die übrigen Angaben zeigen den neuen Stand
