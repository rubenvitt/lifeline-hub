# review-vor-dem-pr Specification

## Purpose
Legt fest, dass vor dem PR kein Pflicht-Review läuft (seit 17.11.2026), sondern der Agent nach
festen Anlässen selbst entscheidet, ob ein Review nötig ist, und wie dieser dann aussieht.

## Requirements

### Requirement: Der Agent entscheidet selbst, ob ein Review nötig ist
Vor dem PR MUST der Main-Loop am Diff prüfen, ob er einen der Anlässe aus `dev-zunder-ausfuehren`,
„Review nach Ermessen“, trifft (Berechtigung und Geltungsbereich, Eingaben von außen, stiller
Datenverlust oder halbes Schreiben, Schreiben ohne Netz, Sitzung, Live-Verteilung, Größe). Trifft
er einen, MUST der Main-Loop den Review selbst starten, ohne den Menschen zu fragen; trifft er
keinen, MUST NOT er einen starten. Der Review MUST ein einzelner Agent mit frischem Kontext sein
(bei einem sehr großen Diff im Orchestrator höchstens zwei), ohne Workflow und ohne Gegenprüfer;
die Befunde prüft der Main-Loop selbst. Der PR MUST unter „Geprüft“ nennen, ob ein Review lief
und warum.

#### Scenario: Diff ändert, wer einen Einsatz sehen darf
- **WHEN** ein Task die Berechtigungsprüfung eines Endpunkts ändert
- **THEN** startet der Main-Loop einen Review-Agenten, ohne zu fragen, und nennt Anlass und
  Befunde im PR

#### Scenario: Reine Layout-Änderung
- **WHEN** ein Task nur Abstände und Texte einer Seite ändert
- **THEN** läuft kein Review, und der PR nennt unter „Geprüft“ den Grund

#### Scenario: Reviewer meldet einen Befund
- **WHEN** der Review-Agent einen Befund zurückgibt
- **THEN** prüft der Main-Loop ihn selbst an der Stelle, ohne einen Gegenprüfer-Agenten, und
  behebt ihn, wenn er zutrifft
