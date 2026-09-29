# Tasks

## 1. Reine Link-Entscheidung (Hülle)

- [x] 1.1 `src-tauri/src/links.rs` mit `Ziel`, `entscheide_neues_fenster`, `entscheide_navigation`
  per TDD nach der Tabelle in design.md D1. Die Tests pinnen: eigene Origin → `Nebenfenster`;
  `/api/einsaetze/1/anhaenge/7` → `Download` (neues Fenster und Navigation);
  `/api/auth/oidc/start` und `/api/auth/oidc/callback` → `Huelle`/`Nebenfenster`, nie
  `Download`; fremde `https` → `System` (neues Fenster) bzw. `Huelle` (Navigation);
  `mailto`/`tel` → `System`; `file:`/`javascript:`/`data:`/`blob:` → `Verwerfen`; anderer Port
  bzw. anderes Schema = fremde Origin; ohne Server keine eigene Origin; Maske und `about:blank`
  → `Huelle`. Nachweis: `cargo test -p lifeline-desktop links`.

## 2. Verdrahtung in der Hülle

- [x] 2.1 `tauri-plugin-opener` in `src-tauri/Cargo.toml` aufnehmen. Nur die freie Funktion
  `open_url` wird genutzt, das Plugin nicht im Builder registriert (design.md D4). Nachweis: `cargo build -p
  lifeline-desktop`, `scripts/check-deps.sh` grün.
- [x] 2.2 `baue_fenster(app, label, url)` aus dem Fensterbau in `setup` herauslösen (Titel,
  Größen, `on_page_load`, `on_download`, macOS-Drosselung und Druckskript). Das Hauptfenster
  entsteht darüber. Nachweis: `cargo test -p lifeline-desktop` grün, Hülle startet unverändert.
- [x] 2.3 `on_new_window` und `on_navigation` in `baue_fenster` an `links.rs` anbinden:
  `Nebenfenster` baut `neben-<n>` (Zähler im `Zustand`), `System` ruft den Opener, `Download`
  führt den Anker per `eval` aus (URL über `serde_json::to_string`), `Verwerfen` protokolliert
  über `fuers_protokoll`. Der Server wird bei jedem Aufruf gelesen. Nachweis: ein Test für den
  Skripttext (Kodierung eines Anführungszeichens und von `</script>` in der URL), `cargo test`.
- [x] 2.4 `server_freigeben` gibt `drucken` für `main` und `neben-*` frei, und `lade_server`
  schließt alle `neben-*`-Fenster vor dem Laden. Nachweis: Test, dass die Fensterliste der
  Capability beide Muster trägt; `capabilities/lokal.json` bleibt bei `main`.

## 3. Frontend: Chat-Anhänge

- [x] 3.1 `chat/NachrichtenStrom.tsx`: Anhänge über `DownloadAnker` (`href`, `dateiname`,
  `groesse`, zugänglicher Name mit Absender und Zeit), kein `target`. Test zuerst: der Anker
  trägt `download` mit dem Dateinamen, kein `target`, die Route
  `/api/einsaetze/{id}/anhaenge/{aid}` und den zugänglichen Namen. Nachweis: Vitest des
  Chat-Stroms; volle Vitest-Suite und `pnpm lint` grün.
- [x] 3.2 Den Dateikopf von `components/DownloadAnker.tsx` um die Chat-Ausnahme (n:m,
  generische Route) ergänzen. Nachweis: Kommentar widerspricht keinem Aufrufer mehr (Grep nach
  `DownloadAnker` in `chat/`).

## 4. Doku und Nachweis in der Hülle

- [x] 4.1 `docs/betrieb/desktop-app.md`: LFH-782 aus „Grenzen (offen)“ streichen, das Verhalten
  (Nebenfenster, Systembrowser, Download) beschreiben, fremde Navigation ohne Rückweg als
  Grenze nennen. In `CLAUDE.md` unter „Desktop-Hülle“ eine Zeile zu `links.rs`: Server zur
  Laufzeit, `/api/auth/` als Ausnahme. Nachweis: Grep nach `LFH-782` in beiden Dateien.
- [x] 4.2 Handprobe in der gebauten Hülle auf macOS gegen einen lokalen https-Server: Chat-Anhang
  (PDF) lädt herunter und die App bleibt, Inspector-Link öffnet den Standardbrowser,
  Palette Strg/⌘+↵ öffnet ein angemeldetes Nebenfenster, Druck im Nebenfenster erreicht den
  Dialog, Navigation auf eine Anhang-URL ersetzt die App nicht, OIDC-Anmeldung läuft durch
  (falls ein Anbieter lokal verfügbar ist, sonst als offen vermerkt). Belege als JSON unter
  `openspec/changes/lfh-782-huelle-neue-fenster-und-links/belege/macos/`. Windows als offen
  vermerken, falls kein Gerät bereitsteht.
- [x] 4.3 `./scripts/check-all.sh` grün (Log auf `ÜBERSPRUNGEN` prüfen). In der CI von #234 durchgehend grün; lokal unter Last schwankten `e2e/uhs-grundriss-touch.spec.ts:478` (1 von 3 isoliert) und `palette-oeffnung.spec.ts:338` (isoliert 3 von 3 grün), beide ohne Bezug zum Diff.
