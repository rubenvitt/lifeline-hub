//! Abruf der PEGELONLINE-Zeitreihe je Station mit Cache (LFH-606).
//!
//! Je Station ein Eintrag `pegel:<uuid>` in `karte::cache` (die geparste Reihe der letzten
//! 24 Stunden; bis LFH-633 waren es drei — ältere Einträge bleiben gültig und wachsen mit
//! dem nächsten Abruf). Stale-while-revalidate wie bei den Fachebenen (`karte::quellen`):
//!
//! - frisch (< 5 min) → sofort, ohne Netz;
//! - abgelaufen → **sofort** den alten Stand ausliefern und im Hintergrund erneuern. Sein
//!   Messzeitpunkt ist der ehrliche Datenstand, das Frontend markiert ihn selbst als
//!   veraltet;
//! - gar kein Eintrag → nur beim Lesen ([`Modus::Warten`]) einmalig warten, höchstens
//!   [`ABRUF_FRIST`]. Schreibende Routen ([`Modus::NurCache`]) warten nie: sie antworten
//!   mit dem Cache und stoßen fehlende Stationen im Hintergrund an.
//!
//! Zwei Bremsen gegen eine Quelle, die nicht kann (unbekannte UUID → 404, hängender
//! Server): je Station läuft höchstens EIN Abruf (In-flight-Schlüssel `pegel:<uuid>` in
//! `FachebenenState::inflight`, auch im kalten Zweig — ist er belegt, fehlt die Messung,
//! statt dass ein zweiter Abruf startet), und nach einem Fehlschlag ruht die Station
//! [`ABKUEHLUNG`] lang (`FachebenenState::pegel_fehlschlag`). Die In-flight-Marke fällt über
//! einen Drop-Guard — auch wenn ein wartender Request abbricht und sein Future verworfen
//! wird.
//!
//! Alle Stationen einer Liste laufen parallel.

use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
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
/// Ruhezeit einer Station nach einem gescheiterten Abruf.
pub const ABKUEHLUNG: Duration = Duration::from_secs(60);

/// Darf eine fehlende Messung abgewartet werden?
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Modus {
    /// Lesen: ohne jeden Cache-Eintrag einmalig auf den Abruf warten.
    Warten,
    /// Schreiben: nie warten, Fehlendes nur im Hintergrund anstoßen.
    NurCache,
}

/// Cache-Schlüssel einer Station (zugleich ihr In-flight-Schlüssel).
pub fn cache_schluessel(station_uuid: &str) -> String {
    format!("pegel:{station_uuid}")
}

/// URL der W-Zeitreihe (Wasserstand) der letzten 24 Stunden (LFH-633: für den Verlauf; der
/// Trend nutzt davon weiter nur die letzten 60 min, `trend::FENSTER_S`). Gemessen: 96 Punkte
/// im 15-min-Raster, rund 5,6 KB je Station.
pub fn messungen_url(basis: &str, station_uuid: &str) -> String {
    format!("{basis}/stations/{station_uuid}/W/measurements.json?start=P1D")
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

/// Gibt die In-flight-Marke frei, wenn der Abruf endet — auch bei Panik oder wenn das
/// Future verworfen wird (Request abgebrochen). Muster: `karte::quellen::InflightFreigabe`.
struct InflightFreigabe {
    inflight: Arc<Mutex<HashSet<String>>>,
    key: String,
}

impl Drop for InflightFreigabe {
    fn drop(&mut self) {
        // Nie mit Panik im Drop: ein vergifteter Mutex hält die Menge trotzdem.
        let mut menge = self.inflight.lock().unwrap_or_else(|e| e.into_inner());
        menge.remove(&self.key);
    }
}

/// Läuft die Abkühlung nach einem Fehlschlag noch?
fn in_abkuehlung(fe: &FachebenenState, station_uuid: &str) -> bool {
    fe.pegel_fehlschlag
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(station_uuid)
        .is_some_and(|t| t.elapsed() < ABKUEHLUNG)
}

/// Belegt die In-flight-Marke der Station. `None`, wenn schon ein Abruf läuft oder die
/// Station in der Abkühlung ist — dann wird NICHT abgerufen.
fn beanspruche(fe: &FachebenenState, station_uuid: &str) -> Option<InflightFreigabe> {
    if in_abkuehlung(fe, station_uuid) {
        return None;
    }
    let key = cache_schluessel(station_uuid);
    // Den Mutex NIE über ein await halten (!Send) — nur einfügen und loslassen.
    if !fe.inflight.lock().unwrap().insert(key.clone()) {
        return None;
    }
    Some(InflightFreigabe {
        inflight: fe.inflight.clone(),
        key,
    })
}

/// Ruft ab, vermerkt den Ausgang (Fehlschlag → Abkühlung) und gibt erst DANACH die Marke
/// frei — sonst könnte ein Aufruf zwischen Freigabe und Vermerk einen zweiten Abruf starten.
fn abruf(
    fe: &FachebenenState,
    pool: &SqlitePool,
    station_uuid: &str,
    freigabe: InflightFreigabe,
) -> impl std::future::Future<Output = Option<Vec<Messpunkt>>> + Send + 'static {
    let fehlschlag = fe.pegel_fehlschlag.clone();
    let uuid = station_uuid.to_string();
    let fut = erneuere(
        fe.client.clone(),
        fe.pegel_basis_url.clone(),
        pool.clone(),
        uuid.clone(),
    );
    async move {
        let ergebnis = fut.await;
        let mut merker = fehlschlag.lock().unwrap_or_else(|e| e.into_inner());
        if ergebnis.is_some() {
            merker.remove(&uuid);
        } else {
            merker.insert(uuid, std::time::Instant::now());
        }
        drop(merker);
        drop(freigabe);
        ergebnis
    }
}

