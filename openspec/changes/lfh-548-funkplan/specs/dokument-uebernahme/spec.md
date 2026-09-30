# Spec Delta

## Purpose

Legt fest, wie ein Lagebericht oder Befehl gleich mit Inhalt angelegt wird. Eine Übernahme aus
einer abgeleiteten Sicht (Meldebild, Funkplan) gelingt dadurch ganz oder gar nicht und hinterlässt
keinen leeren Entwurf.

## ADDED Requirements

### Requirement: Anlegen mit Startinhalt
Das Anlegen eines Lageberichts oder Befehls SHALL optional einen Startinhalt annehmen: eine Liste
von Abschnitten mit Schlüssel und Text.
- Jeder Schlüssel MUST zur gewählten Vorlage gehören. Ein unbekannter Schlüssel MUST mit 400
  abgelehnt werden, wie beim Bearbeiten eines Entwurfs. Nennt der Startinhalt einen Schlüssel
  mehr als einmal, MUST das Anlegen ebenfalls mit 400 abgelehnt werden.
- Der Entwurf MUST mit dem Startinhalt in einem Schritt entstehen. Wird die Anfrage abgelehnt,
  MUST kein Entwurf zurückbleiben.
- Abschnitte der Vorlage, die der Startinhalt nicht nennt, MUST leer angelegt werden.
- Ohne Startinhalt MUST sich das Anlegen verhalten wie bisher: leeres Skelett der Vorlage.
- Der neue Entwurf MUST denselben Live-Hinweis auslösen wie bisher, und zwar genau einmal.
- Beim Bearbeiten eines Entwurfs MUST dieselbe Schlüsselprüfung gelten, auch für doppelte
  Schlüssel (400, der Entwurf bleibt unverändert).

#### Scenario: Freitext-Lagebericht mit Inhalt
- **WHEN** ein Lagebericht mit Vorlage „freitext“, Titel „Funkplan 301200Sep26“ und dem
  Startinhalt `text` = „# Funkplan …“ angelegt wird
- **THEN** antwortet das System mit 201, und der Entwurf enthält diesen Text im Abschnitt `text`

#### Scenario: Unbekannter Schlüssel
- **WHEN** der Startinhalt einen Abschnitt `lage` für die Vorlage „freitext“ nennt
- **THEN** antwortet das System mit 400, und im Einsatz ist kein neuer Entwurf entstanden

#### Scenario: Ohne Startinhalt
- **WHEN** ein Befehl ohne Startinhalt angelegt wird
- **THEN** entsteht der Entwurf mit dem leeren Abschnittsskelett seiner Vorlage, wie bisher

### Requirement: Übernahme aus dem Meldebild in einem Schritt
„In Lagebericht übernehmen“ im Meldebild SHALL den Lagebericht in einem einzigen Aufruf mit dem
Meldebild als Startinhalt anlegen. Scheitert der Aufruf, MUST der Fehler an der Seite stehen und
MUST kein leerer Entwurf entstehen. Gelingt er, SHALL der neue Lagebericht geöffnet werden.

#### Scenario: Meldebild übernehmen
- **WHEN** eine Person mit Schreibrecht im Meldebild „In Lagebericht übernehmen“ wählt
- **THEN** sendet der Client genau eine anlegende Anfrage mit dem Meldebild als Text, und der
  Bericht öffnet sich

#### Scenario: Übernahme abgelehnt
- **WHEN** der Server das Anlegen ablehnt
- **THEN** steht der Fehler an der Seite, und es folgt keine weitere Anfrage
