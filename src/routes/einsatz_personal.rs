use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::{Einheiten, Fahrzeuge, Lagekarte, Personal};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::kraefte_disposition;
use crate::live::LiveEvent;
use crate::personal::disposition_repo::{self, AdhocDaten};
use crate::personal::status_repo;
use crate::personal::{EinsatzPersonalAnzeige, FuehrungskraftKarte};
use crate::routes::support::{
    deserialize_optional_field, parse_enum, parse_flag, pflicht, pruefe_koordinate, trimme,
    trimme_tri,
};
use crate::staerke::StaerkePosition;
use crate::zeitachse::repo as zeitachse_repo;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify: die Disposition einer Einsatzkraft hat sich geändert (Tag `personal`).
/// Eigenes Tag seit F01/LFH-227: `person` trägt BETROFFENE Personen (Modul `personen`),
/// hier geht es um disponiertes Personal (Modul `personal`) — die ID-Räume sind disjunkt,
/// und nur getrennte Tags lassen sich getrennt gaten.
pub(super) fn sse_personal(state: &AppState, einsatz_id: i64, ep_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Personal, "personal_id", ep_id);
}

/// Validiert eine optionale Stärke-Position gegen das Enum (leer/None erlaubt).
fn pruefe_position(p: &Option<String>) -> Result<(), AppError> {
    if let Some(s) = p.as_deref() {
        parse_enum(StaerkePosition::parse, s, "Ungültige Stärke-Position")?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    /// `1` = statt der aktiven die entlassenen Kräfte (LLH-1079, Nachweis).
    #[serde(default)]
    entlassene: Option<String>,
}

/// GET /api/einsaetze/{id}/personal — aktives Personal (aufgelöst), mit `?entlassene=1` das
/// entlassene (Spec `kraefte-entlassung`). Stornierte liefert keine der beiden. Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personal>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<EinsatzPersonalAnzeige>>, AppError> {
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
    pub name: String,
    pub funktion: Option<String>,
    pub traegerorganisation: Option<String>,
    pub staerke_position: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub personal_id: Option<i64>,
    pub staerke_position: Option<String>,
    pub adhoc: Option<AdhocBody>,
}

