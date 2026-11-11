//! Lagebild für Externe (LLH-1496, Spec `lagebild-extern`): ein Link je Empfänger, ohne Konto,
//! der allein eine geschwärzte Ansicht des Einsatzes öffnet.
//!
//! Herleitung: `/mnt/project-files/llh-1496/openspec/k11guwns-lagebild-extern/design.md`.
//!
//! - Die Einsatzleitung legt eine Freigabe an (Empfänger, Stufe, Ablauf). Der Schlüssel verlässt
//!   den Server einmal, in der Antwort auf das Anlegen; gespeichert wird nur sein SHA-256 (D1).
//! - Der Schlüssel ist kein Benutzer und keine Sitzung. [`LagebildZugriff`] öffnet allein
//!   `GET /api/extern/v1/lagebild` (`routes::lagebild_extern`) und, neben der Sitzung, den
//!   Karten-Proxy ([`KartenZugriff`]); jede andere Route verlangt weiter `CurrentUser` (D3).
//! - Gültig ist eine Freigabe, solange sie nicht widerrufen und nicht abgelaufen ist und ihr
//!   Einsatz aktiv ist. Der Abschluss beendet sie so, ohne das Protokoll zu löschen (D2).
//! - Freigabe und Protokoll gelten nur an dieser Instanz und werden nicht gespiegelt (D8).

use crate::app::AppState;
use crate::error::AppError;
use crate::wire_enum::wire_enum;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Längster Empfänger in Zeichen.
pub const EMPFAENGER_MAX: usize = 80;

/// Präfix jedes Schlüssels: in einem Log oder einer Nachricht als Lifeline-Link erkennbar.
pub const SCHLUESSEL_PRAEFIX: &str = "llh_lb_";

/// Längste Kennung einer Öffnung; die Seite zieht eine UUID.
pub const OEFFNUNG_MAX: usize = 64;

/// So viele Öffnungen zeigt die Liste je Freigabe, die jüngsten zuerst.
pub const PROTOKOLL_ANZEIGE_MAX: i64 = 20;

wire_enum! {
    /// Was ein Link zeigt (design.md D4). `oeffentlich` ist eine Teilmenge von `lagebild`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum LagebildStufe {
        /// Behörde, Nachbarorganisation: Zahlen, Karte, Lagemeldung.
        Lagebild => "lagebild",
        /// Presse: Gesamtzahlen, Einsatzort und Absperrungen.
        Oeffentlich => "oeffentlich",
    }
    try_from = |s| format!("Ungültige LagebildStufe: {s}");
}

wire_enum! {
    /// Wie lange ein Link gilt (design.md D2). Spätestens der Abschluss beendet ihn.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum LagebildDauer {
        ZweiStunden => "2h",
        ZwoelfStunden => "12h",
        VierundzwanzigStunden => "24h",
        Einsatzende => "einsatzende",
    }
}

impl LagebildDauer {
    /// SQLite-Modifikator für `datetime('now', …)`; `None` heißt bis zum Einsatzende.
    pub fn modifikator(self) -> Option<&'static str> {
        match self {
            LagebildDauer::ZweiStunden => Some("+2 hours"),
            LagebildDauer::ZwoelfStunden => Some("+12 hours"),
            LagebildDauer::VierundzwanzigStunden => Some("+24 hours"),
            LagebildDauer::Einsatzende => None,
        }
    }
}

/// Erzeugt einen neuen Schlüssel: 32 Zufallsbytes, base64url ohne Auffüllung.
pub fn neuer_schluessel() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    format!(
        "{SCHLUESSEL_PRAEFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

/// SHA-256-Hex eines Schlüssels; nur das steht in der DB.
pub fn hash(schluessel: &str) -> String {
    crate::anhang::repo::sha256_hex(schluessel.as_bytes())
}

/// Bedingung einer wirksamen Freigabe; erwartet die Aliasse `f` (Freigabe) und `e` (Einsatz).
const GUELTIG: &str = "f.widerrufen_at IS NULL \
     AND (f.gueltig_bis IS NULL OR f.gueltig_bis > datetime('now')) \
     AND e.status = 'aktiv' AND e.geloescht_at IS NULL";

/// Eine Öffnung der Seite im Protokoll (design.md D6).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct LagebildOeffnung {
    /// UTC im SQLite-Format.
    pub begonnen_at: String,
    /// Letzter Abruf dieser Öffnung (UTC im SQLite-Format).
    pub zuletzt_at: String,
    pub abrufe: i64,
}

