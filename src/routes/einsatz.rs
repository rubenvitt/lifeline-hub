use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_einsatzleitung, fordere_lesezugriff, fordere_schreibrecht_oder_admin,
    ist_fristverkuerzung,
};
use crate::einsatz::{
    einstellungen, ist_gueltige_einsatzart, modul, modul_override, repo, EinsatzAnzeige,
    EinsatzRolle, MitgliedAnzeige, EINSATZ_ROLLE_LEITUNG,
};
use crate::error::AppError;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct NeuerEinsatz {
    pub bezeichnung: String,
    pub stichwort: Option<String>,
}

/// POST /api/einsaetze — neuen Einsatz anlegen; Ersteller wird Einsatzleitung.
/// Erfordert Anlege-Berechtigung (System-Admin oder org-weite Führungskraft).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Json(req): Json<NeuerEinsatz>,
) -> Result<(StatusCode, Json<EinsatzAnzeige>), AppError> {
    if !benutzer.darf_einsatz_anlegen() {
        return Err(AppError::Forbidden);
    }
    if req.bezeichnung.trim().is_empty() {
        return Err(AppError::Validation(
            "Bezeichnung darf nicht leer sein".into(),
        ));
    }
    let stichwort = req
        .stichwort
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let einsatz =
        repo::anlegen(&state.pool, req.bezeichnung.trim(), stichwort, benutzer.id).await?;
    Ok((
        StatusCode::CREATED,
        Json(einsatz.anzeige(Some(EINSATZ_ROLLE_LEITUNG.to_string()))),
    ))
}

/// GET /api/einsaetze — alle Einsätze mit der Rolle des Abfragenden (`meine_rolle`).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EinsatzAnzeige>>, AppError> {
    Ok(Json(repo::liste_fuer(&state.pool, &benutzer).await?))
}

/// GET /api/einsaetze/{id} — Einsatz-Detail; gemäß DSGVO-Lese-Policy.
/// Mitglieder (je nach Status/Frist) sowie höhere Berechtigungen (auch ohne
/// Mitgliedschaft) dürfen lesen; `meine_rolle` ist dann ggf. `null`.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(einsatz.anzeige(rolle.map(|r| r.as_str().to_string()))))
}

/// POST /api/einsaetze/{id}/abschliessen — Einsatz abschließen (read-only).
/// Nur Einsatzleitung, nur wenn der Einsatz aktuell aktiv ist.
pub async fn abschliessen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(rolle)?;
    fordere_aktiv(&einsatz)?;

    let aktualisiert = repo::abschliessen(&state.pool, id, benutzer.id).await?;
    Ok(Json(
        aktualisiert.anzeige(rolle.map(|r| r.as_str().to_string())),
    ))
}

#[derive(Debug, Deserialize)]
pub struct FristSetzen {
    /// Neue Aufbewahrungsfrist (ISO-8601/RFC3339 oder SQLite-Format); `null`/leer
    /// hebt die Frist auf (unbegrenzt).
    pub retention_bis: Option<String>,
    /// Pflicht-Bestätigung bei Verkürzung der Frist (sonst 409).
    #[serde(default)]
    pub bestaetigt: bool,
}

