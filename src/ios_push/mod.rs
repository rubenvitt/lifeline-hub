//! iOS-Push über das Relais (APNs): Anmeldungen, Verschlüsselung der Nutzlast, Relais-Client.
// Der Versand (`senden`, Wire-Typen) bekommt seinen Aufrufer erst mit dem Versand der
// Benachrichtigungen; bis dahin meldet der Compiler sie als ungenutzt.
#![allow(dead_code)]

pub mod krypto;
pub mod relais;
pub mod repo;

use self::relais::{
    RegistrierungAnfrage, RegistrierungAntwort, RelaisErgebnis, RelaisFehler, RelaisNachricht,
    SendenAnfrage, SendenAntwort,
};
use self::repo::RelaisZugang;
use reqwest::{StatusCode, Url};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;

/// iOS-Push über das Relais. Billig zu klonen. `einrichten` öffnet keine Verbindung: das
/// Relais hört erst beim ersten Versand von dieser Instanz.
#[derive(Clone)]
pub struct IosPush {
    inner: Arc<Inner>,
}

struct Inner {
    pool: SqlitePool,
    relais: Url,
    kontakt: Option<String>,
    client: reqwest::Client,
    /// Serialisiert Registrierung und Neuregistrierung, damit parallele Versände nicht je einen
    /// eigenen Zugang anlegen.
    registrierung: tokio::sync::Mutex<()>,
}

impl IosPush {
    /// Richtet den Client ein (nur `https`). `kontakt` ist der Betreiberkontakt für das Relais.
    pub fn einrichten(
        pool: SqlitePool,
        relais: Url,
        kontakt: Option<String>,
    ) -> anyhow::Result<Self> {
        Self::bauen(pool, relais, kontakt, true)
    }

    /// Wie [`Self::einrichten`], erlaubt aber `http` für ein lokales Relais-Doppel.
    pub fn einrichten_fuer_test(pool: SqlitePool, relais: Url) -> anyhow::Result<Self> {
        Self::bauen(pool, relais, None, false)
    }

    fn bauen(
        pool: SqlitePool,
        relais: Url,
        kontakt: Option<String>,
        nur_https: bool,
    ) -> anyhow::Result<Self> {
        if nur_https && relais.scheme() != "https" {
            anyhow::bail!("das Relais verlangt https");
        }
        let client = crate::ausgehend::client_builder(crate::ausgehend::Zweck::IosPush)
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .https_only(nur_https)
            .no_gzip()
            .build()?;
        Ok(Self {
            inner: Arc::new(Inner {
                pool,
                relais,
                kontakt,
                client,
                registrierung: tokio::sync::Mutex::new(()),
            }),
        })
    }

    fn url(&self, pfad: &str) -> Result<Url, RelaisFehler> {
        self.inner
            .relais
            .join(pfad)
            .map_err(|e| RelaisFehler::Antwort(e.to_string()))
    }

    /// Der gespeicherte Zugang; fehlt er, registriert sich der Server beim Relais
    /// (`POST /v1/server`) und speichert ihn. `None`, wenn das Relais den Server gesperrt hat:
    /// dann kein Kontakt mehr.
    async fn zugang(&self) -> Result<Option<RelaisZugang>, RelaisFehler> {
        let _sperre = self.inner.registrierung.lock().await;
        let gespeichert = repo::relais_zugang(&self.inner.pool)
            .await
            .map_err(|e| RelaisFehler::Speicher(e.to_string()))?;
        match gespeichert {
            Some(z) if z.gesperrt => Ok(None),
            Some(z) => Ok(Some(z)),
            None => self.registrieren().await.map(Some),
        }
    }

    /// Registriert den Server neu und speichert den Zugang. Der Aufrufer hält die Sperre.
    async fn registrieren(&self) -> Result<RelaisZugang, RelaisFehler> {
        let anfrage = RegistrierungAnfrage {
            kontakt: self.inner.kontakt.as_deref(),
            version: crate::instanz::softwarestand(),
        };
        let antwort = self
            .inner
            .client
            .post(self.url("/v1/server")?)
            .json(&anfrage)
            .send()
            .await
            .map_err(|e| RelaisFehler::Netz(e.without_url().to_string()))?;
        if !antwort.status().is_success() {
            return Err(RelaisFehler::Antwort(format!(
                "Registrierung: {}",
                antwort.status()
            )));
        }
        let a: RegistrierungAntwort = antwort
            .json()
            .await
            .map_err(|e| RelaisFehler::Antwort(e.without_url().to_string()))?;
        let zugang = RelaisZugang {
            server_id: a.server_id,
            geheimnis: a.geheimnis,
            gesperrt: false,
        };
        repo::relais_zugang_speichern(&self.inner.pool, &zugang)
            .await
            .map_err(|e| RelaisFehler::Speicher(e.to_string()))?;
        tracing::info!("iOS-Push: am Relais angemeldet");
        Ok(zugang)
    }

