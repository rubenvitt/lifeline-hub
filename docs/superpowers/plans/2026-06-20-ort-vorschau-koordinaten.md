# Ort-Vorschau in der Koordinaten-Eingabe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unter der WGS84-Vorschauzeile der `KoordinatenEingabe` einen ungefähren Ort anzeigen — immer eine offline-fähige Peilung (Distanz + Himmelsrichtung zum nächsten bekannten Einsatz-Marker), bei Netz zusätzlich einen Ortsnamen (Reverse-Geocoding).

**Architecture:** Neues Backend-Modul `src/geocoding/` (reine Peilungs-Mathematik + wiederverwendbarer Reverse-Geocoding-Dienst nach dem `karte/quellen.rs`-Proxy-Muster) liefert über `GET /api/einsaetze/:id/ort-vorschau` ein `{peilung, ortsname}`. Die Peilung wird bedingungslos berechnet; der Ortsname kommt nur, wenn der Geocoder rechtzeitig/aus dem Cache antwortet (harter Timeout, Token-Bucket-Rate-Limit, runder Cache-Key). Das Frontend zeigt rein additiv an und degradiert leer. Umgesetzt in zwei Phasen: **Phase 1 (Tasks 1–5)** liefert die Peilung end-to-end und ist eigenständig shippbar; **Phase 2 (Tasks 6–10)** ergänzt das Reverse-Geocoding inkl. Admin-Einstellung.

**Tech Stack:** Rust (axum, sqlx-sqlite, reqwest, tokio), React + TypeScript (antd, @tanstack/react-query, vitest + MSW), SQLite-Migrationen.

## Global Constraints

- **Peilung nie netz-gekoppelt:** Das Backend berechnet die Peilung bedingungslos. Geocoder-Ausfall/-Timeout/Rate-Limit liefert `ortsname: null`, beeinflusst die Peilung nie.
- **Additiv & leer-degradierend:** Fehlt Bezugspunkt oder Netz, verschwindet der jeweilige Teil der Zeile — nie ein Fehler, nie ein Layout-Sprung. Persistenz bleibt unberührt (Feature liest nur).
- **Nominatim-ToS (Pflicht, nicht Komfort):** identifizierender User-Agent `LifelineHub-Geocoder/1.0 (+https://github.com/)`, serverseitiger Cache, Rate-Limit ≤ 1 req/s, kein Per-Tastenanschlag (Debounce ~700 ms / on-blur).
- **Datenschutz dokumentieren:** Default-Nominatim sendet die Einsatz-Koordinate an einen öffentlichen Dritt-Server (anders als die bestehenden Warndaten-*Pulls*). Im Modul-Header von `src/geocoding/mod.rs` explizit vermerken; Peilung funktioniert ohne externen Dienst.
- **Geocoding-State prozess-global, nicht in `AppState`:** reqwest-Client + Token-Bucket leben in `OnceLock`-Statics (Rate-Limit ist ohnehin prozessweit). `AppState` wird NICHT erweitert (53 Konstruktionsstellen bleiben unangetastet). Die per-Org `geocoder_url` kommt pro Request aus `org_einstellungen`.
- **Cache-Key gerundet & integer:** Koordinaten auf 3 Nachkommastellen (~100 m) runden, als `i64` (`(wert*1000).round()`) speichern — exakte Gleichheit als Primärschlüssel, nie Float-PK.
- **Gates:** Rust `cargo test`; Frontend `pnpm exec tsc --noEmit` + `pnpm exec vitest run` (volle Suite mit `--no-file-parallelism`, da unter Last flaky). Bei Pass/Fail-Gates über den rtk-Hook ggf. `rtk proxy <cmd>` nutzen (rtk maskiert sonst Exit-Codes).
- **Frontend ins Binary eingebettet:** Manuelle Sichtprüfung im echten Backend braucht `pnpm build` + Backend-Neustart (rust-embed). Für Tests irrelevant.

## File Structure

**Backend (neu):**
- `src/geocoding/mod.rs` — Modul-Wurzel: Datenschutz-Header, `OnceLock`-Statics (reqwest-Client + Token-Bucket), `TokenBucket`, `reverse` / `reverse_mit`, `NOMINATIM_DEFAULT`. Re-exportiert die Submodule.
- `src/geocoding/peilung.rs` — `Marker`, `Peilung`, `haversine_m`, `bearing_8`, `naechster` (reine Mathematik, keine I/O).
- `src/geocoding/marker.rs` — `lade_marker(pool, einsatz_id)` (UNION-ALL über die 7 verorteten Tabellen).
- `src/geocoding/cache.rs` — `schluessel` (Rundung), `lese` / `schreibe` (Tabelle `geocoding_cache`).
- `src/routes/ort_vorschau.rs` — Handler `vorschau` für `GET /api/einsaetze/:id/ort-vorschau`.
- `migrations/0071_geocoding.sql` — Tabelle `geocoding_cache` + `ALTER TABLE org_einstellungen ADD COLUMN geocoder_url`.

**Backend (geändert):**
- `src/lib.rs` — `pub mod geocoding;`.
- `src/routes/mod.rs` — `pub mod ort_vorschau;`.
- `src/app.rs` — Route-Registrierung.
- `src/org/einstellungen.rs` — `geocoder_url` in Struct/`leer`/`anzeige`/`OrgEinstellungenDaten`/`laden_oder_default`/`speichern` (NICHT in `anzeige_hinweis` — kein Leak an Einsatz-Mitglieder).
- `src/routes/org_einstellungen.rs` — `geocoder_url` in `OrgEinstellungenUpdate` + Validierung.
- `src/einsatz/einstellungen.rs` — `ist_gueltige_geocoder_url`.

**Frontend (neu):**
- `frontend/src/api/ortVorschau.ts` — API-Client + Typen `Peilung` / `OrtVorschau`.
- `frontend/src/anzeige/useOrtVorschau.ts` — debounced React-Query-Hook.

**Frontend (geändert):**
- `frontend/src/anzeige/KoordinatenEingabe.tsx` — Props `einsatzId?` / `exclude?` + bedingt gemountete innere `OrtVorschauZeile`.
- `frontend/src/pages/EinsatzdatenPage.tsx` — Einsatzort-Feld verdrahtet (`einsatzId` + `exclude`).
- `frontend/src/api/types.ts` — `geocoder_url` auf `OrgEinstellungen` + `OrgEinstellungenUpdate`.
- `frontend/src/pages/GlobalEinstellungenPage.tsx` — Geocoder-URL-Feld (Admin).

---

# Phase 1 — Fundament (Peilung)

### Task 1: Peilungs-Mathematik (`geocoding::peilung`)

**Files:**
- Create: `src/geocoding/mod.rs`
- Create: `src/geocoding/peilung.rs`
- Modify: `src/lib.rs` (Modul-Deklaration alphabetisch nach `pub mod gefahr;` / vor `pub mod karte;`)

**Interfaces:**
- Produces:
  - `pub struct Marker { pub typ: String, pub id: i64, pub label: String, pub lat: f64, pub lon: f64 }` (`#[derive(Debug, Clone, sqlx::FromRow)]` — wird in Task 2 via FromRow geladen)
  - `pub struct Peilung { pub distanz_m: f64, pub richtung: String, pub bezug_label: String }`
  - `pub fn haversine_m(a: (f64, f64), b: (f64, f64)) -> f64`
  - `pub fn bearing_8(from: (f64, f64), to: (f64, f64)) -> &'static str`
  - `pub fn naechster(marker: &[Marker], lat: f64, lon: f64, exclude: Option<(&str, i64)>) -> Option<Peilung>`

- [ ] **Step 1: Modul registrieren**

In `src/lib.rs` die Zeile einfügen (alphabetisch zwischen `pub mod gefahr;` und `pub mod karte;`):

```rust
pub mod geocoding;
```

- [ ] **Step 2: Modul-Wurzel mit Datenschutz-Header anlegen**

`src/geocoding/mod.rs`:

```rust
//! Geocoding & Peilung für die Koordinaten-Plausibilitätsprüfung (LFH Ort-Vorschau).
//!
//! Zwei Schichten:
//! - `peilung` — reine Mathematik (Haversine + 8-Strich-Bearing) zum nächsten bekannten
//!   verorteten Einsatz-Marker. Funktioniert IMMER offline, ohne externen Dienst.
//! - Reverse-Geocoding (Phase 2) — ergänzt einen Ortsnamen über einen konfigurierbaren
//!   Nominatim-kompatiblen Dienst, mit hartem Timeout, Token-Bucket-Rate-Limit und Cache.
//!
//! DATENSCHUTZ (bewusste Abwägung, Stil der GK-~3m-Grenze in `frontend/.../koordinaten.ts`):
//! Der Default-Geocoder (öffentlicher Nominatim) sendet die Einsatz-Koordinate an einen
//! Dritt-Server — anders als die bestehenden *Pulls* öffentlicher Warndaten (NINA/DWD/Pegel).
//! Der Cache-Key wird auf ~100 m gerundet (Nachbarpunkte teilen einen Eintrag). Admins können
//! eine eigene Geocoder-URL hinterlegen. Die Peilung kommt ohne jeden externen Dienst aus.

pub mod peilung;
```

- [ ] **Step 3: Failing test schreiben**

