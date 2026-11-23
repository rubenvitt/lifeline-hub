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
///
/// Verlauf: 1 mit LLH-1982; nur 2 mit LLH-1979, weil die Hülle seither
/// `/api/auth/app-code/redeem` ruft, den ein Server mit Vertrag 1 nicht kennt (ADR-0085).
pub const BEKANNTE_VERTRAEGE: [u32; 1] = [2];

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

/// Richtung eines unbekannten Vertrags; `None`, wenn die Hülle ihn kennt (`bekannt`).
fn richtung(vertrag: u32, bekannt: &[u32]) -> Option<Richtung> {
    if bekannt.contains(&vertrag) {
        return None;
    }
    let groesster = bekannt.iter().copied().max().unwrap_or(0);
    Some(if vertrag > groesster {
        Richtung::ZuNeu
    } else {
        Richtung::ZuAlt
    })
}

/// Bewertet einen Abruf. `letzter_vertrag` ist der zuletzt bestätigte Vertrag dieses Servers; er
/// gilt ohne Verbindung.
pub fn evaluate(abruf: &ShellAbruf, letzter_vertrag: Option<u32>) -> Vertragsergebnis {
    evaluate_mit(abruf, letzter_vertrag, &BEKANNTE_VERTRAEGE)
}

/// [`evaluate`] gegen die Verträge `bekannt` statt die der Hülle; so prüfen die gemeinsamen Fälle
/// (`faelle/vertrag.json`) auch Hüllen mit anderen Verträgen, wie `Vertragspruefung.evaluate`.
fn evaluate_mit(
    abruf: &ShellAbruf,
    letzter_vertrag: Option<u32>,
    bekannt: &[u32],
) -> Vertragsergebnis {
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
            match richtung(info.shell_contract, bekannt) {
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
            match letzter_vertrag.and_then(|vertrag| richtung(vertrag, bekannt)) {
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

    use serde::Deserialize;

    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    /// Gemeinsame Fälle beider Hüllen (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“): dieselbe
    /// Datei prüft der Swift-Kern der iOS-Hülle (`ios/LifelineKern`).
    const FAELLE: &str = include_str!("../faelle/vertrag.json");

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Datei {
        #[allow(dead_code)]
        zweck: String,
        bekannt: Vec<u32>,
        bewerte: Vec<BewerteFall>,
        weiterleitung: Vec<WeiterleitungFall>,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct BewerteFall {
        beschreibung: String,
        abruf: Abruf,
        letzter_vertrag: Option<u32>,
        bekannt: Option<Vec<u32>>,
        ergebnis: String,
        server_version: Option<String>,
        shell_contract: Option<u32>,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields, untagged)]
    enum Abruf {
        Antwort {
            status: u16,
            content_type: Option<String>,
            koerper: String,
        },
        Fehler {
            #[allow(dead_code)]
            fehler: bool,
        },
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct WeiterleitungFall {
        beschreibung: String,
        von: String,
        nach: String,
        folgt: bool,
    }

    fn datei() -> Datei {
        serde_json::from_str(FAELLE).expect("faelle/vertrag.json ist lesbar")
    }

    #[test]
    fn jeder_gemeinsame_fall_von_bewerte_gilt() {
        let datei = datei();
        assert!(
            datei.bewerte.len() >= 20,
            "nur {} Fälle gelesen",
            datei.bewerte.len()
        );
        for fall in datei.bewerte {
            let abruf = match fall.abruf {
                Abruf::Antwort {
                    status,
                    content_type,
                    koerper,
                } => ShellAbruf::Antwort {
                    status,
                    body: koerper.into_bytes(),
                    content_type,
                },
                Abruf::Fehler { .. } => ShellAbruf::Fehler,
            };
            let bekannt = fall.bekannt.as_deref().unwrap_or(&datei.bekannt);
            let soll = match fall.ergebnis.as_str() {
                "vertraeglich" => Vertragsergebnis::Vertraeglich(ShellInfo {
                    version: fall.server_version.clone().expect("server_version"),
                    shell_contract: fall.shell_contract.expect("shell_contract"),
                }),
                "zu_alt" => Vertragsergebnis::NichtVertraeglich {
                    richtung: Richtung::ZuAlt,
                    server_version: fall.server_version.clone(),
                },
                "zu_neu" => Vertragsergebnis::NichtVertraeglich {
                    richtung: Richtung::ZuNeu,
                    server_version: fall.server_version.clone(),
                },
                "nicht_erreichbar" => Vertragsergebnis::NichtErreichbar,
                anderes => panic!("{}: unbekanntes Ergebnis {anderes}", fall.beschreibung),
            };
            assert_eq!(
                evaluate_mit(&abruf, fall.letzter_vertrag, bekannt),
                soll,
                "{}",
                fall.beschreibung
            );
        }
    }

    #[test]
    fn jeder_gemeinsame_fall_von_weiterleitung_gilt() {
        let faelle = datei().weiterleitung;
        assert!(faelle.len() >= 5, "nur {} Fälle gelesen", faelle.len());
        for fall in faelle {
            assert_eq!(
                follows_redirect(&url(&fall.von), &url(&fall.nach)),
                fall.folgt,
                "{}",
                fall.beschreibung
            );
        }
    }

    /// Die Liste der gemeinsamen Fälle ist die der Hülle; `evaluate` prüft gegen sie.
    #[test]
    fn die_huelle_kennt_die_vertraege_der_gemeinsamen_faelle() {
        assert_eq!(BEKANNTE_VERTRAEGE.as_slice(), datei().bekannt.as_slice());
        let abruf = ShellAbruf::Antwort {
            status: 200,
            body: br#"{"version":"2.0.0","shell_contract":2}"#.to_vec(),
            content_type: Some("application/json".into()),
        };
        assert_eq!(
            evaluate(&abruf, None),
            evaluate_mit(&abruf, None, &BEKANNTE_VERTRAEGE)
        );
    }

    #[test]
    fn endpunkt_liegt_an_der_wurzel() {
        assert_eq!(
            endpoint(&url("https://elw.local:8443/pfad/"), "/api/shell").as_str(),
            "https://elw.local:8443/api/shell"
        );
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
