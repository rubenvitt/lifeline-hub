## MODIFIED Requirements

### Requirement: Knotenaufbau

Das Organigramm SHALL diesen Baum zeigen:

- Wurzel „Einsatzleitung“
- darunter die obersten Abschnitte
- unter einem Abschnitt seine Unterabschnitte und dann seine obersten Einheiten
- unter einer Einheit ihre unterstellten Einheiten

Ein Abschnitt, dessen übergeordneter Abschnitt fehlt, MUST als oberster Abschnitt erscheinen. Für
eine Einheit ohne bekannte übergeordnete Einheit gilt dasselbe. Einheiten ohne Abschnitt stehen
unter dem Sammelknoten „Ohne Abschnitt“, der nur erscheint, wenn es solche Einheiten gibt. Eine
unterstellte Einheit, die selbst in einem anderen Abschnitt steht als ihre übergeordnete Einheit,
MUST wie im Meldebild unter ihrem eigenen Abschnitt stehen und „aus <Name der übergeordneten
Einheit>“ tragen. Die Fernmeldeskizze, die diesen Baum als Vorlage liest, MUST den Verband behalten
wie der Funkplan.

#### Scenario: Unterstellte Einheit

- **WHEN** Einheit B der Einheit A unterstellt ist und A dem Abschnitt „EA Nord“ zugeordnet ist
- **THEN** steht B unter A, und A steht unter „EA Nord“

#### Scenario: Unterstellte Einheit in einem anderen Abschnitt

- **WHEN** die „Sanitätsgruppe UHS“ dem „Sanitätszug“ im Abschnitt „EA 1“ unterstellt ist und selbst
  im Unterabschnitt „UHS Turnhalle“ steht
- **THEN** steht sie im Organigramm unter „UHS Turnhalle“ mit „aus Sanitätszug“, nicht unter dem
  Sanitätszug
- **AND** hängt sie in der Fernmeldeskizze weiter am Sanitätszug, wie im Funkplan

#### Scenario: Keine Einheit ohne Abschnitt

- **WHEN** alle Einheiten einem Abschnitt zugeordnet sind
- **THEN** gibt es keinen Knoten „Ohne Abschnitt“

### Requirement: Stärke aus derselben Rechnung wie die Abschnittsseite

Die Stärke eines Abschnittsknotens SHALL die Stärke einschließlich aller Unterabschnitte sein. Sie
MUST mit dem Wert übereinstimmen, den der Gliederungsbaum derselben Seite für diesen Abschnitt
zeigt. Die Stärke eines Einheitsknotens SHALL ihre eigene Ist-Stärke samt der unterstellten
Einheiten sein, die unter ihr stehen; eine unterstellte Einheit unter einem anderen Abschnitt zählt
dort. Die Wurzel „Einsatzleitung“ MUST NOT eine eigene Gesamtstärke zeigen, denn die Kräftezahl des
Einsatzes hat ihre Heimat im Meldebild.

#### Scenario: Gleiche Zahl in beiden Ansichten

- **WHEN** ein Abschnitt mit zwei Unterabschnitten und je einer Einheit in der Gliederung
  „1/2/9//12“ zeigt
- **THEN** zeigt derselbe Abschnitt im Organigramm „1/2/9//12“

#### Scenario: Abschnitt ohne Einheiten

- **WHEN** einem Abschnitt und seinen Unterabschnitten keine Einheit zugeordnet ist
- **THEN** zeigt sein Knoten „—“ und nicht „0/0/0//0“

#### Scenario: Einheitsknoten ohne abgestellte Gruppe

- **WHEN** der Sanitätszug selbst 1/0/2 hat und seine Gruppe (0/1/1) im Unterabschnitt „UHS
  Turnhalle“ steht
- **THEN** zeigt der Zugknoten 1/0/2//3 und der Gruppenknoten unter „UHS Turnhalle“ 0/1/1//2