/// Eine Freigabe, wie die Einsatzleitung sie sieht. Der Schlüssel steht nie darin.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct LagebildFreigabeAnzeige {
    pub id: i64,
    pub empfaenger: String,
    pub stufe: LagebildStufe,
    /// Ende der Gültigkeit (UTC); fehlt bei „bis Einsatzende“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gueltig_bis: Option<String>,
    /// Der Link wirkt gerade: nicht widerrufen, nicht abgelaufen, Einsatz aktiv.
    pub gueltig: bool,
    pub angelegt_at: String,
    /// Anzeigename der Person, die freigegeben hat; fehlt, wenn ihr Konto gelöscht ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angelegt_von_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widerrufen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widerrufen_von_name: Option<String>,
    /// Alle Öffnungen der Seite über diesen Link.
    pub oeffnungen: i64,
    /// Letzter Abruf über diesen Link; fehlt, solange ihn niemand geöffnet hat.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zuletzt_abgerufen_at: Option<String>,
    /// Die jüngsten Öffnungen (höchstens [`PROTOKOLL_ANZEIGE_MAX`]).
    pub protokoll: Vec<LagebildOeffnung>,
}

#[derive(sqlx::FromRow)]
struct FreigabeZeile {
    id: i64,
    empfaenger: String,
    stufe: String,
    gueltig_bis: Option<String>,
    gueltig: bool,
    angelegt_at: String,
    angelegt_von_name: Option<String>,
    widerrufen_at: Option<String>,
    widerrufen_von_name: Option<String>,
    oeffnungen: i64,
    zuletzt_abgerufen_at: Option<String>,
}

/// Alle Freigaben eines Einsatzes: wirksame zuerst, dann die jüngsten.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<LagebildFreigabeAnzeige>, AppError> {
    let sql = format!(
        "SELECT f.id, f.empfaenger, f.stufe, f.gueltig_bis, ({GUELTIG}) AS gueltig, \
                f.angelegt_at, a.anzeigename AS angelegt_von_name, f.widerrufen_at, \
                w.anzeigename AS widerrufen_von_name, \
                (SELECT COUNT(*) FROM lagebild_abruf r WHERE r.freigabe_id = f.id) AS oeffnungen, \
                (SELECT MAX(r.zuletzt_at) FROM lagebild_abruf r WHERE r.freigabe_id = f.id) \
                    AS zuletzt_abgerufen_at \
         FROM lagebild_freigabe f \
         JOIN einsatz e ON e.id = f.einsatz_id \
         LEFT JOIN benutzer a ON a.id = f.angelegt_von \
         LEFT JOIN benutzer w ON w.id = f.widerrufen_von \
         WHERE f.einsatz_id = ? \
         ORDER BY gueltig DESC, f.angelegt_at DESC, f.id DESC"
    );
    let zeilen: Vec<FreigabeZeile> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
    let mut ergebnis = Vec::with_capacity(zeilen.len());
    for z in zeilen {
        let protokoll: Vec<LagebildOeffnung> = sqlx::query_as(
            "SELECT begonnen_at, zuletzt_at, abrufe FROM lagebild_abruf \
             WHERE freigabe_id = ? ORDER BY zuletzt_at DESC, id DESC LIMIT ?",
        )
        .bind(z.id)
        .bind(PROTOKOLL_ANZEIGE_MAX)
        .fetch_all(pool)
        .await?;
        ergebnis.push(LagebildFreigabeAnzeige {
            id: z.id,
            empfaenger: z.empfaenger,
            stufe: LagebildStufe::try_from(z.stufe).map_err(AppError::Internal)?,
            gueltig_bis: z.gueltig_bis,
            gueltig: z.gueltig,
            angelegt_at: z.angelegt_at,
            angelegt_von_name: z.angelegt_von_name,
            widerrufen_at: z.widerrufen_at,
            widerrufen_von_name: z.widerrufen_von_name,
            oeffnungen: z.oeffnungen,
            zuletzt_abgerufen_at: z.zuletzt_abgerufen_at,
            protokoll,
        });
    }
    Ok(ergebnis)
}

/// Eine Freigabe des Einsatzes; 404, wenn sie fremd oder unbekannt ist.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    freigabe_id: i64,
) -> Result<LagebildFreigabeAnzeige, AppError> {
    liste(pool, einsatz_id)
        .await?
        .into_iter()
        .find(|f| f.id == freigabe_id)
        .ok_or(AppError::NotFound)
}

