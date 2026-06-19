use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_modul_zugriff, fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::einsatz::modul_override;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "tiere";
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::person::repo as person_repo; // Org-Isolation der Halter-FK (404 bei fremder Person)
use crate::tier::{
    darf_uebergehen, registrier_anzeige, repo as tier_repo, AbschlussGrund, Spezies, TierAnzeige,
    TierGeschlecht, TierStatus,
};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

// ---------- ETB-/SSE-Helfer (lokales Muster wie in anderen Routen) ----------

/// Schreibt einen pseudonymen System-ETB-Eintrag und publiziert ihn als `etb`-SSE.
/// Identisch zu `routes::einsatz_person::etb_system`.
async fn etb_system(
    state: &AppState,
    einsatz_id: i64,
    benutzer_id: i64,
    inhalt: &str,
) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

/// Dediziertes `tier`-SSE-Event OHNE sensible Payload (nur einsatz_id + tier_id);
/// Clients refetchen.
fn sse_tier(state: &AppState, einsatz_id: i64, tier_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "tier_id": tier_id }).to_string();
    state.live.publiziere_event(einsatz_id, "tier", data);
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Liest ein optional-nullable Feld so, dass JSON-`null` → `Some(None)` und
/// fehlendes Feld → `None` (für den Halter-FK↔Freitext-Toggle). Wie in
/// `routes::einsatz_uhs`.
fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Validiert optionales Tier-Geschlecht; `Validation`, falls gesetzt und unbekannt.
fn pruefe_geschlecht(g: &Option<String>) -> Result<(), AppError> {
    if let Some(g) = g {
        if TierGeschlecht::parse(g).is_none() {
            return Err(AppError::Validation("Unbekanntes Geschlecht".into()));
        }
    }
    Ok(())
}

