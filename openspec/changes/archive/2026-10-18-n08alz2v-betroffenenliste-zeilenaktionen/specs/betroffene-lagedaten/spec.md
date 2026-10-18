## ADDED Requirements

### Requirement: Sichtung und Verbleib aus der Betroffenenliste

Die Betroffenenliste SHALL Nachsichten, Verbleib erfassen und einen Verortungsauftrag direkt aus
der Zeile anbieten, ohne Umweg über die Detailseite.
- Die Sichtungszelle MUST der Auslöser der Nachsichtung sein: Zelle, Fläche, „Übernehmen“,
  höchstens drei Tipps. Ihr zugänglicher Name nennt die Kennung der Person.
- Bei offenem Verbleib MUST die Verbleib-Zelle „Verbleib erfassen“ anbieten.
- Ein Zeilenmenü MUST „Sichten“, „Verbleib erfassen“ und „Auf Lagekarte verorten“ tragen.
- Der Zeilenklick MUST weiter die Detailseite öffnen. Eine Bedienung in Zelle, Popover oder Menü
  MUST NOT den Zeilenklick auslösen.
- Ein abgelehnter Schreibversuch MUST an seiner Zeile stehen.
- Solange ein Popover oder Menü einer Zeile offen ist, MUST die Liste Menge und Folge halten.
- Ohne Schreibrecht MUST über der Liste „Nur Ansicht“ mit Grund stehen, und die Bedienelemente
  MUST fehlen.

#### Scenario: Nachsichtung aus der Liste
- **WHEN** jemand mit Schreibrecht in der Zeile von R-007 auf die Sichtung tippt, „SK I“ wählt und
  „Übernehmen“ drückt
- **THEN** zeigt die Zeile „SK I“, die Detailseite wurde nicht geöffnet, und es waren drei Tipps

#### Scenario: Verbleib-Lücke schließen
- **WHEN** „Nur Lücken zeigen“ aktiv ist und jemand in der leeren Verbleib-Zelle „Verbleib
  erfassen“ wählt und einen Transport speichert
- **THEN** trägt die Zeile den Verbleib, und die Lückenzahl sinkt um eins

#### Scenario: Liste springt nicht unter dem Popover
- **WHEN** das Sichtungs-Popover einer Zeile offen ist und live eine neue Person hinzukommt
- **THEN** bleiben Menge und Folge der Liste, bis das Popover geschlossen ist

#### Scenario: Ohne Schreibrecht
- **WHEN** ein Beobachter die Betroffenenliste öffnet
- **THEN** steht über der Liste „Nur Ansicht“ mit Grund, und die Zeilen tragen weder
  Sichtungsauslöser noch „Verbleib erfassen“ noch Zeilenmenü
