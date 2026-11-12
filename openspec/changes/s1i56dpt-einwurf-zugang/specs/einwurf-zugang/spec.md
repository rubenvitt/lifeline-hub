# Spec Delta

## Purpose

Absender, die nur eine URL aufrufen und nicht signieren können (BOSWatch, FE2, Divera-Webhook,
OsmAnd), liefern Alarmmeldungen und Positionen über einen Einwurf-Zugang ein. Der Zugang trägt
ein Geheimnis im Pfad, schreibt nur in eine Ablage und liest nichts.

## ADDED Requirements

### Requirement: Ein Einwurf-Zugang gehört einer Org und hat genau einen Zweck

Ein System-Admin SHALL für seine Org einen Einwurf-Zugang mit Name, genau einem Zweck
(`alarmmeldungen:write` oder `positionen:write`) und optionalem „gültig bis“ anlegen können. Der
Schlüssel MUST aus `llh_ew_` und 32 Zufallsbytes bestehen. Der Server MUST nur seinen SHA-256
speichern und den Schlüssel genau einmal ausgeben, in der Antwort auf das Anlegen oder Wechseln.

#### Scenario: Anlegen
- **WHEN** ein Admin einen Einwurf-Zugang „BOSWatch Wache 1“ mit dem Zweck `alarmmeldungen:write` anlegt
- **THEN** enthält die Antwort einen Schlüssel mit dem Präfix `llh_ew_`, und die Liste der Zugänge zeigt den Zugang ohne Schlüssel

#### Scenario: Schlüssel nicht nachlesbar
- **WHEN** ein Admin die Liste der Einwurf-Zugänge nach dem Anlegen erneut abruft
- **THEN** enthält keine Antwort den Schlüssel oder seinen Hash

#### Scenario: Unbekannter Zweck
- **WHEN** ein Admin einen Einwurf-Zugang mit dem Zweck `lage:read` anlegen will
- **THEN** antwortet der Server mit 400 und legt nichts an

#### Scenario: Ohne Admin-Recht
- **WHEN** eine Führungskraft ohne System-Admin-Recht einen Einwurf-Zugang anlegen will
- **THEN** antwortet der Server mit 403

### Requirement: Ein Einwurf wird über den Schlüssel im Pfad angenommen

Der Server SHALL unter `GET` und `POST /api/v1/einwurf/{schluessel}/alarmmeldung` und
`…/position` Einwürfe annehmen, ohne Signatur, Sitzung oder Kopf `Authorization`. Ein
angenommener Einwurf MUST in die Ablage der Org des Zugangs geschrieben und mit 204 beantwortet
werden. Ein unbekannter, widerrufener oder abgelaufener Schlüssel MUST 401 mit dem Code
`unauthorized` ergeben.

#### Scenario: Gültiger Schlüssel
- **WHEN** ein Absender `GET /api/v1/einwurf/<schlüssel>/alarmmeldung?text=Brand` mit einem gültigen Schlüssel aufruft
- **THEN** antwortet der Server mit 204, und die Ablage der Org enthält einen Eintrag mit diesem Inhalt

#### Scenario: Unbekannter Schlüssel
- **WHEN** ein Absender einen Schlüssel schickt, den es nicht gibt
- **THEN** antwortet der Server mit 401 und dem Code `unauthorized`, und nichts wird gespeichert

#### Scenario: Abgelaufen
- **WHEN** das „gültig bis“ eines Zugangs verstrichen ist und ein Einwurf mit seinem Schlüssel kommt
- **THEN** antwortet der Server mit 401

### Requirement: Ein Zugang schreibt nur für seinen Zweck

Ein Einwurf-Zugang MUST nur die Route seines Zwecks benutzen können. Ein Einwurf an die Route des
anderen Zwecks MUST 403 mit dem Code `missing_scope` ergeben und nichts speichern. Ein Einwurf
MUST NOT einen Einsatz anlegen oder ändern.

