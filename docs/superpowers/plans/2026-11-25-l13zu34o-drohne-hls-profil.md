# Drohnenquelle „reine HLS-Adresse“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Adapterart `hls_adresse`, die das HLS-Bild eines MediaMTX des Kunden (auch im LAN per `http` an ein privates IP-Literal) über den bestehenden Video-Proxy ins Videofenster bringt.

**Architecture:** Neue Prüfung `ziel::check_adapter_url` mit Art-Flag `http_im_lan`; `video::rewrite_playlist` ersetzt `check_playlist` für beide Arten; `drohne::hls::HlsAdresseArt` als flüchtige Art; die Video-Route verzweigt nach der Art des Adapters.

**Tech Stack:** Rust (axum, reqwest, url, sqlx/SQLite), React-Text im Frontend.

**Spec:** `docs/superpowers/specs/2026-11-25-l13zu34o-drohne-hls-profil-design.md`

## Global Constraints

- Art-Code `hls_adresse`, Bezeichnung „Drohnenbild (HLS-Adresse)“, flüchtig, Intervall min 5 s, Vorschlag 5 s.
- Felder `playlist_url` (Url, Pflicht, max 512, „Adresse der Playlist“), `benutzer` (Text, optional, max 128, „Benutzer“); Platz `passwort` (optional, „Passwort“).
- `http` nur: Art mit `http_im_lan`, `lan_erlaubt`, Host IP-Literal der Klasse `Privat`. Hostnamen nie per `http`.
- Fehlertext: „Die Adresse muss mit https:// beginnen; http:// nur zu einer privaten IP-Adresse mit LAN-Ausnahme.“
- 404 der Playlist = kein Video, kein Fehlschlag (auch im Probelauf).
- Playlist-URIs nur Dateien im selben Verzeichnis desselben Ziels (Schema, Host, Port), sicheres Segment mit Endung aus `ttl_for`; sonst ganze Playlist ungültig.
- Keine Anfrage an `adapter::ziel` vorbei; nichts in die Datenbank außer Bestehendem.
- Bezeichner nach `AGENTS.md` (Technik englisch, Fachbegriffe deutsch); Prosa deutsch.

## Review Focus

- MediaMTX liefert zuerst eine Multivariant-Playlist (`index.m3u8` → `video1_stream.m3u8`), die Unterplaylist muss ebenfalls über den Proxy gehen → Test in Task 2 (`mediamtx_multivariant`).
- Playlist-URL mit Query (`…/index.m3u8?token=x`) → Verzeichnis ist das der Pfadangabe, Query fällt bei Unterdateien weg → Test in Task 2.
- Drohne landet, MediaMTX antwortet 404 → Anbindung bleibt „ok“, Video verschwindet → Test in Task 3 (`einordnen_404`).
- Ein Admin ändert `playlist_url` von https auf `http://mediamtx.lan` → Validierungsfehler beim Speichern → Test in Task 1.
- Videokennung eines `hls_adresse`-Adapters, der im Einsatz nicht zugeschaltet ist → 404 → Test in Task 4.

---

### Task 1: `http` im LAN für Arten mit `http_im_lan`

**Files:**
- Modify: `src/adapter/ziel.rs` (neue Funktion, `AbrufKontext` Feld + Builder)
- Modify: `src/adapter/art.rs` (Trait-Methode, `check_einstellungen`)
- Modify: `src/adapter/lauf.rs:283`, `src/adapter/live.rs:55` (Flag aus der Art setzen)

**Interfaces:**
- Produces: `pub fn check_adapter_url(roh: &str, lan_erlaubt: bool, http_im_lan: bool) -> Result<Url, ZielFehler>` in `adapter::ziel`; `AdapterArt::http_im_lan(&self) -> bool` (Standard `false`); `AbrufKontext::with_http_im_lan(self, bool) -> Self`; `ZielFehler::NichtHttps` behält seinen Text, der Adapter-Fehlertext entsteht in `check_einstellungen` für Arten mit `http_im_lan`.

