## MODIFIED Requirements

### Requirement: Stärke zählt jede Einheit höchstens einmal
Eine Stärkesumme über eine Menge von Einheiten SHALL die kumulierte Ist-Stärke nur der Einheiten
addieren, deren übergeordnete Einheit nicht selbst in derselben Summe steckt. Die Stärke eines
Einsatzabschnitts SHALL zählen, wer in ihm steht: jede aktive Einheit mit ihrer eigenen Stärke bei
ihrem wirksamen Abschnitt, also dem eigenen oder, ohne eigenen, dem ihrer nächsten Obereinheit mit
Abschnitt. Eine unterstellte Einheit in einem anderen Abschnitt zählt dort und nicht bei ihrer
Obereinheit.
- Die Seite Einsatzabschnitte (Gliederung, Detail, Organigramm), die Abschnittsvorschau, die
  Abschnittsansicht am Gerät, das Meldebild und der Führungsüberblick MUST für denselben Abschnitt
  dieselbe Stärke zeigen.
- Die Zahl der Einheiten eines Abschnitts MUST dieselbe Menge zählen wie seine Stärke.
- Ein Bereitstellungsraum MUST jede in ihm stehende Einheit höchstens einmal zählen.
- Eine leere Menge MUST weiter „keine Einheit zugeordnet“ bedeuten, nicht 0/0/0.

#### Scenario: Unterstellte Einheit im selben Abschnitt
- **WHEN** Einheit A (1/1/2) im Abschnitt X steht und ihr die Einheit B (0/1/3) unterstellt ist,
  die ebenfalls im Abschnitt X steht
- **THEN** zeigt der Abschnitt X die Stärke 1/2/5//8, nicht 1/3/8//12

#### Scenario: Unterstellte Einheit in anderem Abschnitt
- **WHEN** Einheit B (0/1/1) der Einheit A (1/1/2) unterstellt ist, A im Abschnitt X und B im
  Abschnitt Y steht
- **THEN** zeigt Y die Stärke 0/1/1//2 und X die Stärke 1/1/2//4, auf der Seite Einsatzabschnitte
  wie im Meldebild
- **AND** zeigt ein Abschnitt über X und Y „inkl. Unterabschnitte“ beide zusammen, 1/2/3//6

#### Scenario: Unterstellte Einheit ohne eigenen Abschnitt
- **WHEN** Einheit B der Einheit A unterstellt ist, A im Abschnitt X steht und B keinen eigenen
  Abschnitt trägt
- **THEN** zählt B bei X

#### Scenario: Abschnitt mit nur einer abgestellten Einheit
- **WHEN** im Abschnitt „UHS Turnhalle“ nur die Sanitätsgruppe (0/1/1) steht, die dem Zug in einem
  anderen Abschnitt unterstellt ist
- **THEN** zeigen Gliederung und Organigramm für „UHS Turnhalle“ 0/1/1//2 und „1 Einheit“, nicht
  0/0/0//0

#### Scenario: Bereitstellungsraum mit Einheit und Untereinheit
- **WHEN** im Bereitstellungsraum Einheit A und die ihr unterstellte Einheit B stehen
- **THEN** zählt die Summe B genau einmal

#### Scenario: Meldebild mit kumulierter Elternzeile
- **WHEN** das Meldebild Einheit A (1/1/2) mit der unterstellten Einheit B (0/1/3) im selben
  Abschnitt als Kind zeigt
- **THEN** zeigt A 1/2/5//8, B 0/1/3//4, und der Seitenkopf zählt 1/2/5//8

## ADDED Requirements

### Requirement: Kräfte heißt Köpfe
Eine Zahl, die mit „Kräfte“ beschriftet ist, SHALL Personen zählen. Fahrzeuge, Einheiten und
Material MUST NOT in eine Zahl „Kräfte“ eingehen; nennt eine Stelle sie mit, dann als eigene Zahl
mit eigenem Wort.

#### Scenario: Zeile über dem Meldebild
- **WHEN** der Einsatz 12 Personen und 8 Fahrzeuge führt und kein Filter gesetzt ist
- **THEN** steht über dem Meldebild „12 von 12 Kräften · 8 von 8 Fahrzeugen“, nicht „20 von 20
  Kräften“

#### Scenario: Gefilterte Auswahl
- **WHEN** ein Filter 5 der 12 Personen und 2 der 8 Fahrzeuge durchlässt
- **THEN** steht dort „5 von 12 Kräften · 2 von 8 Fahrzeugen“

### Requirement: Kräfte an Unfallhilfsstellen nur an aktiven UHS
Die Zahl der Kräfte an Unfallhilfsstellen SHALL das aktive Personal zählen, das einer UHS im
Status „aktiv“ zugeordnet ist. Geplante und aufgelöste UHS MUST NOT mitzählen. Lagebild und
Lagemonitor MUST dieselbe Zahl zeigen und sie als Kräfte „an UHS“ beschriften.

#### Scenario: Geplante UHS mit zugeordnetem Personal
- **WHEN** der aktiven UHS „Turnhalle“ drei Kräfte zugeordnet sind und der geplanten UHS „Sporthalle“
  zwei
- **THEN** nennt das Lagebild in der Kennzahl „UHS aktiv“ „1 geplant · 3 Kräfte an UHS“
- **AND** nennt der Lagemonitor in der Kachel „Kräfte“ „3 an UHS“
