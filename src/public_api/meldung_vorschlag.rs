//! `POST /api/v1/report-suggestions` (LLH-2112, Design-Doc
//! `docs/superpowers/specs/2026-11-28-jd4jgna4-maschinen-eingang-meldungen-design.md`): ein
//! Maschinenzugang mit `meldungen:write` reicht einen kurzen Text als unbestätigten Vorschlag für
//! den Einsatz ein, den die Einsatzleitung für ihn freigegeben hat (ADR-0112). Daraus wird erst
//! eine Meldung, wenn ein Mensch den Vorschlag übernimmt.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::machine::MachineClient;
use super::{ApiError, ErrorCode};
use crate::app::AppState;
use crate::meldung::vorschlag::{self, Herkunft, NeuerVorschlag};

const EXTERNAL_ID_MAX: usize = 128;
const ADAPTER_MAX: usize = 32;
const SENDER_ID_MAX: usize = 64;

/// Herkunft des Vorschlags beim Fremdsystem.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReportSuggestionSource {
    /// Kennung des Adapters oder Kanals: Kleinbuchstaben, Ziffern, `-` und `_`, 1 bis 32 Zeichen.
    #[schema(example = "funk-gateway")]
    pub adapter: Option<String>,
    /// Kennung des Absenders im Fremdsystem, 1 bis 64 Zeichen.
    pub sender_id: Option<String>,
    /// Anzeigename des Absenders, höchstens 500 Zeichen.
    pub sender_name: Option<String>,
    /// Ob das Fremdsystem den Absender selbst geprüft hat (Pflicht).
    pub signed: Option<bool>,
}

/// Ein Vorschlag für den Meldungseingang.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReportSuggestionRequest {
    /// Der Text, nicht leer, höchstens 20 000 Zeichen.
    pub text: Option<String>,
    /// Kennung des Vorschlags im Fremdsystem (Pflicht, höchstens 128 Zeichen). Dieselbe Kennung
    /// am selben Zugang ergibt denselben Vorschlag (Wiederholung).
    pub external_id: Option<String>,
    /// Zeitpunkt der Absendung beim Fremdsystem: ISO 8601 mit Zone (etwa
    /// `2026-11-28T09:41:12Z`) oder UTC als `JJJJ-MM-TT hh:mm:ss`, Jahr 2000 bis 2100. Gespeichert
    /// wird er als UTC `JJJJ-MM-TT hh:mm:ss`.
    #[schema(example = "2026-11-28T09:41:12Z")]
    pub sent_at: Option<String>,
    pub source: Option<ReportSuggestionSource>,
}

/// Der abgelegte Vorschlag.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReportSuggestionResponse {
    pub id: i64,
    /// `offen`, `angenommen`, `verworfen` oder `abgelaufen`.
    pub status: String,
    /// Zeitpunkt des Empfangs (UTC).
    pub received_at: String,
}

fn unprocessable(text: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::Unprocessable, text)
}

/// Geprüfte Eingabe.
struct Geprueft {
    text: String,
    external_id: String,
    gesendet_at: Option<String>,
    herkunft: Herkunft,
}

