//! Gemeinsame Handler-Logik der Vorlagen-Dokumente (`routes::befehl`, `routes::lagebericht`).
//! Die Handler selbst stehen weiter in den beiden Route-Modulen und reichen nur durch; hier
//! liegen Rechteprüfung, Validierung, Repo-Aufruf und Live-Ereignis, für beide Arten gleich.

use crate::anhang;
use crate::app::AppState;
use crate::auth::Benutzer;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::normalisiere_zeit;
use crate::live::LiveEvent;
use crate::routes::support::{anhang_antwort, pflicht, pflicht_tri, Fassung};
use crate::vorlagendokument::anlage::{
    self, AnlageArt, DokumentAnlageAnzeige, NeueAnlage, ERLAUBTE_MIME_ANLAGE,
};
use crate::vorlagendokument::repo::{self as dok_repo, Patch};
use crate::vorlagendokument::{vorlage, Abschnittsart, Dokumentart, STATUS_ENTWURF};
use crate::zeit::jetzt;
use axum::extract::Multipart;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::Deserialize;

/// Was die Routen einer Dokumentart über [`Dokumentart`] hinaus brauchen.
pub trait DokumentRoute: Dokumentart {
    /// Modul-Key für die Modul-Freigabe (LFH-132).
    const MODUL_KEY: &'static str;
    /// Live-Ereignis und Schlüssel der Objekt-id in seiner Payload.
    const LIVE: LiveEvent;
    const LIVE_ID: &'static str;
}

/// SSE-Notify: Dokumente des Einsatzes haben sich geändert.
fn sse<T: DokumentRoute>(state: &AppState, einsatz_id: i64, id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, T::LIVE, T::LIVE_ID, id);
}

/// SSE-Notify eines Entwurfs-PATCH, der nur Abschnitte geändert hat (LFH-931): `nur_inhalt`
/// sagt anderen Tabs, dass die Kopfliste gleich bleibt und nur das Detail abzugleichen ist.
fn sse_nur_inhalt<T: DokumentRoute>(state: &AppState, einsatz_id: i64, id: i64) {
    state
        .live
        .publiziere_objekt_mit(einsatz_id, T::LIVE, T::LIVE_ID, id, &["nur_inhalt"]);
}

/// SSE-Notify einer Änderung an den Anlagen (LFH-1028): `anlagen` sagt anderen Tabs, dass nur
/// die Anlagenliste dieses Dokuments abzugleichen ist; Kopf und Text bleiben.
fn sse_anlagen<T: DokumentRoute>(state: &AppState, einsatz_id: i64, id: i64) {
    state
        .live
        .publiziere_objekt_mit(einsatz_id, T::LIVE, T::LIVE_ID, id, &["anlagen"]);
}

/// Lesezugriff (inkl. Beobachter) plus Modul-Freigabe.
async fn fordere_lesen<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        T::MODUL_KEY,
        benutzer,
        rolle,
    )
    .await
}

/// Schreibrecht plus Modul-Freigabe, Einsatz aktiv.
async fn fordere_schreiben<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        T::MODUL_KEY,
        benutzer,
        rolle,
    )
    .await?;
    fordere_aktiv(&einsatz)
}

pub async fn liste<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
) -> Result<Json<Vec<T::Kopf>>, AppError> {
    fordere_lesen::<T>(state, benutzer, einsatz_id).await?;
    let alle = dok_repo::liste_koepfe::<T>(&state.pool, einsatz_id).await?;
    Ok(Json(alle.into_iter().map(Into::into).collect()))
}

pub async fn detail<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
) -> Result<Json<T::Anzeige>, AppError> {
    fordere_lesen::<T>(state, benutzer, einsatz_id).await?;
    Ok(Json(
        dok_repo::laden::<T>(&state.pool, einsatz_id, id)
            .await?
            .into(),
    ))
}

/// Anlegen. `abschnitte` ist der optionale Startinhalt (LFH-548): damit entsteht der Entwurf in
/// EINEM Schritt mit Text, statt als leeres Skelett, das ein zweiter PATCH füllt und bei dessen
/// Scheitern leer stehen bliebe (die Übernahme aus Meldebild und Funkplan).
#[derive(Debug, Deserialize)]
pub struct AnlegenBody<A> {
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: Option<String>,
    #[serde(default = "Option::default")]
    pub abschnitte: Option<Vec<A>>,
}

/// Jeder Schlüssel gehört zur Vorlage und kommt höchstens einmal vor. Enum-artig: der Schlüssel
/// wird gegen die feste Schlüsselmenge der Vorlage geprüft, scheitert also am Feld selbst → 400
/// (LFH-305). Geteilt von Anlegen (Startinhalt) und Bearbeiten.
fn pruefe_abschnitts_schluessel<A: Abschnittsart>(
    v: &crate::vorlagendokument::VorlageDef,
    abschnitte: &[A],
) -> Result<(), AppError> {
    for (i, a) in abschnitte.iter().enumerate() {
        if !v.abschnitte.iter().any(|d| d.schluessel == a.schluessel()) {
            return Err(AppError::Validation(format!(
                "Unbekannter Abschnitts-Schlüssel «{}»",
                a.schluessel()
            )));
        }
        if abschnitte[..i]
            .iter()
            .any(|b| b.schluessel() == a.schluessel())
        {
            return Err(AppError::Validation(format!(
                "Abschnitts-Schlüssel «{}» doppelt",
                a.schluessel()
            )));
        }
    }
    Ok(())
}

