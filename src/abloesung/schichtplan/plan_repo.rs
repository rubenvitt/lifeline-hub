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

use std::collections::{BTreeMap, HashMap};
use std::future::Future;

use chrono::{DateTime, Utc};
use sqlx::query::Query;
use sqlx::sqlite::{SqliteArguments, SqliteRow};
use sqlx::{Row, Sqlite, SqliteConnection};

use super::pruefung::{self, Block, BlockErgebnis, Ergebnis, Grundlage, PersonStand};
use super::{
    zerlegung, PlanHelferAnzeige, PlanPerson, PlanPersonAnzeige, PlanPersonArt, Posten,
    SchichtplanGrenzwerte, PLAN_BLOECKE_MAX, PLAN_HELFER_MAX,
};
use crate::error::{AppError, ZeilenArt, ZeilenGrund};
use crate::personal::quali_soll::QualiSoll;
use crate::zeit;
use crate::zeitdarstellung::Zeitstil;

/// Eine Abfrage, an die [`Planart::bind_posten`] die Spalten des Postens bindet.
pub(crate) type PostenQuery<'q> = Query<'q, Sqlite, SqliteArguments>;

/// Was eine Planart vom Kern unterscheidet. Der Wert ist der Plan selbst (seine Kennung); alles
/// Feste steht in Konstanten, jede Abweichung im Ablauf in einer Methode, die der Kern an
/// derselben Stelle der Prüfreihenfolge ruft wie die Seite vorher.
pub(crate) trait Planart: Sync {
    /// Der Posten eines Blocks: Einheit, UHS oder Pause im Einsatz, ein Planungsposten oder die
    /// Pause (`None`) in der Vorplanung.
    type Posten: Copy + PartialEq + Send + Sync;
    /// Eine Zeile aus [`Self::SELECT_BLOECKE`].
    type BlockZeile: for<'r> sqlx::FromRow<'r, SqliteRow> + Send + Unpin;
    /// Was der Aufrufer beim Löschen eines Blocks darf ([`Self::check_delete_tx`]).
    type DeleteRecht: Copy + Send + Sync;

