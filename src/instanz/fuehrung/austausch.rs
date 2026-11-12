//! Austausch der Führungsakten in der Meldung (design.md D3, D7, D9, D10).
//!
//! Beide Seiten schicken die Akten der zugeordneten Orgs, die sich seit der letzten Quittung des
//! Gegenübers geändert haben (`stand` über `fuehrung_bis`), höchstens [`AKTEN_MAX`] je Nachricht.
//! Was ankommt, entscheidet [`entscheide`] nach der Richtung der Kopplung:
//!
//! - Eine größere Epoche, die mir die Führung nicht nimmt, gilt.
//! - Nimmt sie mir die Führung, nimmt die erreichte Seite (Hub) sie an; die meldende Seite (ELW)
//!   nur mit gültigem Beweis, und auch dann erst nach der Entscheidung der Einsatzleitung (offen).
//!   Ohne gültigen Beweis verwirft sie die Akte und führt mit der nächsten Epoche weiter (D10).
//! - Eine Anfrage der meldenden Seite an eine Akte, die die erreichte Seite führt, erfüllt diese
//!   sofort (D9).

use super::erklaerung::{self, FuehrungBeweis, NotuebernahmeErklaerung};
use super::repo::{self, AkteZeile, Ich, VerlaufNeu};
use super::{Epoche, FuehrungWechselArt};
use crate::auth::admin_audit::AdminAktion;
use crate::auth::unterschrift::pruefen;
use crate::auth::unterschrift::repo as unterschrift;
use crate::error::AppError;
use crate::instanz::repo::KopplungZeile;
use crate::instanz::{InstanzKopplungArt, InstanzKopplungRichtung};
use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;

/// Höchstzahl Akten je Nachricht.
pub const AKTEN_MAX: usize = 50;
/// Byte-Budget der Akten in einer Meldung (der Rumpf darf höchstens 64 KiB groß sein).
pub const MELDUNG_BYTES: usize = 40 * 1024;
/// Byte-Budget der Akten in einer Antwort. Es geht vom Budget der Stammdaten ab und muss neben
/// der größten Nachlieferung der Unterschriftsschlüssel in `melden::ANTWORT_MAX` passen (Test
/// `melden::tests::groesste_antwort_passt_in_die_lesegrenze`, LLH-1672).
pub const ANTWORT_BYTES: usize = 128 * 1024;
/// Obergrenzen der Textfelder einer gelieferten Akte (Zeichen).
const TEXT_MAX: usize = 500;
const ERKLAERUNG_MAX: usize = 4096;
/// Größter Zähler einer gelieferten Epoche: weit über jedem echten Verlauf, weit unter dem
/// Überlauf (`Epoche::naechste` rechnet plus eins).
const ZAEHLER_MAX: i64 = 1 << 40;
/// Größter Stand einer gelieferten Akte (LLH-1672): Stände folgen den Unix-Sekunden und zählen
/// je Änderung mindestens eins hoch (LLH-1708, `repo::next_stand`), um 2026 also bei 1,8 · 10⁹,
/// weit darunter; ein Stand darüber setzte die Quittung dauerhaft aufs Maximum.
const STAND_MAX: i64 = 1 << 40;
/// Bis hierher darf eine Quittung des Gegenübers den eigenen Zähler heben (LLH-1708, design.md
/// D3): Eine gekoppelte Seite soll ihn nicht bis an [`STAND_MAX`] treiben können, ab dem jede
/// weitere Akte abgelehnt würde.
pub const STAND_RAISE_MAX: i64 = STAND_MAX / 2;
/// Länge eines Prüfwerts aus dem Abgabecode (HMAC-SHA256, Base64url: 43 Zeichen) mit Luft.
const PRUEFWERT_MAX: usize = 64;
/// Größte Akte in Byte (JSON), die hinausgeht: passt in jede Meldung ([`MELDUNG_BYTES`]) und
/// jede Antwort.
pub const AKTE_BYTES: usize = 32 * 1024;
/// Spielraum zwischen Annahme und Ausgang: Eine angenommene Akte geht neu gebaut weiter (eigener
/// Stand bis 20 Ziffern, `anfrage`/`offen` als `false`, eigener Org-Schlüssel bis 88 Zeichen, in
/// JSON höchstens sechs Byte je Zeichen). Ohne ihn läge sie dann über [`AKTE_BYTES`] (LLH-1672).
const AKTE_SPIELRAUM: usize = 1024;

/// Eine Akte auf der Leitung.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AkteMeldung {
    pub kennung: String,
    /// Org-Schlüssel der erreichten Seite.
    pub org: String,
    #[serde(default)]
    pub nummer: Option<String>,
    pub bezeichnung: String,
    #[serde(default)]
    pub stichwort: Option<String>,
    pub status: String,
    pub epoche: Epoche,
    pub fuehrer: String,
    pub fuehrer_name: String,
    pub art: String,
    #[serde(default)]
    pub erklaerung: Option<String>,
    #[serde(default)]
    pub beweis: Option<FuehrungBeweis>,
    /// Die meldende Seite bittet um die Führung (D9).
    #[serde(default)]
    pub anfrage: bool,
    /// Die sendende Seite hält eine Übernahme gegen sich offen.
    #[serde(default)]
    pub offen: bool,
    /// Stand der sendenden Seite.
    pub stand: i64,
}

/// Kürzt einen Text auf höchstens `max` Zeichen.
fn truncate_chars(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_string(),
        None => s.to_string(),
    }
}

impl AkteMeldung {
    /// Baut die Akte für die Leitung. Die Kopf-Felder (Anzeige beim Gegenüber) kommen auf
    /// [`TEXT_MAX`] gekürzt: lokal haben Bezeichnung und Stichwort keine Grenze, und eine Akte
    /// darüber nähme das Gegenüber nicht an (LLH-1672).
    fn aus(a: &AkteZeile, org: &str) -> Self {
        Self {
            kennung: a.kennung.clone(),
            org: org.to_string(),
            nummer: a.nummer.as_deref().map(|n| truncate_chars(n, TEXT_MAX)),
            bezeichnung: truncate_chars(&a.bezeichnung, TEXT_MAX),
            stichwort: a.stichwort.as_deref().map(|s| truncate_chars(s, TEXT_MAX)),
            status: a.status.clone(),
            epoche: a.epoche(),
            fuehrer: a.fuehrer_kennung.clone(),
            fuehrer_name: truncate_chars(&a.fuehrer_name, TEXT_MAX),
            art: a.art.clone(),
            erklaerung: a.erklaerung.clone(),
            beweis: a
                .beweis
                .as_deref()
                .and_then(|b| serde_json::from_str(b).ok()),
            anfrage: a.anfrage_at.is_some(),
            offen: a.offen.is_some(),
            stand: a.stand,
        }
    }

    /// Derselbe Führungswechsel: Epoche, Führer und Erklärung. Die übrigen Felder zählen nicht:
    /// `stand` vergibt das Gegenüber bei jedem erneuten Senden neu, der Kopf ändert sich mit dem
    /// Einsatz und nicht mit der Führung, und ein Beweis kommt nur bis hierher, wenn er diese
    /// Erklärung trägt (`check_unterschrift`) (LLH-1671).
    fn is_gleicher_wechsel(&self, other: &Self) -> bool {
        self.epoche == other.epoche
            && self.fuehrer == other.fuehrer
            && self.erklaerung == other.erklaerung
    }

    /// Ob der Stand der sendenden Seite plausibel ist; nur ein solcher zählt für die Quittung.
    fn is_stand_plausibel(&self) -> bool {
        (1..=STAND_MAX).contains(&self.stand)
    }

    /// Ob der Beweis in seinen Grenzen liegt (Assertion wie `pruefen::verify`, Prüfwert kurz).
    fn is_beweis_in_grenzen(&self) -> bool {
        use crate::auth::unterschrift::pruefen::{
            AUTHENTICATOR_DATA_MAX, CLIENT_DATA_JSON_MAX, CREDENTIAL_ID_MAX, SIGNATUR_MAX,
        };
        match &self.beweis {
            None => true,
            Some(FuehrungBeweis::Unterschrift { assertion: a }) => {
                a.credential_id.len() <= CREDENTIAL_ID_MAX
                    && a.authenticator_data.len() <= AUTHENTICATOR_DATA_MAX
                    && a.client_data_json.len() <= CLIENT_DATA_JSON_MAX
                    && a.signatur.len() <= SIGNATUR_MAX
            }
            Some(FuehrungBeweis::Code { pruefwert }) => pruefwert.len() <= PRUEFWERT_MAX,
        }
    }

    /// Größe auf der Leitung (JSON) in Byte.
    fn bytes(&self) -> usize {
        serde_json::to_vec(self).map_or(usize::MAX, |v| v.len())
    }

    /// Grenzen einer gelieferten Akte; eine Akte darüber wird nicht übernommen. Was hier
    /// durchgeht, wird gespeichert und geht neu gebaut weiter, deshalb gilt am Eingang
    /// [`AKTE_BYTES`] abzüglich [`AKTE_SPIELRAUM`].
    fn is_in_grenzen(&self) -> bool {
        self.is_in_grenzen_bis(AKTE_BYTES - AKTE_SPIELRAUM)
    }

    /// Die Grenzen der Felder und höchstens `bytes_max` Byte JSON.
    fn is_in_grenzen_bis(&self, bytes_max: usize) -> bool {
        let kurz = |s: &str| s.chars().count() <= TEXT_MAX;
        kurz(&self.kennung)
            && kurz(&self.org)
            && self.nummer.as_deref().is_none_or(kurz)
            && kurz(&self.bezeichnung)
            && self.stichwort.as_deref().is_none_or(kurz)
            && kurz(&self.fuehrer)
            && kurz(&self.fuehrer_name)
            && kurz(&self.epoche.instanz)
            && (1..=ZAEHLER_MAX).contains(&self.epoche.zaehler)
            && matches!(self.status.as_str(), "aktiv" | "abgeschlossen")
            && FuehrungWechselArt::parse(&self.art).is_some()
            && self
                .erklaerung
                .as_deref()
                .is_none_or(|e| e.len() <= ERKLAERUNG_MAX)
            && self.is_beweis_in_grenzen()
            && self.is_stand_plausibel()
            && self.bytes() <= bytes_max
    }
}

