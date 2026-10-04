# Spec Delta

## Purpose

Legt fest, wie ein gekoppelter Lagemonitor das Lagebild dauerhaft und ohne Bedienung anzeigt:
lesbar aus der Entfernung, immer aktuell, ohne personenbezogene Daten.

## ADDED Requirements

### Requirement: Feste Kachelung ohne Bedienung

Der Lagemonitor SHALL eine feste Kachelung ohne Bildlauf zeigen: Lagekarte, Kopfzahlen,
Kräftesummen, Belegung je UHS und Datenstand. Die Kacheln MUST NOT auf Klick, Tippen oder
Ziehen reagieren; die Karte MUST NOT verschiebbar oder zoombar sein und zeigt das
Einsatzgebiet.

#### Scenario: Versehentliches Tippen

- **WHEN** jemand auf die Karte des Lagemonitors tippt oder sie zieht
- **THEN** ändert sich die Anzeige nicht

#### Scenario: Kein Bildlauf

- **WHEN** der Lagemonitor auf einem Bildschirm mit 1920 × 1080 läuft
- **THEN** sind alle Kacheln ohne Bildlauf sichtbar

### Requirement: Keine personenbezogenen Daten

Der Lagemonitor SHALL nur verdichtete Zahlen und Lagedaten ohne Personenbezug zeigen. Namen von
Betroffenen, Patienten oder Einsatzkräften MUST er nicht anzeigen und nicht vom Server erhalten.

#### Scenario: Belegung einer UHS

- **WHEN** in der UHS Nord drei Personen liegen
- **THEN** zeigt der Monitor für die UHS Nord die Zahl 3
- **AND** enthält die Antwort des Servers keine Namen und keine Personenkennungen

### Requirement: Lesbar aus der Entfernung

Der Lagemonitor SHALL für Großbild ausgelegt sein: Kennzahlen mindestens 72 px, jeder Text
mindestens 28 px bei 1920 × 1080, Kontrast nach `farbrollen-kontrast`.

#### Scenario: Kennzahl

- **WHEN** der Monitor die Zahl der Betroffenen zeigt
- **THEN** ist die Zahl mindestens 72 px hoch

### Requirement: Bildschirm bleibt an

Beim Start SHALL der Lagemonitor einmal „Anzeige starten“ anbieten; diese Aktion MUST Vollbild
und Bildschirm-Wachhalten anfordern. Geht das Wachhalten verloren (etwa nach einem
Tab-Wechsel), MUST der Monitor es bei Rückkehr neu anfordern. Kann der Browser es nicht, MUST
ein dauerhafter Hinweis erscheinen, den Bildschirmschoner am Gerät abzuschalten.

#### Scenario: Wachhalten nach Rückkehr

- **WHEN** der Monitor wieder sichtbar wird
- **THEN** fordert er das Wachhalten neu an

#### Scenario: Browser ohne Wachhalten

- **WHEN** der Browser kein Bildschirm-Wachhalten kennt
- **THEN** zeigt der Monitor den Hinweis zum Bildschirmschoner und läuft weiter

### Requirement: Aktualisiert sich selbst

Der Lagemonitor SHALL über den Live-Kanal aktualisieren, bei Verbindungsverlust selbst neu
verbinden und den Datenstand mit Alter zeigen. Ist der Stand älter als 2 Minuten, MUST der
Monitor ihn als veraltet hervorheben.

#### Scenario: Server kurz weg

- **WHEN** der Server für eine Minute nicht erreichbar ist und dann wieder
- **THEN** verbindet sich der Monitor ohne Eingriff neu
- **AND** zeigt danach den aktuellen Stand

#### Scenario: Veralteter Stand

- **WHEN** der Monitor seit 3 Minuten keinen neuen Stand erhalten hat
- **THEN** ist die Datenstand-Anzeige als veraltet hervorgehoben

### Requirement: Gerätemenü nur auf langes Drücken

Der Lagemonitor SHALL ein Gerätemenü (Vollbild, Tag/Nacht/Automatik, Helligkeit, Neu laden) nur
nach mindestens 3 Sekunden Drücken auf die Statusleiste öffnen. Ohne Eingabe MUST es sich nach
30 Sekunden wieder schließen.

#### Scenario: Kurzes Tippen

- **WHEN** jemand kurz auf die Statusleiste tippt
- **THEN** öffnet sich kein Menü

#### Scenario: Tag und Nacht

- **WHEN** im Gerätemenü „Nacht“ gewählt wird
- **THEN** zeigt der Monitor die dunkle Darstellung, auch nach einem Neuladen

### Requirement: Kopplung beendet

Antwortet der Server dem Lagemonitor mit 401, SHALL der Monitor bildschirmfüllend „Kopplung
beendet“ zeigen und kein Lagebild mehr.

#### Scenario: Monitor widerrufen

- **WHEN** die Einsatzleitung den Lagemonitor widerruft
- **THEN** zeigt der Monitor „Kopplung beendet“ ohne Lagebild
