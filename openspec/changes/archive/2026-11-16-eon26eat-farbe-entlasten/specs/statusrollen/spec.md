# Spec Delta

## Purpose

Legt fest, was die Statusrollen bedeuten und welche Zustände welche Rolle tragen, damit Gelb und
Rot im Einsatz nur dort erscheinen, wo jemand handeln muss, und derselbe Zustand überall gleich
aussieht.

## ADDED Requirements

### Requirement: Gelb heißt, jemand muss bald handeln

Die Rolle `achtung` SHALL nur einen Zustand tragen, auf den jemand bald reagieren muss (etwa
Ablösung bald fällig, Rückruf offen, Verbleib offen, unterbesetzt, ohne Leiter, nicht beurteilt).
Ein Zustand des Normalbetriebs (eine Kraft ist unterwegs oder eingesetzt, ein Vorgang ist
eingegangen, ein Ablauf läuft planmäßig) MUST NOT `achtung` tragen. Die Rolle `alarm` bleibt
nach `farbrollen-kontrast` dem abnormen Zustand vorbehalten.

#### Scenario: Laufender Einsatz auf der Kräfte-Seite
- **WHEN** im laufenden Einsatz alle Fahrzeuge auf Anfahrt oder am Einsatzort stehen und eine
  Einheit unterbesetzt ist
- **THEN** ist nur „unterbesetzt“ gelb, die Fahrzeugstatus sind neutral

#### Scenario: Rückruf am Informationstelefon
- **WHEN** ein Anruf auf Rückruf wartet
- **THEN** trägt „Rückruf offen“ die Rolle `achtung`

### Requirement: „gebunden“ ist überall neutral

Die Statuskategorie „gebunden“ SHALL an jeder Stelle die Rolle `neutral` tragen: am Status eines
Fahrzeugs oder einer Kraft, in Meldebild, Kräfteübersicht, Überblick, FMS-Tableau, Kartenleiste,
Sprungpalette und Verdichtungszeile. Keine Stelle MUST „gebunden“ in einer anderen Rolle zeigen.

#### Scenario: Gebundene Fahrzeuge im Meldebild und im Überblick
- **WHEN** drei Fahrzeuge auf Anfahrt sind
- **THEN** zeigt die Verteilung im Meldebild „3 gebunden“ neutral
- **AND** der Überblick zeigt in der Abschnittskarte „gebunden“ in derselben Rolle

#### Scenario: Alarmierte Einsatzkraft
- **WHEN** eine Einsatzkraft den Status „alarmiert“ trägt
- **THEN** ist ihr Statusetikett neutral, nicht gelb

### Requirement: Sprechwunsch bleibt gelb

Ein Fahrzeugstatus mit FMS-Anker 5 (Sprechwunsch) oder 0 (Priorisierter Sprechwunsch) SHALL die
Rolle `achtung` tragen, unabhängig von seiner Kategorie, an jeder Stelle, die den einzelnen
Status eines Fahrzeugs zeigt. Ein Status ohne FMS-Anker MUST seine Rolle aus der Kategorie
nehmen. Zählungen nach Kategorie bleiben davon unberührt.

#### Scenario: Fahrzeug meldet Sprechwunsch
- **WHEN** ein Fahrzeug auf einen Status mit FMS-Anker 5 wechselt, dessen Kategorie „gebunden“ ist
- **THEN** zeigt die Fahrzeugliste, das Meldebild und das FMS-Tableau seinen Status gelb mit
  „S5“ und Wort

#### Scenario: Mandantenstatus ohne Anker
- **WHEN** ein Katalogstatus der Kategorie „gebunden“ keinen FMS-Anker hat
- **THEN** ist sein Etikett neutral

### Requirement: Der Eingang einer Meldung oder eines Auftrags ist neutral

Der Eingangszustand einer Meldung („Neu“) und eines Auftrags („Offen“) SHALL als neutrales
Etikett erscheinen. Die Karte MUST den Eingang weiter an einer leisen, neutralen Kante kenntlich
machen, damit er in der Liste auffindbar bleibt. Eine Priorität „dringend“ oder „sofort“ MUST
weiter gelb bzw. rot zeigen.

#### Scenario: Neue Meldung ohne Priorität
- **WHEN** eine Meldung mit Priorität „normal“ eingeht
- **THEN** trägt ihr Etikett „Neu“ die Rolle `neutral`, und ihre Karte hat eine neutrale Kante,
  die sich von der Kante einer bearbeiteten Karte unterscheidet

#### Scenario: Dringende neue Meldung
- **WHEN** eine Meldung mit Priorität „dringend“ eingeht
- **THEN** zeigt sie die Priorität gelb, obwohl ihr Eingangsetikett neutral ist
