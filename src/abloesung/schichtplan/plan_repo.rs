//! Gemeinsamer Kern der Schreib- und Prüfwege von Schichtplan (Einsatz) und Vorplanung
//! (LLH-1684, design.md D1–D4 der Change `y106s29r-blockplan-kern`). Beide Pläne teilen Raster,
//! Soll, Personen- und Qualifikationsprüfung, Höchstzahlen und die Helferwege; ihre Tabellen
//! bleiben getrennt.
//!
//! Was eine Seite vom Kern unterscheidet, steht in [`Planart`]: Tabellen und Spalten als
//! `&'static str`-Konstanten (nur sie gehen per `format!` ins SQL, Werte bleiben gebunden, Muster
//! `vorlagendokument::repo`), Wortlaute als Konstanten, Abweichungen im Ablauf als Methoden. Die
//! beiden Arten sind `abloesung::schichtplan::repo::Einsatzplan` und
//! `planung::repo::Vorplanung`; sie tragen die Kennung ihres Plans.

use std::future::Future;

use sqlx::SqliteConnection;

use super::{PlanHelferAnzeige, PlanPerson, PlanPersonArt, PLAN_BLOECKE_MAX, PLAN_HELFER_MAX};
use crate::error::AppError;
use crate::zeit;
use crate::zeitdarstellung::Zeitstil;

/// Was eine Planart vom Kern unterscheidet. Der Wert ist der Plan selbst (seine Kennung); alles
/// Feste steht in Konstanten.
pub(crate) trait Planart: Sync {
    /// Der Posten eines Blocks: Einheit, UHS oder Pause im Einsatz, ein Planungsposten oder die
    /// Pause in der Vorplanung.
    type Posten: Copy + PartialEq + Send + Sync;

    /// Tabelle der Blöcke.
    const SCHICHT: &'static str;
    /// Tabelle der Helfer.
    const HELFER: &'static str;
    /// Spalte, die Blöcke und Helfer an ihren Plan bindet.
    const SCOPE: &'static str;
    /// Die Spalten eines Helfers für [`PlanHelferAnzeige`] (`kennung` und `herkunft` gibt es nur
    /// im Einsatz).
    const HELFER_SPALTEN: &'static str;
    /// Der Plan in „Höchstens … je {JE}“.
    const JE: &'static str;

    /// Die Kennung des Plans (Wert der Spalte [`Self::SCOPE`]).
    fn id(&self) -> i64;

    /// Vor jedem Schreibweg, als Erstes in seiner Transaktion: liefert die Organisation des Plans.
    /// Die Vorplanung prüft hier den Schreibschutz nach der Übernahme (409) und erhöht `stand`.
    fn before_write_tx(
        &self,
        conn: &mut SqliteConnection,
    ) -> impl Future<Output = Result<i64, AppError>> + Send;

    /// Die Posten der Blöcke, in denen ein Helfer steht, bevor er gelöscht wird (der Einsatz zieht
    /// danach die Schichten ihrer Einheiten nach). Vorgabe: keine.
    fn helfer_posten_tx(
        &self,
        _conn: &mut SqliteConnection,
        _hid: i64,
    ) -> impl Future<Output = Result<Vec<Self::Posten>, AppError>> + Send {
        async { Ok(Vec::new()) }
    }
}

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------

/// Ein gespeicherter Zeitpunkt (400, wenn er sich nicht lesen lässt).
pub(crate) fn utc(wert: &str) -> Result<chrono::DateTime<chrono::Utc>, AppError> {
    zeit::parse_utc(wert)
        .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{wert}'")))
}

/// Eine gespeicherte Kennungsliste (JSON-Array); leer, wenn es keine gibt.
pub(crate) fn json_ids(json: Option<&str>) -> Vec<i64> {
    json.and_then(|j| serde_json::from_str::<Vec<i64>>(j).ok())
        .unwrap_or_default()
}

