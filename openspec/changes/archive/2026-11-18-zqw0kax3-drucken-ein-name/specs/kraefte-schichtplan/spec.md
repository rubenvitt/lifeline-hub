## MODIFIED Requirements

### Requirement: Schichtplan drucken
Die Ablösung SHALL den Schichtplan eines Einsatzes als Druckansicht ausgeben, wahlweise je
Posten (Aushang) oder je Person (Zettel), für alle Blätter oder ein einzelnes. Der Einstieg MUST
„Druckansicht“ heißen und, solange die Ansicht Schichtplan gewählt ist, neben „Excel“ im Seitenkopf
stehen. Jedes Blatt MUST
auf einer neuen A4-Seite beginnen und den Druckkopf tragen. Der Aushang MUST je Schicht Zeit,
eingeteilte Personen mit Qualifikationen und offene Plätze als Wort zeigen, aber keine
Prüfbefunde. Der Zettel MUST je Schicht Zeit, Posten mit Abschnitt und die übrigen Eingeteilten
zeigen und die Stunden ohne Pausen summieren. Die Pause MUST keinen Aushang haben. Ohne Freigabe
des Moduls Personal MUST der Aushang nur die Besetzung als Zahl zeigen und der Zettel gesperrt
sein. Eine Tabellenzeile MUST in Chromium, Firefox und WebKit nicht über eine Seitengrenze
geschnitten werden.

#### Scenario: Aushang an der UHS
- **WHEN** jemand in der Ansicht Schichtplan im Seitenkopf „Druckansicht“ wählt, „Je Posten“ und die UHS Marktplatz
- **THEN** zeigt die Druckansicht ein Blatt UHS Marktplatz mit den Schichten nach Beginn, den
  Eingeteilten und „1 offen“ an der Schicht mit fehlender Person

#### Scenario: Zettel einer Person
- **WHEN** eine Person drei Schichten zu je drei Stunden und eine Pause von 30 Minuten hat
- **THEN** zeigt ihr Zettel vier Zeilen und „3 Schichten, 9 h“

#### Scenario: Ohne Modul Personal
- **WHEN** jemand ohne Freigabe des Moduls Personal die Druckansicht öffnet
- **THEN** zeigt der Aushang „3 von 4 besetzt“ ohne Namen, und „Je Person“ ist mit Grund gesperrt

#### Scenario: Langer Posten
- **WHEN** ein Posten mehr Schichten hat, als auf eine Seite passen
- **THEN** läuft die Tabelle auf der nächsten Seite mit wiederholtem Tabellenkopf weiter, und
  keine Zeile ist abgeschnitten
