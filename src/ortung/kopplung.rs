//! Kopplung eines Einsatzfahrzeugs an eine Ortungs-Kennung (LLH-2091, Entwurf „Koppeln und
//! Trennen“). Alle `_tx`-Funktionen laufen in der Schreibtransaktion des Aufrufers; ETB und Live
//! macht der Aufrufer.

use crate::error::AppError;
use crate::ortung::{Ortungsziel, Positionsquelle};
use crate::public_api::scope::Scope;
use sqlx::{SqliteConnection, SqlitePool};

/// Der Zugang, an dem eine Kopplung hängt: ein lokaler Einwurf-Zugang oder ein Zugang des Hubs
/// (LLH-2119), also eines Einwurf-Zugangs einer gekoppelten Instanz.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KopplungZugang {
    Lokal {
        zugang_id: String,
    },
    Hub {
        instanz_kopplung_id: i64,
        zugang_id: String,
    },
}

/// Eine Kopplung mit dem Namen ihres Zugangs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Kopplung {
    pub einsatz_fahrzeug_id: i64,
    pub einsatz_id: i64,
    pub zugang: KopplungZugang,
    pub zugang_name: String,
    pub kennung: String,
    pub gekoppelt_at: String,
}

impl Kopplung {
    /// Der Schlüssel des Zugangs, beider Arten (lokal: `einwurf_zugang.id`, Hub: die ID des
    /// Zugangs auf dem Hub).
    pub fn access_id(&self) -> &str {
        match &self.zugang {
            KopplungZugang::Lokal { zugang_id } | KopplungZugang::Hub { zugang_id, .. } => {
                zugang_id
            }
        }
    }
}

/// Die Zeile, wie die Datenbank sie liefert; [`Kopplung`] macht daraus die Art des Zugangs.
#[derive(sqlx::FromRow)]
struct KopplungZeile {
    einsatz_fahrzeug_id: i64,
    einsatz_id: i64,
    zugang_id: Option<String>,
    instanz_kopplung_id: Option<i64>,
    fremder_zugang_id: Option<String>,
    zugang_name: Option<String>,
    kennung: String,
    gekoppelt_at: String,
}

impl TryFrom<KopplungZeile> for Kopplung {
    type Error = AppError;

    fn try_from(z: KopplungZeile) -> Result<Self, AppError> {
        let zugang = match (z.zugang_id, z.instanz_kopplung_id, z.fremder_zugang_id) {
            (Some(zugang_id), None, None) => KopplungZugang::Lokal { zugang_id },
            (None, Some(instanz_kopplung_id), Some(zugang_id)) => KopplungZugang::Hub {
                instanz_kopplung_id,
                zugang_id,
            },
            _ => {
                return Err(AppError::Internal(
                    "Ortungs-Kopplung ohne eindeutigen Zugang".into(),
                ))
            }
        };
        Ok(Self {
            einsatz_fahrzeug_id: z.einsatz_fahrzeug_id,
            einsatz_id: z.einsatz_id,
            zugang,
            zugang_name: z.zugang_name.unwrap_or_default(),
            kennung: z.kennung,
            gekoppelt_at: z.gekoppelt_at,
        })
    }
}

/// Eine Kennung der letzten 24 Stunden. Bewusst ohne Koordinaten.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Kandidat {
    pub zugang_id: String,
    pub zugang_name: String,
    pub kennung: String,
    pub empfangen_at: String,
    pub gekoppelt: bool,
}

const SELECT_KOPPLUNG: &str = "SELECT k.einsatz_fahrzeug_id, k.einsatz_id, k.zugang_id, \
        k.instanz_kopplung_id, k.fremder_zugang_id, \
        COALESCE(z.name, k.zugang_name) AS zugang_name, k.kennung, k.gekoppelt_at \
     FROM ortung_kopplung k LEFT JOIN einwurf_zugang z ON z.id = k.zugang_id";

/// Die Kopplung des Einsatzfahrzeugs, wenn es eine hat.
pub async fn load_kopplung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<Option<Kopplung>, AppError> {
    sqlx::query_as::<_, KopplungZeile>(sqlx::AssertSqlSafe(format!(
        "{SELECT_KOPPLUNG} WHERE k.einsatz_fahrzeug_id = ? AND k.einsatz_id = ?"
    )))
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .map(Kopplung::try_from)
    .transpose()
}

/// Meldung des 422, wenn der Org-Schalter „Ortung im Einsatz“ (ADR-0101) aus ist.
pub const MELDUNG_SCHALTER_AUS: &str = "Ortung ist für diese Organisation ausgeschaltet \
     (Verwaltung → Einsatz-Vorgaben)";

