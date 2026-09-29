# Tasks

## 1. Gerüst `src-tauri` im Workspace

- [x] 1.1 Vorher `cargo tree -p lifeline-hub -e normal --prefix none | sort -u` sichern. Danach
  `src-tauri/` anlegen:
  - Crate `lifeline-desktop` mit `tauri` 2.12 und den Plugins `deep-link`, `single-instance`
    (Feature `deep-link`), `updater`, `dialog`, `process`,
  - `build.rs`, `tauri.conf.json` ohne `version` (Produktname „Lifeline Hub“, Identifier
    `dev.rubeen.lifeline.desktop`, Schema `lifeline`, `createUpdaterArtifacts`,
    `signingIdentity: "-"`),
  - Workspace-Mitglied in `Cargo.toml`, `src-tauri/gen/` in `.gitignore`.

  Prüfen:
  - `cargo build -p lifeline-desktop` läuft grün.
  - `git status` nach dem Build ist sauber.
  - Der `cargo tree`-Vergleich für `lifeline-hub` zeigt keine geänderte Version.
- [x] 1.2 Icons per `cargo tauri icon frontend/public/pwa-512.png` erzeugen und committen.
  Prüfen: `cargo tauri build --debug --bundles app` erzeugt ein startbares `.app` mit Icon.
- [x] 1.3 `src-tauri/Info.plist` mit `NSLocalNetworkUsageDescription` und `NSBonjourServices`.
  Prüfen: `plutil -p` auf die `Info.plist` im gebauten Bundle zeigt beide Schlüssel.

## 2. Reine Entscheidungen (TDD)

- [x] 2.1 `adresse.rs`: `pruefe_adresse` test-first. Fälle:
  - `https://elw.local:8443` gültig,
  - Leerraum wird getrimmt,
  - `http://…` abgelehnt mit einer Meldung, die https nennt,
  - `https://` und `https:///x` abgelehnt mit einer Meldung, die den Hostnamen nennt,
  - Unsinn abgelehnt.

  Prüfen: `cargo test -p lifeline-desktop adresse` grün. Die Mutationsprobe (https-Prüfung
  entfernt) macht ihn rot.
- [x] 2.2 `deeplink.rs`: `deute` und `entscheide` test-first. Fälle:
  - ohne gespeicherte Adresse → `Vorbelegen`,
  - abweichend → `Bestaetigen`,
  - gleich (auch mit abschließendem `/`) → `Nichts`,
  - fremder Pfad, fehlendes `server` oder `http`-Ziel → `None`.

  Prüfen: `cargo test -p lifeline-desktop deeplink` grün, mit Mutationsprobe am Gleichheitsfall.
- [x] 2.3 `verbindung.rs`: Lesen und Schreiben test-first mit `tempfile`, dazu fehlende und
  kaputte Datei → keine Adresse. Prüfen: `cargo test -p lifeline-desktop verbindung` grün.

## 3. Hülle verdrahten

- [ ] 3.1 Erststart-Maske `src-tauri/ui/index.html` (D9) und die lokalen Commands `verbinden`,
  `abbrechen`, `vorbelegung` mit lokaler Capability. Start ohne Adresse → Maske, mit Adresse →
  Serverseite.

  Prüfen am lokalen Build gegen den Dev-Stack mit `--tls`:
  - Erststart zeigt die Maske,
  - `http://…` zeigt die https-Meldung,
  - „Verbinden“ lädt den Server,
  - ein Neustart lädt ihn ohne Maske.
- [x] 3.2 Laufzeit-Capability nur mit `drucken` für die Server-Origin, neu gesetzt bei jedem
  Verbinden. Prüfen:
  - Von der Serverseite aus lehnt der Aufruf von `verbinden` über `__TAURI_INTERNALS__.invoke` ab.
  - `drucken` geht.
- [ ] 3.3 Deeplink `lifeline://verbinden` über `deep-link` und `single-instance`, Wirkung nach
  `entscheide`, Bestätigung als nativer Dialog. Prüfen mit `open 'lifeline://verbinden?server=…'`:
  - ohne Adresse → Maske vorbelegt, nichts gespeichert,
  - abweichend → Dialog, „Abbrechen“ lässt die alte Adresse stehen,
  - bei laufender Hülle entsteht kein zweites Fenster.
- [ ] 3.4 Anwendungsmenü mit „Server wechseln…“ (Maske vorbelegt, „Abbrechen“ lädt die alte
  Adresse) und „Nach Updates suchen…“ neben den Standard-Bearbeiten-Einträgen. Prüfen: Beide
  Wege am lokalen Build, ⌘C/⌘V gehen im Webview.
- [ ] 3.5 macOS: `background_throttling(Disabled)` am Hauptfenster, Druck-Umleitung per
  `initialization_script` (D8). Messen, ob der native Druck `beforeprint`/`afterprint` selbst
  auslöst, und das Skript danach richten.

  Prüfen:
  - Auf der ETB-Druckseite öffnet „Drucken“ den macOS-Druckdialog, und die Druckansicht schaltet
    genau einmal um.
  - Ein minimiertes Fenster empfängt ein Live-Ereignis in Echtzeit (Beleg notieren).
