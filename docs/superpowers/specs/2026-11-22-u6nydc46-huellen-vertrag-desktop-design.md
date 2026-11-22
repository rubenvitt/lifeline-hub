# Desktop-Hülle prüft den Hüllen-Vertrag und meldet Plattform und Version (LLH-1982)

Zunder: https://zunder.rubeen.dev/#/aufgabe/u6nydc46jdtcuwuiwutktpu8

Abgestimmt mit Ruben am 22.11.2026 (Fragen im Gespräch, Antworten unter „Entscheidungen“).

## Absicht

LLH-1978 hat den Hüllen-Vertrag eingeführt: `GET /api/shell` nennt `version` und
`shell_contract` (Spec `huellen-vertrag`, `src/routes/shell.rs`). Bisher nutzt ihn nur die
iOS-Hülle. Sie lädt einen Server nur, wenn sie seinen Vertrag kennt. Die Desktop-Hülle lädt
dagegen jeden Server ungeprüft. Steigt der Vertrag einmal, liefe eine alte Desktop-App still
gegen einen Server, mit dem sie nicht mehr richtig arbeitet. Die Desktop-Hülle soll deshalb
genauso prüfen und der Seite wie iOS sagen, auf welcher Plattform und in welcher Version sie
läuft. Die Rückmeldung (Hilfe → „Rückmeldung geben“) nennt dann „Desktop-App (macOS)“ oder
„Desktop-App (Windows)“ statt nur „Desktop-App“.

## Ziele

- Vor jedem Laden des Servers, das die Hülle selbst anstößt, fragt sie `GET /api/shell` ab:
  beim Start, beim Verbinden in der Maske, bei „Abbrechen“ in der Maske, beim Wechsel per
  Deeplink und bei „Erneut versuchen“ auf den lokalen Anzeigen.
- Kennt sie den `shell_contract` nicht, lädt sie die Oberfläche nicht. Stattdessen zeigt sie die
  lokale Seite „nicht verträglich“ mit Server-Version, App-Version und Richtung: „App
  aktualisieren“ bei größerem Vertrag, „Server ist zu alt für diese App“ bei kleinerem oder
  fehlendem.
- Ein Server, der auf `/api/shell` mit 404 antwortet, gilt als zu alt. Seine Version kommt aus
  `GET /api/health`.
- Ohne Verbindung lädt die Hülle wie heute (Wache, Offline-Start über den Service Worker). Dabei
  gilt der zuletzt bestätigte Vertrag dieses Servers: Ist er der App unbekannt, kommt „nicht
  verträglich“ ohne Server-Version.
- Die Kennung `window.__LIFELINE_HUELLE__` trägt in jeder Desktop-Hülle `platform` (`'macos'`,
  `'windows'`) und `version` (die volle Version der Hülle, etwa `1.0.0-alpha.195`).
- `frontend/src/rueckmeldung/adresse.ts` setzt die Oberfläche nach `platform`.

## Nicht-Ziele

- Kein eigener Abruf beim Öffnen eines Nebenfensters oder „Neues Fenster“. Sie folgen dem Urteil,
  das die Hülle für den verbundenen Server schon hat (s. „Urteil je Server“).
- Kein erneutes Prüfen im laufenden Betrieb, etwa beim Fokuswechsel. Die Desktop-App kennt keine
  Rückkehr in den Vordergrund wie iOS.
- Keine gemeinsamen Vertragsfälle mit der iOS-Hülle unter `src-tauri/faelle/` in diesem Task.
  Die iOS-Hülle lässt sich hier nicht bauen (`ios/AGENTS.md`: nur auf macOS). Das wird eine
  Folgeaufgabe.
- Keine eigene Seite für Zertifikatsfehler. Die Desktop-Hülle behandelt sie wie heute als „nicht
  erreichbar“ bzw. über die Wache.
- Keine Änderung am Server und am Endpunkt.

## Anti-Ziele

- Die Oberfläche eines unverträglichen Servers läuft an, auch nur kurz.
- Der Start im Einsatz-LAN ohne Internet oder ohne Server wird spürbar langsamer oder bleibt
  hängen.
- Die Hülle wird zum Client der Anwendung: Sie holt Daten, schickt Cookies oder trägt eine
  Sitzung.
- Die Prüfung vertraut anderen Zertifikaten als der Webview. Dann würde ein Server geprüft, den
  der Webview gar nicht lädt, oder umgekehrt.

## Ansätze

