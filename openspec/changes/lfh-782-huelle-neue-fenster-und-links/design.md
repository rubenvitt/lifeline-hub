# Design

## Context

Die Hülle (`src-tauri/src/main.rs`, LFH-721) baut genau ein Fenster `main` mit
`on_page_load`, `on_download` (Vorgabeverhalten, nur Protokoll), auf macOS
`background_throttling` aus und dem Druck-Init-Skript. Sie setzt weder `on_new_window` noch
`on_navigation`. Der verbundene Server wechselt zur Laufzeit (`verbinden`, `abbrechen`,
Deeplink-Bestätigung), die Adresse steht in `verbindung.rs`.

Gemessen in LFH-720 und in den Quellen von Tauri 2.12 / wry 0.57:

- `on_new_window(url, features) -> NewWindowResponse` erreicht `window.open` und
  `target="_blank"` auf beiden Plattformen. `Deny` unterdrückt das Fenster.
- `on_navigation(&Url) -> bool` läuft für Navigationen im Webview. In WKWebView prüft wry
  **vorher** `shouldPerformDownload`. Eine Navigation, die ein `<a download>` auslöst, geht
  direkt an den Download und am Handler vorbei (`wkwebview/navigation.rs`).
- WKWebView zeigt alles an, was es darstellen kann (`canShowMIMEType`), also auch PDF und
  Bilder mit `Content-Disposition: attachment`. Deshalb ersetzt ein Datei-Link ohne
  `download` die Anwendung (`belege/macos/anhang-ohne-download-attribut.json`).
- Die OIDC-Anmeldung läuft im Fenster: `LoginPage` navigiert per `location.assign` auf
  `/api/auth/oidc/start`, weiter zum Anbieter (fremde Origin), zurück über
  `/api/auth/oidc/callback` (`oidc-angemeldet.json`).
- Laufzeit-Capabilities nehmen Glob-Muster als Fensterkennung (`glob::Pattern` in
  `ipc/authority.rs`).

## Goals / Non-Goals

**Goals:**

- Eine reine, getestete Entscheidung „was passiert mit dieser URL“, dazu dünner Leim in
  `main.rs`. Das folgt dem Muster von `adresse.rs`/`deeplink.rs`.
- Nebenfenster verhalten sich wie das Hauptfenster (Handler, Drosselung, Druck).

**Non-Goals:**

- Keine Anwendungslogik in der Hülle. Palette und Inspector bleiben im Frontend unverändert.
- Keine Navigation zurück aus einer fremden Seite im Hauptfenster (Zurück-Knopf,
  Menüeintrag). „Ansicht → Neu laden“ bzw. „Server wechseln“ bleiben der Ausweg.
- Keine Erkennung von Dateiantworten am Inhaltstyp: `on_navigation` sieht nur die URL.
- Nebenfenster merken sich weder Position noch Größe.

## Decisions

### D1 Reine Entscheidung in `src-tauri/src/links.rs`

`entscheide_neues_fenster(server: Option<&Url>, ziel: &Url) -> Ziel` und
`entscheide_navigation(server: Option<&Url>, ziel: &Url) -> Ziel` mit
`Ziel = Huelle | Nebenfenster | Download | System | Verwerfen`. Der Server wird bei jedem
Aufruf aus `verbindung::lesen` bzw. geteiltem Zustand gelesen, nie beim Bauen des Fensters
eingefangen. Sonst stimmt er nach dem ersten Wechsel nicht mehr.

| Anlass | Ziel | Ergebnis |
|---|---|---|
| neues Fenster | eigene Origin, Pfad `/api/…` außer `/api/auth/…` | `Download` |
| neues Fenster | eigene Origin, sonst | `Nebenfenster` |
| neues Fenster | `http`/`https`/`mailto`/`tel`, fremd | `System` |
| neues Fenster | alles andere (`file:`, `javascript:`, `data:`, `blob:`, `tauri:` …) | `Verwerfen` |
| Navigation | eigene Origin, Pfad `/api/…` außer `/api/auth/…` | `Download` |
| Navigation | `mailto`/`tel` | `System` |
| Navigation | alles andere (eigene Origin, Maske, `about:blank`, fremde `http(s)`) | `Huelle` |

„Eigene Origin“ heißt dieselbe Origin wie der verbundene Server (Schema, Host, Port). Ohne
verbundenen Server gibt es keine eigene Origin: Die Maske navigiert nur auf sich selbst und
auf den Server beim Verbinden.

**Alternative verworfen:** eine Positivliste der Dateirouten (`…/anhaenge/…`, `…/datei`,
Backup, Support). Sie wäre lang, und jede neue Route bräche still. `/api/` ist nie eine
Anwendungsseite, der Router kennt keine. Die Anmelderouten sind die einzigen `/api/`-Ziele,
die als Seite im Hauptfenster laufen. Ein Test pinnt `/api/auth/oidc/start` und
`/api/auth/oidc/callback` ausdrücklich.