    /// Tabelle der Blöcke.
    const SCHICHT: &'static str;
    /// Tabelle der Personen je Block.
    const PERSON: &'static str;
    /// Spalte in [`Self::PERSON`], die auf den Block zeigt.
    const PERSON_FK: &'static str;
    /// Tabelle der Helfer.
    const HELFER: &'static str;
    /// Spalte, die Blöcke und Helfer an ihren Plan bindet.
    const SCOPE: &'static str;
    /// Die Spalten des Postens in [`Self::SCHICHT`], in der Reihenfolge von
    /// [`Self::bind_posten`].
    const POSTEN_SPALTEN: &'static [&'static str];
    /// Die Blöcke des Plans in ihrer Reihenfolge, als [`Self::BlockZeile`]; ein Parameter, die
    /// Kennung des Plans.
    const SELECT_BLOECKE: &'static str;
    /// Die Spalten eines Helfers für [`PlanHelferAnzeige`] (`kennung` und `herkunft` gibt es nur
    /// im Einsatz).
    const HELFER_SPALTEN: &'static str;
    /// Der Plan in „Höchstens … je {JE}“.
    const JE: &'static str;
    /// Der Plan im Dativ: „Ein Helfer gehört nicht zu {ZU_DIESEM}“.
    const ZU_DIESEM: &'static str;
    /// Der Plan mit unbestimmtem Artikel: „{MIT_ARTIKEL} kennt nur Stamm-Personal und Helfer“.
    const MIT_ARTIKEL: &'static str;
    /// Ob der Plan Ad-hoc-Kräfte kennt (Spalte `einsatz_personal_id` in [`Self::PERSON`]).
    const MIT_ADHOC: bool;
    /// Ob die Prüfung den Ist-Stand der Personen kennt (`pruefung::Grundlage::mit_ist`).
    const MIT_IST: bool;

    /// Die Kennung des Plans (Wert der Spalte [`Self::SCOPE`]).
    fn id(&self) -> i64;

    /// Ob der Posten die Pause ist (sie darf überlappen und hat kein Soll).
    fn is_pause(posten: Self::Posten) -> bool;

    /// Der Posten aus den Spalten [`Self::POSTEN_SPALTEN`] einer Zeile.
    fn posten_from_row(row: &SqliteRow) -> Result<Self::Posten, AppError>;

    /// Bindet die Werte der Spalten [`Self::POSTEN_SPALTEN`].
    fn bind_posten(query: PostenQuery<'_>, posten: Self::Posten) -> PostenQuery<'_>;

    /// Was der Kern aus einer Blockzeile braucht.
    fn block_kern(zeile: &Self::BlockZeile) -> Result<BlockKern<'_>, AppError>;

    /// Vor jedem Schreibweg, als Erstes in seiner Transaktion: liefert die Organisation des Plans.
    /// Die Vorplanung prüft hier den Schreibschutz nach der Übernahme (409) und erhöht `stand`.
    fn before_write_tx(
        &self,
        conn: &mut SqliteConnection,
    ) -> impl Future<Output = Result<i64, AppError>> + Send;

    /// Der Posten gehört zum Plan und besteht (422 sonst); liefert seine Vorgaben. Die Pause hat
    /// keine.
    fn check_posten_tx(
        &self,
        conn: &mut SqliteConnection,
        posten: Self::Posten,
    ) -> impl Future<Output = Result<PostenVorgabe, AppError>> + Send;

    /// Zone und Darstellung für Servertexte des Plans.
    fn zone_tx(
        &self,
        conn: &mut SqliteConnection,
    ) -> impl Future<Output = Result<Zeitstil, AppError>> + Send;

    /// Beim Ändern eines Blocks nach der Personenprüfung und vor der Überschneidung. Vorgabe:
    /// nichts.
    fn check_update_tx(
        &self,
        _conn: &mut SqliteConnection,
        _bid: i64,
        _alt: Self::Posten,
        _neu: Self::Posten,
    ) -> impl Future<Output = Result<(), AppError>> + Send {
        async { Ok(()) }
    }

    /// Beim Löschen eines Blocks nach dem CAS über `version`, vor dem Löschen.
    fn check_delete_tx(
        &self,
        conn: &mut SqliteConnection,
        bid: i64,
        recht: Self::DeleteRecht,
    ) -> impl Future<Output = Result<(), AppError>> + Send;

    /// Name und Stand jeder Person, die im Plan steht.
    fn load_personen_tx(
        &self,
        conn: &mut SqliteConnection,
    ) -> impl Future<Output = Result<BTreeMap<PlanPerson, PersonDaten>, AppError>> + Send;

    /// Die Unterstellung der Einheiten für die Prüfung (`pruefung::Grundlage::ueber_einheit`).
    /// Vorgabe: keine.
    fn load_ueber_einheit_tx(
        &self,
        _conn: &mut SqliteConnection,
    ) -> impl Future<Output = Result<HashMap<i64, Option<i64>>, AppError>> + Send {
        async { Ok(HashMap::new()) }
    }

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

/// Die Vorgaben eines Postens für neue Blöcke.
#[derive(Debug, Clone, Default)]
pub(crate) struct PostenVorgabe {
    pub soll_anzahl: Option<i64>,
    /// Gespeicherte Form (`personal::quali_soll::form`).
    pub quali_soll: Option<String>,
    pub bezeichnung: Option<String>,
    /// Länge je Schicht für „Schichten erzeugen“.
    pub schichtlaenge: Option<i64>,
}

/// Was der Kern aus einer Blockzeile braucht ([`Planart::block_kern`]).
pub(crate) struct BlockKern<'a> {
    pub id: i64,
    /// Der neutrale Schlüssel des Postens in der Prüfung.
    pub posten: Posten,
    pub von: &'a str,
    pub bis: &'a str,
    pub soll_anzahl: Option<i64>,
    pub quali_soll: Option<&'a QualiSoll>,
}

/// Name und Stand einer Person im Plan.
pub(crate) struct PersonDaten {
    pub name: String,
    pub stand: PersonStand,
}

/// Ein neuer Block, Felder schon geprüft (Handler). Zeiten im kanonischen Format.
#[derive(Debug, Clone)]
pub struct BlockEingabe<P> {
    pub posten: P,
    pub von: String,
    pub bis: String,
    /// Fehlt = Vorgabe des Postens; `Some(None)` = kein Soll.
    pub soll_anzahl: Option<Option<i64>>,
    /// Gespeicherte Form (`personal::quali_soll::form`); fehlt = Vorgabe des Postens.
    pub quali_soll: Option<Option<String>>,
    pub personen: Vec<PlanPerson>,
    pub notiz: Option<String>,
}

