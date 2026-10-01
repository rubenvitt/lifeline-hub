# Spec Delta

## ADDED Requirements

### Requirement: Kartenhöhe unabhängig von Uhrzeit und fremder Rhythmusänderung

Die Karte einer Schicht SHALL ihre Fälligkeit in einer Zeitspalte fester Breite zeigen, die das
breiteste Zeitformat (Tag und Uhrzeit) fasst. Ob die Fälligkeit heute oder an einem anderen Tag
liegt, MUST weder die Spaltenbreite noch den Zeilenumbruch der Karte ändern. Der Rhythmus MUST
in einer eigenen Zeile stehen, die Quelle als „Vorgabe“ oder „eigen“. Ändert eine andere Person
den Rhythmus einer gezeigten Schicht, MUST die Karte ihre Höhe behalten.

#### Scenario: Fremde Rhythmusänderung kurz vor Mitternacht, mobil
- **WHEN** um 23:40 (Anzeigezone Europe/Berlin) auf 390 px Breite in der Dichte `komfortabel` drei Schichten mit 6 h gezeigt werden und eine andere Person den Rhythmus der mittleren auf 30 min setzt
- **THEN** behalten alle drei Karten ihre Oberkante (Abweichung höchstens 0,5 px), und die mittlere Karte zeigt ihre neue Einstufung

#### Scenario: Gleiche Lage am Tag und in der Nacht
- **WHEN** dieselbe Liste einmal um 12:00 und einmal um 23:40 gezeigt wird
- **THEN** ist die Zeitspalte der Karten in beiden Fällen gleich breit

#### Scenario: Längster zulässiger Rhythmus bleibt einzeilig
- **WHEN** eine Schicht einen Rhythmus von 167 h 59 min als Vorgabe des Abschnitts trägt und die Karte auf 390 px Breite in der Dichte `komfortabel` oder `handschuh` steht
- **THEN** steht „Rhythmus 167 h 59 min (Vorgabe)“ in einer Zeile
