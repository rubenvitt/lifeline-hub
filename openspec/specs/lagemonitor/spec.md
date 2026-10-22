# lagemonitor Specification

## Purpose
Legt fest, wie ein gekoppelter Lagemonitor das Lagebild dauerhaft und ohne Bedienung anzeigt:
lesbar aus der Entfernung, immer aktuell, ohne personenbezogene Daten.

## Requirements

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

### Requirement: Kartenkachel ohne Kartengrafik

Kann das Gerät die Karte nicht zeichnen (kein WebGL2), SHALL die Kachel „Lagekarte“ an Stelle der
Karte „Karte auf diesem Gerät nicht darstellbar“ zeigen, in Großbild-Schrift und ohne die Technik
zu nennen. Die übrigen Kacheln und die Statusleiste MUST sichtbar bleiben, und der Monitor MUST
NOT in die Fehlerseite der App fallen. Ein anderer Fehler beim Aufbau der Karte MUST weiter als
Fehler gelten.

#### Scenario: Gerät ohne Kartengrafik

- **WHEN** der Einsatzort verortet ist und der Browser des Monitors kein WebGL2 hat
- **THEN** zeigt die Kachel „Lagekarte“ „Karte auf diesem Gerät nicht darstellbar“ in mindestens 28 px
- **AND** Betroffene, Kräfte, Belegung der Unfallhilfsstellen, Meldungen und Statusleiste bleiben sichtbar
- **AND** es erscheint keine Fehlerseite der App

### Requirement: Keine personenbezogenen Daten

Der Lagemonitor SHALL nur verdichtete Zahlen und Lagedaten ohne Personenbezug zeigen. Namen von
Betroffenen, Patienten oder Einsatzkräften MUST er nicht anzeigen und nicht vom Server erhalten.

#### Scenario: Belegung einer UHS

- **WHEN** in der UHS Nord drei Personen liegen
- **THEN** zeigt der Monitor für die UHS Nord die Zahl 3
- **AND** enthält die Antwort des Servers keine Namen und keine Personenkennungen

#### Scenario: Freitexte im Einsatzkopf

- **WHEN** der Sachverhalt des Einsatzes „Herr Muster gestürzt“ lautet
- **THEN** erhält der Monitor den Einsatzkopf ohne Sachverhalt, meldende Stelle und Ortsangabe
- **AND** behält er den Punkt des Einsatzorts für die Karte

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

### Requirement: Zahl der offenen Sofortmeldungen

Der Lagemonitor SHALL bei den Kopfzahlen die Zahl der offenen, noch nicht bestätigten
Sofortmeldungen zeigen. Er MUST sie als verdichtete Zahl vom Server erhalten, ohne Meldungstext,
Absender oder Empfänger.

#### Scenario: Zwei offene Sofortmeldungen
- **WHEN** im Einsatz zwei Sofortmeldungen unbestätigt sind
- **THEN** zeigt der Lagemonitor „Sofortmeldungen offen 2“

### Requirement: Neue Dringlichkeit sichtbar hervorheben

Steigt die Zahl der offenen Sofortmeldungen oder der Personen der Sichtungskategorie I, SHALL der
Lagemonitor die betroffene Zahl 60 Sekunden lang sichtbar hervorheben, ohne Ton, ohne Blinken und
ohne Inhalt oder Personenbezug der Meldung. Sinkt oder bleibt die Zahl, MUST keine Hervorhebung
entstehen.

#### Scenario: Neue Sofortmeldung
- **WHEN** die Zahl der offenen Sofortmeldungen von 0 auf 1 steigt
- **THEN** hebt der Lagemonitor die Zahl 60 Sekunden lang hervor und spielt keinen Ton
- **AND** enthält die Antwort des Servers keinen Meldungstext

#### Scenario: Sofortmeldung bestätigt
- **WHEN** die Zahl der offenen Sofortmeldungen von 2 auf 1 sinkt
- **THEN** entsteht keine Hervorhebung
