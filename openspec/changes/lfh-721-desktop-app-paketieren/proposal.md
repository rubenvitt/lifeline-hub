# Proposal

## Why

Der Spike LFH-720 hat gezeigt, dass Variante A trägt: Eine Tauri-2-Hülle, die die
https-Adresse des Servers lädt, genügt für Windows und macOS. Fehlen noch ein ausgeliefertes,
installierbares Paket und ein Weg, installierte Hüllen aktuell zu halten. Die Entscheidung vom
25.09.2026 legt **einen** stabilen Kanal an `main`-Releases fest. Auf dem Mac bräche die Hülle
ohne die gemessenen Auflagen (Druck, lokales Netz, Hintergrund-Drosselung) still. Deshalb kommen
diese Auflagen in dieselbe erste Auslieferung.

## What Changes

- Neues Workspace-Mitglied `src-tauri` (Crate `lifeline-desktop`, Produktname „Lifeline Hub“,
  Bundle-ID `dev.rubeen.lifeline.desktop`). Die Hülle hat keine eigene Anwendungslogik.
- Erststart-Maske für die Serveradresse: nur `https` mit Hostname. Die gespeicherte Adresse
  lässt sich über das App-Menü „Server wechseln…“ ändern.
- Deeplink `lifeline://verbinden?server=https://…` (Vertrag für LFH-38 „Geräte verbinden“).
  Ohne gespeicherte Adresse füllt er die Maske vor, eine abweichende Adresse muss bestätigt
  werden.
- Auflagen aus `desktop-huelle`, außer neuen Fenstern und Links (LFH-782):
  - die Laufzeit-Capability genau für die konfigurierte Origin,
  - `NSLocalNetworkUsageDescription`,
  - die Umleitung von `window.print()` auf den nativen Druck (macOS),
  - `background_throttling` aus (macOS),
  - Downloads in den Download-Ordner.
- Tauri-Updater mit Ed25519-Schlüsselpaar. Der öffentliche Schlüssel steht im Repo, der private
  als CI-Secret. Die Hülle prüft beim Start im Hintergrund, bietet ein Update mit Versionsnummer
  an und installiert es erst nach Zustimmung. Ein Offline-Start wartet nicht auf die Prüfung.
- `artefakte.yml` bekommt eine Desktop-Build-Matrix:
  - macOS arm64 (`.app`/`.dmg` plus Updater-Archiv, ad-hoc signiert),
  - Windows x64 (NSIS-Installer, nativer MSVC-Build).

  Die Matrix läuft nur bei stabilen Tags, bei Vorabversionen nur auf ausdrücklichen Wunsch per
  `workflow_dispatch`. Ein Skript im Repo erzeugt aus den tatsächlich gebauten Plattformen ein
  `latest.json` und hängt es ans Release. Der Updater liest es über
  `…/releases/latest/download/latest.json`.
- `release.config.mjs` führt die Version der Desktop-Crate mit der Anwendungsversion.
- CI: Der Linux-Runner des Rust-Jobs bekommt die webkit2gtk-/GTK-Systempakete. Schritt 4 testet
  Server und Hülle getrennt, damit Cargo ihre Features nicht vereinigt; die Coverage misst ohne
  Hülle. `check-all.sh` bleibt die einzige Wahrheit. Der Selbsttest
  des Manifest-Skripts läuft in Schritt 8.

## Capabilities

### New Capabilities
- `desktop-auslieferung`: Wie aus einem stabilen Release installierbare Desktop-Pakete und ein
  Update-Manifest entstehen, und wie eine installierte Hülle das nächste Release findet, prüft
  und nach Zustimmung installiert.

### Modified Capabilities
- `desktop-huelle`: Neue Anforderungen für die Erststart-Maske, „Server wechseln“, den
  Deeplink-Vertrag (Schema, Vorbelegen ohne gespeicherte Adresse) und den Einzelinstanz-Betrieb.
  Die bestehenden Anforderungen aus LFH-720 bleiben unverändert und werden hier umgesetzt, außer
  „Neue Fenster und fremde Links laufen nicht ins Leere“ (LFH-782).

## Impact

- **Neu:** `src-tauri/` (Rust, `tauri` 2.12, Plugins `deep-link`, `single-instance`, `updater`,
  `dialog`, `process`), die Erststart-Maske (`src-tauri/ui/`, statisches HTML), Icons, macOS
  `Info.plist`, `scripts/release/desktop-manifest.mjs` plus Selbsttest, Betriebsdoku
  `docs/betrieb/desktop-app.md`.
- **Geändert:**
  - `Cargo.toml` (Workspace-Mitglied) und `Cargo.lock` (rund 400 zusätzliche Crates; der
    Server-Build bleibt davon unberührt, weil `cargo build` im Root nur das Root-Paket baut),
  - `.github/workflows/artefakte.yml`, `ci.yml` (Rust-Job), `coverage.yml`,
  - `release.config.mjs` (`prepareCmd`, `assets`), `scripts/check-all.sh` (Schritt 8).
- **Laufzeit der Gates:** Schritt 4 kompiliert zusätzlich Tauri (einmalig einige Minuten, danach
  im Cache).
- **Secrets (vom Menschen zu setzen):** `TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- **Nicht betroffen:** Server-API, Frontend, Datenbank. Die Server-Binaries aus LFH-522 bleiben
  unverändert.
- **Folgetickets:**
  - LFH-722 (Signierung und Notarisierung),
  - LFH-782 (neue Fenster und Links),
  - LFH-779/780 (Sitzung über den Neustart),
  - LFH-783 (Passkey auf macOS).
