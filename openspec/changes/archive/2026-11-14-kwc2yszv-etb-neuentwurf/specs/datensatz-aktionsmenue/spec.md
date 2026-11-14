## MODIFIED Requirements

### Requirement: Im Einsatztagebuch öffnet ein langer Druck kein Kontextmenü

Im Einsatztagebuch (Einträge der Zeitachse) SHALL ein langer Druck am Touchgerät kein Kontextmenü
öffnen, damit Text markierbar bleibt; das ⋮-Menü führt dort zu den Aktionen. Rechtsklick und Tasten
MUST das Kontextmenü weiter öffnen.

#### Scenario: Langer Druck im Einsatztagebuch
- **WHEN** eine Person mit Schreibrecht am Tablet 600 ms auf den Text eines ETB-Eintrags drückt, ohne den Finger zu bewegen
- **THEN** öffnet kein Kontextmenü, und das Gerät darf den Text wie gewohnt markieren

### Requirement: Kein Auslöser ohne Aktion

Bleibt nach Rechte- und Zustandsprüfung keine Aktion für das Menü übrig, SHALL kein Auslöser
erscheinen, auch kein deaktivierter. Ausgenommen ist das Zeilenmenü der ETB-Spalten- und
Handschirm-Zeile: es trägt auch Angaben zum Eintrag (Vermerke, Verfasser), die in der Zeile keinen
Platz haben, und steht deshalb auch ohne Aktion.

#### Scenario: Gelöschte Nachricht
- **WHEN** der Chat eine gelöschte Nachricht zeigt
- **THEN** trägt sie keinen Aktionen-Auslöser

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht die ETB-Zeitachse in komfortabler Dichte ab `md` öffnet und kein Eintrag eine Aktion für sie hat
- **THEN** zeigt kein Eintrag einen Aktionen-Auslöser

#### Scenario: Spaltenzeile für Lesende
- **WHEN** eine Person ohne Schreibrecht die ETB-Zeitachse in kompakter Dichte ab `lg` öffnet
- **THEN** trägt jede Zeile ein ⋮, das den Verfasser nennt und keine Aktion anbietet

## REMOVED Requirements

### Requirement: Chips der ETB-Erfassung tragen das Kontextmenü

**Reason**: Die ETB-Erfassung hat keine Chips mehr. Von, An, Zeit und Meldeweg stehen als feste
Felder in der Feldzeile (Spec `etb-schnellerfassung-tastatur`, „Feste Felder der Erfassung“); ein
Feld behält das Kontextmenü des Browsers.

**Migration**: Werte ändert man direkt im Feld; „Nur für diesen Eintrag ändern“ ist das Feld selbst,
„Standard-Rufname ändern“ steht als „Eigene Stelle ändern“ in der Fußzeile der Erfassung.
