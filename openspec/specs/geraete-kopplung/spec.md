# geraete-kopplung Specification

## Purpose
Ein ausgegebenes Gerät (Tablet, Laptop, Lagemonitor) arbeitet ohne Personenkonto in genau einem
Einsatz: gekoppelt durch die Einsatzleitung, befristet, jederzeit widerrufbar und mit eigener
Urheberschaft in ETB und Audit.

## Requirements

### Requirement: Nur die Einsatzleitung koppelt Geräte

Das System SHALL das Anlegen, Verlängern, Neuausstellen und Widerrufen einer Kopplung nur der
Einsatzleitung eines aktiven Einsatzes erlauben. Eine Kopplung MUST Einsatz, Funktionsansicht
und Gerätebezeichnung tragen, bei einer stellengebundenen Ansicht zusätzlich die Stelle.

#### Scenario: Führungspersonal darf nicht koppeln

- **WHEN** ein Mitglied mit der Rolle Führungspersonal eine Kopplung anlegen will
- **THEN** antwortet der Server mit 403
- **AND** entsteht keine Kopplung

#### Scenario: UHS-Ansicht ohne UHS

- **WHEN** die Einsatzleitung eine Kopplung „UHS-Tablet“ ohne UHS anlegt
- **THEN** antwortet der Server mit 400

#### Scenario: Kein Koppeln am abgeschlossenen Einsatz

- **WHEN** die Einsatzleitung an einem abgeschlossenen Einsatz koppeln will
- **THEN** antwortet der Server mit 409

### Requirement: Kopplungscode ist kurzlebig und einmalig

Das System SHALL je Kopplung einen Code aus 8 Zeichen ausgeben, der 10 Minuten gilt und genau
einmal eingelöst werden kann. Der Code MUST als Text und als QR angezeigt werden; der QR MUST
den Code im Fragment der Adresse tragen. Der Server MUST den Code nur gehasht speichern.

#### Scenario: Code einlösen

- **WHEN** ein Gerät auf `/koppeln` einen gültigen Code einlöst
- **THEN** erhält es eine Gerätesitzung für diese Kopplung
- **AND** landet auf der Startseite seiner Funktionsansicht

#### Scenario: Code ein zweites Mal

- **WHEN** derselbe Code ein zweites Mal eingelöst wird
- **THEN** antwortet der Server mit 401
- **AND** entsteht keine zweite Sitzung

#### Scenario: Falscher und abgelaufener Code antworten gleich

- **WHEN** ein Gerät einen unbekannten oder einen abgelaufenen Code einlöst
- **THEN** antwortet der Server in beiden Fällen mit 401 und demselben Fehlertext

#### Scenario: Zu viele Versuche

- **WHEN** von einer Adresse mehr Fehlversuche kommen, als das Rate-Limit erlaubt
- **THEN** antwortet der Server mit 429, auch für einen richtigen Code

### Requirement: Eine Kopplung, ein Gerät

Das System SHALL beim Einlösen eines neu ausgestellten Codes alle bisherigen Sitzungen derselben
Kopplung beenden.

#### Scenario: Gerät getauscht

- **WHEN** die Einsatzleitung für eine bestehende Kopplung einen neuen Code ausstellt
- **AND** ein zweites Gerät ihn einlöst
- **THEN** bekommt das erste Gerät bei seiner nächsten Anfrage 401

### Requirement: Kopplung läuft ab

Eine Kopplung SHALL nach der gewählten Frist enden, ohne Angabe nach 24 Stunden, höchstens nach
72 Stunden. Die Einsatzleitung MUST sie verlängern können. Mit dem Abschluss des Einsatzes MUST
jede Kopplung enden, auch in der Nachlauffrist.

#### Scenario: Frist überschritten

- **WHEN** die Frist einer Kopplung verstrichen ist
- **THEN** bekommt das Gerät bei der nächsten Anfrage 401

#### Scenario: Frist über 72 Stunden