**Alternative verworfen:** fremde `http(s)`-Navigationen im Hauptfenster an den Systembrowser.
Damit bräche die OIDC-Anmeldung, denn die Hülle kennt den Anbieter nicht.

### D2 Download über ein Skript im auslösenden Webview

Für `Download` gibt der Handler `Deny` bzw. `false` zurück. Danach führt er im auslösenden
Webview `eval` eines Ankers mit `download` aus. Die URL geht über `serde_json::to_string`
ins Skript, nie per `format!`. Der Klick löst eine Download-Aktion aus. wry leitet sie am
Navigations-Handler vorbei an den Download, es entsteht keine Schleife. Das Protokoll läuft
über das bestehende `on_download`.

**Alternative verworfen:** den Download in Rust selbst holen (HTTP-Client). Das Cookie der
Sitzung liegt im Webview. Die Hülle müsste es auslesen und weiterreichen, und damit trüge sie
Sitzungslogik.

### D3 Nebenfenster über denselben Fensterbau

Eine Funktion `baue_fenster(app, label, url)` setzt Titel, Größen, `on_page_load`,
`on_download`, `on_new_window`, `on_navigation`, auf macOS Drosselung und Druckskript. Das
Hauptfenster (`main`) und die Nebenfenster (`neben-<n>`, Zähler im `Zustand`) entstehen daraus.
`NewWindowResponse::Create` wird **nicht** genutzt: Es verlangt auf macOS dieselbe
`WKWebViewConfiguration` wie der Aufrufer. Die Palette öffnet ohnehin mit `noopener`. Daher
`Deny` und ein eigenes Fenster, das die Hülle selbst baut. Die Sitzung teilen beide über den
gemeinsamen Datenspeicher des Webviews (Vorgabe beider Plattformen).

Die Laufzeit-Freigabe in `server_freigeben` gilt künftig für `main` **und** `neben-*`, damit
der Druck im Nebenfenster ankommt. `capabilities/lokal.json` bleibt bei `main`: Die Befehle
der Maske gehören nicht ins Nebenfenster. `lade_server` schließt vor dem Laden alle
`neben-*`-Fenster.

### D4 Systemprogramm über `tauri-plugin-opener`, nur Rust-seitig

`tauri_plugin_opener::open_url(url, None::<&str>)`. Das Plugin wird initialisiert, bekommt
aber keine Permission in einer Capability. Die Seite kann es also nicht selbst aufrufen.
Schlägt das Öffnen fehl, steht es im Protokoll (ohne Query). Die Seite bekommt kein Signal.

### D5 Chat-Anhänge auf `DownloadAnker`

`NachrichtenStrom` rendert je Anhang `DownloadAnker` mit `href`
`/api/einsaetze/{id}/anhaenge/{aid}`, `dateiname`, `groesse` und einem zugänglichen Namen mit
Nachrichtenbezug („<Datei>, <Größe>, Anhang der Nachricht von <Absender> um <Zeit>
herunterladen“). Der Dateikopf von `DownloadAnker` nennt den Chat als n:m-Ausnahme, die die
generische Route benutzen darf (`routes/anhang.rs`). Im Browser lädt der Anker damit auch
herunter, statt einen Tab zu öffnen. Das ist dieselbe Form wie ETB und Schaden.

## Risks / Trade-offs

- [Ein per Skript ausgelöstes `a.click()` ohne Nutzergeste lädt in WKWebView oder WebView2
  nicht herunter] → Handprobe auf macOS in Gruppe 4. Scheitert sie, schwenkt die Hülle auf
  `WebviewWindow::navigate` in ein verstecktes Hilfsfenster. Dessen Antwort fängt
  `on_download` ab. Der Schwenk bleibt in der Hülle, Spec und Frontend ändern sich nicht.
- [Eine künftige `/api/`-Route liefert eine Seite, die im Fenster laufen soll] → Sie
  bräuchte eine Ausnahme wie `/api/auth/`. Der Test der Entscheidung nennt diese Grenze.
- [Fremde Navigation im Hauptfenster ohne Rückweg] → Bewusst offen (Non-Goal).
  „Neu laden“ lädt die fremde Seite neu. Der Ausweg ist „Server wechseln“ → „Abbrechen“.
- [Nebenfenster ohne IPC für die Maske] → gewollt, siehe D3.
- [Stapel auf einem ungemergten Branch] → Der PR gegen `alpha` folgt erst, wenn LFH-721 dort
  liegt. Vorher wird nichts von LFH-721 gepusht.

## Migration Plan

Keine Daten, keine Migration. Die Hülle kommt mit dem nächsten stabilen Release (LFH-721).
Rücknahme heißt, die Handler zu entfernen.
