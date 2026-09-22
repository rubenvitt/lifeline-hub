//! Vorhersage-Reihe `WV` einer PEGELONLINE-Station als Vorschlag für die Prognose (LFH-628).
//!
//! Gemessen am 22.09.2026: `GET {basis}/stations/{uuid}/WV/measurements.json` liefert
//! `[{ "initialized", "timestamp", "value", "type": "forecast" | "estimate" }, …]` in cm,
//! im 2-h-Raster, rund vier Tage voraus (Quelle BfG). Nur **43** Stationen führen die Reihe;
//! alle anderen antworten mit 404. Die Reihe **ersetzt** die Handerfassung deshalb nicht,
//! sie belegt sie vor, wo sie existiert — und auch dort bleibt der Handwert maßgeblich: die
//! Hochwasservorhersagezentrale eines Landes kann eine andere Zahl nennen als die BfG.
//!
//! Abgerufen wird NUR auf Anfrage (der Prognose-Dialog öffnet sich), nicht im Takt der
//! Kennzahl. Cache je Station unter `pegel-wv:<uuid>`, [`TTL_S`] lang; auch „führt keine
//! Reihe" wird gecacht, sonst fragte jeder Dialog einer der vielen Stationen ohne `WV` erneut
//! an. Scheitert der Abruf, wird ein abgelaufener Eintrag ausgeliefert; ohne jeden Eintrag
//! meldet die Route 502 — der Dialog bleibt dann bedienbar, nur ohne Vorschlag.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

use super::abruf::ABRUF_FRIST;
use super::PegelVorhersage;
use crate::karte::cache;
use crate::karte::FachebenenState;

/// Lebensdauer eines Cache-Eintrags (Sekunden). Die BfG rechnet die Vorhersage wenige Male
/// am Tag neu; eine halbe Stunde ist nah genug dran und schont die Quelle.
pub const TTL_S: i64 = 30 * 60;

/// Ein Punkt der Vorhersage-Reihe, wie er im Cache liegt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VorhersagePunkt {
    pub zeitpunkt: String,
    pub wert_cm: f64,
    pub erstellt: String,
    pub abschaetzung: bool,
}

pub fn cache_schluessel(station_uuid: &str) -> String {
    format!("pegel-wv:{station_uuid}")
}

pub fn vorhersage_url(basis: &str, station_uuid: &str) -> String {
    format!("{basis}/stations/{station_uuid}/WV/measurements.json")
}

/// `WV/measurements.json` → Punkte. `None`, wenn die Antwort kein Array ist. Einträge ohne
/// gültigen RFC-3339-Zeitstempel oder ohne endlichen Wert werden übersprungen. Rein.
pub fn parse_reihe(roh: &Value) -> Option<Vec<VorhersagePunkt>> {
    let arr = roh.as_array()?;
    Some(
        arr.iter()
            .filter_map(|p| {
                let zeitpunkt = p.get("timestamp")?.as_str()?;
                let wert_cm = p.get("value")?.as_f64()?;
                if !wert_cm.is_finite() || DateTime::parse_from_rfc3339(zeitpunkt).is_err() {
                    return None;
                }
                Some(VorhersagePunkt {
                    zeitpunkt: zeitpunkt.to_string(),
                    wert_cm,
                    erstellt: p
                        .get("initialized")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    abschaetzung: p.get("type").and_then(Value::as_str) == Some("estimate"),
                })
            })
            .collect(),
    )
}

/// Höchster Wert der Reihe **ab `jetzt`**, bei Gleichstand der früheste. Vergangene Punkte
/// zählen nicht: eine Reihe von 07:00, um 15:00 gelesen, beginnt mit Werten, die schon
/// gemessen sind — ihr Höchstwert wäre keine Erwartung mehr. `None`, wenn kein Punkt in der
/// Zukunft liegt. Rein.
pub fn hoechststand(punkte: &[VorhersagePunkt], jetzt: DateTime<Utc>) -> Option<PegelVorhersage> {
    let mut bester: Option<(&VorhersagePunkt, DateTime<Utc>)> = None;
    for p in punkte {
        let Ok(t) = DateTime::parse_from_rfc3339(&p.zeitpunkt) else {
            continue;
        };
        let t = t.with_timezone(&Utc);
        if t < jetzt {
            continue;
        }
        let besser = match bester {
            None => true,
            Some((b, bt)) => p.wert_cm > b.wert_cm || (p.wert_cm == b.wert_cm && t < bt),
        };
        if besser {
            bester = Some((p, t));
        }
    }
    bester.map(|(p, _)| PegelVorhersage {
        hoechststand_cm: p.wert_cm,
        zeitpunkt: p.zeitpunkt.clone(),
        erstellt: p.erstellt.clone(),
        abschaetzung: p.abschaetzung,
    })
}

