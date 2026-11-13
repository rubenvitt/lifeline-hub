//! Der Hintergrundlauf der Webhooks (LLH-1656, design.md D3, Spec `webhook-zustellung`,
//! „Zustellung der Reihe nach aus der Outbox“).
//!
//! Je [`super::TAKT`] ein Durchgang: die fälligen Webhooks laden, bis zu [`super::PARALLEL`]
//! gleichzeitig beliefern, je Webhook streng der Reihe nach und höchstens
//! [`super::MAX_JE_TAKT`] Ereignisse. Während der HTTP-Anfrage hält der Lauf keine
//! Datenbankverbindung; das Ergebnis schreibt er danach in einer Transaktion.
//!
//! Den Weg nach draußen nimmt der Lauf als [`Zusteller`] entgegen; Tests setzen einen ein, der
//! aufzeichnet (Loopback ist für den echten Weg immer gesperrt).

use std::collections::HashSet;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use chrono::{DateTime, Utc};
use futures::FutureExt;
use sqlx::SqlitePool;
use tokio::sync::{watch, Semaphore};
use tokio::task::JoinHandle;

use super::repo::{self, Webhook};
use super::ziel::{Ergebnis, HttpZusteller, Zusteller, Zustellung};
use super::zustand::nach_fehlschlag;
use super::{ruht_grund, MAX_JE_TAKT, PARALLEL, TAKT};
use crate::error::AppError;
use crate::instanz::identitaet::{self, Identitaet};
use crate::instanz::signatur::{new_jti, sign_webhook};
use crate::public_api::events::{self, Naechstes};
use crate::public_api::zugang;
use crate::zeit;

/// Webhooks, die gerade beliefert werden; ein Durchgang lässt sie aus.
type Laufend = Arc<Mutex<HashSet<String>>>;

/// Startet den Lauf. Er endet, sobald `stopp` auf `true` springt oder sein Sender fällt. Jeder
/// Takt startet nur Webhooks, die nicht schon beliefert werden, und wartet nicht auf sie: Ein
/// langsames Ziel hält die übrigen nicht auf. Ein Absturz in einer Belieferung beendet nur diese.
pub fn starte(pool: SqlitePool, mut stopp: watch::Receiver<bool>) -> JoinHandle<()> {
    let zusteller = Arc::new(HttpZusteller);
    let laufend: Laufend = Arc::default();
    let plaetze = Arc::new(Semaphore::new(PARALLEL));
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(TAKT);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                biased;
                geaendert = stopp.changed() => {
                    if geaendert.is_err() || *stopp.borrow() {
                        break;
                    }
                }
                _ = ticker.tick() => {
                    // Die Belieferungen laufen weiter; der Takt wartet nicht auf sie.
                    if let Err(e) = takt(&pool, &zusteller, Utc::now(), &laufend, &plaetze).await {
                        tracing::error!("Webhook-Durchgang fehlgeschlagen: {e}");
                    }
                }
            }
        }
        tracing::info!("Webhook-Zustellung beendet");
    })
}

/// Ein Durchgang zum Zeitpunkt `jetzt`, der wartet, bis jede gestartete Belieferung fertig ist
/// (für Tests und Werkzeuge; der Lauf selbst wartet nicht).
pub async fn durchgang<Z: Zusteller>(
    pool: &SqlitePool,
    zusteller: &Arc<Z>,
    jetzt: DateTime<Utc>,
) -> Result<(), AppError> {
    let laufend: Laufend = Arc::default();
    let plaetze = Arc::new(Semaphore::new(PARALLEL));
    for handle in takt(pool, zusteller, jetzt, &laufend, &plaetze).await? {
        let _ = handle.await;
    }
    Ok(())
}

