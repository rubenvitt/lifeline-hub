# Spec Delta

## MODIFIED Requirements

### Requirement: Rückweg von Profil und Verwaltung

Auf `/profil`, `/benachrichtigungen`, `/neuigkeiten` und `/admin/*` SHALL ein Ortspfad stehen
(„Einsätze › Profil“, „Einsätze › Benachrichtigungen“, „Einsätze › Neuigkeiten“ bzw. „Einsätze ›
Verwaltung ›“). Ist der gemerkte Einsatz aktiv und für die Person sichtbar, SHALL dort ein Knopf
„Zurück zu <Einsatz>“ an den gemerkten Pfad führen. Der Kopflink „Verwaltung“ SHALL im
Verwaltungsbereich `aria-current="page"` tragen und seinen Zustand nicht nur über die Farbe zeigen.

#### Scenario: Passwort geändert, zurück ins ETB

- **WHEN** eine Person aus dem ETB über das Benutzermenü ins Profil wechselt
- **THEN** führt „Zurück zu <Einsatz>“ sie zurück ins ETB desselben Einsatzes

#### Scenario: Einsatz inzwischen abgeschlossen

- **WHEN** der gemerkte Einsatz abgeschlossen ist
- **THEN** steht auf Profil kein Rückweg-Knopf

#### Scenario: Neuigkeiten aus der Lagekarte

- **WHEN** eine Person aus der Lagekarte eines aktiven Einsatzes über das Benutzermenü die Neuigkeiten öffnet
- **THEN** steht über dem Titel „Einsätze › Neuigkeiten“
- **AND** führt „Zurück zu <Einsatz>“ sie zurück in die Lagekarte desselben Einsatzes

#### Scenario: Benachrichtigungen aus den Eingängen

- **WHEN** eine Person in einem aktiven Einsatz in der Klappfläche „Eingänge“ „Benachrichtigungen einstellen“ wählt
- **THEN** führt „Zurück zu <Einsatz>“ auf der Seite „Benachrichtigungen“ an die Stelle zurück, an der sie war

## ADDED Requirements

### Requirement: Rückweg aus der Hilfe

Der Kopf der Hilfe SHALL genau einen Rückweg tragen: in der Sitzung eines gekoppelten Geräts
„Zum Gerät“, ohne Anmeldung „Zur Anmeldung“, angemeldet „Zurück zu <Einsatz>“ an den gemerkten
Pfad unter derselben Bedingung wie auf Profil, sonst „Zu den Einsätzen“ zur Einsatzliste. Ein
Wechsel zwischen Kapiteln MUST den Rückweg nicht ändern.

#### Scenario: Hilfe aus dem ETB

- **WHEN** eine Person in einem aktiven Einsatz aus dem ETB die Hilfe öffnet, ein Kapitel liest und „Zurück zu <Einsatz>“ wählt
- **THEN** steht sie wieder im ETB desselben Einsatzes

#### Scenario: Hilfe ohne aktiven Einsatz

- **WHEN** eine angemeldete Person die Hilfe öffnet und ihr gemerkter Einsatz abgeschlossen ist oder es keinen gemerkten Einsatz gibt
- **THEN** trägt der Kopf der Hilfe „Zu den Einsätzen“, und der Knopf führt zur Einsatzliste

#### Scenario: Gekoppeltes Gerät

- **WHEN** die Hilfe in der Sitzung eines gekoppelten Geräts geöffnet ist
- **THEN** trägt ihr Kopf „Zum Gerät“ und keinen Rückweg in einen Einsatz
