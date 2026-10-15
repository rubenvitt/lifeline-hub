# bereitstellungsraum-belegung Specification

## Purpose
Ein Bereitstellungsraum zeigt, wer wie lange wartet: je Kraft im Raum den Zeitpunkt, seit dem
sie dort steht, zu jeder Einheit ihre Fahrzeuge, je Raum die Kennzahlen der Belegung (Einheiten,
Fahrzeuge einschließlich der Fahrzeuge der Einheiten, längste Wartezeit) und die vollständige
Reihe seiner Belegungsereignisse. Liste und Detail lesen dieselben Kennzahlen, das gekoppelte
Gerät des Raums liest den Verlauf des eigenen Raums mit. Am Raum bucht die Führung oder das Gerät
des Raums das Eintreffen einer Kraft, auch einer unangemeldeten, die das System als Einheit mit
Meldung an die Einsatzleitung anlegt; die Führung übernimmt oder weist sie ab.

## Requirements

### Requirement: Wartezeit je Kraft im Raum
Das Detail eines Bereitstellungsraums SHALL für jede Einheit und jedes einheitenlose Fahrzeug,
das im Raum steht, den Zeitpunkt nennen, seit dem es dort steht („seit“). „Seit“ MUST der
Zeitpunkt des jüngsten Belegungsereignisses des Objekts sein, gemessen an der
Erfassungsreihenfolge, und MUST nur dann gesetzt sein, wenn dieses Ereignis ein Eintritt oder
ein Wechsel in genau diesen Raum ist; sonst MUST „seit“ fehlen. Ein früherer Eintritt in einen
anderen Raum MUST „seit“ nicht bestimmen. Zeitpunkte MUST als UTC ohne Zonenkennung
(`YYYY-MM-DD HH:MM:SS`) übertragen werden.

#### Scenario: Eintritt
- **WHEN** die Einheit „1. Zug“ um 13:42 in den BR Sportplatz eintritt
- **THEN** nennt das Detail des BR Sportplatz für „1. Zug“ „seit“ 13:42

#### Scenario: Wechsel zwischen zwei Räumen
- **WHEN** „1. Zug“ um 13:42 in den BR Sportplatz eintritt und um 14:10 in den BR Schule wechselt
- **THEN** nennt das Detail des BR Schule für „1. Zug“ „seit“ 14:10, nicht 13:42
- **AND** das Detail des BR Sportplatz führt „1. Zug“ nicht mehr

#### Scenario: Belegung ohne Ereignis
- **WHEN** eine Einheit im Raum steht, für die kein Eintritt oder Wechsel in diesen Raum als
  jüngstes Ereignis vorliegt
- **THEN** führt das Detail die Einheit ohne „seit“

### Requirement: Fahrzeuge der Einheiten im Raum
Das Detail eines Bereitstellungsraums SHALL zu jeder Einheit im Raum ihre aktiven Fahrzeuge mit
Kennung und Funkrufnamen nennen. Fahrzeuge, die entlassen oder storniert sind, MUST fehlen. Die
Fahrzeuge einer Untereinheit MUST nur dann erscheinen, wenn die Untereinheit selbst im Raum
steht. Die einheitenlosen Fahrzeuge im Raum MUST weiter getrennt davon stehen.

#### Scenario: Einheit mit Fahrzeug
- **WHEN** die Einheit „1. Zug“ mit dem Fahrzeug „Florian 1/44-1“ im BR Sportplatz steht
- **THEN** nennt das Detail bei „1. Zug“ das Fahrzeug „Florian 1/44-1“

#### Scenario: Untereinheit außerhalb des Raums
- **WHEN** „1. Zug“ im BR Sportplatz steht und seine Untereinheit „Gruppe 2“ mit eigenem Fahrzeug
  in keinem Raum steht
- **THEN** nennt das Detail das Fahrzeug der „Gruppe 2“ nicht

### Requirement: Kennzahlen der Belegung
Das System SHALL je Bereitstellungsraum drei Kennzahlen der Belegung liefern: die Zahl der
Einheiten im Raum (Untereinheiten, die selbst im Raum stehen, einzeln gezählt), die Zahl der
Fahrzeuge im Raum und den frühesten „seit“-Zeitpunkt der Kräfte im Raum („längste Wartezeit“).
Die Fahrzeugzahl MUST die einheitenlosen Fahrzeuge im Raum und die aktiven Fahrzeuge der
Einheiten im Raum umfassen und MUST jedes Fahrzeug genau einmal zählen. Kräfte ohne „seit“ MUST
den frühesten Zeitpunkt nicht bestimmen; hat keine Kraft ein „seit“, MUST er fehlen. Liste und
Detail MUST dieselben Kennzahlen aus derselben Berechnung liefern.

