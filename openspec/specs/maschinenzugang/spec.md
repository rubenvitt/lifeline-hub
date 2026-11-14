# maschinenzugang Specification

## Purpose

Fremdsysteme wie Alarm-Adapter, Lagemonitor oder das Einsatzbuch der iuk-suite melden sich an
der öffentlichen API unter `/api/v1/` mit einem eigenen Schlüsselpaar an. Jede Anfrage ist
signiert und an eine Org und feste Scopes gebunden. Ein Admin legt den Zugang an, sieht, was er
tut, und widerruft ihn ohne Nebenwirkungen.

## Requirements

### Requirement: Ein Maschinenzugang gehört einer Org und trägt feste Scopes

Ein System-Admin SHALL Maschinenzugänge nur für seine eigene Org anlegen, ändern und widerrufen
können. Ein Zugang MUST einen Namen und mindestens einen Scope tragen. Optional hat er „gültig
bis“. Scopes MUST aus `lage:read`, `einsaetze:read`, `events:read`, `alarmmeldungen:write`,
`positionen:write` und `rechner:use` stammen. Ein unbekannter Scope MUST mit 400 abgewiesen
werden.

#### Scenario: Anlegen
- **WHEN** ein System-Admin einen Zugang „Alarm-Adapter Wache 1“ mit `alarmmeldungen:write` anlegt
- **THEN** erscheint der Zugang mit Name, Scope und Zustand „wartet auf Schlüssel“ in der Liste seiner Org, und die Antwort enthält einen Einmal-Code

#### Scenario: Ändern in der Ansicht
- **WHEN** ein System-Admin in der Ansicht eines Zugangs nur die Scopes ändert, während ein anderer Admin denselben Zugang seit dem Öffnen umbenannt hat
- **THEN** sendet die Seite nur die Scopes mit dem Stand beim Öffnen, der Server antwortet 409 „Zwischenzeitlich geändert“ und ändert nichts, und erst „Meine Änderung übernehmen“ setzt die Scopes, ohne den neuen Namen zu überschreiben

#### Scenario: Unbekannter Scope
- **WHEN** die Anlage den Scope `alles:write` nennt
- **THEN** antwortet der Server mit 400 und legt nichts an

#### Scenario: Fremde Org
- **WHEN** ein System-Admin einen Zugang einer anderen Org ändern oder widerrufen will
- **THEN** antwortet der Server mit 404

#### Scenario: Kein System-Admin
- **WHEN** ein Konto ohne System-Admin-Rolle einen Zugang anlegen will
- **THEN** antwortet der Server mit 403

### Requirement: Ein Einmal-Code bindet den Schlüssel des Fremdsystems

Der Code SHALL aus 16 Zeichen Crockford-Base32 bestehen, 15 Minuten gelten und genau einmal
eingelöst werden können. Der Server MUST ihn nur abgeleitet speichern. Beim Einlösen MUST das
Fremdsystem seinen öffentlichen Ed25519-Schlüssel mit einem aus dem Code abgeleiteten Prüfwert
schicken, nie den Code selbst. Die Ableitung trägt das Salz `lifeline-machine-client/1`.

#### Scenario: Einlösen
- **WHEN** ein Fremdsystem einen offenen Code mit gültigem Prüfwert an `POST /api/v1/zugang/redeem` schickt
- **THEN** bindet der Server den Schlüssel an den Zugang und antwortet mit Zugangs-ID, Instanz-UUID, öffentlichem Instanzschlüssel und dem Prüfwert der Instanz

#### Scenario: Zweites Einlösen
- **WHEN** derselbe Code ein zweites Mal eingelöst wird
- **THEN** antwortet der Server mit 401 und ändert am Zugang nichts

#### Scenario: Abgelaufener Code
- **WHEN** ein Code nach mehr als 15 Minuten eingelöst wird
- **THEN** antwortet der Server mit 401

#### Scenario: Falscher Prüfwert
- **WHEN** der Prüfwert nicht zum Code und zum mitgeschickten Schlüssel passt
- **THEN** antwortet der Server mit 401, bindet keinen Schlüssel und der Code bleibt einlösbar