pub async fn anlegen<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    body: AnlegenBody<T::Abschnitt>,
) -> Result<(StatusCode, Json<T::Anzeige>), AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;

    let Some(v) = vorlage::<T>(&body.vorlage) else {
        return Err(AppError::Validation("Unbekannte Vorlage".into()));
    };
    if let Some(abs) = &body.abschnitte {
        pruefe_abschnitts_schluessel(v, abs)?;
    }
    let titel = pflicht(&body.titel, "Titel")?;
    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => normalisiere_zeit(z)?,
        None => jetzt(),
    };

    let dok = dok_repo::anlegen::<T>(
        &state.pool,
        einsatz_id,
        &body.vorlage,
        &titel,
        &zeitstand,
        benutzer.id,
        body.abschnitte.as_deref(),
    )
    .await?;
    sse::<T>(state, einsatz_id, dok.id);
    Ok((StatusCode::CREATED, Json(dok.into())))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody<A> {
    pub titel: Option<String>,
    pub zeitstand: Option<String>,
    pub abschnitte: Option<Vec<A>>,
}

/// Nur solange Entwurf (sonst 422).
pub async fn aktualisieren<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
    body: PatchBody<T::Abschnitt>,
) -> Result<Json<T::Anzeige>, AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;

    let vorher = dok_repo::laden::<T>(&state.pool, einsatz_id, id).await?;
    if vorher.status != STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity(
            "Nur Entwürfe können bearbeitet werden".into(),
        ));
    }

    let titel = pflicht_tri(body.titel.as_deref(), "Titel")?;
    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => Some(normalisiere_zeit(z)?),
        None => None,
    };
    if let Some(abs) = &body.abschnitte {
        let v = vorlage::<T>(&vorher.vorlage)
            .ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
        pruefe_abschnitts_schluessel(v, abs)?;
    }

    let dok = dok_repo::aktualisiere::<T>(
        &state.pool,
        einsatz_id,
        id,
        Patch {
            titel: titel.as_deref(),
            zeitstand: zeitstand.as_deref(),
            abschnitte: body.abschnitte.as_deref(),
        },
    )
    .await?;
    // Titel und Zeitstand sind die einzigen Kopffelder, die ein PATCH ändern kann; bleiben sie,
    // sieht die Liste nichts Neues (`DokumentKopf` trägt kein `aktualisiert_at`).
    if dok.titel == vorher.titel && dok.zeitstand == vorher.zeitstand {
        sse_nur_inhalt::<T>(state, einsatz_id, id);
    } else {
        sse::<T>(state, einsatz_id, id);
    }
    Ok(Json(dok.into()))
}

/// Rendert und snapshottet ins ETB.
pub async fn freigeben<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
) -> Result<Json<T::Anzeige>, AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;

    // Laden, Status prüfen, validieren, rendern und schreiben in EINER Transaktion, auf
    // demselben Weg wie der Demo-Import (LFH-690).
    let dok = dok_repo::freigeben_gerendert::<T>(&state.pool, einsatz_id, id, benutzer.id).await?;

    if let Some(etb_id) = dok.etb_eintrag_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    sse::<T>(state, einsatz_id, id);
    Ok(Json(dok.into()))
}

#[derive(Debug, Deserialize)]
pub struct FortschreibenBody {
    pub zeitstand: Option<String>,
}

/// Neue Entwurfs-Version aus einem freigegebenen Dokument.
pub async fn fortschreiben<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
    body: FortschreibenBody,
) -> Result<(StatusCode, Json<T::Anzeige>), AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;

    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => normalisiere_zeit(z)?,
        None => jetzt(),
    };
    let dok =
        dok_repo::fortschreiben::<T>(&state.pool, einsatz_id, id, benutzer.id, &zeitstand).await?;
    sse::<T>(state, einsatz_id, dok.id);
    Ok((StatusCode::CREATED, Json(dok.into())))
}

// ── Bild-Anlagen (LFH-1028, Spec `dokument-anlagen`) ──────────────────────────────────────

/// Liste der lebenden Anlagen eines Dokuments. Lesezugriff wie das Detail.
pub async fn anlagen<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
) -> Result<Json<Vec<DokumentAnlageAnzeige>>, AppError> {
    fordere_lesen::<T>(state, benutzer, einsatz_id).await?;
    Ok(Json(anlage::liste::<T>(&state.pool, einsatz_id, id).await?))
}

