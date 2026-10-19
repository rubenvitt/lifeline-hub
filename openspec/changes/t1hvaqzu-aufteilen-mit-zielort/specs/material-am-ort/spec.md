# Spec Delta

## MODIFIED Requirements

### Requirement: Material am Ort zuordnen

An jedem Ort SHALL eine Auswahl „Material zuordnen …“ Posten ohne Ort und Posten an anderen Orten
anbieten, getrennt in „Ohne Ort“ und „An anderem Ort“, mit dem bisherigen Ort im Etikett. Die Wahl
MUST den Posten an diesen Ort setzen und den bisherigen Ort lösen. Ist nichts anzubieten, MUST die
Ansicht das sagen und in das Modul Material springen lassen. Eine Ablehnung MUST unter der Auswahl
stehen. Lässt sich der gewählte Posten aufteilen (Verbrauchsgut, Menge ab 2, Rest ab 1), MUST die
Wahl zuerst in einem Dialog „Wie viel hierher?“ die Menge erfragen, vorbelegt mit der ganzen Menge:
die ganze Menge holt den Posten, eine kleinere teilt ihn auf und setzt den abgeteilten Teil an
diesen Ort, in einem Schritt.

#### Scenario: Von der Einheit an die UHS
- **WHEN** die Person im Bereich „Material“ der UHS „Turnhalle“ den Posten „Wolldecke · Staffel A“ wählt und im Dialog „Wie viel hierher?“ die vorbelegte ganze Menge bestätigt
- **THEN** liegt die Wolldecke an der UHS „Turnhalle“, die Einheit-Ansicht von „Staffel A“ zeigt sie nicht mehr, und das ETB nennt „Einheit «Staffel A» → UHS «Turnhalle»“

#### Scenario: Teilmenge an die UHS
- **WHEN** die Person im Bereich „Material“ der UHS „Turnhalle“ den Posten „Wolldecke · 50 · Staffel A“ wählt und im Dialog 20 einträgt
- **THEN** zeigt die UHS „Turnhalle“ 20 Wolldecken, die Einheit-Ansicht von „Staffel A“ zeigt 30, und das ETB hat genau einen Eintrag dazu

#### Scenario: Gerät ohne Mengenfrage
- **WHEN** die Person an einem Ort ein Gerät oder ein Verbrauchsgut mit Menge 1 wählt
- **THEN** liegt der Posten sofort an diesem Ort, ohne Dialog

#### Scenario: Nichts anzubieten
- **WHEN** jeder Posten des Einsatzes schon an diesem Ort liegt
- **THEN** steht neben der Auswahl, dass kein Material ohne Ort da ist, mit einem Sprung in das Modul Material

### Requirement: Ein Schreibweg für den Ort

Jeder Ortswechsel und jedes Lösen aus der Materialliste, der Einheit-Ansicht, der Fahrzeugliste, dem
UHS-Bereich „Material“ und der Ansicht eines Bereitstellungsraums SHALL dieselbe Änderung der
Material-Disposition senden: das Ort-Feld des Ziels mit seinem Wert, beim Lösen das Ort-Feld des
bisherigen Orts leer. Eine Teilmenge an einen Ort MUST jede Ansicht über das Aufteilen der
Material-Disposition mit denselben Ort-Feldern senden. Die Zuordnungswege des Moduls Einheiten MUST
NOT für Material genutzt werden.

#### Scenario: Gleicher Wechsel aus zwei Ansichten
- **WHEN** derselbe Posten einmal aus der Materialliste und einmal aus der Einheit-Ansicht der Einheit „Staffel B“ zugeordnet wird
- **THEN** senden beide dieselbe Änderung an die Material-Disposition

#### Scenario: Gleiche Teilmenge aus zwei Ansichten
- **WHEN** 20 von 50 Wolldecken einmal über „Aufteilen …“ der Materialliste mit Ort UHS „Turnhalle“ und einmal an der UHS „Turnhalle“ über „Material zuordnen …“ verlegt werden
- **THEN** senden beide dasselbe Aufteilen mit dem Ort-Feld der UHS an die Material-Disposition