### Requirement: Jede Anfrage eines Fremdsystems ist einzeln signiert

Eine Route, die einen Maschinenzugang verlangt, SHALL nur Anfragen mit Kopf
`Authorization: Machine <jws>` annehmen. Das JWS ist EdDSA-signiert und hat `typ`
`lifeline-machine+jwt`, `kid` = Zugangs-ID und die Claims `iss`, `aud` (Instanz-UUID), `iat`,
`exp`, `jti`, `htm`, `htu` (Pfad mit Abfrage) und `bh` (SHA-256 des Bodys). Es MUST höchstens 60 s
gelten. Die Uhren dürfen um bis zu 5 min abweichen.

#### Scenario: Gültige Anfrage
- **WHEN** ein Fremdsystem `GET /api/v1/me` mit einem gültigen JWS aufruft
- **THEN** antwortet der Server mit 200

#### Scenario: Anderer Body
- **WHEN** der Body nicht zum Claim `bh` passt
- **THEN** antwortet der Server mit 401

#### Scenario: Anderer Pfad oder andere Methode
- **WHEN** das JWS für `GET /api/v1/me` ausgestellt ist und an eine andere Route oder mit anderer Methode geschickt wird
- **THEN** antwortet der Server mit 401

#### Scenario: Andere Instanz
- **WHEN** `aud` nicht die UUID dieser Instanz ist
- **THEN** antwortet der Server mit 401

#### Scenario: Anderer Algorithmus
- **WHEN** der Kopf `alg` einen anderen Wert als `EdDSA` oder einen anderen `typ` trägt
- **THEN** antwortet der Server mit 401, ohne eine Signatur zu prüfen

### Requirement: Ein JWS gilt genau einmal

Der Server SHALL jede `jti` eines Zugangs speichern, bis das JWS samt Uhrtoleranz abgelaufen ist.
Ein zweites JWS mit derselben `jti` desselben Zugangs MUST mit 401 abgewiesen werden. Gespeicherte
`jti` werden danach aufgeräumt.

#### Scenario: Wiederholung
- **WHEN** dasselbe JWS ein zweites Mal geschickt wird
- **THEN** antwortet der Server mit 401

### Requirement: Eine gescheiterte Anmeldung antwortet ohne Grund

Scheitert die Anmeldung eines Fremdsystems, SHALL der Server mit 401 und dem Code `unauthorized`
antworten, ohne den Grund zu nennen. Dazu zählen unbekannter Zugang, Signatur, Uhr, Pfad, Body,
Wiederholung, Ablauf und Widerruf. Ist der Zugang bekannt, MUST der Grund am Zugang gespeichert
werden. Bei einer Uhrabweichung MUST auch die Abweichung gespeichert werden.

#### Scenario: Uhr weicht ab
- **WHEN** ein Fremdsystem mit einer Uhr, die 7 min nachgeht, eine Anfrage signiert
- **THEN** bekommt es 401 ohne Grund, und die Seite „Anbindungen“ zeigt am Zugang „Uhr geht 7 min nach“ mit Zeitpunkt

#### Scenario: Unbekannter Zugang
- **WHEN** ein JWS eine unbekannte Zugangs-ID im `kid` trägt
- **THEN** antwortet der Server mit 401 und schreibt an keinen Zugang einen Grund

### Requirement: Widerruf und Ablauf wirken sofort

Ein widerrufener Zugang SHALL ab dem Widerruf keine Anfrage mehr durchbringen. Dasselbe gilt für
einen Zugang nach seinem „gültig bis“. Ein Widerruf MUST NOT eine Instanzkopplung, einen Spiegel
oder einen anderen Zugang berühren. Widerrufene Zugänge MUST mit Zeitpunkt und handelndem Admin
sichtbar bleiben.

#### Scenario: Widerruf
- **WHEN** ein Admin einen Zugang widerruft und das Fremdsystem danach eine gültig signierte Anfrage schickt
- **THEN** antwortet der Server mit 401

#### Scenario: Ablauf
- **WHEN** „gültig bis“ eines Zugangs verstrichen ist
- **THEN** antwortet der Server auf jede Anfrage dieses Zugangs mit 401, und die Seite zeigt ihn als abgelaufen

