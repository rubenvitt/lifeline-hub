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
Instanz nicht verteilt, MUST sich nichts ändern. Ging der Passwort-Hash eines System-Admins je an
eine andere Instanz, MUST die Abweisung auch nach dem Widerruf der Zuordnung gelten.

#### Scenario: Admin mit Passkey am Hub
- **WHEN** der Hub die Org von „anna“ an einen ELW verteilt, „anna“ System-Admin ist, einen Anmelde-Passkey hat und sich am Hub mit richtigem Passwort anmelden will
- **THEN** antwortet der Hub mit 403 „Admins melden sich hier per Passkey an“, und es entsteht keine Sitzung

#### Scenario: Derselbe Admin am ELW
- **WHEN** „anna“ sich ohne Netz am ELW mit ihrem Passwort anmeldet
- **THEN** gelingt die Anmeldung, denn der ELW verteilt nichts

#### Scenario: Admin ohne Passkey
- **WHEN** der Admin „bert“ am Hub keinen Anmelde-Passkey hat
- **THEN** meldet er sich am Hub weiter per Passwort an

#### Scenario: Nach dem Widerruf
- **WHEN** der Hub die Kopplung widerruft, nachdem der Hash von „anna“ an den ELW ging
- **THEN** weist der Hub ihren Passwort-Login weiter mit 403 ab

### Requirement: Ein Admin ohne seinen Passkey kommt über ein Einmalpasswort zurück

Gilt für einen System-Admin die Passkey-Pflicht, MUST ein Einmalpasswort aus der
Benutzerverwaltung zugleich seine Anmelde-Passkeys entfernen, und die Admin-Spur MUST ihre Zahl
nennen. Wo die Pflicht nicht gilt, MUST das Einmalpasswort Passkeys unberührt lassen. Der
Startbefehl `admin-zugang-zuruecksetzen <benutzername>` MUST dasselbe für einen System-Admin ohne
eine andere Person tun: Anmelde-Passkeys entfernen, ein Einmalpasswort mit Wechselpflicht am
Terminal ausgeben, Sitzungen beenden und einen Eintrag ohne Akteur in die Admin-Spur schreiben. Für
andere Konten MUST er abbrechen.

#### Scenario: Passkey verloren, ein anderer Admin hilft
- **WHEN** „anna“ ihren Passkey verliert und „bert“ ihr am Hub ein Einmalpasswort gibt
- **THEN** sind ihre Anmelde-Passkeys entfernt, und sie meldet sich mit dem Einmalpasswort an und legt ein eigenes Passwort fest

#### Scenario: Der letzte Admin
- **WHEN** der einzige Admin seinen Passkey verliert und der Betrieb `admin-zugang-zuruecksetzen anna` am Server ausführt
- **THEN** steht am Terminal ein Einmalpasswort, mit dem „anna“ sich anmelden kann
