//! Melden (design.md D4, D9): die meldende Seite meldet sich in festen Abständen signiert beim
//! Gegenüber. Die Antwort trägt Widerrufe von Org-Zuordnungen und die Nachlieferung der
//! Unterschriftsschlüssel; eine Meldung trägt umgekehrt Widerrufe der meldenden Seite. Die
//! erreichte Seite baut nie selbst eine Verbindung auf.
//!
//! Das Schema hier ist über alle Protokollversionen nur additiv: Melden geht immer, auch wenn die
//! Versionen weiter auseinanderliegen (D5).

use super::extractor::MELDEN_PFAD;
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

/// Setzt den Abstand einmal beim Start (`--instanz-melden-sekunden`).
pub fn set_abstand(sekunden: u64) {
    let _ = ABSTAND_S.set(sekunden);
}

fn abstand_s() -> u64 {
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
}

impl std::fmt::Display for SendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SendError::Netz(t) => write!(f, "nicht erreichbar: {t}"),
            SendError::Abgelehnt(s, t) if t.is_empty() => write!(f, "abgelehnt ({s})"),
            SendError::Abgelehnt(s, t) => write!(f, "abgelehnt ({s}): {t}"),
            SendError::AntwortUngueltig(t) => write!(f, "Antwort ungültig: {t}"),
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
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
    pfad: &str,
    anfrage: &A,
) -> Result<VerifiedAntwort<T>, SendError> {
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
    let resp = client()
        .post(format!("{basis}{pfad}"))
        .header(reqwest::header::AUTHORIZATION, format!("{SCHEMA} {token}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| SendError::Netz(e.without_url().to_string()))?;
    let status = resp.status().as_u16();
    let antwort_token = resp
        .headers()
        .get(ANTWORT_KOPF)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let rumpf = crate::http_begrenzt::lies_begrenzt(resp, ANTWORT_MAX)
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
    Ok(VerifiedAntwort {
        wert,
        uhr_abweichung_s: claims.iat.saturating_sub(jetzt),
    })
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
            } else {
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
    };
    let jetzt = crate::zeit::jetzt();
    let ergebnis =
        send_signed::<_, MeldenAntwort>(&identitaet, kopplung, MELDEN_PFAD, &anfrage).await;
    let antwort = match ergebnis.and_then(|a| match check_antwort(&a.wert) {
        Ok(()) => Ok(a),
        Err(grund) => Err(SendError::AntwortUngueltig(grund)),
    }) {
        Ok(a) => a,
        Err(f) => {
            let abstand = next_abstand(abstand_s(), kopplung.fehlversuche as u32 + 1);
            let naechste = add_sekunden(&jetzt, abstand as i64).unwrap_or(jetzt);
            tracing::warn!(kopplung = kopplung.id, fehler = %f, "Meldung bei gekoppelter Instanz gescheitert");
            repo::save_meldeversuch(pool, kopplung.id, Some(&f.to_string()), &naechste).await?;
            return Ok(());
        }
    };
    let a = antwort.wert;
    let mut abgelehnt_alle = Vec::new();
    let mut vom_gegenueber_widerrufen = Vec::new();
    let mut stammdaten_geaendert: Vec<i64> = Vec::new();
    let mut sitzungen_beendet: Vec<String> = Vec::new();
    crate::write_retry!(pool, |conn| {
        abgelehnt_alle.clear();
        vom_gegenueber_widerrufen.clear();
        stammdaten_geaendert.clear();
        sitzungen_beendet.clear();
        repo::mark_gesehen(
            conn,
            kopplung.id,
            &a.softwarestand,
            a.protokoll,
            Some(antwort.uhr_abweichung_s),
            &jetzt,
        )
        .await?;
        let ids: Vec<i64> = offen.iter().map(|o| o.id).collect();
        repo::mark_widerruf_gemeldet(conn, &ids, &jetzt).await?;
        for oa in &a.orgs {
            let Some(o) = aktiv.iter().find(|o| o.fremde_org_kennung == oa.org) else {
                continue;
            };
            if oa.widerrufen {
                if repo::org_widerrufen(conn, o.id, None, &jetzt, true).await? {
                    vom_gegenueber_widerrufen.push(o.clone());
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
        repo::update_zustand_nach_orgs(
            conn,
            kopplung.id,
            InstanzKopplungZustand::VomGegenueberWiderrufen,
        )
        .await?;
        Ok(())
    })?;
    let naechste = add_sekunden(&jetzt, abstand_s() as i64).unwrap_or(jetzt.clone());
    repo::save_meldeversuch(pool, kopplung.id, None, &naechste).await?;
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
) -> Result<MeldenAntwort, AppError> {
    if kopplung.richtung() != Some(super::InstanzKopplungRichtung::WirdGemeldet) {
        return Err(AppError::Forbidden);
    }
    let (anfrage_orgs, anfrage_widerrufen) = dedupe_anfrage(anfrage)?;
    let jetzt = crate::zeit::jetzt();
    let mut vom_gegenueber = Vec::new();
    let orgs = crate::write_retry!(pool, |conn| {
        vom_gegenueber.clear();
        repo::mark_gesehen(
            conn,
            kopplung.id,
            &anfrage.softwarestand,
            anfrage.protokoll,
            None,
            &jetzt,
        )
        .await?;
        let alle = repo::list_orgs(conn, kopplung.id).await?;
        let kennung = |o: &repo::OrgZeile| org_kennung(&identitaet.kennung, o.org_id);
        for w in anfrage_widerrufen.iter().copied() {
            if let Some(o) = alle
                .iter()
                .find(|o| o.widerrufen_at.is_none() && kennung(o) == w)
            {
                if repo::org_widerrufen(conn, o.id, None, &jetzt, true).await? {
                    vom_gegenueber.push(o.clone());
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
        // Die Stammdaten bekommen, was Unterschriftsschlüssel und Reserve übrig lassen (D2).
        let mut stammdaten_budget = liefern::Budget::neu(ANTWORT_MAX - stammdaten::ANTWORT_RESERVE);
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
                    let nach = if mo.stammdaten_stand < 0 {
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
        Ok(orgs)
    })?;
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
        }
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
        }
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
        a.orgs[0].unterschrift = vec![lieferung; unterschrift::LIEFERUNGEN_MAX];
        // Stammdaten (LLH-1493, D2) füllen nur auf, was Unterschriftsschlüssel und Reserve übrig
        // lassen; die Reserve trägt Hülle und Org-Einträge (hier schon mitgezählt) und eine
        // einzelne übergroße Zeile (höchstens die halbe Reserve).
        let groesse = serde_json::to_vec(&a).expect("JSON").len();
        assert!(
            groesse + stammdaten::ANTWORT_RESERVE / 2 < ANTWORT_MAX,
            "{groesse} Byte lassen keinen Platz für eine übergroße Stammdatenzeile"
        );
        assert!(
            groesse < ANTWORT_MAX,
            "{groesse} Byte passen nicht in {ANTWORT_MAX}"
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
