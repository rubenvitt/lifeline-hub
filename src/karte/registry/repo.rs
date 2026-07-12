//! CRUD- und Lese-Queries der Karten-Registry (runtime-queries, Muster wie `benutzer.rs`).

use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

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
    /// Serverseitig proxen (key-basierte Anbieter): `/config` gibt nur relative Proxy-URLs aus,
    /// die Upstream-`url` (inkl. Key) bleibt server-seitig (LFH-182).
    pub proxy: bool,
}

/// Eingabefelder zum Anlegen/Aktualisieren einer Online-Quelle (vom Handler aus dem JSON-Body).
pub struct OnlineQuelleEingabe {
    pub name: String,
    pub url: String,
    pub typ: String,
    pub attribution: Option<String>,
    pub sortier: i64,
    pub aktiv: bool,
    pub proxy: bool,
}

// Hinweis (sqlx 0.9): `query_as` akzeptiert nur `&'static str` (SqlSafeStr) — kein `format!`-
// String. Die Spaltenliste wird daher als Literal je Query wiederholt, nicht zentral geteilt.

/// Aktive Online-Quelle für `GET /api/karte/config` — trägt zusätzlich `id` und `proxy`, die der
/// Config-Handler für den Proxy-URL-Rewrite braucht (LFH-182). Ersetzt `aktive_online_styles` als
/// Datenquelle des Handlers (das schlanke `OnlineStyle` kennt weder `id` noch `proxy`).
#[derive(Debug, sqlx::FromRow)]
pub struct OnlineQuelleConfig {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub typ: String,
    pub attribution: Option<String>,
    pub proxy: bool,
}

/// Eine Online-Quelle per `id`, oder `None` — für die Proxy-Handler (Existenz + proxy/aktiv prüfen).
pub async fn finde_online_quelle(
    pool: &SqlitePool,
    id: i64,
) -> Result<Option<OnlineQuelle>, sqlx::Error> {
    sqlx::query_as::<_, OnlineQuelle>(
        "SELECT id, name, url, typ, attribution, sortier, aktiv, proxy \
         FROM karte_online_quelle WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Aktive Online-Quellen (mit `id`+`proxy`) für den Config-Rewrite, nach `sortier`, `id`.
pub async fn aktive_online_quellen_fuer_config(
    pool: &SqlitePool,
) -> Result<Vec<OnlineQuelleConfig>, sqlx::Error> {
    sqlx::query_as::<_, OnlineQuelleConfig>(
        "SELECT id, name, url, typ, attribution, proxy FROM karte_online_quelle \
         WHERE aktiv = 1 ORDER BY sortier, id",
    )
    .fetch_all(pool)
    .await
}

// --- Proxy-Slot-Map (LFH-182): opake Slot-IDs ↔ Upstream-URLs (inkl. Key; nur server-seitig) ---

/// Legt einen Slot für (`quelle_id`, `upstream_url`) an oder gibt den bestehenden zurück
/// (dedup via UNIQUE). Liefert die Slot-`id`.
pub async fn slot_upsert(
    pool: &SqlitePool,
    quelle_id: i64,
    upstream_url: &str,
    art: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO karte_proxy_asset (quelle_id, upstream_url, art) VALUES (?, ?, ?) \
         ON CONFLICT(quelle_id, upstream_url, art) DO UPDATE SET art = excluded.art RETURNING id",
    )
    .bind(quelle_id)
    .bind(upstream_url)
    .bind(art)
    .fetch_one(pool)
    .await
}

/// Löst einen Slot zu seiner Upstream-URL auf — nur bei passender `quelle_id` UND `art`
/// (Defense-in-Depth gegen art-Verwechslung / cross-quelle-Zugriff). `None` sonst.
pub async fn slot_aufloesen(
    pool: &SqlitePool,
    quelle_id: i64,
    slot: i64,
    art: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT upstream_url FROM karte_proxy_asset WHERE id = ? AND quelle_id = ? AND art = ?",
    )
    .bind(slot)
    .bind(quelle_id)
    .bind(art)
    .fetch_optional(pool)
    .await
}

/// Entfernt alle Slots einer Quelle (bei URL-Änderung/Löschen). Liefert die Anzahl.
pub async fn slots_loeschen(pool: &SqlitePool, quelle_id: i64) -> Result<u64, sqlx::Error> {
    let n = sqlx::query("DELETE FROM karte_proxy_asset WHERE quelle_id = ?")
        .bind(quelle_id)
        .execute(pool)
        .await?
        .rows_affected();
    Ok(n)
}

