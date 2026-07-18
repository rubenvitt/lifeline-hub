use super::EinsatzabschnittAnzeige;
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

/// Editierbare Felder eines Abschnitts (bereits getrimmt/validiert durch den Handler,
/// hier zusätzlich auf Einsatz-Zugehörigkeit von parent/leiter geprüft).
/// Hinweis: `sprechgruppe_tmo`/`_dmo` sind eingefroren (Freitext-Migration LFH-109);
/// Sprechgruppen werden über die Join-Tabelle via `setze_abschnitt_sprechgruppen` gesetzt.
#[derive(Debug)]
pub struct AbschnittDaten<'a> {
    pub name: &'a str,
    pub ueber_abschnitt_id: Option<i64>,
    pub leiter_id: Option<i64>,
    pub bemerkung: Option<&'a str>,
    pub kommunikationsmittel: Option<&'a str>,
    pub erreichbarkeit: Option<&'a str>,
    pub sortier: i64,
}

const SELECT_AUFGELOEST: &str = "\
    SELECT a.id, a.einsatz_id, a.ueber_abschnitt_id, a.name, a.leiter_id, \
           p.snap_name AS leiter_name, a.bemerkung, \
           a.flaeche_geojson, a.tz_fachaufgabe, a.tz_organisation, \
           a.sprechgruppe_tmo, a.sprechgruppe_dmo, a.kommunikationsmittel, a.erreichbarkeit, \
           a.sortier \
    FROM einsatzabschnitt a \
    LEFT JOIN einsatz_personal p ON p.id = a.leiter_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    ueber_abschnitt_id: Option<i64>,
    name: String,
    leiter_id: Option<i64>,
    leiter_name: Option<String>,
    bemerkung: Option<String>,
    flaeche_geojson: Option<String>,
    tz_fachaufgabe: Option<String>,
    tz_organisation: Option<String>,
    sprechgruppe_tmo: Option<String>,
    sprechgruppe_dmo: Option<String>,
    kommunikationsmittel: Option<String>,
    erreichbarkeit: Option<String>,
    sortier: i64,
}

fn zu_anzeige(row: Row) -> EinsatzabschnittAnzeige {
    EinsatzabschnittAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        ueber_abschnitt_id: row.ueber_abschnitt_id,
        name: row.name,
        leiter_id: row.leiter_id,
        leiter_name: row.leiter_name,
        bemerkung: row.bemerkung,
        flaeche_geojson: row.flaeche_geojson,
        tz_fachaufgabe: row.tz_fachaufgabe,
        tz_organisation: row.tz_organisation,
        sprechgruppe_tmo: row.sprechgruppe_tmo,
        sprechgruppe_dmo: row.sprechgruppe_dmo,
        kommunikationsmittel: row.kommunikationsmittel,
        erreichbarkeit: row.erreichbarkeit,
        sortier: row.sortier,
        sprechgruppen: Vec::new(), // befüllt durch laden()/liste()
    }
}

/// Alle Abschnitte eines Einsatzes (flach, aufgelöst), sortiert nach `sortier`, dann `id`.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<EinsatzabschnittAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE a.einsatz_id = ? ORDER BY a.sortier, a.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut ergebnis = Vec::with_capacity(rows.len());
    for row in rows {
        let id = row.id;
        let mut anzeige = zu_anzeige(row);
        let sgs = crate::sprechgruppe::repo::lade_abschnitt_sprechgruppen(pool, id).await?;
        anzeige.sprechgruppen = sgs.into_iter().map(|s| s.anzeige()).collect();
        ergebnis.push(anzeige);
    }
    Ok(ergebnis)
}

/// Lädt einen Abschnitt (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<EinsatzabschnittAnzeige, AppError> {
    let mut anzeige = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE a.id = ? AND a.einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .map(zu_anzeige)
    .ok_or(AppError::NotFound)?;
    let sgs = crate::sprechgruppe::repo::lade_abschnitt_sprechgruppen(pool, id).await?;
    anzeige.sprechgruppen = sgs.into_iter().map(|s| s.anzeige()).collect();
    Ok(anzeige)
}