/// Was eine Seite an Akten hinausschickt.
#[derive(Debug, Default)]
pub struct Ausgang {
    pub akten: Vec<AkteMeldung>,
    /// Es bleibt mehr, als in diese Nachricht passte.
    pub mehr: bool,
    /// Höchster Stand, den diese Nachricht abdeckt (gesendet oder übersprungen); 0 ohne Akte.
    /// Mehr darf das Gegenüber nicht quittieren.
    pub bis: i64,
}

/// Baut die Akten für eine Kopplung: Stand über `ab`, höchstens [`AKTEN_MAX`] und `bytes`
/// (mindestens [`AKTE_BYTES`]). Eine Akte über den Grenzen des Ausgangs (Felder wie beim
/// Empfänger, höchstens [`AKTE_BYTES`]; der Empfänger hält [`AKTE_SPIELRAUM`] für das Neubauen
/// zurück, den eine ehrlich entstandene Akte nie braucht) wird übersprungen, mit Hinweis an der Kopplung; ihr Stand zählt als
/// abgedeckt, das Gegenüber behält die bisherige Fassung, und mit der nächsten Änderung geht sie
/// wieder hinaus (LLH-1672, wie `zu_gross` beim Spiegel). Anhalten ließe eine einzige Akte, auch
/// eine fremde, den Austausch der ganzen Kopplung stehen.
pub async fn build_ausgang(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    ab: i64,
    bytes: usize,
) -> Result<Ausgang, AppError> {
    let Some(richtung) = kopplung.richtung() else {
        return Ok(Ausgang::default());
    };
    let orgs = repo::list_orgs_der_kopplung(conn, kopplung.id, richtung).await?;
    let ids: Vec<i64> = orgs.iter().map(|(id, _)| *id).collect();
    let zeilen = repo::list_zu_senden(conn, &ids, ab, AKTEN_MAX + 1).await?;
    let mut aus = Ausgang::default();
    let mut summe = 0;
    for a in &zeilen {
        let Some((_, org)) = orgs.iter().find(|(id, _)| *id == a.org_id) else {
            continue;
        };
        let m = AkteMeldung::aus(a, org);
        let groesse = m.bytes();
        if !m.is_in_grenzen_bis(AKTE_BYTES) {
            let grund = if groesse > AKTE_BYTES {
                format!("zu groß ({groesse} Byte, höchstens {AKTE_BYTES})")
            } else {
                "über den Grenzen, die das Gegenüber annimmt".to_string()
            };
            crate::instanz::repo::set_hinweis(
                conn,
                kopplung.id,
                &format!(
                    "Führungsakte „{}“ geht nicht an {}: {grund}. Dort bleibt die bisherige \
                     Fassung, bis sich die Akte wieder ändert.",
                    truncate_chars(&a.bezeichnung, 80),
                    kopplung.gegenueber_name
                ),
            )
            .await?;
            aus.bis = aus.bis.max(a.stand);
            continue;
        }
        if aus.akten.len() == AKTEN_MAX || summe + groesse > bytes {
            aus.mehr = true;
            return Ok(aus);
        }
        summe += groesse;
        aus.bis = aus.bis.max(a.stand);
        aus.akten.push(m);
    }
    // Übersprungene zählen nicht gegen AKTEN_MAX: Lagen mehr Zeilen bereit, folgen sie. Ohne
    // gesendete Akte quittiert das Gegenüber nichts, ein „sofort wieder“ drehte sich im Kreis.
    aus.mehr = zeilen.len() > AKTEN_MAX && !aus.akten.is_empty();
    Ok(aus)
}

/// Quittung nach einer gelieferten Akte: Nur ein plausibler Stand zählt, ein Wert wie `i64::MAX`
/// setzte sie dauerhaft aufs Maximum (LLH-1672). Eine abgelehnte Akte mit plausiblem Stand wird
/// quittiert, aber nicht still (Hinweis in [`apply_eingang`]).
fn quittung_nach(bis: Option<i64>, m: &AkteMeldung) -> Option<i64> {
    if !m.is_stand_plausibel() {
        return bis;
    }
    Some(bis.map_or(m.stand, |b| b.max(m.stand)))
}

/// Was nach dem Commit eines Austauschs zu tun ist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Folge {
    /// Der Kopf eines lokalen Einsatzes hat sich geändert (Live-Ereignis `einsatz`).
    Kopf { einsatz_id: i64 },
    /// Alarm „ungültige Übernahme“ an die Einsatzleitung.
    Alarm { einsatz_id: i64 },
    /// Eine gültige Übernahme wartet auf die Einsatzleitung.
    Offen { einsatz_id: i64 },
    /// Eintrag in der Admin-Spur der Org, ausgelöst vom Gegenüber.
    Spur {
        aktion: AdminAktion,
        org_id: i64,
        grund: String,
    },
}

/// Ergebnis eines Austauschs.
#[derive(Debug, Default)]
pub struct Eingang {
    /// Höchster Stand des Gegenübers in dieser Nachricht (seine Quittung beim nächsten Mal).
    pub bis: Option<i64>,
    pub folgen: Vec<Folge>,
    /// Hinweis an der Kopplung (der jüngste gilt).
    pub hinweis: Option<String>,
}

/// Wie eine eingehende Akte, die mir die Führung nimmt, behandelt wird (D7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entscheid {
    /// Übernehmen.
    Annehmen,
    /// Gültig bewiesen, aber erst nach der Entscheidung der Einsatzleitung (meldende Seite).
    OffenHalten,
    /// Verwerfen, mit Grund.
    Verwerfen(String),
}

/// Die Annahmeregel als reine Funktion (Tabelle in design.md D7 der Change `v6hj7xl2`, ergänzt in
/// design.md D3 und D7 der Change `faq7l7m4-zwei-elw-unterlegene-seite`): `richtung` der Kopplung
/// aus meiner Sicht, `bewiesen` = ob der Beweis gegen meine Schlüssel trägt (nur für die meldende
/// Seite von Belang), `dritter` = an der Akte ist eine dritte Instanz beteiligt (sie führt, oder
/// sie hat die Epoche vergeben, mit der die erreichte Seite selbst führt). Dann gibt es keinen
/// Beweis gegen mich, und niemand hat Unrechtes getan: offen halten, ohne Alarm.
pub fn entscheide(
    richtung: InstanzKopplungRichtung,
    bewiesen: Result<(), String>,
    dritter: bool,
) -> Entscheid {
    match (richtung, bewiesen) {
        (InstanzKopplungRichtung::WirdGemeldet, _) => Entscheid::Annehmen,
        (InstanzKopplungRichtung::MeldetSich, _) if dritter => Entscheid::OffenHalten,
        (InstanzKopplungRichtung::MeldetSich, Ok(())) => Entscheid::OffenHalten,
        (InstanzKopplungRichtung::MeldetSich, Err(grund)) => Entscheid::Verwerfen(grund),
    }
}

/// Übernimmt eine Akte, die mir die Führung nicht nimmt: Epoche und Führer des Absenders, eine
/// überholte offene Übernahme fällt weg, Verlauf und Kopf folgen.
async fn folge_dem_absender(
    conn: &mut SqliteConnection,
    a: &mut AkteZeile,
    m: &AkteMeldung,
    aus: &mut Eingang,
) -> Result<(), AppError> {
    let von = a.fuehrer_name.clone();
    uebernimm(a, m);
    if a.offen
        .as_deref()
        .is_some_and(|o| serde_json::from_str::<AkteMeldung>(o).is_ok_and(|o| o.epoche <= m.epoche))
    {
        a.offen = None;
        a.offen_bruch_at = None;
    }
    repo::save(conn, a, true).await?;
    repo::add_verlauf(
        conn,
        a,
        VerlaufNeu {
            von_name: Some(&von),
            nach_name: &m.fuehrer_name,
            grund: grund_der(m).as_deref(),
            unterzeichner: unterzeichner_der(m).as_deref(),
            ..VerlaufNeu::default()
        },
    )
    .await?;
    if let Some(einsatz_id) = a.einsatz_id {
        aus.folgen.push(Folge::Kopf { einsatz_id });
    }
    Ok(())
}

/// Wie eine Akte mit höherer Epoche über eine Direktkopplung vor Ort behandelt wird (LLH-1497,
/// Change `t10a7luh-elw-lan-direktkopplung`, design.md D4), gleich in welcher Richtung die
/// Kopplung läuft.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VorOrtEntscheid {
    /// Die Führung wechselte zwischen den beiden Seiten: verwerfen, Hinweis an der Kopplung.
    Verwerfen,
    /// Der bisherige Führer ist der Absender und bezeugt seine Abgabe an eine dritte Instanz oder
    /// führt mit neuer Epoche weiter: annehmen, der Spiegel folgt.
    Annehmen,
    /// Weder noch (etwa von einer Dritten weitergereicht): nur zur Anzeige, nichts ändert sich.
    NurAnzeige,
}

/// Die Annahmeregel einer Direktkopplung als reine Funktion (Tabelle in design.md D4): `bisher`
/// der Führer laut eigener Akte, `neu` der Führer der eingehenden Akte, `sender` und `ich` die
/// beiden Seiten der Kopplung.
pub fn entscheide_vor_ort(bisher: &str, neu: &str, sender: &str, ich: &str) -> VorOrtEntscheid {
    let seite = |k: &str| k == sender || k == ich;
    if seite(bisher) && seite(neu) && bisher != neu {
        VorOrtEntscheid::Verwerfen
    } else if bisher == sender {
        VorOrtEntscheid::Annehmen
    } else {
        VorOrtEntscheid::NurAnzeige
    }
}

