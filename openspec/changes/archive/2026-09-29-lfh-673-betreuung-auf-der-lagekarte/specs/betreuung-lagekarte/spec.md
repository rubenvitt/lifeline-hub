# Spec Delta

## Purpose

Betreuungsstellen und Evakuierungsbezirke des Fachmoduls Betreuung erscheinen auf der
Lagekarte: Stellen als verortete Marker, Bezirke als Flächen aus einer oder mehreren
Teilzonen. Damit sieht die Führung auf einen Blick, wo untergebracht wird und welche
Gebiete geräumt werden, ohne die Modulfreigabe zu umgehen.

## ADDED Requirements

### Requirement: Koordinate einer Betreuungsstelle

Das System SHALL an einer Betreuungsstelle optional eine Koordinate führen, bestehend aus
Breite `lat` und Länge `lon`. Beide Werte MUST gemeinsam gesetzt oder gemeinsam leer sein.
Die Breite MUST zwischen −90 und 90 liegen, die Länge zwischen −180 und 180. Eine
Koordinate MUST über denselben Änderungsweg gesetzt, geändert und entfernt werden können
wie die übrigen Angaben der Stelle. Fehlt die Koordinate in einer Änderung, bleibt sie
unverändert. Ist sie `null`, wird sie entfernt. Die Anzeige einer Stelle MUST die
Koordinate tragen, wenn eine gesetzt ist, und das Feld sonst weglassen.

#### Scenario: Stelle verorten
- **WHEN** eine Person mit Schreibrecht an der Stelle „NU Turnhalle Nord“ `lat` 51,93 und `lon` 8,87 setzt
- **THEN** trägt die Stelle diese Koordinate, und eine erneute Abfrage liefert sie

#### Scenario: Nur ein Wert des Paares
- **WHEN** eine Änderung nur `lat` setzt und die Stelle bisher keine Koordinate hat
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Wert außerhalb des Bereichs
- **WHEN** eine Änderung `lat` 91 und `lon` 8 setzt
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Verortung entfernen
- **WHEN** eine Änderung `lat` und `lon` jeweils auf `null` setzt
- **THEN** trägt die Stelle keine Koordinate mehr, und ihre Anzeige enthält weder `lat` noch `lon`

#### Scenario: Verortung ändert keine anderen Angaben
- **WHEN** eine Änderung nur die Koordinate setzt, während eine andere Person zuvor Status und Kapazität geändert hat
- **THEN** bleiben Status und Kapazität auf dem zuletzt gespeicherten Stand

#### Scenario: Stornierte Stelle
- **WHEN** an einer stornierten Stelle eine Koordinate gesetzt werden soll
- **THEN** antwortet das System mit 409

### Requirement: Verortung ohne Tagebucheintrag, aber live

Eine Änderung, die an einer Stelle ausschließlich die Koordinate verändert, MUST keinen
ETB-Eintrag schreiben. Sie MUST dennoch als Änderung des Moduls Betreuung live verteilt
werden. Eine Änderung, die die Koordinate unverändert lässt und auch sonst keinen Wert
verändert, MUST weder einen ETB-Eintrag schreiben noch live verteilt werden. Kein
ETB-Eintrag des Moduls MUST eine Koordinate enthalten.

#### Scenario: Nur Koordinate geändert
- **WHEN** eine Stelle verortet wird und sonst nichts geändert wird
- **THEN** entsteht kein ETB-Eintrag
- **AND** Personen mit Lesezugriff auf das Modul Betreuung erhalten ein Live-Ereignis zur Stelle

#### Scenario: Koordinate unverändert
- **WHEN** eine Änderung dieselbe Koordinate schickt, die die Stelle bereits trägt, und sonst nichts ändert
- **THEN** antwortet das System erfolgreich, schreibt keinen ETB-Eintrag und verteilt kein Live-Ereignis

#### Scenario: Koordinate zusammen mit Stammdaten
- **WHEN** eine Änderung Koordinate und Kapazität zugleich ändert
- **THEN** nennt der ETB-Eintrag die Kapazitätsänderung und enthält keine Koordinate

### Requirement: Betreuungsstellen als Marker

