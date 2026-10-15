use crate::app::AppState;
use crate::bereitstellungsraum::belegung_repo;
use crate::bereitstellungsraum::repo::{self as br_repo, NeueDaten, PatchDaten};
use crate::bereitstellungsraum::{
    BrAnzeige, BrBelegungAnzeige, BrBelegungKennzahlen, BrStatus, BrVerlaufEintrag, ObjektTyp,
};
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Bereitstellungsraeume;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::geraet::{stelle, Bindungsart};
use crate::live::LiveEvent;
use crate::routes::support::{
    deserialize_optional_field, parse_enum, parse_enum_opt, pflicht, pflicht_tri, trimme,
};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Detail-Antwort: BR-Stamm + aktuell bereitgestellte Einheiten (mit ihren Fahrzeugen) +
/// einheitenlose Fahrzeuge + Kennzahlen der Belegung (LLH-1095, design.md D4).
#[derive(Debug, Serialize, ToSchema)]
pub struct BrDetail {
    #[serde(flatten)]
    pub br: BrAnzeige,
    pub einheiten: Vec<BrEinheitKurz>,
    /// Einheitenlose Fahrzeuge im Raum (`aktueller_br_id`); die Fahrzeuge der Einheiten stehen an
    /// der Einheit.
    pub fahrzeuge: Vec<BrFahrzeugKurz>,
    pub belegung: BrBelegungKennzahlen,
}

/// Schlanke Einheiten-Info für den Detail-Response.
#[derive(Debug, Serialize, ToSchema)]
pub struct BrEinheitKurz {
    pub id: i64,
    pub name: String,
    /// Seit wann die Einheit im Raum steht (jüngster Eintritt oder Wechsel herein, UTC ohne
    /// Zone); fehlt ohne passendes Ereignis.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seit_at: Option<String>,
    /// Aktive Fahrzeuge der Einheit.
    pub fahrzeuge: Vec<BrEinheitFahrzeug>,
}

/// Aktives Fahrzeug einer Einheit im Raum.
#[derive(Debug, Serialize, ToSchema)]
pub struct BrEinheitFahrzeug {
    pub id: i64,
    pub funkrufname: String,
}

/// Schlanke Fahrzeug-Info für den Detail-Response.
#[derive(Debug, Serialize, ToSchema)]
pub struct BrFahrzeugKurz {
    pub id: i64,
    pub funkrufname: String,
    /// Wie [`BrEinheitKurz::seit_at`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seit_at: Option<String>,
}

/// Eintrag der Liste: Raumdaten wie bisher (flatten), dazu Abschnittsname, Kennzahlen und die
/// Einheiten im Raum (LLH-1095, design.md D4; die Stärke rechnet der Client über
/// `summiereStaerke`).
#[derive(Debug, Serialize, ToSchema)]
pub struct BrListenEintrag {
    #[serde(flatten)]
    pub br: BrAnzeige,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_name: Option<String>,
    pub belegung: BrBelegungKennzahlen,
    pub einheit_ids: Vec<i64>,
}

// ---------- ETB-/SSE-Helfer ----------

pub(super) fn sse_br(state: &AppState, einsatz_id: i64, br_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Bereitstellungsraum, "br_id", br_id);
}

