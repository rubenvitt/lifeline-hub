//! Grobe Gerätebezeichnung einer Sitzung aus dem `User-Agent` (LFH-1092).
//!
//! Die Sitzungsliste soll eine Anmeldung wiedererkennbar machen („Firefox · Windows“), mehr
//! nicht. Gespeichert wird deshalb nur diese Bezeichnung, nie der User-Agent selbst: Versionen und
//! Build-Kennungen ergeben einen Fingerabdruck, den niemand braucht. Unbekanntes bleibt `None`.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;

/// Leitet „Browser · Betriebssystem“ ab; fehlt eine Hälfte, steht die andere allein.
pub fn aus_user_agent(ua: &str) -> Option<String> {
    match (browser(ua), betriebssystem(ua)) {
        (Some(b), Some(o)) => Some(format!("{b} · {o}")),
        (Some(b), None) => Some(b.to_string()),
        (None, Some(o)) => Some(o.to_string()),
        (None, None) => None,
    }
}

/// Reihenfolge zählt: Edge und Opera tragen auch `Chrome/`, Chrome trägt auch `Safari/`. Ein
/// WebKit ohne eigenes Kennzeichen (Safari, eingebettete Webansicht der Desktop-Hülle unter
/// macOS) heißt Safari; WebView2 unter Windows meldet sich als Edge.
fn browser(ua: &str) -> Option<&'static str> {
    let hat = |s: &str| ua.contains(s);
    if hat("Edg/") || hat("EdgA/") || hat("EdgiOS/") {
        Some("Edge")
    } else if hat("OPR/") || hat("OPiOS/") {
        Some("Opera")
    } else if hat("SamsungBrowser/") {
        Some("Samsung Internet")
    } else if hat("Firefox/") || hat("FxiOS/") {
        Some("Firefox")
    } else if hat("Chrome/") || hat("CriOS/") || hat("Chromium/") {
        Some("Chrome")
    } else if hat("AppleWebKit/") {
        Some("Safari")
    } else {
        None
    }
}

/// iPad vor iPhone vor Mac (ein iPad im Desktop-Modus meldet sich als Mac und erscheint so);
/// Android vor Linux (Android trägt `Linux`).
fn betriebssystem(ua: &str) -> Option<&'static str> {
    let hat = |s: &str| ua.contains(s);
    if hat("Windows") {
        Some("Windows")
    } else if hat("iPad") {
        Some("iPadOS")
    } else if hat("iPhone") || hat("iPod") {
        Some("iOS")
    } else if hat("Android") {
        Some("Android")
    } else if hat("CrOS") {
        Some("ChromeOS")
    } else if hat("Macintosh") || hat("Mac OS X") {
        Some("macOS")
    } else if hat("Linux") {
        Some("Linux")
    } else {
        None
    }
}

/// Extractor: die Gerätebezeichnung der Anfrage (`None` ohne oder bei unlesbarem `User-Agent`).
/// Die Anmeldewege reichen sie an `session::anlegen` weiter.
#[derive(Debug, Clone, Default)]
pub struct GeraetAngabe(pub Option<String>);

impl<S: Send + Sync> FromRequestParts<S> for GeraetAngabe {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(GeraetAngabe(
            parts
                .headers
                .get(axum::http::header::USER_AGENT)
                .and_then(|v| v.to_str().ok())
                .and_then(aus_user_agent),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echte_user_agents() {
        let faelle = [
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
                "Firefox · Windows",
            ),
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
                 Chrome/129.0.0.0 Safari/537.36",
                "Chrome · Windows",
            ),
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
                 Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
                "Edge · Windows",
            ),
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
                 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
                "Safari · macOS",
            ),
            // Eingebettete Webansicht der Desktop-Hülle unter macOS: kein `Safari/`.
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
                 (KHTML, like Gecko)",
                "Safari · macOS",
            ),
            (
                "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 \
                 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
                "Safari · iPadOS",
            ),
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 \
                 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
                "Chrome · iOS",
            ),
            (
                "Mozilla/5.0 (Linux; Android 14; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) \
                 SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36",
                "Samsung Internet · Android",
            ),
            (
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) \
                 Chrome/129.0.0.0 Mobile Safari/537.36",
                "Chrome · Android",
            ),
            (
                "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
                "Firefox · Linux",
            ),
            ("Mozilla/5.0 (X11; Linux x86_64)", "Linux"),
            ("Firefox/131.0", "Firefox"),
        ];
        for (ua, erwartet) in faelle {
            assert_eq!(aus_user_agent(ua).as_deref(), Some(erwartet), "{ua}");
        }
    }

    #[test]
    fn unbekanntes_bleibt_leer() {
        for ua in ["", "curl/8.5.0", "Playwright", "\u{1F600}"] {
            assert_eq!(aus_user_agent(ua), None, "{ua}");
        }
    }
}
