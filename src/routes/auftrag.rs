use crate::app::AppState;
use crate::auftrag::{repo, validiere_neuen_auftrag, AuftragDetail, NeuerAuftrag};
use crate::einsatz::einstellungen;
use crate::einsatz::kontext::EinsatzKontext;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "auftraege";
use crate::error::AppError;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Aufträge des Einsatzes haben sich geändert (Tag `auftrag`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "auftrag",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub richtung: Option<String>,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/auftraege — Aufträge listen (Lesezugriff, auch Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzKontext,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<AuftragDetail>>, AppError> {
    ctx.fordere_lesezugriff()?;
    ctx.fordere_modul_zugriff(&state.pool, MODUL_KEY).await?;
    let einsatz_id = ctx.einsatz.id;

    if params.abschnitt_id.is_some() && params.einheit_id.is_some() {
        return Err(AppError::Validation(
            "Nur ein Empfänger-Filter erlaubt (Abschnitt ODER Einheit)".into(),
        ));
    }
    let filter = (params.abschnitt_id.is_some() || params.einheit_id.is_some()).then_some(
        repo::EmpfaengerFilter {
            abschnitt_id: params.abschnitt_id,
            einheit_id: params.einheit_id,
        },
    );
    let richtung = params
        .richtung
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(r) = richtung {
        if !crate::auftrag::richtung_gueltig(r) {
            return Err(AppError::Validation("Ungültige Richtung".into()));
        }
    }
    let liste = repo::liste(
        &state.pool,
        einsatz_id,
        params.status.as_deref(),
        richtung,
        filter.as_ref(),
        &jetzt(),
    )
    .await?;
    Ok(Json(liste))
}

/// Leitet die Default-Quittierungs-Frist (Minuten) aus Einsatz- und Org-Einstellungen ab.
/// Fallback-Kette: Einsatz ?? Org ?? None (kein Default → keine automatische Frist).
fn auftrag_default_quittierung_frist_min(
    e: &einstellungen::EinsatzEinstellungen,
    o: &crate::org::einstellungen::OrgEinstellungen,
) -> Option<i64> {
    crate::einsatz::effektiv::effektive_auftrag_quittierung_frist_min(e, o)
}

/// POST /api/einsaetze/{id}/auftraege — Auftrag anlegen + zustellen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzKontext,
    Json(req): Json<NeuerAuftrag>,
) -> Result<(StatusCode, Json<AuftragDetail>), AppError> {
    ctx.fordere_schreibrecht()?;
    ctx.fordere_modul_zugriff(&state.pool, MODUL_KEY).await?;
    ctx.fordere_aktiv()?;
    let einsatz_id = ctx.einsatz.id;

    let now = jetzt();
    // Default-Quittierfrist (Task 8/LFH-133): Fallback-Kette Einsatz ?? Org ?? None.
    // Nur für die direkte Auftragserfassung; greift, wenn der Client keine frist_at mitschickt.
    let einst = einstellungen::laden_oder_default(&state.pool, einsatz_id).await?;
    let org_einst =
        crate::org::einstellungen::laden_oder_default(&state.pool, ctx.einsatz.org_id).await?;
    let default_frist = auftrag_default_quittierung_frist_min(&einst, &org_einst);
    let validiert =
        validiere_neuen_auftrag(&state.pool, einsatz_id, &req, &now, default_frist).await?;
    let d = repo::anlegen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        validiert.daten(),
        &now,
    )
    .await?;

    // Nachfass/Eskalation (LFH-118): bei gesetzter Quittierfrist eine Auto-Frist-Erinnerung
    // anlegen (idempotent, quelle='auto_frist', bezug_typ='auftrag'). Der Scheduler-Tick feuert
    // bei Fristablauf `erinnerung` mit Diskriminator → In-App-Alarm; Quittieren aller Empfänger
    // schließt sie wieder (siehe quittieren). Reuse des Meldungs-Pfads (routes/meldung.rs).
    if let Some(frist) = d.auftrag.frist_at.as_deref() {
        let titel = match d.auftrag.lfd_nr {
            Some(nr) => format!("Auftrag #{nr} Quittierfrist"),
            None => "Auftrag Quittierfrist".to_string(),
        };
        crate::erinnerung::repo::anlegen_aus_frist(
            &state.pool,
            einsatz_id,
            ctx.benutzer.id,
            crate::kommunikation::OBJEKT_AUFTRAG,
            d.auftrag.id,
            &titel,
            frist,
            &now,
        )
        .await?;
    }

    // ETB-Anordnung wurde im selben Commit erzeugt → ETB-Live-Event mitschicken.
    if let Some(etb_id) = d.auftrag.etb_anordnung_id {
        if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb) {
                state.live.publiziere(einsatz_id, json);
            }
        }
    }
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(d)))
}

