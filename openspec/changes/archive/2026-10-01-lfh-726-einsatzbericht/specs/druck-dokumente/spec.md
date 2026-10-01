# Spec Delta

## MODIFIED Requirements

### Requirement: Gemeinsamer Druckkopf

Jedes Druckstück SHALL auf der ersten Seite einen Druckkopf tragen, der das Dokument ohne
Bildschirm zuordenbar macht: Name der Organisation, Logo der Organisation (falls hinterlegt),
Dokumentart und -titel, Einsatzbezeichnung mit Einsatznummer (falls vergeben), Stand der Daten
bzw. die gedruckte Auswahl, Name der druckenden Person und Druckzeitpunkt. Zeitangaben im
Druckkopf MUST in der Zeitzone der Organisation stehen. Lagebericht, Befehl, Meldebild,
ETB-Druck und Einsatzbericht MUST denselben Druckkopf verwenden. Am Bildschirm SHALL der
Druckkopf nur auf den Druckansichten (ETB-Druck, Einsatzbericht) sichtbar sein.

#### Scenario: Meldebild mit Auswahl

- **WHEN** ein gefiltertes Meldebild gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Meldebild“, Einsatz, Stand, Auswahl, die
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