/// POST /api/einsaetze/{id}/personal — Stamm-Person disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag.
pub async fn disponieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    JsonBody(body): JsonBody<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzPersonalAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Validierung + Aufbereitung VOR der Tx (der Tx-Body kann wiederholt laufen).
    enum Vorbereitet {
        Stamm(i64),
        Adhoc {
            name: String,
            funktion: Option<String>,
            traeger: Option<String>,
            position: Option<String>,
        },
    }
    let vorbereitet = match (body.personal_id, body.adhoc) {
        (Some(personal_id), None) => {
            pruefe_position(&body.staerke_position)?;
            Vorbereitet::Stamm(personal_id)
        }
        (None, Some(adhoc)) => {
            let name = pflicht(&adhoc.name, "Name")?;
            pruefe_position(&adhoc.staerke_position)?;
            Vorbereitet::Adhoc {
                name,
                funktion: trimme(adhoc.funktion),
                traeger: trimme(adhoc.traegerorganisation),
                position: trimme(adhoc.staerke_position),
            }
        }
        (None, None) => {
            return Err(AppError::Validation(
                "Entweder personal_id (Stamm) oder adhoc angeben".into(),
            ))
        }
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "Entweder personal_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    // LFH-552: Disposition und die Zeitachse des Initialstatus (Marke) in EINER Tx. Eine Stamm-
    // Person läuft über den Baustein der Sammel-Disposition (LLH-1100) mit einer ID; eine
    // entlassene wird dabei wieder aufgenommen (LLH-1079, design.md D7), die Fehler bleiben die
    // des Einzelwegs (`als_einzelfehler`).
    let kontext = kraefte_disposition::Kontext {
        einsatz_id,
        org_id: ctx.einsatz.org_id,
        benutzer_id: ctx.benutzer.id,
    };
    let disponiert = crate::write_retry!(&state.pool, |conn| {
        let disponiert = match &vorbereitet {
            Vorbereitet::Stamm(personal_id) => {
                let wahl = [kraefte_disposition::PersonalWahl {
                    personal_id: *personal_id,
                    staerke_position: body.staerke_position.clone(),
                }];
                let ergebnis = kraefte_disposition::disponiere_personal_tx(
                    conn,
                    kontext,
                    &wahl,
                    kraefte_disposition::Ziel::default(),
                    kraefte_disposition::Regeln::EINZEL,
                )
                .await
                .map_err(kraefte_disposition::als_einzelfehler)?;
                let kraft = &ergebnis.kraefte[0];
                disposition_repo::Disponiert {
                    id: kraft.ep_id,
                    reaktiviert: kraft.reaktiviert,
                }
            }
            Vorbereitet::Adhoc {
                name,
                funktion,
                traeger,
                position,
            } => {
                let id = disposition_repo::disponieren_adhoc_tx(
                    conn,
                    einsatz_id,
                    ctx.einsatz.org_id,
                    AdhocDaten {
                        name,
                        funktion: funktion.as_deref(),
                        traegerorganisation: traeger.as_deref(),
                        staerke_position: position.as_deref(),
                    },
                    ctx.benutzer.id,
                )
                .await?;
                disposition_repo::start_zeitachse_tx(conn, einsatz_id, ctx.benutzer.id, id).await?;
                disposition_repo::Disponiert {
                    id,
                    reaktiviert: false,
                }
            }
        };
        Ok(disponiert)
    })?;
    let ep_id = disponiert.id;

    let anzeige = disposition_repo::load_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    let text = if disponiert.reaktiviert {
        crate::personal::etb_text_erneut_disponiert(&anzeige.name, anzeige.funktion.as_deref())
    } else {
        crate::personal::etb_text_disponiert(&anzeige.name, anzeige.funktion.as_deref())
    };
    super::etb_system_degradiert(&state, einsatz_id, ctx.benutzer.id, &text).await;
    sse_personal(&state, einsatz_id, ep_id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct SammelBody {
    /// Stamm-IDs, höchstens `kraefte_disposition::SAMMEL_MAX` (vor dem Entdoppeln).
    pub personal_ids: Vec<i64>,
    pub einheit_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/personal/sammel — mehrere Stamm-Personen in einem Schritt
/// disponieren und optional Einheit und Fahrzeug zuordnen (LLH-1100, Spec
/// `kraefte-disposition`). Alles oder nichts: eine nicht disponierbare Person → 422 mit Gründen
/// je Zeile. Mit Einheit gilt auch das Recht am Modul Einheiten, mit Fahrzeug das am Modul
/// Fahrzeuge (403 vor jedem Schreiben). Genau ein ETB-Sammeleintrag in der Transaktion,
/// Ereignisse nach dem Commit. Liefert die disponierten Kräfte.
pub async fn sammel_disponieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    JsonBody(body): JsonBody<SammelBody>,
) -> Result<(StatusCode, Json<Vec<EinsatzPersonalAnzeige>>), AppError> {
    if body.einheit_id.is_some() {
        ctx.fordere_zielmodul::<Einheiten>(&state.pool).await?;
    }
    if body.fahrzeug_id.is_some() {
        ctx.fordere_zielmodul::<Fahrzeuge>(&state.pool).await?;
    }
    let wahl: Vec<kraefte_disposition::PersonalWahl> =
        kraefte_disposition::check_ids(&body.personal_ids)?
            .into_iter()
            .map(|personal_id| kraefte_disposition::PersonalWahl {
                personal_id,
                staerke_position: None,
            })
            .collect();
    let einsatz_id = ctx.einsatz.id;
    let kontext = kraefte_disposition::Kontext {
        einsatz_id,
        org_id: ctx.einsatz.org_id,
        benutzer_id: ctx.benutzer.id,
    };
    let ziel = kraefte_disposition::Ziel {
        einheit_id: body.einheit_id,
        fahrzeug_id: body.fahrzeug_id,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (ergebnis, etb_id, anzeigen) = crate::write_retry!(&state.pool, |conn| {
        let ergebnis = kraefte_disposition::disponiere_personal_tx(
            conn,
            kontext,
            &wahl,
            ziel,
            kraefte_disposition::Regeln::SAMMEL,
        )
        .await?;
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &kraefte_disposition::etb_text_personal(&ergebnis),
        )
        .await?;
        let mut anzeigen = Vec::with_capacity(ergebnis.kraefte.len());
        for k in &ergebnis.kraefte {
            anzeigen
                .push(disposition_repo::load_anzeige_tx(conn, einsatz_id, k.ep_id, true).await?);
        }
        Ok((ergebnis, etb_id, anzeigen))
    })?;
    // Das ETB-Ereignis gehört dazu: die Modul-Ereignisse frischen das Einsatztagebuch nicht auf.
    state.live.publiziere(einsatz_id, etb_id);
    for k in &ergebnis.kraefte {
        sse_personal(&state, einsatz_id, k.ep_id);
    }
    if let Some(e) = &ergebnis.einheit {
        super::einsatz_einheit::sse_einheit(&state, einsatz_id, e.id);
    }
    if let Some(f) = &ergebnis.fahrzeug {
        super::einsatz_fahrzeug::sse_fahrzeug(&state, einsatz_id, f.id);
    }
    Ok((StatusCode::CREATED, Json(anzeigen)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub status_id: Option<i64>,
    /// Tri-State (LFH-4): fehlend = unverändert, `null` = Override entfernen, Wert = setzen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub staerke_position: Option<Option<String>>,
    /// Tri-State (F12-c/LFH-266): fehlend = unverändert, `null`/`""` = leeren, Wert = setzen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/personal/{ep_id} — Status, Stärke-Position und/oder Bemerkung.
/// Status-Wechsel schreibt ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    PfadParam((_eid, ep_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<DispoPatchBody>,
) -> Result<Json<EinsatzPersonalAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, ctx.einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }
    // staerke_position ist Tri-State; nur ein konkret gesetzter Wert wird validiert.
    if let Some(Some(pos)) = &body.staerke_position {
        parse_enum(StaerkePosition::parse, pos, "Ungültige Stärke-Position")?;
    }

    // Bemerkung ist Tri-State (F12-c/LFH-266): absent = unverändert, `null` oder ""/Whitespace
    // = leeren (Spalte auf NULL), Wert = setzen. Das Trimmen/Leer-Kollabieren passiert hier in
    // der Route, das Repo bleibt dumm — wie bei `staerke_position`.
    let bemerkung = trimme_tri(body.bemerkung);
    let bemerkung = bemerkung.as_ref().map(|o| o.as_deref());
    let staerke_position = body.staerke_position.as_ref().map(|o| o.as_deref());

    // F06/LFH-244 Tier-A: Dispo-UPDATE + (nur bei Statuswechsel) System-ETB-Eintrag atomar in
    // EINER Tx (BEGIN IMMEDIATE + Retry). Vor- und Nachzustand liest die Tx selbst; der Reload
    // liefert die frische, aufgelöste Anzeige für den ETB-Text UND die Response; SSE erst nach
    // dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    let (vorher, nachher) = crate::write_retry!(&state.pool, |conn| {
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
        disposition_repo::update_tx(
            conn,
            einsatz_id,
            ep_id,
            body.status_id,
            staerke_position,
            bemerkung,
        )
        .await?;
        let nachher = disposition_repo::load_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
        if vorher.status_id != nachher.status_id {
            // LFH-552: ein markierter Status schreibt die Zeitachse mit; ein Verstoß gegen die
            // Perioden-Regeln wird verschluckt, der Statuswechsel gelingt immer.
            if let Some(sid) = nachher.status_id {
                zeitachse_repo::aus_personalstatus_tx(
                    conn,
                    einsatz_id,
                    ctx.benutzer.id,
                    ep_id,
                    sid,
                    &jetzt,
                )
                .await?;
            }
            let alt = vorher.status_label.as_deref().unwrap_or("—");
            let neu = nachher.status_label.as_deref().unwrap_or("—");
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                ctx.benutzer.id,
                startwert,
                &format!("Person «{}»: Status «{}» → «{}»", nachher.name, alt, neu),
            )
            .await?;
        }
        Ok((vorher, nachher))
    })?;
    sse_personal(&state, einsatz_id, ep_id);
    // Die wirksame Stärke-Position zeigt die Mitgliederliste der Einheit, und die UHS zählt ihre
    // Kräfte nach ihr (LFH-1045); `personal` erreicht deren Leser ohne Personalrecht nicht
    // (LLH-1182). Status und Bemerkung zeigen beide Ansichten nicht.
    if vorher.staerke_position != nachher.staerke_position {
        if let Some(einheit_id) = nachher.einheit_id {
            super::einsatz_einheit::sse_einheit(&state, einsatz_id, einheit_id);
        }
        if let Some(uhs_id) = nachher.uhs_id {
            super::einsatz_uhs::sse_uhs(&state, einsatz_id, uhs_id);
        }
    }
    Ok(Json(nachher))
}

