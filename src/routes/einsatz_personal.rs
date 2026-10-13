use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::{Lagekarte, Personal};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::personal::disposition_repo::{self, AdhocDaten};
use crate::personal::status_repo;
use crate::personal::{EinsatzPersonalAnzeige, FuehrungskraftKarte};
use crate::routes::support::{
    deserialize_optional_field, parse_enum, pflicht, pruefe_koordinate, trimme, trimme_tri,
};
use crate::staerke::StaerkePosition;
use crate::zeitachse::repo as zeitachse_repo;
use axum::extract::State;
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

/// Personen-Bezeichnung für ETB-Texte: Name, optional mit Funktion in Klammern.
fn person_bezeichnung(a: &EinsatzPersonalAnzeige) -> String {
    crate::personal::etb_bezeichnung(&a.name, a.funktion.as_deref())
}

/// Validiert eine optionale Stärke-Position gegen das Enum (leer/None erlaubt).
fn pruefe_position(p: &Option<String>) -> Result<(), AppError> {
    if let Some(s) = p.as_deref() {
        parse_enum(StaerkePosition::parse, s, "Ungültige Stärke-Position")?;
    }
    Ok(())
}

/// GET /api/einsaetze/{id}/personal — disponiertes Personal (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personal>,
) -> Result<Json<Vec<EinsatzPersonalAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, ctx.einsatz.ist_aktiv()).await?,
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

    // LFH-552: Disposition und die Zeitachse des Initialstatus (Marke) in EINER Tx.
    let jetzt = crate::zeit::jetzt();
    let ep_id = crate::write_retry!(&state.pool, |conn| {
        let ep_id = match &vorbereitet {
            Vorbereitet::Stamm(personal_id) => {
                disposition_repo::disponiere_stamm_tx(
                    conn,
                    einsatz_id,
                    ctx.einsatz.org_id,
                    *personal_id,
                    body.staerke_position.as_deref(),
                    ctx.benutzer.id,
                )
                .await?
            }
            Vorbereitet::Adhoc {
                name,
                funktion,
                traeger,
                position,
            } => {
                disposition_repo::disponiere_adhoc_tx(
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
                .await?
            }
        };
        let status_id: Option<i64> =
            sqlx::query_scalar("SELECT status_id FROM einsatz_personal WHERE id = ?")
                .bind(ep_id)
                .fetch_one(&mut *conn)
                .await?;
        if let Some(sid) = status_id {
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
        Ok(ep_id)
    })?;

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    super::etb_system_degradiert(
        &state,
        einsatz_id,
        ctx.benutzer.id,
        &crate::personal::etb_text_disponiert(&anzeige.name, anzeige.funktion.as_deref()),
    )
    .await;
    sse_personal(&state, einsatz_id, ep_id);
    Ok((StatusCode::CREATED, Json(anzeige)))
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
        let vorher = disposition_repo::laden_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
        disposition_repo::aktualisiere_tx(
            conn,
            einsatz_id,
            ep_id,
            body.status_id,
            staerke_position,
            bemerkung,
        )
        .await?;
        let nachher = disposition_repo::laden_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
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

/// DELETE /api/einsaetze/{id}/personal/{ep_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    PfadParam((_eid, ep_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    // F06/LFH-244 Tier-A: Führungsrollen-Freigabe + DELETE + System-ETB-Eintrag atomar in EINER
    // Tx (BEGIN IMMEDIATE + Retry). ETB-Text aus der VOR der Tx geladenen Anzeige; SSE erst
    // nach dem Commit.
    let text = format!(
        "Person «{}» aus dem Einsatz entfernt",
        person_bezeichnung(&anzeige)
    );
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let betroffen = crate::write_retry!(&state.pool, |conn| {
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
            schaeden: crate::schaden::repo::load_geschaedigt_durch_tx(conn, einsatz_id, ep_id)
                .await?,
        };
        disposition_repo::entferne_tx(conn, einsatz_id, ep_id).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await?;
        Ok(betroffen)
    })?;
    sse_personal(&state, einsatz_id, ep_id);
    // `personal` erreicht nur Leser mit Personal- oder Kartenrecht. Den Vermerk „nicht mehr
    // disponiert“ (ON DELETE SET NULL) lesen Führungsstelle und Stab mit eigenem Gate; sie hängen
    // an `einsatz` bzw. `stab` (LLH-1164, wie das getragene Fahrzeug in LFH-1106). Ebenso tragen
    // Einheiten (Mitglieder, Führer) und Abschnitte (Leiter) die Person (LLH-1178), die UHS ihre
    // Stärke und ein Schaden die geschädigte Einsatzkraft (LLH-1182).
    if betroffen.einsatzleiter {
        crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    }
    if betroffen.stab {
        state.live.publiziere_einsatz(einsatz_id, LiveEvent::Stab);
    }
    for einheit_id in betroffen.einheiten {
        super::einsatz_einheit::sse_einheit(&state, einsatz_id, einheit_id);
    }
    for abschnitt_id in betroffen.abschnitte {
        super::einsatzabschnitt::sse_abschnitt(&state, einsatz_id, abschnitt_id);
    }
    if let Some(uhs_id) = betroffen.uhs {
        super::einsatz_uhs::sse_uhs(&state, einsatz_id, uhs_id);
    }
    for schaden_id in betroffen.schaeden {
        super::einsatz_schaden::sse_schaden(&state, einsatz_id, schaden_id);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Was eine entlassene Person außerhalb des Personalmoduls trug, in der Transaktion vor dem
/// DELETE gefragt; jede Ansicht bekommt nach dem Commit ihr eigenes Ereignis.
struct EntlassenBetroffen {
    einsatzleiter: bool,
    stab: bool,
    einheiten: Vec<i64>,
    abschnitte: Vec<i64>,
    uhs: Option<i64>,
    schaeden: Vec<i64>,
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
/// Liefert die Karten-Sicht; jede disponierte Person des Einsatzes ist verortbar (LFH-276).
pub async fn position(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personal>,
    PfadParam((_eid, ep_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PositionBody>,
) -> Result<Json<FuehrungskraftKarte>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Effektivzustand für die Paar-Validierung: vorhandene lat/lon (404 falls fremd).
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

    let nachher = disposition_repo::aktualisiere_position(
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

/// GET /api/einsaetze/{id}/karte/fuehrungskraefte — alle disponierten Personen des Einsatzes
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
