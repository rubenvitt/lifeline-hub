## ADDED Requirements

### Requirement: Kennzahlenband hält seine Höhe

Das Band „Lage in Zahlen“ im Lage-Dashboard und in Führung · Überblick MUST ab einer
Fensterbreite von 768 px seine Höhe behalten, wenn sich die Länge einer Notiz ändert. Jede
Notiz des Bands SHALL dort genau drei Textzeilen hoch sein, ob ihr Text kürzer oder länger
ist. Eine längere Notiz MUST mit einer Auslassung („…“) enden, ihr vollständiger Text MUST
als Hinweistext am Mauszeiger und im zugänglichen Namen der Kennzahl erreichbar bleiben.
Eine Notiz, die in drei Zeilen passt, MUST NOT gekürzt werden. Unter 768 px gilt weiter der
Boden von zwei Zeilen ohne Kürzung.

#### Scenario: Neue Standmeldung bei „Evakuiert“
- **WHEN** bei 1200, 1440 oder 1920 px Breite die Notiz von „Evakuiert“ „von ≈ 1 850 geplant · 1 ohne Meldung“ lautet und eine neue Standmeldung sie zu „von 1 850 geplant“ verkürzt
- **THEN** ist das Band danach genauso hoch wie davor, und Gefahrenmatrix, Sichtung und Meldungsstrom bleiben an ihrem Platz

#### Scenario: Pegel-Notiz mit und ohne Prognose
- **WHEN** die Pegel-Notiz bei derselben Breite einmal ohne und einmal mit „· Prognose … · +1 weitere“ steht
- **THEN** ist das Band in beiden Fällen gleich hoch

#### Scenario: Keine Aussage geht verloren
- **WHEN** die Notiz „von ≈ 1 850 geplant · 1 ohne Meldung“ bei 1200, 1440 oder 1920 px steht
- **THEN** ist sie ganz sichtbar, einschließlich „≈“ und „ohne Meldung“, ohne Auslassung

#### Scenario: Zu lange Notiz
- **WHEN** eine Notiz länger ist als drei Zeilen ihrer Zelle
- **THEN** endet die dritte Zeile mit „…“, der Hinweistext der Notiz zeigt den vollständigen Text, und der zugängliche Name der Kennzahl enthält ihn ebenfalls
