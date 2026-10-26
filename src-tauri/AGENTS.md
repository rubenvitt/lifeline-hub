# Desktop-Hülle (LFH-721) — Regeln

Gilt für `src-tauri/`, zusätzlich zur `AGENTS.md` der Wurzel.

`src-tauri/` (Crate `lifeline-desktop`, Tauri 2), Anforderungen `openspec/specs/desktop-huelle/`
und `…/desktop-auslieferung/`, Betrieb `docs/betrieb/desktop-app.md`.
- **Keine Anwendungslogik in der Hülle** (Variante A, LFH-720): der Webview lädt die
  https-Adresse des Servers. Abhilfen für Webview-Grenzen gehören in die Hülle (Init-Skript,
  Command), nicht ins Frontend.
- **Rechte:** Adresse setzen nur die lokale Maske (`capabilities/lokal.json`, nur Fenster
  `main`); die lokale Anzeige „nicht erreichbar“ (`capabilities/nicht-erreichbar.json`, jedes
  Fenster) darf nur prüfen, neu laden und zur Maske führen; die Serverseite
  bekommt zur Laufzeit genau für ihre Origin nur `SERVER_RECHTE` (`drucken`,
  `anmeldung_im_browser`, `benachrichtigung_zeigen`, `set_app_badge`; `server_freigeben`). Jeder neue Command steht
  im `AppManifest` von `build.rs`, sonst wäre er für jede Seite offen. Commands eines Plugins
  (`notification:…`) gibt keine Capability frei.
- **Native Meldung** (Benachrichtigungskonzept D7): `benachrichtigung_zeigen` reicht Titel und
  Text an `tauri-plugin-notification` durch; ob und wann, entscheidet das Frontend
  (`frontend/src/alarm/desktopAlarm.ts`, Kennung über `benachrichtigung.js` in jeder Hülle, vor
  `faehigkeiten.js`; beide ergänzen `__LIFELINE_HUELLE__`). Das Plugin ersetzt in jeder Seite
  `window.Notification` durch einen Weg ohne Freigabe; die Seite darf ihn nicht nehmen. Ein Klick
  (`on_action`, `tap`) holt das Fenster der Meldung nach vorn (`klick_fenster`, `nach_vorn`), den
  Sprung trägt der Toast. Schließen kann die Hülle eine Meldung auf macOS und Windows nicht.
- **App-Badge** (LLH-1423): `set_app_badge { count }` setzt die Zahl, die das Frontend nennt
  (`frontend/src/alarm/appBadge.ts`, über `benachrichtigung.js`). Die Hülle merkt sich je Fenster
  eine Zahl (`update_badge`), das Symbol trägt die größte (`badge_count`); ein neues Laden im
  Fenster und sein Schließen nehmen dessen Zahl weg. Tauri setzt sie über `set_badge_count`
  (macOS Dock, app-weit); unter Windows tut der Aufruf nichts, ein Overlay-Symbol gibt es nicht.
- **Im Browser anmelden** (LFH-818, `openspec/changes/archive/2026-09-30-lfh-818-anmeldung-im-systembrowser/design.md`):
  `ASWebAuthenticationSession` (`aswas.rs`), PKCE-`verifier` bleibt in der Hülle, Rücksprung nur
  aus der Sitzung (`anmeldung::folge`); eingelöst per `eval` im startenden Fenster mit doppelter
  Origin-Prüfung, Server `POST /api/auth/app-code[/einloesen]` (einheitlich 401, Audit
  `systembrowser`). Ein `lifeline://anmeldung` von außen bleibt wirkungslos.
- Adresse, Deeplink (`lifeline://verbinden?server=`, Vertrag für LFH-38) und Speicherung sind
  reine, getestete Funktionen (`adresse.rs`, `deeplink.rs`, `verbindung.rs`). `verbindung.json`
  trägt neben `server` die Liste `bekannt` (LLH-1282, neuester zuerst, höchstens
  `MAX_BEKANNT`); der verbundene Server lässt sich nicht vergessen.