Die Lagekarte SHALL jede nicht stornierte, verortete Betreuungsstelle als Marker an ihrer
Koordinate zeigen, mit dem taktischen Zeichen Grundzeichen „Stelle“ und Fachaufgabe
„Betreuung“. Die Marker MUST eine eigene, schaltbare Ebene „Betreuungsstellen“ bilden. Die
Auswahl eines Markers MUST Bezeichnung, Art und Status der Stelle zeigen und einen Sprung
ins Modul Betreuung anbieten, der die Stelle dort auswählt. Stornierte Stellen MUST weder
als Marker noch in einer Liste der Karte erscheinen.

#### Scenario: Verortete Stelle
- **WHEN** die Stelle „NU Turnhalle Nord“ verortet ist
- **THEN** zeigt die Lagekarte an ihrer Koordinate einen Marker mit dem Zeichen Stelle/Betreuung

#### Scenario: Sprung ins Modul
- **WHEN** der Marker ausgewählt und „Im Fachmodul öffnen“ gewählt wird
- **THEN** öffnet sich die Betreuungsseite mit dieser Stelle ausgewählt

#### Scenario: Ebene ausblenden
- **WHEN** die Ebene „Betreuungsstellen“ ausgeschaltet wird
- **THEN** zeigt die Karte keinen Betreuungsstellen-Marker

#### Scenario: Stornierte Stelle
- **WHEN** eine verortete Stelle storniert wird
- **THEN** verschwindet ihr Marker von der Karte

### Requirement: Nicht verortete Stellen platzieren

Die Lagekarte SHALL nicht stornierte Betreuungsstellen ohne Koordinate in der Liste „Nicht
verortet“ führen. Eine Person mit Schreibrecht MUST eine solche Stelle von dort aus durch
einen Klick in die Karte verorten können. Die Adresse
`/einsaetze/<id>/lagekarte?platzieren=betreuungsstelle:<stellen-id>` MUST die Karte in den
Platziermodus für diese Stelle schicken und den Parameter danach aus der Adresse entfernen.
Ohne Schreibrecht MUST der Platziermodus nicht betreten werden. Die Betreuungsseite MUST
an jeder nicht verorteten Stelle einen Einstieg „Auf Karte verorten“ anbieten, der zu
dieser Adresse führt, sofern die Person Schreibrecht hat.

#### Scenario: Aus der Liste platzieren
- **WHEN** eine Person mit Schreibrecht in „Nicht verortet“ die Stelle „AS Rathaus“ wählt und in die Karte klickt
- **THEN** trägt die Stelle die Koordinate des Klickpunkts und erscheint als Marker
- **AND** sie steht nicht mehr in „Nicht verortet“

#### Scenario: Deeplink aus dem Modul
- **WHEN** auf der Betreuungsseite an einer nicht verorteten Stelle „Auf Karte verorten“ gewählt wird
- **THEN** öffnet die Lagekarte im Platziermodus für diese Stelle, und die Adresse enthält danach kein `platzieren` mehr

#### Scenario: Unbrauchbarer Auftrag
- **WHEN** die Adresse `?platzieren=betreuungsstelle:abc` aufgerufen wird
- **THEN** betritt die Karte keinen Platziermodus

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht die Platzieren-Adresse aufruft
- **THEN** betritt die Karte keinen Platziermodus

#### Scenario: Verortung entfernen
- **WHEN** eine Person mit Schreibrecht am ausgewählten Marker „Verortung löschen“ wählt
- **THEN** verliert die Stelle ihre Koordinate und steht wieder in „Nicht verortet“

### Requirement: Modulfreigabe auf der Karte

Wer das Modul Betreuung nicht lesen darf, MUST auf der Lagekarte weder Betreuungsstellen
noch Bezirksnamen oder Räumungszustände sehen. Die Karte MUST das in der Ebenenliste als
gesperrte Ebene mit Begründung ausweisen und MUST den gesperrten Abruf nicht als
Quellenfehler melden. Zonen vom Typ Evakuierungsbezirk MUST auch dann als Flächen
erscheinen, beschriftet nur mit ihrem eigenen Zonennamen oder dem Typwort.

#### Scenario: Ohne Modulrecht
- **WHEN** eine Person ohne Lesezugriff auf das Modul Betreuung die Lagekarte öffnet
- **THEN** zeigt die Ebenenliste „Betreuungsstellen“ als gesperrt mit Begründung
- **AND** es erscheint kein Hinweis auf eine fehlerhafte Datenquelle

