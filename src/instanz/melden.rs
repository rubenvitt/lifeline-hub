//! Melden (design.md D4, D9): die meldende Seite meldet sich in festen Abständen signiert beim
//! Gegenüber. Die Antwort trägt Widerrufe von Org-Zuordnungen und die Nachlieferung der
//! Unterschriftsschlüssel; eine Meldung trägt umgekehrt Widerrufe der meldenden Seite. Die
//! erreichte Seite baut nie selbst eine Verbindung auf.
//!
//! Das Schema hier ist über alle Protokollversionen nur additiv: Melden geht immer, auch wenn die
//! Versionen weiter auseinanderliegen (D5).

use super::extractor::MELDEN_PFAD;
use super::identitaet::{self, oeffentlich_lesen, Identitaet};
use super::repo::{self, KopplungZeile};
use super::signatur::{self, AnfrageEntwurf, ANTWORT_KOPF, SCHEMA};
use super::{org_kennung, KopplungZustand, PROTOKOLL};
use crate::auth::admin_audit::{self, AdminAktion, Ziel, ZugangsAngaben};
use crate::auth::unterschrift::repo as unterschrift;
use crate::auth::unterschrift::SchluesselLieferung;
use crate::error::AppError;
use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::OnceLock;
use std::time::Duration;

/// Größte Antwort, die die meldende Seite liest.
pub const ANTWORT_MAX: usize = 256 * 1024;
/// Obergrenze des Abstands bei wiederholten Fehlern.
pub const ABSTAND_MAX_S: u64 = 600;
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
pub fn naechster_abstand(grund: u64, fehlversuche: u32) -> u64 {
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
}

/// Eine Org in der Antwort.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeldenOrgAntwort {
    pub org: String,
    pub widerrufen: bool,
    #[serde(default)]
    pub unterschrift: Vec<SchluesselLieferung>,
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
        reqwest::Client::builder()
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
pub fn adresse_normalisieren(eingabe: &str) -> Result<String, AppError> {
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
pub enum SendeFehler {
    /// Nicht erreichbar oder Zeitüberschreitung.
    Netz(String),
    /// Das Gegenüber hat mit diesem Status abgelehnt.
    Abgelehnt(u16, String),
    /// Die Antwort war nicht vom Gegenüber signiert oder passte nicht.
    AntwortUngueltig(String),
}

impl std::fmt::Display for SendeFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SendeFehler::Netz(t) => write!(f, "nicht erreichbar: {t}"),
            SendeFehler::Abgelehnt(s, t) if t.is_empty() => write!(f, "abgelehnt ({s})"),
            SendeFehler::Abgelehnt(s, t) => write!(f, "abgelehnt ({s}): {t}"),
            SendeFehler::AntwortUngueltig(t) => write!(f, "Antwort ungültig: {t}"),
        }
    }
}

/// Eine geprüfte Antwort des Gegenübers.
#[derive(Debug)]
pub struct GepruefteAntwort<T> {
    pub wert: T,
    /// Uhr des Gegenübers minus unsere, in Sekunden.
    pub uhr_abweichung_s: i64,
}

