//! „Im Browser anmelden“ (LFH-818): reine Schritte rund um den Rücksprung aus der
//! `ASWebAuthenticationSession`. Herleitung und Entscheidungen:
//! `openspec/changes/archive/2026-09-30-lfh-818-anmeldung-im-systembrowser/design.md`.
//!
//! Den Code löst die Seite des Servers im Webview ein, weil nur dort der Cookie-Speicher liegt,
//! in dem die Sitzung entstehen muss. Die Hülle reicht Code und `verifier` als JSON-Literale in
//! ein Skript und prüft die Origin zweimal: vorher am Fenster, im Skript noch einmal, weil die
//! Seite zwischen Prüfung und Ausführung wechseln kann.

use url::Url;

use crate::deeplink::SCHEMA;

/// Pfad der Anmeldeseite, auf der die Hülle einlöst.
pub const ANMELDESEITE: &str = "/login";

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
    /// Nichts tun: das Fenster zeigt keine Seite des Servers (bzw. beim Einlösen nicht die
    /// Anmeldeseite), Code und `verifier` bleiben draußen.
    Nichts,
}

/// Entscheidet über das Ende der Sitzung. `ergebnis` ist die Rücksprung-URL oder, ob die Person
/// abgebrochen hat; `seite` die aktuelle Seite des startenden Fensters.
pub fn folge(ergebnis: Result<&str, bool>, seite: Option<&Url>, server: &Url) -> Folge {
    // Weder Code noch Meldung an eine fremde Seite; eine Meldung ohne Geheimnis darf auf jede
    // Seite des Servers, eingelöst wird nur auf der Anmeldeseite.
    let Some(seite) = seite.filter(|seite| origin_passt(seite, server)) else {
        return Folge::Nichts;
    };
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
    // Nur dort hört die Seite auf das Ergebnis. Wer inzwischen auf anderem Weg angemeldet
    // weitergearbeitet hat, verliert seine Sitzung nicht an einen späten Rücksprung.
    if seite.path() == ANMELDESEITE {
        Folge::Einloesen(code)
    } else {
        Folge::Nichts
    }
}

/// Die laufende Sitzung mit ihrer Generation. Ein Handler beendet nur „seine“ Sitzung: der
/// Handler einer ersetzten Sitzung kann nach dem Start der neuen eintreffen und darf diese nicht
/// verwerfen (Review LFH-818).
#[derive(Debug)]
pub struct Lauf<T> {
    generation: u64,
    laufend: Option<(u64, T)>,
}

impl<T> Default for Lauf<T> {
    fn default() -> Self {
        Self {
            generation: 0,
            laufend: None,
        }
    }
}

impl<T> Lauf<T> {
    /// Nächste Generation, bevor die Sitzung gebaut wird (ihr Handler braucht sie).
    pub fn naechste(&mut self) -> u64 {
        self.generation += 1;
        self.generation
    }

    /// Merkt sich die gestartete Sitzung unter `generation`.
    pub fn merke(&mut self, generation: u64, wert: T) {
        self.laufend = Some((generation, wert));
    }

    /// Nimmt die laufende Sitzung heraus, gleich welcher Generation (zum Abbrechen).
    pub fn nimm(&mut self) -> Option<T> {
        self.laufend.take().map(|(_, wert)| wert)
    }

    /// Nimmt die Sitzung nur heraus, wenn sie zu `generation` gehört.
    pub fn beende(&mut self, generation: u64) -> Option<T> {
        match &self.laufend {
            Some((g, _)) if *g == generation => self.nimm(),
            _ => None,
        }
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
    fn ein_alter_handler_beendet_die_neue_sitzung_nicht() {
        let mut lauf = Lauf::default();
        let alt = lauf.naechste();
        lauf.merke(alt, "alt");
        // Neuer Start: die alte Sitzung wird abgebrochen, die neue gemerkt.
        assert_eq!(lauf.nimm(), Some("alt"));
        let neu = lauf.naechste();
        lauf.merke(neu, "neu");
        // Der Abbruch-Handler der alten Sitzung trifft danach ein.
        assert_eq!(lauf.beende(alt), None);
        assert_eq!(lauf.beende(neu), Some("neu"));
        assert_eq!(lauf.beende(neu), None);
    }

    #[test]
    fn folge_nach_dem_ende_der_sitzung() {
        let server = url("https://elw.local:8443/");
        let seite = url("https://elw.local:8443/login");
        let fremd = url("https://id.rubeen.dev/login");
        let andere_seite = url("https://elw.local:8443/einsaetze");
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
        // Eingelöst wird nur auf der Anmeldeseite: dort hört die Seite auf das Ergebnis, und eine
        // inzwischen anders angemeldete Seite verliert ihre Sitzung nicht.
        assert_eq!(
            folge(Ok(&ruecksprung), Some(&andere_seite), &server),
            Folge::Nichts
        );
        // Auch Meldungen gehen nur an eine Seite des Servers.
        assert_eq!(folge(Err(true), Some(&fremd), &server), Folge::Nichts);
        assert_eq!(folge(Err(false), None, &server), Folge::Nichts);
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
