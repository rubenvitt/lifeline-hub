## MODIFIED Requirements

### Requirement: Zustand einer Person
Das System SHALL an jeder Person einen optionalen Freitext „Zustand“ führen, der den aktuellen
Zustand oder eine Verdachtsdiagnose in Kurzform beschreibt (z. B. „gehfähig, unterkühlt“ oder
„Verdacht auf Hüftfraktur“). Die Oberfläche MUST das Feld überall „Zustand / Verdacht“ nennen
(Erfassung, Liste, Detail, Schnellansicht, Druck); der Feldname der Schnittstelle bleibt
`zustand`. Der Zustand MUST beim Anlegen (`POST …/personen`) und beim Bearbeiten
(`PATCH …/personen/{pid}`) setzbar sein. Beim Bearbeiten MUST er mit `null` oder einem leeren
Text wieder leerbar sein. Führende und folgende Leerzeichen MUST entfernt werden, ein danach
leerer Text MUST als „kein Zustand“ gespeichert werden.

#### Scenario: Zustand beim Anlegen
- **WHEN** eine Person mit `zustand: "  Beinfraktur "` angelegt wird
- **THEN** antwortet der Server mit 201 und die Person trägt `zustand: "Beinfraktur"`

#### Scenario: Zustand leeren
- **WHEN** eine Person mit Zustand per PATCH `{ "zustand": null }` bearbeitet wird
- **THEN** trägt sie keinen Zustand mehr, und andere Felder bleiben unverändert

#### Scenario: Zustand in der Liste bearbeiten
- **WHEN** eine schreibberechtigte Person in der Betroffenenliste den leeren Zustand einer Zeile anklickt, einen Text eingibt und das Feld verlässt
- **THEN** wird der Zustand gespeichert und in der Spalte „Zustand / Verdacht“ angezeigt

#### Scenario: Ein Wort für das Feld
- **WHEN** die Erfassungsmaske, die Betroffenenliste, das Detail und die Schnellansicht einer Person angezeigt werden
- **THEN** heißt das Feld an allen vier Stellen „Zustand / Verdacht“
