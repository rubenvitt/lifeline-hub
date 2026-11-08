//! Lagebild für externe Anzeigen (LLH-1484), etwa den eigenständigen Lagemonitor im FüKW.
//!
//! `GET /api/lagemonitor/v1/lage` mit einem Lesezugang als Bearer
//! ([`crate::lagemonitor_zugang::LagemonitorZugriff`]). Herleitung:
//! `/mnt/project-files/llh-1484/design.md` (D4–D7). Das Drahtformat ist versioniert
//! ([`API_VERSION`]): ein Fremdsystem darf nicht an einer internen Umbenennung brechen. Neue
//! Felder kommen nur hinzu; wer eines entfernt oder umdeutet, erhöht die Version.
//!
//! Die Zahlen kommen aus derselben Verdichtung wie beim gekoppelten Lagemonitor
//! ([`super::lagemonitor::verdichte`]). Wie dort gilt: **keine Namen, keine Personenkennungen,
//! keine freien Notizen**. Gezeigt werden nur Bezeichnungen (Einsatz, Abschnitte, UHS) und die
//! Zusammenfassung des jüngsten freigegebenen Lageberichts (D6), die für die Weitergabe
//! geschrieben ist. Die Karte trägt die Koordinate des Einsatzorts, nicht seine Adresse.

use crate::app::AppState;
use crate::einsatz::Einsatzart;
use crate::error::AppError;
use crate::lagemonitor_zugang::{self as zugang, LagemonitorZugriff};
use crate::uhs::{UhsStatus, UhsTyp};
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use utoipa::ToSchema;

use super::lagemonitor::{verdichte, LagemonitorBetroffene, LagemonitorKraefte};

/// Version des Drahtformats (`/v1`).
pub const API_VERSION: u32 = 1;

/// `?karte=`, mit dem die Anzeige die Karte abbestellt.
const KARTE_AUS: &str = "aus";

/// Antwort der Schnittstelle.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorLage {
    pub api_version: u32,
    /// Zeitpunkt der Berechnung (UTC, SQLite-Format).
    pub stand_at: String,
    /// Der freigegebene, laufende Einsatz; `null`, wenn keiner freigegeben ist.
    #[schema(required)]
    pub einsatz: Option<LagemonitorEinsatz>,
    /// Lagekarte als GeoJSON-FeatureCollection; fehlt ohne Einsatz, bei `?karte=aus` und wenn sie
    /// der Fassung aus `?karte=<etag>` gleicht.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::karte::typen::GeoJsonFeatureCollection>)]
    pub karte: Option<Value>,
    /// Fassung der Karte; fehlt ohne Einsatz und bei `?karte=aus`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub karte_etag: Option<String>,
}

/// Der gezeigte Einsatz, ohne Sachverhalt, Adresstext und meldende Stelle. Die Koordinate des
/// Einsatzorts steht als Feature `einsatzort` in der Karte.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorEinsatz {
    pub bezeichnung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stichwort: Option<String>,
    pub einsatzart: Einsatzart,
    /// UTC, SQLite-Format.
    pub begonnen_at: String,
    pub betroffene: LagemonitorBetroffene,
    pub kraefte: LagemonitorKraefte,
    /// Nicht aufgelöste UHS mit Belegung als Zahl; die Lage steht in der Karte.
    pub uhs: Vec<LagemonitorUhsZahl>,
    /// Unbestätigte, nicht erledigte Sofortmeldungen; nur die Zahl.
    pub sofortmeldungen_offen: i64,
    /// Zusammenfassung des jüngsten freigegebenen Lageberichts; `null` ohne einen.
    #[schema(required)]
    pub lagemeldung: Option<LagemonitorLagemeldung>,
    /// Hilfeleistungen in Zahlen, nur wenn am Einsatz die Reihe „Sanitätsdienst“ gewählt ist
    /// (LLH-1574). Neues optionales Feld, `api_version` bleibt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sanitaetsdienst: Option<super::lagemonitor::LagemonitorSanitaetsdienst>,
}

/// Eine UHS in Zahlen.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorUhsZahl {
    pub id: i64,
    pub bezeichnung: String,
    pub typ: UhsTyp,
    pub status: UhsStatus,
    pub belegt: i64,
    /// Plätze ohne Wartebereich.
    pub plaetze: i64,
    /// Stärke der zugeordneten Kräfte.
    pub kraefte: i64,
}

/// Die Lagemeldung für die Anzeige.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorLagemeldung {
    pub text: String,
    /// Freigabe des Lageberichts (UTC, SQLite-Format).
    pub freigegeben_at: String,
}