- **WHEN** die Einsatzleitung eine Frist über 72 Stunden setzt
- **THEN** antwortet der Server mit 400

#### Scenario: Einsatz abgeschlossen

- **WHEN** der Einsatz abgeschlossen wird
- **THEN** bekommt jedes gekoppelte Gerät bei der nächsten Anfrage 401

### Requirement: Widerruf wirkt sofort

Nach einem Widerruf SHALL das Gerät keinen Zugriff mehr haben: jede folgende Anfrage MUST 401
sein, und ein offener Live-Kanal der Kopplung MUST der Server beenden, ohne auf eine Anfrage des
Geräts zu warten.

#### Scenario: Widerruf bei offener Verbindung

- **WHEN** ein Gerät einen offenen Live-Kanal hat
- **AND** die Einsatzleitung seine Kopplung widerruft
- **THEN** schließt der Server den Live-Kanal
- **AND** antwortet auf die nächste Anfrage des Geräts mit 401

#### Scenario: Widerruf trifft nur dieses Gerät

- **WHEN** die Einsatzleitung eine von zwei Kopplungen widerruft
- **THEN** arbeitet das andere Gerät ungestört weiter

### Requirement: Gerätekonto ist keine Person

Jede Kopplung SHALL unter einem eigenen Gerätekonto schreiben. Ein Gerätekonto MUST NOT in
Benutzerverwaltung, Mitgliederauswahl oder Personenauswahl erscheinen und MUST sich nicht über
Passwort, SSO, Passkey oder App-Code anmelden können.

#### Scenario: Benutzerliste

- **WHEN** ein Admin die Benutzerverwaltung öffnet
- **THEN** sieht er kein Gerätekonto

#### Scenario: Passwortanmeldung mit Gerätekonto

- **WHEN** jemand sich mit dem Benutzernamen eines Gerätekontos anmelden will
- **THEN** schlägt die Anmeldung fehl wie bei einem falschen Passwort

### Requirement: Einträge nennen Gerät und Stelle

Ein Eintrag, den ein gekoppeltes Gerät schreibt, SHALL als Erfasser das Gerätekonto tragen. Die
Anzeige MUST Stelle und Gerätebezeichnung nennen (etwa „UHS Nord · Tablet 1“).

#### Scenario: Belegung vom Tablet im ETB

- **WHEN** das Tablet der UHS Nord eine Person in die UHS bucht
- **THEN** nennt der zugehörige ETB-Eintrag „UHS Nord · Tablet 1“ als Erfasser

### Requirement: Kopplungen sind auditiert

Das System SHALL jede Einlösung, gelungen wie gescheitert, mit IP im Anmelde-Audit unter dem
Anmeldeweg `geraetecode` festhalten, Anlegen, Code-Ausstellung, Einlösung, Verlängerung und
Widerruf in der Ereignisspur der Kopplung, und Anlegen, Einlösen und Widerruf zusätzlich als
System-Eintrag im ETB des Einsatzes. Der Ablauf braucht keinen Eintrag: er folgt aus dem
gespeicherten Ende. Die Einsatzleitung MUST je Kopplung sehen, wer sie angelegt
hat, wann sie eingelöst wurde und wann das Gerät zuletzt zugegriffen hat.

#### Scenario: Widerruf im ETB

- **WHEN** die Einsatzleitung das Tablet der UHS Nord widerruft
- **THEN** steht im ETB ein System-Eintrag mit Gerät, Stelle und widerrufender Person

#### Scenario: Gescheiterte Einlösung im Anmelde-Audit

- **WHEN** jemand einen falschen Kopplungscode eingibt
- **THEN** steht im Anmelde-Audit ein Fehlschlag mit Anmeldeweg `geraetecode` und IP

#### Scenario: Übersicht der Kopplungen

- **WHEN** die Einsatzleitung die Geräteübersicht öffnet
- **THEN** sieht sie je Kopplung Ansicht, Stelle, Status, Ablauf, Anleger und letzten Zugriff
