## MODIFIED Requirements

### Requirement: Material am Ort lösen

Jede Zeile SHALL das Lösen vom Ort ohne Rückfrage anbieten, als roter Knopf mit Abstand, beschriftet
je Ort: „Aus Einheit lösen“, „Vom Fahrzeug lösen“, an UHS und Bereitstellungsraum „Lösen“. Ein
gelöster Posten MUST ohne Ort im Einsatz bleiben. Eine Ablehnung MUST an der Zeile stehen. Die Zeile
eines selbst gelösten Postens MUST an ihrer Stelle als „Gelöst“ stehen bleiben, bis Zeiger und Fokus
den Baustein verlassen haben und seit dem letzten Tipp darin einige Sekunden vergangen sind; an der
Stelle des Knopfs löst dann nichts, und die Zeile behält ihre Höhe. An einem Ort, der nicht beendet
ist, SHALL das Lösen einen Rückgängig-Weg anbieten, der den Posten wieder diesem Ort zuordnet.

#### Scenario: Vom Fahrzeug lösen
- **WHEN** die Person im Block „Beladung“ beim Stromerzeuger „Vom Fahrzeug lösen“ wählt
- **THEN** steht der Stromerzeuger ohne Ort in der Materialliste

#### Scenario: Zwei schnelle Tipps lösen einen Posten
- **WHEN** die Person an der UHS mit den Posten Trage und Lichtmast zweimal schnell auf „Lösen“ in der Zeile der Trage tippt
- **THEN** ist nur die Trage gelöst, der Lichtmast liegt weiter an der UHS, und an der Stelle des Knopfs steht „Gelöst“

#### Scenario: Gelöste Zeile fällt nach dem Verlassen
- **WHEN** die Person die Trage gelöst hat und Zeiger und Fokus den Baustein verlassen
- **THEN** fällt die Zeile der Trage nach wenigen Sekunden weg, und die übrigen Zeilen rücken nach

#### Scenario: Lösen rückgängig machen
- **WHEN** die Person nach dem Lösen der Trage im Hinweis „Rückgängig“ wählt
- **THEN** liegt die Trage wieder an diesem Ort und zeigt ihre Zeile mit dem Lösen-Knopf

#### Scenario: Kein Rückgängig am beendeten Ort
- **WHEN** die Person an der aufgelösten UHS die Trage löst
- **THEN** nennt der Hinweis „Trage gelöst“ ohne „Rückgängig“, denn die UHS nimmt kein Material mehr an
