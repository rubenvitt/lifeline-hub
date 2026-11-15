## RENAMED Requirements

- FROM: `### Requirement: Benutzermenü: Abmelden ohne Rollen`
- TO: `### Requirement: Benutzermenü: Einsatzfunktion im Kopf`

## MODIFIED Requirements

### Requirement: Benutzermenü: Einsatzfunktion im Kopf

Der Kopf des Benutzermenüs MUST die eigene Einsatzfunktion nennen, wenn es eine gibt, auf jeder
Breite. Wo „Profil“ und „Abmelden“ im Menü stehen und was davon am Handy ohne Rollen sichtbar
ist, regelt die Fähigkeit `benutzermenue`; „Abmelden“ MUST auf 390 × 844 und 1180 × 820 in jeder
Dichtestufe im Menü erreichbar sein, im Handschuh-Betrieb am Handy auch erst durch Rollen.

#### Scenario: Schichtwechsel am Handy im Handschuh-Betrieb
- **WHEN** das Benutzermenü bei 390 × 844 in `handschuh` geöffnet wird
- **THEN** ist „Abmelden“ im Menü erreichbar, gegebenenfalls durch Rollen, und meldet nach der Rückfrage ab

#### Scenario: Funktion auf dem Tablet
- **WHEN** das Benutzermenü im Einsatz unter `xl` geöffnet wird und die Person eine Funktion hat
- **THEN** nennt der Menükopf die Funktion

#### Scenario: Funktion am Handy
- **WHEN** das Benutzermenü im Einsatz bei 390 × 844 geöffnet wird und die Person eine Funktion hat
- **THEN** nennt der Menükopf die Funktion
