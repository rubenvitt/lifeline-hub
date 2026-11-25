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