fn is_adapter(s: &str) -> bool {
    (1..=ADAPTER_MAX).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// `sent_at` normalisiert (ISO 8601 mit Zone wie `2026-11-28T09:41:12Z` oder UTC
/// `JJJJ-MM-TT hh:mm:ss`), nur mit einem Jahr aus `zeit::JAHRE`: Knoten ohne Uhr senden oft
/// Epoch 0, das Formular belegte sonst die Ereigniszeit mit 1970 vor (Review M2).
fn pruefe_sent_at(roh: &str) -> Result<String, ApiError> {
    let ungueltig = || {
        unprocessable(format!(
            "sent_at muss ein Zeitpunkt nach ISO 8601 (etwa 2026-11-28T09:41:12Z) zwischen den \
             Jahren {} und {} sein",
            crate::zeit::JAHRE.start(),
            crate::zeit::JAHRE.end()
        ))
    };
    let normal = crate::etb::normalisiere_zeit(roh.trim()).map_err(|_| ungueltig())?;
    crate::zeit::im_jahresbereich(normal, "sent_at").map_err(|_| ungueltig())
}

fn pruefen(body: &[u8]) -> Result<Geprueft, ApiError> {
    let roh: ReportSuggestionRequest = serde_json::from_slice(body).map_err(|e| {
        if e.is_data() {
            unprocessable(format!(
                "Anfrage-Body passt nicht zum erwarteten Format: {e}"
            ))
        } else {
            ApiError::new(
                ErrorCode::InvalidField,
                "Anfrage-Body ist kein gültiges JSON.",
            )
        }
    })?;
    let text = roh.text.as_deref().map(str::trim).unwrap_or_default();
    if text.is_empty() {
        return Err(unprocessable("text darf nicht leer sein"));
    }
    if text.chars().count() > crate::etb::INHALT_MAX {
        return Err(unprocessable(format!(
            "text darf höchstens {} Zeichen haben",
            crate::etb::INHALT_MAX
        )));
    }
    let external_id = roh.external_id.unwrap_or_default();
    if external_id.is_empty() || external_id.chars().count() > EXTERNAL_ID_MAX {
        return Err(unprocessable(format!(
            "external_id ist Pflicht und hat höchstens {EXTERNAL_ID_MAX} Zeichen"
        )));
    }
    let source = roh
        .source
        .ok_or_else(|| unprocessable("source ist Pflicht"))?;
    let adapter = source.adapter.unwrap_or_default();
    if !is_adapter(&adapter) {
        return Err(unprocessable(format!(
            "source.adapter muss aus Kleinbuchstaben, Ziffern, - und _ bestehen (1 bis {ADAPTER_MAX} Zeichen)"
        )));
    }
    let kennung = source.sender_id.unwrap_or_default();
    if kennung.is_empty() || kennung.chars().count() > SENDER_ID_MAX {
        return Err(unprocessable(format!(
            "source.sender_id ist Pflicht und hat höchstens {SENDER_ID_MAX} Zeichen"
        )));
    }
    let name = source
        .sender_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty());
    if name
        .as_deref()
        .is_some_and(|n| n.chars().count() > crate::etb::PARTEI_MAX)
    {
        return Err(unprocessable(format!(
            "source.sender_name darf höchstens {} Zeichen haben",
            crate::etb::PARTEI_MAX
        )));
    }
    let Some(signiert) = source.signed else {
        return Err(unprocessable("source.signed ist Pflicht"));
    };
    let gesendet_at = roh.sent_at.as_deref().map(pruefe_sent_at).transpose()?;
    Ok(Geprueft {
        text: text.to_string(),
        external_id,
        gesendet_at,
        herkunft: Herkunft {
            adapter,
            kennung,
            name,
            signiert,
        },
    })
}