- [ ] **Step 1: Failing tests** in `src/adapter/ziel.rs` tests:
  `http_nur_zu_privatem_ip_literal_mit_beiden_flags`: `check_adapter_url("http://10.0.0.5:8888/a/index.m3u8", true, true)` ok; dieselbe mit `(false,true)` und `(true,false)` → `Err(NichtHttps)` bzw. `Err(Intern)`; `http://100.64.1.2/x`, `http://[fd00::1]/x` ok mit `(true,true)`; `http://mediamtx.lan/x`, `http://8.8.8.8/x` → `Err(NichtHttps)`; `http://127.0.0.1/x`, `http://169.254.1.1/x` → `Err`; `https://beispiel.de/x` ok mit `(false,false)`; `http://u:p@10.0.0.5/x` → `Err(Anmeldedaten)`.
  In `src/adapter/art.rs` tests: Probe-Art mit `http_im_lan = true`: `{"url":"http://10.0.0.5/x"}` mit `lan=true` ok, `{"url":"http://mediamtx.lan/x"}` → Err mit dem Fehlertext aus Global Constraints; Probe ohne Flag lehnt `http://10.0.0.5/x` ab.
- [ ] **Step 2:** `cargo test --lib adapter::` → FAIL (Funktion fehlt).
- [ ] **Step 3:** Implementieren. `check_adapter_url`: Schema `http` und beide Flags → Host als IP-Literal parsen (`[…]` trimmen), `klasse == Privat` verlangen, dann `check_url` auf derselben URL mit Schema `https` ersetzt prüfen (übrige Regeln gleich) und die Original-URL zurückgeben; sonst `check_url`. `AbrufKontext::request` nutzt `check_adapter_url(url, lan, self.http_im_lan)`. `check_einstellungen` nutzt sie mit `art.http_im_lan()` und mappt `NichtHttps` bei `http_im_lan` auf den Text aus Global Constraints. `lauf`/`live` setzen `.with_http_im_lan(art.http_im_lan())`.
- [ ] **Step 4:** `cargo test --lib adapter::` → PASS.
- [ ] **Step 5:** Commit `feat(adapter): http zu privaten IP-Literalen für Arten mit LAN-Ausnahme`.

### Task 2: Playlist umschreiben (`rewrite_playlist`)

**Files:**
- Modify: `src/drohne/video.rs` (ersetzt `check_playlist` + Tests)
- Modify: `src/routes/drohne.rs` (`hls_abrufen` Suchlage-Zweig ruft `rewrite_playlist` mit der abgerufenen URL)

**Interfaces:**
- Consumes: `check_adapter_url` (Task 1), `crate::drohne::is_safe_segment`, `ttl_for`.
- Produces: `pub fn rewrite_playlist(bytes: &[u8], playlist_url: &Url, lan_erlaubt: bool, http_im_lan: bool) -> Result<Bytes, VideoFehler>`.

- [ ] **Step 1: Failing tests** (bestehende `check_playlist`-Tests umziehen, Basis `https://s.example/api/lagemonitor/v1/video/SN/hls/index.m3u8`):
  - `mediamtx_multivariant`: Basis `http://10.0.0.5:8888/drohne/index.m3u8`, Eingabe `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo1_stream.m3u8\n` → Ausgabe enthält Zeile `video1_stream.m3u8`, mit `(true,true)`.
  - `absolute_uri_im_selben_verzeichnis_wird_dateiname`: `http://10.0.0.5:8888/drohne/seg1.mp4` und `#EXT-X-MAP:URI="http://10.0.0.5:8888/drohne/init.mp4"` → `seg1.mp4`, `URI="init.mp4"`.
  - `query_faellt_weg`: Basis mit `?token=x`, Zeile `seg1.mp4?x=1` → `seg1.mp4`.
  - `abgelehnt`: fremder Host, anderer Port, `sub/seg.mp4`, `../seg.mp4`, `data:…`, `seg.exe`, `#EXT-X-KEY:METHOD=AES-128,URI="key.bin"`, `/drohne/seg.mp4` mit anderem Schema (https) → `Err(Upstream)`.
  - Suchlage-Playlists der alten Tests mit relativen URIs → ok und inhaltlich unverändert bis auf Normalisierung.