/// PUT /api/einsaetze/{id}/aufbewahrungsfrist — Aufbewahrungsfrist setzen, ändern
/// oder aufheben (LFH-130). Nur Einsatzleitung oder System-Admin. Eine Verkürzung
/// (inkl. erstmaligem Setzen auf einen bislang unbegrenzten Einsatz) erfordert
/// `bestaetigt=true`. Schreibt einen ETB-System-Eintrag als Audit. Die Frist greift
/// erst ab Einsatzabschluss (reaktive Lese-Sperre), nie auf aktive Einsätze.
pub async fn aufbewahrungsfrist_setzen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
    Json(req): Json<FristSetzen>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    // Administrativ: Einsatzleitung (Mitgliedschaft) oder System-Admin.
    if !benutzer.ist_admin() {
        fordere_einsatzleitung(rolle)?;
    }

    // Neue Frist normalisieren; leer/None = aufheben.
    let neue_frist = match req
        .retention_bis
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(s) => Some(crate::etb::normalisiere_zeit(s)?),
        None => None,
    };

    let alt = einsatz.retention_bis.as_deref();
    // Unverändert → kein UPDATE, kein Audit-Eintrag (kein Rauschen im ETB).
    if alt == neue_frist.as_deref() {
        return Ok(Json(einsatz.anzeige(rolle.map(|r| r.as_str().to_string()))));
    }
    if ist_fristverkuerzung(alt, neue_frist.as_deref()) && !req.bestaetigt {
        return Err(AppError::Conflict(
            "Verkürzung der Aufbewahrungsfrist muss bestätigt werden".into(),
        ));
    }

    let audit = match (alt, neue_frist.as_deref()) {
        (_, None) => "Aufbewahrungsfrist aufgehoben (unbegrenzt)".to_string(),
        (None, Some(neu)) => format!("Aufbewahrungsfrist gesetzt auf {neu}"),
        (Some(a), Some(neu)) => format!("Aufbewahrungsfrist geändert von {a} auf {neu}"),
    };

    let aktualisiert =
        repo::frist_setzen(&state.pool, id, benutzer.id, neue_frist.as_deref(), &audit).await?;
    Ok(Json(
        aktualisiert.anzeige(rolle.map(|r| r.as_str().to_string())),
    ))
}

#[derive(Debug, Deserialize)]
pub struct EinstellungenUpdate {
    pub standard_modul: Option<String>,
    pub basemap_modus: Option<String>,
    pub karten_zoom_start: Option<f64>,
    /// JSON-Objekt {nina,dwd,pegelonline,kritis}; wird als Text gespeichert.
    pub fachebenen_sichtbar: Option<serde_json::Value>,
    // Anzeige-Konventionen (LFH-136); None/leer = projektweiter Default.
    pub zeitzone: Option<String>,
    pub zeitformat: Option<String>,
    pub einheiten: Option<String>,
    pub koordinatenformat: Option<String>,
}

/// GET /api/einsaetze/{id}/einstellungen — Einsatz-Einstellungen (LFH-131).
/// Lesezugriff gemäß DSGVO-Lese-Policy; existiert keine Zeile → Defaults.
pub async fn einstellungen_laden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<einstellungen::EinstellungenAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(
        einstellungen::laden_oder_default(&state.pool, id)
            .await?
            .anzeige(),
    ))
}

