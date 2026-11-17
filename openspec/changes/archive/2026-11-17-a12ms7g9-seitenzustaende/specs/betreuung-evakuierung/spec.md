# Spec Delta

## MODIFIED Requirements

### Requirement: Detailseite eines Evakuierungsbezirks

Die Oberfläche SHALL je nicht storniertem Bezirk eine Detailseite unter
`/einsaetze/<id>/evakuierung/<bezirk-id>` führen, gegatet wie die Modulseite Evakuierung. Eine
ungültige, unbekannte, fremde oder stornierte Kennung MUST im Rahmen bleiben und „Diesen
Evakuierungsbezirk gibt es nicht (mehr)“ mit einem Weg zur Evakuierung zeigen, ohne stille
Weiterleitung; nach dem eigenen Stornieren MUST die Seite auf die Übersicht führen. Der Kopf
MUST die Bezeichnung mit dem Räumungszustand als Wort und genau eine Primäraktion „Stand
melden“ tragen. Die Seite MUST die Kennzahlen Evakuiert, Geplant, Anteil mit Balken und letzte
Meldung zeigen, geschätzte Werte mit „≈“.

#### Scenario: Unbekannte Kennung
- **WHEN** jemand `/einsaetze/1/evakuierung/99` öffnet und der Einsatz keinen Bezirk 99 führt
- **THEN** bleibt die Adresse stehen, und die Seite zeigt „Diesen Evakuierungsbezirk gibt es nicht
  (mehr)“ mit „Zur Evakuierung“

#### Scenario: Beobachter
- **WHEN** eine Person ohne Schreibrecht die Detailseite öffnet
- **THEN** sieht sie Kennzahlen, Gebiet, Stammdaten und Verlauf, aber weder „Stand melden“ noch „Bearbeiten“
- **AND** ein Hinweis nennt den Grund

### Requirement: Detailseite einer Betreuungsstelle

Die Oberfläche SHALL jede nicht stornierte Betreuungsstelle unter
`/einsaetze/<id>/betreuung/<stellen-id>` als eigene Seite zeigen. Die Seite MUST ihre Daten aus
der Betreuungsübersicht lesen. Eine unbekannte, fremde oder stornierte Stelle und eine
unlesbare Kennung MUST im Rahmen bleiben und „Diese Betreuungsstelle gibt es nicht (mehr)“ mit
einem Weg zur Betreuung zeigen, ohne stille Weiterleitung. Die Adresse `…/betreuung?stelle=<id>` MUST
auf diese Seite umleiten. Die Bezeichnung einer Stelle in der Übersicht MUST auf ihre Seite
führen; Sprünge von der Lagekarte und der Rückweg nach dem Verorten MUST dorthin führen. Ein
Verbleib „Notunterkunft“, der auf eine Stelle zeigt, MUST an der Stabsoberfläche (Patientenkopf
und Verlauf der Person) auf deren Seite führen; ist das Modul Betreuung gesperrt oder wird am
gekoppelten Gerät gelesen, MUST er Text ohne Link bleiben.

Der Kopf MUST Bezeichnung, Art und Status zeigen und genau eine Primäraktion „Belegung
melden“ tragen; an einer geschlossenen Stelle MUST sie gesperrt stehen und der Grund sichtbar
daneben. Der Statuswechsel MUST als Handlung benannt sein: „In Betrieb nehmen“
(`vorbereitet`), „Schließen“ (`in_betrieb`), „Wieder öffnen“ (`geschlossen`). Das Schließen
einer belegten Stelle MUST eine ausdrückliche Leermeldung verlangen und erst sie, dann den
Status senden. Bearbeiten und Status MUST nur auf dieser Seite stehen, nicht in der Übersicht.

Die Seite MUST zeigen: „Belegung in Zahlen“ (Belegt, Kapazität, Frei, mit Personenrecht
„Davon namentlich“), die Stammdaten in einem Datenraster mit Bearbeiten in der Ansicht, den
Meldeverlauf, mit Personenrecht die namentlich hier untergebrachten Personen und den Anteil
der Stelle an „in Betreuung“ mit einem Sprung ins Modul Verpflegung, wenn dieses frei ist.
„Frei“ MUST nie negativ sein; eine Überbelegung nennt das Auslastungswort.

Über dem Meldeverlauf MUST ab zwei gültigen Meldungen mit verschiedenem Zeitpunkt eine
Stufenlinie der Belegung stehen: zurückgenommene Meldungen fehlen, zwischen zwei Meldungen gilt
die ältere weiter (keine Interpolation), die Linie endet an der jüngsten Meldung, die y-Achse
beginnt bei 0, und eine bekannte Kapazität steht gestrichelt mit Wort und Zahl daneben. Die
Linie MUST als ein Bild mit einer Aussage zugänglich sein (Anfang, Ende, Zahl der Meldungen,
Kapazität). Mit weniger als zwei Meldungen MUST die Linie fehlen.

#### Scenario: Aus der Übersicht hinein
- **WHEN** in der Übersicht die Bezeichnung „Turnhalle Ost“ gewählt wird
- **THEN** öffnet sich ihre Detailseite mit „Belegung melden“ als Primäraktion

#### Scenario: Alte Adresse
- **WHEN** `…/betreuung?stelle=8` aufgerufen wird
- **THEN** steht die Adresse auf `…/betreuung/8`

#### Scenario: Stornierte Stelle
- **WHEN** die Detailseite einer stornierten Stelle aufgerufen wird
- **THEN** bleibt die Adresse stehen, und die Seite zeigt „Diese Betreuungsstelle gibt es nicht
  (mehr)“ mit „Zur Betreuung“

#### Scenario: Schließen einer belegten Stelle
- **WHEN** an einer Stelle mit Belegung 40 „Schließen“ gewählt und die Leermeldung bestätigt wird
- **THEN** wird zuerst Belegung 0 gemeldet und danach der Status `geschlossen` gesetzt

#### Scenario: Ohne Personenrecht
- **WHEN** eine Person ohne Zugriff auf das Modul Personen die Detailseite öffnet
- **THEN** fehlen „Davon namentlich“ und die Liste der Personen, eine Zeile nennt den Grund, und die Personenliste wird nicht abgefragt

#### Scenario: Überbelegt
- **WHEN** eine Stelle mit Kapazität 150 eine Belegung von 170 trägt
- **THEN** zeigt „Frei“ 0 und „Belegt“ das Wort „überbelegt“

#### Scenario: Belegungsverlauf als Stufenlinie
- **WHEN** eine Stelle mit Kapazität 120 die Meldungen 40 und danach 115 trägt
- **THEN** steht über dem Meldeverlauf eine Stufenlinie „Belegung von 40 … auf 115 …, 2 Meldungen, Kapazität 120“
- **AND** mit nur einer Meldung steht keine Linie

#### Scenario: Vom Verbleib auf die Stelle
- **WHEN** im Patientenkopf einer Person der Verbleib „Notunterkunft → Turnhalle Ost“ mit Stelle steht und das Modul Betreuung frei ist
- **THEN** führt der Verbleib auf `…/betreuung/<stellen-id>`
- **AND** ohne Zugriff auf das Modul Betreuung bleibt er Text