/// Legt eine Freigabe an und liefert ihre id und ihr Ende (UTC, `None` = bis Einsatzende).
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    empfaenger: &str,
    stufe: LagebildStufe,
    dauer: LagebildDauer,
    schluessel_hash: &str,
    von: i64,
) -> Result<(i64, Option<String>), AppError> {
    Ok(sqlx::query_as(
        "INSERT INTO lagebild_freigabe \
             (einsatz_id, empfaenger, stufe, schluessel_hash, gueltig_bis, angelegt_von) \
         VALUES (?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END, ?) \
         RETURNING id, gueltig_bis",
    )
    .bind(einsatz_id)
    .bind(empfaenger)
    .bind(stufe.as_str())
    .bind(schluessel_hash)
    .bind(dauer.modifikator())
    .bind(dauer.modifikator())
    .bind(von)
    .fetch_one(&mut *conn)
    .await?)
}

/// Widerruft eine Freigabe des Einsatzes. `Some(empfaenger)`, wenn sie dabei wirksam endete;
/// `None`, wenn sie schon widerrufen war. 404, wenn sie fremd oder unbekannt ist.
pub async fn widerrufen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    freigabe_id: i64,
    von: i64,
) -> Result<Option<String>, AppError> {
    let empfaenger: String = sqlx::query_scalar(
        "SELECT empfaenger FROM lagebild_freigabe WHERE id = ? AND einsatz_id = ?",
    )
    .bind(freigabe_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    let wirkung = sqlx::query(
        "UPDATE lagebild_freigabe SET widerrufen_at = datetime('now'), widerrufen_von = ? \
         WHERE id = ? AND widerrufen_at IS NULL",
    )
    .bind(von)
    .bind(freigabe_id)
    .execute(&mut *conn)
    .await?
    .rows_affected()
        == 1;
    Ok(wirkung.then_some(empfaenger))
}

/// Vermerkt einen Abruf im Protokoll (design.md D6): die erste einer Öffnung legt die Zeile an,
/// jede weitere schiebt sie. Ein Fehler hier lässt den Abruf nicht scheitern.
pub async fn abruf_vermerken(pool: &SqlitePool, freigabe_id: i64, oeffnung: &str) {
    if let Err(e) = sqlx::query(
        "INSERT INTO lagebild_abruf (freigabe_id, oeffnung) VALUES (?, ?) \
         ON CONFLICT (freigabe_id, oeffnung) DO UPDATE \
         SET zuletzt_at = datetime('now'), abrufe = abrufe + 1",
    )
    .bind(freigabe_id)
    .bind(oeffnung)
    .execute(pool)
    .await
    {
        tracing::warn!(freigabe_id, "Abruf des Lagebilds nicht vermerkt: {e}");
    }
}

/// Die Kennung einer Öffnung aus dem Kopf `X-Lagebild-Oeffnung`: nur Buchstaben, Ziffern und
/// `-`, höchstens [`OEFFNUNG_MAX`] Zeichen. Fehlt oder passt sie nicht, zählt der Abruf als
/// eigene Öffnung „ohne Kennung“.
pub fn oeffnung_aus(kopf: Option<&str>) -> String {
    kopf.map(str::trim)
        .filter(|s| {
            !s.is_empty()
                && s.len() <= OEFFNUNG_MAX
                && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
        .map(str::to_string)
        .unwrap_or_else(|| "ohne-kennung".to_string())
}

/// Schlüssel aus `Authorization: Bearer llh_lb_…`; `None` bei jeder anderen Form.
fn schluessel_aus(parts: &Parts) -> Option<&str> {
    parts
        .headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|s| s.starts_with(SCHLUESSEL_PRAEFIX) && s.len() <= 128)
}

/// Die wirksame Freigabe zu einem Schlüssel.
async fn gueltige_freigabe(
    pool: &SqlitePool,
    schluessel: &str,
) -> Result<Option<LagebildZugriff>, AppError> {
    let sql = format!(
        "SELECT f.id, f.einsatz_id, f.stufe FROM lagebild_freigabe f \
         JOIN einsatz e ON e.id = f.einsatz_id \
         WHERE f.schluessel_hash = ? AND {GUELTIG}"
    );
    let zeile: Option<(i64, i64, String)> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(hash(schluessel))
        .fetch_optional(pool)
        .await?;
    zeile
        .map(|(freigabe_id, einsatz_id, stufe)| {
            Ok(LagebildZugriff {
                freigabe_id,
                einsatz_id,
                stufe: LagebildStufe::try_from(stufe).map_err(AppError::Internal)?,
            })
        })
        .transpose()
}

/// Gibt es eine Freigabe mit diesem Schlüssel, gleich ob noch wirksam?
async fn schluessel_bekannt(pool: &SqlitePool, schluessel: &str) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT 1 FROM lagebild_freigabe WHERE schluessel_hash = ?")
            .bind(hash(schluessel))
            .fetch_optional(pool)
            .await?
            .is_some(),
    )
}