/// POST /api/einsaetze/{id}/personal/{ep_id}/entlassen — aus dem Einsatz entlassen (LLH-1079,
/// Spec `kraefte-entlassung`): die Zeile bleibt, Bindungen gehen, Historie bleibt, die
/// Zeitachse bekommt die Entlassung. Ohne Rückfrage, der Rückweg ist `…/reaktivieren`.
/// Schreibt ETB-Eintrag; eine beendete Kraft → 409. Liefert die entlassene Kraft.
pub async fn entlassen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    PfadParam((_eid, ep_id)): PfadParam<(i64, i64)>,
) -> Result<Json<EinsatzPersonalAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    // F06/LFH-244 Tier-A: Bindungen lösen, Endzustand, Zeitachse und System-ETB atomar in EINER
    // Tx. Was die Person außerhalb des Personalmoduls trug, fragt die Tx vor dem Lösen; SSE erst
    // nach dem Commit.
    let (betroffen, anzeige) = crate::write_retry!(&state.pool, |conn| {
        disposition_repo::require_aktiv_tx(conn, einsatz_id, ep_id).await?;
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
        let betroffen = EntlassenBetroffen {
            einsatzleiter: crate::einsatz::fuehrungsstelle::is_einsatzleiter_tx(
                conn, einsatz_id, ep_id,
            )
            .await?,
            stab: crate::stab::repo::is_besetzt_tx(conn, einsatz_id, ep_id).await?,
            einheiten: crate::einheit::mitglied_repo::load_betroffene_einheiten_tx(
                conn, einsatz_id, ep_id,
            )
            .await?,
            abschnitte: crate::einsatzabschnitt::repo::load_geleitete_abschnitte_tx(
                conn, einsatz_id, ep_id,
            )
            .await?,
            uhs: crate::uhs::kraefte::uhs_der_kraft_tx(conn, einsatz_id, ep_id).await?,
            fahrzeug: vorher.fahrzeug_id,
        };
        let ergebnis =
            disposition_repo::entlassen_tx(conn, einsatz_id, ep_id, ctx.benutzer.id, &jetzt)
                .await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::personal::etb_text_entlassen(
                &vorher.name,
                vorher.funktion.as_deref(),
                ergebnis.einheit_name.as_deref(),
            ),
        )
        .await?;
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
        Ok((betroffen, anzeige))
    })?;
    sse_personal(&state, einsatz_id, ep_id);
    notify_betroffene(&state, einsatz_id, &betroffen).await;
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/personal/{ep_id}/stornieren — Fehldisposition stornieren (LLH-1079,
/// design.md D3): nur ohne Bindung und Spur und in den ersten 15 Minuten, sonst 422 mit dem
/// Grund; eine beendete Kraft → 409. Streicht die Ereignisse aus der Disposition. ETB-Eintrag.
pub async fn stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    PfadParam((_eid, ep_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    crate::write_retry!(&state.pool, |conn| {
        disposition_repo::require_aktiv_tx(conn, einsatz_id, ep_id).await?;
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
        disposition_repo::stornieren_tx(conn, einsatz_id, ep_id, ctx.benutzer.id, &jetzt).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::personal::etb_text_storniert(&vorher.name, vorher.funktion.as_deref()),
        )
        .await?;
        Ok(())
    })?;
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/einsaetze/{id}/personal/{ep_id}/reaktivieren — eine entlassene oder stornierte
/// Kraft erneut disponieren (LLH-1079, design.md D7): Block „Entlassen“ und Rückgängig nach dem
/// Entlassen. Initialstatus und Zeitachse neu, Stärke-Position bleibt. Aktiv → 409. ETB-Eintrag.
pub async fn reaktivieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    PfadParam((_eid, ep_id)): PfadParam<(i64, i64)>,
) -> Result<Json<EinsatzPersonalAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        disposition_repo::reaktivieren_tx(
            conn,
            einsatz_id,
            ctx.einsatz.org_id,
            ep_id,
            None,
            ctx.benutzer.id,
        )
        .await?;
        disposition_repo::start_zeitachse_tx(conn, einsatz_id, ctx.benutzer.id, ep_id).await?;
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::personal::etb_text_erneut_disponiert(
                &anzeige.name,
                anzeige.funktion.as_deref(),
            ),
        )
        .await?;
        Ok(anzeige)
    })?;
    sse_personal(&state, einsatz_id, ep_id);
    Ok(Json(anzeige))
}

