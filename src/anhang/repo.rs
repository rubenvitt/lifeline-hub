use super::AnhangAnzeige;
use crate::error::AppError;
use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};
use sqlx::{SqliteConnection, SqlitePool};

/// Karenz (Stunden), die ein verwaister Anhang „überleben" darf, bevor der Sweep ihn
/// entfernt — großzügig gewählt, damit ein regulärer Upload→Senden-Ablauf (Anhang wird
/// beim Nachricht-Senden verknüpft) nie in die Löschung läuft.
pub const VERWAISTE_KARENZ_STUNDEN: i64 = 24;

/// Projektion der Anzeige-Spalten (ohne `daten`/`sha256`).
const ANZEIGE_SELECT: &str =
    "SELECT id, einsatz_id, dateiname, mime, groesse, hochgeladen_von, erstellt_at FROM anhang";

/// Hex-Kodierung (kleingeschrieben) ohne externe Crate.
fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// SHA-256 der Bytes als Hex-String — Integritäts-/Dedup-Schlüssel und künftiger
/// Cache-Key des AV-Scan-Ergebnisses (LFH-114).
pub fn sha256_hex(daten: &[u8]) -> String {
    hex(&Sha256::digest(daten))
}

/// Lädt die Anzeige eines Anhangs. `NotFound`, wenn er nicht existiert.
pub async fn anzeige_laden(pool: &SqlitePool, id: i64) -> Result<AnhangAnzeige, AppError> {
    sqlx::query_as::<_, AnhangAnzeige>(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE id = ?"
    )))
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Persistiert einen Anhang (Bytes als BLOB) und liefert seine Anzeige.
/// `groesse` und `sha256` werden serverseitig aus den Bytes berechnet. Der INSERT selbst
/// liegt in [`anlegen_tx`], damit es ihn nur einmal gibt.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    hochgeladen_von: i64,
    dateiname: &str,
    mime: &str,
    daten: &[u8],
) -> Result<AnhangAnzeige, AppError> {
    let id = {
        let mut conn = pool.acquire().await?;
        anlegen_tx(
            &mut conn,
            einsatz_id,
            hochgeladen_von,
            dateiname,
            mime,
            daten,
        )
        .await?
    };
    anzeige_laden(pool, id).await
}

/// Persistiert einen Anhang INNERHALB einer offenen Transaktion und liefert die neue `id`
/// (LFH-632: Dokument-Ablage legt Anhang, Dokument und ETB-Eintrag atomar an). Die
/// Pool-Variante [`anlegen`] bleibt für den Chat-Upload.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    hochgeladen_von: i64,
    dateiname: &str,
    mime: &str,
    daten: &[u8],
) -> Result<i64, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(dateiname)
    .bind(mime)
    .bind(daten.len() as i64)
    .bind(sha256_hex(daten))
    .bind(daten)
    .bind(hochgeladen_von)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Lädt die Download-Metadaten OHNE die Bytes: `(dateiname, mime, sha256)`. Speist die