/// Änderung eines Blocks, Felder schon geprüft. Fehlt = unverändert.
#[derive(Debug, Clone)]
pub struct BlockPatch<P> {
    pub version: i64,
    pub posten: Option<P>,
    pub von: Option<String>,
    pub bis: Option<String>,
    pub soll_anzahl: Option<Option<i64>>,
    pub quali_soll: Option<Option<String>>,
    /// Die ganze Liste.
    pub personen: Option<Vec<PlanPerson>>,
    pub notiz: Option<Option<String>>,
}

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------

/// Ein gespeicherter Zeitpunkt (400, wenn er sich nicht lesen lässt).
pub(crate) fn utc(wert: &str) -> Result<DateTime<Utc>, AppError> {
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

// ---------------------------------------------------------------------------------------------
// Personen eines Blocks
// ---------------------------------------------------------------------------------------------

/// Jede Person gehört zur Organisation bzw. zum Plan (422 sonst); eine Abfrage je Art über
/// `json_each` (`src/AGENTS.md`, „Eingabegrenzen“). Ad-hoc-Kräfte nur mit
/// [`Planart::MIT_ADHOC`].
pub(crate) async fn check_personen_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    org_id: i64,
    personen: &[PlanPerson],
) -> Result<(), AppError> {
    if personen.is_empty() {
        return Ok(());
    }
    if !A::MIT_ADHOC && personen.iter().any(|p| p.art() == PlanPersonArt::Einsatz) {
        return Err(AppError::UnprocessableEntity(format!(
            "{} kennt nur Stamm-Personal und Helfer",
            A::MIT_ARTIKEL
        )));
    }
    let fremd_stamm: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN personal p ON p.id = j.value AND p.org_id = ?2 WHERE p.id IS NULL",
    )
    .bind(ids_json(personen, PlanPersonArt::Stamm))
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?;
    if fremd_stamm > 0 {
        return Err(AppError::UnprocessableEntity(
            "Eine Person gehört nicht zur Organisation".into(),
        ));
    }
    if A::MIT_ADHOC {
        let fremd_adhoc: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM json_each(?1) j \
             LEFT JOIN einsatz_personal ep \
               ON ep.id = j.value AND ep.{} = ?2 AND ep.personal_id IS NULL \
             WHERE ep.id IS NULL",
            A::SCOPE
        )))
        .bind(ids_json(personen, PlanPersonArt::Einsatz))
        .bind(plan.id())
        .fetch_one(&mut *conn)
        .await?;
        if fremd_adhoc > 0 {
            return Err(AppError::UnprocessableEntity(
                "Über einsatz_personal_id nur Ad-hoc-Kräfte dieses Einsatzes; Stamm-Personal über \
                 personal_id"
                    .into(),
            ));
        }
    }
    let fremd_helfer: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN {} h ON h.id = j.value AND h.{} = ?2 WHERE h.id IS NULL",
        A::HELFER,
        A::SCOPE
    )))
    .bind(ids_json(personen, PlanPersonArt::Helfer))
    .bind(plan.id())
    .fetch_one(&mut *conn)
    .await?;
    if fremd_helfer > 0 {
        return Err(AppError::UnprocessableEntity(format!(
            "Ein Helfer gehört nicht zu {}",
            A::ZU_DIESEM
        )));
    }
    Ok(())
}

/// Ersetzt die Personen eines Blocks, gruppiert nach Art (Stamm, Ad-hoc, Helfer), je Art in der
/// Reihenfolge der Liste; eine Anweisung je Art, unabhängig von der Zahl.
pub(crate) async fn write_personen_tx<A: Planart>(
    conn: &mut SqliteConnection,
    bid: i64,
    personen: &[PlanPerson],
) -> Result<(), AppError> {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DELETE FROM {} WHERE {} = ?",
        A::PERSON,
        A::PERSON_FK
    )))
    .bind(bid)
    .execute(&mut *conn)
    .await?;
    for (spalte, art) in [
        ("personal_id", PlanPersonArt::Stamm),
        ("einsatz_personal_id", PlanPersonArt::Einsatz),
        ("helfer_id", PlanPersonArt::Helfer),
    ] {
        if art == PlanPersonArt::Einsatz && !A::MIT_ADHOC {
            continue;
        }
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {} ({}, {spalte}) SELECT ?1, j.value FROM json_each(?2) j ORDER BY j.key",
            A::PERSON,
            A::PERSON_FK
        )))
        .bind(bid)
        .bind(ids_json(personen, art))
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Blöcke
// ---------------------------------------------------------------------------------------------

