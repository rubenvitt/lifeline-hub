use super::ort::{self, MaterialOrt, OrtPatch};
use super::{
    check_zeile, EinsatzMaterialAnzeige, MaterialArt, MaterialStatus, DIENSTSTATUS_IN_DIENST,
    GERAET_JE_STUECK,
};
use crate::entlassung::BeendetAls;
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

/// SELECT mit aufgelöster Live-Identität (LEFT JOIN material). Der Status ist ein festes Enum
/// auf der Zeile, kein Katalog-JOIN. Live oder Snapshot wählt `zu_anzeige`. `ist_demo` liest die
/// Demo-Marke des Stamm-Materials live (LFH-733, design.md D2); ad-hoc findet keine Marke.
const SELECT_AUFGELOEST: &str = "\
    SELECT em.id, em.einsatz_id, em.material_id, em.einheit_id, em.uhs_id, em.menge, em.status, \
           em.snap_bezeichnung, em.snap_kategorie, em.snap_bestandsnummer, \
           em.snap_traegerorganisation, em.bemerkung, em.disponiert_at, em.disponiert_von, \
           em.beendet_at, em.beendet_von, em.beendet_als, \
           em.art, em.ausgegeben, em.einsatz_fahrzeug_id, em.br_id, em.nachforderung_id, \
           m.bezeichnung AS live_bezeichnung, m.kategorie AS live_kategorie, \
           m.bestandsnummer AS live_bestandsnummer, m.traegerorganisation AS live_traegerorganisation, \
           m.dienststatus AS live_dienststatus, \
           EXISTS(SELECT 1 FROM demo_herkunft dh \
                  WHERE dh.tabelle = 'material' AND dh.datensatz_id = em.material_id) AS ist_demo \
    FROM einsatz_material em \
    LEFT JOIN material m ON m.id = em.material_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    material_id: Option<i64>,
    einheit_id: Option<i64>,
    uhs_id: Option<i64>,
    menge: i64,
    #[sqlx(try_from = "String")]
    status: MaterialStatus,
    snap_bezeichnung: String,
    snap_kategorie: Option<String>,
    snap_bestandsnummer: Option<String>,
    snap_traegerorganisation: Option<String>,
    bemerkung: Option<String>,
    disponiert_at: String,
    disponiert_von: Option<i64>,
    beendet_at: Option<String>,
    beendet_von: Option<i64>,
    beendet_als: Option<String>,
    #[sqlx(try_from = "String")]
    art: MaterialArt,
    ausgegeben: i64,
    einsatz_fahrzeug_id: Option<i64>,
    br_id: Option<i64>,
    nachforderung_id: Option<i64>,
    live_bezeichnung: Option<String>,
    live_kategorie: Option<String>,
    live_bestandsnummer: Option<String>,
    live_traegerorganisation: Option<String>,
    live_dienststatus: Option<String>,
    /// LFH-733: Demo-Marke des Stamm-Datensatzes (D2), bei Ad-hoc ohne Treffer und damit `false`.
    ist_demo: bool,
}

/// Auflösungsregel: Live-Felder nur mit Stamm-Bezug, aktivem Einsatz UND Material in Dienst,
/// sonst Snapshot. `menge`/`status` kommen immer aus der Dispositionszeile.
fn zu_anzeige(row: Row, einsatz_aktiv: bool) -> EinsatzMaterialAnzeige {
    let live = row.material_id.is_some()
        && einsatz_aktiv
        && row.live_dienststatus.as_deref() == Some(DIENSTSTATUS_IN_DIENST);

    let (bezeichnung, kategorie, bestandsnummer, traeger) = if live {
        (
            row.live_bezeichnung
                .clone()
                .unwrap_or_else(|| row.snap_bezeichnung.clone()),
            row.live_kategorie,
            row.live_bestandsnummer,
            row.live_traegerorganisation,
        )
    } else {
        (
            row.snap_bezeichnung,
            row.snap_kategorie,
            row.snap_bestandsnummer,
            row.snap_traegerorganisation,
        )
    };

    EinsatzMaterialAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        material_id: row.material_id,
        einheit_id: row.einheit_id,
        uhs_id: row.uhs_id,
        einsatz_fahrzeug_id: row.einsatz_fahrzeug_id,
        br_id: row.br_id,
        art: row.art,
        ist_adhoc: row.material_id.is_none(),
        bezeichnung,
        kategorie,
        bestandsnummer,
        traegerorganisation: traeger,
        menge: row.menge,
        ausgegeben: row.ausgegeben,
        status: row.status,
        bemerkung: row.bemerkung,
        disponiert_at: row.disponiert_at,
        disponiert_von: row.disponiert_von,
        ist_demo: row.ist_demo,
        beendet_at: row.beendet_at,
        beendet_von: row.beendet_von,
        beendet_als: row.beendet_als,
        nachforderung_id: row.nachforderung_id,
    }
}

/// Daten für Ad-hoc-externes Material; bereits getrimmt. `Copy`, damit ein Dispatch-Enum sie im
/// Retry-Loop von [`crate::write_retry!`] je Versuch kopieren kann.
#[derive(Debug, Clone, Copy)]
pub struct AdhocDaten<'a> {
    pub bezeichnung: &'a str,
    pub kategorie: Option<&'a str>,
    pub bestandsnummer: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
}

/// Aktives Material eines Einsatzes (aufgelöst), sortiert nach Dispo-Zeit. Herausgenommenes
/// und storniertes fehlt (LLH-1079, Spec `kraefte-entlassung`).
pub async fn list(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzMaterialAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE em.einsatz_id = ? AND em.beendet_at IS NULL \
         ORDER BY em.disponiert_at, em.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| zu_anzeige(r, einsatz_aktiv))
        .collect())
}