`src/geocoding/peilung.rs` (zunächst nur Tests + leere Signaturen genügen nicht — wir schreiben den Test, dann die Implementierung). Lege die Datei mit folgendem Test-Modul an (Implementierung kommt in Step 5):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haversine_bekannte_distanz() {
        // 1 Breitengrad-Minute ~ 1852 m (Seemeile). 0.1° Nord-Versatz ~ 11119 m.
        let d = haversine_m((51.0, 10.0), (51.1, 10.0));
        assert!((d - 11119.0).abs() < 50.0, "war {d}");
    }

    #[test]
    fn bearing_kardinalrichtungen() {
        assert_eq!(bearing_8((51.0, 10.0), (51.5, 10.0)), "N"); // genau Nord
        assert_eq!(bearing_8((51.0, 10.0), (51.0, 10.5)), "O"); // genau Ost
        assert_eq!(bearing_8((51.0, 10.0), (50.5, 10.0)), "S"); // genau Süd
        assert_eq!(bearing_8((51.0, 10.0), (51.0, 9.5)), "W");  // genau West
    }

    fn marker(typ: &str, id: i64, lat: f64, lon: f64) -> Marker {
        Marker { typ: typ.into(), id, label: format!("{typ}-{id}"), lat, lon }
    }

    #[test]
    fn naechster_waehlt_dichtesten_und_liefert_label() {
        let m = vec![marker("uhs", 1, 51.5, 10.0), marker("schaden", 2, 51.01, 10.0)];
        let p = naechster(&m, 51.0, 10.0, None).expect("Peilung");
        assert_eq!(p.bezug_label, "schaden-2"); // näher
        assert_eq!(p.richtung, "N");
        assert!(p.distanz_m > 0.0);
    }

    #[test]
    fn naechster_exclude_schliesst_eigene_entitaet_aus() {
        let m = vec![marker("uhs", 7, 51.001, 10.0), marker("uhs", 8, 51.5, 10.0)];
        // uhs:7 ist am nächsten, wird aber ausgeschlossen → uhs:8 gewinnt.
        let p = naechster(&m, 51.0, 10.0, Some(("uhs", 7))).expect("Peilung");
        assert_eq!(p.bezug_label, "uhs-8");
    }

    #[test]
    fn naechster_ohne_marker_ist_none() {
        assert!(naechster(&[], 51.0, 10.0, None).is_none());
    }
}
```

- [ ] **Step 4: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test --lib geocoding::peilung`
Expected: FAIL (Kompilierfehler — `Marker`, `haversine_m`, `bearing_8`, `naechster` nicht definiert).

- [ ] **Step 5: Implementierung schreiben**

Oben in `src/geocoding/peilung.rs` (vor dem Test-Modul) einfügen:

```rust
//! Reine Peilungs-Mathematik: Haversine-Distanz + 8-Strich-Bearing zwischen zwei
//! WGS84-Punkten. Keine I/O, keine Abhängigkeit zum Netz.

/// Verorteter Einsatz-Marker (Bezugspunkt-Kandidat). `typ` ist ein stabiles Tag
/// (`einsatzort`, `uhs`, `schaden`, `einheit`, `fahrzeug`, `personal`, `lagemeldung`)
/// für `exclude` und Anzeige; `label` ist die menschenlesbare Bezeichnung.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Marker {
    pub typ: String,
    pub id: i64,
    pub label: String,
    pub lat: f64,
    pub lon: f64,
}

/// Distanz + 8-Strich-Richtung + Bezeichnung des nächsten Markers.
#[derive(Debug, Clone)]
pub struct Peilung {
    pub distanz_m: f64,
    pub richtung: String,
    pub bezug_label: String,
}

const ERDRADIUS_M: f64 = 6_371_000.0;
const STRICHE: [&str; 8] = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];

/// Haversine-Großkreisdistanz in Metern. Punkte als `(lat, lon)` in Grad.
pub fn haversine_m(a: (f64, f64), b: (f64, f64)) -> f64 {
    let (phi1, phi2) = (a.0.to_radians(), b.0.to_radians());
    let dphi = (b.0 - a.0).to_radians();
    let dlambda = (b.1 - a.1).to_radians();
    let h = (dphi / 2.0).sin().powi(2)
        + phi1.cos() * phi2.cos() * (dlambda / 2.0).sin().powi(2);
    2.0 * ERDRADIUS_M * h.sqrt().asin()
}

/// Initial-Bearing `from → to`, gerundet auf die nächste der 8 Strich-Richtungen.
pub fn bearing_8(from: (f64, f64), to: (f64, f64)) -> &'static str {
    let (phi1, phi2) = (from.0.to_radians(), to.0.to_radians());
    let dlambda = (to.1 - from.1).to_radians();
    let y = dlambda.sin() * phi2.cos();
    let x = phi1.cos() * phi2.sin() - phi1.sin() * phi2.cos() * dlambda.cos();
    let grad = (y.atan2(x).to_degrees() + 360.0) % 360.0;
    let idx = ((grad / 45.0).round() as usize) % 8;
    STRICHE[idx]
}

/// Nächsten Marker zur Anfrage-Koordinate finden (Haversine), optional eine Entität
/// (`typ`, `id`) ausschließen (Selbst-Ausschluss). `None`, wenn keiner übrig bleibt.
pub fn naechster(
    marker: &[Marker],
    lat: f64,
    lon: f64,
    exclude: Option<(&str, i64)>,
) -> Option<Peilung> {
    let nahe = marker
        .iter()
        .filter(|m| exclude != Some((m.typ.as_str(), m.id)))
        .min_by(|a, b| {
            let da = haversine_m((lat, lon), (a.lat, a.lon));
            let db = haversine_m((lat, lon), (b.lat, b.lon));
            da.total_cmp(&db)
        })?;
    Some(Peilung {
        distanz_m: haversine_m((lat, lon), (nahe.lat, nahe.lon)),
        richtung: bearing_8((lat, lon), (nahe.lat, nahe.lon)).to_string(),
        bezug_label: nahe.label.clone(),
    })
}
```

- [ ] **Step 6: Test laufen lassen, Erfolg bestätigen**

Run: `cargo test --lib geocoding::peilung`
Expected: PASS (5 Tests grün).

- [ ] **Step 7: Commit**

```bash
git add src/lib.rs src/geocoding/mod.rs src/geocoding/peilung.rs
git commit -m "feat(geocoding): Peilungs-Mathematik (Haversine + 8-Strich-Bearing + nächster Marker)"
```

---

### Task 2: Marker-Loader (`geocoding::marker`)

**Files:**
- Create: `src/geocoding/marker.rs`
- Modify: `src/geocoding/mod.rs` (`pub mod marker;`)

**Interfaces:**
- Consumes: `peilung::Marker` (Task 1).
- Produces: `pub async fn lade_marker(pool: &sqlx::SqlitePool, einsatz_id: i64) -> Result<Vec<crate::geocoding::peilung::Marker>, crate::error::AppError>`

- [ ] **Step 1: Submodul registrieren**

In `src/geocoding/mod.rs` nach `pub mod peilung;` einfügen:

```rust
pub mod marker;
```

- [ ] **Step 2: Failing test schreiben**

`src/geocoding/marker.rs` — vorerst nur das Test-Modul (Implementierung folgt in Step 4):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal-Fixture: Org + Benutzer + Einsatz; liefert (benutzer_id, einsatz_id).
    async fn fixture(pool: &sqlx::SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let bid: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'a', 'a', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let eid: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatzort, einsatzort_lat, einsatzort_lon) \
             VALUES (1, 'Lage', 'Rathaus', 51.0, 10.0) RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (bid, eid)
    }

    #[tokio::test]
    async fn laedt_einsatzort_und_uhs_ignoriert_unverortete() {
        let pool = crate::db::test_pool().await;
        let (bid, eid) = fixture(&pool).await;
        // Eine verortete UHS und eine UNverortete (lat/lon NULL → muss fehlen).
        sqlx::query(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, status, erfasst_von, geaendert_von, lat, lon) \
             VALUES (?, 'pa', 'PA 1', 'geplant', ?, ?, 51.2, 10.2)",
        ).bind(eid).bind(bid).bind(bid).execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, status, erfasst_von, geaendert_von) \
             VALUES (?, 'pa', 'PA ohne Geo', 'geplant', ?, ?)",
        ).bind(eid).bind(bid).bind(bid).execute(&pool).await.unwrap();

        let marker = lade_marker(&pool, eid).await.unwrap();
        // Einsatzort + 1 verortete UHS = 2; die unverortete UHS fehlt.
        assert_eq!(marker.len(), 2);
        let einsatzort = marker.iter().find(|m| m.typ == "einsatzort").unwrap();
        assert_eq!(einsatzort.label, "Rathaus");
        assert_eq!(einsatzort.id, eid);
        let uhs = marker.iter().find(|m| m.typ == "uhs").unwrap();
        assert_eq!(uhs.label, "PA 1");
        assert_eq!((uhs.lat, uhs.lon), (51.2, 10.2));
    }

    #[tokio::test]
    async fn fremder_einsatz_liefert_nichts() {
        let pool = crate::db::test_pool().await;
        let (_bid, eid) = fixture(&pool).await;
        let marker = lade_marker(&pool, eid + 999).await.unwrap();
        assert!(marker.is_empty());
    }
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test --lib geocoding::marker`
Expected: FAIL (Kompilierfehler — `lade_marker` nicht definiert).

- [ ] **Step 4: Implementierung schreiben**

Oben in `src/geocoding/marker.rs` einfügen:

```rust
//! Lädt alle verorteten Marker EINES Einsatzes (lat/lon NOT NULL) als Bezugspunkt-
//! Kandidaten für die Peilung. UNION-ALL über die sieben Marker-Tragenden Tabellen;
//! je Quelle ein stabiles `typ`-Tag und eine menschenlesbare `label`-Spalte.

use crate::error::AppError;
use crate::geocoding::peilung::Marker;
use sqlx::SqlitePool;

