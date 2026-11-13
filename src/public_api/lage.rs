//! `GET /api/v1/lage` (LLH-1638, Spec `lage-schnittstelle`, ADR-0034): das Lagebild des Einsatzes,
//! den die Einsatzleitung für den Zugang freigegeben hat ([`super::freigabe`]).
//!
//! Die Zahlen kommen aus derselben Verdichtung wie beim gekoppelten Lagemonitor
//! (`routes::lagemonitor::verdichte`). **Keine Namen, keine Personenkennungen, keine freien
//! Notizen** (ADR-0022): gezeigt werden nur Bezeichnungen (Einsatz, Abschnitte, UHS) und die
//! Zusammenfassung des jüngsten freigegebenen Lageberichts, die für die Weitergabe geschrieben
//! ist. Die Karte trägt die Koordinate des Einsatzorts, nicht seine Adresse.
//!
//! Alle Typen hier sind eigene v1-Schemas. Enums werden mit erschöpfendem `From` aus den internen
//! abgebildet: ein neuer interner Wert bricht den Build, statt still im Vertrag zu erscheinen.
//! Herleitung:
//! `openspec/changes/archive/2026-11-12-f658d8o6-lage-fuer-maschinenzugaenge/design.md` (D1, D6–D8).

use super::error::ApiError;
use super::freigabe;
use super::machine::MachineClient;
use crate::app::AppState;
use crate::einsatz::{Einsatz, Einsatzart};
use crate::error::AppError;
use crate::instanz::spiegel::Freigabestufe;
use crate::lage_zone::LageZoneTyp;
use crate::routes::lagemonitor::{
    karte_etag, lagemeldung, load_karten_features, verdichte, KartenFeature, KartenFeatureArt,
    LagemonitorAnzeige, LagemonitorLagemeldung,
};
use crate::uhs::{UhsStatus, UhsTyp};
use crate::wire_enum::wire_enum;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};

/// `?karte=`, mit dem ein Fremdsystem die Karte abbestellt.
pub const KARTE_NONE: &str = "none";

wire_enum! {
    /// Art des Einsatzes.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum LageEinsatzart {
        Realeinsatz => "realeinsatz",
        Uebung => "uebung",
        Sanitaetsdienst => "sanitaetsdienst",
        Bereitstellung => "bereitstellung",
    }
}

impl From<Einsatzart> for LageEinsatzart {
    fn from(art: Einsatzart) -> Self {
        match art {
            Einsatzart::Realeinsatz => LageEinsatzart::Realeinsatz,
            Einsatzart::Uebung => LageEinsatzart::Uebung,
            Einsatzart::Sanitaetsdienst => LageEinsatzart::Sanitaetsdienst,
            Einsatzart::Bereitstellung => LageEinsatzart::Bereitstellung,
        }
    }
}

wire_enum! {
    /// Art einer Unfallhilfsstelle.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum LageUhsKind {
        Patientenablage => "patientenablage",
        Behandlungsplatz => "behandlungsplatz",
        Verletztensammelstelle => "verletztensammelstelle",
        Sonstige => "sonstige",
    }
}

impl From<UhsTyp> for LageUhsKind {
    fn from(typ: UhsTyp) -> Self {
        match typ {
            UhsTyp::Patientenablage => LageUhsKind::Patientenablage,
            UhsTyp::Behandlungsplatz => LageUhsKind::Behandlungsplatz,
            UhsTyp::Verletztensammelstelle => LageUhsKind::Verletztensammelstelle,
            UhsTyp::Sonstige => LageUhsKind::Sonstige,
        }
    }
}

wire_enum! {
    /// Zustand einer Unfallhilfsstelle. Aufgelöste stehen nicht in der Lage.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum LageUhsState {
        Geplant => "geplant",
        Aktiv => "aktiv",
        Aufgeloest => "aufgeloest",
    }
}

