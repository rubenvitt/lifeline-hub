//! Hüllen-Vertrag in der Desktop-Hülle (LLH-1982, Spec `huellen-vertrag`, ADR-0083): vor jedem
//! Laden des Servers fragt die Hülle `GET /api/shell` und lädt die Oberfläche nur, wenn sie den
//! `shell_contract` kennt. Bewertung wie in der iOS-Hülle (`ios/LifelineKern/.../Vertrag.swift`).
//!
//! Der einzige eigene Abruf der Hülle (ADR-0083): anonym, ohne Cookies, nur `/api/shell` und bei
//! 404 `/api/health`. Zertifikate prüft `rustls-platform-verifier` über den Vertrauensspeicher des
//! Systems, wie der Webview. Weiterleitungen nur auf derselben Origin; eine fremde (Captive
//! Portal, Auth-Proxy) beantwortet nicht der Server und gilt wie ohne Verbindung.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

/// Die Hüllen-Verträge, mit denen diese Hülle arbeitet. Ein neuer Wert kommt erst hinzu, wenn die
/// Hülle den Bruch des Servers mitgeht.
pub const BEKANNTE_VERTRAEGE: [u32; 1] = [1];

/// Höchstdauer des Verbindungsaufbaus samt Namensauflösung: ein Server, der gar nicht antwortet,
/// hält den Offline-Start nicht länger auf.
pub const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);

/// Höchstdauer eines Abrufs; ein hängender Server gilt danach wie ohne Verbindung.
pub const TIMEOUT: Duration = Duration::from_secs(5);

/// Antwort von `GET /api/shell` (OpenAPI-Schema `ShellInfo`). Neue Felder ignoriert die Hülle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellInfo {
    pub version: String,
    pub shell_contract: u32,
}

/// Richtung eines unbekannten Vertrags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Richtung {
    /// Der Server kennt keinen oder einen kleineren Vertrag: „Server ist zu alt für diese App“.
    ZuAlt,
    /// Der Server spricht einen größeren Vertrag: „App aktualisieren“.
    ZuNeu,
}

/// Was die Hülle beim Abruf von `GET /api/shell` erlebt hat.
#[derive(Debug, Clone)]
pub enum ShellAbruf {
    /// `content_type` ist der Kopf `Content-Type`, wie er kam.
    Antwort {
        status: u16,
        body: Vec<u8>,
        content_type: Option<String>,
    },
    /// Keine Antwort: keine Verbindung, Zeitlimit, Zertifikat abgelehnt.
    Fehler,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Vertragsergebnis {
    /// Die Hülle lädt die Oberfläche.
    Vertraeglich(ShellInfo),
    /// Die Hülle lädt nicht; `server_version` fehlt, wenn der Server keinen Vertrag nannte oder
    /// nur der zuletzt bestätigte galt.
    NichtVertraeglich {
        richtung: Richtung,
        server_version: Option<String>,
    },
    /// Ohne Verbindung: die Hülle lädt wie bisher (Wache, Offline-Start).
    NichtErreichbar,
}

/// Medientyp `application/json`, gleich mit welchen Parametern.
fn is_json(content_type: Option<&str>) -> bool {
    content_type
        .and_then(|kopf| kopf.split(';').next())
        .is_some_and(|medientyp| medientyp.trim().eq_ignore_ascii_case("application/json"))
}

/// Richtung eines unbekannten Vertrags; `None`, wenn die Hülle ihn kennt.
pub fn richtung(vertrag: u32) -> Option<Richtung> {
    if BEKANNTE_VERTRAEGE.contains(&vertrag) {
        return None;
    }
    let groesster = BEKANNTE_VERTRAEGE.iter().copied().max().unwrap_or(0);
    Some(if vertrag > groesster {
        Richtung::ZuNeu
    } else {
        Richtung::ZuAlt
    })
}

/// Bewertet einen Abruf. `letzter_vertrag` ist der zuletzt bestätigte Vertrag dieses Servers; er
/// gilt ohne Verbindung.
pub fn evaluate(abruf: &ShellAbruf, letzter_vertrag: Option<u32>) -> Vertragsergebnis {
    match abruf {
        ShellAbruf::Antwort {
            status: 200,
            body,
            content_type,
        } if is_json(content_type.as_deref()) => {
            // JSON ohne lesbaren Vertrag ist ein Server ohne Vertrag, also zu alt.
            let Ok(info) = serde_json::from_slice::<ShellInfo>(body) else {
                return Vertragsergebnis::NichtVertraeglich {
                    richtung: Richtung::ZuAlt,
                    server_version: None,
                };
            };
            match richtung(info.shell_contract) {
                Some(richtung) => Vertragsergebnis::NichtVertraeglich {
                    richtung,
                    server_version: Some(info.version),
                },
                None => Vertragsergebnis::Vertraeglich(info),
            }
        }
        // Vom Server selbst: eine fremde Origin erreicht der Abruf nicht.
        ShellAbruf::Antwort { status: 404, .. } => Vertragsergebnis::NichtVertraeglich {
            richtung: Richtung::ZuAlt,
            server_version: None,
        },
        // Proxy, startender Server, fremde Weiterleitung, Captive Portal mit 200 ohne JSON: das
        // ist nicht der Server, also wie ohne Verbindung.
        ShellAbruf::Antwort { .. } | ShellAbruf::Fehler => {
            match letzter_vertrag.and_then(richtung) {
                Some(richtung) => Vertragsergebnis::NichtVertraeglich {
                    richtung,
                    server_version: None,
                },
                None => Vertragsergebnis::NichtErreichbar,
            }
        }
    }
}

/// Die API liegt an der Wurzel des Servers, auch wenn die Adresse einen Pfad trägt.
pub fn endpoint(server: &Url, pfad: &str) -> Url {
    server.join(pfad).unwrap_or_else(|_| server.clone())
}

/// Folgt der Abruf einer Weiterleitung? Nur auf derselben Origin.
pub fn follows_redirect(von: &Url, nach: &Url) -> bool {
    von.origin() == nach.origin()
}

fn client() -> Option<reqwest::Client> {
    // Wie der Updater: ohne gesetzten Provider `ring`, kein zweiter (src-tauri/AGENTS.md).
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|versuch| {
            let erlaubt = versuch
                .previous()
                .first()
                .is_some_and(|start| follows_redirect(start, versuch.url()));
            if erlaubt && versuch.previous().len() < 5 {
                versuch.follow()
            } else {
                versuch.stop()
            }
        }))
        .build()
        .map_err(|fehler| log::warn!("Client für den Hüllen-Vertrag nicht gebaut: {fehler}"))
        .ok()
}

