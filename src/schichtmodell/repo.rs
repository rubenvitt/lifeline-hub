//! Persistenz der Schichtmodelle (LLH-1122): Stammdaten der Organisation und die Kopie am
//! Einsatz.
//!
//! Regeln (Spec `kraefte-abloesung`, „Schichtmodelle der Organisation“):
//! - Höchstens ein Modell je Org ist die Vorgabe: ein zweites → 409. Der Teilindex
//!   `idx_schichtmodell_vorgabe` ist das Netz und kommt ebenfalls als 409 heraus.
//! - Die Bezeichnung ist je Org eindeutig, ohne Unterschied von Groß- und Kleinschreibung
//!   (409). Verglichen wird in Rust (`to_lowercase` faltet auch Umlaute), der Index ist das Netz.
//! - Löschen ist echt: kein Einsatz verweist auf das Modell, er hat eine Kopie. Eine Demo-Marke
//!   fällt in derselben Transaktion mit, Verweise von Einsatz-Vorlagen (LLH-1313) werden gelöst.
//! - Fremde Organisation: 404, wie nicht vorhanden.

use sqlx::{SqliteConnection, SqlitePool};

use super::{columns, EinsatzSchichtmodell, Schichtmodell, Werte, WerteZeile};
use crate::error::AppError;
use crate::write_retry;

const WERTE_SPALTEN: &str = "bezeichnung, typ, rhythmus_minuten, wechselzeiten, \
     mindestdauer_minuten, vorwarnung_minuten, planungsvorlauf_minuten";

const NAME_VERGEBEN: &str = "Ein Schichtmodell mit dieser Bezeichnung gibt es schon";

#[derive(sqlx::FromRow)]
struct ModellZeile {
    id: i64,
    ist_vorgabe: bool,
    ist_demo: bool,
    #[sqlx(flatten)]
    werte: WerteZeile,
}

impl ModellZeile {
    fn anzeige(self) -> Result<Schichtmodell, AppError> {
        Ok(Schichtmodell::from_werte(
            self.id,
            self.werte.werte()?,
            self.ist_vorgabe,
            self.ist_demo,
        ))
    }
}

fn select_sql() -> String {
    format!(
        "SELECT s.id, s.ist_vorgabe, \
                EXISTS (SELECT 1 FROM demo_herkunft dh \
                        WHERE dh.tabelle = 'schichtmodell' AND dh.datensatz_id = s.id) AS ist_demo, \
                {WERTE_SPALTEN} \
         FROM schichtmodell s"
    )
}

/// Die Modelle der Organisation, die Vorgabe zuerst, dann nach Bezeichnung.
pub async fn list(pool: &SqlitePool, org_id: i64) -> Result<Vec<Schichtmodell>, AppError> {
    sqlx::query_as::<_, ModellZeile>(sqlx::AssertSqlSafe(format!(
        "{} WHERE s.org_id = ? ORDER BY s.ist_vorgabe DESC, s.bezeichnung, s.id",
        select_sql()
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(ModellZeile::anzeige)
    .collect()
}

pub(crate) async fn load_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<Schichtmodell, AppError> {
    sqlx::query_as::<_, ModellZeile>(sqlx::AssertSqlSafe(format!(
        "{} WHERE s.org_id = ? AND s.id = ?",
        select_sql()
    )))
    .bind(org_id)
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?
    .anzeige()
}

/// Werte eines Modells der Organisation, für die Kopie an einen Einsatz. `NotFound`, wenn es
/// nicht zur Org gehört.
pub(crate) async fn load_werte_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<Werte, AppError> {
    sqlx::query_as::<_, WerteZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {WERTE_SPALTEN} FROM schichtmodell WHERE org_id = ? AND id = ?"
    )))
    .bind(org_id)
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?
    .werte()
}

/// 409, wenn ein anderes Modell der Org dieselbe Bezeichnung trägt.
async fn check_name_free_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    bezeichnung: &str,
    ausser_id: Option<i64>,
) -> Result<(), AppError> {
    let namen: Vec<String> = sqlx::query_scalar(
        "SELECT bezeichnung FROM schichtmodell WHERE org_id = ? AND id IS NOT ?",
    )
    .bind(org_id)
    .bind(ausser_id)
    .fetch_all(&mut *conn)
    .await?;
    let gesucht = bezeichnung.trim().to_lowercase();
    if namen.iter().any(|n| n.trim().to_lowercase() == gesucht) {
        return Err(AppError::Conflict(NAME_VERGEBEN.into()));
    }
    Ok(())
}