#### Scenario: Fahrzeuge der Einheiten zählen mit
- **WHEN** im BR Sportplatz zwei Einheiten mit je einem Fahrzeug und ein Fahrzeug ohne Einheit
  stehen
- **THEN** ist die Fahrzeugzahl des Raums 3 und die Zahl der Einheiten 2

#### Scenario: Ein Fahrzeug doppelt geführt
- **WHEN** ein Fahrzeug als einheitenloses Fahrzeug im Raum geführt wird und zugleich einer
  Einheit im Raum angehört
- **THEN** zählt es in der Fahrzeugzahl einmal

#### Scenario: Längste Wartezeit
- **WHEN** im Raum eine Einheit seit 13:42 und ein Fahrzeug seit 14:05 stehen
- **THEN** ist der früheste „seit“-Zeitpunkt des Raums 13:42

#### Scenario: Liste gleich Detail
- **WHEN** die Liste der Bereitstellungsräume und das Detail des BR Sportplatz abgerufen werden
- **THEN** tragen beide für den BR Sportplatz dieselbe Zahl der Einheiten, dieselbe Fahrzeugzahl
  und denselben frühesten „seit“-Zeitpunkt

### Requirement: Liste der Räume mit Belegung
Die Liste der Bereitstellungsräume SHALL je Raum neben den Raumdaten den Namen seines Abschnitts,
die Kennzahlen der Belegung und die Kennungen der Einheiten im Raum tragen. Die Kennzahlen MUST
für alle Räume mit einer festen Zahl von Abfragen entstehen, unabhängig von der Zahl der Räume.
Ein gekoppeltes Gerät eines Bereitstellungsraums MUST weiter nur seinen eigenen Raum erhalten.

#### Scenario: Raum mit Abschnitt
- **WHEN** der BR Sportplatz dem Abschnitt „Nord“ zugeordnet ist und zwei Einheiten trägt
- **THEN** nennt die Liste beim BR Sportplatz „Nord“, die Kennungen beider Einheiten und ihre
  Kennzahlen

### Requirement: Verlauf eines Raums lesen
Das System SHALL je Bereitstellungsraum die vollständige Reihe seiner Belegungsereignisse liefern,
ungeblättert, neueste zuerst nach Erfassungsreihenfolge. Die Reihe MUST Eintritte, Wechsel in den
Raum, Wechsel aus dem Raum in einen anderen Raum und Austritte enthalten, auch Austritte durch
Auflösen einer Einheit oder Entlassen eines Fahrzeugs. Jeder Eintrag MUST Zeitpunkt, Art,
Objekttyp, Objektkennung, Objektname und, falls erfasst, die Notiz tragen; ein Wechsel in den Raum
MUST den Herkunftsraum, ein Wechsel aus dem Raum den Zielraum nennen. Ein Objekt, das inzwischen
aufgelöst oder entlassen ist, MUST mit seinem Namen erscheinen. Auch ein stornierter oder
aufgelöster Raum MUST seine Reihe liefern. Ein Raum eines anderen Einsatzes oder ein unbekannter
Raum MUST mit 404 antworten.

#### Scenario: Reihe mit Wechsel und Austritt
- **WHEN** „1. Zug“ in den BR Sportplatz eintritt, danach in den BR Schule wechselt und dort
  austritt
- **THEN** zeigt die Reihe des BR Sportplatz „Wechsel nach BR Schule“ vor „Eintritt“
- **AND** die Reihe des BR Schule zeigt „Austritt“ vor „Wechsel von BR Sportplatz“

#### Scenario: Austritt durch Auflösen
- **WHEN** eine Einheit, die im BR Sportplatz steht, aufgelöst wird
- **THEN** zeigt die Reihe des BR Sportplatz einen Austritt dieser Einheit mit der Notiz
  „Einheit aufgelöst“

#### Scenario: Raum ohne Belegung
- **WHEN** die Reihe eines Raums ohne Belegungsereignis abgerufen wird
- **THEN** ist die Reihe leer

