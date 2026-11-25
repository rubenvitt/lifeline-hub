use super::{
    status_repo, EinsatzFahrzeugAnzeige, StatusKategorie, DIENSTSTATUS_IN_DIENST,
    KATEGORIE_GEBUNDEN,
};
use crate::bereitstellungsraum::belegung_repo;
use crate::entlassung::{BeendetAls, Disponiert};
use crate::error::AppError;
use crate::staerke::Staerke;
use sqlx::{SqliteConnection, SqlitePool};

/// SELECT mit aufgelöster Live-Identität (LEFT JOIN fahrzeug) und Status. Live oder Snapshot
/// wählt `zu_anzeige` mit `einsatz_aktiv`. `ist_demo` liest die Demo-Marke des Stamm-Fahrzeugs
/// live (LFH-733, design.md D2); ad-hoc (`fahrzeug_id IS NULL`) findet keine Marke.
const SELECT_AUFGELOEST: &str = "\
    SELECT ef.id, ef.einsatz_id, ef.fahrzeug_id, ef.einheit_id, ef.status_id, \
           ef.snap_funkrufname, ef.snap_kennzeichen, ef.snap_fahrzeugtyp, ef.snap_opta, \
           ef.snap_traegerorganisation, ef.bemerkung, \
           ef.lat, ef.lon, ef.position_aktualisiert_at, ef.position_quelle, \
           ef.tz_fachaufgabe, ef.tz_organisation, \
           ef.aktueller_br_id, ef.status_seit, \
           ef.disponiert_at, ef.disponiert_von, \
           ef.beendet_at, ef.beendet_von, ef.beendet_als, \
           f.funkrufname AS live_funkrufname, f.kennzeichen AS live_kennzeichen, \
           f.fahrzeugtyp AS live_fahrzeugtyp, f.opta AS live_opta, \
           f.traegerorganisation AS live_traegerorganisation, f.dienststatus AS live_dienststatus, \
           f.staerke_fuehrer AS soll_fuehrer, f.staerke_unterfuehrer AS soll_unterfuehrer, \
           f.staerke_mannschaft AS soll_mannschaft, \
           s.label AS status_label, s.kategorie AS status_kategorie, s.farbe AS status_farbe, \
           EXISTS(SELECT 1 FROM demo_herkunft dh \
                  WHERE dh.tabelle = 'fahrzeug' AND dh.datensatz_id = ef.fahrzeug_id) AS ist_demo \
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
    position_aktualisiert_at: Option<String>,
    position_quelle: Option<String>,
    tz_fachaufgabe: Option<String>,
    tz_organisation: Option<String>,
    aktueller_br_id: Option<i64>,
    status_seit: Option<String>,
    disponiert_at: String,
    disponiert_von: Option<i64>,
    beendet_at: Option<String>,
    beendet_von: Option<i64>,
    beendet_als: Option<String>,
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
    /// LFH-733: Demo-Marke des Stamm-Datensatzes (D2), bei Ad-hoc ohne Treffer und damit `false`.
    ist_demo: bool,
}

/// Auflösungsregel: Live-Felder nur mit Stamm-Bezug, aktivem Einsatz UND Fahrzeug in Dienst,
/// sonst Snapshot.
fn zu_anzeige(row: Row, einsatz_aktiv: bool) -> EinsatzFahrzeugAnzeige {
    let live = row.fahrzeug_id.is_some()
        && einsatz_aktiv
        && row.live_dienststatus.as_deref() == Some(DIENSTSTATUS_IN_DIENST);

    let (funkrufname, kennzeichen, fahrzeugtyp, opta, traeger) = if live {
        (
            row.live_funkrufname
                .clone()
                .unwrap_or_else(|| row.snap_funkrufname.clone()),
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
        status_seit: row.status_seit,
        bemerkung: row.bemerkung,
        lat: row.lat,
        lon: row.lon,
        position_aktualisiert_at: row.position_aktualisiert_at,
        position_quelle: row.position_quelle,
        tz_fachaufgabe: row.tz_fachaufgabe,
        tz_organisation: row.tz_organisation,
        aktueller_br_id: row.aktueller_br_id,
        // Soll-Besatzung aus dem Stamm-Join: nur eine vollständige Soll-Stärke ergibt `Some`;
        // Ad-hoc-Fahrzeuge liefern `None`.
        soll_besatzung: match (row.soll_fuehrer, row.soll_unterfuehrer, row.soll_mannschaft) {
            (Some(f), Some(u), Some(m)) => Some(Staerke::neu(f as u16, u as u16, m as u16)),
            _ => None,
        },
        disponiert_at: row.disponiert_at,
        disponiert_von: row.disponiert_von,
        ist_demo: row.ist_demo,
        beendet_at: row.beendet_at,
        beendet_von: row.beendet_von,
        beendet_als: row.beendet_als,
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

/// Aktive Fahrzeuge eines Einsatzes (aufgelöst), sortiert nach Dispo-Zeit. Entlassene und
/// stornierte fehlen (LLH-1079, Spec `kraefte-entlassung`).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzFahrzeugAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ef.einsatz_id = ? AND ef.beendet_at IS NULL \
         ORDER BY ef.disponiert_at, ef.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| zu_anzeige(r, einsatz_aktiv))
        .collect())
}

/// Entlassene Fahrzeuge eines Einsatzes (aufgelöst), zuletzt entlassene zuerst — der Nachweis
/// hinter `GET …/vehicles?entlassene=1` (LLH-1079). Stornierte erscheinen nie.
pub async fn list_entlassene(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzFahrzeugAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ef.einsatz_id = ? AND ef.beendet_als = 'entlassen' \
         ORDER BY ef.beendet_at DESC, ef.id DESC"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| zu_anzeige(r, einsatz_aktiv))
        .collect())
}

/// Lädt eine Dispositionszeile (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn load_anzeige(
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

/// Wie [`load_anzeige`], auf einer offenen Verbindung (Reload in der Transaktion beim atomaren
/// Disponieren/Aktualisieren).
pub async fn load_anzeige_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzFahrzeugAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ef.id = ? AND ef.einsatz_id = ?"
    )))
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Eine Disposition eines Stamm-Fahrzeugs in einem aktiven Einsatz (LLH-1290): wer nach einer
/// Änderung im Stamm Bescheid bekommt. `im_raum`: das Fahrzeug oder seine Einheit steht in einem
/// Bereitstellungsraum, oder das Fahrzeug steht im Verlauf eines Raums.
#[derive(Debug, PartialEq, Eq, sqlx::FromRow)]
pub struct AktiveDisposition {
    pub einsatz_id: i64,
    pub ef_id: i64,
    pub einheit_id: Option<i64>,
    pub im_raum: bool,
}

/// Alle Dispositionen des Stamm-Fahrzeugs `fahrzeug_id` von `org_id` in aktiven Einsätzen, auch
/// entlassene: deren Name folgt in der Liste der Entlassenen ebenfalls dem Stamm
/// ([`zu_anzeige`]). Abgeschlossene Einsätze zeigen den Snapshot und bleiben außen vor.
pub async fn aktive_dispositionen(
    pool: &SqlitePool,
    org_id: i64,
    fahrzeug_id: i64,
) -> Result<Vec<AktiveDisposition>, AppError> {
    Ok(sqlx::query_as::<_, AktiveDisposition>(
        "SELECT ef.einsatz_id, ef.id AS ef_id, ef.einheit_id, \
                (ef.aktueller_br_id IS NOT NULL OR ee.aktueller_br_id IS NOT NULL \
                 OR EXISTS(SELECT 1 FROM br_belegung b \
                           WHERE b.objekt_typ = 'fahrzeug' AND b.objekt_id = ef.id)) AS im_raum \
         FROM einsatz_fahrzeug ef \
         JOIN einsatz ez ON ez.id = ef.einsatz_id \
         LEFT JOIN einsatz_einheit ee ON ee.id = ef.einheit_id \
         WHERE ef.fahrzeug_id = ? AND ez.org_id = ? AND ez.status = 'aktiv' \
         ORDER BY ef.einsatz_id, ef.id",
    )
    .bind(fahrzeug_id)
    .bind(org_id)
    .fetch_all(pool)
    .await?)
}

/// Disponiert ein Stamm-Fahrzeug auf einer offenen Verbindung: prüft Org und Dienststatus,
/// friert den Identitäts-Snapshot ein und setzt den ersten `gebunden`-Status. `NotFound` bei
/// fremdem/unbekanntem Fahrzeug, `UnprocessableEntity` bei außer Dienst, `Conflict` bei
/// Doppel-Disposition. Ein entlassenes oder storniertes Fahrzeug wird wieder aufgenommen statt
/// abgelehnt (LLH-1079, design.md D7): `UNIQUE(einsatz_id, fahrzeug_id)` lässt keine zweite
/// Zeile zu.
pub async fn disponiere_stamm_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    fahrzeug_id: i64,
    disponiert_von: i64,
) -> Result<Disponiert, AppError> {
    let bestehend: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT id, beendet_at FROM einsatz_fahrzeug WHERE einsatz_id = ? AND fahrzeug_id = ?",
    )
    .bind(einsatz_id)
    .bind(fahrzeug_id)
    .fetch_optional(&mut *conn)
    .await?;
    match bestehend {
        Some((_, None)) => return Err(doppelt_conflict()),
        Some((id, Some(_))) => {
            reaktivieren_tx(conn, einsatz_id, org_id, id, disponiert_von).await?;
            return Ok(Disponiert {
                id,
                reaktiviert: true,
            });
        }
        None => {}
    }
    let (funkrufname, kennzeichen, fahrzeugtyp, opta, traeger) =
        stamm_snapshot_tx(conn, org_id, fahrzeug_id).await?;
    let status_id =
        status_repo::erster_der_kategorie_tx(&mut *conn, org_id, KATEGORIE_GEBUNDEN).await?;

    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_fahrzeug \
            (einsatz_id, fahrzeug_id, status_id, status_seit, snap_funkrufname, \
             snap_kennzeichen, snap_fahrzeugtyp, snap_opta, snap_traegerorganisation, \
             disponiert_von) \
         VALUES (?1, ?2, ?3, CASE WHEN ?3 IS NULL THEN NULL ELSE datetime('now') END, \
                 ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id",
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
    .fetch_one(&mut *conn)
    .await;

    match ergebnis {
        Ok(id) => Ok(Disponiert {
            id,
            reaktiviert: false,
        }),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(doppelt_conflict()),
        Err(e) => Err(e.into()),
    }
}

fn doppelt_conflict() -> AppError {
    AppError::Conflict("Fahrzeug ist bereits in diesem Einsatz disponiert".into())
}

