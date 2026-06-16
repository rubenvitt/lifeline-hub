# Kräfte-Bereitstellungsraum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eigenständiges einsatz-scoped Modul, in das Einheiten und (einheitenlose) Fahrzeuge bereitgestellt werden, mit Lebenszyklus, append-only Belegungs-Historie, ETB/SSE und Frontend — plus Entfernen von `bereitstellungsraum` aus `UhsTyp`.

**Architecture:** Neues Backend-Modul `src/bereitstellungsraum/` (mod/repo/belegung_repo) + Route-Modul `src/routes/einsatz_bereitstellungsraum.rs`, strukturgleich zu `src/uhs/` und `src/routes/einsatz_uhs.rs`. Polymorphe Belegung über `(objekt_typ, objekt_id)` mit Code-Guard (kein FK). Frontend-Modul analog zum UHS-Modul. **Beim Bauen das jeweils genannte UHS-Analog als Vorlage lesen und spiegeln.**

**Tech Stack:** Rust (axum, sqlx/SQLite), React/TS (antd, @tanstack/react-query, msw, vitest). Frontend ins Binary via rust-embed.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-17-kraefte-bereitstellungsraum-design.md` (verbindlich).
- Status-Spur identisch zu UHS: `geplant → aktiv → aufgeloest` (terminal); `geplant → aufgeloest` direkt erlaubt.
- Belegungs-Objekte: `einheit` = `einsatz_einheit`, `fahrzeug` = `einsatz_fahrzeug`.
- Fahrzeug-Belegung **nur** bei `einsatz_fahrzeug.einheit_id IS NULL` (sonst `409`/`422`).
- Auflösung/Storno blockt bei aktiver Belegung (`409`). `geplant`-BR akzeptiert keine Belegung (`422`).
- Fehlerklassen: unbekannter Enum/leeres Pflichtfeld → `Validation` (400); Regel-/Zustandsverstoß → `UnprocessableEntity` (422); Belegungs-/Storno-Konflikt → `Conflict` (409); fremd/fehlt → `NotFound` (404).
- Berechtigung: `darf_lesen` / `ist_schreibberechtigt` / `fordere_aktiv`, `einsatz_id`-Prädikat in jeder Query (siehe `src/einsatz/berechtigung.rs`).
- ETB **nicht** pseudonym (Kräfte): `etb_system`-Helfer wie in `src/routes/einsatz_uhs.rs`.
- Worktree-Pfade verwenden; Gates via `rtk proxy <cmd>`; Frontend-Tests `--no-file-parallelism`.
- Migrationen ab `0060`.

---

### Task 1: Migrationen (BR-Entity + Belegung + Cache)

**Files:**
- Create: `migrations/0060_bereitstellungsraum.sql`
- Create: `migrations/0061_br_belegung.sql`

**Interfaces:**
- Produces: Tabellen `bereitstellungsraum`, `br_belegung`; Spalten `einsatz_einheit.aktueller_br_id`, `einsatz_fahrzeug.aktueller_br_id`.

- [ ] **Step 1: SQL schreiben** — Inhalt exakt aus der Spec, Abschnitt „Datenmodell" (0060 + 0061), übernehmen.
- [ ] **Step 2: Migrationen greifen** — `rtk proxy cargo test --lib db::` (oder vorhandener Migrations-Smoke-Test) muss grün bleiben; Vorlage für Migrations-Stil: `migrations/0027_uhs.sql`, `0028_uhs_platz.sql`, `0029_person_uhs_belegung.sql`.
- [ ] **Step 3: Commit** — `feat(br): Migrationen BR-Entity + Belegung + Cache (LFH-14)`

---

### Task 2: Modul-Enums + Anzeige-Structs

**Files:**
- Create: `src/bereitstellungsraum/mod.rs`
- Modify: `src/lib.rs` (Modul `pub mod bereitstellungsraum;` registrieren — Stelle wie `pub mod uhs;`)

**Interfaces:**
- Produces: `BrStatus` (Geplant/Aktiv/Aufgeloest, `as_str`/`parse`), `ObjektTyp` (Einheit/Fahrzeug, `as_str`/`parse`), `BrBelegungsArt` (Eintritt/Wechsel/Austritt, `as_str`/`parse`), `darf_uebergehen(von,nach)->bool`, `BrAnzeige`/`BrBelegungAnzeige` (sqlx::FromRow, Serialize).

Vorlage: `src/uhs/mod.rs` (UhsStatus, darf_uebergehen, UhsAnzeige, BelegungAnzeige) spiegeln.

- [ ] **Step 1: Failing test** — in `src/bereitstellungsraum/mod.rs` `#[cfg(test)]`:

