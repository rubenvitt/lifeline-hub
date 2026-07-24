# Lage-Snapshot (LFH-321, Inkrement C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lage_snapshot` — ein manuell ausgelöster, unveränderlicher Stand des vollen Lagebilds (Geometrie + Fachdaten) eines Einsatzes, plus ein Historien-(Read-only-)Modus auf der Lagekarte.

**Architecture:** Neue einsatz-scoped Tabelle `lage_snapshot` mit einem JSON-Dokument (`daten`, `schema_version=1`). Serverseitiger Capture ruft die bestehenden `repo::liste`-Funktionen der ~11 Lagekarte-Quellen **direkt über `&SqlitePool`** (Pool-Reuse, kein Repo-Refactor) auf und friert die **rohen `*Anzeige`-DTOs** ein — Replay füttert sie durch die unveränderten FE-Ableiter (`baueMarker` etc.). Vertragsanbindung (`LiveEvent::LageSnapshot`, DTO, Codegen, queryKeys) spiegelt Inkrement A (LFH-319) verbatim. DSGVO: ganze Zeile löschen.

**Tech Stack:** Rust/axum/sqlx-sqlite (Backend), utoipa (OpenAPI), React/antd/TanStack-Query (Frontend), Vitest/Playwright (Tests).

## Global Constraints

- **Extractor-Vertrag:** Request-Bodies **nur** über `crate::extract::JsonBody`, Route-Sub-IDs **nur** über `crate::extract::PfadParam` — nie `axum::Json`/`axum::extract::Path`. `einsatz_id` kommt über den `EinsatzKontext`-Extractor (→ 404 bei Fremdeinsatz). (`tests/json_extractor_guard.rs`, `tests/path_extractor_guard.rs`)
- **Statuscodes** (`src/error.rs`): unbekannter Enum-Wert / leeres Pflichtfeld → 400 (`AppError::Validation`); Zustands-/Kombinationsfehler → 422; Fremdeinsatz → 404 über `EinsatzKontext`.
- **Typ-Codegen (LFH-120):** neue Response-DTOs tragen `#[derive(ToSchema)]` + Eintrag in `src/api_doc.rs`; nach Backend-Typänderung `scripts/check-typ-codegen.sh` laufen lassen und `frontend/src/api/openapi.json` + `types.generated.ts` **mitcommitten**. `Option<T>`-Felder von Response-DTOs: `#[serde(skip_serializing_if = "Option::is_none")]`.
- **Enum-Wire-Kontrakt:** jede neue `LiveEvent`-Variante wird in `tests/enum_wire_kontrakt.rs` gepinnt (exhaustiver `match` → fehlender Eintrag bricht den Build).
- **Query-Keys (LFH-307):** kein Inline-String-Array als Query-Key; alles über `frontend/src/api/queryKeys.ts`. Der `EINSATZ_STREAM_EVENTS`-Objekt-Key muss **byte-genau** dem `LiveEvent::as_str`-Wire-String entsprechen.
- **DSGVO (LFH-135):** jede neue einsatz-scoped Tabelle wird von `schwaerzung_registry.rs` auto-entdeckt; fehlende Klassifikation bricht `cargo test`.
- **Gates:** `./scripts/check-all.sh` vor Merge; kein `| tail` um Gate-Kommandos (maskiert Exit-Code). Rust-Vollnachweis nur mit `cargo test --workspace`.
- **Commit-Referenz:** jeder Commit referenziert `LFH-321` im Body/Subject.
- **Speicherform-Entscheidung (fix):** rohe DTO-Listen · DSGVO = ganze Zeile löschen · Pool-Reuse sequenziell (User-Checkpoint 2026-07-24).

---

## File Structure

