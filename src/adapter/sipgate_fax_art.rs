//! Adapterart `sipgate_fax` („Fax (sipgate)“, LLH-2095, Design-Doc
//! `docs/superpowers/specs/2026-11-25-atnsssv3-ausgang-fax-pdf-design.md`, Abschnitt 2).
//!
//! Die Art trägt den Fax-Ausgang einer Org: Token-ID, Faxline und eine Absenderkennung für den
//! Kopf des PDFs; das Token ist ein Geheimnis. Der regelmäßige Lauf prüft nur Zugang und
//! Faxline (`sipgate::pruefe`), er sendet nichts und übernimmt nichts. Das Ziel ist fest.

use std::sync::Arc;

use futures::future::BoxFuture;
use serde_json::{Map, Value};

use super::art::{AdapterArt, Fehlschlag, Feld, FeldTyp, OhneUebernahme, Platz, Uebernahme};
use super::sipgate::{self, SipgateFehler, SipgateZugang};
use super::ziel::AbrufKontext;
use super::zustand::AdapterFehler;

/// Code der Art, wie er in `adapter.art` steht.
pub const CODE: &str = "sipgate_fax";

/// Höchstlänge der Absenderkennung im Kopf des PDFs.
pub const ABSENDER_KENNUNG_MAX: usize = 100;

/// Die Prüfung einer Fax-Anbindung. Produktiv die echte API, in Tests ein Skript.
pub trait SipgatePruefer: Send + Sync + 'static {
    fn pruefe<'a>(
        &'a self,
        zugang: &'a SipgateZugang<'a>,
        faxline_id: &'a str,
    ) -> BoxFuture<'a, Result<(), SipgateFehler>>;
}

struct EchterPruefer;

impl SipgatePruefer for EchterPruefer {
    fn pruefe<'a>(
        &'a self,
        zugang: &'a SipgateZugang<'a>,
        faxline_id: &'a str,
    ) -> BoxFuture<'a, Result<(), SipgateFehler>> {
        Box::pin(sipgate::pruefe(zugang, faxline_id))
    }
}

pub struct SipgateFaxArt {
    pruefer: Arc<dyn SipgatePruefer>,
}

impl SipgateFaxArt {
    /// Die Art dieses Builds, mit der echten API.
    pub fn produktiv() -> Self {
        SipgateFaxArt::new(Arc::new(EchterPruefer))
    }

    /// Mit einem anderen Prüfer (Tests).
    pub fn new(pruefer: Arc<dyn SipgatePruefer>) -> Self {
        SipgateFaxArt { pruefer }
    }
}

const PLAETZE: &[Platz] = &[Platz {
    name: "token",
    bezeichnung: "Token (Personal Access Token)",
    pflicht: true,
    intern: false,
}];

const FELDER: &[Feld] = &[
    Feld {
        name: "token_id",
        bezeichnung: "Token-ID",
        typ: FeldTyp::Text,
        pflicht: true,
        max: 200,
    },
    Feld {
        name: "faxline_id",
        bezeichnung: "Faxline (etwa f0)",
        typ: FeldTyp::Text,
        pflicht: true,
        max: 20,
    },
    Feld {
        name: "absender_kennung",
        bezeichnung: "Absender im Fax-Kopf",
        typ: FeldTyp::Text,
        pflicht: false,
        max: ABSENDER_KENNUNG_MAX,
    },
];

/// Ob eine Faxline-ID die Form `f` und Ziffern hat (`f0`, `f12`).
pub fn is_faxline_id(s: &str) -> bool {
    s.strip_prefix('f')
        .is_some_and(|r| !r.is_empty() && r.chars().all(|c| c.is_ascii_digit()))
}

impl AdapterArt for SipgateFaxArt {
    fn code(&self) -> &'static str {
        CODE
    }
    fn bezeichnung(&self) -> &'static str {
        "Fax (sipgate)"
    }
    fn plaetze(&self) -> &'static [Platz] {
        PLAETZE
    }
    fn felder(&self) -> &'static [Feld] {
        FELDER
    }
    fn intervall_min_s(&self) -> i64 {
        900
    }
    fn intervall_vorschlag_s(&self) -> i64 {
        3600
    }

    fn check_extra(&self, einstellungen: &Map<String, Value>) -> Result<(), String> {
        let faxline = einstellungen
            .get("faxline_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !is_faxline_id(faxline) {
            return Err("Faxline: „f“ und Ziffern, etwa f0 (sipgate → Routing → Fax)".into());
        }
        Ok(())
    }

    fn abrufen<'a>(
        &'a self,
        kontext: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
        Box::pin(async move {
            let token_id = kontext
                .einstellung_text("token_id")
                .ok_or(AdapterFehler::EinstellungUngueltig)?;
            let faxline = kontext
                .einstellung_text("faxline_id")
                .ok_or(AdapterFehler::EinstellungUngueltig)?;
            let token = kontext
                .geheimnis("token")
                .ok_or(AdapterFehler::GeheimnisFehlt)?;
            let zugang = SipgateZugang {
                token_id,
                token,
                lan_erlaubt: kontext.lan_erlaubt(),
            };
            match self.pruefer.pruefe(&zugang, faxline).await {
                Ok(()) => Ok(Box::new(OhneUebernahme(0)) as Box<dyn Uebernahme>),
                Err(e) => Err(Fehlschlag {
                    art: e.adapter_fehler(),
                    status: e.status(),
                }),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn faxline_id_ist_f_und_ziffern() {
        for gut in ["f0", "f12"] {
            assert!(super::is_faxline_id(gut), "{gut}");
        }
        for schlecht in ["", "f", "0", "g0", "f0x", "F0", "p1"] {
            assert!(!super::is_faxline_id(schlecht), "{schlecht}");
        }
    }
}
