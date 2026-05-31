use super::qualifikation_repo;
use super::{status_repo, EinsatzPersonalAnzeige, FuehrungskraftKarte};
use crate::error::AppError;
use crate::katalog::{DIENSTSTATUS_IN_DIENST, KATEGORIE_GEBUNDEN};
use sqlx::SqlitePool;

/// SELECT mit aufgelöster Live-Identität (LEFT JOIN personal), Live-Funktion (geordnete
/// Subquery über aktive Qualifikationen — identisch zu `qualifikation_repo::funktion_text`)
/// und Status (LEFT JOIN personal_status). Live vs. Snapshot wählt `zu_anzeige`.
const SELECT_AUFGELOEST: &str = "\
    SELECT ep.id, ep.einsatz_id, ep.personal_id, ep.einheit_id, ep.status_id, \
           ep.staerke_position AS ep_staerke_position, \
           ep.snap_name, ep.snap_funktion, ep.snap_traegerorganisation, \
           ep.bemerkung, ep.disponiert_at, ep.disponiert_von, \
           p.name AS live_name, p.traegerorganisation AS live_traegerorganisation, \
           p.dienststatus AS live_dienststatus, p.staerke_position AS live_staerke_position, \
           (SELECT GROUP_CONCAT(label, ', ') FROM ( \
                SELECT q.label FROM personal_qualifikation pq \
                JOIN qualifikation q ON q.id = pq.qualifikation_id \
                WHERE pq.personal_id = ep.personal_id AND q.aktiv = 1 \
                ORDER BY q.sortier, q.id \
           )) AS live_funktion, \
           s.label AS status_label, s.kategorie AS status_kategorie, s.farbe AS status_farbe \
    FROM einsatz_personal ep \
    LEFT JOIN personal p ON p.id = ep.personal_id \
    LEFT JOIN personal_status s ON s.id = ep.status_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    personal_id: Option<i64>,
    einheit_id: Option<i64>,
    status_id: Option<i64>,
    ep_staerke_position: Option<String>,
    snap_name: String,
    snap_funktion: Option<String>,
    snap_traegerorganisation: Option<String>,
    bemerkung: Option<String>,
    disponiert_at: String,
    disponiert_von: Option<i64>,
    live_name: Option<String>,
    live_traegerorganisation: Option<String>,
    live_dienststatus: Option<String>,
    live_staerke_position: Option<String>,
    live_funktion: Option<String>,
    status_label: Option<String>,
    status_kategorie: Option<String>,
    status_farbe: Option<String>,
}

/// Auflösungsregel für Identität/Funktion: Live nur, wenn Stamm-Bezug besteht, der
/// Einsatz aktiv ist UND die Person in Dienst ist. Sonst Snapshot. Die Stärke-Position
/// wird IMMER live aufgelöst (Dispo-Override vor Stamm-Default, kein Snapshot-Feld).
fn zu_anzeige(row: Row, einsatz_aktiv: bool) -> EinsatzPersonalAnzeige {
    let live = row.personal_id.is_some()
        && einsatz_aktiv
        && row.live_dienststatus.as_deref() == Some(DIENSTSTATUS_IN_DIENST);

    let (name, funktion, traeger) = if live {
        (
            row.live_name.clone().unwrap_or_else(|| row.snap_name.clone()),
            row.live_funktion,
            row.live_traegerorganisation,
        )
    } else {
        (row.snap_name, row.snap_funktion, row.snap_traegerorganisation)
    };

    EinsatzPersonalAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        personal_id: row.personal_id,
        einheit_id: row.einheit_id,
        ist_adhoc: row.personal_id.is_none(),
        name,
        funktion,
        traegerorganisation: traeger,
        staerke_position: row.ep_staerke_position.or(row.live_staerke_position),
        status_id: row.status_id,
        status_label: row.status_label,
        status_kategorie: row.status_kategorie,
        status_farbe: row.status_farbe,
        bemerkung: row.bemerkung,
        disponiert_at: row.disponiert_at,
        disponiert_von: row.disponiert_von,
    }
}

