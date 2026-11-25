//! Adapterart `smtp` („E-Mail (SMTP)“, LLH-2093, Design-Doc
//! `docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`, Abschnitt 2).
//!
//! Die Art trägt den Ausgang für Mail: Server, Anmeldung und Absender einer Org. Der regelmäßige
//! Lauf prüft nur die Verbindung (`smtp::pruefe`), er sendet nichts und übernimmt nichts. Der
//! Versand selbst (`smtp::sende`) liest dasselbe Ziel über [`smtp_ziel`].

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use age::secrecy::SecretString;
use futures::future::BoxFuture;
use serde_json::{Map, Value};

use super::art::{AdapterArt, Fehlschlag, Feld, FeldTyp, OhneUebernahme, Platz, Uebernahme};
use super::smtp::{self, SmtpFehler, SmtpZiel, Verschluesselung};
use super::ziel::AbrufKontext;
use super::zustand::AdapterFehler;
use crate::externe_stelle::kanal::normalize_email;

/// Code der Art, wie er in `adapter.art` steht.
pub const CODE: &str = "smtp";

/// Höchstlänge des Anzeigenamens des Absenders.
pub const ABSENDER_NAME_MAX: usize = 100;

/// Die Verbindungsprüfung einer SMTP-Anbindung. Produktiv der echte Client, in Tests ein Skript.
pub trait SmtpPruefer: Send + Sync + 'static {
    fn pruefe<'a>(&'a self, ziel: &'a SmtpZiel<'a>) -> BoxFuture<'a, Result<(), SmtpFehler>>;
}

/// Der echte Client mit den Vertrauensankern des Systems (einmal gebaut).
struct EchterPruefer;

impl SmtpPruefer for EchterPruefer {
    fn pruefe<'a>(&'a self, ziel: &'a SmtpZiel<'a>) -> BoxFuture<'a, Result<(), SmtpFehler>> {
        Box::pin(async move {
            match tls_config() {
                Some(tls) => smtp::pruefe(ziel, tls).await,
                None => Err(SmtpFehler::Tls),
            }
        })
    }
}

/// Die TLS-Konfiguration des Prozesses; `None`, wenn das System keine Vertrauensanker liefert
/// (dann scheitert jede Prüfung mit `Tls`, nie mit einer Konfiguration ohne Prüfung).
fn tls_config() -> Option<Arc<rustls::ClientConfig>> {
    static TLS: OnceLock<Option<Arc<rustls::ClientConfig>>> = OnceLock::new();
    TLS.get_or_init(|| {
        crate::instanz::zertifikat::webpki_config()
            .map(Arc::new)
            .map_err(|e| tracing::warn!("SMTP: keine Vertrauensanker des Systems: {e}"))
            .ok()
    })
    .clone()
}

pub struct SmtpArt {
    pruefer: Arc<dyn SmtpPruefer>,
}

impl SmtpArt {
    /// Die Art dieses Builds, mit dem echten Client.
    pub fn produktiv() -> Self {
        SmtpArt::new(Arc::new(EchterPruefer))
    }

    /// Mit einem anderen Prüfer (Tests).
    pub fn new(pruefer: Arc<dyn SmtpPruefer>) -> Self {
        SmtpArt { pruefer }
    }
}

const PLAETZE: &[Platz] = &[Platz {
    name: "passwort",
    bezeichnung: "Passwort",
    pflicht: false,
    intern: false,
}];

const FELDER: &[Feld] = &[
    Feld {
        name: "host",
        bezeichnung: "Server",
        typ: FeldTyp::Host,
        pflicht: true,
        max: 253,
    },
    Feld {
        name: "port",
        bezeichnung: "Port",
        typ: FeldTyp::Zahl,
        pflicht: true,
        max: 0,
    },
    Feld {
        name: "verschluesselung",
        bezeichnung: "Verschlüsselung",
        typ: FeldTyp::Text,
        pflicht: true,
        max: 20,
    },
    Feld {
        name: "benutzer",
        bezeichnung: "Benutzer",
        typ: FeldTyp::Text,
        pflicht: false,
        max: 256,
    },
    Feld {
        name: "absender",
        bezeichnung: "Absenderadresse",
        typ: FeldTyp::Text,
        pflicht: true,
        max: 254,
    },
    Feld {
        name: "absender_name",
        bezeichnung: "Absendername",
        typ: FeldTyp::Text,
        pflicht: false,
        max: ABSENDER_NAME_MAX,
    },
];

fn verschluesselung_von(text: &str) -> Option<Verschluesselung> {
    match text {
        "starttls" => Some(Verschluesselung::StartTls),
        "tls" => Some(Verschluesselung::Tls),
        _ => None,
    }
}

/// Das Ziel aus den Einstellungen und Geheimnissen einer Anbindung. Fehlt oder ist etwas
/// ungültig (nach `check_einstellungen` nur bei Altdaten), ist es `ZielUngueltig`. Geteilt mit
/// dem Versand.
pub fn smtp_ziel<'a>(
    einstellungen: &'a Map<String, Value>,
    geheimnisse: &'a HashMap<String, SecretString>,
    lan_erlaubt: bool,
    ehlo_name: &'a str,
) -> Result<SmtpZiel<'a>, AdapterFehler> {
    let ungueltig = || AdapterFehler::ZielUngueltig;
    let text = |name: &str| einstellungen.get(name).and_then(Value::as_str);
    let host = text("host").ok_or_else(ungueltig)?;
    let port = einstellungen
        .get("port")
        .and_then(Value::as_i64)
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p != 0)
        .ok_or_else(ungueltig)?;
    let verschluesselung = text("verschluesselung")
        .and_then(verschluesselung_von)
        .ok_or_else(ungueltig)?;
    Ok(SmtpZiel {
        host,
        port,
        verschluesselung,
        lan_erlaubt,
        benutzer: text("benutzer"),
        passwort: geheimnisse.get("passwort"),
        ehlo_name,
    })
}

impl AdapterArt for SmtpArt {
    fn code(&self) -> &'static str {
        CODE
    }
    fn bezeichnung(&self) -> &'static str {
        "E-Mail (SMTP)"
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
        let port = einstellungen.get("port").and_then(Value::as_i64);
        if !port.is_some_and(|p| (1..=65535).contains(&p)) {
            return Err("Port: muss zwischen 1 und 65535 liegen".into());
        }
        let v = einstellungen
            .get("verschluesselung")
            .and_then(Value::as_str);
        if v.and_then(verschluesselung_von).is_none() {
            return Err("Verschlüsselung: erlaubt sind „starttls“ und „tls“".into());
        }
        let absender = einstellungen
            .get("absender")
            .and_then(Value::as_str)
            .unwrap_or_default();
        normalize_email(absender).map_err(|m| format!("Absenderadresse: {m}"))?;
        Ok(())
    }

    fn abrufen<'a>(
        &'a self,
        kontext: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
        Box::pin(async move {
            let ziel = smtp_ziel(
                kontext.einstellungen,
                kontext.geheimnisse(),
                kontext.lan_erlaubt(),
                smtp::EHLO_VORGABE,
            )?;
            match self.pruefer.pruefe(&ziel).await {
                Ok(()) => Ok(Box::new(OhneUebernahme(0)) as Box<dyn Uebernahme>),
                Err(e) => Err(Fehlschlag {
                    art: e.adapter_fehler(),
                    status: e.status(),
                }),
            }
        })
    }
}