- **A: Abruf in Rust vor dem Laden (gewählt).** Die Hülle fragt mit `reqwest` ab, bevor sie
  navigiert. `reqwest` 0.13 mit `rustls-platform-verifier` steckt schon über
  `tauri-plugin-updater` im Baum. Es prüft Zertifikate über den Vertrauensspeicher des Systems wie
  der Webview, also auch eine eigene CA im Einsatz-LAN. Eine unverträgliche Oberfläche startet
  nie. Preis: ADR-0009 verbietet `reqwest` in der Hülle und muss ersetzt werden.
- **B: Init-Skript in der Serverseite.** Die Seite lädt, ein Skript fragt `/api/shell` ab und
  meldet das Ergebnis an die Hülle, die dann wegnavigiert. Das braucht kein HTTP in Rust, aber die
  unverträgliche Oberfläche läuft schon an (Anti-Ziel), und ihr Service Worker wird registriert.
- Verworfen: `fetch` aus einer lokalen Hüllenseite. Der Server sendet keine CORS-Köpfe. Ein
  selbstgebauter TLS-Abruf ohne `reqwest` wäre mehr eigener Code für dasselbe Ergebnis.

## Entscheidungen (Ruben, 22.11.2026)

1. Ansatz A, Abruf in Rust mit `reqwest`.
2. Ein unverträglicher Server in der **Maske**: Die Maske bleibt stehen und zeigt eine Meldung mit
   beiden Versionen und der Richtung. Der Server wird nicht gespeichert, wie in der iOS-Hülle.
3. Die Seite „App aktualisieren“ bekommt einen Knopf **„Nach Update suchen“**. Er nutzt den
   vorhandenen Updater (`update::auf_wunsch_pruefen`). Dazu kommen „Erneut prüfen“ und „Server
   wechseln“.
4. **Eine neue ADR ersetzt ADR-0009.** Sie übernimmt deren Regeln und lockert nur zwei Stellen:
   - Als einziger eigener Abruf ist der anonyme Vertragsabruf erlaubt (`GET /api/shell`, bei 404
     `GET /api/health`), ohne Cookies und ohne Anwendungsdaten. `reqwest` steht nur in
     `src-tauri/src/vertrag.rs`, und die Prüfung der ADR sichert das ab.
   - `src-tauri/ui/` enthält dazu die Seite „nicht verträglich“ und die Startseite „Verbinde…“.

   ADR-0009 bekommt `status: ersetzt`. Vorbild ist die iOS-Hülle (ADR-0068).

## Entwurf

### Vertragsprüfung (`src-tauri/src/vertrag.rs`, neu)

Eine reine, getestete Funktion nach dem Vorbild von `ios/LifelineKern/.../Vertrag.swift`:

- `BEKANNTE_VERTRAEGE: [u32] = [1]`: die Verträge, die diese Hülle spricht.
- `ShellAbruf`: entweder `Antwort { status, body, content_type }` oder `Fehler`.
- `Vertragsergebnis`: `Vertraeglich(ShellInfo)`, `NichtVertraeglich { richtung, server:
  Option<ShellInfo> }` (`richtung`: `ZuAlt` | `ZuNeu`) oder `NichtErreichbar`.
- `evaluate(abruf, letzter_vertrag) -> Vertragsergebnis`, dieselbe Tabelle wie in Swift:
  - 200 mit Medientyp `application/json`: JSON lesen. Fehlt ein lesbarer Vertrag, gilt der
    Server als zu alt ohne Version. Ein unbekannter Vertrag ergibt die Richtung (größer als der
    größte bekannte heißt zu neu, sonst zu alt). Ein bekannter ergibt `Vertraeglich`.
  - 404: zu alt, ohne Server-Version (die Version holt der Abruf aus `/api/health`).
  - Jeder andere Status (auch 3xx einer fremden Weiterleitung, 200 ohne JSON, 5xx) und jeder
    Fehler: wie ohne Verbindung.
  - Ohne Verbindung: Ist `letzter_vertrag` gesetzt und unbekannt, folgt `NichtVertraeglich` ohne
    Server-Version, sonst `NichtErreichbar`.
- Der Abruf selbst (`check(server)`, async):
  - ein `reqwest::Client` ohne Cookie-Speicher, Verbindungsaufbau (samt Namensauflösung)
    höchstens 1,5 s, ganzer Abruf höchstens 5 s. Ein Server, der gar nicht antwortet, verzögert
    den Offline-Start damit um höchstens 1,5 s; ein Server, der antwortet, aber hängt, fällt
    nach 5 s auf „ohne Verbindung“ (Wache wie heute). *Eigene Wahl, gegen das Anti-Ziel
    „Start ohne Server wird spürbar langsamer“.*
  - Weiterleitungen nur auf derselben Origin (`redirect::Policy::custom`, Vergleich über
    `links::gehoert_zum_server` bzw. die Origin);
  - die URL ist die Wurzel des Servers + `/api/shell`, wie in `Vertragsabruf.endpoint`;
  - bei 404 ein zweiter Abruf `/api/health`, dessen `version` ins Ergebnis kommt.
