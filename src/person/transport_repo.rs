//! Transport einer Person als Verlauf mit aktuellem Stand (LLH-1325, Change `y18v58dt-pat-kern`,
//! design.md D2/D6, Spec `personen-transport`).
//!
//! `person_transport` ist anhängend. Jede Zeile ist ein voller Stand aus Priorität, Art und
//! benötigter Fachrichtung, jedes Feld einzeln leer; drei leere heben den Transport auf. Der Cache
//! an `einsatz_person` folgt dem Stand mit der jüngsten Erfassungszeit, nicht der Einfügung.

use crate::error::AppError;
use crate::geraet::bestaetigung::Bestaetigung;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::SqliteConnection;
use sqlx::SqlitePool;
use utoipa::ToSchema;

wire_enum! {
    /// Transportpriorität (Spec `personen-transport`). String = CHECK in
    /// `migrations/0219_person_transport.sql`. Ordnet innerhalb der Sichtungskategorie, nie über
    /// ihr (design.md D10). Statuskategorie (Retain), deshalb darf sie ins ETB.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum TransportPrioritaet {
        Sofort => "sofort",
        Dringlich => "dringlich",
        Normal => "normal",
    }
}

wire_enum! {
    /// Transportart. Statuskategorie (Retain), erscheint aber nie im ETB oder Live-Kanal.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum TransportArt {
        Liegend => "liegend",
        Sitzend => "sitzend",
        MitNotarzt => "mit_notarzt",
    }
}

wire_enum! {
    /// Benötigte Fachrichtung des Zielkrankenhauses. Diagnosenah (Psychiatrie, Geburtshilfe):
    /// Scrub mit der Kategorie Behandlung (design.md D4), nie im ETB oder Live-Kanal.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Fachrichtung {
        Unfallchirurgie => "unfallchirurgie",
        Verbrennung => "verbrennung",
        Kinder => "kinder",
        Neuro => "neuro",
        Innere => "innere",
        Geburtshilfe => "geburtshilfe",
        Psychiatrie => "psychiatrie",
        Sonstige => "sonstige",
    }
}

/// Ein Transportstand (1:1 zu `person_transport`). Drei leere Felder heißen „aufgehoben“.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct TransportAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<TransportPrioritaet>)]
    pub prioritaet: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<TransportArt>)]
    pub art: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Fachrichtung>)]
    pub fachrichtung: Option<String>,
    /// Erfassungszeit; ohne Netz vorgemerkt die Zeit am Gerät, gekappt.
    pub zeitpunkt_at: String,
    /// Wann der Stand beim Server ankam.
    pub erfasst_at: String,
    pub erfasst_von: i64,
    /// Namentliche Bestätigung am Gerät (LFH-1046).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bestaetigt_name: Option<String>,
}

const SELECT_TRANSPORT: &str = "\
    SELECT id, einsatz_id, person_id, prioritaet, art, fachrichtung, zeitpunkt_at, erfasst_at, \
           erfasst_von, bestaetigt_name \
    FROM person_transport";

/// „Aktuell“ (Spec `personen-verlauf`, design.md D6): der Stand mit der jüngsten Erfassungszeit,
/// bei Gleichstand der später gespeicherte. Die einzige Stelle, die das für den Transport
/// festlegt; Cache, Vorgänger und Verlauf lesen dieselbe Ordnung.
macro_rules! transportfolge {
    () => {
        "ORDER BY zeitpunkt_at DESC, id DESC"
    };
}

/// Ein neuer Stand; die Katalogwerte sind geprüft, die Erfassungszeit gekappt.
#[derive(Debug)]
pub struct NeuerTransport<'a> {
    pub prioritaet: Option<TransportPrioritaet>,
    pub art: Option<TransportArt>,
    pub fachrichtung: Option<Fachrichtung>,
    /// Erfassungszeit, bereits über `support::erfassungszeitpunkt` gekappt.
    pub zeitpunkt_at: &'a str,
    /// Idempotenzschlüssel der Offline-Queue.
    pub client_id: Option<&'a str>,
    /// Bereits über [`crate::geraet::bestaetigung::aufloesen`] geprüft.
    pub bestaetigung: Option<&'a Bestaetigung>,
}

/// Ergebnis einer Erfassung.
#[derive(Debug)]
pub struct ErfassterTransport {
    pub transport: TransportAnzeige,
    /// Ob der Stand der aktuelle ist. Ein nachgereichter älterer gewinnt nicht.
    pub gewinnt: bool,
    /// Priorität des Stands, der in der Zeitfolge unmittelbar vor diesem liegt (`None` ohne
    /// Vorgänger oder ohne Priorität). Gewinnt der Stand, ist das der bisherige aktuelle.
    pub vorher: Option<TransportPrioritaet>,
    /// Priorität des aktuellen Stands nach dieser Erfassung (`None` = keine).
    pub aktuell: Option<TransportPrioritaet>,
}

