## MODIFIED Requirements

### Requirement: Modulbeschreibung als zweite Zeile

Jedes Modul der Registry SHALL eine Beschreibung aus wenigen Fachwörtern tragen, ohne Satz, ohne
Bedienung und ohne Technik. Das Modulmenü (Panel und Drawer) und die Sprungpalette SHALL sie unter
dem Modulnamen zeigen und den vollen Wortlaut im `title` tragen. Im Modulmenü SHALL sie bei
Platzmangel auf höchstens zwei Zeilen umbrechen und erst danach mit Auslassung enden; die
Sprungpalette zeigt sie in einer Zeile mit Auslassung. Der zugängliche Name des Eintrags SHALL der
Modulname bleiben.

#### Scenario: ETB im Menü

- **WHEN** eine Person die Kategorie Erfassung öffnet
- **THEN** steht unter „ETB“ „Einsatztagebuch“

#### Scenario: Lange Beschreibung im Modulpanel

- **WHEN** eine Person bei 1440 px die Kategorie Führung öffnet
- **THEN** steht unter „Überblick“ „Kennzahlen, Fristen, Entscheidungen“ vollständig, und keine
  Beschreibung der Kategorie endet mit Auslassung

#### Scenario: Handy

- **WHEN** eine Person bei 390 px Breite das Modulmenü öffnet
- **THEN** stehen die Beschreibungen ohne waagrechten Überlauf und ohne Auslassung