- `migrations/0097_lage_snapshot.sql` — Tabelle + Index (neu)
- `src/lage_snapshot/mod.rs` — DTOs (`LageSnapshotAnzeige`, `LageSnapshotDokument`, `SnapshotDaten` + Request-DTOs), Modul-Re-Exports (neu)
- `src/lage_snapshot/repo.rs` — CRUD + Capture `erzeuge` (neu)
- `src/routes/lage_snapshot.rs` — HTTP-Handler + SSE-Emit (neu)
- `src/live/mod.rs` — `LiveEvent::LageSnapshot` (modifizieren)
- `src/einsatz/modul.rs` — PFAD_KEY-Eintrag (modifizieren)
- `src/einsatz/schwaerzung_registry.rs` — `lage_snapshot`-Klassifikation (modifizieren)
- `src/api_doc.rs` — DTO-Registrierung (modifizieren)
- `src/lib.rs`, `src/app.rs` (Router) — Modul-/Route-Registrierung (modifizieren)
- `tests/enum_wire_kontrakt.rs` — Wire-Pin (modifizieren)
- `tests/lage_snapshot.rs` — Integrationstests (neu)
- `frontend/src/api/lageSnapshot.ts` — API-Client (neu)
- `frontend/src/api/queryKeys.ts`, `types.ts`, `openapi.json`, `types.generated.ts` — Vertrag/Codegen (modifizieren)
- `frontend/src/pages/lagekarte/useLagekarteDaten.ts`, `useKartenbilder.ts` — Standquelle (modifizieren)
- `frontend/src/pages/lagekarte/Sidebar.tsx`, `LagekartePage.tsx` — Snapshot-Liste, Banner, `?snapshot=` (modifizieren)
- `frontend/src/routing/deeplinks.ts` — `?snapshot=`-Builder (modifizieren)

---

## Task 1: Migration 0097 + Tabelle + Repo-CRUD (Metadaten) + DTOs

**Files:**
- Create: `migrations/0097_lage_snapshot.sql`
- Create: `src/lage_snapshot/mod.rs`, `src/lage_snapshot/repo.rs`
- Modify: `src/lib.rs` (Modul-Deklaration `pub mod lage_snapshot;`)
- Test: `tests/lage_snapshot.rs`

**Interfaces:**
- Produces:
  - `struct LageSnapshotAnzeige { id: i64, bezeichnung: Option<String>, notiz: Option<String>, stand_at: String, schema_version: i64, erstellt_von: i64, erstellt_at: String }` — **ohne `daten`** (Liste)
  - `struct LageSnapshotDokument { id, bezeichnung, notiz, stand_at, schema_version, erstellt_von, erstellt_at, daten: serde_json::Value }` — Volldokument (Einzel-GET)
  - `repo::liste_metadaten(pool, einsatz_id) -> Vec<LageSnapshotAnzeige>`
  - `repo::lade_dokument(pool, einsatz_id, id) -> Option<LageSnapshotDokument>`
  - `repo::patche_meta(pool, einsatz_id, id, bezeichnung: Option<&str>, notiz: Option<&str>) -> bool`
  - `repo::loesche(pool, einsatz_id, id) -> bool`
  - `repo::insert_roh(pool, einsatz_id, benutzer_id, bezeichnung, notiz, stand_at, daten: &serde_json::Value) -> i64` (Test-/Capture-Helfer)

- [ ] **Step 1: Migration schreiben** — `migrations/0097_lage_snapshot.sql`:

```sql
CREATE TABLE lage_snapshot (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung    TEXT,
    notiz          TEXT,
    stand_at       TEXT    NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    daten          TEXT    NOT NULL,
    erstellt_von   INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lage_snapshot_einsatz ON lage_snapshot(einsatz_id, stand_at);
```

- [ ] **Step 2: DTOs + Modul** — `src/lage_snapshot/mod.rs`: `pub mod repo;`, die zwei Anzeige-Structs (`#[derive(Debug, Serialize, ToSchema)]`, `Option`-Felder mit `#[serde(skip_serializing_if = "Option::is_none")]`). `src/lib.rs`: `pub mod lage_snapshot;` in alphabetischer Nachbarschaft zu `pub mod lage_zone;`.

- [ ] **Step 3: Repo-CRUD** — `src/lage_snapshot/repo.rs`: die fünf Funktionen oben. `liste_metadaten` selektiert **nicht** `daten` (SELECT ohne `daten`-Spalte). `patche_meta` als Tri-State-freies Update nur der zwei Felder (siehe Task 3 für die Request-Semantik). Alle `einsatz_id`-gescopt im WHERE (Org-Isolation).

- [ ] **Step 4: Failing test** — `tests/lage_snapshot.rs` (Setup analog `tests/karten_ansicht.rs`):