/// Die Felder eines Anlagen-Uploads: `datei` (genau eine), `art`, `titel`, `stand_at`. Ein
/// unbekanntes Feld ist 400, damit ein Tippfehler im Client nicht still eine Vorgabe greift.
struct AnlagenUpload {
    dateiname: String,
    daten: Vec<u8>,
    art: AnlageArt,
    titel: String,
    stand_at: String,
}

async fn lies_anlagen_upload(multipart: &mut Multipart) -> Result<AnlagenUpload, AppError> {
    let mut datei: Option<(String, Vec<u8>)> = None;
    let (mut art, mut titel, mut stand_at) = (None, None, None);
    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        let name = feld.name().unwrap_or_default().to_string();
        if name == "datei" {
            let Some(dateiname) = feld.file_name().map(str::to_string) else {
                return Err(AppError::Validation(
                    "Das Feld „datei“ trägt keine Datei".into(),
                ));
            };
            if datei.is_some() {
                return Err(AppError::Validation("Genau eine Datei je Anlage".into()));
            }
            // Frühe Endungsprüfung, bevor die Bytes gelesen werden.
            anhang::ermittle_mime_aus(&dateiname, ERLAUBTE_MIME_ANLAGE)?;
            let daten = feld
                .bytes()
                .await
                .map_err(|e| AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}")))?;
            datei = Some((dateiname, daten.to_vec()));
            continue;
        }
        let ziel = match name.as_str() {
            "art" => &mut art,
            "titel" => &mut titel,
            "stand_at" => &mut stand_at,
            _ => {
                return Err(AppError::Validation(format!(
                    "Unbekanntes Feld «{name}» im Upload"
                )))
            }
        };
        let text = feld
            .text()
            .await
            .map_err(|e| AppError::Validation(format!("Feld «{name}» unlesbar: {e}")))?;
        if ziel.replace(text).is_some() {
            return Err(AppError::Validation(format!("Feld «{name}» doppelt")));
        }
    }
    let (dateiname, daten) =
        datei.ok_or_else(|| AppError::Validation("Keine Datei im Upload".into()))?;
    let art = art.ok_or_else(|| AppError::Validation("Art fehlt".into()))?;
    let art = AnlageArt::parse(art.trim())
        .ok_or_else(|| AppError::Validation(format!("Unbekannte Anlagen-Art «{art}»")))?;
    let titel = pflicht(titel.as_deref().unwrap_or_default(), "Titel")?;
    let stand_at = normalisiere_zeit(
        stand_at
            .as_deref()
            .ok_or_else(|| AppError::Validation("Stand fehlt".into()))?,
    )?;
    Ok(AnlagenUpload {
        dateiname,
        daten,
        art,
        titel,
        stand_at,
    })
}

/// Anlage anfügen. Reihenfolge: Gate (403/409) → Felder (400) → Typ, Größe, Scan
/// (400/422/503) → EINE Transaktion aus Statusprüfung (404/422), Höchstzahl (409), Datei und
/// Linker. Der Scan läuft vor der Transaktion, damit kein Schreib-Lock über die Scandauer
/// gehalten wird.
pub async fn anlage_ablegen<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<DokumentAnlageAnzeige>), AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;
    anlage::tabelle::<T>()?;
    let upload = lies_anlagen_upload(&mut multipart).await?;
    let mime =
        anhang::pruefe_vor_persist(&upload.dateiname, &upload.daten, ERLAUBTE_MIME_ANLAGE).await?;
    let neu = anlage::ablegen::<T>(
        &state.pool,
        einsatz_id,
        id,
        benutzer.id,
        &NeueAnlage {
            art: upload.art,
            titel: &upload.titel,
            stand_at: &upload.stand_at,
            dateiname: &upload.dateiname,
            mime: &mime,
            daten: &upload.daten,
        },
    )
    .await?;
    sse_anlagen::<T>(state, einsatz_id, id);
    Ok((StatusCode::CREATED, Json(neu)))
}

/// Download einer Anlage (ETag/304). Der Linker-Lookup IST die Zugriffsprüfung. Ein Original
/// gibt es nicht: das PNG entsteht im Browser und trägt keine Gerätedaten (400).
pub async fn anlage_datei<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
    anlage_id: i64,
    fassung: Fassung,
    req_headers: &HeaderMap,
) -> Result<Response, AppError> {
    fordere_lesen::<T>(state, benutzer, einsatz_id).await?;
    if fassung == Fassung::Original {
        return Err(AppError::Validation(
            "Für Anlagen gibt es keine Originalfassung".into(),
        ));
    }
    let anhang_id =
        anlage::anhang_id_fuer_download::<T>(&state.pool, einsatz_id, id, anlage_id).await?;
    anhang_antwort(&state.pool, anhang_id, req_headers, fassung).await
}

/// Anlage entfernen, nur im Entwurf (422 sonst). Datei und Linker gehen hart.
pub async fn anlage_entfernen<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
    anlage_id: i64,
) -> Result<StatusCode, AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;
    anlage::entfernen::<T>(&state.pool, einsatz_id, id, anlage_id).await?;
    sse_anlagen::<T>(state, einsatz_id, id);
    Ok(StatusCode::NO_CONTENT)
}
