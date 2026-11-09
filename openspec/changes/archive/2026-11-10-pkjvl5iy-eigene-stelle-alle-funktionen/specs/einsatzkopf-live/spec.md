# Spec Delta

## MODIFIED Requirements

### Requirement: Funktionsfelder folgen der Mitgliedschaft
Die benutzerbezogenen Felder des Einsatzkopfs (`meine_rolle`, `meine_fuehrungsstelle`,
`meine_funktion`, `meine_funktion_code`, `meine_funktion_bezeichnung`, `meine_sachgebiete`) SHALL
allein aus der eigenen Mitgliedschaft folgen; `meine_sachgebiete` enthält höchstens das Sachgebiet
der eigenen Führungsfunktion. `meine_funktion_code` MUST der Katalogcode derselben Funktion sein,
die `meine_funktion` im Klartext nennt (Führungsfunktion der Mitgliedschaft, ohne sie mit Rolle
Einsatzleitung `el`), und fehlen, wenn keine Funktion folgt. `meine_funktion_bezeichnung` MUST nur
bei Führungshilfspersonal und Fachberater deren Bezeichnung tragen und sonst fehlen. Detail und
Liste MUST dieselben Werte liefern; der Lage-Snapshot trägt keines dieser Felder. Sie MUST über das
Ereignis `einsatz` der Mitgliedschaftsänderung frisch werden, `lagekennzahlen` über ihr Umschalten.

#### Scenario: Führungsfunktion gesetzt
- **WHEN** die Einsatzleitung einem Mitglied, das den Einsatz offen hat, die Führungsstelle `s2` setzt
- **THEN** wird `einsatz` verteilt, und der Kopf des Mitglieds trägt ohne Neuladen `meine_sachgebiete` mit S2, `meine_funktion_code` `s2` und die Funktion „S2 Lage“

#### Scenario: Höchstens ein Sachgebiet
- **WHEN** ein Mitglied die Führungsstelle `fachberater` mit der Bezeichnung „THW“ trägt
- **THEN** ist `meine_sachgebiete` leer, `meine_funktion_code` ist `fachberater` und `meine_funktion_bezeichnung` „THW“, in Detail und Liste

#### Scenario: Funktion ohne Sachgebiet
- **WHEN** ein Mitglied die Führungsstelle `s7` trägt
- **THEN** ist `meine_sachgebiete` leer, `meine_funktion_code` ist `s7`, und `meine_funktion_bezeichnung` fehlt

#### Scenario: Einsatzleitung ohne Führungsfunktion
- **WHEN** ein Mitglied mit Rolle Einsatzleitung keine Führungsfunktion trägt
- **THEN** ist `meine_funktion_code` `el`
