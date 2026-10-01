# lage-wetter-pegel Specification

## Purpose
Die Führung sieht auf einer Lage-Seite, was Wasser und Wetter am Einsatzort gerade tun und
tun werden. Dazu gehören die maßgeblichen Pegel mit Verlauf, die gültigen amtlichen
Wetterwarnungen für den Einsatzort und eine Vorhersage für die nächsten 24 Stunden. Jede
Angabe trägt dabei ehrlich ihren Datenstand.

## Requirements

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

Das System SHALL für den Einsatzort eine Vorhersage der nächsten 24 Stunden liefern, und
zwar stündlich. Die Seite MUST sie im 3-Stunden-Takt von der laufenden Stunde an zeigen, das
sind acht Zeilen. Je gezeigter Stunde stehen:

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
- **THEN** zeigt die Seite die Werte der nächsten 24 Stunden im 3-Stunden-Takt mit dem Hinweis „Station Bremen, 4,2 km“

#### Scenario: Fehlender Einzelwert
- **WHEN** die Quelle für eine Stunde keine Niederschlagswahrscheinlichkeit liefert
- **THEN** steht dort ein Strich statt „0 %“

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

### Requirement: Unwetterwarnung im Modulzähler

Das Modulpanel SHALL am Modul „Wetter & Pegel“ die Zahl der gültigen Warnungen der Stufen
„schwer“ und „extrem“ für den Einsatzort zeigen, gezählt über „gilt jetzt“ und „angekündigt“.
Warnungen der Stufen „gering“ und „mäßig“ MUST NOT zählen. Der Zähler MUST seine Bedeutung als
zweiten Kanal tragen (Tooltip, zugänglicher Name) und neutral bleiben wie jeder Modulzähler. Er
erscheint nur, wenn das Modul für die Person sichtbar und frei ist.

#### Scenario: Zwei Unwetterwarnungen
- **WHEN** für den Einsatzort eine Warnung „schwer“ gilt, eine Warnung „extrem“ angekündigt ist und eine Warnung „mäßig“ gilt
- **THEN** zeigt das Modul „Wetter & Pegel“ die Zahl 2, und sein zugänglicher Name nennt „2 Unwetterwarnungen für den Einsatzort, davon 1 angekündigt“

#### Scenario: Nur markantes Wetter
- **WHEN** für den Einsatzort nur Warnungen der Stufen „gering“ und „mäßig“ gelten
- **THEN** zeigt das Modul keine Zahl

#### Scenario: Stand unbekannt
- **WHEN** der Warnstand „Stand unbekannt“ ist oder der Einsatz keinen Einsatzort hat
- **THEN** zeigt das Modul keine Zahl, auch nicht 0

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul für die Person ausgeblendet oder gesperrt ist
- **THEN** zeigt der Rahmen keinen Zähler und fragt den Wetter-Endpunkt nicht ab

### Requirement: Hinweis bei neuer Unwetterwarnung

Erscheint für den Einsatzort eine neue Warnung der Stufe „schwer“ oder „extrem“, gilt sie jetzt
oder ist sie angekündigt, SHALL die Oberfläche genau einen Hinweis in der AlarmZentrale zeigen.
Der Hinweis nennt Stufenbezeichnung, Ereignis und Zeitraum und springt zur Modulseite. Er MUST dem
Budget der AlarmZentrale unterliegen (höchstens drei sichtbar, der Rest gebündelt), quittierbar
sein, einen dezenten Ton spielen (stummschaltbar) und darf nicht blinken.

#### Scenario: Unwetter angekündigt
- **WHEN** für den Einsatzort erstmals eine Warnung „SCHWERES GEWITTER“ der Stufe „schwer“ ab 17:00 bis 20:00 erscheint
- **THEN** erscheint ein Hinweis „Unwetterwarnung“ mit „Schweres Gewitter, ab 17:00 · bis 20:00“ und einem Sprung zur Modulseite

#### Scenario: Markantes Wetter alarmiert nicht
- **WHEN** eine neue Warnung der Stufe „mäßig“ erscheint
- **THEN** entsteht kein Hinweis

#### Scenario: Ein Platz im Budget
- **WHEN** nacheinander zwei verschiedene Unwetterwarnungen neu erscheinen, ohne dass der erste Hinweis geschlossen wurde
- **THEN** ist in der AlarmZentrale höchstens ein Unwetterhinweis sichtbar, und er nennt die zuletzt erkannte Warnung

### Requirement: Kein Doppelalarm bei Unwetterwarnungen

Eine Unwetterwarnung MUST als neu gelten, wenn das Paar aus Ereignis und Stufe in den letzten 6
Stunden in diesem Browser für diese Person und diesen Einsatz nicht gemeldet wurde und ihre Stufe nicht unter
der höchsten in dieser Zeit gemeldeten liegt. Eine Aktualisierung derselben Warnung, ein
Neuladen der Seite und eine Herabstufung MUST NOT einen weiteren Hinweis auslösen. Ein Stand
„Stand unbekannt“ MUST NOT einen Hinweis auslösen.

#### Scenario: Erstes Öffnen bei gültiger Unwetterwarnung
- **WHEN** eine Person den Einsatz in diesem Browser öffnet, während eine Unwetterwarnung gilt, die ihr noch nicht gemeldet wurde
- **THEN** entsteht genau ein Hinweis

#### Scenario: Aktualisierte Warnung
- **WHEN** der DWD eine gemeldete Warnung mit neuem Ende neu ausgibt und Ereignis und Stufe gleich bleiben
- **THEN** entsteht kein weiterer Hinweis

#### Scenario: Neu geladen
- **WHEN** die Person die Seite neu lädt, während die gemeldete Warnung weiter gilt
- **THEN** entsteht kein weiterer Hinweis

#### Scenario: Hochstufung
- **WHEN** nach einer gemeldeten Warnung der Stufe „schwer“ eine Warnung der Stufe „extrem“ erscheint
- **THEN** entsteht ein neuer Hinweis „Extremes Unwetter“

#### Scenario: Herabstufung
- **WHEN** eine gemeldete Warnung der Stufe „extrem“ durch eine Warnung der Stufe „schwer“ ersetzt wird
- **THEN** entsteht kein Hinweis, und der Modulzähler zählt die neue Warnung

#### Scenario: Wiederkehr nach Ruhe
- **WHEN** ein Paar aus Ereignis und Stufe zuletzt vor mehr als 6 Stunden gesehen wurde und wieder erscheint
- **THEN** entsteht ein Hinweis

### Requirement: Marke für angekündigtes Unwetter im Überblick

Der Überblick SHALL jede angekündigte Warnung der Stufe „schwer“ oder „extrem“ als Marke unter
„Nächste Marken“ zum Zeitpunkt ihres Beginns führen. Die Marke nennt Stufenbezeichnung und
Ereignis und springt zur Modulseite. Sie MUST verschwinden, sobald die Warnung gilt, und wird nie
„überfällig“. Ohne sichtbares und freies Modul gibt es keine Unwettermarke.

#### Scenario: Angekündigtes Unwetter
- **WHEN** eine Warnung „ORKANBÖEN“ der Stufe „schwer“ in 2 Stunden beginnt
- **THEN** zeigt der Überblick eine Marke „Unwetterwarnung: Orkanböen“ zur Beginnzeit mit dem Wort „in 2 h 00 min“

#### Scenario: Warnung beginnt
- **WHEN** der Beginn einer markierten Unwetterwarnung erreicht ist
- **THEN** verschwindet die Marke, und der Modulzähler zählt die Warnung weiter
