# Design

## Context

- Die Anforderungen an die Hülle stehen in `openspec/specs/desktop-huelle/spec.md` (aus LFH-720)
  und in den Deltas dieses Changes. Herleitung und Belege der Webview-Grenzen:
  `openspec/changes/archive/2026-09-29-lfh-720-tauri-huelle-variante-a/design.md`. Der
  Wegwerf-Prototyp (`~/dev/personal/lfh-720-tauri-spike`, Stand `d9af36f`) ist die Vorlage für
  Laufzeit-Capability, Deeplink, Einzelinstanz und nativen Druck. Er wird **nicht** übernommen,
  weil er Messkanäle (Steuerverzeichnis, `probe.js`, `diag_melden`) trägt, die im Produkt nichts
  verloren haben.
- Release-Fluss (LFH-522):
  - `semantic-release` taggt auf `alpha` Vorabversionen (`vX.Y.Z-alpha.N`) und auf `main`
    stabile Versionen.
  - `artefakte.yml` hängt am Ereignis `release: published` und lässt sich per
    `workflow_dispatch` für einen Tag nachbauen.
  - Bisher gibt es **kein** stabiles Release.
  - Das Repo ist öffentlich. `…/releases/latest/download/<datei>` zeigt auf das neueste
    **stabile** Release, weil GitHub Vorabversionen dabei auslässt.
- Gates: `scripts/check-all.sh` ist die einzige Wahrheit. Die CI ruft es in Bündeln auf und
  richtet vorher nur die Umgebung ein (Toolchain, `nasm`). `cargo test --workspace` (Schritt 4)
  und `cargo llvm-cov --workspace` (`coverage.yml`) übersetzen jedes Workspace-Mitglied — und
  vereinigen dabei die Features aller Mitglieder (siehe D1, Nachtrag).
- `cargo audit` mit dem Tauri-Baum (Probe am 29.09.2026) bleibt grün: nur die Warnungen
  RUSTSEC-2024-0370 (`unmaintained`) und RUSTSEC-2024-0429 (`unsound`), beide ohne Abbruch.

## Goals / Non-Goals

**Goals:**
- Aus einem stabilen Release entstehen ohne Handgriff installierbare Pakete für macOS arm64 und
  Windows x64 sowie ein `latest.json`.
- Eine installierte Hülle aktualisiert sich nach Zustimmung auf das nächste stabile Release.
- Die Auflagen der Fähigkeit `desktop-huelle` sind erfüllt, außer neuen Fenstern und Links
  (LFH-782).

**Non-Goals:**
- Code-Signierung mit Developer ID, Notarisierung, Windows-Zertifikat (LFH-722). Hier nur ad-hoc
  auf macOS.
- Linux-Paket (AppImage/deb). Die Hülle **übersetzt** unter Linux, weil die Gates dort laufen,
  ausgeliefert wird sie dort nicht.
- Ein Vorab-Kanal für die Hülle (Entscheidung 25.09.2026).
- Sitzung über den Neustart (LFH-779/780), Passkey auf macOS (LFH-783), neue Fenster und Links
  (LFH-782).
- Serverseite von LFH-38 (QR/Link erzeugen). Hier wird nur das Schema festgelegt, das die Hülle
  annimmt.
- Autostart der Hülle beim Anmelden.

## Decisions

### D1 — `src-tauri` als Workspace-Mitglied, Linux-Pakete nur als Umgebung

`members = [".", "crates/karten-katalog", "karten-service", "src-tauri"]`, Crate
`lifeline-desktop`. `cargo build` im Root baut weiter nur das Root-Paket, der Server-Build bleibt
also unberührt. Schritt 4 übersetzt die Hülle mit. Deshalb bekommen der Rust-Job in `ci.yml` und
`coverage.yml` die Systempakete `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev
libjavascriptcoregtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev` in denselben
`apt-get`-Aufruf wie `nasm`. Das ist Umgebung wie `nasm`, kein Gate-Schritt neben
`check-all.sh`.