/// Stößt einen Abruf im Hintergrund an (falls weder einer läuft noch Abkühlung gilt).
fn stosse_an(fe: &FachebenenState, pool: &SqlitePool, station_uuid: &str) {
    if let Some(freigabe) = beanspruche(fe, station_uuid) {
        tokio::spawn(abruf(fe, pool, station_uuid, freigabe));
    }
}

/// Liefert die Reihe einer Station nach der Regel im Modulkopf.
async fn reihe_fuer(
    fe: &FachebenenState,
    pool: &SqlitePool,
    station_uuid: &str,
    modus: Modus,
) -> Option<Vec<Messpunkt>> {
    match cache::eintrag_wert::<Vec<Messpunkt>>(pool, &cache_schluessel(station_uuid)).await {
        Some((reihe, alter)) if alter < TTL_S => Some(reihe),
        Some((reihe, _)) => {
            stosse_an(fe, pool, station_uuid);
            Some(reihe)
        }
        None if modus == Modus::NurCache => {
            stosse_an(fe, pool, station_uuid);
            None
        }
        None => match beanspruche(fe, station_uuid) {
            Some(freigabe) => abruf(fe, pool, station_uuid, freigabe).await,
            None => None,
        },
    }
}

/// Rohe Reihen für alle Stationen, parallel, nach der Regel im Modulkopf. Stationen ohne
/// Stand fehlen in der Map.
///
/// Messung (`messungen`) und Verlauf (`routes::pegel::verlauf`) lesen beide hierüber: Wert
/// und Verlaufslinie stammen damit aus demselben Cache-Eintrag, also aus EINEM Stand.
pub async fn reihen(
    fachebenen: &FachebenenState,
    pool: &SqlitePool,
    station_uuids: &[&str],
    modus: Modus,
) -> HashMap<String, Vec<Messpunkt>> {
    let ergebnisse = join_all(station_uuids.iter().map(|uuid| async move {
        let reihe = reihe_fuer(fachebenen, pool, uuid, modus).await;
        (uuid.to_string(), reihe)
    }))
    .await;
    ergebnisse
        .into_iter()
        .filter_map(|(uuid, r)| r.map(|r| (uuid, r)))
        .collect()
}

