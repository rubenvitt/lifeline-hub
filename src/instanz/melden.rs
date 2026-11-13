//! Melden (design.md D4, D9): die meldende Seite meldet sich in festen Abständen signiert beim
//! Gegenüber. Die Antwort trägt Widerrufe von Org-Zuordnungen und die Nachlieferung der
//! Unterschriftsschlüssel; eine Meldung trägt umgekehrt Widerrufe der meldenden Seite. Die
//! erreichte Seite baut nie selbst eine Verbindung auf.
//!
//! Das Schema hier ist über alle Protokollversionen nur additiv: Melden geht immer, auch wenn die
//! Versionen weiter auseinanderliegen (D5).

use super::extractor::MELDEN_PFAD;
use super::fuehrung::austausch::{self as fuehrung_austausch, AkteMeldung};
use super::fuehrung::repo as fuehrung_repo;
use super::identitaet::{self, parse_oeffentlich, Identitaet};
use super::repo::{self, KopplungZeile};
use super::signatur::{self, AnfrageDraft, ANTWORT_KOPF, SCHEMA};
use super::stammdaten::{self, liefern, StammdatenArt, StammdatenLieferung};
use super::{org_kennung, InstanzKopplungZustand, PROTOKOLL};
use crate::auth::admin_audit::{self, AdminAktion, Ziel, ZugangsAngaben};
use crate::auth::unterschrift::repo as unterschrift;
use crate::auth::unterschrift::UnterschriftSchluesselLieferung;
use crate::error::AppError;
use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::OnceLock;
use std::time::Duration;

/// Größte Antwort, die die meldende Seite liest.
pub const ANTWORT_MAX: usize = 1024 * 1024;
/// Obergrenze des Abstands bei wiederholten Fehlern.
pub const ABSTAND_MAX_S: u64 = 600;
/// Höchstzahl Orgs je Meldung und je Antwort, ebenso Widerrufe je Meldung (`src/AGENTS.md`,
/// Listen von außen).
pub const ORGS_MAX: usize = 256;
/// Höchstlänge eines age-Empfängers (`age1…`, Bech32, 62 Zeichen) mit Luft.
pub const AGE_EMPFAENGER_MAX: usize = 128;
/// Wie lange eine angebahnte Kopplung auf ihre erste Meldung wartet (D2).
pub const ANGEBAHNT_MINUTEN: i64 = 15;

static ABSTAND_S: OnceLock<u64> = OnceLock::new();

/// Byte-Budget der Stammdaten in einer Antwort, vor Abzug der Unterschriftsschlüssel. Das Budget
/// der Führungsakten geht immer vorab ab, auch ohne Schalter (LLH-1672): sonst läge die Antwort
/// über [`ANTWORT_MAX`] und würde bei jeder Wiederholung gleich gebaut.
const STAMMDATEN_BUDGET: usize =
    ANTWORT_MAX - stammdaten::ANTWORT_RESERVE - fuehrung_austausch::ANTWORT_BYTES;

/// Setzt den Abstand einmal beim Start (`--instanz-melden-sekunden`).
pub fn set_abstand(sekunden: u64) {
    let _ = ABSTAND_S.set(sekunden);
}

/// Abstand der Meldungen in Sekunden (`--instanz-melden-sekunden`).
pub fn abstand_s() -> u64 {
    ABSTAND_S.get().copied().unwrap_or(60)
}

/// Abstand bis zur nächsten Meldung nach `fehlversuche` Fehlschlägen in Folge: verdoppelt bis
/// [`ABSTAND_MAX_S`].
pub fn next_abstand(grund: u64, fehlversuche: u32) -> u64 {
    grund
        .saturating_mul(1u64 << fehlversuche.min(16))
        .min(ABSTAND_MAX_S.max(grund))
}

// ── Leitung ──────────────────────────────────────────────────────────────────────────────────

/// Eine Org in einer Meldung, aus Sicht der meldenden Seite: die Kennung der Org beim Gegenüber
/// und der höchste Stand der Unterschriftsschlüssel, den wir von dort haben.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MeldenOrg {
    pub org: String,
    pub unterschrift_stand: i64,
    /// Übernommener Stand der Stammdaten (LLH-1493, D2); `-1` = aus dieser Zuordnung keine
    /// Stammdaten (die Org hat schon eine andere Quelle).
    #[serde(default)]
    pub stammdaten_stand: i64,
}

/// Body von `POST /api/instanz/melden`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeldenAnfrage {
    pub name: String,
    pub softwarestand: String,
    pub protokoll: u32,
    pub orgs: Vec<MeldenOrg>,
    /// Org-Kennungen beim Gegenüber, die die meldende Seite widerrufen hat.
    #[serde(default)]
    pub widerrufen: Vec<String>,
    /// Stammdatenarten, die die meldende Seite übernehmen kann (LLH-1493, D2); leer = keine
    /// Stammdaten (eine Instanz vor LLH-1493).
    #[serde(default)]
    pub stammdaten_arten: Vec<String>,
    /// age-Empfänger der meldenden Seite für Kontogeheimnisse (D6).
    #[serde(default)]
    pub age_empfaenger: Option<String>,
    /// Der Betreiber der meldenden Seite hat die Datenträgerverschlüsselung bestätigt (D6).
    #[serde(default)]
    pub datentraeger_verschluesselt: bool,
    /// Führungsakten der meldenden Seite seit der letzten Quittung (LLH-1491, D3); leer ohne
    /// Schalter oder vor LLH-1491.
    #[serde(default)]
    pub fuehrung: Vec<AkteMeldung>,
    /// Bis zu diesem Stand der erreichten Seite hat die meldende Seite Akten übernommen.
    #[serde(default)]
    pub fuehrung_bis: i64,
    /// Bis zu diesem eigenen Stand hat die erreichte Seite nach dem Wissen der meldenden Seite
    /// schon quittiert (ihr `fuehrung_gesendet_bis`, LLH-1708, design.md D5 der Change
    /// `xi5ugyt8-fuehrung-stand-nach-restore`). Liegt die erreichte Seite darunter, wurde sie aus
    /// einer Sicherung zurückgespielt. 0 vor LLH-1708.
    #[serde(default)]
    pub fuehrung_gesendet_bis: i64,
    /// Direktkopplung: der Fingerabdruck des Zertifikats der erreichten Seite, den die meldende
    /// Seite als beglaubigt gespeichert hat (LLH-1497, Anzeige „Zertifikat bestätigt“).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_zertifikat: Option<String>,
}

/// Eine Org in der Antwort.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeldenOrgAntwort {
    pub org: String,
    pub widerrufen: bool,
    #[serde(default)]
    pub unterschrift: Vec<UnterschriftSchluesselLieferung>,
    /// Nachlieferung der Stammdaten (LLH-1493, D2).
    #[serde(default)]
    pub stammdaten: Vec<StammdatenLieferung>,
    /// Bis zu diesem Stand darf die meldende Seite ihren Stammdaten-Stand setzen.
    #[serde(default)]
    pub stammdaten_bis: i64,
}

/// Antwort auf eine Meldung.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeldenAntwort {
    pub name: String,
    pub softwarestand: String,
    pub protokoll: u32,
    pub orgs: Vec<MeldenOrgAntwort>,
    /// Führungsakten der erreichten Seite über `fuehrung_bis` der Meldung (LLH-1491, D3).
    #[serde(default)]
    pub fuehrung: Vec<AkteMeldung>,
    /// Bis zu diesem Stand der meldenden Seite hat die erreichte Seite Akten übernommen.
    #[serde(default)]
    pub fuehrung_bis: i64,
    /// Es bleiben weitere Akten: die meldende Seite meldet sich gleich wieder.
    #[serde(default)]
    pub fuehrung_mehr: bool,
    /// Die erreichte Seite nimmt Hinweise im Abgleich an (LLH-1495, design.md D4). Ein älterer
    /// Stand nennt es nicht: dann `false`, und die meldende Seite pusht selbst.
    #[serde(default)]
    pub hinweise: bool,
    /// Die erreichte Seite bietet Web Push an (D4).
    #[serde(default)]
    pub web_push: bool,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        crate::ausgehend::client_builder(crate::ausgehend::Zweck::Instanzkopplung)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .no_gzip()
            .build()
            .expect("HTTP-Client der Instanzkopplung")
    })
}