/// `a, b, c` aus [`Planart::POSTEN_SPALTEN`].
fn posten_spalten<A: Planart>() -> String {
    A::POSTEN_SPALTEN.join(", ")
}

/// `a = ?, b = ?` bzw. `a IS ? AND b IS ?` aus [`Planart::POSTEN_SPALTEN`].
fn posten_liste<A: Planart>(muster: &str, trenner: &str) -> String {
    A::POSTEN_SPALTEN
        .iter()
        .map(|s| format!("{s} {muster}"))
        .collect::<Vec<_>>()
        .join(trenner)
}

/// Alle Blöcke am Posten, die sich mit `[von, bis)` überschneiden (außer `ausser`), früheste
/// zuerst; die Pause darf überlappen. Anlegen und Ändern nennen den ersten, „Schichten erzeugen“
/// alle (LLH-1594).
pub(crate) async fn ueberschneidungen_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    posten: A::Posten,
    von: &str,
    bis: &str,
    ausser: Option<i64>,
) -> Result<Vec<(i64, String, String)>, AppError> {
    if A::is_pause(posten) {
        return Ok(Vec::new());
    }
    let sql = format!(
        "SELECT id, von, bis FROM {} WHERE {} = ? AND {} AND von < ? AND bis > ? AND id IS NOT ? \
         ORDER BY von, id",
        A::SCHICHT,
        A::SCOPE,
        posten_liste::<A>("IS ?", " AND ")
    );
    let query = sqlx::query(sqlx::AssertSqlSafe(sql)).bind(plan.id());
    let zeilen = A::bind_posten(query, posten)
        .bind(bis)
        .bind(von)
        .bind(ausser)
        .fetch_all(&mut *conn)
        .await?;
    zeilen
        .iter()
        .map(|z| Ok((z.try_get("id")?, z.try_get("von")?, z.try_get("bis")?)))
        .collect()
}

/// Kein anderer Block am Posten überschneidet sich (422 mit dem ersten, in der Zone des Plans).
async fn check_frei_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    posten: A::Posten,
    von: &str,
    bis: &str,
    ausser: Option<i64>,
) -> Result<(), AppError> {
    if let Some((_, a, b)) = ueberschneidungen_tx(conn, plan, posten, von, bis, ausser)
        .await?
        .into_iter()
        .next()
    {
        let stil = plan.zone_tx(conn).await?;
        return Err(AppError::UnprocessableEntity(format!(
            "Die Schicht überschneidet sich mit {}",
            zeitraum_text(&stil, &a, &b)
        )));
    }
    Ok(())
}

/// Schreibt einen Block ohne Prüfung. Liefert die Kennung.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_block_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    benutzer_id: i64,
    posten: A::Posten,
    von: &str,
    bis: &str,
    soll_anzahl: Option<i64>,
    quali_soll: Option<&str>,
    notiz: Option<&str>,
) -> Result<i64, AppError> {
    let sql = format!(
        "INSERT INTO {} ({}, {}, von, bis, soll_anzahl, quali_soll, notiz, angelegt_von) \
         VALUES (?, {}, ?, ?, ?, ?, ?, ?) RETURNING id",
        A::SCHICHT,
        A::SCOPE,
        posten_spalten::<A>(),
        vec!["?"; A::POSTEN_SPALTEN.len()].join(", ")
    );
    let query = sqlx::query(sqlx::AssertSqlSafe(sql)).bind(plan.id());
    let zeile = A::bind_posten(query, posten)
        .bind(von)
        .bind(bis)
        .bind(soll_anzahl)
        .bind(quali_soll)
        .bind(notiz)
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
    Ok(zeile.try_get(0)?)
}