#### Scenario: Raum eines anderen Einsatzes
- **WHEN** die Reihe mit der Kennung eines Raums abgerufen wird, der zu einem anderen Einsatz
  gehört
- **THEN** antwortet das System mit 404

### Requirement: Rechte am Verlauf
Der Verlauf MUST dieselben Rechte verlangen wie das Detail eines Bereitstellungsraums:
Lesezugriff auf den Einsatz und das Modul Bereitstellungsräume. Ein Beobachter MUST den Verlauf
lesen können. Ist das Modul für den Einsatz ausgeblendet, MUST ein Nicht-Admin 403 erhalten.

#### Scenario: Beobachter liest den Verlauf
- **WHEN** ein Benutzer ohne Schreibrecht den Verlauf eines Raums abruft
- **THEN** liefert das System die Reihe

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul Bereitstellungsräume für den Einsatz ausgeblendet ist und ein Nicht-Admin den
  Verlauf abruft
- **THEN** antwortet das System mit 403

### Requirement: Belegung bleibt live aktuell
Ändert sich, was das Detail eines Bereitstellungsraums über seine Kräfte trägt, SHALL das System
für diesen Raum das Live-Ereignis `bereitstellungsraum` senden. Das MUST gelten für Belegen,
Auflösen und Entlassen wie bisher und zusätzlich, wenn ein Fahrzeug einer Einheit im Raum
zugeordnet, von ihr freigegeben, aus dem Einsatz entlassen oder umbenannt wird, wenn ein Fahrzeug
von einer Einheit im Raum zu einer anderen umgehängt wird (beide Räume), wenn beim Bilden einer
Einheit aus einer Vorlage ein Fahrzeug aus einer Einheit im Raum umgehängt wird und wenn eine
Einheit im Raum umbenannt wird. Ohne Änderung MUST kein Ereignis entstehen.

#### Scenario: Fahrzeug kommt zur Einheit im Raum
- **WHEN** einer Einheit im BR Sportplatz ein Fahrzeug zugeordnet wird
- **THEN** erhalten die Leser des BR Sportplatz das Ereignis `bereitstellungsraum`, auch ohne
  Recht auf Einheiten oder Fahrzeuge

#### Scenario: Einheit in keinem Raum
- **WHEN** einer Einheit, die in keinem Raum steht, ein Fahrzeug zugeordnet wird
- **THEN** entsteht kein Ereignis `bereitstellungsraum`

#### Scenario: Einheit im Raum umbenannt
- **WHEN** die Einheit „1. Zug“ im BR Sportplatz in „1. Zug Nord“ umbenannt wird
- **THEN** erhalten die Leser des BR Sportplatz das Ereignis `bereitstellungsraum`

### Requirement: Eintreffen einer bekannten Kraft buchen
Das System SHALL eine Einheit oder ein einheitenloses Fahrzeug des Einsatzes über
`POST /api/einsaetze/{id}/bereitstellungsraeume/{bid}/eintreffen` in einen Bereitstellungsraum
einbuchen. In einer Transaktion MUST dabei der Eintritt in den Raum entstehen, bei einer Einheit
das Ereignis `eintreffen` in der Kräfte-Zeitachse mit Quelle `bereitstellungsraum` und genau ein
ETB-Eintrag. Trägt die offene Periode der Einheit schon ein Eintreffen, MUST das Ereignis
ausgelassen werden und die Buchung trotzdem gelingen. Ein Fahrzeug MUST kein Zeitachsen-Ereignis
erhalten. Eine Kraft, die schon in einem Bereitstellungsraum steht, aufgelöst oder entlassen ist,
oder ein Fahrzeug einer Einheit MUST mit 409 abgelehnt werden; nichts wird geschrieben. Eine
Kraft eines anderen Einsatzes MUST mit 404 abgelehnt werden. Nennt die Anfrage weder eine
bekannte noch eine unangemeldete Kraft, MUST das System mit 400 antworten, nennt sie beides, mit
422.

#### Scenario: Erwartete Einheit trifft ein
- **WHEN** die Einheit „HLF 20 FF Musterstadt“ ohne Eintreffen um 1430 am BR Sportplatz gebucht wird
- **THEN** steht sie im BR Sportplatz, ihre Zeitachse trägt ein Eintreffen 1430 mit Quelle `bereitstellungsraum`, und das ETB erhält genau einen Eintrag „HLF 20 FF Musterstadt im BR Sportplatz eingetroffen“

