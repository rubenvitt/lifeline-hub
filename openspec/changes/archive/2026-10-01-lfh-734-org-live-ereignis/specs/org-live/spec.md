# Spec Delta

## Purpose

Einsatzliste und Stammdaten-Kataloge werden auf jedem angemeldeten Schirm frisch, sobald eine
Nutzer- oder Systemaktion sie ändert. Die Spec legt fest, welche Wege die Org-Ereignisse
`einsatzliste` und `stammdaten` auslösen, wer sie empfängt, über welche Verbindung sie laufen und
was bewusst nicht live ist (LFH-734).

## ADDED Requirements

### Requirement: Ereignis für die Einsatzliste
Das System SHALL ein SSE-Ereignis mit dem Wire-Namen `einsatzliste` verteilen, sobald eine Aktion
die Menge oder den Inhalt der Einsatzliste ändern kann. Das Ereignis MUST erst nach dem Commit der
schreibenden Transaktion verteilt werden. Seine Nutzlast MUST leer sein (`{}`) und darf weder die
Kennung noch Daten des Einsatzes tragen. Eine abgelehnte Anfrage MUST kein Ereignis auslösen.

Das Ereignis MUST verteilt werden nach
- jeder Aktion, die das Ereignis `einsatz` des Einsatzkopfs auslöst,
- der Anlage eines Einsatzes,
- dem Setzen, Ändern oder Entfernen einer Mitgliedschaft,
- dem Wiederherstellen eines Einsatzes aus der Aufbewahrung,
- dem Soft-Delete eines Einsatzes durch die Aufbewahrung,
- Import, Neu-Import und Entfernen der Demo-Daten.

#### Scenario: Neuer Einsatz erscheint auf einem zweiten Schirm
- **WHEN** eine Führungskraft auf Schirm A einen Einsatz anlegt und eine zweite Führungskraft derselben Organisation auf Schirm B die Einsatzliste offen hat
- **THEN** erscheint der Einsatz auf Schirm B ohne Neuladen und ohne Fokuswechsel

#### Scenario: Entfernter Demo-Einsatz verschwindet
- **WHEN** der System-Admin die Demo-Daten entfernt und ein anderer Schirm die Einsatzliste, den Einsatz-Switcher oder die Sprungpalette zeigt
- **THEN** verschwindet der Demo-Einsatz dort ohne Neuladen

#### Scenario: Abschluss ändert die Liste
- **WHEN** die Einsatzleitung einen Einsatz abschließt
- **THEN** wird neben `einsatz` auch `einsatzliste` verteilt

#### Scenario: Abgelehnte Anlage
- **WHEN** die Anlage eines Einsatzes mit 400 oder 403 abgelehnt wird
- **THEN** wird kein Ereignis `einsatzliste` verteilt

### Requirement: Wer von der Einsatzliste erfährt
Ein Ereignis `einsatzliste` zu einem Einsatz MUST genau die Abonnenten erreichen, die diesen Einsatz
in ihrer Liste sehen können oder bis eben sehen konnten:
- die org-weiten Leser der Organisation des Einsatzes (System-Admin, Führungskraft),
- System-Admins anderer Organisationen,
- die Mitglieder des Einsatzes zum Zeitpunkt des Ereignisses,
- bei einer Mitgliedschaftsänderung zusätzlich die betroffene Person, auch wenn sie entfernt wurde.

Jeder andere Abonnent MUST das Ereignis nicht erhalten.

#### Scenario: Mitglied ohne Bezug zum Einsatz
- **WHEN** ein Benutzer derselben Organisation, der weder Mitglied des Einsatzes noch org-weiter Leser ist, den Org-Strom offen hat und der Einsatz abgeschlossen wird
- **THEN** erhält er kein Ereignis `einsatzliste`

#### Scenario: Neu hinzugefügtes Mitglied
- **WHEN** die Einsatzleitung einen Benutzer als Mitglied hinzufügt, der den Org-Strom offen hat
- **THEN** erhält dieser Benutzer `einsatzliste`, und der Einsatz erscheint in seiner Liste

#### Scenario: Entferntes Mitglied
- **WHEN** die Einsatzleitung einen Benutzer aus dem Einsatz entfernt, der den Org-Strom offen hat
- **THEN** erhält dieser Benutzer `einsatzliste`, und der Einsatz verschwindet aus seiner Liste

#### Scenario: Fremde Organisation
- **WHEN** in Organisation A ein Einsatz angelegt wird und ein Benutzer von Organisation B ohne System-Admin-Rolle den Org-Strom offen hat
- **THEN** erhält er kein Ereignis

#### Scenario: System-Admin einer anderen Organisation
- **WHEN** in Organisation A ein Einsatz angelegt wird und ein System-Admin von Organisation B den Org-Strom offen hat
- **THEN** erhält er `einsatzliste`