/// Schickt eine signierte Anfrage an das Gegenüber und prüft dessen signierte Antwort.
pub async fn signiert_senden<A: Serialize, T: DeserializeOwned>(
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
    pfad: &str,
    anfrage: &A,
) -> Result<GepruefteAntwort<T>, SendeFehler> {
    let basis = kopplung
        .gegenueber_adresse
        .as_deref()
        .ok_or_else(|| SendeFehler::Netz("keine Adresse".into()))?;
    let schluessel = oeffentlich_lesen(&kopplung.gegenueber_schluessel)
        .ok_or_else(|| SendeFehler::AntwortUngueltig("Schlüssel des Gegenübers unlesbar".into()))?;
    let body = serde_json::to_vec(anfrage).expect("Anfrage ist serialisierbar");
    let (token, jti) = signatur::anfrage_signieren(
        identitaet,
        &AnfrageEntwurf {
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
        .map_err(|e| SendeFehler::Netz(e.without_url().to_string()))?;
    let status = resp.status().as_u16();
    let antwort_token = resp
        .headers()
        .get(ANTWORT_KOPF)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let rumpf = crate::http_begrenzt::lies_begrenzt(resp, ANTWORT_MAX)
        .await
        .map_err(|e| SendeFehler::Netz(e.to_string()))?;
    let Some(antwort_token) = antwort_token else {
        let text = serde_json::from_slice::<serde_json::Value>(&rumpf)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or_default();
        return Err(if (200..300).contains(&status) {
            SendeFehler::AntwortUngueltig("ohne Signatur".into())
        } else {
            SendeFehler::Abgelehnt(status, text)
        });
    };
    let jetzt = Utc::now().timestamp();
    let claims = signatur::antwort_pruefen(
        &antwort_token,
        &schluessel,
        &kopplung.gegenueber_kennung,
        &identitaet.kennung,
        &jti,
        status,
        &rumpf,
        jetzt,
    )
    .map_err(|e| SendeFehler::AntwortUngueltig(e.to_string()))?;
    if !(200..300).contains(&status) {
        return Err(SendeFehler::Abgelehnt(status, String::new()));
    }
    let wert = serde_json::from_slice(&rumpf)
        .map_err(|e| SendeFehler::AntwortUngueltig(format!("Body unlesbar: {e}")))?;
    Ok(GepruefteAntwort {
        wert,
        uhr_abweichung_s: claims.iat - jetzt,
    })
}

// ── Meldende Seite ───────────────────────────────────────────────────────────────────────────

/// Meldet sich einmal bei einer Kopplung, in der diese Instanz sich meldet, und übernimmt die
/// Antwort. `widerrufen` sind Org-Zuordnungen, die hier gerade widerrufen wurden und deren
/// Widerruf mitgehen soll (sie sind schon nicht mehr aktiv). Fehler landen an der Kopplung, nicht
/// beim Aufrufer.
pub async fn melden_einmal(pool: &SqlitePool, kopplung: &KopplungZeile) -> Result<(), AppError> {
    let identitaet = identitaet::laden_oder_erzeugen(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let (aktiv, offen) = {
        let mut conn = pool.acquire().await?;
        (
            repo::orgs_aktiv(&mut conn, kopplung.id).await?,
            repo::orgs_widerruf_offen(&mut conn, kopplung.id).await?,
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
            })
            .collect(),
        widerrufen: offen.iter().map(|o| o.fremde_org_kennung.clone()).collect(),
    };
    let jetzt = crate::zeit::jetzt();
    let ergebnis =
        signiert_senden::<_, MeldenAntwort>(&identitaet, kopplung, MELDEN_PFAD, &anfrage).await;
    let antwort = match ergebnis {
        Ok(a) => a,
        Err(f) => {
            let abstand = naechster_abstand(abstand_s(), kopplung.fehlversuche as u32 + 1);
            let naechste = plus_sekunden(&jetzt, abstand as i64).unwrap_or(jetzt);
            tracing::warn!(kopplung = kopplung.id, fehler = %f, "Meldung bei gekoppelter Instanz gescheitert");
            repo::meldeversuch(pool, kopplung.id, Some(&f.to_string()), &naechste).await?;
            return Ok(());
        }
    };
    let a = antwort.wert;
    let mut abgelehnt_alle = Vec::new();
    let mut vom_gegenueber_widerrufen = Vec::new();
    crate::write_retry!(pool, |conn| {
        abgelehnt_alle.clear();
        vom_gegenueber_widerrufen.clear();
        repo::gesehen(
            conn,
            kopplung.id,
            &a.softwarestand,
            a.protokoll,
            Some(antwort.uhr_abweichung_s),
            &jetzt,
        )
        .await?;
        let ids: Vec<i64> = offen.iter().map(|o| o.id).collect();
        repo::widerruf_als_gemeldet(conn, &ids, &jetzt).await?;
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
            for ab in unterschrift::annehmen(conn, &ziel, &oa.unterschrift, false, &jetzt).await? {
                abgelehnt_alle.push((o.clone(), ab));
            }
        }
        if let Some((_, ab)) = abgelehnt_alle.last() {
            repo::hinweis_setzen(
                conn,
                kopplung.id,
                &format!(
                    "Unterschriftsschlüssel von {} ({}) abgelehnt: {}",
                    ab.benutzer_name, ab.fingerabdruck, ab.grund
                ),
            )
            .await?;
        }
        repo::zustand_nach_orgs(conn, kopplung.id, KopplungZustand::VomGegenueberWiderrufen)
            .await?;
        Ok(())
    })?;
    let naechste = plus_sekunden(&jetzt, abstand_s() as i64).unwrap_or(jetzt.clone());
    repo::meldeversuch(pool, kopplung.id, None, &naechste).await?;

    for o in &vom_gegenueber_widerrufen {
        admin_audit::schreibe_ohne_akteur(
            pool,
            AdminAktion::InstanzKopplungVomGegenueberWiderrufen,
            o.org_id,
            &kopplung.gegenueber_name,
            Ziel::Instanz(&kopplung.gegenueber_name),
            Some(angaben_gegenstelle(kopplung, &o.fremde_org_name)),
            None,
        )
        .await;
    }
    for (o, ab) in &abgelehnt_alle {
        let mut angaben = angaben_gegenstelle(kopplung, &o.fremde_org_name);
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
pub fn angaben_gegenstelle(kopplung: &KopplungZeile, fremde_org: &str) -> ZugangsAngaben {
    ZugangsAngaben {
        instanz_kennung: Some(kopplung.gegenueber_kennung.clone()),
        fingerabdruck: crate::instanz::basis32::b64_lesen(&kopplung.gegenueber_schluessel)
            .map(|b| crate::instanz::basis32::fingerabdruck(&b)),
        adresse: kopplung.gegenueber_adresse.clone(),
        fremde_org: Some(fremde_org.to_string()),
        ..ZugangsAngaben::default()
    }
}

fn plus_sekunden(zeit: &str, sekunden: i64) -> Option<String> {
    crate::zeit::parse(zeit)
        .map(|t| crate::zeit::formatiere(t + chrono::Duration::seconds(sekunden)))
}

/// Ein Durchlauf des Hintergrund-Tasks: alle fälligen Meldungen, dann angebahnte Kopplungen
/// verwerfen, die zu lange warten.
pub async fn durchlauf(pool: &SqlitePool) -> Result<(), AppError> {
    let jetzt = crate::zeit::jetzt();
    for k in repo::faellige_meldungen(pool, &jetzt).await? {
        melden_einmal(pool, &k).await?;
    }
    if let Some(grenze) = crate::zeit::plus_minuten(&jetzt, -ANGEBAHNT_MINUTEN) {
        repo::angebahnte_verwerfen(pool, &grenze).await?;
    }
    Ok(())
}

/// Startet den Hintergrund-Task: alle fünf Sekunden ein [`durchlauf`]. Ohne Kopplung baut er nie
/// eine Verbindung auf.
pub fn starte(pool: SqlitePool) {
    tokio::spawn(async move {
        let mut takt = tokio::time::interval(Duration::from_secs(5));
        takt.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            takt.tick().await;
            if let Err(e) = durchlauf(&pool).await {
                tracing::warn!(error = %e, "Instanzkopplung: Durchlauf gescheitert");
            }
        }
    });
}

// ── Erreichte Seite ──────────────────────────────────────────────────────────────────────────

/// Beantwortet eine Meldung (Handler `POST /api/instanz/melden`): hält fest, was das Gegenüber
/// über sich sagt, übernimmt dessen Widerrufe und liefert Widerrufe und Unterschriftsschlüssel
/// je Org.
pub async fn beantworten(
    pool: &SqlitePool,
    identitaet: &Identitaet,
    kopplung: &KopplungZeile,
    anfrage: &MeldenAnfrage,
) -> Result<MeldenAntwort, AppError> {
    if kopplung.richtung() != Some(super::KopplungRichtung::WirdGemeldet) {
        return Err(AppError::Forbidden);
    }
    let jetzt = crate::zeit::jetzt();
    let mut vom_gegenueber = Vec::new();
    let orgs = crate::write_retry!(pool, |conn| {
        vom_gegenueber.clear();
        repo::gesehen(
            conn,
            kopplung.id,
            &anfrage.softwarestand,
            anfrage.protokoll,
            None,
            &jetzt,
        )
        .await?;
        let alle = repo::orgs_alle(conn, kopplung.id).await?;
        let kennung = |o: &repo::OrgZeile| org_kennung(&identitaet.kennung, o.org_id);
        for w in &anfrage.widerrufen {
            if let Some(o) = alle
                .iter()
                .find(|o| o.widerrufen_at.is_none() && kennung(o) == *w)
            {
                if repo::org_widerrufen(conn, o.id, None, &jetzt, true).await? {
                    vom_gegenueber.push(o.clone());
                }
            }
        }
        let mut orgs = Vec::with_capacity(anfrage.orgs.len());
        let mut gemeldet = Vec::new();
        for mo in &anfrage.orgs {
            // Die jüngste Zuordnung mit dieser Kennung entscheidet.
            let zuordnung = alle.iter().rev().find(|o| kennung(o) == mo.org);
            let aktiv = zuordnung.filter(|o| {
                o.widerrufen_at.is_none() && !vom_gegenueber.iter().any(|v| v.id == o.id)
            });
            match aktiv {
                Some(o) => orgs.push(MeldenOrgAntwort {
                    org: mo.org.clone(),
                    widerrufen: false,
                    unterschrift: unterschrift::nachlieferung(
                        conn,
                        o.org_id,
                        mo.unterschrift_stand,
                    )
                    .await?,
                }),
                None => {
                    if let Some(o) = zuordnung {
                        gemeldet.push(o.id);
                    }
                    orgs.push(MeldenOrgAntwort {
                        org: mo.org.clone(),
                        widerrufen: true,
                        unterschrift: Vec::new(),
                    });
                }
            }
        }
        repo::widerruf_als_gemeldet(conn, &gemeldet, &jetzt).await?;
        repo::zustand_nach_orgs(conn, kopplung.id, KopplungZustand::VomGegenueberWiderrufen)
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
            Some(angaben_gegenstelle(kopplung, &o.fremde_org_name)),
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

    #[test]
    fn abstand_verdoppelt_sich_bis_zur_obergrenze() {
        assert_eq!(naechster_abstand(60, 0), 60);
        assert_eq!(naechster_abstand(60, 1), 120);
        assert_eq!(naechster_abstand(60, 3), 480);
        assert_eq!(naechster_abstand(60, 4), 600);
        assert_eq!(naechster_abstand(60, 40), 600);
        assert_eq!(
            naechster_abstand(900, 2),
            900,
            "Grundabstand über der Grenze bleibt"
        );
    }

    #[test]
    fn adresse_wird_normalisiert() {
        assert_eq!(
            adresse_normalisieren(" https://Hub.Example.org/ ").unwrap(),
            "https://hub.example.org"
        );
        assert_eq!(
            adresse_normalisieren("https://hub.example.org:8443/lifeline/?x=1#y").unwrap(),
            "https://hub.example.org:8443/lifeline"
        );
        assert_eq!(
            adresse_normalisieren("http://127.0.0.1:3000").unwrap(),
            "http://127.0.0.1:3000"
        );
        assert!(adresse_normalisieren("http://hub.example.org").is_err());
        assert!(adresse_normalisieren("ftp://hub.example.org").is_err());
        assert!(adresse_normalisieren("https://nutzer:pw@hub.example.org").is_err());
        assert!(adresse_normalisieren("hub.example.org").is_err());
    }
}
