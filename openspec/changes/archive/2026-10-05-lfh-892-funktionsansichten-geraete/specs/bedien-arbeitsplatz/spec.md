# Spec Delta

## MODIFIED Requirements

### Requirement: Kein Arbeitsplatz formt die Bedienung

Startziel eines Einsatzes, Primäraktion einer Seite, Reihenfolge der Module und Dichte-Vorgabe
SHALL NOT davon abhängen, welchen fachlichen Arbeitsplatz eine Person besetzt. Das gilt auch
für eine gewählte oder gemerkte „Arbeitsweise“. Unterscheiden sich diese vier Größen zwischen
zwei Personen im selben Einsatz auf demselben Gerät, MUST der Unterschied allein aus ihren
Rechten kommen (Rolle im Einsatz, Systemrolle, Modulfreigabe). Einstellungen des Einsatzes und
Theme, Dichte und Helligkeit des Geräts gelten für beide gleich. Das Befehlsgedächtnis der
Sprungpalette („Zuletzt“) ist je Person gespeichert. Es ordnet nur Palettenzeilen und berührt
keine der vier Größen. Ein gekoppeltes Gerät ist keine Person: Seine Funktionsansicht MUST
Startziel und Navigation festlegen (`feldgeraet-bedienung`, `lagemonitor`).

#### Scenario: Gleiche Rechte, gleiche Bedienung

- **WHEN** zwei Personen mit denselben Rechten (Rolle im Einsatz, Systemrolle, Modulfreigabe)
  nacheinander denselben Einsatz auf demselben Gerät öffnen
- **THEN** landen beide auf demselben Startziel und sehen dieselbe Modulreihenfolge
- **AND** zeigt jede Seite beiden dieselbe Primäraktion

#### Scenario: Es gibt keine Arbeitsplatzwahl

- **WHEN** eine Person Sprungpalette, Einstellungen oder Kopfleiste durchsucht
- **THEN** findet sie keine Wahl eines Arbeitsplatzes oder einer Arbeitsweise, die Startziel,
  Primäraktion, Modulreihenfolge oder Dichte vorbelegt

#### Scenario: Gekoppeltes Gerät startet in seiner Ansicht

- **WHEN** ein als UHS-Tablet gekoppeltes Gerät den Einsatz öffnet
- **THEN** landet es auf der Startseite der Ansicht UHS-Tablet, nicht auf dem Startziel des
  Einsatzes

### Requirement: Die Rechteachse bleibt allein zuständig

Ob eine Person Daten sehen oder schreiben darf, SHALL sich ausschließlich aus der Rolle im
Einsatz, der Systemrolle und der Modulfreigabe ergeben. Ein fachlicher Arbeitsplatz, eine
Stabsfunktion (S1–S6) oder ein Einstieg MUST NOT Rechte gewähren oder entziehen. Für ein
gekoppeltes Gerät gilt zusätzlich seine Funktionsansicht (`funktionsansichten`); sie MUST nur
verengen, nie über die Modulfreigabe hinaus gewähren, und sie gilt nie für eine Person.

#### Scenario: Einstieg gewährt kein Schreibrecht

- **WHEN** eine Person ohne Schreibrecht im Einsatz die Aufnahme-Route über einen Deeplink öffnet
- **THEN** kann sie dort keine Person anlegen
- **AND** erklärt ihr die Seite, warum nicht

#### Scenario: Ansicht verengt das Gerät

- **WHEN** ein als UHS-Tablet gekoppeltes Gerät das ETB abruft
- **THEN** antwortet der Server mit 403, obwohl die Rolle der Ansicht Lesen erlaubte
