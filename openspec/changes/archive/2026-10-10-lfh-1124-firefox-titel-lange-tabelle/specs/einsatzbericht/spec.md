# Spec Delta

## ADDED Requirements

### Requirement: Titel bleibt bei seiner Tabelle

Im Ausdruck des Einsatzberichts SHALL ein Titel (Block oder Abschnitt), dem eine Tabelle folgt,
mit dem Tabellenkopf und der ersten Tabellenzeile auf derselben Seite stehen, in jedem Browser,
dessen Druck die App trägt. Der Bericht MUST dafür vor der Tabelle höchstens so viel Platz frei
lassen, wie Titel, Kopf und erste Zeile zusammen brauchen. Der Kopf einer Tabelle, die über eine
Seite hinausgeht, SHALL sich auf jeder Folgeseite wiederholen.

#### Scenario: Titel einer langen Tabelle fiele ans Seitenende

- **WHEN** der Bericht mit der Anlage Personal je Kopf (40 Personen) gedruckt wird
- **AND** deren Titel so weit unten auf einer Seite stünde, dass die erste Zeile nicht mehr passt
- **THEN** stehen Titel, Spaltenkopf und erste Zeile gemeinsam oben auf der nächsten Seite
- **AND** die vorige Seite endet mit dem Inhalt davor, ohne Titel oder Spaltenkopf

#### Scenario: Keine fast leere Seite

- **WHEN** eine Tabelle mit Titel länger ist als der Rest der Seite
- **AND** Titel, Spaltenkopf und erste Zeile noch auf die Seite passen
- **THEN** beginnt die Tabelle auf dieser Seite und bricht danach zwischen zwei Zeilen um

#### Scenario: Kopf auf der Folgeseite

- **WHEN** eine Tabelle mit Titel über eine Seite hinausgeht
- **THEN** steht ihr Spaltenkopf auch oben auf der Folgeseite
- **AND** jede Zeile steht genau einmal im Ausdruck und in ihrer Reihenfolge
