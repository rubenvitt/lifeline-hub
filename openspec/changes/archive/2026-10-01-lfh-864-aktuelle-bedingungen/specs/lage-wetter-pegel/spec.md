# Spec Delta

## ADDED Requirements

### Requirement: Aktuelle Bedingungen am Einsatzort

Das System SHALL auf der Modulseite die zuletzt gemessenen Wetterwerte von DWD-Wetterstationen
nahe dem Einsatzort zeigen. Dazu gehören Messzeit, Station und deren Entfernung. Als Station
der Messung MUST die Station gelten, von der die meisten gezeigten Werte stammen; bei
Gleichstand die Station, die die Quelle nennt, sonst die nähere. Gemessen heißt beobachtet,
nicht vorhergesagt. Ein Wert, den die Quelle nicht liefert, MUST als fehlend erscheinen und
nicht als 0. Stammt ein Wert aus einer anderen als der Station der Messung, MUST die Seite
diese Station mit Entfernung bei dem Wert nennen.

Je Messung zeigt die Seite:

- Temperatur in °C;
- mittleren Wind in km/h mit Richtung und die stärkste Böe der letzten Stunde in km/h;
- Niederschlag der letzten Stunde in mm;
- die Wetterlage als Wort mit Ikone (klar, teils bewölkt, bewölkt, Nebel, windig, Regen,
  Schneeregen, Schnee, Hagel, Gewitter); bei klar, teils bewölkt und Nebel unterscheidet die
  Ikone Tag und Nacht;
- Sicht, Bewölkung in %, relative Luftfeuchte in %, Taupunkt in °C, Luftdruck in hPa.

Die Seite MUST den Quellenvermerk „Datenbasis: Deutscher Wetterdienst“ tragen.

#### Scenario: Messung einer Station
- **WHEN** die Quelle für den Einsatzort eine Messung der Station „Bremen“ in 3,9 km Entfernung von 08:00 Uhr liefert, mit 15,3 °C, Wind aus Südost mit 11 km/h und Böen bis 17 km/h
- **THEN** zeigt das Paneel „Aktuelle Bedingungen“ diese Werte mit „Station Bremen, 3,9 km“ und der Messzeit 08:00

#### Scenario: Wert aus einer anderen Station ergänzt
- **WHEN** die Station der Messung keine Windmessung hat und die Quelle Wind und Böen aus der Station „Hameln“ in 12,1 km Entfernung ergänzt
- **THEN** stehen Wind und Böen mit dem Hinweis „Station Hameln, 12,1 km“
- **AND** die übrigen Werte stehen ohne diesen Hinweis bei der Station der Messung

#### Scenario: Genannte Station ohne eigenen Wert
- **WHEN** die Quelle die Station „Bremen (Buergerpark)“ in 2,5 km Entfernung nennt, jeder gezeigte Wert aber aus der Station „Bremen“ in 3,9 km Entfernung stammt
- **THEN** steht im Kopf „Station Bremen, 3,9 km“
- **AND** kein Wert trägt einen Hinweis auf eine andere Station

#### Scenario: Fehlender Messwert
- **WHEN** die Quelle für die Messung keine Sicht liefert
- **THEN** steht bei der Sicht ein Strich statt „0 km“

#### Scenario: Nebel bei Nacht
- **WHEN** die Quelle um 02:00 Uhr Ortszeit für eine Station in Bremen Nebel meldet
- **THEN** zeigt die Wetterlage „Nebel“ mit der Nacht-Ikone, nicht mit der Sonne

#### Scenario: Unbekannte Wetterlage
- **WHEN** die Quelle eine Wetterlage meldet, die das System nicht kennt
- **THEN** steht bei der Wetterlage ein Strich ohne Ikone
- **AND** die übrigen Werte der Messung stehen unverändert

#### Scenario: Kein Einsatzort
- **WHEN** der Einsatz keine Koordinate des Einsatzorts hat
- **THEN** liefert der Endpunkt für die aktuellen Bedingungen den Zustand „kein Ort“ ohne Abruf bei der Quelle
- **AND** das Paneel erklärt, dass es einen verorteten Einsatzort braucht

#### Scenario: Ausfall reißt die anderen Teile nicht mit
- **WHEN** die Quelle für die aktuellen Bedingungen nicht antwortet und nichts zwischengespeichert ist, Warnungen und Vorhersage aber vorliegen
- **THEN** zeigt das Paneel „Aktuelle Bedingungen“ „Stand unbekannt“ und keinen Wert
- **AND** Warnungen und Vorhersage zeigen ihre Inhalte unverändert

## MODIFIED Requirements

### Requirement: Datenstand und Quellausfall

Pegel, Warnungen, Vorhersage und aktuelle Bedingungen MUST je ihren eigenen Datenstand tragen.
Beim Pegel ist das der Zeitpunkt der jüngsten Messung, bei den aktuellen Bedingungen die
Messzeit der Station. Bei Warnungen und Vorhersage ist es der Zeitpunkt des letzten
erfolgreichen Abrufs.

Das System MUST einen alten Stand kennzeichnen statt ihn als aktuell auszugeben:

| Teil | „veraltet“ ab | „Stand unbekannt“ ab |
|---|---|---|
| Pegel | 60 min | — |
| Warnungen | 30 min | 6 h |
| Vorhersage | 3 h | 12 h |
| Aktuelle Bedingungen | 90 min nach der Messzeit | 3 h nach der Messzeit |

„veraltet“ heißt: Wort und Zeitpunkt stehen neben dem Stand. „Stand unbekannt“ heißt: der
Teil erscheint ohne Inhalt.

Liegt für einen Teil kein verwertbarer Stand vor, MUST die Seite für diesen Teil
„Stand unbekannt“ zeigen. Das gilt, wenn die Quelle nicht antwortet und nichts
zwischengespeichert ist oder der Stand die Obergrenze überschreitet. Die Seite zeigt dann
keinen Wert und keine Liste. Der Ausfall eines Teils MUST die anderen Teile unberührt lassen.

#### Scenario: Warnquelle fällt aus ohne Zwischenstand
- **WHEN** die Wetterquelle nicht antwortet und für den Einsatzort nichts zwischengespeichert ist
- **THEN** zeigt der Warnbereich „Stand unbekannt“ und keine Liste
- **AND** der Pegelbereich zeigt seine Werte unverändert

#### Scenario: Alter Warnstand
- **WHEN** der letzte erfolgreiche Warnabruf 45 Minuten zurückliegt
- **THEN** zeigt die Seite die Warnungen mit „veraltet“ und der Abrufzeit

#### Scenario: Zu alter Warnstand
- **WHEN** der letzte erfolgreiche Warnabruf sieben Stunden zurückliegt
- **THEN** zeigt der Warnbereich „Stand unbekannt“ und keine Liste

#### Scenario: Pegel ohne Messung
- **WHEN** für einen festgelegten Pegel weder ein Abruf gelingt noch ein Stand vorliegt
- **THEN** zeigt die Zeile „—“ und „Stand unbekannt“ und keinen Verlauf

#### Scenario: Alte Messung der Station
- **WHEN** die jüngste Messung der Station zwei Stunden alt ist, obwohl der Abruf gerade gelang
- **THEN** zeigt das Paneel „Aktuelle Bedingungen“ die Werte mit „veraltet“ und der Messzeit

#### Scenario: Zu alte Messung der Station
- **WHEN** die jüngste Messung der Station vier Stunden alt ist
- **THEN** zeigt das Paneel „Aktuelle Bedingungen“ „Stand unbekannt“ und keinen Wert