/// Cache-Header (ETag/Content-Type/Content-Disposition) und erlaubt die
/// `If-None-Match`-304-Kurzschluss-Antwort, ohne den (teuren) BLOB zu lesen (LFH-258).
/// `NotFound`, wenn der Anhang nicht existiert.
pub async fn meta_fuer_download(
    pool: &SqlitePool,
    id: i64,
) -> Result<(String, String, String), AppError> {
    sqlx::query_as::<_, (String, String, String)>(
        "SELECT dateiname, mime, sha256 FROM anhang WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Lädt die Bytes eines Anhangs für den Download: `(dateiname, mime, daten)`.
/// `NotFound`, wenn der Anhang nicht existiert.
pub async fn laden_bytes(
    pool: &SqlitePool,
    id: i64,
) -> Result<(String, String, Vec<u8>), AppError> {
    sqlx::query_as::<_, (String, String, Vec<u8>)>(
        "SELECT dateiname, mime, daten FROM anhang WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Prüft, ob ein Anhang zum angegebenen Einsatz gehört (Schutz gegen
/// Cross-Einsatz-Zugriff beim Download und beim Verknüpfen).
pub async fn gehoert_anhang_zu_einsatz(
    pool: &SqlitePool,
    anhang_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM anhang WHERE id = ? AND einsatz_id = ?")
            .bind(anhang_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Hard-Delete eines Anhangs, einsatz-gescopt (Ownership: `AND einsatz_id = ?` weist
/// fremde Anhänge ab). Der `ON DELETE CASCADE`-FK räumt die `chat_nachricht_anhang`-
/// Verknüpfungen automatisch mit. `NotFound`, wenn keine Zeile getroffen wird
/// (unbekannter oder fremder Anhang) — Freigabepfad gegen monotones Wachstum (LFH-250).
///
/// **Dokument-gebundene Anhänge löscht diese Funktion nie** (LFH-632): die Route weist sie
/// vorher mit 422 ab, der `NOT EXISTS`-Riegel im DELETE hält dasselbe atomar, auch für
/// künftige Aufrufer ohne die Routenprüfung und im Fenster zwischen `linker_stand` und
/// DELETE. Ohne ihn räumte `einsatz_dokument.anhang_id … ON DELETE CASCADE` die
/// Dokument-Zeile still mit weg — am Soft-Delete und seinem ETB-Nachweis vorbei. Der Fall
/// liefert `NotFound`, nicht 422: über DIESEN Pfad ist die Zeile nicht löschbar, und aus
/// `rows_affected() == 0` ist „unbekannt" von „gebunden" nicht zu trennen, ohne eine zweite
/// Abfrage, die das Rennen wieder öffnete. Im Rennfall antwortet die Route also 404.
///
/// **Dasselbe gilt für ETB-Anhänge** (LFH-117, zweites `NOT EXISTS`): sie sind bis zur
/// Schwärzung unveränderlich wie der Eintrag; die CASCADE von `etb_eintrag_anhang` nähme
/// sonst still die Verknüpfung mit, und der Eintrag verlöre seine Datei.
pub async fn loeschen(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "DELETE FROM anhang WHERE id = ? AND einsatz_id = ? \
           AND NOT EXISTS (SELECT 1 FROM einsatz_dokument d WHERE d.anhang_id = anhang.id) \
           AND NOT EXISTS (SELECT 1 FROM etb_eintrag_anhang l WHERE l.anhang_id = anhang.id)",
    )
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Wer einen Anhang referenziert — über ALLE Linker aggregiert (LFH-116 → LFH-632).
/// Vorher lag diese Frage chat-lokal in `chat::repo` und kannte nur einen Linker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkerStand {
    /// Verknüpfungen über `chat_nachricht_anhang`.
    pub chat_gesamt: i64,
    /// Davon an nicht soft-gelöschten Nachrichten.
    pub chat_lebend: i64,
    /// Verknüpfungen über `einsatz_dokument` (0 oder 1, `anhang_id UNIQUE`), gelöscht oder nicht.
    pub dokument_gesamt: i64,
    /// Verknüpfungen über `etb_eintrag_anhang` (0 oder 1, `anhang_id UNIQUE`, LFH-117).
    pub etb_gesamt: i64,
}

impl LinkerStand {
    /// Der Anhang gehört zur Dokumentenablage (LFH-632).
    pub fn ist_dokument(&self) -> bool {
        self.dokument_gesamt > 0
    }

    /// Der Anhang gehört zu einem ETB-Eintrag (LFH-117) und ist bis zur Schwärzung
    /// unveränderlich wie der Eintrag selbst.
    pub fn ist_etb(&self) -> bool {
        self.etb_gesamt > 0
    }

    /// Ob der **generische** Download (`GET /anhaenge/{aid}`) gesperrt ist:
    /// (a) ein Dokument-Anhang ist nur über die modul-gegatete Dokument-Route ladbar —
    ///     die generische Route ist modul-los (`PFAD_KEY … None`) und wäre sonst ein Bypass
    ///     für ein ausgeblendetes Dokumente-Modul und für soft-gelöschte Dokumente;
    /// (b) Chat-Tombstone (LFH-116): an ≥ 1 Nachricht verknüpft und ALLE tragen den
    ///     Tombstone. Ein verwaister Anhang (Upload→Senden) bleibt ladbar;
    /// (c) ein ETB-Anhang (LFH-117) ist nur über die ETB-Route ladbar — aus demselben Grund
    ///     wie (a): sonst umginge die modul-lose Route das Modul-Gate „etb".
    pub fn generischer_download_gesperrt(&self) -> bool {
        self.ist_dokument() || self.ist_etb() || (self.chat_gesamt > 0 && self.chat_lebend == 0)
    }

    /// An KEINEM Linker gebunden: hochgeladen, aber (noch) nicht gesendet oder erfasst. Die
    /// generische Route bedient einen solchen Anhang nur für die hochladende Person
    /// (LFH-117, Review C1) — wem er gehören wird, steht erst mit dem Linker fest.
    pub fn ist_ungebunden(&self) -> bool {
        self.chat_gesamt == 0 && self.dokument_gesamt == 0 && self.etb_gesamt == 0
    }
}

/// Wer den Anhang hochgeladen hat (`None`: unbekannt).
pub async fn hochgeladen_von(pool: &SqlitePool, anhang_id: i64) -> Result<Option<i64>, AppError> {
    sqlx::query_scalar("SELECT hochgeladen_von FROM anhang WHERE id = ?")
        .bind(anhang_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

/// Aggregiert die Linker eines Anhangs. Ein unbekannter Anhang liefert lauter Nullen —
/// die Existenz prüft der Aufrufer vorher (`gehoert_anhang_zu_einsatz`).
pub async fn linker_stand(pool: &SqlitePool, anhang_id: i64) -> Result<LinkerStand, AppError> {
    let (chat_gesamt, chat_lebend, dokument_gesamt, etb_gesamt): (i64, i64, i64, i64) =
        sqlx::query_as(
            "SELECT \
               (SELECT COUNT(*) FROM chat_nachricht_anhang WHERE anhang_id = ?1), \
               (SELECT COUNT(*) FROM chat_nachricht_anhang cna \
                  JOIN chat_nachricht n ON n.id = cna.nachricht_id \
                 WHERE cna.anhang_id = ?1 AND n.geloescht_at IS NULL), \
               (SELECT COUNT(*) FROM einsatz_dokument WHERE anhang_id = ?1), \
               (SELECT COUNT(*) FROM etb_eintrag_anhang WHERE anhang_id = ?1)",
        )
        .bind(anhang_id)
        .fetch_one(pool)
        .await?;
    Ok(LinkerStand {
        chat_gesamt,
        chat_lebend,
        dokument_gesamt,
        etb_gesamt,
    })
}

/// Löscht „verwaiste" Anhänge — an KEINEN Linker gebunden (weder `chat_nachricht_anhang`
/// noch `einsatz_dokument` noch `etb_eintrag_anhang`), z. B. hochgeladen aber nie gesendet
/// oder nie erfasst —, deren Upload länger als
/// [`VERWAISTE_KARENZ_STUNDEN`] zurückliegt. Gegen monotones BLOB-Wachstum (LFH-250).
/// Injiziertes `jetzt` = deterministisch testbar; der `WHERE`-Guard macht wiederholte Läufe
/// idempotent. Liefert die Anzahl gelöschter Anhänge.
///
/// **Jeder Linker gehört in dieses `NOT EXISTS`** — heute drei: Chat (LFH-102), Dokument
/// (LFH-632), ETB (LFH-117). Ein fehlender Linker macht keinen Fehler, sondern löscht dort
/// gebundene Dateien nach der Karenz still — die Tests
/// `sweep_verwaiste_haelt_dokument_gebundene_anhaenge` und
/// `sweep_verwaiste_haelt_etb_gebundene_anhaenge` pinnen das.
/// Ein soft-gelöschtes Dokument ist bewusst KEIN Orphan (Beweissicherung, LFH-632 E1).
pub async fn sweep_verwaiste(pool: &SqlitePool, jetzt: DateTime<Utc>) -> Result<u64, AppError> {
    let grenze = (jetzt - Duration::hours(VERWAISTE_KARENZ_STUNDEN))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let betroffen = sqlx::query(
        "DELETE FROM anhang \
         WHERE erstellt_at < ? \
           AND NOT EXISTS \
               (SELECT 1 FROM chat_nachricht_anhang cna WHERE cna.anhang_id = anhang.id) \
           AND NOT EXISTS \
               (SELECT 1 FROM einsatz_dokument d WHERE d.anhang_id = anhang.id) \
           AND NOT EXISTS \
               (SELECT 1 FROM etb_eintrag_anhang l WHERE l.anhang_id = anhang.id)",
    )
    .bind(grenze)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(betroffen)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer_id, einsatz_id)
    }

    #[test]
    fn sha256_hex_ist_stabil() {
        // Bekannter Vektor: SHA-256 der leeren Eingabe.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[tokio::test]
    async fn anlegen_und_laden_roundtrip() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let bytes = b"PDF-Inhalt";
        let a = anlegen(
            &pool,
            einsatz,
            benutzer,
            "lage.pdf",
            "application/pdf",
            bytes,
        )
        .await
        .unwrap();
        assert_eq!(a.dateiname, "lage.pdf");
        assert_eq!(a.mime, "application/pdf");
        assert_eq!(a.groesse, bytes.len() as i64);

        let (name, mime, daten) = laden_bytes(&pool, a.id).await.unwrap();
        assert_eq!(name, "lage.pdf");
        assert_eq!(mime, "application/pdf");
        assert_eq!(daten, bytes);
    }

    #[tokio::test]
    async fn gehoert_anhang_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = anlegen(&pool, einsatz, benutzer, "f.png", "image/png", b"x")
            .await
            .unwrap();

        assert!(gehoert_anhang_zu_einsatz(&pool, a.id, einsatz)
            .await
            .unwrap());
        assert!(!gehoert_anhang_zu_einsatz(&pool, a.id, 999).await.unwrap());
        assert!(!gehoert_anhang_zu_einsatz(&pool, 12345, einsatz)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn laden_bytes_unbekannt_ist_notfound() {
        let pool = crate::db::test_pool().await;
        setup(&pool).await;
        assert!(matches!(
            laden_bytes(&pool, 999).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    fn t(s: &str) -> DateTime<Utc> {
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
    }

    /// Verwaisten Anhang mit kontrolliertem `erstellt_at` direkt einfügen (umgeht
    /// `anlegen`s `datetime('now')`), um die Karenz-Grenze deterministisch zu prüfen.
    async fn anhang_mit_zeit(
        pool: &SqlitePool,
        einsatz_id: i64,
        von: i64,
        name: &str,
        erstellt_at: &str,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO anhang \
                (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von, erstellt_at) \
             VALUES (?, ?, 'application/pdf', 3, 'deadbeef', ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(name)
        .bind(b"ABC".as_slice())
        .bind(von)
        .bind(erstellt_at)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn sweep_verwaiste_loescht_alte_orphans_haelt_junge() {
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;

        // Zwei verwaiste Anhänge (nie an eine Nachricht gehängt), unterschiedlich alt.
        let alt = anhang_mit_zeit(&pool, einsatz, von, "alt.pdf", "2026-01-01 00:00:00").await;
        let jung = anhang_mit_zeit(&pool, einsatz, von, "jung.pdf", "2026-06-15 12:00:00").await;

        // jetzt = 2026-06-16 00:00:00 → Karenz-Grenze (24h) = 2026-06-15 00:00:00.
        let geloescht = sweep_verwaiste(&pool, t("2026-06-16 00:00:00"))
            .await
            .unwrap();
        assert_eq!(geloescht, 1, "nur der alte verwaiste Anhang wird gelöscht");

        assert!(
            anzeige_laden(&pool, alt).await.is_err(),
            "alter Orphan ist gelöscht"
        );
        assert!(
            anzeige_laden(&pool, jung).await.is_ok(),
            "junger Orphan bleibt (innerhalb Karenz)"
        );

        // Zweiter Lauf ohne neue Fälligkeit ist idempotent (0 gelöscht).
        let zweiter = sweep_verwaiste(&pool, t("2026-06-16 00:00:00"))
            .await
            .unwrap();
        assert_eq!(zweiter, 0, "idempotent: kein erneutes Löschen");
    }

    /// Hängt einen Anhang als Dokument an (direkter INSERT, inkl. ETB-Pflicht-FK).
    async fn als_dokument(
        pool: &SqlitePool,
        einsatz_id: i64,
        von: i64,
        anhang_id: i64,
        geloescht: bool,
    ) {
        let etb_id: i64 = sqlx::query_scalar(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, (SELECT COALESCE(MAX(lfd_nr), 0) + 1 FROM etb_eintrag WHERE einsatz_id = ?), \
                     'system', 'Dokument abgelegt', ?, datetime('now')) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(einsatz_id)
        .bind(von)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_dokument \
               (einsatz_id, anhang_id, kategorie, titel, etb_eintrag_id, abgelegt_von_id, geloescht_at) \
             VALUES (?, ?, 'foto', 'Titel', ?, ?, CASE WHEN ? THEN datetime('now') END)",
        )
        .bind(einsatz_id)
        .bind(anhang_id)
        .bind(etb_id)
        .bind(von)
        .bind(geloescht)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn sweep_verwaiste_haelt_dokument_gebundene_anhaenge() {
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;
        let dok = anhang_mit_zeit(&pool, einsatz, von, "plan.pdf", "2026-01-01 00:00:00").await;
        let geloeschtes_dok =
            anhang_mit_zeit(&pool, einsatz, von, "alt.pdf", "2026-01-01 00:00:00").await;
        als_dokument(&pool, einsatz, von, dok, false).await;
        als_dokument(&pool, einsatz, von, geloeschtes_dok, true).await;

        let geloescht = sweep_verwaiste(&pool, t("2026-06-16 00:00:00"))
            .await
            .unwrap();

        assert_eq!(
            geloescht, 0,
            "ein Dokument ist kein Orphan — auch ein soft-gelöschtes nicht"
        );
        assert!(anzeige_laden(&pool, dok).await.is_ok());
        assert!(anzeige_laden(&pool, geloeschtes_dok).await.is_ok());
    }

    #[tokio::test]
    async fn loeschen_verweigert_dokument_gebundene_anhaenge() {
        // LFH-632: die Route weist dokument-gebundene Anhänge mit 422 ab; der Repo-Riegel
        // hält dasselbe auch ohne sie (und im Fenster zwischen Linker-Prüfung und DELETE).
        // Ohne ihn räumte die CASCADE die `einsatz_dokument`-Zeile still mit weg.
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;
        let frei = anhang_mit_zeit(&pool, einsatz, von, "a.pdf", "2026-01-01 00:00:00").await;
        let dok = anhang_mit_zeit(&pool, einsatz, von, "b.pdf", "2026-01-01 00:00:00").await;
        als_dokument(&pool, einsatz, von, dok, false).await;

        assert!(matches!(
            loeschen(&pool, einsatz, dok).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(
            anzeige_laden(&pool, dok).await.is_ok(),
            "Dokument-Anhang bleibt"
        );
        let dokumente: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_dokument WHERE anhang_id = ?")
                .bind(dok)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(dokumente, 1, "die Dokument-Zeile bleibt (keine CASCADE)");

        // Gegenaussage: ein freier Anhang desselben Einsatzes wird gelöscht.
        loeschen(&pool, einsatz, frei).await.unwrap();
        assert!(anzeige_laden(&pool, frei).await.is_err());
    }

    #[tokio::test]
    async fn linker_stand_zaehlt_beide_linker() {
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;
        let frei = anhang_mit_zeit(&pool, einsatz, von, "a.pdf", "2026-01-01 00:00:00").await;
        let dok = anhang_mit_zeit(&pool, einsatz, von, "b.pdf", "2026-01-01 00:00:00").await;
        als_dokument(&pool, einsatz, von, dok, false).await;

        let s = linker_stand(&pool, frei).await.unwrap();
        assert_eq!((s.chat_gesamt, s.chat_lebend, s.dokument_gesamt), (0, 0, 0));
        assert!(!s.ist_dokument());
        assert!(
            !s.generischer_download_gesperrt(),
            "verwaist bleibt ladbar (Upload→Senden)"
        );

        let s = linker_stand(&pool, dok).await.unwrap();
        assert_eq!(s.dokument_gesamt, 1);
        assert!(s.ist_dokument());
        assert!(
            s.generischer_download_gesperrt(),
            "Dokument-Anhang nur über die Modul-Route"
        );
    }

    #[test]
    fn ungebunden_heisst_an_keinem_der_drei_linker() {
        let null = LinkerStand {
            chat_gesamt: 0,
            chat_lebend: 0,
            dokument_gesamt: 0,
            etb_gesamt: 0,
        };
        assert!(null.ist_ungebunden());
        // Auch ein toter Chat-Linker bindet: der Tombstone sperrt dann ohnehin (LFH-116).
        for gebunden in [
            LinkerStand {
                chat_gesamt: 1,
                ..null
            },
            LinkerStand {
                dokument_gesamt: 1,
                ..null
            },
            LinkerStand {
                etb_gesamt: 1,
                ..null
            },
        ] {
            assert!(!gebunden.ist_ungebunden(), "{gebunden:?}");
        }
    }

    #[test]
    fn generischer_download_gesperrt_folgt_dem_chat_tombstone() {
        let nur_tot = LinkerStand {
            chat_gesamt: 2,
            chat_lebend: 0,
            dokument_gesamt: 0,
            etb_gesamt: 0,
        };
        let einer_lebt = LinkerStand {
            chat_gesamt: 2,
            chat_lebend: 1,
            dokument_gesamt: 0,
            etb_gesamt: 0,
        };
        // Dokument hat Vorrang: auch eine lebende Chat-Verknüpfung öffnet den generischen
        // Download nicht (LFH-632).
        let dokument_und_lebender_chat = LinkerStand {
            chat_gesamt: 1,
            chat_lebend: 1,
            dokument_gesamt: 1,
            etb_gesamt: 0,
        };
        // Dasselbe für das ETB (LFH-117): die Kreuzsperren verhindern den Zustand, aber die
        // Sperre darf nicht davon abhängen, dass es sie gibt.
        let etb_und_lebender_chat = LinkerStand {
            chat_gesamt: 1,
            chat_lebend: 1,
            dokument_gesamt: 0,
            etb_gesamt: 1,
        };
        assert!(nur_tot.generischer_download_gesperrt());
        assert!(!einer_lebt.generischer_download_gesperrt());
        assert!(dokument_und_lebender_chat.generischer_download_gesperrt());
        assert!(etb_und_lebender_chat.generischer_download_gesperrt());
    }

    // --- LFH-117: `etb_eintrag_anhang` als dritter Linker ---

    /// Hängt einen Anhang an einen frischen ETB-Eintrag (direkter INSERT).
    async fn als_etb(pool: &SqlitePool, einsatz_id: i64, von: i64, anhang_id: i64) -> i64 {
        let etb_id: i64 = sqlx::query_scalar(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, (SELECT COALESCE(MAX(lfd_nr), 0) + 1 FROM etb_eintrag WHERE einsatz_id = ?), \
                     'meldung', 'Foto der Schadenstelle', ?, datetime('now')) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(einsatz_id)
        .bind(von)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO etb_eintrag_anhang (eintrag_id, anhang_id) VALUES (?, ?)")
            .bind(etb_id)
            .bind(anhang_id)
            .execute(pool)
            .await
            .unwrap();
        etb_id
    }

    #[tokio::test]
    async fn linker_stand_zaehlt_den_etb_linker() {
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;
        let frei = anhang_mit_zeit(&pool, einsatz, von, "a.jpg", "2026-01-01 00:00:00").await;
        let etb = anhang_mit_zeit(&pool, einsatz, von, "b.jpg", "2026-01-01 00:00:00").await;
        als_etb(&pool, einsatz, von, etb).await;

        let s = linker_stand(&pool, frei).await.unwrap();
        assert_eq!(s.etb_gesamt, 0);
        assert!(!s.ist_etb());
        assert!(!s.generischer_download_gesperrt());

        let s = linker_stand(&pool, etb).await.unwrap();
        assert_eq!(s.etb_gesamt, 1);
        assert!(s.ist_etb());
        assert!(
            s.generischer_download_gesperrt(),
            "ETB-Anhang nur über die ETB-Route ladbar"
        );
    }

    #[tokio::test]
    async fn sweep_verwaiste_haelt_etb_gebundene_anhaenge() {
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;
        let etb = anhang_mit_zeit(&pool, einsatz, von, "foto.jpg", "2026-01-01 00:00:00").await;
        let frei = anhang_mit_zeit(&pool, einsatz, von, "frei.jpg", "2026-01-01 00:00:00").await;
        als_etb(&pool, einsatz, von, etb).await;

        let geloescht = sweep_verwaiste(&pool, t("2026-06-16 00:00:00"))
            .await
            .unwrap();

        assert_eq!(geloescht, 1, "nur der nie gebundene Anhang geht");
        assert!(
            anzeige_laden(&pool, etb).await.is_ok(),
            "ein ETB-Anhang ist kein Orphan, gleich wie alt"
        );
        assert!(anzeige_laden(&pool, frei).await.is_err());
    }

    #[tokio::test]
    async fn loeschen_verweigert_etb_gebundene_anhaenge() {
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;
        let frei = anhang_mit_zeit(&pool, einsatz, von, "a.jpg", "2026-01-01 00:00:00").await;
        let etb = anhang_mit_zeit(&pool, einsatz, von, "b.jpg", "2026-01-01 00:00:00").await;
        als_etb(&pool, einsatz, von, etb).await;

        assert!(matches!(
            loeschen(&pool, einsatz, etb).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(anzeige_laden(&pool, etb).await.is_ok(), "ETB-Anhang bleibt");
        let links: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag_anhang WHERE anhang_id = ?")
                .bind(etb)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(links, 1, "die Verknüpfung bleibt (keine CASCADE)");

        loeschen(&pool, einsatz, frei).await.unwrap();
        assert!(anzeige_laden(&pool, frei).await.is_err());
    }
}