impl From<UhsStatus> for LageUhsState {
    fn from(status: UhsStatus) -> Self {
        match status {
            UhsStatus::Geplant => LageUhsState::Geplant,
            UhsStatus::Aktiv => LageUhsState::Aktiv,
            UhsStatus::Aufgeloest => LageUhsState::Aufgeloest,
        }
    }
}

wire_enum! {
    /// Art einer Gefahrenzone in der Karte.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum LageZoneKind {
        Gefahrengebiet => "gefahrengebiet",
        Absperrbereich => "absperrbereich",
        Absperrgrenze => "absperrgrenze",
        Sperrgebiet => "sperrgebiet",
    }
}

/// Die Zonenart für die Karte. Evakuierungsbezirke und freie Skizzen sind keine Gefahrenzonen
/// und kommen nicht in die Lage (die Verdichtung liefert sie schon nicht).
fn zone_kind(typ: LageZoneTyp) -> Option<LageZoneKind> {
    match typ {
        LageZoneTyp::Gefahrengebiet => Some(LageZoneKind::Gefahrengebiet),
        LageZoneTyp::Absperrbereich => Some(LageZoneKind::Absperrbereich),
        LageZoneTyp::Absperrgrenze => Some(LageZoneKind::Absperrgrenze),
        LageZoneTyp::Sperrgebiet => Some(LageZoneKind::Sperrgebiet),
        LageZoneTyp::FreieSkizze | LageZoneTyp::Evakuierungsbezirk => None,
    }
}

/// Antwort von `GET /api/v1/lage`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageResponse {
    /// Zeitpunkt der Berechnung (UTC, `JJJJ-MM-TT hh:mm:ss`).
    pub stand_at: String,
    /// Der freigegebene, laufende Einsatz; `null`, wenn keiner freigegeben ist.
    #[schema(required)]
    pub einsatz: Option<LageEinsatz>,
    /// Lagekarte als GeoJSON-FeatureCollection; fehlt ohne Einsatz, bei `?karte=none` und wenn
    /// sie der Fassung aus `?karte=<karte_etag>` gleicht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub karte: Option<LageKarte>,
    /// Fassung der Karte; fehlt ohne Einsatz und bei `?karte=none`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub karte_etag: Option<String>,
}

/// Der gelesene Einsatz, ohne Sachverhalt, Adresse und meldende Stelle. Die Koordinate des
/// Einsatzorts steht als Feature `einsatzort` in der Karte.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageEinsatz {
    /// Kennung des Einsatzes; Ereignisse nennen sie als `einsatz_id`.
    pub id: i64,
    pub bezeichnung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stichwort: Option<String>,
    pub einsatzart: LageEinsatzart,
    /// Beginn des Einsatzes (UTC, `JJJJ-MM-TT hh:mm:ss`).
    pub begonnen_at: String,
    pub betroffene: LageBetroffene,
    pub kraefte: LageKraefte,
    /// Nicht aufgelöste Unfallhilfsstellen mit Belegung als Zahl; ihre Lage steht in der Karte.
    pub uhs: Vec<LageUhs>,
    /// Unbestätigte, nicht erledigte Sofortmeldungen; nur die Zahl.
    pub sofortmeldungen_offen: i64,
    /// Zusammenfassung des jüngsten freigegebenen Lageberichts; `null` ohne einen.
    #[schema(required)]
    pub lagemeldung: Option<LageLagemeldung>,
    /// Hilfeleistungen in Zahlen; nur wenn am Einsatz die Reihe „Sanitätsdienst“ gewählt ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sanitaetsdienst: Option<LageSanitaetsdienst>,
    /// Nur wenn diese Instanz den Einsatz als Spiegel einer anderen hält: die Zahlen sind so
    /// alt wie der letzte Abgleich.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spiegel: Option<LageSpiegel>,
}

/// Betroffene in Zahlen.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageBetroffene {
    pub gesamt: i64,
    /// Sichtungskategorie I bis IV zusammen.
    pub patienten: i64,
    pub sk1: i64,
    pub sk2: i64,
    pub sk3: i64,
    pub sk4: i64,
    pub tot: i64,
    pub unverletzt: i64,
    /// Noch nicht gesichtet.
    pub ohne: i64,
    pub vermisst: i64,
    /// Abgeschlossene Patienten: in `gesamt` enthalten, in keiner Sichtungszahl.
    pub abgeschlossen: i64,
}