/// Meldet `bereitstellungsraum` für die Räume `raeume` und für jeden Raum, in dem eine der
/// `einheiten` steht, je Raum einmal (LLH-1095, design.md D7, Spec `bereitstellungsraum-belegung`,
/// „Belegung bleibt live aktuell“): das Detail zeigt die Fahrzeuge seiner Einheiten, und Leser
/// ohne Recht auf Einheiten oder Fahrzeuge erreicht `einheit`/`fahrzeug` nicht (LLH-1182). Liest
/// nach dem Commit; scheitert das Lesen, bleibt es bei einer Warnung und den Räumen aus `raeume`
/// (Muster `etb_system_degradiert`).
pub(super) async fn sse_br_fuer(
    state: &AppState,
    einsatz_id: i64,
    raeume: &[i64],
    einheiten: &[i64],
) {
    let mut ziele: Vec<i64> = raeume.to_vec();
    if !einheiten.is_empty() {
        let ids = serde_json::to_string(einheiten).unwrap_or_else(|_| "[]".into());
        match sqlx::query_scalar::<_, i64>(
            "SELECT DISTINCT aktueller_br_id FROM einsatz_einheit \
             WHERE einsatz_id = ? AND aktueller_br_id IS NOT NULL \
               AND id IN (SELECT value FROM json_each(?))",
        )
        .bind(einsatz_id)
        .bind(ids)
        .fetch_all(&state.pool)
        .await
        {
            Ok(gefunden) => ziele.extend(gefunden),
            Err(e) => tracing::warn!(
                einsatz_id,
                fehler = %e,
                "Bereitstellungsraum der Einheiten nicht lesbar, Live-Ereignis entfällt"
            ),
        }
    }
    ziele.sort_unstable();
    ziele.dedup();
    for br_id in ziele {
        sse_br(state, einsatz_id, br_id);
    }
}

/// [`sse_br_fuer`] für eine Einheit.
pub(super) async fn sse_br_der_einheit(state: &AppState, einsatz_id: i64, einheit_id: i64) {
    sse_br_fuer(state, einsatz_id, &[], &[einheit_id]).await;
}

// ---------- Detail-Helfer ----------

async fn lade_detail(state: &AppState, einsatz_id: i64, br_id: i64) -> Result<BrDetail, AppError> {
    let br = br_repo::laden(&state.pool, einsatz_id, br_id).await?;
    let letzte = belegung_repo::letztes_je_objekt(&state.pool, einsatz_id, Some(br_id)).await?;
    let seit = |typ: ObjektTyp, id: i64| {
        letzte
            .iter()
            .find(|l| l.objekt_typ == typ && l.objekt_id == id)
            .and_then(|l| l.seit_at().map(str::to_string))
    };
    let einheiten: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, name FROM einsatz_einheit \
         WHERE aktueller_br_id = ? AND einsatz_id = ? AND aufgeloest_at IS NULL",
    )
    .bind(br_id)
    .bind(einsatz_id)
    .fetch_all(&state.pool)
    .await?;
    // Fahrzeuge aller Einheiten im Raum in EINER Abfrage, im Speicher verteilt (D4).
    let einheit_fahrzeuge: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT f.einheit_id, f.id, f.snap_funkrufname FROM einsatz_fahrzeug f \
         WHERE f.einsatz_id = ?2 AND f.beendet_at IS NULL AND f.einheit_id IN ( \
             SELECT e.id FROM einsatz_einheit e \
             WHERE e.aktueller_br_id = ?1 AND e.einsatz_id = ?2 AND e.aufgeloest_at IS NULL) \
         ORDER BY f.snap_funkrufname, f.id",
    )
    .bind(br_id)
    .bind(einsatz_id)
    .fetch_all(&state.pool)
    .await?;
    let einheiten = einheiten
        .into_iter()
        .map(|(id, name)| BrEinheitKurz {
            id,
            name,
            seit_at: seit(ObjektTyp::Einheit, id),
            fahrzeuge: einheit_fahrzeuge
                .iter()
                .filter(|(einheit, _, _)| *einheit == id)
                .map(|(_, id, funkrufname)| BrEinheitFahrzeug {
                    id: *id,
                    funkrufname: funkrufname.clone(),
                })
                .collect(),
        })
        .collect();
    let fahrzeuge: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, snap_funkrufname FROM einsatz_fahrzeug \
         WHERE aktueller_br_id = ? AND einsatz_id = ? AND beendet_at IS NULL",
    )
    .bind(br_id)
    .bind(einsatz_id)
    .fetch_all(&state.pool)
    .await?;
    let fahrzeuge = fahrzeuge
        .into_iter()
        .map(|(id, funkrufname)| BrFahrzeugKurz {
            id,
            funkrufname,
            seit_at: seit(ObjektTyp::Fahrzeug, id),
        })
        .collect();
    let belegung =
        belegung_repo::kennzahlen_aus(&state.pool, einsatz_id, Some(br_id), &letzte).await?;
    Ok(BrDetail {
        br,
        einheiten,
        fahrzeuge,
        belegung: belegung.get(&br_id).cloned().unwrap_or_default(),
    })
}