    /// Ersetzt einen vom Relais abgewiesenen Zugang durch einen neuen. Hat inzwischen ein
    /// anderer Versand ihn ersetzt, gilt dessen Zugang.
    async fn neu_registrieren(
        &self,
        abgewiesen: &RelaisZugang,
    ) -> Result<RelaisZugang, RelaisFehler> {
        let _sperre = self.inner.registrierung.lock().await;
        let aktuell = repo::relais_zugang(&self.inner.pool)
            .await
            .map_err(|e| RelaisFehler::Speicher(e.to_string()))?;
        if let Some(z) = aktuell {
            if z.server_id != abgewiesen.server_id {
                return Ok(z);
            }
        }
        repo::relais_zugang_loeschen(&self.inner.pool)
            .await
            .map_err(|e| RelaisFehler::Speicher(e.to_string()))?;
        self.registrieren().await
    }

    /// Schickt `nachrichten` an das Relais (`POST /v1/senden`, höchstens 100 je Aufruf, Aufgabe
    /// des Aufrufers). Ergebnis: je Nachricht ein [`RelaisErgebnis`], in Eingabe-Reihenfolge.
    ///
    /// - Ohne Zugang meldet sich der Server zuerst an (einmalig, dann gespeichert).
    /// - `401` (Zugang dem Relais unbekannt): Zugang verwerfen, einmal neu anmelden und
    ///   wiederholen; weist das Relais auch den neuen ab, `Abgewiesen`.
    /// - `403` (gesperrt): Sperre merken, warnen, `Gesperrt`; weder Neuanmeldung noch weiterer
    ///   Kontakt, bis ein neuer Zugang gespeichert wird.
    /// - `429`: `Gedrosselt`, nichts wird wiederholt.
    ///
    /// Der Aufrufer wartet nie darauf, dass dies gelingt (`tokio::spawn`); Token und Nutzlast
    /// stehen in keinem Log.
    pub(crate) async fn senden(
        &self,
        nachrichten: &[RelaisNachricht],
    ) -> Result<Vec<RelaisErgebnis>, RelaisFehler> {
        let Some(mut zugang) = self.zugang().await? else {
            return Err(RelaisFehler::Gesperrt);
        };
        let mut neu_versucht = false;
        loop {
            let antwort = self
                .inner
                .client
                .post(self.url("/v1/senden")?)
                .bearer_auth(format!("{}.{}", zugang.server_id, zugang.geheimnis))
                .json(&SendenAnfrage { nachrichten })
                .send()
                .await
                .map_err(|e| RelaisFehler::Netz(e.without_url().to_string()))?;
            match antwort.status() {
                s if s.is_success() => {
                    let a: SendenAntwort = antwort
                        .json()
                        .await
                        .map_err(|e| RelaisFehler::Antwort(e.without_url().to_string()))?;
                    if a.ergebnisse.len() != nachrichten.len() {
                        return Err(RelaisFehler::Antwort("falsche Anzahl Ergebnisse".into()));
                    }
                    return Ok(a.ergebnisse);
                }
                StatusCode::UNAUTHORIZED if !neu_versucht => {
                    neu_versucht = true;
                    zugang = self.neu_registrieren(&zugang).await?;
                }
                StatusCode::UNAUTHORIZED => return Err(RelaisFehler::Abgewiesen),
                StatusCode::FORBIDDEN => {
                    repo::relais_gesperrt_setzen(&self.inner.pool)
                        .await
                        .map_err(|e| RelaisFehler::Speicher(e.to_string()))?;
                    tracing::warn!(
                        "iOS-Push: das Relais hat diesen Server gesperrt; es wird nichts mehr \
                         gesendet"
                    );
                    return Err(RelaisFehler::Gesperrt);
                }
                StatusCode::TOO_MANY_REQUESTS => return Err(RelaisFehler::Gedrosselt),
                s => return Err(RelaisFehler::Antwort(format!("Senden: {s}"))),
            }
        }
    }
}

#[cfg(test)]
mod tests;
