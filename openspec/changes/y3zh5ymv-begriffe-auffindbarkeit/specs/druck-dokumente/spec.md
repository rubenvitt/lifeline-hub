## MODIFIED Requirements

### Requirement: Gemeinsamer Druckkopf

Jedes Druckstück SHALL auf der ersten Seite einen Druckkopf tragen, der das Dokument ohne
Bildschirm zuordenbar macht: Name der Organisation, Logo der Organisation (falls hinterlegt),
Dokumentart und -titel, Einsatzbezeichnung mit Einsatznummer (falls vergeben), Stand der Daten
bzw. die gedruckte Auswahl, Name der druckenden Person und Druckzeitpunkt. Zeitangaben im
Druckkopf MUST in der Zeitzone der Organisation stehen. Lagebericht, Befehl, Kräfteübersicht,
ETB-Druck, Einsatzbericht und Auftrag MUST denselben Druckkopf verwenden. Am Bildschirm SHALL der
Druckkopf nur auf den Druckansichten (ETB-Druck, Druck der Modul-Listen, Einsatzbericht, Auftrag)
sichtbar sein.

Gehört das Druckstück zu einer Übung (Einsatzart „Übung“), SHALL der Druckkopf das Wort „ÜBUNG“
deutlich neben der Einsatzbezeichnung tragen, auch im Schwarz-Weiß-Druck ohne Hintergrundfarben
lesbar. Wo der Browser Randfelder der Druckseite unterstützt, SHALL zusätzlich jede Seite am oberen
Rand „ÜBUNG“ tragen, auch ein Blatt in eigenem Format (Bild-Anlage, Lageplan, Fernmeldeskizze). Ein
Blatt ohne eigenen Druckkopf (Bild-Anlage) SHALL „ÜBUNG“ in seinem Titel tragen. Ein Druckstück
eines Realeinsatzes SHALL nirgends „ÜBUNG“ tragen.

#### Scenario: Meldebild mit Auswahl

- **WHEN** eine gefilterte Kräfteübersicht gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Kräfteübersicht“, Einsatz, Stand, Auswahl, die
  druckende Person („Gedruckt von“) und den Druckzeitpunkt („Gedruckt am“)

#### Scenario: Organisation ohne Logo

- **WHEN** die Organisation kein Logo hinterlegt hat
- **THEN** zeigt der Druckkopf nur den Namen, ohne Platzhalter und ohne leeren Bildrahmen

#### Scenario: Druck erst mit geladenem Kopf

- **WHEN** eine Person „Drucken / als PDF“ wählt, bevor Organisationsdaten oder Logo geladen
  sind
- **THEN** öffnet sich der Druckdialog erst, wenn Name und (falls vorhanden) Logo bereitstehen
- **AND** scheitert das Laden des Logos, wird ohne Logo gedruckt statt gar nicht

#### Scenario: Einsatzbericht trägt den gemeinsamen Kopf

- **WHEN** ein Einsatzbericht gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Einsatzbericht“, Einsatz mit Einsatznummer,
  Stand, die druckende Person und den Druckzeitpunkt
- **AND** am Bildschirm steht derselbe Kopf über dem Bericht

#### Scenario: Auftrag trägt den gemeinsamen Kopf

- **WHEN** der Auftrag #4 gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Auftrag“ mit „#4“, Einsatz mit Einsatznummer,
  Stand, die druckende Person und den Druckzeitpunkt
- **AND** am Bildschirm steht derselbe Kopf über dem Auftragsblatt

#### Scenario: ETB-Druck einer Übung

- **WHEN** das ETB einer Übung gedruckt wird
- **THEN** trägt der Druckkopf „ÜBUNG“ neben der Einsatzbezeichnung
- **AND** in Chromium trägt jede Seite am oberen Rand „ÜBUNG“

#### Scenario: Schichtplan, Lageplan und Planung einer Übung

- **WHEN** der Schichtplan, der Lageplan der Lagekarte oder eine Planung einer Übung gedruckt wird
- **THEN** trägt der Druckkopf „ÜBUNG“

#### Scenario: Bild-Anlage an einem Lagebericht einer Übung

- **WHEN** ein Lagebericht einer Übung mit einer Bild-Anlage gedruckt wird
- **THEN** trägt der Titel des Anlageblatts „ÜBUNG“
- **AND** in Chromium trägt auch das Anlageblatt (A4 quer) am oberen Rand „ÜBUNG“

#### Scenario: Realeinsatz

- **WHEN** ein Druckstück eines Realeinsatzes gedruckt wird
- **THEN** steht weder im Druckkopf noch am Seitenrand „ÜBUNG“

