//! Liest Vektor-Kacheln aus einer MBTiles-Datei (= SQLite). MBTiles speichert `tile_row` in
//! TMS-Orientierung; MapLibre fragt in XYZ → Y-Flip nötig. MVT-Kacheln sind gzip-komprimiert.
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use tokio::sync::OnceCell;

/// Verbindungen je MBTiles-Datei. sqlx-sqlite startet für jede Verbindung einen eigenen
/// OS-Thread; bei mehreren Regionen zählt das je Datei (LFH-934).
const VERBINDUNGEN_JE_DATEI: u32 = 2;

/// Öffnet eine `.mbtiles`-Datei als read-only-Pool (immutable: keine Sperren, kein WAL-Write).
/// `.filename(pfad)` statt einer `sqlite://`-URI, sonst müssten Sonderzeichen im Pfad escaped
/// werden.
pub async fn oeffne_readonly(pfad: &Path) -> Result<sqlx::SqlitePool, sqlx::Error> {
    use sqlx::sqlite::SqliteConnectOptions;
    let opts = SqliteConnectOptions::new()
        .filename(pfad)
        .read_only(true)
        .immutable(true);
    sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(VERBINDUNGEN_JE_DATEI)
        .connect_with(opts)
        .await
}

/// Liest die Kachel (z/x/y in XYZ) oder `None`. `tile_row = (2^z − 1) − y` (TMS-Flip).
pub async fn lies_tile(
    pool: &sqlx::SqlitePool,
    z: i64,
    x: i64,
    y: i64,
) -> Result<Option<Vec<u8>>, sqlx::Error> {
    let tms_row = (1i64 << z) - 1 - y;
    let row: Option<(Vec<u8>,)> = sqlx::query_as(
        "SELECT tile_data FROM tiles WHERE zoom_level = ?1 AND tile_column = ?2 AND tile_row = ?3",
    )
    .bind(z)
    .bind(x)
    .bind(tms_row)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(d,)| d))
}

/// Obergrenze der gecachten Pools. Schlüssel sind die Pfade registrierter Karten plus die
/// Welt-Übersicht; die Grenze fängt nur den Ausreißer ab (alle Bundesländer plus Welt passen).
const MAX_READER: usize = 32;

/// Eine Zelle: einmal gefüllt mit dem realen Ziel, das geöffnet wurde, und seinem Pool.
type Zelle = Arc<OnceCell<(PathBuf, sqlx::SqlitePool)>>;

/// Read-only-Pools der Offline-MBTiles, **je Pfad einer** (LFH-934). Mehrere bereite Regionen
/// fragt MapLibre verschränkt ab; ein Cache mit nur einem Platz öffnete fast für jede Kachel einen
/// neuen Pool. Jede Zelle wird höchstens einmal gefüllt (`OnceCell`): parallele Fehltreffer auf
/// denselben Pfad warten auf dieselbe Öffnung statt je einen eigenen Pool zu bauen. Die
/// `std`-Mutex hält niemand über ein `await`.
///
/// Neben dem Pool merkt sich die Zelle das reale Ziel (`canonicalize`), das der Aufrufer bei jeder
/// Anfrage neu auflöst und auf Containment prüft. Zeigt der Pfad inzwischen woanders hin (Symlink
/// umgebogen), gilt das als Fehltreffer.
pub struct ReaderCache {
    pools: Mutex<HashMap<PathBuf, Zelle>>,
}

