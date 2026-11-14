//! Hilfen innerhalb der Transaktion: Einheit, Abschnitt, Ablöser, Besatzungsplan, Spiegel, Rohzeile.

use super::*;

// ── Hilfen innerhalb der Transaktion ────────────────────────────────────────────────────────

/// Name und Abschnitt einer aktiven Einheit des Einsatzes. `NotFound`, wenn sie nicht
/// dazugehört, `Conflict`, wenn sie aufgelöst ist: eine aufgelöste Einheit bekommt keine
/// Schicht und löst niemanden ab (LLH-1079, Spec `kraefte-entlassung`).
pub(super) async fn einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<(String, Option<i64>), AppError> {
    crate::einheit::repo::require_aktiv_tx(conn, einsatz_id, einheit_id).await?;
    sqlx::query_as("SELECT name, abschnitt_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
}

/// Name und Vorgabe eines Abschnitts.
pub(super) async fn abschnitt_tx(
    conn: &mut SqliteConnection,
    abschnitt_id: i64,
) -> Result<Option<(String, Option<i64>)>, AppError> {
    Ok(
        sqlx::query_as(
            "SELECT name, abloesung_rhythmus_minuten FROM einsatzabschnitt WHERE id = ?",
        )
        .bind(abschnitt_id)
        .fetch_optional(&mut *conn)
        .await?,
    )
}

pub(super) async fn has_laufende_tx(
    conn: &mut SqliteConnection,
    einheit_id: i64,
) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_abloesung WHERE einheit_id = ? AND status = 'laufend'",
    )
    .bind(einheit_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.is_some())
}

/// Ein geprüfter Ablöser: aktive Einheit des Einsatzes, nicht die abgelöste selbst.
#[derive(Debug, Clone)]
pub(super) struct Abloeser {
    pub(super) id: i64,
    pub(super) name: String,
}

/// Prüft eine Liste von Ablösern (LLH-1132) mit EINER Abfrage über `json_each` (`src/AGENTS.md`,
/// „Eingabegrenzen“): die Einheit selbst → 422, eine fremde oder unbekannte → 404, eine
/// aufgelöste → 409 (wie [`einheit_tx`]). Liefert die Ablöser in der Reihenfolge der Liste.
pub(super) async fn check_abloeser_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    selbst: i64,
    ids: &[i64],
) -> Result<Vec<Abloeser>, AppError> {
    if ids.contains(&selbst) {
        return Err(AppError::UnprocessableEntity(
            "Eine Einheit kann sich nicht selbst ablösen".into(),
        ));
    }
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let json = serde_json::to_string(ids).map_err(|e| AppError::Internal(e.to_string()))?;
    let zeilen: Vec<(i64, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT j.value, e.name, e.aufgeloest_at FROM json_each(?) j \
         LEFT JOIN einsatz_einheit e ON e.id = j.value AND e.einsatz_id = ? ORDER BY j.key",
    )
    .bind(json)
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    zeilen
        .into_iter()
        .map(|(id, name, aufgeloest)| match (name, aufgeloest) {
            (None, _) => Err(AppError::NotFound),
            (Some(name), Some(_)) => Err(AppError::Conflict(format!(
                "Die Einheit «{name}» ist aufgelöst"
            ))),
            (Some(name), None) => Ok(Abloeser { id, name }),
        })
        .collect()
}

