//! Der Weg nach draußen für den Lauf des Ausgangskorbs (LLH-2093, Spec Abschnitt 3; kanalneutral
//! seit LLH-2094, Spec `2026-11-25-ntaizave-ausgang-matrix-design.md` Abschnitt 6). Der Lauf gibt
//! je Versand einen [`Versandauftrag`] und bekommt [`Zustellt`] oder einen [`Fehlschlag`] mit dem
//! fertigen deutschen ETB-Grund zurück; die Zuordnung zu `AusgangFehler`, Wiederholung, ETB und
//! Abschluss bleiben im Lauf. Produktiv stellt [`SmtpZusteller`] E-Mails über den SMTP-Client mit
//! den Vertrauensankern des Systems zu und [`MatrixZusteller`] Nachrichten in Matrix-Räume über
//! den Client der Anbindung; Tests setzen einen eigenen [`Zusteller`] oder einen eigenen
//! [`SmtpTransport`] ein (Muster `public_api::webhook::ziel::Zusteller`).

use std::sync::Arc;

mod matrix;
pub use matrix::{MatrixZusteller, MATRIX_ZUSTELL_ZEITLIMIT};

use chrono::{DateTime, Utc};
use futures::future::BoxFuture;

use super::nachricht::{self, Anhang, Schnappschuss};
pub use crate::adapter::lauf::Versandzugang;
use crate::adapter::smtp::{self, SmtpFehler};
use crate::adapter::smtp_art::smtp_ziel;
use crate::externe_stelle::KanalArt;

/// Was ein Versand zum Zustellen braucht. Der Aufrufer hält dabei keine Datenbankverbindung.
pub struct Versandauftrag<'a> {
    /// Kennung der Zeile in `ausgang` (Message-ID, später Transaktions-ID je Teil).
    pub versand_id: &'a str,
    pub kanal: KanalArt,
    /// Zugang der Anbindung, die diesen Kanal bedient.
    pub zugang: &'a Versandzugang,
    pub adresse: &'a str,
    pub betreff: &'a str,
    pub inhalt: &'a str,
    pub anhaenge: &'a [Anhang],
    /// Schon gesendete und gemerkte Teile eines früheren Versuchs (`ausgang_teil`); der Zusteller
    /// lässt sie aus. Bei SMTP immer leer.
    pub gesendet: &'a [i64],
}

/// Warum eine Zustellung scheiterte, kanalneutral. Der Lauf ordnet daraus `AusgangFehler` zu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Zustellfehler {
    /// Im Wiederholungsfenster erneut versuchen; `nicht_vor` ist eine Untergrenze für den
    /// nächsten Versuch (SMTP: immer `None`).
    Voruebergehend { nicht_vor: Option<DateTime<Utc>> },
    /// Die Gegenseite lehnt die Nachricht ab.
    Abgelehnt,
    /// Ob die Nachricht hinaus ist, weiß niemand; nie selbst wiederholt.
    Ungewiss,
    /// Die Anbindung ist nicht nutzbar; `pruefung_vorziehen` lässt ihren Lauf es gleich selbst
    /// feststellen und melden (ADR-0086).
    Anbindung { pruefung_vorziehen: bool },
    /// Kein Zutritt zum Ziel (Matrix-Raum).
    KeinZutritt,
    /// Verschlüsseln nicht möglich (Matrix).
    Verschluesselung,
    /// Die Nachricht ist der Gegenseite zu groß.
    ZuGross,
}

/// Eine gelungene Zustellung. `teile` sind die dabei gesendeten Teile als `(teil, event_id)`;
/// bei SMTP leer.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Zustellt {
    pub teile: Vec<(i64, String)>,
}

/// Eine gescheiterte Zustellung. `grund` ist der fertige, feste deutsche Grund für den ETB-Text
/// (nie ein Text der Gegenseite), `smtp_status` füllt die Spalte `fehler_status`, `teile` sind
/// die bis zum Fehler gesendeten Teile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fehlschlag {
    pub fehler: Zustellfehler,
    pub grund: String,
    pub smtp_status: Option<u16>,
    pub teile: Vec<(i64, String)>,
}

/// Stellt einen Versand über den Zugang seiner Anbindung zu.
pub trait Zusteller: Send + Sync {
    fn zustellen<'a>(
        &'a self,
        auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>>;
}

