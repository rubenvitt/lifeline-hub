//! Routen der maßgeblichen Pegel eines Einsatzes (LFH-606).
//!
//! Gate `OhneModul` wie die Einsatz-Kopfdaten: die Kennzahl steht auf Dashboard und
//! Überblick, nicht nur auf der Karte. Alle drei Routen antworten mit der vollständigen
//! Liste samt Messungen — das Frontend setzt damit genau einen Cache-Eintrag.
//!
//! **Kein Live-Ereignis**: die Messwerte ändern sich im 15-min-Raster, die Festlegung ist
//! selten; das Frontend fragt alle 5 min nach.
//!
//! **Linie 400 ↔ 422 (LFH-267):** leerer oder zu langer Name, keine UUID-Form und eine
//! PUT-Liste mit mehr als [`PEGEL_MAX`] Einträgen scheitern am Body für sich → 400. Zwei
//! Fälle sind ein Zusammenhang → 422: eine doppelte Station in einer PUT-Liste (VOR der DB
//! geprüft, sonst käme sie über den UNIQUE-Index als 409 heraus) und ein POST auf eine
//! volle Liste — dort ist der Body für sich gültig, abgelehnt wird am Zustand des Einsatzes.
//!
//! **Prognose (LFH-628)** hat eigene Routen am einzelnen Pegel statt Felder im Listen-PUT:
//! der ist Vollersatz, und die Einstellungsseite schickt beim Umordnen nur Station, Name und
//! Gewässer — eine Prognose im selben Body würde bei jedem Pfeildruck mitgeschrieben oder
//! still genullt. Ein Zeitpunkt in der Vergangenheit wird angenommen (400 nur für die Form):
//! ob eine Prognose abgelaufen ist, entscheidet die Anzeige gegen ihre Uhr, und ein Nachtrag
//! darf nicht an einer Uhrabweichung scheitern.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use std::collections::HashSet;

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::OhneModul;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::pegel::repo::{self, PegelEingabe};
use crate::pegel::{abruf, vorhersage, PegelAnzeige, PegelVorhersageAntwort, NAME_MAX, PEGEL_MAX};

#[derive(Debug, Deserialize)]
pub struct PegelWahl {
    station_uuid: String,
    name: String,
    #[serde(default)]
    gewaesser: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PegelListe {
    stationen: Vec<PegelWahl>,
}

/// Body der Prognose: erwarteter Höchststand in cm und sein Zeitpunkt (ISO-8601).
#[derive(Debug, Deserialize)]
pub struct PrognoseEingabe {
    hoechststand_cm: f64,
    zeitpunkt: String,
}

/// Plausible Spanne eines Wasserstands in cm. Pegelnull liegt an manchen Stationen über der
/// Sohle, negative Werte kommen vor; mehr als 50 m zeigt keine Pegellatte.
pub const PROGNOSE_MIN_CM: f64 = -1000.0;
pub const PROGNOSE_MAX_CM: f64 = 5000.0;

/// Prüft die Prognose für sich (400) und normalisiert den Zeitpunkt aufs Wire-Format.
fn validiere_prognose(p: &PrognoseEingabe) -> Result<(f64, String), AppError> {
    if !p.hoechststand_cm.is_finite()
        || !(PROGNOSE_MIN_CM..=PROGNOSE_MAX_CM).contains(&p.hoechststand_cm)
    {
        return Err(AppError::Validation(format!(
            "hoechststand_cm muss zwischen {PROGNOSE_MIN_CM} und {PROGNOSE_MAX_CM} liegen"
        )));
    }
    let zeit = p.zeitpunkt.trim();
    if zeit.is_empty() {
        return Err(AppError::Validation(
            "zeitpunkt darf nicht leer sein".into(),
        ));
    }
    // Auf ganze Zentimeter: die Quelle misst in ganzen cm, eine Prognose genauer als die
    // Messung wäre Scheingenauigkeit.
    Ok((
        p.hoechststand_cm.round(),
        crate::etb::normalisiere_zeit(zeit)?,
    ))
}

/// Prüft einen Eintrag für sich (400) und normalisiert ihn.
fn validiere(w: PegelWahl) -> Result<PegelEingabe, AppError> {
    let roh = w.station_uuid.trim();
    // Nur die kanonische Bindestrich-Form (36 Zeichen), wie PEGELONLINE sie führt — die
    // geschweifte oder bindestrichlose Schreibweise, die `Uuid::parse_str` auch nähme,
    // ergäbe für dieselbe Station eine zweite Zeile.
    if roh.len() != 36 || uuid::Uuid::parse_str(roh).is_err() {
        return Err(AppError::Validation(format!(
            "station_uuid '{roh}' ist keine UUID"
        )));
    }
    let name = w.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("name darf nicht leer sein".into()));
    }
    if name.chars().count() > NAME_MAX {
        return Err(AppError::Validation(format!(
            "name darf höchstens {NAME_MAX} Zeichen lang sein"
        )));
    }
    let gewaesser = w
        .gewaesser
        .map(|g| g.trim().to_string())
        .filter(|g| !g.is_empty());
    if gewaesser
        .as_deref()
        .is_some_and(|g| g.chars().count() > NAME_MAX)
    {
        return Err(AppError::Validation(format!(
            "gewaesser darf höchstens {NAME_MAX} Zeichen lang sein"
        )));
    }
    Ok(PegelEingabe {
        station_uuid: roh.to_lowercase(),
        name,
        gewaesser,
    })
}