#### Scenario: Bezirksfläche ohne Modulrecht
- **WHEN** dieselbe Person eine einem Bezirk zugeordnete Zone ansieht
- **THEN** sieht sie die Fläche und das Typwort „Evakuierungsbezirk“, aber weder Bezirksbezeichnung noch Räumungszustand

### Requirement: Zonentyp Evakuierungsbezirk

Das System SHALL den Zonentyp `evakuierungsbezirk` führen. Eine Zone dieses Typs MUST eine
Fläche (Polygon) sein. Die Karte MUST sie mit einem eigenen, von den übrigen Zonentypen
unterscheidbaren Stil zeichnen und in der Legende als „Evakuierungsbezirk“ führen. Anlage,
Änderung von Typ oder Name und Aufhebung einer solchen Zone MUST wie bei den übrigen
Zonentypen im ETB festgehalten werden, mit dem Typwort „Evakuierungsbezirk“.

#### Scenario: Bezirksfläche zeichnen
- **WHEN** eine Person mit Schreibrecht auf der Lagekarte eine Fläche vom Typ Evakuierungsbezirk zeichnet
- **THEN** entsteht eine Zone dieses Typs, und das ETB enthält „Evakuierungsbezirk … eingerichtet“ (Verb der übrigen Zonentypen)

#### Scenario: Linie als Evakuierungsbezirk
- **WHEN** eine Zone vom Typ Evakuierungsbezirk mit einer Linie als Geometrie angelegt werden soll
- **THEN** antwortet das System mit 422

#### Scenario: Unbekannter Zonentyp bleibt 400
- **WHEN** eine Zone mit einem Typ außerhalb der bekannten Werte angelegt wird
- **THEN** antwortet das System mit 400

### Requirement: Zuordnung von Zonen zu einem Bezirk

Das System SHALL eine Zone vom Typ Evakuierungsbezirk optional genau einem
Evakuierungsbezirk desselben Einsatzes zuordnen. Ein Bezirk MUST beliebig viele Zonen
haben dürfen. Eine Zuordnung an eine Zone eines anderen Typs MUST mit 422 abgelehnt
werden. Ein Bezirk, der nicht existiert oder zu einem anderen Einsatz gehört, MUST 404
ergeben, ein stornierter Bezirk 409. Wer das Modul Betreuung nicht lesen darf, MUST keine
Zuordnung setzen oder ändern können (403). Wechselt eine Zone ihren Typ weg von
Evakuierungsbezirk, MUST ihre Zuordnung entfallen. Die Anzeige einer Zone MUST den Verweis
tragen, wenn einer gesetzt ist, aber keine Angaben des Bezirks selbst. Jede Änderung der
Zuordnung, einschließlich der Aufhebung einer zugeordneten Zone, MUST zusätzlich als
Änderung des Moduls Betreuung live verteilt werden.

#### Scenario: Zwei Teilflächen
- **WHEN** zwei Zonen vom Typ Evakuierungsbezirk dem Bezirk „Uferstraße 12–40“ zugeordnet werden
- **THEN** tragen beide Zonen den Verweis auf diesen Bezirk

#### Scenario: Zuordnung an falschem Typ
- **WHEN** einer Zone vom Typ Sperrgebiet ein Bezirk zugeordnet werden soll
- **THEN** antwortet das System mit 422

#### Scenario: Bezirk eines anderen Einsatzes
- **WHEN** einer Zone ein Bezirk eines anderen Einsatzes zugeordnet werden soll
- **THEN** antwortet das System mit 404

#### Scenario: Stornierter Bezirk
- **WHEN** einer Zone ein stornierter Bezirk zugeordnet werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Ohne Modulrecht
- **WHEN** eine Person mit Schreibrecht auf die Karte, aber ohne Lesezugriff auf das Modul Betreuung eine Zuordnung setzen will
- **THEN** antwortet das System mit 403

#### Scenario: Typwechsel
- **WHEN** eine zugeordnete Zone zum Typ Absperrbereich wechselt
- **THEN** trägt sie keinen Bezirksverweis mehr

#### Scenario: Zuordnung lösen
- **WHEN** die Zuordnung einer Zone auf `null` gesetzt wird
- **THEN** bleibt die Zone als nicht zugeordnete Bezirksfläche bestehen

### Requirement: Storno eines Bezirks löst seine Flächen

Wird ein Evakuierungsbezirk storniert, MUST jede ihm zugeordnete Zone im selben Vorgang
ihren Verweis verlieren. Die Zonen MUST dabei als Zonen vom Typ Evakuierungsbezirk
erhalten bleiben. Die Änderung MUST live an die Karte verteilt werden.

