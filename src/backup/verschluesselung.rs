//! Verschlüsselte Sicherungen (LFH-1002).
//!
//! Eine Sicherung ist eine Vollkopie der Einsatz-Datenbank, mit Gesundheitsdaten der Sichtung.
//! Mit gesetzten Empfängern (`--backup-empfaenger`) verlässt sie das Datenbank-Verzeichnis nur
//! verschlüsselt: `age` an öffentliche X25519-Schlüssel. Der Server kennt nur die öffentlichen
//! Schlüssel; ein kompromittierter Server kann alte Sicherungen deshalb nicht lesen. Der private
//! Schlüssel liegt offline und kommt nur zum Restore (`restore --identitaet`) auf die Maschine.

use crate::error::AppError;
use age::secrecy::{ExposeSecret, SecretString};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Erste Zeile jeder `age`-Datei (Format v1). Daran erkennt der Restore eine verschlüsselte
/// Sicherung, unabhängig von der Endung.
pub const AGE_KOPF: &[u8] = b"age-encryption.org/v1\n";

/// Endung, die eine verschlüsselte Sicherung an `.sqlite` anhängt.
pub const AGE_ENDUNG: &str = ".age";

/// Öffentliche Schlüssel, an die Sicherungen verschlüsselt werden. Leer: Sicherungen bleiben
/// Klartext wie vor LFH-1002 (ELW-Betrieb ohne Schlüssel).
#[derive(Clone, Debug, Default)]
pub struct Empfaenger(Arc<[age::x25519::Recipient]>);

impl Empfaenger {
    pub fn neu(schluessel: Vec<age::x25519::Recipient>) -> Self {
        Self(schluessel.into())
    }

    pub fn ist_leer(&self) -> bool {
        self.0.is_empty()
    }

    pub fn anzahl(&self) -> usize {
        self.0.len()
    }

    /// Endung des Dateinamens einer Sicherung: `.sqlite` oder `.sqlite.age`.
    pub fn endung(&self) -> &'static str {
        if self.ist_leer() {
            ".sqlite"
        } else {
            ".sqlite.age"
        }
    }

    fn als_age(&self) -> impl Iterator<Item = &dyn age::Recipient> {
        self.0.iter().map(|r| r as &dyn age::Recipient)
    }
}

/// Ziel der verschlüsselten Bytes. Neben dem Schreiben muss es sich festschreiben lassen (`fsync`),
/// bevor die Teildatei ihren Endnamen bekommt.
pub(crate) trait Ausgabe: Write + Send {
    fn festschreiben(&mut self) -> io::Result<()>;
}

impl Ausgabe for std::fs::File {
    fn festschreiben(&mut self) -> io::Result<()> {
        self.sync_all()
    }
}

/// Verschlüsselt die Datei `quelle` als Strom an `empfaenger` nach `ausgabe` und liefert die
/// Ausgabe zurück. Ohne `finish` wäre die Datei abgeschnitten und nicht entschlüsselbar; ein
/// Fehler dazwischen bricht ab, die Teildatei räumt der Aufrufer weg.
///
/// Springt `abbruch` auf `true`, endet der Lauf mit dem nächsten gelesenen Block: der Thread
/// liefe sonst über die Frist beim Herunterfahren hinaus weiter, und die Runtime wartete auf ihn.
pub(crate) fn verschluessele_datei<W: Write>(
    quelle: &Path,
    ausgabe: W,
    empfaenger: &Empfaenger,
    abbruch: &AtomicBool,
) -> io::Result<W> {
    let verschluesseler =
        age::Encryptor::with_recipients(empfaenger.als_age()).map_err(io::Error::other)?;
    let mut schreiber = verschluesseler.wrap_output(ausgabe)?;
    let mut eingabe = Abbrechbar {
        innen: std::fs::File::open(quelle)?,
        abbruch,
    };
    io::copy(&mut eingabe, &mut schreiber)?;
    schreiber.finish()
}

/// Leser, der mit einem Fehler endet, sobald `abbruch` gesetzt ist.
struct Abbrechbar<'a, R> {
    innen: R,
    abbruch: &'a AtomicBool,
}

