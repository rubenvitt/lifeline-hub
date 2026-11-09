# Spec Delta

## MODIFIED Requirements

### Requirement: Treffflächen im Nur-Lese-Zweig

Bedienziele, die dem Beobachter bleiben, MUST die Trefffläche der Dichtestufe halten
(30 / 48 / 72 px). Dazu gehören gesperrte Primäraktionen, Lese-Links und die Ausgänge der
Karten. Ein Ziel, das der Nur-Lese-Zweig **versteckt**, MUST im Gate als abwesend zugesichert
werden, statt still aus der Messmenge zu fallen.

#### Scenario: Gesperrte Primäraktion
- **WHEN** der Beobachter die Ablösungsseite in `handschuh` öffnet
- **THEN** ist die Primäraktion sichtbar gesperrt und misst mindestens 72 px in der Höhe

#### Scenario: Versteckte Aktion
- **WHEN** der Beobachter die Fahrzeugliste öffnet
- **THEN** gibt es keinen Knopf „Ad-hoc-Fahrzeug“, und die übrigen Ziele der Seite halten die Stufe