#### Scenario: Schon eingetroffen
- **WHEN** eine Einheit, deren offene Periode ein Eintreffen um 1400 trägt, um 1430 am BR gebucht wird
- **THEN** steht sie im BR, ihre Zeitachse trägt weiter genau ein Eintreffen (1400), und das ETB nennt den Eintritt in den Bereitstellungsraum

#### Scenario: Schon in einem Raum
- **WHEN** eine Einheit, die im BR Schule steht, am BR Sportplatz gebucht wird
- **THEN** antwortet das System mit 409, und weder Belegung noch Zeitachse noch ETB ändern sich

#### Scenario: Kraft eines anderen Einsatzes
- **WHEN** die Anfrage eine Einheit nennt, die zu einem anderen Einsatz gehört
- **THEN** antwortet das System mit 404, und nichts ist geschrieben

### Requirement: Unangemeldete Kraft erfassen
Das System SHALL über dieselbe Route eine Kraft erfassen, die im Einsatz noch nicht geführt wird:
Funkrufname (Pflicht), Organisation, Fahrzeugtyp, gemeldete Stärke F/UF/M und Bemerkung (je
optional) sowie bis zu `SAMMEL_MAX` Fahrzeuge. In einer Transaktion MUST genau eine neue Einheit
mit diesen Fahrzeugen als Ad-hoc-Fahrzeugen, der Eintritt der Einheit in den Raum, ihr Eintreffen
in der Zeitachse, eine Meldung an die Einsatzleitung und genau ein ETB-Eintrag entstehen.
Scheitert ein Schritt, MUST nichts davon bestehen bleiben. Ein fehlender oder leerer Funkrufname,
mehr als `SAMMEL_MAX` Fahrzeuge, Funkrufname, Organisation oder Fahrzeugtyp über 200 Zeichen,
eine Bemerkung über 2 000 Zeichen oder eine unvollständige oder negative Stärke MUST mit 400
abgelehnt werden. Die gemeldete Stärke MUST
nur im Text von Meldung und ETB stehen und MUST NOT die Soll-Stärke der Einheit setzen. Die
Bemerkung MUST an der Einheit stehen und MUST NOT in Meldung oder ETB stehen.

#### Scenario: Unangemeldetes Fahrzeug
- **WHEN** der Einweiser am BR Sportplatz „FL-MUS 1-44-1“, Organisation „FF Musterstadt“, Typ „HLF 20“, Stärke 1/1/7 unangemeldet bucht
- **THEN** gibt es genau eine neue Einheit „FL-MUS 1-44-1“ mit genau einem Fahrzeug, einen Belegungseintrag, ein Eintreffen, eine Meldung an die Einsatzleitung und einen ETB-Eintrag, der „unangemeldet“ und die Stärke 1/1/7 nennt

#### Scenario: Fehler mitten in der Erfassung
- **WHEN** das Schreiben des Belegungseintrags nach dem Anlegen der Einheit scheitert
- **THEN** antwortet das System mit einem Fehler, und es gibt keine neue Einheit, kein Fahrzeug, keine Meldung, kein Ereignis und keinen ETB-Eintrag

#### Scenario: Verband mit zwei Fahrzeugen
- **WHEN** eine unangemeldete Kraft mit den Fahrzeugen „FL-MUS 1-44-1“ und „FL-MUS 1-19-1“ gebucht wird
- **THEN** gehören beide Fahrzeuge der neuen Einheit an, und nur die Einheit trägt einen Belegungseintrag

#### Scenario: Stärke nicht als Soll
- **WHEN** eine unangemeldete Kraft mit Stärke 1/1/7 gebucht wird
- **THEN** hat die neue Einheit keine Soll-Stärke

#### Scenario: Funkrufname zu lang
- **WHEN** eine unangemeldete Kraft mit einem Funkrufnamen von 201 Zeichen gebucht wird
- **THEN** antwortet das System mit 400, und nichts ist angelegt

