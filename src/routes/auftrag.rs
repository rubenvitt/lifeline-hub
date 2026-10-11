use crate::app::AppState;
use crate::auftrag::{anreichern_alle, repo, validiere_neuen_auftrag, AuftragDetail, NeuerAuftrag};
use crate::einsatz::einstellungen;
use crate::einsatz::kontext::{EinsatzKontext, EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Auftraege;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::kommunikation::VOLLZUG_IN_ARBEIT;
use crate::live::LiveEvent;
use crate::routes::support::pflicht_max;
use crate::zeit::jetzt;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;

use serde::Deserialize;

/// SSE-Notify: Aufträge des Einsatzes haben sich geändert (Tag `auftrag`).
fn sse(state: &AppState, einsatz_id: i64) {
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Auftrag);
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub richtung: Option<String>,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    /// `offen` | `abgeschlossen` (LFH-1071); ohne: alle Aufträge wie bisher.
    pub phase: Option<String>,
    /// Cursor nur mit `phase=abgeschlossen`: Ordnungszeitpunkt und id des letzten Eintrags.
    pub vor_zeit: Option<String>,
    pub vor_id: Option<i64>,
    /// Seitengröße nur mit `phase=abgeschlossen` (Vorgabe 100, geklemmt auf 1…500).
    pub limit: Option<i64>,
}

/// Empfänger- und Richtungsfilter prüfen (Liste und Kennzahlen).
fn filter_pruefen(
    richtung: Option<&str>,
    abschnitt_id: Option<i64>,
    einheit_id: Option<i64>,
) -> Result<(Option<&str>, Option<repo::EmpfaengerFilter>), AppError> {
    if abschnitt_id.is_some() && einheit_id.is_some() {
        // Feldkombination: 422 (`src/AGENTS.md`, Statuscode-Konvention).
        return Err(AppError::UnprocessableEntity(
            "Nur ein Empfänger-Filter erlaubt (Abschnitt ODER Einheit)".into(),
        ));
    }
    let filter =
        (abschnitt_id.is_some() || einheit_id.is_some()).then_some(repo::EmpfaengerFilter {
            abschnitt_id,
            einheit_id,
        });
    let richtung = richtung.map(str::trim).filter(|s| !s.is_empty());
    if let Some(r) = richtung {
        if !crate::auftrag::richtung_gueltig(r) {
            return Err(AppError::Validation("Ungültige Richtung".into()));
        }
    }
    Ok((richtung, filter))
}

/// GET /api/einsaetze/{id}/auftraege — Aufträge listen (Lesezugriff, auch Beobachter).
/// Mit `phase=abgeschlossen` seitenweise (LFH-1071, Spec `auftraege-blaettern`).
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Auftraege>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<AuftragDetail>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let (richtung, filter) = filter_pruefen(
        params.richtung.as_deref(),
        params.abschnitt_id,
        params.einheit_id,
    )?;
    let (phase, seite) = crate::kommunikation::phase_und_seite(
        params.phase.as_deref(),
        params.vor_zeit.as_deref(),
        params.vor_id,
        params.limit,
    )?;
    // Der Cursor vergleicht Zeichenketten: nur das kanonische Format ordnet richtig.
    if let Some(vor) = seite.as_ref().and_then(|s| s.vor.as_ref()) {
        if crate::zeit::parse_streng(&vor.zeit).is_none() {
            return Err(AppError::Validation("Ungültiges vor_zeit".into()));
        }
    }
    // Ein Abschnittsgerät (LFH-1043) sieht nur Aufträge an seinen Bereich; der Filter steht im
    // SQL, damit das Blättern der Abgeschlossenen volle Seiten liefert.
    let bereich = crate::geraet::abschnitt::bereich(&state.pool, ctx.geraet.as_ref())
        .await?
        .map(|b| {
            let (abschnitte_json, einheiten_json) = b.als_json();
            repo::EmpfaengerBereich {
                abschnitte_json,
                einheiten_json,
            }
        });
    let mut liste = repo::liste_gefiltert(
        &state.pool,
        einsatz_id,
        &repo::AuftragFilter {
            status: params.status.as_deref(),
            richtung,
            empfaenger: filter.as_ref(),
            bereich: bereich.as_ref(),
            phase,
            seite,
        },
        &jetzt(),
    )
    .await?;
    anreichern_alle(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        &ctx.benutzer,
        ctx.modul_rolle(),
        &mut liste,
    )
    .await?;
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct KennzahlenParams {
    pub richtung: Option<String>,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/auftraege/kennzahlen — Zahlen des Auftragsboards (LFH-1071, D3).
pub async fn kennzahlen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Auftraege>,
    Query(params): Query<KennzahlenParams>,
) -> Result<Json<crate::auftrag::AuftragKennzahlen>, AppError> {
    let (richtung, filter) = filter_pruefen(
        params.richtung.as_deref(),
        params.abschnitt_id,
        params.einheit_id,
    )?;
    Ok(Json(
        repo::kennzahlen(&state.pool, ctx.einsatz.id, richtung, filter.as_ref()).await?,
    ))
}

