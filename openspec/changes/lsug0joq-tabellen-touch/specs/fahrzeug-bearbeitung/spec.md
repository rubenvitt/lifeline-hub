# Spec Delta

## ADDED Requirements

### Requirement: Typ eines Fahrzeugs in der Liste

Die Fahrzeugliste SHALL den Typ jedes Fahrzeugs in jeder Breite sichtbar zeigen. Ab `xxl` MUST er
in einer eigenen, sortier- und filterbaren Spalte stehen. Darunter MUST er als gedämpfte zweite
Zeile unter dem Funkrufnamen stehen, in der Tabelle und in der Karte, mit und ohne Freigabe des
Moduls Einheiten. Ein Fahrzeug ohne Typ MUST keine leere zweite Zeile tragen. Die Suche MUST den
Typ weiter treffen.

#### Scenario: KTW am Fükw
- **WHEN** die Fahrzeugliste bei 1440 px den „KTW 85-2“ vom Typ „KTW“ zeigt
- **THEN** steht unter „KTW 85-2“ in der Kennungszelle „KTW“

#### Scenario: Breiter Schirm
- **WHEN** dieselbe Liste bei 1920 px geöffnet wird
- **THEN** steht der Typ in der Spalte „Typ“ und nicht zusätzlich unter dem Funkrufnamen

#### Scenario: Karte mit Freigabe Einheiten
- **WHEN** die Fahrzeugliste bei 390 px als Karte steht und das Modul Einheiten freigegeben ist
- **THEN** steht der Typ unter dem Funkrufnamen der Karte

#### Scenario: Suche nach Typ
- **WHEN** bei 1440 px „KTW“ ins Suchfeld getippt wird
- **THEN** zeigt die Liste die Fahrzeuge vom Typ KTW