```rust
#[test]
fn status_roundtrip_und_uebergaenge() {
    for s in ["geplant","aktiv","aufgeloest"] { assert_eq!(BrStatus::parse(s).unwrap().as_str(), s); }
    assert!(BrStatus::parse("quatsch").is_none());
    assert!(darf_uebergehen("geplant","aktiv"));
    assert!(darf_uebergehen("geplant","aufgeloest"));
    assert!(darf_uebergehen("aktiv","aufgeloest"));
    assert!(!darf_uebergehen("aufgeloest","aktiv"));
    assert!(!darf_uebergehen("aktiv","aktiv"));
}

#[test]
fn objekt_typ_und_belegungs_art_roundtrip() {
    for t in ["einheit","fahrzeug"] { assert_eq!(ObjektTyp::parse(t).unwrap().as_str(), t); }
    assert!(ObjektTyp::parse("person").is_none());
    for a in ["eintritt","wechsel","austritt"] { assert_eq!(BrBelegungsArt::parse(a).unwrap().as_str(), a); }
}
```

- [ ] **Step 2: Run, fails to compile** — `rtk proxy cargo test --lib bereitstellungsraum::mod` → Symbole fehlen.
- [ ] **Step 3: Implement** — Enums + `darf_uebergehen` + Structs spiegeln aus `src/uhs/mod.rs`. `BrAnzeige` Felder = Spalten aus `bereitstellungsraum` (0060). `BrBelegungAnzeige` Felder = Spalten aus `br_belegung` (0061).
- [ ] **Step 4: Run, passes.**
- [ ] **Step 5: Commit** — `feat(br): Modul-Enums + Anzeige-Structs (LFH-14)`

---

### Task 3: Repo (BR-CRUD + Status)

**Files:**
- Create: `src/bereitstellungsraum/repo.rs`
- Modify: `src/bereitstellungsraum/mod.rs` (`pub mod repo;`)

**Interfaces:**
- Consumes: `BrAnzeige`, `BrStatus` (Task 2).
- Produces: `NeueDaten<'a>` (typ-frei: bezeichnung/abschnitt_id/standort/notiz), `PatchDaten<'a>`; `anlegen(pool, einsatz_id, benutzer_id, NeueDaten) -> BrAnzeige`, `laden(pool, einsatz_id, br_id) -> BrAnzeige` (auch storniert, 404 fremd), `liste(pool, einsatz_id, status?, abschnitt_id?) -> Vec<BrAnzeige>`, `aktualisiere(...)`, `setze_status(...)`, `storniere(...)` (blockt bei aktiver Belegung → Conflict).

Vorlage: `src/uhs/repo.rs` spiegeln (ohne `typ`; BR hat keinen Typ). Auflösungs-/Storno-Belegungsprüfung: `NOT EXISTS` über `einsatz_einheit.aktueller_br_id = :id OR einsatz_fahrzeug.aktueller_br_id = :id`.

- [ ] **Step 1: Failing tests** — `#[cfg(test)]` in `repo.rs`, Setup analog `src/uhs/platz_repo.rs::tests::setup` (Orga/Benutzer/Einsatz direkt per SQL anlegen):

```rust
#[tokio::test]
async fn anlegen_liefert_geplant() {
    let pool = test_pool().await; let (b,e) = setup(&pool).await;
    let br = anlegen(&pool, e, b, NeueDaten { bezeichnung: "BR Nord", abschnitt_id: None, standort: None, notiz: None }).await.unwrap();
    assert_eq!(br.status, "geplant");
}
#[tokio::test]
async fn status_geplant_aktiv_aufgeloest() {
    let pool = test_pool().await; let (b,e) = setup(&pool).await;
    let br = anlegen(&pool, e, b, NeueDaten { bezeichnung: "BR 1", abschnitt_id: None, standort: None, notiz: None }).await.unwrap();
    let a = setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
    assert_eq!(a.status, "aktiv");
}
```

- [ ] **Step 2: Run, fails.** `rtk proxy cargo test --lib bereitstellungsraum::repo`
- [ ] **Step 3: Implement** — spiegeln aus `src/uhs/repo.rs`; UNIQUE(einsatz_id,bezeichnung)-Verletzung → `Conflict`.
- [ ] **Step 4: Run, passes** (+ Storno-blockt-bei-Belegung-Test nach Task 4 ergänzen, falls Cache nötig — hier zunächst CRUD/Status).
- [ ] **Step 5: Commit** — `feat(br): Repo CRUD + Status (LFH-14)`