/// Kräfte in Zahlen.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageKraefte {
    pub einheiten: i64,
    pub personal: i64,
    pub staerke: LageStaerke,
}

/// Taktische Stärke: Führer / Unterführer / Mannschaft.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageStaerke {
    pub fuehrer: u16,
    pub unterfuehrer: u16,
    pub mannschaft: u16,
}

/// Eine Unfallhilfsstelle in Zahlen.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageUhs {
    pub id: i64,
    pub bezeichnung: String,
    pub kind: LageUhsKind,
    pub state: LageUhsState,
    /// Personen, die gerade dort liegen.
    pub belegt: i64,
    /// Plätze ohne Wartebereich.
    pub plaetze: i64,
    /// Stärke der zugeordneten Kräfte.
    pub kraefte: i64,
}

/// Die Lagemeldung.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageLagemeldung {
    pub text: String,
    /// Freigabe des Lageberichts (UTC, `JJJJ-MM-TT hh:mm:ss`).
    pub freigegeben_at: String,
}

/// Hilfeleistungen der Reihe „Sanitätsdienst“ in Zahlen.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageSanitaetsdienst {
    /// Alle Personen außer Vermissten.
    pub kontakte: i64,
    /// Kontakte, die in den letzten 60 Minuten erfasst wurden.
    pub kontakte_letzte_stunde: i64,
    /// Angetroffene, die noch nicht abgeschlossen sind.
    pub in_versorgung: i64,
    pub transporte: i64,
}

/// Abgleich eines gespiegelten Einsatzes mit der Instanz, die ihn führt.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageSpiegel {
    /// Letzter erfolgreicher Abgleich (UTC, `JJJJ-MM-TT hh:mm:ss`); `null`, solange keiner lief.
    #[schema(required)]
    pub letzter_abgleich_at: Option<String>,
    /// Der Abgleich ist beendet; die Zahlen werden nicht mehr aktuell.
    pub abgleich_beendet: bool,
}

/// Die Lagekarte: eine GeoJSON-FeatureCollection.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageKarte {
    /// Immer `FeatureCollection`.
    #[serde(rename = "type")]
    pub typ: &'static str,
    pub features: Vec<LageKarteFeature>,
}

/// Ein GeoJSON-Feature der Lagekarte.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageKarteFeature {
    /// Immer `Feature`.
    #[serde(rename = "type")]
    pub typ: &'static str,
    /// GeoJSON-Geometrie (Punkt, Linie oder Fläche) in WGS 84.
    #[schema(value_type = Object)]
    pub geometry: Value,
    pub properties: LageKarteProperties,
}

/// Was ein Feature zeigt; `kind` nennt die Art. Ein Client überspringt unbekannte Arten.
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LageKarteProperties {
    /// Die Koordinate des Einsatzorts.
    Einsatzort,
    /// Gefahrenzone.
    Zone { id: i64, subkind: LageZoneKind },
    /// Fläche eines Einsatzabschnitts.
    Abschnitt {
        id: i64,
        bezeichnung: String,
        /// Kurzbezeichnung im Einsatz, etwa „EA-N“.
        #[serde(skip_serializing_if = "Option::is_none")]
        kurzbezeichnung: Option<String>,
    },
    /// Verortete Unfallhilfsstelle; `id` wie in `einsatz.uhs`.
    Uhs {
        id: i64,
        bezeichnung: String,
        subkind: LageUhsKind,
        belegt: i64,
        plaetze: i64,
    },
    /// Freies taktisches Zeichen; `zeichen_spec` ist seine Zeichenbeschreibung als JSON-Text,
    /// ohne Beschriftung.
    Zeichen { id: i64, zeichen_spec: String },
}

