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
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn server() -> Url {
        url("https://elw.local:8443/")
    }

    fn fenster(ziel: &str) -> Ziel {
        entscheide_neues_fenster(Some(&server()), &url(ziel))
    }

    fn navigation(ziel: &str) -> Ziel {
        entscheide_navigation(Some(&server()), &url(ziel))
    }

    #[test]
    fn eigene_seite_oeffnet_ein_nebenfenster() {
        assert_eq!(
            fenster("https://elw.local:8443/einsaetze/1/etb?eintrag=4"),
            Ziel::Nebenfenster
        );
        assert_eq!(fenster("https://elw.local:8443/"), Ziel::Nebenfenster);
    }

    #[test]
    fn dateiroute_der_eigenen_origin_wird_heruntergeladen() {
        let anhang = "https://elw.local:8443/api/einsaetze/1/anhaenge/7";
        assert_eq!(fenster(anhang), Ziel::Download);
        assert_eq!(navigation(anhang), Ziel::Download);
        assert_eq!(
            navigation("https://elw.local:8443/api/einsaetze/1/schaeden/3/anhaenge/2/datei"),
            Ziel::Download
        );
    }

    /// Die OIDC-Anmeldung navigiert im Fenster über diese beiden Routen — ein Download hier
    /// hieße: niemand kommt mehr per OIDC hinein.
    #[test]
    fn anmelderouten_laufen_im_fenster() {
        for pfad in [
            "https://elw.local:8443/api/auth/oidc/start?von=%2Feinsaetze",
            "https://elw.local:8443/api/auth/oidc/callback?code=x&state=y",
        ] {
            assert_eq!(navigation(pfad), Ziel::Huelle, "{pfad}");
            assert_eq!(fenster(pfad), Ziel::Nebenfenster, "{pfad}");
        }
    }

    #[test]
    fn nur_der_pfadanfang_api_zaehlt() {
        assert_eq!(navigation("https://elw.local:8443/apiarchiv"), Ziel::Huelle);
        assert_eq!(
            fenster("https://elw.local:8443/einsaetze/api/1"),
            Ziel::Nebenfenster
        );
        assert_eq!(navigation("https://elw.local:8443/api"), Ziel::Huelle);
    }

    #[test]
    fn fremde_ziele_gehen_ans_system() {
        assert_eq!(fenster("https://www.govdata.de/dl-de/by-2-0"), Ziel::System);
        assert_eq!(fenster("http://example.org/"), Ziel::System);
        assert_eq!(fenster("mailto:lage@example.org"), Ziel::System);
        assert_eq!(fenster("tel:+4930123"), Ziel::System);
    }

    /// Anderer Port oder anderes Schema ist eine fremde Origin — auch auf demselben Host.
    #[test]
    fn origin_heisst_schema_host_und_port() {
        assert_eq!(fenster("https://elw.local/einsaetze"), Ziel::System);
        assert_eq!(fenster("http://elw.local:8443/einsaetze"), Ziel::System);
        assert_eq!(
            fenster("https://elw.local/api/einsaetze/1/anhaenge/7"),
            Ziel::System
        );
        assert_eq!(
            navigation("https://elw.local/api/einsaetze/1/anhaenge/7"),
            Ziel::Huelle
        );
        // Standardport und ausgeschriebener Port sind dieselbe Origin.
        let server = url("https://elw.local/");
        assert_eq!(
            entscheide_neues_fenster(Some(&server), &url("https://elw.local:443/x")),
            Ziel::Nebenfenster
        );
    }

    #[test]
    fn andere_schemata_werden_verworfen() {
        for ziel in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,x",
            "blob:https://elw.local:8443/1b2c",
            "tauri://localhost/index.html",
            "lifeline://verbinden?server=https://boese.example",
            "about:blank",
        ] {
            assert_eq!(fenster(ziel), Ziel::Verwerfen, "{ziel}");
        }
    }

    #[test]
    fn navigation_bleibt_sonst_im_fenster() {
        // Eigene Seiten, der Weg zum Identitätsanbieter, die Maske, leere Seite.
        for ziel in [
            "https://elw.local:8443/einsaetze/1",
            "https://login.example.org/authorize?client_id=x",
            "tauri://localhost/index.html",
            "http://tauri.localhost/index.html",
            "about:blank",
        ] {
            assert_eq!(navigation(ziel), Ziel::Huelle, "{ziel}");
        }
        assert_eq!(navigation("mailto:lage@example.org"), Ziel::System);
        assert_eq!(navigation("tel:+4930123"), Ziel::System);
    }

    /// Der CSV-Export bietet seine Datei als `blob:` der Serverseite an (LFH-914). Erreicht so
    /// eine Navigation den Handler, läuft sie weiter und der Webview lädt herunter.
    #[test]
    fn blob_der_serverseite_bleibt_im_fenster() {
        let blob = "blob:https://elw.local:8443/6f1c2a9e-8d3b-4e7a-9c55-0b1d2e3f4a5b";
        assert_eq!(navigation(blob), Ziel::Huelle);
        assert!(!gehoert_zum_server(&server(), &url(blob)));
    }

    #[test]
    fn nebenfenster_gehoert_zum_server_derselben_origin() {
        let seite = url("https://elw.local:8443/einsaetze/1/lageberichte/3");
        assert!(gehoert_zum_server(&server(), &seite));
        assert!(gehoert_zum_server(
            &url("https://elw.local:8443/einsaetze"),
            &seite
        ));
        assert!(!gehoert_zum_server(
            &url("https://fuekw.local:8443/"),
            &seite
        ));
        assert!(!gehoert_zum_server(&server(), &url("about:blank")));
    }

    /// Ohne verbundenen Server (Erststart-Maske) gibt es keine eigene Origin.
    #[test]
    fn ohne_server_gibt_es_keine_eigene_origin() {
        let ziel = url("https://elw.local:8443/api/einsaetze/1/anhaenge/7");
        assert_eq!(entscheide_navigation(None, &ziel), Ziel::Huelle);
        assert_eq!(entscheide_neues_fenster(None, &ziel), Ziel::System);
        assert_eq!(
            entscheide_navigation(None, &url("tauri://localhost/index.html")),
            Ziel::Huelle
        );
    }
}
