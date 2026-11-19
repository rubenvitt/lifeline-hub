# Spec Delta

## Purpose

Verhalten der iOS-App für iPhone und iPad: ein nativer Rahmen, der die Weboberfläche des jeweils
gewählten Servers lädt, mehrere Server verwaltet, nur verträgliche Server lädt und die nativen
Wege (Anmeldung, Haptik, Meldung, Downloads, Druck) über eine auf den Server begrenzte Brücke
anbietet, ohne eigene Fachlogik.

## ADDED Requirements

### Requirement: Ohne Server zeigt die App nur das Onboarding
Ohne gespeicherten Server MUST die App nur das Onboarding zeigen. Es MUST die Eingabe einer
Adresse, das Scannen eines QR-Codes (Inhalt: Deeplink `lifeline://verbinden?server=…` oder
https-Adresse) und die Vorbelegung per Deeplink anbieten. Die App MUST einen Server erst
speichern, nachdem die Adresse gültig ist und der Server verträglich ist.

#### Scenario: Erster Start
- **WHEN** die App zum ersten Mal startet
- **THEN** zeigt sie das Onboarding und lädt keine Webseite

#### Scenario: QR-Code mit Deeplink
- **WHEN** jemand im Onboarding einen QR-Code mit `lifeline://verbinden?server=https://elw.local:8443` scannt
- **THEN** steht die Adresse im Onboarding, und verbunden wird erst nach Bestätigung

### Requirement: Die App nimmt nur eine https-Adresse mit Hostname
Die App MUST eine Serveradresse nach denselben Regeln prüfen wie die Desktop-Hülle: nur `https`,
Hostname Pflicht, keine Zugangsdaten vor `@`, drei Schrägstriche nach dem Schema gelten als
fehlender Hostname. Sie MUST dieselben Meldungen zeigen. Die Fälle MUST mit denen der
Desktop-Hülle übereinstimmen.

#### Scenario: http-Adresse
- **WHEN** jemand `http://elw.local:8443` eingibt
- **THEN** zeigt die App „Nur https-Adressen sind möglich: …“ und speichert nichts

#### Scenario: Zugangsdaten vor dem Host
- **WHEN** jemand `https://elw.local:8443@evil.example` eingibt
- **THEN** lehnt die App die Adresse ab

### Requirement: Mehrere Server lassen sich verwalten
Die App MUST mehrere Server speichern und in einer nativen Liste mit Name (Vorgabe Hostname,
änderbar), Adresse und zuletzt verbunden zeigen. Wechseln, Umbenennen, Hinzufügen und Entfernen
MUST möglich sein. Der aktive Server MUST sichtbar sein und MUST sich erst nach einem Wechsel
entfernen lassen. Vor dem Entfernen MUST die App darauf hinweisen, dass noch nicht übertragene
Einträge dieses Servers verloren gehen.

#### Scenario: Wechsel
- **WHEN** jemand in der Liste einen anderen Server wählt
- **THEN** lädt die App dessen Oberfläche, und der aktive Server ist der gewählte

#### Scenario: Aktiven Server entfernen
- **WHEN** jemand den aktiven Server entfernen will
- **THEN** bietet die App das erst nach einem Wechsel an

### Requirement: Jeder Server hat seinen eigenen Datenspeicher
Cookies, Sitzung, IndexedDB, Local Storage und Cache eines Servers MUST getrennt von denen jedes
anderen Servers liegen. Das Entfernen eines Servers MUST seinen Datenspeicher löschen.

#### Scenario: Zwei Server, zwei Sitzungen
- **WHEN** jemand an Server A und Server B mit verschiedenen Konten angemeldet ist und zwischen ihnen wechselt
- **THEN** ist er an jedem Server mit dessen Konto angemeldet, und Offline-Daten von A erscheinen nie bei B

#### Scenario: Server entfernt
- **WHEN** ein Server entfernt und mit derselben Adresse neu hinzugefügt wird
- **THEN** ist niemand angemeldet, und kein alter Offline-Stand ist vorhanden

### Requirement: Ein Deeplink lenkt nie still auf einen anderen Server
Ein Deeplink `lifeline://verbinden?server=…` MUST für einen unbekannten Server das Onboarding
vorbelegen, für einen bekannten, nicht aktiven Server erst nach Bestätigung wechseln und für den
aktiven Server nichts tun. Ein Deeplink mit ungültiger Adresse MUST wirkungslos bleiben.

#### Scenario: Bekannter anderer Server
- **WHEN** ein Deeplink auf einen gespeicherten, nicht aktiven Server geöffnet wird
- **THEN** fragt die App, ob sie wechseln soll, und wechselt nur nach Zustimmung

