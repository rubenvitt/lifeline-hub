# Spec Delta

## Purpose

Die Administration vergibt einer Person, die ihr Passwort vergessen hat, ein Einmalpasswort. Wer
sich damit anmeldet, MUST zuerst ein eigenes Passwort festlegen, bevor eine Sitzung entsteht.

## ADDED Requirements

### Requirement: Die Administration vergibt ein Einmalpasswort

Ein System-Admin SHALL für ein Konto seiner Organisation ein Einmalpasswort anfordern können. Der
Server MUST es zufällig erzeugen, als neues Passwort des Kontos setzen und das Konto unter
Änderungszwang stellen. Die Antwort MUST das Einmalpasswort genau dieses eine Mal enthalten. Sie
MUST `Cache-Control: no-store` tragen. Das Einmalpasswort MUST NOT in Logs oder Protokollen
erscheinen.

#### Scenario: Einmalpasswort für eine Person der eigenen Organisation

- **WHEN** ein Admin `POST /api/benutzer/{id}/einmalpasswort` für den aktiven Benutzer `max` seiner Organisation aufruft
- **THEN** antwortet der Server mit 200 und `{"einmalpasswort": "<passwort>"}` samt `Cache-Control: no-store`
- **AND** `max` kann sich mit dem bisherigen Passwort nicht mehr anmelden

#### Scenario: Ohne Admin-Rolle

- **WHEN** ein Benutzer ohne Admin-Rolle die Route aufruft
- **THEN** antwortet der Server mit 403, und das Passwort des Zielkontos bleibt unverändert

### Requirement: Das Einmalpasswort ist gut lesbar und stark genug

Ein erzeugtes Einmalpasswort MUST aus drei Vierergruppen bestehen, getrennt durch Bindestriche. Es
MUST nur Kleinbuchstaben und Ziffern ohne leicht verwechselbare Zeichen enthalten (kein `0`, `o`,
`1`, `l`, `i`). Es MUST aus einem kryptographisch sicheren Zufallsgenerator stammen.

#### Scenario: Form des Einmalpassworts

- **WHEN** der Server ein Einmalpasswort erzeugt
- **THEN** hat es die Form `xxxx-xxxx-xxxx` und enthält keines der Zeichen `0`, `o`, `1`, `l`, `i`

#### Scenario: Zwei Anforderungen

- **WHEN** ein Admin für dasselbe Konto zweimal hintereinander ein Einmalpasswort anfordert
- **THEN** unterscheiden sich die beiden Einmalpasswörter
- **AND** nur das zweite meldet die Person noch an

### Requirement: Das Vergeben beendet alle Sitzungen und steht in der Admin-Spur

Vergibt ein Admin ein Einmalpasswort, MUST der Server alle Sitzungen des Zielkontos beenden und
offene Tabs der Person darüber benachrichtigen. Nach dem Erfolg MUST genau ein Eintrag
`einmalpasswort_vergeben` in der Admin-Spur entstehen. Er nennt Akteur und Zielkonto, aber nicht das
Passwort. Eine abgewiesene Anforderung MUST NOT einen Eintrag schreiben.

#### Scenario: Laufende Sitzungen der Person

- **WHEN** `max` auf zwei Geräten angemeldet ist und ein Admin ihm ein Einmalpasswort vergibt
- **THEN** antworten beide Sitzungen danach mit 401
- **AND** das Zugangsprotokoll zeigt einen Eintrag „Einmalpasswort vergeben“ mit dem Admin als Akteur und `max` als Ziel

#### Scenario: Abgewiesene Anforderung

- **WHEN** ein Admin für ein SSO-only-Konto ein Einmalpasswort anfordert
- **THEN** entsteht kein Eintrag in der Admin-Spur

### Requirement: Nicht jedes Konto bekommt ein Einmalpasswort

Der Server MUST eine Anforderung abweisen und das Zielkonto unverändert lassen in diesen Fällen: Das
Konto gehört zu einer anderen Organisation oder ist ein Gerätekonto (404). Es ist das eigene Konto
des Admins (422). Es hat kein lokales Passwort, weil es SSO-only ist (422). Der Passwort-Provider ist
abgeschaltet (403).

#### Scenario: Konto einer fremden Organisation

- **WHEN** ein Admin für ein Konto einer anderen Organisation ein Einmalpasswort anfordert
- **THEN** antwortet der Server mit 404