#### Scenario: Falsche Route
- **WHEN** ein Zugang mit dem Zweck `alarmmeldungen:write` `…/position` aufruft
- **THEN** antwortet der Server mit 403 und dem Code `missing_scope`

#### Scenario: Kein Einsatz entsteht
- **WHEN** ein Zugang eine Alarmmeldung einwirft
- **THEN** ist die Zahl der Einsätze der Org unverändert

### Requirement: Ein Einwurf liest nichts

Die Antwort auf einen Einwurf MUST NOT Daten tragen: bei Erfolg 204 ohne Body, im Fehlerfall nur
`error` und `code`. Unter `/api/v1/einwurf/` MUST es keine Route geben, die etwas aus der Ablage
oder über den Zugang zurückgibt. Eine neue Meldung und eine Wiederholung MUST dieselbe Antwort
bekommen.

#### Scenario: Erfolg ohne Body
- **WHEN** ein Einwurf angenommen wird
- **THEN** ist die Antwort 204 mit leerem Body

#### Scenario: Wiederholung nicht erkennbar
- **WHEN** derselbe Einwurf zweimal hintereinander kommt
- **THEN** sind beide Antworten 204 ohne Body

#### Scenario: Kein Leseweg
- **WHEN** jemand mit einem gültigen Schlüssel `GET /api/v1/einwurf/<schlüssel>` oder einen anderen Unterpfad als `alarmmeldung` und `position` aufruft
- **THEN** antwortet der Server mit 404 oder 405 und gibt nichts aus der Ablage zurück

### Requirement: Einwürfe werden nur verschlüsselt angenommen

Der Server SHALL einen Einwurf nur annehmen, wenn er über TLS ankam: der Server terminiert TLS
selbst, oder die Gegenstelle ist ein vertrauter Proxy und jeder Wert von `X-Forwarded-Proto` ist
`https`. Sonst MUST er mit 403 und dem Code `tls_required` antworten, bevor er den Schlüssel
prüft. Nur ein ausdrücklicher Schalter des Betreibers hebt das auf.

#### Scenario: Klartext ohne Schalter
- **WHEN** ein Einwurf mit gültigem Schlüssel unverschlüsselt und ohne vertrauten Proxy ankommt
- **THEN** antwortet der Server mit 403 und dem Code `tls_required`, und nichts wird gespeichert

#### Scenario: Gefälschter Kopf
- **WHEN** eine Gegenstelle, die kein vertrauter Proxy ist, `X-Forwarded-Proto: https` mitschickt
- **THEN** antwortet der Server mit 403 und dem Code `tls_required`

#### Scenario: Vertrauter Proxy
- **WHEN** ein vertrauter Proxy den Einwurf mit `X-Forwarded-Proto: https` weiterreicht
- **THEN** wird der Einwurf angenommen

#### Scenario: Vom Client vorangestellter Wert
- **WHEN** ein vertrauter Proxy `X-Forwarded-Proto: https, http` weiterreicht
- **THEN** antwortet der Server mit 403 und dem Code `tls_required`

#### Scenario: Schalter des Betreibers
- **WHEN** der Betreiber den Schalter für Einwürfe ohne TLS gesetzt hat und ein Einwurf unverschlüsselt ankommt
- **THEN** wird der Einwurf angenommen

### Requirement: Der Schlüssel steht in keinem Protokoll

Der Server MUST NOT einen Einwurf-Schlüssel in eine Logzeile, einen Trace-Span, die Admin-Spur
oder eine Fehlermeldung schreiben. Im protokollierten Pfad MUST der Abschnitt nach `/einwurf/`
und jeder Abschnitt mit dem Präfix `llh_ew_` durch einen festen Platzhalter ersetzt sein. Die
Abfrage MUST NOT protokolliert werden.

#### Scenario: Trace-Span
- **WHEN** ein Einwurf mit gültigem Schlüssel verarbeitet wird und das Log mitgeschnitten wird
- **THEN** enthält keine Logzeile den Schlüssel, und der Pfad im Span lautet `/api/v1/einwurf/***/alarmmeldung`

