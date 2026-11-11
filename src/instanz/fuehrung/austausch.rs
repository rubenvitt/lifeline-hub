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
/// Byte-Budget der Akten in einer Antwort.
pub const ANTWORT_BYTES: usize = 256 * 1024;
/// Obergrenzen der Textfelder einer gelieferten Akte (Zeichen).
const TEXT_MAX: usize = 500;
const ERKLAERUNG_MAX: usize = 4096;
/// Größter Zähler einer gelieferten Epoche: weit über jedem echten Verlauf, weit unter dem
/// Überlauf (`Epoche::naechste` rechnet plus eins).
const ZAEHLER_MAX: i64 = 1 << 40;

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

impl AkteMeldung {
    fn aus(a: &AkteZeile, org: &str) -> Self {
        Self {
            kennung: a.kennung.clone(),
            org: org.to_string(),
            nummer: a.nummer.clone(),
            bezeichnung: a.bezeichnung.clone(),
            stichwort: a.stichwort.clone(),
            status: a.status.clone(),
            epoche: a.epoche(),
            fuehrer: a.fuehrer_kennung.clone(),
            fuehrer_name: a.fuehrer_name.clone(),
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

    /// Grenzen der Felder; eine Akte darüber wird nicht übernommen.
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
        let groesse = serde_json::to_vec(&m).map(|v| v.len()).unwrap_or(0);
        if aus.akten.len() == AKTEN_MAX || (summe + groesse > bytes && !aus.akten.is_empty()) {
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
    for m in akten.iter().take(AKTEN_MAX) {
        aus.bis = Some(aus.bis.map_or(m.stand, |b| b.max(m.stand)));
        if !m.is_in_grenzen() {
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
mod tests {
    use super::*;
    use InstanzKopplungRichtung::{MeldetSich, WirdGemeldet};

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
