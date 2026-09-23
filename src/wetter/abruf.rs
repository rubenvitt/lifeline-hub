//! Abruf von Warnungen und Vorhersage für den Einsatzort mit Cache (LFH-633).
//!
//! Das Muster ist `pegel::abruf`, die Bremsen sind dieselben (design.md D3):
//!
//! - frisch (jünger als die TTL) → sofort, ohne Netz;
//! - abgelaufen, aber unter der Obergrenze → **sofort** den alten Stand ausliefern und im
//!   Hintergrund erneuern. `abgerufen_at` bleibt der Zeitpunkt des letzten erfolgreichen
//!   Abrufs, das Frontend markiert ihn selbst als veraltet;
//! - kein Eintrag oder älter als die Obergrenze → einmalig warten, höchstens
//!   [`ABRUF_FRIST`]. Scheitert das, ist der Teil `ausfall`.
//!
//! Je Schlüssel läuft höchstens EIN Abruf (In-flight-Marke in `FachebenenState::inflight`,
//! freigegeben über einen Drop-Guard, auch wenn der wartende Request abbricht), und nach
//! einem Fehlschlag ruht der Schlüssel [`ABKUEHLUNG`] lang — in einem eigenen Merker
//! (`FachebenenState::wetter_fehlschlag`), damit ein Wetterausfall keine Pegelstation sperrt.
//!
//! **Schlüssel und Anfrage tragen die auf zwei Nachkommastellen gerundete Koordinate**
//! (etwa 1 km): Einsätze am selben Ort teilen sich einen Abruf, und an den Dritten geht weder
//! die genaue Lage noch ein Einsatzbezug. Die Warnzelle ist ohnehin gröber als 1 km.
//!
//! **Der Schlüssel trägt außerdem die Organisation** (nicht die Anfrage): ein instanzweit
//! geteilter Eintrag verriete über `abgerufen_at`, dass eine FREMDE Organisation in den
//! letzten Stunden am selben Ort Wetter abgefragt hat — also dort einen Einsatz führt. Geteilt
//! wird deshalb nur innerhalb einer Organisation (Review LFH-633).
//!
//! Der Cache hält die Warnungen **ungefiltert**; abgelaufene entfernt [`anzeige`] bei jeder
//! Antwort (`quelle::gueltige`), vergangene Vorhersagestunden ebenso
//! (`quelle::kommende_stunden`).

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

use super::quelle::{gueltige, kommende_stunden, parse_alerts, parse_weather};
use super::{
    WetterAnzeige, WetterOrt, WetterTeilZustand, WetterVorhersage, WetterVorhersageTeil,
    WetterWarnung, WetterWarnungen,
};
use crate::karte::cache;
use crate::karte::quellen::hole_json;
use crate::karte::FachebenenState;

/// Lebensdauer eines Warnstands (Sekunden).
pub const TTL_WARNUNGEN_S: i64 = 5 * 60;
/// Lebensdauer eines Vorhersagestands (Sekunden). MOSMIX wird stündlich erneuert.
pub const TTL_VORHERSAGE_S: i64 = 30 * 60;
/// Ab diesem Alter gilt ein Warnstand nicht mehr: `ausfall` statt eines alten Stands.
pub const OBERGRENZE_WARNUNGEN_S: i64 = 6 * 3600;
/// Ab diesem Alter gilt ein Vorhersagestand nicht mehr.
pub const OBERGRENZE_VORHERSAGE_S: i64 = 12 * 3600;
/// Obergrenze je Abruf (wie `pegel::abruf::ABRUF_FRIST`).
pub const ABRUF_FRIST: Duration = Duration::from_secs(8);
/// Ruhezeit eines Schlüssels nach einem gescheiterten Abruf.
pub const ABKUEHLUNG: Duration = Duration::from_secs(60);

/// Ein auf zwei Nachkommastellen gerundeter Ort einer Organisation. `lat`/`lon` stehen in
/// Schlüssel UND Anfrage, `org_id` nur im Schlüssel — an den Dritten geht keine Kennung.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GerundeterOrt {
    pub org_id: i64,
    pub lat: String,
    pub lon: String,
}

