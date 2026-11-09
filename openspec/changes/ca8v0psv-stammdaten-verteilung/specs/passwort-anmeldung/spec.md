# Spec Delta

## ADDED Requirements

### Requirement: Admins mit Passkey melden sich an einer verteilenden Instanz nicht per Passwort an

Eine Instanz verteilt die Geheimnisse einer Org, solange sie für diese Org die erreichte Seite
einer aktiven Org-Zuordnung ist (Fähigkeit `stammdaten-verteilung`). Dort MUST ein Passwort-Login
eines System-Admins dieser Org mit mindestens einem Anmelde-Passkey abgewiesen werden, auch bei
richtigem Passwort und richtigem zweiten Faktor. Bei richtigem Passwort MUST die
Abweisung 403 mit dem Text „Admins melden sich hier per Passkey an“ sein. Sie MUST NOT als
Fehlversuch zählen. Ein falsches Passwort MUST wie bisher mit 401 scheitern. Ein System-Admin ohne
Anmelde-Passkey MUST sich weiter per Passwort anmelden können. Für Orgs, deren Geheimnisse die
Instanz nicht verteilt, MUST sich nichts ändern.

#### Scenario: Admin mit Passkey am Hub
- **WHEN** der Hub die Org von „anna“ an einen ELW verteilt, „anna“ System-Admin ist, einen Anmelde-Passkey hat und sich am Hub mit richtigem Passwort anmelden will
- **THEN** antwortet der Hub mit 403 „Admins melden sich hier per Passkey an“, und es entsteht keine Sitzung

#### Scenario: Derselbe Admin am ELW
- **WHEN** „anna“ sich ohne Netz am ELW mit ihrem Passwort anmeldet
- **THEN** gelingt die Anmeldung, denn der ELW verteilt nichts

#### Scenario: Admin ohne Passkey
- **WHEN** der Admin „bert“ am Hub keinen Anmelde-Passkey hat
- **THEN** meldet er sich am Hub weiter per Passwort an