/// Prüft, ob ein Abschnitt zum Einsatz gehört (für Parent-Validierung). `NotFound` sonst.
async fn pruefe_parent(pool: &SqlitePool, einsatz_id: i64, parent_id: i64) -> Result<(), AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
            .bind(parent_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    treffer.map(|_| ()).ok_or(AppError::NotFound)
}

/// Prüft, ob `leiter_id` eine disponierte Person *desselben* Einsatzes ist.
async fn pruefe_leiter(pool: &SqlitePool, einsatz_id: i64, leiter_id: i64) -> Result<(), AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einsatz_personal WHERE id = ? AND einsatz_id = ?")
            .bind(leiter_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    treffer.map(|_| ()).ok_or_else(|| {
        AppError::Validation(
            "Abschnittsleiter muss eine disponierte Person des Einsatzes sein".into(),
        )
    })
}

/// Ob `kandidat` ein Nachfahre von `start` ist (oder `kandidat == start`): verhindert
/// Zyklen beim Setzen von `ueber_abschnitt_id = kandidat` für den Knoten `start`.
/// Läuft von `kandidat` nach oben; trifft er auf `start`, läge ein Zyklus vor.
async fn waere_zyklus(
    pool: &SqlitePool,
    start_id: i64,
    kandidat_parent: i64,
) -> Result<bool, AppError> {
    let mut aktuell = Some(kandidat_parent);
    // Begrenzung gegen korrupte Altdaten: Anzahl Knoten ist endlich.
    let mut schritte = 0;
    while let Some(id) = aktuell {
        if id == start_id {
            return Ok(true);
        }
        schritte += 1;
        if schritte > 10_000 {
            return Ok(true); // defensiv: bei Verdacht auf Zyklus abbrechen
        }
        aktuell = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT ueber_abschnitt_id FROM einsatzabschnitt WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .flatten();
    }
    Ok(false)
}

/// Validiert parent (selber Einsatz, zyklenfrei) und leiter (disponierte Person).
/// `self_id = None` beim Anlegen (kein Knoten zum Vergleichen).
async fn validiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    self_id: Option<i64>,
    daten: &AbschnittDaten<'_>,
) -> Result<(), AppError> {
    if let Some(parent) = daten.ueber_abschnitt_id {
        pruefe_parent(pool, einsatz_id, parent).await?;
        if let Some(sid) = self_id {
            if waere_zyklus(pool, sid, parent).await? {
                return Err(AppError::Validation(
                    "Abschnitt darf nicht eigener Vorfahr werden".into(),
                ));
            }
        }
    }
    if let Some(leiter) = daten.leiter_id {
        pruefe_leiter(pool, einsatz_id, leiter).await?;
    }
    Ok(())
}

/// Legt einen Abschnitt an (nach Validierung). Liefert die aufgelöste Anzeige.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: AbschnittDaten<'_>,
) -> Result<EinsatzabschnittAnzeige, AppError> {
    validiere(pool, einsatz_id, None, &daten).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatzabschnitt \
            (einsatz_id, ueber_abschnitt_id, name, leiter_id, bemerkung, \
             kommunikationsmittel, erreichbarkeit, sortier) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.ueber_abschnitt_id)
    .bind(daten.name)
    .bind(daten.leiter_id)
    .bind(daten.bemerkung)
    .bind(daten.kommunikationsmittel)
    .bind(daten.erreichbarkeit)
    .bind(daten.sortier)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