impl GerundeterOrt {
    pub fn neu(org_id: i64, lat: f64, lon: f64) -> Self {
        // `+ 0.0` macht aus einer −0.00 eine 0.00: sonst zwei Schlüssel für denselben Ort.
        let runde = |x: f64| format!("{:.2}", (x * 100.0).round() / 100.0 + 0.0);
        GerundeterOrt {
            org_id,
            lat: runde(lat),
            lon: runde(lon),
        }
    }
}

/// Warnzelle und Warnungen, wie sie im Cache liegen (ohne Zeitfilter).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Warnlage {
    pub ort: Option<WetterOrt>,
    pub warnungen: Vec<WetterWarnung>,
}

fn parse_warnlage(roh: &Value) -> Option<Warnlage> {
    parse_alerts(roh).map(|(ort, warnungen)| Warnlage { ort, warnungen })
}

/// Beschreibung eines Teils: Schlüsselpräfix, Fristen, Anfrage und Auswertung.
struct Teil<T> {
    praefix: &'static str,
    ttl_s: i64,
    obergrenze_s: i64,
    url: fn(&str, &GerundeterOrt, DateTime<Utc>) -> String,
    parse: fn(&Value) -> Option<T>,
}

const WARNUNGEN: Teil<Warnlage> = Teil {
    praefix: "wetter-warnungen",
    ttl_s: TTL_WARNUNGEN_S,
    obergrenze_s: OBERGRENZE_WARNUNGEN_S,
    url: |basis, ort, _| warnungen_url(basis, ort),
    parse: parse_warnlage,
};

const VORHERSAGE: Teil<WetterVorhersage> = Teil {
    praefix: "wetter-vorhersage",
    ttl_s: TTL_VORHERSAGE_S,
    obergrenze_s: OBERGRENZE_VORHERSAGE_S,
    url: vorhersage_url,
    parse: parse_weather,
};

/// Cache-Schlüssel (zugleich In-flight- und Abkühlungsschlüssel).
fn schluessel(praefix: &str, ort: &GerundeterOrt) -> String {
    format!("{praefix}:{}:{},{}", ort.org_id, ort.lat, ort.lon)
}

/// Cache-Schlüssel der Warnungen, z. B. `wetter-warnungen:1:53.08,8.80` (Org 1).
pub fn schluessel_warnungen(ort: &GerundeterOrt) -> String {
    schluessel(WARNUNGEN.praefix, ort)
}

/// Cache-Schlüssel der Vorhersage, z. B. `wetter-vorhersage:1:53.08,8.80` (Org 1).
pub fn schluessel_vorhersage(ort: &GerundeterOrt) -> String {
    schluessel(VORHERSAGE.praefix, ort)
}

/// `/alerts` für den Punkt: Warnungen der Gemeinde-Warnzelle samt deren Namen.
pub fn warnungen_url(basis: &str, ort: &GerundeterOrt) -> String {
    format!("{basis}/alerts?lat={}&lon={}&tz=Etc/UTC", ort.lat, ort.lon)
}

/// `/weather` für den Punkt: Stundenwerte von der laufenden vollen Stunde an 24 h lang
/// (25 Einträge). Einheiten in der Vorgabe `dwd`: °C, mm, km/h, %.
pub fn vorhersage_url(basis: &str, ort: &GerundeterOrt, jetzt: DateTime<Utc>) -> String {
    let beginn =
        DateTime::<Utc>::from_timestamp(jetzt.timestamp() - jetzt.timestamp().rem_euclid(3600), 0)
            .unwrap_or(jetzt);
    let ende = beginn + chrono::Duration::hours(24);
    let fmt = |t: DateTime<Utc>| t.to_rfc3339_opts(SecondsFormat::Secs, true);
    format!(
        "{basis}/weather?lat={}&lon={}&date={}&last_date={}&tz=Etc/UTC",
        ort.lat,
        ort.lon,
        fmt(beginn),
        fmt(ende)
    )
}

/// Ergebnis eines Teils vor dem Zeitfilter.
#[derive(Debug, Clone, PartialEq)]
pub enum Stand<T> {
    /// Verwertbarer Stand samt Alter in Sekunden (0 = gerade abgerufen).
    Ok {
        wert: T,
        alter_s: i64,
    },
    Ausfall,
}

/// Gibt die In-flight-Marke frei, wenn der Abruf endet — auch bei Panik oder wenn das
/// Future verworfen wird (Request abgebrochen). Muster: `pegel::abruf::InflightFreigabe`.
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

