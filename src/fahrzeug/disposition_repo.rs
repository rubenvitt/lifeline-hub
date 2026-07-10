use super::{
    status_repo, EinsatzFahrzeugAnzeige, StatusKategorie, DIENSTSTATUS_IN_DIENST,
    KATEGORIE_GEBUNDEN,
};
use crate::error::AppError;
use crate::staerke::Staerke;
use sqlx::SqlitePool;

/// SELECT mit aufgelöster Live-Identität (LEFT JOIN fahrzeug) und Status (LEFT JOIN
/// fahrzeug_status). Die Wahl Live vs. Snapshot trifft `zu_anzeige` mit `einsatz_aktiv`.
const SELECT_AUFGELOEST: &str = "\
    SELECT ef.id, ef.einsatz_id, ef.fahrzeug_id, ef.einheit_id, ef.status_id, \
           ef.snap_funkrufname, ef.snap_kennzeichen, ef.snap_fahrzeugtyp, ef.snap_opta, \
           ef.snap_traegerorganisation, ef.bemerkung, \
           ef.lat, ef.lon, ef.tz_fachaufgabe, ef.tz_organisation, \
           ef.aktueller_br_id, \
           ef.disponiert_at, ef.disponiert_von, \
           f.funkrufname AS live_funkrufname, f.kennzeichen AS live_kennzeichen, \
           f.fahrzeugtyp AS live_fahrzeugtyp, f.opta AS live_opta, \
           f.traegerorganisation AS live_traegerorganisation, f.dienststatus AS live_dienststatus, \
           f.staerke_fuehrer AS soll_fuehrer, f.staerke_unterfuehrer AS soll_unterfuehrer, \
           f.staerke_mannschaft AS soll_mannschaft, \
           s.label AS status_label, s.kategorie AS status_kategorie, s.farbe AS status_farbe \
    FROM einsatz_fahrzeug ef \
    LEFT JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
    LEFT JOIN fahrzeug_status s ON s.id = ef.status_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    fahrzeug_id: Option<i64>,
    einheit_id: Option<i64>,
    status_id: Option<i64>,
    snap_funkrufname: String,
    snap_kennzeichen: Option<String>,
    snap_fahrzeugtyp: Option<String>,
    snap_opta: Option<String>,
    snap_traegerorganisation: Option<String>,
    bemerkung: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
    tz_fachaufgabe: Option<String>,
    tz_organisation: Option<String>,
    aktueller_br_id: Option<i64>,
    disponiert_at: String,
    disponiert_von: Option<i64>,
    live_funkrufname: Option<String>,
    live_kennzeichen: Option<String>,
    live_fahrzeugtyp: Option<String>,
    live_opta: Option<String>,
    live_traegerorganisation: Option<String>,
    live_dienststatus: Option<String>,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    status_label: Option<String>,
    status_kategorie: Option<StatusKategorie>,
    status_farbe: Option<String>,
}

/// Auflösungsregel: Live-Felder aus dem Stamm nur, wenn ein Stamm-Bezug besteht,
/// der Einsatz aktiv ist UND das Fahrzeug noch in Dienst ist. Sonst Snapshot.
fn zu_anzeige(row: Row, einsatz_aktiv: bool) -> EinsatzFahrzeugAnzeige {
    let live = row.fahrzeug_id.is_some()
        && einsatz_aktiv
        && row.live_dienststatus.as_deref() == Some(DIENSTSTATUS_IN_DIENST);

    let (funkrufname, kennzeichen, fahrzeugtyp, opta, traeger) = if live {
        (
            row.live_funkrufname.clone().unwrap_or_else(|| row.snap_funkrufname.clone()),
            row.live_kennzeichen,
            row.live_fahrzeugtyp,
            row.live_opta,
            row.live_traegerorganisation,
        )
    } else {
        (
            row.snap_funkrufname,
            row.snap_kennzeichen,
            row.snap_fahrzeugtyp,
            row.snap_opta,
            row.snap_traegerorganisation,
        )
    };

    EinsatzFahrzeugAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        fahrzeug_id: row.fahrzeug_id,
        einheit_id: row.einheit_id,
        ist_adhoc: row.fahrzeug_id.is_none(),
        funkrufname,
        kennzeichen,
        fahrzeugtyp,
        opta,
        traegerorganisation: traeger,
        status_id: row.status_id,
        status_label: row.status_label,
        status_kategorie: row.status_kategorie,
        status_farbe: row.status_farbe,
        bemerkung: row.bemerkung,
        lat: row.lat,
        lon: row.lon,
        tz_fachaufgabe: row.tz_fachaufgabe,
        tz_organisation: row.tz_organisation,
        aktueller_br_id: row.aktueller_br_id,
        // Soll-Besatzung aus dem Stamm-Live-Join: nur vollständig gepflegte Soll-Stärke
        // ergibt `Some`; Ad-hoc-Fahrzeuge (kein Stamm-Join) liefern lauter NULL → `None`.
        soll_besatzung: match (row.soll_fuehrer, row.soll_unterfuehrer, row.soll_mannschaft) {
            (Some(f), Some(u), Some(m)) => Some(Staerke::neu(f as u16, u as u16, m as u16)),
            _ => None,
        },
        disponiert_at: row.disponiert_at,
        disponiert_von: row.disponiert_von,
    }
}