- [ ] **Step 2:** `cargo test --lib drohne::video` → FAIL.
- [ ] **Step 3:** Implementieren: zeilenweise; Nicht-Tag-Zeilen und jeder `URI=`-Wert (mit/ohne Anführungszeichen) → `playlist_url.join(uri)`, prüfen (`check_adapter_url` auf `as_str()`, gleiches Schema/Host/Port, `pfad.rsplit_once('/')`-Verzeichnis gleich dem der Playlist, letztes Segment `is_safe_segment` und `ttl_for(..).is_some()`), Wert durch Dateinamen ersetzen. Zeilenenden `\n`. Suchlage-Zweig in `hls_abrufen`: `rewrite_playlist(&bytes, &Url::parse(&url)?, kontext-lan, false)`; dafür `LiveKontext` um `pub fn lan_erlaubt(&self) -> bool` ergänzen, falls nicht vorhanden.
- [ ] **Step 4:** `cargo test --lib drohne:: && cargo test --test drohne_video` → PASS.
- [ ] **Step 5:** Commit `feat(drohne): Playlist auf Dateien im selben Verzeichnis umschreiben`.

### Task 3: Adapterart `hls_adresse`

**Files:**
- Create: `src/drohne/hls.rs`
- Modify: `src/drohne/mod.rs` (`ARTEN`, `is_drohnen_art`, `pub mod hls`), `src/adapter/art.rs:248` (Verzeichnis), `src/drohne/art.rs` (Verweise auf `super::ART` → `"suchlage"`-Konstante `SUCHLAGE`)

**Interfaces:**
- Consumes: Task 1, Task 2, `vertrag::key_for`, `store::{Stand, Store}`.
- Produces: `pub const SUCHLAGE: &str = "suchlage"; pub const HLS_ADRESSE: &str = "hls_adresse"; pub const ARTEN: &[&str]`; `pub struct HlsAdresseArt { store: Arc<Store> }` mit `new(Arc<Store>)`; `pub fn video_key(adapter_id: &str) -> String` (= `key_for(adapter_id, "hls")`); `pub fn einordnen(adapter_id: &str, erg: Result<Bytes, Fehlschlag>, playlist_url: &Url, lan: bool) -> Result<Vec<DrohnenVideo>, Fehlschlag>`; `pub fn apply_auth(req, kontext) -> RequestBuilder` (Basic nur mit `benutzer` und `passwort`).

- [ ] **Step 1: Failing tests** in `hls.rs`: `einordnen_200` (gültige Playlist → ein Video mit `video_key("a1")`); `einordnen_404` (`Err(Fehlschlag{status:Some(404),..})` → `Ok(vec![])`); `einordnen_500` → `Err`; `einordnen_ungueltige_playlist` → `Err(AntwortUngueltig)`; `kenndaten` (Code, Bezeichnung, fluechtig, Intervalle, `http_im_lan() == true`, Felder/Platz wie Global Constraints); `nicht_zugeschaltet_ruft_nicht_ab` (Muster `drohne::art`); `verzeichnis_enthaelt_hls_adresse`; in `mod.rs`: `is_drohnen_art("hls_adresse")`.
- [ ] **Step 2:** `cargo test --lib drohne::` → FAIL.
- [ ] **Step 3:** Implementieren nach Spec-Abschnitt „Adapterart“; `abrufen`: GET mit `apply_auth`, `send` + `read_bytes(DECKEL_PLAYLIST)` in einem Result, dann `einordnen`; Lage mit leeren Fluggeräten/Fotos, `karte: None`, `upstream.videos = {key: ""}`; `uebernehmen` wie `SuchlageUebernahme` (Typ dorthin verallgemeinern oder kopieren — kleinste Lösung: `SuchlageUebernahme` in `store.rs` als `StandUebernahme` gemeinsam nutzen). `anzahl` = Zahl der Videos.
- [ ] **Step 4:** `cargo test --lib` → PASS.
- [ ] **Step 5:** Commit `feat(drohne): Adapterart „Drohnenbild (HLS-Adresse)“`.

