//! Gemeinsames Fundament für die `einsatz_*`-/Modul-Routen (F33/LFH-256).
//!
//! Bündelt die zuvor 9–18-fach wörtlich kopierten Infrastruktur-Helfer an EINER Stelle,
//! damit ein Fix (z. B. an der Tri-State-PATCH-Semantik oder am lagged-Resync) alle
//! Routen zugleich erreicht, statt zwischen byte-identischen Kopien zu driften. Die
//! modul-spezifischen `sse_*`-Notify-Wrapper bleiben bewusst lokal (unterscheiden sich in
//! Event-Name und Payload-Keys).

use crate::live::LiveNachricht;
use axum::http::{header, HeaderMap};
use axum::response::sse::Event;
use serde::Deserialize;
use std::convert::Infallible;
use tokio::sync::broadcast::Receiver;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// `Cache-Control` für ausgelieferte BLOB-Assets (Anhänge, Karten-Hintergrundbilder,
/// LFH-258): auth-gated (→ `private`), inhaltsadressiert und je `id` unveränderlich
/// (→ `immutable` + langes `max-age`). Der ETag (sha256) erlaubt Revalidierung; ein
/// Byte-Wechsel bekäme ohnehin eine neue `id`. Geteilt, damit beide Asset-Download-Pfade
/// dieselbe Policy tragen.
pub const ASSET_CACHE_CONTROL: &str = "private, max-age=31536000, immutable";

/// Starker ETag aus dem sha256-Hex (gequotet).
pub fn etag_von(sha256: &str) -> String {
    format!("\"{sha256}\"")
}

/// Ob der `If-None-Match`-Request-Header den ETag (oder `*`) enthält → 304-Kurzschluss.
/// Toleriert die kommaseparierte Mehrfach-Liste des Headers.
pub fn if_none_match_matcht(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',').any(|kandidat| {
                let kandidat = kandidat.trim();
                kandidat == "*" || kandidat == etag
            })
        })
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[test]
    fn trimme_macht_leer_und_whitespace_zu_none() {
        assert_eq!(trimme(None), None);
        assert_eq!(trimme(Some(String::new())), None);
        assert_eq!(trimme(Some("   ".to_string())), None);
        assert_eq!(
            trimme(Some("  Wert  ".to_string())),
            Some("Wert".to_string())
        );
    }

    #[derive(Deserialize)]
    struct Patch {
        #[serde(default, deserialize_with = "deserialize_optional_field")]
        feld: Option<Option<i64>>,
    }

    #[test]
    fn deserialize_optional_field_unterscheidet_null_von_absent() {
        // Fehlendes Feld → None (PATCH lässt unverändert).
        let p: Patch = serde_json::from_str("{}").unwrap();
        assert_eq!(p.feld, None);
        // Explizites JSON-null → Some(None) (PATCH setzt auf NULL).
        let p: Patch = serde_json::from_str(r#"{"feld": null}"#).unwrap();
        assert_eq!(p.feld, Some(None));
        // Konkreter Wert → Some(Some(v)).
        let p: Patch = serde_json::from_str(r#"{"feld": 42}"#).unwrap();
        assert_eq!(p.feld, Some(Some(42)));
    }

    fn inm(wert: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(header::IF_NONE_MATCH, wert.parse().unwrap());
        h
    }

    #[test]
    fn if_none_match_matcht_exakt_stern_und_liste() {
        let etag = etag_von("a".repeat(64).as_str());
        // Exakter Treffer.
        assert!(if_none_match_matcht(&inm(&etag), &etag));
        // Wildcard.
        assert!(if_none_match_matcht(&inm("*"), &etag));
        // Kommaliste mit Treffer.
        assert!(if_none_match_matcht(
            &inm(&format!("\"other\", {etag}")),
            &etag
        ));
        // Kein Treffer.
        assert!(!if_none_match_matcht(&inm("\"deadbeef\""), &etag));
        // Fehlender Header.
        assert!(!if_none_match_matcht(&HeaderMap::new(), &etag));
    }
}
