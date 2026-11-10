//! Extractor für signierte Anfragen gekoppelter Instanzen (design.md D3, Muster ADR-0005):
//! Signatur, Ziel, Methode, Pfad, Body-Hash, Zeitfenster, Wiederholschutz und Protokollfenster
//! sind geprüft, bevor ein Handler läuft. Jede Ablehnung ist 401 ohne Grund nach außen; der Grund
//! steht im Log.

use super::identitaet::{self, parse_oeffentlich, Identitaet};
use super::repo::{self, KopplungZeile};
use super::signatur::{self, Anfrage, SCHEMA, TYP_ANFRAGE, UHR_TOLERANZ_S};
use super::{protokollfenster, Protokollfenster, PROTOKOLL};
use crate::app::AppState;
use crate::error::AppError;
use axum::body::Bytes;
use axum::extract::{FromRequest, Request};
use axum::http::header::AUTHORIZATION;
use chrono::{TimeZone, Utc};

/// Größter Body einer Anfrage zwischen Instanzen. Melden trägt wenige hundert Byte; der Rahmen
/// lässt Platz für spätere Nutzdaten ohne Protokollbruch (LLH-1492 bringt eigene Grenzen).
pub const BODY_MAX: usize = 64 * 1024;

/// Pfad, der auch bei zu großem Abstand der Protokollversionen geht (design.md D5).
pub const MELDEN_PFAD: &str = "/api/instanz/melden";

/// Pfad des Abgleichs der Einsätze (LLH-1492, design.md D6); er trägt größere Pakete.
pub const SPIEGEL_PFAD: &str = "/api/instanz/spiegel";

/// Körpergrenze je Pfad: der Abgleich trägt Lieferungen, alles andere bleibt bei [`BODY_MAX`].
pub fn body_max(pfad: &str) -> usize {
    if pfad == SPIEGEL_PFAD {
        super::spiegel::paket::SPIEGEL_MAX
    } else {
        BODY_MAX
    }
}

/// Eine geprüfte Anfrage einer gekoppelten Instanz.
#[derive(Debug)]
pub struct GekoppelteInstanz {
    pub kopplung: KopplungZeile,
    pub claims: Anfrage,
    pub body: Bytes,
    /// Die eigene Identität, mit der die Antwort signiert wird.
    pub identitaet: Identitaet,
}

fn reject(grund: &str, kennung: Option<&str>) -> AppError {
    tracing::warn!(kennung = ?kennung, grund, "Anfrage einer Instanz abgelehnt");
    AppError::Unauthorized
}

impl FromRequest<AppState> for GekoppelteInstanz {
    type Rejection = AppError;

