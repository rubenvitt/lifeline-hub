## Purpose

Fremdsysteme bekommen die Ausgangsereignisse ihres Maschinenzugangs als signierte HTTPS-Aufrufe
zugestellt, statt selbst abzurufen: der Reihe nach, ohne Verlust innerhalb der Aufbewahrung,
prüfbar mit dem Instanzschlüssel und ohne der Instanz einen Weg in interne Netze zu öffnen.

## ADDED Requirements

### Requirement: Ein Maschinenzugang hat höchstens einen Webhook

Das System SHALL je Maschinenzugang höchstens einen Webhook führen, mit Ziel-URL und einer nicht
leeren Auswahl von Ereignisarten. Wird der Zugang gelöscht, MUST sein Webhook mit ihm enden.

#### Scenario: Zweiter Webhook am selben Zugang
- **WHEN** ein Admin an einem Zugang, der schon einen Webhook hat, einen weiteren anlegen will
- **THEN** antwortet das System mit `409`, und der bestehende Webhook bleibt unverändert

#### Scenario: Leere Auswahl
- **WHEN** ein Admin einen Webhook ohne Ereignisart anlegt
- **THEN** antwortet das System mit `400`, und es entsteht kein Webhook

### Requirement: Nur der System-Admin richtet Webhooks ein

Anlegen, Ändern, Entfernen, Wiederaufnehmen und die Testzustellung SHALL nur dem System-Admin
offenstehen. Den Zustand und den Verlauf MUST jeder sehen können, der den Admin-Bereich sieht. Die
ganze Ziel-URL MUST nur der System-Admin bekommen; alle anderen sehen nur den Host des Ziels.

#### Scenario: Führungskraft liest
- **WHEN** eine org-weite Führungskraft ohne Admin-Rolle die Ansicht einer Anbindung öffnet
- **THEN** sieht sie den Host des Ziels, Arten, Zustand und Verlauf des Webhooks, aber weder die ganze Ziel-URL noch einen Bedienknopf zum Ändern

#### Scenario: Führungskraft schreibt
- **WHEN** eine org-weite Führungskraft ohne Admin-Rolle einen Webhook über die Admin-API anlegt
- **THEN** antwortet das System mit `403`, und es entsteht kein Webhook

### Requirement: Das Ziel ist eine HTTPS-Adresse ohne Anmeldedaten

Die Ziel-URL SHALL das Schema `https` tragen. Sie MUST NOT Benutzername, Passwort oder ein
Fragment enthalten, und ihr Host MUST NOT `localhost` oder eine Adresse sein, die der Ziel-Schutz
sperrt. Die Prüfung MUST beim Anlegen und Ändern greifen und vor jeder Zustellung erneut.

#### Scenario: http-Ziel
- **WHEN** ein Admin `http://empfaenger.example/hook` als Ziel einträgt
- **THEN** antwortet das System mit `400`, und der Webhook bleibt, wie er war

#### Scenario: Anmeldedaten in der URL
- **WHEN** ein Admin `https://nutzer:geheim@empfaenger.example/hook` als Ziel einträgt
- **THEN** antwortet das System mit `400`

### Requirement: Zustellung der Reihe nach aus der Outbox

Das System SHALL je Webhook die Ereignisse des Zugangs in aufsteigender Nummer zustellen, ein
Ereignis je `POST`. Ein Ereignis MUST erst nach dem Erfolg seines Vorgängers zugestellt werden.
Zugestellt werden nur gewählte Arten, die der Zugang nach seinen Scopes auch abrufen dürfte.

#### Scenario: Empfänger zwei Stunden weg
- **WHEN** ein Empfänger zwei Stunden lang nicht erreichbar ist und in dieser Zeit drei Ereignisse für seinen Zugang entstehen
- **THEN** bekommt er sie, sobald er wieder erreichbar ist und der nächste Versuch fällig wird, alle drei in aufsteigender Nummer, jedes genau mit einem erfolgreichen `POST`

#### Scenario: Nicht gewählte Art
- **WHEN** ein Webhook nur `einsatz.closed` gewählt hat und für den Zugang ein `lage.changed` entsteht
- **THEN** wird `lage.changed` nicht zugestellt, und der Webhook rückt trotzdem darüber hinweg

#### Scenario: Fehlender Scope
- **WHEN** ein Webhook `lage.changed` gewählt hat, der Zugang aber kein `lage:read` mehr trägt
- **THEN** wird `lage.changed` nicht zugestellt

### Requirement: Der Body ist das Ereignis des Abrufs

Der Body einer Zustellung SHALL ein JSON-Objekt mit genau `id`, `type`, `occurred_at` und
`einsatz_id` sein, mit denselben Werten wie im Abruf `GET /api/v1/events`. Er MUST NOT Namen,
Freitext oder Inhalte der Änderung enthalten.

#### Scenario: Gleiches Ereignis auf beiden Wegen
- **WHEN** ein Zugang dasselbe Ereignis über den Abruf liest und per Webhook zugestellt bekommt
- **THEN** sind `id`, `type`, `occurred_at` und `einsatz_id` in beiden gleich

