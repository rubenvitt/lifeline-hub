# Spec Delta

## Purpose

Name und Logo der Organisation als pflegbare Stammdaten, damit Ausdrucke und Oberfläche die
Organisation nennen, der ein Dokument gehört.

## ADDED Requirements

### Requirement: Name der Organisation ändern

Ein Admin SHALL den Namen seiner eigenen Organisation in der Verwaltung ändern können. Der
Name MUST nach Entfernen führender und folgender Leerzeichen mindestens ein Zeichen und
höchstens 120 Zeichen haben; sonst MUST die Änderung mit 400 abgelehnt werden. Nicht-Admins
MUST mit 403 abgelehnt werden. Die bestehende Änderung der taktischen Vorgabe-Organisation
SHALL unverändert möglich bleiben, auch ohne Namen im selben Aufruf. Ein Aufruf ohne jedes
änderbare Feld MUST mit 400 abgelehnt werden.

#### Scenario: Admin benennt die Organisation um

- **WHEN** ein Admin den Namen auf „DRK Kreisverband Musterstadt“ setzt
- **THEN** liefern alle folgenden Abrufe der Organisation diesen Namen

#### Scenario: Leerer Name

- **WHEN** ein Admin den Namen „   “ setzt
- **THEN** antwortet das System mit 400 und der Name bleibt unverändert

#### Scenario: Nur die taktische Vorgabe

- **WHEN** ein Admin wie bisher nur die taktische Vorgabe-Organisation ändert
- **THEN** wird sie übernommen und der Name bleibt unverändert

#### Scenario: Nicht-Admin

- **WHEN** eine Person ohne Admin-Rolle den Namen ändern will
- **THEN** antwortet das System mit 403

### Requirement: Der gepflegte Name überlebt einen Neustart

Der beim ersten Start aus der Konfiguration übernommene Name SHALL nur als Anfangswert
dienen. Ein über die Verwaltung gesetzter Name MUST NOT bei einem späteren Start
überschrieben werden.

#### Scenario: Neustart nach Umbenennung

- **WHEN** ein Admin die Organisation umbenannt hat und der Server neu startet
- **THEN** trägt die Organisation weiter den gepflegten Namen

### Requirement: Logo hochladen

Ein Admin SHALL für seine Organisation genau ein Logo hochladen können; ein neues Logo
ersetzt das vorige. Zulässig MUST nur PNG oder JPEG sein, erkannt am Dateiinhalt, nicht an
Dateiname oder angegebenem Typ. SVG und alle anderen Formate MUST mit 400 abgelehnt werden.
Eine leere Datei oder eine Datei über 1 MiB MUST mit 400 abgelehnt werden. Jede Datei MUST vor
dem Speichern auf Schadcode geprüft werden; ein Fund MUST mit 422 abgelehnt werden, ein nicht
erreichbarer Scanner führt zu derselben Entscheidung wie bei anderen Uploads (Vorgabe: 503).
Nicht-Admins MUST mit 403 abgelehnt werden.

#### Scenario: PNG hochladen

- **WHEN** ein Admin ein PNG mit 200 KiB hochlädt
- **THEN** ist es das Logo der Organisation

#### Scenario: SVG mit Bildendung

- **WHEN** ein Admin eine SVG-Datei mit der Endung `.png` hochlädt
- **THEN** antwortet das System mit 400 und das bisherige Logo bleibt

#### Scenario: Grenze der Größe

- **WHEN** ein Admin eine Datei mit genau 1 MiB bzw. mit 1 MiB plus ein Byte hochlädt
- **THEN** wird die erste angenommen und die zweite mit 400 abgelehnt

#### Scenario: Schadcode-Fund

- **WHEN** der Scanner in der Datei Schadcode findet
- **THEN** antwortet das System mit 422 und speichert nichts

### Requirement: Logo entfernen

Ein Admin SHALL das Logo seiner Organisation entfernen können. Danach MUST der Abruf des Logos
404 liefern.

#### Scenario: Logo entfernen

- **WHEN** ein Admin das Logo entfernt
- **THEN** liefert der Abruf des Logos 404 und der Druckkopf zeigt nur den Namen

### Requirement: Name und Logo lesen

Jede angemeldete Person SHALL Name und Logo ihrer eigenen Organisation lesen können. Die
Stammdaten der Organisation SHALL angeben, ob ein Logo hinterlegt ist, samt Bildtyp, Größe
und Änderungszeitpunkt. Der Abruf des Logos SHALL einen Validator liefern, mit dem ein
Browser ein zwischengespeichertes Logo ohne erneute Übertragung bestätigen lassen kann. Ein
neues Logo MUST ohne Wartezeit sichtbar werden; ein zwischengespeichertes altes Logo MUST NOT
als unbefristet gültig gelten.

#### Scenario: Unverändertes Logo erneut laden

- **WHEN** ein Browser das Logo mit seinem Validator erneut anfragt und es sich nicht geändert
  hat
- **THEN** antwortet das System mit 304 ohne Bilddaten

#### Scenario: Logo ersetzt

- **WHEN** ein Admin ein neues Logo hochgeladen hat
- **THEN** zeigt der nächste Druckkopf das neue Logo

### Requirement: Trennung zwischen Organisationen

Name und Logo MUST nur für Personen der eigenen Organisation lesbar und nur durch deren Admins
änderbar sein. Eine Person einer Organisation ohne Logo MUST 404 bekommen und niemals das Logo
einer anderen Organisation.

#### Scenario: Zwei Organisationen mit verschiedenen Logos

- **WHEN** Organisation A und Organisation B je ein anderes Logo haben
- **THEN** bekommt jede Person genau das Logo ihrer eigenen Organisation

#### Scenario: Organisation ohne Logo neben einer mit Logo

- **WHEN** Organisation B kein Logo hat und Organisation A eines
- **THEN** bekommt eine Person aus B beim Abruf 404

### Requirement: Logo ist keine Einsatzunterlage

Das Logo SHALL an der Organisation hängen, nicht an einem Einsatz. Das Schwärzen oder Löschen
eines Einsatzes MUST das Logo unverändert lassen.

#### Scenario: Einsatz schwärzen

- **WHEN** ein Einsatz nach Ablauf der Aufbewahrungsfrist geschwärzt wird
- **THEN** bleibt das Logo der Organisation unverändert abrufbar
