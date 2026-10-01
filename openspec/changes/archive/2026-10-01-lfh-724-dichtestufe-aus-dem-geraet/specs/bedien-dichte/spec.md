# Spec Delta

## Purpose

Legt fest, woraus die Bediendichte (`kompakt`, `komfortabel`, `handschuh`) beim Sitzungsstart
folgt: aus dem Gerät, nie aus der Person. Beantwortet den offenen Punkt „Wie die Dichtestufe je
Kontext gewählt wird“ der Bedien-Leitlinie (LFH-327, A1).

## ADDED Requirements

### Requirement: Die Stufe folgt dem Gerät in fester Reihenfolge

Das System SHALL die Dichtestufe beim Sitzungsstart in genau dieser Reihenfolge bestimmen:
(1) die auf dem Gerät gespeicherte Wahl, (2) ohne Wahl die Zeigerart des Geräts: ein grober
primärer Zeiger ergibt `komfortabel`, (3) sonst `kompakt`. Ein gespeicherter Wert, der keine
Stufe ist, MUST als „keine Wahl“ gelten und auf Schritt (2) fallen, nicht auf `kompakt`. Keine
Ableitung MUST eine gespeicherte Wahl überstimmen.

#### Scenario: Touchgerät ohne Wahl
- **WHEN** ein Gerät mit grobem primärem Zeiger die Anwendung ohne gespeicherte Wahl öffnet
- **THEN** steht die Dichtestufe auf `komfortabel`

#### Scenario: Gerät mit Maus ohne Wahl
- **WHEN** ein Gerät mit feinem primärem Zeiger die Anwendung ohne gespeicherte Wahl öffnet
- **THEN** steht die Dichtestufe auf `kompakt`

#### Scenario: Die Wahl schlägt die Zeigerart
- **WHEN** auf einem Gerät mit grobem primärem Zeiger die Wahl `kompakt` gespeichert ist und die Anwendung neu geladen wird
- **THEN** steht die Dichtestufe auf `kompakt`

#### Scenario: Unbrauchbarer Speicherwert
- **WHEN** auf einem Gerät mit grobem primärem Zeiger ein gespeicherter Wert steht, der keine Stufe ist
- **THEN** steht die Dichtestufe auf `komfortabel`

### Requirement: Handschuh nur auf ausdrückliche Wahl

Die Stufe `handschuh` SHALL nur durch eine ausdrückliche Wahl entstehen: über die
Umschaltgruppe „Bediendichte“ im Benutzermenü oder über die Sprungpalette. Keine Ableitung MUST
`handschuh` vorbelegen.

#### Scenario: Touchgerät startet nicht im Handschuh-Modus
- **WHEN** ein Gerät mit grobem primärem Zeiger die Anwendung ohne gespeicherte Wahl öffnet
- **THEN** steht die Dichtestufe nicht auf `handschuh`

#### Scenario: Gewählter Handschuh-Modus bleibt
- **WHEN** die Stufe `handschuh` gewählt und die Anwendung neu geladen wird
- **THEN** steht die Dichtestufe auf `handschuh`

### Requirement: Keine Umschaltung während der Sitzung

Das System SHALL die Zeigerart nur beim Sitzungsstart lesen. Ändert sich die Zeigerart während
der Sitzung (etwa ein 2-in-1-Gerät, dessen Tastatur abgenommen wird), MUST die Dichtestufe
unverändert bleiben. Nur eine ausdrückliche Wahl ändert die Stufe während der Sitzung.

#### Scenario: Tastatur abgenommen
- **WHEN** während einer Sitzung ohne gespeicherte Wahl der primäre Zeiger von fein auf grob wechselt
- **THEN** bleibt die Dichtestufe auf `kompakt`

### Requirement: Die Person formt die Dichte nicht

Rolle im Einsatz, Systemrolle, Funktion (S1–S7, EL, Führungshilfspersonal, Fachberater),
Führungsstelle, Modulfreigabe und fachlicher Arbeitsplatz MUST NOT in die Dichtestufe
einfließen. Die Wahl SHALL je Gerät gespeichert werden, nicht je Person. Zwei Personen, die
nacheinander dasselbe Gerät benutzen, MUST dieselbe Stufe sehen.

#### Scenario: Wechsel der Person am selben Gerät
- **WHEN** eine Person mit der Funktion S2 die Stufe `handschuh` wählt, sich abmeldet und eine Person ohne Funktion sich am selben Gerät anmeldet
- **THEN** steht die Dichtestufe auf `handschuh`

#### Scenario: Funktion im Einsatz ändert nichts
- **WHEN** einer Person im geöffneten Einsatz ein Sachgebiet zugewiesen oder entzogen wird
- **THEN** bleibt die Dichtestufe unverändert