/// Eine Online-Quelle per `id` lesen (interner Helfer für Anlegen/Aktualisieren).
async fn hole_online_quelle(pool: &SqlitePool, id: i64) -> Result<OnlineQuelle, sqlx::Error> {
    // Delegiert an finde_online_quelle (gleiche Spaltenliste) — `RowNotFound` erhält die bisherige
    // fetch_one-Semantik für Anlegen/Aktualisieren.
    finde_online_quelle(pool, id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

/// Alle Online-Quellen (auch inaktive) für die Admin-Liste, nach `sortier`, `id`.
pub async fn liste_online_quellen(pool: &SqlitePool) -> Result<Vec<OnlineQuelle>, sqlx::Error> {
    sqlx::query_as::<_, OnlineQuelle>(
        "SELECT id, name, url, typ, attribution, sortier, aktiv, proxy \
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
        "INSERT INTO karte_online_quelle (name, url, typ, attribution, sortier, aktiv, proxy) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&eingabe.name)
    .bind(&eingabe.url)
    .bind(&eingabe.typ)
    .bind(&eingabe.attribution)
    .bind(eingabe.sortier)
    .bind(eingabe.aktiv)
    .bind(eingabe.proxy)
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
         SET name = ?, url = ?, typ = ?, attribution = ?, sortier = ?, aktiv = ?, proxy = ?, \
             geaendert_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(&eingabe.name)
    .bind(&eingabe.url)
    .bind(&eingabe.typ)
    .bind(&eingabe.attribution)
    .bind(eingabe.sortier)
    .bind(eingabe.aktiv)
    .bind(eingabe.proxy)
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
#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct OfflineKarte {
    pub id: i64,
    pub name: String,
    pub pfad: String,
    pub quell_url: Option<String>,
    pub lizenz: Option<String>,
    /// Kachel-Schema der Datei (z.B. `'shortbread'`). **Aktuell inertes Metadatenfeld** (LFH-198):
    /// im Tile-Serving nicht konsumiert (MBTiles wird schema-blind gelesen), und alle Insert-Pfade
    /// setzen den Wert explizit — der DB-DEFAULT `'protomaps'` in Migration 0076 greift also nie.
    /// Bewusst behalten (statt teurem Table-Rebuild nur zum Default-Umlegen) für eine mögliche
    /// künftige Schema-Unterscheidung (z.B. Raster vs. Vektor, LFH-185); deren Nutzen hängt nicht
    /// am Default-Wert.
    pub kachel_schema: String,
    /// Kachel-Blob-Format (LFH-185): `pbf` (Vektor, gzip) oder `png`/`jpg`/`webp` (Raster). Steuert
    /// Content-Type + Encoding im Tile-Serving; orthogonal zu `kachel_schema` (Vektor-Layermenge).
    pub format: String,
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
    pub format: String,
    pub sortier: i64,
}

/// Eine Offline-Karte per `id` lesen (interner Helfer).
async fn hole_offline_karte(pool: &SqlitePool, id: i64) -> Result<OfflineKarte, sqlx::Error> {
    sqlx::query_as::<_, OfflineKarte>(
        "SELECT id, name, pfad, quell_url, lizenz, kachel_schema, format, groesse, sha256, download_at, \
                status, aktiv_basemap, sortier \
         FROM karte_offline_karte WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
}

/// Pfad + Kachel-Format der aktiven, ausliefer-bereiten Offline-Karte (für `GET
/// /api/karte/offline/tiles/{z}/{x}/{y}` — der Handler braucht das Format für Content-Type/Encoding).
pub async fn aktive_offline_karte_pfad_und_format(
    pool: &SqlitePool,
) -> Result<Option<(String, String)>, sqlx::Error> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT pfad, format FROM karte_offline_karte \
         WHERE aktiv_basemap = 1 AND status = 'bereit' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
}

/// Alle Offline-Karten für die Admin-Liste, nach `sortier`, `id`.
pub async fn liste_offline_karten(pool: &SqlitePool) -> Result<Vec<OfflineKarte>, sqlx::Error> {
    sqlx::query_as::<_, OfflineKarte>(
        "SELECT id, name, pfad, quell_url, lizenz, kachel_schema, format, groesse, sha256, download_at, \
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
             (name, pfad, quell_url, lizenz, kachel_schema, format, sortier, status, aktiv_basemap) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 'bereit', 0)",
    )
    .bind(&eingabe.name)
    .bind(&eingabe.pfad)
    .bind(&eingabe.quell_url)
    .bind(&eingabe.lizenz)
    .bind(&eingabe.kachel_schema)
    .bind(&eingabe.format)
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

/// One-Click-Update (B2): ersetzt die Karte `alt_id` durch `neu_id` in EINER Transaktion.
/// Die neue Version ERBT den Aktiv-Status der alten: war `alt` die aktive Basemap, wird `neu`
/// aktiv (und alle anderen deaktiviert); war `alt` eine INAKTIVE Hintergrundkarte, bleibt die
/// gerade aktive Basemap UNANGETASTET (sonst klaut ein Update einer Hintergrundkarte die aktive
/// Basemap). `alt` wird immer gelöscht; den Datei-Cleanup (`entferne_download_dateien`) macht der
/// Aufrufer. `Ok(None)`, wenn `neu_id` nicht existiert.
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
    // Nach dem Commit die neue Karte zurückgeben. Wurde `neu_id` nebenläufig gelöscht, ist das
    // konsistent mit dem Initial-Check `Ok(None)` (statt eines RowNotFound-Fehlers).
    match hole_offline_karte(pool, neu_id).await {
        Ok(k) => Ok(Some(k)),
        Err(sqlx::Error::RowNotFound) => Ok(None),
        Err(e) => Err(e),
    }
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
    pub format: String,
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
             (name, pfad, quell_url, lizenz, kachel_schema, format, sortier, status, aktiv_basemap) \
         VALUES (?, '', ?, ?, ?, ?, ?, 'laedt', 0)",
    )
    .bind(&eingabe.name)
    .bind(&eingabe.quell_url)
    .bind(&eingabe.lizenz)
    .bind(&eingabe.kachel_schema)
    .bind(&eingabe.format)
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

/// Setzt die `quell_url` einer Karte neu (In-Place-Reload B3: nach dem Swap auf die neue Katalog-URL
/// aktualisieren, sonst bliebe die Update-Erkennung `quell_url != katalog.url` dauerhaft „Update
/// verfügbar" und der „Stand" veraltet). `markiere_bereit` fasst `quell_url` bewusst nicht an
/// (es teilt sich den Neu-Zeile-Pfad, dort ist die URL schon korrekt gesetzt).
pub async fn aktualisiere_quell_url(
    pool: &SqlitePool,
    id: i64,
    quell_url: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE karte_offline_karte SET quell_url = ?, geaendert_at = datetime('now') WHERE id = ?",
    )
    .bind(quell_url)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
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
        "SELECT id, name, pfad, quell_url, lizenz, kachel_schema, format, groesse, sha256, download_at, \
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
    /// Kachel-Format (`pbf`/`png`/`jpg`/`webp`) — `/config` gröbert es zu vektor/raster für die
    /// Frontend-Style-Wahl (LFH-185).
    pub format: String,
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
        format: String,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT pfad, sha256, geaendert_at, lizenz, format FROM karte_offline_karte \
         WHERE aktiv_basemap = 1 AND status = 'bereit' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| AktiveOfflineKarte {
        pfad: r.pfad,
        version: r.sha256.unwrap_or(r.geaendert_at),
        lizenz: r.lizenz,
        format: r.format,
    }))
}