- [x] 3.6 Downloads: `on_download` lässt das Vorgabeverhalten zu. Prüfen: Ein Anhang zweimal
  laden ergibt zwei Dateien im Download-Ordner, die zweite mit Zählzusatz, Umlaute erhalten.

## 4. Updater

- [x] 4.1 Schlüsselpaar mit Passwort nach `~/.tauri/lifeline-desktop.key` erzeugen, den
  Pubkey und den Endpunkt `…/releases/latest/download/latest.json` in `tauri.conf.json`
  eintragen. Die Secrets setzt der Mensch (Befehle in der Abschlussmeldung). Prüfen: Kein
  privater Schlüssel im Repo (`git grep -n 'untrusted comment: rsign encrypted secret key'` leer).
- [ ] 4.2 Update-Prüfung nach dem Laden im Hintergrund (Timeout 10 s, Fehler nur im Log), Dialog
  „Aktualisieren/Später“, `download_and_install` + Neustart, Windows `installMode: "passive"`,
  Menü-Prüfung mit „aktuell“-Meldung.

  Prüfen:
  - Ein Start ohne Netz lädt den Server ohne Verzögerung und ohne Dialog.
  - „Nach Updates suchen…“ ohne Treffer meldet „aktuell“.
- [ ] 4.3 Lokaler Nachweis der Update-Kette (macOS):
  - Testschlüssel und Prüf-Config mit lokalem Endpunkt (außerhalb des Repos) verwenden,
  - Version N installieren, N+1 bauen und mit `desktop-manifest.mjs` ein `latest.json` erzeugen,
  - lokal ausliefern und prüfen: „Später“ läuft weiter, „Aktualisieren“ startet als N+1,
  - ein verfälschtes Archiv wird abgelehnt.

  Ergebnis mit Belegen in `design.md` nachtragen. Scheitert macOS an der fehlenden Signierung,
  als „offen → LFH-722“ festhalten. Windows nach Möglichkeit in der Spike-VM, sonst als offen
  benennen.

## 5. Release-Pipeline

- [x] 5.1 `scripts/release/desktop-manifest.mjs` test-first mit
  `scripts/release/desktop-manifest.test.mjs`. Fälle:
  - beide Plattformen,
  - eine fehlende Plattform,
  - Archiv ohne `.sig`,
  - keine Plattform → Abbruch,
  - URL mit Tag und Repo.

  Den Test in `check-all.sh` Schritt 8 aufnehmen. Prüfen: `./scripts/check-all.sh --nur schnell`
  grün, die Mutationsprobe (Filter für fehlende `.sig` entfernt) macht ihn rot.
- [ ] 5.2 `artefakte.yml`:
  - Ausgabe `desktop` in `vorbereiten` plus Dispatch-Eingabe `desktop` (boolean),
  - Jobs `desktop-macos-arm64` und `desktop-windows-x86_64` (D3), Upload der Pakete,
  - Job `desktop-veroeffentlichen` (D4),
  - alle neuen Actions per SHA gepinnt.

  Prüfen:
  - `actionlint` (falls vorhanden) bzw. YAML-Prüfung grün,
  - der Kopfkommentar beschreibt die Desktop-Jobs,
  - nach dem Merge ein Dispatch-Lauf mit `desktop: true` auf dem jüngsten Alpha-Tag (Ergebnis in
    der Abschlussmeldung).
- [x] 5.3 `release.config.mjs`: `prepareCmd` um `cargo set-version -p lifeline-desktop`
  ergänzen, `src-tauri/Cargo.toml` zu den Assets. Prüfen: Der Lauf von `cargo set-version -p
  lifeline-desktop 9.9.9` in einer Wegwerf-Kopie ändert genau `src-tauri/Cargo.toml` und
  `Cargo.lock`.
- [ ] 5.4 `ci.yml` (Rust-Job) und `coverage.yml`: die webkit2gtk-/GTK-Pakete in den
  vorhandenen `apt-get`-Aufruf aufnehmen. Prüfen: Der PR-Lauf von `check-all --nur rust` ist grün.

## 6. Doku und Abschluss

- [x] 6.1 `docs/betrieb/desktop-app.md` schreiben:
  - Installation macOS mit Gatekeeper-Erststart und Windows mit SmartScreen,
  - Erststart, Server wechseln, Deeplink-Vertrag `lifeline://verbinden?server=` für LFH-38,
  - Update-Verhalten, Schlüssel und Secrets einschließlich der Folge eines Verlusts,
  - Grenzen (LFH-722/779/780/782/783).

  Verweis aus `docs/betrieb/packaging.md`. Prüfen: Die beschriebenen Befehle laufen wie
  geschrieben.
- [x] 6.2 CLAUDE.md: kurzer Abschnitt „Desktop-Hülle (LFH-721)“ mit den Trägern
  - `src-tauri`, keine Anwendungslogik,
  - Remote-Capability nur `drucken`,
  - Version über `release.config.mjs`,
  - Manifest-Skript mit Selbsttest in Schritt 8.

  Prüfen: Die Pfade existieren.
- [ ] 6.3 `./scripts/check-all.sh` voll grün (Log ohne unerwartetes ÜBERSPRUNGEN), Prüfliste
  der Akzeptanzkriterien mit Verdikt je Zeile in `design.md`.