/// Normalisiert die Adresse des Gegenübers: `https://` (für Loopback auch `http://`, nur für
/// Tests und lokale Versuche), ohne Query, Fragment und abschließenden Schrägstrich. Ein Pfad
/// bleibt (Instanz hinter einem Proxy unter einem Präfix).
pub fn normalize_adresse(eingabe: &str) -> Result<String, AppError> {
    let url = reqwest::Url::parse(eingabe.trim())
        .map_err(|_| AppError::Validation("Adresse ist keine gültige URL.".into()))?;
    let host = url.host_str().unwrap_or_default();
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    match url.scheme() {
        "https" => {}
        "http" if loopback => {}
        _ => {
            return Err(AppError::Validation(
                "Die Adresse muss mit https:// beginnen.".into(),
            ))
        }
    }
    if host.is_empty() || !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::Validation(
            "Adresse ist keine gültige URL.".into(),
        ));
    }
    let mut basis = format!("{}://{}", url.scheme(), host.to_ascii_lowercase());
    if let Some(port) = url.port() {
        basis.push_str(&format!(":{port}"));
    }
    basis.push_str(url.path().trim_end_matches('/'));
    Ok(basis)
}

/// Warum eine Nachricht an das Gegenüber scheiterte.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendError {
    /// Nicht erreichbar oder Zeitüberschreitung.
    Netz(String),
    /// Das Gegenüber hat mit diesem Status abgelehnt.
    Abgelehnt(u16, String),
    /// Die Antwort war nicht vom Gegenüber signiert oder passte nicht.
    AntwortUngueltig(String),
    /// Direktkopplung: das gezeigte TLS-Zertifikat ist nicht das beglaubigte (vor dem Senden
    /// abgebrochen); [`send_signed_bis`] holt dann die signierte Aussage ein.
    ZertifikatGewechselt,
    /// Direktkopplung: auch die signierte Aussage beglaubigt das gezeigte Zertifikat nicht; es geht
    /// nichts hinaus (Spec `instanz-kopplung`).
    ZertifikatPasstNicht,
}

impl std::fmt::Display for SendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SendError::Netz(t) => write!(f, "nicht erreichbar: {t}"),
            SendError::Abgelehnt(s, t) if t.is_empty() => write!(f, "abgelehnt ({s})"),
            SendError::Abgelehnt(s, t) => write!(f, "abgelehnt ({s}): {t}"),
            SendError::AntwortUngueltig(t) => write!(f, "Antwort ungültig: {t}"),
            SendError::ZertifikatGewechselt | SendError::ZertifikatPasstNicht => {
                f.write_str(repo::ZERTIFIKAT_PASST_NICHT)
            }
        }
    }
}

/// Eine geprüfte Antwort des Gegenübers.
#[derive(Debug)]
pub struct VerifiedAntwort<T> {
    pub wert: T,
    /// Uhr des Gegenübers minus unsere, in Sekunden.
    pub uhr_abweichung_s: i64,
}

/// Schickt eine signierte Anfrage an das Gegenüber und prüft dessen signierte Antwort.
pub async fn send_signed<A: Serialize, T: DeserializeOwned>(
    pool: &SqlitePool,
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
    pfad: &str,
    anfrage: &A,
) -> Result<VerifiedAntwort<T>, SendError> {
    send_signed_bis(pool, identitaet, kopplung, pfad, anfrage, ANTWORT_MAX).await
}

/// Wie [`send_signed`], mit eigener Lesegrenze der Antwort (Abgleich, LLH-1492).
///
/// Direktkopplung (LLH-1497, design.md D3): Zeigt die Gegenstelle ein anderes als das beglaubigte
/// Zertifikat, bricht der Versand vor dem Senden ab; dann holt [`bestaetige_zertifikat`] eine
/// signierte Aussage ohne Nutzdaten ein, und nur wenn sie das gezeigte Zertifikat nennt, geht die
/// Anfrage einmal neu hinaus.
pub async fn send_signed_bis<A: Serialize, T: DeserializeOwned>(
    pool: &SqlitePool,
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
    pfad: &str,
    anfrage: &A,
    antwort_max: usize,
) -> Result<VerifiedAntwort<T>, SendError> {
    match send_signed_einmal(identitaet, kopplung, pfad, anfrage, antwort_max).await {
        Err(SendError::ZertifikatGewechselt) => {}
        sonst => return sonst,
    }
    // Kann die Gegenstelle keine gültige Aussage liefern (unsigniert, abgelehnt), passt das
    // gezeigte Zertifikat nicht; nur ein Netzfehler bleibt einer (Spec „Fremdes Zertifikat“).
    let neu = match bestaetige_zertifikat(identitaet, kopplung).await {
        Ok(neu) => neu,
        Err(SendError::Netz(t)) => return Err(SendError::Netz(t)),
        Err(_) => return Err(SendError::ZertifikatPasstNicht),
    };
    if let Err(e) = save_neues_zertifikat(pool, kopplung, &neu).await {
        return Err(SendError::Netz(format!(
            "Zertifikat nicht gespeichert: {e}"
        )));
    }
    let mut k = kopplung.clone();
    k.tls_zertifikat = Some(neu);
    match send_signed_einmal(identitaet, &k, pfad, anfrage, antwort_max).await {
        Err(SendError::ZertifikatGewechselt) => Err(SendError::ZertifikatPasstNicht),
        sonst => sonst,
    }
}

/// Pfad der signierten Aussage über das TLS-Zertifikat (design.md D3).
pub const ZERTIFIKAT_PFAD: &str = "/api/instanz/zertifikat";

/// Antwort auf `POST /api/instanz/zertifikat`: der Fingerabdruck des Zertifikats, das die
/// erreichte Seite gerade zeigt, von ihr signiert.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZertifikatAussage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_zertifikat: Option<String>,
}

/// Holt über eine Verbindung ohne Pin eine signierte Aussage über das Zertifikat der Gegenstelle
/// ein (leere Anfrage, keine Nutzdaten). Passt die Aussage zum gesehenen Zertifikat, wird sie als
/// neuer Pin gespeichert und in die Admin-Spur geschrieben (Spec `instanz-kopplung`, „Ein neues
/// Zertifikat wird vor den Nutzdaten bestätigt“).
async fn bestaetige_zertifikat(
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
) -> Result<String, SendError> {
    let client = super::zertifikat::build_client(None).map_err(SendError::Netz)?;
    let (antwort, gesehen) = send_signed_mit::<_, ZertifikatAussage>(
        &client,
        identitaet,
        kopplung,
        ZERTIFIKAT_PFAD,
        &serde_json::json!({}),
        ANTWORT_MAX,
    )
    .await?;
    match (antwort.wert.tls_zertifikat, gesehen) {
        (Some(a), Some(g)) if a == g => Ok(g),
        _ => Err(SendError::ZertifikatPasstNicht),
    }
}

/// Speichert einen per [`bestaetige_zertifikat`] neu beglaubigten Pin samt Spur, wenn er sich
/// geändert hat. Aufgerufen von den Läufen, die den Pool kennen.
pub async fn save_neues_zertifikat(
    pool: &sqlx::SqlitePool,
    kopplung: &KopplungZeile,
    neu: &str,
) -> Result<(), AppError> {
    if kopplung.tls_zertifikat.as_deref() == Some(neu) {
        return Ok(());
    }
    // Die Verbindung vor der Spur zurückgeben: der Pool kann eine einzige sein.
    let orgs = {
        let mut conn = pool.acquire().await?;
        repo::save_tls_zertifikat(&mut conn, kopplung.id, Some(neu)).await?;
        repo::list_orgs_aktiv(&mut conn, kopplung.id).await?
    };
    for o in orgs {
        crate::auth::admin_audit::schreibe_ohne_akteur(
            pool,
            crate::auth::admin_audit::AdminAktion::InstanzZertifikatGewechselt,
            o.org_id,
            &kopplung.gegenueber_name,
            crate::auth::admin_audit::Ziel::Instanz(&kopplung.gegenueber_name),
            Some(build_angaben_gegenstelle(kopplung, &o.fremde_org_name)),
            None,
        )
        .await;
    }
    Ok(())
}

