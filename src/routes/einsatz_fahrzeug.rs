use super::einsatz_personal::sse_personal;
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::{Einheiten, Fahrzeuge};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::fahrzeug::besatzung_repo;
use crate::fahrzeug::disposition_repo::{self, AdhocDaten, FahrzeugPatch};
use crate::fahrzeug::status_repo;
use crate::fahrzeug::EinsatzFahrzeugAnzeige;
use crate::fahrzeug::{ADHOC_TEXT_MAX, BEMERKUNG_MAX};
use crate::kraefte_disposition;
use crate::live::LiveEvent;
use crate::routes::support::{
    deserialize_optional_field, optional_max, optional_max_tri, parse_flag, pflicht_max,
    pruefe_koordinate,
};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): Fahrzeug-Disposition hat sich geändert.
pub(super) fn sse_fahrzeug(state: &AppState, einsatz_id: i64, ef_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Fahrzeug, "fahrzeug_id", ef_id);
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    /// `1` = statt der aktiven die entlassenen Fahrzeuge (LLH-1079, Nachweis).
    #[serde(default)]
    entlassene: Option<String>,
}

/// GET /api/einsaetze/{id}/fahrzeuge — aktive Fahrzeuge (aufgelöst), mit `?entlassene=1` die
/// entlassenen (Spec `kraefte-entlassung`). Stornierte liefert keine der beiden. Nur
/// Mitglieder/höhere Berechtigung.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Fahrzeuge>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<EinsatzFahrzeugAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let aktiv = ctx.einsatz.ist_aktiv();
    Ok(Json(
        if parse_flag(params.entlassene.as_deref(), "entlassene")? {
            disposition_repo::list_entlassene(&state.pool, einsatz_id, aktiv).await?
        } else {
            disposition_repo::liste(&state.pool, einsatz_id, aktiv).await?
        },
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub traegerorganisation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub fahrzeug_id: Option<i64>,
    pub adhoc: Option<AdhocBody>,
}

/// POST /api/einsaetze/{id}/fahrzeuge — Stamm-Fahrzeug disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag.
pub async fn disponieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    JsonBody(body): JsonBody<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzFahrzeugAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Validierung + Aufbereitung VOR der Tx (Vorladen/Guards bleiben außerhalb des Tx-Bodys).
    enum Vorbereitet {
        Stamm(i64),
        Adhoc {
            funkrufname: String,
            fahrzeugtyp: Option<String>,
            kennzeichen: Option<String>,
            opta: Option<String>,
            traegerorganisation: Option<String>,
        },
    }
    let vorbereitet = match (body.fahrzeug_id, body.adhoc) {
        (Some(fahrzeug_id), None) => Vorbereitet::Stamm(fahrzeug_id),
        // Grenzen (LLH-1073 design.md D8, `src/AGENTS.md`, „Eingabegrenzen“): 400 vor der
        // Transaktion; der Funkrufname geht unverändert ins ETB.
        (None, Some(adhoc)) => Vorbereitet::Adhoc {
            funkrufname: pflicht_max(&adhoc.funkrufname, "Funkrufname", ADHOC_TEXT_MAX)?,
            fahrzeugtyp: optional_max(adhoc.fahrzeugtyp, "Fahrzeugtyp", ADHOC_TEXT_MAX)?,
            kennzeichen: optional_max(adhoc.kennzeichen, "Kennzeichen", ADHOC_TEXT_MAX)?,
            opta: optional_max(adhoc.opta, "OPTA", ADHOC_TEXT_MAX)?,
            traegerorganisation: optional_max(
                adhoc.traegerorganisation,
                "Trägerorganisation",
                ADHOC_TEXT_MAX,
            )?,
        },
        (None, None) => {
            return Err(AppError::Validation(
                "Entweder fahrzeug_id (Stamm) oder adhoc angeben".into(),
            ))
        }
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "Entweder fahrzeug_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    // F06/LFH-244 Tier-A: Domänen-Write (Disposition) + System-ETB atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die aufgelöste Anzeige (funkrufname)
    // für ETB-Text UND Response. SSE erst nach dem Commit (Reinheits-Kontrakt).
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        let disponiert = match &vorbereitet {
            // Ein entlassenes oder storniertes Fahrzeug wird wieder aufgenommen (LLH-1079, D7).
            Vorbereitet::Stamm(fahrzeug_id) => {
                disposition_repo::disponiere_stamm_tx(
                    conn,
                    einsatz_id,
                    ctx.einsatz.org_id,
                    *fahrzeug_id,
                    ctx.benutzer.id,
                )
                .await?
            }
            Vorbereitet::Adhoc {
                funkrufname,
                fahrzeugtyp,
                kennzeichen,
                opta,
                traegerorganisation,
            } => disposition_repo::disponiere_adhoc_tx(
                conn,
                einsatz_id,
                ctx.einsatz.org_id,
                AdhocDaten {
                    funkrufname: funkrufname.as_str(),
                    fahrzeugtyp: fahrzeugtyp.as_deref(),
                    kennzeichen: kennzeichen.as_deref(),
                    opta: opta.as_deref(),
                    traegerorganisation: traegerorganisation.as_deref(),
                },
                ctx.benutzer.id,
            )
            .await
            .map(|id| crate::entlassung::Disponiert {
                id,
                reaktiviert: false,
            })?,
        };
        let anzeige =
            disposition_repo::load_anzeige_tx(conn, einsatz_id, disponiert.id, true).await?;
        let text = if disponiert.reaktiviert {
            crate::fahrzeug::etb_text_erneut_disponiert(&anzeige.funkrufname)
        } else {
            crate::fahrzeug::etb_text_disponiert(&anzeige.funkrufname)
        };
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await?;
        Ok(anzeige)
    })?;
    sse_fahrzeug(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
/// Body der Fahrzeug-Sammelroute. `fahrzeug_ids` sind Stamm-IDs (`fahrzeug.id`), anders als
/// `fahrzeug_id` im Personal-Body (`routes::einsatz_personal::SammelBody`), der die
/// Einsatzzeile meint.
pub struct SammelBody {
    /// Stamm-IDs (`fahrzeug.id`), höchstens `kraefte_disposition::SAMMEL_MAX` vor dem Entdoppeln.
    pub fahrzeug_ids: Vec<i64>,
    /// Ziel-Einheit (`einsatz_einheit.id`).
    pub einheit_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/fahrzeuge/sammel — mehrere Stamm-Fahrzeuge in einem Schritt
/// disponieren und optional einer Einheit zuordnen (LLH-1100, Spec `kraefte-disposition`). Alles
/// oder nichts wie beim Personal (422 mit Gründen je Zeile); mit Einheit gilt auch das Recht am
/// Modul Einheiten. Keine Zeitachse (D6). Ein ETB-Sammeleintrag in der Transaktion, Ereignisse
/// nach dem Commit. Liefert die disponierten Fahrzeuge.
pub async fn sammel_disponieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    JsonBody(body): JsonBody<SammelBody>,
) -> Result<(StatusCode, Json<Vec<EinsatzFahrzeugAnzeige>>), AppError> {
    if body.einheit_id.is_some() {
        ctx.fordere_zielmodul::<Einheiten>(&state.pool).await?;
    }
    let ids = kraefte_disposition::check_ids(&body.fahrzeug_ids)?;
    let einsatz_id = ctx.einsatz.id;
    let kontext = kraefte_disposition::Kontext {
        einsatz_id,
        org_id: ctx.einsatz.org_id,
        benutzer_id: ctx.benutzer.id,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (ergebnis, etb_id, anzeigen) = crate::write_retry!(&state.pool, |conn| {
        let ergebnis =
            kraefte_disposition::disponiere_fahrzeuge_tx(conn, kontext, &ids, body.einheit_id)
                .await?;
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &kraefte_disposition::etb_text_fahrzeuge(&ergebnis),
        )
        .await?;
        let mut anzeigen = Vec::with_capacity(ergebnis.fahrzeuge.len());
        for f in &ergebnis.fahrzeuge {
            anzeigen
                .push(disposition_repo::load_anzeige_tx(conn, einsatz_id, f.ef_id, true).await?);
        }
        Ok((ergebnis, etb_id, anzeigen))
    })?;
    // Das ETB-Ereignis gehört dazu: die Modul-Ereignisse frischen das Einsatztagebuch nicht auf.
    state.live.publiziere(einsatz_id, etb_id);
    for f in &ergebnis.fahrzeuge {
        sse_fahrzeug(&state, einsatz_id, f.ef_id);
    }
    if let Some(e) = &ergebnis.einheit {
        super::einsatz_einheit::sse_einheit(&state, einsatz_id, e.id);
    }
    Ok((StatusCode::CREATED, Json(anzeigen)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub status_id: Option<i64>,
    /// Tri-State (F12-c/LFH-266): fehlend = unverändert, `null`/`""` = leeren, Wert = setzen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
    /// Ad-hoc-Angaben (LLH-1073, design.md D1), symmetrisch zum Ad-hoc-Body; an einem
    /// Stamm-Fahrzeug 422. `funkrufname` ist Pflicht: `null` oder leer → 400.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub funkrufname: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub fahrzeugtyp: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kennzeichen: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub traegerorganisation: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub opta: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id} — Status, Bemerkung und bei Ad-hoc-Fahrzeugen
/// Funkrufname, Typ, Kennzeichen, Träger und OPTA (LLH-1073). Ein Statuswechsel schreibt einen
/// ETB-Eintrag, geänderte Angaben zusammen einen weiteren; die Bemerkung keinen. Reihenfolge:
/// 400 (Feld) → 404 (Zeile) → 409 (beendet) → 422 (Angaben an einem Stamm-Fahrzeug).
pub async fn update(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<DispoPatchBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Status muss (aktiv) zur Org gehören.
    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, ctx.einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }

    // Bemerkung ist Tri-State (F12-c/LFH-266): absent = unverändert, `null` oder ""/Whitespace
    // = leeren (Spalte auf NULL), Wert = setzen. Das Trimmen/Leer-Kollabieren und die Grenzen
    // (LLH-1073 design.md D8) prüft die Route vor jedem Zusammenhang, das Repo bleibt dumm.
    let bemerkung = optional_max_tri(body.bemerkung, "Bemerkung", BEMERKUNG_MAX)?;
    let funkrufname = body
        .funkrufname
        .map(|f| pflicht_max(f.as_deref().unwrap_or(""), "Funkrufname", ADHOC_TEXT_MAX))
        .transpose()?;
    let fahrzeugtyp = optional_max_tri(body.fahrzeugtyp, "Fahrzeugtyp", ADHOC_TEXT_MAX)?;
    let kennzeichen = optional_max_tri(body.kennzeichen, "Kennzeichen", ADHOC_TEXT_MAX)?;
    let traeger = optional_max_tri(
        body.traegerorganisation,
        "Trägerorganisation",
        ADHOC_TEXT_MAX,
    )?;
    let opta = optional_max_tri(body.opta, "OPTA", ADHOC_TEXT_MAX)?;
    fn tri(w: &Option<Option<String>>) -> Option<Option<&str>> {
        w.as_ref().map(|o| o.as_deref())
    }
    let patch = FahrzeugPatch {
        status_id: body.status_id,
        bemerkung: tri(&bemerkung),
        funkrufname: funkrufname.as_deref(),
        fahrzeugtyp: tri(&fahrzeugtyp),
        kennzeichen: tri(&kennzeichen),
        traegerorganisation: tri(&traeger),
        opta: tri(&opta),
    };

    // F06/LFH-244 Tier-A: Update + (bedingter) System-ETB atomar in EINER Tx. Der ETB-Text
    // braucht die frische Anzeige (neues Status-Label) → In-Tx-Reload. Auch den Vorzustand
    // (status_id/-label) liest die Tx selbst, sonst verschluckte ein paralleler Wechsel zurück
    // auf den alten Status ETB, Zeitachse und Ereignis. SSE erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    let (vorher, nachher, beruehrt, traegt_fuehrungsstelle) =
        crate::write_retry!(&state.pool, |conn| {
            let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
            disposition_repo::update_tx(conn, einsatz_id, ef_id, patch).await?;
            let nachher = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
            let mut beruehrt = Vec::new();
            if vorher.status_id != nachher.status_id {
                // LFH-552: ein markierter Status wirkt über die Einheit des Fahrzeugs auf deren
                // Zeitachse (erstes Fahrzeug bzw. alle für die Entlassung) und per Fan-out auf die
                // ihrer Personen; deren Leser erreicht nach dem Commit `personal`.
                if let Some(sid) = nachher.status_id {
                    if let Some((_, b)) = crate::zeitachse::repo::aus_fahrzeugstatus_tx(
                        conn,
                        einsatz_id,
                        ctx.benutzer.id,
                        ef_id,
                        sid,
                        &jetzt,
                    )
                    .await?
                    {
                        beruehrt = b.personen;
                    }
                }
                crate::etb::system_audit_tx(
                    conn,
                    einsatz_id,
                    ctx.benutzer.id,
                    startwert,
                    &crate::fahrzeug::etb_text_status_wechsel(
                        &nachher.funkrufname,
                        vorher.status_label.as_deref(),
                        nachher.status_label.as_deref(),
                    ),
                )
                .await?;
            }
            // LLH-1073, design.md D1: ein Eintrag für alle geänderten Ad-hoc-Angaben.
            let angaben_text = crate::fahrzeug::etb_text_angaben(&vorher, &nachher);
            let mut traegt_fuehrungsstelle = false;
            if let Some(text) = angaben_text {
                crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text)
                    .await?;
                traegt_fuehrungsstelle =
                    crate::einsatz::fuehrungsstelle::traegt_fahrzeug_tx(conn, ef_id).await?;
            }
            Ok((vorher, nachher, beruehrt, traegt_fuehrungsstelle))
        })?;
    let has_status_changed = vorher.status_id != nachher.status_id;
    let has_angaben_changed = vorher.funkrufname != nachher.funkrufname
        || vorher.fahrzeugtyp != nachher.fahrzeugtyp
        || vorher.kennzeichen != nachher.kennzeichen
        || vorher.traegerorganisation != nachher.traegerorganisation
        || vorher.opta != nachher.opta;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    // Die Einheit zeigt den Status ihrer Fahrzeuge und leitet ihren eigenen daraus ab (LFH-609),
    // dazu Funkrufname und Typ (LLH-1073); `fahrzeug` erreicht ihre Leser ohne Fahrzeugrecht
    // nicht (LLH-1182). Ebenso das Detail des Bereitstellungsraums und die Führungsstelle im
    // Kopf, die den Funkrufnamen zeigen.
    if has_status_changed || has_angaben_changed {
        if let Some(einheit_id) = nachher.einheit_id {
            super::einsatz_einheit::sse_einheit(&state, einsatz_id, einheit_id);
        }
    }
    if has_angaben_changed {
        if let Some(br_id) = nachher.aktueller_br_id {
            super::einsatz_bereitstellungsraum::sse_br(&state, einsatz_id, br_id);
        }
        if traegt_fuehrungsstelle {
            crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
        }
    }
    // Der Fan-out hat die Zeitachse dieser Personen geschrieben; ihre Leser mit nur
    // Personalrecht erreicht weder `fahrzeug` noch `einheit` (LLH-1185).
    for ep_id in beruehrt {
        sse_personal(&state, einsatz_id, ep_id);
    }
    Ok(Json(nachher))
}

/// POST /api/einsaetze/{id}/fahrzeuge/{ef_id}/entlassen — aus dem Einsatz entlassen (LLH-1079,
/// Spec `kraefte-entlassung`): die Zeile bleibt, Besatzung, Einheit, Bereitstellungsraum und
/// Führungsstelle gehen, Auftragsempfänger bleiben. Ohne Rückfrage, der Rückweg ist
/// `…/reaktivieren`. Schreibt ETB-Eintrag; ein beendetes Fahrzeug → 409. Liefert das entlassene
/// Fahrzeug.
pub async fn entlassen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    // F06/LFH-244 Tier-A: Bindungen lösen, Austritt, Endzustand und System-ETB atomar in EINER
    // Tx. Was das Fahrzeug außerhalb des Fahrzeugmoduls trug, liefert `entlassen_tx`; SSE erst
    // nach dem Commit.
    let (ergebnis, anzeige) = crate::write_retry!(&state.pool, |conn| {
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        let ergebnis =
            disposition_repo::entlassen_tx(conn, einsatz_id, ef_id, ctx.benutzer.id, &jetzt)
                .await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::fahrzeug::etb_text_entlassen(
                &vorher.funkrufname,
                ergebnis.einheit.as_ref().map(|(_, name)| name.as_str()),
            ),
        )
        .await?;
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        Ok((ergebnis, anzeige))
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    // Die Zuordnung an der Führungsstelle ist gelöscht (LFH-1106): deren Leser hängen am
    // Ereignis `einsatz`. `fahrzeug` erreicht Einheiten- und Personalleser ohne Fahrzeugrecht
    // nicht: die Einheit verliert ein Mitglied, die Besatzung ihr Fahrzeug. Das Detail des
    // Bereitstellungsraums listet seine Fahrzeuge und hängt nur an `bereitstellungsraum`
    // (LLH-1182).
    if ergebnis.trug_fuehrungsstelle {
        crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    }
    if let Some(br_id) = ergebnis.br_id {
        super::einsatz_bereitstellungsraum::sse_br(&state, einsatz_id, br_id);
    }
    if let Some((einheit_id, _)) = ergebnis.einheit {
        super::einsatz_einheit::sse_einheit(&state, einsatz_id, einheit_id);
    }
    for ep_id in ergebnis.besatzung {
        sse_personal(&state, einsatz_id, ep_id);
    }
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/fahrzeuge/{ef_id}/stornieren — Fehldisposition stornieren (LLH-1079,
/// design.md D3): nur mit unverändertem Status, ohne Bindung und Spur und in den ersten
/// 15 Minuten, sonst 422 mit dem Grund; ein beendetes Fahrzeug → 409. ETB-Eintrag.
pub async fn stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    crate::write_retry!(&state.pool, |conn| {
        disposition_repo::require_aktiv_tx(conn, einsatz_id, ef_id).await?;
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        disposition_repo::stornieren_tx(conn, einsatz_id, ef_id, ctx.benutzer.id, &jetzt).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::fahrzeug::etb_text_storniert(&vorher.funkrufname),
        )
        .await?;
        Ok(())
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/einsaetze/{id}/fahrzeuge/{ef_id}/reaktivieren — ein entlassenes oder storniertes
/// Fahrzeug erneut disponieren (LLH-1079, design.md D7): Block „Entlassen“ (auch für Ad-hoc) und
/// Rückgängig nach dem Entlassen. Initialstatus neu. Aktiv → 409. ETB-Eintrag.
pub async fn reaktivieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        disposition_repo::reaktivieren_tx(
            conn,
            einsatz_id,
            ctx.einsatz.org_id,
            ef_id,
            ctx.benutzer.id,
        )
        .await?;
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::fahrzeug::etb_text_erneut_disponiert(&anzeige.funkrufname),
        )
        .await?;
        Ok(anzeige)
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(Json(anzeige))
}

/// PUT /api/einsaetze/{id}/fahrzeuge/{ef_id}/besatzung/{ep_id} — Kraft als Besatzung
/// zuordnen (LFH-9, exklusiv: Wechsel überschreibt). Append-only System-ETB + SSE.
pub async fn besatzung_zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Vorladen: aufgelöste Fahrzeug-Anzeige für den ETB-Text (funkrufname ist über die
    // Besatzungs-Zuordnung stabil). F06/LFH-244 Tier-A: Zuordnung + System-ETB atomar in EINER Tx.
    let fahrzeug =
        disposition_repo::load_anzeige(&state.pool, einsatz_id, ef_id, ctx.einsatz.ist_aktiv())
            .await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let person = besatzung_repo::ordne_besatzung_zu_tx(conn, einsatz_id, ef_id, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::fahrzeug::etb_text_besatzung_zugeordnet(&fahrzeug.funkrufname, &[person]),
        )
        .await?;
        Ok(())
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

/// Body von `POST …/fahrzeuge/{ef_id}/besatzung` (LLH-1073 D12).
#[derive(Debug, Deserialize)]
pub struct BesatzungBody {
    /// Personen des Einsatzes (`einsatz_personal.id`); höchstens `SAMMEL_MAX`, entdoppelt.
    pub ep_ids: Vec<i64>,
}

/// Die Personenliste beim Übernehmen: leer oder mehr als `SAMMEL_MAX` (gezählt vor dem
/// Entdoppeln) → 400 vor jeder Abfrage (`src/AGENTS.md`, „Eingabegrenzen“).
fn check_ep_ids(ids: &[i64]) -> Result<Vec<i64>, AppError> {
    let max = crate::kraefte_disposition::SAMMEL_MAX;
    if ids.is_empty() {
        return Err(AppError::Validation("Mindestens eine Person wählen".into()));
    }
    if ids.len() > max {
        return Err(AppError::Validation(format!(
            "Höchstens {max} Personen je Besatzung"
        )));
    }
    Ok(crate::kraefte_disposition::dedupe(ids, |id| *id))
}

/// POST /api/einsaetze/{id}/fahrzeuge/{ef_id}/besatzung — mehrere Personen in einem Schritt als
/// Besatzung zuordnen („Personal der Einheit übernehmen“, LLH-1073, design.md D12). Alles oder
/// nichts: Fahrzeug beendet → 409, unbekannt → 404; Vorprüfung der Personen in einer Abfrage
/// (unbekannt oder fremd, beendet → 422 mit Grund je Person), dann ein UPDATE. Additiv und
/// exklusiv wie der Einzelweg. Genau ein ETB-Eintrag für alle, die neu aufsitzen; wer schon auf
/// dem Fahrzeug sitzt, ändert nichts. Ereignisse für das Ziel, jedes verlassene Fahrzeug und jede
/// Person.
pub async fn besatzung_uebernehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<BesatzungBody>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ep_ids = check_ep_ids(&body.ep_ids)?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (neu, etb_id) = crate::write_retry!(&state.pool, |conn| {
        let fahrzeug = disposition_repo::load_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        disposition_repo::require_aktiv_tx(conn, einsatz_id, ef_id).await?;
        let personen = besatzung_repo::check_besatzung_menge_tx(conn, einsatz_id, &ep_ids).await?;
        let neu: Vec<besatzung_repo::PersonDerMenge> = personen
            .into_iter()
            .filter(|p| p.vorher != Some(ef_id))
            .collect();
        if neu.is_empty() {
            return Ok((neu, None));
        }
        let ids: Vec<i64> = neu.iter().map(|p| p.ep_id).collect();
        besatzung_repo::zuordnen_besatzung_menge_tx(conn, einsatz_id, ef_id, &ids).await?;
        let namen: Vec<String> = neu.iter().map(|p| p.name.clone()).collect();
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::fahrzeug::etb_text_besatzung_zugeordnet(&fahrzeug.funkrufname, &namen),
        )
        .await?;
        Ok((neu, Some(etb_id)))
    })?;
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
        sse_fahrzeug(&state, einsatz_id, ef_id);
    }
    let mut verlassen: Vec<i64> = neu.iter().filter_map(|p| p.vorher).collect();
    verlassen.sort_unstable();
    verlassen.dedup();
    for alt in verlassen {
        sse_fahrzeug(&state, einsatz_id, alt);
    }
    for p in &neu {
        sse_personal(&state, einsatz_id, p.ep_id);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/einsaetze/{id}/fahrzeuge/{ef_id}/besatzung/{ep_id} — Kraft aus der
/// Fahrzeug-Besatzung freigeben (LFH-9). Append-only System-ETB + SSE.
pub async fn besatzung_freigeben(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Vorladen: aufgelöste Fahrzeug-Anzeige für den ETB-Text (funkrufname ist über die
    // Besatzungs-Freigabe stabil). F06/LFH-244 Tier-A: Freigabe + System-ETB atomar in EINER Tx.
    let fahrzeug =
        disposition_repo::load_anzeige(&state.pool, einsatz_id, ef_id, ctx.einsatz.ist_aktiv())
            .await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let person = besatzung_repo::gib_besatzung_frei_tx(conn, einsatz_id, ef_id, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &format!(
                "Fahrzeug «{}»: «{}» aus der Besatzung freigegeben",
                fahrzeug.funkrufname, person
            ),
        )
        .await?;
        Ok(())
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct PositionBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lon: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_organisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id}/position — reine Lage-Pflege, KEIN ETB.
pub async fn position(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PositionBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Effektivzustand für die Paar-Validierung: vorhandene lat/lon (404 falls fremd).
    let vorher: (Option<f64>, Option<f64>) =
        sqlx::query_as("SELECT lat, lon FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?")
            .bind(ef_id)
            .bind(einsatz_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    let eff_lat = body.lat.unwrap_or(vorher.0);
    let eff_lon = body.lon.unwrap_or(vorher.1);
    pruefe_koordinate(eff_lat, eff_lon, "lat", "lon")?;

    let nachher = disposition_repo::update_position(
        &state.pool,
        einsatz_id,
        ef_id,
        disposition_repo::PositionPatch {
            lat: body.lat,
            lon: body.lon,
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
        ctx.einsatz.ist_aktiv(),
    )
    .await?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(Json(nachher))
}