### Requirement: Die App lädt nur einen verträglichen Server
Vor dem Laden der Oberfläche — beim Start, beim Wechsel, im Onboarding und beim Neuladen nach
Rückkehr in den Vordergrund — MUST die App `GET /api/shell` abfragen. Kennt sie den
`shell_contract` nicht, MUST sie die Oberfläche nicht laden und eine native Seite mit der Version
des Servers, der Version der App und der Richtung zeigen: „App aktualisieren“ bei größerem,
„Server ist zu alt für diese App“ bei kleinerem Vertrag.

#### Scenario: Server wurde auf einen neuen Vertrag gehoben
- **WHEN** ein gespeicherter Server nach einem Update einen unbekannten, größeren `shell_contract` meldet
- **THEN** zeigt die App beim nächsten Laden „App aktualisieren“ und lädt die Oberfläche nicht

### Requirement: Server ohne Vertrag gelten als zu alt
Antwortet ein Server auf `GET /api/shell` mit 404, MUST die App ihn als zu alt behandeln, die
Version aus `GET /api/health` nennen und ihn im Onboarding nicht speichern. Ohne Verbindung zum
Server MUST der zuletzt bestätigte Vertrag dieses Servers gelten.

#### Scenario: Server ohne Endpunkt
- **WHEN** jemand einen Server hinzufügt, der `GET /api/shell` nicht kennt
- **THEN** zeigt die App „Server ist zu alt für diese App“ mit dessen Version und speichert ihn nicht

#### Scenario: Ohne Verbindung
- **WHEN** ein gespeicherter, zuletzt verträglicher Server nicht erreichbar ist
- **THEN** zeigt die App „nicht erreichbar“, nicht „nicht verträglich“

### Requirement: Zertifikatsfehler und Unerreichbarkeit haben eigene Seiten
Die App MUST Zertifikate prüfen wie das System, ohne eigene Ausnahmen. Scheitert eine Verbindung
am Zertifikat, MUST sie die native Seite „Zertifikat nicht vertrauenswürdig“ mit einer Anleitung
zum Installieren und Einschalten des CA-Profils zeigen. Ist der Server sonst nicht erreichbar,
MUST sie „nicht erreichbar“ zeigen, regelmäßig prüfen und die Oberfläche von selbst laden, sobald
der Server antwortet. Beide Seiten MUST den Weg zur Serverliste anbieten.

#### Scenario: CA nicht eingeschaltet
- **WHEN** der Server ein Zertifikat einer installierten, aber nicht eingeschalteten CA vorlegt
- **THEN** zeigt die App „Zertifikat nicht vertrauenswürdig“ mit Anleitung, nicht „nicht erreichbar“

#### Scenario: Server kommt zurück
- **WHEN** die App „nicht erreichbar“ zeigt und der Server wieder antwortet
- **THEN** lädt die App die Oberfläche ohne Zutun

### Requirement: Die Brücke gilt nur für den aktiven Server
Die App MUST Aufrufe der Brücke nur aus dem Hauptframe einer Seite annehmen, deren Origin die des
aktiven Servers ist. Nach einem Serverwechsel MUST sofort die neue Origin gelten. Aufrufe aus
anderen Frames oder Origins MUST ohne Wirkung bleiben.

#### Scenario: Fremde Seite im Webview
- **WHEN** im Webview eine Seite einer anderen Origin (etwa der Identitätsanbieter) die Brücke aufruft
- **THEN** passiert nichts

### Requirement: Die App meldet ihre Fähigkeiten und sperrt Passkeys im Webview
Die App MUST der Seite die Kennung `window.__LIFELINE_HUELLE__` mit `platform: 'ios'`, `version`,
`passkey: false`, `anmeldungImBrowser`, `haptics`, `benachrichtigungZeigen` und `setAppBadge` geben,
bevor das erste Skript der Seite läuft.

#### Scenario: Anmeldeseite in der App
- **WHEN** die Anmeldeseite in der iOS-App erscheint
- **THEN** fehlt der Passkey-Knopf, und „Im Browser anmelden“ ist da

### Requirement: Die App meldet sich im Systembrowser an
„Im Browser anmelden“ MUST die Bestätigungsseite des aktiven Servers in einer
Systembrowser-Sitzung öffnen, den `verifier` in der App behalten und den Rücksprung
`lifeline://anmeldung?code=…` nur aus dieser Sitzung annehmen. Den Code MUST die App im Webview
gegen denselben Server einlösen. Ein Rücksprung von außerhalb der Sitzung MUST wirkungslos
bleiben. Bricht die Person ab, MUST die Anmeldeseite stehen bleiben.

