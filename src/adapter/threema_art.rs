//! Adapterart `threema` („Threema Gateway“, LLH-2096, Design-Doc
//! `docs/superpowers/specs/2026-11-28-gq6qs7tg-ausgang-threema-design.md`, Abschnitt 2).
//!
//! Die Art trägt den Threema-Ausgang einer Org: Gateway-ID als Feld, API-Secret und privater
//! Schlüssel als Geheimnisse; nur der E2E-Modus. Der regelmäßige Lauf prüft Zugang und Schlüssel
//! (`threema::pruefe`) und merkt das Guthaben als Anzahl des Laufs (`letzte_anzahl`); er sendet
//! nichts und übernimmt nichts. Das Ziel ist fest.

use std::sync::Arc;

use futures::future::BoxFuture;
use serde_json::{Map, Value};

use super::art::{AdapterArt, Fehlschlag, Feld, FeldTyp, OhneUebernahme, Platz, Uebernahme};
use super::threema::krypto::{normalize_privater_schluessel, parse_privater_schluessel};
use super::threema::{self, ThreemaFehler, ThreemaZugang, Ziel};
use super::ziel::AbrufKontext;
use super::zustand::AdapterFehler;

/// Code der Art, wie er in `adapter.art` steht.
pub const CODE: &str = "threema";

/// Platz des API-Secrets.
pub const PLATZ_SECRET: &str = "secret";
/// Platz des privaten Schlüssels.
pub const PLATZ_PRIVAT: &str = "privater_schluessel";

/// Die Prüfung einer Threema-Anbindung; liefert das Guthaben. Produktiv die echte API, in Tests
/// ein Skript.
pub trait ThreemaPruefer: Send + Sync + 'static {
    fn pruefe<'a>(
        &'a self,
        zugang: &'a ThreemaZugang<'a>,
        lan_erlaubt: bool,
    ) -> BoxFuture<'a, Result<i64, ThreemaFehler>>;
}

struct EchterPruefer;

impl ThreemaPruefer for EchterPruefer {
    fn pruefe<'a>(
        &'a self,
        zugang: &'a ThreemaZugang<'a>,
        lan_erlaubt: bool,
    ) -> BoxFuture<'a, Result<i64, ThreemaFehler>> {
        Box::pin(async move { threema::pruefe(&Ziel::produktiv(lan_erlaubt), zugang).await })
    }
}

/// Der Prüfer der e2e-Suite: nimmt jeden Zugang an, ohne Netz, mit 100 Credits (Muster
/// `sipgate_fax_art::PrueferOhneNetz`).
struct PrueferOhneNetz;

impl ThreemaPruefer for PrueferOhneNetz {
    fn pruefe<'a>(
        &'a self,
        _zugang: &'a ThreemaZugang<'a>,
        _lan_erlaubt: bool,
    ) -> BoxFuture<'a, Result<i64, ThreemaFehler>> {
        Box::pin(async { Ok(100) })
    }
}

pub struct ThreemaArt {
    pruefer: Arc<dyn ThreemaPruefer>,
}

impl ThreemaArt {
    /// Die Art dieses Builds, mit der echten API.
    pub fn produktiv() -> Self {
        ThreemaArt::new(Arc::new(EchterPruefer))
    }

    /// Die Art neben den Test-Zustellern (`--ausgang-testzusteller`): prüft ohne Netz. Nur in
    /// Debug-Builds.
    pub fn ohne_netz() -> Option<Self> {
        cfg!(debug_assertions).then(|| ThreemaArt::new(Arc::new(PrueferOhneNetz)))
    }

    /// Mit einem anderen Prüfer (Tests).
    pub fn new(pruefer: Arc<dyn ThreemaPruefer>) -> Self {
        ThreemaArt { pruefer }
    }
}

const PLAETZE: &[Platz] = &[
    Platz {
        name: PLATZ_SECRET,
        bezeichnung: "API-Secret",
        pflicht: true,
        intern: false,
    },
    Platz {
        name: PLATZ_PRIVAT,
        bezeichnung: "Privater Schlüssel",
        pflicht: true,
        intern: false,
    },
];

