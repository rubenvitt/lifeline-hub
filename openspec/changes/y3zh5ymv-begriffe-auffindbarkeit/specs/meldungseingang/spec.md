## ADDED Requirements

### Requirement: Chat-Heraufstufung von Meldung und Lage legt den Vorgang im Meldungseingang an
Stuft eine Person eine Chat-Nachricht als „Meldung“ oder „Lage“ ins ETB herauf und hat sie „Nur
protokollieren“ nicht gewählt, SHALL das System in einer Transaktion den ETB-Eintrag und eine
Meldung anlegen, Art „Lagemeldung“ bei „Lage“, „Sonstige“ bei „Meldung“. Eintrag und Meldung MUST
aufeinander verweisen, die Nachricht MUST auf den Eintrag verweisen, ein zweiter ETB-Eintrag zur
Meldung MUST NOT entstehen.

#### Scenario: Meldung aus dem Chat
- **WHEN** eine Person eine Chat-Nachricht von „Anna Schulz“ als „Meldung“ heraufstuft, ohne „Nur protokollieren“
- **THEN** gibt es genau einen neuen ETB-Eintrag und eine Meldung der Art „Sonstige“ mit Absender „Anna Schulz“ und Status „neu“, beide verweisen aufeinander, und der Zähler „Meldungen offen“ steigt um eins

#### Scenario: Lage aus dem Chat
- **WHEN** eine Person eine Chat-Nachricht als „Lage“ heraufstuft, ohne „Nur protokollieren“
- **THEN** steht die Meldung der Art „Lagemeldung“ in der Liste der Lagemeldungen

#### Scenario: Nur protokolliert
- **WHEN** eine Person eine Chat-Nachricht als „Meldung“ mit „Nur protokollieren“ heraufstuft
- **THEN** entsteht nur der ETB-Eintrag, keine Meldung

#### Scenario: Anordnung
- **WHEN** eine Person eine Chat-Nachricht als „Anordnung“ heraufstuft
- **THEN** entsteht nur der ETB-Eintrag, und der Dialog bietet „Nur protokollieren“ nicht an

### Requirement: Die Meldung aus dem Chat übernimmt die Angaben der Nachricht
Die aus dem Chat angelegte Meldung SHALL den Anzeigenamen der Person, die die Nachricht schrieb,
als Absender, den Wortlaut des Eintrags, die Zeit der Nachricht als Ereigniszeit und den Meldeweg
„sonstige“ tragen, Status „neu“ und Priorität „normal“; erfasst hat sie, wer heraufstuft. Ein
automatischer ETB-Eintrag der Meldung MUST nicht entstehen. Live-Ereignisse und Hinweise MUST
wie bei einer erfassten Meldung kommen.

#### Scenario: Angaben übernommen
- **WHEN** „Anna Schulz“ um 14:30 im Chat schreibt und eine andere Person die Nachricht mit geändertem Wortlaut als „Meldung“ heraufstuft
- **THEN** trägt die Meldung den Absender „Anna Schulz“, den geänderten Wortlaut, die Ereigniszeit 14:30 und als Erfasserin die heraufstufende Person

#### Scenario: Live-Ereignisse
- **WHEN** eine Chat-Nachricht als „Meldung“ ohne „Nur protokollieren“ heraufgestuft wird
- **THEN** erhalten die verbundenen Clients des Einsatzes das ETB-Ereignis, das Chat-Ereignis und das Ereignis „meldung“

### Requirement: Die Chat-Heraufstufung in den Meldungseingang verlangt das Recht der Meldungen
Die Heraufstufung mit Meldung SHALL zusätzlich zur Freigabe des ETB die Freigabe des Moduls
Meldungen verlangen; fehlt sie, MUST das System mit HTTP 403 antworten und nichts anlegen. Der
Dialog MUST ohne diese Freigabe nur das Protokollieren anbieten und das sagen.

#### Scenario: Ohne Recht für Meldungen
- **WHEN** eine Person ohne Freigabe der Meldungen eine Heraufstufung mit Meldung sendet
- **THEN** antwortet das System mit HTTP 403, weder Eintrag noch Meldung entstehen, und die Nachricht lässt sich danach weiter heraufstufen

#### Scenario: Dialog ohne Recht
- **WHEN** eine Person ohne Freigabe der Meldungen den Dialog „Zu ETB heraufstufen“ öffnet
- **THEN** fehlt der Schalter „Nur protokollieren“, und ein Hinweis sagt, dass nur ins ETB übernommen wird

### Requirement: Das Meldungsformular öffnet sich über die Adresse
Die Seiten Meldungen und Lagemeldungen SHALL bei `?neu=1` das Meldungsformular öffnen, die
Lagemeldungen mit der Art „Lagemeldung“, und den Parameter danach aus der Adresse nehmen. Ohne
Schreibrecht in den Meldungen MUST die Seite den Parameter ohne Formular verwerfen.

#### Scenario: Meldungen per Adresse
- **WHEN** eine Person mit Schreibrecht `…/meldungen?neu=1` öffnet
- **THEN** zeigt die Seite das Meldungsformular, und die Adresse trägt danach kein `neu` mehr

#### Scenario: Lagemeldungen per Adresse
- **WHEN** eine Person mit Schreibrecht `…/lagemeldungen?neu=1` öffnet
- **THEN** zeigt die Seite das Meldungsformular mit der Art „Lagemeldung“

#### Scenario: Ohne Schreibrecht
- **WHEN** eine beobachtende Person `…/meldungen?neu=1` öffnet
- **THEN** zeigt die Seite die Liste ohne Formular, und die Adresse trägt kein `neu` mehr