/// Die Kennungen einer Art von Personen als JSON-Array, in ihrer Reihenfolge (für `json_each`).
pub(crate) fn ids_json(personen: &[PlanPerson], art: PlanPersonArt) -> String {
    let ids: Vec<i64> = personen
        .iter()
        .filter(|p| p.art() == art)
        .map(|p| p.id())
        .collect();
    serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into())
}

/// Die Qualifikationen eines Helfers in gespeicherter Form; keine = `NULL`.
pub(crate) fn quals_json(ids: &[i64]) -> Option<String> {
    (!ids.is_empty()).then(|| serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()))
}

/// Ein Zeitraum für einen Servertext in der Zone des Plans.
pub(crate) fn zeitraum_text(stil: &Zeitstil, von: &str, bis: &str) -> String {
    match (zeit::parse_utc(von), zeit::parse_utc(bis)) {
        (Some(a), Some(b)) => stil.zeitraum(a, b),
        _ => format!("{von}–{bis}"),
    }
}

/// Jede Qualifikation gehört zur Organisation (422 sonst).
pub(crate) async fn check_qualifikationen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    let fremd: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN qualifikation q ON q.id = j.value AND q.org_id = ?2 WHERE q.id IS NULL",
    )
    .bind(serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()))
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?;
    if fremd > 0 {
        return Err(AppError::UnprocessableEntity(
            "Qualifikation gehört nicht zur Organisation".into(),
        ));
    }
    Ok(())
}

/// Höchstens [`PLAN_BLOECKE_MAX`] Blöcke je Plan, mit `neu` weiteren (422 sonst).
pub(crate) async fn check_anzahl_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    neu: usize,
) -> Result<(), AppError> {
    let bisher: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM {} WHERE {} = ?",
        A::SCHICHT,
        A::SCOPE
    )))
    .bind(plan.id())
    .fetch_one(&mut *conn)
    .await?;
    if bisher + neu as i64 > PLAN_BLOECKE_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Höchstens {PLAN_BLOECKE_MAX} Schichten je {}",
            A::JE
        )));
    }
    Ok(())
}

/// Die Pause hat kein Soll (422).
pub(crate) fn check_pause_ohne_soll(
    ist_pause: bool,
    soll: Option<i64>,
    quali: Option<&str>,
) -> Result<(), AppError> {
    if ist_pause && (soll.is_some() || quali.is_some()) {
        return Err(AppError::UnprocessableEntity(
            "Die Pause hat kein Soll".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------------------------

/// Ein Helfer, Felder schon geprüft und getrimmt.
#[derive(Debug, Clone)]
pub struct HelferEingabe {
    pub name: String,
    pub telefon: Option<String>,
    pub organisation: Option<String>,
    pub qualifikationen: Vec<i64>,
}

/// Änderung eines Helfers. Fehlt = unverändert, `Some(None)` = leeren.
#[derive(Debug, Clone, Default)]
pub struct HelferPatch {
    pub name: Option<String>,
    pub telefon: Option<Option<String>>,
    pub organisation: Option<Option<String>>,
    pub qualifikationen: Option<Vec<i64>>,
}

/// Eine Zeile aus [`Planart::HELFER`] über [`Planart::HELFER_SPALTEN`].
#[derive(sqlx::FromRow)]
struct HelferZeile {
    id: i64,
    name: String,
    telefon: Option<String>,
    organisation: Option<String>,
    qualifikationen: Option<String>,
    kennung: Option<String>,
    herkunft: Option<String>,
}

impl From<HelferZeile> for PlanHelferAnzeige {
    fn from(z: HelferZeile) -> Self {
        PlanHelferAnzeige {
            id: z.id,
            name: z.name,
            telefon: z.telefon,
            organisation: z.organisation,
            qualifikationen: json_ids(z.qualifikationen.as_deref()),
            kennung: z.kennung,
            herkunft: z.herkunft,
        }
    }
}

/// Die Helfer des Plans, nach Name.
pub(crate) async fn load_helfer_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
) -> Result<Vec<PlanHelferAnzeige>, AppError> {
    let zeilen: Vec<HelferZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {} FROM {} WHERE {} = ? ORDER BY name COLLATE NOCASE, id",
        A::HELFER_SPALTEN,
        A::HELFER,
        A::SCOPE
    )))
    .bind(plan.id())
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen.into_iter().map(PlanHelferAnzeige::from).collect())
}