/// Prüft den Beweis einer Notübernahme gegen mich (D6): Erklärung passt zur Akte, Unterschrift
/// von einem gültigen Schlüssel meiner Org über genau diese Erklärung. Gilt bei Ankunft, bei jedem
/// weiteren Eingang einer offenen Übernahme und beim Bestätigen (LLH-1671).
pub(super) async fn check_unterschrift(
    conn: &mut SqliteConnection,
    ich: &Ich,
    org_id: i64,
    m: &AkteMeldung,
    alt: &Epoche,
) -> Result<NotuebernahmeErklaerung, String> {
    let text = m
        .erklaerung
        .as_deref()
        .ok_or_else(|| "ohne Erklärung".to_string())?;
    let e = NotuebernahmeErklaerung::parse(text).ok_or_else(|| "Erklärung unlesbar".to_string())?;
    if e.einsatz != m.kennung
        || e.org != m.org
        || e.epoche_neu != m.epoche
        || e.fuehrer_neu != m.fuehrer
        || e.fuehrer_alt != ich.kennung
        || &e.epoche_alt != alt
    {
        return Err("Erklärung passt nicht zur Übernahme".into());
    }
    let Some(FuehrungBeweis::Unterschrift { assertion }) = &m.beweis else {
        return Err("ohne Unterschrift eines Admins".into());
    };
    let schluessel = unterschrift::find_gueltig_der_org(conn, org_id, &assertion.credential_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "unterschrieben mit einem hier nicht gültigen Schlüssel".to_string())?;
    pruefen::verify(text, assertion, &schluessel.pruef_schluessel())
        .map_err(|f| format!("Unterschrift ungültig: {f}"))?;
    Ok(e)
}

/// Prüft den Code-Beweis gegen den Abgabeschlüssel der Akte (D8).
fn check_code(a: &AkteZeile, m: &AkteMeldung) -> Result<NotuebernahmeErklaerung, String> {
    let schluessel = a
        .abgabe_schluessel
        .as_deref()
        .and_then(erklaerung::parse_schluessel)
        .ok_or_else(|| "kein offener Abgabecode".to_string())?;
    let text = m
        .erklaerung
        .as_deref()
        .ok_or_else(|| "ohne Erklärung".to_string())?;
    let e = NotuebernahmeErklaerung::parse(text).ok_or_else(|| "Erklärung unlesbar".to_string())?;
    if e.einsatz != a.kennung || e.epoche_neu != a.epoche() || e.fuehrer_neu != a.fuehrer_kennung {
        return Err("Erklärung passt nicht zum Abgabecode".into());
    }
    let Some(FuehrungBeweis::Code { pruefwert }) = &m.beweis else {
        return Err("ohne Code".into());
    };
    if !erklaerung::is_code_pruefwert_valid(&schluessel, text, pruefwert) {
        return Err("Code passt nicht".into());
    }
    Ok(e)
}

/// Übernimmt die Felder der Führung aus einer gelieferten Akte mit größerer Epoche.
///
/// Jeder Wechsel löscht den Anfrage-Merker: Eine Anfrage gilt nur dem Stand, den sie sah, sonst
/// gäbe die erreichte Seite die Führung später ohne Menschen ab (LLH-1673).
fn uebernimm(a: &mut AkteZeile, m: &AkteMeldung) {
    a.set_epoche(&m.epoche);
    a.anfrage_at = None;
    a.fuehrer_kennung = m.fuehrer.clone();
    a.fuehrer_name = m.fuehrer_name.clone();
    a.art = m.art.clone();
    a.erklaerung = m.erklaerung.clone();
    a.beweis = m
        .beweis
        .as_ref()
        .map(|b| serde_json::to_string(b).expect("serialisierbar"));
    if a.einsatz_id.is_none() {
        uebernimm_kopf(a, m);
    }
}

fn uebernimm_kopf(a: &mut AkteZeile, m: &AkteMeldung) -> bool {
    let vorher = (
        a.nummer.clone(),
        a.bezeichnung.clone(),
        a.stichwort.clone(),
        a.status.clone(),
    );
    a.nummer = m.nummer.clone();
    a.bezeichnung = m.bezeichnung.clone();
    a.stichwort = m.stichwort.clone();
    a.status = m.status.clone();
    vorher
        != (
            a.nummer.clone(),
            a.bezeichnung.clone(),
            a.stichwort.clone(),
            a.status.clone(),
        )
}

fn grund_der(m: &AkteMeldung) -> Option<String> {
    m.erklaerung
        .as_deref()
        .and_then(NotuebernahmeErklaerung::parse)
        .map(|e| e.grund)
}

fn unterzeichner_der(m: &AkteMeldung) -> Option<String> {
    m.erklaerung
        .as_deref()
        .and_then(NotuebernahmeErklaerung::parse)
        .map(|e| e.unterzeichner)
}

/// Text für die Admin-Spur: Einsatz und Grund.
fn spur_text(a: &AkteZeile, grund: &str) -> String {
    let einsatz = match &a.nummer {
        Some(n) => format!("{n} {}", a.bezeichnung),
        None => a.bezeichnung.clone(),
    };
    format!("{einsatz}: {grund}")
}

/// Verwirft eine Übernahme gegen mich (meldende Seite, D10): ich führe mit der nächsten Epoche
/// weiter, Alarm, Admin-Spur, Hinweis an der Kopplung.
async fn verwerfen(
    conn: &mut SqliteConnection,
    ich: &Ich,
    kopplung: &KopplungZeile,
    a: &mut AkteZeile,
    m: &AkteMeldung,
    grund: &str,
    aus: &mut Eingang,
) -> Result<(), AppError> {
    let text = format!("Übernahme durch {} verworfen: {grund}", m.fuehrer_name);
    fuehre_weiter(conn, ich, a, m, &text, aus).await?;
    if let Some(einsatz_id) = a.einsatz_id {
        aus.folgen.push(Folge::Alarm { einsatz_id });
    }
    aus.folgen.push(Folge::Spur {
        aktion: AdminAktion::FuehrungVerworfen,
        org_id: a.org_id,
        grund: spur_text(a, &text),
    });
    aus.hinweis = Some(format!(
        "{} meldet eine ungültige Übernahme der Führung ({}): {grund}",
        kopplung.gegenueber_name, a.bezeichnung
    ));
    Ok(())
}

/// Lehnt eine Verwahrung ab, die hier nicht quittiert ist (meldende Seite, LLH-1647, E3): Der
/// Einsatz liegt weiter hier, etwa weil er sich nach dem Angebot noch geändert hat oder die
/// Quittung noch fehlt. Ich führe mit der nächsten Epoche weiter, ohne Alarm und ohne Admin-Spur:
/// Die Gegenstelle hat nichts Unrechtes getan, sie wird wieder Spiegel, und die Verwahrung läuft
/// mit dem nächsten Angebot erneut.
async fn verwahrung_ablehnen(
    conn: &mut SqliteConnection,
    ich: &Ich,
    a: &mut AkteZeile,
    m: &AkteMeldung,
    aus: &mut Eingang,
) -> Result<(), AppError> {
    let grund = match a.einsatz_id {
        Some(id) => crate::instanz::spiegel::lebensende::grund_gegen_verwahrung(conn, id).await?,
        None => "Übergabe hier nicht bestätigt",
    };
    let text = format!("Verwahrung durch {} abgelehnt: {grund}", m.fuehrer_name);
    fuehre_weiter(conn, ich, a, m, &text, aus).await
}

/// Ich führe gegen die Epoche `m` mit der nächsten weiter (Art `verworfen`), Verlauf mit `text`.
async fn fuehre_weiter(
    conn: &mut SqliteConnection,
    ich: &Ich,
    a: &mut AkteZeile,
    m: &AkteMeldung,
    text: &str,
    aus: &mut Eingang,
) -> Result<(), AppError> {
    let mut bekannte = vec![a.epoche(), m.epoche.clone()];
    if let Some(offen) = a
        .offen
        .as_deref()
        .and_then(|o| serde_json::from_str::<AkteMeldung>(o).ok())
    {
        bekannte.push(offen.epoche);
    }
    let neu = Epoche::naechste(&bekannte, &ich.kennung);
    let von = a.fuehrer_name.clone();
    a.set_epoche(&neu);
    a.fuehrer_kennung = ich.kennung.clone();
    a.fuehrer_name = ich.name.clone();
    a.set_art(FuehrungWechselArt::Verworfen);
    a.anfrage_at = None;
    a.erklaerung = None;
    a.beweis = None;
    a.offen = None;
    a.offen_bruch_at = None;
    a.abgabe_schluessel = None;
    repo::save(conn, a, true).await?;
    repo::add_verlauf(
        conn,
        a,
        VerlaufNeu {
            von_name: Some(&von),
            nach_name: &ich.name,
            grund: Some(text),
            ..VerlaufNeu::default()
        },
    )
    .await?;
    if let Some(einsatz_id) = a.einsatz_id {
        aus.folgen.push(Folge::Kopf { einsatz_id });
    }
    Ok(())
}

/// Ob eine offene Übernahme ein Konflikt ist (Change `faq7l7m4-zwei-elw-unterlegene-seite`,
/// design.md D3): Die erreichte Seite nennt als Führer eine Instanz, die keiner der Hubs ist, bei
/// denen sich diese Instanz für die Org meldet (`hubs`, [`repo::list_hubs`]; im Austausch der
/// Absender). Eine Übernahme durch den Hub selbst ist keiner, auch nicht mit der Epoche eines
/// Dritten (D7).
pub fn ist_konflikt(offen: &AkteMeldung, hubs: &[&str]) -> bool {
    !hubs.contains(&offen.fuehrer.as_str())
}

/// Hält eine Übernahme gegen mich offen, bis die Einsatzleitung entscheidet; bei gleichem Inhalt
/// ändert sich nichts.
async fn halte_offen(
    conn: &mut SqliteConnection,
    a: &mut AkteZeile,
    m: &AkteMeldung,
    bruch: &str,
    aus: &mut Eingang,
) -> Result<(), AppError> {
    let vorher = a
        .offen
        .as_deref()
        .and_then(|o| serde_json::from_str::<AkteMeldung>(o).ok());
    // Dieselbe Übernahme kommt mit jeder Meldung des Gegenübers wieder, mit neuem `stand`: kein
    // neuer Stand, keine neue Bruchstelle, keine neue Benachrichtigung (LLH-1671). Sonst schaukelten
    // sich beide Stände je Takt hoch (Change `faq7l7m4-zwei-elw-unterlegene-seite`, D3).
    if vorher.as_ref().is_some_and(|o| o.is_gleicher_wechsel(m)) {
        return Ok(());
    }
    // Die Bruchstelle gilt der Übernahme, nicht der Meldung: Bei derselben Epoche bleibt sie die
    // erste, erst eine größere bekommt ihre eigene.
    if !vorher.is_some_and(|o| o.epoche == m.epoche) || a.offen_bruch_at.is_none() {
        a.offen_bruch_at = Some(bruch.to_string());
    }
    a.offen = Some(serde_json::to_string(m).expect("serialisierbar"));
    repo::save(conn, a, true).await?;
    if let Some(einsatz_id) = a.einsatz_id {
        aus.folgen.push(Folge::Offen { einsatz_id });
        aus.folgen.push(Folge::Kopf { einsatz_id });
    }
    Ok(())
}