/// Nach dem Commit des Entlassens: `personal` erreicht nur Leser mit Personal- oder
/// Kartenrecht. Den Vermerk „nicht mehr disponiert“ lesen Führungsstelle und Stab mit eigenem
/// Gate; sie hängen an `einsatz` bzw. `stab` (LLH-1164, wie das getragene Fahrzeug in
/// LFH-1106). Ebenso tragen Einheiten (Mitglieder, Führer) und Abschnitte (Leiter) die Person
/// (LLH-1178), die UHS ihre Stärke (LLH-1182) und ein Fahrzeug seine Besatzung. Schadensbezug,
/// Auftrag und Bestätigungen bleiben unverändert und melden nichts.
async fn notify_betroffene(state: &AppState, einsatz_id: i64, betroffen: &EntlassenBetroffen) {
    if betroffen.einsatzleiter {
        crate::routes::einsatz::kopf_geaendert(state, einsatz_id).await;
    }
    if betroffen.stab {
        state.live.publiziere_einsatz(einsatz_id, LiveEvent::Stab);
    }
    for einheit_id in &betroffen.einheiten {
        super::einsatz_einheit::sse_einheit(state, einsatz_id, *einheit_id);
    }
    for abschnitt_id in &betroffen.abschnitte {
        super::einsatzabschnitt::sse_abschnitt(state, einsatz_id, *abschnitt_id);
    }
    if let Some(uhs_id) = betroffen.uhs {
        super::einsatz_uhs::sse_uhs(state, einsatz_id, uhs_id);
    }
    if let Some(ef_id) = betroffen.fahrzeug {
        super::einsatz_fahrzeug::sse_fahrzeug(state, einsatz_id, ef_id);
    }
}