### Requirement: Ein fehlender Scope ergibt 403

Ist ein Fremdsystem angemeldet, aber fehlt seinem Zugang der Scope der Route, SHALL der Server
mit 403 und dem Code `missing_scope` antworten. Geprüft wird in dieser Reihenfolge: Anmeldung
(Signatur, Wiederholung, Widerruf und Ablauf), Scope, Org. Eine Route ohne Scope-Anforderung,
etwa `GET /api/v1/me`, MUST jedem angemeldeten Zugang offenstehen.

#### Scenario: Fehlender Scope
- **WHEN** ein Zugang nur mit `alarmmeldungen:write` eine Route aufruft, die `lage:read` verlangt
- **THEN** antwortet der Server mit 403 und dem Code `missing_scope`

### Requirement: Die Prüfroute nennt Zugang, Scopes und Serverzeit

`GET /api/v1/me` SHALL einem angemeldeten Fremdsystem seine Zugangs-ID, den Namen des Zugangs,
die Org (Kennung und Name), seine Scopes, „gültig bis“, die Serverzeit und die Abweichung seiner
Uhr in Sekunden liefern. Zeitpunkte MUST in UTC im Format `JJJJ-MM-TT hh:mm:ss` stehen.

#### Scenario: Erste Anbindung
- **WHEN** ein Fremdsystem nach dem Einlösen `GET /api/v1/me` signiert aufruft
- **THEN** bekommt es Zugangs-ID, Org, Scopes und Serverzeit, und die Uhrabweichung entspricht der Differenz zwischen Serverzeit und seinem `iat`

### Requirement: Antworten an Fremdsysteme sind signiert

Jede erfolgreiche Antwort auf eine angemeldete Anfrage SHALL eine Signatur der Instanz tragen.
Sie bindet Instanz, Zugang, die `jti` der Anfrage, Status und Hash des Bodys. Der öffentliche
Instanzschlüssel MUST beim Einlösen mitkommen und unter `GET /api/v1/instanz/jwks.json` ohne
Anmeldung abrufbar sein. Ein Fremdsystem darf die Prüfung auslassen.

#### Scenario: Antwortsignatur prüfen
- **WHEN** ein Fremdsystem die Antwortsignatur von `GET /api/v1/me` mit dem Schlüssel aus dem Einlösen prüft
- **THEN** ist sie gültig und nennt die `jti` seiner Anfrage

#### Scenario: Schlüssel abrufen
- **WHEN** jemand ohne Anmeldung `GET /api/v1/instanz/jwks.json` aufruft
- **THEN** bekommt er den öffentlichen Ed25519-Schlüssel der Instanz als JWK mit der Instanz-UUID als `kid`

### Requirement: Kein Bearer-Token und keine Sitzung unter /api/v1/

Eine Route unter `/api/v1/` MUST NOT ein Bearer-Token, ein Sitzungs-Cookie oder ein geteiltes
Geheimnis als Anmeldung annehmen. Eine Anmelderoute der eigenen Oberfläche MUST NOT
`Authorization: Machine` annehmen. Einzige Ausnahme ist der Einwurf (Spec `einwurf-zugang`): Die
Routen unter `/api/v1/einwurf/` nehmen einen Schlüssel im Pfad an, schreiben nur und lesen
nichts. Ein Einwurf-Schlüssel MUST NOT an einer anderen Route als Anmeldung gelten.

#### Scenario: Bearer
- **WHEN** eine Anfrage an `GET /api/v1/me` oder `GET /api/v1/lage` `Authorization: Bearer …` trägt, auch mit einem früher ausgegebenen Lagemonitor-Schlüssel
- **THEN** antwortet der Server mit 401

#### Scenario: Sitzung
- **WHEN** ein angemeldeter Admin `GET /api/v1/me` mit seinem Sitzungs-Cookie aufruft
- **THEN** antwortet der Server mit 401

#### Scenario: Einwurf-Schlüssel an einer anderen Route
- **WHEN** eine Anfrage an `GET /api/v1/me` einen gültigen Einwurf-Schlüssel im Kopf `Authorization` oder in der Abfrage trägt
- **THEN** antwortet der Server mit 401

