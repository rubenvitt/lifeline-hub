//! Ausgangsereignisse für Fremdsysteme: der Abruf `GET /api/v1/events` (LLH-1655, Spec
//! `ereignis-abruf`, Herleitung
//! `openspec/changes/archive/2026-11-13-umeqho2b-outbox-ereignis-abruf/design.md`).
//!
//! Die Outbox ist die Tabelle `maschine_ereignis`. **Dieses Modul schreibt nie hinein:** Jede
//! Zeile entsteht in einem Trigger, in der Transaktion der Änderung, und gehört genau einem
//! Zugang (design.md D2, D3). Hier wird nur gelesen (Abruf) und gelöscht (Purge).
//!
//! - Der **Cursor** ist die fortlaufende Nummer `id`. Der Höchststand steht in
//!   `sqlite_sequence`, die Löschgrenze in `maschine_ereignis_stand` (D8).
//! - Der **Long-Poll** fragt im Takt nach, statt geweckt zu werden, und hält zwischen zwei
//!   Nachfragen keine Datenbankverbindung (D9).
//! - Die **Wartegrenzen** sind prozessweit ([`Warteraum`], D10).

use std::collections::HashSet;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::{header::RETRY_AFTER, HeaderValue, StatusCode};
use axum::response::Response;
use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::Instant;
use utoipa::ToSchema;

use super::machine::MachineClient;
use super::scope::Scope;
use super::{ApiError, ErrorCode};
use crate::app::AppState;
use crate::error::AppError;
use crate::wire_enum::wire_enum;

wire_enum! {
    // Wire-Werte nach LFH-1312: Fachbegriff deutsch, Vorgang englisch. Dieselben Werte stehen
    // im CHECK von `maschine_ereignis.type` (Abgleich in `tests/public_api_events.rs`). Der
    // Doc-Kommentar steht im öffentlichen Dokument.
    /// Art eines Ereignisses. Neue Arten kommen nur hinzu; ein Client überspringt unbekannte.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum EventType {
        /// Der Einsatz ist für den Zugang lesbar geworden.
        EinsatzCreated => "einsatz.created",
        /// Ein Feld des Einsatzkopfs hat sich geändert.
        EinsatzUpdated => "einsatz.updated",
        /// Der Einsatz ist für den Zugang nicht mehr lesbar.
        EinsatzClosed => "einsatz.closed",
        /// Die Lage des Einsatzes kann sich geändert haben.
        LageChanged => "lage.changed",
    }
}

impl EventType {
    /// Der Scope, den ein Zugang neben `events:read` braucht, um diese Art zu sehen.
    pub const fn scope(self) -> Scope {
        match self {
            EventType::EinsatzCreated | EventType::EinsatzUpdated | EventType::EinsatzClosed => {
                Scope::EinsaetzeRead
            }
            EventType::LageChanged => Scope::LageRead,
        }
    }
}

/// Die Tabellen, deren Änderung `lage.changed` auslöst: die Quellen der Lage
/// (`public_api::lage::QUELLEN`) ohne den Einsatzkopf, den der Trigger `einsatz_ereignis_lage`
/// spaltenweise abdeckt. Dieselbe Liste steht im Trigger `einsatz_aenderung_ereignis_i`
/// (Abgleich in `tests::lage_arten_sind_die_quellen_der_lage_und_stehen_im_trigger`). Liest die
/// Lage aus einer weiteren Tabelle, kommt sie hier dazu, und eine neue Migration baut den Trigger
/// neu (`src/AGENTS.md`, Ausgangsereignisse für Fremdsysteme).
pub const LAGE_ARTEN: &[&str] = &[
    "einsatz_person",
    "einsatz_lagekennzahl_wahl",
    "einsatz_personal",
    "einsatz_einheit",
    "uhs",
    "uhs_platz",
    "lagebericht",
    "lage_zone",
    "einsatzabschnitt",
    "freies_zeichen",
    "meldung",
    "kommunikation_status",
];