#### Scenario: Vertippter Pfad
- **WHEN** jemand `/api/v1/einwurff/llh_ew_…/alarmmeldung` aufruft
- **THEN** enthält keine Logzeile den Schlüssel

#### Scenario: Fehlerfall
- **WHEN** ein Einwurf mit unbekanntem Schlüssel abgelehnt wird
- **THEN** enthält weder die Antwort noch eine Logzeile den geschickten Schlüssel

### Requirement: Jeder Einwurf-Zugang ist gedrosselt

Der Server SHALL je Einwurf-Zugang einen Vorrat von 30 Einwürfen halten, der sich um einen je
zwei Sekunden auffüllt. Ist er leer, MUST er mit 429, dem Code `rate_limited` und `Retry-After`
in ganzen Sekunden antworten und nichts speichern.

#### Scenario: Zu viele Einwürfe
- **WHEN** ein Zugang 31 Einwürfe im selben Augenblick schickt
- **THEN** bekommt der 31. eine 429 mit `Retry-After` von mindestens 1

#### Scenario: Getrennt vom Maschinenzugang
- **WHEN** ein Einwurf-Zugang seinen Vorrat aufgebraucht hat
- **THEN** bleibt der Vorrat jedes Maschinenzugangs und jedes anderen Einwurf-Zugangs unberührt

### Requirement: Die Ablage hat Obergrenzen

Ein Einwurf MUST NOT mehr als 16 KiB Body und 8 KiB Abfrage tragen; darüber antwortet der Server
mit 413 und dem Code `payload_too_large`. Je Zugang MUST der Server höchstens 5 000 neue
Alarmmeldungen in 24 Stunden und höchstens 200 Kennungen für Positionen speichern.

#### Scenario: Zu großer Body
- **WHEN** ein Einwurf einen Body von 17 KiB trägt
- **THEN** antwortet der Server mit 413 und speichert nichts

#### Scenario: Tagesgrenze
- **WHEN** ein Zugang in 24 Stunden 5 000 neue Alarmmeldungen eingeworfen hat und eine weitere neue schickt
- **THEN** antwortet der Server mit 429 und `Retry-After`, und nichts wird gespeichert

#### Scenario: Zu viele Kennungen
- **WHEN** an einem Zugang 200 Kennungen eine Position haben und eine Position für eine weitere Kennung kommt
- **THEN** antwortet der Server mit 422, und die 200 bestehenden Positionen bleiben

### Requirement: Eine Alarmmeldung wird roh abgelegt

Der Server SHALL eine eingeworfene Alarmmeldung unverändert ablegen: die Abfrage und den Body,
dazu Zugang, Org und Empfangszeit. Er MUST den Inhalt nicht deuten und keine Felder verlangen,
außer dass Abfrage oder Body nicht leer sind. Ein leerer Einwurf MUST 422 mit dem Code
`unprocessable` ergeben. Aus Abfrage, Formularfeldern oder JSON-Body erkennt er nur
`external_id` und `message_id`; eine Kennung über 200 Zeichen MUST 400 ergeben.

#### Scenario: BOSWatch-Aufruf
- **WHEN** ein Absender `…/alarmmeldung?ric=1234567&subric=a&text=B2%20Wohnung` aufruft
- **THEN** enthält der Eintrag der Ablage die drei Parameter unverändert

#### Scenario: JSON-Body
- **WHEN** ein Absender per POST `{"external_id": "LS-1", "stichwort": "RD 2"}` schickt
- **THEN** enthält der Eintrag den Body unverändert und die Kennung `LS-1`

#### Scenario: Leerer Einwurf
- **WHEN** ein Absender `…/alarmmeldung` ohne Abfrage und ohne Body aufruft
- **THEN** antwortet der Server mit 422 und dem Code `unprocessable`