**Nachtrag (Gate-Lauf 29.09.2026):** In einem `cargo test --workspace` vereinigt Cargo die
Features von Server und Hülle. `tauri-plugin-updater` schaltet an rustls `ring` ein, der Server
nutzt `aws-lc-rs` — mit beiden kann rustls keinen Standard-Provider mehr wählen, und der
Stolperdraht `tls::tests::rcgen_pem_ist_per_rustls_ladbar` bricht (so gewollt). Das ausgelieferte
Server-Binary (`build-release.sh`, nur das Wurzelpaket) ist nicht betroffen. Deshalb testet
Schritt 4 getrennt: `cargo test --workspace --exclude lifeline-desktop`, dann
`cargo test -p lifeline-desktop`; `coverage.yml` misst ohne Hülle und braucht die GTK-Pakete
nicht. *Verworfen:* den Updater auf `native-tls` stellen (schaltete im Workspace-Lauf reqwest
des Servers auf NativeTls — Test und Produktion liefen auseinander) und den Provider im Server
fest installieren (ändert Server-Code für eine Test-Eigenheit und entschärft den Stolperdraht).

*Alternativen:*
- `exclude` mit eigenem Lockfile: widerspricht dem Ticket, und `cargo audit` sähe den Baum
  nicht.
- Tauri per `cfg` nur auf macOS/Windows: bricht `cargo test --workspace` auf Linux oder lässt
  die reinen Tests dort ungeprüft.

### D2 — Version: eine Quelle in `[workspace.package]`, `tauri.conf.json` ohne eigene

`tauri.conf.json` lässt `version` weg, Tauri nimmt dann die Crate-Version. Server und Hülle
tragen `version.workspace = true`; die Version steht einmal in `[workspace.package]` der Wurzel.
`prepareCmd` bleibt unverändert: `cargo set-version -p lifeline-hub` setzt die geerbte
Workspace-Version (geprüft mit cargo-edit 0.13.7), die Hülle zieht mit.

*Erster Stand (verworfen):* ein eigenes Versionsfeld in `src-tauri/Cargo.toml`, von `prepareCmd`
mitgesetzt. Beim Einmergen eines alpha-Releases driftete es zweimal (alpha.51 ↔ alpha.53 ↔ alpha.55),
und ein Merge dieses PRs kurz nach einem Release hätte `alpha` selbst rot gemacht — der
Release-Job wartet auf die Rust-Suite und wäre blockiert. Der Test
`version_kommt_aus_dem_workspace` pinnt jetzt die Struktur (beide erben).

### D3 — Build-Matrix: eigener Job `desktop`, nativ je Plattform

| Name | Runner | Ziel | Bundles |
|---|---|---|---|
| `desktop-macos-arm64` | `macos-latest` | `aarch64-apple-darwin` | `app`, `dmg` (plus Updater-Archiv `.app.tar.gz` und `.sig`) |
| `desktop-windows-x86_64` | `windows-latest` | `x86_64-pc-windows-msvc` | `nsis` (Installer ist zugleich Updater-Artefakt, plus `.sig`) |

- **Windows nativ, nicht als Cross-Build aus LFH-522:** Die NSIS-Bündelung und WebView2 sind auf
  dem Windows-Runner der erprobte Weg. Der Server-Cross-Build bleibt davon unberührt, und „auf
  Basis der LFH-522-Targets“ heißt dieselben Plattformen.
- **Kein MSI:** MSI lehnt Vorabversionen ab, und lokale sowie per Dispatch gebaute Prüfstände
  tragen Alpha-Versionen.
- **Tauri-CLI:** `cargo install tauri-cli --locked --version 2.12.0`, gepinnt wie `cargo-cyclonedx`
  und über `rust-cache` gecacht. Aufgerufen als `cargo tauri build --target … --bundles …`.
- **Freischaltung:**
  - `vorbereiten` bekommt die Ausgabe `desktop`. Sie ist `true`, wenn der geprüfte Tag keine
    Vorabkennung trägt oder `inputs.desktop` beim Dispatch gesetzt ist.
  - **Nicht** `github.event.release.prerelease`, das beim Dispatch leer ist.
  - Die Desktop-Jobs hängen nur an `vorbereiten` und nie an `bauen`: Ein roter Server-Build hält
    die Hülle nicht auf und umgekehrt.