/// Die Spalten des Einsatzkopfs, die in die Lage einfließen (`public_api::lage`: Bezeichnung,
/// Stichwort, Einsatzart, Beginn und der Ort auf der Karte). Der Trigger `einsatz_ereignis_lage`
/// hört auf genau diese.
pub const LAGE_KOPF_SPALTEN: &[&str] = &[
    "bezeichnung",
    "stichwort",
    "einsatzart",
    "begonnen_at",
    "einsatzort_lat",
    "einsatzort_lon",
];

/// Höchstzahl der Ereignisse je Antwort. Eine volle Seite heißt: gleich weiter abrufen.
pub const SEITE: i64 = 500;

/// Längste Wartezeit eines Abrufs in Sekunden. Liegt unter `zulassung::REQUEST_BUDGET`.
pub const WAIT_MAX_S: u64 = 25;

/// Wie viele Abrufe gleichzeitig warten dürfen. Klein gegen
/// `zulassung::MAX_GLEICHZEITIGE_REQUESTS`, weil jeder Wartende einen Zulassungsplatz hält.
pub const MAX_WARTENDE: usize = 32;

/// `Retry-After` in Sekunden für einen Abruf, der warten wollte und keinen Platz bekam.
pub const RETRY_AFTER_S: u64 = 10;

/// Abstand zweier Nachfragen eines wartenden Abrufs.
pub const TAKT: Duration = Duration::from_secs(1);

/// Aufbewahrung der Ereignisse in Tagen.
pub const AUFBEWAHRUNG_TAGE: i64 = 7;

/// Ein Ausgangsereignis: Art, Zeit und Einsatz, sonst nichts. Den Inhalt liest der Client über
/// die Leserouten nach.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Event {
    /// Fortlaufende Nummer; steigt in der Reihenfolge der Änderungen.
    pub id: i64,
    /// Art des Ereignisses. Unbekannte Werte überspringen.
    #[serde(rename = "type")]
    pub event_type: EventType,
    /// Zeitpunkt in UTC, `JJJJ-MM-TT hh:mm:ss`.
    pub occurred_at: String,
    /// Kennung des Einsatzes an dieser Instanz.
    pub einsatz_id: i64,
}

/// Antwort des Abrufs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EventsResponse {
    /// Stand, bis zu dem geprüft wurde; der nächste Abruf nennt ihn als `after`.
    pub cursor: i64,
    /// Ereignisse des Zugangs nach `after`, aufsteigend nach `id`, höchstens 500.
    pub events: Vec<Event>,
}

/// Ergebnis eines Abrufs mit Wartewunsch.
#[derive(Debug)]
pub struct Abruf {
    pub antwort: EventsResponse,
    /// Der Abruf wollte warten, fand nichts vor und bekam keinen Warteplatz. Die Route setzt
    /// dann `Retry-After`.
    pub ohne_warteplatz: bool,
}

/// Höchststand und Löschgrenze der Outbox.
struct Stand {
    head: i64,
    purged_until: i64,
}

async fn stand(conn: &mut SqliteConnection) -> Result<Stand, sqlx::Error> {
    let (head, purged_until): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'maschine_ereignis'), 0), \
                COALESCE((SELECT purged_until FROM maschine_ereignis_stand WHERE id = 1), 0)",
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(Stand { head, purged_until })
}

/// Der Höchststand der Outbox: der Cursor, ab dem ein Abruf nichts verpasst, was nach diesem
/// Aufruf festgeschrieben wird. Die Einsatzliste liest ihn **vor** den Einsätzen (design.md D11).
pub async fn hoechststand(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    let mut conn = pool.acquire().await?;
    Ok(stand(&mut conn).await?.head)
}

/// Die Arten, die ein Zugang mit diesen Scopes sieht. Auch die Webhooks liefern nur diese
/// (LLH-1656).
pub fn sichtbare_arten(scopes: &[Scope]) -> Vec<EventType> {
    EventType::ALLE
        .into_iter()
        .filter(|art| scopes.contains(&art.scope()))
        .collect()
}

