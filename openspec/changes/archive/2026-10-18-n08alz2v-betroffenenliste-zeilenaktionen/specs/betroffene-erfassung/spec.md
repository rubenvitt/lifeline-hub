## MODIFIED Requirements

### Requirement: Tiere-Erfassung hält das Feldbudget

Die Erfassung eines Tieres auf der Tiere-Liste MUST in beiden Modi (Erfassen und „Vermisst
melden“) höchstens vier Eingabefelder sichtbar zeigen. Alle weiteren Felder MUST unter einem
aufklappbaren Bereich „Weitere Angaben“ stehen, der beim Aufklappen mehr Felder sichtbar macht.
Ein Pflichtfeld MUST nie hinter dem aufklappbaren Bereich stehen.

#### Scenario: Erfassen
- **WHEN** die Tiere-Erfassung geöffnet ist
- **THEN** sind höchstens vier Eingabefelder sichtbar, darunter Spezies und Fundort, und nach dem Aufklappen von „Weitere Angaben“ sind es mehr

#### Scenario: Vermisst melden
- **WHEN** „Vermisst melden“ auf der Tiere-Liste geöffnet ist
- **THEN** sind höchstens vier Eingabefelder sichtbar, und Farbe, Kennzeichnung und Halter-Kontakt erscheinen erst nach dem Aufklappen von „Weitere Angaben“
