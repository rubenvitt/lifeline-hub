//! Vorschläge von Fremdsystemen für den Meldungseingang (LLH-2112).
//!
//! Ein Maschinenzugang mit `meldungen:write` legt einen kurzen Text als unbestätigten Vorschlag
//! ab; ein Mensch übernimmt ihn als Meldung oder verwirft ihn (Design-Doc
//! `docs/superpowers/specs/2026-11-28-jd4jgna4-maschinen-eingang-meldungen-design.md`).
//!
//! **Abgelaufen** ist kein gespeicherter Zustand: ein offener Vorschlag gilt als abgelaufen, wenn
//! er älter als [`ABLAUF_STUNDEN`] Stunden ist, sein Einsatz nicht aktiv ist oder die Instanz den
//! Einsatz nicht mehr führt (Zeile in `einsatz_spiegel`). Alle Lesewege teilen das Prädikat
//! [`ist_abgelaufen_sql`]; `?1` ist dort immer `jetzt`.

use crate::error::AppError;
use sqlx::{Row, SqliteConnection, SqlitePool};

/// Ein offener Vorschlag verfällt nach so vielen Stunden ab `empfangen_at`.
pub const ABLAUF_STUNDEN: i64 = 12;
/// Erledigte Vorschläge (und offene ab Empfang) werden nach so vielen Tagen gelöscht.
pub const AUFBEWAHRUNG_TAGE: i64 = 7;

/// Prädikat „Vorschlag (Alias `v`) ist abgelaufen“, nur sinnvoll zusammen mit `v.status = 'offen'`.
/// Die Stunden stehen als Literal (`concat!`) und müssen [`ABLAUF_STUNDEN`] gleichen; ein Test
/// (`ablaufpraedikat_nutzt_ablauf_stunden`) hält beide zusammen.
/// `?1` ist `jetzt`. Es gibt kein zweites: Liste, Zähler, Laden und Übernehmen beziehen es von hier.
macro_rules! ist_abgelaufen_sql {
    () => {
        concat!(
            "(v.empfangen_at < datetime(?1, '-12 hours') \
             OR EXISTS (SELECT 1 FROM einsatz e WHERE e.id = v.einsatz_id AND e.status != 'aktiv') \
             OR EXISTS (SELECT 1 FROM einsatz_spiegel s WHERE s.einsatz_id = v.einsatz_id))"
        )
    };
}

/// Der Status einer Zeile, wie ihn die Lesewege melden (`abgelaufen` abgeleitet).
macro_rules! status_sql {
    () => {
        concat!(
            "CASE WHEN v.status = 'offen' AND ",
            ist_abgelaufen_sql!(),
            " THEN 'abgelaufen' ELSE v.status END"
        )
    };
}

const SPALTEN: &str = "v.id, v.einsatz_id, v.text, v.adapter, v.absender_kennung, \
                       v.absender_name, v.signiert, v.gesendet_at, v.empfangen_at";

/// Wer den Vorschlag geschickt hat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Herkunft {
    pub adapter: String,
    pub kennung: String,
    pub name: Option<String>,
    pub signiert: bool,
}

/// Eingabe für [`einreichen_tx`] (vom Handler geprüft).
#[derive(Debug)]
pub struct NeuerVorschlag<'a> {
    pub einsatz_id: i64,
    pub zugang_id: &'a str,
    pub external_id: &'a str,
    pub text: &'a str,
    pub herkunft: &'a Herkunft,
    pub gesendet_at: Option<&'a str>,
    pub empfangen_at: &'a str,
}

