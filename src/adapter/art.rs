//! Adapterarten: was eine Anbindung (Divera, HiOrg, Postfach …) dem Rahmen sagt und tut
//! (LLH-2017, Design-Doc „Adapter und Arten“).
//!
//! Eine Art nennt ihre Geheimnis-Plätze und Einstellungsfelder, ihr Intervall und ruft in zwei
//! Phasen ab: [`AdapterArt::abrufen`] nur über das Netz, ohne Datenbank; die gelieferte
//! [`Uebernahme`] danach nur in der Datenbank, ohne Netz, in einer Transaktion. Beim Probelauf
//! („Verbindung prüfen“) entfällt die zweite Phase.

use std::sync::Arc;

use futures::future::BoxFuture;
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::SqliteConnection;
use utoipa::ToSchema;

use super::repo::Adapter;
use super::ziel::AbrufKontext;
use super::zustand::AdapterFehler;
use crate::error::AppError;
use crate::public_api::webhook::ziel::check_url;
use crate::wire_enum::wire_enum;

/// Höchstlänge eines Textfelds einer Einstellung, wenn die Art keine kleinere nennt.
pub const EINSTELLUNG_MAX: usize = 2048;

/// Ein Platz für ein Geheimnis, den die Art festlegt (etwa `accesskey`).
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
pub struct Platz {
    pub name: &'static str,
    pub bezeichnung: &'static str,
    pub pflicht: bool,
}

wire_enum! {
    /// Typ eines Einstellungsfelds.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum FeldTyp {
        Text => "text",
        Zahl => "zahl",
        /// Eine `https`-URL; sie besteht den Zielschutz (LAN nur mit Ausnahme).
        Url => "url",
    }
}

/// Ein Einstellungsfeld der Art. Nichts Geheimes: das gehört in einen [`Platz`].
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
pub struct Feld {
    pub name: &'static str,
    pub bezeichnung: &'static str,
    pub typ: FeldTyp,
    pub pflicht: bool,
    /// Höchstlänge in Zeichen (Text, URL).
    pub max: usize,
}

/// Ein gescheiterter Abruf: Fehlercode und, falls das Ziel antwortete, sein Status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fehlschlag {
    pub art: AdapterFehler,
    pub status: Option<u16>,
}

impl Fehlschlag {
    pub fn new(art: AdapterFehler) -> Self {
        Fehlschlag { art, status: None }
    }
}

impl From<AdapterFehler> for Fehlschlag {
    fn from(art: AdapterFehler) -> Self {
        Fehlschlag::new(art)
    }
}

/// Was ein Abruf in den Vertrag der Art schreibt (zweite Phase).
pub trait Uebernahme: Send + Sync {
    /// Wie viele Einträge der Abruf brachte (für Zustand und Probelauf).
    fn anzahl(&self) -> i64;

    /// Schreibt in den Vertrag der Art, in der Transaktion des Laufs; liefert, wie viele Einträge
    /// neu oder geändert sind. Kein Netz. Kann bei einer belegten Datenbank mehrmals laufen
    /// (`write_retry!`), deshalb `&self`.
    fn uebernehmen<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        adapter: &'a Adapter,
    ) -> BoxFuture<'a, Result<i64, AppError>>;
}

/// Eine Übernahme, die nichts schreibt (Arten ohne Vertrag, Tests).
pub struct OhneUebernahme(pub i64);

impl Uebernahme for OhneUebernahme {
    fn anzahl(&self) -> i64 {
        self.0
    }

    fn uebernehmen<'a>(
        &'a self,
        _conn: &'a mut SqliteConnection,
        _adapter: &'a Adapter,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move { Ok(self.0) })
    }
}

/// Eine Adapterart. Ruft nur über den [`AbrufKontext`] ab (Client, Zielschutz, Deckel).
pub trait AdapterArt: Send + Sync + 'static {
    /// Code der Art, wie er in `adapter.art` steht (`divera`, …).
    fn code(&self) -> &'static str;
    fn bezeichnung(&self) -> &'static str;
    fn plaetze(&self) -> &'static [Platz];
    fn felder(&self) -> &'static [Feld];
    /// Kürzestes erlaubtes Intervall in Sekunden.
    fn intervall_min_s(&self) -> i64;
    /// Vorschlag beim Anlegen.
    fn intervall_vorschlag_s(&self) -> i64;

    /// Prüfung über die Felder hinaus (Kombinationen); Meldung für die Verwaltung (400).
    fn check_extra(&self, _einstellungen: &Map<String, Value>) -> Result<(), String> {
        Ok(())
    }

    /// Erste Phase: abrufen, nur Netz. Liefert die Übernahme für die zweite Phase.
    fn abrufen<'a>(
        &'a self,
        kontext: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>>;
}