- **macOS:** `bundle.macOS.signingIdentity = "-"` (ad-hoc). Apple Silicon verlangt mindestens
  das, echte Signierung bringt LFH-722.
- **Secrets:** `TAURI_SIGNING_PRIVATE_KEY` und `…_PASSWORD` gehen nur an den Bauschritt.
  `createUpdaterArtifacts: true` erzeugt die `.sig`-Dateien.

### D4 — `latest.json` aus einem Repo-Skript mit Selbsttest

`scripts/release/desktop-manifest.mjs`:
- Aufruf: `--dir versand --tag vX.Y.Z --repo owner/name`.
- Es paart je Plattform Archiv und `.sig`. Die Zuordnung steht im Skript als Tabelle
  `darwin-aarch64 → *.app.tar.gz` und `windows-x86_64 → *-setup.exe`.
- Es schreibt `latest.json` mit `version`, `pub_date` und `platforms.<p>.{signature, url}`. Die
  `url` zeigt auf `…/releases/download/<tag>/<datei>`.
- Plattformen ohne Paar lässt es weg. Ohne ein einziges Paar bricht es ab.

Der Selbsttest `desktop-manifest.test.mjs` (`node --test`) läuft in Schritt 8 neben
`ki-notizen.test.mjs`. Damit bleiben `SCHRITTE`, die Bündel und die Selbstprüfung unverändert.

Der Job `desktop-veroeffentlichen` wartet auf beide Desktop-Jobs, läuft aber mit `if: always()`
und dem Ausdruck `needs.vorbereiten.outputs.desktop == 'true'`. Er sammelt die hochgeladenen
Artefakte ein, ruft das Skript und lädt Pakete plus `latest.json` per `gh release upload
--clobber` hoch. So entsteht bei einer gescheiterten Plattform ein Manifest ohne diese Plattform.

*Alternative:* `tauri-apps/tauri-action` erzeugt das Manifest selbst. Die Logik läge dann in
einer CI-Aktion, die `check-all.sh` nicht prüfen kann, und sie brächte einen zweiten Bauweg
neben `cargo tauri build` mit.

### D5 — Update-Endpunkt und -Ablauf in der Hülle

- **Endpunkt:** `https://github.com/rubenvitt/lifeline-hub/releases/latest/download/latest.json`.
  Stabiler Kanal ohne eigenen Kanal-Mechanismus, siehe Context.
- **Ablauf:**
  - Nach dem Laden der Anwendung prüft ein Hintergrund-Task (`tauri-plugin-updater`, Timeout
    10 s). Fehler und Zeitüberschreitung werden nur geloggt.
  - Bei einem Treffer fragt ein nativer Dialog (`tauri-plugin-dialog`) mit Versionsnummer, ob
    geladen wird („Laden“/„Später“). `download` prüft dabei die Signatur.
  - Ist das Update geladen, fragt ein zweiter Dialog, ob **jetzt** neu gestartet wird („Jetzt neu
    starten“/„Später“); erst dann `install` und `app.restart()`. Grund (Review 29.09.2026): der
    Download dauert im ELW-Uplink Sekunden bis Minuten, ein unangekündigter Neustart verlöre, was
    in der Zwischenzeit getippt wurde. Auf Windows beendet der NSIS-Installer die Hülle selbst,
    deshalb gilt `installMode: "passive"`.
  - Eine Sperre (`AtomicBool`) hält Start- und Menüprüfung auseinander: nie zwei Dialoge oder
    Downloads gleichzeitig.
- **Keine wiederkehrende Prüfung** während der Laufzeit: Die Hülle soll mitten in der Lage nicht
  mit Dialogen stören. Der Menüeintrag „Nach Updates suchen…“ prüft auf Wunsch und meldet auch
  „Sie verwenden die aktuelle Version“.
- **Testbarkeit:** Endpunkt und Pubkey stehen in `tauri.conf.json`. Der lokale Nachweis
  überschreibt sie per `cargo tauri build --config <datei>` mit einem Testschlüssel und einem
  lokalen Endpunkt (`dangerousInsecureTransportProtocol` nur in dieser Prüfdatei, die nicht im
  Repo liegt).

