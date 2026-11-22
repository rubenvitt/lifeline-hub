//! Client für die APNs-HTTP/2-Schnittstelle: Anbieter-Token (ES256) und Versand einer Nachricht.
use crate::config::RelaisConfig;
use anyhow::{Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use openssl::{
    ecdsa::EcdsaSig,
    hash::{hash, MessageDigest},
    pkey::{PKey, Private},
};
use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// Apple verlangt ein Anbieter-Token, das nicht älter als eine Stunde ist, und lehnt zu häufige
/// Erneuerung ab; 50 Minuten liegen dazwischen.
const TOKEN_GUELTIG_SEKUNDEN: i64 = 50 * 60;
/// Ablauf der Nachricht bei Apple: 12 Stunden.
const ABLAUF_SEKUNDEN: i64 = 12 * 3600;
/// Frist je Anfrage an Apple. Apple antwortet gewöhnlich in Millisekunden; wer länger hängt,
/// wird `Fehler`, statt den Aufruf aufzuhalten (`senden::GESAMTFRIST` begrenzt den ganzen).
pub const APNS_FRIST: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Umgebung {
    Sandbox,
    Production,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Stufe {
    Alarm,
    Hinweis,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nachricht {
    pub token: String,
    pub umgebung: Umgebung,
    pub stufe: Stufe,
    pub kollaps: Option<String>,
    pub nutzlast: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Ergebnis {
    Zugestellt,
    TokenUngueltig,
    Gedrosselt,
    Fehler,
}

pub struct ApnsClient {
    schluessel: PKey<Private>,
    key_id: String,
    team_id: String,
    bundle_id: String,
    basis_production: String,
    basis_sandbox: String,
    /// `https://`-Basen: Aushandlung per ALPN.
    http: reqwest::Client,
    /// `http://`-Basen (nur Tests): HTTP/2 ohne Aushandlung.
    http_h2c: reqwest::Client,
    /// Zwischengespeichertes Anbieter-Token mit seiner Ausstellungszeit.
    token: Mutex<Option<(i64, String)>>,
}

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn jetzt_sekunden() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl ApnsClient {
    pub fn neu(cfg: &RelaisConfig) -> Result<Self> {
        let pem = std::fs::read(&cfg.apns_schluessel)
            .with_context(|| format!("APNs-Schlüssel {:?} nicht lesbar", cfg.apns_schluessel))?;
        let schluessel = PKey::private_key_from_pem(&pem).context("APNs-Schlüssel ist kein PEM")?;
        let bauen = |h2c: bool| -> Result<reqwest::Client> {
            let b = reqwest::Client::builder()
                .timeout(APNS_FRIST)
                .connect_timeout(APNS_FRIST);
            Ok(if h2c { b.http2_prior_knowledge() } else { b }.build()?)
        };
        Ok(Self {
            schluessel,
            key_id: cfg.apns_key_id.clone(),
            team_id: cfg.apns_team_id.clone(),
            bundle_id: cfg.bundle_id.clone(),
            basis_production: cfg.apns_basis_production.trim_end_matches('/').to_string(),
            basis_sandbox: cfg.apns_basis_sandbox.trim_end_matches('/').to_string(),
            http: bauen(false)?,
            http_h2c: bauen(true)?,
            token: Mutex::new(None),
        })
    }

    /// ES256-JWT für APNs (`kid`, `iss` = Team, `iat`); Signatur roh `r || s` wie bei
    /// `vapid_kopf` im Hauptpaket. 50 Minuten im Speicher.
    pub fn anbieter_token(&self, jetzt: i64) -> String {
        let mut zwischen = self.token.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((ausgestellt, token)) = zwischen.as_ref() {
            if jetzt >= *ausgestellt && jetzt - ausgestellt < TOKEN_GUELTIG_SEKUNDEN {
                return token.clone();
            }
        }
        let token = self.token_signieren(jetzt);
        *zwischen = Some((jetzt, token.clone()));
        token
    }

    fn token_signieren(&self, jetzt: i64) -> String {
        let kopf = b64(serde_json::json!({ "alg": "ES256", "kid": self.key_id })
            .to_string()
            .as_bytes());
        let rumpf = b64(serde_json::json!({ "iss": self.team_id, "iat": jetzt })
            .to_string()
            .as_bytes());
        let eingabe = format!("{kopf}.{rumpf}");
        // Ein nicht signierbarer Schlüssel macht jeden Versand zum Fehler; APNs lehnt das leere
        // Token ab, der Aufrufer sieht `Ergebnis::Fehler`.
        let signatur = (|| -> Result<Vec<u8>, openssl::error::ErrorStack> {
            let digest = hash(MessageDigest::sha256(), eingabe.as_bytes())?;
            let sig = EcdsaSig::sign(&digest, self.schluessel.ec_key()?.as_ref())?;
            let mut roh = sig.r().to_vec_padded(32)?;
            roh.extend(sig.s().to_vec_padded(32)?);
            Ok(roh)
        })();
        match signatur {
            Ok(roh) => format!("{eingabe}.{}", b64(&roh)),
            Err(_) => {
                tracing::error!("Anbieter-Token konnte nicht signiert werden");
                String::new()
            }
        }
    }

    /// Eine Nachricht an Apple. Kein Wiederholen; Token und Nutzlast nie ins Log.
    pub async fn senden(&self, n: &Nachricht) -> Ergebnis {
        // Gerätetoken sind hexadezimal; alles andere gehört nicht in den Pfad.
        if n.token.is_empty() || !n.token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Ergebnis::TokenUngueltig;
        }
        let (basis, client) = match n.umgebung {
            Umgebung::Production => (&self.basis_production, &self.http),
            Umgebung::Sandbox => (&self.basis_sandbox, &self.http),
        };
        let client = if basis.starts_with("http://") {
            &self.http_h2c
        } else {
            client
        };
        let (titel, stufe) = match n.stufe {
            Stufe::Alarm => ("Alarm", "time-sensitive"),
            Stufe::Hinweis => ("Neue Benachrichtigung", "active"),
        };
        let rumpf = serde_json::json!({
            "aps": {
                "alert": { "title": titel },
                "sound": "default",
                "mutable-content": 1,
                "interruption-level": stufe,
            },
            "l": n.nutzlast,
        });
        let jetzt = jetzt_sekunden();
        let mut anfrage = client
            .post(format!("{basis}/3/device/{}", n.token))
            .header(
                "authorization",
                format!("bearer {}", self.anbieter_token(jetzt)),
            )
            .header("apns-topic", &self.bundle_id)
            .header("apns-push-type", "alert")
            .header("apns-priority", "10")
            .header("apns-expiration", (jetzt + ABLAUF_SEKUNDEN).to_string())
            .json(&rumpf);
        if let Some(kollaps) = n.kollaps.as_deref().filter(|k| !k.is_empty()) {
            anfrage = anfrage.header("apns-collapse-id", kollaps);
        }
        // Den reqwest-Fehler nicht ausgeben: sein Text enthält die URL und damit das Token.
        let antwort = match anfrage.send().await {
            Ok(a) => a,
            Err(_) => return Ergebnis::Fehler,
        };
        let status = antwort.status().as_u16();
        match status {
            200 => Ergebnis::Zugestellt,
            410 => Ergebnis::TokenUngueltig,
            429 => Ergebnis::Gedrosselt,
            400 => {
                let grund = antwort
                    .json::<serde_json::Value>()
                    .await
                    .ok()
                    .and_then(|v| v["reason"].as_str().map(str::to_owned));
                match grund.as_deref() {
                    Some("BadDeviceToken") | Some("Unregistered") => Ergebnis::TokenUngueltig,
                    _ => Ergebnis::Fehler,
                }
            }
            _ => Ergebnis::Fehler,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openssl::{bn::BigNum, ec::EcGroup, ec::EcKey, nid::Nid};

    fn client() -> ApnsClient {
        let ec =
            EcKey::generate(&EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).unwrap()).unwrap();
        ApnsClient {
            schluessel: PKey::from_ec_key(ec).unwrap(),
            key_id: "KEYID12345".into(),
            team_id: "TEAMID1234".into(),
            bundle_id: "b".into(),
            basis_production: String::new(),
            basis_sandbox: String::new(),
            http: reqwest::Client::new(),
            http_h2c: reqwest::Client::new(),
            token: Mutex::new(None),
        }
    }

    #[test]
    fn anbieter_token_ist_es256_roh_signiert_und_wird_50_minuten_wiederverwendet() {
        let c = client();
        let t = c.anbieter_token(1_000);
        let teile: Vec<&str> = t.split('.').collect();
        assert_eq!(teile.len(), 3);
        let d = |s: &str| URL_SAFE_NO_PAD.decode(s).unwrap();
        let kopf: serde_json::Value = serde_json::from_slice(&d(teile[0])).unwrap();
        assert_eq!(
            (kopf["alg"].as_str(), kopf["kid"].as_str()),
            (Some("ES256"), Some("KEYID12345"))
        );
        let rumpf: serde_json::Value = serde_json::from_slice(&d(teile[1])).unwrap();
        assert_eq!(
            (rumpf["iss"].as_str(), rumpf["iat"].as_i64()),
            (Some("TEAMID1234"), Some(1_000))
        );
        let roh = d(teile[2]);
        assert_eq!(roh.len(), 64);
        let sig = EcdsaSig::from_private_components(
            BigNum::from_slice(&roh[..32]).unwrap(),
            BigNum::from_slice(&roh[32..]).unwrap(),
        )
        .unwrap();
        let digest = hash(
            MessageDigest::sha256(),
            format!("{}.{}", teile[0], teile[1]).as_bytes(),
        )
        .unwrap();
        assert!(sig
            .verify(&digest, c.schluessel.ec_key().unwrap().as_ref())
            .unwrap());
        assert_eq!(c.anbieter_token(1_000 + 49 * 60), t);
        assert_ne!(c.anbieter_token(1_000 + 51 * 60), t);
    }
}