```rust
#[tokio::test]
async fn liste_liefert_metadaten_ohne_daten_einzel_liefert_dokument() {
    let (pool, einsatz_id, benutzer_id) = setup().await;
    let daten = serde_json::json!({"version":1,"marker":[{"typ":"uhs","id":1}]});
    let id = repo::insert_roh(&pool, einsatz_id, benutzer_id, Some("08:00"), None,
        "2026-07-24T08:00:00Z", &daten).await;

    let liste = repo::liste_metadaten(&pool, einsatz_id).await;
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0].bezeichnung.as_deref(), Some("08:00"));
    // Metadaten-DTO trägt kein daten-Feld (Compile-Beweis + Serde: Feld existiert nicht)
    let v = serde_json::to_value(&liste[0]).unwrap();
    assert!(!v.as_object().unwrap().contains_key("daten"));

    let dok = repo::lade_dokument(&pool, einsatz_id, id).await.unwrap();
    assert_eq!(dok.daten, daten);
}
```

- [ ] **Step 5: Run → PASS.** `cargo test --test lage_snapshot liste_liefert_metadaten -- --nocapture`
- [ ] **Step 6: Commit** — `feat(lfh-321): lage_snapshot-Tabelle + Metadaten/Dokument-Repo`

---

## Task 2: Capture `erzeuge` — volles Lagebild einfrieren (Pool-Reuse)

**Files:**
- Modify: `src/lage_snapshot/repo.rs` (`erzeuge`), `src/lage_snapshot/mod.rs` (`SnapshotDaten`)
- Test: `tests/lage_snapshot.rs`

**Interfaces:**
- Produces: `repo::erzeuge(pool, einsatz_id, benutzer_id, bezeichnung: Option<&str>, notiz: Option<&str>) -> Result<LageSnapshotDokument, AppError>`
- Consumes (bestehend, alle `(pool: &SqlitePool, einsatz_id, ...)`): `uhs::repo::liste`, `schaden::repo::liste`, `einheit::repo::liste`, `fahrzeug::disposition_repo::liste`, `personal::disposition_repo::liste_fuehrungskraefte`, `einsatzabschnitt::repo::liste`, `lage_zone::repo::liste`, `freies_zeichen::repo::liste`, `meldung::repo::liste_lage_meldungen`, `gefahr::repo::gebiete_liste`, `karten_ansicht::repo::liste`, `karte_hintergrundbild::repo::liste` (Metadaten, **kein BLOB**), Einsatz-Laden (`einsatz::repo::laden`) und der Organisation-Loader (globaler TZ-Org-Default — exakte Fn bei Impl lokalisieren).

**Gotchas (aus Scope-Map, verbindlich):**
- Fahrzeuge aus `fahrzeug/disposition_repo.rs::liste` (einsatz-scoped), **nicht** `fahrzeug/repo.rs` (org-weit). Führungskräfte aus `personal/disposition_repo.rs::liste_fuehrungskraefte` (nur EL/AL).
- **Global-Scope-Inputs mit einfrieren:** `organisation.tz_organisation` (TZ-Fallback) + `gefahrengebiet.hoechste_warnstufe` (Zonen-Färbung) — sonst ändert eine spätere Org-Umbenennung/Warnstufen-Neubewertung einen alten Stand.
- Pool-Reuse: sequenzielle `.await`-Aufrufe über `pool`. Keine Repo-Signatur-Änderung.
- **Bekannte Grenze (bewusst):** jede `liste` checkt eine **andere** Pool-Connection aus → **keine** echte Read-Isolation; ein Schreibvorgang mitten im Capture kann ein torn read erzeugen. Für einen manuell ausgelösten v1-Stand akzeptiert (SQLite serialisiert Writes, Fenster winzig). Echte „eine Transaktion" bräuchte den abgelehnten Repo-`impl Executor`-Refactor — nicht in v1.

- [ ] **Step 1: `SnapshotDaten`-Struct** (`Serialize`) mit Feldern: `version: u32` (=1), `stand_at: String`, `einsatz` (Meta für einsatzort-Marker), `ansichten: Vec<KartenAnsichtAnzeige>`, `uhs`, `schaeden`, `einheiten`, `fahrzeuge`, `fuehrungskraefte`, `abschnitte`, `zonen`, `freie_zeichen`, `gefahrengebiete`, `lagemeldungen`, `bilder` (Metadaten-DTO, ID-Ref), `org_default` (die eingefrorene `tz_organisation` bzw. Org-Anzeige). Jedes Feld ist der **rohe `*Anzeige`-Typ** aus dem Quell-Modul.