/// GET /api/einsaetze/{id}/auftraege/{aid} — ein Auftrag des Einsatzes (LFH-1071, Deeplink auf
/// eine nicht geladene Seite). Einsatzfremd → 404.
pub async fn detail(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Auftraege>,
    PfadParam((_, aid)): PfadParam<(i64, i64)>,
) -> Result<Json<AuftragDetail>, AppError> {
    let mut d = repo::laden_im_einsatz(&state.pool, ctx.einsatz.id, aid, &jetzt()).await?;
    fordere_im_bereich(&state, &ctx, &d.empfaenger).await?;
    anreichern_alle(
        &state.pool,
        ctx.einsatz.id,
        ctx.einsatz.org_id,
        &ctx.benutzer,
        ctx.modul_rolle(),
        std::slice::from_mut(&mut d),
    )
    .await?;
    Ok(Json(d))
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
    ctx: EinsatzSchreibzugriff<Auftraege>,
    JsonBody(req): JsonBody<NeuerAuftrag>,
) -> Result<(StatusCode, Json<AuftragDetail>), AppError> {
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
        state.live.publiziere(einsatz_id, etb_id);
    }
    let mut d = d;
    anreichern_alle(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        &ctx.benutzer,
        ctx.modul_rolle(),
        std::slice::from_mut(&mut d),
    )
    .await?;
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(d)))
}

/// Cross-Einsatz-Schutz für Auftrags-Aktionen: der Auftrag muss zu DIESEM Einsatz
/// gehören (fremde → 404). Gibt `org_id` für die `kommunikation_status`-Schreibpfade
/// zurück. Die Gates schreibrecht/modul/aktiv erzwingt jetzt der
/// `EinsatzSchreibzugriff<Auftraege>`-Typ in der Handler-Signatur.
async fn gehoert_pruefen(
    state: &AppState,
    ctx: &EinsatzKontext,
    auftrag_id: i64,
) -> Result<i64, AppError> {
    if !repo::gehoert_zu_einsatz(&state.pool, auftrag_id, ctx.einsatz.id).await? {
        return Err(AppError::NotFound);
    }
    Ok(ctx.einsatz.org_id)
}

/// Ein Abschnittsgerät (LFH-1043) erreicht nur Aufträge mit mindestens einem Empfänger in
/// seinem Bereich; ein fremder ist für es nicht vorhanden (404). Für Personen wirkungslos.
async fn fordere_im_bereich(
    state: &AppState,
    ctx: &EinsatzKontext,
    empfaenger: &[crate::auftrag::AuftragEmpfaengerAnzeige],
) -> Result<(), AppError> {
    match crate::geraet::abschnitt::bereich(&state.pool, ctx.geraet.as_ref()).await? {
        Some(b)
            if !empfaenger
                .iter()
                .any(|e| b.ist_eigener_empfaenger(e.abschnitt_id, e.einheit_id)) =>
        {
            Err(AppError::NotFound)
        }
        _ => Ok(()),
    }
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/empfaenger/{empf}/quittieren — Quittung (Achse 1).
pub async fn quittieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Auftraege>,
    PfadParam((einsatz_id, auftrag_id, empfaenger_id)): PfadParam<(i64, i64, i64)>,
) -> Result<Json<AuftragDetail>, AppError> {
    gehoert_pruefen(&state, &ctx, auftrag_id).await?;
    if !repo::empfaenger_gehoert_zu_auftrag(&state.pool, empfaenger_id, auftrag_id).await? {
        return Err(AppError::NotFound);
    }
    // Ein Abschnittsgerät quittiert nur Zeilen an seinen Bereich (LFH-1043).
    let zeile: Vec<_> = repo::empfaenger_von(&state.pool, auftrag_id)
        .await?
        .into_iter()
        .filter(|e| e.id == empfaenger_id)
        .collect();
    fordere_im_bereich(&state, &ctx, &zeile).await?;
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

    let mut d = d;
    anreichern_alle(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        &ctx.benutzer,
        ctx.modul_rolle(),
        std::slice::from_mut(&mut d),
    )
    .await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}

