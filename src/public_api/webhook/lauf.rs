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

use std::panic::AssertUnwindSafe;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use futures::FutureExt;
use sqlx::SqlitePool;
use tokio::sync::{watch, Semaphore};
use tokio::task::{JoinHandle, JoinSet};

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

/// Startet den Lauf. Er endet, sobald `stopp` auf `true` springt oder sein Sender fällt; eine
/// laufende Zustellung wird zu Ende geführt. Ein Absturz in einem Durchgang beendet nur diesen.
pub fn starte(pool: SqlitePool, mut stopp: watch::Receiver<bool>) -> JoinHandle<()> {
    let zusteller = Arc::new(HttpZusteller);
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
                    let lauf = durchgang(&pool, &zusteller, Utc::now());
                    match AssertUnwindSafe(lauf).catch_unwind().await {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => tracing::error!("Webhook-Durchgang fehlgeschlagen: {e}"),
                        Err(_) => tracing::error!("Webhook-Durchgang abgestürzt"),
                    }
                }
            }
        }
        tracing::info!("Webhook-Zustellung beendet");
    })
}

/// Ein Durchgang zum Zeitpunkt `jetzt`.
pub async fn durchgang<Z: Zusteller>(
    pool: &SqlitePool,
    zusteller: &Arc<Z>,
    jetzt: DateTime<Utc>,
) -> Result<(), AppError> {
    let jetzt_s = zeit::formatiere_utc(jetzt);
    let faellige = repo::faellige(pool, &jetzt_s).await?;
    if faellige.is_empty() {
        return Ok(());
    }
    let identitaet = Arc::new(instanz_identitaet(pool).await?);
    let plaetze = Arc::new(Semaphore::new(PARALLEL));
    let mut alle = JoinSet::new();
    for webhook in faellige {
        let platz = plaetze
            .clone()
            .acquire_owned()
            .await
            .expect("Semaphore bleibt offen");
        let (pool, identitaet, zusteller) = (pool.clone(), identitaet.clone(), zusteller.clone());
        alle.spawn(async move {
            let _platz = platz;
            let id = webhook.id.clone();
            if let Err(e) = beliefern(&pool, &identitaet, &*zusteller, webhook, jetzt).await {
                tracing::error!(webhook = %id, "Webhook-Zustellung fehlgeschlagen: {e}");
            }
        });
    }
    while alle.join_next().await.is_some() {}
    Ok(())
}

/// Beliefert einen Webhook der Reihe nach, bis nichts mehr fällig ist, ein Versuch scheitert oder
/// [`MAX_JE_TAKT`] erreicht ist.
async fn beliefern<Z: Zusteller>(
    pool: &SqlitePool,
    identitaet: &Identitaet,
    zusteller: &Z,
    webhook: Webhook,
    jetzt: DateTime<Utc>,
) -> Result<(), AppError> {
    let jetzt_s = zeit::formatiere_utc(jetzt);
    let zugang = {
        let mut conn = pool.acquire().await?;
        zugang::laden(&mut conn, &webhook.zugang_id).await?
    };
    let Some(zugang) = zugang else {
        return Ok(());
    };
    let ruht = ruht_grund(&zugang, &jetzt_s).is_some();
    let sichtbar = events::sichtbare_arten(&zugang.scopes);
    let arten: Vec<_> = webhook
        .arten()
        .into_iter()
        .filter(|a| sichtbar.contains(a))
        .collect();

    let mut cursor = webhook.cursor;
    let mut offen = webhook.offen_id;
    let mut fehler_seit = webhook.fehler_seit.clone();
    let mut fehlversuche = webhook.fehlversuche;
    for _ in 0..MAX_JE_TAKT {
        match events::naechstes(pool, &webhook.zugang_id, &arten, cursor, offen).await? {
            Naechstes::Leer => {
                if offen.is_some() {
                    crate::write_retry!(pool, |conn| {
                        repo::offen_loeschen(conn, &webhook.id).await?;
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
                cursor = cursor.max(head);
                offen = None;
            }
            Naechstes::Ereignis(ereignis) => {
                if ruht {
                    if offen.is_none() {
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
                    jetzt.timestamp(),
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
                if ergebnis.is_erfolg() {
                    crate::write_retry!(pool, |conn| {
                        repo::erfolg_festhalten(
                            conn,
                            &webhook.id,
                            ereignis.id,
                            &ergebnis,
                            &jetzt_s,
                        )
                        .await?;
                        Ok(())
                    })?;
                    cursor = ereignis.id;
                    offen = None;
                    fehler_seit = None;
                    fehlversuche = 0;
                } else {
                    let folge = nach_fehlschlag(fehler_seit.as_deref(), fehlversuche, &jetzt_s);
                    crate::write_retry!(pool, |conn| {
                        repo::fehlschlag_festhalten(
                            conn,
                            &webhook.id,
                            ereignis.id,
                            &ergebnis,
                            &folge,
                            &jetzt_s,
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