/// Messungen für alle Stationen, parallel. Stationen ohne Messung fehlen in der Map.
pub async fn messungen(
    fachebenen: &FachebenenState,
    pool: &SqlitePool,
    station_uuids: &[&str],
    modus: Modus,
) -> HashMap<String, PegelMessung> {
    reihen(fachebenen, pool, station_uuids, modus)
        .await
        .into_iter()
        .filter_map(|(uuid, r)| messung_aus_reihe(&r).map(|m| (uuid, m)))
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
            format!("https://x/v2/stations/{UUID}/W/measurements.json?start=P1D")
        );
        assert_eq!(cache_schluessel(UUID), format!("pegel:{UUID}"));
    }

    #[tokio::test]
    async fn frischer_cache_ohne_netz() {
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &cache_schluessel(UUID), &reihe()).await;
        let m = messungen(&ohne_netz(), &pool, &[UUID], Modus::Warten).await;
        let m = m.get(UUID).expect("Messung aus dem Cache");
        assert_eq!(m.wasserstand_cm, 110.0);
        assert_eq!(m.trend_cm_pro_h, Some(10.0));
    }

    #[tokio::test]
    async fn reihen_liefert_die_cache_reihe_unveraendert() {
        // Derselbe Weg wie `messungen`: Wert und Verlaufslinie bleiben EIN Stand. Eine
        // Station ohne Cache fehlt in der Map, statt als leere Reihe aufzutauchen.
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &cache_schluessel(UUID), &reihe()).await;
        let andere = "593647aa-9fea-43ec-a7d6-6476a76ae868";
        let r = reihen(&ohne_netz(), &pool, &[UUID, andere], Modus::Warten).await;
        assert_eq!(r.get(UUID), Some(&reihe()));
        assert!(!r.contains_key(andere));
    }

    #[tokio::test]
    async fn gescheiterter_abruf_liefert_alten_eintrag() {
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &cache_schluessel(UUID), &reihe()).await;
        sqlx::query("UPDATE fachebenen_cache SET gespeichert_at = unixepoch() - 3600")
            .execute(&pool)
            .await
            .unwrap();
        let m = messungen(&ohne_netz(), &pool, &[UUID], Modus::Warten).await;
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
            let m = messungen(&fe, &pool, &[UUID], Modus::Warten).await;
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

    /// Eine Quelle, die jede Anfrage sofort mit 404 beantwortet (unbekannte Station) und
    /// die Verbindungen zählt.
    async fn quelle_404() -> (String, Arc<std::sync::atomic::AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let basis = format!("http://{}", listener.local_addr().unwrap());
        let zaehler = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let z = zaehler.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                z.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                tokio::spawn(async move {
                    let mut puffer = [0u8; 2048];
                    let _ = sock.read(&mut puffer).await;
                    let _ = sock
                        .write_all(
                            b"HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n\
                              Content-Length: 14\r\nConnection: close\r\n\r\n{\"status\":404}",
                        )
                        .await;
                });
            }
        });
        (basis, zaehler)
    }

    fn anzahl(z: &std::sync::atomic::AtomicUsize) -> usize {
        z.load(std::sync::atomic::Ordering::SeqCst)
    }

    #[tokio::test]
    async fn kalter_zweig_startet_keinen_zweiten_abruf() {
        // Ein Abruf der Station läuft schon (Marke belegt): der kalte Zweig wartet nicht und
        // fragt nicht zusätzlich an — die Messung fehlt.
        let pool = crate::db::test_pool().await;
        let (basis, zaehler) = stumme_quelle().await;
        let fe = FachebenenState::neu().mit_pegel_basis_url(&basis);
        fe.inflight.lock().unwrap().insert(cache_schluessel(UUID));

        let start = std::time::Instant::now();
        let m = messungen(&fe, &pool, &[UUID], Modus::Warten).await;
        assert!(m.is_empty());
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "{:?}",
            start.elapsed()
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(anzahl(&zaehler), 0, "kein zweiter Abruf");
    }

    #[tokio::test]
    async fn fehlschlag_setzt_abkuehlung() {
        // Unbekannte Station (404): der erste GET fragt an, die folgenden nicht — sie
        // antworten sofort ohne Messung.
        let pool = crate::db::test_pool().await;
        let (basis, zaehler) = quelle_404().await;
        let fe = FachebenenState::neu().mit_pegel_basis_url(&basis);
        for _ in 0..3 {
            assert!(messungen(&fe, &pool, &[UUID], Modus::Warten)
                .await
                .is_empty());
        }
        assert_eq!(anzahl(&zaehler), 1, "drei GETs, ein Abruf");
        assert!(
            fe.inflight.lock().unwrap().is_empty(),
            "Marke nach dem Abruf frei"
        );
        // Nach der Abkühlung wird wieder angefragt.
        fe.pegel_fehlschlag
            .lock()
            .unwrap()
            .insert(UUID.into(), std::time::Instant::now() - ABKUEHLUNG);
        messungen(&fe, &pool, &[UUID], Modus::Warten).await;
        assert_eq!(anzahl(&zaehler), 2);
    }

    #[tokio::test]
    async fn nur_cache_wartet_nie_und_stoesst_an() {
        let pool = crate::db::test_pool().await;
        let (basis, zaehler) = stumme_quelle().await;
        let fe = FachebenenState::neu().mit_pegel_basis_url(&basis);
        let start = std::time::Instant::now();
        let m = messungen(&fe, &pool, &[UUID], Modus::NurCache).await;
        assert!(m.is_empty());
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "{:?}",
            start.elapsed()
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(anzahl(&zaehler), 1, "im Hintergrund angestoßen");
    }

    #[tokio::test]
    async fn abgebrochener_wartender_abruf_gibt_die_marke_frei() {
        // Der Request bricht ab (Client weg) und verwirft sein Future mitten im Abruf. Ohne
        // Drop-Guard bliebe die Marke stehen und sperrte die Station bis zum Neustart.
        let pool = crate::db::test_pool().await;
        let (basis, _) = stumme_quelle().await;
        let fe = FachebenenState::neu().mit_pegel_basis_url(&basis);
        let abgebrochen = tokio::time::timeout(
            Duration::from_millis(300),
            messungen(&fe, &pool, &[UUID], Modus::Warten),
        )
        .await;
        assert!(abgebrochen.is_err(), "der Abruf hing");
        assert!(fe.inflight.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn ohne_cache_und_ohne_quelle_fehlt_die_messung() {
        let pool = crate::db::test_pool().await;
        let m = messungen(&ohne_netz(), &pool, &[UUID], Modus::Warten).await;
        assert!(m.is_empty());
    }

    #[tokio::test]
    async fn leere_reihe_im_cache_ist_keine_messung() {
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &cache_schluessel(UUID), &Vec::<Messpunkt>::new()).await;
        assert!(messungen(&ohne_netz(), &pool, &[UUID], Modus::Warten)
            .await
            .is_empty());
    }
}
