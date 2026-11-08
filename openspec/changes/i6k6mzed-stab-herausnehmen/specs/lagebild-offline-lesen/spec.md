# Spec Delta

## REMOVED Requirements

### Requirement: Ausgewählte Einsatzdaten bleiben ohne Netz lesbar
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Das Szenario „Kommunikationsplan ohne Stab“ setzt ein ausblendbares Modul Stab voraus; der Kommunikationsplan hängt nur noch am Fernmeldewesen. OpenSpec erlaubt nicht, das Szenario in einem MODIFIED-Block wegzulassen.
**Migration**: Das Verhalten gilt unverändert unter „Ausgewählte Einsatzansichten und ihre Rahmendaten bleiben ohne Netz lesbar“. Die Beschreibung ist gekürzt; Umfang je Ansicht und Rahmendaten stehen dort als Szenarien.

## ADDED Requirements

### Requirement: Ausgewählte Einsatzansichten und ihre Rahmendaten bleiben ohne Netz lesbar

Das System SHALL die zuletzt erfolgreich geladenen Daten der Ansichten ETB, Meldebild,
Betroffene, Aufträge, Lagekarte, Bereitstellungsräume (nur die Liste), Kommunikationsplan und
Eingänge eines Einsatzes geräteseitig vorhalten und nach einem Neuladen ohne Netz anzeigen,
dazu die Rahmendaten, ohne die diese Ansichten nicht darstellbar sind. Vorgehalten wird nur,
was die Person zuvor mit Netz tatsächlich geladen hat.

#### Scenario: Umfang je Ansicht

- **WHEN** eine Person die ausgewählten Ansichten eines Einsatzes mit Netz geladen hat und ohne
  Netz neu lädt
- **THEN** zeigt das ETB Einträge und Anzahl in seinen festen Ansichten: Gesamtliste, Typ-Reiter
  und die festen Ausschnitte anderer Seiten (Überblick, Lage-Dashboard)
- **AND** zeigt das Meldebild Einheiten, Personal, Fahrzeuge, Material, Abschnitte, Aufträge und
  Rückmeldungen
- **AND** zeigen Betroffene ihre Personen und Unfallhilfsstellen, Aufträge ihre Aufträge und
  Befehle und die Lagekarte die Datenebenen des Einsatzes
- **AND** zeigen die Bereitstellungsräume ihre Liste mit Status, Standort und Belegung, der
  Kommunikationsplan die gepflegten Stellen und Verbindungen des Fernmeldewesens und die
  Eingänge den Verlauf der eigenen Benachrichtigungen (Spec `benachrichtigungen`, „Verlauf ohne
  Netz“)

#### Scenario: Rahmendaten

- **WHEN** eine Person eine ausgewählte Ansicht mit Netz geladen hat und ohne Netz neu lädt
- **THEN** stehen Einsatzkopf, Modulfreigaben, Einsatzeinstellungen, Modulzähler, Einsatzliste,
  Kartenkonfiguration, Organisation und Fahrzeugstatus-Katalog im zuletzt geladenen Stand bereit

#### Scenario: Neuladen ohne Netz zeigt den letzten Stand

- **WHEN** eine angemeldete Person die ETB-Seite eines Einsatzes mit Netz geöffnet hat, das
  Netz wegfällt und sie die Seite neu lädt
- **THEN** zeigt die ETB-Seite die zuvor geladenen Einträge und landet nicht auf der Anmeldung

#### Scenario: Jede ausgewählte Ansicht übersteht den Offline-Neuladen

- **WHEN** eine Person Meldebild, Betroffene, Aufträge und Lagekarte mit Netz besucht hat und
  sie ohne Netz neu lädt
- **THEN** zeigt jede dieser Ansichten ihren zuletzt geladenen Stand, und die Lagekarte
  zeichnet ihre Datenebenen

#### Scenario: Typ-Reiter des ETB ohne Netz

- **WHEN** eine Person im ETB mit Netz den Reiter eines Eintragstyps geöffnet hat und ohne Netz
  neu lädt
- **THEN** zeigt der Reiter die zuvor geladenen Einträge dieses Typs

#### Scenario: Nie geladene Ansicht bleibt ohne Netz leer

- **WHEN** eine Person eine Ansicht ohne Netz öffnet, die sie mit Netz nie geladen hat
- **THEN** zeigt das System keine Daten dieser Ansicht an und erfindet keinen Stand

#### Scenario: Liste der Bereitstellungsräume ohne Netz

- **WHEN** eine Person die Liste der Bereitstellungsräume mit Netz geöffnet hat und ohne Netz
  neu lädt
- **THEN** zeigt die Liste die zuletzt geladenen Räume mit Standort und Belegung, und die
  Lagekarte zeichnet die Ebene „Bereitstellungsräume“ aus diesem Stand

#### Scenario: Seite eines Bereitstellungsraums ohne Netz

- **WHEN** eine Person nach einem Neuladen ohne Netz einen Raum aus der Liste öffnet
- **THEN** meldet die Seite, dass der Raum nicht geladen werden konnte, und erfindet keinen Stand

#### Scenario: Kommunikationsplan ohne Netz

- **WHEN** eine Person den Kommunikationsplan mit Netz geöffnet hat und ohne Netz neu lädt
- **THEN** zeigt er die zuletzt geladenen Stellen und Verbindungen
