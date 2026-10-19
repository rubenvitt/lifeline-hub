## ADDED Requirements

### Requirement: Druckansicht einer Person

Jede angetroffene Person SHALL eine eigene Druckansicht haben. Sie ist mit Leserecht auf das Modul
Personen erreichbar, auch ohne Schreibrecht, aber nicht am gekoppelten Gerät. Sie MUST tragen:
Registriernummer, Personendaten, Sichtung mit Zeit, Zustand / Verdacht, Transport, PAT-Nummer,
Kontamination, Maßnahmen und das Körperschema mit nummerierter Liste. Alles MUST schwarz-weiß
lesbar sein, Sternchen und Liste unterscheiden sich durch Nummer und Form, nicht durch Farbe. Die
Ansicht MUST die Person einmal beim Öffnen laden und sich danach nicht von selbst ändern, bis
jemand „Neu laden“ wählt. Das Öffnen MUST im Zugriffsprotokoll der Person als Druck stehen. Eine
unbekannte Person MUST als solche erscheinen statt als leeres Blatt.

#### Scenario: Blatt mit drei Verletzungen
- **WHEN** die Druckansicht einer Person mit drei Verletzungen als PDF gedruckt wird
- **THEN** zeigt das Blatt die Figur mit den Sternchen 1 bis 3 und die Liste mit denselben Nummern
  in Schwarz auf Weiß

#### Scenario: Unbekannte Person
- **WHEN** jemand die Druckansicht einer Person öffnet, die es im Einsatz nicht gibt
- **THEN** sagt die Seite, dass die Person nicht gefunden wurde, und „Drucken / als PDF“ steht
  nicht zur Wahl
