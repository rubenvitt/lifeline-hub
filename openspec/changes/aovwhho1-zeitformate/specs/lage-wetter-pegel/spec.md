## MODIFIED Requirements

### Requirement: Marke für angekündigtes Unwetter im Überblick

Der Überblick SHALL jede angekündigte Warnung der Stufe „schwer“ oder „extrem“ als Marke unter
„Nächste Marken“ zum Zeitpunkt ihres Beginns führen. Die Marke nennt Stufenbezeichnung und
Ereignis und springt zur Modulseite. Sie MUST verschwinden, sobald die Warnung gilt, und wird nie
„überfällig“. Ohne sichtbares und freies Modul gibt es keine Unwettermarke.

#### Scenario: Angekündigtes Unwetter
- **WHEN** eine Warnung „ORKANBÖEN“ der Stufe „schwer“ in 2 Stunden beginnt
- **THEN** zeigt der Überblick eine Marke „Unwetterwarnung: Orkanböen“ zur Beginnzeit mit dem Wort „in 2 h“

#### Scenario: Warnung beginnt
- **WHEN** der Beginn einer markierten Unwetterwarnung erreicht ist
- **THEN** verschwindet die Marke, und der Modulzähler zählt die Warnung weiter

