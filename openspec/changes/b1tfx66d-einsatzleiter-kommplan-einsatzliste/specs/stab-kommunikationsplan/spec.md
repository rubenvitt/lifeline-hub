# Spec Delta

## ADDED Requirements

### Requirement: Einsatzleiter an der Zeile der Führungsstelle
Die Zeile der eigenen Führungsstelle SHALL im Nebentext nach dem Rufnamen „Einsatzleiter“ und den
Einsatzleiter nennen, in derselben Darstellung wie Kopfleiste und Funkplan, am Schirm wie im Druck.
Ist keiner erfasst, SHALL dort „Einsatzleiter nicht erfasst“ stehen. Fehlt die Quelle der
Führungsstelle, MUST der Nebentext nur ihren Grund nennen. Der Kommunikationsplan MUST NOT die
App-Rolle als Einsatzleiter zeigen und MUST NOT eine Kontaktangabe des Einsatzleiters zeigen.

#### Scenario: Rufname und Einsatzleiter
- **WHEN** die Führungsstelle den Rufnamen „Florian Kreis 10-1“ trägt und „Anna Schulz“ als Einsatzleiter erfasst ist
- **THEN** lautet der Nebentext der Zeile „Führungsstelle“ „Florian Kreis 10-1 · Einsatzleiter Anna Schulz“

#### Scenario: Ohne Rufname
- **WHEN** die Führungsstelle keinen Rufnamen trägt und „KBM Weber“ als externer Einsatzleiter erfasst ist
- **THEN** lautet der Nebentext „Einsatzleiter KBM Weber (extern)“

#### Scenario: Ohne Einsatzleiter
- **WHEN** die Führungsstelle erfasst ist, aber kein Einsatzleiter, und ein Mitglied die App-Rolle Einsatzleitung trägt
- **THEN** nennt der Nebentext „Einsatzleiter nicht erfasst“, und der Name des Mitglieds steht dort nicht

#### Scenario: Name geschwärzt
- **WHEN** der Name des Einsatzleiters geschwärzt ist
- **THEN** nennt der Nebentext „Einsatzleiter Name geschwärzt“

#### Scenario: Ohne Netz
- **WHEN** der Kommunikationsplan ohne Netz gelesen wird und die Führungsstelle nicht auf dem Gerät liegt
- **THEN** steht die Zeile „Führungsstelle“ mit dem Grund im Nebentext und ohne Einsatzleiter
