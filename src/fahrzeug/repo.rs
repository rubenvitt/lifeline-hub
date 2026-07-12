use super::{Fahrzeug, FahrzeugVorschlaege, DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};
use crate::error::AppError;
use crate::staerke::Staerke;
use sqlx::SqlitePool;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Fahrzeug` (FromRow).
const SPALTEN: &str = "id, org_id, funkrufname, fahrzeugtyp, traegerorganisation, kennzeichen, \
     opta, standort, fms_issi, sondersignal, tragenkapazitaet, staerke_fuehrer, \
     staerke_unterfuehrer, staerke_mannschaft, bemerkung, dienststatus, angelegt_at";

/// Editierbare Stammfelder. Optional-Strings sind bereits getrimmt; leer → `None`.
/// `staerke` ist bereits validiert (alle drei oder keiner).
#[derive(Debug)]
pub struct FahrzeugDaten<'a> {
    pub funkrufname: &'a str,
    pub fahrzeugtyp: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub kennzeichen: Option<&'a str>,
    pub opta: Option<&'a str>,
    pub standort: Option<&'a str>,
    pub fms_issi: Option<&'a str>,
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke: Option<Staerke>,
    pub bemerkung: Option<&'a str>,
}

/// Zerlegt eine optionale Stärke in drei `Option<i64>` (DB-Spalten).
fn zerlege_staerke(s: Option<Staerke>) -> (Option<i64>, Option<i64>, Option<i64>) {
    match s {
        Some(s) => (
            Some(s.fuehrer as i64),
            Some(s.unterfuehrer as i64),
            Some(s.mannschaft as i64),
        ),
        None => (None, None, None),
    }
}

/// Übersetzt einen Unique-Verstoß auf dem Funkrufname-Index in `Conflict`.
fn funkrufname_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Funkrufname ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt ein Fahrzeug der eigenen Org; `NotFound`, falls unbekannt oder fremde Org.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Fahrzeug, AppError> {
    sqlx::query_as::<_, Fahrzeug>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM fahrzeug WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Alle Fahrzeuge der Org, sortiert nach Funkrufname.
/// `nur_im_dienst` filtert auf `dienststatus = 'in_dienst'` (Dispositions-Auswahl).
pub async fn liste(
    pool: &SqlitePool,
    org_id: i64,
    nur_im_dienst: bool,
) -> Result<Vec<Fahrzeug>, AppError> {
    let sql = if nur_im_dienst {
        format!("SELECT {SPALTEN} FROM fahrzeug WHERE org_id = ? AND dienststatus = 'in_dienst' ORDER BY funkrufname")
    } else {
        format!("SELECT {SPALTEN} FROM fahrzeug WHERE org_id = ? ORDER BY funkrufname")
    };
    sqlx::query_as::<_, Fahrzeug>(sqlx::AssertSqlSafe(&*sql))
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// DISTINCT-Werte einer Spalte (org-weit, nicht-leer, sortiert) für die AutoComplete.
/// `spalte` wird in die Query interpoliert und darf daher AUSSCHLIESSLICH mit
/// festen Literalen aufgerufen werden (keine Nutzereingabe).
async fn distinct_werte(
    pool: &SqlitePool,
    org_id: i64,
    spalte: &str,
) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(format!(
        "SELECT DISTINCT {spalte} FROM fahrzeug \
         WHERE org_id = ? AND {spalte} IS NOT NULL AND {spalte} <> '' \
         ORDER BY {spalte}"
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Abgeleitete AutoComplete-Vorschläge (DISTINCT, org-weit) für die Stamm-Comboboxen:
/// Fahrzeugtyp, Trägerorganisation und Standort — jeweils die bereits verwendeten Werte.
pub async fn vorschlaege(pool: &SqlitePool, org_id: i64) -> Result<FahrzeugVorschlaege, AppError> {
    Ok(FahrzeugVorschlaege {
        fahrzeugtyp: distinct_werte(pool, org_id, "fahrzeugtyp").await?,
        traegerorganisation: distinct_werte(pool, org_id, "traegerorganisation").await?,
        standort: distinct_werte(pool, org_id, "standort").await?,
    })
}

/// Legt ein Fahrzeug an. Dublette Funkrufname (unter aktiven) → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: FahrzeugDaten<'_>,
) -> Result<Fahrzeug, AppError> {
    let (sf, su, sm) = zerlege_staerke(daten.staerke);
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fahrzeug \
            (org_id, funkrufname, fahrzeugtyp, traegerorganisation, kennzeichen, opta, \
             standort, fms_issi, sondersignal, tragenkapazitaet, staerke_fuehrer, \
             staerke_unterfuehrer, staerke_mannschaft, bemerkung) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.funkrufname)
    .bind(daten.fahrzeugtyp)
    .bind(daten.traegerorganisation)
    .bind(daten.kennzeichen)
    .bind(daten.opta)
    .bind(daten.standort)
    .bind(daten.fms_issi)
    .bind(daten.sondersignal)
    .bind(daten.tragenkapazitaet)
    .bind(sf)
    .bind(su)
    .bind(sm)
    .bind(daten.bemerkung)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return funkrufname_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound` bei fremder Org,
