# Spec Delta

## MODIFIED Requirements

### Requirement: Das Design System wird aus dem Code erzeugt

Ein Generator im Repo SHALL den vollständigen Inhalt des Design Systems aus dem Code erzeugen:
Farbtokens für Nacht und Tag aus den Farbrollen und Paletten der App, Schriftskala und Schriften,
Abstände je Dichtestufe, Radius, eine README und Vorschauen zentraler Bausteine. Kein Wert MUST von
Hand ins Design System geschrieben werden. Der Nachtbetrieb MUST das erste Thema sein. Die README
MUST die Gestaltungsregeln aus `frontend/AGENTS.md` wiedergeben, nicht eigene Regeln formulieren.
Sie MUST mit der Bausteinwahl aus `frontend/AGENTS.md` beginnen und MUST NOT Ticketnummern,
Spec- oder Herleitungsverweise und Regeln ohne Gestaltungsbezug enthalten; diese bleiben im Repo.

#### Scenario: Farbrolle geändert
- **WHEN** die Farbrolle `text2` im Nachtbetrieb in `theme/tokens.ts` einen neuen Wert bekommt und der Generator läuft
- **THEN** trägt das erzeugte `tokens.json` den neuen Wert unter dem Thema Nacht, und sonst ändert sich nichts

#### Scenario: Regel mit Ticketverweis
- **WHEN** eine Gestaltungsregel in `frontend/AGENTS.md` einen Ticketverweis wie „(LLH-1065)“ trägt und der Generator läuft
- **THEN** steht die Regel in der README ohne den Verweis, und der Satz bleibt vollständig

#### Scenario: Erster Abschnitt
- **WHEN** ein `/design`-Agent die README öffnet
- **THEN** ist der erste Regelabschnitt die Bausteinwahl mit Bedarf, Baustein und Karte

## ADDED Requirements

### Requirement: Bausteinwahl und Karten sind deckungsgleich

Jede Karte des Design Systems SHALL in der Bausteinwahl von `frontend/AGENTS.md` genannt sein, und
jede Karte, die die Bausteinwahl nennt, MUST im Design System existieren. Das Gate MUST rot werden,
wenn eines davon fehlt.

#### Scenario: Neue Karte ohne Bausteinwahl
- **WHEN** ein PR eine Karte ergänzt, die die Bausteinwahl nicht nennt
- **THEN** schlägt der Wächter fehl und nennt die Karte

#### Scenario: Bausteinwahl nennt eine fehlende Karte
- **WHEN** die Bausteinwahl auf eine Karte verweist, die es nicht gibt
- **THEN** schlägt der Wächter fehl und nennt den Verweis

### Requirement: Grundbausteine liegen als Karte vor

Das Design System SHALL für die Grundformen jeder Seite eine Karte aus dem echten Baustein der App
zeigen: Knopf, Eingabefeld, Dialog, Zustände (Laden, Leer, Fehler), Hinweis, Seitenkopf,
Formularlayout und vollständige Tabelle. Eine Form, die die UI-Form-Leitlinie zurückdrängt (der
Drawer außerhalb der Navigation), MUST NOT eine eigene Karte bekommen.

#### Scenario: Entwurf einer neuen Seite
- **WHEN** ein `/design`-Agent eine Seite mit Kopf, Formular und leerem Zustand entwirft
- **THEN** findet er für jede dieser Formen eine Karte mit dem Baustein der App, in Nacht und Tag
