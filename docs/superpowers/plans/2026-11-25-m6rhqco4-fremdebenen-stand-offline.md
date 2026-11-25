# Fremdebenen in gesicherten Ständen und im Offline-Budget — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** „Stand sichern“ friert Fremdebenen samt Inhalt (inhaltsadressiert) ein, der Rückblick zeichnet sie; ohne Netz liegen höchstens 16 MiB Fremdebenen-Daten je Einsatz auf der Platte.

**Architecture:** Neue Tabelle `karte_fremdebene_stand` (eine Zeile je Einsatz und sha256), befüllt beim Anlegen eines Stands in derselben Transaktion; `daten.fremdebenen` im Stand nennt Angaben und Hash. Neue Leseroute über den Hash. Frontend liest im Rückblick Liste aus dem Dokument und Daten über die neue Route; der Lagebild-Persister filtert `fremdebeneDaten` gegen ein Budget.

**Tech Stack:** Rust (axum, sqlx/SQLite), React + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-m6rhqco4-fremdebenen-stand-offline-design.md`

## Global Constraints

- Neue Migration mit Nummer größer als jede auf `origin/alpha` (heute 0381 → **0382**), vorher `git fetch origin alpha` und `scripts/check-migrationen.sh`.
- Routen englisch (ADR-0097): `/api/incidents/{id}/situation-snapshots/{sid}/foreign-layers/{sha256}/data`.
- Neue Wire-Felder englisch: `fremdebenen[]` mit `id`, `name`, `color`, `source`, `url_host`, `fetched_at`, `feature_count`, `dropped_count`, `sha256`; `FremdebeneAnzeige.data_size`.
- Nie `url` in einem Stand. Prosa, Kommentare, Testnamen deutsch.
- Budget: `FREMDEBENEN_OFFLINE_BUDGET = 16 * 1024 * 1024` Bytes.
- Nach DTO-Änderung `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten.
- Vor dem PR `./scripts/check-all.sh --geaendert --ohne-e2e`.

**Abweichung vom Entwurf (beim Planen gefunden):** Der Nachlauf der Schwärzung (`schwaerzung_nachlauf::zur_entfernung_vorgesehen_sql`) erfasst „ganzer Einsatz geschwärzt“ **oder** Kategorie `anhaenge`. Die Stand-Tabelle bekommt deshalb `Z_ANHAENGE` (wie die Bilder der Lagekarte), nicht `Z_EINSATZ`. Folge: schwärzt jemand nur die Anhänge, fallen die eingefrorenen Inhalte, der Stand bleibt; die Stand-Route antwortet 404, der Rückblick zeigt die Ebene als „nicht mehr vorhanden“. Die Tabelle braucht dafür `id INTEGER PRIMARY KEY`.

## Review Focus

1. Stand von einer Ebene, deren Inhalt danach neu abgerufen wird — Rückblick zeigt den alten Inhalt (Task 2, Test `alter_stand_behaelt_alten_inhalt`).
2. Zwei Stände teilen einen Hash, einer wird gelöscht — Inhalt bleibt für den anderen (Task 2, `loeschen_raeumt_nur_unverwiesene`).
3. Geratener Hash eines anderen Einsatzes oder Stands — 404, kein Inhalt (Task 3, `fremder_hash_ist_404`).
4. Älterer Stand ohne Feld `fremdebenen` — Rückblick ohne Fremdebenen, kein Fehler (Task 5, `aelterer_stand_ohne_feld`).
5. Liste ohne `data_size` (Vorrat vom alten Server) — Ebene zählt mit 8 MiB, nichts wirft (Task 6, `ohne_groesse_zaehlt_hoechstwert`).

---

### Task 1: Tabelle `karte_fremdebene_stand` mit Spiegel und Schwärzung