/// Koppelt das Fahrzeug an die Kennung; eine vorhandene Kopplung desselben Fahrzeugs wird
/// ersetzt. 409 bei beendetem Fahrzeug, nicht aktivem oder gespiegeltem Einsatz und bei einer
/// Kennung, die schon an einem anderen Fahrzeug hängt; 422 bei ausgeschaltetem Org-Schalter
/// „Ortung im Einsatz“ (ein Zustand, `src/AGENTS.md`, Statuscode-Konvention) und bei fremdem,
/// widerrufenem oder falschem Zugang.
pub async fn create_kopplung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    zugang_id: &str,
    kennung: &str,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Kopplung, AppError> {
    let org_id = pruefe_koppelbar_tx(conn, einsatz_id, ef_id).await?;

    let zugang: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT scope, widerrufen_at FROM einwurf_zugang WHERE id = ? AND org_id = ? \
           AND (gueltig_bis IS NULL OR gueltig_bis > ?)",
    )
    .bind(zugang_id)
    .bind(org_id)
    .bind(jetzt)
    .fetch_optional(&mut *conn)
    .await?;
    match zugang {
        Some((scope, None)) if scope == Scope::PositionenWrite.as_str() => {}
        _ => {
            return Err(AppError::UnprocessableEntity(
                "Der Zugang ist unbekannt, widerrufen, abgelaufen oder nicht für Positionen eingerichtet"
                    .into(),
            ))
        }
    }

    let belegt: Option<i64> = sqlx::query_scalar(
        "SELECT einsatz_fahrzeug_id FROM ortung_kopplung \
         WHERE zugang_id = ? AND kennung = ? AND einsatz_fahrzeug_id != ?",
    )
    .bind(zugang_id)
    .bind(kennung)
    .bind(ef_id)
    .fetch_optional(&mut *conn)
    .await?;
    if belegt.is_some() {
        return Err(AppError::Conflict(
            "Die Kennung ist schon an ein anderes Fahrzeug gekoppelt".into(),
        ));
    }

    sqlx::query("DELETE FROM ortung_kopplung WHERE einsatz_fahrzeug_id = ?")
        .bind(ef_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, zugang_id, \
         kennung, gekoppelt_at, gekoppelt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .bind(org_id)
    .bind(zugang_id)
    .bind(kennung)
    .bind(jetzt)
    .bind(benutzer_id)
    .execute(&mut *conn)
    .await?;
    load_kopplung_tx(conn, einsatz_id, ef_id)
        .await?
        .ok_or(AppError::NotFound)
}

