# Spec Delta

## Purpose

Die Führung sieht auf einer Lage-Seite, was Wasser und Wetter am Einsatzort gerade tun und
tun werden. Dazu gehören die maßgeblichen Pegel mit Verlauf, die gültigen amtlichen
Wetterwarnungen für den Einsatzort und eine Vorhersage für die nächsten 24 Stunden. Jede
Angabe trägt dabei ehrlich ihren Datenstand.

## ADDED Requirements

### Requirement: Modul „Wetter & Pegel“

Das System SHALL ein Einsatzmodul „Wetter & Pegel“ mit Modul-Key `wetter-pegel` in der
Kategorie Lage führen, erreichbar unter `/einsaetze/{einsatzId}/wetter-pegel`. Das Modul MUST
ausblendbar sein wie jedes andere Fachmodul. Ist es für eine Person ausgeblendet oder
gesperrt, MUST der Wetter-Endpunkt ihr mit 403 antworten. Die Pegel-Endpunkte bleiben
modul-los, weil Dashboard und Überblick sie ebenfalls lesen.

#### Scenario: Modul erscheint unter Lage
- **WHEN** eine Person mit Lesezugriff das Modulpanel der Kategorie Lage öffnet
- **THEN** steht dort „Wetter & Pegel“ hinter „Gefahren“ und vor „Lagemeldungen“

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul `wetter-pegel` im Einsatz ausgeblendet ist und eine Person `GET /api/einsaetze/{id}/wetter` aufruft
- **THEN** antwortet das System mit 403
- **AND** `GET /api/einsaetze/{id}/pegel` antwortet weiterhin mit 200

#### Scenario: Fremder Einsatz
- **WHEN** eine Person den Wetter-Endpunkt eines Einsatzes einer anderen Organisation aufruft
- **THEN** antwortet das System mit 403, wie jeder Einsatz-Endpunkt an der Org-Grenze

#### Scenario: Unbekannter Einsatz
- **WHEN** eine Person den Wetter-Endpunkt eines Einsatzes aufruft, den es nicht gibt
- **THEN** antwortet das System mit 404

### Requirement: Pegel mit 24-h-Verlauf

Das System SHALL auf der Modulseite je maßgeblichem Pegel des Einsatzes, in dessen
Reihenfolge, anzeigen:

- Name und Gewässer;
- Wasserstand in Metern;
- Trend als Wort und in cm/h;
- Datenstand;
- den erwarteten Höchststand, solange er nicht verstrichen ist;
- den Verlauf der letzten 24 Stunden.

Für den Verlauf MUST das System je Pegel die Messreihe der letzten 24 Stunden liefern. Jeder
Punkt trägt Zeitpunkt und Wasserstand in cm. Die Punkte sind nach Zeit aufsteigend
geordnet. Eine Station ohne Stand liefert eine leere Reihe. Der Trend MUST weiterhin über die
letzten 60 Minuten gerechnet werden.

#### Scenario: Verlauf eines Pegels
- **WHEN** für einen festgelegten Pegel Messungen der letzten 24 Stunden vorliegen
- **THEN** zeigt die Seite dessen Verlauf als Linie mit dem niedrigsten und dem höchsten Wert des Zeitraums als Beschriftung

#### Scenario: Keine Pegel festgelegt
- **WHEN** der Einsatz keinen maßgeblichen Pegel hat
- **THEN** zeigt der Pegelbereich „kein Pegel festgelegt“ und einen Weg zu Einstellungen › Pegel

#### Scenario: Pflege bleibt in den Einstellungen
- **WHEN** eine Person auf der Modulseite Pegel festlegen oder eine Prognose ändern will
- **THEN** führt sie ein Verweis zu Einstellungen › Pegel, und die Modulseite selbst ändert nichts

#### Scenario: Verlauf eines fremden Einsatzes
- **WHEN** eine Person den Verlauf-Endpunkt eines Einsatzes einer anderen Organisation aufruft
- **THEN** antwortet das System mit 403, wie `GET …/pegel`

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
- **AND** die Seite erklärt, dass Warnungen und Vorhersage einen verorteten Einsatzort brauchen, und verweist auf die Einsatzdaten

### Requirement: Wettervorhersage für den Einsatzort

Das System SHALL für den Einsatzort eine Vorhersage der nächsten 24 Stunden liefern und
zeigen. Die Seite zeigt je Stunde:

- Temperatur in °C;
- Niederschlag in mm;
- Niederschlagswahrscheinlichkeit in %;
- mittleren Wind und Böen in km/h;
- die Windrichtung.

Dazu nennt sie die Station, aus deren Vorhersage die Werte stammen, und deren Entfernung
zum Einsatzort. Ein Wert, den die Quelle nicht liefert, MUST als fehlend erscheinen und
nicht als 0. Die Seite MUST den Quellenvermerk „Datenbasis: Deutscher Wetterdienst“ tragen.

#### Scenario: Vorhersage mit Station
- **WHEN** die Quelle für den Einsatzort eine Vorhersage der Station „Bremen“ in 4,2 km Entfernung liefert
- **THEN** zeigt die Seite die Stundenwerte der nächsten 24 Stunden mit dem Hinweis „Station Bremen, 4,2 km“

#### Scenario: Fehlender Einzelwert
- **WHEN** die Quelle für eine Stunde keine Niederschlagswahrscheinlichkeit liefert
- **THEN** steht dort ein Strich statt „0 %“

### Requirement: Datenstand und Quellausfall

Pegel, Warnungen und Vorhersage MUST je ihren eigenen Datenstand tragen. Beim Pegel ist das
der Zeitpunkt der jüngsten Messung, bei Warnungen und Vorhersage der Zeitpunkt des letzten
erfolgreichen Abrufs.

Das System MUST einen alten Stand kennzeichnen statt ihn als aktuell auszugeben:

| Teil | „veraltet“ ab | „Stand unbekannt“ ab |
|---|---|---|
| Pegel | 60 min | — |
| Warnungen | 30 min | 6 h |
| Vorhersage | 3 h | 12 h |

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

### Requirement: Wege zur Modulseite

Die Pegel-Kennzahl im Lage-Dashboard und die Überblick-Marke „Erwarteter Höchststand“ MUST
auf die Modulseite führen, wenn das Modul für die Person sichtbar und frei ist. Sonst MUST
sie auf Einstellungen › Pegel führen.

#### Scenario: Modul sichtbar
- **WHEN** eine Person mit sichtbarem Modul die Pegel-Kennzahl im Lage-Dashboard aktiviert
- **THEN** öffnet sich `/einsaetze/{id}/wetter-pegel`

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul für die Person ausgeblendet ist und sie die Pegel-Kennzahl aktiviert
- **THEN** öffnet sich Einstellungen › Pegel