// ============================== Routen ==============================

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub spezies: Option<String>,
    pub halter_person_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/tiere — Liste (Filter `?status=`, `?spezies=`, `?halter_person_id=`).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<TierAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;

    if let Some(s) = &params.status {
        if TierStatus::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannter Status im Filter".into()));
        }
    }
    if let Some(s) = &params.spezies {
        if Spezies::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannte Spezies im Filter".into()));
        }
    }
    Ok(Json(
        tier_repo::liste(
            &state.pool,
            einsatz_id,
            params.status.as_deref(),
            params.spezies.as_deref(),
            params.halter_person_id,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    /// Optional; Default `aktiv`. Erlaubt nur `aktiv` | `vermisst`.
    pub status: Option<String>,
    pub spezies: String,
    pub rasse_beschreibung: Option<String>,
    pub rufname: Option<String>,
    pub geschlecht: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<String>,
    pub kennzeichnung: Option<String>,
    pub groesse_gewicht: Option<String>,
    pub halter_person_id: Option<i64>,
    pub halter_kontakt: Option<String>,
    pub antreff_ort: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/tiere — Anlegen. Status ∈ {aktiv, vermisst}
/// (`abgeschlossen` → 422). Halter-Exklusivität → 422. Pseudonyme ETB-Spur + SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<TierAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    // Spezies (Pflicht) prüfen.
    if Spezies::parse(&body.spezies).is_none() {
        return Err(AppError::Validation("Unbekannte oder fehlende Spezies".into()));
    }
    // Status: Default aktiv; nur aktiv|vermisst erlaubt.
    let status = body.status.as_deref().unwrap_or("aktiv");
    if !matches!(status, "aktiv" | "vermisst") {
        return Err(AppError::UnprocessableEntity(
            "Beim Anlegen ist nur Status 'aktiv' oder 'vermisst' erlaubt".into(),
        ));
    }
    pruefe_geschlecht(&body.geschlecht)?;
    // Halter-Exklusivität (zweite Verteidigungslinie zum DB-CHECK).
    if body.halter_person_id.is_some() && trimme(body.halter_kontakt.clone()).is_some() {
        return Err(AppError::UnprocessableEntity(
            "Halter-FK und Halter-Freitext schließen sich aus".into(),
        ));
    }
    // Org-Isolation: gesetzte Halter-Person muss zu DIESEM Einsatz gehören (404 sonst).
    // Mustergleich zu `einsatz_uhs::platz_verfuegbarkeit` (Reservierungs-Ziel).
    if let Some(hp) = body.halter_person_id {
        person_repo::laden(&state.pool, einsatz_id, hp).await?;
    }

    let rasse = trimme(body.rasse_beschreibung);
    let rufname = trimme(body.rufname);
    let farbe = trimme(body.farbe_beschreibung);
    let kennzeichnung = trimme(body.kennzeichnung);
    let groesse = trimme(body.groesse_gewicht);
    let halter_kontakt = trimme(body.halter_kontakt);
    let antreff = trimme(body.antreff_ort);
    let notiz = trimme(body.notiz);

    let tier = tier_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        status,
        tier_repo::NeueDaten {
            spezies: &body.spezies,
            rasse_beschreibung: rasse.as_deref(),
            rufname: rufname.as_deref(),
            geschlecht: body.geschlecht.as_deref(),
            alter_geschaetzt: body.alter_geschaetzt,
            farbe_beschreibung: farbe.as_deref(),
            kennzeichnung: kennzeichnung.as_deref(),
            groesse_gewicht: groesse.as_deref(),
            halter_person_id: body.halter_person_id,
            halter_kontakt: halter_kontakt.as_deref(),
            antreff_ort: antreff.as_deref(),
            notiz: notiz.as_deref(),
        },
    )
    .await?;

    // Pseudonyme ETB-Spur: nur Reg.-Nr. + Spezies (+ Status bei vermisst).
    let spezies_label = Spezies::parse(&tier.spezies).map(|s| s.etb_label()).unwrap_or("");
    let text = if status == "vermisst" {
        format!("Tier {} ({}) als vermisst gemeldet", registrier_anzeige(tier.registrier_nr), spezies_label)
    } else {
        format!("Tier {} ({}) erfasst", registrier_anzeige(tier.registrier_nr), spezies_label)
    };
    etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    sse_tier(&state, einsatz_id, tier.id);
    Ok((StatusCode::CREATED, Json(tier)))
}

/// GET /api/einsaetze/{id}/tiere/{tid} — Detail (voller Datensatz). NICHT auditiert.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, tier_id)): Path<(i64, i64)>,
) -> Result<Json<TierAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    Ok(Json(tier_repo::laden(&state.pool, einsatz_id, tier_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub rasse_beschreibung: Option<String>,
    pub rufname: Option<String>,
    pub geschlecht: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<String>,
    pub kennzeichnung: Option<String>,
    pub groesse_gewicht: Option<String>,
    pub antreff_ort: Option<String>,
    pub notiz: Option<String>,
    /// `Some(null)` = explizit löschen; absent = unverändert.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub halter_person_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub halter_kontakt: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/tiere/{tid} — Stammfelder (Identität, Halter,
/// Antreffort, Notiz). Halter-Exklusivität → 422. Storniert → 409. KEIN ETB
/// (Stammfelder sind nicht lagerelevant; vgl. E‑1-PATCH). SSE.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, tier_id)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<TierAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;
    pruefe_geschlecht(&body.geschlecht)?;

    let vorher = tier_repo::laden(&state.pool, einsatz_id, tier_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Storniertes Tier kann nicht geändert werden".into()));
    }

    let kontakt_norm = body
        .halter_kontakt
        .map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));

    // Effektiven Halter-Zustand NACH dem Patch bestimmen (XOR als zweite
    // Verteidigungslinie zum DB-CHECK): ein Patch, der nur EIN Halter-Feld setzt,
    // während das andere bereits belegt ist, würde sonst beide setzen → DB-CHECK → 500.
    let effektiv_fk: Option<i64> = match body.halter_person_id {
        Some(opt) => opt,                          // Some(Some(id)) = setzen, Some(None) = leeren
        None => vorher.halter_person_id,           // unverändert
    };
    let effektiv_kontakt: Option<String> = match &kontakt_norm {
        Some(opt) => opt.clone(),                  // Some(Some(s)) = setzen, Some(None) = leeren
        None => vorher.halter_kontakt.clone(),     // unverändert
    };
    if effektiv_fk.is_some() && effektiv_kontakt.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Halter-FK und Halter-Freitext schließen sich aus".into(),
        ));
    }
    // Org-Isolation: ein gesetzter Halter-FK muss zu DIESEM Einsatz gehören (404 sonst).
    if let Some(Some(hp)) = body.halter_person_id {
        person_repo::laden(&state.pool, einsatz_id, hp).await?;
    }

    let rasse = trimme(body.rasse_beschreibung);
    let rufname = trimme(body.rufname);
    let farbe = trimme(body.farbe_beschreibung);
    let kennzeichnung = trimme(body.kennzeichnung);
    let groesse = trimme(body.groesse_gewicht);
    let antreff = trimme(body.antreff_ort);
    let notiz = trimme(body.notiz);

    let tier = tier_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        tier_id,
        benutzer.id,
        tier_repo::PatchDaten {
            rasse_beschreibung: rasse.as_deref(),
            rufname: rufname.as_deref(),
            geschlecht: body.geschlecht.as_deref(),
            alter_geschaetzt: body.alter_geschaetzt,
            farbe_beschreibung: farbe.as_deref(),
            kennzeichnung: kennzeichnung.as_deref(),
            groesse_gewicht: groesse.as_deref(),
            antreff_ort: antreff.as_deref(),
            notiz: notiz.as_deref(),
            halter_person_id: body.halter_person_id,
            halter_kontakt: kontakt_norm.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_tier(&state, einsatz_id, tier_id);
    Ok(Json(tier))
}

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: String,
    pub abschluss_grund: Option<String>,
    pub abschluss_ziel: Option<String>,
}

