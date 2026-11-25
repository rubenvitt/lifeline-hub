//! Abruf der URL-Ebene (LLH-2100), Entwurf
//! `docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md`, Abschnitte „URL-Ebene (C)“
//! und „Festlegungen nach dem Builder-Check“.
//!
//! - Der Weg nach draußen ist ein [`FremdebeneAbrufer`] im `AppState`, nach dem Muster des
//!   `Zusteller` der Webhooks. Produktiv ist das [`HttpAbrufer`] über
//!   `adapter::ziel::fetch_bedingt`; Tests setzen einen eigenen ein, weil Loopback für den echten
//!   Weg immer gesperrt ist.
//! - Zielschutz und LAN-Entscheidung rechnet [`holen`] vor jedem Abruf selbst
//!   (`check_url` mit `is_fremdebenen_lan_erlaubt`); der Abrufer prüft sie noch einmal.
//! - Nachgeholt wird beim Lesen ([`refresh_if_due`]): nur die führende Seite, nur am aktiven
//!   Einsatz, frühestens 60 s nach dem letzten Versuch, je Ebene ein Abruf zugleich.
//! - Die URL geht nie in Log, Fehlertext oder Admin-Spur: `tracing` trägt `ebene_id` und Code.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures::future::BoxFuture;

use super::einlesen::{self, Normiert};
use super::repo::{self, AbrufStand};
use super::{FremdebeneFehler, FremdebeneQuelle, DATEI_MAX};
use crate::adapter::ziel::{fetch_bedingt, fremdebene_fehler_aus_ziel, BedingteAntwort};
use crate::app::AppState;
use crate::einsatz::Einsatz;
use crate::error::AppError;
use crate::live::LiveEvent;
use crate::public_api::webhook::ziel::check_url;

/// So lange gilt ein Abrufversuch als frisch; erst danach holt ein Leser nach.
pub const FRISCH_SEKUNDEN: i64 = 60;

/// Ein Abruf, wie der Abrufer ihn bekommt. Die URL nicht loggen: sie kann ein Token tragen.
#[derive(Clone, PartialEq, Eq)]
pub struct Abruf {
    pub url: String,
    /// Die LAN-Ausnahme der Org (`org::einstellungen::is_fremdebenen_lan_erlaubt`), je Abruf
    /// gelesen.
    pub lan_erlaubt: bool,
    /// Validatoren der letzten Antwort (`If-None-Match`, `If-Modified-Since`).
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

/// Ohne URL: eine Debug-Ausgabe darf sie nicht in ein Log tragen.
impl std::fmt::Debug for Abruf {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Abruf")
            .field("lan_erlaubt", &self.lan_erlaubt)
            .field("etag", &self.etag)
            .field("last_modified", &self.last_modified)
            .finish_non_exhaustive()
    }
}

/// Holt eine URL-Ebene bedingt. Der `AppState` hält ihn, damit Tests ohne Netz abrufen können.
pub trait FremdebeneAbrufer: Send + Sync + 'static {
    fn abrufen(&self, abruf: Abruf) -> BoxFuture<'_, Result<BedingteAntwort, FremdebeneFehler>>;
}

/// Der echte Weg über HTTPS (`adapter::ziel`, gedeckelt auf [`DATEI_MAX`]).
#[derive(Debug, Clone, Copy, Default)]
pub struct HttpAbrufer;

impl FremdebeneAbrufer for HttpAbrufer {
    fn abrufen(&self, abruf: Abruf) -> BoxFuture<'_, Result<BedingteAntwort, FremdebeneFehler>> {
        Box::pin(async move {
            fetch_bedingt(
                &abruf.url,
                abruf.lan_erlaubt,
                DATEI_MAX,
                abruf.etag.as_deref(),
                abruf.last_modified.as_deref(),
            )
            .await
        })
    }
}

type Sperren = Arc<Mutex<HashMap<i64, Arc<tokio::sync::Mutex<()>>>>>;

/// Abrufer samt Single-Flight je Ebene. Vorgabe: [`HttpAbrufer`].
#[derive(Clone)]
pub struct Abrufer {
    weg: Arc<dyn FremdebeneAbrufer>,
    sperren: Sperren,
}

impl Default for Abrufer {
    fn default() -> Self {
        Abrufer::mit(Arc::new(HttpAbrufer))
    }
}

impl Abrufer {
    /// Mit eigenem Weg nach draußen (Tests).
    pub fn mit(weg: Arc<dyn FremdebeneAbrufer>) -> Self {
        Abrufer {
            weg,
            sperren: Default::default(),
        }
    }

