# Spec Delta

## MODIFIED Requirements

### Requirement: DWD-Warnungen für den Einsatzort

Das System SHALL die Wetterwarnungen des Deutschen Wetterdienstes für die Warnzelle
(Gemeinde) liefern, in der der Einsatzort liegt. Die Seite zeigt den Namen dieser Gemeinde.
Eine Warnung MUST nur erscheinen, solange ihr Ende nicht verstrichen ist. Das gilt auch, wenn
die Liste aus einem älteren Stand stammt. Warnungen, deren Beginn noch aussteht, MUST als
„angekündigt“ getrennt von denen erscheinen, die jetzt gelten.

Je Warnung zeigt die Seite:

- die Warnstufe mit der amtlichen Bezeichnung;
- das Ereignis;
- Beginn und Ende;
- die Überschrift;
- auf Wunsch die Beschreibung und die Handlungsempfehlung.

Die vier Stufen und ihre Bezeichnungen sind:

| Stufe | Bezeichnung |
|---|---|
| gering | Wetterwarnung |
| mäßig | Markantes Wetter |
| schwer | Unwetterwarnung |
| extrem | Extremes Unwetter |

#### Scenario: Warnung gilt jetzt
- **WHEN** für die Warnzelle des Einsatzorts eine Sturmböen-Warnung der Stufe „mäßig“ gilt, die vor einer Stunde begann und in zwei Stunden endet
- **THEN** steht sie unter „gilt jetzt“ mit der Bezeichnung „Markantes Wetter“, dem Ereignis und ihrem Ende

#### Scenario: Angekündigte Warnung
- **WHEN** eine Warnung erst in drei Stunden beginnt
- **THEN** steht sie unter „angekündigt“ mit ihrem Beginn

#### Scenario: Abgelaufene Warnung aus altem Stand
- **WHEN** der ausgelieferte Stand eine Warnung enthält, deren Ende verstrichen ist
- **THEN** erscheint diese Warnung nicht

#### Scenario: Keine Warnung
- **WHEN** für die Warnzelle keine gültige Warnung vorliegt und der Stand aktuell ist
- **THEN** zeigt die Seite „keine gültigen Warnungen“ mit dem Gemeindenamen und dem Datenstand

#### Scenario: Kein Einsatzort
- **WHEN** der Einsatz keine Koordinate des Einsatzorts hat
- **THEN** liefert der Endpunkt den Zustand „kein Ort“ ohne Abruf bei der Quelle
- **AND** die Seite erklärt einmal über den Paneelen, dass Warnungen, Vorhersage und aktuelle Bedingungen einen verorteten Einsatzort brauchen, mit dem Knopf „Einsatzort in den Einsatzdaten verorten“
- **AND** die Paneele Warnungen, Vorhersage und Aktuelle Bedingungen nennen nur „ohne Einsatzort“, ohne eigenen Knopf

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
- die Wetterlage als Wort mit Icon (klar, teils bewölkt, bewölkt, Nebel, windig, Regen,
  Schneeregen, Schnee, Hagel, Gewitter); bei klar, teils bewölkt und Nebel unterscheidet das
  Icon Tag und Nacht;
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
- **THEN** zeigt die Wetterlage „Nebel“ mit dem Nacht-Icon, nicht mit der Sonne

#### Scenario: Unbekannte Wetterlage
- **WHEN** die Quelle eine Wetterlage meldet, die das System nicht kennt
- **THEN** steht bei der Wetterlage ein Strich ohne Icon
- **AND** die übrigen Werte der Messung stehen unverändert

#### Scenario: Kein Einsatzort
- **WHEN** der Einsatz keine Koordinate des Einsatzorts hat
- **THEN** liefert der Endpunkt für die aktuellen Bedingungen den Zustand „kein Ort“ ohne Abruf bei der Quelle
- **AND** das Paneel nennt nur „ohne Einsatzort“; erklärt wird einmal auf der Seite (siehe „DWD-Warnungen für den Einsatzort“, Szenario „Kein Einsatzort“)

#### Scenario: Ausfall reißt die anderen Teile nicht mit
- **WHEN** die Quelle für die aktuellen Bedingungen nicht antwortet und nichts zwischengespeichert ist, Warnungen und Vorhersage aber vorliegen
- **THEN** zeigt das Paneel „Aktuelle Bedingungen“ „Stand unbekannt“ und keinen Wert
- **AND** Warnungen und Vorhersage zeigen ihre Inhalte unverändert