/// Legt einen Block an, nach den Prüfungen in dieser Reihenfolge: Plan schreibbar, Posten (422),
/// Höchstzahl (422), Pause ohne Soll (422), Qualifikationssoll und Personen (422),
/// Überschneidung (422). Liefert die Kennung.
pub(crate) async fn create_block_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    benutzer_id: i64,
    eingabe: &BlockEingabe<A::Posten>,
) -> Result<i64, AppError> {
    let org_id = plan.before_write_tx(conn).await?;
    let vorgabe = plan.check_posten_tx(conn, eingabe.posten).await?;
    check_anzahl_tx(conn, plan, 1).await?;
    let soll_anzahl = eingabe.soll_anzahl.unwrap_or(vorgabe.soll_anzahl);
    let quali_soll = eingabe.quali_soll.clone().unwrap_or(vorgabe.quali_soll);
    check_pause_ohne_soll(
        A::is_pause(eingabe.posten),
        soll_anzahl,
        quali_soll.as_deref(),
    )?;
    crate::personal::quali_soll::pruefe_org(&mut *conn, org_id, quali_soll.as_deref()).await?;
    check_personen_tx(conn, plan, org_id, &eingabe.personen).await?;
    check_frei_tx(conn, plan, eingabe.posten, &eingabe.von, &eingabe.bis, None).await?;
    let bid = insert_block_tx(
        conn,
        plan,
        benutzer_id,
        eingabe.posten,
        &eingabe.von,
        &eingabe.bis,
        soll_anzahl,
        quali_soll.as_deref(),
        eingabe.notiz.as_deref(),
    )
    .await?;
    write_personen_tx::<A>(conn, bid, &eingabe.personen).await?;
    Ok(bid)
}

/// Ändert einen Block mit CAS über `version` (409). Verschieben in die Pause löscht das Soll; ein
/// Soll an der Pause ist 422. Liefert den Posten vorher und nachher.
pub(crate) async fn update_block_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    bid: i64,
    benutzer_id: i64,
    patch: &BlockPatch<A::Posten>,
    jetzt: &str,
) -> Result<[A::Posten; 2], AppError> {
    let org_id = plan.before_write_tx(conn).await?;
    let stand = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT version, {}, von, bis, soll_anzahl, quali_soll, notiz FROM {} \
         WHERE id = ? AND {} = ?",
        posten_spalten::<A>(),
        A::SCHICHT,
        A::SCOPE
    )))
    .bind(bid)
    .bind(plan.id())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    let version: i64 = stand.try_get("version")?;
    if version != patch.version {
        return Err(AppError::Conflict(
            "Die Schicht wurde zwischenzeitlich geändert".into(),
        ));
    }
    let posten_alt = A::posten_from_row(&stand)?;
    let posten = patch.posten.unwrap_or(posten_alt);
    if posten != posten_alt {
        plan.check_posten_tx(conn, posten).await?;
    }
    let von: String = match &patch.von {
        Some(v) => v.clone(),
        None => stand.try_get("von")?,
    };
    let bis: String = match &patch.bis {
        Some(b) => b.clone(),
        None => stand.try_get("bis")?,
    };
    zerlegung::pruefe_zeitraum(utc(&von)?, utc(&bis)?).map_err(|e| match e {
        AppError::Validation(m) => AppError::UnprocessableEntity(m),
        andere => andere,
    })?;
    let (mut soll_anzahl, mut quali_soll): (Option<i64>, Option<String>) =
        (stand.try_get("soll_anzahl")?, stand.try_get("quali_soll")?);
    if A::is_pause(posten) && !A::is_pause(posten_alt) {
        (soll_anzahl, quali_soll) = (None, None);
    }
    if let Some(neu) = patch.soll_anzahl {
        soll_anzahl = neu;
    }
    if let Some(neu) = &patch.quali_soll {
        quali_soll = neu.clone();
    }
    check_pause_ohne_soll(A::is_pause(posten), soll_anzahl, quali_soll.as_deref())?;
    if patch.quali_soll.is_some() {
        crate::personal::quali_soll::pruefe_org(&mut *conn, org_id, quali_soll.as_deref()).await?;
    }
    if let Some(personen) = &patch.personen {
        check_personen_tx(conn, plan, org_id, personen).await?;
    }
    plan.check_update_tx(conn, bid, posten_alt, posten).await?;
    check_frei_tx(conn, plan, posten, &von, &bis, Some(bid)).await?;
    let notiz: Option<String> = match &patch.notiz {
        Some(n) => n.clone(),
        None => stand.try_get("notiz")?,
    };
    let sql = format!(
        "UPDATE {} SET {}, von = ?, bis = ?, soll_anzahl = ?, quali_soll = ?, notiz = ?, \
            version = version + 1, geaendert_at = ?, geaendert_von = ? \
         WHERE id = ? AND version = ?",
        A::SCHICHT,
        posten_liste::<A>("= ?", ", ")
    );
    A::bind_posten(sqlx::query(sqlx::AssertSqlSafe(sql)), posten)
        .bind(&von)
        .bind(&bis)
        .bind(soll_anzahl)
        .bind(&quali_soll)
        .bind(&notiz)
        .bind(jetzt)
        .bind(benutzer_id)
        .bind(bid)
        .bind(version)
        .execute(&mut *conn)
        .await?;
    if let Some(personen) = &patch.personen {
        write_personen_tx::<A>(conn, bid, personen).await?;
    }
    Ok([posten_alt, posten])
}

