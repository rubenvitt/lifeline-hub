use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff, fordere_schreibrecht,
};
use crate::einsatz::modul_override;
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;

/// Modul-Key dieses Route-Moduls (LFH-132); gegen die Override-Map geprüft.
const MODUL_KEY: &str = "etb";
use crate::etb::{normalisiere_zeit, repo, EtbEintragAnzeige, EtbTyp, MeldeWeg};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

#[derive(Debug, Deserialize)]
pub struct NeuerEintrag {
    pub typ: String,
    pub inhalt: String,
    pub von: Option<String>,
    pub an: Option<String>,
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    /// ISO-8601/RFC3339 oder SQLite-Format; fehlt das Feld, setzt der Server „jetzt".
    pub ereigniszeit: Option<String>,
    pub erfasst_lokal_at: Option<String>,
    /// Pflicht bei `typ = "berichtigung"`, sonst muss es fehlen.
    pub berichtigt_eintrag_id: Option<i64>,
}

/// Trimmt einen optionalen String und verwirft ihn, wenn er leer ist.
fn bereinige(feld: Option<String>) -> Option<String> {
    feld.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// POST /api/einsaetze/{id}/etb — neuen ETB-Eintrag erfassen.
/// Nur Schreibberechtigte (Einsatzleitung/Führungspersonal), nur bei aktivem
/// Einsatz. Der Server vergibt `lfd_nr` und `received_at` und broadcastet den
/// fertigen Eintrag an alle SSE-Abonnenten.
pub async fn erfassen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeuerEintrag>,
) -> Result<(StatusCode, Json<EtbEintragAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    // Typ validieren; System ist nicht client-erfassbar.
    let typ = EtbTyp::parse(&req.typ)
        .ok_or_else(|| AppError::Validation("Ungültiger Eintragstyp".into()))?;
    if !typ.darf_client_erfassen() {
        return Err(AppError::Validation(
            "Eintragstyp 'system' kann nicht manuell erfasst werden".into(),
        ));
    }

    let inhalt = req.inhalt.trim();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }

    // Meldeweg validieren (falls gesetzt).
    let meldeweg = bereinige(req.meldeweg);
    if let Some(w) = &meldeweg {
        if MeldeWeg::parse(w).is_none() {
            return Err(AppError::Validation("Ungültiger Meldeweg".into()));
        }
    }

    // Berichtigungs-Regeln (Spec §6: Korrekturen nur als verknüpfte Berichtigung).
    if typ.ist_berichtigung() {
        let ziel = req.berichtigt_eintrag_id.ok_or_else(|| {
            AppError::Validation("Berichtigung erfordert berichtigt_eintrag_id".into())
        })?;
        if !repo::gehoert_zu_einsatz(&state.pool, ziel, einsatz_id).await? {
            return Err(AppError::Validation(
                "Berichtigter Eintrag gehört nicht zu diesem Einsatz".into(),
            ));
        }
    } else if req.berichtigt_eintrag_id.is_some() {
        return Err(AppError::Validation(
            "berichtigt_eintrag_id ist nur bei typ='berichtigung' erlaubt".into(),
        ));
    }

    // Zeiten normalisieren (None = Server-Default in der DB).
    let ereigniszeit = match &req.ereigniszeit {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };
    let erfasst_lokal_at = match &req.erfasst_lokal_at {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };

    let von = bereinige(req.von);
    let an = bereinige(req.an);
    let veranlassung = bereinige(req.veranlassung);

    let anzeige = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::EintragDaten {
            typ: typ.as_str(),
            inhalt,
            von: von.as_deref(),
            an: an.as_deref(),
            meldeweg: meldeweg.as_deref(),
            veranlassung: veranlassung.as_deref(),
            ereigniszeit: ereigniszeit.as_deref(),
            erfasst_lokal_at: erfasst_lokal_at.as_deref(),
            berichtigt_eintrag_id: req.berichtigt_eintrag_id,
        },
    )
    .await?;

    // Live an alle SSE-Abonnenten dieses Einsatzes pushen. Eine Serialisierung
    // dieses Typs kann derzeit nicht fehlschlagen; sollte sie es künftig doch,
    // wird der Eintrag (bereits persistiert) nicht stillschweigend verschluckt,
    // sondern protokolliert.
    match serde_json::to_string(&anzeige) {
        Ok(json) => state.live.publiziere(einsatz_id, json),
        Err(e) => tracing::error!(
            eintrag_id = anzeige.id,
            %e,
            "ETB-Eintrag konnte nicht für Live-Publish serialisiert werden"
        ),
    }

    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// POST /api/einsaetze/{id}/etb/{eintrag_id}/auftrag — aus einem ETB-Eintrag direkt einen
