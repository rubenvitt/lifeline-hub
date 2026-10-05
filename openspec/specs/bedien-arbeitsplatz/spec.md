# bedien-arbeitsplatz Specification

## Purpose
Legt fest, wie fachliche Arbeitsplätze (Aufnahme, Sichtung, Transport, UHS-Leitung,
Bereitstellungsraum, Führungsassistenz) in der Bedienung vorkommen: als Einstiege in
aufgabengeschnittene Flächen, nicht als dritte Bedienachse neben Form und Kontext.

## Requirements

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

### Requirement: Arbeitsplatz-Flächen werden über Einstiege erreicht

Eine Fläche, die für einen fachlichen Arbeitsplatz geschnitten ist, SHALL über mindestens einen
Einstieg in einer bestehenden Fläche erreichbar sein: eine Primäraktion im Seitenkopf, eine
Sprungmarke, die Leeraktion eines Paneels oder einen Befehl der Sprungpalette. Außerdem MUST
sie eine stabile Adresse haben, die sich als Lesezeichen am Gerät ablegen lässt.

#### Scenario: Aufnahme aus der Unfallhilfsstelle

- **WHEN** eine Person mit Schreibrecht die Detailseite einer UHS im Betrieb öffnet
- **THEN** bietet der Seitenkopf „Patient aufnehmen“ als Primäraktion an
- **AND** führt die Aktion in die Aufnahme-Route mit dieser UHS als Vorbelegung

#### Scenario: Keine Aufnahme in einer geplanten UHS

- **WHEN** die UHS noch geplant ist
- **THEN** bietet der Seitenkopf keine Aufnahme an

#### Scenario: Aufnahme aus dem leeren Sichtungspaneel

- **WHEN** im Überblick noch keine Person erfasst ist
- **THEN** bietet das Sichtungspaneel „Person aufnehmen“ an
- **AND** führt die Aktion in die Aufnahme-Route

#### Scenario: Lesezeichen auf die Aufnahme

- **WHEN** eine Person die Adresse `/einsaetze/<id>/personen/aufnahme` direkt aufruft
- **THEN** öffnet sich die Aufnahme-Fläche dieses Einsatzes

### Requirement: Einzelerfassung und Serienaufnahme bleiben getrennte Einstiege

Die Schnellaktion „Neue Person erfassen“ der Sprungpalette SHALL auf die Personenliste mit der
Erfassungsmaske führen, also auf die Einzelerfassung. Die Sprungpalette MUST NOT einen eigenen
Befehl für die Aufnahme-Route (Serienbetrieb) führen.

#### Scenario: Palette führt zur Einzelerfassung

- **WHEN** eine Person in der Sprungpalette „Neue Person erfassen“ ausführt
- **THEN** öffnet sich die Personenliste mit der Erfassungsmaske
- **AND** nicht die Aufnahme-Route