/// Die Zeilen des Zugangs in `(after, head]`, aufsteigend, höchstens [`SEITE`]; dazu der neue
/// Cursor. `head` wurde vor diesem Aufruf gelesen: alles bis dorthin ist festgeschrieben, alles
/// Spätere liegt über dem gelieferten Cursor.
async fn seite(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    arten: &[EventType],
    after: i64,
    head: i64,
) -> Result<EventsResponse, sqlx::Error> {
    if arten.is_empty() || after >= head {
        return Ok(EventsResponse {
            cursor: head.max(after),
            events: Vec::new(),
        });
    }
    let mut abfrage = sqlx::QueryBuilder::new(
        "SELECT id, type, occurred_at, einsatz_id FROM maschine_ereignis WHERE zugang_id = ",
    );
    abfrage.push_bind(zugang_id);
    abfrage.push(" AND id > ").push_bind(after);
    abfrage.push(" AND id <= ").push_bind(head);
    abfrage.push(" AND type IN (");
    let mut liste = abfrage.separated(", ");
    for art in arten {
        liste.push_bind(art.as_str());
    }
    abfrage.push(") ORDER BY id LIMIT ").push_bind(SEITE);
    let zeilen: Vec<(i64, String, String, i64)> =
        abfrage.build_query_as().fetch_all(&mut *conn).await?;

    let events: Vec<Event> = zeilen
        .into_iter()
        // Der CHECK der Tabelle lässt nur bekannte Arten zu; eine unbekannte (neuere Migration,
        // älteres Binary) wird übersprungen statt die Antwort scheitern zu lassen.
        .filter_map(|(id, art, occurred_at, einsatz_id)| {
            Some(Event {
                id,
                event_type: EventType::parse(&art)?,
                occurred_at,
                einsatz_id,
            })
        })
        .collect();
    let voll = events.len() as i64 >= SEITE;
    let cursor = match events.last() {
        Some(letztes) if voll => letztes.id,
        _ => head,
    };
    Ok(EventsResponse { cursor, events })
}

/// Liest die Ereignisse des Zugangs nach `after`, ohne zu warten (design.md D8).
///
/// Ohne `after` kommt der aktuelle Stand ohne Ereignisse. Ein Cursor unter der Löschgrenze oder
/// über dem Höchststand ist abgelaufen (`410 cursor_expired`).
pub async fn lesen(
    pool: &SqlitePool,
    zugang_id: &str,
    scopes: &[Scope],
    after: Option<i64>,
) -> Result<EventsResponse, ApiError> {
    let Some(after) = after else {
        return Ok(EventsResponse {
            cursor: hoechststand(pool).await?,
            events: Vec::new(),
        });
    };
    lesen_ab(pool, zugang_id, &sichtbare_arten(scopes), after).await
}

/// Stand und Zeilen aus **einem** Schnappschuss: eine Lesetransaktion auf einer Verbindung, die
/// danach sofort zurückgeht. Zwei getrennte Abfragen ließen einen Purge dazwischen; die Prüfung
/// sähe die alte Löschgrenze, die Seite den schon gelöschten Bereich, und statt `410` käme eine
/// Antwort mit Lücke.
async fn lesen_ab(
    pool: &SqlitePool,
    zugang_id: &str,
    arten: &[EventType],
    after: i64,
) -> Result<EventsResponse, ApiError> {
    let mut tx = pool.begin().await?;
    let stand = stand(&mut tx).await?;
    if after < stand.purged_until || after > stand.head {
        return Err(cursor_abgelaufen());
    }
    let antwort = seite(&mut tx, zugang_id, arten, after, stand.head).await?;
    tx.commit().await?;
    Ok(antwort)
}

/// Was der Webhook eines Zugangs als Nächstes zustellen soll (LLH-1656, design.md D2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Naechstes {
    /// Das nächste fällige Ereignis nach dem Cursor.
    Ereignis(Event),
    /// Nichts fällig.
    Leer,
    /// Das zuletzt fällige, nicht zugestellte Ereignis (`offen_id`) ist schon gelöscht. Der Webhook
    /// setzt beim Höchststand `head` an.
    Verloren { head: i64 },
}