async fn fetch(client: &reqwest::Client, url: Url) -> ShellAbruf {
    let Ok(antwort) = client.get(url).send().await else {
        return ShellAbruf::Fehler;
    };
    let status = antwort.status().as_u16();
    let content_type = antwort
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|kopf| kopf.to_str().ok())
        .map(str::to_string);
    match antwort.bytes().await {
        Ok(body) => ShellAbruf::Antwort {
            status,
            body: body.to_vec(),
            content_type,
        },
        Err(_) => ShellAbruf::Fehler,
    }
}

#[derive(Deserialize)]
struct HealthInfo {
    version: String,
}

/// Fragt `GET /api/shell` und bewertet die Antwort; bei 404 nennt `/api/health` die Version des
/// Servers für die Seite „Server ist zu alt für diese App“.
pub async fn check(server: &Url, letzter_vertrag: Option<u32>) -> Vertragsergebnis {
    let Some(client) = client() else {
        return evaluate(&ShellAbruf::Fehler, letzter_vertrag);
    };
    let abruf = fetch(&client, endpoint(server, "/api/shell")).await;
    let ergebnis = evaluate(&abruf, letzter_vertrag);
    let ShellAbruf::Antwort { status: 404, .. } = abruf else {
        return ergebnis;
    };
    let server_version = match fetch(&client, endpoint(server, "/api/health")).await {
        ShellAbruf::Antwort {
            status: 200, body, ..
        } => serde_json::from_slice::<HealthInfo>(&body)
            .ok()
            .map(|health| health.version),
        _ => None,
    };
    Vertragsergebnis::NichtVertraeglich {
        richtung: Richtung::ZuAlt,
        server_version,
    }
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};

    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn json(body: &str) -> ShellAbruf {
        ShellAbruf::Antwort {
            status: 200,
            body: body.as_bytes().to_vec(),
            content_type: Some("application/json; charset=utf-8".into()),
        }
    }

    fn status(status: u16) -> ShellAbruf {
        ShellAbruf::Antwort {
            status,
            body: Vec::new(),
            content_type: None,
        }
    }

    #[test]
    fn bekannter_vertrag_ist_vertraeglich() {
        assert_eq!(
            evaluate(
                &json(r#"{"version":"1.0.0","shell_contract":1,"neu":true}"#),
                None
            ),
            Vertragsergebnis::Vertraeglich(ShellInfo {
                version: "1.0.0".into(),
                shell_contract: 1,
            })
        );
    }

    #[test]
    fn groesserer_vertrag_heisst_app_aktualisieren() {
        assert_eq!(
            evaluate(&json(r#"{"version":"9","shell_contract":2}"#), None),
            Vertragsergebnis::NichtVertraeglich {
                richtung: Richtung::ZuNeu,
                server_version: Some("9".into()),
            }
        );
    }

    #[test]
    fn kleinerer_vertrag_heisst_server_zu_alt() {
        assert_eq!(richtung(0), Some(Richtung::ZuAlt));
        assert_eq!(richtung(1), None);
        assert_eq!(
            evaluate(&json(r#"{"version":"0.1","shell_contract":0}"#), None),
            Vertragsergebnis::NichtVertraeglich {
                richtung: Richtung::ZuAlt,
                server_version: Some("0.1".into()),
            }
        );
    }

    #[test]
    fn json_ohne_lesbaren_vertrag_ist_zu_alt() {
        assert_eq!(
            evaluate(&json(r#"{"version":"1"}"#), None),
            Vertragsergebnis::NichtVertraeglich {
                richtung: Richtung::ZuAlt,
                server_version: None,
            }
        );
    }

    #[test]
    fn status_404_ist_zu_alt() {
        assert_eq!(
            evaluate(&status(404), Some(1)),
            Vertragsergebnis::NichtVertraeglich {
                richtung: Richtung::ZuAlt,
                server_version: None,
            }
        );
    }

    #[test]
    fn html_mit_200_gilt_wie_ohne_verbindung() {
        let portal = ShellAbruf::Antwort {
            status: 200,
            body: b"<html>Anmelden</html>".to_vec(),
            content_type: Some("text/html".into()),
        };
        assert_eq!(evaluate(&portal, None), Vertragsergebnis::NichtErreichbar);
        assert_eq!(
            evaluate(&portal, Some(1)),
            Vertragsergebnis::NichtErreichbar
        );
    }

    #[test]
    fn fehler_ohne_gemerkten_vertrag_ist_nicht_erreichbar() {
        for abruf in [ShellAbruf::Fehler, status(503), status(302)] {
            assert_eq!(evaluate(&abruf, None), Vertragsergebnis::NichtErreichbar);
        }
    }

    #[test]
    fn ohne_verbindung_gilt_der_gemerkte_vertrag() {
        assert_eq!(
            evaluate(&ShellAbruf::Fehler, Some(2)),
            Vertragsergebnis::NichtVertraeglich {
                richtung: Richtung::ZuNeu,
                server_version: None,
            }
        );
        assert_eq!(
            evaluate(&ShellAbruf::Fehler, Some(1)),
            Vertragsergebnis::NichtErreichbar
        );
    }

    #[test]
    fn endpunkt_liegt_an_der_wurzel() {
        assert_eq!(
            endpoint(&url("https://elw.local:8443/pfad/"), "/api/shell").as_str(),
            "https://elw.local:8443/api/shell"
        );
    }

    #[test]
    fn fremde_weiterleitung_wird_nicht_verfolgt() {
        let shell = url("https://elw.local:8443/api/shell");
        assert!(follows_redirect(
            &shell,
            &url("https://ELW.local:8443/api/shell/")
        ));
        for fremd in [
            "https://portal.example/login",
            "http://elw.local:8443/api/shell",
            "https://elw.local:8444/api/shell",
        ] {
            assert!(!follows_redirect(&shell, &url(fremd)), "{fremd}");
        }
    }

    /// Beantwortet je Verbindung eine Anfrage: `/api/shell` mit 404, `/api/health` mit JSON.
    fn server_ohne_vertrag() -> u16 {
        let lauscher = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = lauscher.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for strom in lauscher.incoming().flatten() {
                let mut zeile = String::new();
                let mut leser = BufReader::new(strom.try_clone().unwrap());
                leser.read_line(&mut zeile).unwrap();
                // Kopfzeilen bis zur Leerzeile überlesen.
                let mut kopf = String::new();
                while leser.read_line(&mut kopf).unwrap_or(0) > 2 {
                    kopf.clear();
                }
                let antwort = if zeile.starts_with("GET /api/health ") {
                    let body = r#"{"status":"ok","version":"0.9.0"}"#;
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                } else {
                    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        .to_string()
                };
                let mut strom = strom;
                let _ = strom.write_all(antwort.as_bytes());
            }
        });
        port
    }

    #[test]
    fn abruf_folgt_404_zur_health_version() {
        let port = server_ohne_vertrag();
        let ergebnis =
            tauri::async_runtime::block_on(check(&url(&format!("http://127.0.0.1:{port}/")), None));
        assert_eq!(
            ergebnis,
            Vertragsergebnis::NichtVertraeglich {
                richtung: Richtung::ZuAlt,
                server_version: Some("0.9.0".into()),
            }
        );
    }

    #[test]
    fn abruf_eines_geschlossenen_ports_ist_nicht_erreichbar() {
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let start = Instant::now();
        let ergebnis = tauri::async_runtime::block_on(check(
            &url(&format!("https://127.0.0.1:{port}/")),
            None,
        ));
        assert_eq!(ergebnis, Vertragsergebnis::NichtErreichbar);
        assert!(start.elapsed() < Duration::from_secs(3));
    }
}
