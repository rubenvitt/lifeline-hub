//! Routen der Befehle. Die Logik teilen sie mit den Lageberichten
//! ([`crate::routes::vorlagendokument`]).
//!
//! Liste, Detail und Quittung erreicht auch das Abschnittsgerät (LLH-1190, Spec
//! `funktionsansichten`, „Ansicht Einsatzabschnitt“). Diese vier Handler ziehen deshalb den
//! Einsatzkontext, der die Rolle eines Geräts aus seiner Ansicht nimmt, und schneiden auf den
//! Bereich zu: das Gerät sieht nur die geltende Fassung eines Befehls mit einem Verteiler-Eintrag
//! in seinem Bereich und quittiert nur diese Einträge; alles andere ist für es nicht vorhanden
//! (404).

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::befehl::repo::{BefehlAnzeige, BefehlKopf};
use crate::befehl::{Abschnitt, Befehl};
use crate::einsatz::kontext::{EinsatzKontext, EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Auftraege;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::geraet::abschnitt::Abschnittsbereich;
use crate::live::LiveEvent;
use crate::routes::support::FassungParam;
use crate::routes::vorlagendokument::{
    self as kern, AnlegenBody, DokumentRoute, FortschreibenBody, PatchBody,
};
use crate::vorlagendokument::anlage::DokumentAnlageAnzeige;
use crate::vorlagendokument::verteiler::VerteilerEintragAnzeige;
use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "auftraege";

impl DokumentRoute for Befehl {
    const MODUL_KEY: &'static str = MODUL_KEY;
    /// Event-Tag `befehl`.
    const LIVE: LiveEvent = LiveEvent::Befehl;
    const LIVE_ID: &'static str = "befehl_id";
}

/// Ob ein Abschnittsgerät mit dem Bereich `bereich` den Befehl sieht: geltende Fassung
/// (quittierbar) mit mindestens einem eigenen Verteiler-Eintrag (LLH-1190, design.md D2).
fn sichtbar_im_bereich(
    bereich: &Abschnittsbereich,
    is_quittierbar: bool,
    verteiler: &[VerteilerEintragAnzeige],
) -> bool {
    is_quittierbar
        && verteiler
            .iter()
            .any(|e| bereich.ist_eigener_empfaenger(e.abschnitt_id, e.einheit_id))
}

/// Der Bereich der Sitzung, wenn sie ein Abschnittsgerät ist; für Personen `None`.
async fn geraete_bereich(
    state: &AppState,
    ctx: &EinsatzKontext,
) -> Result<Option<Abschnittsbereich>, AppError> {
    crate::geraet::abschnitt::bereich(&state.pool, ctx.geraet.as_ref()).await
}

/// GET /api/einsaetze/{id}/befehle — Liste. Nur Lesezugriff (inkl. Beobachter); ein
/// Abschnittsgerät sieht nur die geltenden Fassungen an seinen Bereich.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Auftraege>,
) -> Result<Json<Vec<BefehlKopf>>, AppError> {
    let alle = kern::liste_geprueft::<Befehl>(&state, ctx.einsatz.id).await?;
    Ok(Json(match geraete_bereich(&state, &ctx).await? {
        Some(b) => alle
            .into_iter()
            .filter(|k| sichtbar_im_bereich(&b, k.is_quittierbar, &k.verteiler))
            .collect(),
        None => alle,
    }))
}

/// GET /api/einsaetze/{id}/befehle/{bid} — Detail. Nur Lesezugriff; ein Befehl außerhalb des
/// Bereichs eines Abschnittsgeräts ist für es nicht vorhanden (404).
pub async fn detail(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Auftraege>,
    PfadParam((_, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    let befehl = kern::detail_geprueft::<Befehl>(&state, ctx.einsatz.id, bid).await?;
    if let Some(b) = geraete_bereich(&state, &ctx).await? {
        if !sichtbar_im_bereich(&b, befehl.is_quittierbar, &befehl.verteiler) {
            return Err(AppError::NotFound);
        }
    }
    Ok(Json(befehl))
}

/// POST /api/einsaetze/{id}/befehle — Entwurf anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(body): JsonBody<AnlegenBody<Abschnitt>>,
) -> Result<(StatusCode, Json<BefehlAnzeige>), AppError> {
    kern::anlegen::<Befehl>(&state, &benutzer, einsatz_id, body).await
}

/// PATCH /api/einsaetze/{id}/befehle/{bid} — nur solange Entwurf (sonst 422).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody<Abschnitt>>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    kern::aktualisieren::<Befehl>(&state, &benutzer, einsatz_id, bid, body).await
}