#[derive(Debug, Deserialize)]
pub struct LageQuery {
    /// `aus` oder die Fassung der Karte, die die Anzeige schon hat.
    pub karte: Option<String>,
}

/// GET /api/lagemonitor/v1/lage — das Lagebild des Einsatzes, den die Einsatzleitung für diesen
/// Zugang freigegeben hat. Ohne Freigabe 200 mit `einsatz: null`, ohne gültigen Schlüssel 401.
pub async fn lage(
    State(state): State<AppState>,
    zugriff: LagemonitorZugriff,
    Query(query): Query<LageQuery>,
) -> Result<Json<LagemonitorLage>, AppError> {
    let pool = &state.pool;
    let stand_at = crate::zeit::jetzt();
    let Some(einsatz_id) = zugang::freigegebener_einsatz(pool, zugriff.zugang_id).await? else {
        return Ok(Json(LagemonitorLage {
            api_version: API_VERSION,
            stand_at,
            einsatz: None,
            karte: None,
            karte_etag: None,
        }));
    };
    let kopf = crate::einsatz::repo::laden(pool, einsatz_id).await?;
    // Die Freigabe kennt nur Einsätze der eigenen Org; doppelt hält besser, denn ein fremder
    // Einsatz hier wäre ein Datenabfluss.
    if kopf.org_id != zugriff.org_id {
        return Err(AppError::Internal(
            "Freigabe zeigt auf einen Einsatz einer anderen Organisation".into(),
        ));
    }
    let verdichtet = verdichte(pool, einsatz_id).await?;

    let (karte, karte_etag) = if query.karte.as_deref() == Some(KARTE_AUS) {
        (None, None)
    } else {
        let karte = baue_karte(pool, &kopf, &verdichtet).await?;
        let etag = karte_etag(&karte);
        let gleich = query.karte.as_deref() == Some(etag.as_str());
        ((!gleich).then_some(karte), Some(etag))
    };

    let einsatz = LagemonitorEinsatz {
        bezeichnung: kopf.bezeichnung,
        stichwort: kopf.stichwort,
        einsatzart: kopf.einsatzart,
        begonnen_at: kopf.begonnen_at,
        betroffene: verdichtet.betroffene,
        kraefte: verdichtet.kraefte,
        uhs: verdichtet
            .uhs
            .into_iter()
            .map(|u| LagemonitorUhsZahl {
                id: u.id,
                bezeichnung: u.bezeichnung,
                typ: u.typ,
                status: u.status,
                belegt: u.belegt,
                plaetze: u.plaetze,
                kraefte: u.kraefte,
            })
            .collect(),
        sofortmeldungen_offen: verdichtet.sofortmeldungen_offen,
        lagemeldung: lagemeldung(pool, einsatz_id).await?,
        sanitaetsdienst: verdichtet.sanitaetsdienst,
    };
    Ok(Json(LagemonitorLage {
        api_version: API_VERSION,
        stand_at,
        einsatz: Some(einsatz),
        karte,
        karte_etag,
    }))
}

/// Fassung der Karte: die ersten 16 Hex-Zeichen des SHA-256 ihrer Serialisierung.
fn karte_etag(karte: &Value) -> String {
    let text = serde_json::to_string(karte).expect("Karte ist serialisierbar");
    crate::anhang::repo::sha256_hex(text.as_bytes())[..16].to_string()
}

/// Eine gespeicherte GeoJSON-Geometrie; ein Feature wird auf seine Geometrie zurückgeführt.
/// Kaputtes bleibt weg, statt die ganze Antwort scheitern zu lassen.
fn geometrie(roh: &str) -> Option<Value> {
    let wert: Value = serde_json::from_str(roh).ok()?;
    match wert.get("type").and_then(Value::as_str) {
        Some("Feature") => wert.get("geometry").cloned(),
        Some(_) => Some(wert),
        None => None,
    }
}

fn punkt(lat: f64, lon: f64) -> Value {
    json!({ "type": "Point", "coordinates": [lon, lat] })
}

fn feature(geometrie: Value, properties: Value) -> Value {
    json!({ "type": "Feature", "geometry": geometrie, "properties": properties })
}