### Requirement: Schlüsselwechsel über einen neuen Code

Ein Admin SHALL für einen bestehenden Zugang einen neuen Code ausstellen können. Wird er
eingelöst, MUST der Zugang den neuen Schlüssel annehmen. Der alte Schlüssel MUST so lange gelten,
bis der neue zum ersten Mal eine gültige Anfrage signiert hat; danach MUST der alte abgewiesen
werden. Ein offener Code ersetzt einen früheren offenen Code desselben Zugangs.

#### Scenario: Wechsel
- **WHEN** ein Fremdsystem einen neuen Code einlöst, danach mit dem alten Schlüssel und dann mit dem neuen Schlüssel signiert
- **THEN** gelingen beide Anfragen, und eine weitere Anfrage mit dem alten Schlüssel ergibt 401

#### Scenario: Neuer Code ersetzt alten
- **WHEN** ein Admin zweimal hintereinander einen Code für denselben Zugang ausstellt
- **THEN** lässt sich nur der zweite einlösen

### Requirement: Jeder Zugang ist gedrosselt

Der Server SHALL je Zugang einen Vorrat von 60 Anfragen halten, der sich um eine je Sekunde
auffüllt; im Mittel sind das 60 je Minute. Ist er leer, MUST der Server mit 429, dem Code
`rate_limited` und `Retry-After` in ganzen Sekunden antworten. Eine gedrosselte Anfrage MUST NOT
ihre `jti` verbrauchen.

#### Scenario: Zu viele Anfragen
- **WHEN** ein Zugang 61 gültig signierte Anfragen im selben Augenblick schickt
- **THEN** bekommt die 61. eine 429 mit `Retry-After` von mindestens 1

### Requirement: Fehlversuche von Maschinen sperren nie die Anmeldung von Menschen

Der Server SHALL je Quelle in einem eigenen Zähler für Maschinen nur unbekannte Zugangs-IDs,
gescheiterte Einlösungen und unbekannte Einwurf-Schlüssel zählen. Nach 10 Fehlversuchen in 5
Minuten MUST er sie auf den Maschinenwegen, auch beim Einwurf, mit 429 abweisen. Der Zähler MUST
NOT die Anmeldesperre für Passwort, Passkey oder Gerätekopplung berühren. Falsche Signatur oder
Uhr eines bekannten Zugangs und ein widerrufener, abgelaufener oder abgelöster Einwurf-Schlüssel
MUST NOT zählen.

#### Scenario: Falsche Uhr hinter NAT
- **WHEN** ein bekannter Zugang hinter derselben IP wie eine Wache mehr als zehnmal mit falscher Uhr signiert
- **THEN** bleibt die Passwort-Anmeldung von dieser IP möglich, und die Maschinenwege dieser IP sind nicht gesperrt

#### Scenario: Durchprobieren von Zugangs-IDs
- **WHEN** eine Quelle in 5 Minuten zehn Anfragen mit unbekannten Zugangs-IDs schickt
- **THEN** antwortet der Server auf weitere Maschinen-Anfragen dieser Quelle mit 429, und die Passwort-Anmeldung von dort bleibt möglich

#### Scenario: Durchprobieren von Einwurf-Schlüsseln
- **WHEN** eine Quelle in 5 Minuten zehn Einwürfe mit unbekannten Schlüsseln schickt
- **THEN** antwortet der Server auf weitere Einwürfe dieser Quelle mit 429, auch mit gültigem Schlüssel, und die Passwort-Anmeldung von dort bleibt möglich

#### Scenario: Abgelöster Einwurf-Schlüssel hinter NAT
- **WHEN** ein Admin den Schlüssel eines Einwurf-Zugangs wechselt und der Absender hinter derselben IP wie eine Wache weiter mehr als zehnmal mit dem alten Schlüssel einwirft
- **THEN** bekommt er jedes Mal 401, und der neue Schlüssel wird von dieser IP angenommen