- [ ] **Step 2: `erzeuge`** — ruft die o.g. Funktionen sequenziell über `pool`, baut `SnapshotDaten`, `stand_at = now`, serialisiert zu `serde_json::Value`, ruft `insert_roh`, gibt `lade_dokument` zurück.

- [ ] **Step 3: Failing test — Fachdaten werden eingefroren (Immutabilität):**

```rust
#[tokio::test]
async fn snapshot_friert_fachdaten_ein_umbenennen_aendert_stand_nicht() {
    let (pool, einsatz_id, benutzer_id) = setup().await;
    let einheit_id = seed_einheit(&pool, einsatz_id, "THW Zug 1").await;

    let snap = repo::erzeuge(&pool, einsatz_id, benutzer_id, Some("Stand 1"), None)
        .await.unwrap();

    // Einheit nach dem Snapshot umbenennen
    benenne_einheit_um(&pool, einheit_id, "THW Zug 2").await;

    // Der GESPEICHERTE Stand zeigt weiterhin den alten Namen
    let dok = repo::lade_dokument(&pool, einsatz_id, snap.id).await.unwrap();
    let namen: Vec<&str> = dok.daten["einheiten"].as_array().unwrap()
        .iter().map(|e| e["name"].as_str().unwrap()).collect();
    assert!(namen.contains(&"THW Zug 1"), "Snapshot muss den eingefrorenen Namen tragen");
    assert!(!namen.contains(&"THW Zug 2"));
}
```

