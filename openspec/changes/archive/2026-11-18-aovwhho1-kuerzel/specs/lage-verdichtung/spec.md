## ADDED Requirements

### Requirement: Die Stärke nennt ihre Schreibweise
Jede Fläche, die eine Stärke zeigt, SHALL die Schreibweise „F/UF/M//Σ“ mindestens einmal sichtbar
nennen: als Spaltenkopf, Feldetikett, Legendenzeile oder als Vorsatz „Stärke F/UF/M//Σ“. Jeder Wert
MUST die ausgeschriebene Form „Führer / Unterführer / Mannschaft // Summe“ als zugängliche
Beschreibung tragen; ein Tooltip MAY sie zusätzlich zeigen. Andere Bezeichnungen der Summe („Ges“,
„Gesamt“) und eine Stärke ohne Summe MUST NOT vorkommen.

#### Scenario: Organigramm
- **WHEN** eine Person die Gliederung als Organigramm öffnet
- **THEN** steht über den Knoten einmal „Stärke F/UF/M//Σ“, und jeder Knoten zeigt seinen Wert wie „1/2/5//8“

#### Scenario: Überblick
- **WHEN** der Überblick die Abschnittskarten zeigt
- **THEN** trägt das Feld der Stärke das Etikett „F/UF/M//Σ“ und nicht „F/UF/M//Ges“

#### Scenario: Lagemonitor mit Summe
- **WHEN** der Lagemonitor die Kachel „Kräfte“ mit 1 Führer, 2 Unterführern und 5 Helfern zeigt
- **THEN** steht dort „Stärke F/UF/M//Σ 1/2/5//8“

#### Scenario: Beschreibung für Vorlesehilfen
- **WHEN** eine Vorlesehilfe den Wert „1/2/5//8“ im Meldebild vorliest
- **THEN** nennt sie „Führer / Unterführer / Mannschaft // Summe“
