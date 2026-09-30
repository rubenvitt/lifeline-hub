# Spec Delta

## MODIFIED Requirements

### Requirement: Neue Fenster und fremde Links laufen nicht ins Leere
Die Hülle MUST Anfragen nach einem neuen Fenster (`window.open`, `target="_blank"`) behandeln:
Ziele auf der Origin des verbundenen Servers MUST in einem weiteren Fenster der Hülle geöffnet
werden, das dieselbe Sitzung, denselben Druckweg und dieselbe Link-Behandlung hat. Das
bestehende Fenster MUST dabei erhalten bleiben. Ziele mit `http`, `https`, `mailto` oder `tel`
auf einer fremden Origin MUST im Standardbrowser bzw. im zuständigen Systemprogramm geöffnet
werden. Alle anderen Ziele MUST verworfen und ohne Query protokolliert werden.

Eine Navigation oder ein neues Fenster auf eine Dateiroute der eigenen Origin (`/api/…`) MUST
als Download behandelt werden und MUST die Anwendung nicht ersetzen. Ausgenommen sind die
Anmelderouten (`/api/auth/…`), die im Fenster laufen MUST. Eine Navigation auf eine fremde
`http(s)`-Origin im Fenster MUST erlaubt bleiben, weil die Anmeldung beim Identitätsanbieter
dort stattfindet. `mailto:`- und `tel:`-Navigationen MUST an das Systemprogramm gehen.

Wechselt die Hülle den Server, MUST sie die weiteren Fenster schließen.

#### Scenario: Chat-Anhang mit `target="_blank"`
- **WHEN** jemand im Chat einen Anhang-Link anklickt
- **THEN** lädt die Hülle die Datei in den Download-Ordner, und die Anwendung bleibt bedienbar

#### Scenario: Datei-Link ohne `download` im selben Fenster
- **WHEN** eine Seite im Hauptfenster auf `/api/einsaetze/1/anhaenge/7` der eigenen Origin
  navigiert
- **THEN** lädt die Hülle die Datei herunter, und die zuvor angezeigte Seite bleibt stehen

#### Scenario: Externer Link
- **WHEN** jemand im Fachebenen-Inspector einen Link auf eine fremde Website anklickt
- **THEN** öffnet der Standardbrowser die Seite, und die Hülle bleibt auf der Anwendung

#### Scenario: Sprungpalette „in neuem Tab öffnen“
- **WHEN** jemand in der Sprungpalette mit Strg/⌘+↵ einen Treffer öffnet
- **THEN** öffnet die Hülle ein weiteres Fenster mit dem Ziel, angemeldet, und das
  bisherige Fenster bleibt auf seiner Seite

#### Scenario: Anmeldung über OIDC
- **WHEN** jemand im Hauptfenster die Anmeldung über einen Identitätsanbieter startet
- **THEN** führt das Fenster über `/api/auth/oidc/start` zum Anbieter und über
  `/api/auth/oidc/callback` zurück in die Anwendung, ohne Download und ohne Systembrowser

#### Scenario: Unerlaubtes Schema
- **WHEN** eine Seite ein neues Fenster mit `file:`- oder `javascript:`-Ziel anfordert
- **THEN** öffnet die Hülle nichts und vermerkt das Ziel ohne Query im Protokoll

#### Scenario: Serverwechsel mit offenem Nebenfenster
- **WHEN** ein weiteres Fenster offen ist und die Hülle auf einen anderen Server wechselt
- **THEN** schließt die Hülle das weitere Fenster