    fn sperre(&self, ebene_id: i64) -> Arc<tokio::sync::Mutex<()>> {
        self.sperren
            .lock()
            .expect("Sperren der Fremdebenen")
            .entry(ebene_id)
            .or_default()
            .clone()
    }

    /// Räumt die Sperre ab, wenn niemand sonst sie hält oder wartet (nur die Tabelle und `sperre`).
    fn freigeben(&self, ebene_id: i64, sperre: Arc<tokio::sync::Mutex<()>>) {
        let mut sperren = self.sperren.lock().expect("Sperren der Fremdebenen");
        if Arc::strong_count(&sperre) == 2 {
            sperren.remove(&ebene_id);
        }
    }
}

/// Ob ein Versuch von `versucht_at` (kanonisches Format, UTC) zu `jetzt` länger als
/// [`FRISCH_SEKUNDEN`] zurückliegt. Ohne lesbaren Versuch: fällig.
pub fn is_faellig(versucht_at: Option<&str>, jetzt: chrono::NaiveDateTime) -> bool {
    match versucht_at.and_then(crate::zeit::parse) {
        Some(t) => (jetzt - t).num_seconds() > FRISCH_SEKUNDEN,
        None => true,
    }
}

/// Ob hier nachgeholt werden darf: nur die führende Seite eines aktiven Einsatzes. Am Spiegel
/// bleibt der gespiegelte Stand, am abgeschlossenen der letzte (Teil der Akte).
pub fn is_hier_abzurufen(einsatz: &Einsatz) -> bool {
    einsatz.ist_aktiv() && !einsatz.spiegel.spiegel_ist && !einsatz.fuehrung.fuehrung_fremd
}

/// Ergebnis von [`holen`].
pub enum Geholt {
    /// 200: neuer, eingelesener Inhalt samt Validatoren.
    Neu {
        normiert: Normiert,
        etag: Option<String>,
        last_modified: Option<String>,
    },
    /// 304: unverändert; die Validatoren der Antwort, falls sie welche nennt.
    Unveraendert {
        etag: Option<String>,
        last_modified: Option<String>,
    },
}

/// Prüft das Ziel, liest die LAN-Ausnahme der Org und ruft ab; 200 wird eingelesen. Fehler
/// tragen nur den Code.
pub async fn holen(
    state: &AppState,
    org_id: i64,
    url: &str,
    etag: Option<&str>,
    last_modified: Option<&str>,
) -> Result<Result<Geholt, FremdebeneFehler>, AppError> {
    let lan_erlaubt =
        crate::org::einstellungen::is_fremdebenen_lan_erlaubt(&state.pool, org_id).await?;
    if let Err(f) = check_url(url, lan_erlaubt) {
        return Ok(Err(fremdebene_fehler_aus_ziel(f)));
    }
    let antwort = state
        .fremdebene_abrufer
        .weg
        .abrufen(Abruf {
            url: url.to_string(),
            lan_erlaubt,
            etag: etag.map(str::to_string),
            last_modified: last_modified.map(str::to_string),
        })
        .await;
    Ok(match antwort {
        Err(f) => Err(f),
        Ok(a) if a.status == 304 => Ok(Geholt::Unveraendert {
            etag: a.etag,
            last_modified: a.last_modified,
        }),
        Ok(a) => match a.body {
            None => Err(FremdebeneFehler::Status),
            Some(body) if body.len() > DATEI_MAX => Err(FremdebeneFehler::ZuGross),
            Some(body) => einlesen::read_datei(&body).map(|normiert| Geholt::Neu {
                normiert,
                etag: a.etag,
                last_modified: a.last_modified,
            }),
        },
    })
}

/// Holt eine URL-Ebene beim Lesen nach, wenn sie fällig ist (siehe Modulkopf). Ein Abruffehler
/// ist kein Fehler der Anfrage: er steht an der Ebene, der letzte Stand bleibt.
pub async fn refresh_if_due(
    state: &AppState,
    einsatz: &Einsatz,
    ebene_id: i64,
) -> Result<(), AppError> {
    if !is_hier_abzurufen(einsatz) || faellig(state, einsatz.id, ebene_id).await?.is_none() {
        return Ok(());
    }
    let sperre = state.fremdebene_abrufer.sperre(ebene_id);
    let ergebnis = {
        let _halt = sperre.lock().await;
        // Wer gewartet hat, bekommt das Ergebnis des Vorgängers: nach ihm ist nichts mehr fällig.
        match faellig(state, einsatz.id, ebene_id).await? {
            Some(stand) => nachholen(state, einsatz, ebene_id, stand).await,
            None => Ok(()),
        }
    };
    state.fremdebene_abrufer.freigeben(ebene_id, sperre);
    ergebnis
}