impl Default for ReaderCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ReaderCache {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }

    /// Poisoning-fest: unter der Sperre laufen nur infallible Map-Operationen.
    fn map(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, Zelle>> {
        self.pools.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Zelle für `pfad`, bei Bedarf neu angelegt. Eine Zelle, die auf ein anderes Ziel als `ziel`
    /// zeigt, wird ersetzt. Ist der Cache voll, verdrängt ein neuer Pfad einen beliebigen anderen;
    /// dessen Pool baut sich ab, sobald laufende Abfragen ihn freigeben.
    fn zelle(&self, pfad: &Path, ziel: &Path) -> Zelle {
        let mut m = self.map();
        if let Some(z) = m.get(pfad) {
            match z.get() {
                Some((offen, _)) if offen != ziel => {}
                _ => return z.clone(),
            }
            m.remove(pfad);
        }
        if m.len() >= MAX_READER {
            if let Some(k) = m.keys().next().cloned() {
                m.remove(&k);
            }
        }
        let z = Arc::new(OnceCell::new());
        m.insert(pfad.to_path_buf(), z.clone());
        z
    }

    /// Liefert den gecachten Pool für `pfad`, dessen reales Ziel `ziel` ist; nur beim Fehltreffer
    /// läuft `oeffne`. Scheitert das Öffnen, bleibt nichts im Cache, der nächste Abruf versucht es
    /// erneut.
    pub async fn reader_fuer<F, Fut, E>(
        &self,
        pfad: &Path,
        ziel: &Path,
        oeffne: F,
    ) -> Result<sqlx::SqlitePool, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<sqlx::SqlitePool, E>>,
    {
        let zelle = self.zelle(pfad, ziel);
        let ergebnis = zelle
            .get_or_try_init(|| async { Ok((ziel.to_path_buf(), oeffne().await?)) })
            .await;
        match ergebnis {
            Ok((_, pool)) => Ok(pool.clone()),
            Err(e) => {
                let mut m = self.map();
                // Nur die eigene, leere Zelle entfernen: ein paralleler Abruf kann sie inzwischen
                // ersetzt oder gefüllt haben.
                if m.get(pfad)
                    .is_some_and(|z| Arc::ptr_eq(z, &zelle) && !z.initialized())
                {
                    m.remove(pfad);
                }
                Err(e)
            }
        }
    }

    /// Verwirft den Pool für `pfad` und jeden weiteren Eintrag, der auf dasselbe reale Ziel zeigt
    /// (Alias über einen Symlink). Nach Löschen oder Ersetzen dieser Karte aufrufen: Neu-Download
    /// und In-Place-Reload vergeben denselben Pfad bei neuer Inode, der alte Pool hielte das alte
    /// Datei-Handle und servierte die alte Datei weiter.
    pub fn verwerfen(&self, pfad: &Path) {
        let mut m = self.map();
        let ziel = m
            .remove(pfad)
            .and_then(|z| z.get().map(|(ziel, _)| ziel.clone()));
        if let Some(ziel) = ziel {
            m.retain(|_, z| z.get().is_none_or(|(offen, _)| *offen != ziel));
        }
    }

    /// Verwirft alle Pools (Sonderfälle).
    pub fn leeren(&self) {
        self.map().clear();
    }

    #[cfg(test)]
    fn anzahl(&self) -> usize {
        self.map().len()
    }
}

/// Prozessweiter Reader-Cache der Offline-Kachelauslieferung, gekeyt über den Pfad, unter dem die
/// Karte registriert ist (`karten_dir` + relativer Pfad).
static READER: LazyLock<ReaderCache> = LazyLock::new(ReaderCache::new);

/// Der prozessweite [`ReaderCache`].
pub fn reader() -> &'static ReaderCache {
    &READER
}

/// Verwirft den gecachten Pool für `pfad`, s. [`ReaderCache::verwerfen`].
pub fn invalidate_reader_fuer(pfad: &Path) {
    READER.verwerfen(pfad);
}

