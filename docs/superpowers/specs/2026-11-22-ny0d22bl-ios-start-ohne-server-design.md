# iOS-App: Start ohne Server (LLH-1980)

Stand: 22.11.2026 · Route `entwurf` (E1 Mechanismus, E3 Backend + iOS-Hülle) ·
Zunder: https://zunder.rubeen.dev/#/aufgabe/ny0d22blsi0flu9qy4fp0aur

## Absicht

Ruben will die iOS-App ausdrücklich offline-fähig. Im Browser trägt das der Service Worker mit
seinem Precache. In der App-Hülle (WKWebView) läuft kein Service Worker, deshalb zeigt die App
seit LLH-1978 ohne Server nur die native Seite „nicht erreichbar“. Wer im Einsatz die App
kalt startet und keinen Server erreicht, kommt nicht an das Lagebild, das längst auf dem Gerät
liegt (IndexedDB `lifeline-lagebild`), und kann nichts in die Schreib-Queue erfassen.

Herkunft: `openspec/changes/archive/2026-11-19-t39ltxxi-ios-huelle/design.md`, D5.

## Ziele

- Startet die App, ist der aktive Server nicht erreichbar und liegt von **diesem** Server eine
  zuletzt erfolgreich geladene Oberfläche vor, zeigt die App diese Oberfläche unter der Origin
  des Servers. Cookies, IndexedDB, Offline-Identität (24 h), Lagebild aus der Platte und die
  Schreib-Queue des Frontends greifen dann wie im Browser ohne Netz.
- Die Offline-Kennzeichnung kommt vom Frontend selbst (`offline/useOnline.ts`,
  `offline/verbindung.ts`); die Hülle fügt keine eigene hinzu.
- Kommt der Server zurück, arbeitet die App ohne Zutun wieder mit ihm. Mit derselben Version
  läuft die Oberfläche einfach weiter (offene Eingaben bleiben), mit einer anderen lädt die App
  sie vom Server neu (Entscheidung Ruben, 22.11.2026).
- Auch Seiten, die nie geöffnet wurden (`lazy()`-Chunks), funktionieren ohne Server.
- Der Build ist zugleich der Spike: Ruben misst ihn auf dem Gerät (Flugmodus, Speicherdruck);
  das Ergebnis wird in der ADR festgehalten.

## Nicht-Ziele

- Keine Änderung am Frontend und an seiner Offline-Logik. Was ohne Netz lesbar ist, bleibt
  allein in `LAGEBILD_OFFLINE` (`frontend/src/offline/AGENTS.md`).
- Kein Start ohne Server für einen Server, der nie mit Netz geladen war.
- Keine Desktop-Hülle (`src-tauri/`), kein eigenes URL-Schema (Kandidat 3).
- Keine eigene Kopie der Assets in Application Support (Kandidat 2) in diesem Schritt; sie folgt
  nur, wenn die Messung auf dem Gerät zeigt, dass iOS den HTTP-Cache räumt.

## Anti-Ziele

- Eine Oberfläche, die halb lädt (fehlende Chunks) und dann leer oder kaputt dasteht, ist
  schlechter als die Seite „nicht erreichbar“. Die Hülle muss das erkennen und auf die
  Status-Seite zurückfallen.
- Die Oberfläche eines Servers darf nie unter einem anderen Server erscheinen.
- Ein Zertifikatsfehler darf nicht zum Start ohne Server führen: Der Server antwortet dann, nur
  mit einem Zertifikat, dem das Gerät nicht traut (auch ein Angreifer im Netz sieht so aus).

## Randbedingungen

- Nur https-Server (`ServerAdresse.parse`), je Server ein eigener persistenter
  `WKWebsiteDataStore(forIdentifier: eintrag.id)`.
- Hülle ohne Anwendungslogik; Entscheidungen im Kern `ios/LifelineKern` mit Tests unter Linux
  (`ios/AGENTS.md`, „Logik im Kern“, „Seite und Wirkung aus dem Kern“).
- `/api/shell` wächst nur additiv, `SHELL_CONTRACT` bleibt 1 (`src/routes/shell.rs`, Bruchregel).
  Nach der DTO-Änderung `scripts/check-typ-codegen.sh` (`src/AGENTS.md`).
- Vite-Assets unter `assets/` tragen Hashes und kommen mit
  `Cache-Control: public, max-age=31536000, immutable` (`src/static_files.rs`); `index.html` mit
  `no-cache`.
- Die Cloud-Sitzung hat kein Xcode. App-Code ist erst mit grünem `ios-pruefung.yml` fertig.

## Ansätze

1. **Gespeicherte `index.html` + HTTP-Cache des Datenspeichers (gewählt, Kandidat 1).** Die
   Hülle speichert nach jedem erfolgreichen Online-Laden die `index.html` des Servers und lässt
   den Webview alle Assets einmal holen, damit sie im HTTP-Cache des Datenspeichers liegen. Ohne
   Server lädt sie die Seite mit `loadSimulatedRequest(_:responseHTML:)` unter der Server-URL;
   die Assets kommen aus dem Cache (`immutable`, also ohne Nachfrage beim Server). Wenig Code,
   gleiche Origin, nichts im Frontend. Risiko: iOS darf den Cache unter Speicherdruck räumen;
   das misst der Spike.
