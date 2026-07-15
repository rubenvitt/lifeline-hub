//! Gemeinsames Fundament für die `einsatz_*`-/Modul-Routen (F33/LFH-256).
//!
//! Bündelt die zuvor 9–18-fach wörtlich kopierten Infrastruktur-Helfer an EINER Stelle,
//! damit ein Fix (z. B. an der Tri-State-PATCH-Semantik oder am lagged-Resync) alle
//! Routen zugleich erreicht, statt zwischen byte-identischen Kopien zu driften. Die
//! modul-spezifischen `sse_*`-Notify-Wrapper bleiben bewusst lokal (unterscheiden sich in
//! Event-Name und Payload-Keys).

use crate::live::LiveNachricht;
use axum::response::sse::Event;
use serde::Deserialize;
use std::convert::Infallible;
use tokio::sync::broadcast::Receiver;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// Trimmt einen optionalen String und macht ihn bei leerem Ergebnis zu `None`
/// (leerer/Whitespace-only-Input zählt als „nicht gesetzt").
pub fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Liest ein optional-nullable PATCH-Feld als Tri-State: JSON-`null` → `Some(None)`
/// (explizit auf NULL setzen), fehlendes Feld → `None` (unverändert lassen). Trägt die
/// PATCH-null-vs-absent-Vertragssemantik — genau EINMAL definiert statt 10-fach kopiert.
pub fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Baut den SSE-Ausgabe-Stream aus einem Live-Kanal-Empfänger: jede `LiveNachricht` wird zu
/// einem benannten SSE-Event; ein übergelaufener (lagged) Empfänger erhält ein
/// `lagged`/`resync`-Signal statt eines Stream-Abbruchs — der Client resynct dann per GET.
pub fn sse_event_stream(
    rx: Receiver<LiveNachricht>,
) -> impl Stream<Item = Result<Event, Infallible>> {
    BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    })
}