/// Auftrag/Befehl erteilen (ETB→Auftrag, LFH-112). Erzeugt einen formalen Auftrag (inkl.
/// eigener ETB-Anordnung, Pattern B) und setzt am erzeugten Auftrag den Quellbezug
/// `auftrag.quell_etb_eintrag_id` auf den auslösenden Eintrag. Die Auftragsfelder durchlaufen
/// dieselbe Validierung wie POST /auftraege (geteilt, kein zweiter Pfad). Schreibrecht + aktiv
/// + Cross-Einsatz-Schutz wie bei `erfassen`. Antwortet mit dem erzeugten Auftrag (201).
pub async fn auftrag_erteilen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eintrag_id)): Path<(i64, i64)>,
    Json(req): Json<crate::routes::auftrag::NeuerAuftrag>,
) -> Result<(StatusCode, Json<crate::auftrag::AuftragDetail>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;
    // Cross-Einsatz-Schutz: der Quell-Eintrag muss zu diesem Einsatz gehören.
    if !repo::gehoert_zu_einsatz(&state.pool, eintrag_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    // Gleiche Validierung wie POST /auftraege (geteilt) → kein zweiter, ungeprüfter Pfad.
    let now = jetzt();
    let validiert =
        crate::routes::auftrag::validiere_neuen_auftrag(&state.pool, einsatz_id, &req, &now, None).await?;
    let auftrag_id = crate::auftrag::repo::erteile_aus_etb_tx(
        &state.pool, einsatz_id, eintrag_id, benutzer.id, validiert.daten(),
    )
    .await?;

    let detail = crate::auftrag::repo::laden(&state.pool, auftrag_id, &now).await?;
    // ETB-Anordnung entstand im selben Commit → ETB-Live-Event + Auftrag-Board-Event (SSE-Parität).
    if let Some(etb_id) = detail.auftrag.etb_anordnung_id {
        if let Ok(etb) = repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb) {
                state.live.publiziere(einsatz_id, json);
            }
        }
    }
    state.live.publiziere_event(
        einsatz_id,
        "auftrag",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );

    Ok((StatusCode::CREATED, Json(detail)))
}

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

#[derive(Debug, Deserialize)]
pub struct EtbAbfrageParams {
    /// Volltext-Suchbegriff.
    pub q: Option<String>,
    /// Eintragstyp-Filter.
    pub typ: Option<String>,
    /// Untere Grenze ereigniszeit (ISO-8601/SQLite-Format).
    pub von: Option<String>,
    /// Obere Grenze ereigniszeit.
    pub bis: Option<String>,
    /// Filter nach Erfasser.
    pub erfasser_id: Option<i64>,
    /// Cursor: nur Einträge mit lfd_nr < diesem Wert.
    pub before_lfd_nr: Option<i64>,
    /// Seitengröße (Default STANDARD_LIMIT, max MAX_LIMIT).
    pub limit: Option<i64>,
}

/// GET /api/einsaetze/{id}/etb — ETB-Einträge eines Einsatzes (gefiltert,
/// volltextdurchsucht, paginiert). Nur für Mitglieder (auch Beobachter).
/// Sortierung: lfd_nr DESC (neueste zuerst); Cursor über before_lfd_nr.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<EtbAbfrageParams>,
) -> Result<Json<Vec<EtbEintragAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?; // 404, wenn unbekannt
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;

    // Typ validieren, falls gesetzt.
    if let Some(t) = &params.typ {
        if EtbTyp::parse(t).is_none() {
            return Err(AppError::Validation(
                "Ungültiger Eintragstyp im Filter".into(),
            ));
        }
    }

    // Zeitgrenzen normalisieren.
    let von_zeit = match &params.von {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };
    let bis_zeit = match &params.bis {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };

    // q nur als Filter nutzen, wenn nach Trim nicht leer.
    let q = params
        .q
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let limit = params
        .limit
        .unwrap_or(repo::STANDARD_LIMIT)
        .clamp(1, repo::MAX_LIMIT);

    let filter = repo::EtbFilter {
        q,
        typ: params.typ,
        von_zeit,
        bis_zeit,
        erfasser_id: params.erfasser_id,
        before_lfd_nr: params.before_lfd_nr,
        limit,
    };

    Ok(Json(repo::abfrage(&state.pool, einsatz_id, &filter).await?))
}

/// GET /api/einsaetze/{id}/etb/stream — Server-Sent-Events-Stream der neuen
/// ETB-Einträge eines Einsatzes. Nur für Mitglieder (auch Beobachter dürfen
/// lesen). Es werden nur **neue** Einträge gepusht — der Initial-Bestand wird
/// per `GET …/etb` geladen. Bei Pufferüberlauf sendet der Server ein
/// `lagged`-Event; der Client soll dann per GET resynchronisieren.
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?; // 404, wenn unbekannt
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            // Empfänger ist hinterhergehinkt: Client zum Resync auffordern.
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
