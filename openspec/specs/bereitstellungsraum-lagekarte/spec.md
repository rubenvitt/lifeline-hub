# bereitstellungsraum-lagekarte Specification

## Purpose
Ein Bereitstellungsraum ist ein Ort. Er trägt eine optionale Koordinate, die ohne
Tagebucheintrag gesetzt und live verteilt wird, und erscheint im Lage-Snapshot samt Belegung,
ohne die Modulfreigabe zu umgehen; die Schwärzung behält seine Lage als Geo-Skelett. Die
Lagekarte zeigt den Raum als eigene Ebene mit dem Raumzeichen nach DV 102 und seiner Belegung,
verortet ihn aus der Detailseite oder aus „Nicht verortet“ und führt zurück zur Detailseite
(Gegenstück zu `betreuung-lagekarte`).

## Requirements

### Requirement: Koordinate eines Bereitstellungsraums

Das System SHALL an einem Bereitstellungsraum optional eine Koordinate führen, bestehend aus
Breite `lat` und Länge `lon`. Beide Werte MUST gemeinsam gesetzt oder gemeinsam leer sein, geprüft
gegen den gespeicherten Stand derselben Transaktion. Die Breite MUST zwischen −90 und 90 liegen,
die Länge zwischen −180 und 180; ein Verstoß MUST mit 422 abgelehnt werden, ohne etwas zu ändern.
Die Koordinate MUST beim Anlegen mitgegeben und über denselben Änderungsweg gesetzt, geändert und
entfernt werden können wie Bezeichnung, Standort und Notiz. Fehlt sie in einer Änderung, bleibt
sie unverändert; ist sie `null`, wird sie entfernt. Die Anzeige eines Raums MUST die Koordinate
tragen, wenn eine gesetzt ist, und das Feld sonst weglassen. Der Freitext `standort` MUST daneben
unverändert bestehen bleiben.

#### Scenario: Raum verorten
- **WHEN** eine Person mit Schreibrecht am BR „Sportplatz“ `lat` 51,93 und `lon` 8,87 setzt
- **THEN** trägt der Raum diese Koordinate, und Liste und Detail liefern sie

#### Scenario: Anlegen mit Koordinate
- **WHEN** ein Raum mit Bezeichnung, Standort „Sportplatz Nord“, `lat` 51,93 und `lon` 8,87 angelegt wird
- **THEN** trägt der neue Raum Standort und Koordinate

#### Scenario: Nur ein Wert des Paares
- **WHEN** eine Änderung nur `lat` setzt und der Raum bisher keine Koordinate hat
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Wert außerhalb des Bereichs
- **WHEN** eine Änderung `lat` 91 und `lon` 8 setzt
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Verortung entfernen
- **WHEN** eine Änderung `lat` und `lon` jeweils auf `null` setzt
- **THEN** trägt der Raum keine Koordinate mehr, und seine Anzeige enthält weder `lat` noch `lon`

#### Scenario: Verortung ändert keine anderen Angaben
- **WHEN** eine Änderung nur die Koordinate setzt, während eine andere Person zuvor den Standort geändert hat
- **THEN** bleibt der Standort auf dem zuletzt gespeicherten Stand

#### Scenario: Stornierter Raum
- **WHEN** an einem stornierten Raum eine Koordinate gesetzt werden soll
- **THEN** antwortet das System mit 409

#### Scenario: BR-Gerät
- **WHEN** ein gekoppeltes BR-Gerät die Koordinate seines Raums ändern will
- **THEN** antwortet das System mit 403 und ändert nichts

### Requirement: Verortung ohne Tagebucheintrag, aber live

Eine Änderung der Koordinate eines Bereitstellungsraums MUST keinen ETB-Eintrag schreiben, allein
wie zusammen mit anderen Raumdaten. Sie MUST als Änderung des Raums live an alle Personen mit
Lesezugriff auf das Modul Bereitstellungsräume verteilt werden (Ereignis `bereitstellungsraum`
mit der Kennung des Raums). ETB-Einträge des Moduls MUST NOT eine Koordinate enthalten.

#### Scenario: Nur Koordinate geändert
- **WHEN** ein Raum verortet wird und sonst nichts geändert wird
- **THEN** entsteht kein ETB-Eintrag
- **AND** Personen mit Lesezugriff auf das Modul Bereitstellungsräume erhalten ein Live-Ereignis zum Raum

#### Scenario: Inbetriebnahme nach Verortung
- **WHEN** ein verorteter Raum in Betrieb genommen wird
- **THEN** lautet der ETB-Eintrag wie bisher „Bereitstellungsraum <Bezeichnung> in Betrieb genommen“, ohne Koordinate