/// Sucht die Gegenstelle einer Direktkopplung im LAN unter neuer Adresse (LLH-1497, design.md
/// D6). Eine Adresse gilt erst, wenn dort die signierte Aussage über das Zertifikat kommt; dann
/// werden Adresse (und ein neuer Pin) gespeichert und in die Admin-Spur geschrieben.
/// `Err(Some(fehler))`: eine Adresse antwortete, aber nicht gültig; `Err(None)`: nichts gefunden.
async fn neu_aufloesen(
    pool: &SqlitePool,
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
) -> Result<Result<KopplungZeile, Option<SendError>>, AppError> {
    if !super::entdeckung::is_an(pool).await? {
        return Ok(Err(None));
    }
    // Nur Ankündigungen mit Kennung UND Fingerabdruck der Gegenstelle: eine gefälschte mit
    // fremdem Schlüssel kommt gar nicht erst in Frage (die Aussage prüft ohnehin die Signatur).
    let fingerabdruck = super::basis32::parse_b64(&kopplung.gegenueber_schluessel)
        .map(|b| super::basis32::fingerabdruck(&b))
        .unwrap_or_default();
    let gefunden = super::entdeckung::suche_kennung(
        pool,
        &kopplung.gegenueber_kennung,
        &fingerabdruck,
        super::entdeckung::SUCHDAUER,
    )
    .await?;
    let mut letzter = None;
    for adresse in gefunden {
        let Ok(adresse) = normalize_adresse(&adresse) else {
            continue;
        };
        if kopplung.gegenueber_adresse.as_deref() == Some(adresse.as_str()) {
            continue;
        }
        let mut k = kopplung.clone();
        k.gegenueber_adresse = Some(adresse.clone());
        match bestaetige_zertifikat(identitaet, &k).await {
            Ok(fp) => {
                let orgs = {
                    let mut conn = pool.acquire().await?;
                    repo::save_adresse(&mut conn, kopplung.id, &adresse).await?;
                    repo::list_orgs_aktiv(&mut conn, kopplung.id).await?
                };
                save_neues_zertifikat(pool, kopplung, &fp).await?;
                for o in orgs {
                    admin_audit::schreibe_ohne_akteur(
                        pool,
                        AdminAktion::InstanzAdresseGeaendert,
                        o.org_id,
                        &kopplung.gegenueber_name,
                        Ziel::Instanz(&kopplung.gegenueber_name),
                        Some(build_angaben_gegenstelle(&k, &o.fremde_org_name)),
                        None,
                    )
                    .await;
                }
                k.tls_zertifikat = Some(fp);
                return Ok(Ok(k));
            }
            Err(e) => letzter = Some(e),
        }
    }
    Ok(Err(letzter))
}

async fn send_signed_einmal<A: Serialize, T: DeserializeOwned>(
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
    pfad: &str,
    anfrage: &A,
    antwort_max: usize,
) -> Result<VerifiedAntwort<T>, SendError> {
    let client = match kopplung.art() {
        super::InstanzKopplungArt::Standard => client().clone(),
        super::InstanzKopplungArt::VorOrt => {
            // Ohne beglaubigten Pin geht über eine Direktkopplung nichts hinaus.
            let pin = kopplung
                .tls_zertifikat
                .as_deref()
                .ok_or(SendError::ZertifikatGewechselt)?;
            super::zertifikat::client(pin).map_err(SendError::Netz)?
        }
    };
    send_signed_mit(&client, identitaet, kopplung, pfad, anfrage, antwort_max)
        .await
        .map(|(a, _)| a)
}

/// Eine signierte Anfrage über `client`; liefert die geprüfte Antwort und den Fingerabdruck des
/// Zertifikats, über das sie kam (nur bei einem Client mit `tls_info`).
async fn send_signed_mit<A: Serialize, T: DeserializeOwned>(
    client: &reqwest::Client,
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
    pfad: &str,
    anfrage: &A,
    antwort_max: usize,
) -> Result<(VerifiedAntwort<T>, Option<String>), SendError> {
    let basis = kopplung
        .gegenueber_adresse
        .as_deref()
        .ok_or_else(|| SendError::Netz("keine Adresse".into()))?;
    let schluessel = parse_oeffentlich(&kopplung.gegenueber_schluessel)
        .ok_or_else(|| SendError::AntwortUngueltig("Schlüssel des Gegenübers unlesbar".into()))?;
    let body = serde_json::to_vec(anfrage).expect("Anfrage ist serialisierbar");
    let (token, jti) = signatur::sign_anfrage(
        identitaet,
        &AnfrageDraft {
            ziel_kennung: &kopplung.gegenueber_kennung,
            methode: "POST",
            pfad,
            body: &body,
        },
        Utc::now().timestamp(),
    );
    let resp = client
        .post(format!("{basis}{pfad}"))
        .header(reqwest::header::AUTHORIZATION, format!("{SCHEMA} {token}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| {
            if super::zertifikat::is_passt_nicht(&e) {
                SendError::ZertifikatGewechselt
            } else {
                SendError::Netz(e.without_url().to_string())
            }
        })?;
    let gesehen = super::zertifikat::gesehen(&resp);
    let status = resp.status().as_u16();
    let antwort_token = resp
        .headers()
        .get(ANTWORT_KOPF)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let rumpf = crate::http_begrenzt::lies_begrenzt(resp, antwort_max)
        .await
        .map_err(|e| SendError::Netz(e.to_string()))?;
    let Some(antwort_token) = antwort_token else {
        let text = serde_json::from_slice::<serde_json::Value>(&rumpf)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or_default();
        return Err(if (200..300).contains(&status) {
            SendError::AntwortUngueltig("ohne Signatur".into())
        } else {
            SendError::Abgelehnt(status, text)
        });
    };
    let jetzt = Utc::now().timestamp();
    let claims = signatur::verify_antwort(
        &antwort_token,
        &schluessel,
        &kopplung.gegenueber_kennung,
        &identitaet.kennung,
        &jti,
        status,
        &rumpf,
        jetzt,
    )
    .map_err(|e| SendError::AntwortUngueltig(e.to_string()))?;
    if !(200..300).contains(&status) {
        return Err(SendError::Abgelehnt(status, String::new()));
    }
    let wert = serde_json::from_slice(&rumpf)
        .map_err(|e| SendError::AntwortUngueltig(format!("Body unlesbar: {e}")))?;
    Ok((
        VerifiedAntwort {
            wert,
            uhr_abweichung_s: claims.iat.saturating_sub(jetzt),
        },
        gesehen,
    ))
}

/// Prüft die Listen einer Meldung gegen [`ORGS_MAX`] (gezählt vor dem Entdoppeln) und
/// entdoppelt sie: je Org-Kennung zählt der erste Eintrag.
fn dedupe_anfrage(anfrage: &MeldenAnfrage) -> Result<(Vec<&MeldenOrg>, Vec<&str>), AppError> {
    if anfrage.orgs.len() > ORGS_MAX || anfrage.widerrufen.len() > ORGS_MAX {
        return Err(AppError::Validation(format!(
            "Eine Meldung darf höchstens {ORGS_MAX} Orgs und {ORGS_MAX} Widerrufe nennen."
        )));
    }
    if anfrage.stammdaten_arten.len() > stammdaten::ARTEN_MAX
        || anfrage
            .age_empfaenger
            .as_ref()
            .is_some_and(|a| a.len() > AGE_EMPFAENGER_MAX)
    {
        return Err(AppError::Validation(
            "Stammdatenarten oder age-Empfänger über der Grenze.".into(),
        ));
    }
    let mut gesehen = std::collections::HashSet::new();
    let orgs = anfrage
        .orgs
        .iter()
        .filter(|o| gesehen.insert(o.org.as_str()))
        .collect();
    let mut gesehen = std::collections::HashSet::new();
    let widerrufen = anfrage
        .widerrufen
        .iter()
        .map(String::as_str)
        .filter(|w| gesehen.insert(*w))
        .collect();
    Ok((orgs, widerrufen))
}

