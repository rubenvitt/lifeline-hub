//! Gemeinsames Fundament für die `einsatz_*`-/Modul-Routen (F33/LFH-256).
//!
//! Bündelt die zuvor 9–18-fach wörtlich kopierten Infrastruktur-Helfer an EINER Stelle,
//! damit ein Fix (z. B. an der Tri-State-PATCH-Semantik oder am lagged-Resync) alle
//! Routen zugleich erreicht, statt zwischen byte-identischen Kopien zu driften. Die
//! modul-spezifischen `sse_*`-Notify-Wrapper bleiben bewusst lokal (unterscheiden sich in
//! Event-Name und Payload-Keys).

use crate::live::{LiveEvent, LiveNachricht, Replay};
use axum::http::{header, HeaderMap, HeaderName};
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

/// Wie [`trimme`], aber für Tri-State-PATCH-Felder (LFH-266/F12).
///
/// Die äußere `Option` (Feld im Patch enthalten?) bleibt erhalten, nur der Wert wird
/// getrimmt. Ein vorhandenes, aber leeres/whitespace-only Feld wird zu `Some(None)` — also
/// zum Leerwunsch, nicht zum Leerstring in der Spalte. Damit akzeptiert der Server sowohl
/// `null` als auch `""` als „leeren", was die Formulare im Frontend erheblich vereinfacht.
pub fn trimme_tri(s: Option<Option<String>>) -> Option<Option<String>> {
    s.map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
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

/// Query-Filter `?ansicht=<id>` der ansichtsgebundenen Karten-Objekt-Listen (LFH-320):
/// die drei entitätslosen Layer (freies Zeichen, Zone, Hintergrundbild) filtern auf die
/// Objekte der Ansicht PLUS die ansichtslosen. Ohne Parameter (`None`) bleibt es bei „alles"
/// — für andere Module/Export. Einmal definiert statt dreifach kopiert.
#[derive(Debug, Deserialize)]
pub struct AnsichtFilter {
    pub ansicht: Option<i64>,
}

/// Baut den SSE-Ausgabe-Stream aus einem Live-Kanal-Empfänger: jede `LiveNachricht` wird zu
/// einem benannten SSE-Event; ein übergelaufener (lagged) Empfänger erhält ein
/// `lagged`/`resync`-Signal statt eines Stream-Abbruchs — der Client resynct dann per GET.
///
/// `erlaubt` ist der per-Abonnent-Modul-Filter (F01/LFH-227): der LiveHub bleibt ein
/// auth-freier Dumb-Transport, die Modul-Berechtigung wirkt hier — pro Verbindung.
/// Kontroll-Events (lagged/resync) passieren immer, sonst hinge der Resync.
pub fn sse_event_stream(
    rx: Receiver<LiveNachricht>,
    erlaubt: impl Fn(LiveEvent) -> bool,
) -> impl Stream<Item = Result<Event, Infallible>> {
    BroadcastStream::new(rx).filter_map(move |res| match res {
        // Nicht erlaubtes Modul → die Nachricht verlässt den Server nicht.
        Ok(n) if !erlaubt(n.event) => None,
        // `.id(...)` setzt die SSE-`id:`-Zeile → der Browser schickt sie beim
        // Auto-Reconnect als `Last-Event-ID` zurück (F14/LFH-263).
        Ok(n) => Some(Ok(Event::default()
            .id(n.id)
            .event(n.event.as_str())
            .data(n.data))),
        Err(_) => Some(Ok(Event::default()
            .event(LiveEvent::Lagged.as_str())
            .data("resync"))),
    })
}

/// Liest den `Last-Event-ID`-Request-Header (roh) für den Replay-Resync (F14/LFH-263).
/// Der Browser sendet ihn beim EventSource-Auto-Reconnect automatisch mit.
pub fn last_event_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get(HeaderName::from_static("last-event-id"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Baut den SSE-Ausgabe-Stream mit vorangestelltem Replay (F14/LFH-263): verpasste
/// Nachrichten (`Replay::Events`) werden VOR dem Live-Kanal ausgeliefert; eine `Luecke`
/// (Ring-Overflow / Neustart) sendet genau ein `lagged`/`resync`-Signal (Client resynct per
/// GET); ohne Replay (`Keine`) nur der Live-Kanal.
/// Der Modul-Filter `erlaubt` greift auf BEIDEN Wegen — Replay-Prefix und Live-Tail.
/// Sonst wäre ein Reconnect mit `Last-Event-ID` ein Bypass des Gates (F01/LFH-227).
pub fn sse_stream_mit_replay(
    replay: Replay,
    rx: Receiver<LiveNachricht>,
    erlaubt: impl Fn(LiveEvent) -> bool,
) -> impl Stream<Item = Result<Event, Infallible>> {
    let prefix: Vec<Result<Event, Infallible>> = match replay {
        Replay::Keine => Vec::new(),
        Replay::Events(nachrichten) => nachrichten
            .into_iter()
            .filter(|n| erlaubt(n.event))
            .map(|n| {
                Ok(Event::default()
                    .id(n.id)
                    .event(n.event.as_str())
                    .data(n.data))
            })
            .collect(),
        Replay::Luecke => vec![Ok(Event::default()
            .event(LiveEvent::Lagged.as_str())
            .data("resync"))],
    };
    tokio_stream::iter(prefix).chain(sse_event_stream(rx, erlaubt))
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

    #[test]
    fn last_event_id_liest_header_oder_none() {
        let mut h = HeaderMap::new();
        assert_eq!(last_event_id(&h), None);
        h.insert(
            HeaderName::from_static("last-event-id"),
            "42-7".parse().unwrap(),
        );
        assert_eq!(last_event_id(&h), Some("42-7".to_string()));
    }

    /// Sender fallen lassen → der Live-Kanal endet sofort, wir sehen nur das Prefix.
    fn leerer_rx() -> Receiver<LiveNachricht> {
        let (tx, rx) = tokio::sync::broadcast::channel::<LiveNachricht>(4);
        drop(tx);
        rx
    }

    fn nachricht(id: &str, event: LiveEvent) -> LiveNachricht {
        LiveNachricht {
            id: id.into(),
            event,
            data: "x".into(),
        }
    }

    /// Filter, der alles durchlässt (für die Tests der Replay-Mechanik).
    fn alles(_: LiveEvent) -> bool {
        true
    }

    #[tokio::test]
    async fn sse_stream_mit_replay_praefixt_nach_replay_art() {
        let n = |id: &str| nachricht(id, LiveEvent::Etb);

        let keine: Vec<_> = sse_stream_mit_replay(Replay::Keine, leerer_rx(), alles)
            .collect()
            .await;
        assert_eq!(keine.len(), 0, "Keine → kein Prefix");

        let events: Vec<_> =
            sse_stream_mit_replay(Replay::Events(vec![n("1-1"), n("1-2")]), leerer_rx(), alles)
                .collect()
                .await;
        assert_eq!(events.len(), 2, "Events → je verpasste Nachricht ein Event");

        let luecke: Vec<_> = sse_stream_mit_replay(Replay::Luecke, leerer_rx(), alles)
            .collect()
            .await;
        assert_eq!(luecke.len(), 1, "Luecke → genau ein lagged/resync-Event");
    }

    /// F01/LFH-227: der Modul-Filter muss den **Replay-Prefix** genauso greifen wie den
    /// Live-Tail — sonst wäre ein Reconnect mit `Last-Event-ID` der Bypass des Gates.
    #[tokio::test]
    async fn replay_prefix_wird_gefiltert() {
        let verpasst = vec![
            nachricht("1-1", LiveEvent::Etb),
            nachricht("1-2", LiveEvent::Chat),
            nachricht("1-3", LiveEvent::Etb),
        ];
        let nur_etb: Vec<_> = sse_stream_mit_replay(Replay::Events(verpasst), leerer_rx(), |ev| {
            ev == LiveEvent::Etb
        })
        .collect()
        .await;
        assert_eq!(
            nur_etb.len(),
            2,
            "nur die etb-Nachrichten dürfen im Replay ankommen"
        );
    }

    /// Ein `Luecke`-Resync ist ein Kontroll-Event: es passiert auch einen Filter,
    /// der jedes Fach-Modul verbietet — sonst hinge der Client im Stale-Zustand.
    #[tokio::test]
    async fn lagged_kontroll_event_passiert_jeden_filter() {
        let luecke: Vec<_> = sse_stream_mit_replay(Replay::Luecke, leerer_rx(), |_| false)
            .collect()
            .await;
        assert_eq!(luecke.len(), 1, "lagged/resync muss immer durchgehen");
    }

    /// Der Live-Tail filtert ebenfalls — hier über den echten Broadcast-Kanal.
    #[tokio::test]
    async fn live_tail_wird_gefiltert() {
        let (tx, rx) = tokio::sync::broadcast::channel::<LiveNachricht>(8);
        tx.send(nachricht("1-1", LiveEvent::Chat)).unwrap();
        tx.send(nachricht("1-2", LiveEvent::Etb)).unwrap();
        tx.send(nachricht("1-3", LiveEvent::Chat)).unwrap();
        drop(tx);

        let nur_chat: Vec<_> = sse_event_stream(rx, |ev| ev == LiveEvent::Chat)
            .collect()
            .await;
        assert_eq!(nur_chat.len(), 2, "nur die chat-Nachrichten dürfen durch");
    }
}