/// Erfüllt eine Anfrage: die erreichte Seite gibt an die meldende ab (D9). Hat die meldende Seite
/// noch nicht alles, wartet die Anfrage (`anfrage_von`) und wird bei einer ihrer nächsten
/// Meldungen erfüllt ([`erfuelle_wartende`], LLH-1641 E4). Die Epoche der Anfrage ist die der
/// Akte (sie gilt nur dem Stand, den sie sah).
async fn erfuelle_anfrage(
    conn: &mut SqliteConnection,
    ich: &Ich,
    kopplung: &KopplungZeile,
    a: &mut AkteZeile,
    aus: &mut Eingang,
) -> Result<(), AppError> {
    if let Some(einsatz_id) = a.einsatz_id {
        // Einen verwahrten Einsatz gibt diese Instanz nicht mehr ab (LLH-1647, E4).
        if crate::instanz::spiegel::lebensende::ist_verwahrt(conn, einsatz_id).await? {
            sqlx::query("UPDATE einsatz_fuehrung SET anfrage_von = NULL WHERE id = ?")
                .bind(a.id)
                .execute(&mut *conn)
                .await?;
            return Ok(());
        }
        if !crate::instanz::spiegel::fuehrung::ist_abgeglichen(conn, einsatz_id, kopplung.id)
            .await?
        {
            sqlx::query("UPDATE einsatz_fuehrung SET anfrage_von = ? WHERE id = ?")
                .bind(&kopplung.gegenueber_kennung)
                .bind(a.id)
                .execute(&mut *conn)
                .await?;
            return Ok(());
        }
    }
    sqlx::query("UPDATE einsatz_fuehrung SET anfrage_von = NULL WHERE id = ?")
        .bind(a.id)
        .execute(&mut *conn)
        .await?;
    let neu = Epoche::naechste([&a.epoche()], &ich.kennung);
    a.set_epoche(&neu);
    a.fuehrer_kennung = kopplung.gegenueber_kennung.clone();
    a.fuehrer_name = kopplung.gegenueber_name.clone();
    a.set_art(FuehrungWechselArt::Anfrage);
    a.erklaerung = None;
    a.beweis = None;
    a.bruch_at = None;
    repo::save(conn, a, true).await?;
    repo::add_verlauf(
        conn,
        a,
        VerlaufNeu {
            von_name: Some(&ich.name),
            nach_name: &kopplung.gegenueber_name,
            ..VerlaufNeu::default()
        },
    )
    .await?;
    if let Some(einsatz_id) = a.einsatz_id {
        aus.folgen.push(Folge::Kopf { einsatz_id });
    }
    Ok(())
}

/// Erfüllt wartende Anfragen der meldenden Seite, sobald sie alles hat (LLH-1641, E4).
async fn erfuelle_wartende(
    conn: &mut SqliteConnection,
    ich: &Ich,
    kopplung: &KopplungZeile,
    aus: &mut Eingang,
) -> Result<(), AppError> {
    let ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_fuehrung WHERE anfrage_von = ? AND fuehrer_kennung = ? \
         AND offen IS NULL ORDER BY id",
    )
    .bind(&kopplung.gegenueber_kennung)
    .bind(&ich.kennung)
    .fetch_all(&mut *conn)
    .await?;
    for id in ids {
        let mut a = repo::load(conn, id).await?;
        erfuelle_anfrage(conn, ich, kopplung, &mut a, aus).await?;
    }
    Ok(())
}

/// Prüft die offenen Übernahmen dieser Kopplung erneut gegen die gültigen Schlüssel (LLH-1671).
/// Ein Widerruf, der mit dieser Nachricht kam, ist schon übernommen (`melden.rs`); trägt die
/// Unterschrift nicht mehr, wird verworfen wie bei Ankunft. Früher prüfte das nur nebenbei die je
/// Meldetakt zurückkommende Akte, die nun nicht mehr kommt.
async fn check_offene(
    conn: &mut SqliteConnection,
    ich: &Ich,
    kopplung: &KopplungZeile,
    orgs: &[(i64, String)],
    aus: &mut Eingang,
) -> Result<(), AppError> {
    let ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM einsatz_fuehrung WHERE offen IS NOT NULL ORDER BY id")
            .fetch_all(&mut *conn)
            .await?;
    for id in ids {
        let mut a = repo::load(conn, id).await?;
        if !orgs.iter().any(|(org_id, _)| *org_id == a.org_id) {
            continue;
        }
        let Some(m) = a
            .offen
            .as_deref()
            .and_then(|o| serde_json::from_str::<AkteMeldung>(o).ok())
        else {
            continue;
        };
        if m.epoche.instanz != kopplung.gegenueber_kennung {
            continue;
        }
        // Nur eine Übernahme gegen diese Instanz trägt eine Unterschrift, die gelten muss. Nennt
        // der Hub einen Dritten (Konflikt) oder trägt die Akte keine Erklärung gegen diese Instanz,
        // gibt es nichts nachzuprüfen (Change `faq7l7m4-zwei-elw-unterlegene-seite`, D3, D7).
        let gegen_mich = m
            .erklaerung
            .as_deref()
            .and_then(NotuebernahmeErklaerung::parse)
            .is_some_and(|e| e.fuehrer_alt == ich.kennung);
        if ist_konflikt(&m, &[kopplung.gegenueber_kennung.as_str()]) || !gegen_mich {
            continue;
        }
        let alt = a.epoche();
        if let Err(grund) = check_unterschrift(conn, ich, a.org_id, &m, &alt).await {
            verwerfen(conn, ich, kopplung, &mut a, &m, &grund, aus).await?;
        }
    }
    Ok(())
}

/// Rückschritt des eigenen Zählers (LLH-1708, design.md D3 der Change
/// `xi5ugyt8-fuehrung-stand-nach-restore`): Quittiert das Gegenüber an `kopplung` mehr, als dieser
/// Zähler je vergeben hat, wurde diese Instanz aus einer Sicherung zurückgespielt, und ihre Uhr fing
/// das nicht ab ([`repo::next_stand`]). Dann hebt sie den Zähler über die Quittung und stempelt
/// die Akten **jeder** aktiven Kopplung neu, in der sie erreichte Seite ist, jeweils über deren
/// gespeichertem `fuehrung_gesendet_bis`: Das ist mit der Sicherung zurückgekehrt und nennt, was
/// dieses Gegenüber sicher hat. Jede davon und `kopplung` selbst bekommen einen Hinweis. Nur eine
/// Kopplung neu zu stempeln reichte nicht: Der Zähler gilt je Instanz, und nach dem Heben sähe eine
/// zweite Kopplung ihren Rückschritt nicht mehr (Review B2).
///
/// Läuft an beiden Seiten in der Transaktion der Meldung, an der erreichten vor `ensure_akten` und
/// [`apply_eingang`], damit auch deren Stände über der Quittung liegen. Liefert, ob er hob.
pub async fn repair_stand(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    quittung: i64,
) -> Result<bool, AppError> {
    if !(1..=STAND_RAISE_MAX).contains(&quittung) || quittung <= repo::load_stand(conn).await? {
        return Ok(false);
    }
    repo::raise_stand(conn, quittung).await?;
    let grund = "aus einer Sicherung zurückgespielt?";
    for k in crate::instanz::repo::list_erreicht_aktiv(conn).await? {
        let (gesendet, _) = repo::load_kopplung_staende(conn, k.id).await?;
        let orgs =
            repo::list_orgs_der_kopplung(conn, k.id, InstanzKopplungRichtung::WirdGemeldet).await?;
        let ids: Vec<i64> = orgs.iter().map(|(id, _)| *id).collect();
        repo::renew_stand_ueber(conn, &ids, gesendet).await?;
        if k.id != kopplung.id {
            crate::instanz::repo::set_hinweis(
                conn,
                k.id,
                &format!(
                    "Der Zähler der Führungsakten lag unter einer Quittung ({grund}). Die Akten \
                     gehen erneut an {}.",
                    k.gegenueber_name
                ),
            )
            .await?;
        }
    }
    let erneut = if kopplung.richtung() == Some(InstanzKopplungRichtung::WirdGemeldet) {
        format!(" Die Akten gehen erneut an {}.", kopplung.gegenueber_name)
    } else {
        String::new()
    };
    crate::instanz::repo::set_hinweis(
        conn,
        kopplung.id,
        &format!(
            "{} hat schon spätere Führungsakten quittiert, als diese Instanz vergeben hat \
             ({grund}).{erneut}",
            kopplung.gegenueber_name
        ),
    )
    .await?;
    Ok(true)
}

