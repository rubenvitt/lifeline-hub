//! Kanonischer Live-Feed eines Einsatzes (LFH-227) und Org-Strom (LFH-734).
//!
//! Der Einsatz-Feed trägt die Org-Ereignisse (`einsatzliste`, `stammdaten`) mit, damit ein Tab
//! im Einsatz bei EINER Verbindung bleibt; außerhalb eines Einsatzes öffnet das Frontend den
//! Org-Strom `GET /api/live` (design.md D1 der Change `lfh-734-org-live-ereignis`).
//!
//! EINE Tür (Lesezugriff auf den Einsatz) und ein **Filter je Event** nach den erlaubten
//! Modulen — sonst läse, wer irgendeinen Stream öffnen darf, jedes Event mit, inkl. ETB- und
//! Chat-Volltexten.
//!
//! **Revokation = Snapshot:** die erlaubten Module werden einmal beim Verbindungsaufbau
//! berechnet; ein Rechteentzug wirkt erst beim Reconnect. Das Restfenster verrät nur Metadaten
//! (alle Payloads tragen nur IDs), der Inhalts-GET antwortet sofort 403. Ein DB-Read je Event
//! vervielfachte die Kosten bei Erfassungs-Bursts.

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::erlaubte_module;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::error::AppError;
use crate::live::org::OrgAbonnent;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use std::convert::Infallible;
use tokio_stream::{Stream, StreamExt};

/// GET /api/einsaetze/{id}/live — der Live-Feed des Einsatzes.
///
/// `EinsatzLesezugriff<OhneModul>` erzwingt Org-Floor und Lesezugriff (Org-Grenze, Soft-Delete,
/// Retention, Nachlauffrist) und **kein** Modul-Gate: die Route gehört keinem Modul, die
/// Modul-Ebene wirkt als Event-Filter.
pub async fn stream(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let erlaubt =
        erlaubte_module(&state.pool, einsatz_id, ctx.einsatz.org_id, &ctx.benutzer).await?;

    // Reconnect-Resync: mit `Last-Event-ID` liefert der LiveHub die verpassten Nachrichten nach
    // (bzw. `lagged` bei Ring-Overflow/Neustart). Der Filter greift auf beiden Wegen.
    let seit = crate::routes::support::last_event_id(&headers);
    let (replay, rx) = state.live.abonniere_mit_replay(einsatz_id, seit);
    let org_rx = state.live.abonniere_org();
    let stream = crate::routes::support::sse_stream_mit_replay(replay, rx, move |ev| {
        ev.sichtbar_fuer(&erlaubt)
    })
    // Org-Ereignisse ohne `id:` und ohne Replay (design.md D4); gefiltert gegen den Benutzer,
    // nicht gegen die Modulrechte des Einsatzes.
    .merge(crate::routes::support::sse_org_stream(
        org_rx,
        OrgAbonnent::aus(&ctx.benutzer),
    ));

    // Sofort ein erstes Byte: ein Proxy, der die Header erst mit dem ersten Body-Byte weitergibt
    // (etwa der Vite-Dev-Proxy), hielte sie sonst bis zum ersten Keep-Alive zurück, und
    // `EventSource.onopen` feuerte erst dann. Ein Kommentar trägt kein `id:` und lässt die
    // `Last-Event-ID` unberührt.
    let verbunden = tokio_stream::once(Ok(Event::default().comment("verbunden")));

    Ok(Sse::new(verbunden.chain(stream)).keep_alive(KeepAlive::default()))
}

/// GET /api/live — der Org-Strom (LFH-734) für Tabs außerhalb eines Einsatzes.
///
/// Tür: angemeldet und aktiv (`CurrentUser`), sonst 401. Trägt nur Org-Ereignisse und `lagged`,
/// keine Einsatz-Ereignisse. Empfänger-Schnappschuss beim Aufbau wie beim Einsatz-Feed.
pub async fn org_stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.live.abonniere_org();
    let stream = crate::routes::support::sse_org_stream(rx, OrgAbonnent::aus(&benutzer));
    let verbunden = tokio_stream::once(Ok(Event::default().comment("verbunden")));
    Sse::new(verbunden.chain(stream)).keep_alive(KeepAlive::default())
}

