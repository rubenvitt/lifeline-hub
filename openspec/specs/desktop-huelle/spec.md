# desktop-huelle Specification

## Purpose

Legt fest, was die Tauri-2-Desktophülle aus LFH-128 Phase 1 (Variante A: der Webview lädt die
https-Adresse des Servers) leisten muss, damit die gemessenen Grenzen von WKWebView und WebView2
die Anwendung nicht still brechen. Herleitung und Belege:
`openspec/changes/archive/2026-09-29-lfh-720-tauri-huelle-variante-a/design.md` (LFH-720).

## Requirements

### Requirement: Die Hülle lädt nur eine https-Serveradresse
Die Hülle MUST als Serveradresse ausschließlich eine `https`-URL mit Host annehmen, sowohl aus
der Erststart-Maske als auch aus einem Deeplink. Eine andere Adresse MUST mit einer Meldung
abgelehnt werden, die den Grund nennt. Service Worker, Cache Storage und WebAuthn setzen einen
Secure Context voraus.

#### Scenario: http-Adresse in der Erststart-Maske
- **WHEN** jemand `http://elw.local:8080` eingibt und „Verbinden“ wählt
- **THEN** bleibt die Maske stehen und nennt https als Voraussetzung

### Requirement: Ein Serverwechsel per Deeplink wird bestätigt
Öffnet ein Deeplink die Hülle mit einer Serveradresse, die von der gespeicherten abweicht, MUST
die Hülle vor dem Umschalten eine Bestätigung mit der neuen Adresse einholen. Ohne Bestätigung
MUST die gespeicherte Adresse bleiben.

#### Scenario: Fremder Link will umlenken
- **WHEN** die Hülle mit `https://elw.local:8443` verbunden ist und ein Link
  `…/verbinden?server=https://fremd.example` öffnet
- **THEN** fragt die Hülle mit der Adresse `https://fremd.example` nach, und bei Ablehnung
  bleibt `https://elw.local:8443` geladen

### Requirement: Die native Brücke gilt genau für die konfigurierte Origin
Die Hülle MUST die Commands, die die Server-Seite aufrufen darf, zur Laufzeit per Capability
genau für die Origin der konfigurierten Serveradresse freigeben. Sie MUST keine Wildcard-Origin
und keine zur Build-Zeit verdrahtete Serverliste verwenden. Nach einem Serverwechsel MUST die
neue Origin freigegeben sein.

#### Scenario: Seite einer anderen Origin ruft einen Command
- **WHEN** der Webview eine Seite von einer anderen Origin als der konfigurierten zeigt und
  diese einen freigegebenen Command ruft
- **THEN** lehnt Tauri den Aufruf ab

### Requirement: macOS-Hülle deklariert den Zugriff aufs lokale Netz
Das macOS-Bundle MUST `NSLocalNetworkUsageDescription` mit einem Text tragen, der den
Einsatzserver im lokalen Netz nennt. Ohne diese Freigabe löst WKWebView einen `.local`-Namen
nicht auf, und die Verbindung scheitert nach 60 s ohne Fehlerbild.

#### Scenario: Erster Start mit `elw.local`
- **WHEN** die Hülle zum ersten Mal `https://elw.local:8443` lädt
- **THEN** fragt macOS nach der Freigabe „Lokales Netzwerk“ und die Seite lädt nach der
  Zustimmung

### Requirement: Drucken erreicht den Systemdialog
Ein Druckauftrag der Anwendung (`window.print()`) MUST auf jeder Plattform den Druckdialog des
Systems öffnen. Wo der Webview `window.print()` nicht umsetzt (WKWebView), MUST die Hülle den
Aufruf auf den nativen Druck des Webviews umleiten.

#### Scenario: Drucken auf macOS
- **WHEN** die Anwendung in der macOS-Hülle `window.print()` ruft
- **THEN** erscheint der macOS-Druckdialog für die aktuelle Seite

### Requirement: Neue Fenster und fremde Links laufen nicht ins Leere
Die Hülle MUST Anfragen nach einem neuen Fenster (`window.open`, `target="_blank"`) behandeln:
Ziele auf der konfigurierten Origin MUST in der Hülle geöffnet werden, fremde Origins MUST im
Standardbrowser des Systems geöffnet werden. Eine Hauptframe-Navigation auf eine
Dateiantwort MUST als Download behandelt werden und MUST die Anwendung nicht ersetzen.

#### Scenario: Chat-Anhang mit `target="_blank"`
- **WHEN** jemand im Chat einen Anhang-Link anklickt
- **THEN** öffnet oder lädt die Hülle die Datei, und die Anwendung bleibt bedienbar