/// Identitäts-Snapshot eines Stamm-Fahrzeugs: Funkrufname, Kennzeichen, Typ, OPTA, Träger.
type Snapshot = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Snapshot eines Stamm-Fahrzeugs der Org; `NotFound` bei fremdem/unbekanntem,
/// `UnprocessableEntity` bei außer Dienst.
async fn stamm_snapshot_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    fahrzeug_id: i64,
) -> Result<Snapshot, AppError> {
    let (funkrufname, kennzeichen, fahrzeugtyp, opta, traeger, dienststatus) = sqlx::query_as::<
        _,
        (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        ),
    >(
        "SELECT funkrufname, kennzeichen, fahrzeugtyp, opta, traegerorganisation, \
                    dienststatus \
             FROM fahrzeug WHERE id = ? AND org_id = ?",
    )
    .bind(fahrzeug_id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if dienststatus != DIENSTSTATUS_IN_DIENST {
        // Ein Zustand, also 422 wie bei der Person (`src/AGENTS.md`, Statuscode-Konvention; bis
        // LLH-1100 war es 400).
        return Err(AppError::UnprocessableEntity(
            "Fahrzeug ist außer Dienst und kann nicht disponiert werden".into(),
        ));
    }
    Ok((funkrufname, kennzeichen, fahrzeugtyp, opta, traeger))
}

/// Pool-Wrapper ohne eigene Transaktion; liefert die `ef_id`.
pub async fn disponiere_stamm(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    fahrzeug_id: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let mut conn = pool.acquire().await?;
    Ok(
        disponiere_stamm_tx(&mut conn, einsatz_id, org_id, fahrzeug_id, disponiert_von)
            .await?
            .id,
    )
}

/// Disponiert ein Ad-hoc-externes Fahrzeug (`fahrzeug_id = NULL`) auf einer offenen
/// Verbindung; `snap_*` sind die eigentlichen Daten. Initialstatus ist der erste `gebunden`.
pub async fn disponiere_adhoc_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    daten: AdhocDaten<'_>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let status_id =
        status_repo::erster_der_kategorie_tx(&mut *conn, org_id, KATEGORIE_GEBUNDEN).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_fahrzeug \
            (einsatz_id, fahrzeug_id, status_id, status_seit, snap_funkrufname, \
             snap_kennzeichen, snap_fahrzeugtyp, snap_opta, snap_traegerorganisation, \
             disponiert_von) \
         VALUES (?1, NULL, ?2, CASE WHEN ?2 IS NULL THEN NULL ELSE datetime('now') END, \
                 ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(status_id)
    .bind(daten.funkrufname)
    .bind(daten.kennzeichen)
    .bind(daten.fahrzeugtyp)
    .bind(daten.opta)
    .bind(daten.traegerorganisation)
    .bind(disponiert_von)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Pool-Wrapper: disponiert ein Ad-hoc-Fahrzeug in eigener Transaktion.
pub async fn disponiere_adhoc(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    daten: AdhocDaten<'_>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let mut conn = pool.acquire().await?;
    disponiere_adhoc_tx(&mut conn, einsatz_id, org_id, daten, disponiert_von).await
}

/// Änderung einer Dispositionszeile (Muster `personal::DispositionPatch`, LLH-1067): jedes Feld
/// `None` = unverändert. Tri-State-Felder (`Some(None)` = NULL, `Some(Some(x))` = setzen); getrimmt
/// und begrenzt wird in der Route.
#[derive(Debug, Default, Clone, Copy)]
pub struct FahrzeugPatch<'a> {
    pub status_id: Option<i64>,
    /// Wer den Status setzt; bei einem echten Wechsel in `status_gesetzt_von` (LLH-1781, für die
    /// Rücknahme). `None` lässt die Spalte bei einem Wechsel leer.
    pub gesetzt_von: Option<i64>,
    pub bemerkung: Option<Option<&'a str>>,
    /// Ad-hoc-Angaben (LLH-1073, design.md D1): nur an einer Zeile ohne Stamm-Bezug, sonst 422.
    /// Sie schreiben die `snap_*`-Spalten, die bei einem Ad-hoc-Fahrzeug die Daten sind.
    pub funkrufname: Option<&'a str>,
    pub fahrzeugtyp: Option<Option<&'a str>>,
    pub kennzeichen: Option<Option<&'a str>>,
    pub traegerorganisation: Option<Option<&'a str>>,
    pub opta: Option<Option<&'a str>>,
}

impl FahrzeugPatch<'_> {
    /// Ändert der Patch eine Angabe, die bei einem Stamm-Fahrzeug der Stamm trägt?
    pub fn has_adhoc_angaben(&self) -> bool {
        self.funkrufname.is_some()
            || self.fahrzeugtyp.is_some()
            || self.kennzeichen.is_some()
            || self.traegerorganisation.is_some()
            || self.opta.is_some()
    }
}

/// Der 422 an einem Stamm-Fahrzeug, dessen Angaben über den Einsatz geändert werden sollen
/// (LLH-1073, design.md D1).
pub fn stamm_angaben_error() -> AppError {
    AppError::UnprocessableEntity("Angaben eines Stamm-Fahrzeugs im Stamm pflegen".into())
}