/// Übernimmt die Akten einer Nachricht des Gegenübers. `zuletzt_gesehen` ist der Zeitpunkt der
/// letzten erfolgreichen Meldung vor dieser Nachricht (Bruchstelle, D11).
pub async fn apply_eingang(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    akten: &[AkteMeldung],
    zuletzt_gesehen: Option<&str>,
) -> Result<Eingang, AppError> {
    let mut aus = Eingang::default();
    let Some(richtung) = kopplung.richtung() else {
        return Ok(aus);
    };
    let ich = repo::ich(conn).await?;
    let orgs = repo::list_orgs_der_kopplung(conn, kopplung.id, richtung).await?;
    let sender = kopplung.gegenueber_kennung.as_str();
    let bruch = zuletzt_gesehen
        .map(str::to_string)
        .unwrap_or_else(crate::zeit::jetzt);
    if richtung == InstanzKopplungRichtung::MeldetSich {
        check_offene(conn, &ich, kopplung, &orgs, &mut aus).await?;
    }
    let ablehnen = |m: &AkteMeldung, grund: &str| {
        format!(
            "{} schickt eine ungültige Führungsakte ({}): {grund}, abgelehnt",
            kopplung.gegenueber_name,
            truncate_chars(&m.kennung, 80)
        )
    };
    for m in akten.iter().take(AKTEN_MAX) {
        aus.bis = quittung_nach(aus.bis, m);
        if !m.is_in_grenzen() {
            aus.hinweis = Some(ablehnen(m, "über den Grenzen"));
            continue;
        }
        let Some(&(org_id, _)) = orgs.iter().find(|(_, k)| *k == m.org) else {
            continue;
        };
        let Some(mut a) = repo::find_by_kennung(conn, &m.kennung).await? else {
            // Neue Akte des Gegenübers. Eine Akte eines eigenen Einsatzes, den es hier nicht
            // (mehr) gibt, legt das Gegenüber nicht an.
            if m.kennung.starts_with(&format!("{}/", ich.kennung)) {
                continue;
            }
            if m.epoche.instanz != sender && richtung == InstanzKopplungRichtung::WirdGemeldet {
                continue;
            }
            // Neu anlegen lässt die erreichte Seite die meldende nur deren eigene Akten, also nur
            // unter ihrem Präfix (LLH-1672).
            if richtung == InstanzKopplungRichtung::WirdGemeldet
                && !m.kennung.starts_with(&format!("{sender}/"))
            {
                aus.hinweis = Some(ablehnen(m, "neue Akte nicht unter ihrem Präfix"));
                continue;
            }
            let mut a = AkteZeile {
                id: 0,
                kennung: m.kennung.clone(),
                einsatz_id: None,
                org_id,
                nummer: m.nummer.clone(),
                bezeichnung: m.bezeichnung.clone(),
                stichwort: m.stichwort.clone(),
                status: m.status.clone(),
                epoche_zaehler: m.epoche.zaehler,
                epoche_instanz: m.epoche.instanz.clone(),
                fuehrer_kennung: m.fuehrer.clone(),
                fuehrer_name: m.fuehrer_name.clone(),
                art: m.art.clone(),
                erklaerung: m.erklaerung.clone(),
                beweis: m
                    .beweis
                    .as_ref()
                    .map(|b| serde_json::to_string(b).expect("serialisierbar")),
                offen: None,
                offen_bruch_at: None,
                abgabe_schluessel: None,
                anfrage_at: None,
                bruch_at: None,
                stand: 0,
                geaendert_at: String::new(),
            };
            repo::insert_fremd(conn, &mut a).await?;
            repo::add_verlauf(
                conn,
                &a,
                VerlaufNeu {
                    nach_name: &m.fuehrer_name,
                    grund: grund_der(m).as_deref(),
                    unterzeichner: unterzeichner_der(m).as_deref(),
                    ..VerlaufNeu::default()
                },
            )
            .await?;
            continue;
        };
        if a.org_id != org_id {
            continue;
        }
        let alt = a.epoche();
        let ich_fuehre = a.fuehrer_kennung == ich.kennung;
        if richtung == InstanzKopplungRichtung::MeldetSich {
            // Eine größere Epoche mit meiner Kennung, die ich nie vergeben habe, prüft der Zweig
            // `Greater` unten (Verwerfen); sie ist weder Konflikt noch Nachzug eines Dritten.
            let fremd_vergeben = !(m.epoche > alt && m.epoche.instanz == ich.kennung);
            // Der Hub nennt einen Dritten: er nimmt nichts mehr an, was ich schicke (sein Schutz
            // vor dem Diebstahl unter ELW). Change `faq7l7m4-zwei-elw-unterlegene-seite`, D2, D3.
            let dritter_fuehrt = m.fuehrer != ich.kennung && m.fuehrer != sender;
            // Der Hub führt selbst, mit einer Epoche, die ein Dritter vergab (D7): Ob er meine
            // Führung kannte und zurückholte, ist an der Akte nicht zu sehen; ein Mensch
            // entscheidet (Bestätigen oder Widersprechen, das der Hub annimmt).
            let dritte_epoche = m.fuehrer == sender
                && m.epoche > alt
                && m.epoche.instanz != sender
                && m.epoche.instanz != ich.kennung;
            // Einen eigenen Zweig zum Erlöschen braucht es nicht (D6): Nennt der Hub keinen Dritten
            // mehr, ersetzt die nächste Akte die gehaltene (halte_offen, D7), oder Verwerfen bzw.
            // Annahme unten räumen `offen` ab.
            if ich_fuehre && fremd_vergeben && (dritter_fuehrt || dritte_epoche) {
                // Läuft über die Annahmeregel (src/AGENTS.md); mit einem Dritten heißt sie offen
                // halten.
                debug_assert_eq!(
                    entscheide(richtung, Err(String::new()), true),
                    Entscheid::OffenHalten
                );
                halte_offen(conn, &mut a, m, &bruch, &mut aus).await?;
                continue;
            }
        }
        match m.epoche.cmp(&alt) {
            std::cmp::Ordering::Greater => {
                let nimmt_mir = ich_fuehre && m.fuehrer != ich.kennung;
                let von_sender = m.epoche.instanz == sender;
                if m.epoche.instanz == ich.kennung {
                    // Eine Epoche, die ich nie vergeben habe: gefälscht oder veraltet.
                    if richtung == InstanzKopplungRichtung::MeldetSich && nimmt_mir {
                        verwerfen(
                            conn,
                            &ich,
                            kopplung,
                            &mut a,
                            m,
                            "Epoche wurde hier nie vergeben",
                            &mut aus,
                        )
                        .await?;
                    }
                    continue;
                }
                // Direktkopplung vor Ort (LLH-1497, D4): kein Führungswechsel zwischen den beiden
                // Seiten, gleich in welcher Richtung; die Abgabe des bisherigen Führers an eine
                // Dritte gilt, damit der Spiegel ihr folgt.
                if kopplung.art() == InstanzKopplungArt::VorOrt {
                    match entscheide_vor_ort(&a.fuehrer_kennung, &m.fuehrer, sender, &ich.kennung) {
                        VorOrtEntscheid::Verwerfen => {
                            aus.hinweis = Some(format!(
                                "{} beansprucht die Führung von „{}“ über eine Direktkopplung: \
                                 abgelehnt",
                                kopplung.gegenueber_name, a.bezeichnung
                            ));
                        }
                        VorOrtEntscheid::Annehmen => {
                            folge_dem_absender(conn, &mut a, m, &mut aus).await?;
                        }
                        VorOrtEntscheid::NurAnzeige => {}
                    }
                    continue;
                }
                // Die erreichte Seite nimmt von der meldenden nur sie selbst oder sich als Führer
                // an; die meldende sieht auch eine Übergabe an eine dritte Instanz (mehrere ELW an
                // einem Hub), nimmt sie aber nur zur Anzeige oder mit Beweis an (unten).
                if von_sender
                    && m.fuehrer != sender
                    && m.fuehrer != ich.kennung
                    && richtung == InstanzKopplungRichtung::WirdGemeldet
                {
                    continue;
                }
                if !von_sender && (nimmt_mir || richtung == InstanzKopplungRichtung::WirdGemeldet) {
                    // Weitergereicht von einer dritten Instanz: nur zur Anzeige.
                    continue;
                }
                // Die erreichte Seite nimmt eine Epoche der meldenden nur an, wenn die Führung
                // bisher bei ihr selbst oder bei dieser meldenden Seite lag: Ein ELW kann so keinem
                // anderen ELW derselben Org die Führung nehmen (CodeRabbit, PR #1243).
                if richtung == InstanzKopplungRichtung::WirdGemeldet
                    && a.fuehrer_kennung != ich.kennung
                    && a.fuehrer_kennung != sender
                {
                    aus.hinweis = Some(format!(
                        "{} beansprucht die Führung von „{}“, die bei {} liegt: abgelehnt",
                        kopplung.gegenueber_name, a.bezeichnung, a.fuehrer_name
                    ));
                    continue;
                }
                // Einen verwahrten Einsatz führt nur noch diese Instanz (LLH-1647, E4). Einzige
                // Ausnahme: Die Gegenstelle, die ihn übergab, lehnt die Verwahrung ab, weil er dort
                // noch liegt (E3); dann wird diese Instanz wieder Spiegel.
                if nimmt_mir && richtung == InstanzKopplungRichtung::WirdGemeldet {
                    if let Some(einsatz_id) = a.einsatz_id {
                        let ablehnung = a.art() == FuehrungWechselArt::Verwahrung
                            && m.art == FuehrungWechselArt::Verworfen.as_str()
                            && m.fuehrer == sender
                            && m.kennung.starts_with(&format!("{sender}/"));
                        if !ablehnung
                            && crate::instanz::spiegel::lebensende::ist_verwahrt(conn, einsatz_id)
                                .await?
                        {
                            aus.hinweis = Some(format!(
                                "{} beansprucht die Führung des verwahrten Einsatzes „{}“: abgelehnt",
                                kopplung.gegenueber_name, a.bezeichnung
                            ));
                            continue;
                        }
                    }
                }
                // Verwahrung durch die erreichte Seite (LLH-1647, E2, E3): Hat sie die Übergabe
                // quittiert, wird der Einsatz hier gleich abgeräumt, die Akte mit ihm; sonst liegt
                // er weiter hier, und die Verwahrung wird ohne Alarm abgelehnt.
                if nimmt_mir
                    && richtung == InstanzKopplungRichtung::MeldetSich
                    && m.art == FuehrungWechselArt::Verwahrung.as_str()
                    && m.fuehrer == sender
                {
                    let quittiert = match a.einsatz_id {
                        Some(id) => {
                            crate::instanz::spiegel::lebensende::ist_verwahrung_quittiert(conn, id)
                                .await?
                        }
                        None => false,
                    };
                    if !quittiert {
                        verwahrung_ablehnen(conn, &ich, &mut a, m, &mut aus).await?;
                    }
                    continue;
                }
                if !nimmt_mir {
                    let gewinne = m.fuehrer == ich.kennung && !ich_fuehre;
                    if gewinne {
                        a.bruch_at = None;
                    }
                    folge_dem_absender(conn, &mut a, m, &mut aus).await?;
                    continue;
                }
                let bewiesen = match richtung {
                    InstanzKopplungRichtung::WirdGemeldet => Ok(()),
                    InstanzKopplungRichtung::MeldetSich => {
                        check_unterschrift(conn, &ich, org_id, m, &alt)
                            .await
                            .map(|_| ())
                    }
                };
                match entscheide(richtung, bewiesen, false) {
                    Entscheid::Annehmen => {
                        let art = FuehrungWechselArt::parse(&m.art);
                        let verwahrung_abgelehnt = a.art() == FuehrungWechselArt::Verwahrung;
                        uebernimm(&mut a, m);
                        a.bruch_at = Some(bruch.clone());
                        a.offen = None;
                        a.offen_bruch_at = None;
                        repo::save(conn, &mut a, true).await?;
                        let grund = if verwahrung_abgelehnt {
                            Some(format!(
                                "Verwahrung von {} abgelehnt, der Einsatz liegt dort weiter",
                                kopplung.gegenueber_name
                            ))
                        } else {
                            grund_der(m)
                        };
                        repo::add_verlauf(
                            conn,
                            &a,
                            VerlaufNeu {
                                von_name: Some(&ich.name),
                                nach_name: &m.fuehrer_name,
                                grund: grund.as_deref(),
                                bruch_at: Some(&bruch),
                                ..VerlaufNeu::default()
                            },
                        )
                        .await?;
                        if let Some(einsatz_id) = a.einsatz_id {
                            aus.folgen.push(Folge::Kopf { einsatz_id });
                        }
                        let (aktion, text) = match art {
                            Some(FuehrungWechselArt::Widerspruch) => (
                                Some(AdminAktion::FuehrungWiderspruch),
                                format!(
                                    "{} hat der Notübernahme widersprochen",
                                    kopplung.gegenueber_name
                                ),
                            ),
                            Some(FuehrungWechselArt::Verworfen) if verwahrung_abgelehnt => (
                                None,
                                format!(
                                    "{} hat die Verwahrung abgelehnt",
                                    kopplung.gegenueber_name
                                ),
                            ),
                            Some(FuehrungWechselArt::Verworfen) => (
                                None,
                                format!(
                                    "{} hat die Übernahme als ungültig verworfen",
                                    kopplung.gegenueber_name
                                ),
                            ),
                            Some(FuehrungWechselArt::Notuebernahme) => (
                                Some(AdminAktion::FuehrungNotuebernahme),
                                format!(
                                    "Notübernahme durch {}: {}",
                                    kopplung.gegenueber_name,
                                    grund.as_deref().unwrap_or("ohne Grund")
                                ),
                            ),
                            _ => (None, String::new()),
                        };
                        if !text.is_empty() {
                            aus.hinweis = Some(format!("{text} ({})", a.bezeichnung));
                        }
                        if let Some(aktion) = aktion {
                            aus.folgen.push(Folge::Spur {
                                aktion,
                                org_id: a.org_id,
                                grund: spur_text(&a, &text),
                            });
                        }
                    }
                    Entscheid::OffenHalten => {
                        halte_offen(conn, &mut a, m, &bruch, &mut aus).await?;
                    }
                    Entscheid::Verwerfen(grund) => {
                        verwerfen(conn, &ich, kopplung, &mut a, m, &grund, &mut aus).await?;
                    }
                }
            }
            std::cmp::Ordering::Equal => {
                if richtung == InstanzKopplungRichtung::MeldetSich
                    && a.art() == FuehrungWechselArt::CodeAbgabe
                    && a.abgabe_schluessel.is_some()
                    && matches!(m.beweis, Some(FuehrungBeweis::Code { .. }))
                {
                    match check_code(&a, m) {
                        Ok(e) => {
                            a.abgabe_schluessel = None;
                            a.erklaerung = m.erklaerung.clone();
                            a.beweis = m
                                .beweis
                                .as_ref()
                                .map(|b| serde_json::to_string(b).expect("serialisierbar"));
                            repo::save(conn, &mut a, false).await?;
                            repo::add_verlauf(
                                conn,
                                &a,
                                VerlaufNeu {
                                    art: Some(FuehrungWechselArt::Notuebernahme),
                                    von_name: Some(&ich.name),
                                    nach_name: &a.fuehrer_name.clone(),
                                    grund: Some(&e.grund),
                                    unterzeichner: Some(&e.unterzeichner),
                                    ..VerlaufNeu::default()
                                },
                            )
                            .await?;
                            // Die Notübernahme mit Code gilt erst jetzt: Kopf und Admin-Spur wie
                            // bei jeder Notübernahme (LLH-1674).
                            if let Some(einsatz_id) = a.einsatz_id {
                                aus.folgen.push(Folge::Kopf { einsatz_id });
                            }
                            let text = format!(
                                "Notübernahme durch {} mit Code: {}",
                                kopplung.gegenueber_name, e.grund
                            );
                            aus.folgen.push(Folge::Spur {
                                aktion: AdminAktion::FuehrungNotuebernahme,
                                org_id: a.org_id,
                                grund: spur_text(&a, &text),
                            });
                        }
                        Err(grund) => {
                            verwerfen(conn, &ich, kopplung, &mut a, m, &grund, &mut aus).await?;
                        }
                    }
                    continue;
                }
                if richtung == InstanzKopplungRichtung::WirdGemeldet
                    && m.art == FuehrungWechselArt::Bestaetigt.as_str()
                    && a.art() == FuehrungWechselArt::Notuebernahme
                {
                    a.set_art(FuehrungWechselArt::Bestaetigt);
                    repo::save(conn, &mut a, false).await?;
                    repo::add_verlauf(
                        conn,
                        &a,
                        VerlaufNeu {
                            art: Some(FuehrungWechselArt::Bestaetigt),
                            nach_name: &a.fuehrer_name.clone(),
                            ..VerlaufNeu::default()
                        },
                    )
                    .await?;
                    if let Some(einsatz_id) = a.einsatz_id {
                        aus.folgen.push(Folge::Kopf { einsatz_id });
                    }
                    continue;
                }
                // Eine Anfrage gilt nur dem Stand, den sie sah (Review LLH-1491: ein alter
                // Merker gäbe die Führung sonst ohne Menschen zurück).
                if m.anfrage && ich_fuehre && richtung == InstanzKopplungRichtung::WirdGemeldet {
                    erfuelle_anfrage(conn, &ich, kopplung, &mut a, &mut aus).await?;
                    continue;
                }
                if a.einsatz_id.is_none()
                    && m.kennung.starts_with(&format!("{sender}/"))
                    && uebernimm_kopf(&mut a, m)
                {
                    repo::save(conn, &mut a, true).await?;
                }
            }
            std::cmp::Ordering::Less => {
                // Das Gegenüber ist hinter dieser Seite zurück: die eigene Akte geht mit einem
                // neuen Stand noch einmal hinaus, damit beide wieder gleich stehen. Eine Anfrage
                // auf einen alten Stand wird nicht erfüllt. Hält das Gegenüber eine Übernahme
                // gegen sich offen, hat es diese Akte schon; ein neuer Stand schickte sie nur je
                // Meldetakt erneut (LLH-1671).
                if !m.offen {
                    repo::save(conn, &mut a, true).await?;
                }
            }
        }
    }
    if richtung == InstanzKopplungRichtung::WirdGemeldet {
        erfuelle_wartende(conn, &ich, kopplung, &mut aus).await?;
    }
    Ok(aus)
}