crate::wire_enum::wire_enum! {
    #[wire(ohne_serde)]
    /// Zustand eines Vorschlags; `Abgelaufen` wird beim Lesen bestimmt, nicht gespeichert.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum VorschlagStatus {
        Offen => "offen",
        Angenommen => "angenommen",
        Verworfen => "verworfen",
        Abgelaufen => "abgelaufen",
    }
    try_from = |s| format!("Ungültiger Vorschlagsstatus: {s}");
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Vorschlag {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` nach der Übernahme (der Wortlaut steht dann in der Meldung) und nach dem Verwerfen
    /// bleibt er stehen bis zum Löschlauf.
    pub text: Option<String>,
    pub herkunft: Herkunft,
    pub gesendet_at: Option<String>,
    pub empfangen_at: String,
    pub status: VorschlagStatus,
}

fn aus_zeile(r: &sqlx::sqlite::SqliteRow, status: &str) -> Result<Vorschlag, AppError> {
    Ok(Vorschlag {
        id: r.try_get("id")?,
        einsatz_id: r.try_get("einsatz_id")?,
        text: r.try_get("text")?,
        herkunft: Herkunft {
            adapter: r.try_get("adapter")?,
            kennung: r.try_get("absender_kennung")?,
            name: r.try_get("absender_name")?,
            signiert: r.try_get::<i64, _>("signiert")? != 0,
        },
        gesendet_at: r.try_get("gesendet_at")?,
        empfangen_at: r.try_get("empfangen_at")?,
        status: VorschlagStatus::parse(status).ok_or_else(|| {
            AppError::Internal(format!("Vorschlag mit unbekanntem Status: {status}"))
        })?,
    })
}

async fn lade_je_external_id(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    external_id: &str,
    jetzt: &str,
) -> Result<Vorschlag, AppError> {
    let sql = format!(
        "SELECT {SPALTEN}, {status} AS status_ber FROM meldung_vorschlag v \
         WHERE v.zugang_id = ?2 AND v.external_id = ?3",
        status = status_sql!()
    );
    let r = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(jetzt)
        .bind(zugang_id)
        .bind(external_id)
        .fetch_one(&mut *conn)
        .await?;
    let status: String = r.try_get("status_ber")?;
    aus_zeile(&r, &status)
}

/// Legt einen Vorschlag an. Gibt es `(zugang_id, external_id)` schon, kommt der Bestand mit seinem
/// bestimmten Status zurück, und das Flag ist `false` (Dopplung, jeder Status).
pub async fn einreichen_tx(
    conn: &mut SqliteConnection,
    neu: &NeuerVorschlag<'_>,
    jetzt: &str,
) -> Result<(Vorschlag, bool), AppError> {
    let eingefuegt = sqlx::query(
        "INSERT INTO meldung_vorschlag (einsatz_id, zugang_id, external_id, text, adapter, \
         absender_kennung, absender_name, signiert, gesendet_at, empfangen_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (zugang_id, external_id) DO NOTHING",
    )
    .bind(neu.einsatz_id)
    .bind(neu.zugang_id)
    .bind(neu.external_id)
    .bind(neu.text)
    .bind(&neu.herkunft.adapter)
    .bind(&neu.herkunft.kennung)
    .bind(&neu.herkunft.name)
    .bind(neu.herkunft.signiert)
    .bind(neu.gesendet_at)
    .bind(neu.empfangen_at)
    .execute(&mut *conn)
    .await?
    .rows_affected()
        == 1;
    let v = lade_je_external_id(conn, neu.zugang_id, neu.external_id, jetzt).await?;
    Ok((v, eingefuegt))
}

/// Die offenen, nicht abgelaufenen Vorschläge eines Einsatzes, älteste zuerst.
pub async fn offene(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<Vec<Vorschlag>, AppError> {
    let sql = format!(
        "SELECT {SPALTEN} FROM meldung_vorschlag v \
         WHERE v.einsatz_id = ?2 AND v.status = 'offen' AND NOT {abgelaufen} \
         ORDER BY v.empfangen_at, v.id",
        abgelaufen = ist_abgelaufen_sql!()
    );
    let zeilen = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(jetzt)
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
    zeilen.iter().map(|r| aus_zeile(r, "offen")).collect()
}

/// Anzahl der offenen, nicht abgelaufenen Vorschläge eines Einsatzes.
pub async fn zaehle_offene(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<i64, AppError> {
    let sql = format!(
        "SELECT COUNT(*) FROM meldung_vorschlag v \
         WHERE v.einsatz_id = ?2 AND v.status = 'offen' AND NOT {abgelaufen}",
        abgelaufen = ist_abgelaufen_sql!()
    );
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(jetzt)
        .bind(einsatz_id)
        .fetch_one(pool)
        .await?)
}

/// Lädt einen Vorschlag des Einsatzes, der noch offen und nicht abgelaufen ist. Fremd oder
/// unbekannt ist `NotFound`, nicht mehr offen oder abgelaufen ist `Conflict`.
pub async fn laden_offen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    vorschlag_id: i64,
    jetzt: &str,
) -> Result<Vorschlag, AppError> {
    let sql = format!(
        "SELECT {SPALTEN}, {status} AS status_ber FROM meldung_vorschlag v \
         WHERE v.id = ?2 AND v.einsatz_id = ?3",
        status = status_sql!()
    );
    let r = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(jetzt)
        .bind(vorschlag_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
    let status: String = r.try_get("status_ber")?;
    if status != "offen" {
        return Err(AppError::Conflict(
            "Der Vorschlag ist nicht mehr offen".into(),
        ));
    }
    aus_zeile(&r, &status)
}

/// Schließt einen offenen Vorschlag ab (`angenommen` oder `verworfen`); 0 Zeilen heißt
/// nicht mehr offen oder abgelaufen.
async fn erledige_tx(
    conn: &mut SqliteConnection,
    status: &str,
    leere_text: bool,
    einsatz_id: Option<i64>,
    vorschlag_id: i64,
    meldung_id: Option<i64>,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    let sql = format!(
        "UPDATE meldung_vorschlag AS v SET status = ?2, \
         text = CASE WHEN ?3 THEN NULL ELSE v.text END, meldung_id = ?4, \
         erledigt_at = ?1, erledigt_von_id = ?5 \
         WHERE v.id = ?6 AND (?7 IS NULL OR v.einsatz_id = ?7) \
         AND v.status = 'offen' AND NOT {abgelaufen}",
        abgelaufen = ist_abgelaufen_sql!()
    );
    let n = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(jetzt)
        .bind(status)
        .bind(leere_text)
        .bind(meldung_id)
        .bind(benutzer_id)
        .bind(vorschlag_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    if n == 0 {
        let vorhanden: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM meldung_vorschlag WHERE id = ? AND (?2 IS NULL OR einsatz_id = ?2)",
        )
        .bind(vorschlag_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        return Err(match vorhanden {
            None => AppError::NotFound,
            Some(_) => AppError::Conflict("Der Vorschlag ist nicht mehr offen".into()),
        });
    }
    Ok(())
}

/// Übernimmt den Vorschlag als Meldung: Status `angenommen`, Text geleert, `meldung_id`,
/// `erledigt_*`, und die Herkunft wandert in die Meldung (sie überlebt den Vorschlag). Nur aus
/// `offen` und nicht abgelaufen, sonst `Conflict`.
pub async fn annehmen_tx(
    conn: &mut SqliteConnection,
    vorschlag_id: i64,
    meldung_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    erledige_tx(
        conn,
        "angenommen",
        true,
        None,
        vorschlag_id,
        Some(meldung_id),
        benutzer_id,
        jetzt,
    )
    .await?;
    sqlx::query(
        "UPDATE meldung SET (herkunft_adapter, herkunft_kennung, herkunft_name, \
         herkunft_signiert) = (SELECT adapter, absender_kennung, absender_name, signiert \
         FROM meldung_vorschlag WHERE id = ?1) WHERE id = ?2",
    )
    .bind(vorschlag_id)
    .bind(meldung_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Verwirft einen offenen Vorschlag des Einsatzes. Fremd oder unbekannt ist `NotFound`, nicht
/// mehr offen oder abgelaufen ist `Conflict`.
pub async fn verwerfen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    vorschlag_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    erledige_tx(
        conn,
        "verworfen",
        false,
        Some(einsatz_id),
        vorschlag_id,
        None,
        benutzer_id,
        jetzt,
    )
    .await
}

/// Löschlauf (Purge, Phase C): [`AUFBEWAHRUNG_TAGE`] Tage nach `erledigt_at`, bei offenen nach
/// `empfangen_at`. Gibt die Zahl der gelöschten Zeilen zurück.
pub async fn purge(pool: &SqlitePool, jetzt: &str) -> Result<u64, AppError> {
    Ok(sqlx::query(
        "DELETE FROM meldung_vorschlag WHERE \
         (erledigt_at IS NOT NULL AND erledigt_at < datetime(?1, ?2)) \
         OR (status = 'offen' AND empfangen_at < datetime(?1, ?2))",
    )
    .bind(jetzt)
    .bind(format!("-{AUFBEWAHRUNG_TAGE} days"))
    .execute(pool)
    .await?
    .rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::public_api::scope::Scope;
    use crate::public_api::zugang;

    const JETZT: &str = "2026-11-28 10:00:00";

    /// Das SQL-Prädikat braucht ein Literal (`concat!`); dieser Test bindet es an
    /// [`ABLAUF_STUNDEN`], damit eine Änderung der Konstante den Ablauf mitändert (Review M6).
    #[test]
    fn ablaufpraedikat_nutzt_ablauf_stunden() {
        assert!(
            ist_abgelaufen_sql!().contains(&format!("datetime(?1, '-{ABLAUF_STUNDEN} hours')")),
            "ist_abgelaufen_sql! weicht von ABLAUF_STUNDEN ab"
        );
    }

    async fn grundlage(pool: &SqlitePool) -> (i64, String, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'E') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let z = {
            let mut c = pool.acquire().await.unwrap();
            zugang::anlegen(&mut c, 1, "Z1", &[Scope::LageRead], None, None, JETZT)
                .await
                .unwrap()
        };
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leitung', 'x') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz, z, benutzer)
    }

    fn herkunft() -> Herkunft {
        Herkunft {
            adapter: "boswatch".into(),
            kennung: "wache-1".into(),
            name: Some("Wache 1".into()),
            signiert: true,
        }
    }

    async fn reiche(
        pool: &SqlitePool,
        einsatz_id: i64,
        zugang_id: &str,
        external_id: &str,
        empfangen_at: &str,
        jetzt: &str,
    ) -> (Vorschlag, bool) {
        let h = herkunft();
        let mut c = pool.acquire().await.unwrap();
        einreichen_tx(
            &mut c,
            &NeuerVorschlag {
                einsatz_id,
                zugang_id,
                external_id,
                text: "Keller läuft voll",
                herkunft: &h,
                gesendet_at: Some("2026-11-28 09:59:00"),
                empfangen_at,
            },
            jetzt,
        )
        .await
        .unwrap()
    }

    async fn meldung(pool: &SqlitePool, einsatz_id: i64, benutzer: i64) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, ereigniszeit, \
             eingang_at, erfasst_von_id) VALUES (?, 1, 'A', 'sonstige', 'x', ?2, ?2, ?3) \
             RETURNING id",
        )
        .bind(einsatz_id)
        .bind(JETZT)
        .bind(benutzer)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn einreichen_legt_an_und_meldet_die_dopplung() {
        let pool = db::test_pool().await;
        let (e, z, _) = grundlage(&pool).await;
        let (a, neu_a) = reiche(&pool, e, &z, "ext-1", JETZT, JETZT).await;
        let (b, neu_b) = reiche(&pool, e, &z, "ext-1", JETZT, JETZT).await;
        assert!(neu_a);
        assert!(!neu_b);
        assert_eq!(a.id, b.id);
        assert_eq!(a.status, VorschlagStatus::Offen);
        assert_eq!(a.herkunft, herkunft());
        assert_eq!(a.text.as_deref(), Some("Keller läuft voll"));
    }

    #[tokio::test]
    async fn gleiche_external_id_zweier_zugaenge_sind_zwei_vorschlaege() {
        let pool = db::test_pool().await;
        let (e, z1, _) = grundlage(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        let z2 = zugang::anlegen(&mut c, 1, "Z2", &[Scope::LageRead], None, None, JETZT)
            .await
            .unwrap();
        drop(c);
        let (a, neu_a) = reiche(&pool, e, &z1, "ext-1", JETZT, JETZT).await;
        let (b, neu_b) = reiche(&pool, e, &z2, "ext-1", JETZT, JETZT).await;
        assert!(neu_a && neu_b);
        assert_ne!(a.id, b.id);
        assert_eq!(zaehle_offene(&pool, e, JETZT).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn nach_zwoelf_stunden_ist_ein_vorschlag_abgelaufen() {
        let pool = db::test_pool().await;
        let (e, z, _) = grundlage(&pool).await;
        let (v, _) = reiche(&pool, e, &z, "ext-1", JETZT, JETZT).await;
        // Genau zwölf Stunden zählen noch nicht als abgelaufen.
        let genau = "2026-11-28 22:00:00";
        assert_eq!(offene(&pool, e, genau).await.unwrap().len(), 1);
        let spaeter = "2026-11-28 22:01:00";
        assert!(offene(&pool, e, spaeter).await.unwrap().is_empty());
        assert_eq!(zaehle_offene(&pool, e, spaeter).await.unwrap(), 0);
        let (b, neu) = reiche(&pool, e, &z, "ext-1", JETZT, spaeter).await;
        assert!(!neu);
        assert_eq!(b.status, VorschlagStatus::Abgelaufen);
        let mut c = pool.acquire().await.unwrap();
        let fehler = laden_offen_tx(&mut c, e, v.id, spaeter).await.unwrap_err();
        assert!(matches!(fehler, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn am_abgeschlossenen_einsatz_und_am_spiegel_abgelaufen() {
        let pool = db::test_pool().await;
        let (e, z, _) = grundlage(&pool).await;
        let (v, _) = reiche(&pool, e, &z, "ext-1", JETZT, JETZT).await;
        sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        assert!(offene(&pool, e, JETZT).await.unwrap().is_empty());
        let mut c = pool.acquire().await.unwrap();
        assert!(matches!(
            laden_offen_tx(&mut c, e, v.id, JETZT).await,
            Err(AppError::Conflict(_))
        ));
        drop(c);

        let (e2, _, _) = {
            let id: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Spiegel') RETURNING id",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            (id, (), ())
        };
        let (v2, _) = reiche(&pool, e2, &z, "ext-2", JETZT, JETZT).await;
        assert_eq!(offene(&pool, e2, JETZT).await.unwrap().len(), 1);
        crate::einsatz::spiegel_filter::als_spiegel_markieren(&pool, e2).await;
        assert!(offene(&pool, e2, JETZT).await.unwrap().is_empty());
        let mut c = pool.acquire().await.unwrap();
        assert!(matches!(
            laden_offen_tx(&mut c, e2, v2.id, JETZT).await,
            Err(AppError::Conflict(_))
        ));
    }

    #[tokio::test]
    async fn annehmen_leert_den_text_und_setzt_die_herkunft_der_meldung() {
        let pool = db::test_pool().await;
        let (e, z, b) = grundlage(&pool).await;
        let (v, _) = reiche(&pool, e, &z, "ext-1", JETZT, JETZT).await;
        let m = meldung(&pool, e, b).await;
        let mut c = pool.acquire().await.unwrap();
        annehmen_tx(&mut c, v.id, m, b, JETZT).await.unwrap();
        drop(c);
        let r = sqlx::query(
            "SELECT status, text, meldung_id, erledigt_at, erledigt_von_id \
             FROM meldung_vorschlag WHERE id = ?",
        )
        .bind(v.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(r.get::<String, _>("status"), "angenommen");
        assert_eq!(r.get::<Option<String>, _>("text"), None);
        assert_eq!(r.get::<Option<i64>, _>("meldung_id"), Some(m));
        assert_eq!(
            r.get::<Option<String>, _>("erledigt_at").as_deref(),
            Some(JETZT)
        );
        assert_eq!(r.get::<Option<i64>, _>("erledigt_von_id"), Some(b));
        let h = sqlx::query(
            "SELECT herkunft_adapter, herkunft_kennung, herkunft_name, herkunft_signiert \
             FROM meldung WHERE id = ?",
        )
        .bind(m)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(h.get::<Option<String>, _>(0).as_deref(), Some("boswatch"));
        assert_eq!(h.get::<Option<String>, _>(1).as_deref(), Some("wache-1"));
        assert_eq!(h.get::<Option<String>, _>(2).as_deref(), Some("Wache 1"));
        assert_eq!(h.get::<Option<i64>, _>(3), Some(1));
        assert!(offene(&pool, e, JETZT).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn annehmen_zweimal_ist_ein_konflikt() {
        let pool = db::test_pool().await;
        let (e, z, b) = grundlage(&pool).await;
        let (v, _) = reiche(&pool, e, &z, "ext-1", JETZT, JETZT).await;
        let m = meldung(&pool, e, b).await;
        let mut c = pool.acquire().await.unwrap();
        annehmen_tx(&mut c, v.id, m, b, JETZT).await.unwrap();
        let zweites = annehmen_tx(&mut c, v.id, m, b, JETZT).await.unwrap_err();
        assert!(matches!(zweites, AppError::Conflict(_)));
        let verwerfen = verwerfen_tx(&mut c, e, v.id, b, JETZT).await.unwrap_err();
        assert!(matches!(verwerfen, AppError::Conflict(_)));
        let fremd = verwerfen_tx(&mut c, e + 99, v.id, b, JETZT)
            .await
            .unwrap_err();
        assert!(matches!(fremd, AppError::NotFound));
    }

    #[tokio::test]
    async fn verwerfen_schliesst_den_offenen_vorschlag() {
        let pool = db::test_pool().await;
        let (e, z, b) = grundlage(&pool).await;
        let (v, _) = reiche(&pool, e, &z, "ext-1", JETZT, JETZT).await;
        let mut c = pool.acquire().await.unwrap();
        verwerfen_tx(&mut c, e, v.id, b, JETZT).await.unwrap();
        drop(c);
        assert_eq!(zaehle_offene(&pool, e, JETZT).await.unwrap(), 0);
        let (d, neu) = reiche(&pool, e, &z, "ext-1", JETZT, JETZT).await;
        assert!(!neu);
        assert_eq!(d.status, VorschlagStatus::Verworfen);
    }

    #[tokio::test]
    async fn purge_loescht_nach_sieben_tagen_und_laesst_juengere() {
        let pool = db::test_pool().await;
        let (e, z, b) = grundlage(&pool).await;
        // Offen, älter als sieben Tage; offen, jünger; erledigt vor acht Tagen; erledigt vor sechs.
        let alt = "2026-11-20 09:00:00";
        let (a, _) = reiche(&pool, e, &z, "alt", alt, alt).await;
        let (j, _) = reiche(&pool, e, &z, "jung", "2026-11-27 09:00:00", JETZT).await;
        let (x, _) = reiche(&pool, e, &z, "erledigt-alt", "2026-11-19 09:00:00", alt).await;
        let (y, _) = reiche(&pool, e, &z, "erledigt-jung", "2026-11-22 09:00:00", alt).await;
        sqlx::query("UPDATE meldung_vorschlag SET status = 'verworfen', erledigt_at = '2026-11-20 08:00:00', erledigt_von_id = ? WHERE id = ?")
            .bind(b).bind(x.id).execute(&pool).await.unwrap();
        sqlx::query("UPDATE meldung_vorschlag SET status = 'verworfen', erledigt_at = '2026-11-22 12:00:00', erledigt_von_id = ? WHERE id = ?")
            .bind(b).bind(y.id).execute(&pool).await.unwrap();
        assert_eq!(purge(&pool, JETZT).await.unwrap(), 2);
        let rest: Vec<i64> = sqlx::query_scalar("SELECT id FROM meldung_vorschlag ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rest, vec![j.id, y.id]);
        assert!(!rest.contains(&a.id));
    }
}