/// Die Ablöser einer Schicht in ihrer Reihenfolge (`rowid` = Reihenfolge der Anlage).
pub(super) async fn load_abloeser_ids_tx(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT einheit_id FROM einsatz_abloesung_abloeser WHERE abloesung_id = ? ORDER BY rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Ersetzt die Liste der Ablöser einer Schicht (Reihenfolge wie übergeben, EINE Anweisung über
/// `json_each`) und zieht den Spiegel nach. Einziger Schreibweg der Liste und des Spiegels
/// `abloesende_einheit_id` (= erster Eintrag, Migration 0215) neben [`sync_spiegel_tx`] und den
/// beiden Wegen der Entlassung ([`drop_planungen_tx`] nimmt einen Eintrag heraus,
/// [`restore_entfallene_planungen_tx`] hängt ihn wieder an). Räumt den Vermerk einer entfallenen
/// Planung (LLH-1309): jede Planung, Umplanung, Leerung und der Vollzug machen ihn
/// gegenstandslos, auch für das Zurückholen (LLH-1510).
pub(super) async fn set_abloeser_tx(
    conn: &mut SqliteConnection,
    id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE einsatz_abloesung SET planung_entfallen_at = NULL, \
            planung_entfallen_grund = NULL, planung_entfallen_einheit_name = NULL, \
            planung_entfallen_entlassung_id = NULL WHERE id = ?",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM einsatz_abloesung_abloeser WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    if !ids.is_empty() {
        let json = serde_json::to_string(ids).map_err(|e| AppError::Internal(e.to_string()))?;
        sqlx::query(
            "INSERT INTO einsatz_abloesung_abloeser (abloesung_id, einheit_id) \
             SELECT ?, j.value FROM json_each(?) j ORDER BY j.key",
        )
        .bind(id)
        .bind(json)
        .execute(&mut *conn)
        .await?;
    }
    sync_spiegel_tx(conn, id).await
}

/// Ziele einer neuen Besatzung als JSON für `json_each` (`p` Person, `e` Einheit, `f` Fahrzeug).
pub(super) fn ziele_json(ziele: &[BesatzungZiel]) -> Result<String, AppError> {
    serde_json::to_string(
        &ziele
            .iter()
            .map(|z| serde_json::json!({"p": z.personal_id, "e": z.einheit_id, "f": z.fahrzeug_id}))
            .collect::<Vec<_>>(),
    )
    .map_err(|e| AppError::Internal(e.to_string()))
}

/// Der geplante Besatzungswechsel einer Schicht in seiner Reihenfolge (LLH-1319).
pub(super) async fn load_besatzung_plan_tx(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Vec<BesatzungZiel>, AppError> {
    let zeilen: Vec<(i64, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT personal_id, einheit_id, fahrzeug_id FROM einsatz_abloesung_besatzung_plan \
         WHERE abloesung_id = ? ORDER BY rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|(personal_id, einheit_id, fahrzeug_id)| BesatzungZiel {
            personal_id,
            einheit_id,
            fahrzeug_id,
        })
        .collect())
}

/// Ersetzt den geplanten Besatzungswechsel einer Schicht (LLH-1319, Reihenfolge wie übergeben,
/// EINE Anweisung über `json_each`). Einziger Schreibweg von `einsatz_abloesung_besatzung_plan`;
/// eine leere Liste hebt die Planung auf. Der Vollzug lässt die Zeilen stehen, damit die Rücknahme
/// die Planung wiederfindet.
pub(super) async fn set_besatzung_plan_tx(
    conn: &mut SqliteConnection,
    id: i64,
    ziele: &[BesatzungZiel],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_abloesung_besatzung_plan WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    if !ziele.is_empty() {
        let json = ziele_json(ziele)?;
        sqlx::query(
            "INSERT INTO einsatz_abloesung_besatzung_plan \
                (abloesung_id, personal_id, einheit_id, fahrzeug_id) \
             SELECT ?, json_extract(j.value, '$.p'), json_extract(j.value, '$.e'), \
                    json_extract(j.value, '$.f') \
             FROM json_each(?) j ORDER BY j.key",
        )
        .bind(id)
        .bind(json)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// `abloesende_einheit_id` = erster Ablöser der Liste, NULL ohne einen.
pub(super) async fn sync_spiegel_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE einsatz_abloesung SET abloesende_einheit_id = \
            (SELECT einheit_id FROM einsatz_abloesung_abloeser WHERE abloesung_id = ?1 \
             ORDER BY rowid LIMIT 1) \
         WHERE id = ?1",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Ob ein Vorfahr der Einheit (über `ueber_einheit_id`) in `menge` liegt. Löst ein Verband ab,
/// bilden nur die Ablöser ohne Vorfahren in der Liste den Knoten (LLH-1118 Punkt 3); die übrigen
/// erben dessen Folgeschicht. Iterativ mit Besucht-Menge wie [`vererbung`].
pub(super) fn has_vorfahr_in(
    ueber: &HashMap<i64, Option<i64>>,
    einheit: i64,
    menge: &HashSet<i64>,
) -> bool {
    let mut besucht = HashSet::from([einheit]);
    let mut knoten = ueber.get(&einheit).copied().flatten();
    while let Some(k) = knoten {
        if !besucht.insert(k) {
            return false;
        }
        if menge.contains(&k) {
            return true;
        }
        knoten = ueber.get(&k).copied().flatten();
    }
    false
}

/// Die Untereinheiten, die die laufende Schicht von `traeger` gerade erben, nach ID.
pub(super) async fn load_erben_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    traeger: i64,
) -> Result<Vec<i64>, AppError> {
    let g = load_gliederung(&mut *conn, einsatz_id).await?;
    let mut erben: Vec<i64> = vererbung(&g.ueber, &g.mit_schicht)
        .into_iter()
        .filter_map(|(erbe, t)| (t == traeger).then_some(erbe))
        .collect();
    erben.sort_unstable();
    Ok(erben)
}

/// Rohdaten einer Schicht für die Schreibpfade.
#[derive(sqlx::FromRow)]
pub(super) struct Roh {
    pub(super) einheit_id: i64,
    pub(super) abschnitt_id: Option<i64>,
    pub(super) beginn_at: String,
    pub(super) rhythmus_minuten: i64,
    #[sqlx(try_from = "String")]
    pub(super) rhythmus_quelle: RhythmusQuelle,
    pub(super) faellig_at: String,
    #[sqlx(try_from = "String")]
    pub(super) status: AbloesungStatus,
    pub(super) vollzogen_at: Option<String>,
    pub(super) etb_vollzug_id: Option<i64>,
    #[sqlx(try_from = "String")]
    pub(super) art: AbloesungArt,
    #[sqlx(try_from = "String")]
    pub(super) verbleib: AbloesungVerbleib,
    /// Die Fälligkeit kommt aus dem Schichtplan (LLH-1555).
    pub(super) faellig_laut_plan: bool,
    /// Der Block, in den ein Vollzug aus dem Plan gewechselt hat (Anker, design.md D2).
    pub(super) plan_block_id: Option<i64>,
}

pub(super) async fn roh_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<Roh, AppError> {
    sqlx::query_as(
        "SELECT einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle, \
                faellig_at, status, vollzogen_at, etb_vollzug_id, art, verbleib, \
                faellig_laut_plan, plan_block_id \
         FROM einsatz_abloesung WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

pub(super) fn faellig_oder_400(beginn_at: &str, rhythmus: i64) -> Result<String, AppError> {
    faelligkeit(beginn_at, rhythmus)
        .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{beginn_at}'")))
}
