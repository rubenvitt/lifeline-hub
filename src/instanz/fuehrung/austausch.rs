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
use crate::instanz::InstanzKopplungRichtung;
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
/// Größter Stand einer gelieferten Akte (LLH-1672): Stände zählen je Änderung eins hoch, wie
/// Epochen weit darüber; ein Stand darüber setzte die Quittung dauerhaft aufs Maximum.
const STAND_MAX: i64 = 1 << 40;
/// Länge eines Prüfwerts aus dem Abgabecode (HMAC-SHA256, Base64url: 43 Zeichen) mit Luft.
const PRUEFWERT_MAX: usize = 64;
/// Größte Akte in Byte (JSON): passt in jede Meldung ([`MELDUNG_BYTES`]) und jede Antwort.
pub const AKTE_BYTES: usize = 32 * 1024;

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
fn kuerze(s: &str, max: usize) -> String {
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
            nummer: a.nummer.as_deref().map(|n| kuerze(n, TEXT_MAX)),
            bezeichnung: kuerze(&a.bezeichnung, TEXT_MAX),
            stichwort: a.stichwort.as_deref().map(|s| kuerze(s, TEXT_MAX)),
            status: a.status.clone(),
            epoche: a.epoche(),
            fuehrer: a.fuehrer_kennung.clone(),
            fuehrer_name: kuerze(&a.fuehrer_name, TEXT_MAX),
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

    /// Grenzen der Felder; eine Akte darüber wird nicht übernommen. Was hier durchgeht, wird
    /// gespeichert und geht weiter, also passt es auch in jede Nachricht ([`AKTE_BYTES`]).
    fn is_in_grenzen(&self) -> bool {
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
            && self.bytes() <= AKTE_BYTES
    }
}

/// Was eine Seite an Akten hinausschickt.
#[derive(Debug, Default)]
pub struct Ausgang {
    pub akten: Vec<AkteMeldung>,
    /// Es bleibt mehr, als in diese Nachricht passte.
    pub mehr: bool,
}

/// Baut die Akten für eine Kopplung: Stand über `ab`, höchstens [`AKTEN_MAX`] und `bytes`.
/// Eine Akte über [`AKTE_BYTES`] nähme das Gegenüber nicht an: Sie und alles danach bleibt hier,
/// mit Hinweis an der Kopplung, bis sie kleiner ist (LLH-1672); der Rest der Nachricht geht.
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
        if groesse > AKTE_BYTES.min(bytes) {
            crate::instanz::repo::set_hinweis(
                conn,
                kopplung.id,
                &format!(
                    "Führungsakte „{}“ ist zu groß für den Austausch ({groesse} Byte, höchstens \
                     {} Byte): Sie und die Akten danach gehen nicht an {}, bis sie kleiner ist.",
                    kuerze(&a.bezeichnung, 80),
                    AKTE_BYTES.min(bytes),
                    kopplung.gegenueber_name
                ),
            )
            .await?;
            break;
        }
        if aus.akten.len() == AKTEN_MAX || summe + groesse > bytes {
            aus.mehr = true;
            break;
        }
        summe += groesse;
        aus.akten.push(m);
    }
    Ok(aus)
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

/// Die Annahmeregel als reine Funktion (Tabelle in design.md D7): `richtung` der Kopplung aus
/// meiner Sicht, `bewiesen` = ob der Beweis gegen meine Schlüssel trägt (nur für die meldende
/// Seite von Belang).
pub fn entscheide(richtung: InstanzKopplungRichtung, bewiesen: Result<(), String>) -> Entscheid {
    match (richtung, bewiesen) {
        (InstanzKopplungRichtung::WirdGemeldet, _) => Entscheid::Annehmen,
        (InstanzKopplungRichtung::MeldetSich, Ok(())) => Entscheid::OffenHalten,
        (InstanzKopplungRichtung::MeldetSich, Err(grund)) => Entscheid::Verwerfen(grund),
    }
}