impl<R: Read> Read for Abbrechbar<'_, R> {
    fn read(&mut self, puffer: &mut [u8]) -> io::Result<usize> {
        if self.abbruch.load(Ordering::Relaxed) {
            return Err(io::Error::other("Sicherung abgebrochen"));
        }
        self.innen.read(puffer)
    }
}

/// Setzt beim Fallenlassen das Abbruch-Signal für [`verschluessele_datei`]: fällt das Future,
/// das auf den Thread wartet (Shutdown), hört auch der Thread auf.
pub(crate) struct AbbruchBeiDrop(pub(crate) Arc<AtomicBool>);

impl Drop for AbbruchBeiDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// Beginnt die Datei mit dem `age`-Kopf? Eine Datei, die kürzer ist, ist es nicht.
pub fn ist_verschluesselt(pfad: &Path) -> io::Result<bool> {
    let mut kopf = Vec::with_capacity(AGE_KOPF.len());
    std::fs::File::open(pfad)?
        .take(AGE_KOPF.len() as u64)
        .read_to_end(&mut kopf)?;
    Ok(kopf == AGE_KOPF)
}

/// Private Schlüssel für den Restore einer verschlüsselten Sicherung. `Send + Sync`, damit ein
/// Request-Handler sie über ein `await` halten kann (Archiv einspielen, LLH-1711).
pub struct Schluessel {
    identitaeten: Vec<Box<dyn age::Identity + Send + Sync>>,
}

impl Schluessel {
    /// Liest Identitäten aus dem Inhalt einer `age`-Identitätsdatei (`AGE-SECRET-KEY-1…`, wie sie
    /// `age-keygen` schreibt). Ist die Datei selbst mit einer Passphrase verschlüsselt
    /// (`age -p`), fragt `passphrase` sie ab und entsperrt die Datei sofort; eine falsche
    /// Passphrase scheitert also hier. Sonst wird `passphrase` nie gerufen.
    pub fn laden(
        inhalt: Vec<u8>,
        name: Option<String>,
        passphrase: impl FnOnce() -> io::Result<String>,
    ) -> Result<Self, AppError> {
        Self::laden_aus(&inhalt, name, passphrase)
    }

    /// Wie [`Self::laden`], aber aus einem geliehenen Puffer: wer den Schlüssel geschützt im
    /// Speicher hält (LLH-1711, design.md D4), legt so keine ungeschützte Kopie an. Der
    /// entsperrte Inhalt einer geschützten Datei liegt nur in einem Puffer, der beim Fallenlassen
    /// genullt wird.
    pub fn laden_aus(
        inhalt: &[u8],
        name: Option<String>,
        passphrase: impl FnOnce() -> io::Result<String>,
    ) -> Result<Self, AppError> {
        // Der Name nannte früher die Datei in Rückfragen von `age`; Rückfragen gibt es keine mehr.
        let _ = name;
        if !inhalt.starts_with(AGE_KOPF) {
            return Self::aus_klartext(inhalt);
        }
        let passphrase = passphrase().map_err(|e| {
            AppError::Validation(format!("Passphrase der Identitätsdatei nicht lesbar: {e}"))
        })?;
        Self::laden_geschuetzt(
            inhalt,
            Some(SecretString::from(
                passphrase.trim_end_matches(['\r', '\n']).to_owned(),
            )),
        )
    }

