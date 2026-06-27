# Offline-Karten Eigen-Extract aus Protomaps + SHA256-Pinning (LFH-183) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Offline-Karten-Katalog vom fremden N.O.M.A.D.-Community-Repo lösen — Karten künftig aus einem **eigenen Extract der offiziellen Protomaps-Daily-Builds** (`build.protomaps.com`) auf projekteigenem Storage beziehen, abgesichert durch **optionales SHA256-Pinning mit Verifikation beim Download**.

**Architecture:** Drei Schichten. (1) **Code-Härtung** (diese Session): der Katalog-Eintrag und der Download-Request tragen ein optionales `sha256`; `lade_datei` verifiziert den berechneten gegen den erwarteten Hash und schlägt bei Mismatch fehl; das Frontend reicht den Pin aus dem Katalog durch. (2) **Build-Tooling + Doku** (diese Session): ein reproduzierbares Extract-/Hash-/Upload-Rezept. (3) **Katalog-Umstellung** (GATED, nächste Session nach Ops): erst wenn die Extracts gebaut, schema-verifiziert und gehostet sind, zeigt `default_offline_katalog` auf die eigenen URLs + Hashes und N.O.M.A.D. fliegt raus.

**Tech Stack:** Rust (axum, reqwest, sha2, sqlx 0.9), React/TypeScript (antd, vitest, react-query), `pmtiles` CLI (Ops, nicht im Repo), Bash.

## Scope-Entscheidungen (Phase-1-Checkpoint, User)

- **A1 — Offline-Basemap = umschaltbar, KEINE Koexistenz.** Das Umschalten Online↔Offline (Radio, eine aktiv) existiert bereits → **kein neuer Basemap-Code**. Koexistenz/Overlay ist bewusst NICHT Teil von LFH-183 (separates Feature).
- **B2 — Pinning vollständig + One-Click-Update.** (1) Der SHA256-Pin wird in **beiden** Download-Pfaden mitgeführt (Katalog-Modal + Update/Re-Download), dafür liefert `OfflineKarteAntwort` den Katalog-Hash mit. (2) „Aktualisieren" wird **One-Click**: nach erfolgreichem Update-Download automatisch die neue Version aktivieren UND die alte löschen (Datei + Zeile). Bei Download-Fehler bleibt die alte Karte aktiv.

## Global Constraints

- **Working-Katalog NICHT brechen.** `default_offline_katalog()` zeigt aktuell auf funktionierende N.O.M.A.D.-URLs. Tasks 1–4 lassen die URLs unverändert (sha256 bleibt `None`). Der URL-Flip + N.O.M.A.D.-Entfernung ist **Task 5** und wird **erst nach dem Ops-Schritt** ausgeführt — vorher würde die Live-Karte brechen.
- **Keine DB-Migration.** Die Spalte `karte_offline_karte.sha256` speichert bereits den *berechneten* Hash (LFH-181). Der *erwartete* Hash ist reine In-Memory-Config (Katalog) und fließt über den Request-Body — keine Schema-Änderung.
- **Schema: bestätigt kompatibel, Gate als Bestätigung.** Die Protomaps-Docs bestätigen: der Daily-Build-Channel ist die **„Version 4 Protomaps basemap"** (kompatibel mit `@protomaps/basemaps` Style v4.0.0+, Planet z0–15) — **dasselbe Protomaps-v4-Schema wie N.O.M.A.D.**, das unser `offlineStyle()` rendert, **kein Shortbread**. Das Schema-Risiko ist damit niedrig; das EIN-Extract-Gate (Task 4 / Ops) bleibt als billige Bestätigung, nicht als offene Frage. **URL-Korrektur:** der aktuelle Build-Channel liegt unter `maps.protomaps.com/builds` (nicht `build.protomaps.com` — 404). Die genaue, datums-volatile URL beim Build-Tag aus den Docs ziehen.
- **maxzoom 15 (Spec-Abweichung, User-bestätigt).** Der Task schlägt `--maxzoom=14` vor; der Plan baut z15 (Parität zu N.O.M.A.D. z0–15, Planet ist z0–15). z15 = schärfer + größer (AT ≈ 1,9 GB, nah an GitHub-2-GB) — bei GitHub-Release-Hosting ggf. auf 14 zurück.
- **pnpm via mise:** Frontend-Befehle laufen als `mise exec pnpm@<ver> -- pnpm -C <ABS-PFAD> …` mit absoluten Pfaden (non-interactive Shell hat mise nicht aktiv).
- **Lint-Gate:** `pnpm lint` läuft mit `--max-warnings 0` — Warnings brechen wie Errors; an der Wurzel beheben.
- **sqlx 0.9 SqlSafeStr:** keine `format!`-SQL — irrelevant hier (keine Query-Änderung), aber als Falle notiert.
- **Frontend ins Binary eingebettet (rust-embed):** Vitest-Unit-Tests brauchen keinen Build; ein echter Browser-Smoke braucht `pnpm build` + Backend-Neustart.
- **Pass/Fail-Gates ehrlich prüfen** via `rtk proxy <cmd>` (der rtk-Hook maskiert sonst Exit-Codes).

