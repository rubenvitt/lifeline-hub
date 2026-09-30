//! „Im Browser anmelden“ (LFH-818): reine Schritte rund um den Rücksprung aus der
//! `ASWebAuthenticationSession`. Herleitung und Entscheidungen:
//! `openspec/changes/lfh-818-anmeldung-im-systembrowser/design.md`.
//!
//! Den Code löst die Seite des Servers im Webview ein, weil nur dort der Cookie-Speicher liegt,
//! in dem die Sitzung entstehen muss. Die Hülle reicht Code und `verifier` als JSON-Literale in
//! ein Skript und prüft die Origin zweimal: vorher am Fenster, im Skript noch einmal, weil die
//! Seite zwischen Prüfung und Ausführung wechseln kann.

use url::Url;

use crate::deeplink::SCHEMA;

/// Pfad der Bestätigungsseite im Browser.
pub const BESTAETIGUNG: &str = "/app-anmeldung";

/// Ereignis, mit dem die Hülle der Anmeldeseite das Ergebnis meldet. Es trägt nie Code oder
/// `verifier`, nur eines von `angemeldet`, `abgelehnt`, `fehler`, `abgebrochen`.
pub const EREIGNIS: &str = "lifeline:app-anmeldung";

/// Adresse der Bestätigungsseite auf `server` mit der `challenge`.
pub fn bestaetigung_url(server: &Url, challenge: &str) -> Url {
    let mut ziel = server.clone();
    ziel.set_path(BESTAETIGUNG);
    ziel.set_fragment(None);
    ziel.query_pairs_mut()
        .clear()
        .append_pair("challenge", challenge);
    ziel
}

/// Liest den Code aus dem Rücksprung `lifeline://anmeldung?code=<64 hex>`; alles andere `None`.
pub fn anmeldecode_aus(ruecksprung: &Url) -> Option<String> {
    // Bei einem Nicht-Standard-Schema ist `anmeldung` der Host (wie `verbinden` in `deeplink`).
    if ruecksprung.scheme() != SCHEMA
        || ruecksprung.host_str() != Some("anmeldung")
        || !matches!(ruecksprung.path(), "" | "/")
    {
        return None;
    }
    let (_, code) = ruecksprung.query_pairs().find(|(k, _)| k == "code")?;
    let gueltig = code.len() == 64 && code.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'));
    gueltig.then(|| code.into_owned())
}

/// Ob das Fenster gerade eine Seite des Servers zeigt, gegen den eingelöst wird.
pub fn origin_passt(seite: &Url, server: &Url) -> bool {
    let origin = seite.origin();
    origin.is_tuple() && origin == server.origin()
}

/// Skript, das den Code im Webview einlöst und das Ergebnis als [`EREIGNIS`] meldet.
pub fn einloese_skript(server: &Url, code: &str, verifier: &str) -> String {
    let literal = |s: &str| serde_json::to_string(s).expect("Text als JSON-Literal");
    let origin = literal(&server.origin().ascii_serialization());
    let (code, verifier, ereignis) = (literal(code), literal(verifier), literal(EREIGNIS));
    format!(
        "(() => {{ const melden = (ergebnis) => window.dispatchEvent(new CustomEvent({ereignis}, \
         {{ detail: {{ ergebnis }} }})); if (window.location.origin !== {origin}) return; \
         fetch('/api/auth/app-code/einloesen', {{ method: 'POST', credentials: 'same-origin', \
         headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({{ code: {code}, \
         verifier: {verifier} }}) }}).then((antwort) => melden(antwort.ok ? 'angemeldet' : \
         antwort.status === 401 ? 'abgelehnt' : 'fehler')).catch(() => melden('fehler')); }})();"
    )
}

/// Skript, das nur ein Ergebnis meldet (Abbruch, Fehler vor dem Einlösen).
pub fn meldung_skript(ergebnis: &str) -> String {
    let literal = |s: &str| serde_json::to_string(s).expect("Text als JSON-Literal");
    format!(
        "window.dispatchEvent(new CustomEvent({}, {{ detail: {{ ergebnis: {} }} }}));",
        literal(EREIGNIS),
        literal(ergebnis)
    )
}