/// Daten für eine Ad-hoc-externe Person (kein Stamm-Bezug); bereits getrimmt/validiert.
#[derive(Debug)]
pub struct AdhocDaten<'a> {
    pub name: &'a str,
    pub funktion: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub staerke_position: Option<&'a str>,
}

/// Disponiertes Personal eines Einsatzes (aufgelöst), sortiert nach Dispo-Zeit.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzPersonalAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE ep.einsatz_id = ? ORDER BY ep.disponiert_at, ep.id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| zu_anzeige(r, einsatz_aktiv)).collect())
}

/// Lädt eine Dispositionszeile (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden_anzeige(
    pool: &SqlitePool,
    einsatz_id: i64,
    ep_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzPersonalAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE ep.id = ? AND ep.einsatz_id = ?"
    ))
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Disponiert eine Stamm-Person. Prüft Org-Zugehörigkeit + Dienststatus, friert den
/// Identitäts-Schnappschuss ein (`snap_funktion` aus den aktiven Qualifikationen) und
/// setzt den ersten `gebunden`-Status. `staerke_position` ist der optionale Dispo-Override.
/// `NotFound` bei fremder/unbek. Person, `Validation` bei außer Dienst, `Conflict` bei
/// Doppel-Disposition. Liefert die neue `ep_id`.
pub async fn disponiere_stamm(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    personal_id: i64,
    staerke_position: Option<&str>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let snap = sqlx::query_as::<_, (String, Option<String>, String)>(
        "SELECT name, traegerorganisation, dienststatus FROM personal WHERE id = ? AND org_id = ?",
    )
    .bind(personal_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let (name, traeger, dienststatus) = snap;
    if dienststatus != DIENSTSTATUS_IN_DIENST {
        return Err(AppError::Validation(
            "Person ist außer Dienst und kann nicht disponiert werden".into(),
        ));
    }
    let funktion = qualifikation_repo::funktion_text(pool, personal_id).await?;
    let status_id = status_repo::erster_der_kategorie(pool, org_id, KATEGORIE_GEBUNDEN).await?;

    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_personal \
            (einsatz_id, personal_id, status_id, staerke_position, snap_name, snap_funktion, \
             snap_traegerorganisation, disponiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(personal_id)
    .bind(status_id)
    .bind(staerke_position)
    .bind(&name)
    .bind(&funktion)
    .bind(&traeger)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await;

    match ergebnis {
        Ok(id) => Ok(id),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Person ist bereits in diesem Einsatz disponiert".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Disponiert eine Ad-hoc-externe Person (`personal_id = NULL`); `snap_*` sind die
/// eigentlichen Daten. Initial-Status = erster `gebunden`. Liefert die neue `ep_id`.
pub async fn disponiere_adhoc(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    daten: AdhocDaten<'_>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let status_id = status_repo::erster_der_kategorie(pool, org_id, KATEGORIE_GEBUNDEN).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_personal \
            (einsatz_id, personal_id, status_id, staerke_position, snap_name, snap_funktion, \
             snap_traegerorganisation, disponiert_von) \
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(status_id)
    .bind(daten.staerke_position)
    .bind(daten.name)
    .bind(daten.funktion)
    .bind(daten.traegerorganisation)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Aktualisiert Status, Stärke-Position und/oder Bemerkung (COALESCE: `None` = unverändert).
/// `NotFound`, falls die Zeile nicht zum Einsatz gehört.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    ep_id: i64,
    status_id: Option<i64>,
    staerke_position: Option<&str>,
    bemerkung: Option<&str>,
) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE einsatz_personal \
         SET status_id = COALESCE(?, status_id), \
             staerke_position = COALESCE(?, staerke_position), \
             bemerkung = COALESCE(?, bemerkung) \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(status_id)
    .bind(staerke_position)
    .bind(bemerkung)
    .bind(ep_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Entfernt eine Dispositionszeile aus dem Einsatz (der Stamm bleibt). `NotFound`,
/// falls nicht zum Einsatz gehörend.
pub async fn entferne(pool: &SqlitePool, einsatz_id: i64, ep_id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query("DELETE FROM einsatz_personal WHERE id = ? AND einsatz_id = ?")
        .bind(ep_id)
        .bind(einsatz_id)
        .execute(pool)
        .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Dedizierter Lesepfad: nur Personen, die Einheitsführer (`einsatz_einheit.fuehrer_id`)
/// ODER Abschnittsleiter (`einsatzabschnitt.leiter_id`) sind, mit ihrer Position. Bewusst
/// getrennt vom allgemeinen `liste`-Pfad (der KEIN lat/lon liefert).
pub async fn liste_fuehrungskraefte(
    pool: &SqlitePool, einsatz_id: i64,
) -> Result<Vec<FuehrungskraftKarte>, AppError> {
    let rows = sqlx::query_as::<_, FuehrungskraftKarte>(
        "SELECT ep.id, ep.einsatz_id, ep.snap_name AS name, \
                ep.lat, ep.lon, ep.tz_fachaufgabe, ep.tz_organisation, \
                EXISTS(SELECT 1 FROM einsatz_einheit e \
                       WHERE e.einsatz_id = ep.einsatz_id AND e.fuehrer_id = ep.id) AS ist_einheitsfuehrer, \
                EXISTS(SELECT 1 FROM einsatzabschnitt a \
                       WHERE a.einsatz_id = ep.einsatz_id AND a.leiter_id = ep.id) AS ist_abschnittsleiter \
         FROM einsatz_personal ep \
         WHERE ep.einsatz_id = ?1 \
           AND ( ep.id IN (SELECT fuehrer_id FROM einsatz_einheit WHERE einsatz_id = ?1 AND fuehrer_id IS NOT NULL) \
              OR ep.id IN (SELECT leiter_id  FROM einsatzabschnitt WHERE einsatz_id = ?1 AND leiter_id  IS NOT NULL) ) \
         ORDER BY ep.snap_name, ep.id",
    ).bind(einsatz_id).fetch_all(pool).await?;
    Ok(rows)
}

/// PATCH-Daten für die Führungskraft-Position. Drei-Zustands-Semantik je Feld:
/// `None` = unverändert, `Some(None)` = explizit auf NULL, `Some(Some(x))` = setzen.
#[derive(Debug, Default)]
pub struct PositionPatch<'a> {
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
}

/// Aktualisiert lat/lon/tz_* einer Person des Einsatzes (Drei-Zustands-PATCH; siehe
/// `PositionPatch`). `NotFound`, falls die Zeile nicht zum Einsatz gehört. Liefert die
/// frische Karten-Sicht (setzt voraus, dass die Person eine Führungskraft ist).
pub async fn aktualisiere_position(
    pool: &SqlitePool, einsatz_id: i64, ep_id: i64, daten: PositionPatch<'_>,
) -> Result<FuehrungskraftKarte, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_personal SET \
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
    .bind(ep_id).bind(einsatz_id)
    .execute(pool).await?.rows_affected();
    if betroffen == 0 { return Err(AppError::NotFound); }
    let liste = liste_fuehrungskraefte(pool, einsatz_id).await?;
    liste.into_iter().find(|f| f.id == ep_id).ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::katalog::KATEGORIE_GEBUNDEN;
    use crate::personal::repo::{self as p_repo, PersonalDaten};
    use crate::personal::status_repo::{self, StatusDaten};
    use crate::personal::qualifikation_repo;

    /// Org(1) + Benutzer + Einsatz + ein 'gebunden'-Status; liefert (benutzer, einsatz).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')").execute(pool).await.unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        status_repo::anlegen(pool, 1, StatusDaten {
            label: "alarmiert", kategorie: KATEGORIE_GEBUNDEN, farbe: None, sortier: 20,
        }).await.unwrap();
        (benutzer, einsatz)
    }

    fn p_daten(name: &str) -> PersonalDaten<'_> {
        PersonalDaten {
            name, benutzer_id: None, personalnummer: None, traegerorganisation: Some("DRK"),
            telefon: None, staerke_position: Some("fuehrer"), bemerkung: None,
        }
    }

    /// Seed: Org/Benutzer/Einsatz + 3 `einsatz_personal` (roh, nur snap_name) und eine
    /// `einsatz_einheit` mit `fuehrer_id = p1` sowie ein `einsatzabschnitt` mit
    /// `leiter_id = p2`. #3 bleibt ohne Führungsrolle. Liefert (einsatz, p1, p2, p3).
    async fn seed_personal_mit_fuehrung(pool: &SqlitePool) -> (i64, i64, i64, i64) {
        let (_benutzer, einsatz) = setup(pool).await;
        let mut ids = Vec::new();
        for name in ["Anton Abel", "Berta Busch", "Cäsar Crom"] {
            let id: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, ?) RETURNING id",
            )
            .bind(einsatz)
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap();
            ids.push(id);
        }
        let (p1, p2, p3) = (ids[0], ids[1], ids[2]);
        sqlx::query("INSERT INTO einsatz_einheit (einsatz_id, name, fuehrer_id) VALUES (?, 'Trupp', ?)")
            .bind(einsatz).bind(p1).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO einsatzabschnitt (einsatz_id, name, leiter_id) VALUES (?, 'Abschnitt Nord', ?)")
            .bind(einsatz).bind(p2).execute(pool).await.unwrap();
        (einsatz, p1, p2, p3)
    }

    #[tokio::test]
    async fn nur_fuehrungskraefte_und_position() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, p1, p2, _p3) = seed_personal_mit_fuehrung(&pool).await;

        let liste = liste_fuehrungskraefte(&pool, einsatz_id).await.unwrap();
        let ids: Vec<i64> = liste.iter().map(|f| f.id).collect();
        assert!(ids.contains(&p1) && ids.contains(&p2));
        assert_eq!(liste.len(), 2); // #3 NICHT enthalten

        aktualisiere_position(&pool, einsatz_id, p1, PositionPatch {
            lat: Some(Some(50.1)), lon: Some(Some(8.6)),
            tz_fachaufgabe: Some(Some("fuehrung")), tz_organisation: None,
        }).await.unwrap();
        let liste2 = liste_fuehrungskraefte(&pool, einsatz_id).await.unwrap();
        let f1 = liste2.iter().find(|f| f.id == p1).unwrap();
        assert_eq!(f1.lat, Some(50.1));
        assert!(f1.ist_einheitsfuehrer);
    }

    #[tokio::test]
    async fn disponiere_stamm_fuellt_snapshot_status_und_funktion() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let san = qualifikation_repo::anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let gf = qualifikation_repo::anlegen(&pool, 1, "Gruppenführer", 60).await.unwrap();
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas Müller"), &[san.id, gf.id]).await.unwrap();

        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.name, "Thomas Müller");
        assert_eq!(a.funktion.as_deref(), Some("Sanitäter, Gruppenführer"));
        assert_eq!(a.status_kategorie.as_deref(), Some("gebunden"));
        assert_eq!(a.staerke_position.as_deref(), Some("fuehrer"), "Stamm-Default greift");
        assert!(!a.ist_adhoc);
    }

    #[tokio::test]
    async fn staerke_position_override_schlaegt_stamm_default() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap(); // Stamm = fuehrer
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, Some("mannschaft"), benutzer).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.staerke_position.as_deref(), Some("mannschaft"), "Override schlägt Default");
    }

    #[tokio::test]
    async fn doppelte_stamm_disposition_ist_conflict() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap();
        disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')").execute(&pool).await.unwrap();
        let fremd: i64 = sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (2, 'Fremd') RETURNING id").fetch_one(&pool).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fremd, None, benutzer).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_ausser_dienst_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap();
        p_repo::setze_dienststatus(&pool, 1, person.id, false).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn adhoc_mehrfach_erlaubt_nur_dispo_position() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for name in ["Notarzt Extern", "Helfer Extern"] {
            disponiere_adhoc(&pool, einsatz, 1, AdhocDaten {
                name, funktion: Some("Notarzt"), traegerorganisation: Some("KV"),
                staerke_position: Some("unterfuehrer"),
            }, benutzer).await.unwrap();
        }
        let l = liste(&pool, einsatz, true).await.unwrap();
        assert_eq!(l.len(), 2);
        assert!(l.iter().all(|a| a.ist_adhoc && a.personal_id.is_none()));
        assert_eq!(l[0].staerke_position.as_deref(), Some("unterfuehrer"));
    }

    #[tokio::test]
    async fn snapshot_stabil_live_vs_snapshot() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas Müller"), &[]).await.unwrap();
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();

        // Stamm nachträglich umbenennen.
        p_repo::aktualisiere(&pool, 1, person.id, p_daten("Thomas NEU"), &[]).await.unwrap();
        // Aktiver Einsatz → Live (neuer Name).
        assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().name, "Thomas NEU");
        // Abgeschlossen → Snapshot (alter Name).
        assert_eq!(laden_anzeige(&pool, einsatz, ep, false).await.unwrap().name, "Thomas Müller");
        // Außer Dienst → auch bei aktivem Einsatz Snapshot.
        p_repo::setze_dienststatus(&pool, 1, person.id, false).await.unwrap();
        assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().name, "Thomas Müller");
    }

    #[tokio::test]
    async fn staerke_position_immer_live_ohne_override() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        // Stamm-Default = fuehrer (aus p_daten), KEIN Dispo-Override.
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap();
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();
        assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().staerke_position.as_deref(), Some("fuehrer"));

        // Stamm-Position nachträglich ändern → live reflektiert (kein Snapshot).
        let mut geaendert = p_daten("Thomas");
        geaendert.staerke_position = Some("mannschaft");
        p_repo::aktualisiere(&pool, 1, person.id, geaendert, &[]).await.unwrap();
        assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().staerke_position.as_deref(), Some("mannschaft"), "Position ist immer live, kein Snapshot");
    }

    #[tokio::test]
    async fn funktion_komposition_identisch() {
        // snap_funktion (beim Disponieren) und Live-Funktion (in der Anzeige) MÜSSEN
        // dieselbe Komposition liefern. Pinnt beide Pfade auf dieselbe Ausgabe.
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let san = qualifikation_repo::anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let gf = qualifikation_repo::anlegen(&pool, 1, "Gruppenführer", 60).await.unwrap();
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[gf.id, san.id]).await.unwrap();
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();

        let live = laden_anzeige(&pool, einsatz, ep, true).await.unwrap().funktion;
        let snap = laden_anzeige(&pool, einsatz, ep, false).await.unwrap().funktion;
        let helper = qualifikation_repo::funktion_text(&pool, person.id).await.unwrap();
        assert_eq!(live, snap, "Live == Snapshot bei unverändertem Stamm");
        assert_eq!(live, helper, "Anzeige == funktion_text-Helper");
        assert_eq!(live.as_deref(), Some("Sanitäter, Gruppenführer"));
    }

    #[tokio::test]
    async fn einheit_id_wird_in_anzeige_geliefert() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap();
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();

        // Frisch disponiert → keiner Einheit zugeordnet.
        assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().einheit_id, None);

        // Direkt einer Einheit zuordnen (Mitglied-Repo kommt später; hier roh).
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Trupp') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();
        sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
            .bind(einheit).bind(ep).execute(&pool).await.unwrap();
        assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().einheit_id, Some(einheit));
    }

    #[tokio::test]
    async fn aktualisiere_status_position_bemerkung_dann_entferne() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap();
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();
        let neuer = status_repo::anlegen(&pool, 1, StatusDaten {
            label: "im Einsatz", kategorie: KATEGORIE_GEBUNDEN, farbe: None, sortier: 40,
        }).await.unwrap();

        aktualisiere(&pool, einsatz, ep, Some(neuer.id), Some("mannschaft"), Some("vor Ort")).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.status_id, Some(neuer.id));
        assert_eq!(a.staerke_position.as_deref(), Some("mannschaft"));
        assert_eq!(a.bemerkung.as_deref(), Some("vor Ort"));

        // status_id None → bleibt; position None → bleibt; nur Bemerkung leeren.
        aktualisiere(&pool, einsatz, ep, None, None, Some("")).await.unwrap();
        let b = laden_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(b.status_id, Some(neuer.id), "Status unverändert");
        assert_eq!(b.staerke_position.as_deref(), Some("mannschaft"), "Position unverändert");
        assert_eq!(b.bemerkung.as_deref(), Some(""), "Bemerkung geleert");

        entferne(&pool, einsatz, ep).await.unwrap();
        assert!(matches!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap_err(), AppError::NotFound));
    }
}