### Requirement: Nur ein wirksamer Zugang bekommt Zustellungen

Das System SHALL nur zustellen, solange der Zugang aktiv und nicht abgelaufen ist und das Recht
`events:read` trägt. Sonst MUST der Webhook ruhen, ohne seinen Cursor zu verändern, und die
Ansicht MUST den Grund nennen.

#### Scenario: Widerrufener Zugang
- **WHEN** ein Admin einen Zugang widerruft, dessen Webhook noch Ereignisse zuzustellen hat
- **THEN** geht keine weitere Zustellung an das Ziel, und die Ansicht zeigt den Webhook als ruhend mit dem Grund „Zugang widerrufen“

### Requirement: Jede Zustellung ist mit dem Instanzschlüssel signiert

Jede Zustellung SHALL im Kopf `Lifeline-Signature` ein losgelöstes JWS mit `alg` `EdDSA`, `typ`
`lifeline-event+jwt` und `kid` der Instanz tragen. Claims: `iss` (Instanz), `aud` (Webhook-ID),
`iat`, `exp` (höchstens 300 s nach `iat`), `jti` (je Versuch neu), `bh` (SHA-256 des Bodys,
Base64url). Ein HMAC-Geheimnis MUST NOT es geben.

#### Scenario: Signatur prüfen
- **WHEN** ein Empfänger eine Zustellung mit dem Instanzschlüssel aus dem Einlösen, seiner Webhook-ID und dem empfangenen Body prüft
- **THEN** besteht die Prüfung

#### Scenario: Fremder Schlüssel
- **WHEN** eine Zustellung mit einem anderen Schlüssel als dem der Instanz signiert ist
- **THEN** lehnt die Prüfung sie ab

#### Scenario: Geänderter Body
- **WHEN** ein Byte des Bodys nach dem Signieren geändert wird
- **THEN** lehnt die Prüfung sie ab, weil `bh` nicht passt

#### Scenario: Weitergereichtes Ereignis
- **WHEN** ein Empfänger eine bei ihm eingegangene Zustellung samt Kopf an einen anderen Empfänger weiterreicht
- **THEN** lehnt dessen Prüfung sie ab, weil `aud` nicht seine Webhook-ID ist

### Requirement: Erfolg ist eine 2xx-Antwort

Eine Zustellung SHALL als erfolgreich gelten, wenn das Ziel mit einem Status von `200` bis `299`
antwortet. Jede andere Antwort, eine Weiterleitung, ein Netzfehler und eine Zeitüberschreitung
MUST als Fehlschlag gelten. Der Rumpf der Antwort MUST höchstens bis zu einer festen Grenze
gelesen werden.

#### Scenario: Weiterleitung
- **WHEN** das Ziel mit `302` auf eine andere Adresse verweist
- **THEN** folgt das System der Weiterleitung nicht, und der Versuch zählt als Fehlschlag mit Status 302

### Requirement: Wiederholung mit Backoff

Nach einem Fehlschlag SHALL das System dasselbe Ereignis erneut zustellen, zuerst nach 1 min,
danach jeweils nach doppelt so langer Wartezeit, höchstens nach 6 h. Ein Erfolg MUST die
Wartezeit auf den Anfang zurücksetzen.

#### Scenario: Drei Fehlschläge
- **WHEN** die ersten drei Versuche eines Ereignisses scheitern
- **THEN** liegen zwischen den Versuchen 1 min, 2 min und 4 min, und die Ansicht zeigt den nächsten Versuch

#### Scenario: Obergrenze
- **WHEN** ein Ziel zwölf Stunden lang scheitert
- **THEN** liegt zwischen zwei Versuchen nie mehr als 6 h

### Requirement: Nach 24 Stunden ohne Erfolg wird angehalten

Hat ein Webhook 24 h lang kein Ereignis erfolgreich zugestellt, während eines anstand, SHALL das
System ihn anhalten. Ein angehaltener Webhook MUST NOT zustellen, bis ein Admin ihn wieder
aufnimmt. Die Seite der Anbindungen und ihre Ansicht MUST ihn als angehalten zeigen.

#### Scenario: Dauerhaft unerreichbar
- **WHEN** ein Ziel ab dem ersten Fehlschlag 24 h lang nur scheitert
- **THEN** steht der Webhook danach als „angehalten“ in der Liste der Anbindungen und in ihrer Ansicht, mit Zeitpunkt des ersten Fehlschlags und letztem Fehler, und es geht kein weiterer Versuch hinaus

### Requirement: Wiederaufnahme liefert nach, solange der Rückstand besteht

Nimmt ein Admin einen angehaltenen Webhook wieder auf, SHALL das System ab dem Ereignis
weiterliefern, an dem er stehen blieb, solange es noch in der Outbox liegt. Ist es schon
gelöscht, MUST der Webhook beim aktuellen Stand ansetzen, und die Ansicht MUST sagen, dass der
Empfänger den Stand über die Leserouten neu lesen muss.