#### Scenario: Passkey beim Identitätsanbieter
- **WHEN** sich jemand über „Im Browser anmelden“ beim Identitätsanbieter per Passkey anmeldet
- **THEN** ist die App danach angemeldet

#### Scenario: Untergeschobener Rücksprung
- **WHEN** eine andere App `lifeline://anmeldung?code=…` öffnet
- **THEN** entsteht keine Sitzung

### Requirement: Haptik nur auf Wunsch der Seite und abschaltbar
Die App MUST `haptics(kind)` auf die Arten abbilden: `success`, `warning`, `error` auf die
entsprechende Benachrichtigungs-Rückmeldung, `selection` auf die Auswahl-Rückmeldung, `tap` auf
einen leichten Stoß. Die App MUST einen Schalter „Haptik“ in ihren Einstellungen haben (Vorgabe
an); ausgeschaltet MUST `haptics` nichts tun.

#### Scenario: Haptik aus
- **WHEN** der Schalter „Haptik“ aus ist und die Seite `haptics('success')` aufruft
- **THEN** spürt die Person nichts

### Requirement: Meldung und Badge bei laufender App
Ruft die Seite `benachrichtigungZeigen(titel, text)` auf, MUST die App eine native Meldung zeigen,
nachdem die Person die Berechtigung erteilt hat. `setAppBadge(count)` MUST die Zahl am Symbol
setzen, 0 MUST sie entfernen. Im Hintergrund MUST die App keine Meldung versprechen.

#### Scenario: Meldung bei offener App
- **WHEN** ein Alarm eingeht, während die App im Vordergrund ist und Meldungen erlaubt sind
- **THEN** erscheint eine native Meldung

### Requirement: Links, Downloads und Druck laufen nicht ins Leere
Die App MUST Links nach den Regeln der Desktop-Hülle behandeln: eigene Origin im Webview, auch für
`target=_blank` und `window.open`; `/api/` außer `/api/auth/` als Download; fremde `http(s)`,
`mailto` und `tel` im System. Downloads, auch aus `blob:`-Adressen, MUST mit der Sitzung des
Servers geladen und über das Teilen-Blatt angeboten werden. `window.print()` MUST den
System-Druckdialog mit dem Inhalt des Webviews öffnen.

#### Scenario: CSV-Export
- **WHEN** jemand einen CSV-Export auslöst
- **THEN** öffnet die App das Teilen-Blatt mit der Datei, und die Oberfläche bleibt bedienbar

#### Scenario: Externer Link
- **WHEN** jemand einen Link auf eine fremde Webseite antippt
- **THEN** öffnet ihn das System, nicht der Webview

#### Scenario: Drucken
- **WHEN** jemand im ETB auf „Drucken“ tippt
- **THEN** erscheint der Druckdialog von iOS

### Requirement: Von einer fremden Seite führt ein Weg zurück
Steht der Webview auf einer Seite außerhalb des aktiven Servers, MUST die App „Zur Oberfläche“ anbieten,
das die Startadresse des aktiven Servers neu lädt. Die fremde Seite MUST dabei nicht von selbst
verlassen werden, weil die Anmeldung beim Identitätsanbieter im Webview läuft.

#### Scenario: Zurück von einer fremden Seite
- **WHEN** der Webview nach einem abgebrochenen Ausflug zum Identitätsanbieter auf einer fremden Seite steht
- **THEN** bietet die App „Zur Oberfläche“ an und lädt damit die Startadresse des aktiven Servers neu

### Requirement: Die Oberfläche fühlt sich nativ an
Der Webview MUST innerhalb der sicheren Ränder liegen, MUST am Rand nicht nachfedern und MUST kein
Neuladen per Ziehen anbieten. Außerhalb von Eingabefeldern MUST lange Berührung keine Lupe und
kein Textmenü zeigen. Status-Seiten, Onboarding, Serverliste und Einstellungen MUST nativ sein.

#### Scenario: Ziehen am oberen Rand
- **WHEN** jemand die Seite über den oberen Rand hinaus zieht
- **THEN** bewegt sich die Seite nicht und lädt nicht neu

### Requirement: Nach einem Abbruch des Web-Prozesses lädt die App neu
Beendet iOS den Web-Prozess oder kehrt die App nach einer Pause in den Vordergrund zurück und die
Seite antwortet nicht, MUST die App die Oberfläche des aktiven Servers neu laden statt eine leere
Seite zu zeigen.

#### Scenario: Web-Prozess beendet
- **WHEN** iOS den Web-Prozess der App im Hintergrund beendet und die Person die App wieder öffnet
- **THEN** zeigt die App die Oberfläche des aktiven Servers
