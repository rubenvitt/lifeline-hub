# Spec Delta

## ADDED Requirements

### Requirement: Typ eines Fahrzeugs in der Liste

Die Fahrzeugliste SHALL den Typ jedes Fahrzeugs in jeder Breite sichtbar zeigen, genau an einer
Stelle: Steht die sortier- und filterbare Spalte „Typ“ in der Tabelle (Vorgabe ab `xxl`, sonst
per Hand), MUST er dort stehen; sonst und in der Karte MUST er als gedämpfte zweite Zeile unter
dem Funkrufnamen stehen. Ein Fahrzeug ohne Typ MUST keine leere zweite Zeile tragen. Die Suche
MUST den Typ weiter treffen.

#### Scenario: KTW am Fükw
- **WHEN** die Fahrzeugliste bei 1440 px den „KTW 85-2“ vom Typ „KTW“ zeigt
- **THEN** steht unter „KTW 85-2“ in der Kennungszelle „KTW“

#### Scenario: Breiter Schirm
- **WHEN** dieselbe Liste bei 1920 px geöffnet wird
- **THEN** steht der Typ in der Spalte „Typ“ und nicht zusätzlich unter dem Funkrufnamen

#### Scenario: Unter xxl von Hand eingeblendet
- **WHEN** bei 1440 px die Spalte „Typ“ im Spaltenschalter eingeblendet wird
- **THEN** steht „KTW“ in der Spalte „Typ“ und nicht mehr unter „KTW 85-2“

#### Scenario: Ab xxl von Hand abgewählt
- **WHEN** bei 1920 px die Spalte „Typ“ im Spaltenschalter abgewählt wird
- **THEN** steht „KTW“ wieder unter „KTW 85-2“

#### Scenario: Karte mit Freigabe Einheiten
- **WHEN** die Fahrzeugliste bei 390 px als Karte steht und das Modul Einheiten freigegeben ist
- **THEN** steht der Typ unter dem Funkrufnamen der Karte

#### Scenario: Suche nach Typ
- **WHEN** bei 1440 px „KTW“ ins Suchfeld getippt wird
- **THEN** zeigt die Liste die Fahrzeuge vom Typ KTW