/// Vollersatz der editierbaren Felder (Parent-Wechsel zyklenfrei). `NotFound`,
/// falls der Abschnitt nicht zum Einsatz gehört.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    daten: AbschnittDaten<'_>,
) -> Result<EinsatzabschnittAnzeige, AppError> {
    // Existenz im Einsatz sichern (auch für die self_id-Zyklenprüfung).
    laden(pool, einsatz_id, id).await?;
    validiere(pool, einsatz_id, Some(id), &daten).await?;
    let resultat = sqlx::query(
        "UPDATE einsatzabschnitt SET ueber_abschnitt_id = ?, name = ?, leiter_id = ?, \
                bemerkung = ?, kommunikationsmittel = ?, erreichbarkeit = ?, sortier = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.ueber_abschnitt_id)
    .bind(daten.name)
    .bind(daten.leiter_id)
    .bind(daten.bemerkung)
    .bind(daten.kommunikationsmittel)
    .bind(daten.erreichbarkeit)
    .bind(daten.sortier)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Reine Fläche-/Symbol-Felder eines Abschnitts. `Some(None)` = auf NULL, `None` = unverändert.
#[derive(Debug, Default)]
pub struct FlaechePatch<'a> {
    pub flaeche_geojson: Option<Option<&'a str>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
}

/// Setzt/ändert/löscht Fläche (GeoJSON) + taktische Zeichen-Felder. KEIN ETB-Schreibpfad (Lage-Pflege).
pub async fn aktualisiere_flaeche(
    pool: &SqlitePool,
    einsatz_id: i64,
    aid: i64,
    daten: FlaechePatch<'_>,
) -> Result<EinsatzabschnittAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatzabschnitt SET \
            flaeche_geojson = CASE WHEN ? THEN ? ELSE flaeche_geojson END, \
            tz_fachaufgabe  = CASE WHEN ? THEN ? ELSE tz_fachaufgabe END, \
            tz_organisation = CASE WHEN ? THEN ? ELSE tz_organisation END \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.flaeche_geojson.is_some())
    .bind(daten.flaeche_geojson.flatten())
    .bind(daten.tz_fachaufgabe.is_some())
    .bind(daten.tz_fachaufgabe.flatten())
    .bind(daten.tz_organisation.is_some())
    .bind(daten.tz_organisation.flatten())
    .bind(aid)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, aid).await
}

