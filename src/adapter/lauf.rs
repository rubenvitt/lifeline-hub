//! Der Hintergrundlauf der Adapter (LLH-2017, Design-Doc „Lauf“, Muster `webhook::lauf`).
//!
//! Je [`TAKT`] ein Durchgang: die fälligen Adapter laden, bis zu [`PARALLEL`] gleichzeitig
//! abrufen, keinen doppelt. Ein Abruf liest Zeile und Geheimnisse, gibt die Verbindung zurück,
//! ruft über das Netz ab (erste Phase der Art) und schreibt danach Übernahme, Zustand und Versuch
//! in einer Transaktion. Während der Anfrage hält der Lauf keine Datenbankverbindung.
//!
//! Ausgelassen werden Adapter einer unbekannten Art und solche einer Org, die sich bei einem Hub
//! meldet (G5: Eingehendes kommt am Hub an).

use std::collections::{HashMap, HashSet};
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use age::secrecy::SecretString;
use chrono::{DateTime, Utc};
use futures::FutureExt;
use serde_json::{Map, Value};
use sqlx::SqlitePool;
use tokio::sync::{watch, Semaphore};
use tokio::task::JoinHandle;

use super::art::{check_einstellungen, AdapterArt, Fehlschlag, Uebernahme};
use super::geheimnis::Geheimnisspeicher;
use super::repo::{self, Adapter, Versuch};
use super::ziel::AbrufKontext;
use super::zustand::{nach_fehlschlag, AdapterFehler};
use super::Rahmen;
use crate::error::AppError;
use crate::zeit;

/// Abstand der Durchgänge.
pub const TAKT: Duration = Duration::from_secs(5);

/// Höchstzahl gleichzeitiger Abrufe.
pub const PARALLEL: usize = 4;

/// Adapter, die gerade abgerufen werden; ein Durchgang lässt sie aus.
type Laufend = Arc<Mutex<HashSet<String>>>;

/// Startet den Lauf. Springt `stopp` auf `true` (oder fällt sein Sender), beginnt kein neuer
/// Abruf mehr, und der Lauf endet, sobald die laufenden fertig sind.
pub fn start(pool: SqlitePool, rahmen: Rahmen, mut stopp: watch::Receiver<bool>) -> JoinHandle<()> {
    let laufend: Laufend = Arc::default();
    let plaetze = Arc::new(Semaphore::new(PARALLEL));
    tokio::spawn(async move {
        if let Err(e) = beim_start(&pool, &rahmen).await {
            tracing::error!("Adapter beim Start nicht wieder aufgenommen: {e}");
        }
        let mut ticker = tokio::time::interval(TAKT);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut laufende: Vec<JoinHandle<()>> = Vec::new();
        loop {
            tokio::select! {
                biased;
                geaendert = stopp.changed() => {
                    if geaendert.is_err() || *stopp.borrow() {
                        break;
                    }
                }
                _ = ticker.tick() => {
                    laufende.retain(|h| !h.is_finished());
                    match takt(&pool, &rahmen, Utc::now(), &laufend, &plaetze).await {
                        Ok(neu) => laufende.extend(neu),
                        Err(e) => tracing::error!("Adapter-Durchgang fehlgeschlagen: {e}"),
                    }
                }
            }
        }
        plaetze.close();
        for h in laufende {
            let _ = h.await;
        }
        tracing::info!("Adapter-Lauf beendet");
    })
}

/// Beim Start mit Schlüssel: Adapter, die nur wegen des Speichers angehalten sind (Start ohne
/// oder mit anderem Schlüssel), laufen wieder; passt ein Geheimnis weiter nicht, halten sie beim
/// ersten Abruf erneut an, ohne das Netz zu fragen.
pub async fn beim_start(pool: &SqlitePool, rahmen: &Rahmen) -> Result<(), AppError> {
    if !rahmen.speicher.has_schluessel() {
        return Ok(());
    }
    let n = repo::rearm_nach_schluessel(pool).await?;
    if n > 0 {
        tracing::info!(
            anzahl = n,
            "Adapter nach dem Start mit Schlüssel wieder aufgenommen"
        );
    }
    Ok(())
}