---

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `src/config.rs` | `OfflineKatalogEintrag.sha256: Option<String>` + Katalog-Konstruktion (vorerst `None`) | 1, 5 |
| `src/karte/download.rs` | `lade_datei` verifiziert erwarteten Hash; `DownloadFehler::HashMismatch` | 2 |
| `src/routes/karte.rs` | `OfflineDownloadBody.{sha256_erwartet, ersetzt_karte_id}`; reicht Pin an `lade_datei`; One-Click-Swap im Hintergrund-Task; `OfflineKarteAntwort.katalog_sha256` | 1, 2, 2b |
| `src/karte/registry/repo.rs` | `ersetze_aktive_offline_karte(neu_id, alt_id)` — atomar deaktivieren→neu aktivieren→alt löschen | 2b |
| `frontend/src/api/offlineKarten.ts` | `OfflineKatalogEintrag.sha256`, `OfflineDownloadBody.{sha256_erwartet, ersetzt_karte_id}`, `OfflineKarte.katalog_sha256` | 3 |
| `frontend/src/karten/OfflineDownloadKatalogModal.tsx` | reicht `sha256_erwartet` aus dem Katalog-Eintrag durch (Erst-Download) | 3 |
| `frontend/src/karten/OfflineKartenVerwaltung.tsx` | „Aktualisieren" reicht `sha256_erwartet`+`ersetzt_karte_id` durch (One-Click) | 3 |
| `scripts/build-offline-karten.sh` | reproduzierbares Extract-/Hash-Rezept (Ops) | 4 |
| `docs/superpowers/specs/2026-06-27-offline-karten-eigenmirror.md` | Runbook: Build, Schema-Gate, Hosting, Katalog-Pflege, Frequenz/Datenstand | 4 |

---

## Setup (Pflicht VOR Task 1 — sonst bricht das erste cargo-Gate als Compile-Fehler)

Die Arbeit startet auf `main` → isolierter Worktree. **Ein frischer Worktree hat kein `frontend/dist`** — der rust-embed-Backend-Build (und damit `cargo clippy`/`cargo test` in Task 2) bricht dann beim **Compile**, nicht als Test. Reihenfolge:

- [ ] **Worktree anlegen** (mit User-OK) via REQUIRED SUB-SKILL `superpowers:using-git-worktrees`, Branch `feat/lfh-183-offline-karten-eigenmirror`.
- [ ] **Auf aktuelle main re-baselinen:** der Worktree branched oft von veraltetem `origin/main` → `git reset --hard main` (lokale main ist Wahrheit).
- [ ] **`frontend/dist` bereitstellen, BEVOR irgendein cargo-Befehl läuft:** entweder Platzhalter (`mkdir -p frontend/dist && printf '<!doctype html>' > frontend/dist/index.html`) oder ein echter `pnpm -C <abs>/frontend build`. Sonst `rust-embed`-Compile-Fehler.
- [ ] **Baseline-Gate:** `rtk proxy cargo build` muss durchlaufen, bevor Task 1 beginnt.

---

### Task 1: Backend — `sha256`-Feld im Katalog-Eintrag und Download-Body

**Files:**
- Modify: `src/config.rs` (`OfflineKatalogEintrag` ~94-104, `default_offline_katalog` ~111-171, Test ~257-274)
- Modify: `src/routes/karte.rs` (`OfflineDownloadBody` ~413-422)

**Interfaces:**
- Produces: `OfflineKatalogEintrag` mit zusätzlichem `pub sha256: Option<String>` (serde: `null` wenn `None`). `OfflineDownloadBody` mit `pub sha256_erwartet: Option<String>` und `pub ersetzt_karte_id: Option<i64>` (beide `#[serde(default)]`).

- [ ] **Step 1: Failing test — sha256 serialisiert, default None im v1-Katalog**

In `src/config.rs` im `mod tests` ergänzen:

```rust
#[test]
fn katalog_eintrag_sha256_optional_und_serialisiert() {
    // v1-Default: noch kein Pin (Hashes kommen mit dem Eigen-Mirror, LFH-183 Task 5).
    for e in default_offline_katalog() {
        assert!(e.sha256.is_none(), "v1 pinnt noch nicht: {}", e.name);
    }
    // Mit gesetztem Pin landet der Hash im JSON (Frontend-Kontrakt).
    let mit_pin = OfflineKatalogEintrag {
        name: "x".into(), url: "https://e/x.pmtiles".into(), region: "DE".into(),
        groesse: 1, lizenz: "l".into(), kachel_schema: "protomaps".into(),
        quelle: "q".into(), sha256: Some("abc123".into()),
    };
    let j = serde_json::to_string(&mit_pin).unwrap();
    assert!(j.contains("\"sha256\":\"abc123\""), "sha256 im JSON: {j}");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy cargo test --lib config::tests::katalog_eintrag_sha256 -- --nocapture`
Expected: FAIL — `OfflineKatalogEintrag` hat kein Feld `sha256` (E0560 / missing field).

- [ ] **Step 3: Feld zur Struct hinzufügen**

In `src/config.rs`, in `pub struct OfflineKatalogEintrag` nach `pub quelle: String,`:

```rust
    /// Optionaler SHA256-Pin (hex, lowercase). Gesetzt beim Eigen-Mirror (LFH-183): der Download
    /// verifiziert den berechneten gegen diesen Hash. `None` = kein Pin (v1 / N.O.M.A.D.).
    pub sha256: Option<String>,
```

- [ ] **Step 4: Alle Katalog-Einträge mit `sha256: None` ergänzen**

In `default_offline_katalog()` jeden der drei `OfflineKatalogEintrag { … }`-Literale (Bundesländer-`map`, Österreich, Schweiz) um `sha256: None,` ergänzen. Beispiel im `map`-Closure nach `quelle: QUELLE.into(),`:

```rust
            quelle: QUELLE.into(),
            sha256: None,
```

(gleich für den Österreich- und den Schweiz-`push`).

- [ ] **Step 5: `sha256_erwartet` + `ersetzt_karte_id` zum Download-Body hinzufügen**

In `src/routes/karte.rs`, in `pub struct OfflineDownloadBody` nach dem `groesse_erwartet`-Feld:

```rust
    /// Erwarteter SHA256 (hex) aus dem Katalog-Pin — gegen den berechneten Hash verifiziert.
    #[serde(default)]
    pub sha256_erwartet: Option<String>,
    /// One-Click-Update (B2): id der Karte, die dieser Download ERSETZT. Nach Erfolg wird die neue
    /// Karte aktiviert und die alte (id) gelöscht. `None` = normaler Erst-Download.
    #[serde(default)]
    pub ersetzt_karte_id: Option<i64>,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `rtk proxy cargo test --lib config::tests`
Expected: PASS (alle `config`-Tests grün, inkl. `offline_katalog_ist_kuratiert_und_konsistent`).

- [ ] **Step 7: Commit**

```bash
git add src/config.rs src/routes/karte.rs
git commit -m "feat(lfh-183): optionales sha256 im Offline-Katalog-Eintrag und Download-Body"
```

---

### Task 2: Backend — Hash-Verifikation in `lade_datei`

**Files:**
- Modify: `src/karte/download.rs` (`DownloadFehler` ~42-63, `lade_datei` ~169-224, Tests ~279-302)
- Modify: `src/routes/karte.rs` (Aufruf `lade_datei` ~498)

**Interfaces:**
- Consumes: `OfflineDownloadBody.sha256_erwartet` (Task 1).
- Produces: `lade_datei(client, url, ziel_part, fortschritt, erwartet_sha256: Option<&str>)` — bei Hash-Mismatch `Err(DownloadFehler::HashMismatch { erwartet, ist })`. Neue Enum-Variante `HashMismatch { erwartet: String, ist: String }`.

- [ ] **Step 1: Failing tests — korrekter Pin OK, falscher Pin → HashMismatch, None → kein Check**

In `src/karte/download.rs` im `mod tests` ergänzen (nutzt vorhandenen `spawn_fixture` + `erwarteter_hash`):

```rust
#[tokio::test]
async fn lade_datei_akzeptiert_korrekten_pin_und_lehnt_falschen_ab() {
    let body = b"PMTiles\x03-pin-test".repeat(40);
    let url_str = spawn_fixture(body.clone()).await;
    let tmp = tempfile::tempdir().unwrap();
    let client = download_client();

    // Korrekter Pin → Ok.
    let f1 = Fortschritt::default();
    let erg = lade_datei(
        &client, Url::parse(&url_str).unwrap(),
        &tmp.path().join("ok.part"), &f1, Some(&erwarteter_hash(&body)),
    ).await.unwrap();
    assert_eq!(erg.sha256, erwarteter_hash(&body));

    // Falscher Pin → HashMismatch (erwartet vs. ist).
    let f2 = Fortschritt::default();
    let err = lade_datei(
        &client, Url::parse(&url_str).unwrap(),
        &tmp.path().join("bad.part"), &f2, Some("deadbeef"),
    ).await.unwrap_err();
    match err {
        DownloadFehler::HashMismatch { erwartet, ist } => {
            assert_eq!(erwartet, "deadbeef");
            assert_eq!(ist, erwarteter_hash(&body));
        }
        other => panic!("HashMismatch erwartet, war {other:?}"),
    }
}
```

- [ ] **Step 2: Bestehende `lade_datei`-Aufrufe in den Tests auf neue Signatur anpassen**

In den vorhandenen Tests `lade_datei_schreibt_bytes_und_korrekten_sha256` (~291) und `lade_datei_bricht_bei_gesetztem_abbruch_ab` (~314) den Aufruf um `, None` ergänzen:

```rust
    let erg = lade_datei(&client, url, &ziel, &fortschritt, None).await.unwrap();
```
```rust
    let err = lade_datei(&client, Url::parse(&url_str).unwrap(), &ziel, &fortschritt, None)
        .await
        .unwrap_err();
```

- [ ] **Step 3: Run test to verify it fails**

Run: `rtk proxy cargo test --lib karte::download::tests`
Expected: FAIL — Compile-Error: `lade_datei` nimmt 4 Argumente / `DownloadFehler::HashMismatch` existiert nicht.

- [ ] **Step 4: `HashMismatch`-Variante + Display ergänzen**

In `src/karte/download.rs` zur `enum DownloadFehler`:

```rust
    /// Heruntergeladene Datei stimmt nicht mit dem erwarteten SHA256-Pin überein (Supply-Chain).
    HashMismatch { erwartet: String, ist: String },
```

und in `impl Display` im `match`:

```rust
            DownloadFehler::HashMismatch { erwartet, ist } => {
                write!(f, "SHA256 stimmt nicht: erwartet {erwartet}, war {ist}")
            }