/// Das nächste fällige Ereignis des Zugangs nach `after` unter den Arten `arten`, aus einem
/// Schnappschuss wie [`lesen`]. `offen_id` ist das Ereignis, das beim letzten Blick fällig war und
/// nicht zugestellt werden konnte: Liegt es unter der Löschgrenze, ist es verloren. Ein Cursor
/// unter der Löschgrenze allein ist kein Verlust; gelesen wird ohnehin nur `id > after`.
pub async fn naechstes(
    pool: &SqlitePool,
    zugang_id: &str,
    arten: &[EventType],
    after: i64,
    offen_id: Option<i64>,
) -> Result<Naechstes, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let stand = stand(&mut tx).await?;
    if offen_id.is_some_and(|offen| offen <= stand.purged_until) {
        return Ok(Naechstes::Verloren { head: stand.head });
    }
    if arten.is_empty() || after >= stand.head {
        return Ok(Naechstes::Leer);
    }
    let mut abfrage = sqlx::QueryBuilder::new(
        "SELECT id, type, occurred_at, einsatz_id FROM maschine_ereignis WHERE zugang_id = ",
    );
    abfrage.push_bind(zugang_id);
    abfrage.push(" AND id > ").push_bind(after);
    abfrage.push(" AND id <= ").push_bind(stand.head);
    abfrage.push(" AND type IN (");
    let mut liste = abfrage.separated(", ");
    for art in arten {
        liste.push_bind(art.as_str());
    }
    abfrage.push(") ORDER BY id LIMIT 1");
    let zeile: Option<(i64, String, String, i64)> =
        abfrage.build_query_as().fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(match zeile {
        Some((id, art, occurred_at, einsatz_id)) => match EventType::parse(&art) {
            Some(event_type) => Naechstes::Ereignis(Event {
                id,
                event_type,
                occurred_at,
                einsatz_id,
            }),
            // Der CHECK lässt nur bekannte Arten zu, und die Abfrage filtert auf sie.
            None => Naechstes::Leer,
        },
        None => Naechstes::Leer,
    })
}

/// Höchststand und Löschgrenze der Outbox (Wiederaufnahme eines Webhooks, LLH-1656).
pub async fn stand_lesen(conn: &mut SqliteConnection) -> Result<(i64, i64), sqlx::Error> {
    let st = stand(conn).await?;
    Ok((st.head, st.purged_until))
}

fn cursor_abgelaufen() -> ApiError {
    ApiError::new(
        ErrorCode::CursorExpired,
        "Der Cursor ist abgelaufen. Den Stand neu aufbauen: mit „Einsätze lesen“ über \
         GET /api/v1/einsaetze und dessen Cursor, sonst über GET /api/v1/events ohne after und \
         danach GET /api/v1/lage.",
    )
}

/// Zählt die wartenden Abrufe: insgesamt höchstens `max`, je Zugang höchstens einer. Klonbar,
/// teilt seinen Zustand.
#[derive(Clone)]
pub struct Warteraum {
    gesamt: Arc<Semaphore>,
    zugaenge: Arc<Mutex<HashSet<String>>>,
}

