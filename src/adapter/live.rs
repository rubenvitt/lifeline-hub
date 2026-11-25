//! Live-Abruf einer Art außerhalb des Hintergrundlaufs (LLH-2107, ADR-0098, Nachtrag zu
//! ADR-0077): Routen, die zur Anfragezeit Daten aus dem Fremdsystem brauchen (Videosegmente,
//! Fotovorschauen), rufen es mit dem Zugang des Adapters ab.
//!
//! [`live_kontext`] liest die Zeile und entschlüsselt die Geheimnisse für genau einen Abruf; der
//! [`LiveKontext`] lebt nur so lange, nichts davon wird zwischengespeichert. Er geht über denselben
//! Weg wie der Lauf: [`AbrufKontext`] mit Zielschutz, Client ohne Weiterleitung und gedeckelten
//! Antworten. Verweigert wird bei unbekanntem Adapter, bei unbekannter oder nicht erwarteter Art
//! (die Route nennt die Art, deren Abruf sie baut), bei einem angehaltenen Adapter, bei einem,
//! der einen Menschen braucht, bei gesperrtem Geheimnisspeicher und bei einer Org, die sich bei
//! einem Hub meldet (G5).

use std::collections::HashMap;

use age::secrecy::SecretString;
use serde_json::{Map, Value};
use sqlx::SqlitePool;

use super::art::{Fehlschlag, Verzeichnis};
use super::repo;
use super::ziel::AbrufKontext;
use super::zustand::braucht_eingriff;
use super::{lauf, Rahmen};

/// Warum kein Live-Abruf stattfindet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiveVerweigert {
    /// Kein Adapter dieser Kennung oder seine Art kennt dieser Server nicht.
    Unbekannt,
    /// Von einem Admin angehalten.
    Angehalten,
    /// Angehalten oder gestört wegen eines Fehlers, den nur ein Mensch behebt (auch ein
    /// Geheimnis, das fehlt oder sich nicht entschlüsseln lässt, oder eine ungültige Einstellung).
    BrauchtEingriff,
    /// Der Server hat keinen Schlüssel für Geheimnisse.
    SpeicherGesperrt,
    /// Die Org meldet sich bei einem Hub; hier läuft kein Adapter.
    AmHub,
    /// Fehler im Server (Datenbank, Entschlüsselung); steht im Log.
    Intern,
}

/// Was ein einzelner Live-Abruf sieht. Besitzt Einstellungen und entschlüsselte Geheimnisse und
/// gibt sie mit dem Wert frei; hat kein `Clone` und kein `Debug`.
pub struct LiveKontext {
    adapter_id: String,
    org_id: i64,
    lan_erlaubt: bool,
    http_im_lan: bool,
    einstellungen: Map<String, Value>,
    geheimnisse: HashMap<String, SecretString>,
}

impl LiveKontext {
    fn kontext(&self) -> AbrufKontext<'_> {
        AbrufKontext::new(
            &self.adapter_id,
            self.org_id,
            &self.einstellungen,
            &self.geheimnisse,
            self.lan_erlaubt,
            false,
        )
        .with_http_im_lan(self.http_im_lan)
    }

    /// Ob der Adapter Ziele im LAN erreichen darf.
    pub fn lan_erlaubt(&self) -> bool {
        self.lan_erlaubt
    }

    pub fn adapter_id(&self) -> &str {
        &self.adapter_id
    }

    /// Eine GET-Anfrage, nachdem die URL den Zielschutz bestanden hat.
    pub fn get(&self, url: &str) -> Result<reqwest::RequestBuilder, Fehlschlag> {
        self.kontext().get(url)
    }

    /// Sendet und ordnet ein (Netzfehler, 3xx, 401/403, andere Status außerhalb von 2xx).
    pub async fn send(
        &self,
        anfrage: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, Fehlschlag> {
        self.kontext().send(anfrage).await
    }

    /// Ein Geheimnis der Art, entschlüsselt. Nicht loggen, nicht in Fehler schreiben.
    pub fn geheimnis(&self, name: &str) -> Option<&SecretString> {
        self.geheimnisse.get(name)
    }

    /// Ein Textfeld der Einstellungen.
    pub fn einstellung_text(&self, name: &str) -> Option<&str> {
        self.einstellungen.get(name).and_then(Value::as_str)
    }

    /// Liest den Rumpf mit Deckel.
    pub async fn read_bytes(
        &self,
        antwort: reqwest::Response,
        deckel: usize,
    ) -> Result<axum::body::Bytes, Fehlschlag> {
        self.kontext().read_bytes(antwort, deckel).await
    }

    /// Liest JSON mit Deckel.
    pub async fn read_json<T: serde::de::DeserializeOwned>(
        &self,
        antwort: reqwest::Response,
        deckel: usize,
    ) -> Result<T, Fehlschlag> {
        self.kontext().read_json(antwort, deckel).await
    }
}

/// Bereitet einen Live-Abruf für den Adapter `adapter_id` der Org `org_id` (der Anfrage) vor; die
/// Route nennt die Art, deren Abruf sie baut (`art`). Ein Adapter einer anderen Org oder einer
/// anderen Art ist [`LiveVerweigert::Unbekannt`], nicht von einem fehlenden zu unterscheiden.
pub async fn live_kontext(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    verzeichnis: &Verzeichnis,
    org_id: i64,
    adapter_id: &str,
    art: &str,
) -> Result<LiveKontext, LiveVerweigert> {
    let intern = |e: &dyn std::fmt::Display| {
        tracing::error!("Live-Abruf nicht vorbereitet: {e}");
        LiveVerweigert::Intern
    };
    let a = {
        let mut conn = pool.acquire().await.map_err(|e| intern(&e))?;
        repo::load_in_org(&mut conn, org_id, adapter_id)
            .await
            .map_err(|e| intern(&e))?
    }
    .filter(|a| a.art == art)
    .ok_or(LiveVerweigert::Unbekannt)?;
    let art = verzeichnis.find(&a.art).ok_or(LiveVerweigert::Unbekannt)?;
    if lauf::is_org_am_hub(pool, a.org_id)
        .await
        .map_err(|e| intern(&e))?
    {
        return Err(LiveVerweigert::AmHub);
    }
    if a.is_angehalten() {
        return Err(if a.angehalten_grund().is_some_and(braucht_eingriff) {
            LiveVerweigert::BrauchtEingriff
        } else {
            LiveVerweigert::Angehalten
        });
    }
    // Ein laufender Fehler, den nur ein Mensch behebt; ein früherer (ohne `fehler_seit`) zählt
    // nicht mehr.
    if a.fehler_seit.is_some() && a.letzter_fehler().is_some_and(braucht_eingriff) {
        return Err(LiveVerweigert::BrauchtEingriff);
    }
    if !rahmen.speicher.has_schluessel() {
        return Err(LiveVerweigert::SpeicherGesperrt);
    }
    match lauf::prepare(pool, rahmen, &**art, &a)
        .await
        .map_err(|e| intern(&e))?
    {
        Ok(v) => Ok(LiveKontext {
            adapter_id: a.id,
            org_id: a.org_id,
            lan_erlaubt: a.lan_erlaubt,
            http_im_lan: art.http_im_lan(),
            einstellungen: v.einstellungen,
            geheimnisse: v.geheimnisse,
        }),
        Err(_) => Err(LiveVerweigert::BrauchtEingriff),
    }
}