/// Die SMTP-Sitzung hinter [`SmtpZusteller`]: `von` und `an` sind die Umschlagadressen
/// (MAIL FROM, RCPT TO), `mail` die fertigen Bytes. Produktiv [`TlsTransport`]; Tests spielen
/// hier `SmtpFehler` ab und sehen die fertige Mail.
pub trait SmtpTransport: Send + Sync {
    fn senden<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        von: &'a str,
        an: &'a str,
        mail: &'a [u8],
    ) -> BoxFuture<'a, Result<(), SmtpFehler>>;
}

impl<T: SmtpTransport + ?Sized> SmtpTransport for Arc<T> {
    fn senden<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        von: &'a str,
        an: &'a str,
        mail: &'a [u8],
    ) -> BoxFuture<'a, Result<(), SmtpFehler>> {
        (**self).senden(zugang, von, an, mail)
    }
}

/// Der echte SMTP-Client. Die TLS-Konfiguration (Plattform-Verifier) wird einmal gebaut; fehlt
/// sie (keine Vertrauensanker), scheitert jede Zustellung mit `Tls`, nie ohne Prüfung.
pub struct TlsTransport {
    tls: Option<Arc<rustls::ClientConfig>>,
}

impl TlsTransport {
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
        TlsTransport { tls }
    }
}

impl SmtpTransport for TlsTransport {
    fn senden<'a>(
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

/// Stellt E-Mails zu: baut die Nachricht aus dem Auftrag, übergibt sie dem [`SmtpTransport`] und
/// ordnet dessen `SmtpFehler` einem [`Fehlschlag`] mit festem Grund zu.
pub struct SmtpZusteller<T: SmtpTransport = TlsTransport> {
    transport: T,
}

impl SmtpZusteller {
    /// Der produktive Zusteller über [`TlsTransport`].
    pub fn produktiv() -> Self {
        SmtpZusteller {
            transport: TlsTransport::produktiv(),
        }
    }
}

impl<T: SmtpTransport> SmtpZusteller<T> {
    /// Ein Zusteller über einen eigenen Transport (für Tests).
    pub fn mit_transport(transport: T) -> Self {
        SmtpZusteller { transport }
    }
}

impl<T: SmtpTransport> Zusteller for SmtpZusteller<T> {
    fn zustellen<'a>(
        &'a self,
        auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>> {
        Box::pin(async move {
            // Nur E-Mail; ein Versand eines anderen Kanals darf nie als Mail hinausgehen.
            if auftrag.kanal != KanalArt::Email {
                return Err(kanal_nicht_bedient());
            }
            let (von, mail) = baue_smtp_mail(auftrag)?;
            self.transport
                .senden(auftrag.zugang, &von, auftrag.adresse, &mail)
                .await
                .map(|()| Zustellt::default())
                .map_err(smtp_fehlschlag)
        })
    }
}

/// Der Fehlschlag eines Kanals, den der Zusteller nicht bedient (fester Grund, nie gesendet).
fn kanal_nicht_bedient() -> Fehlschlag {
    Fehlschlag {
        fehler: Zustellfehler::Anbindung {
            pruefung_vorziehen: false,
        },
        grund: "Kanal wird hier nicht zugestellt".into(),
        smtp_status: None,
        teile: Vec::new(),
    }
}

/// Die Weiche des Laufs: gibt jeden Versand dem Zusteller seines Kanals (LLH-2094, Spec
/// Abschnitt 6). Fax und Threema haben keinen und scheitern ohne Netz.
pub struct Zustellerwahl {
    email: Arc<dyn Zusteller>,
    matrix: Arc<dyn Zusteller>,
}

impl Zustellerwahl {
    pub fn new(email: Arc<dyn Zusteller>, matrix: Arc<dyn Zusteller>) -> Self {
        Zustellerwahl { email, matrix }
    }