/// PUT /api/einsaetze/{id}/einstellungen — Einstellungen setzen (Vollersatz).
/// Gate: Einsatz-Schreibrecht ODER System-Admin, plus aktiver Einsatz (Freeze → 409).
pub async fn einstellungen_setzen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
    Json(req): Json<EinstellungenUpdate>,
) -> Result<Json<einstellungen::EinstellungenAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_schreibrecht_oder_admin(&benutzer, rolle)?;
    fordere_aktiv(&einsatz)?; // Freeze bei Abschluss

    let standard_modul = bereinige(req.standard_modul);
    let basemap_modus = bereinige(req.basemap_modus);
    if let Some(m) = basemap_modus.as_deref() {
        if !einstellungen::ist_gueltiger_basemap_modus(m) {
            return Err(AppError::Validation("Ungültiger basemap_modus".into()));
        }
    }
    if let Some(z) = req.karten_zoom_start {
        if !(0.0..=28.0).contains(&z) {
            return Err(AppError::Validation(
                "karten_zoom_start muss zwischen 0 und 28 liegen".into(),
            ));
        }
    }
    // Fachebenen-JSON: muss Objekt sein; als kompakter String gespeichert.
    let fachebenen = match &req.fachebenen_sichtbar {
        Some(v) if v.is_object() => Some(v.to_string()),
        Some(serde_json::Value::Null) | None => None,
        Some(_) => {
            return Err(AppError::Validation(
                "fachebenen_sichtbar muss ein Objekt sein".into(),
            ))
        }
    };

    // Anzeige-Konventionen (LFH-136): bereinigen + Whitelist (Fehler ⇒ 400).
    let zeitzone = bereinige(req.zeitzone);
    if let Some(z) = zeitzone.as_deref() {
        if !einstellungen::ist_gueltige_zeitzone(z) {
            return Err(AppError::Validation("Ungültige zeitzone".into()));
        }
    }
    let zeitformat = bereinige(req.zeitformat);
    if let Some(f) = zeitformat.as_deref() {
        if !einstellungen::ist_gueltiges_zeitformat(f) {
            return Err(AppError::Validation("Ungültiges zeitformat".into()));
        }
    }
    let einheiten = bereinige(req.einheiten);
    if let Some(e) = einheiten.as_deref() {
        if !einstellungen::ist_gueltiges_einheiten_system(e) {
            return Err(AppError::Validation("Ungültiges einheiten-System".into()));
        }
    }
    let koordinatenformat = bereinige(req.koordinatenformat);
    if let Some(k) = koordinatenformat.as_deref() {
        if !einstellungen::ist_gueltiges_koordinatenformat(k) {
            return Err(AppError::Validation("Ungültiges koordinatenformat".into()));
        }
    }

    let gespeichert = einstellungen::speichern(
        &state.pool,
        id,
        benutzer.id,
        einstellungen::EinstellungenDaten {
            standard_modul: standard_modul.as_deref(),
            basemap_modus: basemap_modus.as_deref(),
            karten_zoom_start: req.karten_zoom_start,
            fachebenen_sichtbar: fachebenen.as_deref(),
            zeitzone: zeitzone.as_deref(),
            zeitformat: zeitformat.as_deref(),
            einheiten: einheiten.as_deref(),
            koordinatenformat: koordinatenformat.as_deref(),
            // Verhalten & Automatik (LFH-133): vollständige Annahme + Freeze-Guard folgt in Task 5.
            ..Default::default()
        },
    )
    .await?;
    Ok(Json(gespeichert.anzeige()))
}

/// GET /api/einsaetze/{id}/modul-overrides — alle Modul-Overrides eines Einsatzes
/// (LFH-132), als Map `modul_key → Override`. Lesezugriff gemäß DSGVO-Lese-Policy;
/// existieren keine Overrides, ist die Map leer (= alle Module sichtbar, frei).
pub async fn modul_overrides_laden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<HashMap<String, modul_override::EinsatzModulOverride>>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(modul_override::laden_alle(&state.pool, id).await?))
}

#[derive(Debug, Deserialize)]
pub struct ModulOverrideUpdate {
    pub sichtbar: bool,
    /// 'admin' | 'fuehrungskraft' | null (= frei).
    pub benoetigte_rolle: Option<String>,
}