#### Scenario: Externer Link
- **WHEN** jemand im Fachebenen-Inspector einen Link auf eine fremde Website anklickt
- **THEN** öffnet der Standardbrowser die Seite

### Requirement: Live-Updates laufen im Hintergrund weiter
Die Hülle MUST auf macOS `background_throttling` so setzen, dass WKWebView den Webview eines
verdeckten oder minimierten Fensters nicht suspendiert. Die Anwendung MUST nach jedem
Wiederaufbau der Live-Verbindung nachsynchronisieren (heute `invalAlle` in
`useEinsatzLiveStream`).

#### Scenario: Minimiertes Fenster auf macOS
- **WHEN** das Hüllenfenster minimiert ist und der Server ein Live-Ereignis sendet
- **THEN** bleibt der Webview-Prozess aktiv, statt in den Zustand „Suspended“ zu wechseln

### Requirement: Downloads landen im Download-Ordner
Ein Download über `<a download>` MUST ohne Rückfrage im Download-Ordner des Benutzers landen,
mit dem vom Server gelieferten Dateinamen einschließlich Umlauten, und MUST bei einer
Namensgleichheit eine vorhandene Datei nicht überschreiben.

#### Scenario: Zweimal dieselbe Datei
- **WHEN** jemand denselben Anhang zweimal herunterlädt
- **THEN** liegen zwei Dateien im Download-Ordner, die zweite mit Zählzusatz


### Requirement: Ohne gespeicherte Serveradresse erscheint die Erststart-Maske
Hat die Hülle keine gültige Serveradresse gespeichert, MUST sie beim Start eine lokale Maske
zeigen, in der die Adresse eingegeben wird. Nach „Verbinden“ mit einer gültigen Adresse MUST die
Hülle die Adresse dauerhaft speichern und die Anwendung von dort laden. Bei jedem weiteren Start
MUST sie die gespeicherte Adresse ohne Maske laden.

#### Scenario: Erster Start
- **WHEN** die Hülle zum ersten Mal startet
- **THEN** zeigt sie die Erststart-Maske und lädt keine Serverseite

#### Scenario: Zweiter Start
- **WHEN** jemand beim ersten Start `https://elw.local:8443` verbunden hat und die Hülle neu startet
- **THEN** lädt die Hülle `https://elw.local:8443` ohne Maske

#### Scenario: Adresse ohne Hostname
- **WHEN** jemand `https://` oder `https:///einsatz` eingibt
- **THEN** bleibt die Maske stehen und nennt den fehlenden Hostnamen als Grund

### Requirement: Die Serveradresse lässt sich wechseln
Die Hülle MUST über ihr Anwendungsmenü einen Eintrag „Server wechseln…“ anbieten, der die
Erststart-Maske mit der gespeicherten Adresse vorbelegt öffnet. Bricht jemand dort ab, MUST die
gespeicherte Adresse wieder geladen werden.

#### Scenario: Wechsel abgebrochen
- **WHEN** jemand „Server wechseln…“ wählt und die Maske mit „Abbrechen“ verlässt
- **THEN** lädt die Hülle wieder die bisher gespeicherte Adresse

### Requirement: Der Deeplink hat ein festes Schema
Die Hülle MUST Deeplinks der Form `lifeline://verbinden?server=<https-Adresse>` annehmen.
Deeplinks mit einem anderen Pfad oder ohne Parameter `server` MUST sie ohne Wirkung verwerfen.
Hat die Hülle noch keine Adresse gespeichert, MUST ein gültiger Deeplink die Erststart-Maske mit
der Adresse vorbelegen, und verbunden wird erst mit „Verbinden“.

#### Scenario: Deeplink beim ersten Start
- **WHEN** die Hülle ohne gespeicherte Adresse über `lifeline://verbinden?server=https://elw.local:8443` geöffnet wird
- **THEN** zeigt die Erststart-Maske `https://elw.local:8443` im Eingabefeld, und nichts ist gespeichert

#### Scenario: Unbekannter Pfad
- **WHEN** die Hülle `lifeline://trennen?server=https://elw.local:8443` empfängt
- **THEN** ändert sich weder die gespeicherte noch die geladene Adresse

### Requirement: Die Hülle läuft als eine Instanz
Ein zweiter Start der Hülle, auch per Deeplink, MUST an die laufende Instanz übergeben werden.
Diese MUST ihr Fenster in den Vordergrund holen und einen mitgegebenen Deeplink verarbeiten. Ein
zweites Hauptfenster MUST NOT entstehen.

#### Scenario: Deeplink bei laufender Hülle
- **WHEN** die Hülle läuft und jemand einen `lifeline://verbinden?…`-Link öffnet
- **THEN** kommt das vorhandene Fenster nach vorn und verarbeitet den Link, und es entsteht kein zweites Fenster