#### Scenario: Widerrufener Einwurf-Schlüssel hinter NAT
- **WHEN** ein Absender hinter derselben IP wie eine Wache mehr als zehnmal mit einem widerrufenen Einwurf-Schlüssel einwirft
- **THEN** bekommt er jedes Mal 401, und die Maschinenwege dieser IP sind nicht gesperrt

### Requirement: Admin-Spur und Abrufprotokoll

Anlegen, Code ausstellen, Schlüssel gebunden, Ändern und Widerruf eines Zugangs SHALL je einen
Eintrag in der Admin-Spur der Org schreiben, mit Zugang, Name, Scopes, gegebenenfalls
Fingerabdruck und Quell-IP. Das Binden beim Einlösen schreibt ohne handelnde Person. Anlegen,
Ändern, Entfernen und Wiederaufnehmen eines Webhooks sowie das Ein- und Ausschalten seiner
LAN-Ausnahme SHALL je einen Eintrag schreiben, mit Zugang, Name und Host des Ziels. Jede
angenommene Anfrage MUST im Abrufprotokoll je Zugang, Route und Tag zählen. Das Protokoll MUST
365 Tage aufbewahrt werden.

#### Scenario: Anlegen und Widerruf im Audit
- **WHEN** ein Admin einen Zugang anlegt und später widerruft
- **THEN** zeigt das Zugangsprotokoll beide Einträge mit Admin, Zugang und Zeitpunkt in Klartext

#### Scenario: Abrufe zählen
- **WHEN** ein Zugang an einem Tag dreimal `GET /api/v1/me` aufruft
- **THEN** steht im Abrufprotokoll für diesen Zugang, diese Route und diesen Tag die Anzahl 3 mit erstem und letztem Zeitpunkt, und die Seite zeigt „zuletzt genutzt“

#### Scenario: LAN-Ausnahme im Audit
- **WHEN** ein Admin an einem Webhook die LAN-Ausnahme einschaltet
- **THEN** zeigt das Zugangsprotokoll einen eigenen Eintrag mit Admin, Zugang, Host des Ziels und Zeitpunkt, getrennt vom Eintrag für das Ändern des Ziels

#### Scenario: Testzustellung ohne Eintrag
- **WHEN** ein Admin ein Testereignis sendet
- **THEN** entsteht kein Eintrag in der Admin-Spur, weil sich am Zugang nichts ändert

### Requirement: Ein gekoppelter ELW nimmt keine Fremdsysteme an

Meldet sich eine Instanz für eine Org bei einer anderen Instanz (aktive Kopplung, meldende
Seite), SHALL sie für diese Org keine Maschinenzugänge anlegen und keine Anfrage eines
Maschinenzugangs dieser Org annehmen. Die Seite „Anbindungen“ MUST den Grund nennen.

#### Scenario: Anlegen am ELW
- **WHEN** ein Admin an einem ELW, der sich für seine Org bei einem Hub meldet, einen Zugang anlegen will
- **THEN** ist das Anlegen gesperrt, die Seite nennt den Hub als Ort für Anbindungen, und der Server antwortet auf die Anlage mit 409

#### Scenario: Anfrage am ELW
- **WHEN** ein Zugang angelegt wurde, bevor die Org gekoppelt wurde, und danach eine Anfrage schickt
- **THEN** antwortet der Server mit 401, und am Zugang steht der Grund „Instanz meldet sich bei einem Hub“

### Requirement: Fremdsysteme kommen mit Kommando, Referenz-Clients und Testvektoren an

Das Projekt SHALL dokumentierte Testvektoren bereitstellen: fester Schlüssel, feste Zeit,
Anfrage, erwartetes JWS und erwarteter Prüfwert. Sie MUST auch Zustellungen von Webhooks samt
ungültiger Fälle abdecken. Der Server, der Rust-Client, das TypeScript-Modul und das
Python-Beispiel MUST gegen dieselben Vektoren geprüft werden. Das Binary SHALL
`lifeline-hub zugang redeem <url> <code>` anbieten. Es erzeugt ein Schlüsselpaar, löst den Code
ein und legt eine nur für den Besitzer lesbare Schlüsseldatei ab.