/// Pfadpräfixe der Stammdaten-Kataloge (LFH-734). Eine schreibende Anfrage, deren Route unter
/// einem dieser Präfixe liegt, meldet nach Erfolg `stammdaten` an die Organisation des
/// Benutzers ([`stammdaten_live`]). Ein Präfix deckt den Pfad selbst und alles unter `…/`.
///
/// Gegen eine vergessene Route wacht `tests/stammdaten_live_guard.rs`: jede schreibende Route
/// eines Katalog-Moduls muss hier abgedeckt sein, und jeder Eintrag braucht eine schreibende
/// Route. Bewusst NICHT dabei: Org-Einstellungen und Org-Modul-Einstellungen (enger Lesekreis),
/// Benutzer, Karten (instanzweit) — Spec `org-live`, „Bewusst nicht live".
pub const STAMMDATEN_PFADE: &[&str] = &[
    "/api/fahrzeuge",
    "/api/fahrzeug-status",
    "/api/personal",
    "/api/personal-status",
    "/api/material",
    "/api/qualifikationen",
    "/api/einheit-typen",
    "/api/sprechgruppen",
    "/api/etb-bausteine",
    "/api/stichwort-vorschlaege",
    "/api/org-fuehrungsfunktionen",
    "/api/organisation",
];

/// Ob `pfad` (das `MatchedPath`-Muster) unter einem Stammdaten-Präfix liegt.
pub fn ist_stammdaten_pfad(pfad: &str) -> bool {
    STAMMDATEN_PFADE.iter().any(|p| {
        pfad.strip_prefix(p)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    })
}

/// Middleware: meldet `stammdaten` nach jeder erfolgreichen (2xx) schreibenden Anfrage an eine
/// Katalog-Route (LFH-734, design.md D5). Der Handler hat beim Erfolg schon committet. Den
/// Benutzer löst die Middleware selbst auf; scheitert das, scheitert auch der Handler, und es
/// gibt nichts zu melden.
pub async fn stammdaten_live(
    State(state): State<AppState>,
    pfad: Option<axum::extract::MatchedPath>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let betroffen = req.method() != axum::http::Method::GET
        && req.method() != axum::http::Method::HEAD
        && pfad.is_some_and(|p| ist_stammdaten_pfad(p.as_str()));
    if !betroffen {
        return next.run(req).await;
    }
    let (mut parts, body) = req.into_parts();
    let org_id = {
        use axum::extract::FromRequestParts;
        CurrentUser::from_request_parts(&mut parts, &state)
            .await
            .ok()
            .map(|CurrentUser(b)| b.org_id)
    };
    let antwort = next
        .run(axum::extract::Request::from_parts(parts, body))
        .await;
    if let (true, Some(org_id)) = (antwort.status().is_success(), org_id) {
        state.live.publiziere_stammdaten(org_id);
    }
    antwort
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stammdaten_praefix_ist_segmentgenau() {
        assert!(ist_stammdaten_pfad("/api/fahrzeuge"));
        assert!(ist_stammdaten_pfad("/api/fahrzeuge/{id}/ausser-dienst"));
        assert!(ist_stammdaten_pfad("/api/organisation/logo"));
        assert!(!ist_stammdaten_pfad("/api/fahrzeuge-x"));
        assert!(!ist_stammdaten_pfad("/api/fahrzeug-vorschlaege"));
        assert!(!ist_stammdaten_pfad("/api/einsaetze/{id}/sprechgruppen"));
        assert!(!ist_stammdaten_pfad("/api/org-einstellungen"));
    }
}