/// 409, wenn ein anderes Modell der Org schon die Vorgabe ist.
async fn check_vorgabe_free_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    ausser_id: Option<i64>,
) -> Result<(), AppError> {
    let andere: Option<String> = sqlx::query_scalar(
        "SELECT bezeichnung FROM schichtmodell \
         WHERE org_id = ? AND ist_vorgabe = 1 AND id IS NOT ?",
    )
    .bind(org_id)
    .bind(ausser_id)
    .fetch_optional(&mut *conn)
    .await?;
    match andere {
        Some(name) => Err(AppError::Conflict(format!(
            "«{name}» ist schon die Vorgabe der Organisation; erst dort die Vorgabe aufheben"
        ))),
        None => Ok(()),
    }
}

/// Ein Verstoß gegen einen der beiden Indizes ist derselbe 409 wie die Rust-Prüfung: zwei
/// gleichzeitige Anlagen kommen sonst als 409 und 500 heraus.
fn map_unique<T>(e: AppError) -> Result<T, AppError> {
    if let AppError::Database(sqlx::Error::Database(db)) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                if db.message().contains("bezeichnung") {
                    NAME_VERGEBEN.into()
                } else {
                    "Die Organisation hat schon ein Vorgabemodell".into()
                },
            ));
        }
    }
    Err(e)
}

/// Legt ein Modell an. 409 bei gleicher Bezeichnung oder zweiter Vorgabe.
pub async fn create(
    pool: &SqlitePool,
    org_id: i64,
    werte: &Werte,
    ist_vorgabe: bool,
) -> Result<Schichtmodell, AppError> {
    write_retry!(pool, |conn| {
        check_name_free_tx(conn, org_id, &werte.bezeichnung, None).await?;
        if ist_vorgabe {
            check_vorgabe_free_tx(conn, org_id, None).await?;
        }
        let id = insert_tx(conn, org_id, werte, ist_vorgabe).await?;
        load_tx(conn, org_id, id).await
    })
}

/// Schreibt ein neues Modell ohne Prüfung der Regeln oben (die Indizes halten); für
/// [`create`] und den Demo-Import. Liefert die id.
pub(crate) async fn insert_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    werte: &Werte,
    ist_vorgabe: bool,
) -> Result<i64, AppError> {
    let (typ, rhythmus, wechselzeiten, mindestdauer) = columns(&werte.regel);
    sqlx::query_scalar(
        "INSERT INTO schichtmodell (org_id, bezeichnung, typ, rhythmus_minuten, wechselzeiten, \
            mindestdauer_minuten, vorwarnung_minuten, planungsvorlauf_minuten, ist_vorgabe) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(&werte.bezeichnung)
    .bind(typ)
    .bind(rhythmus)
    .bind(wechselzeiten)
    .bind(mindestdauer)
    .bind(werte.vorwarnung_minuten)
    .bind(werte.planungsvorlauf_minuten)
    .bind(ist_vorgabe)
    .fetch_one(&mut *conn)
    .await
    .map_err(AppError::from)
    .or_else(map_unique)
}

/// Ersetzt die Werte eines Modells (ganzer Satz) und setzt oder hebt die Vorgabe. 404 bei
/// fremdem oder unbekanntem Modell, 409 bei gleicher Bezeichnung oder zweiter Vorgabe.
/// Einsätze behalten ihre Kopie.
pub async fn update(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    werte: &Werte,
    ist_vorgabe: bool,
) -> Result<Schichtmodell, AppError> {
    write_retry!(pool, |conn| {
        load_tx(conn, org_id, id).await?;
        check_name_free_tx(conn, org_id, &werte.bezeichnung, Some(id)).await?;
        if ist_vorgabe {
            check_vorgabe_free_tx(conn, org_id, Some(id)).await?;
        }
        let (typ, rhythmus, wechselzeiten, mindestdauer) = columns(&werte.regel);
        sqlx::query(
            "UPDATE schichtmodell SET bezeichnung = ?, typ = ?, rhythmus_minuten = ?, \
                wechselzeiten = ?, mindestdauer_minuten = ?, vorwarnung_minuten = ?, \
                planungsvorlauf_minuten = ?, ist_vorgabe = ? \
             WHERE id = ? AND org_id = ?",
        )
        .bind(&werte.bezeichnung)
        .bind(typ)
        .bind(rhythmus)
        .bind(wechselzeiten)
        .bind(mindestdauer)
        .bind(werte.vorwarnung_minuten)
        .bind(werte.planungsvorlauf_minuten)
        .bind(ist_vorgabe)
        .bind(id)
        .bind(org_id)
        .execute(&mut *conn)
        .await
        .map_err(AppError::from)
        .or_else(map_unique)?;
        load_tx(conn, org_id, id).await
    })
}

/// Löscht ein Modell samt Demo-Marke. 404 bei fremdem oder unbekanntem Modell. Kopien an
/// Einsätzen bleiben unberührt. Einsatz-Vorlagen, die das Modell vorgeben, verlieren den Verweis
/// im selben Schritt und fallen auf die Vorgabe der Organisation zurück (LLH-1313, design.md D3);
/// der Fremdschlüssel selbst hält fest, damit das Entfernen der Demo-Daten es stehen lässt.
pub async fn delete(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        sqlx::query(
            "UPDATE einsatz_vorlage SET schichtmodell_id = NULL, geaendert_at = datetime('now') \
             WHERE schichtmodell_id = ? AND org_id = ?",
        )
        .bind(id)
        .bind(org_id)
        .execute(&mut *conn)
        .await?;
        let geloescht = sqlx::query("DELETE FROM schichtmodell WHERE id = ? AND org_id = ?")
            .bind(id)
            .bind(org_id)
            .execute(&mut *conn)
            .await?
            .rows_affected();
        if geloescht == 0 {
            return Err(AppError::NotFound);
        }
        sqlx::query(
            "DELETE FROM demo_herkunft WHERE tabelle = 'schichtmodell' AND datensatz_id = ?",
        )
        .bind(id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
}

// ── Kopie am Einsatz ────────────────────────────────────────────────────────────────────────

/// Die Kopie am Einsatz samt Änderungszeitpunkt; `None` = keine Einsatzvorgabe.
pub(crate) async fn load_einsatz_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Option<(Werte, String)>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Zeile {
        geaendert_at: String,
        #[sqlx(flatten)]
        werte: WerteZeile,
    }
    match sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(format!(
        "SELECT geaendert_at, {WERTE_SPALTEN} FROM einsatz_schichtmodell WHERE einsatz_id = ?"
    )))
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    {
        Some(z) => Ok(Some((z.werte.werte()?, z.geaendert_at))),
        None => Ok(None),
    }
}

