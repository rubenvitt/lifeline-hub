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

### Requirement: Hilfeleistungen in der Reihe „Sanitätsdienst“

Trägt der Einsatz die Wahl `sanitaetsdienst` (LLH-1574), SHALL die Verdichtung des Lagemonitors
einen Block `sanitaetsdienst` mit `kontakte`, `kontakte_letzte_stunde`, `in_versorgung` und
`transporte` liefern, nach denselben Regeln wie die Kennzahlen des Lagebilds; ohne die Wahl MUST
der Block fehlen. Die Schnittstelle für Fremdsysteme (`GET /api/v1/lage`, Spec
`lage-schnittstelle`) MUST denselben Block als optionales Feld tragen. Der Monitor MUST dann statt
„Betroffene“ die Kachel „Hilfeleistungen“ zeigen: Kontakte, letzte Stunde und vermisst, darunter
in Versorgung, Transporte und SK I. Der Block MUST nur Zahlen tragen.

#### Scenario: Reihe gewählt
- **WHEN** der Einsatz `sanitaetsdienst` trägt und 41 Kontakte zählt
- **THEN** zeigt der Monitor die Kachel „Hilfeleistungen“ mit „41 Kontakte“

#### Scenario: Reihe nicht gewählt
- **WHEN** der Einsatz `sanitaetsdienst` nicht trägt
- **THEN** fehlt `sanitaetsdienst` in der Antwort, und der Monitor zeigt „Betroffene“

### Requirement: Alarmzeile ohne Personenbezug
Der Lagemonitor SHALL die Alarmzeile über der Kachel „Lagekarte“ zeigen, mit denselben Arten, Rollen und
derselben Folge wie Überblick und Lagebild, Text mindestens 28 px. Er MUST ihre Werte als
verdichtete Zahlen vom Server erhalten. Namen MUST die Antwort nur von Einheiten und
Einsatzabschnitten tragen; Meldungs-, Auftrags- und Erinnerungstexte, Absender, Empfänger und
Namen von Personen MUST sie nicht tragen.

#### Scenario: Kritischer Abschnitt auf dem Monitor
- **WHEN** der Abschnitt „UHS Turnhalle“ den Lagezustand „kritisch“ trägt
- **THEN** zeigt die Alarmzeile des Monitors „kritisch: UHS Turnhalle“ in der Alarmrolle, mindestens 28 px

#### Scenario: Überfälliger Auftrag ohne Text
- **WHEN** ein Auftrag „Herrn Muster abholen“ überfällig ist
- **THEN** zeigt der Monitor „1 Auftrag überfällig“
- **AND** enthält die Antwort des Servers den Auftragstext nicht

#### Scenario: Alle Kacheln bleiben sichtbar
- **WHEN** der Monitor auf 1920 × 1080 läuft und acht Arten vorliegen
- **THEN** sind Alarmzeile und alle Kacheln ohne Bildlauf sichtbar

#### Scenario: Ausfall auf dem Monitor
- **WHEN** das Meldebild beim Logistiktrupp, und nur dort, einen Ausfall nennt, weil die Helferin Anna Muster „nicht verfügbar“ meldet
- **THEN** zeigt die Alarmzeile des Monitors „Ausfall: Logistiktrupp“ in der Alarmrolle
- **AND** enthält die Antwort des Servers den Namen „Anna Muster“ nicht

#### Scenario: Gleiche Einheiten wie im Überblick
- **WHEN** der Überblick zur selben Minute „Ausfall: Sanitätszug, Logistiktrupp +1“ zeigt
- **THEN** zeigt der Monitor „Ausfall: Sanitätszug, Logistiktrupp +1“

### Requirement: Sofortmeldungen erreichen den Monitor sofort
Geht eine Sofortmeldung ein, SHALL der Lagemonitor seine Verdichtung neu abrufen, ohne auf den
Abruftakt zu warten. Das Signal an den Monitor MUST keinen Meldungsinhalt tragen.

#### Scenario: Neue Sofortmeldung
- **WHEN** eine Sofortmeldung eingeht
- **THEN** steht sie innerhalb weniger Sekunden in der Alarmzeile des Monitors, nicht erst nach 30 Sekunden

### Requirement: Gefahrenzonen mit Name und Warnstufe

Der Lagemonitor SHALL jede Gefahrenzone auf der Karte in mindestens 28 px beschriften. Ein
Gefahrengebiet MUST die Bezeichnung seines Gebiets (ohne Bezeichnung „Gefahrengebiet“) und die
höchste Warnstufe tragen, bei unbestätigter Beurteilung zusätzlich „unbestätigt“, und in der
Farbe seiner Warnstufe wie auf der Lagekarte erscheinen. Absperrungen und Sperrgebiete MUST ihr
Artwort tragen.