#### Scenario: Eigenes Konto

- **WHEN** ein Admin für sein eigenes Konto ein Einmalpasswort anfordert
- **THEN** antwortet der Server mit 422, und seine Sitzung bleibt bestehen

#### Scenario: Gerätekonto

- **WHEN** ein Admin für ein Gerätekonto ein Einmalpasswort anfordert
- **THEN** antwortet der Server mit 404

### Requirement: Ein neu angelegtes Konto steht unter Änderungszwang

Legt ein Admin ein Konto mit Passwort an, MUST das Konto unter Änderungszwang stehen. Das Passwort aus
der Anlage gilt dann wie ein Einmalpasswort. Konten, die beim ersten Start, aus Testdaten oder per SSO
entstehen, MUST NOT unter Änderungszwang stehen.

#### Scenario: Erste Anmeldung nach der Anlage

- **WHEN** ein Admin `max` mit dem Passwort `startpasswort` anlegt und `max` sich damit anmeldet
- **THEN** führt die Anmeldung in den Schritt „Neues Passwort festlegen“ statt in eine Sitzung

#### Scenario: Erstes Admin-Konto

- **WHEN** sich das beim ersten Start angelegte Admin-Konto mit seinem Passwort anmeldet
- **THEN** bekommt es sofort eine Sitzung

### Requirement: Der Passwort-Login führt ein Konto unter Änderungszwang in den Wechsel

Besteht ein Konto unter Änderungszwang die Passwortprüfung, MUST der Server ohne Sitzung und ohne
Sitzungs-Cookie mit `{"passwort_wechsel_erforderlich": true}` antworten. Dazu setzt er ein
kurzlebiges, einmal einlösbares HttpOnly-Cookie. Hat das Konto TOTP, MUST erst der zweite Faktor
bestehen, dann folgt der Wechsel. Der Passwortschritt MUST NOT einen Eintrag `login_ok` schreiben;
nur ein bestandener zweiter Faktor protokolliert die Anmeldung wie sonst auch.

#### Scenario: Anmeldung mit dem Einmalpasswort

- **WHEN** `max` sich mit seinem Einmalpasswort anmeldet
- **THEN** antwortet der Server mit `{"passwort_wechsel_erforderlich": true}` ohne Sitzungs-Cookie
- **AND** `GET /api/auth/me` mit den Cookies dieser Antwort liefert 401

#### Scenario: Konto mit TOTP

- **WHEN** `max` mit TOTP sich mit seinem Einmalpasswort anmeldet und danach einen gültigen Code eingibt
- **THEN** antwortet der Login mit `{"mfa_erforderlich": "totp"}`
- **AND** der TOTP-Abschluss antwortet mit `{"passwort_wechsel_erforderlich": true}` statt mit einer Sitzung

#### Scenario: Konto mit TOTP, Einmalpasswort vor dem Code ersetzt

- **WHEN** `max` mit TOTP sich mit dem ersten Einmalpasswort anmeldet, ein Admin ihm ein zweites vergibt und `max` danach einen gültigen Code eingibt
- **THEN** antwortet der TOTP-Abschluss mit 401 ohne Wechsel-Cookie

#### Scenario: Falsches Einmalpasswort

- **WHEN** `max` sich mit einem falschen Passwort anmeldet
- **THEN** antwortet der Server mit 401 wie bei jedem falschen Passwort und verrät den Änderungszwang nicht

### Requirement: Erst das neue Passwort öffnet die Sitzung

`POST /api/auth/passwort/festlegen` MUST mit gültigem Wechsel-Cookie das neue Passwort setzen, den
Zwang aufheben und eine Sitzung anlegen. Es gelten die Längengrenzen jedes neuen Passworts. Ohne
gültiges Cookie MUST der Server mit 401 antworten. Gleicht das neue Passwort dem bisherigen, MUST er
mit 422 antworten, und das Cookie bleibt gültig. Der Erfolg schreibt `passwort_geaendert`, dazu
`login_ok`, wenn nicht schon der zweite Faktor die Anmeldung protokolliert hat.

#### Scenario: Neues Passwort festlegen

- **WHEN** `max` nach der Anmeldung mit dem Einmalpasswort `neues-passwort-1` festlegt
- **THEN** antwortet der Server mit seiner Benutzerdarstellung und einem Sitzungs-Cookie
- **AND** die nächste Anmeldung mit `neues-passwort-1` bekommt sofort eine Sitzung
- **AND** das Einmalpasswort meldet nicht mehr an