#[derive(Debug, Deserialize)]
pub struct VollzugReq {
    /// 'offen' | 'in_arbeit' | 'vollzogen'. `offen` ist die Rücknahme von
    /// „In Bearbeitung" (LFH-343 · C8) und nur von dort aus erlaubt.
    pub status: String,
    pub vollzugsmeldung: Option<String>,
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/vollzug — Bearbeitungsfortschritt (Achse 2).
pub async fn vollzug(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Auftraege>,
    PfadParam((einsatz_id, auftrag_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<VollzugReq>,
) -> Result<Json<AuftragDetail>, AppError> {
    let org_id = gehoert_pruefen(&state, &ctx, auftrag_id).await?;
    fordere_im_bereich(
        &state,
        &ctx,
        &repo::empfaenger_von(&state.pool, auftrag_id).await?,
    )
    .await?;
    let now = jetzt();
    match req.status.as_str() {
        // Rücknahme (LFH-343 · C8): nur aus `in_arbeit`. Aus `vollzogen`/`abgenommen`
        // wäre das die Rücknahme einer Vollzugsmeldung — ein fachlicher Vorgang mit
        // eigenem Weg, kein Undo eines Triage-Klicks. Aus `offen` heraus wäre es ein
        // No-op, der wie Erfolg aussieht. Beides ist ein Zustandsfehler, nicht ein
        // Feldfehler → 422 (src/error.rs).
        "offen" => {
            let aktuell = repo::laden(&state.pool, auftrag_id, &now).await?;
            if aktuell.auftrag.vollzug_status != VOLLZUG_IN_ARBEIT {
                return Err(AppError::UnprocessableEntity(
                    "Zurücknehmen ist nur aus „In Bearbeitung“ möglich".into(),
                ));
            }
            repo::setze_offen(
                &state.pool,
                org_id,
                einsatz_id,
                auftrag_id,
                ctx.benutzer.id,
                &now,
            )
            .await?;
        }
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
            // Wird der Inhalt einer ETB-Meldung: dessen Grenze (LFH-937, design.md D2).
            let text = pflicht_max(
                req.vollzugsmeldung.as_deref().unwrap_or_default(),
                "Vollzugsmeldung",
                crate::etb::INHALT_MAX,
            )?;
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
                &text,
                &now,
            )
            .await?;
            state.live.publiziere(einsatz_id, etb_id);
        }
        _ => return Err(AppError::Validation("Ungültiger Vollzug-Status".into())),
    }
    let d = repo::laden(&state.pool, auftrag_id, &now).await?;
    let mut d = d;
    anreichern_alle(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        &ctx.benutzer,
        ctx.modul_rolle(),
        std::slice::from_mut(&mut d),
    )
    .await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/abnehmen — Führung nimmt Vollzug ab.
pub async fn abnehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Auftraege>,
    PfadParam((einsatz_id, auftrag_id)): PfadParam<(i64, i64)>,
) -> Result<Json<AuftragDetail>, AppError> {
    gehoert_pruefen(&state, &ctx, auftrag_id).await?;
    let now = jetzt();
    let aktuell = repo::laden(&state.pool, auftrag_id, &now).await?;
    if aktuell.auftrag.vollzug_status != "vollzogen" {
        return Err(AppError::UnprocessableEntity(
            "Nur vollzogene Aufträge können abgenommen werden".into(),
        ));
    }
    repo::nimm_ab(&state.pool, auftrag_id, ctx.benutzer.id, &now).await?;
    let d = repo::laden(&state.pool, auftrag_id, &now).await?;
    let mut d = d;
    anreichern_alle(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        &ctx.benutzer,
        ctx.modul_rolle(),
        std::slice::from_mut(&mut d),
    )
    .await?;
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