/// Alle verorteten Marker des Einsatzes (Einsatzort, UHS, Schaden, Einheit, Fahrzeug,
/// Personal/Führung, Lagemeldung). Stornierte UHS/Schäden werden ausgeblendet.
pub async fn lade_marker(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<Marker>, AppError> {
    let marker = sqlx::query_as::<_, Marker>(
        "SELECT 'einsatzort' AS typ, id, COALESCE(NULLIF(einsatzort, ''), bezeichnung) AS label, \
                einsatzort_lat AS lat, einsatzort_lon AS lon \
           FROM einsatz \
          WHERE id = ?1 AND einsatzort_lat IS NOT NULL AND einsatzort_lon IS NOT NULL \
         UNION ALL \
         SELECT 'uhs', id, bezeichnung, lat, lon FROM uhs \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL AND storniert_at IS NULL \
         UNION ALL \
         SELECT 'schaden', id, 'S-' || registrier_nr, lat, lon FROM einsatz_schaden \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL AND storniert_at IS NULL \
         UNION ALL \
         SELECT 'einheit', id, name, lat, lon FROM einsatz_einheit \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL \
         UNION ALL \
         SELECT 'fahrzeug', id, snap_funkrufname, lat, lon FROM einsatz_fahrzeug \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL \
         UNION ALL \
         SELECT 'personal', id, snap_name, lat, lon FROM einsatz_personal \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL \
         UNION ALL \
         SELECT 'lagemeldung', id, 'Lagemeldung', lat, lon FROM lage_meldung \
          WHERE einsatz_id = ?1 AND lat IS NOT NULL AND lon IS NOT NULL",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(marker)
}
```

Hinweis: `?1` (benannter Positions-Parameter von SQLite) erlaubt EINE Bindung für alle sieben Vorkommen. Nur `einsatz`/`uhs`/`einsatz_schaden` haben `storniert_at`; die übrigen Tabellen besitzen die Spalte nicht und werden nur über lat/lon gefiltert.

- [ ] **Step 5: Test laufen lassen, Erfolg bestätigen**

Run: `cargo test --lib geocoding::marker`
Expected: PASS (2 Tests grün).

- [ ] **Step 6: Commit**

```bash
git add src/geocoding/mod.rs src/geocoding/marker.rs
git commit -m "feat(geocoding): Marker-Loader (verortete Einsatz-Marker als Peilungs-Bezug)"
```

---

### Task 3: Route `GET /api/einsaetze/:id/ort-vorschau` (nur Peilung)

**Files:**
- Create: `src/routes/ort_vorschau.rs`
- Modify: `src/routes/mod.rs` (`pub mod ort_vorschau;`)
- Modify: `src/app.rs` (Route nach Zeile `/api/einsaetze/{id}/lage/meldungen`)
- Test: `tests/ort_vorschau.rs`

**Interfaces:**
- Consumes: `geocoding::marker::lade_marker`, `geocoding::peilung::{naechster, Peilung}`, `einsatz::repo::{laden, rolle_von}`, `einsatz::berechtigung::fordere_lesezugriff`, `auth::session::CurrentUser`.
- Produces (Wire-Vertrag, von Phase 2 erweitert):
  - `pub struct OrtVorschauParams { lat: f64, lon: f64, exclude: Option<String> }`
  - `pub struct OrtVorschauAntwort { peilung: Option<PeilungAntwort>, ortsname: Option<String> }`
  - `pub struct PeilungAntwort { distanz_m: f64, richtung: String, bezug_label: String }`
  - `pub async fn vorschau(...) -> Result<Json<OrtVorschauAntwort>, AppError>`

- [ ] **Step 1: Handler implementieren**

`src/routes/ort_vorschau.rs`:

```rust
//! GET /api/einsaetze/:id/ort-vorschau?lat=&lon=&exclude=typ:id
//!
//! Liefert `{peilung, ortsname}` für die Koordinaten-Plausibilitätsprüfung.
//! Die Peilung (nächster verorteter Marker) wird bedingungslos berechnet; `ortsname`
//! ist in Phase 1 stets null und wird in Phase 2 (Reverse-Geocoding) gefüllt.
//! Auth/Scope wie andere /api/einsaetze/:id/*-Routen (Einsatz-Mitglied, Lesezugriff).

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::fordere_lesezugriff;
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::geocoding::{marker, peilung};
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct OrtVorschauParams {
    pub lat: f64,
    pub lon: f64,
    /// `typ:id` der gerade bearbeiteten Entität (Selbst-Ausschluss), z. B. `uhs:7`.
    pub exclude: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PeilungAntwort {
    pub distanz_m: f64,
    pub richtung: String,
    pub bezug_label: String,
}

#[derive(Debug, Serialize)]
pub struct OrtVorschauAntwort {
    pub peilung: Option<PeilungAntwort>,
    pub ortsname: Option<String>,
}

/// `"uhs:7"` → `("uhs", 7)`; ungültiges Format → None (Selbst-Ausschluss entfällt dann).
fn parse_exclude(s: &str) -> Option<(String, i64)> {
    let (typ, id) = s.split_once(':')?;
    Some((typ.to_string(), id.parse().ok()?))
}

pub async fn vorschau(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<OrtVorschauParams>,
) -> Result<Json<OrtVorschauAntwort>, AppError> {
    // Auth/Scope: Einsatz existiert + Lesezugriff (Mitgliedschaft/Retention).
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    // Koordinaten-Plausibilität (400 bei out-of-range).
    if !(-90.0..=90.0).contains(&params.lat) || !(-180.0..=180.0).contains(&params.lon) {
        return Err(AppError::Validation("lat/lon außerhalb des gültigen Bereichs".into()));
    }

    // Peilung: bedingungslos.
    let marker = marker::lade_marker(&state.pool, einsatz_id).await?;
    let exclude = params.exclude.as_deref().and_then(parse_exclude);
    let peilung = peilung::naechster(
        &marker,
        params.lat,
        params.lon,
        exclude.as_ref().map(|(t, i)| (t.as_str(), *i)),
    )
    .map(|p| PeilungAntwort {
        distanz_m: p.distanz_m,
        richtung: p.richtung,
        bezug_label: p.bezug_label,
    });

    // Ortsname: Phase 1 immer null (Phase 2 füllt via Reverse-Geocoding).
    Ok(Json(OrtVorschauAntwort { peilung, ortsname: None }))
}
```

- [ ] **Step 2: Route registrieren**

In `src/routes/mod.rs` `pub mod ort_vorschau;` ergänzen (alphabetisch passend einsortieren).

In `src/app.rs` direkt NACH der Zeile
```rust
        .route("/api/einsaetze/{id}/lage/meldungen", get(routes::meldung::lage_liste))
```
einfügen:
```rust
        .route("/api/einsaetze/{id}/ort-vorschau", get(routes::ort_vorschau::vorschau))
```

- [ ] **Step 3: Failing integration test schreiben**

`tests/ort_vorschau.rs` (Harness analog zu `tests/einsatz_schaden.rs`):

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    });
    (router, pool)
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app.clone().oneshot(
        Request::builder().method("POST").uri("/api/auth/login")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body)).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap()
        .split(';').next().unwrap().to_string()
}

async fn get(app: &axum::Router, uri: &str, cookie: &str) -> (StatusCode, Value) {
    let resp = app.clone().oneshot(
        Request::builder().method("GET").uri(uri)
            .header(header::COOKIE, cookie).body(Body::empty()).unwrap(),
    ).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let v = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
    (status, v)
}

/// Einsatz mit verortetem Einsatzort (51.0,10.0) anlegen; liefert einsatz_id.
async fn einsatz_mit_einsatzort(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz (org_id, bezeichnung, einsatzort, einsatzort_lat, einsatzort_lon) \
         VALUES (1, 'Lage', 'Rathaus', 51.0, 10.0) RETURNING id",
    ).fetch_one(pool).await.unwrap()
}

async fn post_json(app: &axum::Router, uri: &str, cookie: &str, body: Value) -> (StatusCode, Value) {
    let resp = app.clone().oneshot(
        Request::builder().method("POST").uri(uri)
            .header(header::COOKIE, cookie)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string())).unwrap(),
    ).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let v = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
    (status, v)
}

#[tokio::test]
async fn shape_mit_peilung_und_ortsname_null() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    // Anfrage 0.1° südlich des Einsatzorts → Peilung Richtung Norden.
    let (s, v) = get(&app, &format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"), &cookie).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["ortsname"], Value::Null); // Phase 1
    assert_eq!(v["peilung"]["richtung"].as_str(), Some("N"));
    assert_eq!(v["peilung"]["bezug_label"].as_str(), Some("Rathaus"));
    assert!(v["peilung"]["distanz_m"].as_f64().unwrap() > 0.0);
}

#[tokio::test]
async fn ohne_marker_ist_peilung_null() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    // Einsatz OHNE einsatzort_lat/lon.
    let eid = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Leer') RETURNING id",
    ).fetch_one(&pool).await.unwrap();
    let (s, v) = get(&app, &format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"), &cookie).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["peilung"], Value::Null);
    assert_eq!(v["ortsname"], Value::Null);
}

#[tokio::test]
async fn exclude_schliesst_einsatzort_aus() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    // Einsatzort ausschließen → kein weiterer Marker → peilung null.
    let uri = format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0&exclude=einsatzort:{eid}");
    let (s, v) = get(&app, &uri, &cookie).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["peilung"], Value::Null);
}

#[tokio::test]
async fn nicht_mitglied_wird_abgewiesen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    // Regulärer Benutzer (keine Org-Rolle), KEIN Einsatz-Mitglied → kein Lesezugriff.
    // Deterministisch unabhängig von etwaiger Cross-Org-/Admin-Lesepolitik.
    let (s, _v) = post_json(&app, "/api/benutzer", &admin, serde_json::json!({
        "anzeigename": "gast", "benutzername": "gast", "passwort": "gastpw1", "org_rolle": "keine"
    })).await;
    assert_eq!(s, StatusCode::CREATED);
    let gast = login_cookie(&app, "gast", "gastpw1").await;
    let (s, _v) = get(&app, &format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"), &gast).await;
    assert!(s.is_client_error(), "Nicht-Mitglied darf nicht lesen, war {s}");
}

#[tokio::test]
async fn ohne_login_ist_401() {
    let (app, pool) = setup_mit_pool().await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    let resp = app.clone().oneshot(
        Request::builder().method("GET")
            .uri(format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"))
            .body(Body::empty()).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
```

- [ ] **Step 4: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test --test ort_vorschau`
Expected: FAIL beim ersten Lauf nur, falls Handler/Route noch nicht verdrahtet — nach Step 1/2 sollten die Tests grün sein. Wenn ein Test rot ist, ist das die zu behebende Lücke (z. B. `fordere_lesezugriff`-Verhalten bei fremder Org liefert evtl. nur 403 ODER 404 — der Test akzeptiert beides).

- [ ] **Step 5: Test laufen lassen, Erfolg bestätigen**

Run: `cargo test --test ort_vorschau`
Expected: PASS (5 Tests grün).

- [ ] **Step 6: Commit**

```bash
git add src/routes/mod.rs src/routes/ort_vorschau.rs src/app.rs tests/ort_vorschau.rs
git commit -m "feat(geocoding): GET /api/einsaetze/:id/ort-vorschau liefert Peilung (ortsname noch null)"
```

---

### Task 4: Frontend-API-Client + debounced Hook

**Files:**
- Create: `frontend/src/api/ortVorschau.ts`
- Create: `frontend/src/anzeige/useOrtVorschau.ts`
- Test: `frontend/src/anzeige/useOrtVorschau.test.tsx`

**Interfaces:**
- Consumes: `apiGet` aus `frontend/src/api/client.ts`; `LatLon` aus `frontend/src/anzeige/koordinaten.ts`.
- Produces:
  - `export interface Peilung { distanz_m: number; richtung: string; bezug_label: string }`
  - `export interface OrtVorschau { peilung: Peilung | null; ortsname: string | null }`
  - `export function ladeOrtVorschau(einsatzId: number, lat: number, lon: number, exclude?: string): Promise<OrtVorschau>`
  - `export function useOrtVorschau(einsatzId: number, koord: LatLon | null, exclude?: string, debounceMs?: number): UseQueryResult<OrtVorschau>`

- [ ] **Step 1: API-Client schreiben**

`frontend/src/api/ortVorschau.ts`:

```ts
import { apiGet } from './client';

/** Peilung zum nächsten bekannten verorteten Punkt des Einsatzes. */
export interface Peilung {
  distanz_m: number;
  richtung: string;
  bezug_label: string;
}

/** Antwort von GET /api/einsaetze/:id/ort-vorschau. Beide Felder degradieren zu null. */
export interface OrtVorschau {
  peilung: Peilung | null;
  ortsname: string | null;
}

/** Lädt die Ort-Vorschau (Peilung + ggf. Ortsname) für eine Koordinate. */
export function ladeOrtVorschau(
  einsatzId: number,
  lat: number,
  lon: number,
  exclude?: string,
): Promise<OrtVorschau> {
  const p = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (exclude) p.set('exclude', exclude);
  return apiGet<OrtVorschau>(`/api/einsaetze/${einsatzId}/ort-vorschau?${p.toString()}`);
}
```

- [ ] **Step 2: Failing hook test schreiben**

`frontend/src/anzeige/useOrtVorschau.test.tsx`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useOrtVorschau } from './useOrtVorschau';

function wrapper(client = neuerQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useOrtVorschau', () => {
  it('ruft nach Debounce und liefert die Antwort', async () => {
    const treffer = vi.fn();
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () => {
        treffer();
        return HttpResponse.json({
          peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'Einsatzort' },
          ortsname: null,
        });
      }),
    );
    const { result } = renderHook(
      () => useOrtVorschau(1, { lat: 51.5, lon: 10.25 }, undefined, 20),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(treffer).toHaveBeenCalledTimes(1);
    expect(result.current.data?.peilung?.richtung).toBe('NO');
  });

  it('feuert keinen Call bei ungültiger (null) Koordinate', async () => {
    const treffer = vi.fn();
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () => {
        treffer();
        return HttpResponse.json({ peilung: null, ortsname: null });
      }),
    );
    renderHook(() => useOrtVorschau(1, null, undefined, 20), { wrapper: wrapper() });
    // Genug Zeit für einen etwaigen Debounce verstreichen lassen.
    await new Promise((r) => setTimeout(r, 60));
    expect(treffer).not.toHaveBeenCalled();
  });

  it('feuert nicht vor Ablauf des Debounce-Fensters', () => {
    const treffer = vi.fn();
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () => {
        treffer();
        return HttpResponse.json({ peilung: null, ortsname: null });
      }),
    );
    // Großzügiges Fenster; unmittelbar nach dem Render darf noch nichts gefeuert haben.
    renderHook(() => useOrtVorschau(1, { lat: 51.5, lon: 10.25 }, undefined, 500), {
      wrapper: wrapper(),
    });
    expect(treffer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd frontend && pnpm exec vitest run src/anzeige/useOrtVorschau.test.tsx`
Expected: FAIL (`useOrtVorschau` existiert noch nicht).

- [ ] **Step 4: Hook implementieren**

`frontend/src/anzeige/useOrtVorschau.ts`:

```ts
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LatLon } from './koordinaten';
import { ladeOrtVorschau, type OrtVorschau } from '../api/ortVorschau';

/** Auf ~100 m runden (3 Nachkommastellen) — teilt den serverseitigen Cache-Treffer. */
function runde(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Debounced Ort-Vorschau (Peilung + ggf. Ortsname). Ruft den Endpoint erst ~debounceMs
 * nach der letzten Koordinaten-Änderung (kein Per-Tastenanschlag, Nominatim-ToS).
 * `enabled` nur bei gültiger Koordinate; Query-Key inkl. gerundeter Koordinate.
 */
export function useOrtVorschau(
  einsatzId: number,
  koord: LatLon | null,
  exclude?: string,
  debounceMs = 700,
) {
  const [debounced, setDebounced] = useState<LatLon | null>(koord);

  useEffect(() => {
    if (!koord) {
      setDebounced(null);
      return;
    }
    const t = setTimeout(() => setDebounced({ lat: koord.lat, lon: koord.lon }), debounceMs);
    return () => clearTimeout(t);
  }, [koord?.lat, koord?.lon, debounceMs]);

  return useQuery<OrtVorschau>({
    queryKey: [
      'ort-vorschau',
      einsatzId,
      debounced ? runde(debounced.lat) : null,
      debounced ? runde(debounced.lon) : null,
      exclude ?? null,
    ],
    queryFn: () => ladeOrtVorschau(einsatzId, debounced!.lat, debounced!.lon, exclude),
    enabled: Number.isFinite(einsatzId) && debounced != null,
    // Ergebnis ist faktisch unveränderlich (Ort einer Koordinate) → nicht neu laden.
    staleTime: Infinity,
  });
}
```

- [ ] **Step 5: Test laufen lassen, Erfolg bestätigen**

Run: `cd frontend && pnpm exec vitest run src/anzeige/useOrtVorschau.test.tsx`
Expected: PASS (3 Tests grün).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/ortVorschau.ts frontend/src/anzeige/useOrtVorschau.ts frontend/src/anzeige/useOrtVorschau.test.tsx
git commit -m "feat(koordinaten): debounced useOrtVorschau-Hook + API-Client"
```

---

### Task 5: Widget-Integration (`KoordinatenEingabe` + EinsatzdatenPage)

**Files:**
- Modify: `frontend/src/anzeige/KoordinatenEingabe.tsx`
- Modify: `frontend/src/pages/EinsatzdatenPage.tsx:197-199`
- Test: `frontend/src/anzeige/KoordinatenEingabe.test.tsx` (neue Tests ergänzen)

**Interfaces:**
- Consumes: `useOrtVorschau` (Task 4), `useAnzeigeKonventionen().formatDistanz` aus `frontend/src/anzeige/AnzeigeKonventionenContext.tsx`.
- Produces: `KoordinatenEingabe`-Props um `einsatzId?: number` und `exclude?: string` erweitert.

**Designprinzip (wichtig):** Die Ort-Zeile lebt in einer separaten inneren Komponente `OrtVorschauZeile`, die NUR gemountet wird, wenn `einsatzId != null`. So ruft der React-Query-Hook (und damit der `QueryClient`-Bedarf) nur, wenn ein Aufrufer das Feature aktiv anfordert — die bestehenden `KoordinatenEingabe`-Tests (bare `render`, ohne Provider) bleiben grün.

- [ ] **Step 1: Failing tests ergänzen**

In `frontend/src/anzeige/KoordinatenEingabe.test.tsx` oben ergänzen:

```tsx
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
```

Und am Ende des `describe`-Blocks neue Tests einfügen:

```tsx
it('ohne einsatzId rendert keine Ort-Zeile (keine Provider nötig)', () => {
  // Bewusst bare render ohne QueryClient — darf NICHT werfen.
  render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} />);
  expect(screen.queryByText(/vom|·/)).not.toBeInTheDocument();
});

it('rendert die Peilungs-Zeile (ortsname null)', async () => {
  server.use(
    http.get('/api/einsaetze/1/ort-vorschau', () =>
      HttpResponse.json({
        peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'Einsatzort' },
        ortsname: null,
      }),
    ),
  );
  renderMitProviders(
    <KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} einsatzId={1} />,
  );
  expect(await screen.findByText(/NO von Einsatzort/)).toBeInTheDocument();
});

