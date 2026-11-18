# iOS-App als native Hülle um die Weboberfläche des Servers

Zunder: https://zunder.rubeen.dev/#/aufgabe/t39ltxxi3nvvqcoupqrae1do (LLH-1978)
Brainstorming mit Ruben am 18.11.2026. Markiert ist, was Ruben entschieden hat **(R)** und was
ein Vorschlag des Entwurfs ist **(V)**, den die Freigabe mit abdeckt.

## Absicht

Lifeline Hub soll auf iPhone und iPad als echte App laufen. Sie zeigt nur die Weboberfläche des
Servers, mit dem sie verbunden ist, fühlt sich aber nativ an, gibt haptische Rückmeldung und
startet auch dann, wenn der Server gerade nicht erreichbar ist. **(R)**

Warum eine Hülle und keine nachgebaute Oberfläche: Die Weboberfläche spricht die interne API,
die keine Zusage hat (`src/AGENTS.md`). Eine nachgebaute Oberfläche bräuchte einen
versionierten Vertrag für fast die ganze Fachlichkeit und müsste ihn über Jahre rückwärts
tragen. Bei der Hülle liefert jeder Server seine passende Oberfläche selbst. So bleibt die App
mit möglichst vielen Server-Versionen verträglich. **(R)**

## Ziele

- **Onboarding mit Pflicht-Server:** Beim ersten Start muss ein Server angegeben werden
  (Eingabe, QR-Code oder Deeplink `lifeline://verbinden?server=`). **(R)**
- **Mehrere Server:** hinzufügen, benennen, wechseln, entfernen. Der aktive Server ist sichtbar.
  **(R)**
- **Versionsverträglichkeit:** Eine App-Version läuft mit so vielen Server-Versionen wie möglich.
  Über eine Major-Grenze darf es brechen, dann sagt die App das klar. **(R)**
- **Offline:** „Online“ heißt, der Server ist erreichbar. Ohne Server startet die App mit der
  zuletzt gespeicherten Oberfläche dieses Servers. Das Frontend zeigt den letzten Stand
  (LFH-723) und sammelt Einträge (LFH-705) wie heute. **(R)**
- **Natives Gefühl und Haptik.** **(R)**
- **Verteilung über TestFlight.** **(R)**

## Nicht-Ziele

- Geräte untereinander ohne Server (P2P, Sync). **(R)**
- Eigene Fachlogik oder nachgebaute Bildschirme in Swift. **(R)**
- App Store, vorerst. Das kommt später als eigene Aufgabe, mit Prüfung nach Regel 4.2 und einem
  Demo-Server für die Prüfung. **(R)**
- Push über APNs. Das bräuchte APNs auf dem Server, also eine eigene Aufgabe. Bis dahin meldet
  die App nur, solange sie im Vordergrund ist oder iOS sie kurz weiterlaufen lässt. **(V)**
- Android. **(V)**

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Die App lenkt ohne Bestätigung auf einen anderen Server um. Dann könnte ein fremder Link die
  Anmeldung abgreifen; dieselbe Regel gilt in der Desktop-Hülle.
- Sitzungen oder Offline-Daten zweier Server vermischen sich.
- Ein älterer Server bricht nur deshalb, weil die App neuer ist (innerhalb desselben Majors).
- Die Oberfläche bekommt iOS-Sonderwege, die nicht über die Fähigkeits-Kennung der Hülle laufen.

## Ansätze

| Ansatz | Vorteil | Nachteil |
| --- | --- | --- |
| **A. Tauri-2-Hülle (`src-tauri/`) um ein iOS-Ziel erweitern** | ein Crate; Adressprüfung, Deeplink und Serverliste aus Rust wiederverwendet; Haptik als offizielles Plugin | Tauri-iOS ist jung, viel Desktop-Code (Fenster, Menü, Updater) gilt dort nicht; die nötige Feinsteuerung des WKWebView (Datenspeicher je Server, Ausliefern der gespeicherten Oberfläche) geht nur über Umwege |
| **B. Eigene Swift-App (SwiftUI + WKWebView)** — **gewählt (R)** | volle Kontrolle über den Webview; Onboarding und Serverliste als echtes SwiftUI; erprobte TestFlight-Pipeline aus Vault Cockpit (VCP-89/90) | zweite Sprache; Adressprüfung und Linkregeln entstehen ein zweites Mal |
| C. Komplett native App gegen eine stabile API | bestes Gefühl | doppelte Oberfläche, und eine API mit Zusage für fast alle Fachdaten fehlt; widerspricht dem Ziel der Versionsverträglichkeit — verworfen |
| D. Capacitor | — | schon in der Roadmap (`docs/superpowers/specs/2026-06-18-native-apps-roadmap-design.md`) ausgeschlossen |

