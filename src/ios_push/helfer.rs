//! iOS-Push an die Helfer-App (Stufe 2, ADR-0105): je Anmeldung einer Helfer-Kopplung eine
//! verschlüsselte Nutzlast wie bei der Lifeline-App (ADR-0090), mit `thema` = Helfer-Bundle an das
//! Relais. Ein vom Relais als ungültig gemeldetes Token löscht die Anmeldung. Kein Wiederholen.

use super::relais::{RelaisErgebnis, RelaisNachricht, Stufe};
use super::{fehler_melden, krypto, IosPush, UMSCHLAG_MAX};
use crate::helfer::pager::{PagerKlartext, HELFER_BUNDLE_ID};
use crate::helfer::push::HelferPushAnmeldung;
use sha2::{Digest, Sha256};

/// Kollaps-Kennung eines Auftrags bei APNs: erste 32 Hex-Zeichen von
/// `sha256(server_id + ":auftrag:" + auftrag_id)`.
pub fn kollaps_auftrag(server_id: &str, auftrag_id: i64) -> String {
    let hash = Sha256::digest(format!("{server_id}:auftrag:{auftrag_id}").as_bytes());
    hash.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

/// Verschlüsselt `k` mit dem Schlüssel der Anmeldung (frische Nonce) zum Umschlag.
pub fn umschlag_bauen(
    a: &HelferPushAnmeldung,
    k: &PagerKlartext,
) -> Result<String, krypto::KryptoFehler> {
    let klartext = serde_json::to_vec(k).map_err(|e| krypto::KryptoFehler(e.to_string()))?;
    let mut nonce = [0u8; 12];
    openssl::rand::rand_bytes(&mut nonce)?;
    let chiffrat = krypto::verschluesseln(&a.schluessel, &a.kennung, &klartext, nonce)?;
    let umschlag = krypto::umschlag(&a.kennung, &nonce, &chiffrat);
    if umschlag.len() > UMSCHLAG_MAX {
        return Err(krypto::KryptoFehler("Nutzlast zu groß".into()));
    }
    Ok(umschlag)
}

impl IosPush {
    /// Schickt den Auftrag an die Anmeldungen, im Hintergrund.
    pub fn versenden_helfer(
        &self,
        auftrag_id: i64,
        sendungen: Vec<(HelferPushAnmeldung, PagerKlartext)>,
    ) -> tokio::task::JoinHandle<()> {
        let ios = self.clone();
        tokio::spawn(async move { ios.versenden_helfer_jetzt(auftrag_id, sendungen).await })
    }

    async fn versenden_helfer_jetzt(
        &self,
        auftrag_id: i64,
        sendungen: Vec<(HelferPushAnmeldung, PagerKlartext)>,
    ) {
        if sendungen.is_empty() {
            return;
        }
        let zugang = match self.zugang().await {
            Ok(Some(z)) => z,
            Ok(None) => return,
            Err(e) => return fehler_melden("Relais nicht erreichbar", &e),
        };
        let kollaps = kollaps_auftrag(&zugang.server_id, auftrag_id);
        let mut ziele: Vec<(i64, String)> = Vec::new();
        let mut nachrichten: Vec<RelaisNachricht> = Vec::new();
        for (a, k) in &sendungen {
            let nutzlast = match umschlag_bauen(a, k) {
                Ok(n) => n,
                Err(e) => {
                    fehler_melden("Nutzlast nicht verschlüsselt", &e);
                    continue;
                }
            };
            ziele.push((a.kopplung_id, a.token.clone()));
            nachrichten.push(RelaisNachricht {
                token: a.token.clone(),
                umgebung: a.umgebung,
                stufe: Stufe::Alarm,
                kollaps: Some(kollaps.clone()),
                nutzlast,
                thema: Some(HELFER_BUNDLE_ID.to_string()),
            });
        }
        for (teil_ziele, teil) in ziele
            .chunks(super::JE_AUFRUF)
            .zip(nachrichten.chunks(super::JE_AUFRUF))
        {
            match self.senden(teil).await {
                Ok(ergebnisse) => {
                    for ((kopplung_id, token), e) in teil_ziele.iter().zip(ergebnisse) {
                        if e == RelaisErgebnis::TokenUngueltig {
                            let geloescht = async {
                                let mut conn = self.inner.pool.acquire().await?;
                                crate::helfer::push::delete_registration_with_token(
                                    &mut conn,
                                    *kopplung_id,
                                    token,
                                )
                                .await
                            };
                            if let Err(e) = geloescht.await {
                                fehler_melden("Erloschene Helfer-Anmeldung nicht gelöscht", &e);
                            }
                        }
                    }
                }
                Err(e) => fehler_melden("Versand an Helfer-Apps fehlgeschlagen", &e),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn faelle() -> Value {
        let pfad = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src-tauri/faelle/helfer-auftrag.json"
        );
        serde_json::from_str(&std::fs::read_to_string(pfad).unwrap()).unwrap()
    }

    fn bytes(v: &Value) -> Vec<u8> {
        krypto::b64_lesen(v.as_str().unwrap()).unwrap()
    }

    #[test]
    fn pager_nutzlast_passt_zum_testvektor() {
        for f in faelle()["nutzlast"].as_array().unwrap() {
            let schluessel: [u8; 32] = bytes(&f["schluessel"]).try_into().unwrap();
            let nonce: [u8; 12] = bytes(&f["nonce"]).try_into().unwrap();
            let kennung = f["kennung"].as_str().unwrap();
            let klartext = f["klartext"].as_str().unwrap();
            let chiffrat =
                krypto::verschluesseln(&schluessel, kennung, klartext.as_bytes(), nonce).unwrap();
            assert_eq!(
                krypto::b64(&chiffrat),
                f["chiffrat"],
                "{}",
                f["beschreibung"]
            );
            assert_eq!(
                krypto::umschlag(kennung, &nonce, &chiffrat),
                f["umschlag"],
                "{}",
                f["beschreibung"]
            );
        }
    }

    #[test]
    fn pager_klartext_hat_die_form_des_testvektors() {
        let f = &faelle()["nutzlast"][0];
        let k = PagerKlartext {
            v: 1,
            s: "Lifeline".into(),
            art: "auftrag",
            e: 42,
            t: 7,
            titel: "San-Trupp 2".into(),
            text: "Verletzte Person, Zelt 3".into(),
        };
        assert_eq!(serde_json::to_string(&k).unwrap(), f["klartext"]);
    }

    #[test]
    fn umschlag_ist_mit_dem_schluessel_lesbar() {
        let a = HelferPushAnmeldung {
            kopplung_id: 1,
            kennung: "0b7e4e0a-3c1d-4f2a-9a55-1d2f6a7c8e90".into(),
            token: "ab".into(),
            umgebung: super::super::relais::Umgebung::Sandbox,
            schluessel: [9; 32],
        };
        let k = PagerKlartext {
            v: 1,
            s: "L".into(),
            art: "auftrag",
            e: 1,
            t: 2,
            titel: "T".into(),
            text: "x".repeat(crate::helfer::pager::TEXT_MAX_ZEICHEN),
        };
        let u = umschlag_bauen(&a, &k).unwrap();
        let (kennung, nonce, c) = krypto::umschlag_lesen(&u).unwrap();
        let klar = krypto::entschluesseln(&[9; 32], &kennung, &nonce, &c).unwrap();
        assert_eq!(klar, serde_json::to_vec(&k).unwrap());
    }
}