### Requirement: Lage-Snapshot und Schwärzung

Ein Lage-Snapshot SHALL die nicht stornierten Bereitstellungsräume des Einsatzes zum Zeitpunkt der
Aufnahme einfrieren, mit Status, Koordinate und Kennzahlen der Belegung. Beim Abruf MUST der
Snapshot diese Inhalte für Personen ohne Lesezugriff auf das Modul Bereitstellungsräume weglassen.
Ein Snapshot ohne dieses Feld MUST als „keine Räume“ gelten. Die Schwärzung eines Einsatzes MUST
die Koordinate der Räume als operatives Geo-Skelett erhalten.

#### Scenario: Snapshot ohne Modulrecht
- **WHEN** eine Person ohne Lesezugriff auf das Modul Bereitstellungsräume einen Snapshot abruft
- **THEN** enthält die Antwort keine Bereitstellungsräume

#### Scenario: Stand sichern ohne Modulrecht
- **WHEN** eine Person mit Schreibrecht auf die Lagekarte, aber ohne Lesezugriff auf das Modul Bereitstellungsräume einen Stand sichert oder Bezeichnung und Notiz eines Standes ändert
- **THEN** enthält auch diese Antwort keine Bereitstellungsräume, eingefroren werden sie trotzdem

#### Scenario: Schwärzung
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** bleibt die Koordinate der Räume erhalten, während Standort und Notiz wie bisher geleert werden

### Requirement: Bereitstellungsräume als Marker