/// Holt die Reihe. `Ok(None)` bei 404 (Station führt keine `WV`), `Err` bei jedem anderen
/// Fehlschlag.
async fn hole(
    fe: &FachebenenState,
    station_uuid: &str,
) -> Result<Option<Vec<VorhersagePunkt>>, String> {
    let url = vorhersage_url(&fe.pegel_basis_url, station_uuid);
    let abruf = async {
        let resp = fe
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        let roh: Value = resp.json().await.map_err(|e| e.to_string())?;
        parse_reihe(&roh)
            .map(Some)
            .ok_or_else(|| "Antwort ist keine Vorhersage-Reihe".to_string())
    };
    match tokio::time::timeout(ABRUF_FRIST, abruf).await {
        Ok(r) => r,
        Err(_) => Err(format!("keine Antwort binnen {} s", ABRUF_FRIST.as_secs())),
    }
}

/// Die Reihe einer Station nach der Regel im Modulkopf. Äußeres `Err`, wenn weder ein Abruf
/// gelang noch ein Cache-Eintrag vorliegt.
pub async fn reihe(
    fe: &FachebenenState,
    pool: &SqlitePool,
    station_uuid: &str,
) -> Result<Option<Vec<VorhersagePunkt>>, String> {
    let schluessel = cache_schluessel(station_uuid);
    let alt = cache::eintrag_wert::<Option<Vec<VorhersagePunkt>>>(pool, &schluessel).await;
    if let Some((wert, alter)) = &alt {
        if *alter < TTL_S {
            return Ok(wert.clone());
        }
    }
    match hole(fe, station_uuid).await {
        Ok(wert) => {
            cache::setze_wert(pool, &schluessel, &wert).await;
            Ok(wert)
        }
        Err(e) => {
            tracing::warn!("PEGELONLINE-Vorhersage {station_uuid}: {e}");
            alt.map(|(wert, _)| wert).ok_or(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn jetzt() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-09-22T12:00:00+02:00")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn punkt(zeit: &str, cm: f64, schaetzung: bool) -> VorhersagePunkt {
        VorhersagePunkt {
            zeitpunkt: zeit.into(),
            wert_cm: cm,
            erstellt: "2026-09-22T07:00:00+02:00".into(),
            abschaetzung: schaetzung,
        }
    }

    #[test]
    fn parse_wie_gemessen() {
        let roh = json!([
            { "initialized": "2026-09-22T07:00:00+02:00", "timestamp": "2026-09-22T07:00:00+02:00", "value": 58.0, "type": "forecast" },
            { "initialized": "2026-09-22T07:00:00+02:00", "timestamp": "2026-09-24T07:00:00+02:00", "value": 61.0, "type": "estimate" },
            { "timestamp": "kaputt", "value": 1.0 },
            { "timestamp": "2026-09-22T09:00:00+02:00", "value": "x" }
        ]);
        let r = parse_reihe(&roh).unwrap();
        assert_eq!(r.len(), 2);
        assert!(!r[0].abschaetzung);
        assert!(r[1].abschaetzung);
        assert_eq!(r[0].erstellt, "2026-09-22T07:00:00+02:00");
        assert!(parse_reihe(&json!({ "status": 404 })).is_none());
    }

    #[test]
    fn hoechststand_nur_aus_der_zukunft_frueheste_bei_gleichstand() {
        let r = [
            punkt("2026-09-22T09:00:00+02:00", 900.0, false), // vorbei, zählt nicht
            punkt("2026-09-22T13:00:00+02:00", 700.0, false),
            punkt("2026-09-22T18:00:00+02:00", 710.0, false),
            punkt("2026-09-22T20:00:00+02:00", 710.0, false),
            punkt("2026-09-23T07:00:00+02:00", 690.0, true),
        ];
        let v = hoechststand(&r, jetzt()).unwrap();
        assert_eq!(v.hoechststand_cm, 710.0);
        assert_eq!(v.zeitpunkt, "2026-09-22T18:00:00+02:00");
        assert!(!v.abschaetzung);
    }

    #[test]
    fn abschaetzung_wird_mitgemeldet_und_leere_zukunft_ist_none() {
        let r = [
            punkt("2026-09-22T13:00:00+02:00", 700.0, false),
            punkt("2026-09-24T07:00:00+02:00", 750.0, true),
        ];
        assert!(hoechststand(&r, jetzt()).unwrap().abschaetzung);
        let vorbei = [punkt("2026-09-22T09:00:00+02:00", 700.0, false)];
        assert_eq!(hoechststand(&vorbei, jetzt()), None);
        assert_eq!(hoechststand(&[], jetzt()), None);
    }

    #[tokio::test]
    async fn keine_reihe_wird_gecacht_und_ohne_netz_geliefert() {
        let pool = crate::db::test_pool().await;
        let uuid = "a6ee8177-107b-47dd-bcfd-30960ccc6e9c";
        cache::setze_wert(
            &pool,
            &cache_schluessel(uuid),
            &None::<Vec<VorhersagePunkt>>,
        )
        .await;
        let fe = FachebenenState::neu().mit_pegel_basis_url("http://127.0.0.1:1");
        assert_eq!(reihe(&fe, &pool, uuid).await, Ok(None));
    }

    #[tokio::test]
    async fn ohne_cache_und_ohne_quelle_ist_fehler() {
        let pool = crate::db::test_pool().await;
        let fe = FachebenenState::neu().mit_pegel_basis_url("http://127.0.0.1:1");
        assert!(reihe(&fe, &pool, "a6ee8177-107b-47dd-bcfd-30960ccc6e9c")
            .await
            .is_err());
    }
}