/// Abfrage von `GET /api/v1/lage`.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct LageParams {
    /// `none` bestellt die Karte ab. Sonst die Fassung (`karte_etag`), die das Fremdsystem schon
    /// hat: gleicht sie der aktuellen, fehlt `karte` in der Antwort.
    pub karte: Option<String>,
}

/// Tabellen, aus denen die Lage stammt. Hält diese Instanz den Einsatz als Spiegel, muss dessen
/// Freigabestufe die Kategorie jeder dieser Tabellen liefern (design.md D8). Wächter:
/// `tests::jede_quelle_hat_eine_kategorie`.
const QUELLEN: &[&str] = &[
    "einsatz",
    "einsatz_person",
    "einsatz_lagekennzahl_wahl",
    "einsatz_personal",
    "einsatz_einheit",
    "uhs",
    "uhs_platz",
    "lagebericht",
    "lage_zone",
    "einsatzabschnitt",
    "freies_zeichen",
    "meldung",
    "kommunikation_status",
];

/// Liefert die Stufe alles, woraus die Lage stammt? Eine unbekannte Stufe liefert nichts. v1
/// kann Pflichtfelder nicht einzeln weglassen: fehlt eine Kategorie, gibt es keine Lage.
fn is_lage_vollstaendig(stufe: Option<Freigabestufe>) -> bool {
    let Some(stufe) = stufe else {
        return false;
    };
    QUELLEN
        .iter()
        .all(|t| crate::instanz::spiegel::art::kategorie(t).is_some_and(|k| stufe.liefert(k)))
}

/// Führt eine gespeicherte GeoJSON-Geometrie auf `type` und `coordinates` zurück (bei einer
/// `GeometryCollection` auf `type` und `geometries`). Die Zonen- und Abschnittsrouten speichern
/// den gesendeten Text; ein Zusatzschlüssel darin (etwa eine Notiz) ginge sonst mit hinaus.
/// Unbekanntes bleibt weg.
fn geometry(roh: &Value) -> Option<Value> {
    let typ = roh.get("type")?.as_str()?;
    match typ {
        "Point" | "MultiPoint" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon" => {
            let coordinates = roh.get("coordinates")?;
            is_zahlenfeld(coordinates)
                .then(|| serde_json::json!({ "type": typ, "coordinates": coordinates }))
        }
        "GeometryCollection" => {
            let geometries: Vec<Value> = roh
                .get("geometries")?
                .as_array()?
                .iter()
                .filter_map(geometry)
                .collect();
            Some(serde_json::json!({ "type": typ, "geometries": geometries }))
        }
        _ => None,
    }
}

/// Besteht der Wert nur aus Zahlen und Listen davon? So tragen Koordinaten keinen Text.
fn is_zahlenfeld(wert: &Value) -> bool {
    match wert {
        Value::Number(_) => true,
        Value::Array(teile) => teile.iter().all(is_zahlenfeld),
        _ => false,
    }
}

/// Die Karte in der Form der öffentlichen API (design.md D7).
fn lage_karte(features: Vec<KartenFeature>) -> LageKarte {
    let features = features
        .into_iter()
        .filter_map(|f| {
            let properties = match f.art {
                KartenFeatureArt::Einsatzort => LageKarteProperties::Einsatzort,
                KartenFeatureArt::Zone { id, typ } => LageKarteProperties::Zone {
                    id,
                    subkind: zone_kind(typ)?,
                },
                KartenFeatureArt::Abschnitt {
                    id,
                    bezeichnung,
                    kurzbezeichnung,
                } => LageKarteProperties::Abschnitt {
                    id,
                    bezeichnung,
                    kurzbezeichnung,
                },
                KartenFeatureArt::Uhs {
                    id,
                    bezeichnung,
                    typ,
                    belegt,
                    plaetze,
                } => LageKarteProperties::Uhs {
                    id,
                    bezeichnung,
                    subkind: typ.into(),
                    belegt,
                    plaetze,
                },
                KartenFeatureArt::Zeichen { id, zeichen_spec } => {
                    LageKarteProperties::Zeichen { id, zeichen_spec }
                }
            };
            Some(LageKarteFeature {
                typ: "Feature",
                geometry: geometry(&f.geometrie)?,
                properties,
            })
        })
        .collect();
    LageKarte {
        typ: "FeatureCollection",
        features,
    }
}