fn in_abkuehlung(fe: &FachebenenState, key: &str) -> bool {
    fe.wetter_fehlschlag
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(key)
        .is_some_and(|t| t.elapsed() < ABKUEHLUNG)
}

/// Belegt die In-flight-Marke. `None`, wenn schon ein Abruf läuft oder die Abkühlung gilt —
/// dann wird NICHT abgerufen.
fn beanspruche(fe: &FachebenenState, key: &str) -> Option<InflightFreigabe> {
    if in_abkuehlung(fe, key) {
        return None;
    }
    // Den Mutex NIE über ein await halten (!Send) — nur einfügen und loslassen.
    if !fe.inflight.lock().unwrap().insert(key.to_string()) {
        return None;
    }
    Some(InflightFreigabe {
        inflight: fe.inflight.clone(),
        key: key.to_string(),
    })
}

/// Holt einen Teil von der Quelle und schreibt ihn in den Cache. `None` bei jedem
/// Fehlschlag (geloggt). Besitzt alle Eingaben, damit es als Hintergrundaufgabe laufen kann.
async fn erneuere<T: Serialize + Send + Sync>(
    client: reqwest::Client,
    url: String,
    pool: SqlitePool,
    key: String,
    parse: fn(&Value) -> Option<T>,
) -> Option<T> {
    let fehler = match tokio::time::timeout(ABRUF_FRIST, hole_json(&client, &url)).await {
        Ok(Ok(roh)) => match parse(&roh) {
            Some(wert) => {
                cache::setze_wert(&pool, &key, &wert).await;
                return Some(wert);
            }
            None => "Antwort hat nicht die erwartete Form".to_string(),
        },
        Ok(Err(e)) => e,
        Err(_) => format!("keine Antwort binnen {} s", ABRUF_FRIST.as_secs()),
    };
    // Die URL trägt nur die gerundete Koordinate, keinen Einsatzbezug.
    tracing::warn!("Bright Sky {key}: {fehler}");
    None
}

/// Ruft ab, vermerkt den Ausgang (Fehlschlag → Abkühlung) und gibt erst DANACH die Marke
/// frei — sonst könnte ein Aufruf zwischen Freigabe und Vermerk einen zweiten Abruf starten.
fn abruf<T: Serialize + Send + Sync + 'static>(
    fe: &FachebenenState,
    pool: &SqlitePool,
    teil: &Teil<T>,
    ort: &GerundeterOrt,
    jetzt: DateTime<Utc>,
    freigabe: InflightFreigabe,
) -> impl std::future::Future<Output = Option<T>> + Send + 'static {
    let fehlschlag = fe.wetter_fehlschlag.clone();
    let key = freigabe.key.clone();
    let fut = erneuere(
        fe.client.clone(),
        (teil.url)(&fe.wetter_basis_url, ort, jetzt),
        pool.clone(),
        key.clone(),
        teil.parse,
    );
    async move {
        let ergebnis = fut.await;
        let mut merker = fehlschlag.lock().unwrap_or_else(|e| e.into_inner());
        if ergebnis.is_some() {
            merker.remove(&key);
        } else {
            merker.insert(key, std::time::Instant::now());
        }
        drop(merker);
        drop(freigabe);
        ergebnis
    }
}

/// Stand eines Teils nach der Regel im Modulkopf.
async fn stand<T>(
    fe: &FachebenenState,
    pool: &SqlitePool,
    teil: &Teil<T>,
    ort: &GerundeterOrt,
    jetzt: DateTime<Utc>,
) -> Stand<T>
where
    T: Serialize + DeserializeOwned + Send + Sync + 'static,
{
    let key = schluessel(teil.praefix, ort);
    match cache::eintrag_wert::<T>(pool, &key).await {
        Some((wert, alter_s)) if alter_s < teil.ttl_s => Stand::Ok { wert, alter_s },
        Some((wert, alter_s)) if alter_s <= teil.obergrenze_s => {
            if let Some(freigabe) = beanspruche(fe, &key) {
                tokio::spawn(abruf(fe, pool, teil, ort, jetzt, freigabe));
            }
            Stand::Ok { wert, alter_s }
        }
        // Kein Eintrag oder zu alt: einmalig warten.
        _ => match beanspruche(fe, &key) {
            Some(freigabe) => match abruf(fe, pool, teil, ort, jetzt, freigabe).await {
                Some(wert) => Stand::Ok { wert, alter_s: 0 },
                None => Stand::Ausfall,
            },
            None => Stand::Ausfall,
        },
    }
}