    /// Wie [`Self::laden_aus`], mit der Passphrase schon als Geheimnis (Archiv einspielen über die
    /// Verwaltung, LLH-1711): sie entsteht nie als gewöhnlicher `String`. Ohne Passphrase ist eine
    /// geschützte Datei ein Fehler, eine Passphrase zu einer ungeschützten wird nicht gebraucht.
    /// Entsperren kostet scrypt (Sekunden): auf einem Blocking-Thread rufen.
    pub fn laden_geschuetzt(
        inhalt: &[u8],
        passphrase: Option<SecretString>,
    ) -> Result<Self, AppError> {
        if !inhalt.starts_with(AGE_KOPF) {
            return Self::aus_klartext(inhalt);
        }
        let passphrase = passphrase.ok_or_else(|| {
            AppError::Validation(
                "Die Schlüsseldatei ist mit einer Passphrase geschützt; die Passphrase angeben."
                    .into(),
            )
        })?;
        let schloss = age::scrypt::Identity::new(passphrase);
        let mut leser = age::Decryptor::new_buffered(inhalt)
            .map_err(|e| AppError::Validation(format!("Identitätsdatei nicht lesbar: {e}")))?
            .decrypt(std::iter::once(&schloss as &dyn age::Identity))
            .map_err(|e| match e {
                age::DecryptError::NoMatchingKeys => AppError::Validation(
                    "Identitätsdatei ist verschlüsselt, aber nicht mit einer Passphrase".into(),
                ),
                _ => AppError::Validation(
                    "Die Passphrase passt nicht zur Identitätsdatei, oder die Datei ist \
                     beschädigt"
                        .into(),
                ),
            })?;
        let mut klar = age::secrecy::SecretBox::new(Box::new(Vec::with_capacity(inhalt.len())));
        leser
            .read_to_end(age::secrecy::ExposeSecretMut::expose_secret_mut(&mut klar))
            .map_err(|e| AppError::Validation(format!("Identitätsdatei beschädigt: {e}")))?;
        Self::aus_klartext(klar.expose_secret())
    }

    fn aus_klartext(inhalt: &[u8]) -> Result<Self, AppError> {
        let datei = age::IdentityFile::from_buffer(io::Cursor::new(inhalt))
            .map_err(|e| AppError::Validation(format!("Identitätsdatei nicht lesbar: {e}")))?;
        let identitaeten = datei
            .into_identities()
            .map_err(|e| AppError::Validation(format!("Identitätsdatei nicht lesbar: {e}")))?;
        if identitaeten.is_empty() {
            return Err(AppError::Validation(
                "Identitätsdatei enthält keinen Schlüssel (AGE-SECRET-KEY-1…)".into(),
            ));
        }
        Ok(Self { identitaeten })
    }

    /// Entschlüsselt `quelle` nach `ausgabe`. Ein falscher Schlüssel scheitert, bevor ein Byte
    /// geschrieben ist; ein beschädigter Strom mittendrin, dann hat `ausgabe` einen Teil
    /// bekommen und der Aufrufer verwirft sie.
    pub(crate) fn entschluessele_datei<W: Write>(
        &self,
        quelle: &Path,
        ausgabe: W,
    ) -> Result<W, AppError> {
        let eingabe = io::BufReader::new(
            std::fs::File::open(quelle)
                .map_err(|e| AppError::Validation(format!("Sicherungsdatei nicht lesbar: {e}")))?,
        );
        self.entschluessele(eingabe, ausgabe)
    }

