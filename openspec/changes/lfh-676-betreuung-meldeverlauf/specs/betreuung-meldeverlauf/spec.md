# Spec Delta

## Purpose

Die Stand- und Belegungsmeldungen des Fachmoduls Betreuung werden als Verlauf lesbar. Aus dem
Verlauf heraus lässt sich jede einzelne Meldung zurücknehmen, auch eine ältere Fehlmeldung,
die der Rückgängig-Toast direkt nach dem Melden nicht mehr erreicht.

## ADDED Requirements

### Requirement: Meldereihe eines Evakuierungsbezirks lesen

Das System SHALL je Evakuierungsbezirk die vollständige Reihe seiner Standmeldungen liefern,
zurückgenommene Meldungen eingeschlossen. Die Reihe MUST nach Zeitpunkt absteigend geordnet
sein, bei gleichem Zeitpunkt nach Erfassungsreihenfolge absteigend, also in der Reihenfolge,
in der das System den aktuellen Stand bestimmt. Jede Meldung MUST ihre Kennung, die Anzahl
„evakuiert“, die Erhebungsart, den Zeitpunkt, den Erfassungszeitpunkt und den Anzeigenamen
der erfassenden Person tragen. Jede Meldung MUST angeben, ob sie der aktuelle Stand des
Bezirks ist. Genau die Meldung, die der Bezirk als aktuellen Stand führt, MUST als aktuell
markiert sein. Eine zurückgenommene Meldung MUST den Zeitpunkt der Rücknahme und den
Anzeigenamen der zurücknehmenden Person tragen. Bei einer nicht zurückgenommenen Meldung MUST
beides fehlen. Zeitpunkte MUST als UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`) übertragen
werden.

#### Scenario: Reihe mit Nachtragung und Rücknahme
- **WHEN** für einen Bezirk nacheinander 212 (10:00), 480 (11:00), 300 mit Zeitpunkt 10:30 (nachgetragen) gemeldet und danach 212 zurückgenommen wird
- **THEN** liefert die Reihe die Meldungen in der Folge 480, 300, 212
- **AND** nur 480 ist als aktuell markiert
- **AND** 212 trägt Zeitpunkt und Person der Rücknahme

#### Scenario: Bezirk ohne Meldung
- **WHEN** die Reihe eines Bezirks ohne Standmeldung abgerufen wird
- **THEN** ist die Reihe leer

#### Scenario: Stornierter Bezirk
- **WHEN** die Reihe eines stornierten Bezirks abgerufen wird
- **THEN** liefert das System die Reihe, denn Lesen ist kein Lebenszyklus-Vorgang

#### Scenario: Bezirk eines anderen Einsatzes
- **WHEN** die Reihe mit der Kennung eines Bezirks abgerufen wird, der zu einem anderen Einsatz gehört oder nicht existiert
- **THEN** antwortet das System mit 404

### Requirement: Meldereihe einer Betreuungsstelle lesen

Das System SHALL je Betreuungsstelle die vollständige Reihe ihrer Belegungsmeldungen liefern,
nach denselben Regeln wie die Reihe eines Bezirks: Ordnung, Marke „aktuell“,
Rücknahmeangaben, Zeitformat und 404 für fremde oder unbekannte Stellen. An die Stelle von
„evakuiert“ und Erhebungsart tritt die Anzahl „belegt“.

#### Scenario: Reihe einer Stelle
- **WHEN** für „Turnhalle Ost“ 60 und danach 89 gemeldet werden
- **THEN** liefert die Reihe 89 vor 60, und 89 ist als aktuell markiert

#### Scenario: Geschlossene Stelle
- **WHEN** die Reihe einer geschlossenen Stelle abgerufen wird
- **THEN** liefert das System die Reihe unverändert

### Requirement: Rechte am Verlauf

Die Lese-Endpunkte der Meldereihen MUST dieselben Rechte verlangen wie die übrigen lesenden
Endpunkte des Moduls Betreuung: Lesezugriff auf den Einsatz und das Modul. Ein Beobachter
MUST den Verlauf lesen können. Ein Zurücknehmen aus dem Verlauf MUST über die bestehenden
Rücknahme-Endpunkte laufen und deren Rechte, Statuscodes und ETB-Wirkung unverändert haben.

#### Scenario: Beobachter liest den Verlauf
- **WHEN** ein Benutzer ohne Schreibrecht die Reihe eines Bezirks abruft
- **THEN** liefert das System die Reihe

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul Betreuung für den Einsatz ausgeblendet ist und ein Nicht-Admin eine Reihe abruft
- **THEN** antwortet das System mit 403

#### Scenario: Fremde Organisation
- **WHEN** ein Benutzer einer anderen Organisation eine Reihe abruft
- **THEN** antwortet das System mit 403 oder 404 und gibt keine Meldung preis

### Requirement: Verlauf auf der Betreuungsseite

Die Betreuungsseite SHALL an jeder Bezirkskarte und an jeder Stellenzeile einen
Aufklappbereich „Verlauf“ anbieten. Der Auslöser MUST beschriftet sein, seinen Zustand
(auf- oder zugeklappt) zugänglich melden und die Bezeichnung des Bezirks bzw. der Stelle im
zugänglichen Namen tragen. Er MUST ohne Schreibrecht verfügbar sein. Die Reihe MUST erst
beim Aufklappen geladen werden. Während des Ladens, bei einem Fehler und bei leerer Reihe MUST
der Bereich den jeweiligen Zustand in Worten nennen. Ein Ladefehler MUST NOT als leere Reihe
erscheinen.

#### Scenario: Aufklappen lädt die Reihe
- **WHEN** der Verlauf eines Bezirks aufgeklappt wird
- **THEN** wird seine Reihe abgerufen und im Bereich angezeigt
- **AND** vor dem Aufklappen wurde sie nicht abgerufen

#### Scenario: Ladefehler
- **WHEN** der Abruf der Reihe scheitert
- **THEN** nennt der Bereich den Fehler und zeigt nicht „keine Meldungen“

#### Scenario: Neue Meldung bei geöffnetem Verlauf
- **WHEN** bei geöffnetem Verlauf eine andere Person für denselben Bezirk einen Stand meldet
- **THEN** erscheint die neue Meldung im Verlauf ohne Neuladen der Seite

### Requirement: Kennzeichnung im Verlauf

Jede Meldung im Verlauf MUST Anzahl, Zeitpunkt und erfassende Person zeigen, beim Stand
zusätzlich die Erhebungsart. Die aktuelle Meldung, nachgetragene Meldungen und
zurückgenommene Meldungen MUST jeweils durch ein Wort erkennbar sein, nicht allein durch
Farbe. Eine Meldung gilt im Verlauf als nachgetragen, wenn ihr Zeitpunkt mindestens 60
Sekunden vor ihrem Erfassungszeitpunkt liegt. Das ist dieselbe Schwelle wie für
nachgetragene ETB-Einträge. Eine nachgetragene Meldung MUST den Erfassungszeitpunkt nennen.
Eine zurückgenommene Meldung MUST Zeitpunkt und Person der Rücknahme nennen. Zeiten MUST in
der Anzeigezone erscheinen, nicht in UTC, und in derselben Schreibweise wie die Stand-Zeit
auf Karte und Tabelle der Seite.

#### Scenario: Nachgetragene Meldung
- **WHEN** eine Meldung mit Zeitpunkt 10:30 um 11:05 erfasst wurde
- **THEN** zeigt der Verlauf 10:30 als Zeitpunkt und „nachgetragen um“ mit dem Erfassungszeitpunkt 11:05

#### Scenario: Zeitnah erfasste Meldung
- **WHEN** eine Meldung 20 Sekunden nach ihrem Zeitpunkt erfasst wurde
- **THEN** trägt sie keine Nachtragungskennzeichnung

#### Scenario: Zurückgenommene Meldung
- **WHEN** eine Meldung zurückgenommen ist
- **THEN** nennt der Verlauf bei ihr „zurückgenommen“ mit Uhrzeit und Person
- **AND** sie ist nicht als aktuell markiert

### Requirement: Zurücknehmen aus dem Verlauf

Mit Schreibrecht SHALL jede nicht zurückgenommene Meldung im Verlauf einen Auslöser
„Zurücknehmen“ tragen, dessen zugänglicher Name Anzahl und Uhrzeit der Meldung nennt. Weil
eine Rücknahme nicht umkehrbar ist, MUST vor dem Zurücknehmen eine Rückfrage stehen. Sie
nennt die Meldung und sagt, ob es der aktuelle Stand ist. Ihr bestätigender Knopf ist als
Gefahr gekennzeichnet. Scheitert die Rücknahme, MUST der Grund in der Rückfrage stehen
bleiben, bis sie geschlossen oder erneut bestätigt wird. Eine zurückgenommene Meldung MUST
keinen Auslöser tragen. Ohne Schreibrecht MUST kein Auslöser erscheinen. An einer
geschlossenen Betreuungsstelle MUST statt der Auslöser einmal im Verlauf stehen, dass eine
Rücknahme erst nach Wiederinbetriebnahme möglich ist.

#### Scenario: Ältere Fehlmeldung zurücknehmen
- **WHEN** bei aktuellem Stand 480 die nachgetragene Meldung 300 aus dem Verlauf zurückgenommen und die Rückfrage bestätigt wird
- **THEN** ist 300 im Verlauf als zurückgenommen gekennzeichnet
- **AND** der aktuelle Stand bleibt 480
- **AND** das ETB enthält die Berichtigung „bleibt 480“

#### Scenario: Rückfrage abbrechen
- **WHEN** die Rückfrage abgebrochen wird
- **THEN** wird nichts zurückgenommen

#### Scenario: Rücknahme scheitert
- **WHEN** die Rücknahme mit einem Fehler beantwortet wird
- **THEN** bleibt die Rückfrage offen und nennt den Grund

#### Scenario: Geschlossene Stelle
- **WHEN** der Verlauf einer geschlossenen Stelle mit Schreibrecht geöffnet wird
- **THEN** trägt keine Meldung einen Auslöser „Zurücknehmen“
- **AND** der Verlauf nennt einmal, dass die Stelle erst wieder in Betrieb gesetzt werden muss
