# personen-verletzungen Specification

## Purpose
Verletzungen einer Person als auswertbarer Datensatz am Körperschema: wo (Ansicht, Region, Lage),
was (Art, Schwere) und wann, nur anhängend und genau einmal aufhebbar. Patientenansicht, UHS-Gerät
und eine spätere Sichtungs-App schreiben dasselbe.

## Requirements

### Requirement: Verletzung markieren

Wer im Einsatz Schreibrecht auf das Modul Personen hat, SHALL an einer angetroffenen Person eine
Verletzung erfassen können. Sie MUST enthalten:
- die Ansicht `vorn` oder `hinten`;
- eine Region aus dem festen Katalog `kopf`, `gesicht`, `hals`, `thorax`, `abdomen`, `becken`,
  `ruecken`, `wirbelsaeule`, `gesaess` und je `_l`/`_r` für `oberarm`, `unterarm`, `hand`,
  `oberschenkel`, `unterschenkel`, `fuss` (Seiten aus Sicht des Patienten);
- eine Art aus dem festen Katalog `wunde_blutung`, `fraktur_verdacht`, `verbrennung`,
  `prellung_schwellung`, `amputation`, `schmerz`, `sonstige`.

Optional MUST sie annehmen: eine Schwere `leicht`, `mittel` oder `schwer`, eine Lage `x`/`y`
(je 0 bis 1, normiert auf die Ansicht) und eine kurze Notiz mit fester Höchstlänge.

Der Server MUST einen unbekannten Katalogwert oder eine Lage außerhalb 0 bis 1 mit 400 ablehnen.
Eine Region, die es in der Ansicht nicht gibt, MUST er mit 422 ablehnen: `ruecken`,
`wirbelsaeule` und `gesaess` gibt es nur hinten, `gesicht`, `thorax`, `abdomen` und `becken` nur
vorn. Eine stornierte Person MUST 409 ergeben, eine vermisste oder abgemeldete 422.

#### Scenario: Fraktur-Verdacht am Unterarm
- **WHEN** jemand mit Schreibrecht an R-007 „Unterarm links, vorn“ mit Art „Fraktur-Verdacht“
  erfasst
- **THEN** liefert das Detail von R-007 die Verletzung mit Ansicht, Region, Art, Zeitpunkt und
  Erfasser

#### Scenario: Rücken vorn
- **WHEN** eine Verletzung mit Ansicht `vorn` und Region `ruecken` geschickt wird
- **THEN** antwortet der Server mit 422 und speichert nichts

#### Scenario: Unbekannte Art
- **WHEN** eine Verletzung mit Art `biss` geschickt wird
- **THEN** antwortet der Server mit 400

### Requirement: Verletzung aufheben statt löschen

Eine Verletzung SHALL sich genau einmal aufheben lassen. Das Aufheben MUST Zeitpunkt und
Aufhebenden speichern und die Zeile behalten. Ein zweites Aufheben MUST 409 ergeben, auch wenn zwei
Anfragen gleichzeitig ankommen. Das Detail MUST aufgehobene Verletzungen als solche liefern, damit
der Verlauf sie zeigt.

#### Scenario: Zweimal aufheben
- **WHEN** zwei Arbeitsplätze dieselbe Verletzung gleichzeitig aufheben
- **THEN** gelingt genau eines, das andere erhält 409
- **AND** die Verletzung steht im Detail als aufgehoben mit Zeitpunkt

### Requirement: Verletzungen bleiben aus ETB und Live-Kanal heraus

Das Erfassen und Aufheben einer Verletzung SHALL keinen ETB-Eintrag schreiben. Das Live-Ereignis
MUST nur Einsatz und Person nennen, keine Region, keine Art und keine Notiz.

#### Scenario: Leak-Probe
- **WHEN** eine Verletzung mit Notiz „offene Wunde“ erfasst wird
- **THEN** enthält weder das ETB noch ein Live-Ereignis die Region, die Art oder die Notiz

### Requirement: Verletzungen am UHS-Gerät

Ein Gerät mit UHS-Ansicht SHALL Verletzungen an Personen seiner UHS erfassen und aufheben können.
Eine Person einer fremden UHS MUST 404 ergeben. Ein Gerät mit Betreuungsstellen-Ansicht und der
Lagemonitor MUST 403 erhalten.

#### Scenario: Fremde UHS
- **WHEN** das Tablet der UHS Nord eine Verletzung an einer Person der UHS Süd erfasst
- **THEN** antwortet der Server mit 404

#### Scenario: Betreuungsstelle
- **WHEN** ein Gerät der Betreuungsstelle eine Verletzung erfasst
- **THEN** antwortet der Server mit 403