/// Gemeinsamer Vorlauf für Auftrags-Aktionen: Gates + Cross-Einsatz-Schutz.
/// Gibt `org_id` zurück (für kommunikation_status-Schreibpfade).
async fn fordere_bearbeitbar(
    state: &AppState,
    ctx: &EinsatzKontext,
    auftrag_id: i64,
) -> Result<i64, AppError> {
    ctx.fordere_schreibrecht()?;
    ctx.fordere_modul_zugriff(&state.pool, MODUL_KEY).await?;
    ctx.fordere_aktiv()?;
    if !repo::gehoert_zu_einsatz(&state.pool, auftrag_id, ctx.einsatz.id).await? {
        return Err(AppError::NotFound);
    }
    Ok(ctx.einsatz.org_id)
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/empfaenger/{empf}/quittieren — Quittung (Achse 1).
pub async fn quittieren(
    State(state): State<AppState>,
    ctx: EinsatzKontext,
    Path((einsatz_id, auftrag_id, empfaenger_id)): Path<(i64, i64, i64)>,
) -> Result<Json<AuftragDetail>, AppError> {
    fordere_bearbeitbar(&state, &ctx, auftrag_id).await?;
    if !repo::empfaenger_gehoert_zu_auftrag(&state.pool, empfaenger_id, auftrag_id).await? {
        return Err(AppError::NotFound);
    }
    repo::quittiere_empfaenger(&state.pool, empfaenger_id, ctx.benutzer.id, &jetzt()).await?;
    let d = repo::laden(&state.pool, auftrag_id, &jetzt()).await?;

    // LFH-118: sobald ALLE Empfänger quittiert haben, ist der Auftrag nicht mehr überfällig →
    // die Auto-Frist-Erinnerung schließen (verstummt den Nachfass). Solange ein Empfänger offen
    // ist, bleibt sie offen.
    if d.auftrag.empfaenger_anzahl > 0 && d.auftrag.empfaenger_anzahl == d.auftrag.quittiert_anzahl
    {
        crate::erinnerung::repo::schliesse_offene_auto(
            &state.pool,
            crate::kommunikation::OBJEKT_AUFTRAG,
            auftrag_id,
            &jetzt(),
        )
        .await?;
    }

    sse(&state, einsatz_id);
    Ok(Json(d))
}

#[derive(Debug, Deserialize)]
pub struct VollzugReq {
    /// 'in_arbeit' | 'vollzogen'.
    pub status: String,
    pub vollzugsmeldung: Option<String>,
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/vollzug — Bearbeitungsfortschritt (Achse 2).
pub async fn vollzug(
    State(state): State<AppState>,
    ctx: EinsatzKontext,
    Path((einsatz_id, auftrag_id)): Path<(i64, i64)>,
    Json(req): Json<VollzugReq>,
) -> Result<Json<AuftragDetail>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &ctx, auftrag_id).await?;
    let now = jetzt();
    match req.status.as_str() {
        "in_arbeit" => {
            repo::setze_in_arbeit(
                &state.pool,
                org_id,
                einsatz_id,
                auftrag_id,
                ctx.benutzer.id,
                &now,
            )
            .await?;
        }
        "vollzogen" => {
            let text = req
                .vollzugsmeldung
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    AppError::Validation("Vollzugsmeldung darf nicht leer sein".into())
                })?;
            // Doppel-Vollzug verhindern → sonst zweite ETB-Meldung (append-only).
            if repo::laden(&state.pool, auftrag_id, &now)
                .await?
                .auftrag
                .vollzug_status
                == "vollzogen"
            {
                return Err(AppError::UnprocessableEntity(
                    "Auftrag ist bereits vollzogen".into(),
                ));
            }
            let etb_id = repo::melde_vollzug(
                &state.pool,
                org_id,
                einsatz_id,
                auftrag_id,
                ctx.benutzer.id,
                text,
                &now,
            )
            .await?;
            if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
                if let Ok(json) = serde_json::to_string(&etb) {
                    state.live.publiziere(einsatz_id, json);
                }
            }
        }
        _ => return Err(AppError::Validation("Ungültiger Vollzug-Status".into())),
    }
    let d = repo::laden(&state.pool, auftrag_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/abnehmen — Führung nimmt Vollzug ab.
pub async fn abnehmen(
    State(state): State<AppState>,
    ctx: EinsatzKontext,
    Path((einsatz_id, auftrag_id)): Path<(i64, i64)>,
) -> Result<Json<AuftragDetail>, AppError> {
    fordere_bearbeitbar(&state, &ctx, auftrag_id).await?;
    let now = jetzt();
    let aktuell = repo::laden(&state.pool, auftrag_id, &now).await?;
    if aktuell.auftrag.vollzug_status != "vollzogen" {
        return Err(AppError::UnprocessableEntity(
            "Nur vollzogene Aufträge können abgenommen werden".into(),
        ));
    }
    repo::nimm_ab(&state.pool, auftrag_id, ctx.benutzer.id, &now).await?;
    let d = repo::laden(&state.pool, auftrag_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::org::einstellungen::OrgEinstellungen;

    fn e() -> einstellungen::EinsatzEinstellungen {
        einstellungen::EinsatzEinstellungen::leer(1)
    }
    fn o() -> OrgEinstellungen {
        OrgEinstellungen::leer(1)
    }

    /// Kein Einsatz-Override, Org-Frist=45 → 45 (Org-Default greift).
    #[test]
    fn quittierung_frist_aus_org_wenn_einsatz_null() {
        let o = OrgEinstellungen {
            auftrag_quittierung_frist_min: Some(45),
            ..o()
        };
        assert_eq!(auftrag_default_quittierung_frist_min(&e(), &o), Some(45));
    }

    /// Beide NULL → None (keine automatische Frist).
    #[test]
    fn quittierung_frist_none_wenn_beide_null() {
        assert_eq!(auftrag_default_quittierung_frist_min(&e(), &o()), None);
    }

    /// Einsatz-Override schlägt Org.
    #[test]
    fn quittierung_einsatz_schlaegt_org() {
        let e = einstellungen::EinsatzEinstellungen {
            auftrag_quittierung_frist_min: Some(15),
            ..e()
        };
        let o = OrgEinstellungen {
            auftrag_quittierung_frist_min: Some(45),
            ..o()
        };
        assert_eq!(auftrag_default_quittierung_frist_min(&e, &o), Some(15));
    }
}