### Requirement: Meldung an die Einsatzleitung bei unangemeldeter Kraft
Die Meldung einer unangemeldeten Kraft SHALL die neue Einheit als strukturierten Absender tragen,
ohne Abschnitt, die Empfängerfunktion Einsatzleitung, Bestätigungspflicht, Priorität normal und
nicht die Meldungsart Sofortmeldung. Ihr Inhalt MUST Funkrufname, Organisation, Fahrzeugtyp,
Stärke, den Raum und dessen Abschnitt nennen, soweit bekannt. Die Benachrichtigung „Neue
Meldung“ an die Einsatzleitung MUST nach dem Commit genau einmal entstehen, auch wenn dieselbe
Erfassung erneut gesendet wird. Genau ein ETB-Eintrag MUST entstehen: bei aktivem Auto-ETB der
Eintrag der Meldung, sonst ein System-Eintrag mit ihrem Inhalt.

#### Scenario: Einsatzleitung erfährt es
- **WHEN** am BR Sportplatz im Abschnitt Nord eine unangemeldete Kraft gebucht wird
- **THEN** erhalten die Nutzer der Funktion Einsatzleitung einen Hinweis „Neue Meldung“, und die Meldung nennt BR Sportplatz und Abschnitt Nord

#### Scenario: Ein Eintrag im Tagebuch
- **WHEN** bei aktivem Auto-ETB eine unangemeldete Kraft gebucht wird
- **THEN** trägt das ETB genau einen neuen Eintrag, den der Meldung

### Requirement: Doppelbuchung erkennen
Trägt eine aktive Einheit oder ein aktives Fahrzeug des Einsatzes denselben Funkrufnamen wie die
unangemeldete Kraft (ohne Unterschied von Groß- und Kleinschreibung und Leerzeichen), MUST das
System mit 422 und einem Grund ablehnen, der die vorhandene Kraft nennt, und nichts schreiben.
Bestätigt die Anfrage die Neuanlage ausdrücklich, MUST die Kraft trotzdem angelegt werden.

#### Scenario: Schon im Einsatz
- **WHEN** „FL-MUS 1-44-1“ als Fahrzeug im Einsatz geführt wird und am BR als unangemeldet „fl-mus 1-44-1“ gebucht wird
- **THEN** antwortet das System mit 422 und nennt „FL-MUS 1-44-1“, und nichts ist angelegt

#### Scenario: Trotzdem neu anlegen
- **WHEN** dieselbe Erfassung mit ausdrücklicher Bestätigung gesendet wird
- **THEN** ist die Kraft angelegt

### Requirement: Eintreffen nur am aktiven Raum und mit Rechten
Ein Eintreffen MUST Schreibrecht am Modul Bereitstellungsräume verlangen; eine unangemeldete Kraft
MUST zusätzlich das Recht an den Modulen Einheiten und Fahrzeuge verlangen und sonst mit 403
abgelehnt werden, bevor etwas geschrieben wird. Ein Raum, der nicht `aktiv` oder storniert ist,
MUST mit 422 ablehnen. Ein Recht an Meldungen oder an der Zeitachse MUST NOT nötig sein.

#### Scenario: Raum geplant
- **WHEN** eine Kraft an einem BR mit Status `geplant` gebucht wird
- **THEN** antwortet das System mit 422, und nichts ist geschrieben

#### Scenario: Einheiten gesperrt
- **WHEN** eine Person mit BR-Schreibrecht, aber ohne Recht am Modul Einheiten eine unangemeldete Kraft bucht
- **THEN** antwortet das System mit 403, und nichts ist angelegt

### Requirement: Eintreffen ist idempotent
Eine Erfassung mit `client_id` SHALL je Einsatz höchstens einmal wirken. Ein erneutes Senden mit
derselben `client_id` MUST das gespeicherte Ergebnis liefern und nichts erneut anlegen,
auch wenn der Raum oder der Einsatz inzwischen nicht mehr aktiv ist; eine neue Erfassung an
einem abgeschlossenen Einsatz MUST mit 409 abgelehnt werden. Dieselbe `client_id` für einen
anderen Raum MUST mit 422 abgelehnt werden; ein Gerät, das die `client_id` einer fremden
Erfassung sendet, MUST 409 erhalten. Ein mitgesendeter Erfassungszeitpunkt MUST für Belegung,
Zeitachse und Meldung gelten; liegt er mehr als 60 Sekunden in der Zukunft, MUST das System mit
400 antworten.