/// `Conflict` bei Funkrufname-Dublette.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: FahrzeugDaten<'_>,
) -> Result<Fahrzeug, AppError> {
    let (sf, su, sm) = zerlege_staerke(daten.staerke);
    let ergebnis = sqlx::query(
        "UPDATE fahrzeug SET \
            funkrufname = ?, fahrzeugtyp = ?, traegerorganisation = ?, kennzeichen = ?, \
            opta = ?, standort = ?, fms_issi = ?, sondersignal = ?, tragenkapazitaet = ?, \
            staerke_fuehrer = ?, staerke_unterfuehrer = ?, staerke_mannschaft = ?, bemerkung = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.funkrufname)
    .bind(daten.fahrzeugtyp)
    .bind(daten.traegerorganisation)
    .bind(daten.kennzeichen)
    .bind(daten.opta)
    .bind(daten.standort)
    .bind(daten.fms_issi)
    .bind(daten.sondersignal)
    .bind(daten.tragenkapazitaet)
    .bind(sf)
    .bind(su)
    .bind(sm)
    .bind(daten.bemerkung)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return funkrufname_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Setzt den Dienststatus (Soft-Delete bzw. Reaktivierung). `NotFound` bei
/// fremder Org; `Conflict`, wenn beim Reaktivieren der Funkrufname inzwischen
/// aktiv vergeben ist.
pub async fn setze_dienststatus(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    in_dienst: bool,
) -> Result<Fahrzeug, AppError> {
    let neuer = if in_dienst {
        DIENSTSTATUS_IN_DIENST
    } else {
        DIENSTSTATUS_AUSSER_DIENST
    };
    let ergebnis = sqlx::query("UPDATE fahrzeug SET dienststatus = ? WHERE id = ? AND org_id = ?")
        .bind(neuer)
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return funkrufname_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn daten(funkrufname: &str) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname,
            fahrzeugtyp: Some("LF 20"),
            traegerorganisation: None,
            kennzeichen: None,
            opta: None,
            standort: None,
            fms_issi: None,
            sondersignal: false,
            tragenkapazitaet: None,
            staerke: Some(Staerke::neu(0, 1, 8)),
            bemerkung: None,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert_eq!(f.funkrufname, "Florian 1");
        assert_eq!(f.staerke().unwrap().anzeige(), "0/1/8//9");
        assert_eq!(laden(&pool, 1, f.id).await.unwrap().id, f.id);
    }

    #[tokio::test]
    async fn laden_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(matches!(
            laden(&pool, 2, f.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn dublette_funkrufname_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(matches!(
            anlegen(&pool, 1, daten("Florian 1")).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn funkrufname_je_org_unabhaengig() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(anlegen(&pool, 2, daten("Florian 1")).await.is_ok());
    }

    #[tokio::test]
    async fn soft_delete_versteckt_aus_nur_im_dienst_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();

        setze_dienststatus(&pool, 1, f.id, false).await.unwrap();
        assert!(
            liste(&pool, 1, true).await.unwrap().is_empty(),
            "nicht in nur_im_dienst"
        );
        assert_eq!(
            liste(&pool, 1, false).await.unwrap().len(),
            1,
            "aber weiter referenzierbar"
        );
        assert_eq!(
            laden(&pool, 1, f.id).await.unwrap().dienststatus,
            "ausser_dienst"
        );
    }

    #[tokio::test]
    async fn reaktivieren_auf_vergebenen_namen_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let alt = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        setze_dienststatus(&pool, 1, alt.id, false).await.unwrap();
        // Name inzwischen neu vergeben.
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        // Reaktivieren des alten Fahrzeugs kollidiert → Conflict.
        assert!(matches!(
            setze_dienststatus(&pool, 1, alt.id, true)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn aktualisiere_ersetzt_felder() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        let mut neu = daten("Florian 1");
        neu.kennzeichen = Some("XX-AB 123");
        neu.staerke = None;
        let g = aktualisiere(&pool, 1, f.id, neu).await.unwrap();
        assert_eq!(g.kennzeichen.as_deref(), Some("XX-AB 123"));
        assert_eq!(g.staerke(), None);
    }

    #[tokio::test]
    async fn vorschlaege_distinct_je_feld() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap(); // LF 20
        let mut rtw = daten("Rettung 1");
        rtw.fahrzeugtyp = Some("RTW");
        rtw.traegerorganisation = Some("DRK");
        rtw.standort = Some("Wache Mitte");
        anlegen(&pool, 1, rtw).await.unwrap();
        let mut lf2 = daten("Florian 2");
        lf2.fahrzeugtyp = Some("LF 20"); // Dublette Typ
        lf2.traegerorganisation = Some("Feuerwehr");
        lf2.standort = Some("Wache Mitte"); // Dublette Standort
        anlegen(&pool, 1, lf2).await.unwrap();

        let v = vorschlaege(&pool, 1).await.unwrap();
        assert_eq!(v.fahrzeugtyp, vec!["LF 20".to_string(), "RTW".to_string()]);
        assert_eq!(
            v.traegerorganisation,
            vec!["DRK".to_string(), "Feuerwehr".to_string()]
        );
        assert_eq!(
            v.standort,
            vec!["Wache Mitte".to_string()],
            "DISTINCT je Feld"
        );
    }
}
