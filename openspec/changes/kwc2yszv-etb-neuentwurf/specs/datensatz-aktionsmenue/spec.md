## MODIFIED Requirements

### Requirement: Im Einsatztagebuch öffnet ein langer Druck kein Kontextmenü

Im Einsatztagebuch (Einträge der Zeitachse) SHALL ein langer Druck am Touchgerät kein Kontextmenü
öffnen, damit Text markierbar bleibt; das ⋮-Menü führt dort zu den Aktionen. Rechtsklick und Tasten
MUST das Kontextmenü weiter öffnen.

#### Scenario: Langer Druck im Einsatztagebuch
- **WHEN** eine Person mit Schreibrecht am Tablet 600 ms auf den Text eines ETB-Eintrags drückt, ohne den Finger zu bewegen
- **THEN** öffnet kein Kontextmenü, und das Gerät darf den Text wie gewohnt markieren

## REMOVED Requirements

### Requirement: Chips der ETB-Erfassung tragen das Kontextmenü

**Reason**: Die ETB-Erfassung hat keine Chips mehr. Von, An, Zeit und Meldeweg stehen als feste
Felder in der Feldzeile (Spec `etb-schnellerfassung-tastatur`, „Feste Felder der Erfassung“); ein
Feld behält das Kontextmenü des Browsers.

**Migration**: Werte ändert man direkt im Feld; „Nur für diesen Eintrag ändern“ ist das Feld selbst,
„Standard-Rufname ändern“ steht als „Eigene Stelle ändern“ in der Fußzeile der Erfassung.