/// POST /api/einsaetze/{id}/tiere/{tid}/status — validierter Status-Wechsel.
/// Unbekannter Zielstatus → 400; ungültiger Übergang → 422; `→ abgeschlossen`
/// ohne gültigen `abschluss_grund` → 422; storniert → 409. Pseudonyme ETB-Spur + SSE.
pub async fn status_wechsel(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, tier_id)): Path<(i64, i64)>,
    Json(body): Json<StatusBody>,
) -> Result<Json<TierAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    if TierStatus::parse(&body.status).is_none() {
        return Err(AppError::Validation("Unbekannter Status".into()));
    }
    let vorher = tier_repo::laden(&state.pool, einsatz_id, tier_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Storniertes Tier kann nicht geändert werden".into()));
    }
    if !darf_uebergehen(&vorher.status, &body.status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang {} → {} ist nicht erlaubt",
            vorher.status, body.status
        )));
    }

    // → abgeschlossen erfordert gültigen abschluss_grund (Route + DB-CHECK).
    let grund = trimme(body.abschluss_grund.clone());
    let ziel = trimme(body.abschluss_ziel.clone());
    if body.status == "abgeschlossen" {
        match grund.as_deref() {
            Some(g) if AbschlussGrund::parse(g).is_some() => {}
            _ => {
                return Err(AppError::UnprocessableEntity(
                    "Abschluss erfordert einen gültigen abschluss_grund".into(),
                ))
            }
        }
    }

    tier_repo::setze_status(
        &state.pool,
        einsatz_id,
        tier_id,
        &body.status,
        grund.as_deref(),
        ziel.as_deref(),
        benutzer.id,
    )
    .await?;

    // Pseudonyme ETB-Spur (Spec-Tabelle): nie Rufname/Kennzeichnung/Halter/Ziel.
    let r = registrier_anzeige(vorher.registrier_nr);
    let text = match body.status.as_str() {
        "abgeschlossen" => format!("Tier {r}: abgeschlossen ({})", grund.as_deref().unwrap_or("")),
        "aktiv" if vorher.status == "vermisst" => format!("Tier {r}: vermisst → aktiv (aufgefunden)"),
        _ => format!("Tier {r}: {} → {}", vorher.status, body.status),
    };
    etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    sse_tier(&state, einsatz_id, tier_id);
    Ok(Json(tier_repo::laden(&state.pool, einsatz_id, tier_id).await?))
}

/// DELETE /api/einsaetze/{id}/tiere/{tid} — Stornieren (Soft-Delete).
/// Bereits storniert → 409. Pseudonyme ETB-Spur + SSE.
pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, tier_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    let tier = tier_repo::laden(&state.pool, einsatz_id, tier_id).await?;
    if tier.storniert_at.is_some() {
        return Err(AppError::Conflict("Tier ist bereits storniert".into()));
    }
    tier_repo::storniere(&state.pool, einsatz_id, tier_id, benutzer.id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Tier {} storniert", registrier_anzeige(tier.registrier_nr)),
    )
    .await?;
    sse_tier(&state, einsatz_id, tier_id);
    Ok(StatusCode::NO_CONTENT)
}

/// Einfaches CSV-Feld-Quoting (RFC 4180 + Formel-Injektions-Schutz), wie in
/// `routes::einsatz_person::csv_feld`.
fn csv_feld(s: &str) -> String {
    let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    };
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// GET /api/einsaetze/{id}/tiere/export — CSV aller (nicht-stornierten) Tiere.
/// NICHT auditiert (Tiere sind keine besondere Kategorie).
pub async fn export(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Response, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;

    let tiere = tier_repo::liste(&state.pool, einsatz_id, None, None, None).await?;
    let mut csv = String::from("registrier_nr;status;spezies;rufname;rasse;geschlecht;alter;antreff_ort\n");
    for t in &tiere {
        let alter = t.alter_geschaetzt.map(|a| a.to_string()).unwrap_or_default();
        csv.push_str(&format!(
            "{};{};{};{};{};{};{};{}\n",
            registrier_anzeige(t.registrier_nr),
            csv_feld(&t.status),
            csv_feld(&t.spezies),
            csv_feld(t.rufname.as_deref().unwrap_or("")),
            csv_feld(t.rasse_beschreibung.as_deref().unwrap_or("")),
            csv_feld(t.geschlecht.as_deref().unwrap_or("")),
            alter,
            csv_feld(t.antreff_ort.as_deref().unwrap_or("")),
        ));
    }
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/csv; charset=utf-8")],
        csv,
    )
        .into_response())
}

/// GET /api/einsaetze/{id}/tiere/stream — SSE-Stream. Nur Lesezugriff.
/// Der Client filtert clientseitig auf `tier`-Events.
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