/// Eine sichtbare Offline-Region für `GET /api/karte/config` (Multi-Region, LFH-188). Trägt die
/// `id` für den region-adressierten Tile-Endpoint, `version` als Cache-Bust-Token.
pub struct SichtbareOfflineKarte {
    pub id: i64,
    pub name: String,
    /// Cache-Bust-Token (`?v=…`): `sha256`, sonst `geaendert_at` (wie `AktiveOfflineKarte`).
    pub version: String,
    pub lizenz: Option<String>,
    pub format: String,
}

/// Alle gemeinsam anzuzeigenden Offline-Regionen: die Offline-Karte ist die VEREINIGUNG aller
/// bereiten Regionen (LFH-188, „alle automatisch gemeinsam"). Bewusst nur an `status = 'bereit'`
/// gekoppelt — NICHT an `aktiv_basemap` (das bleibt Legacy-/Kompat-Marker der alten Single-Route).
/// Reihenfolge `sortier, id` (stabile, deterministische Layer-/Attribution-Reihenfolge).
pub async fn sichtbare_offline_karten(
    pool: &SqlitePool,
) -> Result<Vec<SichtbareOfflineKarte>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        name: String,
        sha256: Option<String>,
        geaendert_at: String,
        lizenz: Option<String>,
        format: String,
    }
    let rows = sqlx::query_as::<_, Row>(
        "SELECT id, name, sha256, geaendert_at, lizenz, format FROM karte_offline_karte \
         WHERE status = 'bereit' ORDER BY sortier, id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SichtbareOfflineKarte {
            id: r.id,
            name: r.name,
            version: r.sha256.unwrap_or(r.geaendert_at),
            lizenz: r.lizenz,
            format: r.format,
        })
        .collect())
}