## Entwurf

### D1 Ort, Plattform, Kennung **(V)**

- Code im Repo unter `ios/` (Xcode-Projekt, Swift Package für die testbare Logik). Verträge mit
  dem Server ändern sich so im selben PR wie die App. Neue Bereichsdatei `ios/AGENTS.md`, Eintrag
  in die Tabelle der Wurzel-`AGENTS.md`.
- iPhone und iPad, **ab iOS 17** (nötig für `WKWebsiteDataStore(forIdentifier:)`, siehe D3).
- Bundle-ID `dev.rubeen.lifeline.ios`, Team `H95J852PKP` (das Konto der macOS-Signierung,
  LLH-614).
- Version: `CFBundleShortVersionString` folgt der Workspace-Version (`[workspace.package]`) ohne
  Vorab-Suffix, `CFBundleVersion` ist die Build-Nummer der CI. Damit gilt auch hier eine Quelle
  (wie `src-tauri/AGENTS.md`, „Version: eine Quelle“).
- Neue Architekturentscheidung (ADR) „iOS-Hülle als eigene Swift-App“ nach
  `docs/architektur/AGENTS.md`.

### D2 Onboarding und Serverliste **(R, Form V)**

- Ohne gespeicherten Server zeigt die App nur das Onboarding: Adresse eingeben, QR-Code scannen
  (Kamera, Inhalt ist der Deeplink oder eine https-Adresse) oder per Deeplink vorbelegt.
- Die Adressprüfung folgt `src-tauri/src/adresse.rs` Regel für Regel: nur `https`, Hostname
  Pflicht, keine Zugangsdaten vor `@`, `https:///x` gilt als „ohne Host“. Dieselben Meldungstexte.
  Getestet mit denselben Fällen wie dort.
- Vor dem Speichern prüft die App den Server (D4). Ein Server außerhalb des unterstützten Majors
  wird nicht gespeichert, die Meldung sagt, welche App-Version passt.
- Serverliste (SwiftUI): Name (Vorgabe: Hostname, änderbar), Adresse, zuletzt verbunden,
  Verträglichkeit. Wechseln, umbenennen, entfernen; der aktive Server lässt sich nicht entfernen,
  ohne vorher zu wechseln. Erreichbar über einen dezenten nativen Knopf am Rand bzw. eine
  Wischgeste, ohne die Weboberfläche zu verdecken.
- Deeplink `lifeline://verbinden?server=…`: bekannter Server → wechseln nach Bestätigung, neuer
  Server → Onboarding vorbelegt, gleicher Server → nichts (wie `src-tauri/src/deeplink.rs`,
  `entscheide`).

### D2a Server mit eigenem Zertifikat **(R, 18.11.2026)**

Die App prüft Zertifikate wie das System, ohne eigene Ausnahmen und ohne Pinning. Ein Server im
Einsatz-LAN (`elw.local`, mkcert/interne CA) braucht auf dem Gerät das installierte und von Hand
als vertrauenswürdig eingeschaltete CA-Profil, wie heute im Browser (LLH-31). Scheitert die
Prüfung (Onboarding, Erreichbarkeit, Laden), zeigt die App eine native Seite „Zertifikat nicht
vertrauenswürdig“ mit der Anleitung (Profil laden, Einstellungen → Allgemein → Info →
Zertifikatsvertrauenseinstellungen) und unterscheidet das von „nicht erreichbar“.

### D3 Ein Datenspeicher je Server **(V)**

Jeder Server bekommt einen eigenen `WKWebsiteDataStore(forIdentifier:)` (UUID am Servereintrag).
Cookies, IndexedDB (Offline-Lagebild, Schreib-Queue), Local Storage und HTTP-Cache bleiben
getrennt. Entfernen eines Servers löscht seinen Datenspeicher (`removeDataStore`), nach einer
Rückfrage, wenn die Schreib-Queue noch Einträge hat (soweit die Hülle das erkennen kann, sonst
allgemeiner Hinweis).

### D4 Versionen und Fähigkeiten **(R: Ziel; V: Form)**

Zwei Richtungen, keine reine Versionsnummer-Logik:

1. **Server → App:** neuer anonymer Endpunkt `GET /api/huelle` mit
   `{ version, huelle_vertrag }`. `huelle_vertrag` ist eine ganze Zahl, die nur bei einem Bruch
   zwischen Hülle und Server steigt (entspricht dem „Major“ aus Sicht der App). Neue Felder kommen
   nur hinzu. Eine Fähigkeitsliste des Servers gibt es vorerst nicht: Ob eine Funktion der Hülle
   genutzt wird, entscheidet allein das Frontend (D6); die App braucht keine Logik nach
   Server-Fähigkeiten. *(Entscheidung des Entwurfs nach der Prüfung.)*
   **Älterer Server ohne Endpunkt** (404): gilt als nicht verträglich. Mindestversion ist die
   erste Server-Version mit `GET /api/huelle` **(R, 18.11.2026)**: Es gibt nur Alphas, ältere
   haben teils weder die Anmeldung im Systembrowser noch Offline-Lagebild oder Schreib-Queue.
   Die App liest dann `version` aus `GET /api/health` (anonym, gibt es schon) und nennt sie auf
   der Seite „Server ist zu alt für diese App“.