/// Prüft Einstellungen gegen die Felder der Art: keine unbekannten Felder, Pflichtfelder da,
/// Typ und Länge passen, URLs bestehen den Zielschutz. Liefert die bereinigten Einstellungen
/// (Text getrimmt, leere optionale Felder entfernt) oder eine Meldung für die Verwaltung (400).
pub fn check_einstellungen(
    art: &dyn AdapterArt,
    roh: &Map<String, Value>,
    lan_erlaubt: bool,
) -> Result<Map<String, Value>, String> {
    let felder = art.felder();
    if let Some(unbekannt) = roh
        .keys()
        .find(|k| !felder.iter().any(|f| f.name == k.as_str()))
    {
        return Err(format!("einstellungen: unbekanntes Feld „{unbekannt}“"));
    }
    let mut sauber = Map::new();
    for feld in felder {
        let wert = roh.get(feld.name).filter(|w| !w.is_null());
        let wert = match (feld.typ, wert) {
            (_, None) => None,
            (FeldTyp::Zahl, Some(w)) => Some(
                w.as_i64()
                    .map(Value::from)
                    .ok_or_else(|| format!("{}: muss eine ganze Zahl sein", feld.bezeichnung))?,
            ),
            (FeldTyp::Text | FeldTyp::Url, Some(w)) => {
                let text = w
                    .as_str()
                    .ok_or_else(|| format!("{}: muss Text sein", feld.bezeichnung))?
                    .trim();
                if text.is_empty() {
                    None
                } else {
                    let max = if feld.max == 0 {
                        EINSTELLUNG_MAX
                    } else {
                        feld.max.min(EINSTELLUNG_MAX)
                    };
                    if text.chars().count() > max {
                        return Err(format!(
                            "{} darf höchstens {max} Zeichen lang sein",
                            feld.bezeichnung
                        ));
                    }
                    if feld.typ == FeldTyp::Url {
                        check_url(text, lan_erlaubt)
                            .map_err(|f| format!("{}: {}", feld.bezeichnung, f.text()))?;
                    }
                    Some(Value::from(text))
                }
            }
        };
        match wert {
            Some(w) => {
                sauber.insert(feld.name.to_string(), w);
            }
            None if feld.pflicht => {
                return Err(format!("{}: Pflichtfeld", feld.bezeichnung));
            }
            None => {}
        }
    }
    art.check_extra(&sauber)?;
    Ok(sauber)
}

/// Ob eine Änderung der Einstellungen ein neues Ziel einträgt: eine URL, deren Host vorher ein
/// anderer war oder fehlte. Dann gehen die gespeicherten Geheimnisse nicht mehr mit, sie werden
/// entfernt (Entscheidung Ruben, 21.11.2026): sonst schickte „Verbindung prüfen“ ein Geheimnis,
/// das jemand anderes gesetzt hat, an einen frei gewählten Server.
pub fn has_neues_ziel(
    art: &dyn AdapterArt,
    vorher: &Map<String, Value>,
    nachher: &Map<String, Value>,
) -> bool {
    let host = |m: &Map<String, Value>, name: &str| {
        m.get(name)
            .and_then(Value::as_str)
            .and_then(crate::public_api::webhook::ziel::host_von)
            .map(|h| h.to_ascii_lowercase())
    };
    art.felder()
        .iter()
        .filter(|f| f.typ == FeldTyp::Url)
        .any(|f| {
            let neu = host(nachher, f.name);
            neu.is_some() && neu != host(vorher, f.name)
        })
}

/// Die Arten, die dieser Server kennt. In Produktion leer, bis die erste Art kommt (LLH-1193);
/// Tests bringen ihre eigene mit.
#[derive(Clone, Default)]
pub struct Verzeichnis(Arc<[Arc<dyn AdapterArt>]>);

impl std::fmt::Debug for Verzeichnis {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list()
            .entries(self.0.iter().map(|a| a.code()))
            .finish()
    }
}

impl Verzeichnis {
    pub fn new(arten: Vec<Arc<dyn AdapterArt>>) -> Self {
        Verzeichnis(arten.into())
    }

    /// Die Arten dieses Builds.
    pub fn produktiv() -> Self {
        Verzeichnis::default()
    }

    pub fn find(&self, code: &str) -> Option<&Arc<dyn AdapterArt>> {
        self.0.iter().find(|a| a.code() == code)
    }