/// Liste samt Messungen. Messungen kommen aus dem Nachschlage-Cache (eigene DB, F09/LFH-240,
/// Fallback auf den operativen Pool — dieselbe Wahl wie `routes::karte::fachebenen`).
///
/// `modus`: der GET darf eine fehlende Messung einmalig abwarten, PUT/POST nie — sie
/// antworten mit dem Cache und stoßen Fehlendes an, der Client fragt ohnehin nach.
async fn anzeige(
    state: &AppState,
    einsatz_id: i64,
    modus: abruf::Modus,
) -> Result<Vec<PegelAnzeige>, AppError> {
    let zeilen = repo::liste(&state.pool, einsatz_id).await?;
    let cache = crate::cache_db::cache_pool(&state.karten_dir).await;
    let cache_pool = cache.as_ref().unwrap_or(&state.pool);
    let uuids: Vec<&str> = zeilen.iter().map(|z| z.station_uuid.as_str()).collect();
    let mut messungen = abruf::messungen(&state.fachebenen, cache_pool, &uuids, modus).await;
    Ok(zeilen
        .into_iter()
        .map(|z| PegelAnzeige {
            messung: messungen.remove(&z.station_uuid),
            prognose: z.prognose(),
            id: z.id,
            station_uuid: z.station_uuid,
            name: z.name,
            gewaesser: z.gewaesser,
            reihenfolge: z.reihenfolge,
        })
        .collect())
}

/// GET /api/einsaetze/{id}/pegel — festgelegte Pegel in Reihenfolge, je mit Messung.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<OhneModul>,
) -> Result<Json<Vec<PegelAnzeige>>, AppError> {
    Ok(Json(
        anzeige(&state, ctx.einsatz.id, abruf::Modus::Warten).await?,
    ))
}

/// PUT /api/einsaetze/{id}/pegel — Liste vollständig ersetzen (Reihenfolge = Array).
pub async fn ersetzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<OhneModul>,
    JsonBody(req): JsonBody<PegelListe>,
) -> Result<Json<Vec<PegelAnzeige>>, AppError> {
    if req.stationen.len() > PEGEL_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {PEGEL_MAX} Pegel je Einsatz"
        )));
    }
    let eintraege = req
        .stationen
        .into_iter()
        .map(validiere)
        .collect::<Result<Vec<_>, _>>()?;
    let mut gesehen = HashSet::new();
    if let Some(doppelt) = eintraege
        .iter()
        .find(|e| !gesehen.insert(e.station_uuid.as_str()))
    {
        return Err(AppError::UnprocessableEntity(format!(
            "station_uuid '{}' steht mehrfach in der Liste",
            doppelt.station_uuid
        )));
    }
    repo::ersetzen(&state.pool, ctx.einsatz.id, ctx.benutzer.id, &eintraege).await?;
    Ok(Json(
        anzeige(&state, ctx.einsatz.id, abruf::Modus::NurCache).await?,
    ))
}

