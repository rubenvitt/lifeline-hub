# Spec Delta

## ADDED Requirements

### Requirement: Einsatzleiter in der Einsatzanzeige
Die Einsatzanzeige SHALL den Einsatzleiter der eigenen Führungsstelle mitliefern, in der Liste der
Einsätze wie im Detail eines Einsatzes, mit Art, Name, „seit“ und dem Vermerk „nicht mehr
disponiert“ wie an der Führungsstelle. Ohne erfassten Einsatzleiter MUST das Feld fehlen. Ein
geschwärzter Name MUST ohne Namen geliefert werden. Der Lage-Snapshot MUST den Einsatzleiter nicht
einfrieren, und eine Gerätesitzung MUST ihn nicht erhalten.

#### Scenario: Liste nennt den Einsatzleiter
- **WHEN** im Einsatz „Hochwasser“ die Person „Anna Schulz“ als Einsatzleiter erfasst ist und eine Person mit Leserecht die Liste der Einsätze abruft
- **THEN** trägt der Eintrag „Hochwasser“ den Einsatzleiter „Anna Schulz“ mit seinem „seit“

#### Scenario: Ohne Einsatzleiter
- **WHEN** im Einsatz kein Einsatzleiter erfasst ist, aber Mitglieder die App-Rolle Einsatzleitung tragen
- **THEN** fehlt das Feld des Einsatzleiters in Liste und Detail

#### Scenario: Geschwärzter Name
- **WHEN** der Name des Einsatzleiters „Anna Schulz“ in einem noch lesbaren Einsatz geschwärzt wurde (Schwärzung auf Antrag)
- **THEN** liefert die Liste den Einsatzleiter ohne Namen, und „Anna Schulz“ steht nirgends in der Antwort

#### Scenario: Gekoppeltes Gerät
- **WHEN** ein gekoppelter Lagemonitor oder ein UHS-Tablet den Einsatzkopf eines Einsatzes mit erfasstem Einsatzleiter „KBM Weber“ abruft
- **THEN** fehlt das Feld des Einsatzleiters, und „KBM Weber“ steht nicht in der Antwort

#### Scenario: Snapshot ohne Einsatzleiter
- **WHEN** ein Lage-Snapshot eines Einsatzes mit erfasstem Einsatzleiter angelegt wird
- **THEN** enthält der eingefrorene Einsatz des Snapshots keinen Einsatzleiter

### Requirement: Einsatzleiter in der Einsatzliste
Jede Kachel der Einsatzliste, aktiv wie abgeschlossen, SHALL eine Zeile mit dem Kürzel „EL“ und dem
Einsatzleiter tragen, in derselben Darstellung wie Kopfleiste und Funkplan, samt Vermerk „nicht mehr
disponiert“. Ist keiner erfasst, SHALL dort „EL nicht erfasst“ stehen, ein geschwärzter Name als
„Name geschwärzt“. Die Kachel MUST NOT Mitglieder mit der App-Rolle Einsatzleitung als Einsatzleiter
zeigen.

#### Scenario: Erfasster Einsatzleiter
- **WHEN** im Einsatz „Hochwasser“ der externe Einsatzleiter „KBM Weber“ erfasst ist
- **THEN** zeigt die Kachel „Hochwasser“ die Zeile „EL KBM Weber (extern)“

#### Scenario: App-Rolle ohne Einsatzleiter
- **WHEN** ein Mitglied „Administrator“ die Einsatzrolle Einsatzleitung trägt und kein Einsatzleiter erfasst ist
- **THEN** zeigt die Kachel „EL nicht erfasst“, und „Administrator“ steht dort nicht

#### Scenario: Wechsel auf einem anderen Schirm
- **WHEN** auf Schirm A der Einsatzleiter gewechselt wird und Schirm B die Einsatzliste offen hat
- **THEN** zeigt die Kachel auf Schirm B den neuen Einsatzleiter ohne Neuladen
