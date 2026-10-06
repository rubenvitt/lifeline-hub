## MODIFIED Requirements

### Requirement: Ausgewählte Einsatzdaten bleiben ohne Netz lesbar

Das System SHALL die zuletzt erfolgreich geladenen Daten folgender Ansichten eines Einsatzes
geräteseitig vorhalten und nach einem Neuladen ohne Netz anzeigen:

- **ETB** mit Einträgen und Anzahl, in seinen festen Ansichten: Gesamtliste, Typ-Reiter und die
  festen Ausschnitte anderer Seiten (Überblick, Lage-Dashboard)
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

#### Scenario: Typ-Reiter des ETB ohne Netz

- **WHEN** eine Person im ETB mit Netz den Reiter eines Eintragstyps geöffnet hat und ohne Netz
  neu lädt
- **THEN** zeigt der Reiter die zuvor geladenen Einträge dieses Typs

#### Scenario: Nie geladene Ansicht bleibt ohne Netz leer

- **WHEN** eine Person eine Ansicht ohne Netz öffnet, die sie mit Netz nie geladen hat
- **THEN** zeigt das System keine Daten dieser Ansicht an und erfindet keinen Stand

#### Scenario: Kommunikationsplan ohne Netz

- **WHEN** eine Person den Kommunikationsplan mit Netz geöffnet hat und ohne Netz neu lädt
- **THEN** zeigt er die zuletzt geladenen Stellen und Verbindungen

## ADDED Requirements

### Requirement: ETB-Ergebnisse freier Eingaben bleiben vom Gerät fern

ETB-Ergebnisse, deren Auswahl aus einer freien Eingabe stammt (Volltextsuche, Zeitraum,
Einheit, Erfasser, Nummernsprung, Bezugssuche, Lageentwicklung seit einer Besprechung), MUST
NOT geräteseitig gespeichert werden. Das System SHALL sie nach kurzer Zeit ohne Beobachtung
aus dem Speicher des Tabs entfernen statt sie für die Höchstliegezeit zu halten.

#### Scenario: Volltextsuche landet nicht auf der Platte

- **WHEN** eine Person im ETB nach „Pumpe“ sucht, die Suche wieder leert und der Stand
  gespeichert wird
- **THEN** enthält der geräteseitige Speicher die Gesamtliste des ETB, aber kein Ergebnis der
  Suche nach „Pumpe“

#### Scenario: Suchergebnis verlässt den Speicher

- **WHEN** eine Person eine Volltextsuche im ETB verlässt und die Ergebnisseite fünf Minuten
  lang nicht wieder aufruft
- **THEN** hält der Tab das Suchergebnis nicht mehr vor

### Requirement: Speichern ohne Rückstau

Das System SHALL den Stand gedrosselt speichern: Viele Änderungen in kurzer Folge führen zu
höchstens einem laufenden und einem wartenden Speichervorgang, und am Ende steht der jüngste
Stand auf der Platte. Die Bestätigung der Sitzung MUST den gespeicherten Stand dabei weder
lesen noch neu schreiben.

#### Scenario: Langsamer Datenträger

- **WHEN** jeder Speichervorgang länger dauert als die Drossel und im Tab laufend Daten
  nachgeladen werden
- **THEN** wartet höchstens ein Stand auf das Speichern, und nach dem letzten Ereignis steht
  der jüngste Stand auf der Platte

#### Scenario: Bestätigung lässt den Stand unberührt

- **WHEN** ein Abruf die Sitzung bestätigt
- **THEN** ändert sich der Zeitpunkt der Bestätigung, der gespeicherte Stand bleibt
  unverändert