/// Aktualisiert eine Dispositionszeile nach [`FahrzeugPatch`] auf einer offenen Verbindung.
/// `status_id` per COALESCE. `status_seit` springt nur bei einem ECHTEN Wechsel, sonst läse
/// „Seit“ den letzten Klick. `NotFound`, falls die Zeile nicht zum Einsatz gehört, `Conflict` an
/// einem beendeten Fahrzeug (LLH-1079), `UnprocessableEntity` bei Ad-hoc-Angaben an einem
/// Stamm-Fahrzeug, `Veraltet` (409), wenn eine Spalte aus `erwartet` inzwischen einen anderen Wert
/// trägt (Feld-CAS, LLH-1945); jede Ablehnung schreibt nichts, auch keinen Status.
pub async fn update_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    patch: FahrzeugPatch<'_>,
    erwartet: &crate::feld_cas::ExpectedValues<'_>,
) -> Result<(), AppError> {
    // Ein entlassenes oder storniertes Fahrzeug bekommt keinen Status mehr (409, LLH-1079).
    require_aktiv_tx(conn, einsatz_id, ef_id).await?;
    if patch.has_adhoc_angaben() {
        // „Stamm“ wird in der Transaktion am Stammbezug geprüft, nicht am Client (design.md D1).
        let fahrzeug_id: Option<i64> = sqlx::query_scalar(
            "SELECT fahrzeug_id FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
        )
        .bind(ef_id)
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
        if fahrzeug_id.is_some() {
            return Err(stamm_angaben_error());
        }
    }
    // Feld-CAS (LLH-1945): nach 404, 409 (beendet) und 422 (Stamm-Fahrzeug), vor dem Schreiben.
    crate::feld_cas::check_zeile_tx(conn, "einsatz_fahrzeug", einsatz_id, ef_id, erwartet).await?;
    // Ungezählte Bindungen mit Merkern statt `?1..?n`: ein neues Feld verschiebt keine Bindung
    // still (Muster LLH-1067). Die `snap_*`-Spalten schreibt das UPDATE nur ohne Stammbezug, auch
    // wenn eine Route die Prüfung oben vergäße.
    let resultat = sqlx::query(
        "UPDATE einsatz_fahrzeug \
         SET status_seit = CASE WHEN ? IS NOT NULL AND ? IS NOT status_id \
                                THEN datetime('now') ELSE status_seit END, \
             status_gesetzt_von = CASE WHEN ? IS NOT NULL AND ? IS NOT status_id \
                                       THEN ? ELSE status_gesetzt_von END, \
             status_vorher_id = CASE WHEN ? IS NOT NULL AND ? IS NOT status_id \
                                     THEN status_id ELSE status_vorher_id END, \
             status_vorher_seit = CASE WHEN ? IS NOT NULL AND ? IS NOT status_id \
                                       THEN status_seit ELSE status_vorher_seit END, \
             status_ereignis_id = CASE WHEN ? IS NOT NULL AND ? IS NOT status_id \
                                       THEN NULL ELSE status_ereignis_id END, \
             status_id = COALESCE(?, status_id), \
             bemerkung = CASE WHEN ? THEN ? ELSE bemerkung END, \
             snap_funkrufname = CASE WHEN fahrzeug_id IS NULL \
                                     THEN COALESCE(?, snap_funkrufname) \
                                     ELSE snap_funkrufname END, \
             snap_fahrzeugtyp = CASE WHEN ? AND fahrzeug_id IS NULL THEN ? \
                                     ELSE snap_fahrzeugtyp END, \
             snap_kennzeichen = CASE WHEN ? AND fahrzeug_id IS NULL THEN ? \
                                     ELSE snap_kennzeichen END, \
             snap_traegerorganisation = CASE WHEN ? AND fahrzeug_id IS NULL THEN ? \
                                             ELSE snap_traegerorganisation END, \
             snap_opta = CASE WHEN ? AND fahrzeug_id IS NULL THEN ? ELSE snap_opta END \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(patch.status_id)
    .bind(patch.status_id)
    // status_gesetzt_von
    .bind(patch.status_id)
    .bind(patch.status_id)
    .bind(patch.gesetzt_von)
    // status_vorher_id, status_vorher_seit, status_ereignis_id
    .bind(patch.status_id)
    .bind(patch.status_id)
    .bind(patch.status_id)
    .bind(patch.status_id)
    .bind(patch.status_id)
    .bind(patch.status_id)
    // status_id
    .bind(patch.status_id)
    .bind(patch.bemerkung.is_some())
    .bind(patch.bemerkung.flatten())
    .bind(patch.funkrufname)
    .bind(patch.fahrzeugtyp.is_some())
    .bind(patch.fahrzeugtyp.flatten())
    .bind(patch.kennzeichen.is_some())
    .bind(patch.kennzeichen.flatten())
    .bind(patch.traegerorganisation.is_some())
    .bind(patch.traegerorganisation.flatten())
    .bind(patch.opta.is_some())
    .bind(patch.opta.flatten())
    .bind(ef_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Pool-Hülle um [`update_tx`] ohne eigene Transaktion.
pub async fn update(
    pool: &SqlitePool,
    einsatz_id: i64,
    ef_id: i64,
    patch: FahrzeugPatch<'_>,
) -> Result<(), AppError> {
    let mut conn = pool.acquire().await?;
    update_tx(
        &mut conn,
        einsatz_id,
        ef_id,
        patch,
        &crate::feld_cas::ExpectedValues::new(),
    )
    .await
}

/// Geo-/Symbol-Felder einer Disposition. `Some(None)` = NULL, `None` = unverändert.
#[derive(Debug, Default)]
pub struct PositionPatch<'a> {
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
}

/// Setzt/ändert/löscht Position und Symbol-Felder und liefert die aufgelöste Anzeige
/// (`einsatz_aktiv` steuert Live/Snapshot). `NotFound`, falls die Zeile nicht zum Einsatz
/// gehört.
pub async fn update_position(
    pool: &SqlitePool,
    einsatz_id: i64,
    ef_id: i64,
    daten: PositionPatch<'_>,
    einsatz_aktiv: bool,
    erwartet: &crate::feld_cas::ExpectedValues<'_>,
) -> Result<EinsatzFahrzeugAnzeige, AppError> {
    // Ein beendetes Fahrzeug steht auf keiner Karte mehr (409, LLH-1079).
    require_aktiv_tx(&mut *pool.acquire().await?, einsatz_id, ef_id).await?;
    // Feld-CAS (LLH-1945): je Altwert `AND <spalte> IS ?` an demselben UPDATE.
    let sql = format!(
        "UPDATE einsatz_fahrzeug SET \
            lat = CASE WHEN ?1 THEN ?2 ELSE lat END, \
            lon = CASE WHEN ?3 THEN ?4 ELSE lon END, \
            tz_fachaufgabe  = CASE WHEN ?5 THEN ?6 ELSE tz_fachaufgabe END, \
            tz_organisation = CASE WHEN ?7 THEN ?8 ELSE tz_organisation END, \
            position_quelle = CASE WHEN ?1 OR ?3 THEN 'manuell' ELSE position_quelle END, \
            position_aktualisiert_at = CASE WHEN ?1 OR ?3 THEN \
                (CASE WHEN (CASE WHEN ?1 THEN ?2 ELSE lat END) IS NULL THEN NULL ELSE ?11 END) \
                ELSE position_aktualisiert_at END \
         WHERE id = ?9 AND einsatz_id = ?10{}",
        erwartet.sql_suffix(12)
    );
    let q = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(daten.lat.is_some())
        .bind(daten.lat.flatten())
        .bind(daten.lon.is_some())
        .bind(daten.lon.flatten())
        .bind(daten.tz_fachaufgabe.is_some())
        .bind(daten.tz_fachaufgabe.flatten())
        .bind(daten.tz_organisation.is_some())
        .bind(daten.tz_organisation.flatten())
        .bind(ef_id)
        .bind(einsatz_id)
        .bind(crate::zeit::jetzt());
    let betroffen = erwartet.bind_all(q).execute(pool).await?.rows_affected();
    if betroffen == 0 {
        return Err(crate::feld_cas::ohne_treffer(
            pool,
            "einsatz_fahrzeug",
            einsatz_id,
            ef_id,
            erwartet,
        )
        .await);
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

// ── Lebenszustand (LLH-1079 Teil II, Spec `kraefte-entlassung`) ──────────────────────────

/// Jeder Schreibweg an einem Fahrzeug fragt zuerst hier (design.md D6): `NotFound`, wenn die
/// Zeile nicht zum Einsatz gehört, `Conflict` (Lebenszyklus, `src/AGENTS.md`), wenn es entlassen
/// oder storniert ist. Nur das erneute Disponieren schreibt an einem beendeten Fahrzeug.
pub async fn require_aktiv_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<(), AppError> {
    let ende: Option<Option<String>> = sqlx::query_scalar(
        "SELECT beendet_als FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    match ende.ok_or(AppError::NotFound)? {
        None => Ok(()),
        Some(als) => Err(beendet_conflict(&als)),
    }
}

/// Der 409 an einem beendeten Fahrzeug (Lebenszyklus), je Endzustand.
pub fn beendet_conflict(beendet_als: &str) -> AppError {
    AppError::Conflict(match beendet_als {
        "storniert" => "Das Fahrzeug ist storniert; erst erneut disponieren".into(),
        _ => "Das Fahrzeug ist aus dem Einsatz entlassen; erst erneut disponieren".into(),
    })
}

/// Wie [`require_aktiv_tx`] für Schreibwege anderer Module, die die Zugehörigkeit zum Einsatz
/// selbst prüfen (mit eigenem Statuscode): ein unbekanntes Fahrzeug ist hier kein Fehler, ein
/// beendetes der 409 aus [`beendet_conflict`] (design.md D6).
pub async fn require_nicht_beendet(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<(), AppError> {
    let ende: Option<Option<String>> = sqlx::query_scalar(
        "SELECT beendet_als FROM einsatz_fahrzeug \
         WHERE id = ? AND einsatz_id = ? AND beendet_at IS NOT NULL",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(executor)
    .await?;
    match ende.flatten() {
        None => Ok(()),
        Some(als) => Err(beendet_conflict(&als)),
    }
}

/// Fahrzeug eines Eigentransports (LLH-1332, design.md D2): Funkrufname für die Momentaufnahme
/// und die Lebenszeit der Disposition, gegen die der Verbleib-Handler die Erfassungszeit prüft.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TransportFahrzeug {
    pub funkrufname: String,
    pub disponiert_at: String,
    pub beendet_at: Option<String>,
    pub beendet_als: Option<String>,
}

impl TransportFahrzeug {
    /// Bestand die Disposition zur Erfassungszeit? Stornierte gelten als nie disponiert; eine
    /// entlassene nur bis zu ihrer Entlassung. Beide Zeiten im kanonischen Format.
    pub fn bestand_zu(&self, zeitpunkt_at: &str) -> bool {
        if self.beendet_als.as_deref() == Some(BeendetAls::Storniert.as_str()) {
            return false;
        }
        self.disponiert_at.as_str() <= zeitpunkt_at
            && self
                .beendet_at
                .as_deref()
                .is_none_or(|ende| zeitpunkt_at < ende)
    }
}

/// Lädt eine Disposition dieses Einsatzes für einen Eigentransport; `None` bei fremder oder
/// unbekannter Kennung. Liest auch beendete Zeilen: eine vorgemerkte Übergabe kommt womöglich
/// nach der Entlassung des Fahrzeugs an.
pub async fn transport_fahrzeug(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<Option<TransportFahrzeug>, AppError> {
    Ok(sqlx::query_as::<_, TransportFahrzeug>(
        "SELECT COALESCE(f.funkrufname, ef.snap_funkrufname) AS funkrufname, ef.disponiert_at, \
                ef.beendet_at, ef.beendet_als \
         FROM einsatz_fahrzeug ef LEFT JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
         WHERE ef.id = ? AND ef.einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(executor)
    .await?)
}

/// Was das Entlassen eines Fahrzeugs über die Zeile hinaus berührt hat; der Aufrufer meldet es
/// nach dem Commit und nennt die Einheit im ETB-Text.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Entlassen {
    /// Einheit, der das Fahrzeug angehörte (ID für das Ereignis, Name nur für den ETB-Text,
    /// design.md D4).
    pub einheit: Option<(i64, String)>,
    /// Bereitstellungsraum, aus dem das Entlassen den Austritt geschrieben hat.
    pub br_id: Option<i64>,
    /// Besatzung, die frei geworden ist (`einsatz_personal.id`).
    pub besatzung: Vec<i64>,
    /// Trug das Fahrzeug die Führungsstelle?
    pub trug_fuehrungsstelle: bool,
    /// Beladung, die ohne Ort zurückbleibt (`einsatz_material.id`, LLH-1224 D13).
    pub material: Vec<i64>,
}

impl Entlassen {
    /// Der Vorzustand für die Rücknahme (LLH-1722, design.md D5); `entlassen_at` ist der
    /// Zeitpunkt, den das Entlassen geschrieben hat.
    pub fn vorzustand(&self, entlassen_at: &str) -> crate::fahrzeug::EntlassungVorzustand {
        crate::fahrzeug::EntlassungVorzustand {
            entlassen_at: entlassen_at.to_string(),
            einheit_id: self.einheit.as_ref().map(|(id, _)| *id),
            br_id: self.br_id,
            fuehrungsstelle: self.trug_fuehrungsstelle,
            besatzung: self.besatzung.clone(),
            beladung: self.material.clone(),
        }
    }
}

/// Entlässt ein Fahrzeug aus dem Einsatz (design.md D4): die Zeile bleibt mit Zeitpunkt und
/// entlassender Person stehen. Gelöst werden Besatzung, Einheit, Bereitstellungsraum (mit
/// Austritt) und die Zuordnung zur Führungsstelle; Auftragsempfänger bleiben. Keine Zeitachse
/// (D5: Fahrzeuge wirken nur über ihre Einheit). `NotFound`/`Conflict` wie [`require_aktiv_tx`].
pub async fn entlassen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Entlassen, AppError> {
    require_aktiv_tx(conn, einsatz_id, ef_id).await?;
    let einheit: Option<(i64, String)> = sqlx::query_as(
        "SELECT e.id, e.name FROM einsatz_fahrzeug ef \
         JOIN einsatz_einheit e ON e.id = ef.einheit_id \
         WHERE ef.id = ? AND ef.einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let besatzung = super::besatzung_repo::load_besatzung_tx(conn, einsatz_id, ef_id).await?;
    let trug_fuehrungsstelle =
        crate::einsatz::fuehrungsstelle::traegt_fahrzeug_tx(conn, ef_id).await?;
    let br_id =
        belegung_repo::austritt_fahrzeug_bei_entlassung_tx(conn, einsatz_id, ef_id, benutzer_id)
            .await?;
    // Die Beladung bleibt ohne Ort im Einsatz (LLH-1224 D13): sie verschwindet nicht still mit
    // dem Fahrzeug. Beendete Posten haben keinen Ort mehr.
    let material: Vec<i64> = sqlx::query_scalar(
        "UPDATE einsatz_material SET einsatz_fahrzeug_id = NULL \
         WHERE einsatz_fahrzeug_id = ? AND einsatz_id = ? AND beendet_at IS NULL RETURNING id",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for sql in [
        "UPDATE einsatz_personal SET fahrzeug_id = NULL WHERE fahrzeug_id = ? AND einsatz_id = ?",
        "DELETE FROM einsatz_fuehrungsstelle_fahrzeug \
         WHERE einsatz_fahrzeug_id = ? AND einsatz_id = ?",
        "UPDATE einsatz_fahrzeug SET einheit_id = NULL WHERE id = ? AND einsatz_id = ?",
    ] {
        sqlx::query(sql)
            .bind(ef_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
    }
    // Die Führungsstelle verliert ein Fahrzeug: Änderungsvermerk an ihren Fahrzeugen (LLH-1834).
    if trug_fuehrungsstelle {
        crate::einsatz::feld_vermerk::setze_tx(
            conn,
            einsatz_id,
            crate::einsatz::feld_vermerk::Objekt::Fuehrungsstelle,
            &["fahrzeug_ids"],
            benutzer_id,
        )
        .await?;
    }
    set_beendet_tx(
        conn,
        einsatz_id,
        ef_id,
        benutzer_id,
        jetzt,
        BeendetAls::Entlassen,
    )
    .await?;
    Ok(Entlassen {
        einheit,
        br_id,
        besatzung,
        trug_fuehrungsstelle,
        material,
    })
}

/// Setzt den Endzustand genau einmal; die Bedingung `beendet_at IS NULL` steht im UPDATE, so
/// trifft ein gleichzeitiger zweiter Versuch keine Zeile mehr (`Conflict`).
async fn set_beendet_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    benutzer_id: i64,
    jetzt: &str,
    als: BeendetAls,
) -> Result<(), AppError> {
    // `zuletzt_entlassen_at` überdauert das erneute Disponieren (Storno-Sperre, design.md D3).
    let r = sqlx::query(
        "UPDATE einsatz_fahrzeug SET beendet_at = ?1, beendet_von = ?2, beendet_als = ?3, \
             zuletzt_entlassen_at = CASE WHEN ?3 = 'entlassen' THEN ?1 \
                                         ELSE zuletzt_entlassen_at END \
         WHERE id = ?4 AND einsatz_id = ?5 AND beendet_at IS NULL",
    )
    .bind(jetzt)
    .bind(benutzer_id)
    .bind(als.as_str())
    .bind(ef_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Das Fahrzeug ist bereits entlassen".into(),
        ));
    }
    Ok(())
}

/// Storniert eine Fehldisposition (design.md D3): die Zeile endet als `storniert` und erscheint
/// in keinem Nachweis. Nur solange das Fahrzeug aktiv ist (sonst `Conflict`), nie entlassen war,
/// seinen Status seit der Disposition behalten hat, ohne Besatzung, Einheit,
/// Bereitstellungsraum, Führungsstelle und Auftrag und höchstens
/// [`crate::entlassung::STORNO_FRIST_MINUTEN`] nach der Disposition; sonst 422 mit dem ersten
/// verletzten Grund als Satz. Ein Fahrzeug trägt keine eigene Zeitachse, es gibt nichts zu
/// streichen.
pub async fn stornieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    require_aktiv_tx(conn, einsatz_id, ef_id).await?;
    if let Some(grund) = find_storno_hindernis_tx(conn, einsatz_id, ef_id, jetzt).await? {
        return Err(AppError::UnprocessableEntity(grund));
    }
    set_beendet_tx(
        conn,
        einsatz_id,
        ef_id,
        benutzer_id,
        jetzt,
        BeendetAls::Storniert,
    )
    .await
}

/// Der erste Grund, der den Storno eines Fahrzeugs verbietet (design.md D3), oder `None`.
async fn find_storno_hindernis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    jetzt: &str,
) -> Result<Option<String>, AppError> {
    let (disponiert_at, status_id, status_seit, einheit, br, entlassen_at, org_id): (
        String,
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        i64,
    ) = sqlx::query_as(
        "SELECT ef.disponiert_at, ef.status_id, ef.status_seit, ef.einheit_id, \
                ef.aktueller_br_id, ef.zuletzt_entlassen_at, e.org_id \
         FROM einsatz_fahrzeug ef JOIN einsatz e ON e.id = ef.einsatz_id \
         WHERE ef.id = ? AND ef.einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    // Wer einmal entlassen war, war im Einsatz: das erneute Disponieren setzt die Frist nicht
    // zurück.
    if entlassen_at.is_some() {
        return Ok(Some(
            "Das Fahrzeug war schon einmal aus dem Einsatz entlassen; \
             das Fahrzeug lässt sich entlassen"
                .into(),
        ));
    }
    // Disponieren setzt den ersten `gebunden`-Status und `status_seit` = `disponiert_at` in
    // derselben Anweisung; jeder echte Statuswechsel danach ändert den Status oder rückt
    // `status_seit` weiter (sekundengenau, deshalb beides).
    let initial =
        status_repo::erster_der_kategorie_tx(&mut *conn, org_id, KATEGORIE_GEBUNDEN).await?;
    if status_id != initial || status_seit.is_some_and(|s| s != disponiert_at) {
        return Ok(Some(
            "Der Status des Fahrzeugs hat sich seit der Disposition geändert; \
             das Fahrzeug lässt sich entlassen"
                .into(),
        ));
    }
    let hat_besatzung: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM einsatz_personal \
                       WHERE fahrzeug_id = ?1 AND einsatz_id = ?2 AND beendet_at IS NULL)",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    let hat_beladung: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM einsatz_material \
                       WHERE einsatz_fahrzeug_id = ?1 AND einsatz_id = ?2 AND beendet_at IS NULL)",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    let bindung = if hat_besatzung {
        Some("Das Fahrzeug hat eine Besatzung")
    } else if hat_beladung {
        // LLH-1224 D13: wie die Besatzung; die Beladung löst erst das Entlassen.
        Some("Das Fahrzeug hat Material geladen")
    } else if einheit.is_some() {
        Some("Das Fahrzeug gehört einer Einheit an")
    } else if br.is_some() {
        Some("Das Fahrzeug steht in einem Bereitstellungsraum")
    } else {
        None
    };
    if let Some(b) = bindung {
        return Ok(Some(format!("{b}; erst lösen oder das Fahrzeug entlassen")));
    }
    // Spuren außerhalb der eigenen Zeile, in fester Reihenfolge.
    const SPUREN: [(&str, &str); 3] = [
        (
            "SELECT EXISTS(SELECT 1 FROM br_belegung \
                           WHERE objekt_typ = 'fahrzeug' AND objekt_id = ?1 AND einsatz_id = ?2)",
            "Das Fahrzeug war in einem Bereitstellungsraum",
        ),
        (
            "SELECT EXISTS(SELECT 1 FROM einsatz_fuehrungsstelle_fahrzeug \
                           WHERE einsatz_fahrzeug_id = ?1 AND einsatz_id = ?2)",
            "Das Fahrzeug trägt die Führungsstelle",
        ),
        (
            "SELECT EXISTS(SELECT 1 FROM auftrag_empfaenger ae JOIN auftrag a ON a.id = ae.auftrag_id \
                           WHERE ae.fahrzeug_id = ?1 AND a.einsatz_id = ?2)",
            "Das Fahrzeug ist Empfänger eines Auftrags",
        ),
    ];
    for (sql, grund) in SPUREN {
        let hat: bool = sqlx::query_scalar(sql)
            .bind(ef_id)
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
        if hat {
            return Ok(Some(format!("{grund}; das Fahrzeug lässt sich entlassen")));
        }
    }
    if !crate::entlassung::is_in_storno_frist(&disponiert_at, jetzt) {
        return Ok(Some(crate::entlassung::storno_frist_text()));
    }
    Ok(None)
}

/// Nimmt ein entlassenes oder storniertes Fahrzeug wieder auf (design.md D7): Endzustand weg,
/// Initialstatus und Dispositionszeit neu. Ein Stamm-Fahrzeug muss in Dienst sein, sein Snapshot
/// wird erneuert. `NotFound` bei fremder Zeile, `Conflict` bei einer aktiven.
pub async fn reaktivieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    ef_id: i64,
    benutzer_id: i64,
) -> Result<(), AppError> {
    let zeile: Option<(Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT fahrzeug_id, beendet_at FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (fahrzeug_id, beendet_at) = zeile.ok_or(AppError::NotFound)?;
    if beendet_at.is_none() {
        return Err(doppelt_conflict());
    }
    if let Some(fid) = fahrzeug_id {
        let (funkrufname, kennzeichen, fahrzeugtyp, opta, traeger) =
            stamm_snapshot_tx(conn, org_id, fid).await?;
        sqlx::query(
            "UPDATE einsatz_fahrzeug SET snap_funkrufname = ?, snap_kennzeichen = ?, \
                 snap_fahrzeugtyp = ?, snap_opta = ?, snap_traegerorganisation = ? WHERE id = ?",
        )
        .bind(&funkrufname)
        .bind(&kennzeichen)
        .bind(&fahrzeugtyp)
        .bind(&opta)
        .bind(&traeger)
        .bind(ef_id)
        .execute(&mut *conn)
        .await?;
    }
    let status_id =
        status_repo::erster_der_kategorie_tx(&mut *conn, org_id, KATEGORIE_GEBUNDEN).await?;
    // `status_seit` und `disponiert_at` in derselben Anweisung: daran erkennt der Storno einen
    // unveränderten Status (design.md D3).
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET beendet_at = NULL, beendet_von = NULL, beendet_als = NULL, \
             status_id = ?1, \
             status_seit = CASE WHEN ?1 IS NULL THEN NULL ELSE datetime('now') END, \
             disponiert_at = datetime('now'), disponiert_von = ?2 \
         WHERE id = ?3 AND einsatz_id = ?4",
    )
    .bind(status_id)
    .bind(benutzer_id)
    .bind(ef_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// ── Rücknahme der Entlassung (LLH-1722, Spec `kraefte-entlassung`) ─────────────────────────

/// Welche Module die Person beschreiben darf, in die die Rücknahme zurückbindet (D5). Ein Teil
/// ohne Recht bleibt aus und wird genannt.
#[derive(Debug, Clone, Copy)]
pub struct RuecknahmeRechte {
    pub einheiten: bool,
    pub material: bool,
    pub bereitstellungsraeume: bool,
}

/// Was die Rücknahme zurückgebunden hat (für die Live-Meldungen) und was sie ausgelassen hat.
#[derive(Debug, Clone, Default)]
pub struct Ruecknahme {
    pub einheit_id: Option<i64>,
    pub br_id: Option<i64>,
    pub fuehrungsstelle: bool,
    pub besatzung: Vec<i64>,
    pub beladung: Vec<i64>,
    pub ausgelassen: Vec<crate::fahrzeug::RuecknahmeAusgelassen>,
}

fn ausgelassen(
    bezeichnung: impl Into<String>,
    grund: &str,
) -> crate::fahrzeug::RuecknahmeAusgelassen {
    crate::fahrzeug::RuecknahmeAusgelassen {
        bezeichnung: bezeichnung.into(),
        grund: grund.into(),
    }
}

fn ruecknahme_conflict() -> AppError {
    AppError::Conflict(
        "Die Entlassung lässt sich nicht mehr zurücknehmen; das Fahrzeug lässt sich erneut \
         disponieren"
            .into(),
    )
}

/// Nimmt das Entlassen eines Fahrzeugs zurück (design.md D5), in der Transaktion des Aufrufers.
///
/// Riegel: nur die entlassende Person, nur dieses Entlassen (`entlassen_at`), nur innerhalb von
/// [`crate::entlassung::RUECKNAHME_FRIST_MINUTEN`]; sonst `Conflict`. Der Endzustand fällt, Status und „Status seit“
/// bleiben (das Entlassen hat sie nicht angefasst). Die Storno-Sperre (`zuletzt_entlassen_at`)
/// bleibt auf diesem Entlassen stehen: wer einmal entlassen war, war im Einsatz, und ihr Wert
/// davor käme nur ungeprüft vom Client (Review vor dem PR). Jede Bindung kommt nur zurück, wenn ihr Ziel frei ist und die Person das Recht des
/// Moduls hat; sonst steht sie in `ausgelassen`. Keine Zeitachse (D5 von LLH-1079: Fahrzeuge
/// wirken nur über ihre Einheit), keine Benachrichtigung.
pub async fn zuruecknehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    benutzer_id: i64,
    jetzt: &str,
    vorzustand: &crate::fahrzeug::EntlassungVorzustand,
    rechte: RuecknahmeRechte,
) -> Result<Ruecknahme, AppError> {
    let zeile: Option<(Option<String>, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT beendet_at, beendet_von, beendet_als FROM einsatz_fahrzeug \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (beendet_at, beendet_von, beendet_als) = zeile.ok_or(AppError::NotFound)?;
    let im_riegel = beendet_als.as_deref() == Some(BeendetAls::Entlassen.as_str())
        && beendet_von == Some(benutzer_id)
        && beendet_at.as_deref() == Some(vorzustand.entlassen_at.as_str())
        && crate::entlassung::is_in_ruecknahme_frist(&vorzustand.entlassen_at, jetzt);
    if !im_riegel {
        return Err(ruecknahme_conflict());
    }
    let r = sqlx::query(
        "UPDATE einsatz_fahrzeug SET beendet_at = NULL, beendet_von = NULL, beendet_als = NULL \
         WHERE id = ? AND einsatz_id = ? AND beendet_at = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .bind(&vorzustand.entlassen_at)
    .execute(&mut *conn)
    .await?;
    if r.rows_affected() == 0 {
        return Err(ruecknahme_conflict());
    }

    let mut ergebnis = Ruecknahme::default();
    if let Some(einheit_id) = vorzustand.einheit_id {
        // Spurlos aufgelöst heißt gelöscht (`einheit::repo::aufloesen_tx`), und die ID kann an
        // eine danach gebildete Einheit gehen (`einsatz_einheit.id` ohne AUTOINCREMENT). Eine
        // Einheit, die jünger ist als das Entlassen, war nie der Ort davor (LLH-1949).
        let einheit: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT name, aufgeloest_at FROM einsatz_einheit \
             WHERE id = ? AND einsatz_id = ? AND angelegt_at <= ?",
        )
        .bind(einheit_id)
        .bind(einsatz_id)
        .bind(&vorzustand.entlassen_at)
        .fetch_optional(&mut *conn)
        .await?;
        match einheit {
            // Den Namen kennt niemand mehr, die Lücke steht trotzdem in der Antwort.
            None => ergebnis
                .ausgelassen
                .push(ausgelassen("Einheit", "nicht mehr vorhanden")),
            // Ohne Recht kein Name aus dem fremden Modul, nur die allgemeine Bezeichnung
            // (LLH-1951, wie bei der Person in `personal::ruecknahme`).
            Some(_) if !rechte.einheiten => ergebnis.ausgelassen.push(ausgelassen(
                "Einheit",
                "kein Schreibrecht im Modul Einheiten",
            )),
            Some((name, Some(_))) => ergebnis.ausgelassen.push(ausgelassen(
                format!("Einheit «{name}»"),
                "inzwischen aufgelöst",
            )),
            Some((_, None)) => {
                sqlx::query(
                    "UPDATE einsatz_fahrzeug SET einheit_id = ? WHERE id = ? AND einsatz_id = ?",
                )
                .bind(einheit_id)
                .bind(ef_id)
                .bind(einsatz_id)
                .execute(&mut *conn)
                .await?;
                ergebnis.einheit_id = Some(einheit_id);
            }
        }
    }
    // Ein Fahrzeug in einer Einheit steht über sie im Raum, nie selbst (`belege_tx`, Regel 3).
    if let (Some(br_id), None) = (vorzustand.br_id, ergebnis.einheit_id) {
        let name: Option<String> = sqlx::query_scalar(
            "SELECT bezeichnung FROM bereitstellungsraum WHERE id = ? AND einsatz_id = ?",
        )
        .bind(br_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        if let Some(name) = name {
            if !rechte.bereitstellungsraeume {
                ergebnis.ausgelassen.push(ausgelassen(
                    "Bereitstellungsraum",
                    "kein Schreibrecht im Modul Bereitstellungsräume",
                ));
            } else {
                let buchung = belegung_repo::Buchung {
                    art: crate::bereitstellungsraum::BrBelegungsArt::Eintritt,
                    notiz: Some("Entlassung zurückgenommen"),
                    client_id: None,
                    zeitpunkt_at: None,
                    von_br_id: None,
                    ruecknahme_von: None,
                };
                match belegung_repo::belege_tx(
                    conn,
                    einsatz_id,
                    br_id,
                    crate::bereitstellungsraum::ObjektTyp::Fahrzeug,
                    ef_id,
                    &buchung,
                    benutzer_id,
                )
                .await
                {
                    Ok(_) => ergebnis.br_id = Some(br_id),
                    Err(
                        AppError::Conflict(_)
                        | AppError::UnprocessableEntity(_)
                        | AppError::NotFound,
                    ) => ergebnis
                        .ausgelassen
                        .push(ausgelassen(name, "nimmt das Fahrzeug nicht mehr auf")),
                    Err(e) => return Err(e),
                }
            }
        } else {
            ergebnis
                .ausgelassen
                .push(ausgelassen("Bereitstellungsraum", "nicht mehr vorhanden"));
        }
    }
    if vorzustand.fuehrungsstelle {
        sqlx::query(
            "INSERT OR IGNORE INTO einsatz_fuehrungsstelle_fahrzeug \
               (einsatz_id, einsatz_fahrzeug_id) VALUES (?, ?)",
        )
        .bind(einsatz_id)
        .bind(ef_id)
        .execute(&mut *conn)
        .await?;
        ergebnis.fuehrungsstelle = true;
    }
    if !vorzustand.besatzung.is_empty() {
        let ids = crate::kraefte_disposition::ids_json(&vorzustand.besatzung);
        ergebnis.besatzung = sqlx::query_scalar(
            "UPDATE einsatz_personal SET fahrzeug_id = ?1 \
             WHERE einsatz_id = ?2 AND id IN (SELECT value FROM json_each(?3)) \
               AND beendet_at IS NULL AND fahrzeug_id IS NULL RETURNING id",
        )
        .bind(ef_id)
        .bind(einsatz_id)
        .bind(&ids)
        .fetch_all(&mut *conn)
        .await?;
        let fehlen: Vec<String> = sqlx::query_scalar(
            "SELECT snap_name FROM einsatz_personal \
             WHERE einsatz_id = ?1 AND id IN (SELECT value FROM json_each(?2)) \
               AND (fahrzeug_id IS NOT ?3) ORDER BY id",
        )
        .bind(einsatz_id)
        .bind(&ids)
        .bind(ef_id)
        .fetch_all(&mut *conn)
        .await?;
        for name in fehlen {
            ergebnis.ausgelassen.push(ausgelassen(
                name,
                "inzwischen auf einem anderen Fahrzeug oder nicht mehr im Einsatz",
            ));
        }
    }
    if !vorzustand.beladung.is_empty() {
        let ids = crate::kraefte_disposition::ids_json(&vorzustand.beladung);
        if !rechte.material {
            ergebnis.ausgelassen.push(ausgelassen(
                format!("Beladung ({} Posten)", vorzustand.beladung.len()),
                "kein Schreibrecht im Modul Material",
            ));
        } else {
            ergebnis.beladung = sqlx::query_scalar(
                "UPDATE einsatz_material SET einsatz_fahrzeug_id = ?1 \
                 WHERE einsatz_id = ?2 AND id IN (SELECT value FROM json_each(?3)) \
                   AND beendet_at IS NULL AND einheit_id IS NULL AND einsatz_fahrzeug_id IS NULL \
                   AND uhs_id IS NULL AND br_id IS NULL RETURNING id",
            )
            .bind(ef_id)
            .bind(einsatz_id)
            .bind(&ids)
            .fetch_all(&mut *conn)
            .await?;
            let fehlen: Vec<String> = sqlx::query_scalar(
                "SELECT snap_bezeichnung FROM einsatz_material \
                 WHERE einsatz_id = ?1 AND id IN (SELECT value FROM json_each(?2)) \
                   AND (einsatz_fahrzeug_id IS NOT ?3) ORDER BY id",
            )
            .bind(einsatz_id)
            .bind(&ids)
            .bind(ef_id)
            .fetch_all(&mut *conn)
            .await?;
            for name in fehlen {
                ergebnis.ausgelassen.push(ausgelassen(
                    name,
                    "inzwischen an einem anderen Ort oder nicht mehr im Einsatz",
                ));
            }
        }
    }
    Ok(ergebnis)
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
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        status_repo::anlegen(
            pool,
            1,
            StatusDaten {
                label: "disponiert",
                kategorie: KATEGORIE_GEBUNDEN,
                farbe: None,
                fms_anker: Some(3),
                sortier: 20,
                zeitachse_marke: None,
            },
        )
        .await
        .unwrap();
        (benutzer, einsatz)
    }

    fn fz_daten(funkrufname: &str) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname,
            fahrzeugtyp: Some("LF 20"),
            traegerorganisation: None,
            kennzeichen: Some("XX-AB 1"),
            opta: None,
            standort: None,
            fms_issi: None,
            sondersignal: false,
            tragenkapazitaet: None,
            staerke: None,
            bemerkung: None,
        }
    }

    /// Org + Einsatz + ein disponiertes Stamm-Fahrzeug; liefert (einsatz_id, ef_id).
    async fn seed_fahrzeug(pool: &SqlitePool) -> (i64, i64) {
        let (benutzer, einsatz) = setup(pool).await;
        let fz = fz_repo::anlegen(pool, 1, fz_daten("Florian 1"))
            .await
            .unwrap();
        let ef = disponiere_stamm(pool, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();
        (einsatz, ef)
    }

    #[tokio::test]
    async fn fahrzeug_position_partial_merge() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, ef_id) = seed_fahrzeug(&pool).await;
        update_position(
            &pool,
            einsatz_id,
            ef_id,
            PositionPatch {
                lat: Some(Some(50.0)),
                lon: Some(Some(8.0)),
                tz_fachaufgabe: Some(Some("transport")),
                tz_organisation: Some(Some("feuerwehr")),
            },
            true,
            &Default::default(),
        )
        .await
        .unwrap();
        let a = update_position(
            &pool,
            einsatz_id,
            ef_id,
            PositionPatch {
                lat: None,
                lon: None,
                tz_fachaufgabe: Some(Some("logistik")),
                tz_organisation: None,
            },
            true,
            &Default::default(),
        )
        .await
        .unwrap();
        assert_eq!(a.lat, Some(50.0));
        assert_eq!(a.tz_fachaufgabe.as_deref(), Some("logistik"));
        assert_eq!(a.tz_organisation.as_deref(), Some("feuerwehr"));
    }

    #[tokio::test]
    async fn disponiere_stamm_fuellt_snapshot_und_gebunden_status() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1"))
            .await
            .unwrap();

        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();
        let a = load_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(a.funkrufname, "Florian 1");
        assert_eq!(a.kennzeichen.as_deref(), Some("XX-AB 1"));
        assert_eq!(a.status_kategorie, Some(StatusKategorie::Gebunden));
        assert!(!a.ist_adhoc);
    }

    #[tokio::test]
    async fn disponiere_stamm_doppelt_ist_conflict() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1"))
            .await
            .unwrap();
        disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')")
            .execute(&pool)
            .await
            .unwrap();
        let fremd_fz: i64 = sqlx::query_scalar(
            "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (2, 'Fremd 1') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        // Org-Isolation: Einsatz gehört Org 1, Fahrzeug Org 2.
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fremd_fz, benutzer)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_ausser_dienst_ist_unprocessable() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1"))
            .await
            .unwrap();
        fz_repo::setze_dienststatus(&pool, 1, fz.id, false)
            .await
            .unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
                .await
                .unwrap_err(),
            AppError::UnprocessableEntity(_)
        ));
    }

    #[tokio::test]
    async fn adhoc_mehrfach_erlaubt_und_ist_adhoc() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for name in ["FW Extern 1", "FW Extern 2"] {
            disponiere_adhoc(
                &pool,
                einsatz,
                1,
                AdhocDaten {
                    funkrufname: name,
                    fahrzeugtyp: None,
                    kennzeichen: None,
                    opta: None,
                    traegerorganisation: Some("Feuerwehr"),
                },
                benutzer,
            )
            .await
            .unwrap();
        }
        let liste = liste(&pool, einsatz, true).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert!(liste.iter().all(|a| a.ist_adhoc && a.fahrzeug_id.is_none()));
    }

    #[tokio::test]
    async fn snapshot_stabil_live_vs_snapshot() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1"))
            .await
            .unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();

        // Stamm nachträglich umbenennen.
        let mut neu = fz_daten("Florian 1 NEU");
        neu.kennzeichen = Some("XX-AB 1");
        fz_repo::aktualisiere(&pool, 1, fz.id, neu).await.unwrap();

        // Aktiver Einsatz → Live (zeigt neuen Namen).
        let live = load_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(live.funkrufname, "Florian 1 NEU");

        // „Abgeschlossener" Einsatz (einsatz_aktiv=false) → Snapshot (alter Name).
        let snap = load_anzeige(&pool, einsatz, ef, false).await.unwrap();
        assert_eq!(snap.funkrufname, "Florian 1");

        // Stamm außer Dienst → auch bei aktivem Einsatz Snapshot.
        fz_repo::setze_dienststatus(&pool, 1, fz.id, false)
            .await
            .unwrap();
        let nach_ad = load_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(
            nach_ad.funkrufname, "Florian 1",
            "außer Dienst → Snapshot trotz aktivem Einsatz"
        );
    }

    /// LLH-1290: Der SQL-Ausdruck `funkrufname_anzeige_sql!`, den BR, Karte, Benachrichtigung
    /// und die übrigen Lesestellen nutzen, liefert in jedem Zustand denselben Namen wie die
    /// Fahrzeugliste ([`zu_anzeige`]); ein Ad-hoc-Fahrzeug zeigt immer seinen eigenen Namen.
    #[tokio::test]
    async fn funkrufname_anzeige_sql_folgt_der_fahrzeugliste() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1"))
            .await
            .unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();
        let adhoc = disponiere_adhoc(
            &pool,
            einsatz,
            1,
            AdhocDaten {
                funkrufname: "Extern 1",
                fahrzeugtyp: None,
                kennzeichen: None,
                opta: None,
                traegerorganisation: None,
            },
            benutzer,
        )
        .await
        .unwrap();
        fz_repo::aktualisiere(&pool, 1, fz.id, fz_daten("Florian 1 NEU"))
            .await
            .unwrap();

        let ueber_sql = |id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, String>(concat!(
                    "SELECT ",
                    crate::fahrzeug::funkrufname_anzeige_sql!("x"),
                    " FROM einsatz_fahrzeug x WHERE x.id = ?"
                ))
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        let pruefe = |erwartet: &'static str, aktiv: bool| {
            let pool = pool.clone();
            async move {
                for (id, name) in [(ef, erwartet), (adhoc, "Extern 1")] {
                    let liste = load_anzeige(&pool, einsatz, id, aktiv).await.unwrap();
                    assert_eq!(liste.funkrufname, name, "Fahrzeugliste, aktiv={aktiv}");
                    assert_eq!(ueber_sql(id).await, name, "SQL-Ausdruck, aktiv={aktiv}");
                }
            }
        };

        // Aktiver Einsatz, Fahrzeug in Dienst → Stamm.
        pruefe("Florian 1 NEU", true).await;
        // Außer Dienst → Snapshot.
        fz_repo::setze_dienststatus(&pool, 1, fz.id, false)
            .await
            .unwrap();
        pruefe("Florian 1", true).await;
        fz_repo::setze_dienststatus(&pool, 1, fz.id, true)
            .await
            .unwrap();
        // Abgeschlossener Einsatz → Snapshot.
        sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        pruefe("Florian 1", false).await;
    }

    /// LLH-1290: Wer nach einer Änderung im Stamm Bescheid bekommt: jede Disposition des
    /// Fahrzeugs in einem aktiven Einsatz der Org, mit Einheit und Raum; abgeschlossene Einsätze
    /// und fremde Orgs nicht.
    #[tokio::test]
    async fn aktive_dispositionen_nennt_einsatz_einheit_und_raum() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1"))
            .await
            .unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();
        let zweiter: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Zweite Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let ef2 = disponiere_stamm(&pool, zweiter, 1, fz.id, benutzer)
            .await
            .unwrap();
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Zug 1') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            aktive_dispositionen(&pool, 1, fz.id).await.unwrap(),
            vec![
                AktiveDisposition {
                    einsatz_id: einsatz,
                    ef_id: ef,
                    einheit_id: Some(einheit),
                    im_raum: false,
                },
                AktiveDisposition {
                    einsatz_id: zweiter,
                    ef_id: ef2,
                    einheit_id: None,
                    im_raum: false,
                },
            ]
        );

        // Die Einheit steht in einem Raum → `im_raum`.
        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, \
                                              geaendert_von) \
             VALUES (?, 'BR 1', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .bind(benutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_einheit SET aktueller_br_id = ? WHERE id = ?")
            .bind(br)
            .bind(einheit)
            .execute(&pool)
            .await
            .unwrap();
        // Der zweite Einsatz ist abgeschlossen; eine fremde Org kennt das Fahrzeug nicht.
        sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
            .bind(zweiter)
            .execute(&pool)
            .await
            .unwrap();
        let d = aktive_dispositionen(&pool, 1, fz.id).await.unwrap();
        assert_eq!(d.len(), 1);
        assert!(d[0].im_raum);
        assert!(aktive_dispositionen(&pool, 2, fz.id)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn aktualisiere_status_und_bemerkung_dann_entlassen() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1"))
            .await
            .unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();
        let neuer_status = status_repo::anlegen(
            &pool,
            1,
            StatusDaten {
                label: "vor_ort",
                kategorie: KATEGORIE_GEBUNDEN,
                farbe: None,
                fms_anker: Some(4),
                sortier: 40,
                zeitachse_marke: None,
            },
        )
        .await
        .unwrap();

        update(
            &pool,
            einsatz,
            ef,
            FahrzeugPatch {
                status_id: Some(neuer_status.id),
                bemerkung: Some(Some("am Einsatzort")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let a = load_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(a.status_id, Some(neuer_status.id));
        assert_eq!(a.bemerkung.as_deref(), Some("am Einsatzort"));

        // Nur Bemerkung ändern (status_id None → bleibt).
        update(
            &pool,
            einsatz,
            ef,
            FahrzeugPatch {
                bemerkung: Some(Some("korrigiert")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let b = load_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(b.status_id, Some(neuer_status.id), "Status unverändert");
        assert_eq!(b.bemerkung.as_deref(), Some("korrigiert"));

        entlasse(&pool, einsatz, ef, benutzer).await.unwrap();
        // Die Zeile bleibt (LLH-1079), fehlt aber in der Liste und nimmt keinen Status mehr an.
        let c = load_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(c.beendet_als.as_deref(), Some("entlassen"));
        assert_eq!(c.beendet_von, Some(benutzer));
        assert!(liste(&pool, einsatz, true).await.unwrap().is_empty());
        assert_eq!(
            list_entlassene(&pool, einsatz, true)
                .await
                .unwrap()
                .iter()
                .map(|a| a.id)
                .collect::<Vec<_>>(),
            [ef]
        );
        assert!(matches!(
            update(
                &pool,
                einsatz,
                ef,
                FahrzeugPatch {
                    status_id: Some(neuer_status.id),
                    ..Default::default()
                },
            )
            .await
            .unwrap_err(),
            AppError::Conflict(_)
        ));
        assert!(matches!(
            update_position(
                &pool,
                einsatz,
                ef,
                PositionPatch::default(),
                true,
                &Default::default()
            )
            .await
            .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    /// Soll-Besatzung aus dem Stamm: nur Stamm-Fahrzeuge mit vollständiger Soll-Stärke liefern
    /// `Some`, Ad-hoc-Fahrzeuge `None` — nicht 0/0/0 vortäuschen.
    #[tokio::test]
    async fn soll_besatzung_aus_stamm_staerke_adhoc_none() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let mut daten = fz_daten("Florian 1");
        daten.staerke = Some(Staerke::neu(0, 1, 8));
        let fz = fz_repo::anlegen(&pool, 1, daten).await.unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();
        assert_eq!(
            load_anzeige(&pool, einsatz, ef, true)
                .await
                .unwrap()
                .soll_besatzung,
            Some(Staerke::neu(0, 1, 8)),
        );

        let adhoc = disponiere_adhoc(
            &pool,
            einsatz,
            1,
            AdhocDaten {
                funkrufname: "Extern 1",
                fahrzeugtyp: None,
                kennzeichen: None,
                opta: None,
                traegerorganisation: None,
            },
            benutzer,
        )
        .await
        .unwrap();
        assert_eq!(
            load_anzeige(&pool, einsatz, adhoc, true)
                .await
                .unwrap()
                .soll_besatzung,
            None,
            "Ad-hoc-Fahrzeug hat keine Soll-Besatzung",
        );
    }

    /// Fahrzeug entlassen gibt die Besatzung frei (design.md D4); die Kraft bleibt als freie
    /// Kraft erhalten.
    #[tokio::test]
    async fn entlassen_gibt_besatzung_frei() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name, fahrzeug_id) VALUES (?, 'Crew', ?) RETURNING id",
        ).bind(einsatz).bind(ef).fetch_one(&pool).await.unwrap();

        let e = entlasse(&pool, einsatz, ef, 1).await.unwrap();
        assert_eq!(e.besatzung, [ep]);
        let fahrzeug_id: Option<i64> =
            sqlx::query_scalar("SELECT fahrzeug_id FROM einsatz_personal WHERE id = ?")
                .bind(ep)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(fahrzeug_id, None, "Besatzung wird frei, nicht gelöscht");
    }

    /// Ein als Auftrag-Empfänger referenziertes Fahrzeug entlassen: der Auftrag nennt es weiter
    /// (design.md D4, „Historie bleibt“).
    #[tokio::test]
    async fn entlassen_behaelt_auftrag_empfaenger() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let bn: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'L', 'l', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let ef: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let auftrag: i64 = sqlx::query_scalar(
            "INSERT INTO auftrag (einsatz_id, auftrag_text, erteilt_at, erstellt_von_id) \
             VALUES (?, 'X', '2026-07-17 10:00:00', ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(bn)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, fahrzeug_id, snap_anzeige) \
             VALUES (?, 'fahrzeug', ?, 'Florian 1')",
        )
        .bind(auftrag)
        .bind(ef)
        .execute(&pool)
        .await
        .unwrap();

        entlasse(&pool, einsatz, ef, bn)
            .await
            .expect("Fahrzeug entlassen darf nicht am FK scheitern");
        let emp: Option<i64> =
            sqlx::query_scalar("SELECT fahrzeug_id FROM auftrag_empfaenger WHERE auftrag_id = ?")
                .bind(auftrag)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            emp,
            Some(ef),
            "der Auftrag nennt das entlassene Fahrzeug weiter"
        );
        // Ein Auftrag ist eine Spur: das Fahrzeug ließe sich nicht stornieren.
    }

    /// LFH-733 (design.md D2): `ist_demo` folgt der Marke des Stamm-Fahrzeugs, unabhängig von
    /// der Live-oder-Snapshot-Regel; ein Ad-hoc-Fahrzeug ist nie Demo.
    #[tokio::test]
    async fn ist_demo_folgt_der_stamm_marke() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let demo = fz_repo::anlegen(&pool, 1, fz_daten("Florian Demo"))
            .await
            .unwrap();
        let echt = fz_repo::anlegen(&pool, 1, fz_daten("Florian Echt"))
            .await
            .unwrap();
        crate::demo::test_hilfen::demo_markieren(&pool, 1, "fahrzeug", demo.id).await;
        // Dieselbe ID unter den anderen Tabellen markiert: ohne den Filter `dh.tabelle`
        // meldete auch echt Demo.
        crate::demo::test_hilfen::demo_markieren(&pool, 1, "personal", echt.id).await;
        crate::demo::test_hilfen::demo_markieren(&pool, 1, "material", echt.id).await;
        // Erst das echte, dann das Demo-Stück disponieren: so trägt die Disposition des
        // Demo-Stücks eine andere ID als sein Stamm, und `datensatz_id = ef.id` statt
        // `ef.fahrzeug_id` fiele auf.
        let ef_echt = disponiere_stamm(&pool, einsatz, 1, echt.id, benutzer)
            .await
            .unwrap();
        let ef_adhoc = disponiere_adhoc(
            &pool,
            einsatz,
            1,
            AdhocDaten {
                funkrufname: "FW Extern",
                fahrzeugtyp: None,
                kennzeichen: None,
                opta: None,
                traegerorganisation: None,
            },
            benutzer,
        )
        .await
        .unwrap();
        let ef_demo = disponiere_stamm(&pool, einsatz, 1, demo.id, benutzer)
            .await
            .unwrap();
        assert_ne!(ef_demo, demo.id, "Vorbedingung: IDs entkoppelt");

        for einsatz_aktiv in [true, false] {
            let alle = liste(&pool, einsatz, einsatz_aktiv).await.unwrap();
            let marke = |id| alle.iter().find(|a| a.id == id).unwrap().ist_demo;
            assert!(marke(ef_demo), "einsatz_aktiv={einsatz_aktiv}");
            assert!(!marke(ef_echt), "einsatz_aktiv={einsatz_aktiv}");
            assert!(!marke(ef_adhoc), "einsatz_aktiv={einsatz_aktiv}");
        }
        assert!(
            load_anzeige(&pool, einsatz, ef_demo, true)
                .await
                .unwrap()
                .ist_demo
        );
    }

    // ── Lebenszustand (LLH-1079 Teil II) ──────────────────────────────────────────────

    const JETZT: &str = "2099-01-01 00:00:00";

    async fn entlasse(
        pool: &SqlitePool,
        einsatz: i64,
        ef: i64,
        benutzer: i64,
    ) -> Result<Entlassen, AppError> {
        let mut tx = pool.begin().await.unwrap();
        let e = entlassen_tx(&mut tx, einsatz, ef, benutzer, JETZT).await?;
        tx.commit().await.unwrap();
        Ok(e)
    }

    /// Storniert „jetzt“ (Uhrzeit der Datenbank), damit die Frist ab der Disposition läuft.
    async fn storniere(pool: &SqlitePool, einsatz: i64, ef: i64) -> Result<(), AppError> {
        let jetzt: String = sqlx::query_scalar("SELECT datetime('now')")
            .fetch_one(pool)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        stornieren_tx(&mut tx, einsatz, ef, 1, &jetzt).await?;
        tx.commit().await.unwrap();
        Ok(())
    }

    fn grund(e: AppError) -> String {
        match e {
            AppError::UnprocessableEntity(g) => g,
            e => panic!("422 erwartet, bekam {e:?}"),
        }
    }

    /// design.md D4: Entlassen löst Einheit, Bereitstellungsraum (mit Austritt) und die
    /// Führungsstelle; ein zweites Entlassen ist 409.
    #[tokio::test]
    async fn entlassen_loest_einheit_raum_und_fuehrungsstelle() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'BR Nord', 1, 1) RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = ?, aktueller_br_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(br)
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fuehrungsstelle_fahrzeug (einsatz_id, einsatz_fahrzeug_id) \
             VALUES (?, ?)",
        )
        .bind(einsatz)
        .bind(ef)
        .execute(&pool)
        .await
        .unwrap();

        let e = entlasse(&pool, einsatz, ef, 1).await.unwrap();
        assert_eq!(e.einheit, Some((einheit, "1. Zug".to_string())));
        assert_eq!(e.br_id, Some(br));
        assert!(e.trug_fuehrungsstelle);

        let (einheit_nach, br_nach): (Option<i64>, Option<i64>) =
            sqlx::query_as("SELECT einheit_id, aktueller_br_id FROM einsatz_fahrzeug WHERE id = ?")
                .bind(ef)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((einheit_nach, br_nach), (None, None));
        let austritt: (String, Option<String>) = sqlx::query_as(
            "SELECT art, notiz FROM br_belegung WHERE objekt_typ = 'fahrzeug' AND objekt_id = ?",
        )
        .bind(ef)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            austritt,
            ("austritt".into(), Some("Fahrzeug entlassen".into()))
        );
        let fs: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_fuehrungsstelle_fahrzeug WHERE einsatz_fahrzeug_id = ?",
        )
        .bind(ef)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(fs, 0);
        // Keine Zeitachse für Fahrzeuge (D5).
        let zeitachse: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_kraft_zeitachse")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(zeitachse, 0);

        assert!(matches!(
            entlasse(&pool, einsatz, ef, 1).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    /// design.md D7: Disponieren eines entlassenen Stamm-Fahrzeugs nimmt dieselbe Zeile wieder
    /// auf, mit neuem Initialstatus; erst das zweite Disponieren ist 409.
    #[tokio::test]
    async fn disponieren_nimmt_entlassenes_fahrzeug_wieder_auf() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1"))
            .await
            .unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();
        sqlx::query("UPDATE einsatz_fahrzeug SET status_id = NULL WHERE id = ?")
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();
        entlasse(&pool, einsatz, ef, benutzer).await.unwrap();

        let mut conn = pool.acquire().await.unwrap();
        let d = disponiere_stamm_tx(&mut conn, einsatz, 1, fz.id, benutzer)
            .await
            .unwrap();
        drop(conn);
        assert_eq!(
            d,
            Disponiert {
                id: ef,
                reaktiviert: true
            }
        );
        let a = load_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(a.beendet_at, None);
        assert_eq!(a.status_kategorie, Some(StatusKategorie::Gebunden));
        assert_eq!(a.status_seit.as_deref(), Some(a.disponiert_at.as_str()));
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        // `reaktivieren_tx` an einer aktiven Zeile ist 409, an einer fremden 404.
        let mut conn = pool.acquire().await.unwrap();
        assert!(matches!(
            reaktivieren_tx(&mut conn, einsatz, 1, ef, benutzer)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        assert!(matches!(
            reaktivieren_tx(&mut conn, einsatz + 1, 1, ef, benutzer)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }

    /// design.md D3: direkt nach dem Disponieren lässt sich ein Fahrzeug stornieren; es erscheint
    /// danach in keiner Liste und keinem Nachweis, und ein zweiter Storno ist 409.
    #[tokio::test]
    async fn storno_direkt_nach_der_disposition() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        storniere(&pool, einsatz, ef).await.unwrap();
        assert!(liste(&pool, einsatz, true).await.unwrap().is_empty());
        assert!(list_entlassene(&pool, einsatz, true)
            .await
            .unwrap()
            .is_empty());
        let a = load_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(a.beendet_als.as_deref(), Some("storniert"));
        assert!(matches!(
            storniere(&pool, einsatz, ef).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    /// design.md D3: jede Spur verhindert den Storno mit 422 und einem Satz, der den Ausweg nennt.
    #[tokio::test]
    async fn storno_mit_spur_ist_422() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        let setze = |sql: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query(sql).bind(ef).execute(&pool).await.unwrap();
            }
        };

        // Status gewechselt.
        setze("UPDATE einsatz_fahrzeug SET status_seit = '2000-01-01 00:00:00' WHERE id = ?").await;
        assert!(grund(storniere(&pool, einsatz, ef).await.unwrap_err())
            .starts_with("Der Status des Fahrzeugs hat sich seit der Disposition geändert"));
        setze("UPDATE einsatz_fahrzeug SET status_seit = disponiert_at WHERE id = ?").await;
        // Status in derselben Sekunde gewechselt: `status_seit` gleicht der Disposition, der
        // Status nicht mehr dem ersten `gebunden`.
        let initial: Option<i64> =
            sqlx::query_scalar("SELECT status_id FROM einsatz_fahrzeug WHERE id = ?")
                .bind(ef)
                .fetch_one(&pool)
                .await
                .unwrap();
        setze("UPDATE einsatz_fahrzeug SET status_id = NULL WHERE id = ?").await;
        assert!(grund(storniere(&pool, einsatz, ef).await.unwrap_err())
            .starts_with("Der Status des Fahrzeugs hat sich seit der Disposition geändert"));
        sqlx::query("UPDATE einsatz_fahrzeug SET status_id = ? WHERE id = ?")
            .bind(initial)
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();

        // Besatzung.
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name, fahrzeug_id) \
             VALUES (?, 'Crew', ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(ef)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            grund(storniere(&pool, einsatz, ef).await.unwrap_err()),
            "Das Fahrzeug hat eine Besatzung; erst lösen oder das Fahrzeug entlassen"
        );
        sqlx::query("UPDATE einsatz_personal SET fahrzeug_id = NULL WHERE id = ?")
            .bind(ep)
            .execute(&pool)
            .await
            .unwrap();

        // Führungsstelle.
        sqlx::query(
            "INSERT INTO einsatz_fuehrungsstelle_fahrzeug (einsatz_id, einsatz_fahrzeug_id) \
             VALUES (?, ?)",
        )
        .bind(einsatz)
        .bind(ef)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            grund(storniere(&pool, einsatz, ef).await.unwrap_err()),
            "Das Fahrzeug trägt die Führungsstelle; das Fahrzeug lässt sich entlassen"
        );
        setze("DELETE FROM einsatz_fuehrungsstelle_fahrzeug WHERE einsatz_fahrzeug_id = ?").await;

        // Frist abgelaufen.
        setze(
            "UPDATE einsatz_fahrzeug SET disponiert_at = datetime('now', '-20 minutes'), \
             status_seit = datetime('now', '-20 minutes') WHERE id = ?",
        )
        .await;
        assert!(grund(storniere(&pool, einsatz, ef).await.unwrap_err())
            .contains("nur in den ersten 15 Minuten nach der Disposition"));
    }

    /// Wer einmal entlassen war, lässt sich nach dem erneuten Disponieren nicht stornieren
    /// (Storno-Sperre, Migration 0195): sonst verschwände er aus dem Nachweis.
    #[tokio::test]
    async fn einmal_entlassen_sperrt_den_storno() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        entlasse(&pool, einsatz, ef, 1).await.unwrap();
        let mut conn = pool.acquire().await.unwrap();
        reaktivieren_tx(&mut conn, einsatz, 1, ef, 1).await.unwrap();
        drop(conn);
        assert!(grund(storniere(&pool, einsatz, ef).await.unwrap_err())
            .starts_with("Das Fahrzeug war schon einmal aus dem Einsatz entlassen"));
    }

    /// Ein Ad-hoc-Fahrzeug kehrt über `reaktivieren_tx` zurück (Block „Entlassen“, D7).
    #[tokio::test]
    async fn adhoc_fahrzeug_wird_reaktiviert() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let ef = disponiere_adhoc(
            &pool,
            einsatz,
            1,
            AdhocDaten {
                funkrufname: "FW Extern",
                fahrzeugtyp: None,
                kennzeichen: None,
                opta: None,
                traegerorganisation: None,
            },
            benutzer,
        )
        .await
        .unwrap();
        entlasse(&pool, einsatz, ef, benutzer).await.unwrap();
        let mut conn = pool.acquire().await.unwrap();
        reaktivieren_tx(&mut conn, einsatz, 1, ef, benutzer)
            .await
            .unwrap();
        drop(conn);
        let a = load_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(a.beendet_als, None);
        assert_eq!(a.funkrufname, "FW Extern");
        assert_eq!(liste(&pool, einsatz, true).await.unwrap().len(), 1);
    }

    /// Der zweite Versuch, der hinter `require_aktiv_tx` durchrutscht (gleichzeitig), trifft im
    /// UPDATE keine Zeile mehr: 409 mit dem Wortlaut „bereits entlassen“.
    #[tokio::test]
    async fn set_beendet_zweimal_ist_409_bereits_entlassen() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let ef = disponiere_adhoc(
            &pool,
            einsatz,
            1,
            AdhocDaten {
                funkrufname: "FW Extern",
                fahrzeugtyp: None,
                kennzeichen: None,
                opta: None,
                traegerorganisation: None,
            },
            benutzer,
        )
        .await
        .unwrap();
        entlasse(&pool, einsatz, ef, benutzer).await.unwrap();
        let mut conn = pool.acquire().await.unwrap();
        let e = set_beendet_tx(
            &mut conn,
            einsatz,
            ef,
            benutzer,
            JETZT,
            BeendetAls::Entlassen,
        )
        .await
        .unwrap_err();
        assert!(
            matches!(&e, AppError::Conflict(m) if m == "Das Fahrzeug ist bereits entlassen"),
            "{e:?}"
        );
    }

    // ── Rücknahme der Entlassung (LLH-1722, Spec `kraefte-entlassung`) ─────────────────────

    const RUECK_JETZT: &str = "2099-01-01 00:05:00";

    fn alle_rechte() -> RuecknahmeRechte {
        RuecknahmeRechte {
            einheiten: true,
            material: true,
            bereitstellungsraeume: true,
        }
    }

    async fn nimm_zurueck(
        pool: &SqlitePool,
        einsatz: i64,
        ef: i64,
        benutzer: i64,
        jetzt: &str,
        vorzustand: &crate::fahrzeug::EntlassungVorzustand,
        rechte: RuecknahmeRechte,
    ) -> Result<Ruecknahme, AppError> {
        let mut tx = pool.begin().await.unwrap();
        let r = zuruecknehmen_tx(&mut tx, einsatz, ef, benutzer, jetzt, vorzustand, rechte).await?;
        tx.commit().await.unwrap();
        Ok(r)
    }

    /// Ein Fahrzeug auf einem eigenen Status, in einer Einheit, mit Besatzung, Führungsstelle
    /// und einem geladenen Posten; liefert (einsatz, ef, einheit, ep, em, status_id).
    async fn seed_voll(pool: &SqlitePool) -> (i64, i64, i64, i64, i64, i64) {
        let (einsatz, ef) = seed_fahrzeug(pool).await;
        let s2 = status_repo::anlegen(
            pool,
            1,
            StatusDaten {
                label: "frei über Funk",
                kategorie: KATEGORIE_GEBUNDEN,
                farbe: None,
                fms_anker: Some(2),
                sortier: 10,
                zeitachse_marke: None,
            },
        )
        .await
        .unwrap();
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE einsatz_fahrzeug SET einheit_id = ?, status_id = ?, \
                 status_seit = '2098-12-31 23:15:00' WHERE id = ?",
        )
        .bind(einheit)
        .bind(s2.id)
        .bind(ef)
        .execute(pool)
        .await
        .unwrap();
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name, fahrzeug_id, einheit_id) \
             VALUES (?, 'Anna Müller', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(ef)
        .bind(einheit)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fuehrungsstelle_fahrzeug (einsatz_id, einsatz_fahrzeug_id) \
             VALUES (?, ?)",
        )
        .bind(einsatz)
        .bind(ef)
        .execute(pool)
        .await
        .unwrap();
        let em: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, art, menge, \
                einsatz_fahrzeug_id) VALUES (?, 'Stromerzeuger', 'geraet', 1, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(ef)
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz, ef, einheit, ep, em, s2.id)
    }

    /// Die Momentaufnahme eines Fahrzeugs, die „im selben Zustand wie vorher“ ausmacht.
    async fn stand(
        pool: &SqlitePool,
        ef: i64,
    ) -> (
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        Option<String>,
    ) {
        sqlx::query_as(
            "SELECT status_id, status_seit, einheit_id, aktueller_br_id, beendet_at, \
                    zuletzt_entlassen_at FROM einsatz_fahrzeug WHERE id = ?",
        )
        .bind(ef)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn entlassen_liefert_den_vorzustand() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef, einheit, ep, em, _) = seed_voll(&pool).await;
        let e = entlasse(&pool, einsatz, ef, 1).await.unwrap();
        assert_eq!(
            e.vorzustand(JETZT),
            crate::fahrzeug::EntlassungVorzustand {
                entlassen_at: JETZT.into(),
                einheit_id: Some(einheit),
                br_id: None,
                fuehrungsstelle: true,
                besatzung: vec![ep],
                beladung: vec![em],
            }
        );
    }

    #[tokio::test]
    async fn entlassen_und_zuruecknehmen_ergibt_denselben_zustand() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef, _, ep, em, _) = seed_voll(&pool).await;
        let vorher = stand(&pool, ef).await;
        let v = entlasse(&pool, einsatz, ef, 1)
            .await
            .unwrap()
            .vorzustand(JETZT);
        let r = nimm_zurueck(&pool, einsatz, ef, 1, RUECK_JETZT, &v, alle_rechte())
            .await
            .unwrap();
        assert!(r.ausgelassen.is_empty(), "{:?}", r.ausgelassen);
        let nachher = stand(&pool, ef).await;
        assert_eq!(
            (&nachher.0, &nachher.1, nachher.2, nachher.3, &nachher.4),
            (&vorher.0, &vorher.1, vorher.2, vorher.3, &vorher.4)
        );
        assert_eq!(nachher.5.as_deref(), Some(JETZT), "Storno-Sperre bleibt");
        let auf: Option<i64> =
            sqlx::query_scalar("SELECT fahrzeug_id FROM einsatz_personal WHERE id = ?")
                .bind(ep)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(auf, Some(ef));
        let geladen: Option<i64> =
            sqlx::query_scalar("SELECT einsatz_fahrzeug_id FROM einsatz_material WHERE id = ?")
                .bind(em)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(geladen, Some(ef));
        assert!(crate::einsatz::fuehrungsstelle::traegt_fahrzeug_tx(
            &mut pool.acquire().await.unwrap(),
            ef
        )
        .await
        .unwrap());
        // Ein zweites Rücknehmen trifft ein aktives Fahrzeug: 409.
        assert!(matches!(
            nimm_zurueck(&pool, einsatz, ef, 1, RUECK_JETZT, &v, alle_rechte())
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn ruecknahme_bucht_den_raum_wieder_ein() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, geaendert_von, status) \
             VALUES (?, 'BR Nord', 1, 1, 'aktiv') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_fahrzeug SET aktueller_br_id = ? WHERE id = ?")
            .bind(br)
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();
        let v = entlasse(&pool, einsatz, ef, 1)
            .await
            .unwrap()
            .vorzustand(JETZT);
        let r = nimm_zurueck(&pool, einsatz, ef, 1, RUECK_JETZT, &v, alle_rechte())
            .await
            .unwrap();
        assert_eq!(r.br_id, Some(br));
        assert_eq!(stand(&pool, ef).await.3, Some(br));
        let letzte: (String, Option<String>) = sqlx::query_as(
            "SELECT art, notiz FROM br_belegung WHERE objekt_typ = 'fahrzeug' AND objekt_id = ? \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(ef)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            letzte,
            ("eintritt".into(), Some("Entlassung zurückgenommen".into()))
        );
    }

    #[tokio::test]
    async fn ruecknahme_ohne_raum_recht_nennt_den_raum_nicht() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, geaendert_von, status) \
             VALUES (?, 'BR Nord', 1, 1, 'aktiv') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_fahrzeug SET aktueller_br_id = ? WHERE id = ?")
            .bind(br)
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();
        let v = entlasse(&pool, einsatz, ef, 1)
            .await
            .unwrap()
            .vorzustand(JETZT);
        let r = nimm_zurueck(
            &pool,
            einsatz,
            ef,
            1,
            RUECK_JETZT,
            &v,
            RuecknahmeRechte {
                einheiten: true,
                material: true,
                bereitstellungsraeume: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(r.br_id, None);
        assert_eq!(stand(&pool, ef).await.3, None);
        assert_eq!(
            r.ausgelassen,
            [ausgelassen(
                "Bereitstellungsraum",
                "kein Schreibrecht im Modul Bereitstellungsräume"
            )]
        );
    }

    #[tokio::test]
    async fn ruecknahme_laesst_veraendertes_aus_und_nennt_es() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef, einheit, ep, em, _) = seed_voll(&pool).await;
        let v = entlasse(&pool, einsatz, ef, 1)
            .await
            .unwrap()
            .vorzustand(JETZT);
        // Inzwischen: Einheit aufgelöst, Person auf einem anderen Fahrzeug, Posten an einer UHS.
        let anderes: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, '83-2') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_personal SET fahrzeug_id = ? WHERE id = ?")
            .bind(anderes)
            .bind(ep)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE einsatz_einheit SET aufgeloest_at = '2099-01-01 00:01:00' WHERE id = ?",
        )
        .bind(einheit)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_material SET beendet_at = '2099-01-01 00:02:00', beendet_als = 'entlassen' WHERE id = ?")
            .bind(em)
            .execute(&pool)
            .await
            .unwrap();
        let r = nimm_zurueck(&pool, einsatz, ef, 1, RUECK_JETZT, &v, alle_rechte())
            .await
            .unwrap();
        let namen: Vec<&str> = r
            .ausgelassen
            .iter()
            .map(|a| a.bezeichnung.as_str())
            .collect();
        assert_eq!(namen, ["Einheit «1. Zug»", "Anna Müller", "Stromerzeuger"]);
        let s = stand(&pool, ef).await;
        assert_eq!((s.2, s.4), (None, None), "aktiv, ohne Einheit");
        let auf: Option<i64> =
            sqlx::query_scalar("SELECT fahrzeug_id FROM einsatz_personal WHERE id = ?")
                .bind(ep)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            auf,
            Some(anderes),
            "die Person bleibt, wo sie inzwischen sitzt"
        );
    }

    #[tokio::test]
    async fn ruecknahme_ohne_recht_laesst_den_teil_aus() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef, _, _, em, _) = seed_voll(&pool).await;
        let v = entlasse(&pool, einsatz, ef, 1)
            .await
            .unwrap()
            .vorzustand(JETZT);
        let r = nimm_zurueck(
            &pool,
            einsatz,
            ef,
            1,
            RUECK_JETZT,
            &v,
            RuecknahmeRechte {
                einheiten: false,
                material: false,
                bereitstellungsraeume: true,
            },
        )
        .await
        .unwrap();
        let teile: Vec<(&str, &str)> = r
            .ausgelassen
            .iter()
            .map(|a| (a.bezeichnung.as_str(), a.grund.as_str()))
            .collect();
        // Ohne Recht kein Name aus dem fremden Modul (LLH-1951), nur die allgemeine Bezeichnung.
        assert_eq!(
            teile,
            [
                ("Einheit", "kein Schreibrecht im Modul Einheiten"),
                ("Beladung (1 Posten)", "kein Schreibrecht im Modul Material")
            ]
        );
        assert_eq!(stand(&pool, ef).await.2, None);
        let geladen: Option<i64> =
            sqlx::query_scalar("SELECT einsatz_fahrzeug_id FROM einsatz_material WHERE id = ?")
                .bind(em)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(geladen, None);
    }

    #[tokio::test]
    async fn ruecknahme_nur_direkt_nach_dem_entlassen_und_nur_fuer_die_entlassende_person() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef, ..) = seed_voll(&pool).await;
        let v = entlasse(&pool, einsatz, ef, 1)
            .await
            .unwrap()
            .vorzustand(JETZT);
        // Andere Person.
        assert!(matches!(
            nimm_zurueck(&pool, einsatz, ef, 2, RUECK_JETZT, &v, alle_rechte())
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        // Nach zehn Minuten.
        assert!(matches!(
            nimm_zurueck(
                &pool,
                einsatz,
                ef,
                1,
                "2099-01-01 00:10:01",
                &v,
                alle_rechte()
            )
            .await
            .unwrap_err(),
            AppError::Conflict(_)
        ));
        // Ein anderes Entlassen (andere Kennung).
        let fremd = crate::fahrzeug::EntlassungVorzustand {
            entlassen_at: "2098-12-31 23:59:00".into(),
            ..v.clone()
        };
        assert!(matches!(
            nimm_zurueck(&pool, einsatz, ef, 1, RUECK_JETZT, &fremd, alle_rechte())
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        // Schon erneut disponiert.
        let mut tx = pool.begin().await.unwrap();
        reaktivieren_tx(&mut tx, einsatz, 1, ef, 1).await.unwrap();
        tx.commit().await.unwrap();
        assert!(matches!(
            nimm_zurueck(&pool, einsatz, ef, 1, RUECK_JETZT, &v, alle_rechte())
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn ruecknahme_laesst_die_storno_sperre_stehen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        let v = entlasse(&pool, einsatz, ef, 1)
            .await
            .unwrap()
            .vorzustand(JETZT);
        nimm_zurueck(&pool, einsatz, ef, 1, RUECK_JETZT, &v, alle_rechte())
            .await
            .unwrap();
        // Wer einmal entlassen war, war im Einsatz; der Body kann die Sperre nicht aufheben,
        // auch nicht mit einem gefälschten `"zuletzt_entlassen_at": null`.
        assert_eq!(stand(&pool, ef).await.5.as_deref(), Some(JETZT));
        let hindernis =
            find_storno_hindernis_tx(&mut pool.acquire().await.unwrap(), einsatz, ef, RUECK_JETZT)
                .await
                .unwrap();
        assert!(hindernis.is_some(), "Storno bleibt gesperrt");
    }

    #[tokio::test]
    async fn ruecknahme_nennt_eine_geloeschte_einheit() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        let v = entlasse(&pool, einsatz, ef, 1)
            .await
            .unwrap()
            .vorzustand(JETZT);
        // Spurlos aufgelöst: `aufloesen_tx` löscht die Zeile, die Kennung trifft nichts mehr.
        let v = crate::fahrzeug::EntlassungVorzustand {
            einheit_id: Some(i64::MAX),
            ..v
        };
        let r = nimm_zurueck(&pool, einsatz, ef, 1, RUECK_JETZT, &v, alle_rechte())
            .await
            .unwrap();
        assert_eq!(
            r.ausgelassen,
            [crate::fahrzeug::RuecknahmeAusgelassen {
                bezeichnung: "Einheit".into(),
                grund: "nicht mehr vorhanden".into(),
            }]
        );
    }

    /// LLH-1949: eine spurlos aufgelöste Einheit ist gelöscht, ihre ID kann an eine danach
    /// gebildete Einheit gehen (`einsatz_einheit.id` ohne AUTOINCREMENT). Das Fahrzeug kommt dann
    /// ohne Einheit zurück, und `ausgelassen` nennt keinen fremden Namen.
    #[tokio::test]
    async fn ruecknahme_nimmt_keine_neue_einheit_mit_der_alten_id() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ef) = seed_fahrzeug(&pool).await;
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();
        let v = entlasse(&pool, einsatz, ef, 1)
            .await
            .unwrap()
            .vorzustand(JETZT);
        assert_eq!(v.einheit_id, Some(einheit));
        sqlx::query("DELETE FROM einsatz_einheit WHERE id = ?")
            .bind(einheit)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_einheit (id, einsatz_id, name, angelegt_at) \
             VALUES (?, ?, 'Trupp B', '2099-01-01 00:01:00')",
        )
        .bind(einheit)
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();

        let r = nimm_zurueck(&pool, einsatz, ef, 1, RUECK_JETZT, &v, alle_rechte())
            .await
            .unwrap();
        assert_eq!(r.einheit_id, None);
        assert_eq!(
            r.ausgelassen,
            [crate::fahrzeug::RuecknahmeAusgelassen {
                bezeichnung: "Einheit".into(),
                grund: "nicht mehr vorhanden".into(),
            }]
        );
        let (einheit_jetzt, beendet): (Option<i64>, Option<String>) =
            sqlx::query_as("SELECT einheit_id, beendet_at FROM einsatz_fahrzeug WHERE id = ?")
                .bind(ef)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((einheit_jetzt, beendet), (None, None));
    }
}

