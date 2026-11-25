//! iOS-Push über das Relais (APNs): Anmeldungen, Verschlüsselung der Nutzlast, Relais-Client
//! und Versand (LLH-2040, Entwurf „Kanal im Server“).
//!
//! - Versand nur aus `benachrichtigung::ausliefern`, neben Web Push und mit denselben Filtern:
//!   Stilles nie, Konten, denen der Hub iOS-Push gibt, nie, eine auf dem Gerät stumme
//!   Hinweis-Art nie, ein Alarm immer ([`IosPush::versenden`]).
//! - Die Nutzlast trägt Titel, Detail und Pfad wie `GET /api/notifications/{id}`, Absender
//!   und Wortlaut nur mit Wahl und Leserecht ([`inhalt`]); verschlüsselt mit dem Schlüssel des
//!   Geräts ([`krypto`]), sodass Relais und Apple nichts davon lesen.
//! - Kein Token, kein Schlüssel und keine Nutzlast in einem Log.

pub mod inhalt;
pub mod krypto;
pub mod relais;
pub mod repo;

use self::relais::{
    RegistrierungAnfrage, RegistrierungAntwort, RelaisErgebnis, RelaisFehler, RelaisNachricht,
    SendenAnfrage, SendenAntwort, Stufe, Umgebung,
};
use self::repo::{Anmeldung, RelaisZugang};
use crate::auth::Benutzer;
use crate::benachrichtigung::BenachrichtigungEreignis;
use crate::log_drossel::Sammelzeile;
use reqwest::{StatusCode, Url};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// Höchstlänge des Umschlags (`nutzlast` an das Relais). Das Relais nimmt bis 4096 Zeichen; APNs
/// nimmt 4 KB für die ganze Nutzlast samt `aps` und Rückfalltitel, darum 3 KB für den Umschlag.
pub const UMSCHLAG_MAX: usize = 3 * 1024;
/// Höchstens so viele Nachrichten je `POST /v1/senden` (Limit des Relais).
const JE_AUFRUF: usize = 100;
/// Frist für Registrierung und Verbindungsaufbau beim Relais.
const RELAIS_FRIST: Duration = Duration::from_secs(10);
/// Frist für einen `POST /v1/senden`. Das Relais stellt die Nachrichten eines Aufrufs
/// nebenläufig zu und beendet ihn spätestens nach seiner Gesamtfrist (`GESAMTFRIST`, 20 s, in
/// `push-relais/src/senden.rs`); der Server wartet klar länger, damit er die Ergebnisse noch
/// liest und erloschene Anmeldungen löscht. Der Versand läuft in einem eigenen Task, niemand
/// wartet sonst darauf.
const RELAIS_SENDEN_FRIST: Duration = Duration::from_secs(30);
/// So lange gilt eine Sperre des Relais (`403`), ohne dass der Server es erneut fragt. Danach
/// versucht der nächste Versand es einmal mit dem gespeicherten Zugang: Hat der Betreiber den
/// Server entsperrt, fällt die Sperre; sonst gilt sie ab jetzt wieder so lange. Ein Tag hält den
/// Kontakt zu einem gesperrten Server selten, ohne dass ein entsperrter lange stumm bleibt.
pub const SPERRE_GILT_STUNDEN: i64 = 24;

/// Eine Benachrichtigung für einen Nutzer: an jedes seiner Geräte.
#[derive(Debug, Clone)]
pub struct IosSendung {
    pub benutzer_id: i64,
    /// Das Live-Ereignis der Benachrichtigung (nur Kennungen); den Text bildet der Versand.
    pub ereignis: BenachrichtigungEreignis,
    /// Alarm: zeitkritisch und auch bei stummer Art; sonst Hinweis.
    pub alarm: bool,
}

