//! Kanonischer Live-Feed eines Einsatzes (F01/LFH-227).
//!
//! Ersetzt die 9 modul-benannten `…/stream`-Routen, die alle denselben Broadcast-Kanal
//! verbatim weiterleiteten: wer irgendeine davon öffnen durfte, las jedes Event mit —
//! inklusive ETB- und Chat-Volltexten. Statt neun Türen mit je einem Modul-Schloss gibt
//! es hier EINE Tür (Lesezugriff auf den Einsatz) und einen **Post-Filter pro Event**.
//!
//! **Revokation = Snapshot.** Die erlaubten Module werden EINMAL beim Verbindungsaufbau
//! berechnet; ein Rechteentzug wirkt auf eine offene Verbindung erst beim Reconnect.
//! Das ist bewusst: der Restfenster-Leak ist reine METADATA (alle Payloads sind ID-only),
//! während der Content-Pfad — der ungecachte GET — sofort 403t. Die Alternative wäre ein
//! DB-Read pro Event, der bei Erfassungs-Bursts die Kosten des Live-Kanals vervielfachte.

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::auth::Benutzer;
use crate::einsatz::berechtigung::{fordere_lesezugriff, fordere_modul_zugriff};
use crate::einsatz::modul::MODUL_KEYS;
use crate::einsatz::modul_override;
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::convert::Infallible;
use tokio_stream::Stream;

/// Die Modul-Keys, die `benutzer` in diesem Einsatz sehen darf.
///
/// Lädt Override- und Org-Default-Map genau einmal (zwei indizierte Reads, je ≤25 Zeilen
/// über die PKs `(einsatz_id, modul_key)` / `(org_id, modul_key)`) und wertet danach rein
/// in-memory aus — der Filter im Stream braucht keine DB mehr.
async fn erlaubte_module(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    benutzer: &Benutzer,
) -> Result<HashSet<&'static str>, AppError> {
    let overrides = modul_override::laden_alle(pool, einsatz_id).await?;
    let org_defaults = crate::org::modul_einstellung::laden_alle(pool, org_id).await?;
    Ok(MODUL_KEYS
        .iter()
        .copied()
        .filter(|key| fordere_modul_zugriff(&overrides, &org_defaults, key, benutzer).is_ok())
        .collect())
}

/// GET /api/einsaetze/{id}/live — der Live-Feed des Einsatzes.
///
/// Gatet auf Einsatz-Ebene (`fordere_lesezugriff`, deckt Org-Grenze, Soft-Delete,
/// Retention und Nachlauffrist ab); die Modul-Ebene wirkt danach als Event-Filter.
/// Bewusst KEIN `fordere_modul_zugriff` auf die Route selbst: sie gehört keinem Modul,
/// und ein Modul-Gate hier wäre wieder die Tür, an der alle anderen Module vorbeikämen.
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?; // 404, wenn unbekannt
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let erlaubt = erlaubte_module(&state.pool, einsatz_id, einsatz.org_id, &benutzer).await?;

    // Reconnect-Resync (F14/LFH-263): schickt der Browser beim Auto-Reconnect eine
    // `Last-Event-ID`, liefert der LiveHub die seither verpassten Nachrichten nach
    // (bzw. ein `lagged` bei Ring-Overflow/Neustart). Der Filter greift auf beiden Wegen.
    let seit = crate::routes::support::last_event_id(&headers);
    let (replay, rx) = state.live.abonniere_mit_replay(einsatz_id, seit);
    let stream = crate::routes::support::sse_stream_mit_replay(replay, rx, move |ev| {
        ev.sichtbar_fuer(&erlaubt)
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