/// Koppelt das Fahrzeug an eine Kennung eines Zugangs des Hubs (LLH-2119). Die Prüfungen sind
/// die von [`create_kopplung_tx`] ohne die Zugangsprüfung: der Zugang liegt am Hub, die Kennung
/// hat der Aufrufer im Puffer des Hubs nachgeschlagen. „Belegt“ gilt unter den Hub-Zeilen
/// derselben Instanzkopplung (409).
#[allow(clippy::too_many_arguments)]
pub async fn create_hub_kopplung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    instanz_kopplung_id: i64,
    zugang_id: &str,
    zugang_name: &str,
    kennung: &str,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Kopplung, AppError> {
    let org_id = pruefe_koppelbar_tx(conn, einsatz_id, ef_id).await?;
    let belegt: Option<i64> = sqlx::query_scalar(
        "SELECT einsatz_fahrzeug_id FROM ortung_kopplung \
         WHERE instanz_kopplung_id = ? AND fremder_zugang_id = ? AND kennung = ? \
           AND einsatz_fahrzeug_id != ?",
    )
    .bind(instanz_kopplung_id)
    .bind(zugang_id)
    .bind(kennung)
    .bind(ef_id)
    .fetch_optional(&mut *conn)
    .await?;
    if belegt.is_some() {
        return Err(AppError::Conflict(
            "Die Kennung ist schon an ein anderes Fahrzeug gekoppelt".into(),
        ));
    }
    sqlx::query("DELETE FROM ortung_kopplung WHERE einsatz_fahrzeug_id = ?")
        .bind(ef_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, \
         instanz_kopplung_id, fremder_zugang_id, zugang_name, kennung, gekoppelt_at, \
         gekoppelt_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .bind(org_id)
    .bind(instanz_kopplung_id)
    .bind(zugang_id)
    .bind(zugang_name)
    .bind(kennung)
    .bind(jetzt)
    .bind(benutzer_id)
    .execute(&mut *conn)
    .await?;
    load_kopplung_tx(conn, einsatz_id, ef_id)
        .await?
        .ok_or(AppError::NotFound)
}

/// Die gemeinsamen Prüfungen beider Kopplungsarten; liefert die Org des Einsatzes.
async fn pruefe_koppelbar_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<i64, AppError> {
    let einsatz: Option<(i64, String, bool)> =
        sqlx::query_as("SELECT org_id, status, spiegel != 0 FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    let (org_id, status, spiegel) = einsatz.ok_or(AppError::NotFound)?;
    if spiegel {
        return Err(AppError::Conflict(
            "Dieser Einsatz ist ein Spiegel; Ortung lässt sich dort nicht koppeln".into(),
        ));
    }
    if status != "aktiv" {
        return Err(AppError::Conflict("Der Einsatz ist nicht aktiv".into()));
    }
    crate::fahrzeug::disposition_repo::require_aktiv_tx(conn, einsatz_id, ef_id).await?;
    if !is_schalter_an_tx(conn, org_id).await? {
        return Err(AppError::UnprocessableEntity(MELDUNG_SCHALTER_AUS.into()));
    }
    Ok(org_id)
}

/// Ist der Org-Schalter „Ortung im Einsatz“ (ADR-0101) an? Ohne Zeile aus. In der Transaktion
/// des Aufrufers gelesen, damit Koppeln und Übernahme den Stand sehen, unter dem sie schreiben.
pub async fn is_schalter_an_tx(conn: &mut SqliteConnection, org_id: i64) -> Result<bool, AppError> {
    Ok(
        crate::org::einstellungen::laden_oder_default(&mut *conn, org_id)
            .await?
            .ortung_im_einsatz
            != 0,
    )
}

/// Löscht die Kopplung des Fahrzeugs und liefert die gelöschte; `None`, wenn es keine gab.
pub async fn delete_kopplung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<Option<Kopplung>, AppError> {
    let alt = load_kopplung_tx(conn, einsatz_id, ef_id).await?;
    if alt.is_some() {
        sqlx::query("DELETE FROM ortung_kopplung WHERE einsatz_fahrzeug_id = ? AND einsatz_id = ?")
            .bind(ef_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(alt)
}

/// Was der Abschluss an der Fahrzeugortung beendet hat (LLH-2091).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EndeImEinsatz {
    /// Die gelöschten Kopplungen; je eine bekommt einen ETB-Eintrag.
    pub getrennt: Vec<Kopplung>,
    /// Einsatzfahrzeuge, deren Position aus dem Einwurf gelöscht wurde.
    pub geleert: Vec<i64>,
}

impl EndeImEinsatz {
    /// Alle betroffenen Einsatzfahrzeuge ohne Doppel, für das Live-Ereignis nach dem Commit.
    pub fn fahrzeuge(&self) -> Vec<i64> {
        let mut ids: Vec<i64> = self
            .getrennt
            .iter()
            .map(|k| k.einsatz_fahrzeug_id)
            .chain(self.geleert.iter().copied())
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    }
}

/// Abschluss: löscht alle Kopplungen des Einsatzes und die Positionen der Quelle `einwurf`
/// (über [`crate::ortung::loesche_position`]; Quelle und Zeitpunkt bleiben als Hinweis). Manuelle
/// und Helfer-Positionen bleiben stehen. Läuft in der Abschluss-Transaktion neben
/// `helfer::ende::beende_ortung_im_einsatz`.
pub async fn beende_im_einsatz_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<EndeImEinsatz, AppError> {
    let getrennt = sqlx::query_as::<_, KopplungZeile>(sqlx::AssertSqlSafe(format!(
        "{SELECT_KOPPLUNG} WHERE k.einsatz_id = ? ORDER BY k.einsatz_fahrzeug_id"
    )))
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(Kopplung::try_from)
    .collect::<Result<Vec<_>, _>>()?;
    sqlx::query("DELETE FROM ortung_kopplung WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    let geleert: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_fahrzeug \
         WHERE einsatz_id = ? AND position_quelle = ? AND lat IS NOT NULL ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(Positionsquelle::Einwurf.as_str())
    .fetch_all(&mut *conn)
    .await?;
    for id in &geleert {
        crate::ortung::loesche_position(conn, Ortungsziel::Fahrzeug(*id)).await?;
    }
    Ok(EndeImEinsatz { getrennt, geleert })
}

/// Kennungen der letzten 24 Stunden aus den nicht widerrufenen, nicht abgelaufenen Zugängen der Org mit
/// `positionen:write`; jüngste zuerst. `jetzt` im Format [`crate::zeit::FORMAT`].
pub async fn list_kandidaten(
    pool: &SqlitePool,
    org_id: i64,
    jetzt: &str,
) -> Result<Vec<Kandidat>, AppError> {
    Ok(sqlx::query_as::<_, Kandidat>(
        "SELECT p.zugang_id, z.name AS zugang_name, p.kennung, p.empfangen_at, \
                EXISTS (SELECT 1 FROM ortung_kopplung k \
                        WHERE k.zugang_id = p.zugang_id AND k.kennung = p.kennung) AS gekoppelt \
         FROM position_letzte p JOIN einwurf_zugang z ON z.id = p.zugang_id \
         WHERE z.org_id = ? AND z.scope = ? AND z.widerrufen_at IS NULL \
           AND (z.gueltig_bis IS NULL OR z.gueltig_bis > ?) \
           AND p.empfangen_at >= datetime(?, '-24 hours') \
         ORDER BY p.empfangen_at DESC, z.name, p.kennung",
    )
    .bind(org_id)
    .bind(Scope::PositionenWrite.as_str())
    .bind(jetzt)
    .bind(jetzt)
    .fetch_all(pool)
    .await?)
}
