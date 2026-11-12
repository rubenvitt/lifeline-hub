# Spec Delta

## Purpose

Fremdsysteme wie Alarm-Adapter, Lagemonitor oder das Einsatzbuch der iuk-suite melden sich an
der öffentlichen API unter `/api/v1/` mit einem eigenen Schlüsselpaar an. Jede Anfrage ist
signiert und an eine Org und feste Scopes gebunden. Ein Admin legt den Zugang an, sieht, was er
tut, und widerruft ihn ohne Nebenwirkungen.

## ADDED Requirements

### Requirement: Ein Maschinenzugang gehört einer Org und trägt feste Scopes

Ein System-Admin SHALL Maschinenzugänge nur für seine eigene Org anlegen, ändern und widerrufen
können. Ein Zugang MUST einen Namen und mindestens einen Scope tragen. Optional hat er „gültig
bis“. Scopes MUST aus `lage:read`, `einsaetze:read`, `events:read`, `alarmmeldungen:write`,
`positionen:write` und `rechner:use` stammen. Ein unbekannter Scope MUST mit 400 abgewiesen
werden.

#### Scenario: Anlegen
- **WHEN** ein System-Admin einen Zugang „Alarm-Adapter Wache 1“ mit `alarmmeldungen:write` anlegt
- **THEN** erscheint der Zugang mit Name, Scope und Zustand „wartet auf Schlüssel“ in der Liste seiner Org, und die Antwort enthält einen Einmal-Code

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
`Authorization: Machine` annehmen.

#### Scenario: Bearer
- **WHEN** eine Anfrage an `GET /api/v1/me` `Authorization: Bearer …` trägt, auch mit einem gültigen Lagemonitor-Schlüssel
- **THEN** antwortet der Server mit 401

#### Scenario: Sitzung
- **WHEN** ein angemeldeter Admin `GET /api/v1/me` mit seinem Sitzungs-Cookie aufruft
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

Der Server SHALL je Quelle in einem eigenen Zähler für Maschinen nur unbekannte Zugangs-IDs und
gescheiterte Einlösungen zählen. Nach 10 solchen Fehlversuchen in 5 Minuten MUST er diese Quelle
auf den Maschinenwegen mit 429 abweisen. Dieser Zähler MUST NOT die Anmeldesperre für Passwort,
Passkey oder Gerätekopplung berühren. Eine falsche Signatur oder Uhr eines bekannten Zugangs MUST
NOT in ihm zählen.

#### Scenario: Falsche Uhr hinter NAT
- **WHEN** ein bekannter Zugang hinter derselben IP wie eine Wache mehr als zehnmal mit falscher Uhr signiert
- **THEN** bleibt die Passwort-Anmeldung von dieser IP möglich, und die Maschinenwege dieser IP sind nicht gesperrt

#### Scenario: Durchprobieren von Zugangs-IDs
- **WHEN** eine Quelle in 5 Minuten zehn Anfragen mit unbekannten Zugangs-IDs schickt
- **THEN** antwortet der Server auf weitere Maschinen-Anfragen dieser Quelle mit 429, und die Passwort-Anmeldung von dort bleibt möglich

### Requirement: Admin-Spur und Abrufprotokoll

Anlegen, Code ausstellen, Schlüssel gebunden, Ändern und Widerruf eines Zugangs SHALL je einen
Eintrag in der Admin-Spur der Org schreiben, mit Zugang, Name, Scopes, gegebenenfalls
Fingerabdruck und Quell-IP. Das Binden beim Einlösen schreibt ohne handelnde Person. Jede
angenommene Anfrage MUST im Abrufprotokoll je Zugang, Route und Tag zählen. Das Protokoll MUST
365 Tage aufbewahrt werden.

#### Scenario: Anlegen und Widerruf im Audit
- **WHEN** ein Admin einen Zugang anlegt und später widerruft
- **THEN** zeigt das Zugangsprotokoll beide Einträge mit Admin, Zugang und Zeitpunkt in Klartext

#### Scenario: Abrufe zählen
- **WHEN** ein Zugang an einem Tag dreimal `GET /api/v1/me` aufruft
- **THEN** steht im Abrufprotokoll für diesen Zugang, diese Route und diesen Tag die Anzahl 3 mit erstem und letztem Zeitpunkt, und die Seite zeigt „zuletzt genutzt“

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
Anfrage, erwartetes JWS und erwarteter Prüfwert. Der Server, der Rust-Client, das
TypeScript-Modul und das Python-Beispiel MUST gegen dieselben Vektoren geprüft werden. Das Binary
SHALL `lifeline-hub zugang redeem <url> <code>` anbieten. Es erzeugt ein Schlüsselpaar, löst den
Code ein und legt eine nur für den Besitzer lesbare Schlüsseldatei ab.

#### Scenario: Kommando
- **WHEN** ein Betreiber `lifeline-hub zugang redeem https://hub.example ABCD-EFGH-JKMN-PQRS` ausführt
- **THEN** liegt danach eine Schlüsseldatei mit Zugangs-ID, Instanz-UUID, Basis-URL und Schlüsseln vor, und das Kommando nennt den Fingerabdruck, den der Admin an der Seite vergleicht

#### Scenario: Vektoren driften
- **WHEN** jemand das Format der Claims ändert, ohne die Testvektoren neu zu schreiben
- **THEN** schlägt mindestens ein Test im Sammel-Gate fehl