// ============================== Routen ==============================

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub abschnitt_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/bereitstellungsraeume — Räume mit Abschnittsname, Kennzahlen der
/// Belegung und den Einheiten im Raum (LLH-1095). Eine feste Zahl Abfragen für alle Räume.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Bereitstellungsraeume>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<BrListenEintrag>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    parse_enum_opt(
        BrStatus::parse,
        params.status.as_deref(),
        "Unbekannter BR-Status im Filter",
    )?;
    let mut liste = br_repo::liste(
        &state.pool,
        einsatz_id,
        params.status.as_deref(),
        params.abschnitt_id,
    )
    .await?;
    // Stellenbindung (LFH-1042): ein BR-Gerät kennt nur seinen eigenen Raum, jedes andere Gerät
    // keinen.
    let sicht = stelle::sicht(ctx.geraet.as_ref(), Bindungsart::Bereitstellungsraum);
    liste.retain(|z| sicht.sieht(z.br.id));
    let mut kennzahlen = belegung_repo::kennzahlen_je_raum(&state.pool, einsatz_id, None).await?;
    let einheiten: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT aktueller_br_id, id FROM einsatz_einheit \
         WHERE einsatz_id = ? AND aktueller_br_id IS NOT NULL AND aufgeloest_at IS NULL \
         ORDER BY id",
    )
    .bind(einsatz_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        liste
            .into_iter()
            .map(|z| BrListenEintrag {
                belegung: kennzahlen.remove(&z.br.id).unwrap_or_default(),
                einheit_ids: einheiten
                    .iter()
                    .filter(|(raum, _)| *raum == z.br.id)
                    .map(|(_, id)| *id)
                    .collect(),
                abschnitt_name: z.abschnitt_name,
                br: z.br,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub bezeichnung: String,
    pub abschnitt_id: Option<i64>,
    pub standort: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/bereitstellungsraeume
/// KEIN ETB-Eintrag (erst Inbetriebnahme ist lagerelevant). SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Bereitstellungsraeume>,
    JsonBody(body): JsonBody<AnlegenBody>,
) -> Result<(StatusCode, Json<BrAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let bezeichnung = pflicht(&body.bezeichnung, "Bezeichnung")?;
    let standort = trimme(body.standort);
    let notiz = trimme(body.notiz);

    let br = br_repo::anlegen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        NeueDaten {
            bezeichnung: &bezeichnung,
            abschnitt_id: body.abschnitt_id,
            standort: standort.as_deref(),
            notiz: notiz.as_deref(),
        },
    )
    .await?;
    sse_br(&state, einsatz_id, br.id);
    Ok((StatusCode::CREATED, Json(br)))
}

/// GET /api/einsaetze/{id}/bereitstellungsraeume/{bid}
pub async fn detail(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Bereitstellungsraeume>,
    PfadParam((_eid, br_id)): PfadParam<(i64, i64)>,
) -> Result<Json<BrDetail>, AppError> {
    stelle::fordere_stelle(ctx.geraet.as_ref(), Bindungsart::Bereitstellungsraum, br_id)?;
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(lade_detail(&state, einsatz_id, br_id).await?))
}