/// Daten für ein Ad-hoc-externes Fahrzeug (kein Stamm-Bezug); bereits getrimmt.
#[derive(Debug)]
pub struct AdhocDaten<'a> {
    pub funkrufname: &'a str,
    pub fahrzeugtyp: Option<&'a str>,
    pub kennzeichen: Option<&'a str>,
    pub opta: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
}

/// Disponierte Fahrzeuge eines Einsatzes (aufgelöst), sortiert nach Dispo-Zeit.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzFahrzeugAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ef.einsatz_id = ? ORDER BY ef.disponiert_at, ef.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| zu_anzeige(r, einsatz_aktiv)).collect())
}

/// Lädt eine Dispositionszeile (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden_anzeige(
    pool: &SqlitePool,
    einsatz_id: i64,
    ef_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzFahrzeugAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ef.id = ? AND ef.einsatz_id = ?"
    )))
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Disponiert ein Stamm-Fahrzeug. Prüft Org-Zugehörigkeit + Dienststatus, friert
/// den Identitäts-Schnappschuss ein und setzt den ersten `gebunden`-Status.
/// `NotFound` bei fremdem/unbekanntem Fahrzeug, `Validation` bei außer Dienst,
/// `Conflict` bei Doppel-Disposition. Liefert die neue `ef_id`.
pub async fn disponiere_stamm(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    fahrzeug_id: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let snap = sqlx::query_as::<_, (String, Option<String>, Option<String>, Option<String>, Option<String>, String)>(
        "SELECT funkrufname, kennzeichen, fahrzeugtyp, opta, traegerorganisation, dienststatus \
         FROM fahrzeug WHERE id = ? AND org_id = ?",
    )
    .bind(fahrzeug_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let (funkrufname, kennzeichen, fahrzeugtyp, opta, traeger, dienststatus) = snap;
    if dienststatus != DIENSTSTATUS_IN_DIENST {
        return Err(AppError::Validation(
            "Fahrzeug ist außer Dienst und kann nicht disponiert werden".into(),
        ));
    }

    let status_id = status_repo::erster_der_kategorie(pool, org_id, KATEGORIE_GEBUNDEN).await?;

    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_fahrzeug \
            (einsatz_id, fahrzeug_id, status_id, snap_funkrufname, snap_kennzeichen, \
             snap_fahrzeugtyp, snap_opta, snap_traegerorganisation, disponiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(fahrzeug_id)
    .bind(status_id)
    .bind(&funkrufname)
    .bind(&kennzeichen)
    .bind(&fahrzeugtyp)
    .bind(&opta)
    .bind(&traeger)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await;

    match ergebnis {
        Ok(id) => Ok(id),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Fahrzeug ist bereits in diesem Einsatz disponiert".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Disponiert ein Ad-hoc-externes Fahrzeug (`fahrzeug_id = NULL`); `snap_*` sind die
/// eigentlichen Daten. Initial-Status = erster `gebunden`. Liefert die neue `ef_id`.
pub async fn disponiere_adhoc(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    daten: AdhocDaten<'_>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let status_id = status_repo::erster_der_kategorie(pool, org_id, KATEGORIE_GEBUNDEN).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_fahrzeug \
            (einsatz_id, fahrzeug_id, status_id, snap_funkrufname, snap_kennzeichen, \
             snap_fahrzeugtyp, snap_opta, snap_traegerorganisation, disponiert_von) \
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(status_id)
    .bind(daten.funkrufname)
    .bind(daten.kennzeichen)
    .bind(daten.fahrzeugtyp)
    .bind(daten.opta)
    .bind(daten.traegerorganisation)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Aktualisiert Status und/oder Bemerkung einer Dispositionszeile (COALESCE: `None`
/// = unverändert lassen). `NotFound`, falls die Zeile nicht zum Einsatz gehört.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    ef_id: i64,
    status_id: Option<i64>,
    bemerkung: Option<&str>,
) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE einsatz_fahrzeug \
         SET status_id = COALESCE(?, status_id), bemerkung = COALESCE(?, bemerkung) \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(status_id)
    .bind(bemerkung)
    .bind(ef_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Reine Geo-/Symbol-Felder einer Disposition. `Some(None)` = auf NULL, `None` = unverändert.
#[derive(Debug, Default)]
pub struct PositionPatch<'a> {
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
}

/// Setzt/ändert/löscht Position + Symbol-Felder einer Dispositionszeile. Liefert die
/// aufgelöste Anzeige (`einsatz_aktiv` steuert Live vs. Snapshot). `NotFound`, falls
/// die Zeile nicht zum Einsatz gehört.
pub async fn aktualisiere_position(
    pool: &SqlitePool,
    einsatz_id: i64,
    ef_id: i64,
    daten: PositionPatch<'_>,
    einsatz_aktiv: bool,
) -> Result<EinsatzFahrzeugAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_fahrzeug SET \
            lat = CASE WHEN ? THEN ? ELSE lat END, \
            lon = CASE WHEN ? THEN ? ELSE lon END, \
            tz_fachaufgabe  = CASE WHEN ? THEN ? ELSE tz_fachaufgabe END, \
            tz_organisation = CASE WHEN ? THEN ? ELSE tz_organisation END \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.lat.is_some()).bind(daten.lat.flatten())
    .bind(daten.lon.is_some()).bind(daten.lon.flatten())
    .bind(daten.tz_fachaufgabe.is_some()).bind(daten.tz_fachaufgabe.flatten())
    .bind(daten.tz_organisation.is_some()).bind(daten.tz_organisation.flatten())
    .bind(ef_id).bind(einsatz_id)
    .execute(pool).await?.rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ef.id = ? AND ef.einsatz_id = ?"
    )))
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Entfernt eine Dispositionszeile aus dem Einsatz (der Stamm bleibt). `NotFound`,
/// falls nicht zum Einsatz gehörend.
///
/// Transaktional (LFH-9): vor dem DELETE wird die Fahrzeug-Besatzung freigegeben
/// (`einsatz_personal.fahrzeug_id = NULL`). Die Kräfte werden frei, nicht gelöscht;
/// ohne diesen Schritt scheitert das DELETE am FK-Constraint. Schlägt das DELETE auf
/// `NotFound` durch (fremdes/unbekanntes Fahrzeug), rollt die TX die Freigabe zurück.
pub async fn entferne(pool: &SqlitePool, einsatz_id: i64, ef_id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE einsatz_personal SET fahrzeug_id = NULL WHERE fahrzeug_id = ?")
        .bind(ef_id)
        .execute(&mut *tx)
        .await?;
    let resultat = sqlx::query("DELETE FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?")
        .bind(ef_id)
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fahrzeug::repo::{self as fz_repo, FahrzeugDaten};
    use crate::fahrzeug::status_repo::{self, StatusDaten};
    use crate::fahrzeug::{StatusKategorie, KATEGORIE_GEBUNDEN};

    /// Org(1) + Benutzer + Einsatz + ein 'gebunden'-Status; liefert (benutzer, einsatz).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        status_repo::anlegen(pool, 1, StatusDaten {
            label: "disponiert", kategorie: KATEGORIE_GEBUNDEN, farbe: None, fms_anker: Some(3), sortier: 20,
        }).await.unwrap();
        (benutzer, einsatz)
    }

    fn fz_daten(funkrufname: &str) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname, fahrzeugtyp: Some("LF 20"), traegerorganisation: None,
            kennzeichen: Some("XX-AB 1"), opta: None, standort: None, fms_issi: None,
            sondersignal: false, tragenkapazitaet: None, staerke: None, bemerkung: None,
        }
    }

    /// Org + Einsatz + ein disponiertes Stamm-Fahrzeug; liefert (einsatz_id, ef_id).
    async fn seed_fahrzeug(pool: &SqlitePool) -> (i64, i64) {
        let (benutzer, einsatz) = setup(pool).await;
        let fz = fz_repo::anlegen(pool, 1, fz_daten("Florian 1")).await.unwrap();
        let ef = disponiere_stamm(pool, einsatz, 1, fz.id, benutzer).await.unwrap();
        (einsatz, ef)
    }

    #[tokio::test]
    async fn fahrzeug_position_partial_merge() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, ef_id) = seed_fahrzeug(&pool).await;
        aktualisiere_position(&pool, einsatz_id, ef_id, PositionPatch {
            lat: Some(Some(50.0)), lon: Some(Some(8.0)),
            tz_fachaufgabe: Some(Some("transport")), tz_organisation: Some(Some("feuerwehr")),
        }, true).await.unwrap();
        let a = aktualisiere_position(&pool, einsatz_id, ef_id, PositionPatch {
            lat: None, lon: None, tz_fachaufgabe: Some(Some("logistik")), tz_organisation: None,
        }, true).await.unwrap();
        assert_eq!(a.lat, Some(50.0));
        assert_eq!(a.tz_fachaufgabe.as_deref(), Some("logistik"));
        assert_eq!(a.tz_organisation.as_deref(), Some("feuerwehr"));
    }

    #[tokio::test]
    async fn disponiere_stamm_fuellt_snapshot_und_gebunden_status() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();

        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(a.funkrufname, "Florian 1");
        assert_eq!(a.kennzeichen.as_deref(), Some("XX-AB 1"));
        assert_eq!(a.status_kategorie, Some(StatusKategorie::Gebunden));
        assert!(!a.ist_adhoc);
    }

    #[tokio::test]
    async fn disponiere_stamm_doppelt_ist_conflict() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();
        disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')")
            .execute(&pool).await.unwrap();
        let fremd_fz: i64 = sqlx::query_scalar(
            "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (2, 'Fremd 1') RETURNING id",
        ).fetch_one(&pool).await.unwrap();
        // Org-Isolation: Einsatz gehört Org 1, Fahrzeug Org 2.
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fremd_fz, benutzer).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_ausser_dienst_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();
        fz_repo::setze_dienststatus(&pool, 1, fz.id, false).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn adhoc_mehrfach_erlaubt_und_ist_adhoc() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for name in ["FW Extern 1", "FW Extern 2"] {
            disponiere_adhoc(&pool, einsatz, 1, AdhocDaten {
                funkrufname: name, fahrzeugtyp: None, kennzeichen: None, opta: None,
                traegerorganisation: Some("Feuerwehr"),
            }, benutzer).await.unwrap();
        }
        let liste = liste(&pool, einsatz, true).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert!(liste.iter().all(|a| a.ist_adhoc && a.fahrzeug_id.is_none()));
    }

    #[tokio::test]
    async fn snapshot_stabil_live_vs_snapshot() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap();

        // Stamm nachträglich umbenennen.
        let mut neu = fz_daten("Florian 1 NEU");
        neu.kennzeichen = Some("XX-AB 1");
        fz_repo::aktualisiere(&pool, 1, fz.id, neu).await.unwrap();

        // Aktiver Einsatz → Live (zeigt neuen Namen).
        let live = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(live.funkrufname, "Florian 1 NEU");

        // „Abgeschlossener" Einsatz (einsatz_aktiv=false) → Snapshot (alter Name).
        let snap = laden_anzeige(&pool, einsatz, ef, false).await.unwrap();
        assert_eq!(snap.funkrufname, "Florian 1");

        // Stamm außer Dienst → auch bei aktivem Einsatz Snapshot.
        fz_repo::setze_dienststatus(&pool, 1, fz.id, false).await.unwrap();
        let nach_ad = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(nach_ad.funkrufname, "Florian 1", "außer Dienst → Snapshot trotz aktivem Einsatz");
    }

    #[tokio::test]
    async fn aktualisiere_status_und_bemerkung_dann_entferne() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap();
        let neuer_status = status_repo::anlegen(&pool, 1, StatusDaten {
            label: "vor_ort", kategorie: KATEGORIE_GEBUNDEN, farbe: None, fms_anker: Some(4), sortier: 40,
        }).await.unwrap();

        aktualisiere(&pool, einsatz, ef, Some(neuer_status.id), Some("am Einsatzort")).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(a.status_id, Some(neuer_status.id));
        assert_eq!(a.bemerkung.as_deref(), Some("am Einsatzort"));

        // Nur Bemerkung ändern (status_id None → bleibt).
        aktualisiere(&pool, einsatz, ef, None, Some("korrigiert")).await.unwrap();
        let b = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(b.status_id, Some(neuer_status.id), "Status unverändert");
        assert_eq!(b.bemerkung.as_deref(), Some("korrigiert"));

        entferne(&pool, einsatz, ef).await.unwrap();
        assert!(matches!(laden_anzeige(&pool, einsatz, ef, true).await.unwrap_err(), AppError::NotFound));
    }

    /// LFH-9: Soll-Besatzung = Live-Join der Stamm-`staerke_*`. Nur Stamm-Fahrzeuge mit
    /// vollständiger Soll-Stärke liefern `Some`; Ad-hoc-Fahrzeuge (kein Stamm) liefern
    /// `None` — nicht 0/0/0 vortäuschen.
    #[tokio::test]
    async fn soll_besatzung_aus_stamm_staerke_adhoc_none() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let mut daten = fz_daten("Florian 1");
        daten.staerke = Some(Staerke::neu(0, 1, 8));
        let fz = fz_repo::anlegen(&pool, 1, daten).await.unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap();
        assert_eq!(
            laden_anzeige(&pool, einsatz, ef, true).await.unwrap().soll_besatzung,
            Some(Staerke::neu(0, 1, 8)),
        );

        let adhoc = disponiere_adhoc(&pool, einsatz, 1, AdhocDaten {
            funkrufname: "Extern 1", fahrzeugtyp: None, kennzeichen: None, opta: None, traegerorganisation: None,
        }, benutzer).await.unwrap();
        assert_eq!(
            laden_anzeige(&pool, einsatz, adhoc, true).await.unwrap().soll_besatzung,
            None, "Ad-hoc-Fahrzeug hat keine Soll-Besatzung",
        );
    }

    /// LFH-9 (höchstes Risiko): Fahrzeug entfernen gibt die Besatzung transaktional frei —
    /// kein Orphan. Ohne die Freigabe vor dem DELETE scheitert dieses am FK-Constraint
    /// (FK-Enforcement ist an), die Kraft bleibt als freie Kraft erhalten.
    #[tokio::test]
    async fn entferne_gibt_besatzung_frei_statt_orphan() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name, fahrzeug_id) VALUES (?, 'Crew', ?) RETURNING id",
        ).bind(einsatz).bind(ef).fetch_one(&pool).await.unwrap();

        entferne(&pool, einsatz, ef).await.unwrap();

        // Fahrzeug weg, Person bleibt als freie Kraft (fahrzeug_id NULL).
        assert!(matches!(laden_anzeige(&pool, einsatz, ef, true).await.unwrap_err(), AppError::NotFound));
        let fahrzeug_id: Option<i64> = sqlx::query_scalar("SELECT fahrzeug_id FROM einsatz_personal WHERE id = ?")
            .bind(ep).fetch_one(&pool).await.unwrap();
        assert_eq!(fahrzeug_id, None, "Besatzung wird frei, nicht gelöscht");
    }
}