/// Prüft die Listen einer Antwort gegen [`ORGS_MAX`] und [`unterschrift::LIEFERUNGEN_MAX`] (über
/// alle Orgs zusammen). Eine
/// Org doppelt macht die Antwort ungültig, statt entdoppelt zu werden: sonst entschiede die
/// Reihenfolge, ob ein Widerruf gilt.
fn check_antwort(antwort: &MeldenAntwort) -> Result<(), String> {
    if antwort.orgs.len() > ORGS_MAX {
        return Err(format!("mehr als {ORGS_MAX} Orgs in der Antwort"));
    }
    let lieferungen: usize = antwort.orgs.iter().map(|o| o.unterschrift.len()).sum();
    if lieferungen > unterschrift::LIEFERUNGEN_MAX {
        return Err(format!(
            "mehr als {} Unterschriftsschlüssel in der Antwort",
            unterschrift::LIEFERUNGEN_MAX
        ));
    }
    let stammdaten: usize = antwort.orgs.iter().map(|o| o.stammdaten.len()).sum();
    if stammdaten > stammdaten::STAMMDATEN_MAX + stammdaten::ABHAENGIGE_MAX {
        return Err("zu viele Stammdaten in der Antwort".into());
    }
    let unterlisten_zu_lang = antwort
        .orgs
        .iter()
        .flat_map(|o| o.stammdaten.iter())
        .filter_map(|l| l.daten.as_ref()?.get("unterlisten")?.as_object())
        .flat_map(|m| m.values())
        .any(|v| {
            v.as_array()
                .is_some_and(|a| a.len() > stammdaten::UNTERLISTE_MAX)
        });
    if unterlisten_zu_lang {
        return Err("Unterliste in den Stammdaten über der Grenze".into());
    }
    let mut gesehen = std::collections::HashSet::new();
    if !antwort.orgs.iter().all(|o| gesehen.insert(o.org.as_str())) {
        return Err("eine Org doppelt in der Antwort".into());
    }
    Ok(())
}

// ── Meldende Seite ───────────────────────────────────────────────────────────────────────────

/// Meldet sich einmal bei einer Kopplung, in der diese Instanz sich meldet, und übernimmt die
/// Antwort. `widerrufen` sind Org-Zuordnungen, die hier gerade widerrufen wurden und deren
/// Widerruf mitgehen soll (sie sind schon nicht mehr aktiv). Fehler landen an der Kopplung, nicht
/// beim Aufrufer.
pub async fn melden_einmal(pool: &SqlitePool, kopplung: &KopplungZeile) -> Result<(), AppError> {
    melden_einmal_mit(pool, kopplung, true).await
}

