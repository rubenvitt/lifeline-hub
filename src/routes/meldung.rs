use crate::app::AppState;
use crate::einsatz::kontext::{
    EinsatzKontext, EinsatzLesezugriff, EinsatzSchreibfreigabe, EinsatzSchreibzugriff,
};
use crate::einsatz::modul::{Lagemeldungen, Meldungen};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::meldung::{
    repo, MeldungAnzeige, ART_SOFORTMELDUNG, ART_SONSTIGE, BESTAETIGUNG_FRIST_DEFAULT_MIN,
    PRIO_NORMAL, PRIO_SOFORT, RICHTUNG_INTERN,
};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::{Duration, NaiveDateTime};
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Meldungen des Einsatzes haben sich geändert (Tag `meldung`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Meldung,
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

/// SSE-Notify: unübersehbares Sofort-Highlight (Tag `sofortmeldung`, LFH-97). Läuft über
/// dieselbe eine EventSource pro Einsatz; der Client löst Alarm (visuell + Ton) aus.
fn sse_sofort(state: &AppState, einsatz_id: i64, meldung_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Sofortmeldung,
        serde_json::json!({ "einsatz_id": einsatz_id, "meldung_id": meldung_id }).to_string(),
    );
}

fn trimme(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// Leitet die Bestätigungs-Frist in Minuten ab.
/// Fallback-Kette: Request-Override ?? effektive_meldung_frist_min(Einsatz ?? Org) ?? Konstante.
fn meldung_bestaetigung_frist_min_ableiten(
    e: &crate::einsatz::einstellungen::EinsatzEinstellungen,
    o: &crate::org::einstellungen::OrgEinstellungen,
    req_override: Option<i64>,
    konstante: i64,
) -> i64 {
    req_override
        .or_else(|| crate::einsatz::effektiv::effektive_meldung_frist_min(e, o))
        .unwrap_or(konstante)
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub richtung: Option<String>,
}

/// GET /api/einsaetze/{id}/meldungen — Posteingang listen (Lesezugriff, auch Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Meldungen>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<MeldungAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let status = params
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(s) = status {
        if !crate::meldung::status_gueltig(s) {
            return Err(AppError::Validation("Ungültiger Status-Filter".into()));
        }
    }
    let richtung = params
        .richtung
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(r) = richtung {
        if !crate::meldung::richtung_gueltig(r) {
            return Err(AppError::Validation("Ungültiger Richtungs-Filter".into()));
        }
    }
    Ok(Json(
        repo::liste(&state.pool, einsatz_id, status, richtung, &jetzt()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct NeueMeldung {
    pub absender: String,
    pub empfaenger: Option<String>,
    pub meldeweg: String,
    pub inhalt: String,
    pub meldungsart: Option<String>,
    pub prioritaet: Option<String>,
    /// Richtung intern/extern (LFH-87); Default 'intern'.
    pub richtung: Option<String>,
    /// Ereigniszeit (UTC, ISO-8601 oder SQLite-Format). Pflicht (Funk-Realität: ≠ Erfassung).
    pub ereigniszeit: String,
    /// Sofortmeldung & Eskalation (LFH-97): Bestätigungspflicht erzwingen. `None` → aus
    /// Sofort-Klassifikation abgeleitet (Sofortmeldung/Priorität sofort impliziert Pflicht).
    pub bestaetigung_pflicht: Option<bool>,
    /// Optionales Override der Default-Bestätigungsfrist (Minuten ab Eingang).
    pub bestaetigung_frist_min: Option<i64>,
    /// Stabiler, client-generierter Idempotenzschlüssel für Offline-Queue und
    /// Timeout-Replay. Fehlend/leer behält das Verhalten älterer Clients.
    pub client_id: Option<String>,
}

/// Stellt die offene Auto-Frist-Erinnerung ausnahmslos aus dem persistierten
/// Meldungsstand sicher. Dadurch repariert auch ein Replay nach verlorener/fehlgeschlagener
/// Reminder-Anlage den abgeleiteten Datensatz, ohne geänderte Request-Felder zu übernehmen.
async fn auto_frist_erinnerung_sicherstellen(
    state: &AppState,
    meldung: &MeldungAnzeige,
) -> Result<(), AppError> {
    if meldung.bestaetigung_pflicht && meldung.bestaetigung_frist_at.is_some() {
        let titel = format!("Sofortmeldung #{} unbestätigt", meldung.lfd_nr);
        crate::erinnerung::repo::stelle_meldung_auto_frist_sicher(&state.pool, meldung.id, &titel)
            .await?;
    }
    Ok(())
}

/// Liefert das Live-Buendel einer persistierten Meldung at-least-once aus. Der DB-Marker wird
/// erst nach ETB-, Meldungs- und ggf. Sofortalarm-Event gesetzt. Ein `client_id`-Replay holt
/// daher einen Crash vor dem Publish nach; bereits markierte Meldungen erzeugen keine Dublette.
async fn live_publikation_sicherstellen(
    state: &AppState,
    meldung: &MeldungAnzeige,
) -> Result<(), AppError> {
    let einsatz_id = meldung.einsatz_id;
    let meldung_id = meldung.id;
    let etb_id = meldung.etb_meldung_id;
    let ist_sofort = meldung.meldungsart.as_str() == ART_SOFORTMELDUNG
        || meldung.prioritaet.as_str() == PRIO_SOFORT;
    let publiziert_at = jetzt();
    repo::publiziere_live_ausstehend(&state.pool, meldung_id, &publiziert_at, || {
        if let Some(etb_id) = etb_id {
            state.live.publiziere(einsatz_id, etb_id);
        }
        sse(state, einsatz_id);
        if ist_sofort {
            sse_sofort(state, einsatz_id, meldung_id);
        }
    })
    .await?;
    Ok(())
}

/// POST /api/einsaetze/{id}/meldungen — Meldung erfassen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Meldungen>,
    headers: HeaderMap,
    JsonBody(req): JsonBody<NeueMeldung>,
) -> Result<(StatusCode, Json<MeldungAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;

    // Bereits committete Offline-Aktion nach Auth-/Schreib-/Modul-Gates, aber vor dem
    // Aktiv-Gate erkennen. Der Lookup bleibt durch die Einsatz-ID mandantenfest.
    let client_id = req
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if client_id.is_some_and(|cid| cid.len() > 64) {
        return Err(AppError::Validation(
            "client_id zu lang (max. 64 Zeichen)".into(),
        ));
    }
    if let Some(cid) = client_id {
        let aktuell = jetzt();
        if let Some(meldung) =
            repo::laden_nach_client_id(&state.pool, einsatz_id, cid, &aktuell).await?
        {
            live_publikation_sicherstellen(&state, &meldung).await?;
            auto_frist_erinnerung_sicherstellen(&state, &meldung).await?;
            return Ok((StatusCode::CREATED, Json(meldung)));
        }
    }
    ctx.fordere_aktiv()?;

    // Mindestfelder: Absender, Inhalt, Meldeweg.
    let absender = req.absender.trim();
    let inhalt = req.inhalt.trim();
    if absender.is_empty() {
        return Err(AppError::Validation("Absender darf nicht leer sein".into()));
    }
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }
    if crate::meldung::MeldeWeg::parse(req.meldeweg.trim()).is_none() {
        return Err(AppError::Validation("Ungültiger Meldeweg".into()));
    }
    let meldungsart = req
        .meldungsart
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(ART_SONSTIGE);
    if !crate::meldung::meldungsart_gueltig(meldungsart) {
        return Err(AppError::Validation("Ungültige Meldungsart".into()));
    }
    let prioritaet = req
        .prioritaet
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(PRIO_NORMAL);
    if !crate::meldung::prioritaet_gueltig(prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    let richtung = req
        .richtung
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(RICHTUNG_INTERN);
    if !crate::meldung::richtung_gueltig(richtung) {
        return Err(AppError::Validation("Ungültige Richtung".into()));
    }
    // Ereigniszeit normalisieren (ISO-8601/SQLite → SQLite-Format), wie ETB.
    let ereigniszeit = crate::etb::normalisiere_zeit(req.ereigniszeit.trim())?;
    let eingang = jetzt();

    // Sofortmeldung & Eskalation (LFH-97): Sofort impliziert Bestätigungspflicht; explizites
    // Flag überstimmt. Frist = Eingang + (Override||Default) Minuten, nur bei Pflicht.
    let ist_sofort = meldungsart == ART_SOFORTMELDUNG || prioritaet == PRIO_SOFORT;
    let pflicht = req.bestaetigung_pflicht.unwrap_or(ist_sofort);
    // Bestätigungsfrist-Default (Task 8/LFH-133): Fallback-Kette:
    // Request-Override ?? effektive_meldung_frist_min(Einsatz ?? Org) ?? Konstante.
    let einst = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id).await?;
    let org_einst =
        crate::org::einstellungen::laden_oder_default(&state.pool, ctx.einsatz.org_id).await?;
    let frist_min = meldung_bestaetigung_frist_min_ableiten(
        &einst,
        &org_einst,
        req.bestaetigung_frist_min,
        BESTAETIGUNG_FRIST_DEFAULT_MIN,
    );
    if pflicht && frist_min <= 0 {
        return Err(AppError::Validation(
            "Bestätigungsfrist muss positiv sein".into(),
        ));
    }
    let frist_at: Option<String> = if pflicht {
        // `eingang` ist im DB-Format; bei (theoretisch unmöglichem) Parse-Fehler defensiv keine
        // Frist statt 500 (vgl. patch-xor: 422/None statt Panik).
        NaiveDateTime::parse_from_str(&eingang, "%Y-%m-%d %H:%M:%S")
            .ok()
            .map(|n| {
                (n + Duration::minutes(frist_min))
                    .format("%Y-%m-%d %H:%M:%S")
                    .to_string()
            })
    } else {
        None
    };

    let (m, _war_neu) = repo::anlegen_idempotent(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        client_id,
        repo::MeldungDaten {
            absender,
            empfaenger: trimme(&req.empfaenger),
            meldeweg: req.meldeweg.trim(),
            inhalt,
            meldungsart,
            prioritaet,
            richtung,
            ereigniszeit: &ereigniszeit,
            eingang_at: &eingang,
            bestaetigung_pflicht: pflicht,
            bestaetigung_frist_at: frist_at.as_deref(),
        },
    )
    .await?;

    // Erst das persistente At-least-once-Live-Buendel, dann den reparierbaren Reminder.
    // Schlaegt die nachgelagerte Reminder-Anlage fehl, hat der Sofortalarm den Client bereits
    // erreicht; der idempotente Queue-Replay stellt nur den Reminder nach, ohne Doppelalarm.
    live_publikation_sicherstellen(&state, &m).await?;
    auto_frist_erinnerung_sicherstellen(&state, &m).await?;
    Ok((StatusCode::CREATED, Json(m)))
}

/// Cross-Einsatz-Schutz für Meldungs-Aktionen: die Meldung muss zu DIESEM Einsatz
/// gehören (fremde → 404). Gibt `org_id` für die `kommunikation_status`-Schreibpfade
/// zurück. Die Gates schreibrecht/modul/aktiv erzwingt jetzt der
/// `EinsatzSchreibzugriff<Meldungen>`-Typ in der Handler-Signatur.
async fn gehoert_pruefen(
    state: &AppState,
    ctx: &EinsatzKontext,
    meldung_id: i64,
) -> Result<i64, AppError> {
    if !repo::gehoert_zu_einsatz(&state.pool, meldung_id, ctx.einsatz.id).await? {
        return Err(AppError::NotFound);
    }
    Ok(ctx.einsatz.org_id)
}

#[derive(Debug, Deserialize)]
pub struct StatusReq {
    pub status: String,
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/status — NUR den Triage-Status setzen.
/// Die Bearbeiter-Zuweisung läuft über `zuweisen` (getrennte Achse).
pub async fn status(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Meldungen>,
    PfadParam((einsatz_id, meldung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<StatusReq>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    gehoert_pruefen(&state, &ctx, meldung_id).await?;
    let status = req.status.trim();
    if !crate::meldung::status_gueltig(status) {
        return Err(AppError::Validation("Ungültiger Status".into()));
    }
    let jetzt = jetzt();
    repo::setze_status(&state.pool, meldung_id, status, &jetzt).await?;
    let m = repo::laden(&state.pool, meldung_id, &jetzt).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/bestaetigen — Sofortmeldung aktiv bestätigen
/// (LFH-97). Setzt die Quittungs-Achse (Zeitstempel + Person) und schließt die Nachfass-
/// Erinnerung; der Triage-Status bleibt unberührt. Doppel-Bestätigung → 422.
pub async fn bestaetigen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Meldungen>,
    PfadParam((einsatz_id, meldung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    let org_id = gehoert_pruefen(&state, &ctx, meldung_id).await?;
    let now = jetzt();
    // Atomar einmalig (kein read-then-write/TOCTOU): nur die Erst-Bestätigung gewinnt.
    if !repo::bestaetige(
        &state.pool,
        org_id,
        einsatz_id,
        meldung_id,
        ctx.benutzer.id,
        &now,
    )
    .await?
    {
        return Err(AppError::UnprocessableEntity(
            "Meldung ist bereits bestätigt".into(),
        ));
    }
    let m = repo::laden(&state.pool, meldung_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}

#[derive(Debug, Deserialize)]
pub struct ZuweisenReq {
    /// `Some(id)` weist zu, `null`/None gibt frei.
    pub bearbeiter_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/zuweisen — Bearbeiter zuweisen/freigeben (LFH-94).
pub async fn zuweisen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Meldungen>,
    PfadParam((einsatz_id, meldung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<ZuweisenReq>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    gehoert_pruefen(&state, &ctx, meldung_id).await?;
    // Bearbeiter (falls gesetzt) muss Einsatz-Mitglied sein (Cross-Einsatz-Schutz).
    if let Some(bid) = req.bearbeiter_id {
        if einsatz_repo::rolle_von(&state.pool, einsatz_id, bid)
            .await?
            .is_none()
        {
            return Err(AppError::Validation(
                "Bearbeiter ist kein Einsatz-Mitglied".into(),
            ));
        }
    }
    repo::weise_bearbeiter(&state.pool, meldung_id, req.bearbeiter_id).await?;
    let m = repo::laden(&state.pool, meldung_id, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}

#[derive(Debug, Deserialize)]
pub struct LagerelevantReq {
    pub text: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/lagerelevant — an die Lage übergeben (LFH-95).
pub async fn lagerelevant(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Meldungen>,
    PfadParam((einsatz_id, meldung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<LagerelevantReq>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    gehoert_pruefen(&state, &ctx, meldung_id).await?;
    // Default-Text = Meldungsinhalt, falls kein eigener Lage-Text gegeben.
    let aktuell = repo::laden(&state.pool, meldung_id, &jetzt()).await?;
    let text = req
        .text
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or(aktuell.inhalt);
    let geo = match (req.lat, req.lon) {
        (Some(a), Some(o)) => Some((a, o)),
        (None, None) => None,
        _ => return Err(AppError::Validation("lat und lon nur gemeinsam".into())),
    };
    repo::als_lagerelevant(
        &state.pool,
        einsatz_id,
        meldung_id,
        ctx.benutzer.id,
        &text,
        geo,
    )
    .await?;
    let m = repo::laden(&state.pool, meldung_id, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/auftrag — aus einer eingegangenen Meldung direkt
/// einen Auftrag/Befehl erteilen (Meldung→Auftrag, LFH-113). Erzeugt einen formalen Auftrag
/// (inkl. ETB-Anordnung, Pattern B) und setzt den Rückbezug `meldung.auftrag_id` first-write-wins.
/// Auftragsfelder durchlaufen dieselbe Validierung wie POST /auftraege (geteilt, kein zweiter Pfad).
/// Schreibrecht + aktiv über `EinsatzSchreibzugriff<Meldungen>`, Cross-Einsatz-Schutz über
/// `gehoert_pruefen` (wie die anderen Mutationen).
pub async fn auftrag_erteilen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Meldungen>,
    PfadParam((einsatz_id, meldung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<crate::auftrag::NeuerAuftrag>,
) -> Result<(StatusCode, Json<MeldungAnzeige>), AppError> {
    gehoert_pruefen(&state, &ctx, meldung_id).await?;

    // Gleiche Validierung wie POST /auftraege (geteilt) → kein zweiter, ungeprüfter Pfad.
    let now = jetzt();
    let validiert =
        crate::auftrag::validiere_neuen_auftrag(&state.pool, einsatz_id, &req, &now, None).await?;
    let auftrag_id = repo::erteile_auftrag_tx(
        &state.pool,
        einsatz_id,
        meldung_id,
        ctx.benutzer.id,
        validiert.daten(),
    )
    .await?;

    // ETB-Anordnung entstand im selben Commit → ETB-Live-Event + Auftrag-Board + meldung-Tag (SSE-Parität).
    if let Ok(detail) = crate::auftrag::repo::laden(&state.pool, auftrag_id, &now).await {
        if let Some(etb_id) = detail.auftrag.etb_anordnung_id {
            state.live.publiziere(einsatz_id, etb_id);
        }
    }
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Auftrag,
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
    sse(&state, einsatz_id);

    let m = repo::laden(&state.pool, meldung_id, &now).await?;
    Ok((StatusCode::CREATED, Json(m)))
}

/// GET /api/einsaetze/{id}/lage/meldungen — Lageobjekte aus Meldungen (Lese-Oberfläche, LFH-95).
pub async fn lage_liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagemeldungen>,
) -> Result<Json<Vec<crate::meldung::LageMeldungAnzeige>>, AppError> {
    Ok(Json(
        repo::liste_lage_meldungen(&state.pool, ctx.einsatz.id).await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::einstellungen::EinsatzEinstellungen;
    use crate::meldung::BESTAETIGUNG_FRIST_DEFAULT_MIN;
    use crate::org::einstellungen::OrgEinstellungen;

    fn e() -> EinsatzEinstellungen {
        EinsatzEinstellungen::leer(1)
    }
    fn o() -> OrgEinstellungen {
        OrgEinstellungen::leer(1)
    }

    /// Kein Request-Override, Einsatz-Frist NULL, Org-Frist=30 → 30 (Org-Default greift).
    #[test]
    fn frist_aus_org_wenn_einsatz_null() {
        let o = OrgEinstellungen {
            meldung_bestaetigung_frist_min: Some(30),
            ..o()
        };
        assert_eq!(
            meldung_bestaetigung_frist_min_ableiten(&e(), &o, None, BESTAETIGUNG_FRIST_DEFAULT_MIN),
            30
        );
    }

    /// Kein Override, beide NULL → Konstante.
    #[test]
    fn frist_aus_konstante_wenn_org_null() {
        assert_eq!(
            meldung_bestaetigung_frist_min_ableiten(
                &e(),
                &o(),
                None,
                BESTAETIGUNG_FRIST_DEFAULT_MIN
            ),
            BESTAETIGUNG_FRIST_DEFAULT_MIN
        );
    }

    /// Request-Override schlägt Org-Frist.
    #[test]
    fn request_override_schlaegt_org_und_konstante() {
        let o = OrgEinstellungen {
            meldung_bestaetigung_frist_min: Some(30),
            ..o()
        };
        assert_eq!(
            meldung_bestaetigung_frist_min_ableiten(
                &e(),
                &o,
                Some(5),
                BESTAETIGUNG_FRIST_DEFAULT_MIN
            ),
            5
        );
    }

    /// Einsatz-Override schlägt Org-Frist.
    #[test]
    fn einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen {
            meldung_bestaetigung_frist_min: Some(10),
            ..e()
        };
        let o = OrgEinstellungen {
            meldung_bestaetigung_frist_min: Some(30),
            ..o()
        };
        assert_eq!(
            meldung_bestaetigung_frist_min_ableiten(&e, &o, None, BESTAETIGUNG_FRIST_DEFAULT_MIN),
            10
        );
    }
}
