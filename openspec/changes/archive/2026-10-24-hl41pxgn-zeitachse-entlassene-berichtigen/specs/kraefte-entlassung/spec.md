# Spec Delta

## MODIFIED Requirements

### Requirement: Beendete Kräfte in Listen und Zahlen

Das System SHALL entlassene und stornierte Kräfte sowie aufgelöste Einheiten aus jeder Liste,
Auswahl, Karte, Stärke, Statusverteilung und jedem Zähler herauslassen. Entlassene Kräfte und
aufgelöste Einheiten MUST auf Anfrage getrennt abrufbar sein. Personal- und Fahrzeugliste MUST
sie als eingeklappten Block „Entlassen“ mit der Aktion „Erneut disponieren“ zeigen, die
Materialliste als Block „Aus dem Einsatz genommen“, die Einheitenliste aufgelöste Einheiten als
eingeklappten Block „Aufgelöst“. Jeder Schreibweg an einer beendeten Kraft außer dem erneuten
Disponieren und der Berichtigung der Zeitachse einer entlassenen Person MUST mit 409 antworten.
Ein Test MUST fehlschlagen, wenn eine Abfrage der vier
Kräftetabellen (Personal, Einheiten, Fahrzeuge, Material) außerhalb einer Ausnahmeliste den
Zustand nicht prüft.

#### Scenario: Stärke ohne Entlassene
- **WHEN** von zwölf Personen einer Einheit zwei entlassen sind
- **THEN** zählen Meldebild, Statusband und Lagemonitor zehn

#### Scenario: Block Entlassen
- **WHEN** die Personalliste zwei Entlassene hat
- **THEN** zeigt sie unter den aktiven einen eingeklappten Block „Entlassen (2)“

#### Scenario: Status an Entlassener
- **WHEN** der Status einer entlassenen Person gesetzt werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Besatzung an entlassenem Fahrzeug
- **WHEN** einem entlassenen Fahrzeug eine Person als Besatzung zugeordnet werden soll
- **THEN** antwortet das System mit 409

## ADDED Requirements

### Requirement: Zeitachse einer entlassenen Person berichtigen

Das System SHALL an einer entlassenen Person Nachtrag und Streichung an ihrer Zeitachse annehmen,
mit denselben Regeln wie an einer aktiven Kraft. Danach MUST die Person ohne offene
Einsatzperiode sein, sonst MUST das System mit 422 antworten, nichts schreiben und auf das erneute
Disponieren verweisen. Der ETB-Eintrag MUST „berichtigt nach Entlassung“ vermerken. An einer
stornierten Person und an einer aufgelösten Einheit MUST beides weiter mit 409 scheitern.

#### Scenario: Eintreffzeit nach dem Entlassen berichtigen
- **WHEN** an einer um 14:00 entlassenen Person das Eintreffen 06:40 mit Grund „Zeit verwechselt“ gestrichen und ein Eintreffen 06:30 nachgetragen wird, während ihre Periode mit der Alarmierung 06:10 beginnt
- **THEN** gelingen beide, die Periode reicht von 06:10 bis 14:00 mit Eintreffen 06:30, und beide ETB-Einträge vermerken „berichtigt nach Entlassung“

#### Scenario: Fehleintrag einer früheren Periode streichen
- **WHEN** an einer entlassenen Person mit zwei abgeschlossenen Perioden das Eintreffen der ersten mit Grund gestrichen wird, die mit einer Alarmierung beginnt
- **THEN** antwortet das System mit 200, und die Person bleibt entlassen

#### Scenario: Nachtrag öffnet eine Periode
- **WHEN** an einer um 14:00 entlassenen Person ein Eintreffen um 15:00 nachgetragen werden soll
- **THEN** antwortet das System mit 422 und dem Hinweis, die Person erst erneut zu disponieren, und die Zeitachse bleibt unverändert

#### Scenario: Abschließende Entlassung streichen
- **WHEN** an einer entlassenen Person die Entlassung gestrichen werden soll, die ihre letzte Periode schließt
- **THEN** antwortet das System mit 422, und die Oberfläche zeigt den Streichen-Knopf dieser Entlassung gesperrt mit Kurzgrund

#### Scenario: Andere Schreibwege bleiben gesperrt
- **WHEN** an einer entlassenen Person nach einer Berichtigung der Zeitachse der Status gesetzt werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Stornierte Person
- **WHEN** an einer stornierten Person ein Ereignis nachgetragen oder gestrichen werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Aufgelöste Einheit
- **WHEN** an einer aufgelösten Einheit ein Ereignis nachgetragen oder gestrichen werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Oberfläche einer entlassenen Person
- **WHEN** eine Person mit Schreibrecht im aktiven Einsatz die Ansicht einer entlassenen Person öffnet
- **THEN** bietet das Paneel „Zeitachse“ „Nachtragen“ und „Streichen“, und Einteilung und Angaben bleiben nur lesbar