/// Verwirft alle gecachten Pools, s. [`ReaderCache::leeren`].
pub fn invalidate_reader() {
    READER.leeren();
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    // Baut eine In-Memory-MBTiles mit genau einer Kachel bei TMS (z=1, col=0, row=1) = XYZ (z=1,x=0,y=0).
    async fn fixture() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO tiles VALUES (1, 0, 1, x'ABCD')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn liest_kachel_mit_tms_flip() {
        let pool = fixture().await;
        // XYZ y=0 bei z=1 -> TMS row = (2^1 - 1) - 0 = 1 -> Treffer.
        let t = lies_tile(&pool, 1, 0, 0).await.unwrap();
        assert_eq!(t, Some(vec![0xAB, 0xCD]));
    }

    #[tokio::test]
    async fn fehlende_kachel_ist_none() {
        let pool = fixture().await;
        assert_eq!(lies_tile(&pool, 1, 1, 1).await.unwrap(), None);
    }

    /// Schreibt eine Datei-MBTiles mit genau einer Kachel bei TMS (z=1, col=0, row=1) = XYZ
    /// (z=1,x=0,y=0). Eigener schreibbarer Pool; die Datei darf noch nicht existieren.
    async fn schreibe_datei_fixture(pfad: &Path, daten: &[u8]) {
        let opts = SqlitePoolOptions::new().connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(pfad)
                .create_if_missing(true),
        );
        let pool = opts.await.unwrap();
        sqlx::query(
            "CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO tiles VALUES (1, 0, 1, ?1)")
            .bind(daten)
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    }

    /// Öffnet `pfad` read-only und zählt die Öffnung mit.
    async fn oeffne_gezaehlt(
        pfad: &Path,
        zaehler: &std::sync::atomic::AtomicUsize,
    ) -> Result<sqlx::SqlitePool, sqlx::Error> {
        zaehler.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        oeffne_readonly(pfad).await
    }

    // LFH-934: Zwei Regionen, abwechselnd abgefragt wie MapLibre es mit zwei Vector-Sources tut —
    // jede Datei wird genau einmal geöffnet. Ein Cache mit einem Platz öffnete bei jedem Wechsel neu.
    #[tokio::test]
    async fn abwechselnder_abruf_oeffnet_jede_datei_einmal() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("karte-1.mbtiles");
        let b = dir.path().join("karte-2.mbtiles");
        schreibe_datei_fixture(&a, &[0xAA]).await;
        schreibe_datei_fixture(&b, &[0xBB]).await;
        let cache = ReaderCache::new();
        let oeffnungen = AtomicUsize::new(0);

        for _ in 0..10 {
            let pa = cache
                .reader_fuer(&a, &a, || oeffne_gezaehlt(&a, &oeffnungen))
                .await
                .unwrap();
            assert_eq!(lies_tile(&pa, 1, 0, 0).await.unwrap(), Some(vec![0xAA]));
            let pb = cache
                .reader_fuer(&b, &b, || oeffne_gezaehlt(&b, &oeffnungen))
                .await
                .unwrap();
            assert_eq!(lies_tile(&pb, 1, 0, 0).await.unwrap(), Some(vec![0xBB]));
        }
        assert_eq!(oeffnungen.load(Ordering::SeqCst), 2);
    }

    // Parallele Fehltreffer auf denselben Pfad öffnen einen einzigen Pool (Double-Check).
    #[tokio::test]
    async fn parallele_fehltreffer_oeffnen_einen_pool() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let dir = tempfile::tempdir().unwrap();
        let a = Arc::new(dir.path().join("karte-1.mbtiles"));
        schreibe_datei_fixture(&a, &[0xAA]).await;
        let cache = Arc::new(ReaderCache::new());
        let oeffnungen = Arc::new(AtomicUsize::new(0));

        let mut tasks = Vec::new();
        for _ in 0..8 {
            let (cache, a, oeffnungen) = (cache.clone(), a.clone(), oeffnungen.clone());
            tasks.push(tokio::spawn(async move {
                cache
                    .reader_fuer(&a, &a, || async {
                        // Öffnen dauert: alle Abrufe laufen in den Fehltreffer.
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        oeffne_gezaehlt(&a, &oeffnungen).await
                    })
                    .await
                    .unwrap()
            }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        assert_eq!(oeffnungen.load(Ordering::SeqCst), 1);
    }

    // Gezielte Invalidierung (LFH-934): Löschen und Neu-Download vergeben denselben Pfad bei neuer
    // Inode (LFH-195). Verworfen wird nur dieser Pfad; die andere Region behält ihren Pool.
    #[tokio::test]
    async fn verwerfen_trifft_nur_den_pfad() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("karte-1.mbtiles");
        let b = dir.path().join("karte-2.mbtiles");
        schreibe_datei_fixture(&a, &[0xAA]).await;
        schreibe_datei_fixture(&b, &[0xBB]).await;
        let cache = ReaderCache::new();
        let oeffnungen = AtomicUsize::new(0);
        cache
            .reader_fuer(&a, &a, || oeffne_gezaehlt(&a, &oeffnungen))
            .await
            .unwrap();
        cache
            .reader_fuer(&b, &b, || oeffne_gezaehlt(&b, &oeffnungen))
            .await
            .unwrap();

        // "Löschen + Neu-Download": gleicher Pfad, neue Inode, anderer Inhalt.
        std::fs::remove_file(&a).unwrap();
        schreibe_datei_fixture(&a, &[0xCC]).await;

        // Ohne Invalidierung liefert der gecachte Pool weiterhin den alten Inhalt.
        let noch_alt = cache
            .reader_fuer(&a, &a, || oeffne_gezaehlt(&a, &oeffnungen))
            .await
            .unwrap();
        assert_eq!(
            lies_tile(&noch_alt, 1, 0, 0).await.unwrap(),
            Some(vec![0xAA])
        );

        cache.verwerfen(&a);
        let neu = cache
            .reader_fuer(&a, &a, || oeffne_gezaehlt(&a, &oeffnungen))
            .await
            .unwrap();
        assert_eq!(lies_tile(&neu, 1, 0, 0).await.unwrap(), Some(vec![0xCC]));
        cache
            .reader_fuer(&b, &b, || oeffne_gezaehlt(&b, &oeffnungen))
            .await
            .unwrap();
        assert_eq!(oeffnungen.load(Ordering::SeqCst), 3, "nur a neu geöffnet");

        cache.leeren();
        assert_eq!(cache.anzahl(), 0);
    }

    // Zeigt derselbe Pfad auf ein anderes reales Ziel (Symlink umgebogen), öffnet der Cache neu
    // statt den alten Pool zu liefern.
    #[tokio::test]
    async fn neues_ziel_unter_altem_pfad_oeffnet_neu() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.mbtiles");
        let b = dir.path().join("b.mbtiles");
        let link = dir.path().join("link.mbtiles");
        schreibe_datei_fixture(&a, &[0xAA]).await;
        schreibe_datei_fixture(&b, &[0xBB]).await;
        let cache = ReaderCache::new();
        let pool = cache
            .reader_fuer(&link, &a, || oeffne_readonly(&a))
            .await
            .unwrap();
        assert_eq!(lies_tile(&pool, 1, 0, 0).await.unwrap(), Some(vec![0xAA]));
        let pool = cache
            .reader_fuer(&link, &b, || oeffne_readonly(&b))
            .await
            .unwrap();
        assert_eq!(lies_tile(&pool, 1, 0, 0).await.unwrap(), Some(vec![0xBB]));
        assert_eq!(cache.anzahl(), 1);
    }

    // Verwerfen trifft auch einen Alias, der auf dasselbe reale Ziel zeigt.
    #[tokio::test]
    async fn verwerfen_trifft_alias_auf_dasselbe_ziel() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("karte-1.mbtiles");
        let alias = dir.path().join("alias.mbtiles");
        let b = dir.path().join("karte-2.mbtiles");
        schreibe_datei_fixture(&a, &[0xAA]).await;
        schreibe_datei_fixture(&b, &[0xBB]).await;
        let cache = ReaderCache::new();
        cache
            .reader_fuer(&a, &a, || oeffne_readonly(&a))
            .await
            .unwrap();
        cache
            .reader_fuer(&alias, &a, || oeffne_readonly(&a))
            .await
            .unwrap();
        cache
            .reader_fuer(&b, &b, || oeffne_readonly(&b))
            .await
            .unwrap();
        cache.verwerfen(&a);
        assert_eq!(cache.anzahl(), 1, "nur b bleibt");
    }

    // Ein gescheitertes Öffnen hinterlässt keinen Eintrag; der nächste Abruf versucht es erneut.
    #[tokio::test]
    async fn fehlschlag_bleibt_nicht_im_cache() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("karte-1.mbtiles");
        let cache = ReaderCache::new();
        let r: Result<sqlx::SqlitePool, &str> =
            cache.reader_fuer(&a, &a, || async { Err("weg") }).await;
        assert_eq!(r.err(), Some("weg"));
        assert_eq!(cache.anzahl(), 0);

        schreibe_datei_fixture(&a, &[0xAA]).await;
        let pool = cache
            .reader_fuer(&a, &a, || oeffne_readonly(&a))
            .await
            .unwrap();
        assert_eq!(lies_tile(&pool, 1, 0, 0).await.unwrap(), Some(vec![0xAA]));
    }

    // Die Map wächst nicht über `MAX_READER` hinaus.
    #[tokio::test]
    async fn cache_bleibt_begrenzt() {
        let cache = ReaderCache::new();
        for i in 0..MAX_READER + 5 {
            let pfad = PathBuf::from(format!("/nirgends/karte-{i}.mbtiles"));
            cache
                .reader_fuer(&pfad, &pfad, || async {
                    SqlitePoolOptions::new()
                        .max_connections(1)
                        .connect("sqlite::memory:")
                        .await
                })
                .await
                .unwrap();
        }
        assert_eq!(cache.anzahl(), MAX_READER);
    }
}