/// GET /api/einsaetze/{id}/bereitstellungsraeume/{bid}/verlauf — Belegungsreihe des Raums,
/// ungeblättert, neueste zuerst (LLH-1095, design.md D5; Ausnahme von der Phasenregel in
/// `src/AGENTS.md`, „Antwortkompression und Phasenlisten“). Rechte wie das Detail; das BR-Gerät
/// liest nur den eigenen Raum (fremd 404). Auch ein stornierter oder aufgelöster Raum liefert
/// seine Reihe.
pub async fn verlauf(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Bereitstellungsraeume>,
    PfadParam((_eid, br_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<BrVerlaufEintrag>>, AppError> {
    stelle::fordere_stelle(ctx.geraet.as_ref(), Bindungsart::Bereitstellungsraum, br_id)?;
    let einsatz_id = ctx.einsatz.id;
    br_repo::laden(&state.pool, einsatz_id, br_id).await?;
    Ok(Json(
        belegung_repo::verlauf(&state.pool, einsatz_id, br_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub bezeichnung: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub abschnitt_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub standort: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/bereitstellungsraeume/{bid}
/// KEIN ETB-Eintrag. SSE.
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Bereitstellungsraeume>,
    PfadParam((_eid, br_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody>,
) -> Result<Json<BrAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let vorher = br_repo::laden(&state.pool, einsatz_id, br_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter BR kann nicht geändert werden".into(),
        ));
    }

    let bezeichnung = pflicht_tri(body.bezeichnung.as_deref(), "Bezeichnung")?;
    let standort = body
        .standort
        .map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let notiz = body
        .notiz
        .map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));

    let nachher = br_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        br_id,
        ctx.benutzer.id,
        PatchDaten {
            bezeichnung: bezeichnung.as_deref(),
            abschnitt_id: body.abschnitt_id,
            standort: standort.as_ref().map(|o| o.as_deref()),
            notiz: notiz.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_br(&state, einsatz_id, br_id);
    Ok(Json(nachher))
}

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: String,
}

/// POST /api/einsaetze/{id}/bereitstellungsraeume/{bid}/status
/// ETB-Spur bei → aktiv und → aufgeloest. SSE.
pub async fn status_wechsel(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Bereitstellungsraeume>,
    PfadParam((_eid, br_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<StatusBody>,
) -> Result<Json<BrAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let sicht = stelle::sicht(ctx.geraet.as_ref(), Bindungsart::Bereitstellungsraum);
    stelle::fordere_stelle(ctx.geraet.as_ref(), Bindungsart::Bereitstellungsraum, br_id)?;
    let status = parse_enum(BrStatus::parse, &body.status, "Unbekannter Status")?;
    // Ein BR-Gerät nimmt seinen Raum nur in Betrieb (LFH-1042); Auflösen bleibt bei der Leitung.
    if sicht != stelle::Sicht::Alle && status != BrStatus::Aktiv {
        return Err(AppError::Forbidden);
    }
    let vorher = br_repo::laden(&state.pool, einsatz_id, br_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter BR kann nicht geändert werden".into(),
        ));
    }
    // F06/LFH-244 Tier-A: Status-UPDATE + System-ETB-Eintrag atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der ETB-Text ist aus `vorher` berechenbar — die
    // Bezeichnung ändert sich beim Status-Wechsel nicht, daher kein In-Tx-Reload nötig.
    // darf_uebergehen/Belegungs-Vorbedingung prüft `setze_status_tx` in der Tx; SSE erst
    // nach dem Commit (Reinheits-Kontrakt).
    let etb_text = crate::bereitstellungsraum::etb_text_status(&vorher.bezeichnung, &body.status);
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let nachher = crate::write_retry!(&state.pool, |conn| {
        let nachher =
            br_repo::setze_status_tx(conn, einsatz_id, br_id, &body.status, ctx.benutzer.id)
                .await?;
        if let Some(text) = &etb_text {
            crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, text).await?;
        }
        Ok(nachher)
    })?;
    sse_br(&state, einsatz_id, br_id);
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/bereitstellungsraeume/{bid}
/// Soft-Delete. KEIN ETB. SSE.
pub async fn stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Bereitstellungsraeume>,
    PfadParam((_eid, br_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    br_repo::storniere(&state.pool, einsatz_id, br_id, ctx.benutzer.id).await?;
    sse_br(&state, einsatz_id, br_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct BelegungBody {
    pub objekt_typ: String,
    pub objekt_id: i64,
    pub art: String,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/bereitstellungsraeume/{bid}/belegung
/// ETB bei Eintritt/Austritt/Wechsel mit realen Namen. SSE.
pub async fn belegung(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Bereitstellungsraeume>,
    PfadParam((_eid, br_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<BelegungBody>,
) -> Result<(StatusCode, Json<BrBelegungAnzeige>), AppError> {
    // `{bid}` ist bei jeder Art der eigene Raum des Geräts (Ziel von Eintritt und Wechsel, Quelle
    // des Austritts); ein Wechsel hinaus trägt den fremden Raum und ist damit 404 (LFH-1042).
    stelle::fordere_stelle(ctx.geraet.as_ref(), Bindungsart::Bereitstellungsraum, br_id)?;
    let einsatz_id = ctx.einsatz.id;
    let notiz = trimme(body.notiz);

    let event = belegung_repo::belege(
        &state.pool,
        einsatz_id,
        br_id,
        &body.objekt_typ,
        body.objekt_id,
        &body.art,
        notiz.as_deref(),
        ctx.benutzer.id,
    )
    .await?;

    // ETB-Spur (nicht pseudonym): Objektname laden und ETB schreiben.
    let br = br_repo::laden(&state.pool, einsatz_id, br_id).await?;
    if let Some(etb_text) =
        belegungs_etb_text(&state.pool, einsatz_id, &br.bezeichnung, &event).await?
    {
        super::etb_system_degradiert(&state, einsatz_id, ctx.benutzer.id, &etb_text).await;
    }

    sse_br(&state, einsatz_id, br_id);
    // Kräfte-Ansichten (Einheiten/Fahrzeuge) live refetchen lassen: zusätzliches
    // objekt-typ-spezifisches SSE-Event (typisiert via `LiveEvent`, analog `person` in UHS).
    let objekt_event = match event.objekt_typ.as_str() {
        "einheit" => Some(LiveEvent::Einheit),
        "fahrzeug" => Some(LiveEvent::Fahrzeug),
        _ => None,
    };
    if let Some(ev) = objekt_event {
        let data = serde_json::json!({ "einsatz_id": einsatz_id, "objekt_id": event.objekt_id })
            .to_string();
        state.live.publiziere_event(einsatz_id, ev, data);
    }
    Ok((StatusCode::CREATED, Json(event)))
}

/// Erstellt den ETB-Text für ein Belegungs-Event mit realem Objektnamen.
async fn belegungs_etb_text(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
    br_bezeichnung: &str,
    event: &BrBelegungAnzeige,
) -> Result<Option<String>, AppError> {
    // `belege()` hat die Objekt-Existenz bereits geprüft; ein fehlender Name
    // wäre ein inkonsistenter Zustand → NotFound statt leerer ETB-Text.
    let obj_name = match event.objekt_typ.as_str() {
        "einheit" => sqlx::query_scalar::<_, String>(
            "SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
        )
        .bind(event.objekt_id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?,
        "fahrzeug" => sqlx::query_scalar::<_, String>(
            "SELECT snap_funkrufname FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
        )
        .bind(event.objekt_id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?,
        _ => return Ok(None),
    };

    let text = match event.art.as_str() {
        "eintritt" => format!(
            "{} tritt in Bereitstellungsraum {} ein",
            obj_name, br_bezeichnung
        ),
        "wechsel" => format!(
            "{} wechselt zu Bereitstellungsraum {}",
            obj_name, br_bezeichnung
        ),
        "austritt" => format!(
            "{} verlässt Bereitstellungsraum {}",
            obj_name, br_bezeichnung
        ),
        _ => return Ok(None),
    };
    Ok(Some(text))
}
