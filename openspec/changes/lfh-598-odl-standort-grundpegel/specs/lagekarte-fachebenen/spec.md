# Spec Delta

## MODIFIED Requirements

### Requirement: Bewertungsstufe nach festen Bändern
Das System SHALL jeder Sonde, für die **kein** Standort-Grundpegel vorliegt, genau eine
Stufe aus diesen Bändern zuweisen: `keine_messung` (kein Messwert), `normal` (Messwert
≤ 0,2 µSv/h), `erhoeht` (0,2 < Messwert ≤ 0,6 µSv/h), `stark_erhoeht` (Messwert
> 0,6 µSv/h). Die Stufenwörter sind Teil der Schnittstelle und MUST unverändert bleiben —
gleich, ob die Stufe aus diesen Bändern oder aus dem Standort-Grundpegel stammt.

#### Scenario: Grenzwerte werden der unteren Stufe zugeschlagen
- **WHEN** eine Sonde ohne Grundpegel genau 0,2 µSv/h bzw. genau 0,6 µSv/h meldet
- **THEN** trägt sie die Stufe `normal` bzw. `erhoeht`

#### Scenario: Werte oberhalb der Bänder
- **WHEN** eine Sonde ohne Grundpegel 0,21 µSv/h bzw. 0,61 µSv/h meldet
- **THEN** trägt sie die Stufe `erhoeht` bzw. `stark_erhoeht`

#### Scenario: Kaltstart ohne Grundpegel
- **WHEN** für noch keine Sonde ein Grundpegel berechnet wurde (erster Start, Zeitreihe nicht erreichbar)
- **THEN** tragen alle Sonden ihre Stufe nach diesen Bändern und die Grundlage `absolut`

### Requirement: Die Einteilung gibt sich als Projekt-Einteilung zu erkennen
Das System MUST überall dort, wo es eine Sonde als „erhöht" bezeichnet, erkennbar machen,
dass die Einteilung eine Einteilung des Lifeline Hub ist und kein amtlicher Schwellenwert
des BfS, und MUST dabei die für diese Sonde **geltende** Grundlage nennen: bei
standortbezogener Bewertung die Faktor-Schwellen zum Grundpegel der Sonde, bei absoluter
Bewertung die Bänder auf Grundlage des vom BfS genannten natürlichen Bereichs
(0,05–0,2 µSv/h). Die Beschriftung der Stufen MUST für beide Grundlagen zutreffen und
darf deshalb keinen der beiden Maßstäbe nennen. Die Quellendokumentation MUST dasselbe
festhalten.

#### Scenario: Hinweis im Inspector
- **WHEN** ein Benutzer auf der Lagekarte eine ODL-Sonde mit Grundpegel anwählt
- **THEN** zeigt der Inspector Messwert, Messende, Stufe als Wort, Grundpegel in µSv/h samt Stand, Faktor und einen sichtbaren Hinweis, dass die Faktor-Schwellen eine Einteilung des Lifeline Hub und keine BfS-Schwelle sind

#### Scenario: Hinweis im Inspector bei absoluter Bewertung
- **WHEN** ein Benutzer eine ODL-Sonde ohne Grundpegel anwählt
- **THEN** zeigt der Inspector Messwert, Messende, Stufe als Wort, den Hinweis, dass für diese Sonde noch kein Grundpegel vorliegt, und den Hinweis, dass die Bänder am natürlichen Bereich keine BfS-Schwelle sind

## ADDED Requirements

### Requirement: Bewertungsstufe nach Standort-Grundpegel
Liegt für eine Sonde mit Messwert in µSv/h ein Standort-Grundpegel vor, SHALL das System
ihre Stufe aus dem Faktor Messwert ÷ Grundpegel bilden: `normal` (Faktor ≤ 1,5),
`erhoeht` (1,5 < Faktor ≤ 3), `stark_erhoeht` (Faktor > 3). Eine Sonde ohne Messwert
MUST weiterhin `keine_messung` tragen. Der Grundpegel einer Sonde SHALL aus ihren
Stundenwerten der letzten sieben Tage laut BfS-Zeitreihe gebildet werden (unteres
Quartil) und MUST nur gebildet werden, wenn mindestens 20 solcher Werte vorliegen.

#### Scenario: Verdreifachung an einer Sonde mit niedrigem Grundpegel
- **WHEN** eine Sonde mit Grundpegel 0,06 µSv/h 0,19 µSv/h meldet
- **THEN** trägt sie die Stufe `stark_erhoeht`, obwohl der Messwert im natürlichen Bereich liegt

