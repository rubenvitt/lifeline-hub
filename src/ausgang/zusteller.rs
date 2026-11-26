//! Der Weg nach draußen für den Lauf des Ausgangskorbs (LLH-2093, Spec Abschnitt 3). Produktiv
//! der SMTP-Client mit den Vertrauensankern des Systems ([`SmtpZusteller`]); Tests setzen einen
//! eigenen [`Zusteller`] ein, der aufzeichnet (Muster `public_api::webhook::ziel::Zusteller`).

use std::sync::Arc;

use futures::future::BoxFuture;

pub use crate::adapter::lauf::Versandzugang;
use crate::adapter::sipgate::{self, FaxAuftrag, FaxStatus, SipgateFehler, SipgateZugang};
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

/// Übergibt ein Fax und fragt seinen Stand ab (LLH-2095). Der Aufrufer hält dabei keine
/// Datenbankverbindung.
pub trait FaxZusteller: Send + Sync {
    /// Übergibt das Fax; liefert die Session-ID des Anbieters.
    fn senden<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        auftrag: &'a FaxAuftrag<'a>,
    ) -> BoxFuture<'a, Result<String, SipgateFehler>>;

    /// Stand der Session.
    fn status<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        session: &'a str,
    ) -> BoxFuture<'a, Result<FaxStatus, SipgateFehler>>;
}

/// Beide Wege nach draußen, wie der Lauf sie braucht.
#[derive(Clone)]
pub struct Zustellwege {
    pub mail: Arc<dyn Zusteller>,
    pub fax: Arc<dyn FaxZusteller>,
}

/// Die echte sipgate-API (`adapter::sipgate`).
pub struct SipgateZusteller;

/// Zugang aus der Anbindung; ohne Token-ID oder Token ist die Anmeldung so gut wie abgelehnt.
fn sipgate_zugang(zugang: &Versandzugang) -> Result<SipgateZugang<'_>, SipgateFehler> {
    let token_id = zugang
        .einstellung("token_id")
        .ok_or(SipgateFehler::Status(401))?;
    let token = zugang
        .geheimnisse
        .get("token")
        .ok_or(SipgateFehler::Status(401))?;
    Ok(SipgateZugang {
        token_id,
        token,
        lan_erlaubt: zugang.lan_erlaubt,
    })
}

impl FaxZusteller for SipgateZusteller {
    fn senden<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        auftrag: &'a FaxAuftrag<'a>,
    ) -> BoxFuture<'a, Result<String, SipgateFehler>> {
        Box::pin(async move { sipgate::senden(&sipgate_zugang(zugang)?, auftrag).await })
    }

    fn status<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        session: &'a str,
    ) -> BoxFuture<'a, Result<FaxStatus, SipgateFehler>> {
        Box::pin(async move { sipgate::status(&sipgate_zugang(zugang)?, session).await })
    }
}

/// Ein vom Fax-Doppel übergebenes Fax.
#[derive(Debug, Clone)]
pub struct GesendetesFax {
    pub faxline_id: String,
    pub empfaenger: String,
    pub dateiname: String,
    pub pdf: Vec<u8>,
    pub mit_token: bool,
}

/// Das Fax-Doppel der e2e-Suite und der Tests (LLH-2095): nimmt jedes Fax an (Session
/// `sess-<n>`) und meldet es beim ersten Abfragen als gesendet, sofern nichts anderes geplant
/// ist. Ohne Netz; im Betrieb nur über [`testfaxzusteller`] und damit nur im Debug-Build.
#[derive(Default)]
pub struct AufzeichnenderFaxZusteller {
    gesendet: std::sync::Mutex<Vec<GesendetesFax>>,
    senden_plan: std::sync::Mutex<std::collections::VecDeque<Result<String, SipgateFehler>>>,
    status_plan: std::sync::Mutex<std::collections::VecDeque<Result<FaxStatus, SipgateFehler>>>,
    abfragen: std::sync::atomic::AtomicUsize,
}

impl AufzeichnenderFaxZusteller {
    pub fn gesendet(&self) -> Vec<GesendetesFax> {
        self.gesendet.lock().unwrap().clone()
    }
    /// Das Ergebnis des nächsten Sendens.
    pub fn plane_senden(&self, e: Result<String, SipgateFehler>) {
        self.senden_plan.lock().unwrap().push_back(e);
    }
    /// Das Ergebnis der nächsten Abfrage.
    pub fn plane_status(&self, e: Result<FaxStatus, SipgateFehler>) {
        self.status_plan.lock().unwrap().push_back(e);
    }
    /// Wie oft der Stand abgefragt wurde.
    pub fn abfragen(&self) -> usize {
        self.abfragen.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl FaxZusteller for AufzeichnenderFaxZusteller {
    fn senden<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        auftrag: &'a FaxAuftrag<'a>,
    ) -> BoxFuture<'a, Result<String, SipgateFehler>> {
        Box::pin(async move {
            let mut liste = self.gesendet.lock().unwrap();
            liste.push(GesendetesFax {
                faxline_id: auftrag.faxline_id.to_string(),
                empfaenger: auftrag.empfaenger.to_string(),
                dateiname: auftrag.dateiname.to_string(),
                pdf: auftrag.pdf.to_vec(),
                mit_token: zugang.geheimnisse.contains_key("token"),
            });
            let n = liste.len();
            drop(liste);
            self.senden_plan
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(format!("sess-{n}")))
        })
    }

    fn status<'a>(
        &'a self,
        _zugang: &'a Versandzugang,
        _session: &'a str,
    ) -> BoxFuture<'a, Result<FaxStatus, SipgateFehler>> {
        Box::pin(async move {
            self.abfragen
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.status_plan
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(FaxStatus::Gesendet))
        })
    }
}

/// Das aufzeichnende Fax-Doppel, nur in einem Debug-Build (wie [`testzusteller`]).
pub fn testfaxzusteller() -> Option<Arc<AufzeichnenderFaxZusteller>> {
    cfg!(debug_assertions).then(|| Arc::new(AufzeichnenderFaxZusteller::default()))
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
        assert!(testfaxzusteller().is_some());
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn im_release_build_gibt_es_das_doppel_nie() {
        assert!(testzusteller().is_none());
        assert!(testfaxzusteller().is_none());
    }
}