/// Die Kopie am Einsatz als Antwort.
pub async fn load_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Option<EinsatzSchichtmodell>, AppError> {
    let mut conn = pool.acquire().await?;
    Ok(load_einsatz_tx(&mut conn, einsatz_id)
        .await?
        .map(|(w, at)| EinsatzSchichtmodell::from_werte(w, at)))
}

/// Setzt (`Some`) oder entfernt (`None`) die Kopie am Einsatz. Nur die Zeile; das Nachziehen
/// der Schichten macht `abloesung::repo::set_einsatz_vorgabe`.
pub(crate) async fn set_einsatz_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    werte: Option<&Werte>,
    benutzer_id: i64,
) -> Result<(), AppError> {
    let Some(werte) = werte else {
        sqlx::query("DELETE FROM einsatz_schichtmodell WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
        return Ok(());
    };
    let (typ, rhythmus, wechselzeiten, mindestdauer) = columns(&werte.regel);
    sqlx::query(
        "INSERT INTO einsatz_schichtmodell (einsatz_id, bezeichnung, typ, rhythmus_minuten, \
            wechselzeiten, mindestdauer_minuten, vorwarnung_minuten, planungsvorlauf_minuten, \
            geaendert_von_id, geaendert_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) \
         ON CONFLICT (einsatz_id) DO UPDATE SET bezeichnung = excluded.bezeichnung, \
            typ = excluded.typ, rhythmus_minuten = excluded.rhythmus_minuten, \
            wechselzeiten = excluded.wechselzeiten, \
            mindestdauer_minuten = excluded.mindestdauer_minuten, \
            vorwarnung_minuten = excluded.vorwarnung_minuten, \
            planungsvorlauf_minuten = excluded.planungsvorlauf_minuten, \
            geaendert_von_id = excluded.geaendert_von_id, geaendert_at = excluded.geaendert_at",
    )
    .bind(einsatz_id)
    .bind(&werte.bezeichnung)
    .bind(typ)
    .bind(rhythmus)
    .bind(wechselzeiten)
    .bind(mindestdauer)
    .bind(werte.vorwarnung_minuten)
    .bind(werte.planungsvorlauf_minuten)
    .bind(benutzer_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Einsatzanlage (`einsatz::repo::anlegen_tx`): kopiert ein Modell als Vorgabe an den neuen
/// Einsatz. Rangfolge (LLH-1313, design.md D4): das Modell der Einsatz-Vorlage (`modell_id`),
/// sonst die Vorgabe der Organisation, sonst keins (keine erfundene Zahl). `modell_id` stammt aus
/// einer Vorlage derselben Organisation; die Org-Bedingung bleibt trotzdem im WHERE.
pub(crate) async fn copy_vorgabe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    modell_id: Option<i64>,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO einsatz_schichtmodell (einsatz_id, {WERTE_SPALTEN}, geaendert_von_id) \
         SELECT ?1, {WERTE_SPALTEN}, ?2 FROM schichtmodell \
         WHERE org_id = ?3 AND (id = ?4 OR (?4 IS NULL AND ist_vorgabe = 1))"
    )))
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(org_id)
    .bind(modell_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}