### D6 — Das Signaturschlüsselpaar

- Das Paar entsteht in der Umsetzung einmalig mit `cargo tauri signer generate` und Passwort
  unter `~/.tauri/lifeline-desktop.key`, außerhalb des Repos.
- Der öffentliche Schlüssel kommt in `tauri.conf.json` (`plugins.updater.pubkey`).
- Den privaten Schlüssel und das Passwort setzt **der Mensch** als Secrets (`gh secret set`) und
  legt eine Sicherung im Passwortmanager ab.
- Weder Schlüssel noch Passwort erscheinen im Chat, im Repo oder im Log.
- **Verlust des privaten Schlüssels** heißt: Installierte Hüllen nehmen kein Update mehr an und
  müssen einmal von Hand neu installiert werden. Das steht in der Betriebsdoku.

### D7 — Aufbau der Hülle: reine Entscheidungen, dünner Tauri-Rand

Module in `src-tauri/src/`:

| Modul | Inhalt | Getestet |
|---|---|---|
| `adresse.rs` | `pruefe_adresse(&str) -> Result<Url, AdressFehler>`: trimmt, nur `https`, Host Pflicht. Die Fehler sind Varianten mit deutscher Meldung, `http` nennt ausdrücklich https. | rein, Unit-Tests |
| `deeplink.rs` | `deute(&Url) -> Option<Url>` für `lifeline://verbinden?server=`, sonst `None`. `entscheide(gespeichert: Option<&Url>, neu: &Url) -> Aktion { Vorbelegen, Bestaetigen, Nichts }`. | rein, Unit-Tests |
| `verbindung.rs` | Lesen und Schreiben von `<app_config_dir>/verbindung.json` `{ "server": "…" }`. Eine unlesbare Datei gilt als „keine Adresse“. | Unit-Tests mit `tempfile` |
| `main.rs`/`lib.rs` | Builder, Plugins, Fenster, Menü, Laufzeit-Capability, Download-, Druck- und Update-Verdrahtung | per lokalem Nachweis |

- **Commands der Maske** (`verbinden`, `abbrechen`, `vorbelegung`) sind nur in der **lokalen**
  Capability freigegeben.
- **Laufzeit-Capability der Server-Origin** gibt **nur** `drucken` frei, aufgebaut wie im Spike
  (`CapabilityBuilder::remote(origin/*)`), neu bei jedem Wechsel.