/// Löscht einen Block mit CAS über `version` (409); fremd oder unbekannt 404. Liefert seinen
/// Posten.
pub(crate) async fn delete_block_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    bid: i64,
    version: i64,
    recht: A::DeleteRecht,
) -> Result<A::Posten, AppError> {
    plan.before_write_tx(conn).await?;
    let stand = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT version, {} FROM {} WHERE id = ? AND {} = ?",
        posten_spalten::<A>(),
        A::SCHICHT,
        A::SCOPE
    )))
    .bind(bid)
    .bind(plan.id())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if stand.try_get::<i64, _>("version")? != version {
        return Err(AppError::Conflict(
            "Die Schicht wurde zwischenzeitlich geändert".into(),
        ));
    }
    let posten = A::posten_from_row(&stand)?;
    plan.check_delete_tx(conn, bid, recht).await?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DELETE FROM {} WHERE id = ?",
        A::SCHICHT
    )))
    .bind(bid)
    .execute(&mut *conn)
    .await?;
    Ok(posten)
}

/// „Schichten erzeugen“ nach der Teilung durch die Seite: Höchstzahl (422), dann alle
/// Überschneidungen auf einmal (422 mit einer Zeile je bestehendem Block, nichts angelegt), dann
/// die Blöcke mit dem Soll des Postens. Liefert die neuen Kennungen.
pub(crate) async fn create_bloecke_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    benutzer_id: i64,
    posten: A::Posten,
    vorgabe: &PostenVorgabe,
    teile: &[(DateTime<Utc>, DateTime<Utc>)],
) -> Result<Vec<i64>, AppError> {
    check_anzahl_tx(conn, plan, teile.len()).await?;
    let mut konflikte: Vec<ZeilenGrund> = Vec::new();
    let mut stil = None;
    for (a, b) in teile {
        let (a, b) = (zeit::formatiere_utc(*a), zeit::formatiere_utc(*b));
        for (id, x, y) in ueberschneidungen_tx(conn, plan, posten, &a, &b, None).await? {
            if !konflikte.iter().any(|k| k.id == id) {
                if stil.is_none() {
                    stil = Some(plan.zone_tx(conn).await?);
                }
                let s = stil.as_ref().unwrap_or(&Zeitstil::VORGABE);
                konflikte.push(ZeilenGrund {
                    art: ZeilenArt::Planschicht,
                    id,
                    grund: format!("überschneidet sich mit {}", zeitraum_text(s, &x, &y)),
                });
            }
        }
    }
    if !konflikte.is_empty() {
        return Err(AppError::Zeilen {
            meldung: "Erzeugte Schichten überschneiden sich mit bestehenden; nichts angelegt"
                .into(),
            zeilen: konflikte,
        });
    }
    let mut ids = Vec::with_capacity(teile.len());
    for (a, b) in teile {
        ids.push(
            insert_block_tx(
                conn,
                plan,
                benutzer_id,
                posten,
                &zeit::formatiere_utc(*a),
                &zeit::formatiere_utc(*b),
                vorgabe.soll_anzahl,
                vorgabe.quali_soll.as_deref(),
                None,
            )
            .await?,
        );
    }
    Ok(ids)
}

// ---------------------------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------------------------

/// Die Blöcke eines Plans mit Personen und Prüfbefunden, neutral (design.md D3); die Seite bildet
/// sie auf ihren Wire-Typ ab.
pub(crate) struct Geladen<Z> {
    /// Die Zeilen in der Reihenfolge der Seite, parallel zu `bloecke`.
    pub zeilen: Vec<Z>,
    pub bloecke: Vec<Block>,
    pub ergebnis: Ergebnis,
    pub personen: BTreeMap<PlanPerson, PersonDaten>,
}