2. **Wie 1, Assets in Application Support (Kandidat 2).** Robuster gegen das Räumen, aber ein
   Webview kann eine https-Anfrage nicht aus einer eigenen Ablage beantworten; das braucht
   Umwege (alles in eine HTML einbetten, was `lazy()` bricht). Erst nach einem Messergebnis.
3. **Eigenes URL-Schema (Kandidat 3).** Andere Origin, Cookies und SSE müssten durch Swift;
   eigene Sicherheitsprüfung. Nur nach neuer Entscheidung durch Ruben.

Verworfen außerdem: App-Bound Domains, unter denen WKWebView Service Worker erlaubt. Sie stehen
fest in der `Info.plist` (höchstens zehn), die Server trägt aber jeder Betreiber selbst ein.

Gewählt am Phase-1-Checkpoint (22.11.2026): Ansatz 1, als vollständiger Build, der zugleich der
Spike ist; Asset-Liste als neues Feld in `/api/shell`; automatischer Test im Simulator.

## Entwurf

### Backend: Asset-Liste in `/api/shell`

- Neues Feld `assets` in `ShellInfo`: Liste der Pfade relativ zur Wurzel (ohne führenden
  Schrägstrich), die die Oberfläche ohne Server braucht: alle Dateien unter `assets/` des
  eingebetteten Bundles (`static_files.rs`, `Asset::iter()`), sortiert, **ohne
  `assets/doku/`**. Die Liste folgt damit dem Precache des Service Workers
  (`globIgnores` in `frontend/vite.config.ts`; die Doku-Bilder, heute rund 28 MB, lüde sonst
  jedes Release vor, auch über Mobilfunk). `bibliotheken/libheif/` liegt nicht unter `assets/`
  und bleibt ebenfalls draußen. Ohne eingebettetes Frontend die leere Liste. (Wahl des
  Entwurfs.)
- Weiter anonym und ohne Datenbank. Ältere Hüllen ignorieren das Feld
  (`ShellInfo` in `Vertrag.swift` dekodiert nur bekannte Felder), `SHELL_CONTRACT` bleibt 1.
- Typ-Codegen und OpenAPI ziehen mit.

### Kern (`ios/LifelineKern`)

- **Gespeicherte Oberfläche**: ein Wert je Server mit `index.html` (Daten), Server-Version aus
  `/api/shell` und Zeitpunkt; Ablage in Application Support unter der UUID des Eintrags.
  Das Lesen und Schreiben der Dateien liegt im Kern (testbar unter Linux), über ein Verzeichnis,
  das die App hineinreicht.
- **`Ablauf`** bekommt eine Seite für die Oberfläche ohne Server (Name dem Bauenden
  überlassen, etwa `.ohneServer(ServerEintrag)`), dazu Wirkungen zum Laden der gespeicherten
  Oberfläche und zum Vorwärmen. Regeln:
  - Prüfung ergibt `nichtErreichbar` (nicht Zertifikat) **und** für diesen Server liegt eine
    Oberfläche vor → Seite „ohne Server“, gespeicherte Oberfläche laden, Wiederholung planen.
  - Ohne gespeicherte Oberfläche, bei Zertifikatsfehler und bei „nicht verträglich“: wie bisher
    die Status-Seite.
  - Auf „ohne Server“ prüft die App alle `wiederholIntervall` (5 s) und bei Rückkehr in den
    Vordergrund. Ist der Server verträglich → Seite `web` und `markVerbunden`. Neu geladen
    wird **nur**, wenn die Version aus `/api/shell` von der Version der gespeicherten
    Oberfläche abweicht; bei gleicher Version läuft die Oberfläche weiter, denn sie hat
    dieselbe Origin, `/api` antwortet wieder und die Queue gleicht das Frontend selbst ab
    (Entscheidung Ruben, 22.11.2026: offene Eingaben gehen nicht verloren). Nach einer
    abweichenden Version lädt sie vom Server, damit kein altes Frontend mit einem neuen Server
    spricht.
  - Ende des Web-Prozesses (Speicherdruck) und gescheiterte Navigation auf „ohne Server“ →
    gespeicherte Oberfläche erneut laden, nicht `reload()` (das ginge ans Netz).
  - Startet die gespeicherte Oberfläche nicht (siehe Hülle) → Status-Seite „nicht erreichbar“
    wie bisher; die Wiederholung läuft weiter, versucht die gespeicherte Oberfläche aber **in
    diesem App-Lauf nicht noch einmal** (Markierung im Speicher, nicht in der Ablage). Sonst
    wechselten alle 5 s Status-Seite und kaputte Oberfläche. Gelöscht wird nichts: ein
    langsames Gerät soll die Fähigkeit nicht dauerhaft verlieren. (Wahl des Entwurfs.)
  - Wechsel des Servers, Entfernen des Servers: wie bisher; das Entfernen löscht auch die
    gespeicherte Oberfläche (`Serverentfernung`).