- **Fenster sind gleichrangig** (LLH-1281): Schließen des Hauptfensters schließt nichts mit;
  Maske und Serverwechsel bauen `main` bei Bedarf neu (`zeige_maske`, `lade_server`), alles
  andere nimmt `front_fenster`. „Neues Fenster“ (Menü, ⌘N/Strg+N als einziges Menükürzel) baut
  ein `neben-*` über `open_nebenfenster`, versetzt zum vorderen. Gleiche native Meldungen aus
  mehreren Fenstern fasst `neu_gemeldet` zusammen (`DOPPEL_FRIST`).
- **Wache über jedes Laden des Servers** (LLH-1283, `erreichbar.rs`): Wer den Server in ein
  Fenster lädt, geht über `load_in_fenster` bzw. `start_watch`, sonst bleibt das Fenster bei
  einem Ausfall auf macOS leer. Angekommen ist jede nicht-lokale Seite (auch aus dem Service
  Worker oder beim Identitätsanbieter); die Anzeige lädt erst neu, wenn `check_server` den Port
  erreicht.
- **Neue Fenster und Links** (LFH-782) entscheidet `links.rs` rein, den Server liest es bei
  jedem Aufruf frisch: eigene Origin → Nebenfenster (`neben-*`, gleicher Fensterbau
  `baue_fenster`, Druckfreigabe per Muster), `/api/` → Download, **außer `/api/auth/`** (OIDC
  läuft im Fenster), fremde `http(s)`/`mailto`/`tel` → System (`tauri_plugin_opener::open_url`,
  Plugin nicht registriert). Fremde Navigation im Fenster bleibt erlaubt (Anbieter). Ein
  `blob:` mit `<a download>` (CSV-Export) geht in beiden Webviews ohne Hüllencode an
  `on_download` (LFH-914, `links.rs`); eine `blob:`-Navigation nicht verwerfen.
- **Version: eine Quelle** in `[workspace.package]` der Wurzel, Server und Hülle erben
  (`version.workspace = true`), `tauri.conf.json` trägt keine; `prepareCmd` setzt sie über
  `-p lifeline-hub`. Kein eigenes Versionsfeld in `src-tauri` (driftet beim alpha-Merge; Test
  `version_kommt_aus_dem_workspace`).
- Pakete + `latest.json` an jedem Tag (`desktop.yml`, aus `artefakte.yml`): stabil vor der
  Freigabe, ein roter Bau hält sie auf (Job `freigeben`, LFH-1054); Alpha danach (`desktop-alpha`,
  LLH-1280), Alpha-Hüllen lesen den Kanal `desktop-alpha` und merken ihn sich (`kanal.rs`, `update.rs`,
  Job `desktop-kanal`, `scripts/release/desktop-kanal.mjs`);
  `scripts/release/desktop-manifest.mjs`, Selbsttest in Schritt 8. Der Updater-Schlüssel liegt
  außerhalb des Repos (Secrets `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`), der Pubkey in
  `tauri.conf.json`.
- **Developer ID und Notarisierung (macOS)** trägt nur der Release-Lauf (`desktop.yml`,
  `APPLE_*`-Secrets, LFH-722, `openspec/changes/archive/2026-10-01-lfh-722-macos-signierung-notarisierung/design.md`).
  `bundle.macOS.signingIdentity` bleibt `"-"`, damit lokale Bauten ad hoc ohne Zertifikat gehen.
- **Schritt 4 testet Server und Hülle getrennt** (`--workspace --exclude lifeline-desktop`, dann
  `-p lifeline-desktop`): in einem Zug vereinigte Cargo die Features, der Server liefe mit zwei
  rustls-Providern (Stolperdraht `tls::tests::rcgen_pem_ist_per_rustls_ladbar`). Linux-Runner
  des Rust-Jobs brauchen die GTK-/WebKit-Pakete (`ci.yml`); `coverage.yml` misst ohne Hülle.