/// Löst einen Abschnitt auf, auf einer bereits offenen Connection/Transaktion (für den
/// atomaren Handler-Pfad F06/LFH-244 Tier-A: Auflösen + System-ETB in EINER `write_retry!`-Tx):
/// Unter-Abschnitte auf den Parent des gelöschten hochziehen, zugeordnete Einheiten
/// `abschnitt_id = NULL`, uhs/Bereitstellungsraum freigeben, dann löschen. `NotFound`, falls
/// nicht zum Einsatz. Öffnet KEINE eigene Tx — die Atomarität der Statement-Folge liefert der
/// Aufrufer (write_retry! bzw. der Pool-Wrapper `loese_auf`).
pub async fn loese_auf_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<(), AppError> {
    // Parent des aufzulösenden Knotens ermitteln (und Einsatz-Zugehörigkeit sichern).
    let parent: Option<i64> = sqlx::query_scalar(
        "SELECT ueber_abschnitt_id FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;

    sqlx::query("UPDATE einsatzabschnitt SET ueber_abschnitt_id = ? WHERE ueber_abschnitt_id = ? AND einsatz_id = ?")
        .bind(parent).bind(id).bind(einsatz_id).execute(&mut *conn).await?;
    sqlx::query(
        "UPDATE einsatz_einheit SET abschnitt_id = NULL WHERE abschnitt_id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    // uhs + Bereitstellungsraum referenzieren den Abschnitt ohne ON-DELETE-Aktion
    // (LFH-237/F08): vor dem DELETE freigeben, sonst blockiert der FK das Auflösen.
    sqlx::query("UPDATE uhs SET abschnitt_id = NULL WHERE abschnitt_id = ? AND einsatz_id = ?")
        .bind(id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE bereitstellungsraum SET abschnitt_id = NULL WHERE abschnitt_id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
        .bind(id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Löst einen Abschnitt auf (Transaktion): Unter-Abschnitte auf den Parent des
/// gelöschten hochziehen, zugeordnete Einheiten `abschnitt_id = NULL`, dann löschen.
/// `NotFound`, falls nicht zum Einsatz. Pool-Wrapper: delegiert an [`loese_auf_tx`] in
/// einer eigenen Transaktion (die Statement-Folge muss atomar bleiben — daher `begin`/
/// `commit`, nicht bloß eine Pool-Connection).
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    loese_auf_tx(&mut tx, einsatz_id, id).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org(1) + Einsatz; liefert einsatz_id.
    async fn setup(pool: &SqlitePool) -> i64 {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn daten<'a>(name: &'a str, parent: Option<i64>, leiter: Option<i64>) -> AbschnittDaten<'a> {
        AbschnittDaten {
            name,
            ueber_abschnitt_id: parent,
            leiter_id: leiter,
            bemerkung: None,
            sortier: 0,
            kommunikationsmittel: None,
            erreichbarkeit: None,
        }
    }

    /// Org + Einsatz + ein Abschnitt; liefert (einsatz_id, abschnitt_id).
    async fn seed_abschnitt(pool: &SqlitePool) -> (i64, i64) {
        let einsatz = setup(pool).await;
        let a = anlegen(pool, einsatz, daten("Nord", None, None))
            .await
            .unwrap();
        (einsatz, a.id)
    }

    #[tokio::test]
    async fn abschnitt_flaeche_setzen_und_loeschen() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, aid) = seed_abschnitt(&pool).await;
        let gj =
            r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
        let a = aktualisiere_flaeche(
            &pool,
            einsatz_id,
            aid,
            FlaechePatch {
                flaeche_geojson: Some(Some(gj)),
                tz_fachaufgabe: Some(Some("fuehrung")),
                tz_organisation: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(a.flaeche_geojson.as_deref(), Some(gj));
        let b = aktualisiere_flaeche(
            &pool,
            einsatz_id,
            aid,
            FlaechePatch {
                flaeche_geojson: Some(None),
                tz_fachaufgabe: None,
                tz_organisation: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(b.flaeche_geojson, None);
        assert_eq!(b.tz_fachaufgabe.as_deref(), Some("fuehrung")); // unverändert
    }

    #[tokio::test]
    async fn funk_felder_anlegen_und_aktualisieren() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;

        let a = anlegen(
            &pool,
            einsatz,
            AbschnittDaten {
                name: "Nord",
                ueber_abschnitt_id: None,
                leiter_id: None,
                bemerkung: None,
                sortier: 0,
                kommunikationsmittel: Some("digitalfunk"),
                erreichbarkeit: Some("0151 23456"),
            },
        )
        .await
        .unwrap();
        assert_eq!(a.kommunikationsmittel.as_deref(), Some("digitalfunk"));
        assert_eq!(a.erreichbarkeit.as_deref(), Some("0151 23456"));

        // Voll-Ersatz: kommunikationsmittel geändert, erreichbarkeit geleert (→ None).
        let b = aktualisiere(
            &pool,
            einsatz,
            a.id,
            AbschnittDaten {
                name: "Nord",
                ueber_abschnitt_id: None,
                leiter_id: None,
                bemerkung: None,
                sortier: 0,
                kommunikationsmittel: Some("mobil"),
                erreichbarkeit: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(b.kommunikationsmittel.as_deref(), Some("mobil"));
        assert_eq!(b.erreichbarkeit, None);
    }

    #[tokio::test]
    async fn anlegen_und_liste_mit_baum_und_leiter() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        // Disponierte Person als Leiter.
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Abschnittsleiter Nord') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();

        let oben = anlegen(&pool, einsatz, daten("Nord", None, Some(ep)))
            .await
            .unwrap();
        anlegen(&pool, einsatz, daten("Nord-1", Some(oben.id), None))
            .await
            .unwrap();

        let liste = liste(&pool, einsatz).await.unwrap();
        assert_eq!(liste.len(), 2);
        let nord = liste.iter().find(|a| a.name == "Nord").unwrap();
        assert_eq!(nord.leiter_name.as_deref(), Some("Abschnittsleiter Nord"));
        let unter = liste.iter().find(|a| a.name == "Nord-1").unwrap();
        assert_eq!(unter.ueber_abschnitt_id, Some(oben.id));
    }

    #[tokio::test]
    async fn parent_in_fremdem_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let fremder_abschnitt = anlegen(&pool, fremd, daten("Fremd-Nord", None, None))
            .await
            .unwrap();
        assert!(matches!(
            anlegen(&pool, einsatz, daten("X", Some(fremder_abschnitt.id), None))
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn leiter_aus_fremdem_einsatz_ist_validation() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let fremder_ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Fremd') RETURNING id",
        )
        .bind(fremd)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(matches!(
            anlegen(&pool, einsatz, daten("Nord", None, Some(fremder_ep)))
                .await
                .unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn zyklus_direkt_und_transitiv_ist_validation() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let a = anlegen(&pool, einsatz, daten("A", None, None))
            .await
            .unwrap();
        let b = anlegen(&pool, einsatz, daten("B", Some(a.id), None))
            .await
            .unwrap();
        let c = anlegen(&pool, einsatz, daten("C", Some(b.id), None))
            .await
            .unwrap();

        // A unter sich selbst.
        assert!(matches!(
            aktualisiere(&pool, einsatz, a.id, daten("A", Some(a.id), None))
                .await
                .unwrap_err(),
            AppError::Validation(_)
        ));
        // A unter C (C ist Nachfahre von A) → transitiver Zyklus.
        assert!(matches!(
            aktualisiere(&pool, einsatz, a.id, daten("A", Some(c.id), None))
                .await
                .unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn aufloesen_zieht_unterabschnitte_hoch_und_loest_einheit_zuordnung() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let oben = anlegen(&pool, einsatz, daten("Nord", None, None))
            .await
            .unwrap();
        let mitte = anlegen(&pool, einsatz, daten("Nord-Mitte", Some(oben.id), None))
            .await
            .unwrap();
        let unten = anlegen(&pool, einsatz, daten("Nord-Mitte-1", Some(mitte.id), None))
            .await
            .unwrap();

        // Eine Einheit ist dem mittleren Abschnitt zugeordnet.
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, abschnitt_id, name) VALUES (?, ?, 'Zug') RETURNING id",
        ).bind(einsatz).bind(mitte.id).fetch_one(&pool).await.unwrap();

        loese_auf(&pool, einsatz, mitte.id).await.unwrap();

        // 'unten' hängt jetzt direkt unter 'oben' (Parent des aufgelösten).
        let liste = liste(&pool, einsatz).await.unwrap();
        let unten_neu = liste.iter().find(|a| a.id == unten.id).unwrap();
        assert_eq!(unten_neu.ueber_abschnitt_id, Some(oben.id));
        // Der aufgelöste Abschnitt ist weg.
        assert!(liste.iter().all(|a| a.id != mitte.id));
        // Die Einheit ist nicht mehr zugeordnet.
        let abschnitt_id: Option<i64> =
            sqlx::query_scalar("SELECT abschnitt_id FROM einsatz_einheit WHERE id = ?")
                .bind(einheit)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(abschnitt_id, None);
    }

    #[tokio::test]
    async fn aktualisiere_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let a = anlegen(&pool, einsatz, daten("A", None, None))
            .await
            .unwrap();
        assert!(matches!(
            aktualisiere(&pool, 999, a.id, daten("A", None, None))
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            loese_auf(&pool, 999, a.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn abschnitt_anzeige_enthaelt_zugeordnete_sprechgruppen() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let a = anlegen(&pool, einsatz, daten("Nord", None, None))
            .await
            .unwrap();
        let kat = crate::sprechgruppe::repo::anlegen_katalog(
            &pool,
            1,
            crate::sprechgruppe::repo::KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
        crate::sprechgruppe::repo::setze_abschnitt_sprechgruppen(
            &pool,
            1,
            einsatz,
            a.id,
            &[kat.id],
        )
        .await
        .unwrap();
        let neu = laden(&pool, einsatz, a.id).await.unwrap();
        assert_eq!(neu.sprechgruppen.len(), 1);
        assert_eq!(neu.sprechgruppen[0].bezeichnung, "412_F_DRK");
    }

    #[tokio::test]
    async fn datenmigration_freitext_zu_einsatz_lokal_dedupliziert_und_teilt() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1,'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        // Zwei Abschnitte mit GLEICHEM Freitext-TMO-Wert.
        for name in ["Nord", "Süd"] {
            sqlx::query("INSERT INTO einsatzabschnitt (einsatz_id, name, sprechgruppe_tmo) VALUES (?, ?, '412_F_DRK')")
                .bind(e).bind(name).execute(&pool).await.unwrap();
        }
        // TMO-Daten-Migration aus 0073 erneut ausführen (idempotent dank INSERT OR IGNORE):
        sqlx::query(
            "INSERT OR IGNORE INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart) \
             SELECT DISTINCT e.org_id, ea.einsatz_id, trim(ea.sprechgruppe_tmo), 'TMO' \
             FROM einsatzabschnitt ea JOIN einsatz e ON e.id = ea.einsatz_id \
             WHERE ea.sprechgruppe_tmo IS NOT NULL AND trim(ea.sprechgruppe_tmo) <> ''",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT OR IGNORE INTO einsatzabschnitt_sprechgruppe (abschnitt_id, sprechgruppe_id) \
             SELECT ea.id, sg.id FROM einsatzabschnitt ea \
             JOIN sprechgruppe sg ON sg.einsatz_id = ea.einsatz_id AND sg.betriebsart = 'TMO' \
                                 AND sg.bezeichnung = trim(ea.sprechgruppe_tmo) \
             WHERE ea.sprechgruppe_tmo IS NOT NULL AND trim(ea.sprechgruppe_tmo) <> ''",
        )
        .execute(&pool)
        .await
        .unwrap();

        let sg: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sprechgruppe WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
        let joins: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatzabschnitt_sprechgruppe")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(sg, 1, "ein geteilter einsatz-lokaler Eintrag (Dedup)");
        assert_eq!(joins, 2, "beide Abschnitte verknüpft (Sharing)");
    }

    /// LFH-237/F08: Einen Abschnitt auflösen, der von uhs, bereitstellungsraum UND einem
    /// Auftrag-Empfänger referenziert wird. uhs/br werden per Pre-Clean in der Lösch-Tx
    /// freigegeben; der Empfänger-Bezug per ON DELETE SET NULL (Migration 0088).
    #[tokio::test]
    async fn loese_auf_gibt_uhs_br_und_empfaenger_frei() {
        let pool = crate::db::test_pool().await;
        let (einsatz, aid) = seed_abschnitt(&pool).await;
        let bn: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO uhs (einsatz_id, abschnitt_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, ?, 'behandlungsplatz', 'BHP', ?, ?)",
        )
        .bind(einsatz)
        .bind(aid)
        .bind(bn)
        .bind(bn)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bereitstellungsraum (einsatz_id, abschnitt_id, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, ?, 'BR', ?, ?)",
        )
        .bind(einsatz)
        .bind(aid)
        .bind(bn)
        .bind(bn)
        .execute(&pool)
        .await
        .unwrap();
        let auftrag: i64 = sqlx::query_scalar(
            "INSERT INTO auftrag (einsatz_id, auftrag_text, erteilt_at, erstellt_von_id) \
             VALUES (?, 'Sichern', '2026-07-17 10:00:00', ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(bn)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, abschnitt_id, snap_anzeige) \
             VALUES (?, 'abschnitt', ?, 'Nord')",
        )
        .bind(auftrag)
        .bind(aid)
        .execute(&pool)
        .await
        .unwrap();

        loese_auf(&pool, einsatz, aid)
            .await
            .expect("Abschnitt auflösen darf nicht am FK scheitern");

        let uhs_ref: Option<i64> =
            sqlx::query_scalar("SELECT abschnitt_id FROM uhs WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            uhs_ref, None,
            "uhs.abschnitt_id muss freigegeben (NULL) sein"
        );
        let br_ref: Option<i64> =
            sqlx::query_scalar("SELECT abschnitt_id FROM bereitstellungsraum WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            br_ref, None,
            "bereitstellungsraum.abschnitt_id muss freigegeben (NULL) sein"
        );
        let emp_ref: Option<i64> =
            sqlx::query_scalar("SELECT abschnitt_id FROM auftrag_empfaenger WHERE auftrag_id = ?")
                .bind(auftrag)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            emp_ref, None,
            "Empfänger.abschnitt_id muss NULL sein (SET NULL)"
        );
    }
}