#### Scenario: Kommando
- **WHEN** ein Betreiber `lifeline-hub zugang redeem https://hub.example ABCD-EFGH-JKMN-PQRS` ausführt
- **THEN** liegt danach eine Schlüsseldatei mit Zugangs-ID, Instanz-UUID, Basis-URL und Schlüsseln vor, und das Kommando nennt den Fingerabdruck, den der Admin an der Seite vergleicht

#### Scenario: Vektoren driften
- **WHEN** jemand das Format der Claims ändert, ohne die Testvektoren neu zu schreiben
- **THEN** schlägt mindestens ein Test im Sammel-Gate fehl

#### Scenario: Webhook-Vektoren driften
- **WHEN** jemand die Claims einer Webhook-Zustellung ändert, ohne die Testvektoren neu zu schreiben
- **THEN** schlägt mindestens ein Test im Sammel-Gate fehl

### Requirement: Einsatzbezogenes Lesen braucht die Freigabe der Einsatzleitung

Die Einsatzleitung eines aktiven Einsatzes SHALL diesen Einsatz für einen Maschinenzugang der Org
des Einsatzes freigeben und die Freigabe wieder beenden können, sofern der Zugang nicht
widerrufen oder abgelaufen ist und einen Lese-Scope mit Einsatzbezug trägt (`lage:read`,
`einsaetze:read`). Die
Seite „Geräte“ des Einsatzes MUST diese Zugänge im Paneel „Anbindungen“ mit Name, Rechten und
Zustand zeigen. Freigabe und Ende MUST im Einsatztagebuch stehen.

#### Scenario: Freigeben
- **WHEN** die Einsatzleitung im Paneel „Anbindungen“ den Schalter des Zugangs „FüKW Monitor“ einschaltet
- **THEN** zeigt die Zeile „liest diesen Einsatz“, und das Einsatztagebuch nennt die Freigabe mit dem Namen des Zugangs und der handelnden Person

#### Scenario: Freigabe beenden
- **WHEN** die Einsatzleitung den Schalter wieder ausschaltet
- **THEN** liest der Zugang den Einsatz nicht mehr, und das Einsatztagebuch nennt das Ende der Freigabe

#### Scenario: Zugang ohne Leserecht mit Einsatzbezug
- **WHEN** ein Zugang nur `alarmmeldungen:write` trägt
- **THEN** steht er nicht im Paneel „Anbindungen“, und eine Freigabe für ihn antwortet 404

#### Scenario: Nicht die Einsatzleitung
- **WHEN** ein Mitglied ohne die Rolle Einsatzleitung oder ein System-Admin ohne Rolle im Einsatz freigeben will
- **THEN** antwortet der Server mit 403

#### Scenario: Instanz meldet sich bei einem Hub
- **WHEN** die Instanz sich für die Org bei einem Hub meldet und kein Zugang den Einsatz liest
- **THEN** zeigt das Paneel „Anbindungen“ keinen Zugang, und eine Freigabe antwortet 404

#### Scenario: Abgelehntes Umschalten an einer überholten Zeile
- **WHEN** ein Admin den einzigen Zugang des Paneels widerruft und die Einsatzleitung ihn einschaltet, bevor das Paneel nachgefragt hat
- **THEN** bleibt das Paneel mit dem Grund der Ablehnung und dem Namen des Zugangs stehen, bis die Einsatzleitung den Hinweis schließt

#### Scenario: Ohne Verbindung
- **WHEN** die Einsatzleitung ohne Verbindung zum Server ist
- **THEN** sind die Schalter gesperrt, daneben steht „Ohne Verbindung nicht änderbar“, und keine Freigabe wird vorgemerkt

#### Scenario: Zugang einer fremden Org
- **WHEN** die Einsatzleitung einen Zugang einer anderen Org freigeben will
- **THEN** antwortet der Server mit 404

#### Scenario: Abgeschlossener Einsatz
- **WHEN** jemand an einem abgeschlossenen Einsatz freigeben will
- **THEN** antwortet der Server mit 409, und die Schalter des Paneels sind gesperrt