/// Was eine entlassene Person außerhalb des Personalmoduls trug, in der Transaktion vor dem
/// Lösen gefragt; jede Ansicht bekommt nach dem Commit ihr eigenes Ereignis.
struct EntlassenBetroffen {
    einsatzleiter: bool,
    stab: bool,
    einheiten: Vec<i64>,
    abschnitte: Vec<i64>,
    uhs: Option<i64>,
    fahrzeug: Option<i64>,
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

/// PATCH /api/einsaetze/{id}/personal/{ep_id}/position — reine Lage-Pflege, KEIN ETB.
/// Liefert die Karten-Sicht; jede aktive Person des Einsatzes ist verortbar (LFH-276).
pub async fn position(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    PfadParam((_eid, ep_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PositionBody>,
) -> Result<Json<FuehrungskraftKarte>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Eine beendete Kraft ist nicht mehr verortbar (409, LLH-1079); fremd → 404.
    {
        let mut conn = state.pool.acquire().await?;
        disposition_repo::require_aktiv_tx(&mut conn, einsatz_id, ep_id).await?;
    }
    // Effektivzustand für die Paar-Validierung: vorhandene lat/lon.
    let vorher: (Option<f64>, Option<f64>) =
        sqlx::query_as("SELECT lat, lon FROM einsatz_personal WHERE id = ? AND einsatz_id = ?")
            .bind(ep_id)
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
        ep_id,
        disposition_repo::PositionPatch {
            lat: body.lat,
            lon: body.lon,
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_personal(&state, einsatz_id, ep_id);
    Ok(Json(nachher))
}

/// GET /api/einsaetze/{id}/karte/fuehrungskraefte — alle aktiven Personen des Einsatzes
/// (Führung via `ist_einheitsfuehrer`/`ist_abschnittsleiter`-Flags kenntlich, LFH-276).
pub async fn karte_fuehrungskraefte(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
) -> Result<Json<Vec<FuehrungskraftKarte>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(
        disposition_repo::liste_fuehrungskraefte(&state.pool, einsatz_id).await?,
    ))
}
