# Spec Delta

## MODIFIED Requirements

### Requirement: Dokumentlisten liefern Kopfdaten ohne Abschnittstexte

Die Listen der Lageberichte und Befehle eines Einsatzes SHALL je Dokument nur
Kopfdaten liefern: Kennung, Vorlage, Titel, Zeitstand, Status, Version, Vorgänger, Ersteller mit
Namen, Erstellungszeitpunkt, Freigabe mit Person und Zeitpunkt und den ETB-Eintrag der Freigabe.
Sie MUST NOT die Abschnittstexte enthalten. Den Volltext SHALL nur der Einzelabruf eines
Dokuments liefern; seine Antwort bleibt unverändert.

#### Scenario: Liste ohne Abschnitte
- **WHEN** eine Person mit Leserecht die Lageberichtsliste eines Einsatzes mit drei
  Fortschreibungen abruft
- **THEN** enthält jede Zeile Titel, Status und Version, aber kein Feld `abschnitte`

#### Scenario: Detail mit Abschnitten
- **WHEN** dieselbe Person einen dieser Lageberichte einzeln abruft
- **THEN** enthält die Antwort alle Abschnitte mit Text