#### Scenario: Storno mit Fläche
- **WHEN** der Bezirk „Uferstraße 12–40“ mit zwei zugeordneten Zonen storniert wird
- **THEN** tragen beide Zonen keinen Bezirksverweis mehr und bleiben auf der Karte stehen

### Requirement: Bezirk und Fläche in beide Richtungen verbunden

Die Anzeige eines Evakuierungsbezirks SHALL die Zahl der ihm zugeordneten Zonen tragen.
Die Betreuungsseite MUST je Bezirk mit mindestens einer Zone „Auf Karte zeigen“ anbieten,
auch Personen ohne Schreibrecht (ein Sprung ist Lesen).
Die Adresse `/einsaetze/<id>/lagekarte?evakuierungsbezirk=<bezirk-id>` MUST eine Zone dieses
Bezirks auswählen, die Karte dorthin führen und den Parameter danach entfernen. Liegt die
Zone in einer anderen Kartenansicht, MUST die Karte zuerst zu dieser Ansicht wechseln. Ein
unbrauchbarer Wert oder ein Bezirk ohne Zone MUST den Parameter ebenfalls entfernen. Die
Auswahl einer zugeordneten Zone MUST für Personen mit Lesezugriff auf das Modul Bezirk,
Räumungszustand und den Stand „evakuiert N von M“ zeigen und einen Sprung ins Modul
anbieten, der den Bezirk dort auswählt. Die Beschriftung einer zugeordneten Zone auf der
Karte MUST für diese Personen den Räumungszustand als Text tragen.

#### Scenario: Aus dem Modul auf die Karte
- **WHEN** auf der Betreuungsseite am Bezirk „Uferstraße 12–40“ „Auf Karte zeigen“ gewählt wird
- **THEN** öffnet die Lagekarte mit einer Zone dieses Bezirks ausgewählt, und die Adresse enthält danach kein `evakuierungsbezirk` mehr

#### Scenario: Fläche in einer anderen Ansicht
- **WHEN** die einzige Zone des Bezirks in der Ansicht „Nord“ liegt und die Karte mit der Standardansicht öffnet
- **THEN** wechselt die Karte zur Ansicht „Nord“ und wählt dort die Zone aus

#### Scenario: Bezirk ohne Fläche
- **WHEN** ein Bezirk keine zugeordnete Zone hat
- **THEN** bietet die Betreuungsseite an ihm kein „Auf Karte zeigen“ an

#### Scenario: Aus der Karte ins Modul
- **WHEN** eine zugeordnete Zone ausgewählt und der Sprung ins Modul gewählt wird
- **THEN** öffnet sich die Betreuungsseite mit diesem Bezirk ausgewählt

#### Scenario: Räumungszustand auf der Fläche
- **WHEN** der Räumungszustand des Bezirks auf `laeuft` wechselt
- **THEN** trägt die Beschriftung seiner Zonen „Räumung: läuft“

### Requirement: Lage-Snapshot und Schwärzung

Ein Lage-Snapshot SHALL die nicht stornierten Betreuungsstellen und Evakuierungsbezirke des
Einsatzes zum Zeitpunkt der Aufnahme einfrieren, mit Koordinate und Zonenverweis. Beim
Abruf MUST der Snapshot diese Inhalte für Personen ohne Lesezugriff auf das Modul
Betreuung weglassen, wie die übrigen modulgebundenen Inhalte. Die Schwärzung eines
Einsatzes MUST Koordinaten der Stellen und Zonenverweise auf Bezirke als operatives
Geo- bzw. Verweisskelett erhalten.

#### Scenario: Historienansicht
- **WHEN** ein Snapshot mit einer verorteten Stelle abgerufen wird
- **THEN** zeigt die Karte im Rückblick den Marker an der eingefrorenen Koordinate

#### Scenario: Snapshot ohne Modulrecht
- **WHEN** eine Person ohne Lesezugriff auf das Modul Betreuung einen Snapshot abruft
- **THEN** enthält die Antwort keine Betreuungsstellen und keine Bezirke

#### Scenario: Schwärzung
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** bleiben Koordinaten der Stellen und Bezirksverweise der Zonen erhalten, während Bezeichnungen und Freitexte wie bisher geschwärzt werden
