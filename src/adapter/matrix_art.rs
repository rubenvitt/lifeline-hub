//! Adapterart `matrix` („Matrix“, LLH-2094, Design-Doc
//! `docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md`, Abschnitt 3).
//!
//! Die Art trägt den Ausgang per Matrix: Homeserver, Access-Token des Bot-Kontos und die
//! Passphrase seines Schlüsselspeichers (intern, beim Anlegen erzeugt). Der regelmäßige Lauf
//! prüft nur die Verbindung ([`matrix::pruefe`]), er sendet nichts und übernimmt nichts. Der
//! Versand liest dasselbe Ziel über [`matrix_ziel`] und teilt den Client der Anbindung
//! ([`matrix::Clients`]).

use std::collections::HashMap;
use std::sync::Arc;

use age::secrecy::SecretString;
use futures::future::BoxFuture;
use serde_json::{Map, Value};

use super::art::{AdapterArt, Fehlschlag, Feld, FeldTyp, OhneUebernahme, Platz, Uebernahme};
use super::matrix::{self, Clients, MatrixZiel};
use super::ziel::AbrufKontext;
use super::zustand::AdapterFehler;

/// Code der Art, wie er in `adapter.art` steht.
pub const CODE: &str = "matrix";

/// Höchstlänge des Anzeigenamens des Bots.
pub const ANZEIGENAME_MAX: usize = 100;

/// Platz des Access-Tokens.
pub const PLATZ_TOKEN: &str = "access_token";

/// Interner Platz der Passphrase des Schlüsselspeichers.
pub const PLATZ_PASSPHRASE: &str = "speicher_passphrase";

const PLAETZE: &[Platz] = &[
    Platz::new(PLATZ_TOKEN, "Access-Token", true),
    Platz {
        name: PLATZ_PASSPHRASE,
        bezeichnung: "Passphrase des Schlüsselspeichers",
        pflicht: true,
        intern: true,
    },
];

const FELDER: &[Feld] = &[
    Feld {
        name: "homeserver",
        bezeichnung: "Homeserver",
        typ: FeldTyp::Url,
        pflicht: true,
        max: 0,
    },
    Feld {
        name: "anzeigename",
        bezeichnung: "Anzeigename",
        typ: FeldTyp::Text,
        pflicht: false,
        max: ANZEIGENAME_MAX,
    },
];

pub struct MatrixArt {
    clients: Arc<Clients>,
}

impl MatrixArt {
    /// Mit den Clients des Prozesses (dieselben wie in `Rahmen::matrix`).
    pub fn new(clients: Arc<Clients>) -> Self {
        MatrixArt { clients }
    }
}

/// Das Ziel aus Einstellungen und Geheimnissen einer Anbindung. Fehlt etwas (nach
/// `check_einstellungen` und `prepare` nur bei Altdaten), ist es `ZielUngueltig` bzw.
/// `GeheimnisFehlt`. Geteilt mit dem Versand.
pub fn matrix_ziel(
    adapter_id: &str,
    einstellungen: &Map<String, Value>,
    geheimnisse: &HashMap<String, SecretString>,
    lan_erlaubt: bool,
) -> Result<MatrixZiel, AdapterFehler> {
    let homeserver = einstellungen
        .get("homeserver")
        .and_then(Value::as_str)
        .and_then(|u| u.trim().parse().ok())
        .ok_or(AdapterFehler::ZielUngueltig)?;
    let geheimnis = |name: &str| {
        geheimnisse
            .get(name)
            .cloned()
            .ok_or(AdapterFehler::GeheimnisFehlt)
    };
    Ok(MatrixZiel {
        homeserver,
        access_token: geheimnis(PLATZ_TOKEN)?,
        passphrase: geheimnis(PLATZ_PASSPHRASE)?,
        lan_erlaubt,
        adapter_id: adapter_id.to_string(),
    })
}

/// Setzt den Anzeigenamen des Bots, wenn er abweicht. Scheitert das (auch an der Frist der
/// Prüfung, `abrufen`), bleibt es beim alten Namen: kein Fehler der Anbindung.
async fn setze_anzeigename(clients: &Clients, ziel: &MatrixZiel, name: &str) {
    // Der Zugriff darf nur den Client borgen; der Name geht als eigene Kopie hinein.
    let name = name.to_string();
    let ergebnis = clients
        .mit_client(ziel, move |client| {
            Box::pin(async move {
                let konto = client.account();
                if konto.get_display_name().await?.as_deref() != Some(name.as_str()) {
                    konto.set_display_name(Some(&name)).await?;
                }
                Ok::<(), matrix_sdk::Error>(())
            })
        })
        .await;
    if let Ok(Err(err)) = ergebnis {
        tracing::info!(adapter = %ziel.adapter_id, "Matrix: Anzeigename nicht gesetzt: {err}");
    }
}

impl AdapterArt for MatrixArt {
    fn code(&self) -> &'static str {
        CODE
    }
    fn bezeichnung(&self) -> &'static str {
        "Matrix"
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

    fn abrufen<'a>(
        &'a self,
        kontext: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
        Box::pin(async move {
            let ziel = matrix_ziel(
                kontext.adapter_id,
                kontext.einstellungen,
                kontext.geheimnisse(),
                kontext.lan_erlaubt(),
            )?;
            // Eine Frist für Prüfung und Anzeigenamen zusammen: „Verbindung prüfen“ bleibt unter
            // dem Zeitbudget eines Requests, auch wenn der Name auf einen langen Versand wartet.
            let frist = tokio::time::Instant::now() + matrix::PRUEF_ZEITLIMIT;
            match matrix::pruefe(&self.clients, &ziel).await {
                Ok(_) => {
                    if let Some(name) = kontext.einstellung_text("anzeigename") {
                        let setzen = setze_anzeigename(&self.clients, &ziel, name);
                        if tokio::time::timeout_at(frist, setzen).await.is_err() {
                            tracing::info!(
                                adapter = %ziel.adapter_id,
                                "Matrix: Anzeigename nicht gesetzt, Frist der Prüfung abgelaufen"
                            );
                        }
                    }
                    Ok(Box::new(OhneUebernahme(0)) as Box<dyn Uebernahme>)
                }
                Err(e) => Err(Fehlschlag {
                    art: e.into(),
                    status: e.status(),
                }),
            }
        })
    }
}