/// POST /api/einsaetze/{id}/befehle/{bid}/freigeben — rendert + snapshottet ins ETB.
pub async fn freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    kern::freigeben::<Befehl>(&state, &benutzer, einsatz_id, bid).await
}

/// POST /api/einsaetze/{id}/befehle/{bid}/fortschreiben — neue Entwurfs-Version.
pub async fn fortschreiben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<FortschreibenBody>,
) -> Result<(StatusCode, Json<BefehlAnzeige>), AppError> {
    kern::fortschreiben::<Befehl>(&state, &benutzer, einsatz_id, bid, body).await
}

/// Quittung oder Rücknahme. Ein Abschnittsgerät erreicht nur eigene Einträge eines Befehls, den
/// es sieht; ein fremder Eintrag oder ein für es unsichtbarer Befehl ist 404 (LLH-1190, wie
/// `routes::auftrag::fordere_im_bereich`).
async fn quittung(
    state: &AppState,
    ctx: &EinsatzKontext,
    bid: i64,
    vid: i64,
    quittieren: bool,
) -> Result<Json<BefehlAnzeige>, AppError> {
    if let Some(b) = geraete_bereich(state, ctx).await? {
        let befehl = kern::detail_geprueft::<Befehl>(state, ctx.einsatz.id, bid).await?;
        let eigen = befehl
            .verteiler
            .iter()
            .any(|e| e.id == vid && b.ist_eigener_empfaenger(e.abschnitt_id, e.einheit_id));
        if !befehl.is_quittierbar || !eigen {
            return Err(AppError::NotFound);
        }
    }
    kern::quittung_geprueft::<Befehl>(state, &ctx.benutzer, ctx.einsatz.id, bid, vid, quittieren)
        .await
        .map(Json)
}

/// POST /api/einsaetze/{id}/befehle/{bid}/verteiler/{vid}/quittieren — Empfang einer
/// Verteiler-Zeile quittieren (LLH-1173). Nur die jüngste freigegebene Fassung, sonst 422.
pub async fn quittieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Auftraege>,
    PfadParam((_, bid, vid)): PfadParam<(i64, i64, i64)>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    quittung(&state, &ctx, bid, vid, true).await
}

/// POST /api/einsaetze/{id}/befehle/{bid}/verteiler/{vid}/zuruecknehmen — Quittung
/// zurücknehmen (LLH-1173), der Rückweg zum Rückgängig-Knopf (LFH-343).
pub async fn quittung_zuruecknehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Auftraege>,
    PfadParam((_, bid, vid)): PfadParam<(i64, i64, i64)>,
) -> Result<Json<BefehlAnzeige>, AppError> {
    quittung(&state, &ctx, bid, vid, false).await
}

/// GET /api/einsaetze/{id}/befehle/{bid}/anlagen — Bild-Anlagen (LFH-1028). Lesezugriff.
pub async fn anlagen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<DokumentAnlageAnzeige>>, AppError> {
    kern::anlagen::<Befehl>(&state, &benutzer, einsatz_id, bid).await
}

/// POST /api/einsaetze/{id}/befehle/{bid}/anlagen — Anlage anfügen (Multipart: `datei`,
/// `art`, `titel`, `stand_at`), nur im Entwurf.
pub async fn anlage_ablegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid)): PfadParam<(i64, i64)>,
    multipart: Multipart,
) -> Result<(StatusCode, Json<DokumentAnlageAnzeige>), AppError> {
    kern::anlage_ablegen::<Befehl>(&state, &benutzer, einsatz_id, bid, multipart).await
}

/// GET /api/einsaetze/{id}/befehle/{bid}/anlagen/{aid}/datei — Download (`?fassung=`).
pub async fn anlage_datei(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid, aid)): PfadParam<(i64, i64, i64)>,
    param: FassungParam,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let fassung = param.fassung()?;
    kern::anlage_datei::<Befehl>(
        &state,
        &benutzer,
        einsatz_id,
        bid,
        aid,
        fassung,
        &req_headers,
    )
    .await
}

/// DELETE /api/einsaetze/{id}/befehle/{bid}/anlagen/{aid} — nur im Entwurf.
pub async fn anlage_entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, bid, aid)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    kern::anlage_entfernen::<Befehl>(&state, &benutzer, einsatz_id, bid, aid).await
}
