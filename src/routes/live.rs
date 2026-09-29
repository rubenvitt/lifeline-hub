//! Kanonischer Live-Feed eines Einsatzes (LFH-227).
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
use crate::einsatz::berechtigung::erlaubte_module;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::error::AppError;
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
    let stream = crate::routes::support::sse_stream_mit_replay(replay, rx, move |ev| {
        ev.sichtbar_fuer(&erlaubt)
    });

    // Sofort ein erstes Byte: ein Proxy, der die Header erst mit dem ersten Body-Byte weitergibt
    // (etwa der Vite-Dev-Proxy), hielte sie sonst bis zum ersten Keep-Alive zurück, und
    // `EventSource.onopen` feuerte erst dann. Ein Kommentar trägt kein `id:` und lässt die
    // `Last-Event-ID` unberührt.
    let verbunden = tokio_stream::once(Ok(Event::default().comment("verbunden")));

    Ok(Sse::new(verbunden.chain(stream)).keep_alive(KeepAlive::default()))
}