it('rendert Ortsname und Peilung verkettet', async () => {
  server.use(
    http.get('/api/einsaetze/1/ort-vorschau', () =>
      HttpResponse.json({
        peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'Einsatzort' },
        ortsname: 'Hauptstr. 5, Musterstadt',
      }),
    ),
  );
  renderMitProviders(
    <KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} einsatzId={1} />,
  );
  expect(await screen.findByText(/Hauptstr\. 5, Musterstadt · 1,20 km NO von Einsatzort/)).toBeInTheDocument();
});
```

Hinweis: `1200 m` → `formatDistanz` liefert `1.20 km`; antd/Browser-locale stellt das als `1,20 km` dar. Falls die Testumgebung `1.20 km` rendert, den Regex entsprechend anpassen (`/1[.,]20 km/`).

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd frontend && pnpm exec vitest run src/anzeige/KoordinatenEingabe.test.tsx`
Expected: FAIL (die neuen Tests — `einsatzId`-Prop existiert noch nicht, keine Ort-Zeile).

- [ ] **Step 3: `KoordinatenEingabe.tsx` erweitern**

Imports oben ergänzen:

```tsx
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { useOrtVorschau } from './useOrtVorschau';
```

(`useAnzeigeKonventionen` ist bereits importiert — nur `useOrtVorschau` ist neu.)