/// Aus dem Einsatz genommenes Material (aufgelöst), zuletzt herausgenommenes zuerst — der
/// Nachweis hinter `GET …/material?entlassene=1` (LLH-1079). Storniertes erscheint nie.
pub async fn list_entlassene(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzMaterialAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE em.einsatz_id = ? AND em.beendet_als = 'entlassen' \
         ORDER BY em.beendet_at DESC, em.id DESC"
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
    em_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzMaterialAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE em.id = ? AND em.einsatz_id = ?"
    )))
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Wie [`load_anzeige`], auf einer offenen Verbindung — für ETB-Text und Response aus EINER
/// Transaktion beim atomaren Disponieren/Aktualisieren.
pub async fn load_anzeige_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzMaterialAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE em.id = ? AND em.einsatz_id = ?"
    )))
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Disponiert Stamm-Material mit Menge: prüft Org und Dienststatus, friert den
/// Identitäts-Snapshot ein und kopiert die Art des Stamms an die Zeile (LLH-1224, design.md D1).
/// `NotFound` bei fremdem/unbekanntem Material, `UnprocessableEntity` bei außer Dienst und bei
/// einem Gerät mit Menge über 1 (D2). Mehrfach-Disposition ist erlaubt. `nachforderung_id` ist der
/// vom Aufrufer geprüfte Bezug einer Übernahme (LLH-1226). Liefert die `em_id`.
pub async fn disponiere_stamm_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    material_id: i64,
    menge: i64,
    disponiert_von: i64,
    nachforderung_id: Option<i64>,
) -> Result<i64, AppError> {
    let ((bezeichnung, kategorie, bestandsnummer, traeger), art) =
        stamm_snapshot_tx(conn, org_id, material_id).await?;
    check_zeile(art, menge, 0, MaterialStatus::Einsatzbereit, false)?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_material \
            (einsatz_id, material_id, menge, art, snap_bezeichnung, snap_kategorie, \
             snap_bestandsnummer, snap_traegerorganisation, disponiert_von, nachforderung_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(material_id)
    .bind(menge)
    .bind(art.as_str())
    .bind(&bezeichnung)
    .bind(&kategorie)
    .bind(&bestandsnummer)
    .bind(&traeger)
    .bind(disponiert_von)
    .bind(nachforderung_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Identitäts-Snapshot eines Stamm-Materials: Bezeichnung, Kategorie, Bestandsnummer, Träger.
type Snapshot = (String, Option<String>, Option<String>, Option<String>);

/// Snapshot und Art eines Stamm-Materials der Org; `NotFound` bei fremdem/unbekanntem,
/// `UnprocessableEntity` bei außer Dienst.
async fn stamm_snapshot_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    material_id: i64,
) -> Result<(Snapshot, MaterialArt), AppError> {
    let (bezeichnung, kategorie, bestandsnummer, traeger, dienststatus, art) = sqlx::query_as::<
        _,
        (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            String,
        ),
    >(
        "SELECT bezeichnung, kategorie, bestandsnummer, traegerorganisation, dienststatus, art \
         FROM material WHERE id = ? AND org_id = ?",
    )
    .bind(material_id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if dienststatus != DIENSTSTATUS_IN_DIENST {
        // Ein Zustand, also 422 wie bei Person und Fahrzeug (`src/AGENTS.md`,
        // Statuscode-Konvention; bis LLH-1079 Teil II war es 400).
        return Err(AppError::UnprocessableEntity(
            "Material ist außer Dienst und kann nicht disponiert werden".into(),
        ));
    }
    let art = MaterialArt::try_from(art).map_err(AppError::Internal)?;
    Ok(((bezeichnung, kategorie, bestandsnummer, traeger), art))
}

/// Pool-Wrapper um [`disponiere_stamm_tx`].
pub async fn disponiere_stamm(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    material_id: i64,
    menge: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let mut conn = pool.acquire().await?;
    disponiere_stamm_tx(
        &mut conn,
        einsatz_id,
        org_id,
        material_id,
        menge,
        disponiert_von,
        None,
    )
    .await
}

/// Disponiert Ad-hoc-externes Material (`material_id = NULL`); `snap_*` sind die
/// eigentlichen Daten. Ohne Art gilt die Vorgabe aus der Menge (LLH-1224, design.md D1); ein
/// Gerät mit Menge über 1 ist `UnprocessableEntity` (D2). `nachforderung_id` ist der vom Aufrufer
/// geprüfte Bezug einer Übernahme (LLH-1226). Liefert die neue `em_id`.
pub async fn disponiere_adhoc_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    daten: AdhocDaten<'_>,
    art: Option<MaterialArt>,
    menge: i64,
    disponiert_von: i64,
    nachforderung_id: Option<i64>,
) -> Result<i64, AppError> {
    let art = art.unwrap_or(MaterialArt::from_menge(menge));
    check_zeile(art, menge, 0, MaterialStatus::Einsatzbereit, false)?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_material \
            (einsatz_id, material_id, menge, art, snap_bezeichnung, snap_kategorie, \
             snap_bestandsnummer, snap_traegerorganisation, disponiert_von, nachforderung_id) \
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(menge)
    .bind(art.as_str())
    .bind(daten.bezeichnung)
    .bind(daten.kategorie)
    .bind(daten.bestandsnummer)
    .bind(daten.traegerorganisation)
    .bind(disponiert_von)
    .bind(nachforderung_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Pool-Wrapper um [`disponiere_adhoc_tx`].
pub async fn disponiere_adhoc(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: AdhocDaten<'_>,
    art: Option<MaterialArt>,
    menge: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let mut conn = pool.acquire().await?;
    disponiere_adhoc_tx(
        &mut conn,
        einsatz_id,
        daten,
        art,
        menge,
        disponiert_von,
        None,
    )
    .await
}

/// Änderungen an einer Dispositionszeile (PATCH), schon getrimmt und geprüft in der Route.
/// `menge`, `ausgegeben`, `status`, `art` und `bezeichnung`: `None` = unverändert. Die übrigen
/// Felder sind Tri-State: `None` = unverändert, `Some(None)` = NULL, `Some(Some(x))` = setzen.
/// Ein Struct statt Positionsparametern, damit eine neue Angabe keine Bindung still verschiebt.
#[derive(Debug, Default, Clone, Copy)]
pub struct MaterialPatch<'a> {
    pub menge: Option<i64>,
    /// Ausgegebene Menge als neuer Gesamtwert (LLH-1224, design.md D4), ≥ 0 prüft die Route.
    pub ausgegeben: Option<i64>,
    pub status: Option<MaterialStatus>,
    /// Art der Zeile (LLH-1224, design.md D10); die Stamm-Art bleibt.
    pub art: Option<MaterialArt>,
    pub bemerkung: Option<Option<&'a str>>,
    /// Der eine Ort (LLH-1224, design.md D7): ein neues Ziel geht durch
    /// [`ort::require_ziel_tx`], geschrieben über [`ort::set_ort_tx`].
    pub ort: OrtPatch,
    /// Ad-hoc-Angaben (LLH-1093, design.md D6): nur an einer Zeile ohne Stamm-Bezug, sonst 422.
    /// Sie schreiben die `snap_*`-Spalten, die bei Ad-hoc-Material die Daten sind.
    pub bezeichnung: Option<&'a str>,
    pub kategorie: Option<Option<&'a str>>,
    pub bestandsnummer: Option<Option<&'a str>>,
    pub traegerorganisation: Option<Option<&'a str>>,
}

impl MaterialPatch<'_> {
    /// Ändert der Patch eine Angabe, die bei einem Stamm-Posten der Stamm trägt?
    pub fn has_adhoc_angaben(&self) -> bool {
        self.bezeichnung.is_some()
            || self.kategorie.is_some()
            || self.bestandsnummer.is_some()
            || self.traegerorganisation.is_some()
    }
}

/// Der 422 an einem Stamm-Posten, dessen Bezeichnung, Kategorie, Bestandsnummer oder Träger über
/// den Einsatz geändert werden soll (LLH-1093, design.md D6).
pub fn stamm_angaben_error() -> AppError {
    AppError::UnprocessableEntity("Angaben eines Stamm-Postens im Stamm pflegen".into())
}

/// Aktualisiert eine Dispositionszeile nach [`MaterialPatch`]. `NotFound`, falls die Zeile nicht
/// zum Einsatz gehört, `Conflict` an beendetem Material (LLH-1079), `UnprocessableEntity` bei
/// Ad-hoc-Angaben an einem Stamm-Posten und wenn die Ergebniszeile gegen Art, Menge, Ausgabe oder
/// Status verstößt ([`check_zeile`], LLH-1224); die Prüfung des Orts (404/409/422) läuft nur bei
/// geändertem Ziel. Erst wird alles geprüft, dann geschrieben: jede Ablehnung schreibt nichts.
pub async fn update_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    patch: MaterialPatch<'_>,
) -> Result<(), AppError> {
    // Herausgenommenes oder storniertes Material ändert sich nicht mehr (409, LLH-1079).
    require_aktiv_tx(conn, einsatz_id, em_id).await?;
    let (material_id, art, menge, ausgegeben, status): (Option<i64>, String, i64, i64, String) =
        sqlx::query_as(
            "SELECT material_id, art, menge, ausgegeben, status FROM einsatz_material \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(em_id)
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
    if patch.has_adhoc_angaben() && material_id.is_some() {
        return Err(stamm_angaben_error());
    }
    patch.ort.validate()?;
    let art = MaterialArt::try_from(art).map_err(AppError::Internal)?;
    let status = MaterialStatus::try_from(status).map_err(AppError::Internal)?;
    check_zeile(
        patch.art.unwrap_or(art),
        patch.menge.unwrap_or(menge),
        patch.ausgegeben.unwrap_or(ausgegeben),
        patch.status.unwrap_or(status),
        patch.ausgegeben.is_some(),
    )?;
    // Der Ort zuletzt geprüft und vor der Zeile geschrieben: `set_ort_tx` prüft nur ein neues Ziel
    // (Lösen und ein unveränderter Wert gehen immer, auch an einer aufgelösten UHS) und schreibt
    // erst danach.
    if !patch.ort.is_empty() {
        let aktuell = ort::load_ort_tx(conn, einsatz_id, em_id).await?;
        if let Some(ziel) = patch.ort.ziel(aktuell) {
            ort::set_ort_tx(conn, einsatz_id, em_id, ziel).await?;
        }
    }
    let resultat = sqlx::query(
        "UPDATE einsatz_material \
         SET menge = COALESCE(?1, menge), \
             ausgegeben = COALESCE(?2, ausgegeben), \
             status = COALESCE(?3, status), \
             art = COALESCE(?4, art), \
             bemerkung = CASE WHEN ?5 THEN ?6 ELSE bemerkung END, \
             snap_bezeichnung = COALESCE(?7, snap_bezeichnung), \
             snap_kategorie = CASE WHEN ?8 THEN ?9 ELSE snap_kategorie END, \
             snap_bestandsnummer = CASE WHEN ?10 THEN ?11 ELSE snap_bestandsnummer END, \
             snap_traegerorganisation = CASE WHEN ?12 THEN ?13 ELSE snap_traegerorganisation END \
         WHERE id = ?14 AND einsatz_id = ?15",
    )
    .bind(patch.menge)
    .bind(patch.ausgegeben)
    .bind(patch.status.map(|s| s.as_str()))
    .bind(patch.art.map(|a| a.as_str()))
    .bind(patch.bemerkung.is_some())
    .bind(patch.bemerkung.flatten())
    .bind(patch.bezeichnung)
    .bind(patch.kategorie.is_some())
    .bind(patch.kategorie.flatten())
    .bind(patch.bestandsnummer.is_some())
    .bind(patch.bestandsnummer.flatten())
    .bind(patch.traegerorganisation.is_some())
    .bind(patch.traegerorganisation.flatten())
    .bind(em_id)
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
    em_id: i64,
    patch: MaterialPatch<'_>,
) -> Result<(), AppError> {
    let mut conn = pool.acquire().await?;
    update_tx(&mut conn, einsatz_id, em_id, patch).await
}

/// Teilt `menge` von einem Posten ab (LLH-1093, design.md D8): die Ausgangszeile wird um `menge`
/// gemindert, und in derselben Transaktion entsteht eine neue Zeile mit `menge`, die Stammbezug,
/// alle `snap_*`, Art, Status, Bemerkung, den einen Ort und den Dispositionszeitpunkt samt
/// Dispositionsperson übernimmt und ohne Ausgabe beginnt (LLH-1224, design.md D14: die Teilzeile
/// kommt aus dem Rest, die Ausgabe bleibt an der Ausgangszeile); so bleibt die Storno-Frist (LLH-1079 D3) die der Ausgangszeile,
/// und auch eine frühere Herausnahme (`zuletzt_entlassen_at`, Migration 0195) sperrt den Storno
/// der Teilzeile wie den der Ausgangszeile. Den Bezug auf eine Nachforderung übernimmt sie auch:
/// sie kam mit derselben Lieferung (LLH-1226, design.md D9). Die neue Zeile ist aktiv.
/// `NotFound`/`Conflict` wie
/// [`require_aktiv_tx`], `UnprocessableEntity` an einem Gerät, wenn `menge` nicht kleiner als die
/// Menge ist und wenn sie den Rest übersteigt. `menge` ≥ 1 prüft die Route (400).
///
/// `ort_patch` setzt den Ort der neuen Zeile in derselben Anfrage (t1hvaqzu, design.md D1/D2): dieselben
/// Tri-State-Felder wie im PATCH, bezogen auf den Ort der Ausgangszeile, den die neue Zeile erbt;
/// leer = gleicher Ort. Zwei Orte mit Wert prüft die Route (422). Ein anderes Ziel wird nach Menge
/// und Art und vor dem ersten Schreiben geprüft ([`ort::require_ziel_tx`], 404/409/422), so
/// schreibt jede Ablehnung nichts, auch ohne umgebende Transaktion; gesetzt wird es über
/// [`ort::set_ort_tx`]. Liefert die ID der neuen Zeile und ihren Ortswechsel gegenüber der
/// Ausgangszeile.
pub async fn teile_auf_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    menge: i64,
    ort_patch: OrtPatch,
) -> Result<(i64, ort::OrtWechsel), AppError> {
    require_aktiv_tx(conn, einsatz_id, em_id).await?;
    let (ausgang, ausgegeben, art): (i64, i64, String) = sqlx::query_as(
        "SELECT menge, ausgegeben, art FROM einsatz_material WHERE id = ? AND einsatz_id = ?",
    )
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    if art == MaterialArt::Geraet.as_str() {
        return Err(AppError::UnprocessableEntity(GERAET_JE_STUECK.into()));
    }
    if menge >= ausgang {
        return Err(AppError::UnprocessableEntity(
            "Abzuteilende Menge muss kleiner als die Menge sein".into(),
        ));
    }
    if menge > ausgang - ausgegeben {
        return Err(AppError::UnprocessableEntity(
            "Abzuteilende Menge größer als der Rest".into(),
        ));
    }
    let vorher = ort::load_ort_tx(conn, einsatz_id, em_id).await?;
    let wechsel = ort::OrtWechsel {
        vorher,
        nachher: ort_patch.ziel(vorher).unwrap_or(vorher),
    };
    if let (true, Some(ziel)) = (wechsel.is_changed(), wechsel.nachher) {
        ort::require_ziel_tx(conn, einsatz_id, ziel).await?;
    }
    let neu: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_material \
            (einsatz_id, material_id, einheit_id, einsatz_fahrzeug_id, uhs_id, br_id, menge, \
             ausgegeben, art, status, snap_bezeichnung, snap_kategorie, snap_bestandsnummer, \
             snap_traegerorganisation, bemerkung, disponiert_at, disponiert_von, \
             zuletzt_entlassen_at, nachforderung_id) \
         SELECT einsatz_id, material_id, einheit_id, einsatz_fahrzeug_id, uhs_id, br_id, ?, \
                0, art, status, snap_bezeichnung, snap_kategorie, snap_bestandsnummer, \
                snap_traegerorganisation, bemerkung, disponiert_at, disponiert_von, \
                zuletzt_entlassen_at, nachforderung_id \
         FROM einsatz_material WHERE id = ? AND einsatz_id = ? \
         RETURNING id",
    )
    .bind(menge)
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query("UPDATE einsatz_material SET menge = menge - ? WHERE id = ? AND einsatz_id = ?")
        .bind(menge)
        .bind(em_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    if wechsel.is_changed() {
        ort::set_ort_tx(conn, einsatz_id, neu, wechsel.nachher).await?;
    }
    Ok((neu, wechsel))
}

/// Aktives Material einer UHS (aufgelöst), nach Dispo-Zeit; gefiltert nach `einsatz_id`
/// UND `uhs_id`.
pub async fn list_je_uhs(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzMaterialAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE em.einsatz_id = ? AND em.uhs_id = ? AND em.beendet_at IS NULL \
         ORDER BY em.disponiert_at, em.id"
    )))
    .bind(einsatz_id)
    .bind(uhs_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| zu_anzeige(r, einsatz_aktiv))
        .collect())
}