### Task 4: Video-Route nach Art

**Files:**
- Modify: `src/routes/drohne.rs` (`video`, `hls_abrufen`, `foto_abrufen` → `SUCHLAGE`)
- Test: `tests/drohne_video.rs`

**Interfaces:**
- Consumes: Task 3 (`HLS_ADRESSE`, `apply_auth`), Task 2.
- Produces: `hls_abrufen(state, org_id, adapter_id, art: &'static str, upstream: String, file)`.

- [ ] **Step 1: Failing tests:**
  - `tests/drohne_video.rs`: `adapter_anlegen` bekommt die Art als Parameter; `hls_adresse_nicht_zugeschaltet_404` (Stand mit Video im Store, Adapter `hls_adresse` nicht zugeschaltet → 404).
  - `src/drohne/mod.rs`: `pub fn drohnen_art(code: &str) -> Option<&'static str>` (liefert die Konstante aus `ARTEN`); Test: `suchlage`/`hls_adresse` → `Some`, `test` → `None`.
  - `tests/adapter_live.rs` (oder neue `tests/drohne_hls.rs`): ein `hls_adresse`-Adapter mit `lan_erlaubt` und `playlist_url` `http://10.0.0.5:8888/d/index.m3u8` über den Rahmen mit Schlüssel und produktivem Verzeichnis → `live_kontext(.., "hls_adresse")` ok, `k.get("http://10.0.0.5:8888/d/seg1.mp4")` ok, `k.get("http://mediamtx.lan/x")` Err; mit Art `"suchlage"` → `Unbekannt`.
- [ ] **Step 2:** `cargo test --test drohne_video` → FAIL.
- [ ] **Step 3:** Art des Adapters aus `adapter_repo` (Zeile der Org) lesen, `ARTEN`-Konstante wählen, an `live_kontext` geben; `hls_adresse`-Zweig: `Url::parse(playlist_url)?.join(&file)`, `rewrite_playlist(.., lan, true)` für Playlists, `apply_auth`.
- [ ] **Step 4:** `cargo test --test drohne_video --test drohne_quellen --test drohne_foto` → PASS.
- [ ] **Step 5:** Commit `feat(drohne): Livebild-Proxy auch für HLS-Adressen`.

### Task 5: Regeln, ADR, Doku, Hinweis im Formular

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0104-adapter-rufen-http-nur-zu-privaten-ip-literalen.md`
- Modify: `src/AGENTS.md` (Adapter: `http`-Regel, `drohne::ARTEN`), `docs/architektur/05-bausteinsicht.md:237-238`, `docs/konzepte/2026-11-24-drohnenbild-ueber-suchlage.md` (Schritt 8 Stand), `frontend/src/pages/einstellungen/AdapterPaneel.tsx` (`ADAPTER_LAN_WARNUNG` + Satz „Mit http:// (nur zu einer privaten IP-Adresse) gehen Zugangsdaten unverschlüsselt durchs Netz.“)

- [ ] **Step 1:** ADR nach `VORLAGE.md`, `gilt_fuer: src/adapter/ziel.rs`, Regeln (MUST NOT `http` ohne `http_im_lan`; MUST nur IP-Literal `Privat`), Prüfung `verlange 'fn check_adapter_url' src/adapter/ziel.rs`.
- [ ] **Step 2:** `scripts/check-all.sh --geaendert --ohne-e2e` → grün (inkl. Typ-Codegen, fmt, Prettier, ADR-Wächter).
- [ ] **Step 3:** Commit `docs(adapter): http-Ausnahme im LAN als Regel und ADR`.