### Requirement: Ereignis für die Stammdaten
Das System SHALL ein SSE-Ereignis mit dem Wire-Namen `stammdaten` verteilen, sobald eine
erfolgreiche Schreibanfrage einen Stammdaten-Katalog der Organisation ändert. Das Ereignis MUST
nach dem Commit verteilt werden, seine Nutzlast MUST leer sein (`{}`), und es MUST jeden
angemeldeten Abonnenten der Organisation erreichen und keinen anderer Organisationen.

Stammdaten-Kataloge im Sinne dieser Anforderung sind Fahrzeuge, Fahrzeug-Status, Personal,
Personal-Status, Material, Material-Kategorien, Qualifikationen, Einheit-Typen, Sprechgruppen der
Organisation, ETB-Bausteine, Stichwort-Vorschläge, Führungsfunktionen und die Organisation selbst
(Name, Logo). Import, Neu-Import und Entfernen der Demo-Daten MUST `stammdaten` ebenfalls auslösen.

#### Scenario: Fahrzeug außer Dienst
- **WHEN** der System-Admin auf Schirm A ein Fahrzeug außer Dienst stellt und Schirm B derselben Organisation eine Fahrzeugauswahl offen hat
- **THEN** zeigt Schirm B den neuen Stand ohne Neuladen

#### Scenario: Andere Organisation
- **WHEN** Organisation A ihren Material-Katalog ändert
- **THEN** erhält kein Abonnent von Organisation B das Ereignis `stammdaten`

#### Scenario: Abgelehnte Änderung
- **WHEN** eine Katalog-Schreibanfrage mit 400, 403, 409 oder 422 abgelehnt wird
- **THEN** wird kein Ereignis `stammdaten` verteilt

### Requirement: Eine Live-Verbindung je Tab
Ein angemeldeter Tab SHALL zu jedem Zeitpunkt höchstens eine Live-Verbindung offen halten. Innerhalb
eines Einsatzes MUST der Live-Strom des Einsatzes die Org-Ereignisse mittragen. Außerhalb eines
Einsatzes MUST der Tab den Org-Strom `GET /api/live` öffnen. Der Org-Strom MUST nur angemeldeten,
aktiven Benutzern offenstehen (sonst 401) und MUST nur Org-Ereignisse und das Kontrollereignis
`lagged` tragen, keine Einsatz-Ereignisse. Ohne Anmeldung MUST der Tab keine Live-Verbindung öffnen.

#### Scenario: Einsatz-Workspace
- **WHEN** ein Tab einen Einsatz geöffnet hat
- **THEN** hält er genau eine Verbindung zum Live-Strom dieses Einsatzes und keine zum Org-Strom, und eine Änderung an der Einsatzliste erreicht ihn trotzdem

#### Scenario: Einsatzliste
- **WHEN** ein Tab die Einsatzliste, die Verwaltung oder das Profil zeigt
- **THEN** hält er genau eine Verbindung zum Org-Strom

#### Scenario: Abgemeldet
- **WHEN** der Tab die Anmeldeseite zeigt
- **THEN** ist keine Live-Verbindung offen

### Requirement: Org-Ereignisse frischen die globalen Abfragen
Das Frontend SHALL bei `einsatzliste` die Einsatzliste samt allen ihren Lesern (Einsatzliste,
Einsatz-Switcher, Sprungpalette) sowie die Admin-Listen zu Aufbewahrung und Demo-Daten neu abrufen,
bei `stammdaten` jeden Stammdaten-Katalog und die Einsatzliste (sie zeigt den Namen der
Organisation und Labels aus dem Führungsfunktions-Katalog). Jeder globale Query-Key MUST genau einer der beiden
Klassen angehören: live über ein Org-Ereignis oder ausdrücklich nicht live. Nach `lagged` und nach
jedem Wiederaufbau einer Live-Verbindung MUST das Frontend auch alle live geführten globalen Keys
neu abrufen.

#### Scenario: Verbindung kommt nach Unterbrechung zurück
- **WHEN** die Live-Verbindung eines Tabs abreißt, in der Zeit ein Einsatz angelegt wird und die Verbindung danach wieder steht
- **THEN** zeigt der Tab den neuen Einsatz, ohne dass ein Ereignis nachgeliefert werden musste

#### Scenario: Neuer globaler Key ohne Klasse
- **WHEN** ein Entwickler einen globalen Query-Key ergänzt, ohne ihn einem Org-Ereignis oder der nicht-live-Liste zuzuordnen
- **THEN** schlägt ein Test fehl

### Requirement: Bewusst nicht live in der Organisation
Folgende Änderungen SHALL kein Org-Ereignis auslösen und werden erst beim nächsten Abruf sichtbar:
der zeitgesteuerte Ablauf der Nachlauffrist oder der Aufbewahrungsfrist, Stab-Besetzungen
(`meine_sachgebiete`, `meine_funktion`), die Lagekennzahlen, Org-Einstellungen und
Org-Modul-Einstellungen, die Benutzerverwaltung und die instanzweite Kartenkonfiguration.

#### Scenario: Stab-Besetzung
- **WHEN** ein Sachgebiet im Stab besetzt wird
- **THEN** wird kein Ereignis `einsatzliste` verteilt
