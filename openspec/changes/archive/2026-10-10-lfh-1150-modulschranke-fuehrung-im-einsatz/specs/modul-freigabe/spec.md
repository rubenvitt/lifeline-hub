# Spec Delta

## ADDED Requirements

### Requirement: Die Rollensperre „Führung im Einsatz“ bezieht die Einsatzrolle ein
Steht die effektive benötigte Rolle eines Moduls auf `einsatzfuehrung`, MUST `zugriff` genau dann
`true` sein, wenn der Benutzer System-Admin ist, org-weite Führungskraft ist oder im Einsatz die
Rolle Einsatzleitung oder Führungspersonal trägt. Beobachter und Benutzer ohne Rolle im Einsatz
MUST keinen Zugriff erhalten. Die Stufe `fuehrungskraft` MUST unverändert nur die Org-Rolle prüfen.

#### Scenario: Einsatzleitung ohne Org-Rolle
- **WHEN** der Einsatz das Modul `schaeden` auf `einsatzfuehrung` beschränkt und eine Einsatzleitung ohne Org-Rolle „Führungskraft“ die Freigaben abruft
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`, und der Listen-Endpunkt der Schäden antwortet ihr mit HTTP 200

#### Scenario: Führungspersonal
- **WHEN** der Einsatz das Modul `schaeden` auf `einsatzfuehrung` beschränkt und ein Mitglied mit der Einsatzrolle Führungspersonal anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`

#### Scenario: Beobachter
- **WHEN** der Einsatz das Modul `schaeden` auf `einsatzfuehrung` beschränkt und ein Beobachter ohne Org-Rolle anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: false`, und der Listen-Endpunkt der Schäden antwortet ihm mit HTTP 403

#### Scenario: Org-Führungskraft ohne Mitgliedschaft
- **WHEN** der Einsatz das Modul `schaeden` auf `einsatzfuehrung` beschränkt und eine org-weite Führungskraft der Einsatz-Org ohne Mitgliedschaft anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`

#### Scenario: Org-Vorgabe mit der neuen Stufe
- **WHEN** die Org-Vorgabe `schaeden` auf `einsatzfuehrung` beschränkt, der Einsatz keinen Override dafür hat und eine Einsatzleitung ohne Org-Rolle anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`

#### Scenario: Bestehende Stufe bleibt
- **WHEN** der Einsatz das Modul `schaeden` auf `fuehrungskraft` beschränkt und eine Einsatzleitung ohne Org-Rolle anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: false` wie bisher

### Requirement: Ein gekoppeltes Gerät zählt nicht als Führung im Einsatz
Ein gekoppeltes Gerät MUST die Stufe `einsatzfuehrung` nicht passieren, auch wenn seine
Funktionsansicht im Einsatz schreiben darf. Die Modulsperren, die die Geräteverwaltung je
Funktionsansicht nennt, MUST ein auf `einsatzfuehrung` beschränktes Modul als gesperrt führen.

#### Scenario: UHS-Tablet
- **WHEN** der Einsatz das Modul `personen` auf `einsatzfuehrung` beschränkt und ein als UHS-Tablet gekoppeltes Gerät die Personenliste abruft
- **THEN** antwortet das System mit HTTP 403

#### Scenario: Geräteverwaltung nennt die Sperre
- **WHEN** der Einsatz das Modul `personen` auf `einsatzfuehrung` beschränkt und die Einsatzleitung die Geräteliste abruft
- **THEN** führt die Sperrliste jeder Ansicht, die `personen` liest, das Modul `personen`

### Requirement: Der Server nimmt genau die bekannten Rollenwerte an
Der Schreibweg eines Modul-Overrides im Einsatz und der Schreibweg der Org-Vorgabe MUST als
benötigte Rolle genau `admin`, `fuehrungskraft`, `einsatzfuehrung` oder keinen Wert (frei)
annehmen. Jeden anderen Wert MUST das System mit HTTP 400 abweisen, ohne etwas zu speichern.

#### Scenario: Neue Stufe im Einsatz setzen
- **WHEN** eine Einsatzleitung den Override des Moduls `schaeden` mit `benoetigte_rolle: "einsatzfuehrung"` speichert
- **THEN** antwortet das System mit HTTP 200, und der Override trägt `einsatzfuehrung`

#### Scenario: Neue Stufe als Org-Vorgabe
- **WHEN** ein System-Admin die Org-Vorgabe des Moduls `schaeden` auf `einsatzfuehrung` setzt
- **THEN** antwortet das System mit HTTP 200, und die Vorgabe trägt `einsatzfuehrung`

#### Scenario: Unbekannter Wert
- **WHEN** jemand einen Override mit `benoetigte_rolle: "einsatzleitung"` speichern will
- **THEN** antwortet das System mit HTTP 400, und der bisherige Override bleibt unverändert

### Requirement: Die Einstellungsseiten benennen die Rollenstufen eindeutig
Die Auswahl der benötigten Rolle im Editor „Module“ des Einsatzes und in der „Rollen-Vorgabe je
Modul“ der Organisation MUST die Stufen in dieser Reihenfolge anbieten: „Frei (alle)“, „Führung im
Einsatz“, „Führungskraft der Organisation“, „Admin“. Der Hinweis auf eine Org-Vorgabe im Editor
des Einsatzes MUST dieselben Namen verwenden. Kein Name MUST in der Rollenspalte abgeschnitten
erscheinen.

#### Scenario: Auswahl im Einsatz
- **WHEN** eine Einsatzleitung im Editor „Module“ die Auswahl der benötigten Rolle eines Moduls öffnet
- **THEN** stehen dort „Frei (alle)“, „Führung im Einsatz“, „Führungskraft der Organisation“ und „Admin“ in dieser Reihenfolge

#### Scenario: Hinweis auf die Org-Vorgabe
- **WHEN** die Org-Vorgabe ein Modul auf `einsatzfuehrung` beschränkt und der Einsatz keinen Override dafür hat
- **THEN** nennt der Editor „Module“ beim Modul „Vorgabe der Organisation: Führung im Einsatz“

#### Scenario: Gespeicherte Altwerte
- **WHEN** ein Override aus der Zeit vor dieser Änderung `fuehrungskraft` trägt
- **THEN** zeigt die Auswahl „Führungskraft der Organisation“
