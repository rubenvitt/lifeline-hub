# Desktop-Hülle (LFH-721) — Regeln

Gilt für `src-tauri/`, zusätzlich zur `AGENTS.md` der Wurzel.

`src-tauri/` (Crate `lifeline-desktop`, Tauri 2), Anforderungen `openspec/specs/desktop-huelle/`
und `…/desktop-auslieferung/`, Betrieb `docs/betrieb/desktop-app.md`.
- **Keine Anwendungslogik in der Hülle** (Variante A, LFH-720): der Webview lädt die
  https-Adresse des Servers. Abhilfen für Webview-Grenzen gehören in die Hülle (Init-Skript,
  Command), nicht ins Frontend.
- **Rechte:** Adresse setzen nur die lokale Maske (`capabilities/lokal.json`); die Serverseite
  bekommt zur Laufzeit genau für ihre Origin nur `SERVER_RECHTE` (`drucken`,
  `anmeldung_im_browser`; `server_freigeben`). Jeder neue Command steht im `AppManifest` von
  `build.rs`, sonst wäre er für jede Seite offen.
- **Im Browser anmelden** (LFH-818, `openspec/changes/archive/2026-09-30-lfh-818-anmeldung-im-systembrowser/design.md`):
  `ASWebAuthenticationSession` (`aswas.rs`), PKCE-`verifier` bleibt in der Hülle, Rücksprung nur
  aus der Sitzung (`anmeldung::folge`); eingelöst per `eval` im startenden Fenster mit doppelter
  Origin-Prüfung, Server `POST /api/auth/app-code[/einloesen]` (einheitlich 401, Audit
  `systembrowser`). Ein `lifeline://anmeldung` von außen bleibt wirkungslos.
- Adresse, Deeplink (`lifeline://verbinden?server=`, Vertrag für LFH-38) und Speicherung sind
  reine, getestete Funktionen (`adresse.rs`, `deeplink.rs`, `verbindung.rs`).
- **Neue Fenster und Links** (LFH-782) entscheidet `links.rs` rein, den Server liest es bei
  jedem Aufruf frisch: eigene Origin → Nebenfenster (`neben-*`, gleicher Fensterbau
  `baue_fenster`, Druckfreigabe per Muster), `/api/` → Download, **außer `/api/auth/`** (OIDC
  läuft im Fenster), fremde `http(s)`/`mailto`/`tel` → System (`tauri_plugin_opener::open_url`,
  Plugin nicht registriert). Fremde Navigation im Fenster bleibt erlaubt (Anbieter).
- **Version: eine Quelle** in `[workspace.package]` der Wurzel, Server und Hülle erben
  (`version.workspace = true`), `tauri.conf.json` trägt keine; `prepareCmd` setzt sie über
  `-p lifeline-hub`. Kein eigenes Versionsfeld in `src-tauri` (driftet beim alpha-Merge; Test
  `version_kommt_aus_dem_workspace`).
- Pakete + `latest.json` nur bei stabilen Tags (`artefakte.yml`, Ausgabe `desktop`);
  `scripts/release/desktop-manifest.mjs`, Selbsttest in Schritt 8. Der Updater-Schlüssel liegt
  außerhalb des Repos (Secrets `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`), der Pubkey in
  `tauri.conf.json`.
- **Developer ID und Notarisierung (macOS)** trägt nur der Release-Lauf (`artefakte.yml`,
  `APPLE_*`-Secrets, LFH-722, `openspec/changes/archive/2026-10-01-lfh-722-macos-signierung-notarisierung/design.md`).
  `bundle.macOS.signingIdentity` bleibt `"-"`, damit lokale Bauten ad hoc ohne Zertifikat gehen.
- **Schritt 4 testet Server und Hülle getrennt** (`--workspace --exclude lifeline-desktop`, dann
  `-p lifeline-desktop`): in einem Zug vereinigte Cargo die Features, der Server liefe mit zwei
  rustls-Providern (Stolperdraht `tls::tests::rcgen_pem_ist_per_rustls_ladbar`). Linux-Runner
  des Rust-Jobs brauchen die GTK-/WebKit-Pakete (`ci.yml`); `coverage.yml` misst ohne Hülle.