**Files:**
- Create: `migrations/0382_karte_fremdebene_stand.sql`
- Modify: `src/instanz/spiegel/art.rs` (`GESPIEGELT`, Gruppe `K::Anhaenge` neben `karte_fremdebene_daten`)
- Modify: `src/einsatz/schwaerzung_registry.rs` (neue `TabellenRegel` nach `karte_fremdebene_daten`)
- Modify: `src/einsatz/schwaerzung_nachlauf.rs` (`EINZELN_GELOESCHT` += `"karte_fremdebene_stand"`)

**Interfaces:**
- Produces: Tabelle `karte_fremdebene_stand(id INTEGER PRIMARY KEY, einsatz_id INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE, sha256 TEXT NOT NULL, geojson BLOB NOT NULL, objekte INTEGER NOT NULL, verworfen INTEGER NOT NULL, UNIQUE (einsatz_id, sha256))`.

- [ ] **Step 1:** Migration mit Tabelle schreiben; danach die Spiegel-Trigger erzeugen: `SPIEGEL_SQL=<tmp> cargo test erzeuge_migration -- --ignored` (Aufruf wie im Test `spiegel::art::tests::erzeuge_migration`), den Teil für `karte_fremdebene_stand` an die Migration anhängen, Kopf-Kommentar wie 0378.
- [ ] **Step 2:** Registry-Regel: alle sechs Spalten `scrub(…, Strategie::ZeileEinzelnLoeschen, Z_ANHAENGE)`, `Scoping::EinsatzId`, Kommentar mit Grund (Abweichung oben). `EINZELN_GELOESCHT` ergänzen.
- [ ] **Step 3:** Wächter laufen lassen: `cargo test --lib spiegel::art schwaerzung_registry schwaerzung_nachlauf db::tests` → grün (u. a. `jede_gespiegelte_tabelle_hat_einen_primaerschluessel`, Registry-Vollständigkeit, Trigger-Vergleich).
- [ ] **Step 4:** Test in `schwaerzung_nachlauf::tests`: `stand_inhalt_faellt_im_nachlauf_mit_kategorie_anhaenge` — Zeile anlegen, Einsatz abschließen, Kategorie `anhaenge` geschwärzt, `entferne_vorgesehene` → 1 gelöscht. Erst rot (ohne Eintrag in `EINZELN_GELOESCHT`), dann grün.
- [ ] **Step 5:** Commit `feat: Tabelle für eingefrorene Fremdebenen-Inhalte (LLH-2130)`.

### Task 2: Stand friert Fremdebenen ein, Löschen räumt

**Files:**
- Create: `src/lage_snapshot/fremdebene.rs`
- Modify: `src/lage_snapshot/mod.rs` (`pub mod fremdebene;`)
- Modify: `src/lage_snapshot/repo.rs` (`SnapshotDaten.fremdebenen`, `erzeuge`, `insert_roh`, `loesche`)

**Interfaces:**
- Produces in `lage_snapshot::fremdebene`:
  - `#[derive(Serialize, Deserialize, ToSchema)] pub struct FremdebeneImStand { id: i64, name: String, color: String, source: FremdebeneQuelle, url_host: Option<String>, fetched_at: Option<String>, feature_count: i64, dropped_count: i64, sha256: String }` (Optionale mit `skip_serializing_if`).
  - `pub async fn sichern(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<Vec<FremdebeneImStand>, AppError>` — nur Ebenen mit Daten; `INSERT OR IGNORE INTO karte_fremdebene_stand (einsatz_id, sha256, geojson, objekte, verworfen) SELECT …`; `url_host` wie `FremdebeneAnzeige` (Hilfsfunktion aus `karte_fremdebene` wiederverwenden). Übergeht Daten, die am Spiegel noch fehlen (`spiegel_anhang` offen) nicht gesondert — sie kopieren den Platzhalter nicht: nur Zeilen mit `length(geojson) > 0`.
  - `pub async fn raeumen(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<u64, AppError>` — löscht Zeilen des Einsatzes, deren `sha256` in keinem `json_each(lage_snapshot.daten, '$.fremdebenen')` des Einsatzes steht.
  - `pub async fn laden(pool: &SqlitePool, einsatz_id: i64, snapshot_id: i64, sha256: &str) -> Result<Option<String>, AppError>` — `None`, wenn der Stand den Hash nicht nennt oder keine Zeile da ist; übergeht vorgesehene Zeilen (`zur_entfernung_vorgesehen_sql("s")`); vorher `spiegel::anhang::pruefe_vorhanden(pool, "karte_fremdebene_stand", &id.to_string())`.