// ── Lebenszustand (LLH-1079 Teil II, Spec `kraefte-entlassung`) ──────────────────────────
// Material wird nicht „entlassen“, sondern „aus dem Einsatz genommen“ (Entscheidung Welle 2,
// LLH-1093 Nr. 3); der Endzustand auf dem Draht bleibt `entlassen` wie bei jeder Kraft.

/// Jeder Schreibweg an einer Materialposition fragt zuerst hier (design.md D6): `NotFound`, wenn
/// die Zeile nicht zum Einsatz gehört, `Conflict` (Lebenszyklus, `src/AGENTS.md`), wenn sie aus
/// dem Einsatz genommen oder storniert ist. Nur das erneute Disponieren schreibt daran.
pub async fn require_aktiv_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
) -> Result<(), AppError> {
    let ende: Option<Option<String>> = sqlx::query_scalar(
        "SELECT beendet_als FROM einsatz_material WHERE id = ? AND einsatz_id = ?",
    )
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    match ende.ok_or(AppError::NotFound)? {
        None => Ok(()),
        Some(als) => Err(beendet_conflict(&als)),
    }
}

/// Der 409 an beendetem Material (Lebenszyklus), je Endzustand.
pub fn beendet_conflict(beendet_als: &str) -> AppError {
    AppError::Conflict(match beendet_als {
        "storniert" => "Das Material ist storniert; erst erneut disponieren".into(),
        _ => "Das Material ist aus dem Einsatz genommen; erst erneut disponieren".into(),
    })
}

/// Was das Herausnehmen über die Zeile hinaus berührt hat; der Aufrufer meldet es nach dem
/// Commit und nennt die Einheit im ETB-Text.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Entlassen {
    /// Einheit, der das Material angehörte (Name für den ETB-Text).
    pub einheit: Option<(i64, String)>,
    /// Der Ort, an dem das Material lag (LLH-1224); sein Leser bekommt ein Ereignis.
    pub ort: Option<MaterialOrt>,
}

/// Nimmt Material aus dem Einsatz (design.md D4, Wortlaut LLH-1093): die Zeile bleibt mit
/// Zeitpunkt und handelnder Person stehen, der Ort wird gelöst (alle vier Spalten, LLH-1224 D13). Keine Zeitachse (D5).
/// `NotFound`/`Conflict` wie [`require_aktiv_tx`].
pub async fn entlassen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Entlassen, AppError> {
    require_aktiv_tx(conn, einsatz_id, em_id).await?;
    let einheit: Option<(i64, String)> = sqlx::query_as(
        "SELECT e.id, e.name FROM einsatz_material em \
         JOIN einsatz_einheit e ON e.id = em.einheit_id \
         WHERE em.id = ? AND em.einsatz_id = ?",
    )
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let wechsel = ort::set_ort_tx(conn, einsatz_id, em_id, None).await?;
    set_beendet_tx(
        conn,
        einsatz_id,
        em_id,
        benutzer_id,
        jetzt,
        BeendetAls::Entlassen,
    )
    .await?;
    Ok(Entlassen {
        einheit,
        ort: wechsel.vorher,
    })
}

/// Setzt den Endzustand genau einmal; die Bedingung `beendet_at IS NULL` steht im UPDATE, so
/// trifft ein gleichzeitiger zweiter Versuch keine Zeile mehr (`Conflict`).
async fn set_beendet_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    benutzer_id: i64,
    jetzt: &str,
    als: BeendetAls,
) -> Result<(), AppError> {
    // `zuletzt_entlassen_at` überdauert das erneute Disponieren (Storno-Sperre, design.md D3).
    let r = sqlx::query(
        "UPDATE einsatz_material SET beendet_at = ?1, beendet_von = ?2, beendet_als = ?3, \
             zuletzt_entlassen_at = CASE WHEN ?3 = 'entlassen' THEN ?1 \
                                         ELSE zuletzt_entlassen_at END \
         WHERE id = ?4 AND einsatz_id = ?5 AND beendet_at IS NULL",
    )
    .bind(jetzt)
    .bind(benutzer_id)
    .bind(als.as_str())
    .bind(em_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Das Material ist bereits aus dem Einsatz genommen".into(),
        ));
    }
    Ok(())
}

