//! Abruf der PEGELONLINE-Zeitreihe je Station mit Cache (LFH-606).
//!
//! Je Station ein Eintrag `pegel:<uuid>` in `karte::cache` (die geparste Reihe der letzten
//! drei Stunden). Stale-while-revalidate wie bei den Fachebenen (`karte::quellen`):
//!
//! - frisch (< 5 min) → sofort, ohne Netz;
//! - abgelaufen → **sofort** den alten Stand ausliefern und im Hintergrund erneuern. Sein
//!   Messzeitpunkt ist der ehrliche Datenstand, das Frontend markiert ihn selbst als
//!   veraltet. Je Station läuft höchstens EIN Hintergrundabruf (In-flight-Schlüssel
//!   `pegel:<uuid>` in `FachebenenState::inflight`) — parallele GETs starten keine n Abrufe;
//! - gar kein Eintrag → einmalig warten, höchstens [`ABRUF_FRIST`]. Scheitert das, fehlt
//!   die Messung.
//!
//! Alle Stationen einer Liste laufen parallel.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::future::join_all;
use sqlx::SqlitePool;

use super::trend::{messung_aus_reihe, parse_messungen, Messpunkt};
use super::PegelMessung;
use crate::karte::cache;
use crate::karte::quellen::hole_json;
use crate::karte::FachebenenState;

/// Lebensdauer eines Cache-Eintrags (Sekunden). Die Quelle misst im 15-min-Raster.
pub const TTL_S: i64 = 5 * 60;
/// Obergrenze je Stationsabruf. Der gemeinsame Client trägt dieselbe Schranke; die eigene
/// hält auch eine Verbindung auf, die langsam, aber nicht tot ist.
pub const ABRUF_FRIST: Duration = Duration::from_secs(8);

/// Cache-Schlüssel einer Station (zugleich ihr In-flight-Schlüssel).
pub fn cache_schluessel(station_uuid: &str) -> String {
    format!("pegel:{station_uuid}")
}

/// URL der W-Zeitreihe (Wasserstand) der letzten drei Stunden.
pub fn messungen_url(basis: &str, station_uuid: &str) -> String {
    format!("{basis}/stations/{station_uuid}/W/measurements.json?start=PT3H")
}

/// Holt die Reihe von der Quelle und schreibt sie in den Cache. `None` bei jedem Fehlschlag
/// (geloggt). Besitzt alle Eingaben, damit es als Hintergrundaufgabe laufen kann.
async fn erneuere(
    client: reqwest::Client,
    basis: Arc<str>,
    pool: SqlitePool,
    station_uuid: String,
) -> Option<Vec<Messpunkt>> {
    let url = messungen_url(&basis, &station_uuid);
    let fehler = match tokio::time::timeout(ABRUF_FRIST, hole_json(&client, &url)).await {
        Ok(Ok(roh)) => match parse_messungen(&roh) {
            Some(reihe) => {
                cache::setze_wert(&pool, &cache_schluessel(&station_uuid), &reihe).await;
                return Some(reihe);
            }
            None => "Antwort ist keine Messreihe".to_string(),
        },
        Ok(Err(e)) => e,
        Err(_) => format!("keine Antwort binnen {} s", ABRUF_FRIST.as_secs()),
    };
    tracing::warn!("PEGELONLINE-Messreihe {station_uuid}: {fehler}");
    None
}

/// Liefert die Reihe einer Station nach der SWR-Regel im Modulkopf.
async fn reihe_fuer(
    fachebenen: &FachebenenState,
    pool: &SqlitePool,
    station_uuid: &str,
) -> Option<Vec<Messpunkt>> {
    let schluessel = cache_schluessel(station_uuid);
    let abruf = || {
        erneuere(
            fachebenen.client.clone(),
            fachebenen.pegel_basis_url.clone(),
            pool.clone(),
            station_uuid.to_string(),
        )
    };
    match cache::eintrag_wert::<Vec<Messpunkt>>(pool, &schluessel).await {
        Some((reihe, alter)) if alter < TTL_S => Some(reihe),
        Some((reihe, _)) => {
            // Den Mutex NIE über ein await halten (!Send) — nur einfügen und loslassen.
            let beansprucht = fachebenen
                .inflight
                .lock()
                .unwrap()
                .insert(schluessel.clone());
            if beansprucht {
                let inflight = fachebenen.inflight.clone();
                let fut = abruf();
                tokio::spawn(async move {
                    fut.await;
                    inflight.lock().unwrap().remove(&schluessel);
                });
            }
            Some(reihe)
        }
        None => abruf().await,
    }
}