- `insert_roh` nimmt `conn: &mut SqliteConnection` statt `&SqlitePool` (alle Aufrufer anpassen).
- `SnapshotDaten.fremdebenen: Vec<FremdebeneImStand>` mit `#[serde(default)]`.

- [ ] **Step 1: Tests in `fremdebene.rs` schreiben** (Testhilfe wie `karte_fremdebene::repo::tests`):
  - `stand_friert_ebenen_mit_hash_ohne_url_ein` — URL-Ebene mit Daten + Datei-Ebene ohne Daten; `erzeuge` → `daten.fremdebenen.len() == 1`, `sha256` gesetzt, Dokument-Text enthält die URL nicht.
  - `zweiter_stand_ohne_aenderung_legt_keine_zeile_an` — zwei Stände → `COUNT(*) == 1`.
  - `alter_stand_behaelt_alten_inhalt` — Stand, `ersetze_daten` mit neuem Inhalt, `laden(alter_stand, alter_hash)` == alter Inhalt.
  - `ebene_loeschen_laesst_stand_lesbar` — `karte_fremdebene::repo::loeschen`, `laden` liefert weiter.
  - `loeschen_raeumt_nur_unverwiesene` — Stand A, Daten ändern, Stand B (zwei Hashes, einer geteilt? nein: A hat h1, B hat h2, Stand C ohne Änderung nach B hat h2); `loesche(A)` → h1 weg; `loesche(B)` → h2 bleibt (C).
  - `laden_kennt_nur_hashes_des_stands` — Hash aus Stand B über Stand A → `None`.
- [ ] **Step 2:** `cargo test --lib lage_snapshot::fremdebene` → rot (Kompilierfehler/fehlende Funktionen).
- [ ] **Step 3:** Implementieren. `erzeuge`: Lesen wie bisher über den Pool, dann `write_retry!`-Transaktion (Muster im Repo) mit `sichern` → in `daten` einsetzen → `insert_roh`. `loesche`: Transaktion `DELETE` + `raeumen`.
- [ ] **Step 4:** `cargo test --lib lage_snapshot purge_scheduler` → grün (Purge-Test nutzt `erzeuge`).
- [ ] **Step 5:** Commit `feat: Stand sichern friert Fremdebenen ein (LLH-2130)`.

### Task 3: Leseroute und `data_size`

**Files:**
- Modify: `src/routes/lage_snapshot.rs` (Handler `fremdebene_daten`)
- Modify: `src/app.rs` (Route neben `/api/incidents/{id}/situation-snapshots/{sid}`, `route_layer(download_grenze())`)
- Modify: `src/api_doc.rs`
- Modify: `src/karte_fremdebene/mod.rs` (`FremdebeneAnzeige.data_size: Option<i64>`), `src/karte_fremdebene/repo.rs` (Liste liest `length(d.geojson)`, nie den Inhalt)
- Modify: `frontend/src/api/types.generated.ts`, `frontend/src/api/openapi.json` (Codegen)
- Test: Routen-Test neben den bestehenden Snapshot-Routen-Tests (`grep -rn "situation-snapshots" tests src --include=*.rs` zeigt den Ort)

**Interfaces:**
- Consumes: `lage_snapshot::fremdebene::laden`.
- Produces: `GET …/situation-snapshots/{sid}/foreign-layers/{sha256}/data` → 200 `application/geo+json`, `ETag` = `etag_von(sha)` (aus `routes::karte_fremdebene` wiederverwenden, ggf. `pub(crate)`), `If-None-Match` → 304, sonst 404. `Cache-Control: private, max-age=31536000, immutable`.

