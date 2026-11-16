## MODIFIED Requirements

### Requirement: Eine Sprungmarke steht unter ihrem Zielmodul
Eine Sprungmarke SHALL in der Kategorie ihres Zielmoduls stehen, direkt hinter dem Zielmodul oder
hinter einer anderen Marke desselben Ziels. Nach dem Sprung MUST die hervorgehobene Zeile, das
Zielmodul, damit in derselben Kategorie stehen wie die geklickte Marke. Das gilt im Modulpanel am
Fükw und am Tablet und im Navigations-Drawer.

#### Scenario: Entscheidungen unter ETB
- **WHEN** jemand mit Freigabe des ETB die Kategorie „Führung“ öffnet
- **THEN** folgt auf „ETB“ unmittelbar die Marke „Entscheidungen“, und die Kategorie „Betroffene & Schäden“
  führt weder „ETB“ noch „Entscheidungen“

#### Scenario: Hervorhebung bleibt in der Kategorie
- **WHEN** die Marke „Entscheidungen“ geklickt wird
- **THEN** zeigt die App das ETB mit dem Filter Entscheidung, die Kategorie „Führung“ bleibt
  offen, und „ETB“ ist dort als aktuelle Seite hervorgehoben

#### Scenario: Marken desselben Ziels
- **WHEN** jemand mit Freigabe der Betroffenen die Kategorie „Betroffene & Schäden“ öffnet
- **THEN** folgen auf das Modul „Betroffene“ unmittelbar „Patienten“ und „Vermisste“
