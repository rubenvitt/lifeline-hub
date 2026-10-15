# web-push Specification

## Purpose
Benachrichtigungen erreichen eine Person auch dann, wenn auf ihrem Gerät kein Tab der App offen
ist, ohne dass Inhalte aus dem Einsatz über fremde Server gehen und ohne dass der Server ins
Internet spricht, wenn der Betreiber es nicht will.

## Requirements

### Requirement: Web Push nur auf Wunsch des Betreibers

Der Server SHALL Web Push nur anbieten, wenn der Betreiber es eingeschaltet hat (Vorgabe aus).
Eingeschaltet MUST der Server einen Kontakt (`mailto:` oder `https:`) für die Push-Dienste
kennen, sonst startet er nicht. Ausgeschaltet MUST der Server keine Verbindung zu einem
Push-Dienst aufbauen, und die Push-Routen antworten 404.

#### Scenario: Instanz ohne Internet
- **WHEN** der Server ohne Schalter läuft und eine Sofortmeldung eingeht
- **THEN** baut er keine ausgehende Verbindung zu einem Push-Dienst auf, und Tab und Desktop-App melden wie bisher

#### Scenario: Schalter ohne Kontakt
- **WHEN** der Server mit Schalter, aber ohne Kontakt startet
- **THEN** bricht der Start mit einer Fehlermeldung ab, die den fehlenden Kontakt nennt

### Requirement: Ein Schlüssel je Instanz

Der Server SHALL beim ersten Start mit Schalter ein Schlüsselpaar für Web Push erzeugen und es in
der Datenbank speichern. Jeder weitere Start MUST dasselbe Paar verwenden, auch nach einer
Wiederherstellung aus der Sicherung.

#### Scenario: Neustart
- **WHEN** der Server neu startet
- **THEN** liefert er denselben öffentlichen Schlüssel wie vorher, und bestehende Abos bleiben gültig

### Requirement: Abo gilt für ein Gerät und eine Sitzung

Ein Nutzer SHALL Push für das Gerät einschalten können, auf dem er angemeldet ist. Das Abo MUST an
die Sitzung gebunden sein: endet die Sitzung (Abmelden, Ablauf, Beenden, Passwortwechsel), MUST
das Abo mit ihr entfallen. Gerätekonten MUST NOT ein Abo anlegen können. Meldet sich auf demselben
Browser ein anderer Nutzer an und schaltet Push ein, MUST das Abo nur noch ihm gehören.

#### Scenario: Abmelden
- **WHEN** Person A auf ihrem Handy Push eingeschaltet hat und sich dort abmeldet
- **THEN** erhält das Handy danach keine Push-Meldung mehr für A

#### Scenario: Sitzung von anderem Gerät beendet
- **WHEN** Person A am Laptop die Sitzung ihres Handys beendet
- **THEN** entfällt das Abo des Handys

#### Scenario: Gerätekonto
- **WHEN** ein gekoppeltes Gerät ein Abo anmelden will
- **THEN** antwortet der Server mit 403

### Requirement: Nur Endpunkte bekannter Push-Dienste

Der Server SHALL ein Abo nur annehmen, wenn sein Endpunkt eine `https`-Adresse eines bekannten
Push-Dienstes ist (Google, Mozilla, Apple, Microsoft). Jeden anderen Endpunkt MUST er mit 400
ablehnen.

#### Scenario: Interne Adresse
- **WHEN** ein Client ein Abo mit dem Endpunkt `https://10.0.0.5/` anmeldet
- **THEN** antwortet der Server mit 400 und speichert nichts

### Requirement: Push an jedes Abo der Empfänger

Erhält ein Nutzer eine Benachrichtigung der Stufe Alarm oder Hinweis, SHALL der Server sie an
jedes seiner Abos senden. Die Nutzlast MUST nur Kennungen tragen wie das Live-Ereignis und MUST
Ende-zu-Ende verschlüsselt sein. Der Versand MUST die auslösende Anfrage weder verzögern noch
scheitern lassen. Meldet der Push-Dienst ein Abo als erloschen, MUST der Server es löschen.

#### Scenario: Alarm bei geschlossener App
- **WHEN** Person A Push auf ihrem Handy eingeschaltet hat, die App dort geschlossen ist und eine Sofortmeldung an A geht
- **THEN** erscheint auf dem Handy eine OS-Meldung „Sofortmeldung“, und ein Tipp darauf öffnet die Sofortmeldung in der App

#### Scenario: Abgeschaltete Hinweis-Art
- **WHEN** Person A die Art „Neue Gefahr“ abgeschaltet hat und eine Gefahr eingetragen wird
- **THEN** sendet der Server keinen Push an A's Geräte

#### Scenario: Erloschenes Abo
- **WHEN** der Push-Dienst auf einen Versand mit 410 antwortet
- **THEN** löscht der Server dieses Abo

#### Scenario: Push-Dienst nicht erreichbar
- **WHEN** der Push-Dienst nicht antwortet und ein Auftrag erteilt wird
- **THEN** antwortet die Auftragsroute wie ohne Push, und der Fehler steht im Log ohne den Endpunkt

### Requirement: Meldung des Service Workers

Der Service Worker SHALL zu jedem Push eine OS-Meldung zeigen, deren Text er beim Server des
Empfängers holt. Ist der Server nicht erreichbar, MUST er eine Meldung mit dem Titel der Stufe
zeigen. Hat die App einen fokussierten Tab, MUST er die Meldung sofort wieder schließen. Ein
verdeckter Tab und ein Push zur selben Benachrichtigung MUST NOT zwei OS-Meldungen ergeben.

#### Scenario: Server vom Handy nicht erreichbar
- **WHEN** ein Push eintrifft und die Abfrage des Textes scheitert
- **THEN** erscheint die OS-Meldung „Alarm“ bzw. „Neue Benachrichtigung“, und ein Tipp öffnet den Einsatz

#### Scenario: App im Vordergrund
- **WHEN** ein Push eintrifft, während ein Tab der App fokussiert ist
- **THEN** bleibt keine OS-Meldung stehen, und der Tab zeigt den Toast

### Requirement: Schalter je Gerät

Die Seite „Benachrichtigungen“ SHALL einen Schalter für Push auf diesem Gerät zeigen, wenn der
Server Push anbietet und der Browser es kann. In der Desktop-App MUST der Schalter fehlen.
Hat der Nutzer Push eingeschaltet, MUST das Frontend das Abo nach einer neuen Anmeldung auf
diesem Gerät von selbst wieder anmelden.

#### Scenario: Neue Anmeldung nach Ablauf
- **WHEN** die Sitzung von Person A auf dem Handy nach 7 Tagen abläuft und A sich dort neu anmeldet
- **THEN** ist Push auf dem Handy wieder an, ohne dass A den Schalter erneut betätigt

#### Scenario: iPhone im Browser
- **WHEN** Person A die Seite in Safari auf dem iPhone öffnet, ohne die App installiert zu haben
- **THEN** zeigt die Seite keinen Push-Schalter
