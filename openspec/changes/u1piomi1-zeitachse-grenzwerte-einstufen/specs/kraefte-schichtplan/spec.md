## MODIFIED Requirements

### Requirement: Prüfbefunde
Das Lesen des Plans MUST je Block und Person Befunde liefern, ohne Schreiben zu blockieren:
- `doppelt`: eine Person in zwei Blöcken mit überschneidender Zeit.
- `quali`: geforderte Qualifikationen, die die freien Plätze nicht mehr aufnehmen können
  (Deckungsregel `qualifikationen`). Vorher sind sie Teil der Lücke.
- `dienst`: eine Dienststrecke länger als der Höchstwert, wobei Lücken unter der Mindestruhe und
  Pausen die Strecke nicht trennen.
- `verfuegbar`: die Person ist außer Dienst oder entlassen, oder der Posten ist aufgelöst.
- `abweichung`: ab Blockbeginn plus 10 Minuten bis Blockende ist eine eingeteilte Person nicht am
  Posten.

Der Dienst-Befund liest nur Planblöcke. Das Ist der Kräfte-Zeitachse stuft dieselbe Regel gegen
dieselben Grenzwerte ein (Capability `kraefte-zeitachse`, „Einstufung gegen die Grenzwerte des
Einsatzes“); ein Befund des Plans entsteht daraus nicht.

#### Scenario: Doppelt
- **WHEN** Anna in Streife 2 14:00–16:00 und an der UHS 15:00–19:00 steht
- **THEN** tragen beide Blöcke den Befund „doppelt“ für Anna

#### Scenario: Lücke statt Befund
- **WHEN** ein Block Soll 3 mit „mind. 1 Rettungssanitäter“ hat und zwei Sanitäter eingeteilt sind
- **THEN** meldet der Block „1 Platz offen, braucht Rettungssanitäter“ und keinen Befund „quali“

#### Scenario: Qualifikation fehlt
- **WHEN** ein Block Soll 2 mit „mind. 1 Rettungssanitäter“ hat und zwei Sanitäter eingeteilt sind
- **THEN** meldet der Block den Befund „quali“ für 1 Rettungssanitäter

#### Scenario: Zu lange ohne Ruhe
- **WHEN** die Werte 12 h / 8 h gelten und Anna 08:00–14:00 und 16:00–22:00 steht
- **THEN** meldet der Plan für Anna „dienst“ (14 h ohne 8 h Ruhe)

#### Scenario: Genug Ruhe
- **WHEN** die Werte 12 h / 8 h gelten und Anna 06:00–12:00 und 20:00–02:00 steht
- **THEN** meldet der Plan für Anna keinen Befund „dienst“

#### Scenario: Plan gegen Ist
- **WHEN** Ben ab 14:00 an der Streife 2 eingeteilt ist und um 14:15 noch dem RTW 1 zugeordnet ist
- **THEN** meldet der Block „abweichung“ für Ben; um 14:05 noch nicht

### Requirement: Grenzwerte des Einsatzes
Ein Einsatz SHALL einen Höchstwert für den Dienst (60 bis 1440 Minuten) und eine Mindestruhe (0
bis 1440 Minuten) tragen. Ohne eigenen Wert MUST 12 Stunden bzw. 8 Stunden gelten. Eine Änderung
MUST einen ETB-Systemsatz schreiben. Dieselben wirksamen Werte MUST auch die Einstufung der
Kräfte-Zeitachse lesen; es gibt keine zweite Einstellung.

#### Scenario: Vorgabe ohne eigenen Wert
- **WHEN** ein Einsatz keinen eigenen Höchstwert und keine eigene Mindestruhe setzt
- **THEN** gelten 12 h und 8 h im Plan und in der Einstufung der Kräfte-Zeitachse

#### Scenario: Eigener Wert gilt für Plan und Ist
- **WHEN** jemand den Höchstwert des Einsatzes auf 10 h setzt
- **THEN** entsteht ein ETB-Systemsatz, und Plan-Befund `dienst` und Einstufung der Kräfte-Zeitachse prüfen gegen 10 h
