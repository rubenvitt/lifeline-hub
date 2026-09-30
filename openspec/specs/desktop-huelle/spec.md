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
der Adresse vorbelegen, und verbunden wird erst mit „Verbinden“. Ein `lifeline://anmeldung`, der
als Deeplink von außen eintrifft und nicht aus der laufenden Anmeldesitzung der Hülle stammt,
MUST ohne Wirkung bleiben. Verworfene Deeplinks MUST ohne ihre Query ins Protokoll.

#### Scenario: Deeplink beim ersten Start
- **WHEN** die Hülle ohne gespeicherte Adresse über `lifeline://verbinden?server=https://elw.local:8443` geöffnet wird
- **THEN** zeigt die Erststart-Maske `https://elw.local:8443` im Eingabefeld, und nichts ist gespeichert

#### Scenario: Unbekannter Pfad
- **WHEN** die Hülle `lifeline://trennen?server=https://elw.local:8443` empfängt
- **THEN** ändert sich weder die gespeicherte noch die geladene Adresse

#### Scenario: Anmeldecode von außen
- **WHEN** eine Webseite `lifeline://anmeldung?code=abc` öffnet, während die Hülle läuft
- **THEN** löst die Hülle nichts ein, ihre Sitzung ändert sich nicht, und im Protokoll steht der Link ohne `code`

### Requirement: Die Hülle läuft als eine Instanz
Ein zweiter Start der Hülle, auch per Deeplink, MUST an die laufende Instanz übergeben werden.
Diese MUST ihr Fenster in den Vordergrund holen und einen mitgegebenen Deeplink verarbeiten. Ein
zweites Hauptfenster MUST NOT entstehen.

#### Scenario: Deeplink bei laufender Hülle
- **WHEN** die Hülle läuft und jemand einen `lifeline://verbinden?…`-Link öffnet
- **THEN** kommt das vorhandene Fenster nach vorn und verarbeitet den Link, und es entsteht kein zweites Fenster

### Requirement: Die Hülle meldet, ob sie Passkeys ausführen kann
Die Hülle MUST der geladenen Anwendung vor dem ersten Skript der Seite mitteilen, ob der
Webview Passkeys (WebAuthn) ausführen kann. Auf macOS MUST sie „nicht möglich“ melden, solange
keine Verknüpfung per Associated Domains besteht. Die Anwendung MUST diese Meldung der
Feature-Erkennung des Webviews vorziehen, weil WKWebView dort Fähigkeiten meldet, die es in
der Hülle nicht einlöst. Ohne Meldung (Browser) MUST die Anwendung sich verhalten wie heute.

#### Scenario: macOS-Hülle
- **WHEN** die macOS-Hülle die Anmeldeseite lädt
- **THEN** meldet sie „Passkey nicht möglich“, und die Seite bietet keine Passkey-Anmeldung an

#### Scenario: Browser ohne Hülle
- **WHEN** dieselbe Seite in einem Browser geöffnet wird
- **THEN** fehlt die Meldung, und die Passkey-Anmeldung steht wie bisher zur Verfügung

### Requirement: Die macOS-Hülle bietet keinen Passkey an, den sie nicht ausführen kann
Meldet die Hülle „Passkey nicht möglich“, MUST die Anwendung weder die Passkey-Anmeldung noch
die Einrichtung eines Passkeys anbieten. An der Stelle der Einrichtung MUST sie in einem Satz
sagen, dass Passkeys im Browser eingerichtet werden. Passwort- und OIDC-Anmeldung MUST
unverändert angeboten werden.

#### Scenario: Profil in der macOS-Hülle
- **WHEN** jemand in der macOS-Hülle das Profil öffnet
- **THEN** fehlt „Passkey einrichten“, und ein Hinweis nennt den Browser als Weg

### Requirement: Die macOS-Hülle meldet sich im Systembrowser an
Die macOS-Hülle MUST der geladenen Anwendung melden, dass sie die Anmeldung im Systembrowser
anbietet, und MUST der Serverseite genau diese eine Handlung freigeben. Die Anmeldeseite in der
macOS-Hülle MUST „Im Browser anmelden“ anbieten, neben Passwort und OIDC und auch dann, wenn
nur Passkeys aktiv sind. Die Passkey-Anmeldung selbst MUST in der Hülle weiter fehlen.

Beim Start der Handlung MUST die Hülle einen neuen, zufälligen `verifier` erzeugen und ihn
nicht aus der Hülle herausgeben. Sie MUST die Bestätigungsseite des geladenen Servers in einer
`ASWebAuthenticationSession` öffnen und dabei nur die `challenge` übergeben. Den Rücksprung
`lifeline://anmeldung?code=…` MUST sie nur aus dieser Sitzung annehmen. Den Code MUST sie mit
dem `verifier` gegen denselben Server einlösen, und zwar nur in dem Fenster, aus dem die
Anmeldung gestartet wurde, und nur, wenn es gerade eine Seite dieses Servers zeigt. Nach
erfolgreicher Einlösung MUST dieses Fenster angemeldet sein,
ohne dass die Hülle neu startet. Bricht die Person ab oder scheitert die Einlösung, MUST die
Anmeldeseite stehen bleiben und einen Hinweis zeigen. Ein erneuter Start MUST einen laufenden
ersetzen, und ein alter `verifier` MUST dabei verfallen. Die Handlung MUST wieder bedienbar sein,
sobald der Start zurückgekehrt ist, auch wenn der Browser keinen Abbruch meldet.

#### Scenario: SSO-Konto mit Passkey-only-IdP
- **WHEN** ein Konto ohne eigenes Passwort, dessen IdP nur Passkeys kennt, in der macOS-Hülle „Im Browser anmelden“ wählt und sich im Browser beim IdP per Passkey anmeldet
- **THEN** ist die Mac-App danach als dieses Konto angemeldet

#### Scenario: Lifeline-Passkey
- **WHEN** jemand mit einem im Browser eingerichteten Lifeline-Passkey „Im Browser anmelden“ wählt und sich dort per Passkey anmeldet
- **THEN** ist die Mac-App danach angemeldet

#### Scenario: Abbruch
- **WHEN** die Person das Anmeldefenster des Browsers schließt, ohne zuzustimmen
- **THEN** bleibt die Anmeldeseite der Mac-App stehen, und es entsteht keine Sitzung

#### Scenario: Nur Passkey aktiv
- **WHEN** auf dem Server nur Passkeys als Anmeldeweg aktiv sind und die macOS-Hülle die Anmeldeseite lädt
- **THEN** zeigt die Seite „Im Browser anmelden“ und keinen Passkey-Knopf

#### Scenario: Browser und Windows-Hülle
- **WHEN** die Anmeldeseite im Browser oder in der Windows-Hülle geöffnet wird
- **THEN** fehlt „Im Browser anmelden“, und die Seite verhält sich wie bisher

#### Scenario: Fremde Seite im startenden Fenster
- **WHEN** der Rücksprung eintrifft, während das Fenster, aus dem die Anmeldung gestartet wurde, eine Seite einer anderen Origin zeigt
- **THEN** löst die Hülle den Code nicht ein und gibt weder Code noch `verifier` an diese Seite
