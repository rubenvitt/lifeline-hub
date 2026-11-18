## MODIFIED Requirements

### Requirement: Planung drucken
Eine Planung SHALL dieselben Druckblätter wie der Schichtplan eines Einsatzes ausgeben
(`/planungen/{id}/druck?sicht=posten|person&auswahl=…`): einen Aushang je Posten in der
Reihenfolge der Planung ohne die Pause und einen Schichtzettel je eingeteilter Person mit der Pause.
Der Druckkopf MUST die Planung statt eines Einsatzes nennen, die Zeiten MUST in der Zone der
Organisation stehen. Die Druckansicht MUST ein Schnappschuss sein, den eine Änderung an der Planung
nicht still ändert. Solange der Reiter „Plan“ gewählt ist, MUST der Seitenkopf der Planung
„Druckansicht“ und „Excel“ anbieten.

#### Scenario: Aushang aus der Planungsseite
- **WHEN** jemand im Reiter „Plan“ einer Planung mit zwei Posten im Seitenkopf „Druckansicht“ wählt
- **THEN** stehen zwei Aushänge in der Reihenfolge der Posten da, jeder auf eigener Seite, und der
  Druckkopf nennt „Planung“ mit ihrer Bezeichnung
