//! iOS-Push an die Helfer-App (Stufe 2, ADR-0104): je Anmeldung einer Helfer-Kopplung eine
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
        let mut ziele: Vec<i64> = Vec::new();
        let mut nachrichten: Vec<RelaisNachricht> = Vec::new();
        for (a, k) in &sendungen {
            let nutzlast = match umschlag_bauen(a, k) {
                Ok(n) => n,
                Err(e) => {
                    fehler_melden("Nutzlast nicht verschlüsselt", &e);
                    continue;
                }
            };
            ziele.push(a.kopplung_id);
            nachrichten.push(RelaisNachricht {
                token: a.token.clone(),
                umgebung: a.umgebung,
                stufe: Stufe::Alarm,
                kollaps: Some(kollaps.clone()),
                nutzlast,
                thema: Some(HELFER_BUNDLE_ID.to_string()),
            });
        }
        for (teil_ziele, teil) in ziele.chunks(100).zip(nachrichten.chunks(100)) {
            match self.senden(teil).await {
                Ok(ergebnisse) => {
                    for (kopplung_id, e) in teil_ziele.iter().zip(ergebnisse) {
                        if e == RelaisErgebnis::TokenUngueltig {
                            let geloescht = async {
                                let mut conn = self.inner.pool.acquire().await?;
                                crate::helfer::push::delete_registration(&mut conn, *kopplung_id)
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