- [ ] **Step 1: Tests:** `stand_route_liefert_eingefrorenen_inhalt` (200, Body == Inhalt, ETag), `stand_route_304_bei_passendem_etag`, `fremder_hash_ist_404` (Hash eines anderen Stands und eines anderen Einsatzes), `stand_route_braucht_leserecht_lagekarte` (ohne Modulrecht 403 wie das GET des Stands); `liste_traegt_data_size` im Repo-Test von `karte_fremdebene`.
- [ ] **Step 2:** rot laufen lassen.
- [ ] **Step 3:** Handler mit `EinsatzLesezugriff<Lagekarte>`, `PfadParam<(i64, i64, String)>`; Hash vor der Abfrage auf 64 Hex-Zeichen prüfen (sonst 404).
- [ ] **Step 4:** Tests grün; `scripts/check-typ-codegen.sh`, `scripts/check-api-routen.sh` grün.
- [ ] **Step 5:** Commit `feat: Route für eingefrorene Fremdebenen und Größe in der Liste (LLH-2130)`.

### Task 4: Spiegel schreibt `fremdebenen[].id` um

**Files:**
- Modify: `src/instanz/spiegel/uebernehmen.rs` (`snapshot_bilder` → bildet zusätzlich `fremdebenen[].id` über `ziel_lokal(conn, einsatz_id, "karte_fremdebene", …)` ab; Name bleibt, Doc-Kommentar ergänzen)

- [ ] **Step 1: Test** neben dem bestehenden Test für `bilder[].id`: `stand_bildet_fremdebenen_ids_ab` — bekannte Ebene → lokale ID, unbekannte → `null`, `sha256` unverändert.
- [ ] **Step 2:** rot, **Step 3:** umsetzen, **Step 4:** `cargo test --lib instanz::spiegel` grün.
- [ ] **Step 5:** Commit `feat: Spiegel bildet Fremdebenen im Stand ab (LLH-2130)`.

### Task 5: Rückblick zeichnet Fremdebenen

**Files:**
- Modify: `frontend/src/api/fremdebenen.ts` (`ladeStandFremdebeneDaten(einsatzId, snapshotId, sha256)`)
- Modify: `frontend/src/api/queryKeys.ts` (`EINSATZ_KEYS.lageSnapshotFremdebeneDaten = 'einsatz-lage-snapshot-fremdebene-daten'`, Factory `lageSnapshotFremdebeneDaten(einsatzId, snapshotId, sha256)`, Modul-Zuordnung `lage_snapshot`, in der Guard-Liste ausdrücklich draußen wie `lageSnapshotDokument`)
- Modify: `frontend/src/pages/lagekarte/snapshotDaten.ts` (`SnapshotDaten.fremdebenen?: FremdebeneImStand[]`)
- Modify: `frontend/src/pages/lagekarte/useFremdebenen.ts` (Option `quelle: Standquelle` statt `aktiv`)
- Modify: `frontend/src/pages/LagekartePage.tsx:793`, Baumzeile (`FremdebenenZeilen.tsx`: im Stand keine Bearbeitung, kein Fehler-Neuladen, Alter aus `fetched_at` relativ zu `stand_at`)
- Test: `frontend/src/pages/lagekarte/useFremdebenen.test.tsx` (neu oder bestehend)

**Interfaces:**
- `useFremdebenen(einsatzId, { quelle })` liefert im Stand: `ebenen` aus `daten.fremdebenen` (als `Fremdebene`-Form mit `id ?? negativer Platzhalter`), `aktive` über die Stand-Route, `umbenennen/setzeFarbe/entfernen` als No-op, `datenZustand` 404 → `{ art: 'fehler' }` mit Text „Inhalt nicht mehr vorhanden“. Eine Ebene mit `id: null` ist immer sichtbar (nicht in `toggle`).