#### Scenario: Gefahrengebiet mit hoher Stufe

- **WHEN** das Gefahrengebiet „Hangrutsch Kirchberg“ in seiner Matrix die höchste Stufe „hoch“ hat und seine Beurteilung bestätigt ist
- **THEN** steht an seiner Fläche „Hangrutsch Kirchberg · hoch“ in mindestens 28 px
- **AND** ist die Fläche in der Alarmfarbe gefärbt

#### Scenario: Beurteilung offen

- **WHEN** das Gefahrengebiet „Hangrutsch Kirchberg“ die Stufe „mittel“ hat und niemand die Beurteilung bestätigt hat
- **THEN** steht an seiner Fläche „Hangrutsch Kirchberg · mittel · unbestätigt“
- **AND** ist die Fläche in der Achtungsfarbe gefärbt

#### Scenario: Gefahrengebiet ohne Bezeichnung

- **WHEN** ein Gefahrengebiet keine Bezeichnung hat und die Stufe „akut“
- **THEN** steht an seiner Fläche „Gefahrengebiet · akut“

#### Scenario: Absperrung

- **WHEN** der Einsatz einen Absperrbereich mit der Beschriftung „Garten Familie Muster“ hat
- **THEN** steht an seiner Fläche „Absperrbereich“
- **AND** erscheint „Garten Familie Muster“ weder auf dem Monitor noch in der Antwort des Servers

### Requirement: Zonen ohne Freitext

Die Verdichtung des Lagemonitors SHALL zu einer Gefahrenzone nur Typ, Geometrie und, bei einem
Gefahrengebiet, Bezeichnung, höchste Warnstufe und Bestätigung des Gebiets liefern. Beschriftung
und Notiz der Zone sowie der Name dessen, der die Beurteilung bestätigt hat, MUST NOT in der
Antwort stehen.

#### Scenario: Freitexte einer Zone

- **WHEN** eine Gefahrengebiet-Zone die Beschriftung „Haus Muster“ und die Notiz „Herr Muster wartet“ trägt und ihr Gebiet „Hangrutsch Kirchberg“ heißt
- **THEN** enthält die Antwort an den Monitor „Hangrutsch Kirchberg“, die Warnstufe und die Bestätigung
- **AND** enthält sie weder „Haus Muster“ noch „Herr Muster wartet“ noch den Namen der bestätigenden Person

### Requirement: Überbelegte Unfallhilfsstelle in Alarmrolle

Liegen in einer Unfallhilfsstelle mehr Personen, als sie Plätze hat, SHALL der Lagemonitor ihre
Belegung „Belegte/Plätze“ in der Alarmrolle zeigen, sie in der Kachel „Belegung der
Unfallhilfsstellen“ vor nicht überbelegten Stellen reihen und in deren Titelzeile „n überbelegt“
in der Alarmrolle nennen. Die Kartenmarke der Stelle MUST Belegte und Plätze zeigen, überbelegt in
der Alarmrolle.

#### Scenario: Acht Personen auf fünf Plätzen

- **WHEN** in der UHS Turnhalle acht Personen liegen und sie fünf Plätze hat
- **THEN** zeigt die Kachel „Belegung der Unfallhilfsstellen“ für die UHS Turnhalle „8/5“ in der Alarmrolle
- **AND** steht in der Titelzeile der Kachel „1 überbelegt“
- **AND** trägt die Kartenmarke der UHS Turnhalle „8/5“ in der Alarmrolle

#### Scenario: Überbelegt, aber kleiner als andere

- **WHEN** sieben Unfallhilfsstellen je zehn Belegte auf zwanzig Plätzen haben und die UHS Turnhalle acht auf fünf
- **THEN** steht die UHS Turnhalle in der Kachel an erster Stelle

#### Scenario: Volle Stelle ist nicht überbelegt

- **WHEN** in einer UHS fünf Personen auf fünf Plätzen liegen
- **THEN** steht ihre Belegung „5/5“ ohne Alarmrolle
- **AND** fehlt „überbelegt“ in der Titelzeile

#### Scenario: Stelle ohne Plätze

- **WHEN** eine UHS keine Plätze hat und zwei Personen dort liegen
- **THEN** zeigt der Monitor für sie die Zahl 2 ohne Alarmrolle
