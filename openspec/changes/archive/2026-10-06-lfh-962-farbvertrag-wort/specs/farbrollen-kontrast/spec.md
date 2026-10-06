## ADDED Requirements

### Requirement: Rot steht nur für den abnormen Zustand

Die Rolle `alarm` SHALL nur einen abnormen Zustand oder eine destruktive Handlung tragen. Ein
planmäßiger Endzustand, ein nicht erfasster Wert und ein Knopf, der nichts löscht, MUST NOT rot
sein. Jede Statusfarbe MUST ein sichtbares Wort neben sich haben; ein Wort nur im `aria-label`
oder `title` reicht nicht.

#### Scenario: Fahrzeug ohne zugeordnete Besatzung

- **WHEN** einem disponierten Fahrzeug keine Kraft zugeordnet ist
- **THEN** steht neutral „Besatzung nicht erfasst“, und Rot erscheint nur, wenn zugeordnete Kräfte
  das Soll unterschreiten

#### Scenario: Aufgelöste Unfallhilfsstelle

- **WHEN** eine UHS oder ein Bereitstellungsraum aufgelöst ist
- **THEN** trägt das Etikett „aufgelöst“ die Rolle `neutral`

#### Scenario: Abschnitt ohne Leiter

- **WHEN** einem Abschnitt kein Leiter eingetragen ist
- **THEN** zeigt der Gliederungsbaum das Wort „ohne Leiter“, keinen reinen Farbpunkt

#### Scenario: Knöpfe an der Sofortmeldung

- **WHEN** eine Sofortmeldung vorbelegt oder bestätigt wird
- **THEN** trägt weder „Sofortmeldung“ noch „Bestätigen“ `danger`; „Bestätigen“ ist der
  Primärknopf