2. **App → Server:** wie bei der Desktop-Hülle über `window.__LIFELINE_HUELLE__`, ergänzt um
   `plattform: 'ios'`, `version` und die neuen Funktionen (D6). Das Frontend liest die Kennung
   weiter nur in `frontend/src/huelle/faehigkeiten.ts` und prüft jede Funktion einzeln. Ein
   älteres Frontend kennt die neuen Felder nicht und ignoriert sie.

Die App trägt eine Liste der `huelle_vertrag`-Werte, die sie kann (anfangs `[1]`). Liegt der
Server außerhalb, zeigt die App eine native Seite und lädt die Oberfläche nicht. Kein halbes
Funktionieren. Die Seite nennt Version des Servers und der App und die Richtung: Server-Vertrag
größer → „App aktualisieren“, kleiner → „Server ist zu alt für diese App“. Ein Feld „passende
App-Version“ liefert der Server nicht. *(Entscheidung des Entwurfs.)*

`__LIFELINE_HUELLE__.version` und die Anzeigen nennen die volle Workspace-Version
(`1.0.0-alpha.195`); nur `CFBundleShortVersionString` ist ohne Suffix, weil Apple keins zulässt.
*(Entscheidung des Entwurfs.)*

### D5 Offline-Start **(R: Ziel; Mechanismus: Spike zuerst)**

Ein WKWebView in einer App bekommt Service Worker nur für höchstens 10 App-Bound Domains, die
beim Bau feststehen. Für frei eingetragene Server fällt der Precache des PWA-Service-Workers
also aus, und die Oberfläche startet ohne Netz nicht von selbst. Die Hülle muss das übernehmen.

Anforderung: Ist der Server nicht erreichbar, lädt die App die zuletzt erfolgreich geladene
Oberfläche **desselben** Servers, unter dessen Origin, sodass Cookies, IndexedDB und die
Offline-Logik des Frontends greifen. Kommt der Server wieder, lädt sie neu (Muster
`src-tauri/src/erreichbar.rs`: neu laden erst, wenn der Server antwortet).

Kandidaten, im Spike zu messen (Reihenfolge = Vorzug):

1. `loadSimulatedRequest(_:response:responseHTML:)` (iOS 15+) mit gespeicherter `index.html`
   unter der Server-URL; die gehashten Vite-Assets kommen aus dem HTTP-Cache des Datenspeichers
   (sie sind unveränderlich gecacht). Offen: ob WebKit sie ohne Netz wirklich aus dem Cache
   liefert, auch nach einem Neustart der App.
2. Wie 1, aber die Hülle hält die Assets selbst vor (Liste aus dem Vite-Manifest) und füllt
   Lücken über einen eigenen Weg. Nur, wenn 1 nicht trägt.
3. Eigenes URL-Schema mit `WKURLSchemeHandler`, der Oberfläche und `/api` vermittelt. Ändert die
   Origin und braucht einen Cookie- und SSE-Weg in Swift — nur als letzter Ausweg.

Ergebnis des Spikes: Entscheidungsprotokoll mit Belegen auf echtem Gerät (Flugmodus, Kaltstart,
Server weg, Server wieder da), bevor der Mechanismus gebaut wird.

Der Spike hält den Rest nicht auf: Der erste TestFlight-Build darf nur online laufen und zeigt
ohne Server die native Seite „nicht erreichbar“; der Offline-Start folgt als eigener Schritt.
Tragen weder 1 noch 2, entscheidet Ruben neu, bevor Kandidat 3 gebaut wird (Mehraufwand und eigene
Sicherheitsprüfung). *(Entscheidung des Entwurfs nach der Prüfung.)*

### D6 Natives Gefühl und Haptik **(R: Ziel; V: Form)**

- Kein Nachfedern am Seitenrand, keine Lupe und kein Textmenü außerhalb von Eingaben, sichere
  Ränder (`viewport-fit=cover` liefert der Server schon oder bekommt es), Pull-to-Refresh nur,
  wenn das Frontend es will (V: anfangs aus).
- Status- und Fehlerseiten der Hülle (nicht erreichbar, nicht verträglich, kein Server) sind
  SwiftUI, nicht HTML.
