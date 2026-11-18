## MODIFIED Requirements

### Requirement: Grundbausteine liegen als Karte vor

Das Design System SHALL für die Grundformen jeder Seite eine Karte aus dem echten Baustein der App
zeigen: Knopf, Eingabefeld, Dialog, Zustände (Laden, Leer, Fehler), Hinweis, Seitenkopf,
Formularlayout, vollständige Tabelle und die Navigation im Einsatz (Kategorie-Rail und
Modulpanel). Eine Form, die die UI-Form-Leitlinie zurückdrängt (der Drawer außerhalb der
Navigation), MUST NOT eine eigene Karte bekommen.

#### Scenario: Entwurf einer neuen Seite
- **WHEN** ein `/design`-Agent eine Seite mit Kopf, Formular und leerem Zustand entwirft
- **THEN** findet er für jede dieser Formen eine Karte mit dem Baustein der App, in Nacht und Tag

#### Scenario: Entwurf eines neuen Moduls im Einsatzrahmen
- **WHEN** ein `/design`-Agent ein Modul mit Rail und Modulpanel daneben entwirft
- **THEN** findet er die Karte `Navigation` mit Rail und offenem Modulpanel aus den Bausteinen der
  App, in fester Höhe unabhängig vom Fenster des Betrachters, in Nacht und Tag

#### Scenario: Karte bleibt bei jedem Lauf gleich
- **WHEN** der Generator die Karte `Navigation` zweimal zu verschiedenen Zeiten erzeugt
- **THEN** sind beide Ergebnisse bytegleich, auch im Fuß „Einsatzdauer“