- [ ] **Step 4: Zweiter Test — Vollständigkeit der Marker-Typen** (Enumerations-Guard gegen „ein Typ vergessen"): seede je 1 uhs/schaden/fahrzeug/führungskraft/zone/freies_zeichen, `erzeuge`, assert dass jede der Listen im Dokument nicht-leer ist. (Fängt fehlende disposition_repo-Quellen.)

- [ ] **Step 5: Run → PASS.** `cargo test --test lage_snapshot snapshot_friert -- --nocapture`
- [ ] **Step 6: Commit** — `feat(lfh-321): Snapshot-Capture friert volles Lagebild ein (rohe DTOs)`

---

## Task 3: Routen (POST/GET-Liste/GET-Einzel/PATCH/DELETE) + Gating + Extractoren

**Files:**
- Create: `src/routes/lage_snapshot.rs`
- Modify: `src/app.rs` (Router-Registrierung), `src/routes/mod.rs` (falls Modul-Liste)
- Modify: `src/lage_snapshot/mod.rs` (Request-DTO `PatchLageSnapshot`, `NeuerLageSnapshot`)
- Test: `tests/lage_snapshot.rs`

**Interfaces (Routen, EinsatzKontext-gegatet, Modul-Marker `lagekarte`):**
```
POST   /api/einsaetze/{id}/lage-snapshots        → erzeuge   (darfImEinsatzSchreiben) 201
GET    /api/einsaetze/{id}/lage-snapshots        → Metadaten-Liste
GET    /api/einsaetze/{id}/lage-snapshots/{sid}  → Volldokument
PATCH  /api/einsaetze/{id}/lage-snapshots/{sid}  → nur bezeichnung/notiz
DELETE /api/einsaetze/{id}/lage-snapshots/{sid}  → loesche   (darfEinsatzLeiten)
```

- [ ] **Step 1: Request-DTOs** — `NeuerLageSnapshot { bezeichnung: Option<String>, notiz: Option<String> }`; `PatchLageSnapshot { bezeichnung: Option<TriState<String>>, notiz: Option<TriState<String>> }` (PATCH-Muster wie Bestand). **Der PATCH-DTO trägt strukturell KEIN `daten`/`stand_at`/`erstellt_*`** — Unveränderlichkeit ist typseitig erzwungen.

- [ ] **Step 2: Handler** — `sid` via `PfadParam`, Body via `JsonBody`, `einsatz`/`benutzer` via `EinsatzKontext`. POST: Schreibrecht-Check → `repo::erzeuge` → 201 + SSE (Task 4). DELETE: Leitungsrecht → `repo::loesche` → 204/200. GET-Einzel: `lade_dokument` → 404 wenn None.

- [ ] **Step 3: Router** — in `src/app.rs` analog `karten_ansicht`-Routen einhängen.

- [ ] **Step 4: Failing tests** (`tests/lage_snapshot.rs`, HTTP-Ebene via `anfrage`-Helfer):
  - `post_erzeugt_snapshot_201_und_liste_zeigt_metadaten_ohne_daten`
  - `get_einzel_liefert_volldokument`
  - `patch_setzt_nur_bezeichnung_daten_bleibt` — PATCH `{bezeichnung:"X"}`, danach `daten` unverändert, `stand_at` unverändert. (Feld-Guard: der DTO kann `daten` gar nicht annehmen — zusätzlicher Test schickt `{"daten":{}}` im Body und erwartet, dass `daten` unverändert bleibt, weil das Feld ignoriert/abgelehnt wird.)
  - `delete_ohne_leitungsrecht_403` / `delete_mit_leitungsrecht_ok`
  - `fremder_einsatz_404` (EinsatzKontext)

```rust
#[tokio::test]
async fn patch_ist_immutabel_fuer_daten() {
    let (app, einsatz_id, cookie) = setup_http().await;
    let snap = post_snapshot(&app, einsatz_id, &cookie, "Stand 1").await;
    let vorher = get_dokument(&app, einsatz_id, snap.id, &cookie).await;

    // Versuch, daten/stand_at über PATCH zu ändern — Feld existiert im DTO nicht
    let res = patch(&app, einsatz_id, snap.id, &cookie,
        serde_json::json!({"bezeichnung":"Neu","daten":{"hacked":true},"stand_at":"1999"})).await;
    assert_eq!(res.status(), 200);

    let nachher = get_dokument(&app, einsatz_id, snap.id, &cookie).await;
    assert_eq!(nachher["daten"], vorher["daten"]);   // unverändert
    assert_eq!(nachher["stand_at"], vorher["stand_at"]);
    assert_eq!(nachher["bezeichnung"], "Neu");        // nur Meta geändert
}
```

- [ ] **Step 5: Run → PASS.** `cargo test --test lage_snapshot`
- [ ] **Step 6: Commit** — `feat(lfh-321): lage_snapshot-Routen (POST/GET/PATCH/DELETE) + Gating`

---

## Task 4: SSE `LiveEvent::LageSnapshot` + Modul-Pfad + Wire-Pin

**Files:**
- Modify: `src/live/mod.rs` (5 Verankerungen), `tests/enum_wire_kontrakt.rs`, `src/einsatz/modul.rs` (PFAD_KEY), `src/routes/lage_snapshot.rs` (Emit)

**Interfaces:** `LiveEvent::LageSnapshot` → Wire `"lage_snapshot"`, `modul_keys` → `&["lagekarte"]`.

- [ ] **Step 1:** `src/live/mod.rs` — (1) Variante `LageSnapshot` im `enum LiveEvent`; (2) `ALLE`-Array + Längen-Bump `[LiveEvent; 25]`→`[LiveEvent; 26]`; (3) `as_str` → `LageSnapshot => "lage_snapshot"`; (4) `modul_keys` → `LageSnapshot => &["lagekarte"]`; (5) `tests::gate_mengen_sind_gepinnt` → Tupel `(LiveEvent::LageSnapshot, &["lagekarte"])`.
- [ ] **Step 2:** `tests/enum_wire_kontrakt.rs` → `live_event_wire`-Block: `LageSnapshot => "lage_snapshot"`.
- [ ] **Step 3:** `src/einsatz/modul.rs` → PFAD_KEY-Eintrag `("/api/einsaetze/{id}/lage-snapshots", Some("lagekarte"))` (Modul `lagekarte` wird wiederverwendet, kein neuer modul_marker).
- [ ] **Step 4:** `src/routes/lage_snapshot.rs` → in POST/DELETE/PATCH `state.live.publiziere_event(einsatz_id, LiveEvent::LageSnapshot, json!({"einsatz_id":einsatz_id,"snapshot_id":id}))`.
- [ ] **Step 5: Test/Build** — `cargo test --test enum_wire_kontrakt` + `cargo test -p lifeline-hub live::tests::gate_mengen_sind_gepinnt`. Optionaler SSE-Integrationstest (abonnieren nach Snapshot-Anlegen, Event beim zweiten POST empfangen).
- [ ] **Step 6: Commit** — `feat(lfh-321): LiveEvent::LageSnapshot SSE-Verankerung + Wire-Pin`

---

## Task 5: `api_doc` + Codegen + FE-queryKeys

**Files:**
- Modify: `src/api_doc.rs`, `frontend/src/api/queryKeys.ts`, `frontend/src/api/types.ts`
- Generiert: `frontend/src/api/openapi.json`, `types.generated.ts`
- Create: `frontend/src/api/lageSnapshot.ts`

- [ ] **Step 0 (FE-Setup, einmalig):** Worktree hat kein `node_modules` → `pnpm -C frontend install` (via `mise exec` gemäß Projekt-Konvention). Prerequisite für `check-typ-codegen.sh` (Task 5) und Vitest (Tasks 7–8).
- [ ] **Step 1:** `src/api_doc.rs` schemas-Liste: `crate::lage_snapshot::LageSnapshotAnzeige,` (+ `LageSnapshotDokument`, falls eigenes Schema). `LiveEvent` ist bereits registriert — neue Variante fließt automatisch in die Codegen.
- [ ] **Step 2:** `scripts/check-typ-codegen.sh` laufen lassen → `openapi.json` + `types.generated.ts` regenerieren.
- [ ] **Step 3:** `frontend/src/api/types.ts` Barrel: `export type LageSnapshot = S['LageSnapshotAnzeige'];` (+ Dokument-Typ). Request-DTOs `NeuerLageSnapshot`/`PatchLageSnapshot` hand-gepflegt ergänzen.
- [ ] **Step 4:** `frontend/src/api/queryKeys.ts` — 3 Stellen: `EINSATZ_KEYS.lageSnapshot: 'einsatz-lage-snapshot'` (**oberhalb** der `// Nicht live`-Linie); `EINSATZ_STREAM_EVENTS.lage_snapshot: [EINSATZ_KEYS.lageSnapshot]` (Objekt-Key **byte-genau** `lage_snapshot`); `einsatzKeys.lageSnapshot(einsatzId)`.
- [ ] **Step 5:** `frontend/src/api/lageSnapshot.ts` — `listeLageSnapshots`, `ladeLageSnapshot`, `erzeugeLageSnapshot`, `patcheLageSnapshot`, `loescheLageSnapshot` (fetch-Wrapper wie `kartenAnsicht.ts`).
- [ ] **Step 6: Verify** — `scripts/check-typ-codegen.sh` grün (kein uncommittetes Diff), `pnpm -C frontend test queryKeys` grün.
- [ ] **Step 7: Commit** — `feat(lfh-321): LageSnapshot Codegen + FE-queryKeys + API-Client`

---

## Task 6: DSGVO — `schwaerzung_registry`

**Files:** Modify: `src/einsatz/schwaerzung_registry.rs`

- [ ] **Step 1:** `TABELLEN`-Konstante: `TabellenRegel` für `lage_snapshot` mit **`Strategie::ZeileLoeschen`** (kohärent für ALLE Spalten — der `zeile_loeschen_ist_kohaerent`-Guard verlangt Einheitlichkeit). Begründung als Kommentar: „Nutzlast (daten-JSON) IST PII, kein erhaltenswertes Skelett; keine ETB-Kopplung → nicht Retain-fähig (vgl. lagebericht/befehl.abschnitte)."
- [ ] **Step 2: Run → PASS.** `cargo test -p lifeline-hub schwaerzung` (Guards `jede_einsatz_scoped_spalte_ist_klassifiziert`, `entdeckte_tabellen_gleich_registry_tabellen` grün).
- [ ] **Step 3: Commit** — `feat(lfh-321): lage_snapshot in DSGVO-Schwärzung (ZeileLoeschen)`

---

## Task 7: FE — `Standquelle` in `useLagekarteDaten` + `useKartenbilder`

**Files:** Modify: `frontend/src/pages/lagekarte/useLagekarteDaten.ts`, `useKartenbilder.ts`, `LagekartePage.tsx`

**Interfaces:** `type Standquelle = { typ: 'live' } | { typ: 'snapshot'; id: number }`. Beide Hooks nehmen `quelle` als Parameter/Prop.

**KRITISCH (Advisor-Fund) — Global-Scope-Freeze muss auch KONSUMIERT werden:** Im Snapshot-Modus müssen `orgDefault` (für `baueTzProps`) und die gefahrengebiet-Warnstufe (für `gebietWarnstufe`/Zonen-Färbung) **aus dem Dokument** (`dokument.org_default`, `dokument.gefahrengebiete[].hoechste_warnstufe`) gespeist werden — **nicht** aus den Live-Queries `ladeOrganisation`/`ladeGefahrengebiete`. Sonst schreibt eine spätere Org-Umbenennung/Warnstufen-Neubewertung den historischen Stand still um. Der Einheit-Umbenennen-Test (Task 2) deckt diesen Seam **nicht** ab (per-Entity-DTO vs. Global-Scope-Ableitung).

- [ ] **Step 0 (Voraussetzung prüfen):** Signaturen von `baueTzProps`/`baueMarker`/`gebietWarnstufe` (marker.ts/useLagekarteDaten.ts) lesen — nehmen sie `orgDefault`/Warnstufe bereits als Parameter? Falls hart an Live-Query gekoppelt: den Ableitungspfad so umbauen, dass die Quelle (Live-Query **oder** Dokument-Wert) injizierbar ist.
- [ ] **Step 1:** `Standquelle`-Typ. `useLagekarteDaten`: bei `quelle.typ==='snapshot'` das Dokument via `ladeLageSnapshot(einsatzId, quelle.id)` laden und **alle** Rückgabeformen aus den **rohen DTO-Listen des Dokuments** ableiten (dieselben `baueMarker`/`baueTaktischeMarker`/`zoneStil`), inkl. `orgDefault ← dokument.org_default` und Warnstufe ← Dokument. `darfSchreiben` hart `false` bei `quelle.typ!=='live'`.
- [ ] **Step 2:** `useKartenbilder`: analog aus `dokument.bilder` (ID-Refs); Blob weiterhin live via `ladeBildBlobUrl` — gelöschte Bilder → Hinweis-Fallback (Soft-Delete bewusst nicht in v1).
- [ ] **Step 3:** `LagekartePage`: `?snapshot=`-Param parsen → `quelle`; an beide Hooks reichen.
- [ ] **Step 4: Vitest** — zwei Tests:

```ts
it('Historien-Modus sperrt Schreiben (darfSchreiben=false)', async () => {
  vi.mocked(ladeLageSnapshot).mockResolvedValue(dokumentFixture)
  const { result } = renderHook(() => useLagekarteDaten({ einsatzId: 1, quelle: { typ: 'snapshot', id: 5 } }), { wrapper })
  await waitFor(() => expect(result.current.ladt).toBe(false))
  expect(result.current.darfSchreiben).toBe(false)
})

// Advisor-Fund: Global-Scope-Freeze wird KONSUMIERT — Live-Org/Warnstufe ändern den Stand NICHT
it('Snapshot nutzt eingefrorene org tz + warnstufe, nicht Live', async () => {
  // Dokument trägt org_default='THW' und gefahrengebiet.hoechste_warnstufe=2
  vi.mocked(ladeLageSnapshot).mockResolvedValue(dokumentMitOrgUndWarnstufe)
  // Live-Queries liefern GEÄNDERTE Werte (Org umbenannt, Warnstufe hochgestuft)
  vi.mocked(ladeOrganisation).mockResolvedValue({ tz_organisation: 'FEUERWEHR' })
  vi.mocked(ladeGefahrengebiete).mockResolvedValue([{ id: 7, hoechste_warnstufe: 4 }])
  const { result } = renderHook(() => useLagekarteDaten({ einsatzId: 1, quelle: { typ: 'snapshot', id: 5 } }), { wrapper })
  await waitFor(() => expect(result.current.ladt).toBe(false))
  // Marker-TZ nutzt eingefrorene Org, Zonenfarbe die eingefrorene Warnstufe — NICHT die Live-Werte
  const einheitMarker = result.current.alleVerortet.find(m => m.typ === 'einheit')
  expect(einheitMarker?.tz.organisation).toBe('THW')        // nicht 'FEUERWEHR'
  const zone = result.current.zonenFeatures.find(z => z.gefahrengebiet_id === 7)
  expect(zone?.warnstufe).toBe(2)                             // nicht 4
})
```
(Fixture-Feldnamen an die tatsächlichen `tz`/`zonenFeatures`-Formen anpassen — Prinzip: Live ≠ Snapshot, assert Snapshot.)

- [ ] **Step 5: Run → PASS.** `pnpm -C frontend test useLagekarteDaten`
- [ ] **Step 6: Commit** — `feat(lfh-321): Standquelle live|snapshot in Lagekarte-Daten-Hooks`

---

## Task 8: FE — Snapshot-Liste, „Stand sichern", Historien-Banner, `?snapshot=`-Deeplink

**Files:** Modify: `frontend/src/pages/lagekarte/Sidebar.tsx`, `LagekartePage.tsx`, `frontend/src/routing/deeplinks.ts`; ggf. neue `SnapshotListe.tsx`, `HistorienBanner.tsx`

- [ ] **Step 1:** `deeplinks.ts`: Builder `lagekarteSnapshot(einsatzId, snapshotId)` → `/einsaetze/:id/lagekarte?snapshot=<id>` (+ Unit-Test wie Bestand).
- [ ] **Step 2:** Sidebar-Kopf: „Stand sichern"-Button (→ `erzeugeLageSnapshot` + Query-Invalidierung) + Snapshot-Liste (Metadaten, Klick setzt `?snapshot=`). Nur bei `darfSchreiben` (live) sichtbar; Liste immer sichtbar.
- [ ] **Step 3:** `HistorienBanner` — bei aktivem `?snapshot=` über der Karte: „Historischer Stand — schreibgeschützt" + Button „Aktuell" (räumt `?snapshot=`). Ansichts-Switcher bleibt aktiv (orthogonal).
- [ ] **Step 4: Vitest** — „Stand sichern" ruft `erzeugeLageSnapshot`; Snapshot-Auswahl rendert Banner + entfernt Schreib-UI.
- [ ] **Step 5: Run → PASS.** `pnpm -C frontend test Sidebar LagekartePage`
- [ ] **Step 6: Commit** — `feat(lfh-321): Snapshot-Sidebar, Historien-Banner, ?snapshot=-Deeplink`

---

## Abschluss (nach Task 8)

- [ ] `./scripts/check-all.sh` (alle Gates) grün im Worktree.
- [ ] `superpowers:verification-before-completion` vor „fertig".
- [ ] `superpowers:requesting-code-review` → Board `in review`.
- [ ] Merge in lokalen `main` (`git -C <mainroot> merge --ff-only <branch>`), Board `shipped`.
- [ ] D (LFH-322, Replay) als **separates** Inkrement mit eigenem Plan.

## Self-Review (Spec-Abgleich)

- Snapshot-Umfang volles Lagebild (Geometrie+Fachdaten) → Task 2 ✓
- Unveränderlichkeit (PATCH nur bezeichnung/notiz; daten/stand_at/erstellt_* nicht schreibbar) → Task 1 (DTO) + Task 3 (Guard-Test) ✓
- Zwei Response-Formen (Liste=Metadaten, Einzel=Dokument) → Task 1 ✓
- Anlegen `darfImEinsatzSchreiben`, Löschen `darfEinsatzLeiten` → Task 3 ✓
- SSE `LiveEvent::LageSnapshot` + Codegen + queryKeys → Task 4/5 ✓
- DSGVO `schwaerze_einsatz` → Task 6 ✓
- Historien-Modus Schreibsperre + Banner, Switcher bleibt aktiv → Task 7/8 ✓
- Bilder nur ID-Referenz (kein BLOB) → Task 2/7 ✓
- Global-Scope-Freeze (org tz_organisation, gefahrengebiet Warnstufe) → Task 2 (über Spec hinaus, Scope-Fund) ✓
- **D/Replay bewusst ausgeklammert** → eigener Plan.
