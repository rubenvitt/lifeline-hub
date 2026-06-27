//! CRUD- und Lese-Queries der Karten-Registry (runtime-queries, Muster wie `benutzer.rs`).

use crate::config::{OnlineStyle, OnlineStyleTyp};
use serde::Serialize;
use sqlx::SqlitePool;

/// Eine Online-Quelle als DB-Zeile (Admin-CRUD; trägt `id`/`sortier`/`aktiv`, anders als das
/// schlanke Laufzeit-`OnlineStyle`). `typ` bleibt String ('vektor'|'raster') — serialisiert
/// lowercase wie im Frontend-Vertrag; Validierung der Werte im Handler.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OnlineQuelle {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub typ: String,
    pub attribution: Option<String>,
    pub sortier: i64,
    pub aktiv: bool,
}

/// Eingabefelder zum Anlegen/Aktualisieren einer Online-Quelle (vom Handler aus dem JSON-Body).
pub struct OnlineQuelleEingabe {
    pub name: String,
    pub url: String,
    pub typ: String,
    pub attribution: Option<String>,
    pub sortier: i64,
    pub aktiv: bool,
}

/// FromRow-Helfer: liest eine Online-Quelle und mappt den `typ`-String aufs Enum.
/// (Hält `config.rs` serde-only — kein `sqlx::Type`-Derive auf `OnlineStyleTyp`.)
#[derive(sqlx::FromRow)]
struct OnlineStyleRow {
    name: String,
    url: String,
    typ: String,
    attribution: Option<String>,
}

impl From<OnlineStyleRow> for OnlineStyle {
    fn from(r: OnlineStyleRow) -> Self {
        // `typ` ist per CHECK auf 'vektor'|'raster' beschränkt → `_` sicher als Vektor.
        let typ = match r.typ.as_str() {
            "raster" => OnlineStyleTyp::Raster,
            _ => OnlineStyleTyp::Vektor,
        };
        OnlineStyle {
            name: r.name,
            url: r.url,
            typ,
            attribution: r.attribution,
        }
    }
}