### Requirement: Eine Meldung mit Kennung ist dauerhaft idempotent

Trägt eine Alarmmeldung eine `message_id`, MUST der Server eine weitere Meldung desselben Zugangs
mit derselben `external_id` und `message_id` als Wiederholung behandeln, gleich wie viel Zeit
vergangen ist. Trägt sie nur eine `external_id`, gilt dasselbe für gleichen Inhalt. Eine
Wiederholung MUST NOT einen neuen Eintrag anlegen; sie wird am bestehenden Eintrag mit Zahl und
Zeit vermerkt.

#### Scenario: Retry nach Stunden
- **WHEN** ein Absender dieselbe Meldung mit `external_id` und `message_id` nach drei Stunden noch einmal schickt
- **THEN** gibt es weiter genau einen Eintrag, und er vermerkt einen erneuten Empfang mit der Zeit

#### Scenario: Nachtrag
- **WHEN** ein Absender zur selben `external_id` eine Meldung mit neuer `message_id` schickt
- **THEN** entsteht ein zweiter Eintrag mit derselben `external_id`

#### Scenario: Gleiche Kennung, anderer Zugang
- **WHEN** zwei Zugänge derselben Org eine Meldung mit derselben `external_id` und `message_id` einwerfen
- **THEN** entstehen zwei Einträge

### Requirement: Ohne Kennung zählt gleicher Inhalt binnen zwei Minuten als Wiederholung

Trägt eine Alarmmeldung keine Kennung, SHALL der Server sie als Wiederholung vermerken, wenn
derselbe Zugang denselben Inhalt höchstens 2 Minuten vor ihr zuletzt eingeworfen hat. Kommt
derselbe Inhalt später, MUST ein neuer Eintrag entstehen, der auf den früheren verweist. Der
Server MUST NOT eine Alarmmeldung still verwerfen.

#### Scenario: POCSAG-Wiederholung
- **WHEN** ein Zugang denselben Aufruf dreimal im Abstand von 30 Sekunden schickt
- **THEN** gibt es genau einen Eintrag, der zwei erneute Empfänge mit der Zeit des letzten vermerkt

#### Scenario: Später Retry
- **WHEN** ein Zugang denselben Aufruf nach 10 Minuten noch einmal schickt
- **THEN** entsteht ein zweiter Eintrag, der auf den ersten verweist

#### Scenario: Anderer Inhalt
- **WHEN** ein Zugang innerhalb einer Minute zwei Aufrufe mit unterschiedlichem Text schickt
- **THEN** entstehen zwei Einträge ohne Verweis

### Requirement: Abgelegte Alarmmeldungen werden nach sieben Tagen gelöscht

Der Server SHALL eine abgelegte Alarmmeldung samt Rohdaten 7 Tage nach ihrem ersten Empfang
löschen. Ein erneuter Empfang MUST die Frist nicht verlängern.

#### Scenario: Frist abgelaufen
- **WHEN** eine Alarmmeldung vor mehr als 7 Tagen empfangen wurde und der Löschlauf läuft
- **THEN** ist ihr Eintrag samt Rohdaten gelöscht

#### Scenario: Frist läuft noch
- **WHEN** eine Alarmmeldung vor 6 Tagen empfangen wurde und der Löschlauf läuft
- **THEN** ist ihr Eintrag noch da

### Requirement: Eine Position hängt an der Kennung des Absenders

Der Server SHALL eine eingeworfene Position mit Kennung (`id` oder `deviceid`), `lat`, `lon` und
optionalem `timestamp` annehmen. Je Zugang und Kennung MUST er genau eine Position halten: Eine
neue ersetzt die gespeicherte, ohne Verlauf. Fehlt die Kennung oder liegt eine Koordinate
außerhalb des Wertebereichs, MUST er mit 400 und dem Code `invalid_field` antworten.