- [ ] **Step 1: Tests:** `rueckblick_zeichnet_eingefrorene_ebene` (MSW: Dokument mit einer Ebene, Stand-Route liefert FC → `aktive.length == 1`, Farbe der Ebene), `aelterer_stand_ohne_feld` (Dokument ohne `fremdebenen` → `ebenen == []`), `rueckblick_ruft_live_routen_nicht` (kein Request auf `/map/foreign-layers`), `ebene_ohne_id_ist_immer_sichtbar`.
- [ ] **Step 2:** rot. **Step 3:** umsetzen. **Step 4:** `mise exec -- pnpm -C frontend vitest run src/pages/lagekarte src/offline/lagebildOffline.guard.test.ts` grün, `pnpm -C frontend lint` und `tsc` grün.
- [ ] **Step 5:** Commit `feat: Rückblick zeigt Fremdebenen aus dem Stand (LLH-2130)`.

### Task 6: Offline-Budget

**Files:**
- Create: `frontend/src/offline/fremdebenenBudget.ts`, `frontend/src/offline/fremdebenenBudget.test.ts`
- Modify: `frontend/src/offline/lagebildSitzung.ts` (`erzeuge` auf die zusammengeführte Liste; `zulaessigeEintraege` am Ende)
- Modify: `frontend/src/offline/AGENTS.md` (Absatz „Fremdebenen nur im Budget“ im Abschnitt Lagebild ohne Netz), `frontend/src/api/queryKeys.ts:1662` (Kommentar)

**Interfaces:**
- `export const FREMDEBENEN_OFFLINE_BUDGET = 16 * 1024 * 1024;`
- `export function fremdebenenImBudget<E extends { queryKey: readonly unknown[] }& { state: { data?: unknown } }>(eintraege: E[], budget = FREMDEBENEN_OFFLINE_BUDGET): E[]` — je Einsatz: Daten-Einträge `[fremdebeneDaten, einsatzId, ebeneId]` nach `data_size` aus dem Listen-Eintrag `[fremdebenen, einsatzId]` aufsteigend, Gleichstand `created_at` absteigend, aufnehmen solange Summe ≤ budget; fehlt `data_size` → `FREMDEBENE_GRENZEN`-Höchstwert (8 MiB); fehlt die Liste oder die Ebene darin → Eintrag fällt. Alle übrigen Einträge unverändert, Reihenfolge erhalten.

- [ ] **Step 1: Tests:** `alles_unter_budget_bleibt`, `kleinste_zuerst_bis_budget` (Größen 10, 7, 2 MiB → 2 und 7 bleiben), `gleichstand_neuere_zuerst`, `ohne_groesse_zaehlt_hoechstwert`, `ohne_liste_fallen_daten`, `andere_eintraege_unberuehrt`, `je_einsatz_eigenes_budget`; in `lagebildSitzung.test.ts`: `speicherung_laesst_daten_ueber_budget_draussen`.
- [ ] **Step 2:** rot. **Step 3:** umsetzen und an beiden Stellen anwenden. **Step 4:** `vitest run src/offline` grün.
- [ ] **Step 5:** Commit `feat: Fremdebenen ohne Netz nur im Budget von 16 MiB (LLH-2130)`.

### Task 7: Abschluss

- [ ] `scripts/adr-fuer.sh` über die geänderten Pfade; betroffene ADR-Regeln prüfen. Anwenderdoku nach `docs/anwender/AGENTS.md` (Mitänderungsregel) prüfen und ggf. Kapitel der Lagekarte ergänzen; `frontend/src/pages/lagekarte/AGENTS.md`, falls dort Regeln zu Fremdebenen im Stand stehen.
- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [ ] `/verify` für die Lagekarte im Rückblick (Bild der Änderung).
- [ ] Plan abhaken, Commit, Push, PR gegen `alpha`.