/// Ergebnis eines Schlüsselwechsels beim Start (LLH-2025).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Umschluesselt {
    /// Geheimnisse, die jetzt am neuen Schlüssel liegen.
    pub umgeschluesselt: u64,
    /// Geheimnisse am alten Schlüssel, die sich nicht öffnen ließen; sie bleiben, wie sie sind.
    pub unlesbar: u64,
    /// Geheimnisse, die danach noch nicht am neuen Schlüssel liegen (die unlesbaren und solche an
    /// einem dritten). Nur bei 0 kann der alte Schlüssel weg.
    pub uebrig: u64,
}

/// Schlüsselwechsel (LLH-2025, ADR-0077): Ist ein alter Schlüssel geladen, liegen danach alle
/// Geheimnisse, die er öffnet, am neuen; in einer Transaktion. Ohne alten Schlüssel nichts. Ein
/// Geheimnis, das sich nicht öffnen lässt, bleibt und wird gezählt. Kein Wert verlässt die
/// Funktion, auch nicht im Fehler.
pub async fn umschluesseln(
    pool: &SqlitePool,
    speicher: &Geheimnisspeicher,
) -> Result<Umschluesselt, sqlx::Error> {
    let (Some(fp_alt), Some(fp_neu)) = (speicher.fingerabdruck_alt(), speicher.fingerabdruck())
    else {
        return Ok(Umschluesselt::default());
    };
    let mut ergebnis = Umschluesselt::default();
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    for (adapter_id, name, chiffrat) in repo::load_chiffrate_mit_fp(&mut tx, fp_alt).await? {
        let s = speicher.clone();
        let alt = fp_alt.to_string();
        let neu = tokio::task::spawn_blocking(move || {
            let wert = s.decrypt(&chiffrat, &alt).ok()?;
            s.encrypt(&wert).ok()
        })
        .await
        .ok()
        .flatten();
        match neu {
            Some((chiffrat, fp)) if fp == fp_neu => {
                if repo::update_chiffrat(&mut tx, &adapter_id, &name, &chiffrat, fp_neu, fp_alt)
                    .await?
                {
                    ergebnis.umgeschluesselt += 1;
                }
            }
            _ => ergebnis.unlesbar += 1,
        }
    }
    tx.commit().await?;
    ergebnis.uebrig =
        u64::try_from(repo::count_fremde_chiffrate(pool, Some(fp_neu)).await?).unwrap_or_default();
    Ok(ergebnis)
}

/// Ein Durchgang zum Zeitpunkt `jetzt`, der auf jeden gestarteten Abruf wartet (für Tests).
pub async fn durchgang(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    jetzt: DateTime<Utc>,
) -> Result<(), AppError> {
    let laufend: Laufend = Arc::default();
    let plaetze = Arc::new(Semaphore::new(PARALLEL));
    for handle in takt(pool, rahmen, jetzt, &laufend, &plaetze).await? {
        let _ = handle.await;
    }
    Ok(())
}

async fn takt(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    jetzt: DateTime<Utc>,
    laufend: &Laufend,
    plaetze: &Arc<Semaphore>,
) -> Result<Vec<JoinHandle<()>>, AppError> {
    let faellige = repo::load_faellige(pool, &zeit::formatiere_utc(jetzt)).await?;
    let mut handles = Vec::new();
    for adapter in faellige {
        let Some(art) = rahmen.arten.find(&adapter.art).cloned() else {
            continue;
        };
        if !laufend
            .lock()
            .expect("Merker nicht vergiftet")
            .insert(adapter.id.clone())
        {
            continue;
        }
        let (pool, rahmen) = (pool.clone(), rahmen.clone());
        let (laufend, plaetze) = (laufend.clone(), plaetze.clone());
        let gestartet = Instant::now();
        handles.push(tokio::spawn(async move {
            let id = adapter.id.clone();
            if let Ok(_platz) = plaetze.acquire_owned().await {
                let jetzt_echt =
                    jetzt + chrono::Duration::from_std(gestartet.elapsed()).unwrap_or_default();
                let lauf = run_one(&pool, &rahmen, &*art, adapter, jetzt_echt);
                match AssertUnwindSafe(lauf).catch_unwind().await {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        tracing::error!(adapter = %id, "Adapter-Abruf fehlgeschlagen: {e}")
                    }
                    Err(_) => tracing::error!(adapter = %id, "Adapter-Abruf abgestürzt"),
                }
            }
            laufend.lock().expect("Merker nicht vergiftet").remove(&id);
        }));
    }
    Ok(handles)
}