#### Scenario: OsmAnd-Aufruf
- **WHEN** ein Absender `…/position?id=elw1&lat=52.1&lon=9.3&timestamp=1794423731` aufruft
- **THEN** hält die Ablage für die Kennung `elw1` genau diese Position mit ihrem Zeitstempel

#### Scenario: Ersetzen ohne Verlauf
- **WHEN** für dieselbe Kennung eine zweite Position mit späterem Zeitstempel kommt
- **THEN** hält die Ablage nur die zweite, und die erste ist nirgends mehr gespeichert

#### Scenario: Ungültige Koordinate
- **WHEN** ein Absender `lat=123` schickt
- **THEN** antwortet der Server mit 400 und dem Code `invalid_field` und ändert nichts

### Requirement: Eine ältere Position wird nicht übernommen

Der Server MUST eine Position mit älterem Zeitstempel als dem gespeicherten derselben Kennung
nicht übernehmen; er antwortet trotzdem mit 204. Ohne `timestamp` gilt die Empfangszeit. Ein
unlesbarer Zeitstempel MUST 400 ergeben, einer, der mehr als 5 Minuten in der Zukunft liegt, 422.

#### Scenario: Verspätete Position
- **WHEN** nach einer Position von 12:05 eine Position derselben Kennung von 12:03 ankommt
- **THEN** antwortet der Server mit 204, und gespeichert bleibt die Position von 12:05

#### Scenario: Uhr des Absenders geht vor
- **WHEN** eine Position einen Zeitstempel trägt, der 30 Minuten in der Zukunft liegt
- **THEN** antwortet der Server mit 422 und ändert nichts

### Requirement: Eine Position verfällt nach 24 Stunden

Der Server SHALL eine gespeicherte Position 24 Stunden nach ihrem Empfang löschen, wenn bis dahin
keine neuere für dieselbe Kennung kam.

#### Scenario: Keine neue Meldung
- **WHEN** die letzte Position einer Kennung vor mehr als 24 Stunden empfangen wurde und der Löschlauf läuft
- **THEN** ist sie gelöscht

### Requirement: Widerruf und Wechsel wirken sofort

Ein Admin SHALL einen Einwurf-Zugang widerrufen und seinen Schlüssel wechseln können. Nach dem
Widerruf MUST jeder Einwurf mit dem Schlüssel 401 ergeben. Der Wechsel gibt einen neuen Schlüssel
aus; der alte MUST im selben Augenblick 401 ergeben. Name, Zweck und „gültig bis“ bleiben beim
Wechsel. Ein widerrufener Zugang MUST NOT einen neuen Schlüssel bekommen.

#### Scenario: Widerruf
- **WHEN** ein Admin einen Zugang widerruft und danach ein Einwurf mit dessen Schlüssel kommt
- **THEN** antwortet der Server mit 401

#### Scenario: Wechsel
- **WHEN** ein Admin den Schlüssel wechselt
- **THEN** ergibt der alte Schlüssel 401, und der neue wird angenommen

#### Scenario: Wechsel nach Widerruf
- **WHEN** ein Admin den Schlüssel eines widerrufenen Zugangs wechseln will
- **THEN** antwortet der Server mit 409

### Requirement: Anlegen, Wechsel und Widerruf stehen in der Admin-Spur

Anlegen, Schlüsselwechsel und Widerruf eines Einwurf-Zugangs SHALL je einen Eintrag in der
Admin-Spur der Org schreiben, mit Admin, Name des Zugangs, Zweck und Quell-IP. Der Eintrag MUST
NOT den Schlüssel oder seinen Hash enthalten. Das Zugangsprotokoll MUST die drei Aktionen in
Klartext zeigen.

#### Scenario: Anlegen und Widerruf
- **WHEN** ein Admin einen Einwurf-Zugang anlegt und später widerruft
- **THEN** zeigt das Zugangsprotokoll beide Einträge mit Admin, Zugang und Zeitpunkt in Klartext

