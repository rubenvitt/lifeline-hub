//! Abruf der PEGELONLINE-Zeitreihe je Station mit Cache (LFH-606).
//!
//! Je Station ein Eintrag `pegel:<uuid>` in `karte::cache` (die geparste Reihe der letzten
//! drei Stunden). Frisch (< 5 min) → ohne Netz; sonst Abruf. Scheitert der Abruf, gilt der
//! **alte** Eintrag — sein Messzeitpunkt ist der ehrliche Datenstand, das Frontend markiert
//! ihn selbst als veraltet. Ohne Eintrag fehlt die Messung.
//!
//! Das Laden der Liste darf nicht an einer hängenden Station warten: alle Stationen werden
//! parallel geholt, jede unter [`ABRUF_FRIST`].

use std::collections::HashMap;
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

/// Cache-Schlüssel einer Station.
pub fn cache_schluessel(station_uuid: &str) -> String {
    format!("pegel:{station_uuid}")
}

/// URL der W-Zeitreihe (Wasserstand) der letzten drei Stunden.
pub fn messungen_url(basis: &str, station_uuid: &str) -> String {
    format!("{basis}/stations/{station_uuid}/W/measurements.json?start=PT3H")
}

/// Liefert die Reihe einer Station: frischer Cache, sonst Abruf, sonst alter Cache.
async fn reihe_fuer(
    fachebenen: &FachebenenState,
    pool: &SqlitePool,
    station_uuid: &str,
) -> Option<Vec<Messpunkt>> {
    let schluessel = cache_schluessel(station_uuid);
    let alt = cache::eintrag_wert::<Vec<Messpunkt>>(pool, &schluessel).await;
    if let Some((reihe, alter)) = &alt {
        if *alter < TTL_S {
            return Some(reihe.clone());
        }
    }
    let url = messungen_url(&fachebenen.pegel_basis_url, station_uuid);
    let fehler = match tokio::time::timeout(ABRUF_FRIST, hole_json(&fachebenen.client, &url)).await
    {
        Ok(Ok(roh)) => match parse_messungen(&roh) {
            Some(reihe) => {
                cache::setze_wert(pool, &schluessel, &reihe).await;
                return Some(reihe);
            }
            None => "Antwort ist keine Messreihe".to_string(),
        },
        Ok(Err(e)) => e,
        Err(_) => format!("keine Antwort binnen {} s", ABRUF_FRIST.as_secs()),
    };
    tracing::warn!("PEGELONLINE-Messreihe {station_uuid}: {fehler}");
    alt.map(|(reihe, _)| reihe)
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
