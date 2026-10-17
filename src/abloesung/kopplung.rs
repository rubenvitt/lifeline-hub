//! Kopplung der Kräfte-Zeitachse an die Ablösung (LLH-1128, Spec `kraefte-abloesung`
//! „Schicht mit dem Eintreffen“, `kraefte-zeitachse` „Kopplung an die Ablösung“).
//!
//! Gerufen nur aus `zeitachse::repo` (einziger Schreibpfad, `frontend/src/kraefte/AGENTS.md`),
//! nachdem an einer **Einheit** ein Ereignis geschrieben oder gestrichen wurde, in derselben
//! Transaktion:
//! - **Eintreffen** der offenen Periode: hat die Einheit keine laufende Schicht, auch keine
//!   geerbte (Knoten-Modell), und gibt es eine Vorgabe des Abschnitts oder des Einsatzes, beginnt
//!   die Schicht zum Eintreffen ([`repo::start_schicht_tx`], Rangfolge wie von Hand). Ohne
//!   Vorgabe entsteht nichts: keine erfundene Zahl. Eine als Ablöser geplante Einheit (Eintrag
//!   der Liste einer laufenden Schicht, auch über einen geplanten Vorfahren, LLH-1132) bekommt
//!   keine: ihre Schicht entsteht mit dem Vollzug als Folgeschicht.
//! - **Entlassung**, die die letzte Periode schließt: die laufende Schicht der Einheit endet als
//!   `beendet` mit Grund `entlassung`, ihre Fristen schließen.
//! - **Streichung dieser Entlassung**: die Schicht läuft wieder, samt Fristen.
//!
//! **Ein Fehler hier bricht nie den Anlass** (gleiche Regel wie ein Perioden-Verstoß beim
//! Statuswechsel): die Kopplung läuft in einem eigenen `SAVEPOINT`, ein Fehler rollt nur sie
//! zurück und wird geloggt. Die Einheit erscheint dann ohne Schicht.

use sqlx::SqliteConnection;

use super::repo::{self, Start};
use super::BeendetGrund;
use crate::error::AppError;
use crate::zeitachse::ZeitachseArt;

/// Name des Savepoints; eindeutig genug, weil die Kopplung sich nie selbst ruft.
const SAVEPOINT: &str = "abloesung_kopplung";

/// Text, mit dem der Autostart den Beginn im ETB nennt.
pub const WIE_AUTOSTART: &str = "mit dem Eintreffen begonnen";

/// Nach einem geschriebenen Ereignis an einer Einheit. Liefert die ETB-Einträge, die die
/// Kopplung geschrieben hat (für Kurzruf und `LiveEvent::Abloesung` nach dem Commit); leer ohne
/// Wirkung oder nach einem verschluckten Fehler.
pub async fn nach_ereignis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    art: ZeitachseArt,
    zeitpunkt_at: &str,
) -> Result<Vec<i64>, AppError> {
    let schritt = match art {
        ZeitachseArt::Eintreffen => Schritt::Autostart,
        ZeitachseArt::Entlassung => Schritt::Ende,
        _ => return Ok(Vec::new()),
    };
    isoliert(
        conn,
        einsatz_id,
        benutzer_id,
        einheit_id,
        schritt,
        zeitpunkt_at,
    )
    .await
}

/// Nach einer gestrichenen Entlassung an einer Einheit: öffnet die mit ihr beendete Schicht.
pub async fn nach_streichung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    art: ZeitachseArt,
    zeitpunkt_at: &str,
) -> Result<Vec<i64>, AppError> {
    if art != ZeitachseArt::Entlassung {
        return Ok(Vec::new());
    }
    isoliert(
        conn,
        einsatz_id,
        benutzer_id,
        einheit_id,
        Schritt::Wiederaufnahme,
        zeitpunkt_at,
    )
    .await
}

/// Was die Kopplung an der Schicht tut.
#[derive(Debug, Clone, Copy)]
enum Schritt {
    Autostart,
    Ende,
    Wiederaufnahme,
}

/// Führt den Schritt in einem Savepoint aus. Ein Fehler darin rollt nur den Savepoint zurück und
/// wird geloggt (leeres Ergebnis); nur ein Fehler der Savepoint-Anweisungen selbst geht nach
/// oben, denn dann ist die Transaktion nicht mehr sicher.
async fn isoliert(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    schritt: Schritt,
    zeitpunkt_at: &str,
) -> Result<Vec<i64>, AppError> {
    sqlx::query(sqlx::AssertSqlSafe(format!("SAVEPOINT {SAVEPOINT}")))
        .execute(&mut *conn)
        .await?;
    let r = match schritt {
        Schritt::Autostart => {
            autostart_tx(conn, einsatz_id, benutzer_id, einheit_id, zeitpunkt_at).await
        }
        Schritt::Ende => end_tx(conn, einsatz_id, benutzer_id, einheit_id, zeitpunkt_at).await,
        Schritt::Wiederaufnahme => {
            reopen_tx(conn, einsatz_id, benutzer_id, einheit_id, zeitpunkt_at).await
        }
    };
    match r {
        Ok(etb) => {
            sqlx::query(sqlx::AssertSqlSafe(format!("RELEASE {SAVEPOINT}")))
                .execute(&mut *conn)
                .await?;
            Ok(etb)
        }
        Err(e) => {
            sqlx::query(sqlx::AssertSqlSafe(format!("ROLLBACK TO {SAVEPOINT}")))
                .execute(&mut *conn)
                .await?;
            sqlx::query(sqlx::AssertSqlSafe(format!("RELEASE {SAVEPOINT}")))
                .execute(&mut *conn)
                .await?;
            tracing::warn!(
                ?schritt,
                einheit_id,
                "Kopplung an die Ablösung ausgelassen: {e}"
            );
            Ok(Vec::new())
        }
    }
}