/// Was ein Abruf braucht, aus der Datenbank gelesen und geprüft.
struct Vorbereitet {
    einstellungen: Map<String, Value>,
    geheimnisse: HashMap<String, SecretString>,
}

/// Liest Geheimnisse und prüft Einstellungen. Kein Netz; die Verbindung ist danach zurück.
async fn prepare(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    art: &dyn AdapterArt,
    a: &Adapter,
) -> Result<Result<Vorbereitet, Fehlschlag>, AppError> {
    let einstellungen = match check_einstellungen(art, &a.einstellungen(), a.lan_erlaubt) {
        Ok(e) => e,
        Err(_) => return Ok(Err(AdapterFehler::EinstellungUngueltig.into())),
    };
    let chiffrate = {
        let mut conn = pool.acquire().await?;
        repo::load_chiffrate(&mut conn, &a.id).await?
    };
    let plaetze = art.plaetze();
    let braucht_schluessel = plaetze
        .iter()
        .any(|p| p.pflicht || chiffrate.iter().any(|c| c.name == p.name));
    if braucht_schluessel && !rahmen.speicher.has_schluessel() {
        return Ok(Err(AdapterFehler::GeheimnisspeicherGesperrt.into()));
    }
    let mut geheimnisse = HashMap::new();
    for platz in plaetze {
        match chiffrate.iter().find(|c| c.name == platz.name) {
            None if platz.pflicht => return Ok(Err(AdapterFehler::GeheimnisFehlt.into())),
            None => {}
            Some(c) => {
                let speicher = rahmen.speicher.clone();
                let c = c.clone();
                let wert = tokio::task::spawn_blocking(move || {
                    speicher.decrypt(&c.chiffrat, &c.schluessel_fp)
                })
                .await
                .map_err(|e| AppError::Internal(format!("Entschlüsseln abgebrochen: {e}")))?;
                match wert {
                    Ok(w) => {
                        geheimnisse.insert(platz.name.to_string(), w);
                    }
                    Err(_) => return Ok(Err(AdapterFehler::GeheimnisUnlesbar.into())),
                }
            }
        }
    }
    Ok(Ok(Vorbereitet {
        einstellungen,
        geheimnisse,
    }))
}

/// Ergebnis eines Abrufs ohne Übernahme (Probelauf) oder vor ihr.
async fn fetch(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    art: &dyn AdapterArt,
    a: &Adapter,
    is_probe: bool,
) -> Result<Result<Box<dyn Uebernahme>, Fehlschlag>, AppError> {
    let v = match prepare(pool, rahmen, art, a).await? {
        Ok(v) => v,
        Err(f) => return Ok(Err(f)),
    };
    let kontext = AbrufKontext::new(
        &a.id,
        a.org_id,
        &v.einstellungen,
        &v.geheimnisse,
        a.lan_erlaubt,
        is_probe,
    );
    Ok(art.abrufen(&kontext).await)
}

/// Ob die Org sich bei einem Hub meldet; dann läuft hier kein Adapter.
async fn is_org_am_hub(pool: &SqlitePool, org_id: i64) -> Result<bool, AppError> {
    let mut conn = pool.acquire().await?;
    Ok(crate::public_api::zugang::hub_fuer_org(&mut conn, org_id)
        .await?
        .is_some())
}

fn dauer_ms(gestartet: Instant) -> i64 {
    i64::try_from(gestartet.elapsed().as_millis()).unwrap_or(i64::MAX)
}

