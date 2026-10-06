# listen-projektion Specification

## Purpose
Legt fest, welche Einsatzlisten nur Kopf- oder Markerdaten liefern und woher Abnehmer den
Volltext eines Datensatzes holen, damit die Last einer Liste nicht mit Textmenge und
Einsatzdauer wächst. (LFH-931)

## Requirements

### Requirement: Dokumentlisten liefern Kopfdaten ohne Abschnittstexte

Die Listen der Lageberichte, Befehle und Pressemitteilungen eines Einsatzes SHALL je Dokument nur
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

### Requirement: Abnehmer des Volltexts lesen das Detail

Wer den Text eines Lageberichts zeigt, SHALL ihn aus dem Einzelabruf lesen, nicht aus der Liste.
Das gilt für die Vorschau eines Lageberichts in der Sprungpalette und für den Lagetext im
Einsatzbericht. Das Lage-Dashboard SHALL den neuesten Lagebericht weiter aus der Liste ermitteln
und unverändert anzeigen.

#### Scenario: Vorschau in der Sprungpalette
- **WHEN** eine Person in der Sprungpalette einen Lagebericht markiert
- **THEN** zeigt die Vorschau seine Abschnittstexte wie bisher

#### Scenario: Einsatzbericht
- **WHEN** der Einsatzbericht für einen Einsatz mit zwei freigegebenen Lageberichten erzeugt wird
- **THEN** steht der Text des zuletzt freigegebenen Lageberichts im Abschnitt zur Lage

### Requirement: Lagekarte und Lage-Dashboard lesen Schadenmarker

Das System SHALL je Einsatz eine Markerliste der Schäden anbieten. Sie enthält je nicht
stornierten Schaden nur Kennung, Registriernummer, Typ, Ausmaß, Status und Lage und MUST NOT
Ort, Beschreibung oder Angaben zu Geschädigten enthalten. Sie steht hinter demselben Recht wie
die Schadenliste. Lagekarte und Lage-Dashboard SHALL Schäden aus dieser Markerliste lesen; die
Modulseite Schäden, Druck, Einsatzbericht, Chat-Bezug und Sprungpalette lesen weiter die
Schadenliste. Die Markerliste MUST im Offline-Lagebild auf dem Gerät gespeichert werden, damit
die Lagekarte ohne Netz ihre Schäden zeigt.

#### Scenario: Marker ohne Freitext
- **WHEN** ein Schaden mit Ort „Hauptstraße 3“ und Beschreibung „Dach abgedeckt“ erfasst ist
- **THEN** enthält seine Zeile in der Markerliste weder den Ort noch die Beschreibung

#### Scenario: Stornierter Schaden
- **WHEN** ein Schaden storniert wird
- **THEN** fehlt er in der Markerliste

#### Scenario: Ohne Modulrecht
- **WHEN** eine Person ohne Zugriff auf das Modul Schäden die Markerliste abruft
- **THEN** antwortet das System wie bei der Schadenliste mit der Modulsperre

#### Scenario: Lagekarte ohne Netz
- **WHEN** die Lagekarte mit Schäden geladen war und das Gerät die Verbindung verliert
- **THEN** zeigt die Lagekarte nach einem Neuladen ohne Netz die Schadenmarker weiter
