# Spec Delta

## ADDED Requirements

### Requirement: Abgeschlossene Patienten zählen nicht als Patienten
Lage-Dashboard, Vorbereitung der Lagebesprechung und Lagemonitor SHALL in der Zahl „Patienten“
und in der Sichtungsverteilung nur Personen zählen, deren Versorgungszustand nicht
`abgeschlossen` ist. Unterwegs befindliche Patienten MUST mitzählen. Druck und Einsatzbericht
MUST weiter alle Personen zählen.

#### Scenario: Lagemonitor nach Entlassung
- **WHEN** drei Personen in SK II erfasst sind und eine davon an ein fremdes Rettungsmittel übergeben wurde
- **THEN** zeigt der Lagemonitor „SK II 2“, und das Lage-Dashboard zeigt in der Sichtungsverteilung SK II 2

#### Scenario: Einsatzbericht bleibt vollständig
- **WHEN** der Einsatzbericht für denselben Einsatz gedruckt wird
- **THEN** zählt seine Personenbilanz SK II 3

## MODIFIED Requirements

### Requirement: Gemeinsames Fixture für Regeln beider Sprachen
Jede Zählregel, die sowohl der Server als auch der Client anwendet, SHALL durch ein gemeinsames
Fixture belegt sein. Das Fixture ist eine Datei mit Eingaben und erwarteten Zahlen, gelesen von
einem Rust-Test und von einem Vitest-Test. Es MUST mindestens diese Regeln abdecken:
- Auftrag offen und davon überfällig;
- Meldung offen, neu und Bestätigung überfällig;
- kumulierte Ist-Stärke einer Einheit über ihre Unterstellung;
- Stärke eines Abschnitts;
- entlassene und stornierte Kräfte zählen in keiner Stärke und keiner Statusverteilung;
- Versorgungszustand einer Person aus ihrem jüngsten Verbleib, und abgeschlossene Patienten
  zählen in keiner Sichtungsverteilung der Lage.

Eine Änderung an einer Regel, die nur eine Seite nachzieht, MUST einen der beiden Tests rot machen.

#### Scenario: Server weicht ab
- **WHEN** die Server-Regel für „Auftrag überfällig“ geändert wird und das Fixture nicht
- **THEN** schlägt der Rust-Test fehl

#### Scenario: Client weicht ab
- **WHEN** die Client-Regel für „Bestätigung überfällig“ geändert wird und das Fixture nicht
- **THEN** schlägt der Vitest-Test fehl

#### Scenario: Entlassene mitgezählt
- **WHEN** eine Seite entlassene Personen in die Stärke zählt
- **THEN** schlägt der Test ihrer Sprache fehl

#### Scenario: Versorgungszustand weicht ab
- **WHEN** eine Seite einen Transport mit `angemeldet` als abgeschlossen ableitet
- **THEN** schlägt der Test ihrer Sprache fehl