- TLS: dieselben `reqwest`-Features wie beim Updater (`rustls-no-provider`, Plattform-Verifier).
  Fehlt ein Standard-Provider, wird `ring` installiert, so wie es der Updater tut
  (`updater.rs`). Es kommt kein zweiter Provider dazu (`src-tauri/AGENTS.md`, Schritt 4).

### Ablauf in `main.rs`

- Ein gemeinsamer Weg `pruefe_und_lade(app, label, ziel)` ersetzt das direkte Navigieren in
  `lade_server` und `erneut_versuchen`:
  1. Prüfen (async, im Tauri-Runtime).
  2. `Vertraeglich`: den Vertrag als zuletzt bestätigt merken, dann wie bisher
     `server_freigeben` + `load_in_fenster` (mit Wache). Bei geschlossenem Hauptfenster wird es
     neu gebaut, wie heute.
  3. `NichtErreichbar`: wie bisher laden. Die Wache und der Service Worker übernehmen.
  4. `NichtVertraeglich`: nicht laden. Das Fenster zeigt die lokale Seite „nicht verträglich“,
     und der Zustand je Fenster liegt neben `ausfaelle`.
- **Start:** Mit gespeichertem Server baut die Hülle das Hauptfenster mit einer lokalen
  Startseite `verbinde.html?server=<origin>` („Verbinde mit …“, ohne IPC), dann folgt
  `pruefe_und_lade`. Ohne Server bleibt es wie heute bei der Maske. Das Fenster erscheint sofort,
  auch wenn der Abruf bis zum Zeitlimit hängt.
- **Maske:** `verbinden` wird async:
  - prüfen, bevor gespeichert wird;
  - `NichtVertraeglich` gibt eine Fehlermeldung an die Maske zurück und speichert nicht, zum
    Beispiel: „Der Server (Version 1.0.0-alpha.120) ist zu alt für diese App (Version
    1.0.0-alpha.195).“ bzw. „Der Server (Version …) ist neuer als diese App (Version …).
    Aktualisieren Sie die App.“;
  - `Vertraeglich` und `NichtErreichbar` speichern und laden wie heute. Ein heute
    unerreichbarer Server lässt sich also weiter eintragen.
  - `abbrechen` geht über `pruefe_und_lade`.
- **Deeplink:** Nach der Bestätigung prüft `bestaetige_wechsel` vor dem Speichern, wie die Maske.
  Ist der Server unverträglich, wird nicht gespeichert, und ein nativer Dialog nennt den Grund.
- **„Erneut versuchen“** (Anzeige „nicht erreichbar“) geht ebenfalls über `pruefe_und_lade`.

### Urteil je Server (Nebenfenster)

*Eigene Wahl, aus dem Anti-Ziel „unverträgliche Oberfläche läuft an“:* Beim Start bleibt ein
gespeicherter, unverträglicher Server in `verbindung.json` stehen (der Mensch soll ihn nach einem
App-Update wieder nutzen können). „Neues Fenster“ und Links in ein Nebenfenster dürfen ihn dann
nicht ungeprüft öffnen. Deshalb merkt sich `Zustand` das letzte Urteil je Server-Origin
(`NichtVertraeglich` samt Anzeige-Daten; `Vertraeglich` löscht es). `open_nebenfenster` und
`neues_fenster_aus_menue` zeigen für einen so markierten Server im neuen Fenster sofort die Seite
„nicht verträglich“ statt der Oberfläche; sonst bleibt es wie heute, ohne eigenen Abruf.
„Erneut prüfen“ in irgendeinem Fenster aktualisiert das Urteil.

### Gemerkter Vertrag (`verbindung.rs`)

`verbindung.json` bekommt `vertraege: { "<origin>": <n> }` (`#[serde(default)]`; ältere Dateien
bleiben lesbar). Es gibt zwei getestete Funktionen:

- `letzter_vertrag(dir, server)`;
- `merke_vertrag(dir, server, n)`, das nur Server aus der Liste der bekannten aufnimmt.

`vergessen` nimmt den Eintrag mit.

### Seite „nicht verträglich“ (`src-tauri/ui/nicht-vertraeglich.html` + `.js`)

Sie ist gebaut wie `nicht-erreichbar.html`, mit gleichem Stil und gleichen Knöpfen:

