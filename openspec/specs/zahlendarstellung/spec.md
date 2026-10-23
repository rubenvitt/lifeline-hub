# zahlendarstellung Specification

## Purpose
Legt fest, wie Dezimalzahlen in der Oberfläche erscheinen und eingegeben werden: deutsch, mit
Dezimalkomma, damit „1.20 km“ niemand als 1.200 liest (LLH-1146).

## Requirements

### Requirement: Dezimalzahlen mit Komma
Angezeigte Dezimalzahlen SHALL deutsch geschrieben werden: Dezimalkomma, Tausenderpunkt und das
Minuszeichen „−“. Koordinaten sowie Werte in Adressen und Schnittstellen MUST mit Punkt bleiben.

#### Scenario: Entfernung in der Ort-Zeile
- **WHEN** ein Ort 1200 m vom Einsatzort entfernt liegt
- **THEN** nennt die Ort-Zeile „1,20 km NO von Einsatzort“

#### Scenario: Dateigröße
- **WHEN** ein Anhang 1,5 MiB groß ist
- **THEN** steht an ihm „1,5 MB“

#### Scenario: Koordinate bleibt mit Punkt
- **WHEN** eine Koordinate im Format WGS84 dezimal erscheint
- **THEN** steht sie als „52.37580, 9.73201“

### Requirement: Eingabe von Dezimalzahlen
Ein Feld für eine Dezimalzahl SHALL den Wert mit Komma zeigen und Komma wie Punkt als
Dezimaltrenner annehmen.

#### Scenario: Komma und Punkt
- **WHEN** jemand in „Erwarteter Höchststand (m)“ „7,5“ oder „7.5“ einträgt
- **THEN** gilt 7,5 m, und das Feld zeigt „7,50“