/// Pfad + Kachel-Format einer bereiten Offline-Karte per `id` — für den region-adressierten
/// Endpoint `GET /api/karte/offline/{karte_id}/tiles/{z}/{x}/{y}` (LFH-188). `None`, wenn die
/// Region unbekannt oder (noch) nicht `bereit` ist → der Handler antwortet dann `204`.
pub async fn offline_karte_pfad_und_format(
    pool: &SqlitePool,
    id: i64,
) -> Result<Option<(String, String)>, sqlx::Error> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT pfad, format FROM karte_offline_karte \
         WHERE id = ? AND status = 'bereit' LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;

    #[tokio::test]
    async fn aktive_online_quellen_fuer_config_nur_aktive_sortiert() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO karte_online_quelle (name,url,typ,attribution,sortier,aktiv) VALUES (?,?,?,?,?,?)")
            .bind("B").bind("https://b").bind("vektor").bind(None::<String>).bind(2).bind(1)
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO karte_online_quelle (name,url,typ,attribution,sortier,aktiv) VALUES (?,?,?,?,?,?)")
            .bind("A").bind("https://a").bind("raster").bind(Some("© X")).bind(1).bind(1)
            .execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO karte_online_quelle (name,url,typ,sortier,aktiv) VALUES (?,?,?,?,?)",
        )
        .bind("Inaktiv")
        .bind("https://i")
        .bind("vektor")
        .bind(0)
        .bind(0)
        .execute(&pool)
        .await
        .unwrap();

        let q = aktive_online_quellen_fuer_config(&pool).await.unwrap();
        assert_eq!(q.len(), 2, "inaktive Quelle ausgeschlossen");
        assert_eq!(q[0].name, "A", "sortier 1 vor 2");
        assert_eq!(q[0].typ, "raster");
        assert!(!q[0].proxy, "Default proxy=false");
        assert_eq!(q[1].name, "B");
    }

    fn eingabe(name: &str, sortier: i64, aktiv: bool) -> OnlineQuelleEingabe {
        OnlineQuelleEingabe {
            name: name.into(),
            url: format!("https://{name}"),
            typ: "vektor".into(),
            attribution: Some("© Test".into()),
            sortier,
            aktiv,
            proxy: false,
        }
    }

    #[tokio::test]
    async fn liste_online_quellen_enthaelt_auch_inaktive_sortiert() {
        let pool = test_pool().await;
        anlegen_online_quelle(&pool, &eingabe("B", 2, true))
            .await
            .unwrap();
        anlegen_online_quelle(&pool, &eingabe("A", 1, false))
            .await
            .unwrap();
        let liste = liste_online_quellen(&pool).await.unwrap();
        assert_eq!(liste.len(), 2, "Admin sieht auch inaktive Quellen");
        assert_eq!(liste[0].name, "A");
        assert!(!liste[0].aktiv, "aktiv=false korrekt aus DB gelesen");
        assert_eq!(liste[1].name, "B");
    }

    #[tokio::test]
    async fn anlegen_online_quelle_gibt_zeile_mit_id() {
        let pool = test_pool().await;
        let q = anlegen_online_quelle(&pool, &eingabe("X", 5, true))
            .await
            .unwrap();
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
        let q = anlegen_online_quelle(&pool, &eingabe("X", 1, true))
            .await
            .unwrap();
        let neu = OnlineQuelleEingabe {
            name: "Neu".into(),
            url: "https://neu".into(),
            typ: "raster".into(),
            attribution: None,
            sortier: 9,
            aktiv: false,
            proxy: false,
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
        let q = anlegen_online_quelle(&pool, &eingabe("X", 1, true))
            .await
            .unwrap();
        assert!(loesche_online_quelle(&pool, q.id).await.unwrap());
        assert!(
            !loesche_online_quelle(&pool, q.id).await.unwrap(),
            "zweites Löschen entfernt nichts"
        );
        assert!(liste_online_quellen(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn online_quelle_round_trippt_proxy() {
        let pool = test_pool().await;
        let mut e = eingabe("X", 1, true);
        e.proxy = true;
        let q = anlegen_online_quelle(&pool, &e).await.unwrap();
        assert!(q.proxy, "proxy=true gespeichert+gelesen");
        let q2 = anlegen_online_quelle(&pool, &eingabe("Y", 2, true))
            .await
            .unwrap();
        assert!(!q2.proxy, "Default proxy=false");
        // direkter INSERT ohne proxy-Spalte → Default 0
        sqlx::query(
            "INSERT INTO karte_online_quelle (name,url,typ,sortier,aktiv) VALUES (?,?,?,?,?)",
        )
        .bind("Z")
        .bind("https://z")
        .bind("vektor")
        .bind(3)
        .bind(1)
        .execute(&pool)
        .await
        .unwrap();
        let z = liste_online_quellen(&pool)
            .await
            .unwrap()
            .into_iter()
            .find(|r| r.name == "Z")
            .unwrap();
        assert!(!z.proxy);
    }

    #[tokio::test]
    async fn aktive_online_quellen_fuer_config_traegt_id_und_proxy() {
        let pool = test_pool().await;
        let mut e = eingabe("P", 1, true);
        e.proxy = true;
        let q = anlegen_online_quelle(&pool, &e).await.unwrap();
        anlegen_online_quelle(&pool, &eingabe("Inaktiv", 2, false))
            .await
            .unwrap();
        let liste = aktive_online_quellen_fuer_config(&pool).await.unwrap();
        assert_eq!(liste.len(), 1, "nur aktive");
        let row = &liste[0];
        assert_eq!(row.id, q.id);
        assert!(row.proxy);
        assert_eq!(row.typ, "vektor");
    }

    #[tokio::test]
    async fn slot_upsert_dedupliziert_und_aufloesen_scoped() {
        let pool = test_pool().await;
        let q = anlegen_online_quelle(&pool, &eingabe("S", 1, true))
            .await
            .unwrap();
        let s1 = slot_upsert(&pool, q.id, "https://h/a?key=K", "template")
            .await
            .unwrap();
        let s1b = slot_upsert(&pool, q.id, "https://h/a?key=K", "template")
            .await
            .unwrap();
        assert_eq!(s1, s1b, "gleiche url → gleiche id (dedup)");
        let s2 = slot_upsert(&pool, q.id, "https://h/b", "sprite")
            .await
            .unwrap();
        assert_ne!(s1, s2, "andere url → neue id");
        assert_eq!(
            slot_aufloesen(&pool, q.id, s1, "template")
                .await
                .unwrap()
                .as_deref(),
            Some("https://h/a?key=K")
        );
        assert!(
            slot_aufloesen(&pool, q.id, s1, "sprite")
                .await
                .unwrap()
                .is_none(),
            "falsche art → None"
        );
        assert!(
            slot_aufloesen(&pool, 999, s1, "template")
                .await
                .unwrap()
                .is_none(),
            "fremde quelle → None"
        );
        assert!(
            slot_aufloesen(&pool, q.id, 99999, "template")
                .await
                .unwrap()
                .is_none(),
            "unbekannter slot → None"
        );
    }

    #[tokio::test]
    async fn slot_upsert_gleiche_url_zwei_arten_zwei_slots() {
        // art ist Teil der Identität: dieselbe URL in zwei Rollen bekommt zwei Slots, jeder über
        // seine art auflösbar (sonst würde ON CONFLICT eine Art überschreiben → unauflösbar).
        let pool = test_pool().await;
        let q = anlegen_online_quelle(&pool, &eingabe("U", 1, true))
            .await
            .unwrap();
        let a = slot_upsert(&pool, q.id, "https://h/x", "sprite")
            .await
            .unwrap();
        let b = slot_upsert(&pool, q.id, "https://h/x", "tilejson")
            .await
            .unwrap();
        assert_ne!(a, b, "gleiche URL, andere art → eigener Slot");
        assert_eq!(
            slot_aufloesen(&pool, q.id, a, "sprite")
                .await
                .unwrap()
                .as_deref(),
            Some("https://h/x")
        );
        assert_eq!(
            slot_aufloesen(&pool, q.id, b, "tilejson")
                .await
                .unwrap()
                .as_deref(),
            Some("https://h/x")
        );
    }

    #[tokio::test]
    async fn slots_loeschen_nur_eigene() {
        let pool = test_pool().await;
        let a = anlegen_online_quelle(&pool, &eingabe("A", 1, true))
            .await
            .unwrap();
        let b = anlegen_online_quelle(&pool, &eingabe("B", 2, true))
            .await
            .unwrap();
        let sa = slot_upsert(&pool, a.id, "https://h/a", "static")
            .await
            .unwrap();
        let sb = slot_upsert(&pool, b.id, "https://h/b", "static")
            .await
            .unwrap();
        let n = slots_loeschen(&pool, a.id).await.unwrap();
        assert_eq!(n, 1);
        assert!(
            slot_aufloesen(&pool, a.id, sa, "static")
                .await
                .unwrap()
                .is_none(),
            "A-Slot weg"
        );
        assert!(
            slot_aufloesen(&pool, b.id, sb, "static")
                .await
                .unwrap()
                .is_some(),
            "B-Slot bleibt"
        );
    }

    #[tokio::test]
    async fn slots_cascade_beim_loeschen_der_quelle() {
        // FK ON DELETE CASCADE (test_pool aktiviert PRAGMA foreign_keys): Löschen der Quelle
        // entfernt ihre Slots auch OHNE den expliziten slots_loeschen-Aufruf des Handlers.
        let pool = test_pool().await;
        let q = anlegen_online_quelle(&pool, &eingabe("C", 1, true))
            .await
            .unwrap();
        let s = slot_upsert(&pool, q.id, "https://h/x", "tilejson")
            .await
            .unwrap();
        loesche_online_quelle(&pool, q.id).await.unwrap();
        assert!(
            slot_aufloesen(&pool, q.id, s, "tilejson")
                .await
                .unwrap()
                .is_none(),
            "CASCADE entfernt Slots ohne expliziten Purge"
        );
    }

    fn offline_eingabe(name: &str) -> OfflineKarteEingabe {
        OfflineKarteEingabe {
            name: name.into(),
            pfad: format!("/karten/{name}.pmtiles"),
            quell_url: Some("https://quelle".into()),
            lizenz: Some("CC0".into()),
            kachel_schema: "shortbread".into(),
            format: "pbf".into(),
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
        assert_eq!(k.kachel_schema, "shortbread");
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
        assert!(aktive_offline_karte_pfad_und_format(&pool)
            .await
            .unwrap()
            .is_none());
        assert!(aktive_offline_karte(&pool).await.unwrap().is_none());
        let k = registriere_offline_karte(&pool, &offline_eingabe("A"))
            .await
            .unwrap();
        assert!(
            aktive_offline_karte(&pool).await.unwrap().is_none(),
            "registriert aber nicht aktiv → noch nicht ausgeliefert"
        );
        aktiviere_offline_karte(&pool, k.id).await.unwrap();
        assert_eq!(
            aktive_offline_karte_pfad_und_format(&pool).await.unwrap(),
            Some(("/karten/A.pmtiles".to_string(), "pbf".to_string())),
            "Pfad + Default-Format der aktiven Karte"
        );
        assert!(aktive_offline_karte(&pool).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn format_round_trippt_und_defaultet_pbf() {
        // LFH-185: format über Registrierung round-trippt; Roh-INSERT ohne format → DEFAULT 'pbf'.
        let pool = test_pool().await;
        let mut e = offline_eingabe("Raster");
        e.format = "png".into();
        let k = registriere_offline_karte(&pool, &e).await.unwrap();
        assert_eq!(k.format, "png", "format round-trippt beim Registrieren");
        aktiviere_offline_karte(&pool, k.id).await.unwrap();
        assert_eq!(
            aktive_offline_karte_pfad_und_format(&pool).await.unwrap(),
            Some((k.pfad.clone(), "png".to_string())),
            "aktive Karte trägt das Raster-Format"
        );
        assert_eq!(
            aktive_offline_karte(&pool).await.unwrap().unwrap().format,
            "png"
        );

        // Roh-INSERT ohne format-Spalte → DB-DEFAULT 'pbf' (Bestandsverhalten).
        sqlx::query("INSERT INTO karte_offline_karte (name, pfad, status) VALUES ('Alt', '/k/alt.mbtiles', 'bereit')")
            .execute(&pool)
            .await
            .unwrap();
        let alt = liste_offline_karten(&pool)
            .await
            .unwrap()
            .into_iter()
            .find(|k| k.name == "Alt")
            .unwrap();
        assert_eq!(alt.format, "pbf", "Roh-INSERT ohne format → DEFAULT pbf");
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
            aktive_offline_karte(&pool).await.unwrap().is_none(),
            "status='laedt' wird nicht ausgeliefert"
        );
        assert!(aktive_offline_karte_pfad_und_format(&pool)
            .await
            .unwrap()
            .is_none());
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

    #[tokio::test]
    async fn ersetze_aktive_offline_karte_aktiviert_neu_und_loescht_alt() {
        let pool = test_pool().await;
        let alt = registriere_offline_karte(&pool, &offline_eingabe("DE-v1"))
            .await
            .unwrap();
        aktiviere_offline_karte(&pool, alt.id).await.unwrap();
        let neu = registriere_offline_karte(&pool, &offline_eingabe("DE-v2"))
            .await
            .unwrap();

        let aktiv = ersetze_aktive_offline_karte(&pool, neu.id, alt.id)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(aktiv.id, neu.id);
        assert!(aktiv.aktiv_basemap, "neue Karte erbt aktiv (alt war aktiv)");
        let liste = liste_offline_karten(&pool).await.unwrap();
        assert_eq!(liste.len(), 1, "alte Zeile gelöscht");
        assert_eq!(liste[0].id, neu.id);
    }

    /// Diskriminierend: Update einer INAKTIVEN Hintergrundkarte darf die aktive Basemap NICHT klauen.
    #[tokio::test]
    async fn ersetze_offline_karte_inaktiv_laesst_aktive_basemap_unberuehrt() {
        let pool = test_pool().await;
        // A ist die aktive Basemap.
        let a = registriere_offline_karte(&pool, &offline_eingabe("A"))
            .await
            .unwrap();
        aktiviere_offline_karte(&pool, a.id).await.unwrap();
        // B inaktiv + bereit, B2 ist die heruntergeladene neue Version.
        let b = registriere_offline_karte(&pool, &offline_eingabe("B-v1"))
            .await
            .unwrap();
        let b2 = registriere_offline_karte(&pool, &offline_eingabe("B-v2"))
            .await
            .unwrap();

        let neu = ersetze_aktive_offline_karte(&pool, b2.id, b.id)
            .await
            .unwrap()
            .unwrap();

        assert!(!neu.aktiv_basemap, "neue B-Version bleibt inaktiv");
        let liste = liste_offline_karten(&pool).await.unwrap();
        assert!(
            liste.iter().find(|k| k.id == a.id).unwrap().aktiv_basemap,
            "aktive Basemap A unverändert"
        );
        assert!(liste.iter().all(|k| k.id != b.id), "alte B-Zeile gelöscht");
    }

    // --- Offline-Download-Lebenszyklus (LFH-181) ---

    fn download_eingabe(name: &str) -> OfflineDownloadEingabe {
        OfflineDownloadEingabe {
            name: name.into(),
            quell_url: format!("https://example.test/{name}.pmtiles"),
            lizenz: "© OpenStreetMap contributors (ODbL)".into(),
            kachel_schema: "shortbread".into(),
            format: "pbf".into(),
            sortier: 0,
        }
    }

    #[tokio::test]
    async fn neue_download_karte_ist_laedt_inaktiv_ohne_datei() {
        let pool = test_pool().await;
        let k = neue_download_karte(&pool, &download_eingabe("A"))
            .await
            .unwrap();
        assert!(k.id > 0);
        assert_eq!(k.status, "laedt");
        assert!(!k.aktiv_basemap);
        assert_eq!(k.pfad, "", "Pfad-Platzhalter bis markiere_bereit");
        assert_eq!(k.groesse, None);
        assert_eq!(k.sha256, None);
        assert_eq!(k.download_at, None);
        // Solange nicht 'bereit' → nicht ausgeliefert.
        assert!(aktive_offline_karte(&pool).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn markiere_bereit_setzt_pfad_groesse_sha256_und_status() {
        let pool = test_pool().await;
        let k = neue_download_karte(&pool, &download_eingabe("A"))
            .await
            .unwrap();
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
        let k = neue_download_karte(&pool, &download_eingabe("A"))
            .await
            .unwrap();
        assert!(setze_status(&pool, k.id, "fehler").await.unwrap());
        let nach = finde_offline_karte(&pool, k.id).await.unwrap().unwrap();
        assert_eq!(nach.status, "fehler");
        assert!(!setze_status(&pool, 999, "fehler").await.unwrap());
    }

    #[tokio::test]
    async fn reset_haengende_downloads_setzt_nur_laedt_auf_fehler() {
        let pool = test_pool().await;
        let a = neue_download_karte(&pool, &download_eingabe("A"))
            .await
            .unwrap();
        let b = neue_download_karte(&pool, &download_eingabe("B"))
            .await
            .unwrap();
        let bereit = registriere_offline_karte(&pool, &offline_eingabe("C"))
            .await
            .unwrap();
        let mut ids = reset_haengende_downloads(&pool).await.unwrap();
        ids.sort();
        assert_eq!(ids, vec![a.id, b.id], "nur die laedt-Zeilen");
        assert_eq!(
            finde_offline_karte(&pool, a.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            "fehler"
        );
        assert_eq!(
            finde_offline_karte(&pool, b.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            "fehler"
        );
        assert_eq!(
            finde_offline_karte(&pool, bereit.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            "bereit",
            "bereite Karte unangetastet"
        );
        // Idempotent: kein laedt mehr übrig.
        assert!(reset_haengende_downloads(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn finde_offline_karte_some_und_none() {
        let pool = test_pool().await;
        let k = neue_download_karte(&pool, &download_eingabe("A"))
            .await
            .unwrap();
        assert_eq!(
            finde_offline_karte(&pool, k.id).await.unwrap().unwrap().id,
            k.id
        );
        assert!(finde_offline_karte(&pool, 999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn aktive_offline_karte_version_aus_sha256_und_lizenz() {
        let pool = test_pool().await;
        assert!(aktive_offline_karte(&pool).await.unwrap().is_none());
        let k = neue_download_karte(&pool, &download_eingabe("A"))
            .await
            .unwrap();
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
        assert!(
            !aktiv.version.is_empty(),
            "geaendert_at-Fallback nicht leer"
        );
        assert_ne!(aktiv.version, "", "Token vorhanden trotz fehlendem sha256");
    }

    #[tokio::test]
    async fn aktiviere_wenn_keine_aktive_aktiviert_erste_bereite() {
        let pool = test_pool().await;
        let k = neue_download_karte(&pool, &download_eingabe("A"))
            .await
            .unwrap();
        markiere_bereit(&pool, k.id, "karte-1.pmtiles", 10, "cafef00d")
            .await
            .unwrap();
        // Keine aktive Karte → die erste fertige wird automatisch ausgeliefert.
        assert!(
            aktiviere_wenn_keine_aktive(&pool, k.id).await.unwrap(),
            "aktiviert"
        );
        let nach = finde_offline_karte(&pool, k.id).await.unwrap().unwrap();
        assert!(nach.aktiv_basemap);
        assert!(aktive_offline_karte(&pool).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn aktiviere_wenn_keine_aktive_noop_wenn_schon_aktiv() {
        let pool = test_pool().await;
        let a = neue_download_karte(&pool, &download_eingabe("A"))
            .await
            .unwrap();
        markiere_bereit(&pool, a.id, "karte-1.pmtiles", 10, "aaaa")
            .await
            .unwrap();
        aktiviere_offline_karte(&pool, a.id).await.unwrap();
        // Zweite Karte fertig, A ist schon aktiv → kein Verdrängen, kein Wechsel.
        let b = neue_download_karte(&pool, &download_eingabe("B"))
            .await
            .unwrap();
        markiere_bereit(&pool, b.id, "karte-2.pmtiles", 20, "bbbb")
            .await
            .unwrap();
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
        let k = neue_download_karte(&pool, &download_eingabe("A"))
            .await
            .unwrap();
        assert!(
            !aktiviere_wenn_keine_aktive(&pool, k.id).await.unwrap(),
            "nicht bereit → nicht aktivierbar"
        );
        assert!(
            !finde_offline_karte(&pool, k.id)
                .await
                .unwrap()
                .unwrap()
                .aktiv_basemap
        );
    }

    // --- Multi-Region-Anzeige (LFH-188, „alle automatisch gemeinsam") ---

    #[tokio::test]
    async fn sichtbare_offline_karten_listet_alle_bereiten_unabhaengig_von_aktiv() {
        let pool = test_pool().await;
        // Zwei bereite Regionen (eine aktiv, eine NICHT aktiv) + eine ladende.
        let a = registriere_offline_karte(&pool, &offline_eingabe("A"))
            .await
            .unwrap();
        let b = registriere_offline_karte(&pool, &offline_eingabe("B"))
            .await
            .unwrap();
        aktiviere_offline_karte(&pool, a.id).await.unwrap(); // a aktiv, b nicht
        let laedt = neue_download_karte(&pool, &download_eingabe("C"))
            .await
            .unwrap();

        let sichtbar = sichtbare_offline_karten(&pool).await.unwrap();
        let ids: Vec<i64> = sichtbar.iter().map(|r| r.id).collect();
        assert_eq!(
            ids,
            vec![a.id, b.id],
            "beide bereiten Regionen, sortier,id; ladende nicht"
        );
        assert!(
            !ids.contains(&laedt.id),
            "ladende Region wird nicht ausgeliefert"
        );
    }

    #[tokio::test]
    async fn sichtbare_offline_karten_version_aus_sha256_sonst_geaendert_at() {
        let pool = test_pool().await;
        // Heruntergeladene Karte trägt sha256 → Token = sha256.
        let d = neue_download_karte(&pool, &download_eingabe("D"))
            .await
            .unwrap();
        markiere_bereit(&pool, d.id, "karte-1.mbtiles", 10, "cafef00d")
            .await
            .unwrap();
        // Registrierte Karte (kein sha256) → Token = geaendert_at (nicht leer).
        let r = registriere_offline_karte(&pool, &offline_eingabe("R"))
            .await
            .unwrap();

        let sichtbar = sichtbare_offline_karten(&pool).await.unwrap();
        let sd = sichtbar.iter().find(|s| s.id == d.id).unwrap();
        assert_eq!(sd.version, "cafef00d", "sha256 als Cache-Bust-Token");
        let sr = sichtbar.iter().find(|s| s.id == r.id).unwrap();
        assert!(!sr.version.is_empty(), "geaendert_at-Fallback ohne sha256");
    }

    #[tokio::test]
    async fn offline_karte_pfad_und_format_nur_bereit_per_id() {
        let pool = test_pool().await;
        let mut e = offline_eingabe("Raster");
        e.format = "png".into();
        let k = registriere_offline_karte(&pool, &e).await.unwrap();
        assert_eq!(
            offline_karte_pfad_und_format(&pool, k.id).await.unwrap(),
            Some((k.pfad.clone(), "png".to_string())),
            "bereite Region per id auflösbar (Pfad + Format)"
        );
        // Ladende Region → None (204).
        let laedt = neue_download_karte(&pool, &download_eingabe("L"))
            .await
            .unwrap();
        assert!(offline_karte_pfad_und_format(&pool, laedt.id)
            .await
            .unwrap()
            .is_none());
        // Unbekannte id → None.
        assert!(offline_karte_pfad_und_format(&pool, 999)
            .await
            .unwrap()
            .is_none());
    }
}