impl ErfassterTransport {
    /// Die neue Priorität, wenn dieser Stand sie gegenüber seinem Vorgänger ändert; `Some(None)`
    /// heißt aufgehoben. Ein reiner Art- oder Fachrichtungswechsel ist `None`.
    pub fn prioritaetswechsel(&self) -> Option<Option<TransportPrioritaet>> {
        let neu = self
            .transport
            .prioritaet
            .as_deref()
            .and_then(TransportPrioritaet::parse);
        (neu != self.vorher).then_some(neu)
    }
}

/// Erfasst einen Stand anhängend und bestimmt den Cache neu aus dem jüngsten Stand, auf der
/// offenen Verbindung des Aufrufers (er bündelt es mit dem ETB in EINE `write_retry!`-Transaktion).
pub async fn erfassen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    neu: &NeuerTransport<'_>,
    erfasst_von: i64,
) -> Result<ErfassterTransport, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_transport (einsatz_id, person_id, prioritaet, art, fachrichtung, \
            zeitpunkt_at, erfasst_at, erfasst_von, bestaetigt_personal_id, bestaetigt_name, \
            client_id) \
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now'), ?, ?, ?, ?) \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(neu.prioritaet.map(|p| p.as_str()))
    .bind(neu.art.map(|a| a.as_str()))
    .bind(neu.fachrichtung.map(|f| f.as_str()))
    .bind(neu.zeitpunkt_at)
    .bind(erfasst_von)
    .bind(neu.bestaetigung.map(|b| b.personal_id))
    .bind(neu.bestaetigung.map(|b| b.name.as_str()))
    .bind(neu.client_id)
    .fetch_one(&mut *conn)
    .await?;
    let transport = laden_tx(conn, einsatz_id, id).await?;

    // Vorgänger in der Zeitfolge: der jüngste Stand vor diesem (gleiche Zeit: früher gespeichert).
    let vorher: Option<Option<String>> = sqlx::query_scalar(concat!(
        "SELECT prioritaet FROM person_transport \
         WHERE einsatz_id = ?1 AND person_id = ?2 \
           AND (zeitpunkt_at < ?3 OR (zeitpunkt_at = ?3 AND id < ?4)) ",
        transportfolge!(),
        " LIMIT 1"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .bind(&transport.zeitpunkt_at)
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    let vorher = vorher
        .flatten()
        .as_deref()
        .and_then(TransportPrioritaet::parse);

    let (juengste, aktuell): (i64, Option<String>) = sqlx::query_as(concat!(
        "SELECT id, prioritaet FROM person_transport WHERE einsatz_id = ? AND person_id = ? ",
        transportfolge!(),
        " LIMIT 1"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einsatz_person SET \
            transport_prioritaet = (SELECT prioritaet FROM person_transport WHERE id = ?1), \
            transport_art = (SELECT art FROM person_transport WHERE id = ?1), \
            transport_fachrichtung = (SELECT fachrichtung FROM person_transport WHERE id = ?1), \
            transport_at = (SELECT CASE WHEN prioritaet IS NULL AND art IS NULL \
                                         AND fachrichtung IS NULL THEN NULL \
                                    ELSE zeitpunkt_at END \
                            FROM person_transport WHERE id = ?1) \
         WHERE id = ?2 AND einsatz_id = ?3",
    )
    .bind(juengste)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(ErfassterTransport {
        transport,
        gewinnt: juengste == id,
        vorher,
        aktuell: aktuell.as_deref().and_then(TransportPrioritaet::parse),
    })
}

/// Der schon gespeicherte Stand zu einer `client_id` im Einsatz (Replay der Offline-Queue).
pub async fn nach_client_id(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<TransportAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, TransportAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_TRANSPORT} WHERE einsatz_id = ? AND client_id = ?"
        )))
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(executor)
        .await?,
    )
}

/// Lädt einen Stand auf einer offenen Verbindung; `NotFound`, falls nicht zum Einsatz.
pub async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<TransportAnzeige, AppError> {
    sqlx::query_as::<_, TransportAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_TRANSPORT} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Transport-Verlauf einer Person, der aktuelle Stand zuerst.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<TransportAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, TransportAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_TRANSPORT} WHERE einsatz_id = ? AND person_id = ? {}",
            transportfolge!()
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
}
