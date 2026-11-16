## MODIFIED Requirements

### Requirement: Stärke im Kräftebaum

Die Zeile einer Einheit SHALL ihre Stärke samt aller Untereinheiten zeigen, die unter ihr stehen;
eine abgestellte Untereinheit steht nicht unter ihr und zählt nicht mit. Die Summe der Stärken
der Wurzeln MUST der Stärke im Seitenkopf gleichen. Fahrzeug-, Personen- und Gruppenzeilen MUST
keine Stärke zeigen; ein Fahrzeug zeigt stattdessen seine Besatzung Ist und Soll. Verteilung der
Mittel und Tönung einer Einheit MUST nur ihre eigenen Mittel zählen.

#### Scenario: Kumulierte Elternzeile
- **WHEN** „Zug 1“ selbst 1/1/2 hat und ihre Gruppen 0/1/8 und 0/1/8, alle im selben Abschnitt
- **THEN** zeigt „Zug 1“ 1/3/18//22, jede Gruppe ihre eigene Stärke, und der Kopf zählt 1/3/18//22 einmal

#### Scenario: Elternzeile ohne abgestellte Gruppe
- **WHEN** „Zug 1“ (1/1/2) im Abschnitt X steht, ihre Gruppe „Gr 1“ (0/1/8) ebenfalls und ihre
  Gruppe „Gr 2“ (0/1/8) im Abschnitt Y
- **THEN** zeigt „Zug 1“ 1/2/10//13 und „Gr 2“ unter Y ihre 0/1/8//9, und der Kopf zählt 1/3/18//22

## ADDED Requirements

### Requirement: Abgestellte Untereinheit unter ihrem Abschnitt

Steht eine Untereinheit in einem anderen Abschnitt als ihre Obereinheit, also mit einem eigenen
Abschnitt, der vom wirksamen Abschnitt der Obereinheit abweicht, SHALL das Meldebild sie mit ihren
Kindern als Wurzel unter diesem Abschnitt zeigen, mit dem Zusatz „aus <Name der Obereinheit>“. Eine
Untereinheit ohne eigenen Abschnitt MUST unter ihrer Obereinheit bleiben. Der Filter „Abschnitt“
MUST dem wirksamen Abschnitt der Einheit folgen.

#### Scenario: Gruppe an der UHS
- **WHEN** die „Sanitätsgruppe UHS“ dem „Sanitätszug“ im Abschnitt „EA 1“ unterstellt ist und selbst
  im Unterabschnitt „UHS Turnhalle“ steht
- **THEN** steht sie im Meldebild unter „UHS Turnhalle“ mit „aus Sanitätszug“, nicht unter dem
  Sanitätszug
- **AND** zeigt der Filter „Abschnitt: UHS Turnhalle“ die Gruppe und „Abschnitt: EA 1“ den Zug ohne
  sie

#### Scenario: Gruppe ohne eigenen Abschnitt
- **WHEN** „Gr 1“ dem „Zug 1“ im Abschnitt X unterstellt ist und keinen eigenen Abschnitt trägt
- **THEN** steht sie eingerückt unter „Zug 1“, und der Filter „Abschnitt: X“ zeigt beide