/// Einen Vorschlag für den Meldungseingang des freigegebenen Einsatzes einreichen.
///
/// Der Vorschlag ist unbestätigt: weder Meldung noch ETB-Eintrag, kein Alarm. Die Einsatzleitung
/// übernimmt ihn oder verwirft ihn; offen bleibt er höchstens 12 Stunden. Eine Wiederholung mit
/// derselben `external_id` am selben Zugang antwortet 200 mit demselben Vorschlag.
#[utoipa::path(
    post,
    path = "/api/v1/report-suggestions",
    tag = "Meldungen",
    operation_id = "create_report_suggestion",
    security(("machine" = [])),
    request_body = ReportSuggestionRequest,
    responses(
        (status = 201, description = "Der Vorschlag ist neu abgelegt; Antwort signiert im Kopf `Lifeline-Signature`", body = ReportSuggestionResponse),
        (status = 200, description = "Diese `external_id` kam an diesem Zugang schon an; es kommt der bestehende Vorschlag mit seinem jetzigen Status", body = ReportSuggestionResponse),
        (status = 400, description = "Der Body ist kein gültiges JSON", body = super::ApiErrorBody),
        (status = 401, description = "Anmeldung fehlgeschlagen (Grund nur am Zugang)", body = super::ApiErrorBody),
        (status = 403, description = "Dem Zugang fehlt das Recht `meldungen:write`", body = super::ApiErrorBody),
        (status = 409, description = "`incident_not_released`: für den Zugang ist kein Einsatz freigegeben, oder das Modul Meldungen ist im freigegebenen Einsatz ausgeblendet (die Brücke puffert und versucht es später); `fuehrung_elsewhere`: eine andere Instanz führt den freigegebenen Einsatz", body = super::ApiErrorBody),
        (status = 413, description = "Der Body ist größer als 64 KiB", body = super::ApiErrorBody),
        (status = 422, description = "Ein Feld fehlt oder ist ungültig: leerer oder zu langer `text`, fehlende `external_id`, `source.adapter` außerhalb von `[a-z0-9_-]{1,32}`, fehlende `source.sender_id` oder `source.signed`, `sent_at` nicht lesbar oder außerhalb der Jahre 2000 bis 2100", body = super::ApiErrorBody),
        (status = 429, description = "Gedrosselt; `Retry-After` nennt die Wartezeit", body = super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn einreichen(
    State(state): State<AppState>,
    client: MachineClient,
) -> Result<Response, ApiError> {
    let geprueft = pruefen(&client.body)?;
    let jetzt = crate::zeit::jetzt();
    let zugang_id = client.zugang.id.clone();
    let org_id = client.zugang.org_id;
    let (v, neu) = crate::write_retry!(&state.pool, |conn| {
        let Some(einsatz_id) =
            super::freigabe::freigegebener_einsatz_tx(&mut *conn, &zugang_id).await?
        else {
            return Ok(Err(ApiError::new(
                ErrorCode::IncidentNotReleased,
                "Für diesen Zugang ist kein Einsatz freigegeben.",
            )));
        };
        let gespiegelt: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = ?)",
        )
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
        if gespiegelt {
            return Ok(Err(ApiError::from_code(ErrorCode::FuehrungElsewhere)));
        }
        let einsatz_org: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
        // Gegenprobe wie `freigabe::is_lesbar` (Review M5): eine Freigabe auf einen fremden
        // Einsatz legt den Vorschlag nicht in der fremden Org ab.
        if einsatz_org != org_id {
            tracing::error!(
                zugang_id,
                einsatz_id,
                "Freigabe zeigt auf einen Einsatz einer anderen Organisation"
            );
            return Ok(Err(ApiError::from_code(ErrorCode::IncidentNotReleased)));
        }
        // Ist „Meldungen“ ausgeblendet, sähe niemand den Vorschlag, bis er abläuft (Review I2):
        // ablehnen, damit die Brücke puffert.
        if crate::einsatz::berechtigung::is_modul_ausgeblendet_tx(
            &mut *conn,
            einsatz_id,
            einsatz_org,
            "meldungen",
        )
        .await?
        {
            return Ok(Err(ApiError::new(
                ErrorCode::IncidentNotReleased,
                "Das Modul Meldungen ist im freigegebenen Einsatz nicht sichtbar.",
            )));
        }
        let eingabe = NeuerVorschlag {
            einsatz_id,
            zugang_id: &zugang_id,
            external_id: &geprueft.external_id,
            text: &geprueft.text,
            herkunft: &geprueft.herkunft,
            gesendet_at: geprueft.gesendet_at.as_deref(),
            empfangen_at: &jetzt,
        };
        let ergebnis = vorschlag::einreichen_tx(&mut *conn, &eingabe, &jetzt).await?;
        Ok(Ok(ergebnis))
    })??;
    if neu {
        // Nach dem Commit; ein Fehler beim Verteilen wirkt nicht auf die Antwort.
        state
            .live
            .publiziere_einsatz(v.einsatz_id, crate::live::LiveEvent::Meldung);
    }
    let antwort = ReportSuggestionResponse {
        id: v.id,
        status: v.status.as_str().to_string(),
        received_at: v.empfangen_at,
    };
    let status = if neu {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok(client.antwort(status, &antwort))
}