/// Aktive Online-Quellen als `OnlineStyle` (für `GET /api/karte/config`), nach `sortier`, `id`.
pub async fn aktive_online_styles(pool: &SqlitePool) -> Result<Vec<OnlineStyle>, sqlx::Error> {
    let rows = sqlx::query_as::<_, OnlineStyleRow>(
        "SELECT name, url, typ, attribution FROM karte_online_quelle \
         WHERE aktiv = 1 ORDER BY sortier, id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(OnlineStyle::from).collect())
}

// Hinweis (sqlx 0.9): `query_as` akzeptiert nur `&'static str` (SqlSafeStr) — kein `format!`-
// String. Die Spaltenliste wird daher als Literal je Query wiederholt, nicht zentral geteilt.

/// Eine Online-Quelle per `id` lesen (interner Helfer für Anlegen/Aktualisieren).
async fn hole_online_quelle(pool: &SqlitePool, id: i64) -> Result<OnlineQuelle, sqlx::Error> {
    sqlx::query_as::<_, OnlineQuelle>(
        "SELECT id, name, url, typ, attribution, sortier, aktiv \
         FROM karte_online_quelle WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
}

/// Alle Online-Quellen (auch inaktive) für die Admin-Liste, nach `sortier`, `id`.
pub async fn liste_online_quellen(pool: &SqlitePool) -> Result<Vec<OnlineQuelle>, sqlx::Error> {
    sqlx::query_as::<_, OnlineQuelle>(
        "SELECT id, name, url, typ, attribution, sortier, aktiv \
         FROM karte_online_quelle ORDER BY sortier, id",
    )
    .fetch_all(pool)
    .await
}

/// Legt eine neue Online-Quelle an und gibt die erzeugte Zeile zurück.
pub async fn anlegen_online_quelle(
    pool: &SqlitePool,
    eingabe: &OnlineQuelleEingabe,
) -> Result<OnlineQuelle, sqlx::Error> {
    let id = sqlx::query(
        "INSERT INTO karte_online_quelle (name, url, typ, attribution, sortier, aktiv) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&eingabe.name)
    .bind(&eingabe.url)
    .bind(&eingabe.typ)
    .bind(&eingabe.attribution)
    .bind(eingabe.sortier)
    .bind(eingabe.aktiv)
    .execute(pool)
    .await?
    .last_insert_rowid();
    hole_online_quelle(pool, id).await
}

/// Aktualisiert eine Online-Quelle vollständig. `Ok(None)`, wenn keine Zeile mit `id` existiert.
pub async fn aktualisiere_online_quelle(
    pool: &SqlitePool,
    id: i64,
    eingabe: &OnlineQuelleEingabe,
) -> Result<Option<OnlineQuelle>, sqlx::Error> {
    let betroffen = sqlx::query(
        "UPDATE karte_online_quelle \
         SET name = ?, url = ?, typ = ?, attribution = ?, sortier = ?, aktiv = ?, \
             geaendert_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(&eingabe.name)
    .bind(&eingabe.url)
    .bind(&eingabe.typ)
    .bind(&eingabe.attribution)
    .bind(eingabe.sortier)
    .bind(eingabe.aktiv)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Ok(None);
    }
    hole_online_quelle(pool, id).await.map(Some)
}

/// Löscht eine Online-Quelle. `Ok(true)`, wenn eine Zeile entfernt wurde.
pub async fn loesche_online_quelle(pool: &SqlitePool, id: i64) -> Result<bool, sqlx::Error> {
    let betroffen = sqlx::query("DELETE FROM karte_online_quelle WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    Ok(betroffen > 0)
}

// --- Offline-Karten (PMTiles) ---

/// Eine Offline-Karte als DB-Zeile (Admin-CRUD). `aktiv_basemap` = die von `/tiles` ausgelieferte
/// Karte; `status` und die Download-Felder (groesse/sha256/download_at) pflegt LFH-181.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OfflineKarte {
    pub id: i64,
    pub name: String,
    pub pfad: String,
    pub quell_url: Option<String>,
    pub lizenz: Option<String>,
    pub kachel_schema: String,
    pub groesse: Option<i64>,
    pub sha256: Option<String>,
    pub download_at: Option<String>,
    pub status: String,
    pub aktiv_basemap: bool,
    pub sortier: i64,
}

/// Eingabefelder zum Registrieren einer Offline-Karte (Grundstein: extern vorhandene Datei).
pub struct OfflineKarteEingabe {
    pub name: String,
    pub pfad: String,
    pub quell_url: Option<String>,
    pub lizenz: Option<String>,
    pub kachel_schema: String,
    pub sortier: i64,
}

/// Eine Offline-Karte per `id` lesen (interner Helfer).
async fn hole_offline_karte(pool: &SqlitePool, id: i64) -> Result<OfflineKarte, sqlx::Error> {
    sqlx::query_as::<_, OfflineKarte>(
        "SELECT id, name, pfad, quell_url, lizenz, kachel_schema, groesse, sha256, download_at, \
                status, aktiv_basemap, sortier \
         FROM karte_offline_karte WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
}

/// Pfad der aktiven, ausliefer-bereiten Offline-Karte (für `GET /api/karte/tiles.pmtiles`).
pub async fn aktive_offline_karte_pfad(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT pfad FROM karte_offline_karte \
         WHERE aktiv_basemap = 1 AND status = 'bereit' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
}

/// Gibt es eine aktive, ausliefer-bereite Offline-Karte? (für `pmtiles_verfuegbar` in `/config`).
pub async fn pmtiles_verfuegbar(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    let anzahl: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM karte_offline_karte \
         WHERE aktiv_basemap = 1 AND status = 'bereit')",
    )
    .fetch_one(pool)
    .await?;
    Ok(anzahl != 0)
}

/// Alle Offline-Karten für die Admin-Liste, nach `sortier`, `id`.
pub async fn liste_offline_karten(pool: &SqlitePool) -> Result<Vec<OfflineKarte>, sqlx::Error> {
    sqlx::query_as::<_, OfflineKarte>(
        "SELECT id, name, pfad, quell_url, lizenz, kachel_schema, groesse, sha256, download_at, \
                status, aktiv_basemap, sortier \
         FROM karte_offline_karte ORDER BY sortier, id",
    )
    .fetch_all(pool)
    .await
}

/// Registriert eine (extern vorhandene) Offline-Karte mit `status = 'bereit'`, nicht aktiv.
pub async fn registriere_offline_karte(
    pool: &SqlitePool,
    eingabe: &OfflineKarteEingabe,
) -> Result<OfflineKarte, sqlx::Error> {
    let id = sqlx::query(
        "INSERT INTO karte_offline_karte \
             (name, pfad, quell_url, lizenz, kachel_schema, sortier, status, aktiv_basemap) \
         VALUES (?, ?, ?, ?, ?, ?, 'bereit', 0)",
    )
    .bind(&eingabe.name)
    .bind(&eingabe.pfad)
    .bind(&eingabe.quell_url)
    .bind(&eingabe.lizenz)
    .bind(&eingabe.kachel_schema)
    .bind(eingabe.sortier)
    .execute(pool)
    .await?
    .last_insert_rowid();
    hole_offline_karte(pool, id).await
}

/// Aktiviert eine Offline-Karte EXKLUSIV (alle anderen werden deaktiviert — sonst verletzt der
/// partielle Unique-Index `idx_offline_eine_aktive`). `Ok(None)`, wenn keine Zeile mit `id` existiert.
pub async fn aktiviere_offline_karte(
    pool: &SqlitePool,
    id: i64,
) -> Result<Option<OfflineKarte>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let existiert: Option<i64> =
        sqlx::query_scalar("SELECT id FROM karte_offline_karte WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    if existiert.is_none() {
        return Ok(None);
    }
    // Erst alle deaktivieren, DANN diese aktivieren — sonst kollidieren zwei aktive Zeilen
    // mit dem partiellen Unique-Index.
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
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    hole_offline_karte(pool, id).await.map(Some)
}

/// Löscht eine Offline-Karte. `Ok(true)`, wenn eine Zeile entfernt wurde.
pub async fn loesche_offline_karte(pool: &SqlitePool, id: i64) -> Result<bool, sqlx::Error> {
    let betroffen = sqlx::query("DELETE FROM karte_offline_karte WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    Ok(betroffen > 0)
}

// --- Offline-Download-Lebenszyklus (LFH-181) ---
// Verdrahtet den Download-Manager in die schon vorhandenen Lifecycle-Felder (Migration 0076):
// FSM laedt → bereit/fehler. `registriere_offline_karte` (Status 'bereit') wird NICHT überladen.

/// Eingabefelder zum Anlegen einer herunterzuladenden Offline-Karte. `quell_url` und `lizenz`
/// sind Pflicht (Server-seitiger Fetch + Offline-Attributionspflicht); der `pfad` wird nicht
/// übergeben, sondern aus der erzeugten `id` abgeleitet (`markiere_bereit`).
pub struct OfflineDownloadEingabe {
    pub name: String,
    pub quell_url: String,
    pub lizenz: String,
    pub kachel_schema: String,
    pub sortier: i64,
}

/// Legt eine Download-Zeile im Status `'laedt'` an (noch ohne Datei; `pfad` leerer Platzhalter,
/// bis `markiere_bereit` den finalen relativen Pfad setzt). Nicht aktiv.
pub async fn neue_download_karte(
    pool: &SqlitePool,
    eingabe: &OfflineDownloadEingabe,
) -> Result<OfflineKarte, sqlx::Error> {
    let id = sqlx::query(
        "INSERT INTO karte_offline_karte \
             (name, pfad, quell_url, lizenz, kachel_schema, sortier, status, aktiv_basemap) \
         VALUES (?, '', ?, ?, ?, ?, 'laedt', 0)",
    )
    .bind(&eingabe.name)
    .bind(&eingabe.quell_url)
    .bind(&eingabe.lizenz)
    .bind(&eingabe.kachel_schema)
    .bind(eingabe.sortier)
    .execute(pool)
    .await?
    .last_insert_rowid();
    hole_offline_karte(pool, id).await
}

/// Setzt den Status (FSM-Übergang). `Ok(true)`, wenn eine Zeile betroffen war. Aufrufer geben
/// nur DB-CHECK-gültige Werte (`registriert`/`laedt`/`bereit`/`fehler`).
pub async fn setze_status(pool: &SqlitePool, id: i64, status: &str) -> Result<bool, sqlx::Error> {
    let betroffen = sqlx::query(
        "UPDATE karte_offline_karte SET status = ?, geaendert_at = datetime('now') WHERE id = ?",
    )
    .bind(status)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(betroffen > 0)
}

/// Markiert eine ladende Karte als `'bereit'`: finaler relativer Pfad + Download-Metadaten
/// (groesse/sha256/download_at). `Ok(None)`, wenn keine Zeile mit `id` existiert.
pub async fn markiere_bereit(
    pool: &SqlitePool,
    id: i64,
    pfad: &str,
    groesse: i64,
    sha256: &str,
) -> Result<Option<OfflineKarte>, sqlx::Error> {
    let betroffen = sqlx::query(
        "UPDATE karte_offline_karte \
         SET status = 'bereit', pfad = ?, groesse = ?, sha256 = ?, \
             download_at = datetime('now'), geaendert_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(pfad)
    .bind(groesse)
    .bind(sha256)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Ok(None);
    }
    hole_offline_karte(pool, id).await.map(Some)
}

/// Aktiviert die `bereit`e Karte `id` als Basemap, ABER nur solange noch KEINE andere Karte aktiv
/// ist — die erste fertig heruntergeladene Karte wird automatisch ausgeliefert (sonst bliebe der
/// Offline-Schalter trotz Download „nicht konfiguriert"). Eine bereits aktive Karte wird bewusst
/// NICHT verdrängt. `Ok(true)`, wenn aktiviert wurde; `Ok(false)` ist der erwartete No-op
/// (schon eine aktiv, Karte nicht `bereit` oder unbekannt). Der `NOT EXISTS`-Guard macht das Setzen
/// race-sicher: SQLite serialisiert Writer, ein zweiter parallel fertig werdender Download sieht
/// die aktive Zeile und greift nicht — der partielle Unique-Index `idx_offline_eine_aktive`
/// bleibt der Backstop.
pub async fn aktiviere_wenn_keine_aktive(pool: &SqlitePool, id: i64) -> Result<bool, sqlx::Error> {
    let betroffen = sqlx::query(
        "UPDATE karte_offline_karte SET aktiv_basemap = 1, geaendert_at = datetime('now') \
         WHERE id = ? AND status = 'bereit' \
           AND NOT EXISTS (SELECT 1 FROM karte_offline_karte WHERE aktiv_basemap = 1)",
    )
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(betroffen > 0)
}

/// Crash-Recovery beim Start: alle im Status `'laedt'` hängenden Zeilen auf `'fehler'` setzen
/// und ihre `id`s zurückgeben (Aufrufer löscht die verwaisten `*.part`-Dateien). Spawned
/// Download-Tasks überleben keinen Neustart.
pub async fn reset_haengende_downloads(pool: &SqlitePool) -> Result<Vec<i64>, sqlx::Error> {
    let ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM karte_offline_karte WHERE status = 'laedt'")
            .fetch_all(pool)
            .await?;
    if !ids.is_empty() {
        sqlx::query(
            "UPDATE karte_offline_karte SET status = 'fehler', geaendert_at = datetime('now') \
             WHERE status = 'laedt'",
        )
        .execute(pool)
        .await?;
    }
    Ok(ids)
}

/// Eine Offline-Karte per `id`, oder `None` — für Guards (Re-Download der aktiven Karte,
/// Concurrency gegen Doppel-Download).
pub async fn finde_offline_karte(
    pool: &SqlitePool,
    id: i64,
) -> Result<Option<OfflineKarte>, sqlx::Error> {
    sqlx::query_as::<_, OfflineKarte>(
        "SELECT id, name, pfad, quell_url, lizenz, kachel_schema, groesse, sha256, download_at, \
                status, aktiv_basemap, sortier \
         FROM karte_offline_karte WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Ausspielungs-Infos der aktiven Offline-Karte für `GET /api/karte/config`.
pub struct AktiveOfflineKarte {
    pub pfad: String,
    /// Cache-Bust-Token (`?v=…`): `sha256`, sonst `geaendert_at` (registrierte Dateien ohne
    /// Download tragen kein sha256). Wechselt bei jedem Karten-Swap → frischer pmtiles-Cache.
    pub version: String,
    /// Lizenz/Attribution der aktiven Karte (offline sichtbar zu machen).
    pub lizenz: Option<String>,
}

/// Die aktive, ausliefer-bereite Offline-Karte mit Cache-Bust-Token + Lizenz, oder `None`.
pub async fn aktive_offline_karte(
    pool: &SqlitePool,
) -> Result<Option<AktiveOfflineKarte>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct Row {
        pfad: String,
        sha256: Option<String>,
        geaendert_at: String,
        lizenz: Option<String>,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT pfad, sha256, geaendert_at, lizenz FROM karte_offline_karte \
         WHERE aktiv_basemap = 1 AND status = 'bereit' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| AktiveOfflineKarte {
        pfad: r.pfad,
        version: r.sha256.unwrap_or(r.geaendert_at),
        lizenz: r.lizenz,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;

    #[tokio::test]
    async fn aktive_online_styles_nur_aktive_sortiert() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO karte_online_quelle (name,url,typ,attribution,sortier,aktiv) \
             VALUES (?,?,?,?,?,?)",
        )
        .bind("B")
        .bind("https://b")
        .bind("vektor")
        .bind(None::<String>)
        .bind(2)
        .bind(1)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO karte_online_quelle (name,url,typ,attribution,sortier,aktiv) \
             VALUES (?,?,?,?,?,?)",
        )
        .bind("A")
        .bind("https://a")
        .bind("raster")
        .bind(Some("© X"))
        .bind(1)
        .bind(1)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO karte_online_quelle (name,url,typ,sortier,aktiv) VALUES (?,?,?,?,?)")
            .bind("Inaktiv")
            .bind("https://i")
            .bind("vektor")
            .bind(0)
            .bind(0)
            .execute(&pool)
            .await
            .unwrap();

        let styles = aktive_online_styles(&pool).await.unwrap();
        assert_eq!(styles.len(), 2, "inaktive Quelle ausgeschlossen");
        assert_eq!(styles[0].name, "A", "sortier 1 vor 2");
        assert_eq!(styles[0].typ, OnlineStyleTyp::Raster);
        assert_eq!(styles[1].name, "B");
    }

    fn eingabe(name: &str, sortier: i64, aktiv: bool) -> OnlineQuelleEingabe {
        OnlineQuelleEingabe {
            name: name.into(),
            url: format!("https://{name}"),
            typ: "vektor".into(),
            attribution: Some("© Test".into()),
            sortier,
            aktiv,
        }
    }

    #[tokio::test]
    async fn liste_online_quellen_enthaelt_auch_inaktive_sortiert() {
        let pool = test_pool().await;
        anlegen_online_quelle(&pool, &eingabe("B", 2, true)).await.unwrap();
        anlegen_online_quelle(&pool, &eingabe("A", 1, false)).await.unwrap();
        let liste = liste_online_quellen(&pool).await.unwrap();
        assert_eq!(liste.len(), 2, "Admin sieht auch inaktive Quellen");
        assert_eq!(liste[0].name, "A");
        assert!(!liste[0].aktiv, "aktiv=false korrekt aus DB gelesen");
        assert_eq!(liste[1].name, "B");
    }

    #[tokio::test]
    async fn anlegen_online_quelle_gibt_zeile_mit_id() {
        let pool = test_pool().await;
        let q = anlegen_online_quelle(&pool, &eingabe("X", 5, true)).await.unwrap();
        assert!(q.id > 0);
        assert_eq!(q.name, "X");
        assert_eq!(q.url, "https://X");
        assert_eq!(q.typ, "vektor");
        assert_eq!(q.sortier, 5);
        assert!(q.aktiv);
    }

    #[tokio::test]
    async fn aktualisiere_online_quelle_aendert_alle_felder() {
        let pool = test_pool().await;
        let q = anlegen_online_quelle(&pool, &eingabe("X", 1, true)).await.unwrap();
        let neu = OnlineQuelleEingabe {
            name: "Neu".into(),
            url: "https://neu".into(),
            typ: "raster".into(),
            attribution: None,
            sortier: 9,
            aktiv: false,
        };
        let akt = aktualisiere_online_quelle(&pool, q.id, &neu)
            .await
            .unwrap()
            .expect("Zeile existiert");
        assert_eq!(akt.id, q.id);
        assert_eq!(akt.name, "Neu");
        assert_eq!(akt.typ, "raster");
        assert_eq!(akt.attribution, None);
        assert!(!akt.aktiv);
    }

    #[tokio::test]
    async fn aktualisiere_online_quelle_unbekannt_gibt_none() {
        let pool = test_pool().await;
        let r = aktualisiere_online_quelle(&pool, 999, &eingabe("X", 1, true))
            .await
            .unwrap();
        assert!(r.is_none());
    }

    #[tokio::test]
    async fn loesche_online_quelle_entfernt_und_meldet() {
        let pool = test_pool().await;
        let q = anlegen_online_quelle(&pool, &eingabe("X", 1, true)).await.unwrap();
        assert!(loesche_online_quelle(&pool, q.id).await.unwrap());
        assert!(
            !loesche_online_quelle(&pool, q.id).await.unwrap(),
            "zweites Löschen entfernt nichts"
        );
        assert!(liste_online_quellen(&pool).await.unwrap().is_empty());
    }

    fn offline_eingabe(name: &str) -> OfflineKarteEingabe {
        OfflineKarteEingabe {
            name: name.into(),
            pfad: format!("/karten/{name}.pmtiles"),
            quell_url: Some("https://quelle".into()),
            lizenz: Some("CC0".into()),
            kachel_schema: "protomaps".into(),
            sortier: 0,
        }
    }

    #[tokio::test]
    async fn registriere_offline_karte_ist_bereit_und_inaktiv() {
        let pool = test_pool().await;
        let k = registriere_offline_karte(&pool, &offline_eingabe("A"))
            .await
            .unwrap();
        assert!(k.id > 0);
        assert_eq!(k.name, "A");
        assert_eq!(k.pfad, "/karten/A.pmtiles");
        assert_eq!(k.status, "bereit");
        assert!(!k.aktiv_basemap, "registriert ist nicht automatisch aktiv");
        assert_eq!(k.kachel_schema, "protomaps");
    }

    #[tokio::test]
    async fn aktiviere_offline_karte_ist_exklusiv() {
        let pool = test_pool().await;
        let a = registriere_offline_karte(&pool, &offline_eingabe("A"))
            .await
            .unwrap();
        let b = registriere_offline_karte(&pool, &offline_eingabe("B"))
            .await
            .unwrap();
        aktiviere_offline_karte(&pool, a.id).await.unwrap().unwrap();
        // B aktivieren MUSS A deaktivieren — sonst Verstoß gegen idx_offline_eine_aktive.
        let b_akt = aktiviere_offline_karte(&pool, b.id)
            .await
            .unwrap()
            .expect("B existiert");
        assert!(b_akt.aktiv_basemap);
        let aktive: Vec<_> = liste_offline_karten(&pool)
            .await
            .unwrap()
            .into_iter()
            .filter(|k| k.aktiv_basemap)
            .collect();
        assert_eq!(aktive.len(), 1, "genau eine aktive Karte");
        assert_eq!(aktive[0].id, b.id);
    }

    #[tokio::test]
    async fn aktive_pfad_und_verfuegbar_nur_wenn_bereit_und_aktiv() {
        let pool = test_pool().await;
        assert!(aktive_offline_karte_pfad(&pool).await.unwrap().is_none());
        assert!(!pmtiles_verfuegbar(&pool).await.unwrap());
        let k = registriere_offline_karte(&pool, &offline_eingabe("A"))
            .await
            .unwrap();
        assert!(
            !pmtiles_verfuegbar(&pool).await.unwrap(),
            "registriert aber nicht aktiv → noch nicht ausgeliefert"
        );
        aktiviere_offline_karte(&pool, k.id).await.unwrap();
        assert_eq!(
            aktive_offline_karte_pfad(&pool).await.unwrap().as_deref(),
            Some("/karten/A.pmtiles")
        );
        assert!(pmtiles_verfuegbar(&pool).await.unwrap());
    }

    #[tokio::test]
    async fn pmtiles_nicht_verfuegbar_wenn_aktiv_aber_nicht_bereit() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO karte_offline_karte (name, pfad, status, aktiv_basemap) \
             VALUES (?, ?, ?, ?)",
        )
        .bind("Laedt")
        .bind("/k/x.pmtiles")
        .bind("laedt")
        .bind(1)
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            !pmtiles_verfuegbar(&pool).await.unwrap(),
            "status='laedt' wird nicht ausgeliefert"
        );
        assert!(aktive_offline_karte_pfad(&pool).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn aktiviere_offline_karte_unbekannt_gibt_none() {
        let pool = test_pool().await;
        assert!(aktiviere_offline_karte(&pool, 999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn loesche_offline_karte_entfernt() {
        let pool = test_pool().await;
        let k = registriere_offline_karte(&pool, &offline_eingabe("A"))
            .await
            .unwrap();
        assert!(loesche_offline_karte(&pool, k.id).await.unwrap());
        assert!(!loesche_offline_karte(&pool, k.id).await.unwrap());
    }

    // --- Offline-Download-Lebenszyklus (LFH-181) ---

    fn download_eingabe(name: &str) -> OfflineDownloadEingabe {
        OfflineDownloadEingabe {
            name: name.into(),
            quell_url: format!("https://example.test/{name}.pmtiles"),
            lizenz: "© OpenStreetMap contributors (ODbL)".into(),
            kachel_schema: "protomaps".into(),
            sortier: 0,
        }
    }

    #[tokio::test]
    async fn neue_download_karte_ist_laedt_inaktiv_ohne_datei() {
        let pool = test_pool().await;
        let k = neue_download_karte(&pool, &download_eingabe("A")).await.unwrap();
        assert!(k.id > 0);
        assert_eq!(k.status, "laedt");
        assert!(!k.aktiv_basemap);
        assert_eq!(k.pfad, "", "Pfad-Platzhalter bis markiere_bereit");
        assert_eq!(k.groesse, None);
        assert_eq!(k.sha256, None);
        assert_eq!(k.download_at, None);
        // Solange nicht 'bereit' → nicht ausgeliefert.
        assert!(!pmtiles_verfuegbar(&pool).await.unwrap());
    }

    #[tokio::test]
    async fn markiere_bereit_setzt_pfad_groesse_sha256_und_status() {
        let pool = test_pool().await;
        let k = neue_download_karte(&pool, &download_eingabe("A")).await.unwrap();
        let fertig = markiere_bereit(&pool, k.id, "karte-1.pmtiles", 4242, "deadbeef")
            .await
            .unwrap()
            .expect("Zeile existiert");
        assert_eq!(fertig.status, "bereit");
        assert_eq!(fertig.pfad, "karte-1.pmtiles");
        assert_eq!(fertig.groesse, Some(4242));
        assert_eq!(fertig.sha256.as_deref(), Some("deadbeef"));
        assert!(fertig.download_at.is_some(), "download_at gesetzt");
    }

    #[tokio::test]
    async fn markiere_bereit_unbekannt_gibt_none() {
        let pool = test_pool().await;
        assert!(markiere_bereit(&pool, 999, "x.pmtiles", 1, "h")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn setze_status_fehler_aendert_status() {
        let pool = test_pool().await;
        let k = neue_download_karte(&pool, &download_eingabe("A")).await.unwrap();
        assert!(setze_status(&pool, k.id, "fehler").await.unwrap());
        let nach = finde_offline_karte(&pool, k.id).await.unwrap().unwrap();
        assert_eq!(nach.status, "fehler");
        assert!(!setze_status(&pool, 999, "fehler").await.unwrap());
    }

    #[tokio::test]
    async fn reset_haengende_downloads_setzt_nur_laedt_auf_fehler() {
        let pool = test_pool().await;
        let a = neue_download_karte(&pool, &download_eingabe("A")).await.unwrap();
        let b = neue_download_karte(&pool, &download_eingabe("B")).await.unwrap();
        let bereit = registriere_offline_karte(&pool, &offline_eingabe("C"))
            .await
            .unwrap();
        let mut ids = reset_haengende_downloads(&pool).await.unwrap();
        ids.sort();
        assert_eq!(ids, vec![a.id, b.id], "nur die laedt-Zeilen");
        assert_eq!(finde_offline_karte(&pool, a.id).await.unwrap().unwrap().status, "fehler");
        assert_eq!(finde_offline_karte(&pool, b.id).await.unwrap().unwrap().status, "fehler");
        assert_eq!(
            finde_offline_karte(&pool, bereit.id).await.unwrap().unwrap().status,
            "bereit",
            "bereite Karte unangetastet"
        );
        // Idempotent: kein laedt mehr übrig.
        assert!(reset_haengende_downloads(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn finde_offline_karte_some_und_none() {
        let pool = test_pool().await;
        let k = neue_download_karte(&pool, &download_eingabe("A")).await.unwrap();
        assert_eq!(finde_offline_karte(&pool, k.id).await.unwrap().unwrap().id, k.id);
        assert!(finde_offline_karte(&pool, 999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn aktive_offline_karte_version_aus_sha256_und_lizenz() {
        let pool = test_pool().await;
        assert!(aktive_offline_karte(&pool).await.unwrap().is_none());
        let k = neue_download_karte(&pool, &download_eingabe("A")).await.unwrap();
        markiere_bereit(&pool, k.id, "karte-1.pmtiles", 10, "cafef00d")
            .await
            .unwrap();
        // bereit, aber noch nicht aktiv.
        assert!(aktive_offline_karte(&pool).await.unwrap().is_none());
        aktiviere_offline_karte(&pool, k.id).await.unwrap();
        let aktiv = aktive_offline_karte(&pool).await.unwrap().expect("aktiv");
        assert_eq!(aktiv.pfad, "karte-1.pmtiles");
        assert_eq!(aktiv.version, "cafef00d", "sha256 als Cache-Bust-Token");
        assert_eq!(
            aktiv.lizenz.as_deref(),
            Some("© OpenStreetMap contributors (ODbL)")
        );
    }

    #[tokio::test]
    async fn aktive_offline_karte_version_faellt_auf_geaendert_at_zurueck() {
        let pool = test_pool().await;
        // Registrierte Datei (kein Download) hat kein sha256 → Token = geaendert_at.
        let k = registriere_offline_karte(&pool, &offline_eingabe("A"))
            .await
            .unwrap();
        aktiviere_offline_karte(&pool, k.id).await.unwrap();
        let aktiv = aktive_offline_karte(&pool).await.unwrap().expect("aktiv");
        assert!(!aktiv.version.is_empty(), "geaendert_at-Fallback nicht leer");
        assert_ne!(aktiv.version, "", "Token vorhanden trotz fehlendem sha256");
    }

    #[tokio::test]
    async fn aktiviere_wenn_keine_aktive_aktiviert_erste_bereite() {
        let pool = test_pool().await;
        let k = neue_download_karte(&pool, &download_eingabe("A")).await.unwrap();
        markiere_bereit(&pool, k.id, "karte-1.pmtiles", 10, "cafef00d")
            .await
            .unwrap();
        // Keine aktive Karte → die erste fertige wird automatisch ausgeliefert.
        assert!(aktiviere_wenn_keine_aktive(&pool, k.id).await.unwrap(), "aktiviert");
        let nach = finde_offline_karte(&pool, k.id).await.unwrap().unwrap();
        assert!(nach.aktiv_basemap);
        assert!(pmtiles_verfuegbar(&pool).await.unwrap());
    }

    #[tokio::test]
    async fn aktiviere_wenn_keine_aktive_noop_wenn_schon_aktiv() {
        let pool = test_pool().await;
        let a = neue_download_karte(&pool, &download_eingabe("A")).await.unwrap();
        markiere_bereit(&pool, a.id, "karte-1.pmtiles", 10, "aaaa").await.unwrap();
        aktiviere_offline_karte(&pool, a.id).await.unwrap();
        // Zweite Karte fertig, A ist schon aktiv → kein Verdrängen, kein Wechsel.
        let b = neue_download_karte(&pool, &download_eingabe("B")).await.unwrap();
        markiere_bereit(&pool, b.id, "karte-2.pmtiles", 20, "bbbb").await.unwrap();
        assert!(
            !aktiviere_wenn_keine_aktive(&pool, b.id).await.unwrap(),
            "bereits eine aktiv → No-op"
        );
        let aktive: Vec<_> = liste_offline_karten(&pool)
            .await
            .unwrap()
            .into_iter()
            .filter(|k| k.aktiv_basemap)
            .collect();
        assert_eq!(aktive.len(), 1, "weiterhin genau eine aktive Karte");
        assert_eq!(aktive[0].id, a.id, "A bleibt aktiv");
    }

    #[tokio::test]
    async fn aktiviere_wenn_keine_aktive_noop_wenn_nicht_bereit() {
        let pool = test_pool().await;
        // Noch im Status 'laedt' (markiere_bereit nicht aufgerufen).
        let k = neue_download_karte(&pool, &download_eingabe("A")).await.unwrap();
        assert!(
            !aktiviere_wenn_keine_aktive(&pool, k.id).await.unwrap(),
            "nicht bereit → nicht aktivierbar"
        );
        assert!(!finde_offline_karte(&pool, k.id).await.unwrap().unwrap().aktiv_basemap);
    }
}