/// Der Einsatz in der Form der öffentlichen API (design.md D6): Feld für Feld, damit kein
/// internes Feld von selbst mitkommt.
fn lage_einsatz(
    kopf: Einsatz,
    verdichtet: LagemonitorAnzeige,
    lagemeldung: Option<LagemonitorLagemeldung>,
) -> LageEinsatz {
    let b = verdichtet.betroffene;
    let spiegel = kopf.spiegel.spiegel_ist.then(|| LageSpiegel {
        letzter_abgleich_at: kopf.spiegel.spiegel_abgleich_at.clone(),
        abgleich_beendet: kopf.spiegel.spiegel_beendet_at.is_some(),
    });
    LageEinsatz {
        id: kopf.id,
        bezeichnung: kopf.bezeichnung,
        stichwort: kopf.stichwort,
        einsatzart: kopf.einsatzart.into(),
        begonnen_at: kopf.begonnen_at,
        betroffene: LageBetroffene {
            gesamt: b.gesamt,
            patienten: b.patienten,
            sk1: b.sk1,
            sk2: b.sk2,
            sk3: b.sk3,
            sk4: b.sk4,
            tot: b.tot,
            unverletzt: b.unverletzt,
            ohne: b.ohne,
            vermisst: b.vermisst,
            abgeschlossen: b.abgeschlossen,
        },
        kraefte: LageKraefte {
            einheiten: verdichtet.kraefte.einheiten,
            personal: verdichtet.kraefte.personal,
            staerke: LageStaerke {
                fuehrer: verdichtet.kraefte.staerke.fuehrer,
                unterfuehrer: verdichtet.kraefte.staerke.unterfuehrer,
                mannschaft: verdichtet.kraefte.staerke.mannschaft,
            },
        },
        uhs: verdichtet
            .uhs
            .into_iter()
            .map(|u| LageUhs {
                id: u.id,
                bezeichnung: u.bezeichnung,
                kind: u.typ.into(),
                state: u.status.into(),
                belegt: u.belegt,
                plaetze: u.plaetze,
                kraefte: u.kraefte,
            })
            .collect(),
        sofortmeldungen_offen: verdichtet.sofortmeldungen_offen,
        lagemeldung: lagemeldung.map(|l| LageLagemeldung {
            text: l.text,
            freigegeben_at: l.freigegeben_at,
        }),
        sanitaetsdienst: verdichtet.sanitaetsdienst.map(|s| LageSanitaetsdienst {
            kontakte: s.kontakte,
            kontakte_letzte_stunde: s.kontakte_letzte_stunde,
            in_versorgung: s.in_versorgung,
            transporte: s.transporte,
        }),
        spiegel,
    }
}