#### Scenario: Regen an einer Sonde mit hohem Grundpegel
- **WHEN** eine Sonde mit Grundpegel 0,2 µSv/h 0,28 µSv/h meldet
- **THEN** trägt sie die Stufe `normal`, obwohl der Messwert über 0,2 µSv/h liegt

#### Scenario: Faktor-Grenzen werden der unteren Stufe zugeschlagen
- **WHEN** eine Sonde mit Grundpegel 0,1 µSv/h genau 0,15 µSv/h bzw. genau 0,3 µSv/h meldet
- **THEN** trägt sie die Stufe `normal` bzw. `erhoeht`

#### Scenario: Zu wenig Historie
- **WHEN** die Zeitreihe für eine Sonde weniger als 20 Stundenwerte enthält
- **THEN** erhält die Sonde keinen Grundpegel und wird nach den festen Bändern bewertet

### Requirement: Features nennen die Grundlage ihrer Stufe
Jedes ODL-Feature SHALL die Grundlage seiner Stufe als Wire-Wort tragen: `standort`, wenn
die Stufe aus dem Grundpegel stammt, sonst `absolut`. Bei `standort` MUST das Feature
zusätzlich den Grundpegel in µSv/h, den Faktor und den Zeitpunkt der Grundpegel-Berechnung
tragen; bei `absolut` MUST diese Angaben fehlen statt als `null` zu erscheinen. Die
Grundlagen-Wörter sind Teil der Schnittstelle und MUST beidseitig gepinnt sein.

#### Scenario: Sonde mit Grundpegel
- **WHEN** die Route `GET /api/karte/fachebenen/odl` eine Sonde mit Grundpegel und Messwert ausliefert
- **THEN** trägt das Feature `bewertung: "standort"`, den Grundpegel, den Faktor und den Stand des Grundpegels

#### Scenario: Sonde ohne Grundpegel
- **WHEN** die Route eine Sonde ohne Grundpegel ausliefert
- **THEN** trägt das Feature `bewertung: "absolut"` und weder Grundpegel noch Faktor noch Stand

### Requirement: Der Grundpegel wandert nicht in eine Lage hinein mit
Das System SHALL den Grundpegel einer Sonde höchstens einmal täglich neu berechnen. Würde
eine Neuberechnung den bisher gespeicherten Grundpegel einer Sonde auf das 1,5-Fache oder
mehr anheben, MUST das System die Neuberechnung für diese Sonde verwerfen und den bisherigen
Grundpegel samt seinem Stand beibehalten.

#### Scenario: Mehrtägige Erhöhung
- **WHEN** eine Sonde mit gespeichertem Grundpegel 0,1 µSv/h über mehrere Tage erhöht misst und die Neuberechnung 0,16 µSv/h ergäbe
- **THEN** bleibt ihr Grundpegel 0,1 µSv/h mit dem bisherigen Stand, und der Faktor wird weiter gegen 0,1 µSv/h gebildet

#### Scenario: Leichte Verschiebung des Grundpegels
- **WHEN** die Neuberechnung für eine Sonde mit gespeichertem Grundpegel 0,1 µSv/h 0,12 µSv/h ergibt
- **THEN** übernimmt das System 0,12 µSv/h mit neuem Stand

### Requirement: Ausfall der Zeitreihe bricht die Ebene nicht
Die Berechnung des Grundpegels SHALL die Auslieferung der ODL-Ebene weder verzögern noch
verhindern: die Route MUST ihre Antwort nicht auf den Abruf der Zeitreihe warten lassen.
Ist die Zeitreihe nicht erreichbar oder unbrauchbar, SHALL das System einen früher
berechneten Grundpegel weiterverwenden, sonst nach den festen Bändern bewerten, und MUST
dabei keinen 5xx-Fehler liefern.

#### Scenario: Zeitreihe weg beim ersten Start
- **WHEN** die ODL-Ebene zum ersten Mal abgerufen wird und die BfS-Zeitreihe nicht antwortet
- **THEN** antwortet die Route ohne auf die Zeitreihe zu warten mit den Sonden nach festen Bändern und `bewertung: "absolut"`

#### Scenario: Zeitreihe weg, alter Grundpegel vorhanden
- **WHEN** die tägliche Neuberechnung scheitert, aber ein früher berechneter Grundpegel gespeichert ist
- **THEN** werden die Sonden weiter gegen diesen Grundpegel bewertet