```

- [ ] **Step 5: `lade_datei` um Pin-Parameter + Verifikation erweitern**

Signatur (~169) ergänzen:

```rust
pub async fn lade_datei(
    client: &reqwest::Client,
    url: Url,
    ziel_part: &Path,
    fortschritt: &Fortschritt,
    erwartet_sha256: Option<&str>,
) -> Result<DownloadErgebnis, DownloadFehler> {
```

Am Ende, NACH `sync_all()` und VOR dem `Ok(DownloadErgebnis { … })`, den finalen Hash bilden und prüfen:

```rust
    let ist = hex(&hasher.finalize());
    if let Some(erwartet) = erwartet_sha256 {
        if !erwartet.eq_ignore_ascii_case(&ist) {
            return Err(DownloadFehler::HashMismatch {
                erwartet: erwartet.to_string(),
                ist,
            });
        }
    }
    Ok(DownloadErgebnis {
        groesse: geladen as i64,
        sha256: ist,
    })
```

(Die alte Zeile `sha256: hex(&hasher.finalize()),` entfällt — `finalize()` konsumiert den Hasher, darf nur einmal aufgerufen werden.)

- [ ] **Step 6: Handler-Aufruf den Pin durchreichen lassen**

In `src/routes/karte.rs` muss `body.sha256_erwartet` in den `tokio::spawn`-Task. Vor dem `tokio::spawn` (bei den anderen `let … = … .clone();`, ~493):

```rust
    let sha256_erwartet = body.sha256_erwartet.clone();
```

und den Aufruf (~498) anpassen:

```rust
        let ergebnis = download::lade_datei(&client, url, &part, &fortschritt, sha256_erwartet.as_deref()).await;
```

Der bestehende `Err(fehler) =>`-Arm (~533) räumt `.part` auf und setzt Status `fehler` — `HashMismatch` fällt automatisch hierunter (geloggt via `Display`). Keine weitere Änderung nötig.

- [ ] **Step 7: Run tests to verify they pass**

Run: `rtk proxy cargo test --lib karte::download::tests`
Expected: PASS (neuer Pin-Test + die zwei angepassten Tests grün).

- [ ] **Step 8: Voller Backend-Build + Clippy als Gate**

Run: `rtk proxy cargo clippy --all-targets -- -D warnings && rtk proxy cargo test --lib karte`
Expected: PASS, keine Warnungen.

- [ ] **Step 9: Commit**

```bash
git add src/karte/download.rs src/routes/karte.rs
git commit -m "feat(lfh-183): SHA256-Pin beim Offline-Download verifizieren (HashMismatch)"
```

---

### Task 2b: Backend — One-Click-Update (Swap) + Katalog-Hash in der Karten-Antwort (B2)

**Files:**
- Modify: `src/karte/registry/repo.rs` (neue Fn `ersetze_aktive_offline_karte` + Test; Vorbild `aktiviere_offline_karte` ~303)
- Modify: `src/routes/karte.rs` (`OfflineKarteAntwort` ~243-256 + `offline_liste` ~291-301; Download-Handler-Spawn ~493-531)

**Interfaces:**
- Consumes: `OfflineDownloadBody.ersetzt_karte_id` (Task 1), `OfflineKatalogEintrag.sha256` (Task 1), bestehende `aktiviere_wenn_keine_aktive`, `download::entferne_download_dateien`.
- Produces: `ersetze_aktive_offline_karte(pool, neu_id: i64, alt_id: i64) -> Result<Option<OfflineKarte>, sqlx::Error>`. `OfflineKarteAntwort` mit `pub katalog_sha256: Option<String>`.

- [ ] **Step 1: Failing test — Swap aktiviert neu und löscht alt**

In `src/karte/registry/repo.rs` im `mod tests` (nutzt `test_pool`, `neue_download_karte`, `markiere_bereit`, `aktiviere_offline_karte`):

```rust
#[tokio::test]
async fn ersetze_aktive_offline_karte_aktiviert_neu_und_loescht_alt() {
    let pool = test_pool().await;
    let alt = neue_download_karte(&pool, &OfflineDownloadEingabe {
        name: "DE".into(), quell_url: "https://e/de_v1.pmtiles".into(),
        lizenz: "ODbL".into(), kachel_schema: "protomaps".into(), sortier: 0,
    }).await.unwrap();
    markiere_bereit(&pool, alt.id, "karte-1.pmtiles", 10, "aaaa").await.unwrap();
    aktiviere_offline_karte(&pool, alt.id).await.unwrap();
    let neu = neue_download_karte(&pool, &OfflineDownloadEingabe {
        name: "DE".into(), quell_url: "https://e/de_v2.pmtiles".into(),
        lizenz: "ODbL".into(), kachel_schema: "protomaps".into(), sortier: 0,
    }).await.unwrap();
    markiere_bereit(&pool, neu.id, "karte-2.pmtiles", 20, "bbbb").await.unwrap();

    let aktiv = ersetze_aktive_offline_karte(&pool, neu.id, alt.id).await.unwrap().unwrap();

    assert_eq!(aktiv.id, neu.id);
    assert!(aktiv.aktiv_basemap, "neue Karte erbt aktiv (alt war aktiv)");
    let liste = liste_offline_karten(&pool).await.unwrap();
    assert_eq!(liste.len(), 1, "alte Zeile gelöscht");
    assert_eq!(liste[0].id, neu.id);
}

/// Diskriminierend (Advisor-Befund): Update einer INAKTIVEN Hintergrundkarte darf die aktive
/// Basemap NICHT klauen.
#[tokio::test]
async fn ersetze_offline_karte_inaktiv_laesst_aktive_basemap_unberuehrt() {
    let pool = test_pool().await;
    let eingabe = |name: &str, url: &str| OfflineDownloadEingabe {
        name: name.into(), quell_url: url.into(), lizenz: "ODbL".into(),
        kachel_schema: "protomaps".into(), sortier: 0,
    };
    // A ist die aktive Basemap.
    let a = neue_download_karte(&pool, &eingabe("A", "https://e/a.pmtiles")).await.unwrap();
    markiere_bereit(&pool, a.id, "karte-a.pmtiles", 10, "aaaa").await.unwrap();
    aktiviere_offline_karte(&pool, a.id).await.unwrap();
    // B ist inaktiv + bereit, B2 ist die heruntergeladene neue Version.
    let b = neue_download_karte(&pool, &eingabe("B", "https://e/b_v1.pmtiles")).await.unwrap();
    markiere_bereit(&pool, b.id, "karte-b.pmtiles", 10, "bbbb").await.unwrap();
    let b2 = neue_download_karte(&pool, &eingabe("B", "https://e/b_v2.pmtiles")).await.unwrap();
    markiere_bereit(&pool, b2.id, "karte-b2.pmtiles", 20, "bbcc").await.unwrap();

    let neu = ersetze_aktive_offline_karte(&pool, b2.id, b.id).await.unwrap().unwrap();

    assert!(!neu.aktiv_basemap, "neue B-Version bleibt inaktiv");
    let liste = liste_offline_karten(&pool).await.unwrap();
    assert!(liste.iter().find(|k| k.id == a.id).unwrap().aktiv_basemap, "aktive Basemap A unverändert");
    assert!(liste.iter().all(|k| k.id != b.id), "alte B-Zeile gelöscht");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy cargo test --lib karte::registry::repo::tests::ersetze`
Expected: FAIL — `ersetze_aktive_offline_karte` existiert nicht.

- [ ] **Step 3: Repo-Fn implementieren**

In `src/karte/registry/repo.rs` (z. B. direkt nach `aktiviere_offline_karte`):

```rust
/// One-Click-Update (B2): ersetzt die Karte `alt_id` durch `neu_id` in EINER Transaktion.
/// Die neue Version ERBT den Aktiv-Status der alten: war `alt` die aktive Basemap, wird `neu`
/// aktiv (und alle anderen deaktiviert); war `alt` eine INAKTIVE Hintergrundkarte, bleibt die
/// gerade aktive Basemap UNANGETASTET (sonst würde ein Update einer Hintergrundkarte die aktive
/// Basemap klauen). `alt` wird immer gelöscht. Datei-Cleanup von `alt`
/// (`entferne_download_dateien`) ist Sache des Aufrufers. `Ok(None)`, wenn `neu_id` nicht existiert.
pub async fn ersetze_aktive_offline_karte(
    pool: &SqlitePool,
    neu_id: i64,
    alt_id: i64,
) -> Result<Option<OfflineKarte>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let existiert: Option<i64> =
        sqlx::query_scalar("SELECT id FROM karte_offline_karte WHERE id = ?")
            .bind(neu_id)
            .fetch_optional(&mut *tx)
            .await?;
    if existiert.is_none() {
        return Ok(None);
    }
    // Aktiv-Status der ersetzten Karte lesen (None, falls alt nebenläufig schon weg ist).
    let alt_war_aktiv: Option<bool> =
        sqlx::query_scalar("SELECT aktiv_basemap FROM karte_offline_karte WHERE id = ?")
            .bind(alt_id)
            .fetch_optional(&mut *tx)
            .await?;
    if alt_war_aktiv == Some(true) {
        // Nur wenn alt die aktive Basemap war: deaktivieren → neu aktivieren (Index-sicher).
        sqlx::query(
            "UPDATE karte_offline_karte SET aktiv_basemap = 0, geaendert_at = datetime('now') \
             WHERE aktiv_basemap = 1",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE karte_offline_karte SET aktiv_basemap = 1, geaendert_at = datetime('now') \
             WHERE id = ?",
        )
        .bind(neu_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("DELETE FROM karte_offline_karte WHERE id = ?")
        .bind(alt_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    hole_offline_karte(pool, neu_id).await.map(Some)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy cargo test --lib karte::registry::repo::tests::ersetze`
Expected: PASS.

- [ ] **Step 5: `katalog_sha256` in der Karten-Antwort liefern**

In `src/routes/karte.rs`, `struct OfflineKarteAntwort` nach `katalog_url`:

```rust
    /// SHA256-Pin der aktuellen Katalog-URL (für den verifizierten Re-Download beim Update).
    pub katalog_sha256: Option<String>,
```

und in `offline_liste`, im `OfflineKarteAntwort { … }`-Literal nach `katalog_url: neuere.map(|e| e.url.clone()),`:

```rust
                katalog_sha256: neuere.and_then(|e| e.sha256.clone()),
```

- [ ] **Step 6: Download-Handler — Swap statt nur Auto-Aktivieren**

In `src/routes/karte.rs`, vor dem `tokio::spawn` (bei den `let … = … .clone();`):

```rust
    let ersetzt_karte_id = body.ersetzt_karte_id;
```

Im Ok-Zweig des Spawn den `else`-Block (heute `aktiviere_wenn_keine_aktive`) ersetzen:

```rust
                } else if let Some(alt) = ersetzt_karte_id {
                    // One-Click-Update (B2): neue Version aktivieren, alte Karte + Datei entfernen.
                    match repo::ersetze_aktive_offline_karte(&pool, id, alt).await {
                        Ok(Some(_)) => {
                            download::entferne_download_dateien(&karten_dir, alt).await;
                            tracing::info!("Offline-Karte {id}: Update aktiviert, alte Karte {alt} entfernt");
                        }
                        Ok(None) => tracing::warn!("Update-Swap {id}: neue Karte verschwand"),
                        Err(e) => tracing::error!("Update-Swap {id}→ersetzt {alt} fehlgeschlagen: {e}"),
                    }
                } else {
                    // Erst-Download: erste bereite Karte automatisch aktivieren (Bestand bleibt).
                    match repo::aktiviere_wenn_keine_aktive(&pool, id).await {
                        Ok(true) => {
                            tracing::info!("Offline-Karte {id}: als Basemap aktiviert (erste bereite)");
                        }
                        Ok(false) => {}
                        Err(e) => {
                            tracing::warn!("Auto-Aktivieren der Offline-Karte {id} fehlgeschlagen: {e}");
                        }
                    }
                }
```

(`karten_dir` ist im Spawn bereits geklont vorhanden. Bei Download-FEHLER bleibt die alte Karte unangetastet — der Swap steht nur im Ok-Zweig.)

- [ ] **Step 7: Gate — Tests + Clippy**

Run: `rtk proxy cargo test --lib karte && rtk proxy cargo clippy --all-targets -- -D warnings`
Expected: PASS, keine Warnungen.

- [ ] **Step 8: Commit**

```bash
git add src/karte/registry/repo.rs src/routes/karte.rs
git commit -m "feat(lfh-183): One-Click-Update (Swap neu↔alt) + Katalog-Hash in der Offline-Karten-Antwort"
```

---

### Task 3: Frontend — SHA256-Pin durch beide Download-Pfade + One-Click-Update

**Files:**
- Modify: `frontend/src/api/offlineKarten.ts` (`OfflineKarte` ~12-31, `OfflineDownloadBody` ~34-42, `OfflineKatalogEintrag` ~45-53)
- Modify: `frontend/src/karten/OfflineDownloadKatalogModal.tsx` (`starteOfflineDownload`-Aufruf ~37-42) — Erst-Download
- Modify: `frontend/src/karten/OfflineKartenVerwaltung.tsx` (`aktualisierenMutation` ~79-92) — Update/Re-Download
- Test: neue `frontend/src/karten/OfflineDownloadKatalogModal.test.tsx`; bestehende `frontend/src/karten/OfflineKartenVerwaltung.test.tsx`

**Interfaces:**
- Consumes: Backend `OfflineKatalogEintrag.sha256` (Task 1), `OfflineDownloadBody.{sha256_erwartet, ersetzt_karte_id}` (Task 1), `OfflineKarteAntwort.katalog_sha256` (Task 2b).
- Produces: Erst-Download (Katalog-Modal) sendet `sha256_erwartet = eintrag.sha256`. Update (`aktualisierenMutation`) sendet `sha256_erwartet = k.katalog_sha256` UND `ersetzt_karte_id = k.id`.

- [ ] **Step 1: Failing tests — beide Pfade reichen Pin (+ Update den Swap) durch**

`frontend/src/karten/OfflineDownloadKatalogModal.test.tsx` (Erst-Download): Katalog mit einem Eintrag mit `sha256` mocken, „Herunterladen" klicken, prüfen:

```tsx
expect(starteOfflineDownload).toHaveBeenCalledWith(
  expect.objectContaining({ url: 'https://eigen/de_bremen.pmtiles', sha256_erwartet: 'cafef00d' }),
);
```

In `frontend/src/karten/OfflineKartenVerwaltung.test.tsx` (Update): eine bereite Karte mit `update_verfuegbar: true`, `katalog_url`, `katalog_sha256: 'cafef00d'` mocken, „Aktualisieren" klicken, prüfen:

```tsx
expect(starteOfflineDownload).toHaveBeenCalledWith(
  expect.objectContaining({ url: 'https://eigen/de_bremen_v2.pmtiles', sha256_erwartet: 'cafef00d', ersetzt_karte_id: 1 }),
);
```

(Mock-Form an die vorhandenen `vi.mock('../api/offlineKarten')`-Tests anlehnen; Buttons über Rolle+Text greifen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend test --run OfflineDownloadKatalogModal OfflineKartenVerwaltung`
Expected: FAIL — `sha256_erwartet`/`ersetzt_karte_id` fehlen; `sha256`/`katalog_sha256` noch keine Felder.

- [ ] **Step 3: Typen erweitern**

In `frontend/src/api/offlineKarten.ts` zu `interface OfflineKarte` (nach `katalog_url`):

```ts
  /** SHA256-Pin der aktuellen Katalog-URL (für verifizierten Re-Download beim Update). */
  katalog_sha256?: string | null;
```

zu `interface OfflineDownloadBody`:

```ts
  /** Erwarteter SHA256 (hex) aus dem Katalog-Pin — Backend verifiziert beim Download. */
  sha256_erwartet?: string;
  /** One-Click-Update: id der Karte, die dieser Download ersetzt (Backend swappt nach Erfolg). */
  ersetzt_karte_id?: number;
```

zu `interface OfflineKatalogEintrag`:

```ts
  /** Optionaler SHA256-Pin (hex); null/undefined = kein Pin. */
  sha256?: string | null;
```

- [ ] **Step 4: Erst-Download (Katalog-Modal) reicht den Pin durch**

In `frontend/src/karten/OfflineDownloadKatalogModal.tsx` im `starteOfflineDownload({ … })`-Objekt (nach `groesse_erwartet: eintrag.groesse,`):

```tsx
          groesse_erwartet: eintrag.groesse,
          sha256_erwartet: eintrag.sha256 ?? undefined,
```

- [ ] **Step 5: Update reicht Pin + `ersetzt_karte_id` durch (One-Click)**

In `frontend/src/karten/OfflineKartenVerwaltung.tsx`, `aktualisierenMutation` (~79-92):

```tsx
  const aktualisierenMutation = useMutation({
    mutationFn: (k: OfflineKarte) =>
      starteOfflineDownload({
        name: k.name,
        url: k.katalog_url!,
        lizenz: k.lizenz ?? '',
        kachel_schema: k.kachel_schema,
        sha256_erwartet: k.katalog_sha256 ?? undefined,
        ersetzt_karte_id: k.id,
        // Disk-Pre-Check: während des Updates liegen alt+neu gleichzeitig (alt erst nach Erfolg
        // gelöscht) → ~2× Peak. Erwartete Größe für den Plattenplatz-Check mitschicken.
        groesse_erwartet: k.groesse ?? undefined,
      }),
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Update lädt — wird nach Abschluss automatisch aktiviert');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktualisieren fehlgeschlagen'),
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend test --run OfflineDownloadKatalogModal OfflineKartenVerwaltung`
Expected: PASS.

- [ ] **Step 7: Lint + Typecheck als Gate**

Run: `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend lint && mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend exec tsc --noEmit`
Expected: PASS, 0 Warnings.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/offlineKarten.ts frontend/src/karten/OfflineDownloadKatalogModal.tsx frontend/src/karten/OfflineDownloadKatalogModal.test.tsx frontend/src/karten/OfflineKartenVerwaltung.tsx frontend/src/karten/OfflineKartenVerwaltung.test.tsx
git commit -m "feat(lfh-183): sha256-Pin in beide Download-Pfade + One-Click-Update (ersetzt_karte_id)"
```

---

### Task 4: Build-Tooling + Runbook (Ops-Rezept — kein TDD)

**Files:**
- Create: `scripts/build-offline-karten.sh`
- Create: `docs/superpowers/specs/2026-06-27-offline-karten-eigenmirror.md`

Diese Task liefert das **reproduzierbare Rezept**, mit dem die Extracts gebaut, schema-verifiziert, gehasht und gehostet werden. Sie führt den Build NICHT aus (braucht `pmtiles`-CLI + mehrere GB Netz + Hosting-Zugang) — das ist der Ops-Schritt vor Task 5.

- [ ] **Step 1: Build-Skript schreiben**

`scripts/build-offline-karten.sh` — nimmt das Daily-Datum + ein Verzeichnis mit Bundesland-GeoJSONs, extrahiert je Region, berechnet sha256, gibt einen Katalog-Snippet aus. Kernlogik:

```bash
#!/usr/bin/env bash
set -euo pipefail
# LFH-183: Eigen-Extract der DACH-Karten aus dem offiziellen Protomaps-Daily-Build.
# Voraussetzung: `pmtiles` CLI (github.com/protomaps/go-pmtiles) im PATH.
#
# Usage: build-offline-karten.sh <YYYYMMDD> <geojson-dir> <out-dir>
#   <YYYYMMDD>     Daily-Build-Datum (https://build.protomaps.com/<datum>.pmtiles, ~7 Tage Retention)
#   <geojson-dir>  Verzeichnis mit <slug>.geojson je Region (Bundesland-Grenzen, OSM admin_level=4)
#   <out-dir>      Zielverzeichnis für die .pmtiles + catalog-snippet.txt
DATUM="${1:?YYYYMMDD}"; GEO="${2:?geojson-dir}"; OUT="${3:?out-dir}"
PLANET="https://build.protomaps.com/${DATUM}.pmtiles"
MAXZOOM=15  # Parität zu N.O.M.A.D. (z0-15); Task-Vorschlag war 14 — höher = schärfer, größer.
mkdir -p "$OUT"; : > "$OUT/catalog-snippet.txt"
for gj in "$GEO"/*.geojson; do
  slug="$(basename "$gj" .geojson)"
  echo ">> extract $slug aus $PLANET (HTTP-Range gegen den Planet)"
  pmtiles extract "$PLANET" "$OUT/${slug}_${DATUM}.pmtiles" --region="$gj" --maxzoom="$MAXZOOM"
  sha="$(shasum -a 256 "$OUT/${slug}_${DATUM}.pmtiles" | awk '{print $1}')"
  bytes="$(wc -c < "$OUT/${slug}_${DATUM}.pmtiles")"
  printf '%s\turl=%s_%s.pmtiles\tgroesse=%s\tsha256=%s\n' "$slug" "$slug" "$DATUM" "$bytes" "$sha" \
    >> "$OUT/catalog-snippet.txt"
done
echo "Fertig. Snippet: $OUT/catalog-snippet.txt — Hashes/Größen nach src/config.rs übertragen."
```

- [ ] **Step 2: Skript ausführbar machen**

```bash
chmod +x scripts/build-offline-karten.sh
```

- [ ] **Step 3: Runbook schreiben**

`docs/superpowers/specs/2026-06-27-offline-karten-eigenmirror.md` mit den Abschnitten:
- **Warum** (Supply-Chain: weg vom Single-Maintainer-N.O.M.A.D., LFH-183 / Folge aus LFH-181).
- **Voraussetzungen:** `pmtiles` CLI installieren (`brew install protomaps/tap/pmtiles` o. `go install github.com/protomaps/go-pmtiles@latest`); Bundesland-Grenzen als GeoJSON (Quelle dokumentieren, z. B. OSM `admin_level=4` via Overpass/geoBoundaries) — die 16 Bundesländer + AT + CH.
- **Schema-Gate (PFLICHT, vor Massen-Build):** EIN kleines Bundesland extrahieren (z. B. Bremen), `pmtiles show <datei>` prüfen → `vector_layers` müssen `earth/landuse/water/roads/buildings` enthalten (= Protomaps-Schema, rendert mit unserem `offlineStyle()`). NICHT Shortbread. Dann lokal als Karte laden und Render im Browser-Smoke bestätigen. Erst danach alle Regionen bauen.
- **Build:** `scripts/build-offline-karten.sh <datum> <geojson-dir> <out-dir>` (Datum aus `build.protomaps.com`, ~7 Tage Retention → zeitnah bauen).
- **Hosting:** projektkontrolliert — entweder eigener S3/R2-Bucket (Sidecar; >2 GB-Dateien möglich) ODER GitHub-Release des Projekts (frei, je Datei ≤ 2 GB — passt bundeslandgranular). HTTPS-URLs notieren.
- **Katalog-Pflege (= Task 5):** `BASIS` in `src/config.rs` auf die eigene URL setzen, je Eintrag `sha256: Some("…")` aus `catalog-snippet.txt`, `QUELLE` anpassen, N.O.M.A.D.-Konstanten entfernen.
- **Frequenz/Datenstand:** ODbL-Daten ändern sich laufend; Empfehlung: quartalsweise oder ad hoc neu bauen; Datenstand (Build-Datum) im Katalog-Namen/Doku führen.

- [ ] **Step 4: Sanity-Check des Skripts (Syntax)**

Run: `bash -n scripts/build-offline-karten.sh`
Expected: kein Output (Syntax ok). `pmtiles` selbst wird hier NICHT ausgeführt.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-offline-karten.sh docs/superpowers/specs/2026-06-27-offline-karten-eigenmirror.md
git commit -m "docs(lfh-183): Eigen-Extract-Runbook + Build-Skript für Offline-Karten aus Protomaps"
```

---

### Task 5: GATED — Katalog auf Eigen-Mirror umstellen, N.O.M.A.D. entfernen

> **NICHT in dieser Session ausführbar.** Voraussetzung: der Ops-Schritt (Task-4-Runbook) ist gelaufen — Extracts gebaut, **Schema-Gate bestanden**, gehostet, und die echten **URLs + SHA256** liegen vor. Diese Task ist der finale, kleine Code-Flip.

**Files:**
- Modify: `src/config.rs` (`default_offline_katalog` + Test)

**Interfaces:**
- Consumes: gehostete URLs + sha256 je Region (Ops-Ergebnis), Feld `sha256` (Task 1).

- [ ] **Step 1: Failing test — Katalog ist projektkontrolliert + gepinnt**

Den vorhandenen Test `offline_katalog_ist_kuratiert_und_konsistent` erweitern bzw. `katalog_eintrag_sha256_optional_und_serialisiert` umstellen:

```rust
    for e in default_offline_katalog() {
        assert!(!e.url.contains("whitespring"), "kein N.O.M.A.D.-Hotlink mehr: {}", e.url);
        assert!(e.sha256.as_deref().is_some_and(|h| h.len() == 64), "SHA256 gepinnt: {}", e.name);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy cargo test --lib config::tests::offline_katalog`
Expected: FAIL — URLs zeigen noch auf `whitespring`, `sha256` ist `None`.

- [ ] **Step 3: `BASIS`, `QUELLE`, Hashes umstellen**

In `default_offline_katalog()`: `BASIS` auf die eigene Storage-URL, `QUELLE` auf den Eigen-Mirror-Text, je Eintrag `sha256: Some("…")` aus dem `catalog-snippet.txt`. (Dateinamen/Schema ggf. an die selbst gebauten Slugs anpassen.) N.O.M.A.D.-spezifische Kommentare/Konstanten entfernen.

- [ ] **Step 4: Run tests + voller Gate**

Run: `rtk proxy cargo test --lib config && rtk proxy cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 5: Browser-Smoke**

Eine Karte aus dem neuen Katalog herunterladen, aktivieren, in der Lagekarte rendern lassen (offline). Pin-Verifikation greift live: bei korrektem Hash `bereit`, bei Manipulation `fehler`.

- [ ] **Step 6: Commit**

```bash
git add src/config.rs
git commit -m "feat(lfh-183): Offline-Katalog auf eigenen Protomaps-Mirror umgestellt, N.O.M.A.D. entfernt"
```

---

## Ops-Handoff (zwischen Task 4 und Task 5 — durch den User)

1. `pmtiles` CLI installieren.
2. Bundesland-/Länder-GeoJSONs beschaffen (16 + AT + CH).
3. **Schema-Gate:** Bremen extrahieren → `pmtiles show` → `vector_layers` prüfen → lokal rendern. Nur bei Erfolg weiter.
4. `scripts/build-offline-karten.sh` für alle Regionen laufen lassen.
5. Output auf projektkontrollierten Storage (S3/R2 oder Projekt-Release) hochladen.
6. `catalog-snippet.txt` (URLs, Größen, SHA256) zurückgeben → ermöglicht Task 5.

---

## Self-Review

- **Spec coverage:** AK „projektkontrollierte stabile URL" → Task 5 (gated). AK „SHA256 je Eintrag + beim Download geprüft" → Tasks 1–3 (Code) + Task 5 (Werte). AK „Re-Build-Prozess dokumentiert" → Task 4. Variante-B-Quelle (`build.protomaps.com`) → Task 4 Build-Skript. Schema-Risiko → Global Constraint + Task-4-Gate.
- **Placeholder-Scan:** Code-Schritte zeigen konkreten Code; Task 4/5-Werte (echte URLs/Hashes) sind bewusst Ops-Output, kein Plan-Placeholder.
- **Typ-Konsistenz:** `sha256` (Katalog/Frontend), `sha256_erwartet` + `ersetzt_karte_id` (Download-Body, beide Seiten), `erwartet_sha256` (`lade_datei`-Param), `DownloadFehler::HashMismatch { erwartet, ist }`, `katalog_sha256` (`OfflineKarteAntwort`/Frontend-`OfflineKarte`), `ersetze_aktive_offline_karte(neu_id, alt_id)` — durchgängig.
- **Re-Download-Pin-Lücke (Phase-1-Scope-Befund) — GESCHLOSSEN:** Der Update-Pfad (`aktualisierenMutation`) reicht den Pin jetzt über `OfflineKarteAntwort.katalog_sha256` mit (Task 2b liefert ihn, Task 3 Step 5 sendet ihn). Damit verifizieren BEIDE Download-Pfade gegen den Pin, sobald Task 5 die Hashes setzt — kein Fail-Open mehr. Der manuelle URL-Download (`OfflineDownloadUrlModal`) hat bewusst keinen Pin (kein Katalog-Eintrag) — korrekt, kein Bug.
- **B2 Verhalten:** One-Click-Update aktiviert die neue Version und löscht die alte nur im Download-Ok-Zweig; bei Fehler/HashMismatch bleibt die alte Karte aktiv (fail-safe). Die neue Version **erbt den Aktiv-Status** der ersetzten (Update einer inaktiven Karte lässt die aktive Basemap in Ruhe). A1: keine Koexistenz/Overlay-Arbeit.
- **Bekannte Limitierung (nicht in LFH-183, geflaggt):** Double-Submit beim Update — die alte `bereit`-Zeile behält ihren „Aktualisieren"-Button während des mehrminütigen Update-Downloads (die neue Zeile ist `laedt`), ein zweiter Klick spawnt einen zweiten Ersatz desselben `alt`. Vorbestehende Klasse; eigentlicher Fix wäre ein `laedt`-Guard am Button. Als Folge-Task notieren, hier nicht gejagt.
