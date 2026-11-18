## MODIFIED Requirements

### Requirement: Einstieg mit dem aktiven Filter

Jede der Listen Personen, Tiere und Schäden SHALL eine Aktion „Druckansicht“ anbieten, die
eine eigene Druckansicht öffnet. Die Druckansicht SHALL eine eigene, teilbare Adresse haben, die
den Seitenfilter der Liste trägt. Die Aktion SHALL den gerade aktiven Seitenfilter unverändert
mitnehmen: bei Personen den Status und den Schalter „nur offene Felder“, bei Tieren die
Statussicht und die Spezies, bei Schäden die Statussicht. Ein unbekannter Filterwert in der
Adresse MUST verworfen werden und darf nicht als Auswahl im Kopf erscheinen.

#### Scenario: Aus der gefilterten Tierliste drucken

- **WHEN** eine Person in der Tierliste die Sicht „Vermisst“ und die Spezies „Hund“ wählt und
  „Druckansicht“ wählt
- **THEN** öffnet sich die Druckansicht mit genau dieser Auswahl
- **AND** ein Neuladen der Druckansicht behält die Auswahl

#### Scenario: Unbrauchbarer Filter in der Adresse

- **WHEN** die Adresse der Schäden-Druckansicht eine unbekannte Statussicht trägt
- **THEN** wird dieser Wert verworfen, und der Kopf nennt die ungefilterte Auswahl