/// Die Lagekarte (D5): Einsatzort, Gefahrenzonen, Abschnittsflächen, UHS und die einsatzweiten
/// freien Zeichen. Freie Zeichen nur mit ihrer Zeichenbeschreibung, ohne Beschriftung (Freitext);
/// Zeichen einer Kartenansicht gehören zu dieser Ansicht und bleiben weg.
async fn baue_karte(
    pool: &SqlitePool,
    kopf: &crate::einsatz::Einsatz,
    verdichtet: &super::lagemonitor::LagemonitorAnzeige,
) -> Result<Value, AppError> {
    let mut features = Vec::new();
    if let (Some(lat), Some(lon)) = (kopf.einsatzort_lat, kopf.einsatzort_lon) {
        features.push(feature(punkt(lat, lon), json!({ "kind": "einsatzort" })));
    }
    for zone in &verdichtet.zonen {
        if let Some(g) = geometrie(&zone.geometrie) {
            features.push(feature(
                g,
                json!({ "kind": "zone", "id": zone.id, "typ": zone.typ }),
            ));
        }
    }
    for abschnitt in &verdichtet.abschnitte {
        if let Some(g) = geometrie(&abschnitt.flaeche_geojson) {
            features.push(feature(
                g,
                json!({
                    "kind": "abschnitt",
                    "id": abschnitt.id,
                    "bezeichnung": abschnitt.bezeichnung,
                    "kurzbezeichnung": abschnitt.kurzbezeichnung,
                }),
            ));
        }
    }
    for uhs in &verdichtet.uhs {
        if let (Some(lat), Some(lon)) = (uhs.lat, uhs.lon) {
            features.push(feature(
                punkt(lat, lon),
                json!({
                    "kind": "uhs",
                    "id": uhs.id,
                    "bezeichnung": uhs.bezeichnung,
                    "typ": uhs.typ,
                    "belegt": uhs.belegt,
                    "plaetze": uhs.plaetze,
                }),
            ));
        }
    }
    let zeichen: Vec<(i64, f64, f64, String)> = sqlx::query_as(
        "SELECT id, lat, lon, zeichen_spec FROM freies_zeichen \
         WHERE einsatz_id = ? AND ansicht_id IS NULL ORDER BY id",
    )
    .bind(kopf.id)
    .fetch_all(pool)
    .await?;
    for (id, lat, lon, zeichen_spec) in zeichen {
        features.push(feature(
            punkt(lat, lon),
            json!({ "kind": "zeichen", "id": id, "zeichen_spec": zeichen_spec }),
        ));
    }
    Ok(json!({ "type": "FeatureCollection", "features": features }))
}

/// Abschnitt `zusammenfassung` des jüngsten freigegebenen Lageberichts der Vorlage
/// `lagebericht` (D6). Leer oder geschwärzt: `None`.
async fn lagemeldung(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Option<LagemonitorLagemeldung>, AppError> {
    let zeile: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT abschnitte, freigegeben_at FROM lagebericht \
         WHERE einsatz_id = ? AND status = 'freigegeben' AND vorlage = 'lagebericht' \
         ORDER BY freigegeben_at DESC, id DESC LIMIT 1",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    let Some((abschnitte, Some(freigegeben_at))) = zeile else {
        return Ok(None);
    };
    #[derive(Deserialize)]
    struct Abschnitt {
        schluessel: String,
        text: String,
    }
    let abschnitte: Vec<Abschnitt> = serde_json::from_str(&abschnitte).unwrap_or_default();
    Ok(abschnitte
        .into_iter()
        .find(|a| a.schluessel == "zusammenfassung")
        .map(|a| a.text.trim().to_string())
        .filter(|t| !t.is_empty())
        .map(|text| LagemonitorLagemeldung {
            text,
            freigegeben_at,
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geometrie_nimmt_feature_und_geometrie_und_verwirft_kaputtes() {
        let g = r#"{"type":"Polygon","coordinates":[[[10,52],[10.1,52],[10,52.1],[10,52]]]}"#;
        assert_eq!(geometrie(g).unwrap()["type"], "Polygon");
        let f = format!(r#"{{"type":"Feature","properties":{{}},"geometry":{g}}}"#);
        assert_eq!(geometrie(&f).unwrap()["type"], "Polygon");
        assert!(geometrie("kein json").is_none());
        assert!(geometrie("{}").is_none());
    }

    #[test]
    fn karte_etag_haengt_am_inhalt() {
        let a = json!({"type": "FeatureCollection", "features": []});
        let b = json!({"type": "FeatureCollection", "features": [{"x": 1}]});
        assert_eq!(karte_etag(&a), karte_etag(&a));
        assert_ne!(karte_etag(&a), karte_etag(&b));
        assert_eq!(karte_etag(&a).len(), 16);
    }
}