/// Storniert eine Fehldisposition (design.md D3): die Zeile endet als `storniert` und erscheint
/// in keinem Nachweis. Nur solange das Material aktiv ist (sonst `Conflict`), nie aus dem
/// Einsatz genommen war, ohne Ort ist (LLH-1224, design.md D13) und höchstens
/// [`crate::entlassung::STORNO_FRIST_MINUTEN`] nach der Disposition; sonst 422 mit dem ersten
/// verletzten Grund als Satz.
pub async fn stornieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    require_aktiv_tx(conn, einsatz_id, em_id).await?;
    if let Some(grund) = find_storno_hindernis_tx(conn, einsatz_id, em_id, jetzt).await? {
        return Err(AppError::UnprocessableEntity(grund));
    }
    set_beendet_tx(
        conn,
        einsatz_id,
        em_id,
        benutzer_id,
        jetzt,
        BeendetAls::Storniert,
    )
    .await
}

/// Der erste Grund, der den Storno von Material verbietet (design.md D3), oder `None`.
async fn find_storno_hindernis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    jetzt: &str,
) -> Result<Option<String>, AppError> {
    let (disponiert_at, entlassen_at): (String, Option<String>) = sqlx::query_as(
        "SELECT disponiert_at, zuletzt_entlassen_at \
         FROM einsatz_material WHERE id = ? AND einsatz_id = ?",
    )
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    const AUSWEG: &str = "das Material lässt sich aus dem Einsatz nehmen";
    if entlassen_at.is_some() {
        return Ok(Some(format!(
            "Das Material war schon einmal aus dem Einsatz genommen; {AUSWEG}"
        )));
    }
    let bindung = match ort::load_ort_tx(conn, einsatz_id, em_id).await? {
        Some(MaterialOrt::Einheit(_)) => Some("Das Material gehört einer Einheit an"),
        Some(MaterialOrt::Fahrzeug(_)) => Some("Das Material ist auf ein Fahrzeug geladen"),
        Some(MaterialOrt::Uhs(_)) => Some("Das Material liegt an einer UHS"),
        Some(MaterialOrt::Bereitstellungsraum(_)) => {
            Some("Das Material liegt in einem Bereitstellungsraum")
        }
        None => None,
    };
    if let Some(b) = bindung {
        return Ok(Some(format!(
            "{b}; erst lösen oder das Material aus dem Einsatz nehmen"
        )));
    }
    if !crate::entlassung::is_in_storno_frist(&disponiert_at, jetzt) {
        return Ok(Some(format!(
            "Stornieren geht nur in den ersten {} Minuten nach der Disposition; {AUSWEG}",
            crate::entlassung::STORNO_FRIST_MINUTEN
        )));
    }
    Ok(None)
}