    /// E-Mail über [`SmtpZusteller::produktiv`], Matrix über [`MatrixZusteller`] mit den Clients
    /// des Prozesses (dieselben wie in `Rahmen::matrix`).
    pub fn produktiv(matrix: Arc<crate::adapter::matrix::Clients>) -> Self {
        Zustellerwahl::new(
            Arc::new(SmtpZusteller::produktiv()),
            Arc::new(MatrixZusteller::new(matrix)),
        )
    }
}

impl Zusteller for Zustellerwahl {
    fn zustellen<'a>(
        &'a self,
        auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>> {
        match auftrag.kanal {
            KanalArt::Email => self.email.zustellen(auftrag),
            KanalArt::Matrix => self.matrix.zustellen(auftrag),
            KanalArt::Fax | KanalArt::Threema => Box::pin(async { Err(kanal_nicht_bedient()) }),
        }
    }
}

/// Die Absenderadresse eines SMTP-Zugangs, normalisiert. Gespeichert ist sie nur getrimmt;
/// hinaus geht sie normalisiert. `None`: keine oder keine gültige Adresse.
pub fn smtp_absender(zugang: &Versandzugang) -> Option<String> {
    zugang
        .absender()
        .and_then(|a| crate::externe_stelle::kanal::normalize_email(a).ok())
}

/// Die Message-ID eines Versands (Spec E-Mail, Abschnitt 4), mit spitzen Klammern. Die Domain
/// ist die der Absenderadresse; ohne sie der Name, unter dem die Mail ohnehin hinausgeht.
fn message_id(versand_id: &str, von: &str) -> String {
    let host = von
        .rsplit_once('@')
        .map(|(_, d)| d)
        .filter(|d| !d.is_empty())
        .unwrap_or(smtp::EHLO_VORGABE);
    format!("<ausgang-{versand_id}@{host}>")
}

/// Der Fehlschlag einer unbrauchbaren Anbindung ohne Einzelheit (kein Absender, Nachricht nicht
/// baubar); derselbe Grund wie im Lauf für `anbindung_fehler` ohne SMTP-Fehler.
fn anbindung_unbrauchbar() -> Fehlschlag {
    Fehlschlag {
        fehler: Zustellfehler::Anbindung {
            pruefung_vorziehen: false,
        },
        grund: "Anbindung des Mailservers nicht nutzbar".into(),
        smtp_status: None,
        teile: Vec::new(),
    }
}

/// Baut die Mail eines Auftrags: Umschlag-Absender und fertige Bytes.
fn baue_smtp_mail(auftrag: &Versandauftrag<'_>) -> Result<(String, Vec<u8>), Fehlschlag> {
    let von = smtp_absender(auftrag.zugang).ok_or_else(anbindung_unbrauchbar)?;
    let schnappschuss = Schnappschuss {
        betreff: auftrag.betreff.to_string(),
        inhalt: auftrag.inhalt.to_string(),
    };
    let mail = nachricht::baue_mail(
        &von,
        auftrag.zugang.absender_name(),
        auftrag.adresse,
        &message_id(auftrag.versand_id, &von),
        &schnappschuss,
        auftrag.anhaenge,
    )
    .map_err(|_| anbindung_unbrauchbar())?;
    Ok((von, mail))
}

/// Ordnet einen Fehler der SMTP-Sitzung zu (Spec E-Mail, Abschnitt 6): Art, fester Grund für
/// das ETB und SMTP-Code. Anmeldung und TLS brauchen einen Eingriff, ihr Lauf soll es gleich
/// selbst feststellen.
pub fn smtp_fehlschlag(e: SmtpFehler) -> Fehlschlag {
    let voruebergehend = Zustellfehler::Voruebergehend { nicht_vor: None };
    let anbindung = |pruefung_vorziehen| Zustellfehler::Anbindung { pruefung_vorziehen };
    let (fehler, grund) = match e {
        SmtpFehler::Voruebergehend(c) => (
            voruebergehend,
            format!("Mailserver nimmt vorübergehend nicht an (SMTP {c})"),
        ),
        SmtpFehler::Dns => (voruebergehend, "Mailserver nicht gefunden".into()),
        SmtpFehler::Zeitueberschreitung => (voruebergehend, "Mailserver antwortet nicht".into()),
        SmtpFehler::Verbindung => (voruebergehend, "Mailserver nicht erreichbar".into()),
        SmtpFehler::Abgelehnt(c) => (
            Zustellfehler::Abgelehnt,
            format!("vom Mailserver abgelehnt (SMTP {c})"),
        ),
        SmtpFehler::Ungewiss => (Zustellfehler::Ungewiss, "Zustellung unklar".into()),
        SmtpFehler::Anmeldung => (anbindung(true), "Anmeldung am Mailserver abgelehnt".into()),
        SmtpFehler::Tls => (
            anbindung(true),
            "verschlüsselte Verbindung zum Mailserver gescheitert".into(),
        ),
        SmtpFehler::ZielIntern => (
            anbindung(false),
            "Adresse des Mailservers nicht erlaubt".into(),
        ),
        SmtpFehler::Antwort => (anbindung(false), "Antwort des Mailservers unlesbar".into()),
    };
    Fehlschlag {
        fehler,
        grund,
        smtp_status: e.status(),
        teile: Vec::new(),
    }
}

/// Eine vom Test-Doppel angenommene Zustellung (ohne Text: der enthält Inhalt). `umfang` ist bei
/// E-Mail die Größe der fertigen Mail in Bytes, sonst die Zahl der Teile (Text und Anlagen).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Angenommen {
    pub kanal: KanalArt,
    pub adresse: String,
    pub umfang: usize,
}

