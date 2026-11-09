# Spec Delta

## MODIFIED Requirements

### Requirement: Sprungmarken stehen als Ansichten in der Palette
Im Einsatz SHALL die Palette jede Sprungmarke des Modulmenüs als Zeile der Gruppe „Ansichten“
führen, mit dem Namen der Marke, Icon und Namen ihres Zielmoduls als Kontext. Angeboten MUST
eine Marke nur werden, wenn ihr Zielmodul fertig, sichtbar und nicht gesperrt ist. ↵ MUST
dorthin springen, wohin die Marke im Menü springt. Jede Marke MUST über ihre Schlagworte und
ihr Ziel auffindbar sein.

#### Scenario: Funk findet den Funkplan
- **WHEN** jemand mit Freigabe des Fernmeldewesens im Einsatz „Funk“ tippt
- **THEN** ist „Fernmeldewesen“ der erste Treffer, und ↵ öffnet den Funkplan

#### Scenario: Schlagwort ohne Namensteil
- **WHEN** jemand mit Freigabe des Fernmeldewesens „sprechgruppe“ tippt
- **THEN** steht „Fernmeldeskizze“ unter den Treffern

#### Scenario: Bestehende Marke
- **WHEN** jemand mit ETB-Freigabe „entscheid“ tippt
- **THEN** steht „Entscheidungen“ mit dem Kontext „ETB“ unter den Treffern

#### Scenario: Ohne Freigabe kein Eintrag
- **WHEN** das ETB für die Person gesperrt oder im Einsatz ausgeblendet ist
- **THEN** führt die Palette die Marke „Entscheidungen“ nicht, aber Fernmeldeskizze und
  Kommunikationsplan, wenn das Fernmeldewesen frei ist

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Fernmeldewesen für die Person gesperrt oder im Einsatz ausgeblendet ist
- **THEN** führt die Palette weder das Modul Fernmeldewesen noch Fernmeldeskizze oder
  Kommunikationsplan

#### Scenario: Startansicht
- **WHEN** die Palette im Einsatz mit leerem Suchfeld geöffnet wird
- **THEN** steht die Gruppe „Ansichten“ direkt unter „Module“, und eine Marke aus „Zuletzt ausgeführt“ fehlt dort

### Requirement: Anruf erfassen aus der Palette
Mit Schreibrecht im Einsatz und freigegebenem Informationstelefon SHALL die Palette die
Schnellaktion „Anruf erfassen“ führen. Sie MUST das Informationstelefon öffnen und den Fokus in
das erste Feld der Anruferfassung setzen; der Auftrag MUST danach aus der Adresse verschwinden, sodass ein Neuladen
keinen zweiten Fokussprung auslöst.

#### Scenario: Bürgeranruf
- **WHEN** jemand mit Schreibrecht „Anruf erfassen“ ausführt
- **THEN** steht das Informationstelefon offen, der Fokus liegt im Feld „Anliegen“ der Erfassung, und die Adresse trägt kein `neu` mehr

#### Scenario: Beobachter
- **WHEN** ein Beobachter die Palette öffnet
- **THEN** führt sie „Anruf erfassen“ nicht

#### Scenario: Informationstelefon gesperrt
- **WHEN** das Modul Informationstelefon für eine Person mit Schreibrecht im Einsatz gesperrt oder ausgeblendet ist
- **THEN** führt die Palette „Anruf erfassen“ nicht