/// Aktiv (nicht aufgelöst) und im Einsatz.
async fn is_aktiv_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ? AND aufgeloest_at IS NULL",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.is_some())
}

/// Ob eine laufende Schicht des Einsatzes die Einheit oder einen ihrer Vorfahren als Ablöser
/// plant: als Eintrag der Liste `einsatz_abloesung_abloeser` (LLH-1132) oder über den Spiegel
/// `abloesende_einheit_id`. Der Vorfahr zählt mit, weil ein Verband als Knoten ablöst: seine
/// Untereinheiten erben die Folgeschicht, die der Vollzug ihm anlegt (LLH-1118 Punkt 1). Die
/// Kette ist per `UNION` zyklenfest.
async fn is_geplanter_abloeser_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(
        "WITH RECURSIVE kette(id) AS ( \
             SELECT ?1 \
             UNION SELECT e.ueber_einheit_id FROM einsatz_einheit e JOIN kette k ON e.id = k.id \
                   WHERE e.ueber_einheit_id IS NOT NULL) \
         SELECT 1 FROM einsatz_abloesung a \
         WHERE a.einsatz_id = ?2 AND a.status = 'laufend' \
           AND (a.abloesende_einheit_id IN (SELECT id FROM kette) \
                OR EXISTS (SELECT 1 FROM einsatz_abloesung_abloeser l \
                           WHERE l.abloesung_id = a.id AND l.einheit_id IN (SELECT id FROM kette))) \
         LIMIT 1",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.is_some())
}

async fn autostart_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    eintreffen_at: &str,
) -> Result<Vec<i64>, AppError> {
    // Nur das Eintreffen der offenen Periode: ein nachgetragenes in eine abgeschlossene Periode
    // beginnt keine Schicht.
    let offen = crate::zeitachse::repo::offenes_eintreffen_tx(conn, einheit_id).await?;
    if offen.as_deref() != Some(eintreffen_at) || !is_aktiv_tx(conn, einsatz_id, einheit_id).await?
    {
        return Ok(Vec::new());
    }
    // Eigene oder geerbte laufende Schicht: nichts anlegen (Knoten-Modell, LLH-1118).
    if repo::load_wirksamen_traeger_tx(conn, einsatz_id, einheit_id)
        .await?
        .is_some()
    {
        return Ok(Vec::new());
    }
    // Als Ablöser geplant (auch als Untereinheit eines geplanten Verbands): ihre Schicht beginnt
    // mit dem Vollzug als Folgeschicht. Ein ungeplant eingetroffener Ablöser bekommt hier seine
    // eigene, die der Vollzug dann übernimmt (LLH-1132).
    if is_geplanter_abloeser_tx(conn, einsatz_id, einheit_id).await? {
        return Ok(Vec::new());
    }
    let startwert = crate::einsatz::einstellungen::etb_startwert(&mut *conn, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    let start = Start {
        einsatz_id,
        benutzer_id,
        startwert,
        einheit_id,
        beginn_at: eintreffen_at,
        rhythmus_minuten: None,
        wie: WIE_AUTOSTART,
    };
    Ok(repo::start_schicht_tx(conn, &start, &jetzt)
        .await?
        .map(|(_, etb_id)| etb_id)
        .into_iter()
        .collect())
}

async fn end_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    entlassung_at: &str,
) -> Result<Vec<i64>, AppError> {
    // Nur eine Entlassung, nach der keine Periode mehr offen ist: eine in eine frühere Periode
    // nachgetragene lässt die laufende Schicht der späteren stehen.
    if crate::zeitachse::repo::has_offene_periode_tx(conn, einheit_id).await? {
        return Ok(Vec::new());
    }
    let Some((id, name)) = repo::load_laufende_tx(conn, einheit_id).await? else {
        return Ok(Vec::new());
    };
    let jetzt = crate::zeit::jetzt();
    repo::end_schicht_tx(
        conn,
        id,
        benutzer_id,
        BeendetGrund::Entlassung,
        entlassung_at,
        &jetzt,
    )
    .await?;
    let startwert = crate::einsatz::einstellungen::etb_startwert(&mut *conn, einsatz_id).await?;
    let etb_id = crate::etb::system_audit_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        &format!("Ablösung: Schicht von «{name}» mit der Entlassung beendet"),
    )
    .await?;
    Ok(vec![etb_id])
}

async fn reopen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    entlassung_at: &str,
) -> Result<Vec<i64>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let Some((_, name)) = repo::reopen_nach_entlassung_tx(
        conn,
        einsatz_id,
        benutzer_id,
        einheit_id,
        entlassung_at,
        &jetzt,
    )
    .await?
    else {
        return Ok(Vec::new());
    };
    let startwert = crate::einsatz::einstellungen::etb_startwert(&mut *conn, einsatz_id).await?;
    let etb_id = crate::etb::system_audit_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        &format!("Ablösung: Schicht von «{name}» läuft wieder, Entlassung gestrichen"),
    )
    .await?;
    Ok(vec![etb_id])
}