/// Der Abrufstand einer fälligen URL-Ebene, sonst `None`.
async fn faellig(
    state: &AppState,
    einsatz_id: i64,
    ebene_id: i64,
) -> Result<Option<repo::Abrufstand>, AppError> {
    let Some(stand) = repo::laden_abrufstand(&state.pool, einsatz_id, ebene_id).await? else {
        return Ok(None);
    };
    let jetzt = chrono::Utc::now().naive_utc();
    Ok((stand.quelle == FremdebeneQuelle::Url
        && stand.url.is_some()
        && is_faellig(stand.versucht_at.as_deref(), jetzt))
    .then_some(stand))
}

async fn nachholen(
    state: &AppState,
    einsatz: &Einsatz,
    ebene_id: i64,
    stand: repo::Abrufstand,
) -> Result<(), AppError> {
    let Some(url) = stand.url.as_deref() else {
        return Ok(());
    };
    let geholt = holen(
        state,
        einsatz.org_id,
        url,
        stand.etag.as_deref(),
        stand.last_modified.as_deref(),
    )
    .await?;
    let pool = &state.pool;
    let melden = match geholt {
        Ok(Geholt::Unveraendert {
            etag,
            last_modified,
        }) => {
            let etag = etag.or(stand.etag);
            let last_modified = last_modified.or(stand.last_modified);
            repo::setze_abruf(
                pool,
                einsatz.id,
                ebene_id,
                AbrufStand::Erfolg {
                    etag: etag.as_deref(),
                    last_modified: last_modified.as_deref(),
                },
            )
            .await?;
            stand.fehler.is_some()
        }
        Ok(Geholt::Neu {
            normiert,
            etag,
            last_modified,
        }) => {
            let geaendert = repo::ersetze_daten(pool, einsatz.id, ebene_id, &normiert).await?;
            repo::setze_abruf(
                pool,
                einsatz.id,
                ebene_id,
                AbrufStand::Erfolg {
                    etag: etag.as_deref(),
                    last_modified: last_modified.as_deref(),
                },
            )
            .await?;
            geaendert || stand.fehler.is_some()
        }
        Err(fehler) => {
            tracing::info!(
                ebene_id,
                fehler = fehler.as_str(),
                "Fremdebene: Abruf gescheitert, der letzte Stand bleibt"
            );
            repo::setze_abruf(pool, einsatz.id, ebene_id, AbrufStand::Fehler(fehler)).await?;
            stand.fehler != Some(fehler)
        }
    };
    if melden {
        state
            .live
            .publiziere_einsatz(einsatz.id, LiveEvent::KarteFremdebene);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> chrono::NaiveDateTime {
        crate::zeit::parse(s).unwrap()
    }

    #[test]
    fn faellig_erst_nach_60_s() {
        let jetzt = t("2026-11-25 12:01:00");
        assert!(
            !is_faellig(Some("2026-11-25 12:00:00"), jetzt),
            "genau 60 s"
        );
        assert!(is_faellig(Some("2026-11-25 11:59:59"), jetzt));
        assert!(!is_faellig(Some("2026-11-25 12:00:30"), jetzt));
        assert!(is_faellig(None, jetzt));
        assert!(is_faellig(Some("unlesbar"), jetzt));
    }

    #[test]
    fn abruf_zeigt_die_url_nicht() {
        let a = Abruf {
            url: "https://geo.example.org/x?token=geheim".into(),
            lan_erlaubt: false,
            etag: None,
            last_modified: None,
        };
        let text = format!("{a:?}");
        assert!(
            !text.contains("geheim") && !text.contains("example"),
            "{text}"
        );
    }

    struct Zaehler(std::sync::atomic::AtomicUsize);

    impl FremdebeneAbrufer for Zaehler {
        fn abrufen(
            &self,
            _abruf: Abruf,
        ) -> BoxFuture<'_, Result<BedingteAntwort, FremdebeneFehler>> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async { Err(FremdebeneFehler::Status) })
        }
    }

    #[tokio::test]
    async fn sperre_wird_abgeraeumt() {
        let a = Abrufer::mit(Arc::new(Zaehler(Default::default())));
        let s = a.sperre(7);
        let zweite = a.sperre(7);
        assert!(Arc::ptr_eq(&s, &zweite), "eine Sperre je Ebene");
        a.freigeben(7, zweite);
        assert_eq!(a.sperren.lock().unwrap().len(), 1, "noch gehalten");
        a.freigeben(7, s);
        assert!(a.sperren.lock().unwrap().is_empty());
    }
}