- Die Server-Seite kann die Adresse also nicht ändern. Das kann nur die lokale Maske.
- **Deeplink:**
  - `Vorbelegen` navigiert zur Maske mit Vorbelegung.
  - `Bestaetigen` fragt nativ („Mit Server https://… verbinden? Die bisherige Verbindung
    https://… wird ersetzt.“).
  - `Nichts` gilt bei gleicher Adresse und bei ungültigem Link.
- **Menü:** Das Anwendungsmenü trägt „Server wechseln…“ und „Nach Updates suchen…“ zusätzlich
  zu den Standardeinträgen (Bearbeiten und Kopieren, damit Strg/⌘+C im Webview geht).

### D8 — Auflagen aus `desktop-huelle`

- **Lokales Netz:** `src-tauri/Info.plist` mit `NSLocalNetworkUsageDescription` („Lifeline Hub
  verbindet sich mit dem Einsatzserver im lokalen Netz, z. B. elw.local.“) und
  `NSBonjourServices` `_https._tcp`. Der Bundler führt die Datei ins App-Bundle.
- **Druck (nur macOS):**
  - Ein `initialization_script` ersetzt `window.print` durch einen Aufruf von `drucken`, der
    `WebviewWindow::print()` ruft.
  - Das Skript löst vorher `beforeprint` und nach der Rückkehr `afterprint` aus, damit
    `useDruckModus` (LFH-22) umschaltet.
  - Ob der native Druck die Ereignisse selbst auslöst, wird in der Umsetzung gemessen. Tut er
    es, entfällt das eigene Auslösen, sonst schaltete die Seite doppelt.
  - Unter Windows bleibt `window.print()` unangetastet (gemessen: trägt).
- **Hintergrund:** `background_throttling(BackgroundThrottlingPolicy::Disabled)` am Hauptfenster
  auf macOS. Das Nachsynchronisieren nach einem Reconnect leistet `useEinsatzLiveStream` schon
  heute.
- **Downloads:** Vorgabeverhalten beider Webviews, `on_download` gibt `true` zurück. Gemessen im
  Spike: Ziel ist der Download-Ordner, Umlaute bleiben erhalten, Dubletten bekommen „(1)“. Keine
  eigene Logik, nur der Nachweis.
- **Nur https, Bestätigung, Capability:** D7.

### D9 — Erststart-Maske als statisches HTML

`src-tauri/ui/index.html` plus kleines Skript, ohne Build-Schritt und ohne antd:
- Farben als Werte der Nachtpalette aus `frontend/src/theme/tokens.ts`, mit Radius 0.
- Systemschrift als Rückfall, weil keine Webfonts gebündelt werden.
- Ein Feld „Serveradresse“, dazu „Verbinden“ und bei einem Wechsel „Abbrechen“.
- Die Fehlermeldung steht am Feld und kommt aus `pruefe_adresse` in Rust. Es gibt keine zweite
  Prüflogik in JS.
- Enter sendet (`<form>`).

Die Maske ist die einzige lokale Seite.

### D10 — Erzeugtes und Icons

- `src-tauri/gen/` (von `tauri-build` erzeugte Schemata) kommt in `.gitignore`, sonst liefe der
  Baum nach einem Gate-Lauf dirty.
- Die Icons erzeugt `cargo tauri icon frontend/public/pwa-512.png` einmalig, und sie werden
  committet.

## Risks / Trade-offs

- **[Längere Rust-Gates]** Schritt 4 und `coverage.yml` übersetzen Tauri mit, einmalig einige
  Minuten → `rust-cache` hält die Artefakte, und die Hülle hat wenige eigene Tests.
- **[Lockfile-Vereinigung]** Neue Tauri-Abhängigkeiten könnten gemeinsame Crates des Servers
  anheben → in der Umsetzung `cargo tree -p lifeline-hub` vor und nach vergleichen, keine
  Server-Version darf sich still ändern.
- **[Erster echter Lauf erst beim ersten stabilen Release]** → Der Nachbau per Dispatch mit
  `desktop: true` auf einem Alpha-Tag prüft die Matrix vorab. Die Update-Kette wird lokal mit
  zwei Versionen und Testschlüssel belegt.
- **[Unsignierte macOS-Hülle]** Gatekeeper warnt beim ersten Öffnen, und LFH-722 bezweifelt ein
  nutzbares Auto-Update ohne Signierung → im lokalen Nachweis mit ad-hoc-Signatur prüfen.
  Scheitert es, steht der macOS-Teil des Akzeptanzkriteriums „aktualisiert sich“ ehrlich als
  „offen → LFH-722“ in der Prüfliste. Die Betriebsdoku beschreibt den Erststart (Rechtsklick →
  Öffnen).
- **[Schlüsselverlust]** → Sicherung im Passwortmanager (D6), Folge in der Betriebsdoku.
- **[Windows-Installer beendet die Hülle beim Update]** → Nur nach ausdrücklicher Zustimmung,
  nie automatisch (D5).
- **[Deeplink-Schema friert ein]** `lifeline://verbinden?server=` ist Vertrag für LFH-38 → in der
  Betriebsdoku und in der Spec festgehalten.

## Migration Plan

Keine Daten- und keine API-Migration.
1. Nach dem Merge laufen Alpha-Releases unverändert, ohne Desktop-Jobs.
2. Vor dem ersten stabilen Release:
   - Secrets setzen (D6).
   - `artefakte.yml` per Dispatch mit `desktop: true` gegen einen Alpha-Tag laufen lassen, der
     NACH dem Merge entstanden ist (ältere Tags haben kein `src-tauri/`), und die Pakete
     installieren.
3. Das erste stabile Release (`alpha → main`) erzeugt die Pakete und `latest.json`.

Rückweg: Die Desktop-Jobs lassen sich über die Ausgabe `desktop` abschalten, ohne die
Server-Artefakte anzufassen.

## Nachweise der Umsetzung (29.09.2026, macOS 27 Apple Silicon)

Gemessen an einem Debug-Bundle (`cargo tauri build --debug --bundles app`, ad-hoc signiert) gegen
eine eigene https-Prüfseite (mkcert, `localhost:9443`), die die IPC-Brücke anspricht und ihr
Ergebnis per POST meldet. Die Seitenaufrufe stehen im Protokoll der Hülle
(`~/Library/Logs/dev.rubeen.lifeline.desktop/`).

| Punkt | Ergebnis | Beleg |
|---|---|---|
| Erststart ohne Adresse | Maske (`tauri://localhost`) | Protokoll „Seite geladen: tauri://localhost“ |
| Neustart mit gespeicherter Adresse | lädt die Adresse ohne Maske | Protokoll „Seite geladen: https://localhost:9443/“ |
| Deeplink ohne gespeicherte Adresse | Maske vorbelegt, nichts gespeichert | Protokoll `…/index.html`, keine `verbindung.json` |
| Deeplink mit fremdem Pfad | verworfen | Protokoll „Deeplink verworfen: lifeline://trennen?…“ |
| Einzelinstanz | eine Instanz nach Deeplink | `pgrep` = 1 |
| Serverseite ruft `verbinden`/`abbrechen`/`vorbelegung` | abgelehnt („not allowed … allowed on: URL: local“) | Bericht der Prüfseite |
| `window.print` auf der Serverseite | umgeleitet auf `drucken` | Bericht der Prüfseite |
| Nativer Druck löst `beforeprint` aus | ja, ~200 ms nach dem Aufruf; `print()` kehrt sofort zurück | Bericht der Prüfseite (`print-aufruf` 112 ms, `beforeprint` 310 ms) |
| Downloads | Download-Ordner, Umlaute erhalten, Dubletten „(1)“ … „(3)“ | `Prüfanhang-LFH-721-äöü*.txt` |
| Update 1.0.0 → 1.0.1 (Testschlüssel, lokales `latest.json` aus `desktop-manifest.mjs`) | Angebot mit Version, nach „Aktualisieren“ Neustart als 1.0.1 — **mit ad-hoc-Signatur** | Zugriffsprotokoll des Endpunkts, `CFBundleShortVersionString` 1.0.1, Nutzer bestätigte den Klick |
| Update-Prüfung ohne erreichbares Manifest | still, nur Protokoll | „Update-Prüfung nicht möglich …“ ohne Dialog |
| Version der Hülle nach einem Release-Merge | der erste Versionstest erkannte die Drift (alpha.51 ↔ alpha.53); daraus D2 in der heutigen Form | Umstellung auf `[workspace.package]` |

**Lehre für Prüfseiten:** Ein klassisches Skript mit `const ipc` auf oberster Ebene bricht in
der Hülle ab — die IPC-Brücke belegt `window.ipc`. Das Frontend lädt als Modul und ist nicht
betroffen.

## Prüfliste Akzeptanzkriterien (LFH-721)

| Kriterium | Verdikt | Beleg / Zielticket |
|---|---|---|
| Ein `main`-Release erzeugt installierbare Pakete und ein Update-Manifest | **offen → nach dem Merge** | Matrix, Einsammeln und Manifest lokal mit Attrappen belegt (actionlint grün); der erste echte Lauf ist der Dispatch mit `desktop: true` nach dem Merge und dem Setzen der Secrets, Windows ist bis dahin unbelegt |
| Eine installierte App aktualisiert sich auf das nächste Release | **erfüllt (macOS)**, Windows **offen → Dispatch-Lauf** | Zweiter Lauf mit dem heutigen Ablauf (Testpaar vom Stand `a628d630`, ad-hoc signiert): „Laden“ → Archiv geladen 20:25:15 → „Jetzt neu starten“ → läuft 20:25:19 als 1.0.1 (`CFBundleShortVersionString`). Die Befürchtung aus LFH-722 (ohne Signierung praktisch unbenutzbar) trifft das Update nicht, nur den Gatekeeper-Erststart |
| `check-all.sh` bleibt die einzige Wahrheit | **erfüllt** | Manifest-Selbsttest in Schritt 8; die CI bekommt nur Umgebung (apt-Pakete), keinen eigenen Schritt |

**Gate-Lauf 29.09.2026:** Schritt 4 nach der Trennung grün (Server 1910 Tests, Hülle 24); die
fünf roten Vitest-Dateien des Volllaufs liefen einzeln grün (Zeitüberschreitungen unter Last,
Frontend unverändert gegenüber `alpha`); e2e 345 grün, `e2e/kraefte-kontrast.spec.ts:140` lokal
3 von 4 Läufen rot (Mandantenpunkt mit Breite 0) — **Ursache offen**, der e2e-Lauf am PR entscheidet.

**Noch von Hand zu bestätigen** (an der Test-App vorbereitet, nicht automatisierbar ohne
Bedienfreigabe; bewusst offen gelassen am 29.09.2026): „Später“ im Neustart-Dialog läuft ohne
Neustart weiter; ein manipuliertes Archiv wird beim Laden abgelehnt (Fehlermeldung, Version
bleibt — gesichert durch die Signaturprüfung in `tauri-plugin-updater` `download`); Menü „Server wechseln…“ mit Vorbelegung und „Abbrechen“;
http-Meldung in der Maske; Bestätigungsdialog beim Deeplink auf eine andere Adresse; `afterprint`
beim Schließen des Druckdialogs; ⌘C/⌘V in der Maske. Live-Ereignisse im minimierten Fenster sind
nicht neu gemessen — die Einstellung (`background_throttling` aus) ist die aus LFH-720, Lauf 2.

## Prüfliste Einsatztauglichkeit — Erststart-Maske (`src-tauri/ui/`)

| #  | Verdikt | Beleg / Begründung |
|----|---|---|
| 1  | erfüllt | Feld und Knöpfe ≥ 48 px hoch, Knöpfe 12 px Abstand |
| 2  | nicht anwendbar | Keine Zeilen/Listen; die Maske hat genau ein Feld und steht vor der Anwendung, deren Dichte-Token hier nicht gilt |
| 3  | erfüllt | „Verbinden“ sperrt sofort und wechselt auf „Verbinde…“; die Prüfung läuft lokal in der Hülle |
| 4  | nicht anwendbar | Keine kritische Aktion; der Serverwechsel per Deeplink hat seine zweite Handlung (Bestätigungsdialog) |
| 5  | erfüllt | Dauerdunkle Fläche, deshalb Tag-Schwelle (LFH-434): Text 15,0/8,0 : 1, Fehlermeldung 7,18 : 1 (`rahmenFarben.alarm`), Primärknopf 10,2 : 1 auf `bedienText`, gesperrt 6,8 : 1; Rahmen 3,3 : 1, Fokusring 6,0 : 1 |
| 6  | erfüllt | Fehler als Text am Feld (`role="alert"`, `aria-invalid`), nicht nur roter Rahmen |
| 7  | erfüllt | Rot nur für den Fehler, Blau nur für Bedienung; Grund `#0c0e11` |
| 8  | nicht anwendbar | Keine Warnung, die gedimmt werden könnte; der Regler gehört zur Anwendung |
| 9  | erfüllt | Feld und Meldung mittig im Blickfeld |
| 10 | nicht anwendbar | Keine Alarme |
| 11 | erfüllt | Kein Blinken |
| 12 | erfüllt | Die Meldungszeile hält ihre Höhe vorab (`min-height`), kein Sprung beim Fehler |
| 13 | erfüllt | Nichts ist fixiert oder überlagert |
| 14 | nicht anwendbar | Keine Tabelle |
| 15 | erfüllt, soweit anwendbar | Label über dem Feld, Vorbelegung sichtbar und überschreibbar, Enter sendet (`<form>`), volle Tastaturbedienung; Serienerfassung und Sammelliste entfallen (ein Wert) |