`Props` erweitern:

```tsx
interface Props {
  value?: LatLon | null;
  onChange?: (wert: LatLon | null) => void;
  status?: 'error' | 'warning';
  /** Einsatz, dessen Marker die Peilung bezieht. Ohne diese Prop bleibt die Ort-Zeile aus. */
  einsatzId?: number;
  /** `typ:id` der gerade bearbeiteten Entität (Selbst-Ausschluss), z. B. `uhs:7`. */
  exclude?: string;
}
```

Innere Komponente VOR `export default function KoordinatenEingabe` einfügen:

```tsx
/** Sekundäre Ort-Zeile (additiv, degradiert leer). Nur gemountet, wenn einsatzId gesetzt
 *  ist — so verlangt der React-Query-Hook nur dann einen QueryClient. */
function OrtVorschauZeile({
  einsatzId,
  koord,
  exclude,
}: {
  einsatzId: number;
  koord: LatLon;
  exclude?: string;
}) {
  const { formatDistanz } = useAnzeigeKonventionen();
  const { data, isFetching } = useOrtVorschau(einsatzId, koord, exclude);

  if (!data) {
    return isFetching ? (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Ort wird ermittelt …
      </Typography.Text>
    ) : null;
  }

  const teile: string[] = [];
  if (data.ortsname) teile.push(data.ortsname);
  if (data.peilung) {
    teile.push(`${formatDistanz(data.peilung.distanz_m)} ${data.peilung.richtung} von ${data.peilung.bezug_label}`);
  }
  if (teile.length === 0) return null;

  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {teile.join(' · ')}
    </Typography.Text>
  );
}
```

In der Signatur die neuen Props destrukturieren:

```tsx
export default function KoordinatenEingabe({ value, onChange, status, einsatzId, exclude }: Props) {
```

Im JSX direkt NACH dem bestehenden WGS84-/Fehler-Block (dem `{fehler ? (...) : value ? (...) : null}`) und noch innerhalb des äußeren `<Space>` einfügen:

```tsx
      {!fehler && value && einsatzId != null && (
        <OrtVorschauZeile einsatzId={einsatzId} koord={value} exclude={exclude} />
      )}
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `cd frontend && pnpm exec vitest run src/anzeige/KoordinatenEingabe.test.tsx`
Expected: PASS (alle alten + neuen Tests grün).

- [ ] **Step 5: EinsatzdatenPage verdrahten**

In `frontend/src/pages/EinsatzdatenPage.tsx` die Zeile 198

```tsx
            <KoordinatenEingabe />
```

ersetzen durch (`einsatzId` stammt aus `const einsatzId = Number(id)` in Zeile 48; `exclude` schließt den eigenen Einsatzort beim Bearbeiten aus):

```tsx
            <KoordinatenEingabe einsatzId={einsatzId} exclude={`einsatzort:${einsatzId}`} />
```

- [ ] **Step 6: Typecheck + Datei-Tests**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run src/anzeige/KoordinatenEingabe.test.tsx src/pages/EinsatzdatenPage`
Expected: PASS (tsc fehlerfrei; Widget- und EinsatzdatenPage-Tests grün — letztere unverändert, da die Ort-Zeile additiv ist).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/anzeige/KoordinatenEingabe.tsx frontend/src/anzeige/KoordinatenEingabe.test.tsx frontend/src/pages/EinsatzdatenPage.tsx
git commit -m "feat(koordinaten): sekundäre Ort-Zeile in KoordinatenEingabe + Einsatzort-Verdrahtung"
```

**→ Phase 1 ist hier eigenständig shippbar:** voller Plausibilitäts-Check (Peilung) ohne externen Dienst.

---

# Phase 2 — Anreicherung (Reverse-Geocoding)

### Task 6: Migration + Cache (`geocoding::cache`)

**Files:**
- Create: `migrations/0071_geocoding.sql`
- Create: `src/geocoding/cache.rs`
- Modify: `src/geocoding/mod.rs` (`pub mod cache;`)

**Interfaces:**
- Produces:
  - `pub fn schluessel(lat: f64, lon: f64) -> (i64, i64)`
  - `pub async fn lese(pool: &SqlitePool, lat_key: i64, lon_key: i64) -> Option<String>`
  - `pub async fn schreibe(pool: &SqlitePool, lat_key: i64, lon_key: i64, ortsname: &str)`

- [ ] **Step 1: Migration schreiben**

`migrations/0071_geocoding.sql`:

```sql
-- Reverse-Geocoding-Cache (Ort-Vorschau). Schlüssel = auf ~100 m gerundete Koordinate
-- als INTEGER (lat*1000, lon*1000), exakte Gleichheit als PK. Ergebnis ist faktisch
-- unveränderlich → quasi-permanente TTL (kein Prune nötig; Tabelle bleibt klein, weil
-- Nachbarpunkte denselben Eintrag teilen). Andere Form als fachebenen_cache (das eine
-- periodisch erneuerte FeatureCollection hält) — wiederverwendet wird das reqwest-Proxy-
-- Konzept, nicht die Tabelle.
CREATE TABLE geocoding_cache (
    lat_key     INTEGER NOT NULL,
    lon_key     INTEGER NOT NULL,
    ortsname    TEXT    NOT NULL,
    erstellt_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (lat_key, lon_key)
);

-- Konfigurierbare Geocoder-Basis-URL je Organisation; NULL = öffentlicher Nominatim.
ALTER TABLE org_einstellungen ADD COLUMN geocoder_url TEXT;
```

- [ ] **Step 2: Submodul registrieren**

In `src/geocoding/mod.rs` nach `pub mod marker;` einfügen:

```rust
pub mod cache;
```

- [ ] **Step 3: Failing test schreiben**

`src/geocoding/cache.rs` — zunächst nur Tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schluessel_rundet_auf_drei_nachkommastellen() {
        assert_eq!(schluessel(51.16040, 10.45140), (51160, 10451));
        // Nachbarpunkte innerhalb ~100 m teilen denselben Schlüssel.
        assert_eq!(schluessel(51.16042, 10.45138), schluessel(51.16040, 10.45140));
    }

    #[tokio::test]
    async fn schreibe_dann_lese_roundtrip() {
        let pool = crate::db::test_pool().await;
        let (la, lo) = schluessel(51.1604, 10.4514);
        assert!(lese(&pool, la, lo).await.is_none());
        schreibe(&pool, la, lo, "Hauptstr. 5, Musterstadt").await;
        assert_eq!(lese(&pool, la, lo).await.as_deref(), Some("Hauptstr. 5, Musterstadt"));
    }

    #[tokio::test]
    async fn schreibe_ist_idempotent_upsert() {
        let pool = crate::db::test_pool().await;
        let (la, lo) = schluessel(51.0, 10.0);
        schreibe(&pool, la, lo, "Alt").await;
        schreibe(&pool, la, lo, "Neu").await;
        assert_eq!(lese(&pool, la, lo).await.as_deref(), Some("Neu"));
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM geocoding_cache")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(n, 1);
    }
}
```

- [ ] **Step 4: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test --lib geocoding::cache`
Expected: FAIL (Funktionen nicht definiert).

- [ ] **Step 5: Implementierung schreiben**

Oben in `src/geocoding/cache.rs`:

```rust
//! Persistenter Reverse-Geocoding-Cache (Tabelle `geocoding_cache`). Schlüssel = auf
//! ~100 m gerundete Koordinate als INTEGER-Paar. Cache-Fehler sind nicht fatal:
//! Lesen → Miss, Schreiben → nur geloggt (eine erfolgreiche Geocodierung darf nie an
//! einem Cache-Schreibfehler scheitern — Stil von `karte/cache.rs`).

use sqlx::SqlitePool;

/// Koordinate → ganzzahliger Cache-Schlüssel (3 Nachkommastellen, ~100 m).
pub fn schluessel(lat: f64, lon: f64) -> (i64, i64) {
    ((lat * 1000.0).round() as i64, (lon * 1000.0).round() as i64)
}

/// Cache-Treffer (Ortsname) oder None.
pub async fn lese(pool: &SqlitePool, lat_key: i64, lon_key: i64) -> Option<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT ortsname FROM geocoding_cache WHERE lat_key = ? AND lon_key = ?",
    )
    .bind(lat_key)
    .bind(lon_key)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Geocoding-Cache: Lesefehler: {e}");
        None
    })
}