/// Was nach dem Ende der Sitzung geschieht.
#[derive(Debug, PartialEq, Eq)]
pub enum Folge {
    /// Den Code im Fenster einlösen.
    Einloesen(String),
    /// Nur ein Ergebnis melden, ohne Geheimnis.
    Melden(&'static str),
    /// Nichts tun: das Fenster zeigt keine Seite des Servers, Code und `verifier` bleiben draußen.
    Nichts,
}

/// Entscheidet über das Ende der Sitzung. `ergebnis` ist die Rücksprung-URL oder, ob die Person
/// abgebrochen hat; `seite` die aktuelle Seite des startenden Fensters.
pub fn folge(ergebnis: Result<&str, bool>, seite: Option<&Url>, server: &Url) -> Folge {
    let ruecksprung = match ergebnis {
        Err(true) => return Folge::Melden("abgebrochen"),
        Err(false) => return Folge::Melden("fehler"),
        Ok(ruecksprung) => ruecksprung,
    };
    let Some(code) = Url::parse(ruecksprung)
        .ok()
        .as_ref()
        .and_then(anmeldecode_aus)
    else {
        return Folge::Melden("fehler");
    };
    match seite {
        Some(seite) if origin_passt(seite, server) => Folge::Einloesen(code),
        _ => Folge::Nichts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    const CODE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn bestaetigung_liegt_auf_der_origin_des_servers() {
        let server = url("https://elw.local:8443/einsaetze/1?q=x");
        assert_eq!(
            bestaetigung_url(&server, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM").as_str(),
            "https://elw.local:8443/app-anmeldung?challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn code_nur_aus_dem_anmelde_ruecksprung() {
        assert_eq!(
            anmeldecode_aus(&url(&format!("lifeline://anmeldung?code={CODE}"))),
            Some(CODE.to_string())
        );
        for fremd in [
            format!("lifeline://verbinden?code={CODE}"),
            format!("andere://anmeldung?code={CODE}"),
            format!("lifeline://anmeldung/x?code={CODE}"),
            "lifeline://anmeldung?code=abc".to_string(),
            format!("lifeline://anmeldung?code={}", CODE.to_uppercase()),
            "lifeline://anmeldung".to_string(),
        ] {
            assert_eq!(anmeldecode_aus(&url(&fremd)), None, "{fremd}");
        }
    }

    #[test]
    fn origin_muss_genau_passen() {
        let server = url("https://elw.local:8443/");
        assert!(origin_passt(
            &url("https://elw.local:8443/login?x=1"),
            &server
        ));
        assert!(!origin_passt(&url("https://elw.local:9443/login"), &server));
        assert!(!origin_passt(&url("https://id.rubeen.dev/login"), &server));
        assert!(!origin_passt(&url("http://elw.local:8443/login"), &server));
        assert!(!origin_passt(&url("tauri://localhost/index.html"), &server));
    }

    #[test]
    fn einloese_skript_kodiert_und_prueft_die_origin() {
        let server = url("https://elw.local:8443/");
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let skript = einloese_skript(&server, CODE, verifier);
        assert!(
            skript.contains(r#"window.location.origin !== "https://elw.local:8443""#),
            "{skript}"
        );
        assert!(skript.contains("/api/auth/app-code/einloesen"), "{skript}");
        assert!(skript.contains(&format!(r#"code: "{CODE}""#)), "{skript}");
        assert!(
            skript.contains(&format!(r#"verifier: "{verifier}""#)),
            "{skript}"
        );
        // Code und verifier stehen je genau einmal darin: im Anfragekörper, nicht im Ereignis.
        assert_eq!(skript.matches(CODE).count(), 1);
        assert_eq!(skript.matches(verifier).count(), 1);
        assert!(skript.contains(EREIGNIS));
        assert!(!skript.contains('\n'), "{skript}");
    }

    #[test]
    fn literale_brechen_nicht_aus() {
        let server = url("https://elw.local:8443/");
        let skript = einloese_skript(&server, "a\"b'c\\d", "x\"); alert(1); (\"");
        assert!(skript.contains(r#"code: "a\"b'c\\d""#), "{skript}");
        assert!(!skript.contains(r#"x"); alert"#), "{skript}");
    }

    #[test]
    fn folge_nach_dem_ende_der_sitzung() {
        let server = url("https://elw.local:8443/");
        let seite = url("https://elw.local:8443/login");
        let fremd = url("https://id.rubeen.dev/login");
        let ruecksprung = format!("lifeline://anmeldung?code={CODE}");

        assert_eq!(
            folge(Ok(&ruecksprung), Some(&seite), &server),
            Folge::Einloesen(CODE.to_string())
        );
        assert_eq!(
            folge(Ok(&ruecksprung), Some(&fremd), &server),
            Folge::Nichts
        );
        assert_eq!(folge(Ok(&ruecksprung), None, &server), Folge::Nichts);
        assert_eq!(
            folge(
                Ok("lifeline://anmeldung?code=kaputt"),
                Some(&seite),
                &server
            ),
            Folge::Melden("fehler")
        );
        assert_eq!(
            folge(Err(true), Some(&seite), &server),
            Folge::Melden("abgebrochen")
        );
        assert_eq!(
            folge(Err(false), Some(&seite), &server),
            Folge::Melden("fehler")
        );
    }

    #[test]
    fn meldung_traegt_nur_das_ergebnis() {
        let skript = meldung_skript("abgebrochen");
        assert!(skript.contains(EREIGNIS));
        assert!(skript.contains(r#"ergebnis: "abgebrochen""#), "{skript}");
        assert!(!skript.contains("fetch"));
    }
}