- **Haptik:** `window.__LIFELINE_HUELLE__.haptik(art)` mit einem kleinen festen Vokabular
  `'erfolg' | 'warnung' | 'fehler' | 'auswahl' | 'tippen'`, abgebildet auf
  `UINotificationFeedbackGenerator` bzw. `UISelectionFeedbackGenerator` und
  `UIImpactFeedbackGenerator`. Wann, entscheidet allein das Frontend über einen Helfer in
  `frontend/src/huelle/faehigkeiten.ts` (ohne Hülle: nichts). Erste Stellen **(V)**: Quittung
  eines gespeicherten Eintrags (`erfolg`), abgelehnte Speicherung (`fehler`), eingehender Alarm
  (`warnung`), Umschalter und Auswahl in Segmenten (`auswahl`).
- Native Meldung und App-Badge über dieselben Kennungsfelder wie die Desktop-Hülle
  (`benachrichtigungZeigen`, `setAppBadge`), solange die App läuft.
- Die Brücke (`WKScriptMessageHandler`) nimmt Aufrufe nur aus dem Hauptframe und nur von der
  Origin des aktiven Servers an (wie `desktop-huelle`: „Die native Brücke gilt genau für die
  konfigurierte Origin“).

### D7 Anmeldung **(V)**

Wie in der macOS-Hülle über `ASWebAuthenticationSession` und den bestehenden Server-Weg
`POST /api/auth/app-code[/einloesen]` (PKCE, `verifier` bleibt in der App, Rücksprung
`lifeline://anmeldung` nur aus der Sitzung). Damit gehen Passkeys für Lifeline und beim IdP;
`passkey: false` gilt wie auf dem Mac. Serverseitig ändert sich nichts, wenn der Weg
plattformneutral ist (zu prüfen: Audit-Kennung `systembrowser` reicht).

### D8 Links, Downloads, Drucken **(V)**

Regeln aus `src-tauri/src/links.rs` übernommen: eigene Origin bleibt in der App (kein zweites
Fenster auf dem iPhone; auf dem iPad optional später), `/api/` außer `/api/auth/` → Download
über das Teilen-Blatt, fremde `http(s)`/`mailto`/`tel` → System. `blob:`-Downloads (CSV) gehen
ebenfalls ans Teilen-Blatt. Drucken über `UIPrintInteractionController` mit dem Webview-Inhalt.

### D9 Bauen und Verteilen **(R: TestFlight; V: Form)**

- Eigener Workflow `ios.yml` auf einem macOS-Runner: bauen, Swift-Tests, bei Tag Upload zu
  TestFlight (App-Store-Connect-API-Schlüssel als Secret, wie bei der Notarisierung). Die
  Linux-Gates von `check-all.sh` bleiben unberührt; die Swift-Prüfung ist ein eigener Schritt,
  der auf Linux sauber übersprungen wird (Mechanik nach `scripts/AGENTS.md`).
- TestFlight zuerst intern, externe Gruppe nach Bedarf.
- Hochgeladen wird per Handstart (`workflow_dispatch`) und an Tags der Kanäle `beta` und `main`,
  nicht an jedem Alpha-Tag: Alphas kommen fast täglich, und der Rahmen der App ändert sich selten.
  *(Entscheidung des Entwurfs.)*
- **Übergaben an Ruben** (geht nicht im Linux-Container): Bundle-ID registrieren und App in App
  Store Connect anlegen, Verteilungszertifikat und API-Schlüssel als Secrets, Spike und Abnahme
  auf echtem iPhone/iPad. Swift-Code wird im Container geschrieben, gebaut und getestet aber nur
  auf dem macOS-Runner oder Rubens Mac; ein „fertig“ ohne grünen macOS-Lauf gibt es nicht.

## Was dem Bauenden überlassen bleibt

- Aufbau des Xcode-Projekts und der Module, Namen der Swift-Typen (Regel „Bezeichner-Sprache“
  gilt auch dort).
- Gestaltung von Onboarding und Serverliste im Rahmen der Gestaltungssprache
  (`frontend/AGENTS.md`).
- Mechanismus des Offline-Starts nach dem Spike-Ergebnis (D5).
- Genaue Felder von `GET /api/huelle` über die genannten hinaus.

## Reihenfolge **(V)**

1. Spike Offline-Start (D5) auf Gerät, Wegwerf-Code.
2. Serverseite: `GET /api/huelle`, Frontend-Helfer `haptik`, Kennungsfelder.
3. App-Gerüst, Onboarding, Serverliste, Datenspeicher je Server, Versionsprüfung.
4. Brücke (Haptik, Meldung, Badge), Anmeldung, Links und Downloads.
5. Offline-Start nach Spike.
6. CI und TestFlight, Doku (`docs/betrieb/`, Anwenderkapitel).