#### Scenario: Replay nach Netzausfall
- **WHEN** eine unangemeldete Kraft mit `client_id` „a1“ gebucht und dieselbe Anfrage danach erneut gesendet wird
- **THEN** antworten beide mit derselben Einheit, und es gibt genau eine Einheit, ein Fahrzeug, einen Belegungseintrag, eine Meldung und eine Benachrichtigung

#### Scenario: Erfassung von vorhin
- **WHEN** eine um 1412 vorgemerkte Erfassung um 1430 gesendet wird
- **THEN** tragen Belegung und Eintreffen den Zeitpunkt 1412

#### Scenario: Replay nach Einsatzabschluss
- **WHEN** eine schon gebuchte Erfassung nach dem Abschluss des Einsatzes erneut gesendet wird
- **THEN** liefert das System das gespeicherte Ergebnis, und eine neue Erfassung dort erhält 409

### Requirement: Kennzeichen „nicht übernommen“ und Herkunft
Eine unangemeldet erfasste Einheit SHALL bis zu ihrer Übernahme als „nicht übernommen“ gelten.
Einheiten-Antwort und Belegung des Raums MUST das als `nicht_uebernommen_seit` liefern und die
Herkunft als `unangemeldet` dauerhaft, auch nach der Übernahme. Nach Übernahme oder Abweisen MUST
`nicht_uebernommen_seit` fehlen.

#### Scenario: Kennzeichen geliefert
- **WHEN** die Führung nach einer unangemeldeten Buchung die Einheitenliste abruft
- **THEN** trägt die neue Einheit `nicht_uebernommen_seit` mit dem Erfassungszeitpunkt und `unangemeldet`

#### Scenario: Herkunft bleibt
- **WHEN** die Einheit übernommen wurde und weiter im BR steht
- **THEN** liefert ihre Belegungszeile `unangemeldet` und kein `nicht_uebernommen_seit` mehr

### Requirement: Unangemeldete Einheit übernehmen
Die Führung SHALL eine nicht übernommene Einheit über
`POST /api/einsaetze/{id}/einheiten/{eid}/uebernehmen` übernehmen können, optional mit Abschnitt
und Über-Einheit nach den Regeln der Einheiten-Änderung. Die Übernahme MUST das Kennzeichen
aufheben, die Meldung des Eintreffens bestätigen und genau einen ETB-Eintrag schreiben, der die
gewählte Unterstellung nennt, und MUST NOT die Einheit aus dem Bereitstellungsraum nehmen. Sie
MUST das Recht am Modul Einheiten verlangen. Eine Einheit ohne offene Übernahme MUST mit 422,
eine aufgelöste mit 409 abgelehnt werden.

#### Scenario: Übernehmen mit Abschnitt
- **WHEN** die Einsatzleitung „FL-MUS 1-44-1“ mit Abschnitt Nord übernimmt
- **THEN** trägt die Einheit kein Kennzeichen mehr, gehört dem Abschnitt Nord an, steht weiter im BR, die Meldung ist bestätigt, und das ETB nennt „Einheit «FL-MUS 1-44-1» übernommen, Abschnitt Nord“

#### Scenario: Zweimal übernommen
- **WHEN** eine schon übernommene Einheit erneut übernommen werden soll
- **THEN** antwortet das System mit 422

### Requirement: Unangemeldete Einheit abweisen
Die Führung SHALL eine nicht übernommene Einheit über
`POST /api/einsaetze/{id}/einheiten/{eid}/abweisen` abweisen können. In einer Transaktion MUST
die Einheit aufgelöst werden (Austritt aus dem Raum, Entlassung in der Zeitachse), jedes ihrer
Fahrzeuge entlassen, die Meldung des Eintreffens bestätigt und genau ein ETB-Eintrag geschrieben
werden. Abweisen MUST die Rechte an den Modulen Einheiten und Fahrzeuge verlangen; eine
aufgelöste Einheit MUST mit 409, eine Einheit ohne offene Übernahme mit 422 abgelehnt werden.

#### Scenario: Abweisen
- **WHEN** die Einsatzleitung „FL-MUS 1-44-1“ abweist
- **THEN** verzeichnet der BR ihren Austritt, die Einheit ist aufgelöst, ihre Zeitachse trägt die Entlassung, ihr Fahrzeug ist entlassen, die Meldung ist bestätigt, und das ETB trägt genau einen Eintrag „Einheit «FL-MUS 1-44-1» abgewiesen …“