- **Vorwärmen**: nach einem verträglichen Online-Laden, wenn sich die Server-Version gegenüber
  der gespeicherten Oberfläche geändert hat oder noch keine vorliegt. Reihenfolge: erst Assets
  vorwärmen, dann `index.html` speichern; so verweist eine gespeicherte Seite nie auf Assets,
  die nicht im Cache sind.
- **Andere Version online geladen → alte Oberfläche sofort ungültig**, noch vor dem
  Vorwärmen. Die neue Version kann beim Online-Laden die IndexedDB-Schemata heben
  (`lifeline-offline`, `lifeline-lagebild`); alter Code scheiterte daran beim nächsten Start
  ohne Server (`VersionError`), Queue oder Lagebild gingen kaputt, und die Startprüfung merkte
  es nicht. Scheitert das Vorwärmen danach, fehlt der Start ohne Server, bis es gelingt.
  Sicherheit geht vor Verfügbarkeit. (Wahl des Entwurfs.)

### Hülle (`ios/App`)

- `index.html` holt die Hülle per `URLSession` von der Startadresse (anonym, `no-cache`), nicht
  aus dem DOM (das Frontend verändert ihn).
- Vorwärmen im Webview selbst, damit die Antworten im HTTP-Cache **seines** Datenspeichers
  landen: per `evaluateJavaScript` ein `fetch(pfad, { cache: 'force-cache' })` je Asset, mit
  höchstens vier gleichzeitig, nach dem ersten Laden der Seite (nicht davor, damit der Start
  nicht wartet). Ergebnis (Anzahl ok/fehlgeschlagen) zurück an das Modell.
- Laden ohne Server: `loadSimulatedRequest(URLRequest(url: eintrag.adresse.url),
  responseHTML: …)` im Webview mit dem Datenspeicher des Eintrags. Die Brücke gilt unverändert
  (gleiche Origin).
- **Startprüfung**: einige Sekunden nach dem Laden ohne Server fragt die Hülle per Skript, ob
  die Oberfläche hochgefahren ist (Wurzelelement der App hat Inhalt). Wenn nicht → Ereignis an
  den Kern, der auf „nicht erreichbar“ fällt. Diese Zahl ist zugleich das Messsignal des Spikes
  (Protokoll per `os.Logger`, Kategorie `ohne-server`).

### Prüfung

- Backend: Test für `assets` (Liste aus dem eingebetteten Bundle, leer ohne Frontend), Typ-Codegen.
- Kern (`swift test`, Linux): `AblaufTests` für jede Regel oben, Tests der Ablage (schreiben,
  lesen, je Server getrennt, Löschen beim Entfernen, Vorwärmen vor Speichern).
- Simulator (`ios-pruefung.yml`): ein App-Test mit einem https-Testserver im Testprozess:
  Oberfläche mit einem Haupt- und einem nachgeladenen Chunk ausliefern, online laden und
  vorwärmen, Server anhalten, neuen Webview mit demselben Datenspeicher bauen und ohne Server
  laden → Oberfläche läuft, auch der nie geladene Chunk; Server mit derselben Version wieder
  starten → Seite `web` ohne Neuladen; mit anderer Version → Laden vom Server. Wie der Test dem selbst signierten Zertifikat traut, ohne dass die ausgelieferte
  App es tut, entscheidet der Bauende (nur im Test-Target oder hinter `#if DEBUG`).
- Gerät (Ruben, TestFlight): Messprotokoll im Plan: Flugmodus-Kaltstart, Server weg und wieder
  da, Speicherdruck (viele Apps öffnen, dann zurück), Gerät neu gestartet, lange nicht geöffnet,
  nie geöffnete Seiten ohne Netz. Ergebnis in die ADR.

### Doku und Regeln

- Neue ADR (E1): Mechanismus des Starts ohne Server in der iOS-Hülle, mit Regeln (nur derselbe
  Server, kein Start bei Zertifikatsfehler, Vorwärmen vor Speichern) und dem Messergebnis vom
  Gerät; `gilt_fuer` `ios/**` und `src/routes/shell.rs`.
- `ios/AGENTS.md`: Regel zum Start ohne Server mit Verweis auf die ADR.
- `frontend/src/offline/AGENTS.md`: ein Satz, dass die iOS-Hülle den Start ohne Netz trägt und
  das Frontend dafür nichts Eigenes hat.
- Architektur Kapitel 6 (Ablauf Offline) ergänzen.
- Anwenderdoku `docs/anwender/kapitel/ohne-netz.md`: Abschnitt zur iOS-App.

## Dem Bauenden überlassen

Namen der neuen Seite, Wirkungen und Typen; Ablage-Format der gespeicherten Oberfläche; die
genaue Wartezeit der Startprüfung; das Test-Vertrauen für das selbst signierte Zertifikat; wie
das Ergebnis des Vorwärmens in den Kern zurückkommt.