/// Messungen für alle Stationen, parallel. Stationen ohne Messung fehlen in der Map.
pub async fn messungen(
    fachebenen: &FachebenenState,
    pool: &SqlitePool,
    station_uuids: &[&str],
) -> HashMap<String, PegelMessung> {
    let ergebnisse = join_all(station_uuids.iter().map(|uuid| async move {
        let messung = reihe_fuer(fachebenen, pool, uuid)
            .await
            .and_then(|r| messung_aus_reihe(&r));
        (uuid.to_string(), messung)
    }))
    .await;
    ergebnisse
        .into_iter()
        .filter_map(|(uuid, m)| m.map(|m| (uuid, m)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "a6ee8177-107b-47dd-bcfd-30960ccc6e9c";

    /// Nicht erreichbare Basis (ECONNREFUSED sofort) — kein Test geht ins Netz.
    fn ohne_netz() -> FachebenenState {
        FachebenenState::neu().mit_pegel_basis_url("http://127.0.0.1:1")
    }

    fn reihe() -> Vec<Messpunkt> {
        [
            ("2026-09-22T08:15:00+02:00", 100.0),
            ("2026-09-22T08:30:00+02:00", 102.5),
            ("2026-09-22T08:45:00+02:00", 105.0),
            ("2026-09-22T09:00:00+02:00", 107.5),
            ("2026-09-22T09:15:00+02:00", 110.0),
        ]
        .iter()
        .map(|(z, v)| Messpunkt {
            zeitpunkt: z.to_string(),
            wert_cm: *v,
        })
        .collect()
    }

    #[test]
    fn url_und_schluessel() {
        assert_eq!(
            messungen_url("https://x/v2", UUID),
            format!("https://x/v2/stations/{UUID}/W/measurements.json?start=PT3H")
        );
        assert_eq!(cache_schluessel(UUID), format!("pegel:{UUID}"));
    }

    #[tokio::test]
    async fn frischer_cache_ohne_netz() {
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &cache_schluessel(UUID), &reihe()).await;
        let m = messungen(&ohne_netz(), &pool, &[UUID]).await;
        let m = m.get(UUID).expect("Messung aus dem Cache");
        assert_eq!(m.wasserstand_cm, 110.0);
        assert_eq!(m.trend_cm_pro_h, Some(10.0));
    }

    #[tokio::test]
    async fn gescheiterter_abruf_liefert_alten_eintrag() {
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &cache_schluessel(UUID), &reihe()).await;
        sqlx::query("UPDATE fachebenen_cache SET gespeichert_at = unixepoch() - 3600")
            .execute(&pool)
            .await
            .unwrap();
        let m = messungen(&ohne_netz(), &pool, &[UUID]).await;
        assert_eq!(
            m.get(UUID).map(|m| m.zeitpunkt.as_str()),
            Some("2026-09-22T09:15:00+02:00"),
            "der alte Stand mit seinem ehrlichen Messzeitpunkt"
        );
    }

    /// Eine Quelle, die Verbindungen annimmt, zählt und nie antwortet.
    async fn stumme_quelle() -> (String, Arc<std::sync::atomic::AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let basis = format!("http://{}", listener.local_addr().unwrap());
        let zaehler = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let z = zaehler.clone();
        tokio::spawn(async move {
            let mut offen = Vec::new();
            while let Ok((sock, _)) = listener.accept().await {
                z.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                offen.push(sock); // offen halten, nie antworten
            }
        });
        (basis, zaehler)
    }

    #[tokio::test]
    async fn abgelaufener_eintrag_kommt_sofort_und_nur_ein_hintergrundabruf() {
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &cache_schluessel(UUID), &reihe()).await;
        sqlx::query("UPDATE fachebenen_cache SET gespeichert_at = unixepoch() - 3600")
            .execute(&pool)
            .await
            .unwrap();
        let (basis, zaehler) = stumme_quelle().await;
        let fe = FachebenenState::neu().mit_pegel_basis_url(&basis);

        let start = std::time::Instant::now();
        for _ in 0..3 {
            let m = messungen(&fe, &pool, &[UUID]).await;
            assert!(m.contains_key(UUID), "alter Stand kommt sofort");
        }
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "kein Warten auf den Abruf: {:?}",
            start.elapsed()
        );
        // Dem Hintergrundabruf Zeit geben, die Verbindung aufzubauen.
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(
            zaehler.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "drei GETs, ein Abruf"
        );
        assert!(fe
            .inflight
            .lock()
            .unwrap()
            .contains(&cache_schluessel(UUID)));
    }

    #[tokio::test]
    async fn ohne_cache_und_ohne_quelle_fehlt_die_messung() {
        let pool = crate::db::test_pool().await;
        let m = messungen(&ohne_netz(), &pool, &[UUID]).await;
        assert!(m.is_empty());
    }

    #[tokio::test]
    async fn leere_reihe_im_cache_ist_keine_messung() {
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &cache_schluessel(UUID), &Vec::<Messpunkt>::new()).await;
        assert!(messungen(&ohne_netz(), &pool, &[UUID]).await.is_empty());
    }
}