/// Ortsnamen speichern (Upsert auf den Koordinaten-Schlüssel).
pub async fn schreibe(pool: &SqlitePool, lat_key: i64, lon_key: i64, ortsname: &str) {
    if let Err(e) = sqlx::query(
        "INSERT INTO geocoding_cache (lat_key, lon_key, ortsname) VALUES (?, ?, ?) \
         ON CONFLICT(lat_key, lon_key) DO UPDATE SET \
         ortsname = excluded.ortsname, erstellt_at = datetime('now')",
    )
    .bind(lat_key)
    .bind(lon_key)
    .bind(ortsname)
    .execute(pool)
    .await
    {
        tracing::warn!("Geocoding-Cache: Schreibfehler: {e}");
    }
}
```

- [ ] **Step 6: Test laufen lassen, Erfolg bestätigen**

Run: `cargo test --lib geocoding::cache`
Expected: PASS (3 Tests grün).

- [ ] **Step 7: Commit**

```bash
git add migrations/0071_geocoding.sql src/geocoding/mod.rs src/geocoding/cache.rs
git commit -m "feat(geocoding): Migration 0071 (geocoding_cache + geocoder_url) + Cache-Repo"
```

---

### Task 7: Reverse-Geocoding-Dienst + Token-Bucket

**Files:**
- Modify: `src/geocoding/mod.rs` (Statics, `TokenBucket`, `reverse`, `reverse_mit`, `NOMINATIM_DEFAULT`)

**Interfaces:**
- Consumes: `geocoding::cache::{schluessel, lese, schreibe}`.
- Produces:
  - `pub const NOMINATIM_DEFAULT: &str`
  - `pub struct TokenBucket { ... }` mit `pub fn neu(rate_pro_sek: f64, kapazitaet: f64) -> Self` und `pub fn try_take(&mut self) -> bool`
  - `pub async fn reverse(pool: &SqlitePool, base_url: &str, lat: f64, lon: f64) -> Option<String>` (prod; nutzt die globalen Statics)
  - `pub async fn reverse_mit(client: &reqwest::Client, bucket: &Mutex<TokenBucket>, pool: &SqlitePool, base_url: &str, lat: f64, lon: f64) -> Option<String>` (injizierbar, testbar)

**Warum injizierbar (Test-Isolation):** Der globale Token-Bucket ist prozessweit. Integrationstests in einem `tests/*.rs`-Binary laufen parallel und würden sich um das eine Token streiten → flaky. Bucket-abhängige Pfade (Erfolg, Cache-Hit, Offline) werden deshalb über `reverse_mit` mit einem **frischen Bucket pro Test** geprüft; die Route-Integration (Task 9) prüft nur Bucket-*unabhängige* Fakten.

- [ ] **Step 1: Failing tests schreiben**

Am Ende von `src/geocoding/mod.rs` ein Test-Modul anfügen:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_bucket_erlaubt_eines_dann_sperrt() {
        let mut b = TokenBucket::neu(1.0, 1.0);
        assert!(b.try_take()); // erstes Token
        assert!(!b.try_take()); // sofort danach gesperrt
    }

    /// Startet einen Mini-HTTP-Stub auf einem Ephemeral-Port; liefert (base_url, handle).
    async fn stub(antwort: serde_json::Value) -> (String, tokio::task::JoinHandle<()>) {
        let app = axum::Router::new().route(
            "/reverse",
            axum::routing::get(move || {
                let a = antwort.clone();
                async move { axum::Json(a) }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        (format!("http://{addr}"), handle)
    }

    /// Ephemeral-Port binden und sofort freigeben → garantiert refused Connection (Offline).
    fn geschlossener_port() -> String {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        format!("http://127.0.0.1:{port}")
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(1500))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn erfolg_liefert_display_name_und_cached() {
        let pool = crate::db::test_pool().await;
        let (base, _h) = stub(serde_json::json!({ "display_name": "Hauptstr. 5, Musterstadt" })).await;
        let bucket = Mutex::new(TokenBucket::neu(1.0, 1.0));
        let name = reverse_mit(&test_client(), &bucket, &pool, &base, 51.1604, 10.4514).await;
        assert_eq!(name.as_deref(), Some("Hauptstr. 5, Musterstadt"));
        // In den Cache geschrieben.
        let (la, lo) = cache::schluessel(51.1604, 10.4514);
        assert_eq!(cache::lese(&pool, la, lo).await.as_deref(), Some("Hauptstr. 5, Musterstadt"));
    }

    #[tokio::test]
    async fn cache_hit_umgeht_http_und_rate_limit() {
        let pool = crate::db::test_pool().await;
        let (la, lo) = cache::schluessel(51.1604, 10.4514);
        cache::schreibe(&pool, la, lo, "Aus Cache").await;
        // Base zeigt auf geschlossenen Port; Bucket leer → trotzdem Treffer aus Cache.
        let mut leer = TokenBucket::neu(1.0, 1.0);
        leer.try_take(); // Token verbrauchen
        let bucket = Mutex::new(leer);
        let name = reverse_mit(&test_client(), &bucket, &pool, &geschlossener_port(), 51.1604, 10.4514).await;
        assert_eq!(name.as_deref(), Some("Aus Cache"));
    }

    #[tokio::test]
    async fn offline_liefert_none() {
        let pool = crate::db::test_pool().await;
        let bucket = Mutex::new(TokenBucket::neu(1.0, 1.0));
        let name = reverse_mit(&test_client(), &bucket, &pool, &geschlossener_port(), 51.0, 10.0).await;
        assert!(name.is_none());
    }

    #[tokio::test]
    async fn rate_limit_ueberzaehlig_liefert_none() {
        let pool = crate::db::test_pool().await;
        let (base, _h) = stub(serde_json::json!({ "display_name": "X" })).await;
        let mut leer = TokenBucket::neu(1.0, 1.0);
        leer.try_take(); // einziges Token weg
        let bucket = Mutex::new(leer);
        // Kein Cache-Eintrag, Bucket leer → None (ohne HTTP).
        let name = reverse_mit(&test_client(), &bucket, &pool, &base, 48.0, 11.0).await;
        assert!(name.is_none());
    }
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test --lib geocoding::tests`
Expected: FAIL (`TokenBucket`, `reverse_mit`, `NOMINATIM_DEFAULT` nicht definiert).

- [ ] **Step 3: Implementierung schreiben**

In `src/geocoding/mod.rs` UNTER den `pub mod`-Zeilen (und über/neben dem Test-Modul) einfügen:

```rust
use sqlx::SqlitePool;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Öffentlicher Nominatim als Default-Geocoder (Admin kann pro Org überschreiben).
pub const NOMINATIM_DEFAULT: &str = "https://nominatim.openstreetmap.org";

/// Harter Timeout je Geocoder-Anfrage — die Peilung wartet nie aufs Netz.
const GEOCODER_TIMEOUT: Duration = Duration::from_millis(1500);

/// Token-Bucket-Rate-Limit gegen den Geocoder (Nominatim-ToS: ≤ 1 req/s).
struct Statics {
    client: reqwest::Client,
    bucket: Mutex<TokenBucket>,
}

static STATICS: OnceLock<Statics> = OnceLock::new();

fn statics() -> &'static Statics {
    STATICS.get_or_init(|| Statics {
        client: reqwest::Client::builder()
            .timeout(GEOCODER_TIMEOUT)
            .user_agent("LifelineHub-Geocoder/1.0 (+https://github.com/)")
            .build()
            .expect("reqwest-Client baubar"),
        bucket: Mutex::new(TokenBucket::neu(1.0, 1.0)),
    })
}

/// Einfacher Token-Bucket (max. `kapazitaet` Tokens, Nachfüllrate `rate_pro_sek`).
pub struct TokenBucket {
    tokens: f64,
    kapazitaet: f64,
    rate_pro_sek: f64,
    zuletzt: Instant,
}

impl TokenBucket {
    pub fn neu(rate_pro_sek: f64, kapazitaet: f64) -> Self {
        Self { tokens: kapazitaet, kapazitaet, rate_pro_sek, zuletzt: Instant::now() }
    }

    /// Ein Token nehmen, falls verfügbar; füllt vorher zeitanteilig nach.
    pub fn try_take(&mut self) -> bool {
        let jetzt = Instant::now();
        let verstrichen = jetzt.duration_since(self.zuletzt).as_secs_f64();
        self.tokens = (self.tokens + verstrichen * self.rate_pro_sek).min(self.kapazitaet);
        self.zuletzt = jetzt;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Reverse-Geocoding (prod): nutzt den prozess-globalen Client + Token-Bucket.
pub async fn reverse(pool: &SqlitePool, base_url: &str, lat: f64, lon: f64) -> Option<String> {
    let s = statics();
    reverse_mit(&s.client, &s.bucket, pool, base_url, lat, lon).await
}

/// Reverse-Geocoding (injizierbar, für Tests). Reihenfolge: Cache → Rate-Limit → HTTP.
/// Cache-Treffer umgeht Rate-Limit UND Timeout. Jeder Fehlerpfad liefert `None`.
pub async fn reverse_mit(
    client: &reqwest::Client,
    bucket: &Mutex<TokenBucket>,
    pool: &SqlitePool,
    base_url: &str,
    lat: f64,
    lon: f64,
) -> Option<String> {
    let (lat_key, lon_key) = cache::schluessel(lat, lon);

    // 1. Cache.
    if let Some(name) = cache::lese(pool, lat_key, lon_key).await {
        return Some(name);
    }

    // 2. Rate-Limit: überzählig → None (Peilung kommt ja sowieso).
    if !bucket.lock().unwrap().try_take() {
        return None;
    }

    // 3. HTTP (mit dem hart getimeouteten Client).
    let url = format!(
        "{}/reverse?lat={lat}&lon={lon}&format=jsonv2&zoom=18&accept-language=de",
        base_url.trim_end_matches('/')
    );
    let name = match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
            Ok(v) => v.get("display_name").and_then(|n| n.as_str()).map(String::from),
            Err(e) => {
                tracing::debug!("Geocoder-JSON-Parse fehlgeschlagen: {e}");
                None
            }
        },
        Ok(resp) => {
            tracing::debug!("Geocoder HTTP {}", resp.status());
            None
        }
        Err(e) => {
            tracing::debug!("Geocoder-Fetch fehlgeschlagen: {e}");
            None
        }
    };

    // 4. Erfolg cachen.
    if let Some(n) = &name {
        if !n.is_empty() {
            cache::schreibe(pool, lat_key, lon_key, n).await;
        }
    }
    name
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `cargo test --lib geocoding::tests`
Expected: PASS (5 Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/geocoding/mod.rs
git commit -m "feat(geocoding): Reverse-Geocoding-Dienst (Cache→Rate-Limit→HTTP, harter Timeout)"
```

---

### Task 8: `geocoder_url` in den Org-Einstellungen

**Files:**
- Modify: `src/org/einstellungen.rs` (7 synchrone Stellen — alle unten aufgeführt)
- Modify: `src/einsatz/einstellungen.rs` (`ist_gueltige_geocoder_url`)
- Modify: `src/routes/org_einstellungen.rs` (`OrgEinstellungenUpdate` + Validierung)
- Test: `src/org/einstellungen.rs` (Roundtrip-Test ergänzen) + `tests/org_einstellungen.rs` (Validierungs-Test ergänzen)

**Interfaces:**
- Produces:
  - `OrgEinstellungen.geocoder_url: Option<String>` (in `anzeige`, NICHT in `anzeige_hinweis`)
  - `OrgEinstellungenDaten.geocoder_url: Option<&str>`
  - `ist_gueltige_geocoder_url(s: &str) -> bool`

**Scoping (bewusst):** `geocoder_url` gehört in `anzeige` (Admin-Endpoint) und in die DB-Lade/Speicher-Pfade. Es gehört NICHT in `anzeige_hinweis` (Einsatz-Mitglieder-View) — die Route liest die URL serverseitig über `laden_oder_default` (volle Struct); kein Mitglied-JSON braucht sie.

- [ ] **Step 1: Validator schreiben (TDD)**

In `src/einsatz/einstellungen.rs` zu dessen `#[cfg(test)] mod tests` (oder ans Dateiende, falls keiner existiert — dann Test-Modul anlegen) ergänzen:

```rust
    #[test]
    fn geocoder_url_nur_http_s() {
        assert!(super::ist_gueltige_geocoder_url("https://nominatim.example.org"));
        assert!(super::ist_gueltige_geocoder_url("http://10.0.0.5:8080"));
        assert!(!super::ist_gueltige_geocoder_url("ftp://x"));
        assert!(!super::ist_gueltige_geocoder_url("kein-schema"));
        assert!(!super::ist_gueltige_geocoder_url(""));
    }
```

Run: `cargo test --lib einsatz::einstellungen::tests::geocoder_url` → FAIL (Funktion fehlt).

Dann den Validator bei den übrigen `ist_gueltige*`-Funktionen in `src/einsatz/einstellungen.rs` einfügen:

```rust
/// Geocoder-Basis-URL: nur http/https, nicht leer. Bewusst leichtgewichtig (kein
/// vollständiges URL-Parsing) — fehlkonfigurierte URLs werden zur Laufzeit wie offline
/// behandelt (`ortsname: null`), nie ein Crash.
pub fn ist_gueltige_geocoder_url(s: &str) -> bool {
    (s.starts_with("http://") || s.starts_with("https://")) && s.len() > 10
}
```

Run: `cargo test --lib einsatz::einstellungen::tests::geocoder_url` → PASS.

- [ ] **Step 2: `OrgEinstellungen`-Struct + alle DB-Pfade erweitern**

In `src/org/einstellungen.rs` an genau diesen Stellen `geocoder_url` ergänzen (Reihenfolge in `speichern` ist bindungskritisch):

1. **Struct `OrgEinstellungen`** (nach `pub auto_etb_eintraege: Option<i64>,`):
```rust
    pub geocoder_url: Option<String>,
```

2. **`leer()`** (nach `auto_etb_eintraege: None,`):
```rust
            geocoder_url: None,
```

3. **`anzeige()`** im `OrgEinstellungenAnzeige { ... }` (nach `auto_etb_eintraege: self.auto_etb_eintraege,`):
```rust
            geocoder_url: self.geocoder_url.clone(),
```

4. **`OrgEinstellungenAnzeige`-Struct** (nach `pub auto_etb_eintraege: Option<i64>,`):
```rust
    pub geocoder_url: Option<String>,
```

5. **`OrgEinstellungenDaten<'a>`-Struct** (nach `pub auto_etb_eintraege: Option<i64>,`):
```rust
    pub geocoder_url: Option<&'a str>,
```

6. **`laden_oder_default` SELECT** — die Spaltenliste um `geocoder_url` erweitern (z. B. nach `auto_etb_eintraege,`):
```sql
... auto_etb_eintraege, geocoder_url, geaendert_at, geaendert_von ...
```
(Position muss zur Struct-Feldreihenfolge passen, da `sqlx::FromRow` per Name mappt — Name-Mapping ist robust, aber die Spalte MUSS im SELECT stehen, sonst schlägt FromRow zur Laufzeit fehl.)

7. **`speichern`** — drei synchrone Stellen:
   - INSERT-Spaltenliste: `... auto_etb_eintraege, geocoder_url, geaendert_at, geaendert_von)`
   - VALUES: ein zusätzliches `?` an passender Position (vor `datetime('now'), ?`): `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
   - ON CONFLICT SET: `geocoder_url = excluded.geocoder_url,` ergänzen
   - **`.bind(daten.geocoder_url)`** an der zur VALUES-Position passenden Stelle (nach `.bind(daten.auto_etb_eintraege)`, vor `.bind(erfasser_id)`).

   `geocoder_url` NICHT in `anzeige_hinweis()` und NICHT in `OrgEinstellungenHinweis` ergänzen.

- [ ] **Step 3: Save+Load-Roundtrip-Test ergänzen**

Im `#[cfg(test)] mod tests` von `src/org/einstellungen.rs`, in `speichern_upsert_und_laden`, beim ersten `speichern`-Aufruf `geocoder_url: Some("https://nominatim.example.org"),` in die `OrgEinstellungenDaten { ... }` aufnehmen und danach assertieren:

```rust
        assert_eq!(g.geocoder_url.as_deref(), Some("https://nominatim.example.org"));
```

Und im Anzeige-Block:
```rust
        assert_eq!(a.geocoder_url.as_deref(), Some("https://nominatim.example.org"));
```

Run: `cargo test --lib org::einstellungen` → muss kompilieren & grün sein (alle `OrgEinstellungenDaten`-Literale brauchen nun das Feld bzw. `..Default::default()`; `OrgEinstellungenDaten` leitet `Default` ab, daher genügt es, das neue Feld nur dort zu setzen, wo nötig).

- [ ] **Step 4: Route-Plumbing (`OrgEinstellungenUpdate` + Validierung)**

In `src/routes/org_einstellungen.rs`:

- `OrgEinstellungenUpdate` um das Feld ergänzen:
```rust
    pub geocoder_url: Option<String>,
```
- Import erweitern: `ist_gueltige_geocoder_url` zur Use-Liste aus `crate::einsatz::einstellungen` hinzufügen.
- In `setzen` nach der Koordinatenformat-Validierung einfügen:
```rust
    let geocoder_url = bereinige(req.geocoder_url);
    if let Some(u) = geocoder_url.as_deref() {
        if !ist_gueltige_geocoder_url(u) {
            return Err(AppError::Validation("Ungültige Geocoder-URL (nur http/https)".into()));
        }
    }
```
- Im `OrgEinstellungenDaten { ... }`-Literal (im `speichern`-Aufruf) ergänzen:
```rust
            geocoder_url: geocoder_url.as_deref(),
```

- [ ] **Step 5: Integrations-Validierungstest ergänzen**

In `tests/org_einstellungen.rs` einen Test ergänzen (Harness/Helfer der Datei wiederverwenden): PUT `/api/org-einstellungen` mit `"geocoder_url": "https://nominatim.example.org"` → 200, danach GET zeigt den Wert; PUT mit `"geocoder_url": "ftp://x"` → 400. (Falls die Datei einen PUT-Helfer wie `anfrage(...)` hat, diesen nutzen; die Body-JSON muss alle Pflichtfelder von `OrgEinstellungenUpdate` enthalten bzw. `null` — am bestehenden Test in der Datei orientieren.)

- [ ] **Step 6: Tests laufen lassen, Erfolg bestätigen**

Run: `cargo test --lib org::einstellungen && cargo test --lib einsatz::einstellungen && cargo test --test org_einstellungen`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/org/einstellungen.rs src/einsatz/einstellungen.rs src/routes/org_einstellungen.rs tests/org_einstellungen.rs
git commit -m "feat(geocoding): geocoder_url in Org-Einstellungen (Struct/Load/Save/Validierung)"
```

---

### Task 9: Route füllt `ortsname` (Reverse-Geocoding verdrahten)

**Files:**
- Modify: `src/routes/ort_vorschau.rs`
- Test: `tests/ort_vorschau.rs` (Cache-Hit-Test ergänzen)

**Interfaces:**
- Consumes: `geocoding::reverse`, `geocoding::NOMINATIM_DEFAULT`, `org::einstellungen::laden_oder_default`, `geocoding::cache::{schluessel, schreibe}` (nur im Test).

- [ ] **Step 1: Handler erweitern**

In `src/routes/ort_vorschau.rs` Imports ergänzen:
```rust
use crate::geocoding;
use crate::org::einstellungen as org_einst;
```
(Das bestehende `use crate::geocoding::{marker, peilung};` bleibt; `geocoding::reverse`/`NOMINATIM_DEFAULT` über den neuen `use crate::geocoding;` oder voll qualifiziert nutzen.)

In `vorschau`, die Zeile `Ok(Json(OrtVorschauAntwort { peilung, ortsname: None }))` ersetzen durch:

```rust
    // Ortsname: parallel-erprobt, hart getimeoutet, rate-limitiert. Jeder Fehler → None.
    let org = org_einst::laden_oder_default(&state.pool, einsatz.org_id).await?;
    let base = org.geocoder_url.as_deref().unwrap_or(geocoding::NOMINATIM_DEFAULT);
    let ortsname = geocoding::reverse(&state.pool, base, params.lat, params.lon).await;

    Ok(Json(OrtVorschauAntwort { peilung, ortsname }))
```

- [ ] **Step 2: Failing/zusätzlicher Test schreiben**

In `tests/ort_vorschau.rs` ergänzen — Cache-Hit liefert `ortsname` ohne Netz (Bucket-unabhängig, weil Cache den Bucket umgeht):

```rust
#[tokio::test]
async fn ortsname_aus_cache_ohne_netz() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_mit_einsatzort(&pool).await;
    // Cache vorbefüllen für die Anfrage-Koordinate.
    let (la, lo) = lifeline_hub::geocoding::cache::schluessel(50.9, 10.0);
    lifeline_hub::geocoding::cache::schreibe(&pool, la, lo, "Teststr. 1, Musterstadt").await;

    let (s, v) = get(&app, &format!("/api/einsaetze/{eid}/ort-vorschau?lat=50.9&lon=10.0"), &cookie).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["ortsname"].as_str(), Some("Teststr. 1, Musterstadt"));
    assert_eq!(v["peilung"]["richtung"].as_str(), Some("N")); // Peilung steht weiterhin
}
```

Der bestehende Test `shape_mit_peilung_und_ortsname_null` bleibt gültig: ohne Cache-Eintrag und mit Default-Nominatim (im Test nicht erreichbar bzw. ggf. rate-limitiert) ist `ortsname` null. Falls dieser Test in CI durch echte Nominatim-Erreichbarkeit flaky würde, in einen separaten Einsatz mit gesetzter, ins Leere zeigender `geocoder_url` umbauen — aber Default-Verhalten ohne Netz in der Sandbox ist `null`, daher i. d. R. stabil. **Verifikation:** Die Route-Assertions hängen nur an Peilung-vorhanden + ortsname-null/Cache — nie am globalen Bucket.

- [ ] **Step 3: Tests laufen lassen, Erfolg bestätigen**

Run: `cargo test --test ort_vorschau`
Expected: PASS (6 Tests grün).

- [ ] **Step 4: Commit**

```bash
git add src/routes/ort_vorschau.rs tests/ort_vorschau.rs
git commit -m "feat(geocoding): ort-vorschau-Route füllt ortsname via Reverse-Geocoding (org-konfigurierbar)"
```

---

### Task 10: Admin-Frontend (Geocoder-URL)

**Files:**
- Modify: `frontend/src/api/types.ts:78-109` (`OrgEinstellungen` + `OrgEinstellungenUpdate`)
- Modify: `frontend/src/pages/GlobalEinstellungenPage.tsx`
- Test: `frontend/src/pages/GlobalEinstellungenPage` (Test ergänzen oder neu)

**Interfaces:**
- Consumes: bestehender `speichereOrgEinstellungen`-Client (übergibt das ganze Update-Objekt — nur der Typ wächst).

- [ ] **Step 1: Typen erweitern**

In `frontend/src/api/types.ts` im Interface `OrgEinstellungen` (nach `auto_etb_eintraege: number | null;`, vor `geaendert_at`):
```ts
  /** Konfigurierbare Geocoder-Basis-URL; null = öffentlicher Nominatim. */
  geocoder_url: string | null;