/// Das Doppel der e2e-Suite (LLH-2093): nimmt jede Zustellung an und merkt sie sich, ohne
/// Netz. Eine E-Mail baut es wie [`SmtpZusteller`] (eine nicht baubare scheitert auch hier).
/// Nur über [`testzusteller`] zu bekommen, und das gibt es nur in Debug-Builds.
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
        auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>> {
        Box::pin(async move {
            let umfang = match auftrag.kanal {
                KanalArt::Email => baue_smtp_mail(auftrag)?.1.len(),
                _ => 1 + auftrag.anhaenge.len(),
            };
            self.angenommen.lock().unwrap().push(Angenommen {
                kanal: auftrag.kanal,
                adresse: auftrag.adresse.to_string(),
                umfang,
            });
            Ok(Zustellt::default())
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
    async fn doppel_nimmt_an_und_merkt_sich_nur_kanal_adresse_und_groesse() {
        let z = AufzeichnenderZusteller::default();
        let mut einstellungen = serde_json::Map::new();
        einstellungen.insert("absender".into(), "von@example.org".into());
        let zugang = Versandzugang {
            einstellungen,
            geheimnisse: Default::default(),
            lan_erlaubt: false,
            adapter_id: "a".into(),
        };
        let auftrag = Versandauftrag {
            versand_id: "v1",
            kanal: KanalArt::Email,
            zugang: &zugang,
            adresse: "an@example.org",
            betreff: "Betreff",
            inhalt: "abc",
            anhaenge: &[],
            gesendet: &[],
        };
        z.zustellen(&auftrag).await.unwrap();
        let angenommen = z.angenommen();
        assert_eq!(angenommen.len(), 1);
        assert_eq!(angenommen[0].kanal, KanalArt::Email);
        assert_eq!(angenommen[0].adresse, "an@example.org");
        assert!(angenommen[0].umfang > 3, "{angenommen:?}");
    }

    fn zugang() -> Versandzugang {
        let mut einstellungen = serde_json::Map::new();
        einstellungen.insert("absender".into(), "von@example.org".into());
        Versandzugang {
            einstellungen,
            geheimnisse: Default::default(),
            lan_erlaubt: false,
            adapter_id: "a".into(),
        }
    }

    fn auftrag<'a>(kanal: KanalArt, zugang: &'a Versandzugang) -> Versandauftrag<'a> {
        Versandauftrag {
            versand_id: "v1",
            kanal,
            zugang,
            adresse: "#lage:example.org",
            betreff: "Betreff",
            inhalt: "abc",
            anhaenge: &[],
            gesendet: &[],
        }
    }

    /// Ein Transport, der zählt, wie oft er gerufen wurde.
    #[derive(Default)]
    struct Zaehler(std::sync::atomic::AtomicUsize);

    impl SmtpTransport for Zaehler {
        fn senden<'a>(
            &'a self,
            _: &'a Versandzugang,
            _: &'a str,
            _: &'a str,
            _: &'a [u8],
        ) -> BoxFuture<'a, Result<(), SmtpFehler>> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }
    }

    #[tokio::test]
    async fn smtp_zusteller_lehnt_andere_kanaele_ab() {
        let transport = Arc::new(Zaehler::default());
        let z = SmtpZusteller::mit_transport(transport.clone());
        let zugang = zugang();
        for kanal in [KanalArt::Matrix, KanalArt::Fax, KanalArt::Threema] {
            let f = z.zustellen(&auftrag(kanal, &zugang)).await.unwrap_err();
            assert_eq!(
                f.fehler,
                Zustellfehler::Anbindung {
                    pruefung_vorziehen: false
                },
                "{kanal:?}"
            );
        }
        assert_eq!(transport.0.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn zustellerwahl_gibt_jedem_kanal_seinen_zusteller() {
        let email = Arc::new(AufzeichnenderZusteller::default());
        let matrix = Arc::new(AufzeichnenderZusteller::default());
        let wahl = Zustellerwahl::new(email.clone(), matrix.clone());
        let zugang = zugang();
        wahl.zustellen(&auftrag(KanalArt::Matrix, &zugang))
            .await
            .unwrap();
        assert!(email.angenommen().is_empty());
        assert_eq!(matrix.angenommen().len(), 1);
        let mut a = auftrag(KanalArt::Email, &zugang);
        a.adresse = "an@example.org";
        wahl.zustellen(&a).await.unwrap();
        assert_eq!(email.angenommen().len(), 1);
        for kanal in [KanalArt::Fax, KanalArt::Threema] {
            let f = wahl.zustellen(&auftrag(kanal, &zugang)).await.unwrap_err();
            assert!(matches!(f.fehler, Zustellfehler::Anbindung { .. }));
        }
        assert_eq!(email.angenommen().len() + matrix.angenommen().len(), 2);
    }

    /// Die ETB-Gründe der E-Mail stehen fest: eine Änderung hier ist eine bewusste Änderung der
    /// Texte im Einsatztagebuch. Der `match` ohne Platzhalter bricht den Build, wenn ein neuer
    /// `SmtpFehler` keinen Eintrag bekommt.
    #[test]
    fn smtp_gruende_stehen_fest() {
        fn eintrag(e: SmtpFehler) -> (&'static str, Zustellfehler, Option<u16>) {
            let v = Zustellfehler::Voruebergehend { nicht_vor: None };
            let a = |p| Zustellfehler::Anbindung {
                pruefung_vorziehen: p,
            };
            match e {
                SmtpFehler::Voruebergehend(_) => (
                    "Mailserver nimmt vorübergehend nicht an (SMTP 451)",
                    v,
                    Some(451),
                ),
                SmtpFehler::Dns => ("Mailserver nicht gefunden", v, None),
                SmtpFehler::Zeitueberschreitung => ("Mailserver antwortet nicht", v, None),
                SmtpFehler::Verbindung => ("Mailserver nicht erreichbar", v, None),
                SmtpFehler::Abgelehnt(_) => (
                    "vom Mailserver abgelehnt (SMTP 550)",
                    Zustellfehler::Abgelehnt,
                    Some(550),
                ),
                SmtpFehler::Ungewiss => ("Zustellung unklar", Zustellfehler::Ungewiss, None),
                SmtpFehler::Anmeldung => ("Anmeldung am Mailserver abgelehnt", a(true), None),
                SmtpFehler::Tls => (
                    "verschlüsselte Verbindung zum Mailserver gescheitert",
                    a(true),
                    None,
                ),
                SmtpFehler::ZielIntern => ("Adresse des Mailservers nicht erlaubt", a(false), None),
                SmtpFehler::Antwort => ("Antwort des Mailservers unlesbar", a(false), None),
            }
        }
        for e in [
            SmtpFehler::Voruebergehend(451),
            SmtpFehler::Dns,
            SmtpFehler::Zeitueberschreitung,
            SmtpFehler::Verbindung,
            SmtpFehler::Abgelehnt(550),
            SmtpFehler::Ungewiss,
            SmtpFehler::Anmeldung,
            SmtpFehler::Tls,
            SmtpFehler::ZielIntern,
            SmtpFehler::Antwort,
        ] {
            let (grund, fehler, status) = eintrag(e);
            let f = smtp_fehlschlag(e);
            assert_eq!(f.grund, grund, "{e:?}");
            assert_eq!(f.fehler, fehler, "{e:?}");
            assert_eq!(f.smtp_status, status, "{e:?}");
            assert!(f.teile.is_empty());
        }
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