/// Kollaps-Kennung einer Benachrichtigung bei APNs: eine erneute Zustellung ersetzt die alte, ohne
/// dass Relais oder Apple eine Kennung sehen. Erste 32 Hex-Zeichen von
/// `sha256(server_id + ":" + benachrichtigung_id)`.
pub fn kollaps(server_id: &str, benachrichtigung_id: i64) -> String {
    let hash = Sha256::digest(format!("{server_id}:{benachrichtigung_id}").as_bytes());
    hash.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

/// Größtes Chiffrat (samt Tag), dessen Umschlag zur Kennung höchstens [`UMSCHLAG_MAX`] Zeichen
/// lang ist. Umschlag = base64url(`{"c":…,"k":…,"n":…}`), base64url ohne Auffüllung hat
/// `ceil(4n/3)` Zeichen.
fn chiffrat_max(kennung: &str) -> usize {
    let kennung_json = serde_json::to_string(kennung).map_or(usize::MAX / 2, |k| k.len());
    // `{"c":"` + C + `","k":` + K + `,"n":"` + 16 + `"}`
    let rest = 6 + 6 + kennung_json + 6 + 16 + 2;
    let json_max = UMSCHLAG_MAX * 3 / 4;
    json_max.saturating_sub(rest) * 3 / 4
}

/// Kürzt `k` passend ([`inhalt::kuerzen`]), verschlüsselt ihn mit dem Schlüssel des Geräts und
/// einer frischen Nonce und liefert den Umschlag für das Relais.
pub fn nutzlast_bauen(
    kennung: &str,
    schluessel: &[u8; 32],
    k: &mut inhalt::Klartext,
) -> Result<String, krypto::KryptoFehler> {
    inhalt::kuerzen(k, chiffrat_max(kennung));
    let klartext = serde_json::to_vec(k).map_err(|e| krypto::KryptoFehler(e.to_string()))?;
    let mut nonce = [0u8; 12];
    openssl::rand::rand_bytes(&mut nonce)?;
    let chiffrat = krypto::verschluesseln(schluessel, kennung, &klartext, nonce)?;
    let umschlag = krypto::umschlag(kennung, &nonce, &chiffrat);
    if umschlag.len() > UMSCHLAG_MAX {
        return Err(krypto::KryptoFehler("Nutzlast zu groß".into()));
    }
    Ok(umschlag)
}

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
            .timeout(RELAIS_FRIST)
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

    /// Versendet die Sendungen an alle Geräte ihrer Nutzer, in einem eigenen Task: der Aufrufer
    /// (`benachrichtigung::ausliefern` nach dem Commit) wartet nie auf das Relais.
    pub fn versenden(&self, sendungen: Vec<IosSendung>) -> tokio::task::JoinHandle<()> {
        let ios = self.clone();
        tokio::spawn(async move { ios.versenden_jetzt(sendungen).await })
    }

    /// Kern von [`Self::versenden`], im aufrufenden Task. Ohne passende Anmeldung kein Kontakt
    /// zum Relais. Je Anmeldung ein eigener Klartext und eine eigene Verschlüsselung, gebündelt je
    /// 100 an das Relais; ein Token, das das Relais als ungültig meldet, löscht die Anmeldung. Kein
    /// Wiederholen.
    pub async fn versenden_jetzt(&self, sendungen: Vec<IosSendung>) {
        if sendungen.is_empty() {
            return;
        }
        let pool = &self.inner.pool;
        let ids: Vec<i64> = sendungen.iter().map(|s| s.benutzer_id).collect();
        let anmeldungen = match repo::anmeldungen_von(pool, &ids).await {
            Ok(a) => a,
            Err(e) => return fehler_melden("Anmeldungen nicht lesbar", &e),
        };
        let auftraege: Vec<(Anmeldung, &IosSendung)> = anmeldungen
            .into_iter()
            .filter_map(|a| {
                let s = sendungen.iter().find(|s| s.benutzer_id == a.benutzer_id)?;
                soll_senden(&a, s).then_some((a, s))
            })
            .collect();
        if auftraege.is_empty() {
            return;
        }
        let zugang = match self.zugang().await {
            Ok(Some(z)) => z,
            // Gesperrt: das hat `senden` schon gemeldet, es geht nichts hinaus.
            Ok(None) => return,
            Err(e) => return fehler_melden("Relais nicht erreichbar", &e),
        };
        let benutzer = match personen(pool, &ids).await {
            Ok(b) => b,
            Err(e) => return fehler_melden("Empfänger nicht lesbar", &e),
        };
        // Je Nutzer und Wahl einmal gebildet; jedes Gerät bekommt seine eigene Verschlüsselung.
        let mut texte: HashMap<(i64, bool), Option<inhalt::Klartext>> = HashMap::new();
        let mut ziele: Vec<(i64, String)> = Vec::new();
        let mut nachrichten: Vec<RelaisNachricht> = Vec::new();
        for (a, s) in auftraege {
            let Some(person) = benutzer.get(&a.benutzer_id) else {
                continue;
            };
            let Some(umgebung) = umgebung(&a.umgebung) else {
                continue;
            };
            let Some(schluessel) =
                krypto::b64_lesen(&a.schluessel).and_then(|b| <[u8; 32]>::try_from(b).ok())
            else {
                continue;
            };
            let schluessel_text = (a.benutzer_id, a.inhalt);
            let text = match texte.get(&schluessel_text) {
                Some(t) => t.clone(),
                None => {
                    let t = match inhalt::klartext(pool, person, &s.ereignis, a.inhalt).await {
                        Ok(t) => Some(t),
                        Err(e) => {
                            fehler_melden("Text der Benachrichtigung nicht gebildet", &e);
                            None
                        }
                    };
                    texte.insert(schluessel_text, t.clone());
                    t
                }
            };
            let Some(mut k) = text else {
                continue;
            };
            let nutzlast = match nutzlast_bauen(&a.kennung, &schluessel, &mut k) {
                Ok(n) => n,
                Err(e) => {
                    fehler_melden("Nutzlast nicht verschlüsselt", &e);
                    continue;
                }
            };
            nachrichten.push(RelaisNachricht {
                token: a.token.clone(),
                umgebung,
                stufe: if s.alarm {
                    Stufe::Alarm
                } else {
                    Stufe::Hinweis
                },
                kollaps: Some(kollaps(&zugang.server_id, s.ereignis.benachrichtigung_id)),
                nutzlast,
                thema: None,
            });
            ziele.push((a.id, a.token));
        }
        for (teil, ziele) in nachrichten.chunks(JE_AUFRUF).zip(ziele.chunks(JE_AUFRUF)) {
            match self.senden(teil).await {
                Ok(ergebnisse) => {
                    for ((id, token), e) in ziele.iter().zip(ergebnisse) {
                        match e {
                            RelaisErgebnis::Zugestellt => {}
                            RelaisErgebnis::TokenUngueltig => {
                                if let Err(e) = repo::erloschen(pool, *id, token).await {
                                    fehler_melden("Erloschene Anmeldung nicht gelöscht", &e);
                                }
                            }
                            RelaisErgebnis::Gedrosselt | RelaisErgebnis::Fehler => {
                                fehler_melden("Relais stellt nicht zu", &format!("{e:?}"));
                            }
                        }
                    }
                }
                // Gesperrt oder gedrosselt: der Rest käme genauso wenig an.
                Err(e @ (RelaisFehler::Gesperrt | RelaisFehler::Gedrosselt)) => {
                    return fehler_melden("Relais nimmt nichts an", &e);
                }
                Err(e) => fehler_melden("Relais nicht erreichbar", &e),
            }
        }
    }

    fn url(&self, pfad: &str) -> Result<Url, RelaisFehler> {
        self.inner
            .relais
            .join(pfad)
            .map_err(|e| RelaisFehler::Antwort(e.to_string()))
    }

    /// Der gespeicherte Zugang; fehlt er, registriert sich der Server beim Relais
    /// (`POST /v1/server`) und speichert ihn. `None`, solange eine Sperre des Relais jünger als
    /// [`SPERRE_GILT_STUNDEN`] ist: dann kein Kontakt. Eine ältere Sperre liefert den Zugang
    /// (`gesperrt` gesetzt), damit [`Self::senden`] es einmal versucht.
    async fn zugang(&self) -> Result<Option<RelaisZugang>, RelaisFehler> {
        let _sperre = self.inner.registrierung.lock().await;
        let gespeichert = repo::relais_zugang(&self.inner.pool)
            .await
            .map_err(|e| RelaisFehler::Speicher(e.to_string()))?;
        match gespeichert {
            Some(z) if z.gesperrt && !z.sperre_abgelaufen => Ok(None),
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
            sperre_abgelaufen: false,
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
    /// - `403` (gesperrt): Sperre merken (oder erneuern), warnen, `Gesperrt`; keine Neuanmeldung
    ///   und [`SPERRE_GILT_STUNDEN`] lang kein Kontakt. Danach versucht der nächste Versand es
    ///   einmal mit dem gespeicherten Zugang; nimmt das Relais ihn an, fällt die Sperre.
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
                .timeout(RELAIS_SENDEN_FRIST)
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
                    if zugang.gesperrt {
                        // Zugestellt ist schon; die Ergebnisse gehen auch ohne Speicher zurück.
                        match repo::relais_sperre_aufheben(&self.inner.pool, &zugang.server_id)
                            .await
                        {
                            Ok(()) => {
                                tracing::info!("iOS-Push: das Relais nimmt diesen Server wieder an")
                            }
                            Err(e) => fehler_melden("Sperre nicht aufgehoben", &e),
                        }
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
                        "iOS-Push: das Relais hat diesen Server gesperrt; bis zum nächsten \
                         Versuch in {SPERRE_GILT_STUNDEN} Stunden wird nichts gesendet"
                    );
                    return Err(RelaisFehler::Gesperrt);
                }
                StatusCode::TOO_MANY_REQUESTS => return Err(RelaisFehler::Gedrosselt),
                s => return Err(RelaisFehler::Antwort(format!("Senden: {s}"))),
            }
        }
    }
}