/// Wie [`melden_einmal`]; `aufloesen` erlaubt höchstens ein Neuauflösen der Adresse je Lauf, damit
/// zwei angekündigte Adressen einander nicht ohne Ende ablösen (LLH-1497, Review).
async fn melden_einmal_mit(
    pool: &SqlitePool,
    kopplung: &KopplungZeile,
    aufloesen: bool,
) -> Result<(), AppError> {
    let identitaet = identitaet::load_or_create(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    // Stammdaten (LLH-1493): was diese Instanz empfangen kann; ändert es sich, beginnt die
    // Nachlieferung bei 0. Je Org nur die Quelle (älteste Zuordnung) bekommt Stammdaten.
    let age = stammdaten::geheimnis::load_or_create_age(pool).await?;
    let datentraeger = stammdaten::geheimnis::is_datentraeger_bestaetigt(pool).await?;
    let kennzeichen = stammdaten::empfangs_kennzeichen(datentraeger);
    let quellen: Vec<i64> = crate::write_retry!(pool, |conn| {
        let mut quellen = Vec::new();
        for o in repo::list_orgs_aktiv(conn, kopplung.id).await? {
            if stammdaten::herkunft::find_quelle(conn, o.org_id).await? == Some(o.id) {
                repo::save_stammdaten_kennzeichen(conn, o.id, &kennzeichen).await?;
                quellen.push(o.id);
            } else if kopplung.art().traegt(super::Fluss::Stammdaten) {
                // Über eine Direktkopplung fließen nie Stammdaten (LLH-1497): kein Hinweis dort.
                repo::add_stammdaten_hinweise(
                    conn,
                    o.id,
                    &[
                        "Stammdaten dieser Org kommen schon aus einer anderen Kopplung."
                            .to_string(),
                    ],
                )
                .await?;
            }
        }
        Ok(quellen)
    })?;
    let (aktiv, offen) = {
        let mut conn = pool.acquire().await?;
        (
            repo::list_orgs_aktiv(&mut conn, kopplung.id).await?,
            repo::list_orgs_widerruf_offen(&mut conn, kopplung.id).await?,
        )
    };
    // Führung je Einsatz (LLH-1491, D3): Akten seit der letzten Quittung des Gegenübers.
    let fuehrung_an = super::fuehrung::is_enabled(pool).await?;
    let (fuehrung_ausgang, fuehrung_gesendet, fuehrung_empfangen) = if fuehrung_an {
        crate::write_retry!(pool, |conn| {
            fuehrung_repo::ensure_akten(conn).await?;
            let (gesendet, empfangen) =
                fuehrung_repo::load_kopplung_staende(conn, kopplung.id).await?;
            let ausgang = fuehrung_austausch::build_ausgang(
                conn,
                kopplung,
                gesendet,
                fuehrung_austausch::MELDUNG_BYTES,
            )
            .await?;
            Ok((ausgang, gesendet, empfangen))
        })?
    } else {
        (fuehrung_austausch::Ausgang::default(), 0, 0)
    };
    // Höchster Stand, den diese Meldung abdeckt: Mehr darf das Gegenüber nicht quittieren
    // (LLH-1672); sonst fiele, was wegen `AKTEN_MAX` oder des Budgets hier blieb.
    let gesendet_hoechst = fuehrung_ausgang.bis.max(fuehrung_gesendet);
    let anfrage = MeldenAnfrage {
        name: super::name().to_string(),
        softwarestand: super::softwarestand().to_string(),
        protokoll: PROTOKOLL,
        orgs: aktiv
            .iter()
            .map(|o| MeldenOrg {
                org: o.fremde_org_kennung.clone(),
                unterschrift_stand: o.unterschrift_stand,
                stammdaten_stand: if quellen.contains(&o.id) {
                    o.stammdaten_stand
                } else {
                    -1
                },
            })
            .collect(),
        widerrufen: offen.iter().map(|o| o.fremde_org_kennung.clone()).collect(),
        stammdaten_arten: stammdaten::eigene_arten(),
        age_empfaenger: Some(age.to_public().to_string()),
        datentraeger_verschluesselt: datentraeger,
        fuehrung: fuehrung_ausgang.akten,
        fuehrung_bis: fuehrung_empfangen,
        fuehrung_gesendet_bis: fuehrung_gesendet,
        tls_zertifikat: kopplung.tls_zertifikat.clone(),
    };
    let jetzt = crate::zeit::jetzt();
    let ergebnis =
        send_signed::<_, MeldenAntwort>(pool, &identitaet, kopplung, MELDEN_PFAD, &anfrage).await;
    let antwort = match ergebnis.and_then(|a| match check_antwort(&a.wert) {
        Ok(()) => Ok(a),
        Err(grund) => Err(SendError::AntwortUngueltig(grund)),
    }) {
        Ok(a) => a,
        Err(f) => {
            // Direktkopplung nicht erreichbar: die Gegenstelle im LAN unter ihrer Kennung suchen
            // (LLH-1497, Spec `instanz-entdeckung`). Gefunden und signiert bestätigt, gleich dort
            // melden; das Neuauflösen findet die dann gespeicherte Adresse nicht noch einmal.
            let f = if aufloesen
                && matches!(f, SendError::Netz(_))
                && kopplung.art() == super::InstanzKopplungArt::VorOrt
            {
                match neu_aufloesen(pool, &identitaet, kopplung).await? {
                    Ok(neu) => return Box::pin(melden_einmal_mit(pool, &neu, false)).await,
                    Err(Some(probe)) => probe,
                    Err(None) => f,
                }
            } else {
                f
            };
            let abstand = next_abstand(abstand_s(), kopplung.fehlversuche as u32 + 1);
            let naechste = add_sekunden(&jetzt, abstand as i64).unwrap_or(jetzt);
            tracing::warn!(kopplung = kopplung.id, fehler = %f, "Meldung bei gekoppelter Instanz gescheitert");
            let mut conn = pool.acquire().await?;
            repo::save_meldeversuch(&mut conn, kopplung.id, Some(&f.to_string()), &naechste)
                .await?;
            return Ok(());
        }
    };
    let a = antwort.wert;
    // Bleibt mehr Führung, als in diese Meldung passte, meldet sie sich gleich wieder (D3).
    // Eigener Rest nur, wenn das Gegenüber quittiert hat (sonst hörte ein Gegenüber ohne Schalter
    // die Meldung jede fünf Sekunden).
    // Quittung des Gegenübers, höchstens bis zum Stand, den diese Meldung abdeckte (LLH-1672).
    let quittung = a.fuehrung_bis.min(gesendet_hoechst);
    let fortschritt = quittung > fuehrung_gesendet;
    let naechste = if fuehrung_an && ((fuehrung_ausgang.mehr && fortschritt) || a.fuehrung_mehr) {
        jetzt.clone()
    } else {
        add_sekunden(&jetzt, abstand_s() as i64).unwrap_or(jetzt.clone())
    };
    let mut abgelehnt_alle = Vec::new();
    let mut vom_gegenueber_widerrufen = Vec::new();
    let mut stammdaten_geaendert: Vec<i64> = Vec::new();
    let mut sitzungen_beendet: Vec<String> = Vec::new();
    let mut fuehrung_folgen = Vec::new();
    crate::write_retry!(pool, |conn| {
        abgelehnt_alle.clear();
        vom_gegenueber_widerrufen.clear();
        stammdaten_geaendert.clear();
        sitzungen_beendet.clear();
        fuehrung_folgen.clear();
        repo::mark_gesehen(
            conn,
            kopplung.id,
            &a.softwarestand,
            a.protokoll,
            Some(antwort.uhr_abweichung_s),
            &jetzt,
        )
        .await?;
        repo::save_faehigkeiten(conn, kopplung.id, a.hinweise, a.web_push).await?;
        let ids: Vec<i64> = offen.iter().map(|o| o.id).collect();
        repo::mark_widerruf_gemeldet(conn, &ids, &jetzt).await?;
        for oa in &a.orgs {
            let Some(o) = aktiv.iter().find(|o| o.fremde_org_kennung == oa.org) else {
                continue;
            };
            if oa.widerrufen {
                if let Some(einsaetze) =
                    repo::org_widerrufen(conn, o.id, None, &jetzt, true).await?
                {
                    vom_gegenueber_widerrufen.push(o.clone());
                    fuehrung_folgen.extend(
                        einsaetze
                            .into_iter()
                            .map(|einsatz_id| fuehrung_austausch::Folge::Kopf { einsatz_id }),
                    );
                }
                continue;
            }
            let ziel = unterschrift::Ziel {
                kopplung_org_id: o.id,
                org_id: o.org_id,
                fremde_org_kennung: &o.fremde_org_kennung,
            };
            for ab in unterschrift::accept_lieferungen(conn, &ziel, &oa.unterschrift, false, &jetzt)
                .await?
            {
                abgelehnt_alle.push((o.clone(), ab));
            }
            if quellen.contains(&o.id) {
                let ergebnis =
                    stammdaten::uebernehmen::uebernehmen(conn, o, &oa.stammdaten, Some(&age))
                        .await?;
                repo::save_stammdaten_stand(conn, o.id, o.stammdaten_stand, oa.stammdaten_bis)
                    .await?;
                repo::add_stammdaten_hinweise(conn, o.id, &ergebnis.hinweise).await?;
                for konto in &ergebnis.deaktivierte_konten {
                    sitzungen_beendet
                        .extend(crate::auth::session::alle_loeschen(conn, *konto).await?);
                }
                if ergebnis.geaendert {
                    stammdaten_geaendert.push(o.org_id);
                }
            }
        }
        if let Some((_, ab)) = abgelehnt_alle.last() {
            repo::set_hinweis(
                conn,
                kopplung.id,
                &format!(
                    "Unterschriftsschlüssel von {} ({}) abgelehnt: {}",
                    ab.benutzer_name, ab.fingerabdruck, ab.grund
                ),
            )
            .await?;
        }
        // Spricht die Quelle zum ersten Mal Protokoll 3, liefert sie die Ursprungskennung mit
        // (LLH-1497, design.md D5): einmal von vorn, damit jede übernommene Zeile sie trägt.
        if kopplung
            .gegenueber_protokoll
            .is_some_and(|p| p < i64::from(super::PROTOKOLL_VOR_ORT))
            && a.protokoll >= super::PROTOKOLL_VOR_ORT
        {
            for id in &quellen {
                sqlx::query("UPDATE instanz_kopplung_org SET stammdaten_stand = 0 WHERE id = ?")
                    .bind(id)
                    .execute(&mut *conn)
                    .await?;
            }
        }
        if fuehrung_an {
            // Bruchstelle (D11): die letzte erfolgreiche Meldung VOR dieser.
            let eingang = fuehrung_austausch::apply_eingang(
                conn,
                kopplung,
                &a.fuehrung,
                kopplung.zuletzt_gesehen_at.as_deref(),
            )
            .await?;
            fuehrung_repo::save_kopplung_staende(conn, kopplung.id, Some(quittung), eingang.bis)
                .await?;
            // Rückschritt des Gegenübers (LLH-1708, D2): Seine Quittung liegt unter dem, was es
            // schon bestätigt hatte, es hat also Akten mit einer Sicherung verloren. 0 sagt ein
            // Gegenüber ohne Schalter oder vor LLH-1491 immer; das ist kein Rückschritt.
            if a.fuehrung_bis > 0 && a.fuehrung_bis < fuehrung_gesendet {
                fuehrung_repo::reset_gesendet_bis(conn, kopplung.id, a.fuehrung_bis).await?;
            }
            // Rückschritt des eigenen Zählers (D3): Wer selbst zurückgespielt wurde, hebt ihn über
            // die Quittung. Für diese Kopplung braucht es kein neues Stempeln (sie sendet ab dem
            // eigenen `gesendet_bis`), wohl aber für jede, in der diese Instanz erreichte Seite ist.
            fuehrung_austausch::repair_stand(conn, kopplung, a.fuehrung_bis).await?;
            if let Some(h) = &eingang.hinweis {
                repo::set_hinweis(conn, kopplung.id, h).await?;
            }
            // Anhängen, nicht zuweisen (LLH-1855): Die Kopf-Folgen eines Widerrufs durch das
            // Gegenüber stehen schon in der Liste.
            fuehrung_folgen.extend(eingang.folgen);
        }
        repo::update_zustand_nach_orgs(
            conn,
            kopplung.id,
            InstanzKopplungZustand::VomGegenueberWiderrufen,
        )
        .await?;
        // Der Meldeversuch gehört zur Meldung (LLH-1674): Klemmt er, gilt nichts davon, und die
        // nächste Meldung holt alles nach. Sonst stünden committete Wechsel ohne ihre Folgen.
        repo::save_meldeversuch(conn, kopplung.id, None, &naechste).await?;
        Ok(())
    })?;
    // Nach dem Commit kein `?` mehr vor den Folgen: Alarm, Benachrichtigung, Kopf-Ereignis und
    // Admin-Spur der übernommenen Akten.
    fuehrung_austausch::run_folgen(pool, kopplung, &fuehrung_folgen).await;
    if let Some(live) = stammdaten::live() {
        for org_id in &stammdaten_geaendert {
            live.publiziere_stammdaten(*org_id);
        }
        live.melde_sitzung_ende(sitzungen_beendet);
    }

    for o in &vom_gegenueber_widerrufen {
        admin_audit::schreibe_ohne_akteur(
            pool,
            AdminAktion::InstanzKopplungVomGegenueberWiderrufen,
            o.org_id,
            &kopplung.gegenueber_name,
            Ziel::Instanz(&kopplung.gegenueber_name),
            Some(build_angaben_gegenstelle(kopplung, &o.fremde_org_name)),
            None,
        )
        .await;
    }
    for (o, ab) in &abgelehnt_alle {
        let mut angaben = build_angaben_gegenstelle(kopplung, &o.fremde_org_name);
        angaben.fingerabdruck = Some(ab.fingerabdruck.clone());
        angaben.grund = Some(ab.grund.clone());
        admin_audit::schreibe_ohne_akteur(
            pool,
            AdminAktion::UnterschriftAbgelehnt,
            o.org_id,
            &kopplung.gegenueber_name,
            Ziel::Unterschrift(&ab.benutzer_name),
            Some(angaben),
            None,
        )
        .await;
    }
    Ok(())
}

/// Angaben zur Gegenstelle für die Admin-Spur.
pub fn build_angaben_gegenstelle(kopplung: &KopplungZeile, fremde_org: &str) -> ZugangsAngaben {
    ZugangsAngaben {
        instanz_kennung: Some(kopplung.gegenueber_kennung.clone()),
        fingerabdruck: crate::instanz::basis32::parse_b64(&kopplung.gegenueber_schluessel)
            .map(|b| crate::instanz::basis32::fingerabdruck(&b)),
        adresse: kopplung.gegenueber_adresse.clone(),
        fremde_org: Some(fremde_org.to_string()),
        ..ZugangsAngaben::default()
    }
}

fn add_sekunden(zeit: &str, sekunden: i64) -> Option<String> {
    crate::zeit::parse(zeit)
        .map(|t| crate::zeit::formatiere(t + chrono::Duration::seconds(sekunden)))
}

/// Ein Durchlauf des Hintergrund-Tasks: alle fälligen Meldungen, dann angebahnte Kopplungen
/// verwerfen, die zu lange warten.
pub async fn run_durchlauf(pool: &SqlitePool) -> Result<(), AppError> {
    let jetzt = crate::zeit::jetzt();
    for k in repo::list_faellige_meldungen(pool, &jetzt).await? {
        melden_einmal(pool, &k).await?;
    }
    if let Some(grenze) = crate::zeit::plus_minuten(&jetzt, -ANGEBAHNT_MINUTEN) {
        repo::discard_angebahnte(pool, &grenze).await?;
    }
    Ok(())
}

/// Startet den Hintergrund-Task: alle fünf Sekunden ein [`durchlauf`]. Ohne Kopplung baut er nie
/// eine Verbindung auf.
pub fn start(pool: SqlitePool) {
    tokio::spawn(async move {
        let mut takt = tokio::time::interval(Duration::from_secs(5));
        takt.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            takt.tick().await;
            if let Err(e) = run_durchlauf(&pool).await {
                tracing::warn!(error = %e, "Instanzkopplung: Durchlauf gescheitert");
            }
        }
    });
}