/// Ein Helfer des Plans; fremd oder unbekannt 404.
async fn load_one_helfer_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    hid: i64,
) -> Result<PlanHelferAnzeige, AppError> {
    let zeile: HelferZeile = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {} FROM {} WHERE id = ? AND {} = ?",
        A::HELFER_SPALTEN,
        A::HELFER,
        A::SCOPE
    )))
    .bind(hid)
    .bind(plan.id())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zeile.into())
}

/// Legt einen Helfer an: Qualifikationen der Organisation (422), höchstens [`PLAN_HELFER_MAX`]
/// je Plan (422).
pub(crate) async fn create_helfer_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    benutzer_id: i64,
    eingabe: &HelferEingabe,
) -> Result<PlanHelferAnzeige, AppError> {
    let org_id = plan.before_write_tx(conn).await?;
    check_qualifikationen_tx(conn, org_id, &eingabe.qualifikationen).await?;
    let bisher: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM {} WHERE {} = ?",
        A::HELFER,
        A::SCOPE
    )))
    .bind(plan.id())
    .fetch_one(&mut *conn)
    .await?;
    if bisher >= PLAN_HELFER_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Höchstens {PLAN_HELFER_MAX} Helfer je {}",
            A::JE
        )));
    }
    let hid: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "INSERT INTO {} ({}, name, telefon, organisation, qualifikationen, angelegt_von) \
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        A::HELFER,
        A::SCOPE
    )))
    .bind(plan.id())
    .bind(&eingabe.name)
    .bind(&eingabe.telefon)
    .bind(&eingabe.organisation)
    .bind(quals_json(&eingabe.qualifikationen))
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    load_one_helfer_tx(conn, plan, hid).await
}

/// Ändert einen Helfer; fremd oder unbekannt 404, fremde Qualifikation 422.
pub(crate) async fn update_helfer_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    hid: i64,
    patch: &HelferPatch,
) -> Result<PlanHelferAnzeige, AppError> {
    let org_id = plan.before_write_tx(conn).await?;
    let mut h = load_one_helfer_tx(conn, plan, hid).await?;
    if let Some(ids) = &patch.qualifikationen {
        check_qualifikationen_tx(conn, org_id, ids).await?;
        h.qualifikationen = ids.clone();
    }
    if let Some(name) = &patch.name {
        h.name = name.clone();
    }
    if let Some(t) = &patch.telefon {
        h.telefon = t.clone();
    }
    if let Some(o) = &patch.organisation {
        h.organisation = o.clone();
    }
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE {} SET name = ?, telefon = ?, organisation = ?, qualifikationen = ? WHERE id = ?",
        A::HELFER
    )))
    .bind(&h.name)
    .bind(&h.telefon)
    .bind(&h.organisation)
    .bind(quals_json(&h.qualifikationen))
    .bind(hid)
    .execute(&mut *conn)
    .await?;
    Ok(h)
}

/// Löscht einen Helfer und nimmt ihn aus allen Blöcken (CASCADE); fremd oder unbekannt 404.
/// Liefert die Posten der Blöcke, in denen er stand ([`Planart::helfer_posten_tx`]).
pub(crate) async fn delete_helfer_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    hid: i64,
) -> Result<Vec<A::Posten>, AppError> {
    plan.before_write_tx(conn).await?;
    let posten = plan.helfer_posten_tx(conn, hid).await?;
    let geloescht = sqlx::query(sqlx::AssertSqlSafe(format!(
        "DELETE FROM {} WHERE id = ? AND {} = ?",
        A::HELFER,
        A::SCOPE
    )))
    .bind(hid)
    .bind(plan.id())
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if geloescht == 0 {
        return Err(AppError::NotFound);
    }
    Ok(posten)
}