#### Scenario: Zugang nur mit Ereignissen
- **WHEN** ein Zugang nur `events:read` trägt
- **THEN** steht er nicht im Paneel „Anbindungen“, denn allein öffnet dieses Recht keinen Einsatz

### Requirement: Ein Zugang liest höchstens einen Einsatz

Für einen Maschinenzugang MUST höchstens ein Einsatz freigegeben sein. Gibt die Einsatzleitung
einen zweiten Einsatz für denselben Zugang frei, SHALL die frühere Freigabe enden. Das
Einsatztagebuch des neuen Einsatzes MUST die Freigabe nennen, das des früheren die Umstellung,
sofern die Instanz ihn führt oder die handelnde Person dort zur Führung gehört. Ein Einsatz kann
für mehrere Zugänge freigegeben sein.

#### Scenario: Umstellen
- **WHEN** der Zugang den Einsatz A liest und die Einsatzleitung des Einsatzes B ihn dort einschaltet
- **THEN** liest der Zugang nur noch den Einsatz B, im Paneel des Einsatzes A steht „liest einen anderen Einsatz“, und beide Einsatztagebücher nennen die Umstellung

#### Scenario: Früherer Einsatz ist ein Spiegel ohne Rolle der Person
- **WHEN** der Zugang einen gespiegelten Einsatz liest und eine Einsatzleitung ohne Rolle in diesem Einsatz ihn an ihrem eigenen Einsatz einschaltet
- **THEN** liest der Zugang den neuen Einsatz, und für den früheren entsteht kein Antrag

#### Scenario: Zwei Zugänge an einem Einsatz
- **WHEN** die Einsatzleitung denselben Einsatz für zwei Zugänge freigibt
- **THEN** lesen beide Zugänge diesen Einsatz

### Requirement: Eine Freigabe ruht, solange die Instanz sich bei einem Hub meldet

Liest ein Zugang einen Einsatz und meldet sich die Instanz danach für die Org bei einem Hub,
SHALL die Freigabe bestehen bleiben und nach dem Ende der Kopplung wieder gelten. Solange die
Kopplung besteht, MUST das Paneel „Anbindungen“ des Einsatzes diesen Zugang mit „Freigabe ruht:
Instanz meldet sich bei einem Hub“ zeigen, und die Einsatzleitung MUST die Freigabe dort beenden
können. Eine neue Freigabe MUST NOT möglich sein, solange die Kopplung besteht.

#### Scenario: Kopplung bei bestehender Freigabe
- **WHEN** der Zugang „FüKW Monitor“ den Einsatz liest und die Instanz sich danach für die Org bei einem Hub meldet
- **THEN** antwortet der Server dem Zugang mit 401, und das Paneel des Einsatzes zeigt nur diesen Zugang, mit „Freigabe ruht: Instanz meldet sich bei einem Hub“

#### Scenario: Ruhende Freigabe beenden
- **WHEN** die Einsatzleitung den Schalter der ruhenden Freigabe ausschaltet
- **THEN** endet die Freigabe, das Einsatztagebuch nennt das Ende, und der Zugang liest den Einsatz auch nach dem Ende der Kopplung nicht

#### Scenario: Kopplung endet
- **WHEN** die Kopplung endet, der Einsatz noch läuft und niemand die Freigabe beendet hat
- **THEN** liest der Zugang den Einsatz wieder

### Requirement: Die Freigabe geht auch an einem Spiegel

Hält die Instanz einen aktiven Einsatz als Spiegel, SHALL die Einsatzleitung ihn dort ebenso für
einen Maschinenzugang freigeben und die Freigabe beenden können. Der Eintrag im Einsatztagebuch
MUST dann als Antrag an die führende Instanz gehen. Die Freigabe selbst MUST an der Instanz
bleiben, an der der Zugang angelegt ist, und wird nicht gespiegelt.

#### Scenario: Freigabe am Hub für einen vom ELW geführten Einsatz
- **WHEN** ein ELW den Einsatz führt, der Hub ihn als Spiegel hält und die Einsatzleitung am Hub einen Zugang einschaltet
- **THEN** liest der Zugang am Hub den gespiegelten Einsatz, und der Eintrag zur Freigabe geht als Antrag an den ELW

