## MODIFIED Requirements

### Requirement: Material am Ort lösen

Jede Zeile SHALL das Lösen vom Ort ohne Rückfrage anbieten, beschriftet je Ort: „Aus Einheit
lösen“, „Vom Fahrzeug lösen“, an UHS und Bereitstellungsraum „Lösen“. Ist es die einzige
Handlung der Zeile, MUST es als roter Knopf mit Abstand stehen; bietet die Zeile auch „Ausgeben“,
MUST es im ⋮ der Zeile stehen und „Ausgeben“ als Knopf. Ein gelöster Posten MUST ohne Ort im
Einsatz bleiben. Eine Ablehnung MUST an der Zeile stehen.

#### Scenario: Vom Fahrzeug lösen
- **WHEN** die Person im Block „Beladung“ beim Stromerzeuger „Vom Fahrzeug lösen“ wählt
- **THEN** steht der Stromerzeuger ohne Ort in der Materialliste

#### Scenario: Decken an der UHS lösen
- **WHEN** die Person an der UHS die Zeile „Wolldecken“ ansieht, von denen noch welche auszugeben sind
- **THEN** steht „Wolldecken ausgeben“ als Knopf und „Lösen“ im ⋮ der Zeile, auch über das Kontextmenü am Namen

### Requirement: Lösen rückgängig machen

An einem Ort, der nicht beendet ist, SHALL das Lösen einen Rückgängig-Weg im Hinweis und in der
gehaltenen Zeile anbieten, der den Posten über denselben Schreibweg wieder diesem Ort zuordnet.
Liegt der Posten inzwischen an einem anderen Ort, MUST der Rückweg ohne Änderung abgelehnt werden
und diesen Ort nennen. Eine Ablehnung MUST über dem Baustein stehen bleiben, auch wenn die
gelöste Zeile wegfällt.

#### Scenario: Lösen rückgängig machen
- **WHEN** die Person nach dem Lösen der Trage im Hinweis „Rückgängig“ wählt
- **THEN** liegt die Trage wieder an diesem Ort und zeigt ihre Zeile mit dem Lösen-Knopf

#### Scenario: Kein Rückgängig am beendeten Ort
- **WHEN** die Person an der aufgelösten UHS die Trage löst
- **THEN** nennt der Hinweis „Trage gelöst“ ohne „Rückgängig“, die gehaltene Zeile trägt keinen Knopf „Rückgängig“, denn die UHS nimmt kein Material mehr an

#### Scenario: Posten liegt inzwischen woanders
- **WHEN** die Trage an der UHS gelöst und danach auf das Fahrzeug 83-1 geladen wurde und die Person „Rückgängig“ wählt
- **THEN** bleibt die Trage auf 83-1, und über dem Baustein steht, dass sie inzwischen auf «83-1» liegt