/// Ob die Sendung an dieses Gerät geht: ein Alarm immer, ein Hinweis nur, wenn seine Art auf
/// dem Gerät nicht stumm ist (wie `web_push::soll_senden`).
pub fn soll_senden(a: &Anmeldung, s: &IosSendung) -> bool {
    s.alarm || !a.ist_stumm(s.ereignis.art)
}

fn umgebung(wert: &str) -> Option<Umgebung> {
    match wert {
        "sandbox" => Some(Umgebung::Sandbox),
        "production" => Some(Umgebung::Production),
        _ => None,
    }
}

/// Die aktiven Personenkonten unter `ids` (ohne Gerätekonten), wie die Empfängerauflösung sie
/// liest.
async fn personen(pool: &SqlitePool, ids: &[i64]) -> Result<HashMap<i64, Benutzer>, sqlx::Error> {
    let liste = serde_json::to_string(ids).expect("ID-Liste serialisierbar");
    let konten = sqlx::query_as::<_, Benutzer>(
        "SELECT b.id, b.org_id, b.anzeigename, b.benutzername, b.passwort_hash, \
                b.system_rolle, b.org_rolle, b.aktiv, b.erstellt_at \
         FROM benutzer b WHERE b.id IN (SELECT value FROM json_each(?)) AND b.aktiv = 1 \
           AND NOT EXISTS (SELECT 1 FROM geraet_kopplung g WHERE g.benutzer_id = b.id)",
    )
    .bind(liste)
    .fetch_all(pool)
    .await?;
    Ok(konten.into_iter().map(|b| (b.id, b)).collect())
}

/// Eine gedrosselte Warnzeile des Versands. Nie mit Token, Schlüssel oder Nutzlast: `fehler`
/// ist ein Fehler des Relais, der Datenbank oder der Verschlüsselung.
fn fehler_melden(was: &str, fehler: &dyn std::fmt::Display) {
    static FEHLER: Sammelzeile = Sammelzeile::neu();
    if let Some(f) = FEHLER.zaehlen() {
        tracing::warn!(
            fehler = %fehler,
            anzahl = f.anzahl,
            seit_s = f.seit_s,
            "iOS-Push: {was}, Sammelzeile"
        );
    }
}

#[cfg(test)]
mod tests;