/// Extractor der öffentlichen Lagebild-Route: eine wirksame Freigabe als
/// `Authorization: Bearer llh_lb_…`. Alles andere ist 401, ohne zu sagen, warum (fehlt,
/// unbekannt, abgelaufen, widerrufen, Einsatz abgeschlossen). Ein fehlender oder unbekannter
/// Schlüssel zählt als Fehlversuch der Adresse wie bei der Gerätekopplung, ein bekannter, nicht
/// mehr wirksamer nicht; eine gesperrte Adresse bekommt 429.
#[derive(Debug, Clone, Copy)]
pub struct LagebildZugriff {
    pub freigabe_id: i64,
    pub einsatz_id: i64,
    pub stufe: LagebildStufe,
}

impl FromRequestParts<AppState> for LagebildZugriff {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let crate::extract::PeerIp(peer_ip) =
            match crate::extract::PeerIp::from_request_parts(parts, state).await {
                Ok(p) => p,
                Err(never) => match never {},
            };
        if let Some(ip) = peer_ip {
            if crate::auth::rate_limit::ist_gesperrt(ip) {
                return Err(AppError::TooManyRequests(
                    "Zu viele ungültige Abrufe. Bitte kurz warten.".to_string(),
                ));
            }
        }
        let schluessel = schluessel_aus(parts);
        if let Some(s) = schluessel {
            if let Some(z) = gueltige_freigabe(&state.pool, s).await? {
                return Ok(z);
            }
        }
        // Ein bekannter, aber nicht mehr wirksamer Schlüssel (abgelaufen, widerrufen, Einsatz
        // abgeschlossen) ist kein Rateversuch: offene Seiten hinter einer gemeinsamen Adresse
        // sperrten sonst beim Einsatzende die Adresse für alle gültigen Links und Anmeldungen.
        let bekannt = match schluessel {
            Some(s) => schluessel_bekannt(&state.pool, s).await?,
            None => false,
        };
        if let (Some(ip), false) = (peer_ip, bekannt) {
            crate::auth::rate_limit::fehlversuch(ip, None);
        }
        Err(AppError::Unauthorized)
    }
}

/// Schranke des Karten-Proxys (LFH-1072): eine Sitzung oder eine wirksame Lagebild-Freigabe
/// (design.md D3). So lädt die Karte der Seite `/extern` die Online-Kacheln, ohne das
/// Anbieter-Kontingent für jeden zu öffnen. Ein falscher Schlüssel zählt hier nicht als
/// Fehlversuch: eine Karte fragt viele Kacheln auf einmal.
pub struct KartenZugriff;

impl FromRequestParts<AppState> for KartenZugriff {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if let Some(s) = schluessel_aus(parts) {
            return match gueltige_freigabe(&state.pool, s).await? {
                Some(_) => Ok(KartenZugriff),
                None => Err(AppError::Unauthorized),
            };
        }
        crate::auth::session::CurrentUser::from_request_parts(parts, state).await?;
        Ok(KartenZugriff)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schluessel_tragen_das_praefix_und_sind_verschieden() {
        let a = neuer_schluessel();
        let b = neuer_schluessel();
        assert!(a.starts_with(SCHLUESSEL_PRAEFIX));
        assert_eq!(a.len(), SCHLUESSEL_PRAEFIX.len() + 43);
        assert_ne!(a, b);
        assert_eq!(hash(&a).len(), 64);
    }

    #[test]
    fn oeffnung_nimmt_nur_saubere_kennungen() {
        assert_eq!(oeffnung_aus(Some("3f2a-77")), "3f2a-77");
        assert_eq!(oeffnung_aus(Some(" 3f2a ")), "3f2a");
        assert_eq!(oeffnung_aus(Some("a b")), "ohne-kennung");
        assert_eq!(oeffnung_aus(Some(&"x".repeat(65))), "ohne-kennung");
        assert_eq!(oeffnung_aus(None), "ohne-kennung");
    }

    #[test]
    fn dauer_einsatzende_hat_kein_ende() {
        assert_eq!(LagebildDauer::Einsatzende.modifikator(), None);
        assert_eq!(
            LagebildDauer::parse("24h"),
            Some(LagebildDauer::VierundzwanzigStunden)
        );
    }
}