#### Scenario: Erneuter Widerruf
- **WHEN** ein Admin einen schon widerrufenen Zugang noch einmal widerruft
- **THEN** entsteht kein weiterer Eintrag

### Requirement: Die Seite „Anbindungen“ verwaltet Einwurf-Zugänge

Die Seite „Anbindungen“ SHALL unter den Maschinenzugängen ein Paneel „Einwurf-Zugänge“ zeigen,
mit Name, Zweck, Zustand, „gültig bis“ und „zuletzt genutzt“ je Zugang. Ein System-Admin legt
dort an, wechselt den Schlüssel und widerruft; Wechsel und Widerruf verlangen eine Rückfrage. Die
Adresse mit Schlüssel MUST genau einmal erscheinen, in einem Dialog, der nur über „Fertig“
schließt. Wer kein System-Admin ist, sieht die Liste ohne Aktionen.

#### Scenario: Adresse einmal zeigen
- **WHEN** ein Admin einen Zugang für Alarmmeldungen anlegt
- **THEN** zeigt ein Dialog die vollständige Adresse `…/api/v1/einwurf/<schlüssel>/alarmmeldung` zum Kopieren, und nach „Fertig“ ist sie nirgends mehr abrufbar

#### Scenario: Widerruf erst nach Rückfrage
- **WHEN** ein Admin „Widerrufen …“ wählt
- **THEN** fragt die Seite nach, und erst „Widerrufen“ widerruft

#### Scenario: Zuletzt genutzt
- **WHEN** ein Zugang einen Einwurf angenommen hat und die Seite neu lädt
- **THEN** zeigt die Zeile des Zugangs „zuletzt genutzt“ mit dem Zeitpunkt

#### Scenario: Nur lesen
- **WHEN** eine Führungskraft ohne System-Admin-Recht die Seite öffnet
- **THEN** sieht sie die Zugänge, aber keine Aktion zum Anlegen, Wechseln oder Widerrufen

### Requirement: Die Seite warnt, wenn Einwürfe unverschlüsselt möglich oder unmöglich sind

Die Seite „Anbindungen“ MUST im Paneel „Einwurf-Zugänge“ warnen, wenn der Betreiber Einwürfe ohne
TLS erlaubt hat. Sie MUST ebenso warnen, wenn die Instanz weder TLS terminiert noch einen
vertrauten Proxy kennt und den Schalter nicht gesetzt hat: Dann lehnt sie jeden Einwurf ab.

#### Scenario: Schalter gesetzt
- **WHEN** die Instanz mit dem Schalter für Einwürfe ohne TLS läuft
- **THEN** zeigt das Paneel den Hinweis, dass Einwürfe unverschlüsselt angenommen werden

#### Scenario: Kein Weg mit TLS
- **WHEN** die Instanz ohne TLS, ohne vertraute Proxys und ohne den Schalter läuft
- **THEN** zeigt das Paneel den Hinweis, dass Einwürfe abgelehnt werden

### Requirement: Ein gekoppelter ELW nimmt keine Einwürfe an

Meldet sich eine Instanz für eine Org bei einer anderen Instanz (aktive Kopplung, meldende
Seite), SHALL sie für diese Org keine Einwurf-Zugänge anlegen, keinen Schlüssel wechseln und
keinen Einwurf eines Zugangs dieser Org annehmen. Das Paneel MUST den Grund nennen. Widerrufen
bleibt möglich.

#### Scenario: Anlegen am ELW
- **WHEN** ein Admin an einem ELW, der sich für seine Org bei einem Hub meldet, einen Einwurf-Zugang anlegen will
- **THEN** ist das Anlegen gesperrt, das Paneel nennt den Hub als Ort für Anbindungen, und der Server antwortet auf die Anlage mit 409

#### Scenario: Einwurf am ELW
- **WHEN** ein Zugang angelegt wurde, bevor die Org gekoppelt wurde, und danach ein Einwurf kommt
- **THEN** antwortet der Server mit 401 und speichert nichts