/// Startet für jeden fälligen Webhook, der nicht schon beliefert wird, eine Belieferung und
/// liefert ihre Handles. Höchstens [`PARALLEL`] liefern gleichzeitig (`plaetze`).
async fn takt<Z: Zusteller>(
    pool: &SqlitePool,
    zusteller: &Arc<Z>,
    jetzt: DateTime<Utc>,
    laufend: &Laufend,
    plaetze: &Arc<Semaphore>,
) -> Result<Vec<JoinHandle<()>>, AppError> {
    let faellige = repo::faellige(pool, &zeit::formatiere_utc(jetzt)).await?;
    if faellige.is_empty() {
        return Ok(Vec::new());
    }
    let identitaet = Arc::new(instanz_identitaet(pool).await?);
    let mut handles = Vec::new();
    for webhook in faellige {
        if !laufend
            .lock()
            .expect("Merker nicht vergiftet")
            .insert(webhook.id.clone())
        {
            continue;
        }
        let (pool, identitaet, zusteller) = (pool.clone(), identitaet.clone(), zusteller.clone());
        let (laufend, plaetze) = (laufend.clone(), plaetze.clone());
        handles.push(tokio::spawn(async move {
            let id = webhook.id;
            if let Ok(_platz) = plaetze.acquire_owned().await {
                let lauf = beliefern(&pool, &identitaet, &*zusteller, &id, jetzt);
                match AssertUnwindSafe(lauf).catch_unwind().await {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        tracing::error!(webhook = %id, "Webhook-Zustellung fehlgeschlagen: {e}")
                    }
                    Err(_) => tracing::error!(webhook = %id, "Webhook-Zustellung abgestürzt"),
                }
            }
            laufend.lock().expect("Merker nicht vergiftet").remove(&id);
        }));
    }
    Ok(handles)
}

