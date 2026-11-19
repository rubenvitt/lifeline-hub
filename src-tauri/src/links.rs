//! Was mit einer URL geschieht, die ein neues Fenster verlangt oder das Fenster wegnavigiert
//! (LFH-782, desktop-huelle: „Neue Fenster und fremde Links laufen nicht ins Leere“).
//!
//! Zwei reine Entscheidungen; `main.rs` bindet sie an `on_new_window`/`on_navigation`. Der
//! Server geht bei jedem Aufruf frisch hinein — er wechselt zur Laufzeit (Maske, Deeplink).
//!
//! Dateirouten erkennt die Hülle am Pfad `/api/`, nicht an der Antwort: `on_navigation` sieht
//! nur die URL. `/api/` ist nie eine Anwendungsseite; einzige Ausnahme sind die Anmelderouten
//! `/api/auth/` (OIDC-Start und -Rücksprung laufen im Fenster). Eine weitere `/api/`-Route, die
//! als Seite laufen soll, braucht hier eine eigene Ausnahme.
//!
//! Exporte, die die Seite selbst lädt und als `blob:` mit `<a download>` anbietet (CSV auf
//! Betroffene und Tiere, `frontend/src/components/dateiSpeichern.ts`), kommen hier nicht vorbei
//! (LFH-914, gelesen in wry 0.57): WKWebView meldet `shouldPerformDownload` und wry gibt sie vor
//! jeder Navigationsentscheidung als Download frei, WebView2 startet sie als `DownloadStarting`.
//! Beide landen in `on_download` mit dem Namen aus `download`. Eine `blob:`-Navigation, die doch
//! hier ankommt, darf deshalb nicht verworfen werden: sie bliebe sonst stumm.

use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ziel {
    /// Die Navigation läuft im Fenster wie angefordert.
    Huelle,
    /// Ein weiteres Fenster der Hülle mit dem Ziel.
    Nebenfenster,
    /// Die Datei wird heruntergeladen; die angezeigte Seite bleibt.
    Download,
    /// Standardbrowser bzw. zuständiges Systemprogramm (`mailto:`, `tel:`).
    System,
    /// Nichts öffnen, nur protokollieren.
    Verwerfen,
}

/// Gleiche Origin wie der verbundene Server. Das Schema wird eigens verlangt: `blob:` erbt die
/// Origin der Seite, die ihn erzeugt hat, ist aber keine Adresse, die ein Fenster laden kann.
fn eigene_origin(server: Option<&Url>, ziel: &Url) -> bool {
    matches!(ziel.scheme(), "http" | "https")
        && server.is_some_and(|server| server.origin() == ziel.origin())
}

fn ist_dateiroute(ziel: &Url) -> bool {
    let pfad = ziel.path();
    pfad.starts_with("/api/") && !pfad.starts_with("/api/auth/")
}

/// Zeigt `seite` noch den Server `server`? Beim Verbinden bleiben nur Nebenfenster offen, für die
/// das gilt — ein Abbrechen oder erneutes Verbinden mit derselben Adresse schließt nichts.
pub fn gehoert_zum_server(server: &Url, seite: &Url) -> bool {
    eigene_origin(Some(server), seite)
}

/// `window.open` bzw. `target="_blank"`.
pub fn entscheide_neues_fenster(server: Option<&Url>, ziel: &Url) -> Ziel {
    if eigene_origin(server, ziel) {
        return if ist_dateiroute(ziel) {
            Ziel::Download
        } else {
            Ziel::Nebenfenster
        };
    }
    match ziel.scheme() {
        "http" | "https" | "mailto" | "tel" => Ziel::System,
        _ => Ziel::Verwerfen,
    }
}

/// Navigation im bestehenden Fenster. Fremde `http(s)`-Ziele bleiben erlaubt: die Anmeldung
/// beim Identitätsanbieter läuft dort, und die Hülle kennt den Anbieter nicht.
pub fn entscheide_navigation(server: Option<&Url>, ziel: &Url) -> Ziel {
    if eigene_origin(server, ziel) && ist_dateiroute(ziel) {
        return Ziel::Download;
    }
    match ziel.scheme() {
        "mailto" | "tel" => Ziel::System,
        _ => Ziel::Huelle,
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    /// Gemeinsame Fälle beider Hüllen (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“): dieselbe
    /// Datei prüft der Swift-Kern der iOS-Hülle (`ios/LifelineKern`).
    const FAELLE: &str = include_str!("../faelle/links.json");

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Datei {
        #[allow(dead_code)]
        zweck: String,
        neues_fenster: Vec<ZielFall>,
        navigation: Vec<ZielFall>,
        gehoert_zum_server: Vec<ServerFall>,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct ZielFall {
        beschreibung: String,
        server: Option<String>,
        ziel: String,
        erwartet: String,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct ServerFall {
        beschreibung: String,
        server: String,
        seite: String,
        erwartet: bool,
    }

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn datei() -> Datei {
        serde_json::from_str(FAELLE).expect("faelle/links.json ist lesbar")
    }

    /// Kennwort eines Ziels in den gemeinsamen Fällen.
    fn kennwort(ziel: Ziel) -> &'static str {
        match ziel {
            Ziel::Huelle => "huelle",
            Ziel::Nebenfenster => "nebenfenster",
            Ziel::Download => "download",
            Ziel::System => "system",
            Ziel::Verwerfen => "verwerfen",
        }
    }

    fn pruefe(faelle: Vec<ZielFall>, entscheide: fn(Option<&Url>, &Url) -> Ziel) {
        for fall in faelle {
            let server = fall.server.as_deref().map(url);
            assert_eq!(
                kennwort(entscheide(server.as_ref(), &url(&fall.ziel))),
                fall.erwartet,
                "{}",
                fall.beschreibung
            );
        }
    }

    #[test]
    fn jeder_gemeinsame_fall_fuer_neue_fenster_gilt() {
        let faelle = datei().neues_fenster;
        assert!(faelle.len() >= 22, "nur {} Fälle gelesen", faelle.len());
        pruefe(faelle, entscheide_neues_fenster);
    }

    #[test]
    fn jeder_gemeinsame_fall_fuer_die_navigation_gilt() {
        let faelle = datei().navigation;
        assert!(faelle.len() >= 17, "nur {} Fälle gelesen", faelle.len());
        pruefe(faelle, entscheide_navigation);
    }

    #[test]
    fn jeder_gemeinsame_fall_fuer_die_zugehoerigkeit_gilt() {
        let faelle = datei().gehoert_zum_server;
        assert!(faelle.len() >= 5, "nur {} Fälle gelesen", faelle.len());
        for fall in faelle {
            assert_eq!(
                gehoert_zum_server(&url(&fall.server), &url(&fall.seite)),
                fall.erwartet,
                "{}",
                fall.beschreibung
            );
        }
    }

    #[test]
    fn jedes_ziel_hat_einen_fall() {
        let datei = datei();
        let alle = [
            Ziel::Huelle,
            Ziel::Nebenfenster,
            Ziel::Download,
            Ziel::System,
            Ziel::Verwerfen,
        ];
        for ziel in alle {
            assert!(
                datei
                    .neues_fenster
                    .iter()
                    .chain(&datei.navigation)
                    .any(|fall| fall.erwartet == kennwort(ziel)),
                "kein Fall für {ziel:?}"
            );
        }
    }
}
