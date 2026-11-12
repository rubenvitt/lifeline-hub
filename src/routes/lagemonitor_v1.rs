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
use axum::extract::{Query, State};
use axum::Json;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

use super::lagemonitor::{
    baue_karte, karte_etag, lagemeldung, verdichte, LageQuery, LagemonitorBetroffene,
    LagemonitorKraefte, LagemonitorLagemeldung, LagemonitorUhsZahl, KARTE_AUS,
};

/// Version des Drahtformats (`/v1`).
pub const API_VERSION: u32 = 1;

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