#### Scenario: Rückstand noch da
- **WHEN** ein Admin einen Webhook zwei Tage nach dem Anhalten wieder aufnimmt
- **THEN** stellt das System zuerst das Ereignis zu, an dem er stehen blieb, danach die übrigen der Reihe nach

#### Scenario: Rückstand gelöscht
- **WHEN** ein Admin einen Webhook zehn Tage nach dem Anhalten wieder aufnimmt
- **THEN** setzt der Webhook beim aktuellen Stand an, liefert nur noch neue Ereignisse, und die Ansicht zeigt den Hinweis, dass Ereignisse verloren sind und der Empfänger den Stand neu lesen muss

### Requirement: Keine Zustellung an interne Ziele

Das System SHALL den Host des Ziels selbst auflösen und sich genau mit den geprüften Adressen
verbinden. Ist eine aufgelöste Adresse intern, MUST der Versuch ohne Verbindung scheitern. Ein
Proxy aus der Umgebung MUST NOT benutzt werden.

#### Scenario: Name zeigt auf ein internes Netz
- **WHEN** der Host des Ziels auf `10.0.0.5` aufgelöst wird und die LAN-Ausnahme aus ist
- **THEN** baut das System keine Verbindung auf, und der Versuch zählt als Fehlschlag „Ziel im internen Netz“

#### Scenario: Gemischte Auflösung
- **WHEN** der Host auf eine öffentliche und eine interne Adresse aufgelöst wird
- **THEN** baut das System keine Verbindung auf

### Requirement: LAN-Ziele nur als bewusste Ausnahme

Ein Admin SHALL am Webhook ausdrücklich erlauben können, dass das Ziel in einem privaten Netz
liegt. Loopback, Link-Local, Multicast, Broadcast und unbestimmte Adressen MUST auch dann
gesperrt bleiben. Das Einschalten MUST einen eigenen Eintrag in der Admin-Spur schreiben.

#### Scenario: Ziel im Netz des ELW
- **WHEN** ein Admin die LAN-Ausnahme einschaltet und das Ziel auf `192.168.10.20` aufgelöst wird
- **THEN** stellt das System dorthin zu

#### Scenario: Metadatenadresse trotz Ausnahme
- **WHEN** die LAN-Ausnahme an ist und das Ziel auf `169.254.169.254` aufgelöst wird
- **THEN** baut das System keine Verbindung auf

#### Scenario: Loopback trotz Ausnahme
- **WHEN** die LAN-Ausnahme an ist und das Ziel auf `127.0.0.1` aufgelöst wird
- **THEN** baut das System keine Verbindung auf

### Requirement: Testzustellung

Ein Admin SHALL ein Testereignis an das Ziel senden können. Es MUST den Typ `ping` tragen, wie
jede Zustellung signiert sein und dieselben Ziel-Prüfungen durchlaufen. Es MUST NOT den Cursor,
den Zustand oder die Wartezeit des Webhooks verändern. Das Ergebnis MUST sofort angezeigt werden.

#### Scenario: Test an erreichbares Ziel
- **WHEN** ein Admin „Testereignis senden“ wählt und das Ziel mit `204` antwortet
- **THEN** zeigt die Ansicht den Erfolg mit Status 204, und der Webhook steht weiter beim selben Ereignis

#### Scenario: Test an angehaltenen Webhook
- **WHEN** ein Admin bei einem angehaltenen Webhook ein Testereignis sendet und das Ziel antwortet
- **THEN** bleibt der Webhook angehalten, bis der Admin ihn wieder aufnimmt

### Requirement: Diagnose der Zustellung

Die Ansicht SHALL den Zustand des Webhooks, den letzten Fehlschlag (Zeitpunkt, Status oder Art
des Netzfehlers), den nächsten Versuch und die letzten 50 Zustellversuche zeigen, jeweils mit
Zeitpunkt, Ereignisnummer, Ergebnis und Dauer. Ein Eintrag MUST NOT den Rumpf der Antwort
enthalten. Ältere Versuche MUST gelöscht werden.

#### Scenario: Verlauf nach einer Störung
- **WHEN** ein Ziel zweimal mit `503` antwortet und danach mit `200`
- **THEN** zeigt der Verlauf drei Versuche zum selben Ereignis, zwei als Fehlschlag mit Status 503 und einen als Erfolg

### Requirement: Referenz-Clients prüfen Webhooks

Der Rust-Client, das TypeScript-Modul und das Python-Beispiel SHALL eine Prüfung eingehender
Webhooks anbieten: Kopf, Signatur gegen den Instanzschlüssel, `aud` gegen die eigene Webhook-ID,
Zeitfenster und `bh` gegen den Body. Alle drei MUST gegen dieselben Testvektoren geprüft werden.

#### Scenario: Vektoren für Webhooks
- **WHEN** das Sammel-Gate läuft
- **THEN** prüfen Server und alle drei Clients einen gültigen Webhook als gültig und Vektoren mit fremdem Schlüssel, geändertem Body, falscher `aud` und abgelaufenem `exp` als ungültig