/// Führt die Folgen eines Austauschs nach dem Commit aus: Live-Ereignis am Einsatzkopf,
/// Benachrichtigungen an die Einsatzleitung, Einträge der Admin-Spur. Fehler schlagen nicht durch
/// (die Meldung ist schon committet).
pub async fn run_folgen(pool: &sqlx::SqlitePool, kopplung: &KopplungZeile, folgen: &[Folge]) {
    use crate::benachrichtigung::{
        self as b, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
    };
    if folgen.is_empty() {
        return;
    }
    let live = crate::instanz::stammdaten::live()
        .cloned()
        .unwrap_or_else(crate::live::LiveHub::new);
    for f in folgen {
        match f {
            Folge::Kopf { einsatz_id } => {
                crate::live::org::kopf_melden(pool, &live, *einsatz_id, &[]).await;
            }
            Folge::Alarm { einsatz_id } | Folge::Offen { einsatz_id } => {
                let art = if matches!(f, Folge::Alarm { .. }) {
                    BenachrichtigungArt::FuehrungUngueltig
                } else {
                    BenachrichtigungArt::FuehrungUebernommen
                };
                b::melden(
                    pool,
                    &live,
                    Anlass::neu(
                        *einsatz_id,
                        art,
                        Bezug::neu(BenachrichtigungBezugTyp::Einsatz, *einsatz_id),
                    )
                    .an(Adressat::Einsatzleitung),
                )
                .await;
            }
            Folge::Spur {
                aktion,
                org_id,
                grund,
            } => {
                crate::auth::admin_audit::schreibe_ohne_akteur(
                    pool,
                    *aktion,
                    *org_id,
                    &kopplung.gegenueber_name,
                    crate::auth::admin_audit::Ziel::Instanz(&kopplung.gegenueber_name),
                    Some(crate::auth::admin_audit::ZugangsAngaben {
                        instanz_kennung: Some(kopplung.gegenueber_kennung.clone()),
                        grund: Some(grund.clone()),
                        ..Default::default()
                    }),
                    None,
                )
                .await;
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    // ── Rückschritt des Zählers (LLH-1708, design.md D3) ──────────────────────────────────

    /// Zur Kopplung 1 aus `repo::tests::gekoppelt` (diese Instanz meldet sich, Org 1) kommen zwei,
    /// in denen sie erreichte Seite ist: Kopplung 2 mit Org 2, Kopplung 3 mit Org 1.
    async fn drei_kopplungen(pool: &sqlx::SqlitePool) {
        repo::tests::gekoppelt(pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Zweite')")
            .execute(pool)
            .await
            .unwrap();
        for (id, org) in [(2, 2), (3, 1)] {
            sqlx::query(
                "INSERT INTO instanz_kopplung (id, gegenueber_kennung, gegenueber_schluessel, \
                 gegenueber_name, richtung, zustand) \
                 VALUES (?, ?, 's', ?, 'wird_gemeldet', 'aktiv')",
            )
            .bind(id)
            .bind(format!("elw{id}"))
            .bind(format!("ELW {id}"))
            .execute(pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, \
                 fremde_org_name) VALUES (?, ?, ?, 'Org')",
            )
            .bind(id)
            .bind(org)
            .bind(format!("elw{id}/9"))
            .execute(pool)
            .await
            .unwrap();
        }
    }

    async fn stand_der_akte(pool: &sqlx::SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT stand FROM einsatz_fuehrung WHERE org_id = 1")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn hinweis_an(pool: &sqlx::SqlitePool, id: i64) -> String {
        sqlx::query_scalar::<_, Option<String>>("SELECT hinweis FROM instanz_kopplung WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
            .unwrap_or_default()
    }

    /// Ruft `repair_stand` für Kopplung `id` mit `quittung`; liefert, ob gehoben wurde.
    async fn repair(pool: &sqlx::SqlitePool, id: i64, quittung: i64) -> bool {
        let k = crate::instanz::repo::load_kopplung(pool, id).await.unwrap();
        let mut conn = pool.acquire().await.unwrap();
        repair_stand(&mut conn, &k, quittung).await.unwrap()
    }

    #[tokio::test]
    async fn rueckschritt_an_einer_kopplung_stempelt_jede_erreichte_kopplung_neu() {
        // Review B2: Die Akte der Org 1 hängt nur an Kopplung 3 (als erreichte Seite). Erkennt
        // Kopplung 2 den Rückschritt und hebt den Zähler, sähe Kopplung 3 ihn danach nicht mehr.
        let pool = crate::db::test_pool().await;
        drei_kopplungen(&pool).await;
        super::super::save_schalter(&pool, true).await.unwrap();
        repo::tests::einsatz(&pool, "Lage").await;
        repo::tests::ensure(&pool).await;
        let quittung = stand_der_akte(&pool).await + 1000;
        assert!(repair(&pool, 2, quittung).await);
        assert!(
            stand_der_akte(&pool).await > quittung,
            "Kopplung 3 bekommt sie erneut"
        );
        assert!(hinweis_an(&pool, 2).await.contains("ELW 2"));
        assert!(hinweis_an(&pool, 3).await.contains("erneut an ELW 3"));
        assert!(
            !repair(&pool, 2, quittung).await,
            "einmal gehoben, nicht wieder"
        );
    }

    #[tokio::test]
    async fn heben_an_der_meldenden_seite_stempelt_die_erreichten_kopplungen_neu() {
        let pool = crate::db::test_pool().await;
        drei_kopplungen(&pool).await;
        super::super::save_schalter(&pool, true).await.unwrap();
        repo::tests::einsatz(&pool, "Lage").await;
        repo::tests::ensure(&pool).await;
        let quittung = stand_der_akte(&pool).await + 1000;
        assert!(repair(&pool, 1, quittung).await);
        assert!(stand_der_akte(&pool).await > quittung);
        assert!(hinweis_an(&pool, 1).await.contains("Hub Nord"));
        assert!(hinweis_an(&pool, 3).await.contains("erneut an ELW 3"));
    }

    #[tokio::test]
    async fn eine_quittung_hebt_genau_bis_zur_grenze() {
        // Review B6: genau auf der Grenze hebt sie, eins darüber nicht.
        let pool = crate::db::test_pool().await;
        drei_kopplungen(&pool).await;
        assert!(!repair(&pool, 2, STAND_RAISE_MAX + 1).await);
        let mut conn = pool.acquire().await.unwrap();
        assert!(repo::load_stand(&mut conn).await.unwrap() < STAND_RAISE_MAX);
        drop(conn);
        assert!(repair(&pool, 2, STAND_RAISE_MAX).await);
        let mut conn = pool.acquire().await.unwrap();
        assert_eq!(repo::load_stand(&mut conn).await.unwrap(), STAND_RAISE_MAX);
    }
    use crate::auth::unterschrift::pruefen::{
        AUTHENTICATOR_DATA_MAX, CLIENT_DATA_JSON_MAX, CREDENTIAL_ID_MAX, SIGNATUR_MAX,
    };
    use InstanzKopplungRichtung::{MeldetSich, WirdGemeldet};

    fn akte() -> AkteMeldung {
        serde_json::from_value(serde_json::json!({
            "kennung": "elw/1", "org": "hub/1", "bezeichnung": "Lage", "status": "aktiv",
            "epoche": {"zaehler": 1, "instanz": "elw"}, "fuehrer": "elw",
            "fuehrer_name": "ELW", "art": "angelegt", "stand": 3
        }))
        .unwrap()
    }

    fn assertion(cid: usize, auth: usize, cdj: usize, sig: usize) -> FuehrungBeweis {
        serde_json::from_value(serde_json::json!({
            "art": "unterschrift",
            "assertion": {
                "credential_id": "A".repeat(cid),
                "authenticator_data": "a".repeat(auth),
                "client_data_json": "c".repeat(cdj),
                "signatur": "s".repeat(sig)
            }
        }))
        .unwrap()
    }

    /// Eine gültige Akte von genau `ziel` Byte JSON: Textfelder voll mit Vier-Byte-Zeichen, der
    /// Beweis an allen Grenzen der Assertion, die Erklärung aufgefüllt mit Steuerzeichen (sechs
    /// Byte in JSON) und einfachen Zeichen.
    pub(crate) fn akte_mit_bytes(ziel: usize) -> AkteMeldung {
        pad_to_bytes(build_filled(), ziel)
    }

    /// Grundakte für [`pad_to_bytes`]: Textfelder voll mit Vier-Byte-Zeichen, Beweis an den Grenzen.
    fn build_filled() -> AkteMeldung {
        let text = "𝄞".repeat(TEXT_MAX);
        let mut m = akte();
        m.nummer = Some(text.clone());
        m.bezeichnung = text.clone();
        m.stichwort = Some(text.clone());
        m.fuehrer_name = text;
        m.beweis = Some(assertion(
            CREDENTIAL_ID_MAX,
            AUTHENTICATOR_DATA_MAX,
            CLIENT_DATA_JSON_MAX,
            SIGNATUR_MAX,
        ));
        m
    }

    /// Füllt die Erklärung von `m` auf, bis die Akte genau `ziel` Byte JSON hat.
    fn pad_to_bytes(mut m: AkteMeldung, ziel: usize) -> AkteMeldung {
        m.erklaerung = Some(String::new());
        let fehlt = ziel - m.bytes();
        let erklaerung = "\u{1}".repeat(fehlt / 6) + &"e".repeat(fehlt % 6);
        assert!(erklaerung.len() <= ERKLAERUNG_MAX, "Ziel {ziel} zu groß");
        m.erklaerung = Some(erklaerung);
        assert_eq!(m.bytes(), ziel);
        m
    }

    /// Die größte Akte, die [`AkteMeldung::is_in_grenzen`] annimmt.
    pub(crate) fn groesste_akte() -> AkteMeldung {
        akte_mit_bytes(AKTE_BYTES - AKTE_SPIELRAUM)
    }

    #[test]
    fn grenzen_knapp_darunter_und_knapp_darueber() {
        let ok = |f: &dyn Fn(&mut AkteMeldung)| {
            let mut m = akte();
            f(&mut m);
            m.is_in_grenzen()
        };
        assert!(ok(&|m| m.bezeichnung = "ü".repeat(TEXT_MAX)));
        assert!(!ok(&|m| m.bezeichnung = "ü".repeat(TEXT_MAX + 1)));
        assert!(ok(&|m| m.fuehrer_name = "x".repeat(TEXT_MAX)));
        assert!(!ok(&|m| m.fuehrer_name = "x".repeat(TEXT_MAX + 1)));
        assert!(ok(&|m| m.epoche.zaehler = ZAEHLER_MAX));
        assert!(!ok(&|m| m.epoche.zaehler = ZAEHLER_MAX + 1));
        assert!(!ok(&|m| m.epoche.zaehler = 0));
        assert!(ok(&|m| m.erklaerung = Some("e".repeat(ERKLAERUNG_MAX))));
        assert!(!ok(&|m| m.erklaerung = Some("e".repeat(ERKLAERUNG_MAX + 1))));
        assert!(ok(&|m| m.stand = STAND_MAX));
        assert!(!ok(&|m| m.stand = STAND_MAX + 1));
        assert!(!ok(&|m| m.stand = 0));
        assert!(!ok(&|m| m.stand = i64::MAX));
    }

    #[test]
    fn nur_ein_plausibler_stand_zaehlt_fuer_die_quittung() {
        let mit = |stand: i64| {
            let mut m = akte();
            m.stand = stand;
            m
        };
        assert_eq!(quittung_nach(None, &mit(5)), Some(5));
        assert_eq!(quittung_nach(Some(7), &mit(5)), Some(7));
        assert_eq!(quittung_nach(Some(7), &mit(STAND_MAX)), Some(STAND_MAX));
        assert_eq!(quittung_nach(Some(7), &mit(STAND_MAX + 1)), Some(7));
        assert_eq!(quittung_nach(Some(7), &mit(i64::MAX)), Some(7));
        assert_eq!(quittung_nach(None, &mit(0)), None);
        // Über den übrigen Grenzen, aber mit plausiblem Stand: quittiert (mit Hinweis).
        let mut m = mit(9);
        m.art = "erfunden".into();
        assert_eq!(quittung_nach(Some(7), &m), Some(9));
    }

    #[test]
    fn beweis_hat_grenzen() {
        let mit = |b: FuehrungBeweis| {
            let mut m = akte();
            m.beweis = Some(b);
            m.is_in_grenzen()
        };
        let (c, a, d, s) = (
            CREDENTIAL_ID_MAX,
            AUTHENTICATOR_DATA_MAX,
            CLIENT_DATA_JSON_MAX,
            SIGNATUR_MAX,
        );
        assert!(mit(assertion(c, a, d, s)));
        assert!(!mit(assertion(c + 1, a, d, s)));
        assert!(!mit(assertion(c, a + 1, d, s)));
        assert!(!mit(assertion(c, a, d + 1, s)));
        assert!(!mit(assertion(c, a, d, s + 1)));
        let code = |n: usize| FuehrungBeweis::Code {
            pruefwert: "p".repeat(n),
        };
        assert!(mit(code(PRUEFWERT_MAX)));
        assert!(!mit(code(PRUEFWERT_MAX + 1)));
    }

    #[test]
    fn akte_bytes_knapp_darunter_und_knapp_darueber() {
        let eingang = AKTE_BYTES - AKTE_SPIELRAUM;
        assert!(akte_mit_bytes(eingang).is_in_grenzen());
        assert!(!akte_mit_bytes(eingang + 1).is_in_grenzen());
        // Hinaus geht bis AKTE_BYTES.
        assert!(akte_mit_bytes(AKTE_BYTES).is_in_grenzen_bis(AKTE_BYTES));
        assert!(!akte_mit_bytes(AKTE_BYTES + 1).is_in_grenzen_bis(AKTE_BYTES));
        assert!(AKTE_BYTES <= MELDUNG_BYTES && AKTE_BYTES <= ANTWORT_BYTES);
    }

    #[test]
    fn angenommene_akte_geht_neu_gebaut_wieder_hinaus() {
        // Am Eingang so klein wie möglich, was neu gebaut wächst: Stand 1, `anfrage` und `offen`
        // gesetzt, kurzer Org-Schlüssel.
        let mut basis = build_filled();
        basis.stand = 1;
        basis.anfrage = true;
        basis.offen = true;
        basis.org = "h".into();
        let m = pad_to_bytes(basis, AKTE_BYTES - AKTE_SPIELRAUM);
        assert!(m.is_in_grenzen(), "{} Byte", m.bytes());
        // Neu gebaut: höchster Stand, ohne Merker, längster Org-Schlüssel voller Steuerzeichen.
        let zeile = AkteZeile {
            id: 1,
            kennung: m.kennung.clone(),
            einsatz_id: None,
            org_id: 1,
            nummer: m.nummer.clone(),
            bezeichnung: m.bezeichnung.clone(),
            stichwort: m.stichwort.clone(),
            status: m.status.clone(),
            epoche_zaehler: m.epoche.zaehler,
            epoche_instanz: m.epoche.instanz.clone(),
            fuehrer_kennung: m.fuehrer.clone(),
            fuehrer_name: m.fuehrer_name.clone(),
            art: m.art.clone(),
            erklaerung: m.erklaerung.clone(),
            beweis: m.beweis.as_ref().map(|b| serde_json::to_string(b).unwrap()),
            offen: None,
            offen_bruch_at: None,
            abgabe_schluessel: None,
            anfrage_at: None,
            bruch_at: None,
            stand: STAND_MAX,
            geaendert_at: String::new(),
        };
        let raus = AkteMeldung::aus(&zeile, &"\u{1}".repeat(88));
        assert!(
            raus.is_in_grenzen_bis(AKTE_BYTES),
            "{} Byte neu gebaut, {} am Eingang",
            raus.bytes(),
            m.bytes()
        );
    }

    #[test]
    fn steuerzeichen_ueber_den_bytes_gelten_nicht() {
        let mut m = akte();
        m.bezeichnung = "\u{1}".repeat(TEXT_MAX);
        m.stichwort = Some(m.bezeichnung.clone());
        m.nummer = Some(m.bezeichnung.clone());
        m.fuehrer_name = m.bezeichnung.clone();
        m.erklaerung = Some("\u{1}".repeat(ERKLAERUNG_MAX));
        m.beweis = groesste_akte().beweis;
        assert!(m.bytes() > AKTE_BYTES);
        assert!(!m.is_in_grenzen());
    }

    #[test]
    fn kopf_wird_beim_bauen_gekuerzt() {
        let lang = "ü".repeat(TEXT_MAX * 200);
        let zeile = AkteZeile {
            id: 1,
            kennung: "elw/1".into(),
            einsatz_id: Some(1),
            org_id: 1,
            nummer: Some(lang.clone()),
            bezeichnung: lang.clone(),
            stichwort: Some(lang.clone()),
            status: "aktiv".into(),
            epoche_zaehler: 1,
            epoche_instanz: "elw".into(),
            fuehrer_kennung: "elw".into(),
            fuehrer_name: lang,
            art: "angelegt".into(),
            erklaerung: None,
            beweis: None,
            offen: None,
            offen_bruch_at: None,
            abgabe_schluessel: None,
            anfrage_at: None,
            bruch_at: None,
            stand: 7,
            geaendert_at: String::new(),
        };
        let m = AkteMeldung::aus(&zeile, "hub/1");
        assert_eq!(m.bezeichnung.chars().count(), TEXT_MAX);
        assert_eq!(m.stichwort.unwrap().chars().count(), TEXT_MAX);
        assert_eq!(m.nummer.unwrap().chars().count(), TEXT_MAX);
        assert_eq!(m.fuehrer_name.chars().count(), TEXT_MAX);
        let mut kurz = zeile.clone();
        kurz.bezeichnung = "ü".repeat(TEXT_MAX);
        assert_eq!(
            AkteMeldung::aus(&kurz, "hub/1").bezeichnung,
            kurz.bezeichnung
        );
    }

    #[test]
    fn annahmeregel_ueber_alle_zellen() {
        for dritter in [false, true] {
            assert_eq!(
                entscheide(WirdGemeldet, Ok(()), dritter),
                Entscheid::Annehmen
            );
            assert_eq!(
                entscheide(WirdGemeldet, Err("x".into()), dritter),
                Entscheid::Annehmen,
                "die erreichte Seite nimmt ohne Beweis an"
            );
            assert_eq!(
                entscheide(MeldetSich, Ok(()), dritter),
                Entscheid::OffenHalten
            );
        }
        assert_eq!(
            entscheide(MeldetSich, Err("x".into()), false),
            Entscheid::Verwerfen("x".into())
        );
        assert_eq!(
            entscheide(MeldetSich, Err("x".into()), true),
            Entscheid::OffenHalten,
            "mit einem Dritten gibt es keinen Beweis gegen mich und keinen Alarm"
        );
    }

    fn akte_von(fuehrer: &str, stand: i64) -> AkteMeldung {
        serde_json::from_value(serde_json::json!({
            "kennung": "hub/1", "org": "hub/1", "bezeichnung": "Lage", "status": "aktiv",
            "epoche": {"zaehler": 2, "instanz": "elw1"}, "fuehrer": fuehrer,
            "fuehrer_name": "ELW 1", "art": "notuebernahme", "stand": stand
        }))
        .unwrap()
    }

    #[test]
    fn konflikt_heisst_der_fuehrer_ist_kein_gegenueber() {
        assert!(ist_konflikt(&akte_von("elw1", 3), &["hub"]));
        assert!(!ist_konflikt(&akte_von("hub", 3), &["hub"]));
        assert!(
            ist_konflikt(&akte_von("hub", 3), &[]),
            "ohne Kopplung führt ein Dritter"
        );
    }

    /// Tabelle aus design.md D4 (LLH-1497): Zeilen je Fall, beide Richtungen sind dieselbe Regel.
    #[test]
    fn annahmeregel_vor_ort_ueber_alle_zellen() {
        use VorOrtEntscheid::*;
        let (s, i, d) = ("sender", "ich", "dritte");
        // Wechsel zwischen den beiden Seiten, in beide Richtungen.
        assert_eq!(
            entscheide_vor_ort(i, s, s, i),
            Verwerfen,
            "Sender nimmt mir die Führung"
        );
        assert_eq!(
            entscheide_vor_ort(s, i, s, i),
            Verwerfen,
            "Sender gibt sie mir"
        );
        // Der bisherige Führer ist der Absender.
        assert_eq!(
            entscheide_vor_ort(s, d, s, i),
            Annehmen,
            "Abgabe an eine Dritte"
        );
        assert_eq!(
            entscheide_vor_ort(s, s, s, i),
            Annehmen,
            "Sender führt weiter"
        );
        // Alles andere nur zur Anzeige.
        assert_eq!(
            entscheide_vor_ort(d, s, s, i),
            NurAnzeige,
            "Sender beansprucht von Dritter"
        );
        assert_eq!(entscheide_vor_ort(d, d, s, i), NurAnzeige);
        assert_eq!(
            entscheide_vor_ort(i, d, s, i),
            NurAnzeige,
            "meine Führung an eine Dritte"
        );
        assert_eq!(entscheide_vor_ort(i, i, s, i), NurAnzeige);
    }

    #[test]
    fn alte_akte_ohne_neue_felder_liest_sich() {
        let m: AkteMeldung = serde_json::from_value(serde_json::json!({
            "kennung": "elw/1", "org": "hub/1", "bezeichnung": "Lage", "status": "aktiv",
            "epoche": {"zaehler": 1, "instanz": "elw"}, "fuehrer": "elw",
            "fuehrer_name": "ELW", "art": "angelegt", "stand": 3
        }))
        .unwrap();
        assert!(!m.anfrage && !m.offen && m.beweis.is_none());
        assert!(m.is_in_grenzen());
    }

    #[test]
    fn akte_ueber_den_grenzen_wird_nicht_uebernommen() {
        let mut m: AkteMeldung = serde_json::from_value(serde_json::json!({
            "kennung": "elw/1", "org": "hub/1", "bezeichnung": "Lage", "status": "aktiv",
            "epoche": {"zaehler": 1, "instanz": "elw"}, "fuehrer": "elw",
            "fuehrer_name": "ELW", "art": "angelegt", "stand": 3
        }))
        .unwrap();
        m.bezeichnung = "x".repeat(TEXT_MAX + 1);
        assert!(!m.is_in_grenzen());
        m.bezeichnung = "Lage".into();
        m.art = "erfunden".into();
        assert!(!m.is_in_grenzen());
        m.art = "angelegt".into();
        m.epoche.zaehler = 0;
        assert!(!m.is_in_grenzen());
    }
}