/// Lädt die Blöcke des Plans, ihre Personen (in Einfügefolge) und prüft sie
/// (`pruefung::pruefe`). `aufgeloest` sagt je Zeile, ob ihr Posten nicht mehr besteht.
pub(crate) async fn load_tx<A: Planart>(
    conn: &mut SqliteConnection,
    plan: &A,
    org_id: i64,
    grenzwerte: SchichtplanGrenzwerte,
    jetzt: DateTime<Utc>,
    aufgeloest: impl Fn(&A::BlockZeile) -> bool,
) -> Result<Geladen<A::BlockZeile>, AppError> {
    let zeilen: Vec<A::BlockZeile> = sqlx::query_as(A::SELECT_BLOECKE)
        .bind(plan.id())
        .fetch_all(&mut *conn)
        .await?;
    let zuordnung: Vec<(i64, Option<i64>, Option<i64>, Option<i64>)> =
        sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT pp.{fk}, pp.personal_id, {adhoc}, pp.helfer_id FROM {person} pp \
             JOIN {schicht} p ON p.id = pp.{fk} WHERE p.{scope} = ? ORDER BY pp.rowid",
            fk = A::PERSON_FK,
            adhoc = if A::MIT_ADHOC {
                "pp.einsatz_personal_id"
            } else {
                "NULL"
            },
            person = A::PERSON,
            schicht = A::SCHICHT,
            scope = A::SCOPE
        )))
        .bind(plan.id())
        .fetch_all(&mut *conn)
        .await?;
    let mut je_block: HashMap<i64, Vec<PlanPerson>> = HashMap::new();
    for (bid, stamm, ep, helfer) in zuordnung {
        if let Some(p) = PlanPerson::aus_spalten(stamm, ep, helfer) {
            je_block.entry(bid).or_default().push(p);
        }
    }
    let personen = plan.load_personen_tx(conn).await?;
    let ueber = plan.load_ueber_einheit_tx(conn).await?;
    let katalog = crate::personal::qualifikation_repo::einschluesse(&mut *conn, org_id).await?;

    let mut bloecke = Vec::with_capacity(zeilen.len());
    for z in &zeilen {
        let k = A::block_kern(z)?;
        bloecke.push(Block {
            id: k.id,
            posten: k.posten,
            von: utc(k.von)?,
            bis: utc(k.bis)?,
            soll_anzahl: k.soll_anzahl,
            quali_soll: k
                .quali_soll
                .map(QualiSoll::anforderungen)
                .unwrap_or_default(),
            personen: je_block.remove(&k.id).unwrap_or_default(),
            posten_aufgeloest: aufgeloest(z),
        });
    }
    let staende: HashMap<PlanPerson, PersonStand> = personen
        .iter()
        .map(|(p, d)| (*p, d.stand.clone()))
        .collect();
    let ergebnis = pruefung::pruefe(
        &bloecke,
        &Grundlage {
            katalog: &katalog,
            personen: &staende,
            ueber_einheit: &ueber,
            grenzwerte,
            jetzt,
            mit_ist: A::MIT_IST,
        },
    );
    Ok(Geladen {
        zeilen,
        bloecke,
        ergebnis,
        personen,
    })
}

/// Die Personen eines Blocks für die Anzeige, mit ihren Befunden aus `ergebnis`.
pub(crate) fn personen_anzeige(
    block: &Block,
    personen: &BTreeMap<PlanPerson, PersonDaten>,
    ergebnis: &mut BlockErgebnis,
) -> Vec<PlanPersonAnzeige> {
    block
        .personen
        .iter()
        .map(|p| {
            let daten = personen.get(p);
            PlanPersonAnzeige {
                art: p.art(),
                personal_id: matches!(p, PlanPerson::Stamm(_)).then(|| p.id()),
                einsatz_personal_id: matches!(p, PlanPerson::Einsatz(_)).then(|| p.id()),
                helfer_id: matches!(p, PlanPerson::Helfer(_)).then(|| p.id()),
                name: daten.map(|d| d.name.clone()).unwrap_or_default(),
                qualifikationen: daten
                    .map(|d| d.stand.qualifikationen.clone())
                    .unwrap_or_default(),
                im_einsatz: daten.is_some_and(|d| d.stand.ist.im_einsatz),
                befunde: ergebnis.personen.remove(p).unwrap_or_default(),
            }
        })
        .collect()
}