/// PUT /api/einsaetze/{id}/modul-overrides/{modul_key} — Sichtbarkeit + benötigte
/// Rolle eines Moduls überschreiben (LFH-132). Gate: Einsatzleitung ODER System-Admin,
/// plus aktiver Einsatz (Freeze → 409). Unbekannter Modul-Key → 400. Nicht-ausblendbare
/// Module (einsatzdaten, einsatz-einstellungen) lassen sich nicht verstecken
/// (Selbst-Aussperr-Schutz) → 400. Ungültige `benoetigte_rolle` → 400.
pub async fn modul_override_setzen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((id, modul_key)): Path<(i64, String)>,
    Json(req): Json<ModulOverrideUpdate>,
) -> Result<Json<modul_override::EinsatzModulOverride>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    // Administrativ: Einsatzleitung (Mitgliedschaft) oder System-Admin.
    if !benutzer.ist_admin() {
        fordere_einsatzleitung(rolle)?;
    }
    fordere_aktiv(&einsatz)?; // Freeze bei Abschluss

    if !modul::ist_gueltiger_modul_key(&modul_key) {
        return Err(AppError::Validation("Unbekannter Modul-Key".into()));
    }
    // Selbst-Aussperr-Schutz: nicht-ausblendbare Module dürfen weder versteckt noch
    // rollen-beschränkt werden (beide Dimensionen, sonst Aussperrung aus den
    // Einstellungen möglich).
    let benoetigte_rolle = bereinige(req.benoetigte_rolle);
    if !modul::ist_ausblendbar(&modul_key) && (!req.sichtbar || benoetigte_rolle.is_some()) {
        return Err(AppError::Validation(
            "Dieses Modul kann nicht ausgeblendet oder rollen-beschränkt werden".into(),
        ));
    }
    if let Some(r) = benoetigte_rolle.as_deref() {
        if !modul::ist_gueltige_benoetigte_rolle(r) {
            return Err(AppError::Validation("Ungültige benoetigte_rolle".into()));
        }
    }

    let gespeichert = modul_override::setzen(
        &state.pool,
        id,
        &modul_key,
        req.sichtbar,
        benoetigte_rolle.as_deref(),
        benutzer.id,
    )
    .await?;
    Ok(Json(gespeichert))
}

#[derive(Debug, Deserialize)]
pub struct MitgliedRolle {
    /// 'einsatzleitung' | 'fuehrungspersonal' | 'beobachter'.
    pub einsatz_rolle: String,
}

/// GET /api/einsaetze/{id}/mitglieder — Mitgliederliste; gemäß DSGVO-Lese-Policy.
pub async fn mitglieder(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<Vec<MitgliedAnzeige>>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?; // 404, wenn der Einsatz nicht existiert
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(repo::mitglieder(&state.pool, id).await?))
}

/// PUT /api/einsaetze/{id}/mitglieder/{benutzer_id} — Mitglied hinzufügen oder
/// dessen Rolle ändern. Nur Einsatzleitung, nur bei aktivem Einsatz.
/// Schützt die letzte Einsatzleitung vor Herabstufung.
pub async fn mitglied_setzen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((id, ziel_id)): Path<(i64, i64)>,
    Json(req): Json<MitgliedRolle>,
) -> Result<Json<Vec<MitgliedAnzeige>>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let meine = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(meine)?;
    fordere_aktiv(&einsatz)?;

    let neue_rolle = EinsatzRolle::parse(&req.einsatz_rolle)
        .ok_or_else(|| AppError::Validation("Ungültige einsatz_rolle".into()))?;

    // Ziel-Benutzer muss existieren und aktiv sein.
    let ziel_aktiv: Option<bool> = sqlx::query_scalar("SELECT aktiv FROM benutzer WHERE id = ?")
        .bind(ziel_id)
        .fetch_optional(&state.pool)
        .await?;
    match ziel_aktiv {
        None => return Err(AppError::NotFound),
        Some(false) => return Err(AppError::Conflict("Benutzer ist deaktiviert".into())),
        Some(true) => {}
    }

    // Letzte Einsatzleitung nicht herabstufen.
    if neue_rolle != EinsatzRolle::Einsatzleitung {
        let aktuelle = repo::rolle_von(&state.pool, id, ziel_id).await?;
        if aktuelle == Some(EinsatzRolle::Einsatzleitung)
            && repo::zaehle_einsatzleitung(&state.pool, id).await? <= 1
        {
            return Err(AppError::Conflict(
                "Die letzte Einsatzleitung kann nicht herabgestuft werden".into(),
            ));
        }
    }

    repo::setze_rolle(&state.pool, id, ziel_id, neue_rolle).await?;
    Ok(Json(repo::mitglieder(&state.pool, id).await?))
}