#### Scenario: Ende ohne laufenden Abgleich
- **WHEN** der Abgleich des Spiegels beendet ist und die Einsatzleitung die Freigabe beendet
- **THEN** endet die Freigabe, auch ohne dass ein Antrag entsteht

### Requirement: Die Freigabe endet mit Einsatz, Zugang oder Recht

Eine Freigabe SHALL enden, sobald der Einsatz abgeschlossen ist, der Zugang widerrufen wird, sein
„gültig bis“ verstrichen ist oder sich seine Lese-Scopes mit Einsatzbezug ändern, durch Entzug wie
durch Hinzufügen. Nach dem Ende MUST der Zugang den Einsatz nicht mehr lesen, bis die
Einsatzleitung erneut freigibt. Führt die Instanz den Einsatz, MUST dessen Einsatztagebuch
Widerruf und Änderung der Rechte nennen.

#### Scenario: Einsatzabschluss
- **WHEN** die Einsatzleitung einen freigegebenen Einsatz abschließt
- **THEN** ist für den Zugang kein Einsatz mehr freigegeben

#### Scenario: Widerruf des Zugangs
- **WHEN** ein Admin den Zugang widerruft, während er einen Einsatz liest
- **THEN** antwortet der Server dem Zugang mit 401, und das Einsatztagebuch des Einsatzes nennt den Widerruf

#### Scenario: Abgelaufen und verlängert
- **WHEN** das „gültig bis“ eines Zugangs verstreicht, während er einen Einsatz liest, und ein Admin es danach verlängert
- **THEN** ist kein Einsatz freigegeben, bis die Einsatzleitung erneut freigibt

#### Scenario: Recht entzogen und wieder erteilt
- **WHEN** ein Admin dem Zugang `lage:read` entzieht und es ihm später wieder gibt
- **THEN** ist kein Einsatz freigegeben, bis die Einsatzleitung erneut freigibt

#### Scenario: Recht mit Einsatzbezug hinzugefügt
- **WHEN** ein Admin einem Zugang, der einen Einsatz mit `einsaetze:read` liest, zusätzlich `lage:read` gibt
- **THEN** ist kein Einsatz mehr freigegeben, `GET /api/v1/lage` antwortet mit `einsatz: null`, und das Einsatztagebuch nennt die Änderung der Rechte

#### Scenario: Eines von zwei Rechten entzogen
- **WHEN** ein Admin einem Zugang mit `lage:read` und `einsaetze:read` eines der beiden nimmt
- **THEN** ist kein Einsatz mehr freigegeben, bis die Einsatzleitung erneut freigibt

#### Scenario: Recht ohne Einsatzbezug geändert
- **WHEN** ein Admin einem Zugang, der einen Einsatz liest, `rechner:use` gibt oder nimmt
- **THEN** bleibt die Freigabe bestehen

### Requirement: Die Anbindung zeigt den gelesenen Einsatz

Die Seite „Anbindungen“ SHALL an jedem Zugang, für den sich ein Einsatz freigeben lässt (nicht
widerrufen, nicht abgelaufen, mit einem Lese-Scope mit Einsatzbezug), zeigen, welchen Einsatz er
gerade liest, oder dass keiner freigegeben ist. An einer Instanz, die sich für die Org bei einem
Hub meldet, MUST die Seite an keinem Zugang einen gelesenen Einsatz nennen.

#### Scenario: Zugang liest einen Einsatz
- **WHEN** die Einsatzleitung den Einsatz „Stadtfest“ für den Zugang freigegeben hat und ein Admin die Seite „Anbindungen“ öffnet
- **THEN** steht an der Zeile des Zugangs „liest Stadtfest“

#### Scenario: Keine Freigabe
- **WHEN** der Zugang `lage:read` trägt und kein Einsatz für ihn freigegeben ist
- **THEN** steht an seiner Zeile „kein Einsatz freigegeben“

#### Scenario: Widerrufener Zugang
- **WHEN** der Zugang widerrufen ist
- **THEN** nennt seine Zeile weder einen Einsatz noch „kein Einsatz freigegeben“
