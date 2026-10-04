## MODIFIED Requirements

### Requirement: Ausgewählte Einsatzdaten bleiben ohne Netz lesbar

Das System SHALL die zuletzt erfolgreich geladenen Daten folgender Ansichten eines Einsatzes
geräteseitig vorhalten und nach einem Neuladen ohne Netz anzeigen:

- **ETB** mit Einträgen und Anzahl
- **Meldebild** mit Einheiten, Personal, Fahrzeugen, Material, Abschnitten, Aufträgen und
  Rückmeldungen
- **Betroffene** mit Personen und Unfallhilfsstellen
- **Aufträge** mit Aufträgen und Befehlen
- **Lagekarte** mit den Datenebenen des Einsatzes
- **Kommunikationsplan** mit den gepflegten Stellen und Verbindungen des Stabs

Dazu SHALL das System die Rahmendaten vorhalten, ohne die diese Ansichten nicht darstellbar
sind: Einsatzkopf, Modulfreigaben, Einsatzeinstellungen, Modulzähler, Einsatzliste,
Kartenkonfiguration, Organisation und Fahrzeugstatus-Katalog. Vorgehalten wird nur, was die
Person zuvor mit Netz tatsächlich geladen hat.

#### Scenario: Neuladen ohne Netz zeigt den letzten Stand

- **WHEN** eine angemeldete Person die ETB-Seite eines Einsatzes mit Netz geöffnet hat, das
  Netz wegfällt und sie die Seite neu lädt
- **THEN** zeigt die ETB-Seite die zuvor geladenen Einträge und landet nicht auf der Anmeldung

#### Scenario: Jede ausgewählte Ansicht übersteht den Offline-Neuladen

- **WHEN** eine Person Meldebild, Betroffene, Aufträge und Lagekarte mit Netz besucht hat und
  sie ohne Netz neu lädt
- **THEN** zeigt jede dieser Ansichten ihren zuletzt geladenen Stand, und die Lagekarte
  zeichnet ihre Datenebenen

#### Scenario: Nie geladene Ansicht bleibt ohne Netz leer

- **WHEN** eine Person eine Ansicht ohne Netz öffnet, die sie mit Netz nie geladen hat
- **THEN** zeigt das System keine Daten dieser Ansicht an und erfindet keinen Stand

#### Scenario: Kommunikationsplan ohne Netz

- **WHEN** eine Person den Kommunikationsplan mit Netz geöffnet hat und ohne Netz neu lädt
- **THEN** zeigt er die zuletzt geladenen Stellen und Verbindungen