/// DELETE /api/einsaetze/{id}/mitglieder/{benutzer_id} — Mitglied entfernen.
/// Nur Einsatzleitung, nur bei aktivem Einsatz.
/// Schützt die letzte Einsatzleitung vor Entfernung.
pub async fn mitglied_entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((id, ziel_id)): Path<(i64, i64)>,
) -> Result<Json<Vec<MitgliedAnzeige>>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let meine = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(meine)?;
    fordere_aktiv(&einsatz)?;

    let ziel_rolle = repo::rolle_von(&state.pool, id, ziel_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if ziel_rolle == EinsatzRolle::Einsatzleitung
        && repo::zaehle_einsatzleitung(&state.pool, id).await? <= 1
    {
        return Err(AppError::Conflict(
            "Die letzte Einsatzleitung kann nicht entfernt werden".into(),
        ));
    }

    repo::entferne(&state.pool, id, ziel_id).await?;
    Ok(Json(repo::mitglieder(&state.pool, id).await?))
}

/// Trimmt einen optionalen String; leer → `None` (wird als NULL gespeichert).
fn bereinige(feld: Option<String>) -> Option<String> {
    feld.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
pub struct KopfdatenUpdate {
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub einsatzart: String,
    pub einsatznummer_intern: Option<String>,
    pub leitstellen_nr: Option<String>,
    pub einsatzort: Option<String>,
    pub einsatzort_lat: Option<f64>,
    pub einsatzort_lon: Option<f64>,
    pub meldende_stelle: Option<String>,
    pub sachverhalt: Option<String>,
    pub anzahl_betroffene_initial: Option<i64>,
    /// Alarmzeit (ISO-8601/RFC3339 oder SQLite-Format).
    pub begonnen_at: String,
}

/// PATCH /api/einsaetze/{id} — Kopf-/Stammdaten in einem Request aktualisieren.
/// Gate: Einsatz-Schreibrecht ODER System-Admin, plus aktiver Einsatz (sonst 409).
/// Vollersatz der editierbaren Felder; leere Optional-Strings → NULL.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
    Json(req): Json<KopfdatenUpdate>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_schreibrecht_oder_admin(&benutzer, rolle)?;
    fordere_aktiv(&einsatz)?;

    let bezeichnung = req.bezeichnung.trim();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    if !ist_gueltige_einsatzart(&req.einsatzart) {
        return Err(AppError::Validation("Ungültige Einsatzart".into()));
    }
    if let Some(n) = req.anzahl_betroffene_initial {
        if n < 0 {
            return Err(AppError::Validation(
                "Anzahl Betroffene darf nicht negativ sein".into(),
            ));
        }
    }
    let begonnen_at = crate::etb::normalisiere_zeit(&req.begonnen_at)?;

    let stichwort = bereinige(req.stichwort);
    let einsatznummer_intern = bereinige(req.einsatznummer_intern);
    let leitstellen_nr = bereinige(req.leitstellen_nr);
    let einsatzort = bereinige(req.einsatzort);
    let meldende_stelle = bereinige(req.meldende_stelle);
    let sachverhalt = bereinige(req.sachverhalt);

    let aktualisiert = repo::aktualisiere_kopf(
        &state.pool,
        id,
        repo::KopfDaten {
            bezeichnung,
            stichwort: stichwort.as_deref(),
            einsatzart: &req.einsatzart,
            einsatznummer_intern: einsatznummer_intern.as_deref(),
            leitstellen_nr: leitstellen_nr.as_deref(),
            einsatzort: einsatzort.as_deref(),
            einsatzort_lat: req.einsatzort_lat,
            einsatzort_lon: req.einsatzort_lon,
            meldende_stelle: meldende_stelle.as_deref(),
            sachverhalt: sachverhalt.as_deref(),
            anzahl_betroffene_initial: req.anzahl_betroffene_initial,
            begonnen_at: &begonnen_at,
        },
    )
    .await?;

    Ok(Json(
        aktualisiert.anzeige(rolle.map(|r| r.as_str().to_string())),
    ))
}
