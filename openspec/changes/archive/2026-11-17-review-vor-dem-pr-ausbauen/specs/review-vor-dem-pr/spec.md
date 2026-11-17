## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Der Agent startet den Review vor dem PR selbst
**Reason**: Am 17.11.2026 ausgebaut; der Pflicht-Review kostete zu viele Tokens.
**Migration**: Review nach Ermessen (Anforderung oben).

### Requirement: Der Reviewer arbeitet mit frischem Kontext
**Reason**: Gilt nur noch für den Review nach Ermessen und steht dort.
**Migration**: Anforderung „Der Agent entscheidet selbst, ob ein Review nötig ist“.

### Requirement: Der Review prüft gegen eine Prüfliste
**Reason**: Die Prüfliste bleibt als Nachschlagewerk; eine Pflicht, jede Klasse zu prüfen, und
das Verbot eigener Dimensionen im Orchestrator entfallen mit dem Pflicht-Review.
**Migration**: Anforderung „Der Agent entscheidet selbst, ob ein Review nötig ist“.

### Requirement: Befunde werden gegengeprüft und vor dem PR behandelt
**Reason**: Die Gegenprüfung je Befund war der teuerste Teil des Reviews.
**Migration**: Keine; Befunde prüft und behandelt der Main-Loop selbst.

### Requirement: Der PR weist den Review nach
**Reason**: Ohne Pflicht-Review gibt es nichts nachzuweisen.
**Migration**: Der Abschnitt „Review“ der PR-Vorlage entfällt.

### Requirement: Der Review braucht kein zusätzliches Plugin
**Reason**: Entfällt mit dem Pflicht-Review.
**Migration**: Keine.

### Requirement: Die Prüfliste wächst mit den Fehlern, die durchrutschen
**Reason**: Ohne Pflicht-Review fehlt der Anlass, die Liste bei jedem Fehler zu pflegen.
**Migration**: Keine; die Liste bleibt im Stand vom 17.11.2026.