// ── Erreichte Seite ──────────────────────────────────────────────────────────────────────────

/// Beantwortet eine Meldung (Handler `POST /api/instanz/melden`): hält fest, was das Gegenüber
/// über sich sagt, übernimmt dessen Widerrufe und liefert Widerrufe und Unterschriftsschlüssel
/// je Org.
pub async fn handle_meldung(
    pool: &SqlitePool,
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
    anfrage: &MeldenAnfrage,
    web_push: bool,
) -> Result<MeldenAntwort, AppError> {
    if kopplung.richtung() != Some(super::InstanzKopplungRichtung::WirdGemeldet) {
        return Err(AppError::Forbidden);
    }
    let (anfrage_orgs, anfrage_widerrufen) = dedupe_anfrage(anfrage)?;
    if anfrage.fuehrung.len() > fuehrung_austausch::AKTEN_MAX {
        return Err(AppError::Validation(format!(
            "Eine Meldung darf höchstens {} Führungsakten tragen.",
            fuehrung_austausch::AKTEN_MAX
        )));
    }
    let jetzt = crate::zeit::jetzt();
    let fuehrung_an = super::fuehrung::is_enabled(pool).await?;
    let mut vom_gegenueber = Vec::new();
    let mut fuehrung_folgen = Vec::new();
    let mut fuehrung_ausgang = fuehrung_austausch::Ausgang::default();
    let mut fuehrung_bis = 0;
    let orgs = crate::write_retry!(pool, |conn| {
        vom_gegenueber.clear();
        fuehrung_folgen.clear();
        repo::mark_gesehen(
            conn,
            kopplung.id,
            &anfrage.softwarestand,
            anfrage.protokoll,
            None,
            &jetzt,
        )
        .await?;
        if kopplung.art() == super::InstanzKopplungArt::VorOrt {
            repo::save_tls_zertifikat_gemeldet(
                conn,
                kopplung.id,
                anfrage.tls_zertifikat.as_deref().filter(|t| t.len() <= 128),
            )
            .await?;
        }
        let alle = repo::list_orgs(conn, kopplung.id).await?;
        let kennung = |o: &repo::OrgZeile| org_kennung(&identitaet.kennung, o.org_id);
        for w in anfrage_widerrufen.iter().copied() {
            if let Some(o) = alle
                .iter()
                .find(|o| o.widerrufen_at.is_none() && kennung(o) == w)
            {
                if let Some(einsaetze) =
                    repo::org_widerrufen(conn, o.id, None, &jetzt, true).await?
                {
                    vom_gegenueber.push(o.clone());
                    fuehrung_folgen.extend(
                        einsaetze
                            .into_iter()
                            .map(|einsatz_id| fuehrung_austausch::Folge::Kopf { einsatz_id }),
                    );
                }
            }
        }
        repo::save_gegenueber_empfang(
            conn,
            kopplung.id,
            anfrage.age_empfaenger.as_deref(),
            anfrage.datentraeger_verschluesselt,
        )
        .await?;
        let arten: std::collections::HashSet<StammdatenArt> = anfrage
            .stammdaten_arten
            .iter()
            .filter_map(|a| StammdatenArt::parse(a))
            .collect();
        // Die Stammdaten bekommen, was Unterschriftsschlüssel, Führung und Reserve übrig lassen
        // (D2, LLH-1672).
        let mut stammdaten_budget = liefern::Budget::neu(STAMMDATEN_BUDGET);
        let mut orgs = Vec::with_capacity(anfrage_orgs.len());
        let mut gemeldet = Vec::new();
        // Die Nachlieferung teilt sich eine Grenze über alle Orgs; was nicht passt, folgt mit der
        // nächsten Meldung, weil der Stand je Org nur bis zum Gelieferten wandert.
        let mut budget = unterschrift::LIEFERUNGEN_MAX;
        for mo in anfrage_orgs.iter().copied() {
            // Die jüngste Zuordnung mit dieser Kennung entscheidet.
            let zuordnung = alle.iter().rev().find(|o| kennung(o) == mo.org);
            let aktiv = zuordnung.filter(|o| {
                o.widerrufen_at.is_none() && !vom_gegenueber.iter().any(|v| v.id == o.id)
            });
            if let Some(o) = aktiv {
                repo::confirm_org(conn, o.id).await?;
            }
            match aktiv {
                Some(o) => {
                    let lieferung =
                        unterschrift::nachlieferung(conn, o.org_id, mo.unterschrift_stand, budget)
                            .await?;
                    budget -= lieferung.len();
                    let unterschrift_bytes: usize = lieferung
                        .iter()
                        .map(|l| serde_json::to_vec(l).map(|v| v.len()).unwrap_or(0))
                        .sum();
                    stammdaten_budget.bytes =
                        stammdaten_budget.bytes.saturating_sub(unterschrift_bytes);
                    // Stammdaten und Geheimnisse nur über eine Kopplung, die sie trägt (LLH-1497).
                    let nach = if mo.stammdaten_stand < 0
                        || !kopplung.art().traegt(super::Fluss::Stammdaten)
                    {
                        liefern::Nachlieferung::default()
                    } else {
                        liefern::nachlieferung(
                            conn,
                            o.org_id,
                            mo.stammdaten_stand,
                            &mut stammdaten_budget,
                            &arten,
                            &liefern::Empfaenger {
                                kopplung_org_id: o.id,
                                age: anfrage.age_empfaenger.as_deref(),
                                datentraeger_bestaetigt: anfrage.datentraeger_verschluesselt,
                            },
                        )
                        .await?
                    };
                    orgs.push(MeldenOrgAntwort {
                        org: mo.org.clone(),
                        widerrufen: false,
                        unterschrift: lieferung,
                        stammdaten: nach.zeilen,
                        stammdaten_bis: nach.bis.max(mo.stammdaten_stand),
                    });
                }
                None => {
                    if let Some(o) = zuordnung {
                        gemeldet.push(o.id);
                    }
                    orgs.push(MeldenOrgAntwort {
                        org: mo.org.clone(),
                        widerrufen: true,
                        unterschrift: Vec::new(),
                        stammdaten: Vec::new(),
                        stammdaten_bis: 0,
                    });
                }
            }
        }
        repo::mark_widerruf_gemeldet(conn, &gemeldet, &jetzt).await?;
        repo::update_zustand_nach_orgs(
            conn,
            kopplung.id,
            InstanzKopplungZustand::VomGegenueberWiderrufen,
        )
        .await?;
        if fuehrung_an {
            // Führung je Einsatz (LLH-1491, D3, D7): erst übernehmen (eine Anfrage wird dabei
            // erfüllt), dann die eigenen Akten über der Quittung der meldenden Seite. Davor ein
            // Rückschritt des eigenen Zählers (LLH-1708, D3), damit jeder Stand dieser Meldung
            // über der Quittung liegt.
            fuehrung_austausch::repair_stand(conn, kopplung, anfrage.fuehrung_bis).await?;
            fuehrung_repo::ensure_akten(conn).await?;
            // Verlorene Quittung (LLH-1708, D5): Liegt der eigene Empfangsstand unter dem, was die
            // meldende Seite als quittiert führt, wurde diese Seite zurückgespielt. Dann gilt die
            // alte Quittung, auch wenn diese Meldung schon eine neue Akte bringt; die meldende
            // Seite setzt ihren Sendestand darauf zurück und schickt die verlorenen Akten erneut.
            // Bis dahin bleibt der Empfangsstand stehen, damit auch eine Wiederholung nach einer
            // verlorenen Antwort den Rückschritt noch zeigt. Nur bei 0 nicht: Eine Quittung 0
            // setzt die meldende Seite nicht zurück, sie schickte sonst ewig dieselbe Seite.
            let empfangen_vorher = fuehrung_repo::load_kopplung_staende(conn, kopplung.id)
                .await?
                .1;
            let rueckschritt = empfangen_vorher < anfrage.fuehrung_gesendet_bis;
            let eingang = fuehrung_austausch::apply_eingang(
                conn,
                kopplung,
                &anfrage.fuehrung,
                kopplung.zuletzt_gesehen_at.as_deref(),
            )
            .await?;
            // Die Quittung der meldenden Seite gilt hier nur für diesen Aufruf (`ab` unten); jeder
            // Stand einer Akte kommt aus dem eigenen Zähler, eine Kappung darauf änderte nichts.
            fuehrung_repo::save_kopplung_staende(
                conn,
                kopplung.id,
                Some(anfrage.fuehrung_bis),
                if rueckschritt && empfangen_vorher > 0 {
                    None
                } else {
                    eingang.bis
                },
            )
            .await?;
            if let Some(h) = &eingang.hinweis {
                repo::set_hinweis(conn, kopplung.id, h).await?;
            }
            // Anhängen, nicht zuweisen (LLH-1855): Die Kopf-Folgen eines Widerrufs durch das
            // Gegenüber stehen schon in der Liste.
            fuehrung_folgen.extend(eingang.folgen);
            fuehrung_bis = if rueckschritt {
                empfangen_vorher
            } else {
                fuehrung_repo::load_kopplung_staende(conn, kopplung.id)
                    .await?
                    .1
            };
            fuehrung_ausgang = fuehrung_austausch::build_ausgang(
                conn,
                kopplung,
                anfrage.fuehrung_bis,
                fuehrung_austausch::ANTWORT_BYTES,
            )
            .await?;
        }
        Ok(orgs)
    })?;
    fuehrung_austausch::run_folgen(pool, kopplung, &fuehrung_folgen).await;
    for o in &vom_gegenueber {
        admin_audit::schreibe_ohne_akteur(
            pool,
            AdminAktion::InstanzKopplungVomGegenueberWiderrufen,
            o.org_id,
            &kopplung.gegenueber_name,
            Ziel::Instanz(&kopplung.gegenueber_name),
            Some(build_angaben_gegenstelle(kopplung, &o.fremde_org_name)),
            None,
        )
        .await;
    }
    Ok(MeldenAntwort {
        name: super::name().to_string(),
        softwarestand: super::softwarestand().to_string(),
        protokoll: PROTOKOLL,
        orgs,
        fuehrung: fuehrung_ausgang.akten,
        fuehrung_bis,
        fuehrung_mehr: fuehrung_ausgang.mehr,
        hinweise: true,
        web_push,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anfrage(orgs: &[&str], widerrufen: &[&str]) -> MeldenAnfrage {
        MeldenAnfrage {
            name: "ELW".into(),
            softwarestand: "1".into(),
            protokoll: PROTOKOLL,
            orgs: orgs
                .iter()
                .enumerate()
                .map(|(i, o)| MeldenOrg {
                    org: (*o).into(),
                    unterschrift_stand: i as i64,
                    stammdaten_stand: 0,
                })
                .collect(),
            widerrufen: widerrufen.iter().map(|w| (*w).into()).collect(),
            stammdaten_arten: Vec::new(),
            age_empfaenger: None,
            datentraeger_verschluesselt: false,
            fuehrung: Vec::new(),
            tls_zertifikat: None,
            fuehrung_bis: 0,
            fuehrung_gesendet_bis: 0,
        }
    }

    #[test]
    fn anfrage_ohne_sendestand_liest_sich_mit_null() {
        // Eine meldende Seite vor LLH-1708 schickt `fuehrung_gesendet_bis` nicht (D4).
        let mut v = serde_json::to_value(anfrage(&["h/1"], &[])).unwrap();
        v.as_object_mut().unwrap().remove("fuehrung_gesendet_bis");
        let a: MeldenAnfrage = serde_json::from_value(v).unwrap();
        assert_eq!(a.fuehrung_gesendet_bis, 0);
    }

    #[test]
    fn meldung_wird_entdoppelt_und_der_erste_eintrag_zaehlt() {
        let a = anfrage(&["h/1", "h/2", "h/1"], &["h/3", "h/3"]);
        let (orgs, widerrufen) = dedupe_anfrage(&a).unwrap();
        assert_eq!(
            orgs.iter()
                .map(|o| (o.org.as_str(), o.unterschrift_stand))
                .collect::<Vec<_>>(),
            [("h/1", 0), ("h/2", 1)]
        );
        assert_eq!(widerrufen, ["h/3"]);
    }

    #[test]
    fn meldung_ueber_der_grenze_wird_abgelehnt_auch_wenn_doppelt() {
        let viele = vec!["h/1"; ORGS_MAX + 1];
        assert!(matches!(
            dedupe_anfrage(&anfrage(&viele, &[])),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            dedupe_anfrage(&anfrage(&[], &viele)),
            Err(AppError::Validation(_))
        ));
        assert!(dedupe_anfrage(&anfrage(&vec!["h/1"; ORGS_MAX], &vec!["h/1"; ORGS_MAX])).is_ok());
    }

    fn antwort(orgs: usize, lieferungen: usize) -> MeldenAntwort {
        let lieferung: UnterschriftSchluesselLieferung =
            serde_json::from_value(serde_json::json!({
                "id": 1, "benutzer_name": "A", "credential_id": "c", "schluessel": "s",
                "alg": "ES256", "rp_id": "r", "origin": "o", "bezeichnung": "b",
                "zustand": "gueltig", "stand": 1
            }))
            .expect("Lieferung");
        MeldenAntwort {
            name: "Hub".into(),
            softwarestand: "1".into(),
            protokoll: PROTOKOLL,
            orgs: (0..orgs)
                .map(|i| MeldenOrgAntwort {
                    org: format!("h/{i}"),
                    widerrufen: false,
                    unterschrift: vec![lieferung.clone(); lieferungen],
                    stammdaten: Vec::new(),
                    stammdaten_bis: 0,
                })
                .collect(),
            fuehrung: Vec::new(),
            fuehrung_bis: 0,
            fuehrung_mehr: false,
            hinweise: true,
            web_push: false,
        }
    }

    #[test]
    fn antwort_eines_aelteren_hubs_nennt_keine_faehigkeiten() {
        let a: MeldenAntwort = serde_json::from_value(serde_json::json!({
            "name": "Hub", "softwarestand": "1", "protokoll": PROTOKOLL, "orgs": []
        }))
        .expect("ältere Antwort");
        assert!(!a.hinweise);
        assert!(!a.web_push);
    }

    #[test]
    fn antwort_ueber_der_grenze_oder_mit_doppelter_org_ist_ungueltig() {
        assert!(check_antwort(&antwort(1, unterschrift::LIEFERUNGEN_MAX)).is_ok());
        let mut doppelt = antwort(2, 0);
        doppelt.orgs[1].org = doppelt.orgs[0].org.clone();
        assert!(check_antwort(&doppelt).is_err(), "Org doppelt");
        assert!(check_antwort(&antwort(ORGS_MAX, 0)).is_ok());
        assert!(check_antwort(&antwort(ORGS_MAX + 1, 0)).is_err());
        assert!(check_antwort(&antwort(1, unterschrift::LIEFERUNGEN_MAX + 1)).is_err());
        assert!(
            check_antwort(&antwort(2, unterschrift::LIEFERUNGEN_MAX / 2 + 1)).is_err(),
            "die Grenze gilt für die ganze Antwort, nicht je Org"
        );
    }

    /// Die größte zulässige Antwort muss in [`ANTWORT_MAX`] passen, sonst bliebe Melden bei vielen
    /// Schlüsseln dauerhaft an einer unlesbaren Antwort hängen.
    #[test]
    fn groesste_antwort_passt_in_die_lesegrenze() {
        // Jedes Feld so groß, wie es beim Registrieren und Gegenzeichnen höchstens angenommen
        // wird; Namen und Bezeichnung mit Umlauten (zwei Byte je Zeichen).
        use crate::auth::unterschrift::pruefen::{
            AUTHENTICATOR_DATA_MAX, CLIENT_DATA_JSON_MAX, CREDENTIAL_ID_MAX, SIGNATUR_MAX,
        };
        let cid = "A".repeat(CREDENTIAL_ID_MAX);
        let name = "ü".repeat(unterschrift::NAME_MAX);
        let bezeichnung = "ü".repeat(crate::routes::instanz::BEZEICHNUNG_MAX);
        let erklaerung = serde_json::to_string(&serde_json::json!({
            "typ": "unterschriftsschluessel-aufnahme", "org": "k".repeat(88),
            "credential_id": cid, "schluessel_hash": "h".repeat(43),
            "fingerabdruck": "F".repeat(39), "inhaber": name,
            "zeitpunkt": "2026-11-08 12:00:00", "rp_id": "r".repeat(253),
            "origin": "o".repeat(261), "alg": "es256"
        }))
        .expect("Erklärung");
        let lieferung: UnterschriftSchluesselLieferung =
            serde_json::from_value(serde_json::json!({
                "id": i64::MAX, "benutzer_name": name, "credential_id": cid,
                "schluessel": "s".repeat(87), "alg": "es256", "rp_id": "r".repeat(253),
                "origin": "o".repeat(261), "bezeichnung": bezeichnung,
                "zustand": "widerrufen", "stand": i64::MAX,
                "gegenzeichnung": {
                    "erklaerung": erklaerung,
                    "assertion": {
                        "credential_id": cid,
                        "authenticator_data": "a".repeat(AUTHENTICATOR_DATA_MAX),
                        "client_data_json": "c".repeat(CLIENT_DATA_JSON_MAX),
                        "signatur": "s".repeat(SIGNATUR_MAX)
                    },
                    "unterzeichner_credential_id": cid
                }
            }))
            .expect("Lieferung");
        let mut a = antwort(ORGS_MAX, 0);
        for o in &mut a.orgs {
            o.org = "k".repeat(88);
        }
        a.fuehrung_bis = i64::MAX;
        a.fuehrung_mehr = true;
        // Hülle: alle Org-Einträge, ohne Schlüssel, Stammdaten und Akten.
        let huelle = serde_json::to_vec(&a).expect("JSON").len();
        a.orgs[0].unterschrift = vec![lieferung.clone(); unterschrift::LIEFERUNGEN_MAX];
        let unterschrift_bytes =
            serde_json::to_vec(&lieferung).expect("JSON").len() * unterschrift::LIEFERUNGEN_MAX;
        // Führungsakten (LLH-1672): `build_ausgang` packt höchstens `ANTWORT_BYTES`, je Akte
        // höchstens `AKTE_BYTES`.
        let akte = fuehrung_austausch::tests::akte_mit_bytes(fuehrung_austausch::AKTE_BYTES);
        let akte_bytes = serde_json::to_vec(&akte).expect("JSON").len();
        let akten =
            (fuehrung_austausch::ANTWORT_BYTES / akte_bytes).min(fuehrung_austausch::AKTEN_MAX);
        assert!(
            akten > 0,
            "die größte Akte des Ausgangs passt in eine Antwort"
        );
        a.fuehrung = vec![akte; akten];
        // Die Teile der Antwort: Schlüssel und Stammdaten zusammen höchstens `STAMMDATEN_BUDGET`
        // (die Stammdaten füllen nur auf, was die Schlüssel übrig lassen), die Führung höchstens
        // `ANTWORT_BYTES`, die Reserve trägt Hülle, Trennzeichen der Akten und eine einzelne
        // übergroße Stammdatenzeile (höchstens die halbe Reserve).
        assert!(
            unterschrift_bytes <= STAMMDATEN_BUDGET,
            "{unterschrift_bytes} Byte Schlüssel sprengen das Budget"
        );
        assert_eq!(
            STAMMDATEN_BUDGET + fuehrung_austausch::ANTWORT_BYTES + stammdaten::ANTWORT_RESERVE,
            ANTWORT_MAX,
            "die Führung geht vom Budget der Stammdaten ab"
        );
        assert!(
            huelle + fuehrung_austausch::AKTEN_MAX + stammdaten::ANTWORT_RESERVE / 2
                <= stammdaten::ANTWORT_RESERVE,
            "{huelle} Byte Hülle lassen keinen Platz für eine übergroße Stammdatenzeile"
        );
        // Gegenprobe am Stück: volle Schlüssel und Akten, der Rest des Budgets als Stammdaten.
        let groesse = serde_json::to_vec(&a).expect("JSON").len();
        let stammdaten_rest = STAMMDATEN_BUDGET - unterschrift_bytes;
        assert!(
            groesse + stammdaten_rest + stammdaten::ANTWORT_RESERVE / 2 < ANTWORT_MAX,
            "{groesse} Byte und {stammdaten_rest} Byte Stammdaten passen nicht in {ANTWORT_MAX}"
        );
    }

    #[test]
    fn abstand_verdoppelt_sich_bis_zur_obergrenze() {
        assert_eq!(next_abstand(60, 0), 60);
        assert_eq!(next_abstand(60, 1), 120);
        assert_eq!(next_abstand(60, 3), 480);
        assert_eq!(next_abstand(60, 4), 600);
        assert_eq!(next_abstand(60, 40), 600);
        assert_eq!(
            next_abstand(900, 2),
            900,
            "Grundabstand über der Grenze bleibt"
        );
    }

    #[test]
    fn adresse_wird_normalisiert() {
        assert_eq!(
            normalize_adresse(" https://Hub.Example.org/ ").unwrap(),
            "https://hub.example.org"
        );
        assert_eq!(
            normalize_adresse("https://hub.example.org:8443/lifeline/?x=1#y").unwrap(),
            "https://hub.example.org:8443/lifeline"
        );
        assert_eq!(
            normalize_adresse("http://127.0.0.1:3000").unwrap(),
            "http://127.0.0.1:3000"
        );
        assert!(normalize_adresse("http://hub.example.org").is_err());
        assert!(normalize_adresse("ftp://hub.example.org").is_err());
        assert!(normalize_adresse("https://nutzer:pw@hub.example.org").is_err());
        assert!(normalize_adresse("hub.example.org").is_err());
    }
}