```
Und in `OrgEinstellungenUpdate` (nach `auto_etb_eintraege: boolean | null;`):
```ts
  geocoder_url: string | null;
```

- [ ] **Step 2: Failing test schreiben**

`frontend/src/pages/GlobalEinstellungenPage.test.tsx` (neu, falls nicht vorhanden — sonst Test ergänzen). MSW-Handler für GET/PUT, Admin-Auth via vorhandenes Muster; minimaler Test:

```tsx
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import GlobalEinstellungenPage from './GlobalEinstellungenPage';

// Falls die Seite useAuth() braucht: AuthContext über vorhandenes Test-Muster bereitstellen
// (am Muster eines bestehenden Admin-Seiten-Tests orientieren).

describe('GlobalEinstellungenPage — Geocoder-URL', () => {
  it('zeigt das Feld und sendet es beim Speichern', async () => {
    const put = vi.fn();
    server.use(
      http.get('/api/org-einstellungen', () =>
        HttpResponse.json({
          zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
          retention_dauer_tage: null, etb_nummer_praefix: null, meldung_nummer_praefix: null,
          auftrag_nummer_praefix: null, meldung_bestaetigung_frist_min: null,
          auftrag_quittierung_frist_min: null, auto_etb_eintraege: null,
          geocoder_url: null, geaendert_at: null, geaendert_von: null,
        }),
      ),
      http.get('/api/org-modul-einstellungen', () => HttpResponse.json({})),
      http.put('/api/org-einstellungen', async ({ request }) => {
        put(await request.json());
        return HttpResponse.json({ geocoder_url: 'https://nominatim.example.org' });
      }),
    );
    renderMitProviders(<GlobalEinstellungenPage />);
    const feld = await screen.findByLabelText(/Geocoder-URL/i);
    await userEvent.type(feld, 'https://nominatim.example.org');
    await userEvent.click(screen.getByRole('button', { name: /Speichern/i }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        expect.objectContaining({ geocoder_url: 'https://nominatim.example.org' }),
      ),
    );
  });
});
```

Hinweis: Falls `GlobalEinstellungenPage` `useAuth()` benötigt (Admin-Flag), den Test am Setup eines bestehenden Admin-Seiten-Tests ausrichten (z. B. wie andere Tests den `AuthContext`/`benutzer` mit `system_rolle: 'admin'` mocken). Ohne Admin ist das Feld disabled und der Speichern-Button fehlt.

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd frontend && pnpm exec vitest run src/pages/GlobalEinstellungenPage.test.tsx`
Expected: FAIL (kein „Geocoder-URL"-Feld).

- [ ] **Step 4: Seite erweitern**

In `frontend/src/pages/GlobalEinstellungenPage.tsx`:

- `FormWerte` um `geocoder_url?: string;` erweitern.
- In `initialWerte` ergänzen: `geocoder_url: einstellungen.geocoder_url ?? undefined,`.
- In `speichern(werte)` im `felder`-Objekt ergänzen: `geocoder_url: werte.geocoder_url?.trim() || null,`.
- In Sektion 1 (Anzeige-Konventionen) ODER einer neuen kurzen Sektion „Geocoding" ein Feld einfügen (z. B. nach dem Koordinatenformat-`Form.Item`):

```tsx
        <Form.Item
          label="Geocoder-URL"
          name="geocoder_url"
          tooltip="Nominatim-kompatible Basis-URL für die Ort-Vorschau (Reverse-Geocoding). Leer = öffentlicher Nominatim. Die Einsatz-Koordinate wird an diesen Dienst gesendet — für Produktivlast/Datenschutz eigenen Geocoder hinterlegen."
        >
          <Input placeholder="https://nominatim.openstreetmap.org (Default)" allowClear style={{ width: '100%' }} />
        </Form.Item>
```

- [ ] **Step 5: Test + Typecheck laufen lassen, Erfolg bestätigen**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run src/pages/GlobalEinstellungenPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/pages/GlobalEinstellungenPage.tsx frontend/src/pages/GlobalEinstellungenPage.test.tsx
git commit -m "feat(geocoding): Admin-Feld Geocoder-URL in den globalen Einstellungen"
```

---

## Abschluss-Gates (nach Task 10)

- [ ] **Backend voll:** `cargo test` (bzw. `rtk proxy cargo test` für ehrlichen Exit-Code) → alle grün.
- [ ] **Frontend voll:** `cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run --no-file-parallelism` → alle grün (volle Suite mit `--no-file-parallelism`, da unter Last sonst flaky).
- [ ] **Manuelle Sichtprüfung (optional):** `cd frontend && pnpm build`, Backend neu starten (rust-embed bettet das Bundle ein), EinsatzdatenPage öffnen, Koordinate ins Koordinaten-Feld tippen → nach ~700 ms erscheint die Ort-Zeile (Peilung; bei Netz zusätzlich Ortsname).

## Self-Review (gegen die Spec)

- **Endpoint-Vertrag** `{peilung, ortsname}` mit `exclude=typ:id` → Tasks 3/9. ✓
- **Peilung bedingungslos**, Haversine + 8-Strich, nächster Marker, Selbst-Ausschluss, kein Marker → null → Tasks 1/2/3. ✓
- **Marker-Quellen** Einsatzort/UHS/Schaden/Einheit/Fahrzeug/Personal/Lagemeldung → Task 2 (UNION-ALL, lat/lon NOT NULL). ✓
- **Geocoding-Dienst** reqwest + eigener User-Agent + harter 1,5 s-Timeout + Token-Bucket ≤ 1/s + gerundeter Cache-Key + Cache umgeht Timeout/Rate-Limit → Tasks 6/7. ✓
- **Konfigurierbare `geocoder_url`** (NULL = Nominatim) → Tasks 6/8/10. ✓
- **Datenschutz im Modul-Header dokumentiert** → Task 1 (`mod.rs`). ✓
- **Frontend** debounced Hook (kein Per-Tastenanschlag, `enabled` nur gültig, Query-Key gerundet), additive Zeile via `formatDistanz`, kein Layout-Sprung → Tasks 4/5. ✓
- **`exclude` durchgereicht** (EinsatzdatenPage → `einsatzort:<id>`) → Task 5. ✓
- **Fehler-/Edge-Cases** (offline/Timeout/kein Referenzpunkt/leere Koordinate/falsch konfigurierte URL = wie offline) → über `None`/`enabled`/Validator abgedeckt. ✓
- **Teststrategie** (Peilung-Unit, Geocoding-Unit inkl. Cache-Hit/Rate-Limit/Timeout, Route-Integration, Frontend-Hook + Widget) → Tasks 1/2/3/6/7/9/4/5. ✓
- **Sequenzierung 80/20** (Phase 1 ohne Migration eigenständig shippbar) → Phasen-Split. ✓

**Bewusst außerhalb (Spec-konform):** Forward-Geocoding; Ort-Anzeige in reinen Anzeige-Stellen; Persistierung des Ortsnamens; Verdrahtung weiterer Aufrufer (Lagekarte-Sidebar) — die Props machen das additiv nachrüstbar (Sidebar-Platzierung relativ zu einem bestehenden Einsatzort exerziert die Peilung sichtbarer als das frühe Einsatzort-Feld, ist aber nicht Teil dieses Plans).