impl Warteraum {
    pub fn neu(max: usize) -> Self {
        Self {
            gesamt: Arc::new(Semaphore::new(max)),
            zugaenge: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Belegt einen Warteplatz für den Zugang, ohne zu warten. `None`, wenn der Zugang schon
    /// wartet oder alle Plätze belegt sind. Der Platz fällt zurück, wenn der [`Warteplatz`]
    /// fällt, auch bei einem abgebrochenen Abruf.
    pub fn belegen(&self, zugang_id: &str) -> Option<Warteplatz> {
        let mut zugaenge = self.zugaenge.lock().expect("Warteraum");
        if zugaenge.contains(zugang_id) {
            return None;
        }
        let gesamt = self.gesamt.clone().try_acquire_owned().ok()?;
        zugaenge.insert(zugang_id.to_string());
        Some(Warteplatz {
            zugang_id: zugang_id.to_string(),
            zugaenge: self.zugaenge.clone(),
            _gesamt: gesamt,
        })
    }

    /// Wie viele Abrufe gerade warten.
    pub fn wartende(&self) -> usize {
        self.zugaenge.lock().expect("Warteraum").len()
    }
}

/// Ein belegter Warteplatz; gibt beim Fallen frei.
pub struct Warteplatz {
    zugang_id: String,
    zugaenge: Arc<Mutex<HashSet<String>>>,
    _gesamt: OwnedSemaphorePermit,
}

impl Drop for Warteplatz {
    fn drop(&mut self) {
        if let Ok(mut zugaenge) = self.zugaenge.lock() {
            zugaenge.remove(&self.zugang_id);
        }
    }
}

/// Der Warteraum des Prozesses. Als `static`, weil die Grenze eine Eigenschaft der Maschine ist
/// und ein `AppState`-Feld jede Test-Konstruktion bräche (Muster `auth::provider::password`).
static WARTERAUM: LazyLock<Warteraum> = LazyLock::new(|| Warteraum::neu(MAX_WARTENDE));

/// Abruf mit Wartewunsch gegen den Warteraum des Prozesses (design.md D9, D10).
pub async fn abrufen(
    pool: &SqlitePool,
    zugang_id: &str,
    scopes: &[Scope],
    after: Option<i64>,
    wait: Duration,
) -> Result<Abruf, ApiError> {
    abrufen_mit(pool, zugang_id, scopes, after, wait, &WARTERAUM, TAKT).await
}

/// Wie [`abrufen`], mit eigenem Warteraum und Takt (Tests).
///
/// Liegt etwas vor, kommt es sofort. Sonst wartet der Abruf bis zu `wait`, sofern er einen
/// Warteplatz bekommt, und fragt im `takt` nach. Zwischen den Nachfragen hält er keine
/// Datenbankverbindung. Ohne `after` und ohne `wait` wartet er nie.
pub async fn abrufen_mit(
    pool: &SqlitePool,
    zugang_id: &str,
    scopes: &[Scope],
    after: Option<i64>,
    wait: Duration,
    warteraum: &Warteraum,
    takt: Duration,
) -> Result<Abruf, ApiError> {
    let mut antwort = lesen(pool, zugang_id, scopes, after).await?;
    if after.is_none() || wait.is_zero() || !antwort.events.is_empty() {
        return Ok(Abruf {
            antwort,
            ohne_warteplatz: false,
        });
    }
    let Some(_platz) = warteraum.belegen(zugang_id) else {
        return Ok(Abruf {
            antwort,
            ohne_warteplatz: true,
        });
    };

    let arten = sichtbare_arten(scopes);
    let ende = Instant::now() + wait;
    loop {
        let jetzt = Instant::now();
        if jetzt >= ende {
            break;
        }
        tokio::time::sleep(takt.min(ende - jetzt)).await;
        // Weiter ab dem zuletzt geprüften Stand: davor lag nichts für diesen Zugang.
        antwort = lesen_ab(pool, zugang_id, &arten, antwort.cursor).await?;
        if !antwort.events.is_empty() {
            break;
        }
    }
    Ok(Abruf {
        antwort,
        ohne_warteplatz: false,
    })
}

/// Löscht Ereignisse, die älter als [`AUFBEWAHRUNG_TAGE`] sind, und hält fest, bis zu welcher
/// Nummer gelöscht ist (Purge-Lauf, Phase C; design.md D12). Liefert die Zahl der gelöschten
/// Zeilen.
///
/// Gelöscht wird nach Nummer, nicht nach Zeit: So passen Löschgrenze und Bestand auch nach einem
/// Uhrensprung zusammen.
pub async fn purge(pool: &SqlitePool, jetzt: &str) -> Result<u64, AppError> {
    let frist = format!("-{AUFBEWAHRUNG_TAGE} days");
    crate::write_retry!(pool, |conn| {
        sqlx::query(
            "UPDATE maschine_ereignis_stand SET purged_until = MAX(purged_until, COALESCE( \
                 (SELECT MAX(id) FROM maschine_ereignis WHERE occurred_at < datetime(?, ?)), 0)) \
             WHERE id = 1",
        )
        .bind(jetzt)
        .bind(&frist)
        .execute(&mut *conn)
        .await?;
        let geloescht = sqlx::query(
            "DELETE FROM maschine_ereignis \
             WHERE id <= (SELECT purged_until FROM maschine_ereignis_stand WHERE id = 1)",
        )
        .execute(&mut *conn)
        .await?
        .rows_affected();
        Ok(geloescht)
    })
}

/// Abfrage des Abrufs. Beide Werte kommen als Text und werden im Handler geprüft, damit ein
/// falscher Wert den Code `invalid_field` bekommt.
#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    pub after: Option<String>,
    pub wait: Option<String>,
}

/// `after`: eine ganze Zahl ab 0; fehlt es, beginnt der Zugang beim aktuellen Stand.
fn parse_after(roh: Option<&str>) -> Result<Option<i64>, ApiError> {
    let Some(roh) = roh else { return Ok(None) };
    match roh.parse::<i64>() {
        Ok(after) if after >= 0 => Ok(Some(after)),
        _ => Err(ApiError::new(
            ErrorCode::InvalidField,
            "after: erwartet wird der Cursor aus der letzten Antwort, eine ganze Zahl ab 0.",
        )),
    }
}

/// `wait`: ganze Sekunden von 0 bis [`WAIT_MAX_S`]; fehlt es, wartet der Abruf nicht.
fn parse_wait(roh: Option<&str>) -> Result<Duration, ApiError> {
    let Some(roh) = roh else {
        return Ok(Duration::ZERO);
    };
    match roh.parse::<u64>() {
        Ok(sekunden) if sekunden <= WAIT_MAX_S => Ok(Duration::from_secs(sekunden)),
        _ => Err(ApiError::new(
            ErrorCode::InvalidField,
            format!("wait: erwartet werden ganze Sekunden von 0 bis {WAIT_MAX_S}."),
        )),
    }
}

/// Ereignisse des Zugangs nach einem Cursor, auf Wunsch mit Warten (Long-Poll).
///
/// Ohne `after` kommt der aktuelle Stand ohne Ereignisse. Mit `wait` bleibt der Abruf offen, bis
/// ein Ereignis vorliegt oder die Zeit abläuft. Kommt eine volle Seite (500), liegt vermutlich
/// mehr vor: gleich mit dem neuen Cursor weiter abrufen.
#[utoipa::path(
    get,
    path = "/api/v1/events",
    tag = "Ereignisse",
    operation_id = "get_events",
    security(("machine" = ["events:read"])),
    params(
        ("after" = Option<i64>, Query,
            description = "Cursor aus der letzten Antwort oder aus `GET /api/v1/einsaetze`. Ohne ihn antwortet der Abruf sofort mit dem aktuellen Stand und ohne Ereignisse."),
        ("wait" = Option<u8>, Query, maximum = 25,
            description = "Höchste Wartezeit in ganzen Sekunden (0 bis 25), bis ein Ereignis vorliegt. Ohne ihn wartet der Abruf nicht."),
    ),
    responses(
        (status = 200,
            description = "Ereignisse nach `after`, aufsteigend nach `id`; Antwort signiert im Kopf `Lifeline-Signature`. Trägt die Antwort `Retry-After`, war kein Warteplatz frei (höchstens 32 Abrufe warten zugleich, je Zugang einer): so viele Sekunden bis zum nächsten Abruf warten.",
            body = EventsResponse,
            headers(("Retry-After" = u64, description = "Nur an einer leeren Antwort ohne Warteplatz: Sekunden bis zum nächsten Abruf"))),
        (status = 400, description = "`after` oder `wait` ungültig (`invalid_field`)", body = super::ApiErrorBody),
        (status = 401, description = "Anmeldung fehlgeschlagen (Grund nur am Zugang)", body = super::ApiErrorBody),
        (status = 403, description = "Dem Zugang fehlt `events:read` (`missing_scope`)", body = super::ApiErrorBody),
        (status = 410, description = "Der Cursor ist älter als die Aufbewahrung von sieben Tagen oder gehört zu einem anderen Stand (`cursor_expired`): den Stand neu aufbauen, mit `einsaetze:read` über `GET /api/v1/einsaetze` und dessen Cursor, sonst über `GET /api/v1/events` ohne `after` und danach `GET /api/v1/lage`", body = super::ApiErrorBody),
        (status = 429, description = "Gedrosselt; `Retry-After` nennt die Wartezeit", body = super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn events(
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
    client: MachineClient,
) -> Result<Response, ApiError> {
    let after = parse_after(query.after.as_deref())?;
    let wait = parse_wait(query.wait.as_deref())?;
    let abruf = abrufen(
        &state.pool,
        &client.zugang.id,
        &client.zugang.scopes,
        after,
        wait,
    )
    .await?;
    let mut antwort = client.antwort(StatusCode::OK, &abruf.antwort);
    if abruf.ohne_warteplatz {
        // Kein Fehler: der Client soll nur nicht sofort wieder anfragen und so in seine
        // Drosselung laufen (design.md D10). `ApiError` setzt den Kopf nur an 429.
        antwort
            .headers_mut()
            .insert(RETRY_AFTER, HeaderValue::from(RETRY_AFTER_S));
    }
    Ok(antwort)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jede_art_braucht_einen_scope_mit_einsatzbezug() {
        for art in EventType::ALLE {
            assert!(
                matches!(art.scope(), Scope::EinsaetzeRead | Scope::LageRead),
                "{} hängt an einem Lese-Scope mit Einsatzbezug",
                art.as_str()
            );
        }
    }

    #[test]
    fn events_read_allein_oeffnet_keine_art() {
        assert!(sichtbare_arten(&[Scope::EventsRead]).is_empty());
        assert_eq!(
            sichtbare_arten(&[Scope::EventsRead, Scope::LageRead]),
            vec![EventType::LageChanged]
        );
        assert_eq!(
            sichtbare_arten(&[Scope::EinsaetzeRead]),
            vec![
                EventType::EinsatzCreated,
                EventType::EinsatzUpdated,
                EventType::EinsatzClosed
            ]
        );
    }

    #[test]
    fn ein_zugang_wartet_hoechstens_einmal_und_der_raum_ist_begrenzt() {
        let raum = Warteraum::neu(2);
        let a = raum.belegen("a").expect("erster Platz");
        assert!(
            raum.belegen("a").is_none(),
            "derselbe Zugang wartet nicht zweimal"
        );
        let _b = raum.belegen("b").expect("zweiter Platz");
        assert!(raum.belegen("c").is_none(), "der Raum ist voll");
        assert_eq!(raum.wartende(), 2);
        drop(a);
        assert_eq!(raum.wartende(), 1);
        assert!(
            raum.belegen("c").is_some(),
            "ein freier Platz geht an den nächsten"
        );
    }

    #[test]
    fn die_wartezeit_liegt_unter_dem_budget_der_zulassung() {
        assert!(Duration::from_secs(WAIT_MAX_S) + TAKT < crate::zulassung::REQUEST_BUDGET);
        assert!(MAX_WARTENDE < crate::zulassung::MAX_GLEICHZEITIGE_REQUESTS);
    }

    #[test]
    fn after_ist_eine_ganze_zahl_ab_null_oder_fehlt() {
        assert_eq!(parse_after(None).unwrap(), None);
        assert_eq!(parse_after(Some("0")).unwrap(), Some(0));
        assert_eq!(parse_after(Some("4711")).unwrap(), Some(4711));
        for falsch in ["abc", "-1", "1.5", "", " 7", "99999999999999999999"] {
            let fehler = parse_after(Some(falsch)).unwrap_err();
            assert_eq!(fehler.code, ErrorCode::InvalidField, "after={falsch:?}");
            assert_eq!(fehler.status, StatusCode::BAD_REQUEST);
        }
    }

    #[test]
    fn wait_ist_null_bis_fuenfundzwanzig_sekunden_oder_fehlt() {
        assert_eq!(parse_wait(None).unwrap(), Duration::ZERO);
        assert_eq!(parse_wait(Some("0")).unwrap(), Duration::ZERO);
        assert_eq!(parse_wait(Some("25")).unwrap(), Duration::from_secs(25));
        for falsch in ["26", "60", "x", "-1", "2.5", ""] {
            let fehler = parse_wait(Some(falsch)).unwrap_err();
            assert_eq!(fehler.code, ErrorCode::InvalidField, "wait={falsch:?}");
        }
    }

    /// Text eines Triggers aus dem Schema.
    async fn trigger_sql(name: &str) -> String {
        let pool = crate::db::test_pool().await;
        sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
            .bind(name)
            .fetch_one(&pool)
            .await
            .expect("Trigger steht im Schema")
    }

    fn sortiert(liste: &[&'static str]) -> Vec<&'static str> {
        let mut liste = liste.to_vec();
        liste.sort();
        liste
    }

    #[tokio::test]
    async fn lage_arten_sind_die_quellen_der_lage_und_stehen_im_trigger() {
        // Die Lage nennt ihre Quellen selbst; der Kopf hat seinen eigenen Trigger.
        let quellen: Vec<&str> = crate::public_api::lage::QUELLEN
            .iter()
            .copied()
            .filter(|t| *t != "einsatz")
            .collect();
        assert_eq!(
            sortiert(LAGE_ARTEN),
            sortiert(&quellen),
            "liest die Lage aus einer weiteren Tabelle, gehört sie in LAGE_ARTEN und in den Trigger"
        );
        // Nur gespiegelte Tabellen schreiben ins Änderungslog, an dem der Trigger hängt.
        for art in LAGE_ARTEN {
            assert!(
                crate::instanz::spiegel::art::GESPIEGELT
                    .iter()
                    .any(|g| g.tabelle == *art),
                "{art} schreibt nicht ins Änderungslog: lage.changed bliebe aus"
            );
        }
        let sql = trigger_sql("einsatz_aenderung_ereignis_i").await;
        let liste =
            &sql[sql.find("NEW.art IN (").expect("Liste der Arten") + "NEW.art IN (".len()..];
        let liste = &liste[..liste.find(')').unwrap()];
        let mut im_trigger: Vec<&str> = liste
            .split(',')
            .map(|a| a.trim().trim_matches('\''))
            .collect();
        im_trigger.sort();
        assert_eq!(im_trigger, sortiert(LAGE_ARTEN));
    }

    #[tokio::test]
    async fn der_lage_trigger_am_kopf_kennt_genau_die_lagespalten() {
        let sql = trigger_sql("einsatz_ereignis_lage").await;
        let liste = &sql[sql.find("UPDATE OF").unwrap() + "UPDATE OF".len()
            ..sql.find("ON einsatz").expect("Trigger an einsatz")];
        let mut im_trigger: Vec<&str> = liste.split(',').map(str::trim).collect();
        im_trigger.sort();
        assert_eq!(im_trigger, sortiert(LAGE_KOPF_SPALTEN));
        for spalte in LAGE_KOPF_SPALTEN {
            assert!(
                sql.contains(&format!("OLD.{spalte} IS NOT NEW.{spalte}")),
                "der Trigger vergleicht {spalte}"
            );
            assert!(
                crate::public_api::einsaetze::KOPF_SPALTEN.contains(spalte),
                "{spalte} gehört auch zum Kopf der Leseroute"
            );
        }
    }
}