Die Lagekarte SHALL jeden verorteten Bereitstellungsraum im Status „geplant“ oder „aktiv“ als
Marker an seiner Koordinate zeigen, mit dem Führungszeichen D.2.1 „Bereitstellungsraum“ der
Bibliothek `@einsatzzeichen`. Die Marker MUST eine eigene, schaltbare Ebene
„Bereitstellungsräume“ bilden, die mit der Anzahl ihrer Marker in der Ebenenliste steht. Die
Beschriftung MUST die Bezeichnung tragen, bei einem aktiven Raum dahinter die Stärke im Raum
(Führer/Unterführer/Mannschaft//Summe) und die Zahl der Fahrzeuge („3 Fz“), soweit belegt. Die
Zahl der Fahrzeuge MUST aus den Kennzahlen der Belegung des Servers kommen, die Stärke aus der
Einheitenliste über dieselbe Rechnung wie Liste und Detailseite; ist sie unvollständig, MUST sie
in der Beschriftung fehlen statt zu klein dazustehen. Ein geplanter Raum MUST gestrichelt
erscheinen (ein gestrichelter Ring um das Zeichen) und in der Beschriftung das Wort „geplant“
tragen. Aufgelöste und stornierte Räume MUST weder als Marker noch in einer Liste der Karte
erscheinen. Die Auswahl eines Markers MUST Bezeichnung, Status, Stärke, Fahrzeuge, Einheiten,
den Beginn der längsten Wartezeit und den Abschnitt zeigen und einen Sprung zur Detailseite des
Raums anbieten. Jeder Marker MUST eine Trefferzone in der Steuerhöhe der aktiven Dichtestufe
tragen.

#### Scenario: Verorteter Raum mit Belegung
- **WHEN** der aktive Raum „BR Sportplatz“ verortet ist und eine Einheit mit Stärke 0/2/9//11 sowie drei Fahrzeuge in ihm stehen
- **THEN** zeigt die Karte an seiner Koordinate das Raumzeichen mit der Beschriftung „BR Sportplatz · 0/2/9//11 · 3 Fz“

#### Scenario: Geplanter Raum
- **WHEN** der verortete Raum „BR Nord“ den Status „geplant“ hat
- **THEN** trägt sein Zeichen einen gestrichelten Ring und die Beschriftung „BR Nord · geplant“

#### Scenario: Aufgelöster Raum
- **WHEN** ein verorteter Raum aufgelöst wird
- **THEN** verschwindet sein Marker von der Karte

#### Scenario: Einheitenliste fehlt
- **WHEN** die Einheitenliste für die Person nicht freigegeben ist
- **THEN** trägt die Beschriftung eines belegten Raums keine Stärke, und der Inspector zeigt „—“ als Stärke

#### Scenario: Sprung zur Detailseite
- **WHEN** der Marker ausgewählt und „Im Fachmodul öffnen“ gewählt wird
- **THEN** öffnet sich die Detailseite dieses Raums

#### Scenario: Ebene ausblenden
- **WHEN** die Ebene „Bereitstellungsräume“ ausgeschaltet wird
- **THEN** zeigt die Karte keinen Raum-Marker

### Requirement: Nicht verortete Räume platzieren

Die Lagekarte SHALL Räume im Status „geplant“ oder „aktiv“ ohne Koordinate in der Liste „Nicht
verortet“ führen. Eine Person mit Schreibrecht MUST einen solchen Raum von dort aus durch einen
Klick in die Karte verorten können. Die Adresse
`/einsaetze/<id>/lagekarte?platzieren=bereitstellungsraum:<raum-id>` MUST die Karte in den
Platziermodus für diesen Raum schicken und den Parameter danach aus der Adresse entfernen; ohne
Schreibrecht oder ohne Lesezugriff auf das Modul Bereitstellungsräume MUST der Platziermodus
nicht betreten werden. Die Detailseite eines Raums MUST an den Raumdaten einen Einstieg zu dieser
Adresse anbieten, „Auf Karte verorten“ bzw. bei einem verorteten Raum „Auf Karte versetzen“,
sofern die Person den Raum bearbeiten darf; ist die Lagekarte für sie gesperrt, MUST der
Einstieg gesperrt mit Grund im sichtbaren Text stehen. Das Verorten MUST keinen ETB-Eintrag
schreiben.

#### Scenario: Aus der Detailseite verorten
- **WHEN** eine Person mit Schreibrecht an den Raumdaten von „BR Sportplatz“ „Auf Karte verorten“ wählt und in die Karte klickt
- **THEN** trägt der Raum die Koordinate des Klickpunkts, erscheint als Marker, und die Adresse enthält kein `platzieren` mehr
- **AND** es entsteht kein ETB-Eintrag

#### Scenario: Aus der Liste platzieren
- **WHEN** eine Person mit Schreibrecht in „Nicht verortet“ den Raum „BR Nord“ wählt und in die Karte klickt
- **THEN** trägt der Raum die Koordinate des Klickpunkts und steht nicht mehr in „Nicht verortet“

#### Scenario: Ohne Modulrecht
- **WHEN** eine Person ohne Lesezugriff auf das Modul Bereitstellungsräume die Platzieren-Adresse aufruft
- **THEN** betritt die Karte keinen Platziermodus

#### Scenario: Lagekarte gesperrt
- **WHEN** die Lagekarte für eine Person gesperrt ist, die den Raum bearbeiten darf
- **THEN** steht an den Raumdaten „Auf Karte verorten (Keine Berechtigung)“ gesperrt

#### Scenario: Verortung entfernen
- **WHEN** eine Person mit Schreibrecht am ausgewählten Marker „Verortung löschen“ wählt
- **THEN** verliert der Raum seine Koordinate und steht wieder in „Nicht verortet“

### Requirement: Modulfreigabe und gesicherter Stand auf der Karte

Die Lagekarte MUST die Räume nur anfragen, wenn der Server das Modul Bereitstellungsräume für die
Person freigibt; ohne bekannte Freigaben MUST sie nicht anfragen. Ein gesperrtes Modul MUST in
der Ebenenliste als gesperrte Zeile mit Grund und ohne Zahl stehen, ein im Einsatz
ausgeblendetes Modul ohne Zeile; beides MUST NOT als Ausfall einer Lagebild-Quelle gemeldet
werden, auch nicht eine trotz Freigabe mit 403 abgelehnte Liste. Die Objektsuche der Karte MUST
ohne Freigabe keinen Raum finden. Änderungen an Koordinate, Status und Belegung MUST die Karte
ohne Neuladen erreichen. Im gesicherten Stand MUST die Karte die eingefrorenen Räume mit Status
und Belegung zeigen; ein Stand ohne Räume MUST keinen Fehler melden.

#### Scenario: Ohne Freigabe
- **WHEN** der Server einer Person das Modul Bereitstellungsräume verweigert
- **THEN** fragt die Karte keine Räume an, zeigt die Ebene gesperrt mit Grund und meldet keinen Ausfall

#### Scenario: Live
- **WHEN** eine andere Person einen Raum verortet, während die Karte offen ist
- **THEN** erscheint sein Marker ohne Neuladen

#### Scenario: Historienansicht
- **WHEN** ein gesicherter Stand mit einem geplanten, verorteten Raum aufgerufen wird
- **THEN** zeigt die Karte den Raum gestrichelt an der eingefrorenen Koordinate, auch wenn er inzwischen aktiv ist