---

### Task 4: Belegung-Repo (Events + Cache + Regeln)

**Files:**
- Create: `src/bereitstellungsraum/belegung_repo.rs`
- Modify: `src/bereitstellungsraum/mod.rs` (`pub mod belegung_repo;`)

**Interfaces:**
- Consumes: `ObjektTyp`, `BrBelegungsArt`, `BrAnzeige` (Task 2), `repo::laden` (Task 3).
- Produces: `belege(pool, einsatz_id, br_id, objekt_typ: &str, objekt_id: i64, art: &str, notiz: Option<&str>, benutzer_id) -> BrBelegungAnzeige` (eine Tx: Event-Insert + Cache-Update auf der Zieltabelle), `liste_je_br(pool, br_id) -> Vec<BrBelegungAnzeige>`.

**Regeln (im Repo oder Handler — hier Repo):**
- Ziel-BR muss `aktiv` sein, sonst `UnprocessableEntity`.
- `eintritt`: Objekt-`aktueller_br_id` muss NULL sein; `wechsel`/`austritt`: muss gesetzt sein.
- `objekt_typ='fahrzeug'`: `einsatz_fahrzeug.einheit_id` muss NULL sein, sonst `Conflict`.
- `objekt_id` muss im selben Einsatz existieren (einsatz_einheit/einsatz_fahrzeug), sonst `NotFound`.
- Cache `aktueller_br_id`: bei eintritt/wechsel = br_id; bei austritt = NULL.

- [ ] **Step 1: Failing tests** (Setup legt zusätzlich eine `einsatz_einheit` + ein `einsatz_fahrzeug` mit/ohne `einheit_id` per SQL an):

```rust
#[tokio::test]
async fn einheit_eintritt_setzt_cache() {
    let pool = test_pool().await; let (b,e,br,eh,_fz_frei,_fz_in_einheit) = setup_full(&pool).await; // br aktiv
    let ev = belege(&pool, e, br, "einheit", eh, "eintritt", None, b).await.unwrap();
    assert_eq!(ev.art, "eintritt");
    let cache: Option<i64> = sqlx::query_scalar("SELECT aktueller_br_id FROM einsatz_einheit WHERE id=?").bind(eh).fetch_one(&pool).await.unwrap();
    assert_eq!(cache, Some(br));
}
#[tokio::test]
async fn fahrzeug_mit_einheit_belegen_ist_konflikt() {
    let pool = test_pool().await; let (b,e,br,_eh,_fz_frei,fz_in_einheit) = setup_full(&pool).await;
    let err = belege(&pool, e, br, "fahrzeug", fz_in_einheit, "eintritt", None, b).await.unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)));
}
#[tokio::test]
async fn einzelfahrzeug_ohne_einheit_belegbar() {
    let pool = test_pool().await; let (b,e,br,_eh,fz_frei,_x) = setup_full(&pool).await;
    assert!(belege(&pool, e, br, "fahrzeug", fz_frei, "eintritt", None, b).await.is_ok());
}
```

- [ ] **Step 2: Run, fails.** `rtk proxy cargo test --lib bereitstellungsraum::belegung_repo`
- [ ] **Step 3: Implement** — Tx-Muster aus `src/uhs/belegung_repo.rs` spiegeln; Cache-Tabelle anhand `objekt_typ` wählen (`einsatz_einheit` bzw. `einsatz_fahrzeug`).
- [ ] **Step 4: Run, passes.** Zusätzlich `repo::storniere`-Block-Test (Task 3) nun mit belegter Einheit ergänzen → `Conflict`.
- [ ] **Step 5: Commit** — `feat(br): Belegung-Events + Cache + Regeln (LFH-14)`

---

### Task 5: Routen (Handlers + ETB + SSE + Registrierung)

