## ADDED Requirements

### Requirement: Ein Review läuft nur auf Wunsch des Menschen
Der Main-Loop MUST NOT vor dem PR von sich aus einen Review-Agenten oder -Workflow starten. Die
Gates (`check-all.sh`) sind die Prüfung vor dem PR. Verlangt der Mensch einen Review, SHOULD ein
eigener Agent mit frischem Kontext den Diff gegen `origin/alpha` mit der Prüfliste
(`dev-zunder-ausfuehren/references/review-pruefliste.md`) prüfen; eine Gegenprüfung je Befund ist
nicht verlangt. Die PR-Beschreibung MUST NOT einen Abschnitt „Review“ verlangen.

#### Scenario: Umsetzung fertig, niemand verlangt einen Review
- **WHEN** ein Task auf der Route `klar` umgesetzt und verifiziert ist
- **THEN** öffnet der Main-Loop den PR nach den Gates, ohne einen Review-Agenten zu starten

#### Scenario: Der Mensch verlangt einen Review
- **WHEN** der Mensch vor dem PR einen Review verlangt
- **THEN** prüft ein Agent mit frischem Kontext den Diff des Branches gegen die Prüfliste und
  liefert Befunde zurück, die der Main-Loop behandelt

## REMOVED Requirements

### Requirement: Der Agent startet den Review vor dem PR selbst
**Reason**: Am 17.11.2026 ausgebaut; der Pflicht-Review kostete zu viele Tokens.
**Migration**: Review nur auf Wunsch des Menschen (Anforderung oben).

### Requirement: Der Reviewer arbeitet mit frischem Kontext
**Reason**: Gilt nur noch für den Review auf Wunsch und steht dort.
**Migration**: Anforderung „Ein Review läuft nur auf Wunsch des Menschen“.

### Requirement: Der Review prüft gegen eine Prüfliste
**Reason**: Die Prüfliste bleibt als Nachschlagewerk; eine Pflicht, jede Klasse zu prüfen, und
das Verbot eigener Dimensionen im Orchestrator entfallen mit dem Pflicht-Review.
**Migration**: Anforderung „Ein Review läuft nur auf Wunsch des Menschen“.

### Requirement: Befunde werden gegengeprüft und vor dem PR behandelt
**Reason**: Die Gegenprüfung je Befund war der teuerste Teil des Reviews.
**Migration**: Keine; Befunde eines Reviews auf Wunsch behandelt der Main-Loop direkt.

### Requirement: Der PR weist den Review nach
**Reason**: Ohne Pflicht-Review gibt es nichts nachzuweisen.
**Migration**: Der Abschnitt „Review“ der PR-Vorlage entfällt.

### Requirement: Der Review braucht kein zusätzliches Plugin
**Reason**: Entfällt mit dem Pflicht-Review.
**Migration**: Keine.

### Requirement: Die Prüfliste wächst mit den Fehlern, die durchrutschen
**Reason**: Ohne Pflicht-Review fehlt der Anlass, die Liste bei jedem Fehler zu pflegen.
**Migration**: Keine; die Liste bleibt im Stand vom 17.11.2026.