/// Ruft einen Adapter ab und schreibt das Ergebnis. Die Zeile wird vorher neu gelesen: wer
/// inzwischen angehalten, gelöscht oder umgestellt wurde, läuft nicht mit altem Stand.
async fn run_one(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    art: &dyn AdapterArt,
    adapter: Adapter,
    beginn: DateTime<Utc>,
) -> Result<(), AppError> {
    let a = {
        let mut conn = pool.acquire().await?;
        match repo::load_in_org(&mut conn, adapter.org_id, &adapter.id).await? {
            Some(a) if !a.is_angehalten() => a,
            _ => return Ok(()),
        }
    };
    if is_org_am_hub(pool, a.org_id).await? {
        // Kein Abruf; nach dem Intervall wieder nachsehen statt in jedem Takt.
        let spaeter = beginn + chrono::Duration::seconds(a.intervall_s);
        repo::postpone(pool, &a.id, &zeit::formatiere_utc(spaeter)).await?;
        return Ok(());
    }
    let gestartet = Instant::now();
    let ergebnis = fetch(pool, rahmen, art, &a, false).await?;
    let jetzt = zeit::formatiere_utc(
        beginn + chrono::Duration::from_std(gestartet.elapsed()).unwrap_or_default(),
    );
    let dauer = dauer_ms(gestartet);
    match ergebnis {
        Ok(uebernahme) => {
            let geliefert = uebernahme.anzahl();
            let uebernommen = crate::write_retry!(pool, |conn| {
                // Hat ein Admin inzwischen angehalten oder etwas geändert, gilt das Ergebnis nicht:
                // nur der Versuch bleibt stehen.
                let n = if repo::is_unveraendert(&mut *conn, &a.id, a.stand).await? {
                    let n = uebernahme.uebernehmen(&mut *conn, &a).await?;
                    repo::save_erfolg(&mut *conn, &a, geliefert, &jetzt).await?;
                    n
                } else {
                    0
                };
                repo::save_versuch(
                    &mut *conn,
                    &a.id,
                    &Versuch {
                        at: jetzt.clone(),
                        probe: false,
                        status: None,
                        fehler_art: None,
                        dauer_ms: dauer,
                        anzahl: Some(geliefert),
                    },
                )
                .await?;
                Ok(n)
            });
            match uebernommen {
                Ok(_) => Ok(()),
                // Die Übernahme scheiterte in der Datenbank: als Fehler des Adapters festhalten,
                // nicht still verlieren; der nächste Versuch kommt mit Wartezeit.
                Err(e) => {
                    tracing::error!(adapter = %a.id, "Übernahme fehlgeschlagen: {e}");
                    record_failure(
                        pool,
                        &a,
                        Fehlschlag::new(AdapterFehler::Intern),
                        &jetzt,
                        dauer,
                    )
                    .await
                }
            }
        }
        Err(f) => record_failure(pool, &a, f, &jetzt, dauer).await,
    }
}

async fn record_failure(
    pool: &SqlitePool,
    a: &Adapter,
    f: Fehlschlag,
    jetzt: &str,
    dauer: i64,
) -> Result<(), AppError> {
    let nach = nach_fehlschlag(
        f.art,
        a.intervall_s,
        a.fehler_seit.as_deref(),
        a.fehlversuche,
        jetzt,
    );
    crate::write_retry!(pool, |conn| {
        if repo::is_unveraendert(&mut *conn, &a.id, a.stand).await? {
            repo::save_fehlschlag(&mut *conn, a, f.art, f.status, &nach, jetzt).await?;
        }
        repo::save_versuch(
            &mut *conn,
            &a.id,
            &Versuch {
                at: jetzt.to_string(),
                probe: false,
                status: f.status.map(i64::from),
                fehler_art: Some(f.art.as_str().to_string()),
                dauer_ms: dauer,
                anzahl: None,
            },
        )
        .await?;
        Ok(())
    })
}

/// „Verbindung prüfen“: ruft einmal ab, übernimmt nichts und lässt den Zustand, wie er ist. Der
/// Versuch steht im Verlauf (`probe`).
pub async fn probe(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    art: &dyn AdapterArt,
    a: &Adapter,
    beginn: DateTime<Utc>,
) -> Result<Versuch, AppError> {
    let gestartet = Instant::now();
    let ergebnis = fetch(pool, rahmen, art, a, true).await?;
    let jetzt = zeit::formatiere_utc(
        beginn + chrono::Duration::from_std(gestartet.elapsed()).unwrap_or_default(),
    );
    let versuch = match ergebnis {
        Ok(u) => Versuch {
            at: jetzt,
            probe: true,
            status: None,
            fehler_art: None,
            dauer_ms: dauer_ms(gestartet),
            anzahl: Some(u.anzahl()),
        },
        Err(f) => Versuch {
            at: jetzt,
            probe: true,
            status: f.status.map(i64::from),
            fehler_art: Some(f.art.as_str().to_string()),
            dauer_ms: dauer_ms(gestartet),
            anzahl: None,
        },
    };
    crate::write_retry!(pool, |conn| {
        repo::save_versuch(&mut *conn, &a.id, &versuch).await?;
        Ok(())
    })?;
    Ok(versuch)
}
