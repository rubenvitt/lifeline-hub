# Drohnenbild über Suchlage – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lifeline Hub zeigt Position, Spur, Kartenelemente, Livebild und Fotos einer Suchlage-Drohne in der Lagekarte eines zugeschalteten Einsatzes, ohne etwas davon zu speichern.

**Architecture:** Eine flüchtige Adapterart „suchlage“ ruft alle 5 s `lagemonitor/v1/lage` ab und legt den neutralen Lagestand (`src/drohne/`) im Arbeitsspeicher ab. Einsatzrouten unter `/api/incidents/{id}/…` liefern daraus eine Fachebene, bündeln HLS-Segmente und reichen bereinigte Fotovorschauen durch; Token werden je Live-Abruf entschlüsselt.

**Tech Stack:** Rust (axum, sqlx/SQLite, reqwest über `adapter::ziel`, `futures::Shared`), React/antd/MapLibre, `hls.js`.

**Spec:** `docs/superpowers/specs/2026-11-24-incls23v-drohnenbild-suchlage-design.md` (freigegeben 24.11.2026). Suchlage-Vertrag: `rubenvitt/suchlage` `src/contract/lagemonitor.rs` (Branch von PR #40).

## Global Constraints

- Bezeichner: Fachbegriffe deutsch, Technik englisch (Wurzel-`AGENTS.md`, „Bezeichner-Sprache“); Prosa, Kommentare, Testnamen deutsch mit echten Umlauten in Texten.
- Neue Routen unter `/api/incidents/{id}/…`; jedes feste Segment steht in `scripts/api-routen-woerter.tsv` (sortiert); `scripts/api-routen-bestand.txt` wächst nicht.
- Neue Wire-Felder englisch; GeoJSON-Eigenschaft `kind` mit `aircraft` | `track` | `element` | `photo`.
- Nichts aus Suchlage in die DB; einzige neue Tabelle `adapter_einsatz` ohne Personenbezug.
- Keine Seriennummer (`gateway_sn`, `aircraft_sn`) und kein Token in Antwort, Log, Fehler.
- HTTP nur über `adapter::ziel`; kein neuer Client.
- Neue DTOs mit `ToSchema` → `scripts/check-typ-codegen.sh` (openapi.json + types.generated.ts mitcommitten).
- Statuscodes nach `src/AGENTS.md`, Statuscode-Konvention: 400 Feld, 422 Zusammenhang, 409 Konflikt, 403 Recht, 404 nicht gefunden, 503 Abhängigkeit.
- Jeder Commit-Body trägt `Zunder: https://zunder.rubeen.dev/#/aufgabe/<id>` der Unteraufgabe und die Co-Authored-By-/Claude-Session-Zeilen der Sitzung.
- Gate vor jedem Commit: `./scripts/check-all.sh --geaendert --ohne-e2e` (bei Zeitnot mindestens die betroffenen `cargo test`-Ziele und `pnpm -C frontend test <datei>`; vor dem PR der volle `--geaendert --ohne-e2e`-Lauf).

## Review Focus

1. **Zwei Einsätze, eine Quelle:** zweite Zuschaltung → 409, auch bei gleichzeitigen Anfragen (Task 5 testet zwei PUTs in Folge; die Prüfung läuft in derselben Schreibtransaktion).
2. **Neustart:** nach `Store::load` ist ein zugeschalteter Adapter sofort wieder `is_zugeschaltet` (Task 3).
3. **Einsatz abgeschlossen, Zuschaltung bleibt in der Tabelle:** Routen antworten 404/`offline`, `uebernehmen` räumt den Merker ab (Task 4, Task 6).
4. **Suchlage liefert `map` weg (ETag passt):** letzte Karte bleibt sichtbar (Task 2).
5. **Playlist mit absoluter URI oder Datei mit `..`:** 502 bzw. 404, nie ein Abruf außerhalb von `basis_url` (Task 9).

---

## LLH-2105 (bj5xpxed) – Drohnenquelle und Adapter

### Task 1: Rahmen – flüchtige Arten und `version_unbekannt`

**Files:**
- Modify: `src/adapter/art.rs` (Trait), `src/adapter/repo.rs` (`save_erfolg`), `src/adapter/lauf.rs` (`run_one`), `src/adapter/zustand.rs` (`AdapterFehler`, `braucht_eingriff`), `src/benachrichtigung/adapter.rs` (`fehler_text`), `frontend/src/api/adapter.ts`, `tests/enum_wire_kontrakt.rs`, `tests/adapter_testart/mod.rs`, `src/AGENTS.md` (Abschnitt „Backend — Adapter“)
- Test: `tests/adapter_lauf.rs`

**Interfaces:**
- Produces: `AdapterArt::fluechtig(&self) -> bool` (Default `false`); `AdapterFehler::VersionUnbekannt` (Wire `version_unbekannt`, `braucht_eingriff == true`); `repo::save_erfolg(conn, a, anzahl, jetzt, ab: &str)` – `ab` ist der Zeitpunkt, ab dem das Intervall zählt.

- [ ] **Step 1: Failing tests in `tests/adapter_lauf.rs`** (Testart bekommt einen Schalter `fluechtig`):
  - `flüchtige_art_schreibt_bei_erfolg_keinen_versuch`: zwei erfolgreiche Läufe → `adapter_versuch` für den Adapter hat 0 Zeilen, `letzter_erfolg_at` gesetzt.
  - `flüchtige_art_schreibt_den_versuch_der_die_störung_beendet`: Fehlschlag, dann Erfolg → 2 Zeilen; die zweite hat `fehler_art IS NULL`.
  - `flüchtige_art_zählt_das_intervall_ab_laufbeginn`: Intervall 5 s, Lauf beginnt bei T → `naechster_abruf_at == T + 5 s` (nicht Ende + 5 s).
  - `nicht_flüchtige_art_bleibt_wie_bisher`: Versuch je Erfolg, Intervall ab Ende.
  - `version_unbekannt_hält_den_adapter_an`: Testart liefert `Fehlschlag(VersionUnbekannt)` → Adapter `angehalten`.
- [ ] **Step 2:** `cargo test --test adapter_lauf` → neue Tests FAIL.
- [ ] **Step 3:** Implementieren: in `run_one` bei `art.fluechtig()` `save_erfolg(…, ab = beginn)` statt Ende, `save_versuch` nur wenn `war_gemeldet` oder `a.fehlversuche > 0`; sonst `versuch_id` für `AdapterWiederOk` wie gehabt. Neuer Code in `AdapterFehler`, `braucht_eingriff`, `fehler_text` („Unbekannte Schnittstellenversion“), `adapter.ts` gleichlautend, Enum-Kontrakt.
- [ ] **Step 4:** `cargo test --test adapter_lauf --test enum_wire_kontrakt` → PASS.
- [ ] **Step 5:** `src/AGENTS.md`, „Backend — Adapter“: Absatz „Flüchtige Arten“ (Übernahme nur in den Speicher, Takt ab Laufbeginn, Versuchszeile nur bei Zustandswechsel). Commit `feat: flüchtige Adapterarten und Code version_unbekannt (LLH-2105)`.

### Task 2: Neutraler Vertrag und Übersetzung aus Suchlage

**Files:**
- Create: `src/drohne/mod.rs`, `src/drohne/vertrag.rs`, `src/drohne/suchlage.rs`, `src/drohne/testdaten/lage.json`, `src/drohne/testdaten/lage_ohne_karte.json`, `src/drohne/testdaten/photos.json`
- Modify: `src/lib.rs` (Modul)

**Interfaces:**
- Produces (`src/drohne/vertrag.rs`):
  - `pub struct DrohnenLage { pub stand_ms: i64, pub quelle_stand_ms: i64, pub mission_name: Option<String>, pub fluggeraete: Vec<Fluggeraet>, pub karte: Option<serde_json::Value /* FeatureCollection */>, pub videos: Vec<DrohnenVideo>, pub fotos: Vec<DrohnenFoto>, pub verworfen: u32 }`
  - `pub struct Fluggeraet { pub key: String, pub label: String, pub position: Option<[f64; 2]>, pub heading_deg: Option<f64>, pub height_m: Option<f64>, pub battery_percent: Option<u8>, pub airborne: bool }`
  - `pub struct DrohnenVideo { pub key: String }` (nur HLS)
  - `pub struct DrohnenFoto { pub key: String, pub taken_at_ms: i64, pub position: [f64; 2], pub lens: String, pub heading_deg: Option<f64>, pub relative_altitude_m: Option<f64> }`
  - `pub fn key_for(adapter_id: &str, upstream: &str) -> String` – erste 16 Hex-Zeichen von SHA-256(`adapter_id:upstream`).
- Produces (`src/drohne/suchlage.rs`):
  - `pub struct Upstream { pub videos: HashMap<String /*key*/, String /*gateway_sn*/>, pub fotos: HashMap<String /*key*/, String /*thumb_url*/> }`
  - `pub fn parse_lage(adapter_id: &str, json: &[u8], vorige_karte: Option<(&str /*etag*/, &serde_json::Value)>, jetzt_ms: i64) -> Result<(DrohnenLage, Option<String> /*map_etag*/, Option<i64> /*photos_latest_ms*/, Upstream), ParseError>`
  - `pub fn parse_photos(adapter_id: &str, json: &[u8]) -> Result<(Vec<DrohnenFoto>, HashMap<String, String>), ParseError>`
  - `pub enum ParseError { VersionUnbekannt(u32), Ungueltig }`

- [ ] **Step 1: Failing unit tests in `src/drohne/suchlage.rs`** mit synthetischen Fixtures (Felder nach `suchlage/src/contract/lagemonitor.rs`: `api_version`, `aircraft[].gateway_sn/label/position/heading_deg/elevation_takeoff_m/battery_percent/airborne`, `videos[]`, `map`, `map_etag`, `photos_latest_ms`, `mission`):
  - `übersetzt_fluggerät_ohne_seriennummer`: `key == key_for(id, gateway_sn)`, serialisierte `DrohnenLage` enthält die Seriennummer nicht (String-Suche).
  - `kennung_ist_stabil_und_je_adapter_verschieden`.
  - `fehlende_karte_übernimmt_die_vorige`: `lage_ohne_karte.json` + `vorige_karte` → `karte` gleich der vorigen, `map_etag` gleich.
  - `unbekannte_version_wird_abgelehnt`: `api_version: 2` → `ParseError::VersionUnbekannt(2)`.
  - `unbekannte_feature_arten_werden_gezählt`: Feature mit unbekannter `kind` → nicht in `karte`, `verworfen == 1`.
  - `fotos_ohne_position_fallen_weg` und `foto_kennung_bildet_auf_thumb_url_ab` (`photos.json`; `LmPhotoShot.id` ist eine Zahl, je Linse ein `DrohnenFoto`, Upstream-Schlüssel `"{id}:{lens}"`).
- [ ] **Step 2:** `cargo test drohne::` → FAIL.
- [ ] **Step 3:** Implementieren. Karte: Suchlage-Features in `kind` `track` (Flugspur) bzw. `element` (Kartenelement, Punkt/Linie/Fläche, mit `label`) umschreiben; andere verwerfen und zählen.
- [ ] **Step 4:** `cargo test drohne::` → PASS.
- [ ] **Step 5:** Commit `feat: neutraler Drohnenvertrag und Übersetzung aus Suchlage (LLH-2105)`.

### Task 3: Zuschaltung – Tabelle, Repo und Speicher

**Files:**
- Create: `migrations/<nächste>_adapter_einsatz.sql`, `src/drohne/store.rs`, `src/drohne/repo.rs`
- Modify: `src/app.rs` (`AppState` bekommt `drohne: Arc<drohne::Store>`), `src/main.rs` (`Store::load` vor dem Adapter-Lauf)
- Test: `tests/drohne_store.rs`

**Interfaces:**
- Migration: `CREATE TABLE adapter_einsatz (adapter_id TEXT NOT NULL REFERENCES adapter(id) ON DELETE CASCADE, einsatz_id INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE, zugeschaltet_at TEXT NOT NULL, lagemonitor INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (adapter_id, einsatz_id));` plus Index auf `einsatz_id`.
- Produces (`src/drohne/repo.rs`): `pub struct Zuschaltung { pub adapter_id: String, pub einsatz_id: i64, pub zugeschaltet_at: String, pub lagemonitor: bool }`; `load_for_einsatz(conn, einsatz_id) -> Vec<Zuschaltung>`; `load_active_adapter_ids(conn) -> Vec<String>` (nur laufende Einsätze); `find_active_holder(conn, adapter_id) -> Option<i64 /*einsatz_id*/>`; `upsert(conn, &Zuschaltung)`; `delete(conn, adapter_id, einsatz_id) -> bool`; `is_active(conn, adapter_id) -> bool`.
- Produces (`src/drohne/store.rs`): `pub struct Store`; `Store::new() -> Self`; `async fn load(&self, pool)`; `fn is_zugeschaltet(&self, adapter_id) -> bool`; `fn set_zugeschaltet(&self, adapter_id, bool)` (bei `false` auch Stand leeren); `fn put(&self, adapter_id, Stand)`; `fn get(&self, adapter_id) -> Option<Stand>` (Clone); `fn find_video(&self, key) -> Option<(String /*adapter_id*/, String /*gateway_sn*/)>`; `fn find_photo(&self, key) -> Option<(String, String /*thumb_url*/)>`; `pub struct Stand { pub lage: DrohnenLage, pub map_etag: Option<String>, pub photos_latest_ms: Option<i64>, pub upstream: Upstream }`.
- „Laufend“ = dieselbe Bedingung, die `fordere_aktiv` für einen Einsatz nutzt (nachlesen in `src/einsatz/`).

- [ ] **Step 1: Failing tests `tests/drohne_store.rs`:** `load_setzt_den_merker_für_laufende_einsätze`, `abgeschlossener_einsatz_zählt_nicht`, `find_active_holder_findet_den_anderen_einsatz`, `abschalten_leert_den_stand`, `löschen_des_adapters_entfernt_die_zuschaltung` (CASCADE).
- [ ] **Step 2:** `cargo test --test drohne_store` → FAIL.
- [ ] **Step 3:** Implementieren; `check-migrationen.sh` beachten (Nummer, Kanal).
- [ ] **Step 4:** `cargo test --test drohne_store` → PASS; `scripts/check-migrationen.sh` → OK.
- [ ] **Step 5:** `src/AGENTS.md`, „Backend — Adapter“: Absatz „Zuschaltung je Einsatz“ (`adapter_einsatz`, DB ist Quelle der Wahrheit, `drohne::Store` nur Abbild). Commit `feat: Zuschaltung einer Drohnenquelle je Einsatz (LLH-2105)`.

### Task 4: Art „suchlage“

**Files:**
- Create: `src/drohne/art.rs`
- Modify: `src/adapter/art.rs` (`Verzeichnis::produktiv(drohne: Arc<drohne::Store>)` und Test auf leeres Verzeichnis → enthält `suchlage`), `src/main.rs`
- Test: Unit-Tests in `src/drohne/art.rs`

**Interfaces:**
- Consumes: Task 1 (`fluechtig`, `VersionUnbekannt`), Task 2 (`parse_lage`, `parse_photos`), Task 3 (`Store`, `repo::is_active`).
- Produces: `pub struct SuchlageArt { store: Arc<Store> }` mit `code() == "suchlage"`, `bezeichnung() == "Suchlage (Drohne)"`, Feld `basis_url` (`FeldTyp::Url`, Pflicht, max 512), Platz `token` (Pflicht, „Großbild-Zugang“), `intervall_min_s() == 5`, `intervall_vorschlag_s() == 5`, `fluechtig() == true`. `pub const LAGE_DECKEL: usize = 4 * 1024 * 1024; pub const FOTOS_DECKEL: usize = 2 * 1024 * 1024;`
- `abrufen`: nicht zugeschaltet und kein Probelauf → `OhneUebernahme(0)`; sonst `GET {basis_url}/api/lagemonitor/v1/lage` (mit `?karte=<etag>`, wenn bekannt), `Authorization: Bearer <token>`; `ParseError::VersionUnbekannt` → `Fehlschlag(VersionUnbekannt)`, `Ungueltig` → `AntwortUngueltig`; `photos_latest_ms` geändert → `GET …/photos` und Fotos ersetzen. Probelauf: nur Version prüfen, `OhneUebernahme(n Fluggeräte)`.
- `uebernehmen`: `repo::is_active(conn, adapter.id)` → `store.set_zugeschaltet`; wenn aktiv, `store.put(adapter.id, stand)`. Rückgabe `Ok(1)` bei geändertem Stand, sonst `Ok(0)`.

- [ ] **Step 1: Failing unit tests:** `url_der_lage_hängt_den_etag_an` (reine Funktion `lage_url(basis, etag) -> String`, Basis mit und ohne `/` am Ende), `nicht_zugeschaltet_ruft_nicht_ab` (Kontext ohne Netz; `abrufen` liefert `anzahl() == 0`, ohne Anfrage – über einen Store ohne Merker), `verzeichnis_enthält_suchlage`.
- [ ] **Step 2:** `cargo test drohne::art adapter::art` → FAIL.
- [ ] **Step 3:** Implementieren (der Netzweg ist über Loopback nicht testbar, `src/AGENTS.md` ~222; Logik in reine Funktionen ziehen).
- [ ] **Step 4:** Tests PASS; `cargo test --test adapter_admin` (Art erscheint in der Liste der Arten) PASS.
- [ ] **Step 5:** Commit `feat: Adapterart Suchlage (LLH-2105)`.

### Task 5: Routen der Zuschaltung

**Files:**
- Create: `src/routes/drohne.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs` (Routen), `src/einsatz/modul.rs` (`PFAD_KEY`: `("/api/incidents/{id}/drone", Some("lagekarte"))`, `("/api/incidents/{id}/map/drone", Some("lagekarte"))`), `scripts/api-routen-woerter.tsv` (`drone`, `sources`, sortiert), `src/api_doc.rs`, `openapi.json`, `frontend/src/api/types.generated.ts`
- Test: `tests/drohne_quellen.rs`

**Interfaces:**
- `GET /api/incidents/{id}/drone/sources` (`EinsatzLesezugriff<Lagekarte>`) → `Vec<DroneSourceView>`; `DroneSourceView { adapter_id, label, connected: bool, held_by_other: Option<String> /* Einsatzname oder "anderer Einsatz" */, lagemonitor: bool, state: String /* Adapterzustand */, mission_name: Option<String>, video_keys: Vec<String> }` (`ToSchema`).
- `PUT /api/incidents/{id}/drone/sources/{aid}` Body `DroneSourceUpdate { lagemonitor: bool }` (`fordere_einsatzleitung`, aktiv): falsche Org → 404; Art ohne Drohnenvertrag → 422; an anderem laufenden Einsatz → 409; sonst upsert + `etb::system_audit_tx` „Drohnenbild aus Suchlage zugeschaltet“ (nur beim ersten Zuschalten) + `store.set_zugeschaltet(aid, true)` nach dem Commit → 200 mit `DroneSourceView`.
- `DELETE /api/incidents/{id}/drone/sources/{aid}` (Einsatzleitung) → 204; ETB „… abgeschaltet“; `set_zugeschaltet(aid, false)`.
- Ob eine Art einen Drohnenvertrag hat: `art.code() == "suchlage"` über eine Funktion `drohne::is_drohnen_art(code) -> bool`.

- [ ] **Step 1: Failing tests `tests/drohne_quellen.rs`:** `einsatzleitung_schaltet_zu_und_ab`, `beobachter_darf_lesen_aber_nicht_zuschalten` (403), `zweiter_einsatz_bekommt_409`, `fremde_org_bekommt_404`, `adapter_anderer_art_ergibt_422`, `zuschalten_schreibt_ins_etb`, `abgeschlossener_einsatz_kann_nicht_zuschalten`. Adapter mit Art `suchlage` direkt per SQL anlegen.
- [ ] **Step 2:** `cargo test --test drohne_quellen` → FAIL.
- [ ] **Step 3:** Implementieren; `scripts/check-typ-codegen.sh` laufen lassen.
- [ ] **Step 4:** `cargo test --test drohne_quellen --test einsatz_kontext_guard`, `scripts/check-api-routen.sh` → PASS.
- [ ] **Step 5:** Commit `feat: Drohnenquelle je Einsatz zu- und abschalten (LLH-2105)`.

## LLH-2106 (xz4gvgil) – Fachebene „Drohne“

### Task 6: Kartenroute

**Files:**
- Modify: `src/routes/drohne.rs`, `src/routes/karte.rs` (`fachebene_antwort` `pub(crate)`), `src/app.rs`, `frontend/src/pages/lagekarte/AGENTS.md` (Regel: einsatzbezogene Ebenen nur über die Einsatzroute)
- Create: `src/drohne/karte.rs`
- Test: `tests/drohne_karte.rs`, Unit-Tests in `src/drohne/karte.rs`

**Interfaces:**
- Produces: `pub fn build_fachebene(lage: &DrohnenLage, fotos_ab_ms: i64) -> crate::karte::typen::FachebeneAntwort` – Features `kind: aircraft` (Punkt; `label`, `heading_deg`, `airborne`, `battery_percent`), `track`, `element` aus `lage.karte`, `photo` (Punkt; `key`, `taken_at_ms`, `lens`, `heading_deg`) nur mit `taken_at_ms >= fotos_ab_ms`; `abgerufen` = `stand_ms`; Status `leer` ohne Features.
- `GET /api/incidents/{id}/map/drone` (`EinsatzLesezugriff<Lagekarte>`): erste Zuschaltung des Einsatzes (nach `zugeschaltet_at`) mit Stand → `fachebene_antwort(build_fachebene(…, zugeschaltet_at_ms))`; ohne Zuschaltung, ohne Stand oder Einsatz nicht laufend → `FachebeneAntwort` mit Status `offline`.

- [ ] **Step 1: Failing tests:** Unit `fotos_vor_dem_zuschalten_fehlen`, `fluggerät_trägt_blickrichtung`, `ohne_features_ist_leer`; Integration `ohne_zuschaltung_offline`, `mit_stand_liefert_features_und_etag` (Stand direkt in `state.drohne` legen), `gleicher_stand_ergibt_304`, `andere_org_404`.
- [ ] **Step 2:** `cargo test --test drohne_karte drohne::karte` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: Fachebene Drohne über die Einsatzroute (LLH-2106)`.

### Task 7: Fachebene im Frontend und Zuschalten in der Leiste

**Files:**
- Modify: `frontend/src/api/fachebenen.ts` (Quelle `drohne` mit eigenem Lader `loadDrohneFachebene(einsatzId)` auf `/api/incidents/{id}/map/drone`), `frontend/src/pages/lagekarte/fachebenen.ts` (`FACHEBENEN.drohne`: `pollMs: 5000`, `veraltetNachMin: 1`), `frontend/src/api/queryKeys.ts` (Schlüssel mit Einsatz-ID), `frontend/src/pages/lagekarte/fachebenenLayer.ts` (Symbol Fluggerät mit Rotation nach `heading_deg`, `track` als Linie, `element` blass, `photo` als Bildpunkt), `frontend/src/theme/statusFarben.ts` (`FACHEBENE_TON.drohne`), `frontend/src/pages/lagekarte/leistenDaten.ts` (Gruppe „Drohne“), `frontend/src/pages/lagekarte/useFachebenen.ts`
- Create: `frontend/src/api/drohne.ts` (`useDrohnenQuellen(einsatzId)`, `useZuschalten`, `useAbschalten`), `frontend/src/pages/lagekarte/DrohnenQuelle.tsx` (Zeile in der Leiste: Zustand, Missionsname, „Suchlage zuschalten“/„Abschalten“ nur mit Recht der Einsatzleitung; 409 zeigt „Bereits an Einsatz … zugeschaltet“)
- Test: `frontend/src/pages/lagekarte/DrohnenQuelle.test.tsx`, `fachebenen.test.ts` (bestehende Wächter grün)

- [ ] **Step 1: Failing tests:** `DrohnenQuelle` zeigt „Suchlage zuschalten“ nur für die Einsatzleitung; zeigt Missionsname bei Zuschaltung; zeigt den 409-Hinweis; `fachebenen.test.ts`: Poll unter TTL-Wächter für `drohne`.
- [ ] **Step 2:** `pnpm -C frontend test DrohnenQuelle fachebenen` → FAIL.
- [ ] **Step 3:** Implementieren (Typen aus `types.generated.ts`).
- [ ] **Step 4:** Tests PASS; `pnpm -C frontend lint` und `tsc` PASS.
- [ ] **Step 5:** Commit `feat: Fachebene Drohne in der Lagekarte (LLH-2106)`.

## LLH-2107 (lkz50cn5) – Livebild

### Task 8: Live-Abruf außerhalb des Laufs

**Files:**
- Create: `src/adapter/live.rs`, `docs/architektur/entscheidungen/ADR-0098-adapter-rufen-fuer-ihre-eigenen-routen-auch-ausserhalb-des-laufs-ab.md` (Nummer nach `docs/architektur/AGENTS.md` prüfen; Nachtrag zu ADR-0077)
- Modify: `src/adapter/mod.rs`, `src/adapter/lauf.rs` (`prepare` für `live` wiederverwendbar machen), `src/AGENTS.md` („Backend — Adapter“: Live-Abruf; Satz „gelesen und entschlüsselt nur im Lauf“ anpassen)
- Test: `tests/adapter_live.rs`

**Interfaces:**
- Produces: `pub async fn live_kontext(pool: &SqlitePool, rahmen: &Rahmen, verzeichnis: &Verzeichnis, adapter_id: &str) -> Result<LiveKontext, LiveVerweigert>`; `LiveKontext` bietet `get(url) -> Result<RequestBuilder, Fehlschlag>`, `geheimnis(name)`, `einstellung_text(name)`, `read_bytes(resp, deckel) -> Result<Bytes, Fehlschlag>`; `pub enum LiveVerweigert { Unbekannt, Angehalten, BrauchtEingriff, SpeicherGesperrt, AmHub }`. Nichts wird zwischengespeichert; `LiveKontext` lebt nur für einen Abruf.

- [ ] **Step 1: Failing tests:** `angehaltener_adapter_verweigert`, `adapter_mit_eingriff_verweigert` (letzter Fehler `abgelehnt`), `org_am_hub_verweigert`, `gesperrter_speicher_verweigert`, `laufender_adapter_liefert_kontext_mit_geheimnis`.
- [ ] **Step 2:** `cargo test --test adapter_live` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** PASS; `scripts/check-adr*.sh` bzw. der ADR-Wächter aus `docs/architektur/AGENTS.md` PASS.
- [ ] **Step 5:** Commit `feat: Live-Abruf für Adapter außerhalb des Laufs (LLH-2107)`.

### Task 9: HLS-Bündelung und Video-Route

**Files:**
- Create: `src/drohne/video.rs`
- Modify: `src/routes/drohne.rs`, `src/app.rs`, `src/http_begrenzt.rs` (`DECKEL_VIDEO = 8 MiB`, `DECKEL_PLAYLIST = 256 KiB`), `scripts/api-routen-woerter.tsv` (`video`, `hls`), `src/AGENTS.md` (CSP-Notiz: `media-src 'self' blob:`, `worker-src 'self' blob:`)
- Test: Unit-Tests in `src/drohne/video.rs`, `tests/drohne_video.rs`

**Interfaces:**
- Produces: `pub struct Buendel` mit `pub async fn get_or_fetch<F, Fut>(&self, key: (String, String, String), ttl: Duration, fetch: F) -> Result<Bytes, VideoFehler>` (nach `karte::tile_cache::hole_gebuendelt`: `futures::Shared`, In-Flight-Map, TTL, Gesamtdeckel 64 MiB, älteste zuerst raus); `pub fn ttl_for(file: &str) -> Option<Duration>` (`.m3u8` 1 s, `.mp4`/`.m4s`/`.ts` 30 s, sonst `None`); `pub fn content_type_for(file: &str) -> Option<&'static str>`; `pub fn check_playlist(bytes: &[u8]) -> Result<(), VideoFehler>` (jede URI-Zeile relativ, ohne `..`, ohne Schema; sonst Fehler).
- `GET /api/incidents/{id}/drone/video/{key}/hls/{*file}` (`EinsatzLesezugriff<Lagekarte>`): Zuschaltung des Einsatzes Pflicht und `key` gehört zu ihrem Adapter, sonst 404; `file` nur `[A-Za-z0-9._-]+`, `ttl_for` bekannt, sonst 404; Query verworfen; Abruf über `live_kontext` → `{basis_url}/api/lagemonitor/v1/video/{gateway_sn}/hls/{file}`; `LiveVerweigert` → 503; Upstream-Fehler → 502; Antwort mit `content_type_for`, `nosniff`, `Cache-Control: private, no-cache` (Playlist) bzw. `private, max-age=30` (Segment), keine Upstream-Kopfzeilen.

- [ ] **Step 1: Failing tests:** Unit `zehn_gleichzeitige_anfragen_ein_abruf` (Zähl-Fetcher), `ttl_läuft_ab`, `deckel_wirft_älteste_raus`, `playlist_mit_absoluter_uri_wird_abgelehnt`, `playlist_mit_punktpunkt_wird_abgelehnt`, `content_type_nach_endung`; Integration `video_ohne_zuschaltung_404`, `fremder_key_404`, `datei_mit_schrägstrich_404`.
- [ ] **Step 2:** `cargo test drohne::video --test drohne_video` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** PASS; `scripts/check-api-routen.sh` PASS.
- [ ] **Step 5:** Commit `feat: Livebild der Drohne über einen bündelnden HLS-Proxy (LLH-2107)`.

### Task 10: Videofenster über der Karte

**Files:**
- Modify: `frontend/package.json` (`hls.js` exakt gepinnt, aktuelle stabile 1.x), `frontend/src/pages/LagekartePage.tsx` (Fenster in der Kartenspalte einhängen), `frontend/src/pages/lagekarte/DrohnenQuelle.tsx` (Knopf „Livebild“ bei `video_keys.length > 0`)
- Create: `frontend/src/pages/lagekarte/DrohnenVideoFenster.tsx`, `frontend/src/pages/lagekarte/DrohnenVideoFenster.test.tsx`
- Vorher: UI-Entwurf nach `frontend/AGENTS.md`, „Größere UI-Entwürfe“ (neuer Baustein) – **diesen Schritt erledigt der Main-Loop**, bevor ein Agent Task 10 bekommt; Ergebnis unter `docs/design/2026-11-24-drohnen-videofenster/`.

**Interfaces:**
- Consumes: `DroneSourceView.video_keys` (Task 5), Route aus Task 9.
- Produces: `<DrohnenVideoFenster einsatzId videoKey onClose />`: `hls.js` dynamisch importiert (`lowLatencyMode: false`), Safari über `canPlayType('application/vnd.apple.mpegurl')` nativ; stumm, Autoplay; Zustände „lädt“, „läuft“, „Kein Livebild“ (Player-Fehler `fatal` oder `video_keys` leer); neuer Versuch, wenn der Key wieder erscheint; schließbar; keine neue feste Breite in der Kartenspalte.

- [ ] **Step 1: Failing tests (`hls.js` gemockt):** zeigt „Kein Livebild“ bei fatalem Fehler; schließt über den Knopf; startet neu bei neuem Key; nutzt die Route `/api/incidents/{id}/drone/video/{key}/hls/index.m3u8`.
- [ ] **Step 2:** `pnpm -C frontend test DrohnenVideoFenster` → FAIL.
- [ ] **Step 3:** Implementieren nach dem Entwurf.
- [ ] **Step 4:** PASS; Lint, `tsc`, `leistenAbstand.guard.test.ts` PASS.
- [ ] **Step 5:** Commit `feat: Videofenster für das Livebild der Drohne (LLH-2107)`.

## LLH-2108 (k6v3espq) – Fotos

### Task 11: Foto-Vorschau über Proxy

**Files:**
- Modify: `src/routes/drohne.rs`, `src/drohne/video.rs` oder neu `src/drohne/foto.rs` (Cache 5 min, Deckel 32 MiB, gleiche `Buendel`-Mechanik), `src/app.rs`, `scripts/api-routen-woerter.tsv` (`photos`, `thumb`), `src/AGENTS.md` („Anhänge“: fremde, nicht gespeicherte Bilder bereinigt mit `ANHANG_CSP`, nicht über `anhang_antwort`)
- Test: `tests/drohne_foto.rs`

**Interfaces:**
- `GET /api/incidents/{id}/drone/photos/{key}/thumb` (`EinsatzLesezugriff<Lagekarte>`): Zuschaltung Pflicht, `key` gehört zum Adapter, Foto `taken_at_ms >= zugeschaltet_at`, sonst 404; Abruf `{basis_url}{thumb_url}` über `live_kontext` (Deckel 2 MiB); `anhang::metadaten::bereinigen(bytes, "image/jpeg")` → bei Fehler 422; Antwort `Content-Type: image/jpeg`, `Content-Disposition: inline`, `Content-Security-Policy: ANHANG_CSP`, `nosniff`, `Cache-Control: private, max-age=300`.
- Reine Funktion `pub fn clean_thumb(bytes: &[u8]) -> Result<Vec<u8>, AppError>`.

- [ ] **Step 1: Failing tests:** `clean_thumb_entfernt_gps_exif` (synthetisches JPEG mit GPS-IFD); `foto_vor_dem_zuschalten_404`; `foto_ohne_zuschaltung_404`; `fremder_key_404`.
- [ ] **Step 2:** `cargo test --test drohne_foto` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: Vorschau der Drohnenfotos über den Proxy (LLH-2108)`.

### Task 12: Foto-Popup

**Files:**
- Modify: `frontend/src/pages/lagekarte/FachebenenInspector.tsx` (Fall `kind === "photo"` der Quelle `drohne`: Bild nach Muster `WebcamStandbild`, `src` = Route aus Task 11, Linse, Aufnahmezeit, Blickrichtung; „Vorschau nicht abrufbar“ bei Fehler)
- Test: `frontend/src/pages/lagekarte/FachebenenInspector.test.tsx`

- [ ] **Step 1: Failing tests:** Foto-Feature zeigt Bild mit der Einsatzroute und Linse „Wärmebild“; Fehlerfall zeigt „Vorschau nicht abrufbar“.
- [ ] **Step 2:** `pnpm -C frontend test FachebenenInspector` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: Drohnenfotos im Inspector der Lagekarte (LLH-2108)`.

## Abschluss

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [ ] Anwenderdoku (`docs/anwender/`): Abschnitt „Drohnenbild aus Suchlage“ im Lagekarten-Kapitel nach `docs/anwender/AGENTS.md`; Bilder nach Mitänderungsregel.
- [ ] Bilder der Änderung (Leiste, Fachebene, Videofenster, Foto-Popup) nach `dev-zunder-ausfuehren`, „Bilder der Änderung“.