#### Scenario: Dasselbe Passwort noch einmal

- **WHEN** `max` als neues Passwort das Einmalpasswort selbst eingibt
- **THEN** antwortet der Server mit 422 „Das neue Passwort muss sich vom bisherigen unterscheiden.“
- **AND** ein zweiter Versuch mit einem anderen Passwort gelingt ohne neue Anmeldung

#### Scenario: Zu kurzes Passwort

- **WHEN** `max` ein neues Passwort mit sieben Zeichen festlegen will
- **THEN** antwortet der Server mit 400, und das Cookie bleibt gültig

#### Scenario: Neues Einmalpasswort während des Wechsels

- **WHEN** `max` sich mit dem ersten Einmalpasswort angemeldet hat und ein Admin ihm vor dem Festlegen ein zweites vergibt
- **THEN** antwortet `POST /api/auth/passwort/festlegen` mit 401, und das zweite Einmalpasswort bleibt gültig

#### Scenario: Ohne Zwischenschritt

- **WHEN** `POST /api/auth/passwort/festlegen` ohne oder mit abgelaufenem Wechsel-Cookie eintrifft
- **THEN** antwortet der Server mit 401 und ändert kein Passwort

### Requirement: Andere Anmeldewege bleiben vom Zwang unberührt

Passkey, SSO und App-Code MUST für ein Konto unter Änderungszwang wie bisher eine Sitzung anlegen.
Ändert die Person danach ihr Passwort im Profil, MUST der Zwang enden.

#### Scenario: Passkey bei offenem Zwang

- **WHEN** `max` unter Änderungszwang steht und sich mit seinem Passkey anmeldet
- **THEN** bekommt er sofort eine Sitzung

#### Scenario: Wechsel im Profil hebt den Zwang auf

- **WHEN** `max` unter Änderungszwang per Passkey angemeldet ist und sein Passwort im Profil mit dem Einmalpasswort als bisherigem Passwort ändert
- **THEN** bekommt die nächste Anmeldung mit dem neuen Passwort sofort eine Sitzung

### Requirement: Die Anmeldeseite führt durch den Wechsel

Antwortet der Passwort-Login mit `passwort_wechsel_erforderlich`, MUST die Anmeldeseite den Schritt
„Neues Passwort festlegen“ zeigen. Er hat die Felder „Neues Passwort“ und „Neues Passwort
wiederholen“. Die Seite MUST NOT die Person vorher als angemeldet übernehmen: Andere Tabs und das
Offline-Lagebild sehen sie erst nach dem Festlegen.

#### Scenario: Schritt nach dem Einmalpasswort

- **WHEN** `max` auf der Anmeldeseite Benutzername und Einmalpasswort eingibt und „Anmelden“ wählt
- **THEN** zeigt die Seite „Neues Passwort festlegen“ mit zwei Passwortfeldern
- **AND** nach „Passwort festlegen“ mit gültiger Eingabe landet `max` auf der Einsatzliste

#### Scenario: Wiederholung passt nicht

- **WHEN** die beiden Felder verschiedene Passwörter enthalten
- **THEN** zeigt die Seite einen Feldfehler und sendet nichts

### Requirement: Die Benutzerverwaltung bietet das Einmalpasswort an

Der Bearbeiten-Dialog eines Kontos MUST die Aktion „Einmalpasswort vergeben“ tragen. Sie fragt vorher
nach und nennt dabei die Folge. Danach MUST der Dialog das Einmalpasswort einmal anzeigen, mit
Kopierknopf. Wo der Server sicher ablehnt (eigenes Konto, SSO-only-Konto), MUST die Aktion gesperrt
stehen und den Grund nennen.

#### Scenario: Einmalpasswort vergeben

- **WHEN** ein Admin im Bearbeiten-Dialog von `max` „Einmalpasswort vergeben“ wählt und die Rückfrage bestätigt
- **THEN** zeigt der Dialog das Einmalpasswort mit einem Knopf „Kopieren“

#### Scenario: Eigenes Konto

- **WHEN** ein Admin seinen eigenen Bearbeiten-Dialog öffnet
- **THEN** steht „Einmalpasswort vergeben“ gesperrt, mit einem Grund, der auf das Profil verweist