/// Nimmt Material, das aus dem Einsatz genommen oder storniert war, wieder auf (design.md D7):
/// Endzustand weg, Dispositionszeit neu. Menge und Status bleiben, sie beschreiben das Material
/// selbst (ein defektes Gerät ist nach dem Wiederaufnehmen nicht einsatzbereit). Stamm-Material
/// muss in Dienst sein, sein Snapshot wird erneuert. `NotFound` bei fremder Zeile, `Conflict`
/// bei einer aktiven.
pub async fn reaktivieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    em_id: i64,
    benutzer_id: i64,
) -> Result<(), AppError> {
    let zeile: Option<(Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT material_id, beendet_at FROM einsatz_material WHERE id = ? AND einsatz_id = ?",
    )
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (material_id, beendet_at) = zeile.ok_or(AppError::NotFound)?;
    if beendet_at.is_none() {
        return Err(AppError::Conflict(
            "Das Material ist bereits in diesem Einsatz disponiert".into(),
        ));
    }
    if let Some(mid) = material_id {
        // Die Art bleibt die der Zeile (design.md D1): sie gilt für die Zeile, nicht für den Stamm.
        let ((bezeichnung, kategorie, bestandsnummer, traeger), _) =
            stamm_snapshot_tx(conn, org_id, mid).await?;
        sqlx::query(
            "UPDATE einsatz_material SET snap_bezeichnung = ?, snap_kategorie = ?, \
                 snap_bestandsnummer = ?, snap_traegerorganisation = ? WHERE id = ?",
        )
        .bind(&bezeichnung)
        .bind(&kategorie)
        .bind(&bestandsnummer)
        .bind(&traeger)
        .bind(em_id)
        .execute(&mut *conn)
        .await?;
    }
    sqlx::query(
        "UPDATE einsatz_material SET beendet_at = NULL, beendet_von = NULL, beendet_als = NULL, \
             disponiert_at = datetime('now'), disponiert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(benutzer_id)
    .bind(em_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::material::repo::{self as mat_repo, MaterialDaten};
    use crate::material::MaterialStatus;

    /// Org(1) + Benutzer + Einsatz; liefert (benutzer, einsatz).
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
        (benutzer, einsatz)
    }

    /// Stamm-Verbrauchsgut (Mengen über 1, Ausgabe); Geräte über [`geraet_daten`].
    fn mat_daten(bezeichnung: &str) -> MaterialDaten<'_> {
        MaterialDaten {
            bezeichnung,
            kategorie: Some("Betreuung"),
            bestandsnummer: None,
            traegerorganisation: None,
            standort: None,
            bemerkung: None,
            art: MaterialArt::Verbrauchsgut,
        }
    }

    fn geraet_daten(bezeichnung: &str) -> MaterialDaten<'_> {
        MaterialDaten {
            art: MaterialArt::Geraet,
            ..mat_daten(bezeichnung)
        }
    }

    /// LLH-1226, design.md D8: die Anzeige trägt von der Nachforderung nur die Kennung, ohne
    /// Bezug fehlt das Feld (Norm LFH-265).
    #[tokio::test]
    async fn anzeige_traegt_nur_die_kennung_der_nachforderung() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let daten = AdhocDaten {
            bezeichnung: "Tauchpumpe",
            kategorie: None,
            bestandsnummer: None,
            traegerorganisation: None,
        };
        let ohne = disponiere_adhoc(&pool, einsatz, daten, None, 1, benutzer)
            .await
            .unwrap();
        let a = load_anzeige(&pool, einsatz, ohne, true).await.unwrap();
        assert_eq!(a.nachforderung_id, None);
        let json = serde_json::to_value(&a).unwrap();
        assert!(!json.as_object().unwrap().contains_key("nachforderung_id"));

        let n: i64 = sqlx::query_scalar(
            "INSERT INTO nachforderung (einsatz_id, art, bezeichnung, adressat_kategorie, \
                angefordert_at, erstellt_von_id) \
             VALUES (?, 'Tauchpumpe', '3 Tauchpumpen', 'leitstelle', '2026-10-15 08:00:00', ?) \
             RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_material SET nachforderung_id = ? WHERE id = ?")
            .bind(n)
            .bind(ohne)
            .execute(&pool)
            .await
            .unwrap();
        let a = load_anzeige(&pool, einsatz, ohne, true).await.unwrap();
        assert_eq!(a.nachforderung_id, Some(n));
        let json = serde_json::to_value(&a).unwrap();
        assert_eq!(json["nachforderung_id"], serde_json::json!(n));
        assert_eq!(
            list(&pool, einsatz, true).await.unwrap()[0].nachforderung_id,
            Some(n)
        );
    }

    #[tokio::test]
    async fn disponiere_stamm_fuellt_snapshot_und_default_status() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();

        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.bezeichnung, "Wolldecke");
        assert_eq!(a.menge, 50);
        assert_eq!(a.status, MaterialStatus::Einsatzbereit);
        assert!(!a.ist_adhoc);
        assert_eq!(a.kategorie.as_deref(), Some("Betreuung"));
    }

    #[tokio::test]
    async fn disponiere_stamm_mehrfach_erlaubt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        disponiere_stamm(&pool, einsatz, 1, m.id, 30, benutzer)
            .await
            .unwrap();
        disponiere_stamm(&pool, einsatz, 1, m.id, 20, benutzer)
            .await
            .unwrap();
        assert_eq!(
            list(&pool, einsatz, true).await.unwrap().len(),
            2,
            "kein UNIQUE - Mengen-Splitting"
        );
    }

    #[tokio::test]
    async fn disponiere_stamm_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')")
            .execute(&pool)
            .await
            .unwrap();
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO material (org_id, bezeichnung) VALUES (2, 'Fremd-Decke') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fremd, 1, benutzer)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }

    /// Außer Dienst ist ein Zustand der Stamm-Zeile, also 422 (`src/AGENTS.md`,
    /// Statuscode-Konvention; bis LLH-1079 Teil II war es 400).
    #[tokio::test]
    async fn disponiere_stamm_ausser_dienst_ist_422() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        mat_repo::setze_dienststatus(&pool, 1, m.id, false)
            .await
            .unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, m.id, 1, benutzer)
                .await
                .unwrap_err(),
            AppError::UnprocessableEntity(m)
                if m == "Material ist außer Dienst und kann nicht disponiert werden"
        ));
    }

    #[tokio::test]
    async fn adhoc_ohne_stamm() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let em = disponiere_adhoc(
            &pool,
            einsatz,
            AdhocDaten {
                bezeichnung: "Spende-Decken",
                kategorie: None,
                bestandsnummer: None,
                traegerorganisation: Some("THW"),
            },
            None,
            100,
            benutzer,
        )
        .await
        .unwrap();
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert!(a.ist_adhoc && a.material_id.is_none());
        assert_eq!(a.menge, 100);
        assert_eq!(a.traegerorganisation.as_deref(), Some("THW"));
    }

    #[tokio::test]
    async fn aktualisiere_menge_status_bemerkung_dann_aus_dem_einsatz_nehmen() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();

        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                menge: Some(30),
                status: Some(MaterialStatus::Defekt),
                bemerkung: Some(Some("nass")),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.menge, 30);
        assert_eq!(a.status, MaterialStatus::Defekt);
        assert_eq!(a.bemerkung.as_deref(), Some("nass"));

        // Nur die Ausgabe ändern (menge/status/bemerkung None -> bleiben); ganz ausgegeben
        // heißt aufgebraucht, der Status bleibt (LLH-1224 D3).
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                ausgegeben: Some(30),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        let b = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!((b.menge, b.ausgegeben), (30, 30), "Menge unveraendert");
        assert_eq!(b.status, MaterialStatus::Defekt);

        nimm_heraus(&pool, einsatz, em, benutzer).await.unwrap();
        // Die Zeile bleibt mit Menge und Status (LLH-1079), fehlt aber in der Liste.
        let c = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(c.beendet_als.as_deref(), Some("entlassen"));
        assert_eq!(
            (c.menge, c.ausgegeben, c.status),
            (30, 30, MaterialStatus::Defekt)
        );
        assert!(list(&pool, einsatz, true).await.unwrap().is_empty());
        assert_eq!(
            list_entlassene(&pool, einsatz, true).await.unwrap().len(),
            1
        );
        assert!(matches!(
            update(
                &pool,
                einsatz,
                em,
                MaterialPatch {
                    menge: Some(1),
                    ..MaterialPatch::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::Conflict(_)
        ));
        assert!(matches!(
            nimm_heraus(&pool, einsatz, em, benutzer).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn aktualisiere_setzt_uhs_id_und_loese() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();
        let u: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'behandlungsplatz', 'BHP 50', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .bind(benutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        // Zuordnen:
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                ort: OrtPatch {
                    uhs_id: Some(Some(u)),
                    ..OrtPatch::default()
                },
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.uhs_id, Some(u));
        // Lösen (explizit NULL):
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                ort: OrtPatch {
                    uhs_id: Some(None),
                    ..OrtPatch::default()
                },
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert!(a.uhs_id.is_none());
        // list_je_uhs:
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                ort: OrtPatch {
                    uhs_id: Some(Some(u)),
                    ..OrtPatch::default()
                },
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        let liste = list_je_uhs(&pool, einsatz, u, true).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].id, em);
    }

    /// LLH-1093, design.md D6: jede Ad-hoc-Angabe landet in ihrer eigenen `snap_*`-Spalte (die
    /// Bindungsfalle: eine verschobene Bindung schriebe ein Feld in das Nachbarfeld), und die
    /// übrigen bleiben stehen.
    #[tokio::test]
    async fn adhoc_angaben_je_feld_in_der_eigenen_spalte() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let em = disponiere_adhoc(
            &pool,
            einsatz,
            AdhocDaten {
                bezeichnung: "Feldbeten",
                kategorie: Some("K"),
                bestandsnummer: Some("B"),
                traegerorganisation: Some("T"),
            },
            None,
            4,
            benutzer,
        )
        .await
        .unwrap();
        let load = |pool: SqlitePool| async move {
            let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
            (
                a.bezeichnung,
                a.kategorie,
                a.bestandsnummer,
                a.traegerorganisation,
                a.menge,
            )
        };
        let s = |v: &str| Some(v.to_string());

        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                bezeichnung: Some("Feldbetten"),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            load(pool.clone()).await,
            ("Feldbetten".into(), s("K"), s("B"), s("T"), 4)
        );
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                kategorie: Some(Some("Betreuung")),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            load(pool.clone()).await,
            ("Feldbetten".into(), s("Betreuung"), s("B"), s("T"), 4)
        );
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                bestandsnummer: Some(Some("B-7")),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            load(pool.clone()).await,
            ("Feldbetten".into(), s("Betreuung"), s("B-7"), s("T"), 4)
        );
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                traegerorganisation: Some(Some("THW")),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            load(pool.clone()).await,
            ("Feldbetten".into(), s("Betreuung"), s("B-7"), s("THW"), 4)
        );
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                kategorie: Some(None),
                bestandsnummer: Some(None),
                traegerorganisation: Some(None),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            load(pool.clone()).await,
            ("Feldbetten".into(), None, None, None, 4)
        );
    }

    /// LLH-1093, design.md D6: an einem Stamm-Posten ist jede Ad-hoc-Angabe 422, und nichts aus
    /// dem Patch ist geschrieben, auch nicht Menge, Status oder Bemerkung.
    #[tokio::test]
    async fn stamm_posten_lehnt_adhoc_angaben_ab_ohne_zu_schreiben() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();
        let rest = MaterialPatch {
            menge: Some(3),
            status: Some(MaterialStatus::Defekt),
            bemerkung: Some(Some("nass")),
            ..MaterialPatch::default()
        };
        for patch in [
            MaterialPatch {
                bezeichnung: Some("Decke"),
                ..rest
            },
            MaterialPatch {
                kategorie: Some(None),
                ..rest
            },
            MaterialPatch {
                bestandsnummer: Some(Some("B")),
                ..rest
            },
            MaterialPatch {
                traegerorganisation: Some(Some("THW")),
                ..rest
            },
        ] {
            assert!(matches!(
                update(&pool, einsatz, em, patch).await.unwrap_err(),
                AppError::UnprocessableEntity(m) if m == "Angaben eines Stamm-Postens im Stamm pflegen"
            ));
        }
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(
            (a.menge, a.status, a.bemerkung),
            (50, MaterialStatus::Einsatzbereit, None)
        );
        assert_eq!(a.kategorie.as_deref(), Some("Betreuung"));
        // Ohne Angaben geht derselbe Rest durch.
        update(&pool, einsatz, em, rest).await.unwrap();
    }

    #[tokio::test]
    async fn snapshot_stabil_live_vs_snapshot() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();

        // Stamm nachträglich umbenennen.
        mat_repo::aktualisiere(&pool, 1, m.id, mat_daten("Wolldecke NEU"))
            .await
            .unwrap();

        // Aktiver Einsatz + in Dienst -> Live (neuer Name); menge/status aus der Zeile.
        let live = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(live.bezeichnung, "Wolldecke NEU");
        assert_eq!(live.menge, 50);

        // Abgeschlossener Einsatz (einsatz_aktiv=false) -> Snapshot (alter Name).
        let snap = load_anzeige(&pool, einsatz, em, false).await.unwrap();
        assert_eq!(snap.bezeichnung, "Wolldecke");

        // Stamm außer Dienst -> auch bei aktivem Einsatz Snapshot.
        mat_repo::setze_dienststatus(&pool, 1, m.id, false)
            .await
            .unwrap();
        let nach_ad = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(
            nach_ad.bezeichnung, "Wolldecke",
            "ausser Dienst -> Snapshot trotz aktivem Einsatz"
        );
    }

    /// LFH-733 (design.md D2): `ist_demo` folgt der Marke des Stamm-Materials, unabhängig von
    /// der Live-oder-Snapshot-Regel; Ad-hoc-Material ist nie Demo.
    #[tokio::test]
    async fn ist_demo_folgt_der_stamm_marke() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let demo = mat_repo::anlegen(&pool, 1, mat_daten("Demo-Decke"))
            .await
            .unwrap();
        let echt = mat_repo::anlegen(&pool, 1, mat_daten("Echte Decke"))
            .await
            .unwrap();
        crate::demo::test_hilfen::demo_markieren(&pool, 1, "material", demo.id).await;
        // Dieselbe ID unter den anderen Tabellen markiert: ohne den Filter `dh.tabelle`
        // meldete auch echt Demo.
        crate::demo::test_hilfen::demo_markieren(&pool, 1, "fahrzeug", echt.id).await;
        crate::demo::test_hilfen::demo_markieren(&pool, 1, "personal", echt.id).await;
        // Erst das echte, dann das Demo-Stück disponieren: so trägt die Disposition des
        // Demo-Stücks eine andere ID als sein Stamm, und `datensatz_id = em.id` statt
        // `em.material_id` fiele auf.
        let em_echt = disponiere_stamm(&pool, einsatz, 1, echt.id, 5, benutzer)
            .await
            .unwrap();
        let em_adhoc = disponiere_adhoc(
            &pool,
            einsatz,
            AdhocDaten {
                bezeichnung: "Fremde Trage",
                kategorie: None,
                bestandsnummer: None,
                traegerorganisation: None,
            },
            None,
            1,
            benutzer,
        )
        .await
        .unwrap();
        let em_demo = disponiere_stamm(&pool, einsatz, 1, demo.id, 5, benutzer)
            .await
            .unwrap();
        assert_ne!(em_demo, demo.id, "Vorbedingung: IDs entkoppelt");

        for einsatz_aktiv in [true, false] {
            let alle = list(&pool, einsatz, einsatz_aktiv).await.unwrap();
            let marke = |id| alle.iter().find(|a| a.id == id).unwrap().ist_demo;
            assert!(marke(em_demo), "einsatz_aktiv={einsatz_aktiv}");
            assert!(!marke(em_echt), "einsatz_aktiv={einsatz_aktiv}");
            assert!(!marke(em_adhoc), "einsatz_aktiv={einsatz_aktiv}");
        }
        assert!(
            load_anzeige(&pool, einsatz, em_demo, true)
                .await
                .unwrap()
                .ist_demo
        );
    }

    // ── Lebenszustand (LLH-1079 Teil II) ──────────────────────────────────────────────

    async fn teile(pool: &SqlitePool, einsatz: i64, em: i64, menge: i64) -> Result<i64, AppError> {
        let mut tx = pool.begin().await.unwrap();
        let (neu, _) = teile_auf_tx(&mut tx, einsatz, em, menge, OrtPatch::default()).await?;
        tx.commit().await.unwrap();
        Ok(neu)
    }

    /// Aufteilen mit Ort-Feldern OHNE umgebende Transaktion: eine Ablehnung darf dann nichts
    /// geschrieben haben, auch ohne Rollback (t1hvaqzu, design.md D2).
    async fn teile_nach(
        pool: &SqlitePool,
        einsatz: i64,
        em: i64,
        menge: i64,
        ort: OrtPatch,
    ) -> Result<(i64, ort::OrtWechsel), AppError> {
        teile_auf_tx(&mut pool.acquire().await.unwrap(), einsatz, em, menge, ort).await
    }

    /// LLH-1224 D2/D3/D4: Art, Menge, Ausgabe und Status passen zueinander, beim Disponieren
    /// wie beim Ändern; ein abgelehnter Patch schreibt nichts, auch keinen Ort.
    #[tokio::test]
    async fn zeilenregeln_beim_disponieren_und_aendern() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let g = mat_repo::anlegen(&pool, 1, geraet_daten("Stromerzeuger"))
            .await
            .unwrap();
        assert_eq!(
            grund(
                disponiere_stamm(&pool, einsatz, 1, g.id, 2, benutzer)
                    .await
                    .unwrap_err()
            ),
            GERAET_JE_STUECK
        );
        let geraet = disponiere_stamm(&pool, einsatz, 1, g.id, 1, benutzer)
            .await
            .unwrap();
        assert_eq!(
            load_anzeige(&pool, einsatz, geraet, true)
                .await
                .unwrap()
                .art,
            MaterialArt::Geraet,
            "Art aus dem Stamm"
        );
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let vg = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let mit_ort = |patch: MaterialPatch<'static>| MaterialPatch {
            ort: OrtPatch {
                einheit_id: Some(Some(einheit)),
                ..OrtPatch::default()
            },
            ..patch
        };
        let faelle: [(i64, MaterialPatch<'static>, &str); 7] = [
            (
                geraet,
                MaterialPatch {
                    menge: Some(3),
                    ..MaterialPatch::default()
                },
                GERAET_JE_STUECK,
            ),
            (
                geraet,
                MaterialPatch {
                    ausgegeben: Some(1),
                    ..MaterialPatch::default()
                },
                "Ausgabe gibt es nur für Verbrauchsgut",
            ),
            (
                vg,
                MaterialPatch {
                    ausgegeben: Some(60),
                    ..MaterialPatch::default()
                },
                "Ausgabe größer als die Menge",
            ),
            (
                vg,
                MaterialPatch {
                    status: Some(MaterialStatus::Verbraucht),
                    ..MaterialPatch::default()
                },
                "Status «verbraucht» gibt es nur für Geräte",
            ),
            (
                vg,
                MaterialPatch {
                    status: Some(MaterialStatus::DesinfektionNoetig),
                    ..MaterialPatch::default()
                },
                "Status «Desinfektion nötig» gibt es nur für Geräte",
            ),
            (
                vg,
                MaterialPatch {
                    art: Some(MaterialArt::Geraet),
                    ..MaterialPatch::default()
                },
                GERAET_JE_STUECK,
            ),
            (
                geraet,
                MaterialPatch {
                    status: Some(MaterialStatus::Verbraucht),
                    art: Some(MaterialArt::Verbrauchsgut),
                    ..MaterialPatch::default()
                },
                "Status «verbraucht» gibt es nur für Geräte",
            ),
        ];
        for (em, patch, erwartet) in faelle {
            assert_eq!(
                grund(
                    update(&pool, einsatz, em, mit_ort(patch))
                        .await
                        .unwrap_err()
                ),
                erwartet
            );
            let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
            assert_eq!(a.ort(), None, "{erwartet}: kein Ort geschrieben");
        }
        // Die Ausgabe steht, dann ist eine kleinere Menge die Verletzung.
        update(
            &pool,
            einsatz,
            vg,
            MaterialPatch {
                ausgegeben: Some(30),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            grund(
                update(
                    &pool,
                    einsatz,
                    vg,
                    MaterialPatch {
                        menge: Some(20),
                        ..MaterialPatch::default()
                    },
                )
                .await
                .unwrap_err()
            ),
            "Menge kleiner als die Ausgabe"
        );
        // Ein Gerät darf „verbraucht“ werden; ein Verbrauchsgut mit Menge 1 darf ein Gerät werden.
        update(
            &pool,
            einsatz,
            geraet,
            MaterialPatch {
                status: Some(MaterialStatus::Verbraucht),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        let eins = disponiere_stamm(&pool, einsatz, 1, m.id, 1, benutzer)
            .await
            .unwrap();
        update(
            &pool,
            einsatz,
            eins,
            MaterialPatch {
                art: Some(MaterialArt::Geraet),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            load_anzeige(&pool, einsatz, eins, true).await.unwrap().art,
            MaterialArt::Geraet
        );
        // Zwei Orte in einem Patch: 422 ohne zu schreiben.
        let u: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'behandlungsplatz', 'BHP 50', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .bind(benutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            grund(
                update(
                    &pool,
                    einsatz,
                    vg,
                    MaterialPatch {
                        ort: OrtPatch {
                            einheit_id: Some(Some(einheit)),
                            uhs_id: Some(Some(u)),
                            ..OrtPatch::default()
                        },
                        ..MaterialPatch::default()
                    },
                )
                .await
                .unwrap_err()
            ),
            "Ein Posten hat höchstens einen Ort"
        );
        assert_eq!(
            load_anzeige(&pool, einsatz, vg, true).await.unwrap().ort(),
            None
        );
    }

    /// LLH-1093, design.md D8, LLH-1224 D14: Summe gleich, Art, alle Angaben, der eine Ort und
    /// der Dispositionszeitpunkt übernommen, die Teilzeile aktiv; sie kommt aus dem Rest und
    /// startet ohne Ausgabe, die Ausgabe bleibt an der Ausgangszeile.
    #[tokio::test]
    async fn aufteilen_haelt_die_summe_und_uebernimmt_alles() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();
        let u: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'behandlungsplatz', 'BHP 50', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .bind(benutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE einsatz_material SET uhs_id = ?, status = 'im_einsatz', ausgegeben = 10, \
             bemerkung = 'Regal 2', disponiert_at = '2026-10-14 08:00:00' WHERE id = ?",
        )
        .bind(u)
        .bind(em)
        .execute(&pool)
        .await
        .unwrap();

        let neu = teile(&pool, einsatz, em, 20).await.unwrap();
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        let b = load_anzeige(&pool, einsatz, neu, true).await.unwrap();
        assert_ne!(neu, em);
        assert_eq!((a.menge, b.menge), (30, 20), "Summe gleich");
        assert_eq!((a.ausgegeben, b.ausgegeben), (10, 0), "Ausgabe bleibt");
        assert_eq!(b.art, MaterialArt::Verbrauchsgut);
        assert_eq!(b.material_id, Some(m.id));
        assert_eq!(
            (b.ort(), b.status, b.bemerkung.as_deref()),
            (
                Some(MaterialOrt::Uhs(u)),
                MaterialStatus::ImEinsatz,
                Some("Regal 2")
            )
        );
        assert_eq!(
            (b.bezeichnung.as_str(), b.kategorie.as_deref()),
            ("Wolldecke", Some("Betreuung"))
        );
        assert_eq!(
            b.disponiert_at, "2026-10-14 08:00:00",
            "Dispositionszeitpunkt übernommen"
        );
        assert_eq!(b.disponiert_von, Some(benutzer));
        assert_eq!(b.beendet_at, None, "die Teilzeile ist aktiv");
        let snap: (String, Option<String>) = sqlx::query_as(
            "SELECT snap_bezeichnung, snap_kategorie FROM einsatz_material WHERE id = ?",
        )
        .bind(neu)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(snap, ("Wolldecke".into(), Some("Betreuung".into())));
        assert_eq!(list(&pool, einsatz, true).await.unwrap().len(), 2);
        assert_eq!(list_je_uhs(&pool, einsatz, u, true).await.unwrap().len(), 2);
    }

    /// LLH-1224 D14: ein Gerät lässt sich nicht aufteilen, ein Verbrauchsgut höchstens um seinen
    /// Rest; jeweils ohne zu schreiben. Der ganze Rest geht.
    #[tokio::test]
    async fn aufteilen_nur_aus_dem_rest_und_nie_ein_geraet() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let g = mat_repo::anlegen(&pool, 1, geraet_daten("Stromerzeuger"))
            .await
            .unwrap();
        let geraet = disponiere_stamm(&pool, einsatz, 1, g.id, 1, benutzer)
            .await
            .unwrap();
        assert_eq!(
            grund(teile(&pool, einsatz, geraet, 1).await.unwrap_err()),
            GERAET_JE_STUECK
        );
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                ausgegeben: Some(40),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            grund(teile(&pool, einsatz, em, 11).await.unwrap_err()),
            "Abzuteilende Menge größer als der Rest"
        );
        assert_eq!(
            load_anzeige(&pool, einsatz, em, true).await.unwrap().menge,
            50
        );
        assert_eq!(list(&pool, einsatz, true).await.unwrap().len(), 2);
        let neu = teile(&pool, einsatz, em, 10).await.unwrap();
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!((a.menge, a.ausgegeben), (40, 40), "ganz ausgegeben");
        let b = load_anzeige(&pool, einsatz, neu, true).await.unwrap();
        assert_eq!((b.menge, b.ausgegeben), (10, 0));
    }

    /// LLH-1093, design.md D8: eine Menge ab der Ausgangsmenge ist 422 (deckt Menge 1 ab),
    /// beendetes Material 409, eine fremde Zeile 404; jeweils ohne zu schreiben.
    #[tokio::test]
    async fn aufteilen_grenzen() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Trage"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 3, benutzer)
            .await
            .unwrap();
        for menge in [3, 4] {
            assert_eq!(
                grund(teile(&pool, einsatz, em, menge).await.unwrap_err()),
                "Abzuteilende Menge muss kleiner als die Menge sein"
            );
        }
        let eins = disponiere_stamm(&pool, einsatz, 1, m.id, 1, benutzer)
            .await
            .unwrap();
        assert!(matches!(
            teile(&pool, einsatz, eins, 1).await.unwrap_err(),
            AppError::UnprocessableEntity(_)
        ));
        assert!(matches!(
            teile(&pool, einsatz + 1, em, 1).await.unwrap_err(),
            AppError::NotFound
        ));
        nimm_heraus(&pool, einsatz, em, benutzer).await.unwrap();
        assert!(matches!(
            teile(&pool, einsatz, em, 1).await.unwrap_err(),
            AppError::Conflict(_)
        ));
        let gesamt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_material")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(gesamt, 2, "nichts angelegt");
        assert_eq!(
            load_anzeige(&pool, einsatz, em, true).await.unwrap().menge,
            3
        );
    }

    /// Einheit „Staffel A“, UHS „Turnhalle“, Fahrzeug „Florian 1/83-1“ und 50 Wolldecken an der
    /// Einheit; liefert (einsatz, einheit, uhs, fahrzeug, em).
    async fn decken_an_der_einheit(pool: &SqlitePool) -> (i64, i64, i64, i64, i64) {
        let (benutzer, einsatz) = setup(pool).await;
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Staffel A') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap();
        let uhs: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'patientenablage', 'Turnhalle', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .bind(benutzer)
        .fetch_one(pool)
        .await
        .unwrap();
        let fahrzeug: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) \
             VALUES (?, 'Florian 1/83-1') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap();
        let m = mat_repo::anlegen(pool, 1, mat_daten("Wolldecke"))
            .await
            .unwrap();
        let em = disponiere_stamm(pool, einsatz, 1, m.id, 50, benutzer)
            .await
            .unwrap();
        ort::set_ort_tx(
            &mut pool.acquire().await.unwrap(),
            einsatz,
            em,
            Some(MaterialOrt::Einheit(einheit)),
        )
        .await
        .unwrap();
        (einsatz, einheit, uhs, fahrzeug, em)
    }

    async fn zeilen(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_material")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// t1hvaqzu (LLH-1251), design.md D1/D2: 20 von 50 Wolldecken der Einheit an die UHS in EINEM
    /// Aufteilen; genau eine neue Zeile, und zwar an der UHS, der Rest bleibt an der Einheit.
    #[tokio::test]
    async fn aufteilen_mit_zielort_legt_genau_eine_zeile_am_ziel_an() {
        let pool = crate::db::test_pool().await;
        let (einsatz, einheit, uhs, _, em) = decken_an_der_einheit(&pool).await;
        let ziel = OrtPatch {
            uhs_id: Some(Some(uhs)),
            ..OrtPatch::default()
        };
        let (neu, wechsel) = teile_nach(&pool, einsatz, em, 20, ziel).await.unwrap();
        assert_eq!(
            wechsel,
            ort::OrtWechsel {
                vorher: Some(MaterialOrt::Einheit(einheit)),
                nachher: Some(MaterialOrt::Uhs(uhs)),
            }
        );
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        let b = load_anzeige(&pool, einsatz, neu, true).await.unwrap();
        assert_eq!(
            (a.menge, a.ort()),
            (30, Some(MaterialOrt::Einheit(einheit)))
        );
        assert_eq!((b.menge, b.ort()), (20, Some(MaterialOrt::Uhs(uhs))));
        assert_eq!(zeilen(&pool).await, 2, "genau eine neue Zeile");
        let an_der_uhs = list_je_uhs(&pool, einsatz, uhs, true).await.unwrap();
        assert_eq!(
            an_der_uhs.iter().map(|e| e.id).collect::<Vec<_>>(),
            vec![neu]
        );
    }

    /// t1hvaqzu, design.md D1/D2: die Ort-Felder bedeuten dasselbe wie im PATCH (bezogen auf den
    /// Ort der Ausgangszeile); ein Ziel wird wie jeder Ortswechsel geprüft, NACH Menge und Art und
    /// VOR dem ersten Schreiben.
    #[tokio::test]
    async fn aufteilen_mit_ziel_grenzen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, einheit, uhs, fahrzeug, em) = decken_an_der_einheit(&pool).await;
        let code = |r: Result<(i64, ort::OrtWechsel), AppError>| match r {
            Ok(_) => 200,
            Err(AppError::NotFound) => 404,
            Err(AppError::Conflict(_)) => 409,
            Err(AppError::UnprocessableEntity(_)) => 422,
            Err(other) => panic!("unerwartet: {other:?}"),
        };

        // `null` am aktuellen Ort: der abgeteilte Teil steht ohne Ort.
        let loesen = OrtPatch {
            einheit_id: Some(None),
            ..OrtPatch::default()
        };
        let (ohne, w) = teile_nach(&pool, einsatz, em, 5, loesen).await.unwrap();
        assert!(w.is_changed());
        assert_eq!(
            load_anzeige(&pool, einsatz, ohne, true)
                .await
                .unwrap()
                .ort(),
            None
        );
        // Derselbe Ort: kein Wechsel, die Teilzeile bleibt an der Einheit.
        let gleich = OrtPatch {
            einheit_id: Some(Some(einheit)),
            ..OrtPatch::default()
        };
        let (dort, w) = teile_nach(&pool, einsatz, em, 5, gleich).await.unwrap();
        assert!(!w.is_changed());
        assert_eq!(
            load_anzeige(&pool, einsatz, dort, true)
                .await
                .unwrap()
                .ort(),
            Some(MaterialOrt::Einheit(einheit))
        );
        assert_eq!(
            load_anzeige(&pool, einsatz, em, true).await.unwrap().menge,
            40
        );
        let vorher = zeilen(&pool).await;

        // Erst Menge, dann Ziel: zu viel an ein unbekanntes Ziel ist der Mengen-422, kein 404.
        let unbekannt = OrtPatch {
            einheit_id: Some(Some(9999)),
            ..OrtPatch::default()
        };
        assert_eq!(
            grund(
                teile_nach(&pool, einsatz, em, 40, unbekannt)
                    .await
                    .unwrap_err()
            ),
            "Abzuteilende Menge muss kleiner als die Menge sein"
        );
        assert_eq!(
            code(teile_nach(&pool, einsatz, em, 5, unbekannt).await),
            404
        );
        sqlx::query("UPDATE uhs SET status = 'aufgeloest' WHERE id = ?")
            .bind(uhs)
            .execute(&pool)
            .await
            .unwrap();
        let an_uhs = OrtPatch {
            uhs_id: Some(Some(uhs)),
            ..OrtPatch::default()
        };
        assert_eq!(code(teile_nach(&pool, einsatz, em, 5, an_uhs).await), 422);
        sqlx::query(
            "UPDATE einsatz_fahrzeug SET beendet_at = '2026-10-14 10:00:00', \
                 beendet_als = 'entlassen' WHERE id = ?",
        )
        .bind(fahrzeug)
        .execute(&pool)
        .await
        .unwrap();
        let an_fahrzeug = OrtPatch {
            einsatz_fahrzeug_id: Some(Some(fahrzeug)),
            ..OrtPatch::default()
        };
        assert_eq!(
            code(teile_nach(&pool, einsatz, em, 5, an_fahrzeug).await),
            409
        );
        assert_eq!(
            zeilen(&pool).await,
            vorher,
            "keine Ablehnung legt eine Zeile an"
        );
        assert_eq!(
            load_anzeige(&pool, einsatz, em, true).await.unwrap().menge,
            40,
            "keine Ablehnung mindert die Ausgangszeile"
        );
    }

    /// LLH-1093 Aufgabe 4.4 (LLH-1079 D3): die Teilzeile hat die Storno-Frist der Ausgangszeile.
    /// Frisch disponiert lässt sie sich stornieren; ist die Frist der Ausgangszeile abgelaufen
    /// oder war sie schon einmal herausgenommen, nicht.
    #[tokio::test]
    async fn teilzeile_erbt_die_storno_frist() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Decke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 10, benutzer)
            .await
            .unwrap();
        let frisch = teile(&pool, einsatz, em, 2).await.unwrap();
        storniere(&pool, einsatz, frisch).await.unwrap();

        sqlx::query(
            "UPDATE einsatz_material SET disponiert_at = datetime('now', '-20 minutes') WHERE id = ?",
        )
        .bind(em)
        .execute(&pool)
        .await
        .unwrap();
        let spaet = teile(&pool, einsatz, em, 2).await.unwrap();
        assert!(grund(storniere(&pool, einsatz, spaet).await.unwrap_err())
            .contains("nur in den ersten 15 Minuten nach der Disposition"));

        // Herausgenommen und erneut disponiert: die Sperre geht mit (Migration 0195).
        nimm_heraus(&pool, einsatz, em, benutzer).await.unwrap();
        let mut conn = pool.acquire().await.unwrap();
        reaktivieren_tx(&mut conn, einsatz, 1, em, benutzer)
            .await
            .unwrap();
        drop(conn);
        let nach_herausnahme = teile(&pool, einsatz, em, 1).await.unwrap();
        assert!(grund(
            storniere(&pool, einsatz, nach_herausnahme)
                .await
                .unwrap_err()
        )
        .starts_with("Das Material war schon einmal aus dem Einsatz genommen"));
    }

    async fn nimm_heraus(
        pool: &SqlitePool,
        einsatz: i64,
        em: i64,
        benutzer: i64,
    ) -> Result<Entlassen, AppError> {
        let mut tx = pool.begin().await.unwrap();
        let e = entlassen_tx(&mut tx, einsatz, em, benutzer, "2099-01-01 00:00:00").await?;
        tx.commit().await.unwrap();
        Ok(e)
    }

    async fn storniere(pool: &SqlitePool, einsatz: i64, em: i64) -> Result<(), AppError> {
        let jetzt: String = sqlx::query_scalar("SELECT datetime('now')")
            .fetch_one(pool)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        stornieren_tx(&mut tx, einsatz, em, 1, &jetzt).await?;
        tx.commit().await.unwrap();
        Ok(())
    }

    fn grund(e: AppError) -> String {
        match e {
            AppError::UnprocessableEntity(g) => g,
            e => panic!("422 erwartet, bekam {e:?}"),
        }
    }

    /// design.md D4, LLH-1224 D13: Herausnehmen löst den einen Ort (alle vier Spalten) und
    /// meldet ihn; an einer Einheit nennt es zusätzlich deren Namen für den ETB-Text.
    #[tokio::test]
    async fn herausnehmen_loest_den_ort() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Trage"))
            .await
            .unwrap();
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let u: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'behandlungsplatz', 'BHP 50', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .bind(benutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        for ort in [MaterialOrt::Einheit(einheit), MaterialOrt::Uhs(u)] {
            let em = disponiere_stamm(&pool, einsatz, 1, m.id, 2, benutzer)
                .await
                .unwrap();
            let mut conn = pool.acquire().await.unwrap();
            ort::set_ort_tx(&mut conn, einsatz, em, Some(ort))
                .await
                .unwrap();
            drop(conn);
            let e = nimm_heraus(&pool, einsatz, em, benutzer).await.unwrap();
            assert_eq!(e.ort, Some(ort));
            let einheit_erwartet = match ort {
                MaterialOrt::Einheit(_) => Some((einheit, "1. Zug".to_string())),
                _ => None,
            };
            assert_eq!(e.einheit, einheit_erwartet);
            let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
            assert_eq!(a.ort(), None, "{ort:?}");
        }
        assert!(list_je_uhs(&pool, einsatz, u, true)
            .await
            .unwrap()
            .is_empty());
    }

    /// design.md D3: Storno direkt nach der Disposition; Einheit, UHS und Frist verhindern ihn.
    #[tokio::test]
    async fn storno_regeln_fuer_material() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Decke"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 5, benutzer)
            .await
            .unwrap();
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_material SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(em)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            grund(storniere(&pool, einsatz, em).await.unwrap_err()),
            "Das Material gehört einer Einheit an; erst lösen oder das Material aus dem Einsatz \
             nehmen"
        );
        sqlx::query(
            "UPDATE einsatz_material SET einheit_id = NULL, \
             disponiert_at = datetime('now', '-20 minutes') WHERE id = ?",
        )
        .bind(em)
        .execute(&pool)
        .await
        .unwrap();
        let frist = grund(storniere(&pool, einsatz, em).await.unwrap_err());
        assert!(frist.contains("nur in den ersten 15 Minuten nach der Disposition"));
        assert!(frist.ends_with("das Material lässt sich aus dem Einsatz nehmen"));
        sqlx::query("UPDATE einsatz_material SET disponiert_at = datetime('now') WHERE id = ?")
            .bind(em)
            .execute(&pool)
            .await
            .unwrap();
        storniere(&pool, einsatz, em).await.unwrap();
        assert!(list(&pool, einsatz, true).await.unwrap().is_empty());
        assert!(list_entlassene(&pool, einsatz, true)
            .await
            .unwrap()
            .is_empty());
        assert!(matches!(
            storniere(&pool, einsatz, em).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    /// design.md D7: herausgenommenes Material kommt über `reaktivieren_tx` zurück, mit Menge und
    /// Status; danach sperrt die frühere Herausnahme den Storno (Migration 0195).
    #[tokio::test]
    async fn reaktivieren_behaelt_menge_und_status_und_sperrt_storno() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Pumpe"))
            .await
            .unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 3, benutzer)
            .await
            .unwrap();
        update(
            &pool,
            einsatz,
            em,
            MaterialPatch {
                status: Some(MaterialStatus::Defekt),
                ..MaterialPatch::default()
            },
        )
        .await
        .unwrap();
        nimm_heraus(&pool, einsatz, em, benutzer).await.unwrap();
        let mut conn = pool.acquire().await.unwrap();
        reaktivieren_tx(&mut conn, einsatz, 1, em, benutzer)
            .await
            .unwrap();
        assert!(matches!(
            reaktivieren_tx(&mut conn, einsatz, 1, em, benutzer)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        drop(conn);
        let a = load_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.beendet_at, None);
        assert_eq!((a.menge, a.status), (3, MaterialStatus::Defekt));
        assert!(grund(storniere(&pool, einsatz, em).await.unwrap_err())
            .starts_with("Das Material war schon einmal aus dem Einsatz genommen"));
        // Außer Dienst gestelltes Stamm-Material kommt nicht zurück (422, Zustand).
        nimm_heraus(&pool, einsatz, em, benutzer).await.unwrap();
        sqlx::query("UPDATE material SET dienststatus = 'ausser_dienst' WHERE id = ?")
            .bind(m.id)
            .execute(&pool)
            .await
            .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        assert!(matches!(
            reaktivieren_tx(&mut conn, einsatz, 1, em, benutzer)
                .await
                .unwrap_err(),
            AppError::UnprocessableEntity(_)
        ));
    }
}