**Files:**
- Create: `src/routes/einsatz_bereitstellungsraum.rs`
- Modify: `src/routes/mod.rs` (`pub mod einsatz_bereitstellungsraum;`), `src/app.rs` (7 Routen registrieren — Block direkt nach den UHS-Routen, Pfade aus Spec „Routen")
- Test: `tests/einsatz_bereitstellungsraum.rs`

**Interfaces:**
- Consumes: `bereitstellungsraum::{repo, belegung_repo, mod}`.
- Produces: HTTP-Endpunkte aus Spec-Tabelle „Routen". Detail-Response `BrDetail { #[serde(flatten)] br, einheiten: Vec<...>, fahrzeuge: Vec<...> }`.

Vorlage: `src/routes/einsatz_uhs.rs` (Berechtigungs-Gates, `etb_system`, `sse_uhs`→`sse_br`, Handler-Struktur) spiegeln.

- [ ] **Step 1: Failing HTTP-Tests** — Harness analog `tests/einsatz_uhs.rs` (setup_mit_pool/login_cookie/einsatz_anlegen). Helfer `br_anlegen_und_aktivieren`. Tests:

```rust
#[tokio::test]
async fn crud_und_status_und_belegung_einheit() {
    // POST BR → 201 geplant; POST status aktiv → 200;
    // einsatz_einheit anlegen (über vorhandene Einheiten-Route oder SQL); 
    // POST /belegung {objekt_typ:"einheit",objekt_id,art:"eintritt"} → 201;
    // GET detail zeigt die Einheit.
}
#[tokio::test]
async fn aufloesen_blockt_bei_belegung_409() { /* belegt → status aufgeloest → 409 */ }
#[tokio::test]
async fn fahrzeug_mit_einheit_belegen_409() { /* einsatz_fahrzeug mit einheit_id → 409 */ }
#[tokio::test]
async fn unbekannter_objekt_typ_400() { /* objekt_typ:"person" → 400 */ }
#[tokio::test]
async fn beobachter_kann_nicht_schreiben_und_fremder_einsatz_404() { /* Rechte-Matrix wie UHS */ }
```

- [ ] **Step 2: Run, fails** (405/404, Routen fehlen). `rtk proxy cargo test --test einsatz_bereitstellungsraum`
- [ ] **Step 3: Implement** — Handler + Route-Registrierung + ETB-Texte (Spec „ETB") + `sse_br`. SSE-Event-Typ `bereitstellungsraum` in `src/live` registrieren analog `uhs` (vorhandenes Muster prüfen).
- [ ] **Step 4: Run, passes.**
- [ ] **Step 5: Commit** — `feat(br): HTTP-Routen + ETB + SSE (LFH-14)`

---

### Task 6: UhsTyp-Cleanup (Backend)

**Files:**
- Create: `migrations/0062_uhs_typ_ohne_bereitstellungsraum.sql`
- Modify: `src/uhs/mod.rs` (UhsTyp: Variante `Bereitstellungsraum` + Zweige in `as_str`/`parse`/`anzeige_label` + Test `uhs_typ_roundtrip` entfernen)

**Interfaces:**
- Produces: `UhsTyp` ohne `Bereitstellungsraum`; `UhsTyp::parse("bereitstellungsraum") == None`.

- [ ] **Step 1: Test anpassen (failing)** — in `src/uhs/mod.rs::tests::uhs_typ_roundtrip` die `bereitstellungsraum`-Einträge entfernen und assertion ergänzen: `assert!(UhsTyp::parse("bereitstellungsraum").is_none());`
- [ ] **Step 2: Run, fails** — `rtk proxy cargo test --lib uhs::mod` (Variante existiert noch).
- [ ] **Step 3: Implement** — Variante + alle Zweige entfernen; Migration 0062: `UPDATE uhs SET typ='sonstige' WHERE typ='bereitstellungsraum';` + uhs-Tabellen-Rebuild mit CHECK ohne `bereitstellungsraum` (CREATE uhs_neu mit Schema aus 0027 minus dem Wert, `INSERT INTO uhs_neu SELECT * FROM uhs`, `DROP TABLE uhs`, `ALTER TABLE uhs_neu RENAME TO uhs`, Indizes neu — exakte Spalten aus `migrations/0027_uhs.sql`).
- [ ] **Step 4: Run, passes** — `rtk proxy cargo test --test einsatz_uhs && rtk proxy cargo test --lib uhs::` (alle grün, kein UHS-Test nutzt `bereitstellungsraum`).
- [ ] **Step 5: Commit** — `refactor(uhs): bereitstellungsraum aus UhsTyp entfernt (LFH-14)`

---

### Task 7: Frontend-API + Typen

**Files:**
- Create: `frontend/src/api/einsatzBereitstellungsraum.ts`
- Modify: `frontend/src/api/types.ts` (Interfaces `Bereitstellungsraum`, `BrDetail`, `BrBelegung`, Typen `BrStatus`, `ObjektTyp`, `BrBelegungsArt`; `PlatzTyp`/`UhsTyp` unverändert lassen — UhsTyp-Frontend-Cleanup in Task 9)

**Interfaces:**
- Produces: `listeBr`, `ladeBr`, `legeBrAn`, `aktualisiereBr`, `setzeBrStatus`, `storniereBr`, `belegeBr(einsatzId, brId, {objekt_typ, objekt_id, art, notiz?})`.

Vorlage: `frontend/src/api/einsatzUhs.ts` spiegeln.

- [ ] **Step 1: Implement API + Typen** (reine Client-Funktionen; getestet über Task 8).
- [ ] **Step 2: `rtk proxy pnpm exec tsc --noEmit`** → sauber.
- [ ] **Step 3: Commit** — `feat(br): Frontend-API + Typen (LFH-14)`

---

### Task 8: Frontend-Modul (Liste + Detail + Sidebar)

**Files:**
- Create: `frontend/src/pages/bereitstellungsraum/BereitstellungsraeumePage.tsx`, `BrDetailPage.tsx`, `KraefteOhneBrSidebar.tsx`
- Modify: `modulRegistry` (Eintrag `bereitstellungsraeume`, Kategorie Kräfte/Mittel — Stelle wie UHS-Eintrag), Routing
- Test: `frontend/src/pages/bereitstellungsraum/BrDetailPage.test.tsx`

**Interfaces:**
- Consumes: API aus Task 7.

Vorlage: `frontend/src/pages/uhs/` (UhsDetailPage, Grundriss, PersonenOhneUhsSidebar) spiegeln; Drop von Grundriss/DnD entfällt — einfache Listen + Zuweisen/Entfernen-Buttons genügen.

- [ ] **Step 1: Failing tests** — RTL+msw (Muster `frontend/src/pages/uhs/Grundriss.test.tsx`):

```tsx
it('zeigt bereitgestellte Einheiten und entfernt per Austritt', async () => {
  // msw GET detail → BR aktiv mit 1 Einheit; GET kräfte ohne br → [];
  // render → Einheit sichtbar; click "entfernen" → POST belegung art=austritt erfasst.
});
it('weist eine einheitenlose Kraft zu', async () => {
  // Sidebar zeigt freie Einheit/Fahrzeug; click "zuweisen" → POST belegung art=eintritt mit objekt_typ.
});
```

- [ ] **Step 2: Run, fails.** `cd frontend && rtk proxy pnpm exec vitest run src/pages/bereitstellungsraum --no-file-parallelism`
- [ ] **Step 3: Implement** Pages + Registry + Routing.
- [ ] **Step 4: Run, passes** + `rtk proxy pnpm exec tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(br): Frontend-Modul Bereitstellungsräume (LFH-14)`

---

### Task 9: UhsTyp-Cleanup (Frontend) + Abschluss-Gate

**Files:**
- Modify: `frontend/src/api/types.ts` (`'bereitstellungsraum'` aus `UhsTyp`-Union entfernen), UHS-Anlege-UI (Typ-Auswahl: Option entfernen — Datei mit der UhsTyp-Auswahl, z. B. `UhsAnlegenDrawer.tsx`)

- [ ] **Step 1: grep** `rtk proxy rg -n "bereitstellungsraum" frontend/src` → alle Vorkommen prüfen; nur die UhsTyp-bezogenen entfernen (BR-Modul-Routen/`'bereitstellungsraeume'` NICHT anfassen).
- [ ] **Step 2: Implement** Entfernung; `rtk proxy pnpm exec tsc --noEmit` sauber.
- [ ] **Step 3: Abschluss-Gate** — `rtk proxy cargo test` grün; `cd frontend && rtk proxy pnpm exec vitest run src/pages/bereitstellungsraum src/pages/uhs --no-file-parallelism` grün.
- [ ] **Step 4: Commit** — `refactor(uhs): bereitstellungsraum aus Frontend-UhsTyp entfernt (LFH-14)`

---

## Self-Review

**Spec-Abdeckung:** Entity+Lifecycle (T1–T3), Belegung+Cache+Regeln (T1,T4), polymorpher Guard (T4–T5), Routen+ETB+SSE (T5), UhsTyp-Cleanup (T6,T9), Frontend (T7–T9), Tests je Task. Berechtigung/Org-Isolation in T5-Tests. ✓
**Platzhalter:** Implementierungsschritte verweisen auf konkrete vorhandene Analog-Dateien dieses Repos (kein „TBD") + zeigen die Test-Codes. Boilerplate-Spiegelung ist bewusst (Spec: „mirror UHS"). ✓
**Typkonsistenz:** `belege(...)`-Signatur, `aktueller_br_id`, `objekt_typ`/`objekt_id`, Status-Werte durchgängig identisch verwendet. ✓