/// Warnstand für den Ort (ungefiltert).
pub async fn warnlage(
    fe: &FachebenenState,
    pool: &SqlitePool,
    ort: &GerundeterOrt,
    jetzt: DateTime<Utc>,
) -> Stand<Warnlage> {
    stand(fe, pool, &WARNUNGEN, ort, jetzt).await
}

/// Vorhersagestand für den Ort (ungefiltert).
pub async fn vorhersage(
    fe: &FachebenenState,
    pool: &SqlitePool,
    ort: &GerundeterOrt,
    jetzt: DateTime<Utc>,
) -> Stand<WetterVorhersage> {
    stand(fe, pool, &VORHERSAGE, ort, jetzt).await
}

/// `jetzt − Alter` als RFC 3339 in UTC: der Zeitpunkt des letzten erfolgreichen Abrufs.
fn abgerufen_at(jetzt: DateTime<Utc>, alter_s: i64) -> String {
    (jetzt - chrono::Duration::seconds(alter_s.max(0))).to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Die ganze Antwort des Wetter-Endpunkts. `ort` ist der Einsatzort (lat, lon); ohne ihn
/// sind beide Teile `kein_ort`, und es gibt keinen Abruf. `org_id` ist die Organisation des
/// Einsatzes (nur im Cache-Schlüssel). Beide Teile laufen parallel.
pub async fn anzeige(
    fe: &FachebenenState,
    pool: &SqlitePool,
    org_id: i64,
    ort: Option<(f64, f64)>,
    jetzt: DateTime<Utc>,
) -> WetterAnzeige {
    let Some((lat, lon)) = ort.filter(|(lat, lon)| lat.is_finite() && lon.is_finite()) else {
        return WetterAnzeige {
            ort: None,
            warnungen: WetterWarnungen {
                zustand: WetterTeilZustand::KeinOrt,
                abgerufen_at: None,
                daten: None,
            },
            vorhersage: WetterVorhersageTeil {
                zustand: WetterTeilZustand::KeinOrt,
                abgerufen_at: None,
                daten: None,
            },
        };
    };
    let ort = GerundeterOrt::neu(org_id, lat, lon);
    let (warn, vorh) = tokio::join!(
        warnlage(fe, pool, &ort, jetzt),
        vorhersage(fe, pool, &ort, jetzt)
    );
    let (wetter_ort, warnungen) = match warn {
        Stand::Ok { wert, alter_s } => (
            wert.ort,
            WetterWarnungen {
                zustand: WetterTeilZustand::Ok,
                abgerufen_at: Some(abgerufen_at(jetzt, alter_s)),
                daten: Some(gueltige(wert.warnungen, jetzt)),
            },
        ),
        Stand::Ausfall => (
            None,
            WetterWarnungen {
                zustand: WetterTeilZustand::Ausfall,
                abgerufen_at: None,
                daten: None,
            },
        ),
    };
    let vorhersage = match vorh {
        Stand::Ok { wert, alter_s } => WetterVorhersageTeil {
            zustand: WetterTeilZustand::Ok,
            abgerufen_at: Some(abgerufen_at(jetzt, alter_s)),
            daten: Some(kommende_stunden(wert, jetzt)),
        },
        Stand::Ausfall => WetterVorhersageTeil {
            zustand: WetterTeilZustand::Ausfall,
            abgerufen_at: None,
            daten: None,
        },
    };
    WetterAnzeige {
        ort: wetter_ort,
        warnungen,
        vorhersage,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wetter::{WetterStunde, WetterWarnstufe};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Bremen-Mitte, nicht auf einer Rundungsgrenze.
    const ORG: i64 = 1;
    const LAT: f64 = 53.0793;
    const LON: f64 = 8.8017;

    fn ort() -> GerundeterOrt {
        GerundeterOrt::neu(ORG, LAT, LON)
    }

    fn fmt(t: DateTime<Utc>) -> String {
        t.to_rfc3339_opts(SecondsFormat::Secs, true)
    }

    /// Nicht erreichbare Basis (ECONNREFUSED sofort) — kein Test geht ins Netz.
    fn ohne_netz() -> FachebenenState {
        FachebenenState::neu().mit_wetter_basis_url("http://127.0.0.1:1")
    }

    fn warnung(ereignis: &str, stufe: WetterWarnstufe, ende: Option<String>) -> WetterWarnung {
        WetterWarnung {
            stufe,
            ereignis: ereignis.into(),
            ueberschrift: format!("Amtliche WARNUNG vor {ereignis}"),
            beschreibung: None,
            handlungsempfehlung: None,
            beginn: None,
            ende,
            ausgegeben: None,
        }
    }

    fn warnlage_mit(warnungen: Vec<WetterWarnung>) -> Warnlage {
        Warnlage {
            ort: Some(WetterOrt {
                name: "Stadt Bremen".into(),
                kreis: Some("Bremen".into()),
                land: Some("Bremen".into()),
            }),
            warnungen,
        }
    }

    fn vorhersage_ab(jetzt: DateTime<Utc>) -> WetterVorhersage {
        let beginn = jetzt - chrono::Duration::seconds(jetzt.timestamp().rem_euclid(3600));
        WetterVorhersage {
            station: Some("BREMEN".into()),
            entfernung_m: Some(3340.0),
            stunden: (-2..3)
                .map(|h| WetterStunde {
                    zeitpunkt: fmt(beginn + chrono::Duration::hours(h)),
                    temperatur_c: Some(12.0),
                    niederschlag_mm: None,
                    niederschlag_wahrscheinlichkeit: None,
                    wind_kmh: None,
                    boeen_kmh: None,
                    windrichtung_grad: None,
                })
                .collect(),
        }
    }

    async fn altere(pool: &SqlitePool, sekunden: i64) {
        sqlx::query("UPDATE fachebenen_cache SET gespeichert_at = unixepoch() - ?")
            .bind(sekunden)
            .execute(pool)
            .await
            .unwrap();
    }

    /// Eine Quelle, die Verbindungen annimmt, zählt und nie antwortet.
    async fn stumme_quelle() -> (String, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let basis = format!("http://{}", listener.local_addr().unwrap());
        let zaehler = Arc::new(AtomicUsize::new(0));
        let z = zaehler.clone();
        tokio::spawn(async move {
            let mut offen = Vec::new();
            while let Ok((sock, _)) = listener.accept().await {
                z.fetch_add(1, Ordering::SeqCst);
                offen.push(sock); // offen halten, nie antworten
            }
        });
        (basis, zaehler)
    }

    /// Eine Quelle, die jede Anfrage sofort mit 404 beantwortet und die Verbindungen zählt.
    async fn quelle_404() -> (String, Arc<AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let basis = format!("http://{}", listener.local_addr().unwrap());
        let zaehler = Arc::new(AtomicUsize::new(0));
        let z = zaehler.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                z.fetch_add(1, Ordering::SeqCst);
                tokio::spawn(async move {
                    let mut puffer = [0u8; 2048];
                    let _ = sock.read(&mut puffer).await;
                    let _ = sock
                        .write_all(
                            b"HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n\
                              Content-Length: 2\r\nConnection: close\r\n\r\n{}",
                        )
                        .await;
                });
            }
        });
        (basis, zaehler)
    }

    /// Wartet (höchstens 5 s), bis kein Abruf mehr läuft — statt einer festen Pause, die
    /// unter Last zu kurz sein kann.
    async fn warte_bis_marken_frei(fe: &FachebenenState) {
        for _ in 0..500 {
            if fe.inflight.lock().unwrap().is_empty() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("Hintergrundabrufe laufen nach 5 s noch");
    }

    fn anzahl(z: &AtomicUsize) -> usize {
        z.load(Ordering::SeqCst)
    }

    #[test]
    fn rundung_von_schluessel_und_anfrage() {
        let o = GerundeterOrt::neu(1, 53.0849, 8.8);
        assert_eq!(o.lat, "53.08");
        assert_eq!(o.lon, "8.80");
        assert_eq!(schluessel_warnungen(&o), "wetter-warnungen:1:53.08,8.80");
        assert_eq!(schluessel_vorhersage(&o), "wetter-vorhersage:1:53.08,8.80");
        assert_eq!(
            GerundeterOrt::neu(1, 53.0751, 8.7951),
            GerundeterOrt::neu(1, 53.0849, 8.8049),
            "derselbe Kilometer, derselbe Schlüssel"
        );
        // Dieselbe Zelle, fremde Organisation: eigener Schlüssel — sonst verriete
        // `abgerufen_at` den Einsatz der anderen Org.
        assert_ne!(
            schluessel_warnungen(&GerundeterOrt::neu(1, 53.08, 8.80)),
            schluessel_warnungen(&GerundeterOrt::neu(2, 53.08, 8.80)),
        );
        assert_eq!(
            GerundeterOrt::neu(1, -0.001, 0.0).lat,
            "0.00",
            "keine −0.00"
        );
        assert_eq!(
            warnungen_url("https://b", &o),
            "https://b/alerts?lat=53.08&lon=8.80&tz=Etc/UTC"
        );
        let jetzt = DateTime::parse_from_rfc3339("2026-09-23T12:34:56Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            vorhersage_url("https://b", &o, jetzt),
            "https://b/weather?lat=53.08&lon=8.80&date=2026-09-23T12:00:00Z\
             &last_date=2026-09-24T12:00:00Z&tz=Etc/UTC"
        );
    }

    #[tokio::test]
    async fn ohne_ort_kein_abruf() {
        let pool = crate::db::test_pool().await;
        let (basis, zaehler) = quelle_404().await;
        let fe = FachebenenState::neu().mit_wetter_basis_url(&basis);
        let a = anzeige(&fe, &pool, ORG, None, Utc::now()).await;
        assert_eq!(a.warnungen.zustand, WetterTeilZustand::KeinOrt);
        assert_eq!(a.vorhersage.zustand, WetterTeilZustand::KeinOrt);
        assert_eq!(a.ort, None);
        let a = anzeige(&fe, &pool, ORG, Some((f64::NAN, 8.8)), Utc::now()).await;
        assert_eq!(a.warnungen.zustand, WetterTeilZustand::KeinOrt);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(anzahl(&zaehler), 0);
    }

    #[tokio::test]
    async fn frischer_cache_ohne_netz() {
        let pool = crate::db::test_pool().await;
        let jetzt = Utc::now();
        cache::setze_wert(
            &pool,
            &schluessel_warnungen(&ort()),
            &warnlage_mit(vec![warnung("STURMBÖEN", WetterWarnstufe::Maessig, None)]),
        )
        .await;
        cache::setze_wert(&pool, &schluessel_vorhersage(&ort()), &vorhersage_ab(jetzt)).await;
        let (basis, zaehler) = quelle_404().await;
        let fe = FachebenenState::neu().mit_wetter_basis_url(&basis);

        let a = anzeige(&fe, &pool, ORG, Some((LAT, LON)), jetzt).await;
        assert_eq!(a.ort.as_ref().unwrap().name, "Stadt Bremen");
        assert_eq!(a.warnungen.zustand, WetterTeilZustand::Ok);
        assert_eq!(a.warnungen.daten.as_ref().unwrap().len(), 1);
        assert_eq!(a.vorhersage.zustand, WetterTeilZustand::Ok);
        let stunden = &a.vorhersage.daten.as_ref().unwrap().stunden;
        assert_eq!(stunden.len(), 3, "die zwei vergangenen Stunden fallen weg");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(anzahl(&zaehler), 0, "frisch: kein Abruf");
    }

    #[tokio::test]
    async fn abgerufen_at_ist_jetzt_minus_cache_alter() {
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &schluessel_warnungen(&ort()), &warnlage_mit(vec![])).await;
        altere(&pool, 120).await;
        let jetzt = Utc::now();
        let a = anzeige(&ohne_netz(), &pool, ORG, Some((LAT, LON)), jetzt).await;
        let abgerufen = DateTime::parse_from_rfc3339(a.warnungen.abgerufen_at.as_deref().unwrap())
            .unwrap()
            .with_timezone(&Utc);
        let abstand = (jetzt - abgerufen).num_seconds();
        assert!((119..=122).contains(&abstand), "{abstand}");
        assert_eq!(
            a.warnungen.daten,
            Some(vec![]),
            "ok und leer ist nicht ausfall"
        );
    }

    #[tokio::test]
    async fn abgelaufener_stand_kommt_sofort_und_nur_ein_hintergrundabruf() {
        let pool = crate::db::test_pool().await;
        cache::setze_wert(&pool, &schluessel_warnungen(&ort()), &warnlage_mit(vec![])).await;
        altere(&pool, TTL_WARNUNGEN_S + 60).await;
        let (basis, zaehler) = stumme_quelle().await;
        let fe = FachebenenState::neu().mit_wetter_basis_url(&basis);

        let start = std::time::Instant::now();
        for _ in 0..3 {
            let s = warnlage(&fe, &pool, &ort(), Utc::now()).await;
            assert!(matches!(s, Stand::Ok { .. }), "alter Stand kommt sofort");
        }
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "{:?}",
            start.elapsed()
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(anzahl(&zaehler), 1, "drei Aufrufe, ein Abruf");
        assert!(fe
            .inflight
            .lock()
            .unwrap()
            .contains(&schluessel_warnungen(&ort())));
    }

    #[tokio::test]
    async fn kalt_und_ausfall_ist_ausfall() {
        let pool = crate::db::test_pool().await;
        let a = anzeige(&ohne_netz(), &pool, ORG, Some((LAT, LON)), Utc::now()).await;
        assert_eq!(a.warnungen.zustand, WetterTeilZustand::Ausfall);
        assert_eq!(a.vorhersage.zustand, WetterTeilZustand::Ausfall);
        assert_eq!(a.warnungen.daten, None);
        assert_eq!(a.warnungen.abgerufen_at, None);
        assert_eq!(a.ort, None);
    }

    #[tokio::test]
    async fn stand_ueber_der_obergrenze_ist_ausfall() {
        let pool = crate::db::test_pool().await;
        let jetzt = Utc::now();
        cache::setze_wert(&pool, &schluessel_warnungen(&ort()), &warnlage_mit(vec![])).await;
        cache::setze_wert(&pool, &schluessel_vorhersage(&ort()), &vorhersage_ab(jetzt)).await;
        let (basis, zaehler) = quelle_404().await;
        let fe = FachebenenState::neu().mit_wetter_basis_url(&basis);

        // Knapp unter beiden Obergrenzen: alter Stand, Abruf im Hintergrund.
        altere(&pool, OBERGRENZE_WARNUNGEN_S - 60).await;
        let a = anzeige(&fe, &pool, ORG, Some((LAT, LON)), jetzt).await;
        assert_eq!(a.warnungen.zustand, WetterTeilZustand::Ok);
        assert_eq!(a.vorhersage.zustand, WetterTeilZustand::Ok);

        // Sieben Stunden: Warnungen über 6 h → ausfall; Vorhersage unter 12 h → ok. Erst die
        // Hintergrundabrufe auslaufen lassen, sonst hielte ihre Marke den kalten Abruf auf.
        warte_bis_marken_frei(&fe).await;
        fe.wetter_fehlschlag.lock().unwrap().clear();
        altere(&pool, 7 * 3600).await;
        let a = anzeige(&fe, &pool, ORG, Some((LAT, LON)), jetzt).await;
        assert_eq!(a.warnungen.zustand, WetterTeilZustand::Ausfall);
        assert_eq!(a.warnungen.daten, None);
        assert_eq!(a.vorhersage.zustand, WetterTeilZustand::Ok);

        // 13 Stunden: auch die Vorhersage.
        warte_bis_marken_frei(&fe).await;
        fe.wetter_fehlschlag.lock().unwrap().clear();
        altere(&pool, 13 * 3600).await;
        let a = anzeige(&fe, &pool, ORG, Some((LAT, LON)), jetzt).await;
        assert_eq!(a.vorhersage.zustand, WetterTeilZustand::Ausfall);
        assert!(anzahl(&zaehler) >= 3, "zu alt heißt: neu abrufen");
    }

    #[tokio::test]
    async fn fehlschlag_setzt_abkuehlung() {
        let pool = crate::db::test_pool().await;
        let (basis, zaehler) = quelle_404().await;
        let fe = FachebenenState::neu().mit_wetter_basis_url(&basis);
        for _ in 0..3 {
            assert_eq!(
                warnlage(&fe, &pool, &ort(), Utc::now()).await,
                Stand::Ausfall
            );
        }
        assert_eq!(anzahl(&zaehler), 1, "drei Aufrufe, ein Abruf");
        assert!(fe.inflight.lock().unwrap().is_empty(), "Marke frei");
        assert!(
            fe.pegel_fehlschlag.lock().unwrap().is_empty(),
            "der Pegel-Merker bleibt unberührt"
        );
        // Nach der Abkühlung wird wieder angefragt.
        fe.wetter_fehlschlag.lock().unwrap().insert(
            schluessel_warnungen(&ort()),
            std::time::Instant::now() - ABKUEHLUNG,
        );
        warnlage(&fe, &pool, &ort(), Utc::now()).await;
        assert_eq!(anzahl(&zaehler), 2);
    }

    #[tokio::test]
    async fn abgebrochener_abruf_gibt_die_marke_frei() {
        let pool = crate::db::test_pool().await;
        let (basis, _) = stumme_quelle().await;
        let fe = FachebenenState::neu().mit_wetter_basis_url(&basis);
        let abgebrochen = tokio::time::timeout(
            Duration::from_millis(300),
            anzeige(&fe, &pool, ORG, Some((LAT, LON)), Utc::now()),
        )
        .await;
        assert!(abgebrochen.is_err(), "der Abruf hing");
        assert!(fe.inflight.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn abgelaufene_warnung_verschwindet_aus_altem_stand() {
        let pool = crate::db::test_pool().await;
        let jetzt = Utc::now();
        let stunde = |h: i64| Some(fmt(jetzt + chrono::Duration::hours(h)));
        cache::setze_wert(
            &pool,
            &schluessel_warnungen(&ort()),
            &warnlage_mit(vec![
                warnung("WINDBÖEN", WetterWarnstufe::Gering, stunde(-1)),
                warnung("STURMBÖEN", WetterWarnstufe::Maessig, stunde(2)),
            ]),
        )
        .await;
        altere(&pool, 45 * 60).await;
        let a = anzeige(&ohne_netz(), &pool, ORG, Some((LAT, LON)), jetzt).await;
        assert_eq!(a.warnungen.zustand, WetterTeilZustand::Ok);
        let daten = a.warnungen.daten.unwrap();
        assert_eq!(daten.len(), 1);
        assert_eq!(daten[0].ereignis, "STURMBÖEN");
    }

    #[tokio::test]
    async fn kalter_abruf_schreibt_den_cache() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let basis = format!("http://{}", listener.local_addr().unwrap());
        let anfragen = Arc::new(Mutex::new(Vec::<String>::new()));
        let a2 = anfragen.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let a2 = a2.clone();
                tokio::spawn(async move {
                    let mut puffer = vec![0u8; 4096];
                    let n = sock.read(&mut puffer).await.unwrap_or(0);
                    let zeile = String::from_utf8_lossy(&puffer[..n])
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .to_string();
                    let body = if zeile.contains("/alerts") {
                        r#"{"alerts":[],"location":{"name":"Stadt Bremen"}}"#
                    } else {
                        r#"{"weather":[],"sources":[]}"#
                    };
                    a2.lock().unwrap().push(zeile);
                    let antwort = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(antwort.as_bytes()).await;
                });
            }
        });
        let pool = crate::db::test_pool().await;
        let fe = FachebenenState::neu().mit_wetter_basis_url(&basis);
        let a = anzeige(&fe, &pool, ORG, Some((LAT, LON)), Utc::now()).await;
        assert_eq!(a.ort.unwrap().name, "Stadt Bremen");
        assert_eq!(a.warnungen.zustand, WetterTeilZustand::Ok);
        assert_eq!(a.vorhersage.zustand, WetterTeilZustand::Ok);
        let anfragen = anfragen.lock().unwrap().clone();
        assert_eq!(anfragen.len(), 2);
        assert!(
            anfragen.iter().all(|z| z.contains("lat=53.08&lon=8.80")),
            "nur die gerundete Koordinate verlässt das Haus: {anfragen:?}"
        );
        assert!(
            cache::eintrag_wert::<Warnlage>(&pool, &schluessel_warnungen(&ort()))
                .await
                .is_some()
        );
    }
}