    async fn from_request(req: Request, state: &AppState) -> Result<Self, Self::Rejection> {
        let (parts, body) = req.into_parts();
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix(SCHEMA))
            .and_then(|v| v.strip_prefix(' '))
            .ok_or_else(|| reject("ohne Token", None))?
            .to_string();
        let kopf =
            signatur::parse_kopf(&token, TYP_ANFRAGE).map_err(|e| reject(&e.to_string(), None))?;
        let kopplung = {
            let mut conn = state.pool.acquire().await?;
            repo::find_kopplung(&mut conn, &kopf.kid).await?
        }
        .ok_or_else(|| reject("unbekannte Instanz", Some(&kopf.kid)))?;
        if kopplung.zustand() == Some(super::InstanzKopplungZustand::VomGegenueberWiderrufen) {
            return Err(reject("Kopplung vom Gegenüber widerrufen", Some(&kopf.kid)));
        }
        let schluessel = parse_oeffentlich(&kopplung.gegenueber_schluessel)
            .ok_or_else(|| reject("gespeicherter Schlüssel unlesbar", Some(&kopf.kid)))?;
        let body = axum::body::to_bytes(body, body_max(parts.uri.path()))
            .await
            .map_err(|_| AppError::PayloadTooLarge("Anfrage ist zu groß.".into()))?;
        let identitaet = identitaet::load_or_create(&state.pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // Der Absender signiert den API-Pfad ohne den Pfad seiner Basisadresse; ein Proxy vor
        // dieser Instanz darf ein Präfix abschneiden, die Prüfung sieht denselben Pfad.
        let pfad = parts
            .uri
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or_else(|| parts.uri.path());
        let jetzt = Utc::now().timestamp();
        let claims = signatur::verify_anfrage(
            &token,
            &schluessel,
            &kopplung.gegenueber_kennung,
            &identitaet.kennung,
            parts.method.as_str(),
            pfad,
            &body,
            jetzt,
        )
        .map_err(|e| reject(&e.to_string(), Some(&kopf.kid)))?;
        let bis = Utc
            .timestamp_opt(claims.exp + UHR_TOLERANZ_S, 0)
            .single()
            .map(crate::zeit::formatiere_utc)
            .ok_or_else(|| reject("Ablauf unlesbar", Some(&kopf.kid)))?;
        if !repo::remember_jti(&state.pool, &kopplung.gegenueber_kennung, &claims.jti, &bis).await?
        {
            return Err(reject("Wiederholung", Some(&kopf.kid)));
        }
        check_protokoll(parts.uri.path(), claims.pv)?;
        // Außer Melden (das Widerrufe überbringt) nur bei aktiver Kopplung.
        if parts.uri.path() != MELDEN_PFAD
            && kopplung.zustand() != Some(super::InstanzKopplungZustand::Aktiv)
        {
            return Err(reject("Kopplung nicht aktiv", Some(&kopf.kid)));
        }
        Ok(GekoppelteInstanz {
            kopplung,
            claims,
            body,
            identitaet,
        })
    }
}

/// Protokollfenster (design.md D5): Melden geht immer, alles andere nur bei höchstens einem Stand
/// Abstand (sonst 426).
pub fn check_protokoll(pfad: &str, pv: u32) -> Result<(), AppError> {
    if pfad != MELDEN_PFAD && protokollfenster(PROTOKOLL, pv) != Protokollfenster::Voll {
        return Err(AppError::UpgradeRequired(format!(
            "Protokoll {pv} wird hier nicht mehr verstanden (hier {PROTOKOLL}); nur Melden geht."
        )));
    }
    Ok(())
}

impl GekoppelteInstanz {
    /// Liest den Body als JSON; kaputt → 400 im `{error}`-Format.
    pub fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, AppError> {
        serde_json::from_slice(&self.body)
            .map_err(|e| AppError::Validation(format!("Body unlesbar: {e}")))
    }

    /// Eine signierte JSON-Antwort an den Absender (design.md D3).
    pub fn antwort<T: serde::Serialize>(
        &self,
        status: axum::http::StatusCode,
        wert: &T,
    ) -> axum::response::Response {
        signed_antwort(
            &self.identitaet,
            &self.kopplung.gegenueber_kennung,
            &self.claims.jti,
            status,
            wert,
        )
    }
}

/// Eine JSON-Antwort mit Signatur im Kopf [`signatur::ANTWORT_KOPF`].
pub fn signed_antwort<T: serde::Serialize>(
    identitaet: &Identitaet,
    ziel_kennung: &str,
    bezug: &str,
    status: axum::http::StatusCode,
    wert: &T,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let body = serde_json::to_vec(wert).expect("Antwort ist serialisierbar");
    let token = signatur::sign_antwort(
        identitaet,
        ziel_kennung,
        bezug,
        status.as_u16(),
        &body,
        Utc::now().timestamp(),
    );
    (
        status,
        [
            (
                axum::http::header::CONTENT_TYPE,
                "application/json".to_string(),
            ),
            (
                axum::http::HeaderName::from_static(signatur::ANTWORT_KOPF),
                token,
            ),
        ],
        body,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn melden_geht_immer_anderes_nur_im_fenster() {
        assert!(check_protokoll(MELDEN_PFAD, PROTOKOLL + 5).is_ok());
        assert!(check_protokoll("/api/instanz/etwas", PROTOKOLL + 1).is_ok());
        let fehler = check_protokoll("/api/instanz/etwas", PROTOKOLL + 2).unwrap_err();
        assert_eq!(fehler.status(), axum::http::StatusCode::UPGRADE_REQUIRED);
    }
}