    pub fn iter(&self) -> impl Iterator<Item = &Arc<dyn AdapterArt>> {
        self.0.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// Eine Art, wie die Verwaltung sie zum Anlegen sieht.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdapterArtAnzeige {
    pub code: String,
    pub bezeichnung: String,
    pub plaetze: Vec<Platz>,
    pub felder: Vec<Feld>,
    pub intervall_min_s: i64,
    pub intervall_vorschlag_s: i64,
}

impl AdapterArtAnzeige {
    pub fn aus(art: &dyn AdapterArt) -> Self {
        AdapterArtAnzeige {
            code: art.code().to_string(),
            bezeichnung: art.bezeichnung().to_string(),
            plaetze: art.plaetze().to_vec(),
            felder: art.felder().to_vec(),
            intervall_min_s: art.intervall_min_s(),
            intervall_vorschlag_s: art.intervall_vorschlag_s(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Probe;

    impl AdapterArt for Probe {
        fn code(&self) -> &'static str {
            "probe"
        }
        fn bezeichnung(&self) -> &'static str {
            "Probe"
        }
        fn plaetze(&self) -> &'static [Platz] {
            &[]
        }
        fn felder(&self) -> &'static [Feld] {
            &[
                Feld {
                    name: "adresse",
                    bezeichnung: "Adresse",
                    typ: FeldTyp::Url,
                    pflicht: true,
                    max: 200,
                },
                Feld {
                    name: "gruppe",
                    bezeichnung: "Gruppe",
                    typ: FeldTyp::Text,
                    pflicht: false,
                    max: 5,
                },
                Feld {
                    name: "anzahl",
                    bezeichnung: "Anzahl",
                    typ: FeldTyp::Zahl,
                    pflicht: false,
                    max: 0,
                },
            ]
        }
        fn intervall_min_s(&self) -> i64 {
            30
        }
        fn intervall_vorschlag_s(&self) -> i64 {
            60
        }
        fn abrufen<'a>(
            &'a self,
            _kontext: &'a AbrufKontext<'a>,
        ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
            Box::pin(async { Ok(Box::new(OhneUebernahme(0)) as Box<dyn Uebernahme>) })
        }
    }

    fn pruefe(v: Value, lan: bool) -> Result<Map<String, Value>, String> {
        check_einstellungen(&Probe, v.as_object().unwrap(), lan)
    }

    #[test]
    fn felder_werden_geprueft_und_bereinigt() {
        let ok = pruefe(
            json!({ "adresse": " https://api.example.org/x ", "gruppe": "  ", "anzahl": 3 }),
            false,
        )
        .unwrap();
        assert_eq!(
            Value::Object(ok),
            json!({ "adresse": "https://api.example.org/x", "anzahl": 3 })
        );

        assert!(pruefe(json!({}), false)
            .unwrap_err()
            .contains("Pflichtfeld"));
        assert!(
            pruefe(json!({ "adresse": "https://a.example", "x": 1 }), false)
                .unwrap_err()
                .contains("unbekanntes Feld")
        );
        assert!(pruefe(
            json!({ "adresse": "https://a.example", "gruppe": "genau" }),
            false
        )
        .is_ok());
        assert!(pruefe(
            json!({ "adresse": "https://a.example", "gruppe": "zu lang" }),
            false
        )
        .unwrap_err()
        .contains("höchstens 5"));
        assert!(pruefe(
            json!({ "adresse": "https://a.example", "anzahl": "3" }),
            false
        )
        .unwrap_err()
        .contains("ganze Zahl"));
        assert!(pruefe(json!({ "adresse": "http://a.example" }), false)
            .unwrap_err()
            .contains("https://"));
    }

    #[test]
    fn url_im_lan_nur_mit_ausnahme_loopback_nie() {
        assert!(pruefe(json!({ "adresse": "https://192.168.1.5/" }), false).is_err());
        assert!(pruefe(json!({ "adresse": "https://192.168.1.5/" }), true).is_ok());
        assert!(pruefe(json!({ "adresse": "https://127.0.0.1/" }), true).is_err());
    }

    #[test]
    fn neues_ziel_nur_bei_anderem_oder_neuem_host() {
        let m = |v: Value| v.as_object().unwrap().clone();
        let alt = m(json!({ "adresse": "https://api.example.org/a" }));
        assert!(!has_neues_ziel(&Probe, &alt, &alt));
        assert!(!has_neues_ziel(
            &Probe,
            &alt,
            &m(json!({ "adresse": "https://API.example.org/b?x=1", "gruppe": "x" }))
        ));
        assert!(has_neues_ziel(
            &Probe,
            &alt,
            &m(json!({ "adresse": "https://boese.example/a" }))
        ));
        assert!(has_neues_ziel(
            &Probe,
            &m(json!({})),
            &m(json!({ "adresse": "https://api.example.org/a" }))
        ));
        // Eine entfernte URL schickt nichts mehr irgendwohin.
        assert!(!has_neues_ziel(&Probe, &alt, &m(json!({}))));
    }

    #[test]
    fn verzeichnis_findet_nach_code() {
        let v = Verzeichnis::new(vec![Arc::new(Probe)]);
        assert!(v.find("probe").is_some());
        assert!(v.find("divera").is_none());
        assert!(Verzeichnis::produktiv().is_empty());
    }
}