/// Beliefert einen Webhook der Reihe nach, bis nichts mehr fällig ist, ein Versuch scheitert oder
/// [`MAX_JE_TAKT`] erreicht ist. Webhook und Zugang werden vor jedem Versuch neu gelesen: Ein
/// Widerruf, ein entzogenes Recht, ein neues Ziel oder das Entfernen wirken ab dem nächsten
/// Ereignis. `beginn` ist die Zeit des Durchgangs; jeder Versuch rechnet mit der Zeit, zu der er
/// geschieht.
async fn beliefern<Z: Zusteller>(
    pool: &SqlitePool,
    identitaet: &Identitaet,
    zusteller: &Z,
    webhook_id: &str,
    beginn: DateTime<Utc>,
) -> Result<(), AppError> {
    let start = Instant::now();
    let jetzt = || beginn + chrono::Duration::from_std(start.elapsed()).unwrap_or_default();
    for _ in 0..MAX_JE_TAKT {
        let (webhook, zugang) = {
            let mut conn = pool.acquire().await?;
            let Some(webhook) = repo::laden(&mut conn, webhook_id).await? else {
                return Ok(());
            };
            let Some(zugang) = zugang::laden(&mut conn, &webhook.zugang_id).await? else {
                return Ok(());
            };
            (webhook, zugang)
        };
        if webhook.is_angehalten() {
            return Ok(());
        }
        let jetzt_s = zeit::formatiere_utc(jetzt());
        let ruht = ruht_grund(&zugang, &jetzt_s).is_some();
        let sichtbar = events::sichtbare_arten(&zugang.scopes);
        let arten: Vec<_> = webhook
            .arten()
            .into_iter()
            .filter(|a| sichtbar.contains(a))
            .collect();

        match events::naechstes(
            pool,
            &webhook.zugang_id,
            &arten,
            webhook.cursor,
            webhook.offen_id,
        )
        .await?
        {
            Naechstes::Leer { uebersprungen_bis } => {
                let rueckt = uebersprungen_bis.is_some_and(|bis| bis > webhook.cursor);
                if rueckt || webhook.offen_id.is_some() || webhook.fehler_seit.is_some() {
                    crate::write_retry!(pool, |conn| {
                        repo::leer_festhalten(conn, &webhook.id, uebersprungen_bis).await?;
                        Ok(())
                    })?;
                }
                return Ok(());
            }
            Naechstes::Verloren { head } => {
                tracing::warn!(
                    webhook = %webhook.id,
                    "Webhook: wartendes Ereignis ist schon gelöscht, setzt beim aktuellen Stand an"
                );
                crate::write_retry!(pool, |conn| {
                    repo::verlust_festhalten(conn, &webhook.id, head, &jetzt_s).await?;
                    Ok(())
                })?;
            }
            Naechstes::Ereignis(ereignis) => {
                if ruht {
                    if webhook.offen_id.is_none() {
                        crate::write_retry!(pool, |conn| {
                            repo::offen_vermerken(conn, &webhook.id, ereignis.id).await?;
                            Ok(())
                        })?;
                    }
                    return Ok(());
                }
                let body = serde_json::to_vec(&ereignis).map_err(|e| {
                    AppError::Internal(format!("Ereignis nicht serialisierbar: {e}"))
                })?;
                let signatur = sign_webhook(
                    identitaet,
                    &webhook.id,
                    &body,
                    jetzt().timestamp(),
                    &new_jti(),
                );
                let ergebnis = zusteller
                    .senden(Zustellung {
                        url: webhook.url.clone(),
                        lan_erlaubt: webhook.lan_erlaubt,
                        signatur,
                        ereignis_id: Some(ereignis.id),
                        body,
                    })
                    .await;
                // Festgehalten wird mit der Zeit nach dem Versuch.
                let danach = zeit::formatiere_utc(jetzt());
                if ergebnis.is_erfolg() {
                    let gilt = crate::write_retry!(pool, |conn| {
                        Ok(repo::erfolg_festhalten(
                            conn,
                            &webhook.id,
                            &webhook.geaendert_at,
                            ereignis.id,
                            &ergebnis,
                            &danach,
                        )
                        .await?)
                    })?;
                    if !gilt {
                        // Ein Admin hat den Webhook während des Versuchs geändert; der nächste
                        // Takt beginnt mit dem neuen Stand.
                        return Ok(());
                    }
                } else {
                    let folge = nach_fehlschlag(
                        webhook.fehler_seit.as_deref(),
                        webhook.fehlversuche,
                        &danach,
                    );
                    crate::write_retry!(pool, |conn| {
                        repo::fehlschlag_festhalten(
                            conn,
                            &webhook.id,
                            &webhook.geaendert_at,
                            ereignis.id,
                            &ergebnis,
                            &folge,
                            &danach,
                        )
                        .await?;
                        Ok(())
                    })?;
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

async fn instanz_identitaet(pool: &SqlitePool) -> Result<Identitaet, AppError> {
    identitaet::load_or_create(pool)
        .await
        .map_err(|e| AppError::Internal(format!("Instanzidentität nicht lesbar: {e}")))
}

/// Body des Testereignisses: `{"type":"ping","occurred_at":"…"}`.
pub fn ping_body(jetzt_s: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({ "type": "ping", "occurred_at": jetzt_s }))
        .expect("JSON ist serialisierbar")
}

/// Sendet ein signiertes Testereignis an das Ziel des Webhooks und hält es im Verlauf fest.
/// Cursor, Zustand und Wartezeit bleiben unberührt (Spec „Testzustellung“).
pub async fn testereignis<Z: Zusteller>(
    pool: &SqlitePool,
    zusteller: &Z,
    webhook: &Webhook,
    jetzt: DateTime<Utc>,
) -> Result<Ergebnis, AppError> {
    let identitaet = instanz_identitaet(pool).await?;
    let jetzt_s = zeit::formatiere_utc(jetzt);
    let body = ping_body(&jetzt_s);
    let signatur = sign_webhook(
        &identitaet,
        &webhook.id,
        &body,
        jetzt.timestamp(),
        &new_jti(),
    );
    let ergebnis = zusteller
        .senden(Zustellung {
            url: webhook.url.clone(),
            lan_erlaubt: webhook.lan_erlaubt,
            signatur,
            ereignis_id: None,
            body,
        })
        .await;
    crate::write_retry!(pool, |conn| {
        repo::test_festhalten(conn, &webhook.id, &ergebnis, &jetzt_s).await?;
        Ok(())
    })?;
    Ok(ergebnis)
}