    /// Wie [`Self::entschluessele_datei`], aus einem Leser (etwa einem Archivblock aus der
    /// Datenbank, LLH-1712).
    pub(crate) fn entschluessele<R: io::BufRead, W: Write>(
        &self,
        eingabe: R,
        mut ausgabe: W,
    ) -> Result<W, AppError> {
        let entschluesseler = age::Decryptor::new_buffered(eingabe).map_err(|e| {
            AppError::Validation(format!("Verschlüsselte Sicherung nicht lesbar: {e}"))
        })?;
        let mut leser = entschluesseler
            .decrypt(
                self.identitaeten
                    .iter()
                    .map(|i| i.as_ref() as &dyn age::Identity),
            )
            .map_err(|e| match e {
                age::DecryptError::NoMatchingKeys => {
                    AppError::Validation("Der Schlüssel passt nicht zu dieser Sicherung".into())
                }
                andere => AppError::Validation(format!(
                    "Sicherung lässt sich nicht entschlüsseln: {andere}"
                )),
            })?;
        io::copy(&mut leser, &mut ausgabe).map_err(|e| {
            AppError::Validation(format!(
                "Sicherung beim Entschlüsseln beschädigt oder unvollständig: {e}"
            ))
        })?;
        Ok(ausgabe)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Ein frisches Schlüsselpaar: der Empfänger für die Sicherung, die Identitätsdatei für den
    /// Restore.
    pub(crate) fn schluesselpaar() -> (Empfaenger, Vec<u8>) {
        let identitaet = age::x25519::Identity::generate();
        let empfaenger = Empfaenger::neu(vec![identitaet.to_public()]);
        let datei = format!(
            "# erzeugt im Test\n{}\n",
            identitaet.to_string().expose_secret()
        );
        (empfaenger, datei.into_bytes())
    }

    fn keine_passphrase() -> io::Result<String> {
        panic!("eine unverschlüsselte Identitätsdatei fragt keine Passphrase ab")
    }

    #[test]
    fn verschluesselt_und_entschluesselt_im_kreis() {
        let dir = tempfile::tempdir().unwrap();
        let klartext = dir.path().join("klartext");
        std::fs::write(&klartext, b"SQLite format 3\0 und Inhalt").unwrap();
        let (empfaenger, identitaet) = schluesselpaar();

        let geheim =
            verschluessele_datei(&klartext, Vec::new(), &empfaenger, &AtomicBool::new(false))
                .unwrap();
        assert!(geheim.starts_with(AGE_KOPF));
        assert!(!geheim
            .windows(b"SQLite format 3".len())
            .any(|w| w == b"SQLite format 3"));
        let verschluesselt = dir.path().join("geheim.age");
        std::fs::write(&verschluesselt, &geheim).unwrap();
        assert!(ist_verschluesselt(&verschluesselt).unwrap());
        assert!(!ist_verschluesselt(&klartext).unwrap());

        let schluessel = Schluessel::laden(identitaet, None, keine_passphrase).unwrap();
        let zurueck = schluessel
            .entschluessele_datei(&verschluesselt, Vec::new())
            .unwrap();
        assert_eq!(zurueck, b"SQLite format 3\0 und Inhalt");
    }

    #[test]
    fn gesetzter_abbruch_beendet_die_verschluesselung() {
        let dir = tempfile::tempdir().unwrap();
        let klartext = dir.path().join("klartext");
        std::fs::write(&klartext, b"inhalt").unwrap();
        let (empfaenger, _) = schluesselpaar();

        assert!(
            verschluessele_datei(&klartext, Vec::new(), &empfaenger, &AtomicBool::new(true))
                .is_err()
        );
    }

    #[test]
    fn mehrere_empfaenger_jeder_kann_entschluesseln() {
        let dir = tempfile::tempdir().unwrap();
        let klartext = dir.path().join("klartext");
        std::fs::write(&klartext, b"inhalt").unwrap();
        let (haupt, haupt_id) = schluesselpaar();
        let (notfall, notfall_id) = schluesselpaar();
        let beide = Empfaenger::neu(haupt.0.iter().chain(notfall.0.iter()).cloned().collect());

        let geheim = dir.path().join("geheim.age");
        std::fs::write(
            &geheim,
            verschluessele_datei(&klartext, Vec::new(), &beide, &AtomicBool::new(false)).unwrap(),
        )
        .unwrap();

        for id in [haupt_id, notfall_id] {
            let schluessel = Schluessel::laden(id, None, keine_passphrase).unwrap();
            assert_eq!(
                schluessel
                    .entschluessele_datei(&geheim, Vec::new())
                    .unwrap(),
                b"inhalt"
            );
        }
    }

    #[test]
    fn falscher_schluessel_schreibt_nichts() {
        let dir = tempfile::tempdir().unwrap();
        let klartext = dir.path().join("klartext");
        std::fs::write(&klartext, b"inhalt").unwrap();
        let (empfaenger, _) = schluesselpaar();
        let (_, fremd) = schluesselpaar();
        let geheim = dir.path().join("geheim.age");
        std::fs::write(
            &geheim,
            verschluessele_datei(&klartext, Vec::new(), &empfaenger, &AtomicBool::new(false))
                .unwrap(),
        )
        .unwrap();

        let schluessel = Schluessel::laden(fremd, None, keine_passphrase).unwrap();
        let mut ausgabe = Vec::new();
        let fehler = schluessel
            .entschluessele_datei(&geheim, &mut ausgabe)
            .unwrap_err();
        assert!(matches!(fehler, AppError::Validation(m) if m.contains("passt nicht")));
        assert!(ausgabe.is_empty());
    }

    #[test]
    fn passphrase_geschuetzte_identitaet_wird_entsperrt() {
        let dir = tempfile::tempdir().unwrap();
        let klartext = dir.path().join("klartext");
        std::fs::write(&klartext, b"inhalt").unwrap();
        let (empfaenger, identitaet) = schluesselpaar();
        let geheim = dir.path().join("geheim.age");
        std::fs::write(
            &geheim,
            verschluessele_datei(&klartext, Vec::new(), &empfaenger, &AtomicBool::new(false))
                .unwrap(),
        )
        .unwrap();

        // `age -p` auf die Identitätsdatei, mit kleinem Arbeitsfaktor, damit der Test schnell ist.
        let mut passphrase = age::scrypt::Recipient::new(SecretString::from("geheim".to_owned()));
        passphrase.set_work_factor(10);
        let mut geschuetzt = Vec::new();
        let mut schreiber =
            age::Encryptor::with_recipients(std::iter::once(&passphrase as &dyn age::Recipient))
                .unwrap()
                .wrap_output(&mut geschuetzt)
                .unwrap();
        schreiber.write_all(&identitaet).unwrap();
        schreiber.finish().unwrap();

        // Seit LLH-1711 wird die Datei beim Laden entsperrt: eine falsche Passphrase scheitert
        // dort, nicht erst am Block.
        let falsch = Schluessel::laden(geschuetzt.clone(), None, || Ok("falsch\n".into()));
        assert!(
            matches!(falsch, Err(AppError::Validation(ref m)) if m.contains("Passphrase passt nicht")),
            "eine falsche Passphrase entsperrt nichts"
        );

        let schluessel = Schluessel::laden(geschuetzt, None, || Ok("geheim\n".into())).unwrap();
        assert_eq!(
            schluessel
                .entschluessele_datei(&geheim, Vec::new())
                .unwrap(),
            b"inhalt"
        );
    }

    /// LLH-1711, design.md D4: die Verwaltung leiht den Puffer, den sie geschützt hält.
    #[test]
    fn laden_aus_einem_geliehenen_puffer_mit_und_ohne_passphrase() {
        let dir = tempfile::tempdir().unwrap();
        let klartext = dir.path().join("klartext");
        std::fs::write(&klartext, b"inhalt").unwrap();
        let (empfaenger, identitaet) = schluesselpaar();
        let geheim = dir.path().join("geheim.age");
        std::fs::write(
            &geheim,
            verschluessele_datei(&klartext, Vec::new(), &empfaenger, &AtomicBool::new(false))
                .unwrap(),
        )
        .unwrap();
        let schluessel = Schluessel::laden_aus(&identitaet, None, keine_passphrase).unwrap();
        assert_eq!(
            schluessel
                .entschluessele_datei(&geheim, Vec::new())
                .unwrap(),
            b"inhalt"
        );

        let mut passphrase = age::scrypt::Recipient::new(SecretString::from("geheim".to_owned()));
        passphrase.set_work_factor(10);
        let mut geschuetzt = Vec::new();
        let mut schreiber =
            age::Encryptor::with_recipients(std::iter::once(&passphrase as &dyn age::Recipient))
                .unwrap()
                .wrap_output(&mut geschuetzt)
                .unwrap();
        schreiber.write_all(&identitaet).unwrap();
        schreiber.finish().unwrap();
        let schluessel = Schluessel::laden_aus(&geschuetzt, None, || Ok("geheim".into())).unwrap();
        assert_eq!(
            schluessel
                .entschluessele_datei(&geheim, Vec::new())
                .unwrap(),
            b"inhalt"
        );
        // Ohne Passphrase: abgelehnt, nicht entsperrt.
        let ohne = Schluessel::laden_aus(&geschuetzt, None, || {
            Err(io::Error::other("keine Passphrase angegeben"))
        });
        assert!(matches!(ohne, Err(AppError::Validation(_))));
    }

    #[test]
    fn leere_oder_fremde_identitaetsdatei_wird_abgelehnt() {
        assert!(Schluessel::laden(b"# nur Kommentar\n".to_vec(), None, keine_passphrase).is_err());
        assert!(Schluessel::laden(b"kein schluessel\n".to_vec(), None, keine_passphrase).is_err());
    }
}