/// Das Lagebild des Einsatzes, den die Einsatzleitung für diesen Zugang freigegeben hat.
///
/// Ohne Freigabe ist `einsatz` `null`. Gibt die Einsatzleitung einen Einsatz frei oder beendet
/// die Freigabe, ändert sich die Antwort beim nächsten Abruf.
#[utoipa::path(
    get,
    path = "/api/v1/lage",
    tag = "Lage",
    operation_id = "get_lage",
    security(("machine" = ["lage:read"])),
    params(LageParams),
    responses(
        (status = 200, description = "Lagebild; Antwort signiert im Kopf `Lifeline-Signature`", body = LageResponse),
        (status = 401, description = "Anmeldung fehlgeschlagen (Grund nur am Zugang)", body = super::ApiErrorBody),
        (status = 403, description = "Dem Zugang fehlt das Recht `lage:read`", body = super::ApiErrorBody),
        (status = 429, description = "Gedrosselt; `Retry-After` nennt die Wartezeit", body = super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn lage(
    State(state): State<AppState>,
    Query(params): Query<LageParams>,
    client: MachineClient,
) -> Result<Response, ApiError> {
    let pool = &state.pool;
    let stand_at = crate::zeit::jetzt();
    let ohne_einsatz = |stand_at: String| LageResponse {
        stand_at,
        einsatz: None,
        karte: None,
        karte_etag: None,
    };
    let Some(einsatz_id) = freigabe::freigegebener_einsatz(pool, &client.zugang.id).await? else {
        return Ok(client.antwort(StatusCode::OK, &ohne_einsatz(stand_at)));
    };
    let kopf = crate::einsatz::repo::laden(pool, einsatz_id).await?;
    // Die Freigabe kennt nur Einsätze der eigenen Org; doppelt hält besser, denn ein fremder
    // Einsatz hier wäre ein Datenabfluss.
    if kopf.org_id != client.zugang.org_id {
        return Err(AppError::Internal(
            "Freigabe zeigt auf einen Einsatz einer anderen Organisation".into(),
        )
        .into());
    }
    let stufe = crate::routes::lagebild_extern::load_freigabestufe(pool, kopf.id).await?;
    if !is_lage_vollstaendig(stufe) {
        return Ok(client.antwort(StatusCode::OK, &ohne_einsatz(stand_at)));
    }
    let verdichtet = verdichte(pool, einsatz_id).await?;

    let (karte, etag) = if params.karte.as_deref() == Some(KARTE_NONE) {
        (None, None)
    } else {
        let karte = lage_karte(load_karten_features(pool, &kopf, &verdichtet).await?);
        let etag = karte_etag(&karte);
        let gleich = params.karte.as_deref() == Some(etag.as_str());
        ((!gleich).then_some(karte), Some(etag))
    };
    let meldung = lagemeldung(pool, einsatz_id).await?;
    Ok(client.antwort(
        StatusCode::OK,
        &LageResponse {
            stand_at,
            einsatz: Some(lage_einsatz(kopf, verdichtet, meldung)),
            karte,
            karte_etag: etag,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn jede_quelle_hat_eine_kategorie() {
        for t in QUELLEN {
            assert!(
                crate::instanz::spiegel::art::kategorie(t).is_some(),
                "{t} ist keine gespiegelte Tabelle: die Lage am Spiegel wäre unvollständig"
            );
        }
    }

    #[test]
    fn lage_gibt_es_nur_mit_allen_kategorien() {
        assert!(is_lage_vollstaendig(Some(Freigabestufe::Alles)));
        assert!(
            !is_lage_vollstaendig(None),
            "unbekannte Stufe liefert nichts"
        );
    }

    #[test]
    fn nur_gefahrenzonen_kommen_in_die_karte() {
        for typ in LageZoneTyp::ALLE {
            assert_eq!(
                zone_kind(typ).is_some(),
                typ.ist_gefahrenzone(),
                "{}",
                typ.as_str()
            );
            if let Some(kind) = zone_kind(typ) {
                assert_eq!(kind.as_str(), typ.as_str());
            }
        }
    }

    #[test]
    fn enums_tragen_die_werte_der_internen() {
        for art in Einsatzart::ALLE {
            assert_eq!(LageEinsatzart::from(art).as_str(), art.as_str());
        }
        for typ in UhsTyp::ALLE {
            assert_eq!(LageUhsKind::from(typ).as_str(), typ.as_str());
        }
        for status in UhsStatus::ALLE {
            assert_eq!(LageUhsState::from(status).as_str(), status.as_str());
        }
    }

    /// Gespeicherte Geometrien sind der Text des Aufrufers: nur `type` und Koordinaten gehen
    /// hinaus, kein Zusatzschlüssel und kein Text an Stelle einer Zahl.
    #[test]
    fn geometrie_traegt_nur_typ_und_koordinaten() {
        let polygon = json!([[[9.0, 52.0], [9.1, 52.0], [9.0, 52.1], [9.0, 52.0]]]);
        let roh = json!({
            "type": "Polygon",
            "coordinates": polygon,
            "notiz": "Herr Muster gestürzt",
            "properties": { "name": "Muster" },
        });
        assert_eq!(
            geometry(&roh),
            Some(json!({ "type": "Polygon", "coordinates": polygon }))
        );
        let sammlung = json!({
            "type": "GeometryCollection",
            "titel": "Muster",
            "geometries": [roh, { "type": "Unbekannt", "coordinates": [1, 2] }],
        });
        assert_eq!(
            geometry(&sammlung),
            Some(json!({
                "type": "GeometryCollection",
                "geometries": [{ "type": "Polygon", "coordinates": polygon }],
            }))
        );
        // Text an Stelle einer Koordinate, ein Feature oder gar kein Typ: bleibt weg.
        assert_eq!(
            geometry(&json!({ "type": "Point", "coordinates": [9.0, "Muster"] })),
            None
        );
        assert_eq!(
            geometry(&json!({ "type": "Feature", "geometry": roh })),
            None
        );
        assert_eq!(geometry(&json!({ "coordinates": [9.0, 52.0] })), None);

        let karte = lage_karte(vec![
            KartenFeature {
                geometrie: roh.clone(),
                art: KartenFeatureArt::Zone {
                    id: 3,
                    typ: LageZoneTyp::Absperrbereich,
                },
            },
            KartenFeature {
                geometrie: json!({ "type": "Point", "coordinates": "Muster" }),
                art: KartenFeatureArt::Einsatzort,
            },
        ]);
        let text = serde_json::to_string(&karte).unwrap();
        assert!(
            !text.contains("Muster") && !text.contains("notiz"),
            "{text}"
        );
        assert_eq!(karte.features.len(), 1, "die kaputte Geometrie bleibt weg");
    }

    #[test]
    fn karte_nennt_subkind_und_laesst_leere_kurzbezeichnung_weg() {
        let punkt = json!({ "type": "Point", "coordinates": [9.3, 52.1] });
        let feature = |art| KartenFeature {
            geometrie: punkt.clone(),
            art,
        };
        let karte = lage_karte(vec![
            feature(KartenFeatureArt::Einsatzort),
            feature(KartenFeatureArt::Zone {
                id: 3,
                typ: LageZoneTyp::Absperrbereich,
            }),
            // Keine Gefahrenzone: bleibt weg.
            feature(KartenFeatureArt::Zone {
                id: 9,
                typ: LageZoneTyp::FreieSkizze,
            }),
            feature(KartenFeatureArt::Abschnitt {
                id: 4,
                bezeichnung: "Abschnitt Nord".into(),
                kurzbezeichnung: None,
            }),
            feature(KartenFeatureArt::Uhs {
                id: 5,
                bezeichnung: "BHP Nord".into(),
                typ: UhsTyp::Behandlungsplatz,
                belegt: 3,
                plaetze: 10,
            }),
            feature(KartenFeatureArt::Zeichen {
                id: 7,
                zeichen_spec: "{\"v\":1}".into(),
            }),
        ]);
        let v = serde_json::to_value(&karte).unwrap();
        assert_eq!(v["type"], "FeatureCollection");
        let properties: Vec<Value> = v["features"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| {
                assert_eq!(f["type"], "Feature");
                assert_eq!(f["geometry"], punkt);
                f["properties"].clone()
            })
            .collect();
        assert_eq!(
            properties,
            vec![
                json!({ "kind": "einsatzort" }),
                json!({ "kind": "zone", "id": 3, "subkind": "absperrbereich" }),
                json!({ "kind": "abschnitt", "id": 4, "bezeichnung": "Abschnitt Nord" }),
                json!({
                    "kind": "uhs", "id": 5, "bezeichnung": "BHP Nord",
                    "subkind": "behandlungsplatz", "belegt": 3, "plaetze": 10,
                }),
                json!({ "kind": "zeichen", "id": 7, "zeichen_spec": "{\"v\":1}" }),
            ]
        );
    }
}
