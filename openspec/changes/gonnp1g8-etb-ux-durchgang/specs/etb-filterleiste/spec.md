# Spec Delta

## Purpose

Legt fest, wo die Filter des Einsatztagebuchs stehen, was die Zeitraum-Schnellwahl in die Adresse
schreibt und wie ein aktiver Filter unübersehbar bleibt, damit niemand ein gefiltertes Tagebuch
für vollständig hält.

## ADDED Requirements

### Requirement: Eine Filterleiste über der Zeitachse
Ab Breite `md` SHALL die ETB-Seite alle Filter in einer Leiste direkt über der Zeitachse zeigen, in
dieser Ordnung: Typ-Segmente, Umschaltknopf Systemeinträge, Zeitraum, Einheit, Volltext. Der
Seitenkopf MUST ab `md` keinen Filter tragen. In der kompakten Dichte bei 1440×900 MUST die Leiste
einzeilig bleiben; dichtere Stufen dürfen umbrechen. Unter `md` bleibt der Typ im Kopf, der Rest
hinter „Filter (n)“.

#### Scenario: Fükw
- **WHEN** die ETB-Seite in kompakter Dichte bei 1440×900 steht
- **THEN** stehen Typ, System, Zeitraum, Einheit und Volltext in einer Zeile über der Zeitachse, und der Kopf trägt nur Titel, Zahl und „Drucken / als PDF“

#### Scenario: Handschirm
- **WHEN** die Seite bei 390×844 steht
- **THEN** rollt der Typ einzeilig im Kopf, „Filter (n)“ zählt die übrigen gesetzten Merkmale samt System, und zwei Einträge stehen ganz im Bild

### Requirement: Zeitraum mit Schnellwahl
Der Zeitraum der Filterleiste SHALL ein Bedienziel sein, das eine Schnellwahl öffnet: „Letzte
Stunde“, „Letzte 4 Stunden“, „Seit letzter Lagebesprechung“ (nur mit Zugriff auf die
Lagebesprechung und wenn eine abgehalten ist), „Heute“ (Tagesbeginn der Anzeigezone) und „Eigener
Zeitraum“. Eine Wahl MUST absolute, auf die Minute abgerundete Grenzen `von`/`bis` in die Adresse
schreiben; „bis“ leer heißt jetzt. Die Beschriftung zeigt den wirksamen Wert ohne Sekunden.

#### Scenario: Letzte Stunde
- **WHEN** um 14:45:37 Serverzeit „Letzte Stunde“ gewählt wird
- **THEN** steht in der Adresse `von` für 13:45 ohne `bis`, und das Bedienziel heißt „seit 1345“

#### Scenario: Seit letzter Lagebesprechung
- **WHEN** die letzte Lagebesprechung um 13:30 abgehalten wurde und die Wahl getroffen wird
- **THEN** gilt `von` 13:30, und das Bedienziel heißt „seit LB 1330“

#### Scenario: Ohne Lagebesprechung
- **WHEN** keine Lagebesprechung abgehalten ist oder der Zugriff fehlt
- **THEN** bietet die Schnellwahl „Seit letzter Lagebesprechung“ nicht an

#### Scenario: Geteilter Link
- **WHEN** jemand einen Link mit gesetztem Zeitraum öffnet
- **THEN** zeigen Zeitachse und Druck dieselbe Menge wie beim Absender

### Requirement: Filterband über der Erfassung
Ist ein Filtermerkmal gesetzt (Typ, Zeitraum, Einheit, Volltext, ohne System), SHALL direkt über der
Erfassung auf jeder Breite ein Band in der Achtungsfläche stehen: das Wort „Gefiltert“, „n von m
Einträgen sichtbar“, die Merkmale kurz und „Filter zurücksetzen“. n und m MUST aus der Serverzählung
stammen; fehlt eine, steht keine Zahl. Ohne Filter MUST das Band fehlen und keinen Platz belegen.

#### Scenario: Zeitraum gesetzt
- **WHEN** „Letzte Stunde“ gilt und 7 von 134 Einträgen dazu passen
- **THEN** steht über der Erfassung „Gefiltert · 7 von 134 Einträgen sichtbar · seit 1345“ mit „Filter zurücksetzen“

#### Scenario: Zurücksetzen
- **WHEN** „Filter zurücksetzen“ gewählt wird
- **THEN** sind alle Filtermerkmale aus der Adresse entfernt, die Felder geleert, und das Band ist fort

#### Scenario: Zählung fehlt
- **WHEN** die Zählung noch lädt
- **THEN** steht „Gefiltert“ mit den Merkmalen, aber keine Zahl, auch keine aus dem geladenen Fenster

### Requirement: Eigener Eintrag außerhalb des Filters
Nimmt der Server einen eben erfassten Eintrag an, der nicht zum aktiven Filter passt, SHALL das
Filterband einmalig „Nr. n erfasst – außerhalb des Filters · anzeigen“ zeigen. „anzeigen“ MUST den
Filter zurücksetzen und auf den Eintrag springen.

#### Scenario: Anordnung unter Typfilter Meldung
- **WHEN** unter dem Typfilter „Meldung“ eine Anordnung Nr. 135 erfasst wird
- **THEN** nennt das Band „Nr. 135 erfasst – außerhalb des Filters · anzeigen“, und „anzeigen“ zeigt Nr. 135 hervorgehoben ohne Filter

### Requirement: Nachträge vor der Lagebesprechung
Gilt der Zeitraum „Seit letzter Lagebesprechung“ und gibt es Einträge, die nach der Besprechung
erfasst wurden, aber eine frühere Ereigniszeit tragen, SHALL das Filterband ihre Zahl nennen
(„+n Nachträge vor <Uhrzeit> erfasst · anzeigen“). „anzeigen“ MUST einen Zeitraum wählen, der sie
einschließt.

#### Scenario: Nachtrag
- **WHEN** die Lagebesprechung um 13:30 war und um 13:40 ein Eintrag mit Ereigniszeit 13:20 erfasst wurde
- **THEN** nennt das Band „+1 Nachtrag vor 1330 erfasst · anzeigen“