/// POST /api/einsaetze/{id}/pegel — einen Pegel hinten anfügen (Karten-Schnellweg).
/// Neu → 201; schon festgelegt → 200 mit dem Bestand (idempotent).
pub async fn anfuegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<OhneModul>,
    JsonBody(req): JsonBody<PegelWahl>,
) -> Result<(StatusCode, Json<Vec<PegelAnzeige>>), AppError> {
    let eingabe = validiere(req)?;
    let neu = repo::anfuegen(&state.pool, ctx.einsatz.id, ctx.benutzer.id, &eingabe).await?;
    let status = if neu {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((
        status,
        Json(anzeige(&state, ctx.einsatz.id, abruf::Modus::NurCache).await?),
    ))
}

/// PUT /api/einsaetze/{id}/pegel/{pegel_id}/prognose — erwarteten Höchststand setzen
/// (überschreibt einen vorhandenen). Pegel nicht in diesem Einsatz → 404.
pub async fn prognose_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<OhneModul>,
    PfadParam((_, pegel_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<PrognoseEingabe>,
) -> Result<Json<Vec<PegelAnzeige>>, AppError> {
    let (cm, zeit) = validiere_prognose(&req)?;
    if !repo::setze_prognose(
        &state.pool,
        ctx.einsatz.id,
        pegel_id,
        ctx.benutzer.id,
        Some((cm, &zeit)),
    )
    .await?
    {
        return Err(AppError::NotFound);
    }
    Ok(Json(
        anzeige(&state, ctx.einsatz.id, abruf::Modus::NurCache).await?,
    ))
}

/// DELETE /api/einsaetze/{id}/pegel/{pegel_id}/prognose — Prognose löschen. Idempotent: ohne
/// gesetzte Prognose ebenfalls 200. Pegel nicht in diesem Einsatz → 404.
pub async fn prognose_loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<OhneModul>,
    PfadParam((_, pegel_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<PegelAnzeige>>, AppError> {
    if !repo::setze_prognose(&state.pool, ctx.einsatz.id, pegel_id, ctx.benutzer.id, None).await? {
        return Err(AppError::NotFound);
    }
    Ok(Json(
        anzeige(&state, ctx.einsatz.id, abruf::Modus::NurCache).await?,
    ))
}

/// GET /api/einsaetze/{id}/pegel/{pegel_id}/vorhersage — Vorschlag aus der Reihe `WV`
/// (höchster künftiger Wert). Ohne Reihe: 200 ohne `vorhersage`. Quelle nicht erreichbar und
/// nichts im Cache → 502. Pegel nicht in diesem Einsatz → 404.
pub async fn vorhersage_lesen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<OhneModul>,
    PfadParam((_, pegel_id)): PfadParam<(i64, i64)>,
) -> Result<Json<PegelVorhersageAntwort>, AppError> {
    let station = repo::station_von(&state.pool, ctx.einsatz.id, pegel_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let cache = crate::cache_db::cache_pool(&state.karten_dir).await;
    let cache_pool = cache.as_ref().unwrap_or(&state.pool);
    let reihe = vorhersage::reihe(&state.fachebenen, cache_pool, &station)
        .await
        .map_err(|_| {
            AppError::BadGateway("PEGELONLINE-Vorhersage ist gerade nicht erreichbar".into())
        })?;
    Ok(Json(PegelVorhersageAntwort {
        vorhersage: reihe.and_then(|r| vorhersage::hoechststand(&r, chrono::Utc::now())),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wahl(uuid: &str, name: &str) -> PegelWahl {
        PegelWahl {
            station_uuid: uuid.into(),
            name: name.into(),
            gewaesser: None,
        }
    }

    #[test]
    fn uuid_nur_in_kanonischer_form_und_kleingeschrieben() {
        let e = validiere(wahl(" A6EE8177-107B-47DD-BCFD-30960CCC6E9C ", "Köln")).unwrap();
        assert_eq!(e.station_uuid, "a6ee8177-107b-47dd-bcfd-30960ccc6e9c");
        for kaputt in [
            "a6ee8177107b47ddbcfd30960ccc6e9c",
            "{a6ee8177-107b-47dd-bcfd-30960ccc6e9c}",
            "koeln",
            "",
        ] {
            assert!(
                matches!(
                    validiere(wahl(kaputt, "Köln")),
                    Err(AppError::Validation(_))
                ),
                "{kaputt}"
            );
        }
    }

    #[test]
    fn name_grenzen() {
        let uuid = "a6ee8177-107b-47dd-bcfd-30960ccc6e9c";
        assert!(matches!(
            validiere(wahl(uuid, "   ")),
            Err(AppError::Validation(_))
        ));
        assert!(validiere(wahl(uuid, &"ä".repeat(NAME_MAX))).is_ok());
        assert!(matches!(
            validiere(wahl(uuid, &"ä".repeat(NAME_MAX + 1))),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn leeres_gewaesser_wird_none() {
        let mut w = wahl("a6ee8177-107b-47dd-bcfd-30960ccc6e9c", "Köln");
        w.gewaesser = Some("  ".into());
        assert_eq!(validiere(w).unwrap().gewaesser, None);
    }

    fn prognose(cm: f64, zeit: &str) -> PrognoseEingabe {
        PrognoseEingabe {
            hoechststand_cm: cm,
            zeitpunkt: zeit.into(),
        }
    }

    #[test]
    fn prognose_grenzen_und_normalisierung() {
        let (cm, zeit) = validiere_prognose(&prognose(709.6, "2026-09-22T18:00:00+02:00")).unwrap();
        assert_eq!(cm, 710.0);
        assert_eq!(zeit, "2026-09-22 16:00:00");
        for kaputt in [
            prognose(f64::NAN, "2026-09-22T18:00:00Z"),
            prognose(PROGNOSE_MAX_CM + 1.0, "2026-09-22T18:00:00Z"),
            prognose(PROGNOSE_MIN_CM - 1.0, "2026-09-22T18:00:00Z"),
            prognose(700.0, "  "),
            prognose(700.0, "morgen 18 Uhr"),
        ] {
            assert!(
                matches!(validiere_prognose(&kaputt), Err(AppError::Validation(_))),
                "{kaputt:?}"
            );
        }
    }
}