/// Prüft den Beweis einer Notübernahme gegen mich (D6): Erklärung passt zur Akte, Unterschrift
/// von einem gültigen Schlüssel meiner Org über genau diese Erklärung.
async fn check_unterschrift(
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

/// Übernimmt die Felder der Führung aus einer gelieferten Akte.
fn uebernimm(a: &mut AkteZeile, m: &AkteMeldung) {
    a.set_epoche(&m.epoche);
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
    let ablehnen = |m: &AkteMeldung, grund: &str| {
        format!(
            "{} schickt eine ungültige Führungsakte ({}): {grund}, abgelehnt",
            kopplung.gegenueber_name,
            kuerze(&m.kennung, 80)
        )
    };
    for m in akten.iter().take(AKTEN_MAX) {
        // Nur ein plausibler Stand zählt für die Quittung: ein Wert wie `i64::MAX` setzte sie
        // dauerhaft aufs Maximum (LLH-1672). Eine abgelehnte Akte wird quittiert, aber nicht still.
        if m.is_stand_plausibel() {
            aus.bis = Some(aus.bis.map_or(m.stand, |b| b.max(m.stand)));
        }
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
                    let von = a.fuehrer_name.clone();
                    uebernimm(&mut a, m);
                    if gewinne {
                        a.anfrage_at = None;
                        a.bruch_at = None;
                    }
                    if a.offen.as_deref().is_some_and(|o| {
                        serde_json::from_str::<AkteMeldung>(o).is_ok_and(|o| o.epoche <= m.epoche)
                    }) {
                        a.offen = None;
                        a.offen_bruch_at = None;
                    }
                    repo::save(conn, &mut a, true).await?;
                    repo::add_verlauf(
                        conn,
                        &a,
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
                match entscheide(richtung, bewiesen) {
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
                        let offen = serde_json::to_string(m).expect("serialisierbar");
                        if a.offen.as_deref() == Some(offen.as_str()) {
                            continue;
                        }
                        a.offen = Some(offen);
                        a.offen_bruch_at = Some(bruch.clone());
                        repo::save(conn, &mut a, true).await?;
                        if let Some(einsatz_id) = a.einsatz_id {
                            aus.folgen.push(Folge::Offen { einsatz_id });
                            aus.folgen.push(Folge::Kopf { einsatz_id });
                        }
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
                // auf einen alten Stand wird nicht erfüllt.
                repo::save(conn, &mut a, true).await?;
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

    /// Die größte Akte, die [`AkteMeldung::is_in_grenzen`] annimmt: jedes Textfeld voll mit
    /// Umlauten (zwei Byte je Zeichen), die Erklärung voll mit Anführungszeichen (in JSON zwei Byte
    /// je Zeichen), der Beweis an allen Grenzen der Assertion.
    pub(crate) fn groesste_akte() -> AkteMeldung {
        let text = "ü".repeat(TEXT_MAX);
        AkteMeldung {
            kennung: text.clone(),
            org: text.clone(),
            nummer: Some(text.clone()),
            bezeichnung: text.clone(),
            stichwort: Some(text.clone()),
            status: "abgeschlossen".into(),
            epoche: Epoche {
                zaehler: ZAEHLER_MAX,
                instanz: text.clone(),
            },
            fuehrer: text.clone(),
            fuehrer_name: text,
            art: "notuebernahme".into(),
            erklaerung: Some("\"".repeat(ERKLAERUNG_MAX)),
            beweis: Some(assertion(
                CREDENTIAL_ID_MAX,
                AUTHENTICATOR_DATA_MAX,
                CLIENT_DATA_JSON_MAX,
                SIGNATUR_MAX,
            )),
            anfrage: true,
            offen: true,
            stand: STAND_MAX,
        }
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
    fn groesste_akte_passt_in_eine_meldung() {
        let m = groesste_akte();
        assert!(m.is_in_grenzen(), "die größte Akte liegt in den Grenzen");
        let groesse = serde_json::to_vec(&m).unwrap().len();
        assert!(groesse <= AKTE_BYTES, "{groesse} Byte über {AKTE_BYTES}");
        assert!(AKTE_BYTES <= MELDUNG_BYTES && AKTE_BYTES <= ANTWORT_BYTES);
        // Über die Bytes hinaus (etwa Steuerzeichen, in JSON sechs Byte je Zeichen) gilt sie nicht.
        let mut m = akte();
        m.bezeichnung = "\u{1}".repeat(TEXT_MAX);
        m.stichwort = Some(m.bezeichnung.clone());
        m.nummer = Some(m.bezeichnung.clone());
        m.fuehrer_name = m.bezeichnung.clone();
        m.erklaerung = Some("\u{1}".repeat(ERKLAERUNG_MAX));
        m.beweis = groesste_akte().beweis;
        assert!(serde_json::to_vec(&m).unwrap().len() > AKTE_BYTES);
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
        assert_eq!(entscheide(WirdGemeldet, Ok(())), Entscheid::Annehmen);
        assert_eq!(
            entscheide(WirdGemeldet, Err("x".into())),
            Entscheid::Annehmen,
            "die erreichte Seite nimmt ohne Beweis an"
        );
        assert_eq!(entscheide(MeldetSich, Ok(())), Entscheid::OffenHalten);
        assert_eq!(
            entscheide(MeldetSich, Err("x".into())),
            Entscheid::Verwerfen("x".into())
        );
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