- Überschrift je nach Richtung „App aktualisieren“ bzw. „Server ist zu alt für diese App“, dazu
  die Adresse, „Server-Version: …“ (falls bekannt) und „App-Version: …“.
- Knöpfe:
  - „Nach Update suchen“, nur bei zu neu: ruft den Updater, der wie im Menü seine Dialoge zeigt;
  - „Erneut prüfen“: `pruefe_und_lade` für das Ziel;
  - „Server wechseln“: zur Maske.
- Commands: `nicht_vertraeglich` (was die Seite zeigt), `update_suchen`, dazu die vorhandenen
  `erneut_versuchen` und `server_wechseln`.
  - Alle stehen im `AppManifest` von `build.rs`.
  - Eine eigene Capability `capabilities/nicht-vertraeglich.json` gibt sie frei, für die Fenster
    `main` und `neben-*`.
  - Die Serverseite bekommt keinen davon.

Seitentexte nach `docs/betrieb/ios-app.md`, „Status-Seiten“.

### Kennung (`src-tauri/src/kennung.js`, neu)

Ein Init-Skript in **jeder** Hülle, vor `benachrichtigung.js`. Es setzt `platform` und `version`
und ergänzt die Kennung wie die anderen Skripte (`Object.freeze({...vorher, …})`).

- Die Werte setzt Rust beim Bau des Fensters ein, als JSON-kodierte Zeichenketten.
- `platform` kommt aus `std::env::consts::OS` (`macos`, `windows`; unter Linux, nur Entwicklung,
  `linux`).
- `version` ist `env!("CARGO_PKG_VERSION")` und stammt damit aus dem Workspace.

Der Test `init_skripte_ergaenzen_dieselbe_kennung` nimmt das Skript mit auf.

### Frontend

- `frontend/src/huelle/faehigkeiten.ts`: Doku-Kommentare nachziehen. Die Desktop-Hüllen setzen
  jetzt `platform` und `version`. `huellePlatform`/`huelleVersion` bleiben unverändert.
- `frontend/src/rueckmeldung/adresse.ts`, `oberflaecheText`:
  - `ios` → „iOS-App“;
  - `macos` → „Desktop-App (macOS)“;
  - `windows` → „Desktop-App (Windows)“;
  - eine andere Plattform oder keine, aber in einer Hülle → „Desktop-App“ (ältere Desktop-Hülle);
  - sonst „Browser“.
- Tests in `adresse.test.ts` und `faehigkeiten.test.ts`.

### Regeln und Doku

- Neue ADR (nächste freie Nummer laut `scripts/adr-fuer.sh --alle`), `ersetzt: ADR-0009`:
  - Regeln wie 0009, mit den zwei Lockerungen aus Entscheidung 4;
  - Prüfung: `reqwest` in `src-tauri/Cargo.toml` erlaubt, aber `verbiete 'reqwest'` in
    `src-tauri/src/` außer `vertrag.rs`; weiter `verbiete` für `lifeline-hub`, `sqlx`, `axum`
    usw.
- ADR-0009 bekommt `status: ersetzt`.
- `src-tauri/AGENTS.md`: ein Abschnitt „Hüllen-Vertrag“ mit diesen Punkten:
  - wo geprüft wird;
  - dass jedes Laden des Servers durch eine Hülle über `pruefe_und_lade` geht;
  - wo der Vertrag gemerkt wird;
  - die Kennung mit `platform`/`version`;
  - die neuen Rechte (Capability `nicht-vertraeglich`).
- `docs/betrieb/desktop-app.md`: Status-Seiten und Prüfung, wie in `ios-app.md`.
- Architektur: `docs/architektur/08-querschnittliche-konzepte.md` (Abschnitt zum Hüllen-Vertrag)
  und `05-bausteinsicht.md` (Desktop-Hülle nutzt `GET /api/shell`), nach der Mitänderungsregel
  in `docs/architektur/AGENTS.md`.
- Anwenderdoku: `docs/anwender/kapitel/rueckmeldung.md`, falls es die Oberfläche nennt.

## Was der Umsetzung überlassen bleibt

- Genaue Namen und Schnitt der Rust-Typen, sofern sie der Bezeichnerregel folgen (Fachbegriffe
  deutsch, Technik englisch).
- Ob `pruefe_und_lade` bei schon laufender Prüfung desselben Fensters die ältere verwirft
  (Nummer wie bei `start_watch`).
- Das Layout der beiden neuen lokalen Seiten im Rahmen von `stil.css`.
- Die Folgeaufgabe für gemeinsame Vertragsfälle (`src-tauri/faelle/vertrag.json`, von Swift und
  Rust gelesen) legt der Main-Loop mit `zunder-task-anlegen` an.