/// Ergebnis der Rücknahme eines Statuswechsels: für die Live-Meldungen nach dem Commit.
#[derive(Debug, Default)]
pub struct StatusRuecknahme {
    pub einheit_id: Option<i64>,
    pub beruehrt: crate::zeitachse::repo::Beruehrt,
}

/// Merkt das Zeitachsen-Ereignis, das ein Statuswechsel geschrieben hat (LLH-1781, design.md D8),
/// in der Transaktion des Wechsels.
pub async fn merke_status_ereignis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    ereignis_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET status_ereignis_id = ? WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ereignis_id)
    .bind(ef_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Nimmt einen Statuswechsel zurück (LLH-1781, Spec `fahrzeugstatus-quittung`, Change
/// `eon26eat-status-und-bedienung`, design.md D8), in der Transaktion des Aufrufers.
///
/// Was wiederhergestellt wird (Status und „seit“ davor, das Ereignis des Wechsels), hält der
/// Server selbst fest; vom Client zählen nur `status_id` und `status_seit` als Prüfwerte.
/// Riegel: das Fahrzeug ist aktiv und steht noch auf diesem Wechsel (sonst `Veraltet`),
/// `benutzer_id` hat gewechselt, und höchstens [`crate::entlassung::RUECKNAHME_FRIST_MINUTEN`]
/// sind vergangen (sonst `Conflict`). Bräche das Streichen die Ordnung der Zeitachse, ist es
/// ebenfalls `Conflict`, und der Aufrufer rollt alles zurück. Ein inzwischen schon gestrichenes
/// Ereignis bleibt, wie es ist.
pub async fn status_zuruecknehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    benutzer_id: i64,
    jetzt: &str,
    beleg: &crate::fahrzeug::StatusRuecknahmeBeleg,
) -> Result<StatusRuecknahme, AppError> {
    require_aktiv_tx(conn, einsatz_id, ef_id).await?;
    type Zeile = (
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<i64>,
    );
    let zeile: Option<Zeile> = sqlx::query_as(
        "SELECT status_id, status_seit, status_gesetzt_von, status_vorher_id, \
                status_vorher_seit, status_ereignis_id, einheit_id \
         FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (status_id, status_seit, gesetzt_von, vorher_id, vorher_seit, ereignis, einheit_id) =
        zeile.ok_or(AppError::NotFound)?;
    // Inzwischen anders gesetzt: ein CAS-Konflikt (`src/AGENTS.md`, Statuscode-Konvention).
    crate::status_ruecknahme::pruefe(
        &crate::status_ruecknahme::Gemerkt {
            status: status_id,
            kennung: status_seit,
            gesetzt_von,
        },
        &Some(beleg.status_id),
        &beleg.status_seit,
        benutzer_id,
        jetzt,
    )?;

    let mut ergebnis = StatusRuecknahme {
        einheit_id,
        ..Default::default()
    };
    if let Some(eid) = einheit_id {
        ergebnis.beruehrt = crate::status_ruecknahme::streiche_ereignis_tx(
            conn,
            einsatz_id,
            benutzer_id,
            crate::zeitachse::repo::Kraft::Einheit(eid),
            ereignis,
        )
        .await?;
    }

    let r = sqlx::query(
        "UPDATE einsatz_fahrzeug SET status_id = ?, status_seit = ?, status_gesetzt_von = NULL, \
                status_vorher_id = NULL, status_vorher_seit = NULL, status_ereignis_id = NULL \
         WHERE id = ? AND einsatz_id = ? AND status_id = ? AND status_seit = ?",
    )
    .bind(vorher_id)
    .bind(vorher_seit.as_deref())
    .bind(ef_id)
    .bind(einsatz_id)
    .bind(beleg.status_id)
    .bind(&beleg.status_seit)
    .execute(&mut *conn)
    .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::Veraltet);
    }
    Ok(ergebnis)
}
