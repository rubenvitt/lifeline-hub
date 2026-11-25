//! Der Weg nach draußen für den Lauf des Ausgangskorbs (LLH-2093, Spec Abschnitt 3). Produktiv
//! der SMTP-Client mit den Vertrauensankern des Systems ([`SmtpZusteller`]); Tests setzen einen
//! eigenen [`Zusteller`] ein, der aufzeichnet (Muster `public_api::webhook::ziel::Zusteller`).

use std::sync::Arc;

use futures::future::BoxFuture;

pub use crate::adapter::lauf::Versandzugang;
use crate::adapter::smtp::{self, SmtpFehler};
use crate::adapter::smtp_art::smtp_ziel;

/// Stellt eine fertige Mail über den Zugang einer Anbindung zu. `von` und `an` sind die
/// Umschlagadressen (MAIL FROM, RCPT TO), `mail` die fertigen Bytes. Der Aufrufer hält dabei keine
/// Datenbankverbindung.
pub trait Zusteller: Send + Sync {
    fn zustellen<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        von: &'a str,
        an: &'a str,
        mail: &'a [u8],
    ) -> BoxFuture<'a, Result<(), SmtpFehler>>;
}

/// Der echte SMTP-Client. Die TLS-Konfiguration (Plattform-Verifier) wird einmal gebaut; fehlt
/// sie (keine Vertrauensanker), scheitert jede Zustellung mit `Tls`, nie ohne Prüfung.
pub struct SmtpZusteller {
    tls: Option<Arc<rustls::ClientConfig>>,
}

impl SmtpZusteller {
    /// Baut die TLS-Konfiguration; scheitert das, steht es einmal im Log.
    pub fn produktiv() -> Self {
        let tls = match crate::instanz::zertifikat::webpki_config() {
            Ok(c) => Some(Arc::new(c)),
            Err(e) => {
                tracing::error!(
                    "Ausgang per E-Mail: keine Vertrauensanker des Systems, Zustellungen \
                     scheitern: {e}"
                );
                None
            }
        };
        SmtpZusteller { tls }
    }
}

impl Zusteller for SmtpZusteller {
    fn zustellen<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        von: &'a str,
        an: &'a str,
        mail: &'a [u8],
    ) -> BoxFuture<'a, Result<(), SmtpFehler>> {
        Box::pin(async move {
            let Some(tls) = self.tls.clone() else {
                return Err(SmtpFehler::Tls);
            };
            // Nach `check_einstellungen` scheitert das nur bei Altdaten; das Ziel ist dann so
            // unbrauchbar wie ein gesperrtes (Fehler der Anbindung, Einzelheit an ihr).
            let ziel = smtp_ziel(
                &zugang.einstellungen,
                &zugang.geheimnisse,
                zugang.lan_erlaubt,
                smtp::EHLO_VORGABE,
            )
            .map_err(|_| SmtpFehler::ZielIntern)?;
            smtp::sende(&ziel, tls, von, an, mail).await
        })
    }
}

/// Eine vom Test-Doppel angenommene Zustellung (ohne Mailtext: der enthält Inhalt).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Angenommen {
    pub von: String,
    pub an: String,
    pub bytes: usize,
}

/// Das Doppel der e2e-Suite (LLH-2093): nimmt jede Zustellung an und merkt sie sich, ohne
/// Netz. Nur über [`testzusteller`] zu bekommen, und das gibt es nur in Debug-Builds.
#[derive(Default)]
pub struct AufzeichnenderZusteller {
    angenommen: std::sync::Mutex<Vec<Angenommen>>,
}

impl AufzeichnenderZusteller {
    pub fn angenommen(&self) -> Vec<Angenommen> {
        self.angenommen.lock().unwrap().clone()
    }
}

impl Zusteller for AufzeichnenderZusteller {
    fn zustellen<'a>(
        &'a self,
        _zugang: &'a Versandzugang,
        von: &'a str,
        an: &'a str,
        mail: &'a [u8],
    ) -> BoxFuture<'a, Result<(), SmtpFehler>> {
        Box::pin(async move {
            self.angenommen.lock().unwrap().push(Angenommen {
                von: von.to_string(),
                an: an.to_string(),
                bytes: mail.len(),
            });
            Ok(())
        })
    }
}

/// Das aufzeichnende Doppel, nur in einem Debug-Build; im Release-Build immer `None`, damit
/// kein Produktivbinary Mails verschluckt, auch nicht durch einen versehentlich gesetzten Schalter.
pub fn testzusteller() -> Option<Arc<AufzeichnenderZusteller>> {
    cfg!(debug_assertions).then(|| Arc::new(AufzeichnenderZusteller::default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn doppel_nimmt_an_und_merkt_sich_nur_umschlag_und_groesse() {
        let z = AufzeichnenderZusteller::default();
        let zugang = Versandzugang {
            einstellungen: Default::default(),
            geheimnisse: Default::default(),
            lan_erlaubt: false,
            adapter_id: "a".into(),
        };
        z.zustellen(&zugang, "von@example.org", "an@example.org", b"abc")
            .await
            .unwrap();
        assert_eq!(
            z.angenommen(),
            vec![Angenommen {
                von: "von@example.org".into(),
                an: "an@example.org".into(),
                bytes: 3
            }]
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn im_debug_build_gibt_es_das_doppel() {
        assert!(testzusteller().is_some());
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn im_release_build_gibt_es_das_doppel_nie() {
        assert!(testzusteller().is_none());
    }
}