const FELDER: &[Feld] = &[Feld {
    name: "gateway_id",
    bezeichnung: "Gateway-ID (etwa *LAGE123)",
    typ: FeldTyp::Text,
    pflicht: true,
    max: 8,
}];

/// Ob eine Gateway-ID die Form `*` und sieben Zeichen `A–Z0–9` hat.
pub fn is_gateway_id(s: &str) -> bool {
    s.len() == 8
        && s.starts_with('*')
        && s[1..]
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

impl AdapterArt for ThreemaArt {
    fn code(&self) -> &'static str {
        CODE
    }
    fn bezeichnung(&self) -> &'static str {
        "Threema Gateway"
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
        let id = einstellungen
            .get("gateway_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !is_gateway_id(id) {
            return Err(
                "Gateway-ID: „*“ und sieben Großbuchstaben oder Ziffern, etwa *LAGE123".into(),
            );
        }
        Ok(())
    }

    fn check_geheimnis(&self, platz: &str, wert: &str) -> Result<String, String> {
        if platz == PLATZ_PRIVAT {
            normalize_privater_schluessel(wert).map_err(str::to_string)
        } else {
            Ok(wert.to_string())
        }
    }

    fn abrufen<'a>(
        &'a self,
        kontext: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
        Box::pin(async move {
            let gateway_id = kontext
                .einstellung_text("gateway_id")
                .ok_or(AdapterFehler::EinstellungUngueltig)?;
            let secret = kontext
                .geheimnis(PLATZ_SECRET)
                .ok_or(AdapterFehler::GeheimnisFehlt)?;
            let privat = kontext
                .geheimnis(PLATZ_PRIVAT)
                .ok_or(AdapterFehler::GeheimnisFehlt)?;
            let privat = {
                use age::secrecy::ExposeSecret;
                parse_privater_schluessel(privat.expose_secret())
                    .map_err(|_| AdapterFehler::SchluesselPassenNicht)?
            };
            let zugang = ThreemaZugang {
                gateway_id,
                secret,
                privat: &privat,
            };
            match self.pruefer.pruefe(&zugang, kontext.lan_erlaubt()).await {
                Ok(guthaben) => Ok(Box::new(OhneUebernahme(guthaben)) as Box<dyn Uebernahme>),
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
    use super::*;

    #[test]
    fn gateway_id_ist_stern_und_sieben_zeichen() {
        for gut in ["*ABCDEF1", "*LAGE123"] {
            assert!(is_gateway_id(gut), "{gut}");
        }
        for schlecht in ["", "ABCDEFGH", "*ABC", "*abcdef1", "*ABCDEF12", "*ABC-EF1"] {
            assert!(!is_gateway_id(schlecht), "{schlecht}");
        }
        let art = ThreemaArt::produktiv();
        let mut m = Map::new();
        m.insert("gateway_id".into(), "*abcdef1".into());
        assert!(art.check_extra(&m).is_err());
    }

    #[test]
    fn privater_schluessel_wird_beim_setzen_normalisiert() {
        let art = ThreemaArt::produktiv();
        let hex = "ab".repeat(32);
        assert_eq!(
            art.check_geheimnis(PLATZ_PRIVAT, &format!("private:{}", hex.to_uppercase())),
            Ok(hex)
        );
        assert!(art.check_geheimnis(PLATZ_PRIVAT, "abc").is_err());
        assert_eq!(art.check_geheimnis(PLATZ_SECRET, " x "), Ok(" x ".into()));
    }

    #[tokio::test]
    async fn ohne_netz_ersetzt_die_art() {
        let art = ThreemaArt::ohne_netz().expect("Debug-Build");
        let v = super::super::art::Verzeichnis::produktiv(
            std::sync::Arc::new(crate::drohne::Store::new()),
            Default::default(),
        );
        let codes: Vec<_> = v.iter().map(|a| a.code()).collect();
        assert!(codes.contains(&CODE));
        let neu = v.ersetzt(std::sync::Arc::new(art));
        assert_eq!(neu.iter().map(|a| a.code()).collect::<Vec<_>>(), codes);
    }
}
