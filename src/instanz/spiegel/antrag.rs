//! Anträge (design.md D9, D11, Spec `spiegel-antraege`).
//!
//! - Am Spiegel fängt [`schicht`] eine beantragbare Erfassung ab ([`BEANTRAGBAR`]), bildet ihre
//!   Verweise auf die Kennungen des Führers ab und legt sie als Antrag ab (202 „ausstehend“).
//! - Der Abgleich bringt offene Anträge zum Führer ([`offene_antraege`]) und Quittungen zurück
//!   ([`quittungen_uebernehmen`]).
//! - Der Führer führt einen Antrag über den eigenen Router aus ([`ausfuehren`]), als hätte das
//!   Konto die Erfassung bei ihm gemacht; die Extension [`AntragAkteur`] ersetzt dabei das Cookie.
//!   Sie entsteht nur hier, HTTP kann sie nicht setzen.

use super::abbildung;
use super::paket::{
    Antrag, AntragQuittung, KontoAngabe, ANTRAEGE_BYTES_MAX, ANTRAEGE_MAX, ANTRAG_DATEN_MAX,
};
use crate::app::AppState;
use crate::error::AppError;
use crate::instanz::repo::KopplungZeile;
use crate::instanz::stammdaten::StammdatenArt;
use axum::extract::{MatchedPath, Request, State};
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Router;
use serde_json::{json, Value};
use sqlx::{SqliteConnection, SqlitePool};
use std::sync::{Arc, OnceLock};
use tower::ServiceExt;

/// Ziel eines Verweises in Pfad oder Body eines Antrags.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AntragZiel {
    /// Eine Zeile des Einsatzes; der Spiegel bildet sie über `spiegel_herkunft` ab.
    Einsatz(&'static str),
    /// Stammdaten; abgebildet von der meldenden Seite (D5).
    Stammdaten(StammdatenArt),
    /// Eine Zeile des Einsatzes, deren Tabelle ein Typfeld nennt (`(Wert, Tabelle)`).
    Polymorph {
        typ_pfad: &'static str,
        ziele: &'static [(&'static str, &'static str)],
    },
}

/// Ein Verweis im Body: Pfad wie `kraefte[].einheit_id` (`[]` = jedes Element einer Liste).
#[derive(Debug, Clone, Copy)]
pub struct BodyVerweis {
    pub pfad: &'static str,
    pub ziel: AntragZiel,
}

/// Eine beantragbare Erfassung (Spec `spiegel-antraege`): Art wie in der Offline-Warteschlange,
/// Methode und Routenvorlage, Verweise in Pfad und Body, Feld der `client_id` und die Tabelle der
/// entstehenden Zeile.
#[derive(Debug, Clone, Copy)]
pub struct Beantragbar {
    pub art: &'static str,
    pub methode: &'static str,
    pub pfad: &'static str,
    pub pfad_verweise: &'static [(&'static str, &'static str)],
    pub body_verweise: &'static [BodyVerweis],
    pub client_id: Option<&'static str>,
    /// Tabelle der entstehenden Hauptzeile.
    pub ergebnis: &'static str,
    /// Wo die Antwort deren Kennung trägt (`id`, `belegung.id`); leer = keine neue Zeile.
    pub ergebnis_feld: &'static str,
}

/// Das Feld, in dem die Route einer beantragbaren Erfassung ihre Erfassungszeit annimmt;
/// `None`, wo sie keine kennt oder der Client sie immer mitschickt (Meldung: Ereigniszeit ist
/// Pflicht). Der Wächter `jede_beantragbare_art_nennt_ihre_erfassungszeit` hält die Liste vollständig.
pub const ERFASSUNGSZEIT: &[(&str, Option<&str>)] = &[
    ("etb", Some("ereigniszeit")),
    ("meldung", None),
    ("person", Some("zeitpunkt_at")),
    ("sichtung", Some("zeitpunkt_at")),
    ("verbleib", Some("zeitpunkt_at")),
    ("notiz", Some("zeitpunkt_at")),
    ("transport", Some("zeitpunkt_at")),
    ("anlass", Some("zeitpunkt_at")),
    ("massnahme", Some("zeitpunkt_at")),
    ("verletzung", Some("zeitpunkt_at")),
    ("stand", Some("zeitpunkt_at")),
    ("belegung", Some("zeitpunkt_at")),
    ("registrierung", Some("zeitpunkt_at")),
    ("abmeldung", Some("zeitpunkt_at")),
    ("eintreffen", Some("zeitpunkt_at")),
    ("ausgabe", Some("zeitpunkt_at")),
];

fn erfassungszeit_feld(art: &str) -> Option<&'static str> {
    ERFASSUNGSZEIT
        .iter()
        .find(|(a, _)| *a == art)
        .and_then(|(_, f)| *f)
}

/// Die beantragbaren Erfassungen. Ergänzt aus der Aufnahme der Routen; der Wächter
/// `jede_vormerkbare_art_ist_eingeordnet` hält sie mit der Offline-Warteschlange gleich.
pub const BEANTRAGBAR: &[Beantragbar] = &[
    b(
        "etb",
        "/api/einsaetze/{id}/etb",
        &[],
        &[e("berichtigt_eintrag_id", "etb_eintrag")],
        "etb_eintrag",
        "id",
    ),
    b(
        "meldung",
        "/api/einsaetze/{id}/meldungen",
        &[],
        &[
            e("einheit_id", "einsatz_einheit"),
            e("abschnitt_id", "einsatzabschnitt"),
        ],
        "meldung",
        "id",
    ),
    b(
        "person",
        "/api/einsaetze/{id}/personen",
        &[],
        &[
            e("uhs_id", "uhs"),
            e("bestaetigt_personal_id", "einsatz_personal"),
            e("versorgende_einheit_id", "einsatz_einheit"),
            e("meldung_id", "meldung"),
        ],
        "einsatz_person",
        "id",
    ),
    b(
        "sichtung",
        "/api/einsaetze/{id}/personen/{pid}/sichtung",
        PERSON,
        &[e("bestaetigt_personal_id", "einsatz_personal")],
        "person_sichtung",
        "id",
    ),
    b(
        "verbleib",
        "/api/einsaetze/{id}/personen/{pid}/verbleib",
        PERSON,
        &[
            e("betreuungsstelle_id", "betreuungsstelle"),
            e("bestaetigt_personal_id", "einsatz_personal"),
            e("einsatz_fahrzeug_id", "einsatz_fahrzeug"),
        ],
        "person_verbleib",
        "id",
    ),
    b(
        "notiz",
        "/api/einsaetze/{id}/personen/{pid}/notizen",
        PERSON,
        &[],
        "person_verlaufsnotiz",
        "id",
    ),
    b(
        "transport",
        "/api/einsaetze/{id}/personen/{pid}/transport",
        PERSON,
        &[e("bestaetigt_personal_id", "einsatz_personal")],
        "person_transport",
        "id",
    ),
    b(
        "anlass",
        "/api/einsaetze/{id}/personen/{pid}/anlass",
        PERSON,
        &[],
        "person_anlass",
        "id",
    ),
    b(
        "massnahme",
        "/api/einsaetze/{id}/personen/{pid}/massnahmen",
        PERSON,
        &[e("bestaetigt_personal_id", "einsatz_personal")],
        "person_massnahme",
        "id",
    ),
    b(
        "verletzung",
        "/api/einsaetze/{id}/personen/{pid}/verletzungen",
        PERSON,
        &[e("bestaetigt_personal_id", "einsatz_personal")],
        "person_verletzung",
        "id",
    ),
    b(
        "stand",
        "/api/einsaetze/{id}/evakuierung/bezirke/{bid}/staende",
        &[("bid", "evakuierungsbezirk")],
        &[],
        "evakuierung_stand",
        "meldung_id",
    ),
    b(
        "belegung",
        "/api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen",
        STELLE,
        &[],
        "betreuungsstelle_belegung",
        "meldung_id",
    ),
    b(
        "registrierung",
        "/api/einsaetze/{id}/betreuung/stellen/{sid}/registrierungen",
        STELLE,
        &[e("haushalt_id", "haushalt")],
        "haushalt",
        "id",
    ),
    b(
        "abmeldung",
        "/api/einsaetze/{id}/betreuung/stellen/{sid}/abmeldungen",
        STELLE,
        &[
            e("haushalt_id", "haushalt"),
            e("person_ids[]", "einsatz_person"),
        ],
        "person_verbleib",
        "",
    ),
    b(
        "eintreffen",
        "/api/einsaetze/{id}/bereitstellungsraeume/{bid}/eintreffen",
        &[("bid", "bereitstellungsraum")],
        &[
            BodyVerweis {
                pfad: "kraft.objekt_id",
                ziel: AntragZiel::Polymorph {
                    typ_pfad: "kraft.objekt_typ",
                    ziele: &[
                        ("einheit", "einsatz_einheit"),
                        ("fahrzeug", "einsatz_fahrzeug"),
                    ],
                },
            },
            BodyVerweis {
                pfad: "vorlage.vorlage_id",
                ziel: AntragZiel::Stammdaten(StammdatenArt::EinheitVorlage),
            },
            e("nachforderung_id", "nachforderung"),
        ],
        "br_belegung",
        "belegung.id",
    ),
    b(
        "ausgabe",
        "/api/einsaetze/{id}/verpflegung/zeitfenster/{zid}/ausgaben",
        &[("zid", "verpflegung_zeitfenster")],
        &[
            e("nachforderung_id", "nachforderung"),
            e("verpflegungsstelle_id", "verpflegungsstelle"),
            e("einheit_id", "einsatz_einheit"),
            e("abschnitt_id", "einsatzabschnitt"),
            e("betreuungsstelle_id", "betreuungsstelle"),
        ],
        "verpflegung_ausgabe",
        "ausgabe_id",
    ),
];

const PERSON: &[(&str, &str)] = &[("pid", "einsatz_person")];
const STELLE: &[(&str, &str)] = &[("sid", "betreuungsstelle")];

const fn e(pfad: &'static str, tabelle: &'static str) -> BodyVerweis {
    BodyVerweis {
        pfad,
        ziel: AntragZiel::Einsatz(tabelle),
    }
}

const fn b(
    art: &'static str,
    pfad: &'static str,
    pfad_verweise: &'static [(&'static str, &'static str)],
    body_verweise: &'static [BodyVerweis],
    ergebnis: &'static str,
    ergebnis_feld: &'static str,
) -> Beantragbar {
    Beantragbar {
        art,
        methode: "POST",
        pfad,
        pfad_verweise,
        body_verweise,
        client_id: Some("client_id"),
        ergebnis,
        ergebnis_feld,
    }
}

/// Arten der Offline-Warteschlange, die keine Anträge sind, mit Grund.
pub const NICHT_BEANTRAGBAR: &[(&str, &str)] = &[
    (
        "eingaenge_gelesen",
        "Benachrichtigungen werden nicht gespiegelt; der Lesestand bleibt an dieser Instanz",
    ),
    (
        "benachrichtigung_quittiert",
        "Benachrichtigungen werden nicht gespiegelt; die Quittung bleibt an dieser Instanz",
    ),
];

/// Wer einen Antrag beim Führer stellt (D11). Nur [`ausfuehren`] legt sie an; `CurrentUser`
/// nimmt das Konto daraus statt aus dem Cookie.
#[derive(Debug, Clone, Copy)]
pub struct AntragAkteur {
    benutzer_id: i64,
}

impl AntragAkteur {
    pub fn benutzer_id(&self) -> i64 {
        self.benutzer_id
    }
}

/// Platz für den fertigen Router, an jeder Anfrage als Extension (D11): Der Führer führt Anträge
/// über ihn aus. Gesetzt in `app::build_router_mit`, sobald der Router steht.
#[derive(Debug, Clone, Default)]
pub struct RouterPlatz(pub Arc<OnceLock<Router>>);

impl RouterPlatz {
    pub fn router(&self) -> Option<Router> {
        self.0.get().cloned()
    }
}

/// Die beantragbare Erfassung zu Methode und Routenvorlage.
pub fn beantragbar(methode: &Method, pfad: &str) -> Option<&'static Beantragbar> {
    BEANTRAGBAR
        .iter()
        .find(|b| b.methode == methode.as_str() && b.pfad == pfad)
}

// ── Am Spiegel ───────────────────────────────────────────────────────────────────────────────

/// Schicht vor den Einsatzrouten (D9): eine beantragbare Erfassung an einem Spiegel wird zum
/// Antrag, alles andere läuft weiter (am Spiegel sperrt der Schutz-Trigger, D10).
pub async fn schicht(
    State(state): State<AppState>,
    pfad: Option<MatchedPath>,
    req: Request,
    next: Next,
) -> Response {
    let Some(b) = pfad.and_then(|p| beantragbar(req.method(), p.as_str())) else {
        return next.run(req).await;
    };
    let Some(einsatz_id) = einsatz_aus_pfad(req.uri().path()) else {
        return next.run(req).await;
    };
    let spiegel: Option<String> =
        match sqlx::query_scalar("SELECT fremde_kennung FROM einsatz_spiegel WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_optional(&state.pool)
            .await
        {
            Ok(s) => s,
            Err(e) => return AppError::from(e).into_response(),
        };
    let Some(kennung) = spiegel else {
        return next.run(req).await;
    };
    match beantragen(&state, b, einsatz_id, &kennung, req).await {
        Ok(r) => r,
        Err(e) => e.into_response(),
    }
}

fn einsatz_aus_pfad(pfad: &str) -> Option<i64> {
    pfad.strip_prefix("/api/einsaetze/")?
        .split('/')
        .next()?
        .parse()
        .ok()
}

/// Wendet `f` auf jeden Wert am Pfad an (`a.b`, `liste[].feld`).
fn jeder_wert<'a>(wert: &'a mut Value, pfad: &str, ziele: &mut Vec<&'a mut Value>) {
    let (kopf, rest) = match pfad.split_once('.') {
        Some((k, r)) => (k, Some(r)),
        None => (pfad, None),
    };
    let (name, liste) = match kopf.strip_suffix("[]") {
        Some(n) => (n, true),
        None => (kopf, false),
    };
    let Some(feld) = wert.get_mut(name) else {
        return;
    };
    let mut knoten: Vec<&'a mut Value> = if liste {
        match feld {
            Value::Array(a) => a.iter_mut().collect(),
            _ => Vec::new(),
        }
    } else {
        vec![feld]
    };
    match rest {
        None => ziele.append(&mut knoten),
        Some(r) => {
            for k in knoten {
                jeder_wert(k, r, ziele);
            }
        }
    }
}

/// Bildet einen lokalen Einsatzverweis auf die Kennung des Führers ab.
async fn einsatz_fremd(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    tabelle: &str,
    lokal: &str,
) -> Result<Option<String>, AppError> {
    if tabelle == "einsatz" {
        return Ok(sqlx::query_scalar(
            "SELECT fremder_schluessel FROM spiegel_herkunft WHERE einsatz_id = ? AND art = 'einsatz'",
        )
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?);
    }
    let fremd: Option<String> = sqlx::query_scalar(
        "SELECT fremder_schluessel FROM spiegel_herkunft \
         WHERE einsatz_id = ? AND art = ? AND lokaler_schluessel = ?",
    )
    .bind(einsatz_id)
    .bind(tabelle)
    .bind(lokal)
    .fetch_optional(&mut *conn)
    .await?;
    match fremd {
        Some(f) => Ok(Some(f)),
        // Eine mitbenutzte Katalogzeile (LLH-1629).
        None => Ok(super::katalog::fremd(conn, einsatz_id, tabelle, lokal).await?),
    }
}

/// Kopplung und Rolle der Seite, an der ein Spiegel hängt.
async fn kopplung_des_spiegels(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Option<(i64, i64, bool)>, AppError> {
    let z: Option<(i64, i64, String)> = sqlx::query_as(
        "SELECT o.kopplung_id, o.id, k.richtung FROM einsatz_spiegel s \
         JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
         JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE s.einsatz_id = ? AND s.beendet_at IS NULL AND o.widerrufen_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(z.map(|(k, o, r)| (k, o, r == "meldet_sich")))
}

/// Legt eine Erfassung am Spiegel als Antrag ab.
async fn beantragen(
    state: &AppState,
    b: &Beantragbar,
    einsatz_id: i64,
    _kennung: &str,
    req: Request,
) -> Result<Response, AppError> {
    use axum::extract::FromRequestParts;
    let (mut parts, body) = req.into_parts();
    let crate::auth::session::CurrentUser(benutzer) =
        crate::auth::session::CurrentUser::from_request_parts(&mut parts, state).await?;
    // Dieselbe Schranke wie die Route: Einsatzrolle mit Schreibrecht (die Mitgliedschaft ist
    // gespiegelt).
    let rolle = crate::einsatz::repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    crate::einsatz::berechtigung::fordere_schreibrecht(rolle)?;
    let status: String = sqlx::query_scalar("SELECT status FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_one(&state.pool)
        .await?;
    if status != "aktiv" {
        return Err(AppError::Conflict(
            "Einsatz ist abgeschlossen und schreibgeschützt".into(),
        ));
    }
    let params = axum::extract::RawPathParams::from_request_parts(&mut parts, state)
        .await
        .map_err(|_| AppError::NotFound)?;
    let bytes = axum::body::to_bytes(body, crate::app::JSON_BODY_MAX)
        .await
        .map_err(|_| AppError::PayloadTooLarge("Anfrage ist zu groß.".into()))?;
    if bytes.len() > ANTRAG_DATEN_MAX {
        return Err(AppError::PayloadTooLarge(
            "Für einen Antrag an die führende Instanz ist die Erfassung zu groß.".into(),
        ));
    }
    let mut daten: Value = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Validation(format!("Body unlesbar: {e}")))?;
    if daten
        .get("anhang_ids")
        .and_then(Value::as_array)
        .is_some_and(|a| !a.is_empty())
    {
        return Err(AppError::Validation(
            "Anhänge gehen an einem Spiegel nicht; ohne Anhang erneut erfassen.".into(),
        ));
    }
    let client_id = match b.client_id {
        Some(feld) => Some(
            daten
                .get(feld)
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| AppError::Validation("client_id fehlt.".into()))?
                .to_string(),
        ),
        None => None,
    };
    let mut conn = state.pool.acquire().await?;
    let Some((_kopplung_id, kopplung_org_id, meldend)) =
        kopplung_des_spiegels(&mut conn, einsatz_id).await?
    else {
        return Err(AppError::Conflict(
            "Der Abgleich dieses Spiegels ist beendet; ein Antrag geht nicht mehr.".into(),
        ));
    };
    let fehlt = || AppError::Validation("Bezug noch nicht beim Führer.".into());
    let mut pfad_parameter = serde_json::Map::new();
    let mut pfad_lokal = serde_json::Map::new();
    for (name, wert) in params.iter() {
        if name == "id" {
            continue;
        }
        pfad_lokal.insert(
            name.to_string(),
            wert.parse::<i64>()
                .map(Value::from)
                .unwrap_or(Value::from(wert)),
        );
        let ziel = b
            .pfad_verweise
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, t)| *t);
        let fremd = match ziel {
            Some(t) => einsatz_fremd(&mut conn, einsatz_id, t, wert)
                .await?
                .ok_or_else(fehlt)?,
            None => wert.to_string(),
        };
        pfad_parameter.insert(name.to_string(), Value::from(fremd));
    }
    for v in b.body_verweise {
        let ziel = match v.ziel {
            AntragZiel::Polymorph { typ_pfad, ziele } => {
                let mut kopie = daten.clone();
                let mut typen = Vec::new();
                jeder_wert(&mut kopie, typ_pfad, &mut typen);
                // Wie die Route: Leerraum zählt nicht (`objekt_typ: " einheit"`).
                let typ = typen
                    .first()
                    .and_then(|t| t.as_str())
                    .map(|t| t.trim().to_string());
                match ziele.iter().find(|(w, _)| Some(*w) == typ.as_deref()) {
                    Some((_, t)) => AntragZiel::Einsatz(t),
                    None => continue,
                }
            }
            z => z,
        };
        let mut werte = Vec::new();
        jeder_wert(&mut daten, v.pfad, &mut werte);
        for w in werte {
            let Some(id) = w.as_i64() else { continue };
            *w = match ziel {
                AntragZiel::Polymorph { .. } => continue,
                AntragZiel::Einsatz(t) => {
                    let f = einsatz_fremd(&mut conn, einsatz_id, t, &id.to_string())
                        .await?
                        .ok_or_else(fehlt)?;
                    f.parse::<i64>().map(Value::from).unwrap_or(Value::from(f))
                }
                AntragZiel::Stammdaten(art) if meldend => {
                    abbildung::stammdaten_fremd(&mut conn, kopplung_org_id, art, id)
                        .await?
                        .map_or(Value::Null, Value::from)
                }
                AntragZiel::Stammdaten(_) => Value::from(id),
            };
        }
    }
    let jetzt = crate::zeit::jetzt();
    // Die Erfassungszeit des Antrags gilt beim Führer (Spec `spiegel-antraege`, „Der Führer
    // übernimmt im Namen des Kontos“): ohne eigene Angabe setzte er sonst die Zeit der Ausführung.
    if let (Some(feld), Some(o)) = (erfassungszeit_feld(b.art), daten.as_object_mut()) {
        if o.get(feld).is_none_or(Value::is_null) {
            o.insert(feld.to_string(), Value::from(jetzt.clone()));
        }
    }
    if let Some(c) = &client_id {
        let vorhanden: Option<(i64, String)> = sqlx::query_as(
            "SELECT id, zustand FROM spiegel_antrag WHERE einsatz_id = ? AND art = ? AND client_id = ?",
        )
        .bind(einsatz_id)
        .bind(b.art)
        .bind(c)
        .fetch_optional(&mut *conn)
        .await?;
        if let Some((id, zustand)) = vorhanden {
            return Ok(antrag_antwort(id, &zustand));
        }
    }
    drop(conn);
    let id: i64 = crate::write_retry!(&state.pool, |conn| {
        Ok(sqlx::query_scalar(
            "INSERT INTO spiegel_antrag (einsatz_id, art, methode, pfad_vorlage, pfad_parameter, \
             pfad_lokal, daten, benutzer_id, client_id, erfasst_at, geaendert_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(b.art)
        .bind(b.methode)
        .bind(b.pfad)
        .bind(Value::Object(pfad_parameter.clone()).to_string())
        .bind(Value::Object(pfad_lokal.clone()).to_string())
        .bind(daten.to_string())
        .bind(benutzer.id)
        .bind(&client_id)
        .bind(&jetzt)
        .bind(&jetzt)
        .fetch_one(&mut *conn)
        .await?)
    })?;
    super::takt::wecken();
    Ok(antrag_antwort(id, "ausstehend"))
}

fn antrag_antwort(id: i64, zustand: &str) -> Response {
    (
        StatusCode::ACCEPTED,
        axum::Json(json!({ "antrag": { "id": id, "zustand": zustand } })),
    )
        .into_response()
}

/// Die offenen Anträge an Einsätze, die das Gegenüber dieser Kopplung führt, die ältesten zuerst
/// und höchstens [`ANTRAEGE_BYTES_MAX`] (mindestens einer); dazu ihre Größe im Paket, die vor
/// den Lieferungen vom Budget abgeht.
pub async fn offene_antraege(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    meldend: bool,
) -> Result<(Vec<Antrag>, usize), AppError> {
    #[allow(clippy::type_complexity)]
    let zeilen: Vec<(
        i64,
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        String,
        i64,
        String,
    )> = sqlx::query_as(
        "SELECT a.id, s.fremde_kennung, a.art, a.methode, a.pfad_vorlage, a.pfad_parameter, \
             a.daten, a.benutzer_id, a.client_id, a.erfasst_at, o.id, b.anzeigename \
             FROM spiegel_antrag a JOIN einsatz_spiegel s ON s.einsatz_id = a.einsatz_id \
             JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
             JOIN benutzer b ON b.id = a.benutzer_id \
             WHERE o.kopplung_id = ? AND o.widerrufen_at IS NULL AND s.beendet_at IS NULL \
             AND a.zustand IN ('ausstehend', 'zugestellt') ORDER BY a.id LIMIT ?",
    )
    .bind(kopplung_id)
    .bind(ANTRAEGE_MAX as i64)
    .fetch_all(&mut *conn)
    .await?;
    let mut antraege = Vec::with_capacity(zeilen.len());
    let mut bytes = 0usize;
    for (
        id,
        kennung,
        art,
        methode,
        pfad,
        parameter,
        daten,
        benutzer,
        client_id,
        erfasst,
        ko,
        name,
    ) in zeilen
    {
        let gegen_id = if meldend {
            abbildung::stammdaten_fremd(conn, ko, StammdatenArt::Konto, benutzer).await?
        } else {
            None
        };
        let gegen_id = match gegen_id {
            Some(g) => Some(g),
            None => abbildung::stellvertreter_fremd(conn, kopplung_id, benutzer).await?,
        };
        antraege.push(Antrag {
            id,
            kennung,
            art,
            methode,
            pfad_vorlage: pfad,
            pfad_parameter: serde_json::from_str(&parameter).unwrap_or_default(),
            daten: serde_json::from_str(&daten).unwrap_or(Value::Null),
            konto: KontoAngabe {
                id: benutzer,
                anzeigename: name,
                gegen_id,
            },
            client_id,
            erfasst_at: erfasst,
        });
        let groesse = antraege
            .last()
            .and_then(|a| serde_json::to_vec(a).ok())
            .map_or(0, |v| v.len());
        if bytes + groesse > ANTRAEGE_BYTES_MAX && antraege.len() > 1 {
            antraege.pop();
            break;
        }
        bytes += groesse;
    }
    Ok((antraege, bytes))
}

/// Nach einem gelungenen Abgleich: die gesendeten Anträge sind zugestellt.
pub async fn markiere_zugestellt(conn: &mut SqliteConnection, ids: &[i64]) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE spiegel_antrag SET zustand = 'zugestellt', geaendert_at = ? \
         WHERE zustand = 'ausstehend' AND id IN (SELECT value FROM json_each(?))",
    )
    .bind(crate::zeit::jetzt())
    .bind(serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Übernimmt Quittungen des Führers; liefert die Spiegel, deren Anträge sich geändert haben
/// (Live-Ereignis: die Antragsliste am Spiegel gleicht sich ab, auch ohne neue Zeile).
pub async fn quittungen_uebernehmen(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    quittungen: &[AntragQuittung],
) -> Result<Vec<i64>, AppError> {
    let mut einsaetze = Vec::new();
    for q in quittungen.iter().take(ANTRAEGE_MAX) {
        let zustand = match q.ergebnis.as_str() {
            "uebernommen" => "uebernommen",
            _ => "abgelehnt",
        };
        let geaendert: Option<i64> = sqlx::query_scalar(
            "UPDATE spiegel_antrag SET zustand = ?, grund = ?, ergebnis_art = ?, \
             ergebnis_schluessel = ?, geaendert_at = ? \
             WHERE id = ? AND zustand IN ('ausstehend', 'zugestellt') \
             AND einsatz_id IN (SELECT s.einsatz_id FROM einsatz_spiegel s \
                 JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
                 WHERE o.kopplung_id = ?) RETURNING einsatz_id",
        )
        .bind(zustand)
        .bind(
            q.grund
                .as_deref()
                .map(|g| g.chars().take(500).collect::<String>()),
        )
        .bind(&q.ergebnis_art)
        .bind(&q.ergebnis_schluessel)
        .bind(crate::zeit::jetzt())
        .bind(q.id)
        .bind(kopplung_id)
        .fetch_optional(&mut *conn)
        .await?;
        if let Some(e) = geaendert {
            if !einsaetze.contains(&e) {
                einsaetze.push(e);
            }
        }
    }
    Ok(einsaetze)
}

// ── Beim Führer ──────────────────────────────────────────────────────────────────────────────

fn abgelehnt(id: i64, grund: &str) -> AntragQuittung {
    AntragQuittung {
        id,
        ergebnis: "abgelehnt".into(),
        grund: Some(grund.into()),
        ergebnis_art: None,
        ergebnis_schluessel: None,
    }
}

/// Führt einen Antrag aus (D11). `None`: vorübergehend gescheitert (5xx), die Gegenseite stellt
/// erneut zu. Eine zweite Zustellung bekommt dieselbe Quittung, ohne erneut auszuführen.
pub async fn ausfuehren(
    pool: &SqlitePool,
    router: &Router,
    kopplung: &KopplungZeile,
    meldend: bool,
    a: &Antrag,
) -> Result<Option<AntragQuittung>, AppError> {
    let fingerabdruck = format!(
        "{}|{}|{}",
        a.art,
        a.client_id.as_deref().unwrap_or(""),
        a.erfasst_at
    );
    let gespeichert: Option<(String, String)> = sqlx::query_as(
        "SELECT quittung, fingerabdruck FROM spiegel_antrag_eingang \
         WHERE kopplung_id = ? AND fremde_antrag_id = ?",
    )
    .bind(kopplung.id)
    .bind(a.id)
    .fetch_optional(pool)
    .await?;
    if let Some((q, f)) = &gespeichert {
        if *f == fingerabdruck {
            return Ok(serde_json::from_str(q).ok());
        }
    }
    let quittung = match ausfuehren_innen(pool, router, kopplung, meldend, a).await? {
        Some(q) => q,
        None => return Ok(None),
    };
    crate::write_retry!(pool, |conn| {
        // Eine andere Erfassung unter derselben Nummer (Spiegel wiederhergestellt) ersetzt den
        // alten Eingang.
        sqlx::query(
            "INSERT INTO spiegel_antrag_eingang (kopplung_id, fremde_antrag_id, fingerabdruck, \
             quittung, erstellt_at) VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT (kopplung_id, fremde_antrag_id) DO UPDATE SET \
             fingerabdruck = excluded.fingerabdruck, quittung = excluded.quittung, \
             erstellt_at = excluded.erstellt_at, gemeldet_at = NULL \
             WHERE spiegel_antrag_eingang.fingerabdruck <> excluded.fingerabdruck",
        )
        .bind(kopplung.id)
        .bind(a.id)
        .bind(&fingerabdruck)
        .bind(serde_json::to_string(&quittung).unwrap_or_default())
        .bind(crate::zeit::jetzt())
        .execute(&mut *conn)
        .await?;
        Ok(())
    })?;
    Ok(Some(quittung))
}

async fn ausfuehren_innen(
    pool: &SqlitePool,
    router: &Router,
    kopplung: &KopplungZeile,
    meldend: bool,
    a: &Antrag,
) -> Result<Option<AntragQuittung>, AppError> {
    let Some(b) = BEANTRAGBAR
        .iter()
        .find(|b| b.art == a.art && b.pfad == a.pfad_vorlage && b.methode == a.methode)
    else {
        return Ok(Some(abgelehnt(a.id, "Unbekannte Art des Antrags.")));
    };
    // Nur Einsätze, die hier geführt werden und deren Org der Kopplung zugeordnet ist.
    let einsatz: Option<(i64, i64, i64)> = sqlx::query_as(
        "SELECT e.id, o.id, e.org_id FROM einsatz e JOIN instanz_kopplung_org o ON o.org_id = e.org_id \
         WHERE e.kennung = ? AND e.spiegel = 0 AND o.kopplung_id = ? AND o.widerrufen_at IS NULL",
    )
    .bind(&a.kennung)
    .bind(kopplung.id)
    .fetch_optional(pool)
    .await?;
    let Some((einsatz_id, kopplung_org_id, org_id)) = einsatz else {
        return Ok(Some(abgelehnt(a.id, "Führung liegt nicht hier.")));
    };
    let mut conn = pool.acquire().await?;
    let konto = match a.konto.gegen_id {
        Some(g) => Some(g),
        None if meldend => {
            abbildung::stammdaten_lokal(
                &mut conn,
                kopplung_org_id,
                StammdatenArt::Konto,
                a.konto.id,
            )
            .await?
        }
        None => None,
    };
    let konto: Option<i64> = match konto {
        Some(k) => {
            sqlx::query_scalar(
                "SELECT b.id FROM benutzer b WHERE b.id = ? AND b.aktiv = 1 AND b.org_id = ? \
             AND NOT EXISTS (SELECT 1 FROM spiegel_konto sk WHERE sk.benutzer_id = b.id)",
            )
            .bind(k)
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?
        }
        None => None,
    };
    let Some(konto) = konto else {
        return Ok(Some(abgelehnt(a.id, "Konto am Führer unbekannt.")));
    };
    let mut daten = a.daten.clone();
    if meldend {
        for v in b.body_verweise {
            let AntragZiel::Stammdaten(art) = v.ziel else {
                continue;
            };
            let mut werte = Vec::new();
            jeder_wert(&mut daten, v.pfad, &mut werte);
            for w in werte {
                if let Some(id) = w.as_i64() {
                    *w = abbildung::stammdaten_lokal(&mut conn, kopplung_org_id, art, id)
                        .await?
                        .map_or(Value::Null, Value::from);
                }
            }
        }
    }
    drop(conn);
    let mut uri = b.pfad.replace("{id}", &einsatz_id.to_string());
    for (name, wert) in &a.pfad_parameter {
        let text = match wert {
            Value::String(s) => s.clone(),
            w => w.to_string(),
        };
        if text
            .chars()
            .any(|c| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
        {
            return Ok(Some(abgelehnt(a.id, "Bezug nicht mehr vorhanden.")));
        }
        uri = uri.replace(&format!("{{{name}}}"), &text);
    }
    if uri.contains('{') {
        return Ok(Some(abgelehnt(a.id, "Bezug nicht mehr vorhanden.")));
    }
    let mut anfrage = axum::http::Request::builder()
        .method(b.methode)
        .uri(uri)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(daten.to_string()))
        .map_err(|e| AppError::Internal(e.to_string()))?;
    anfrage
        .extensions_mut()
        .insert(AntragAkteur { benutzer_id: konto });
    let antwort = router
        .clone()
        .oneshot(anfrage)
        .await
        .map_err(|e| AppError::Internal(format!("{e:?}")))?;
    let status = antwort.status();
    let rumpf = axum::body::to_bytes(antwort.into_body(), 1024 * 1024)
        .await
        .unwrap_or_default();
    let wert: Value = serde_json::from_slice(&rumpf).unwrap_or(Value::Null);
    if status.is_server_error() {
        tracing::warn!(antrag = a.id, %status, "Antrag beim Führer vorübergehend gescheitert");
        return Ok(None);
    }
    if status.is_success() {
        let feld = b
            .ergebnis_feld
            .split('.')
            .filter(|t| !t.is_empty())
            .try_fold(&wert, |w, t| w.get(t));
        let schluessel = feld.filter(|_| !b.ergebnis_feld.is_empty()).and_then(|v| {
            v.as_i64()
                .map(|i| i.to_string())
                .or(v.as_str().map(str::to_string))
        });
        return Ok(Some(AntragQuittung {
            id: a.id,
            ergebnis: "uebernommen".into(),
            grund: None,
            ergebnis_art: schluessel.as_ref().map(|_| b.ergebnis.to_string()),
            ergebnis_schluessel: schluessel,
        }));
    }
    let grund = if status == StatusCode::NOT_FOUND {
        "Bezug nicht mehr vorhanden.".to_string()
    } else {
        wert.get("error")
            .and_then(Value::as_str)
            .unwrap_or("Abgelehnt.")
            .to_string()
    };
    Ok(Some(abgelehnt(a.id, &grund)))
}

/// Quittungen, die der Führer als meldende Seite noch mitgeben muss.
pub async fn offene_quittungen(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<Vec<AntragQuittung>, AppError> {
    let zeilen: Vec<String> = sqlx::query_scalar(
        "SELECT quittung FROM spiegel_antrag_eingang \
         WHERE kopplung_id = ? AND gemeldet_at IS NULL ORDER BY fremde_antrag_id LIMIT ?",
    )
    .bind(kopplung_id)
    .bind(ANTRAEGE_MAX as i64)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .iter()
        .filter_map(|q| serde_json::from_str(q).ok())
        .collect())
}

/// Eine Quittung ist angekommen, wenn die Gegenseite den Antrag nicht mehr schickt.
pub async fn markiere_gemeldet(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    gesendet: &[i64],
    noch_offen: &[i64],
) -> Result<(), AppError> {
    let erledigt: Vec<i64> = gesendet
        .iter()
        .filter(|id| !noch_offen.contains(id))
        .copied()
        .collect();
    sqlx::query(
        "UPDATE spiegel_antrag_eingang SET gemeldet_at = ? \
         WHERE kopplung_id = ? AND fremde_antrag_id IN (SELECT value FROM json_each(?))",
    )
    .bind(crate::zeit::jetzt())
    .bind(kopplung_id)
    .bind(serde_json::to_string(&erledigt).unwrap_or_else(|_| "[]".into()))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// ── Anzeige am Spiegel ───────────────────────────────────────────────────────────────────────

/// Ein Antrag, wie die Person ihn am Spiegel sieht (Spec `spiegel-antraege`).
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct SpiegelAntragAnzeige {
    pub id: i64,
    /// Art wie in der Offline-Warteschlange (`etb`, `sichtung`, …).
    pub art: String,
    /// `ausstehend`, `zugestellt`, `uebernommen` (Zeile noch nicht im Spiegel) oder `abgelehnt`.
    pub zustand: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grund: Option<String>,
    pub erfasst_at: String,
    /// Pfadparameter mit den Kennungen dieser Instanz (etwa `pid` der Person).
    #[schema(value_type = Object)]
    pub ziel: Value,
    /// Die erfassten Daten (Kennungen der führenden Instanz).
    #[schema(value_type = Object)]
    pub daten: Value,
}

/// Die eigenen Anträge eines Spiegels, die noch etwas zu sagen haben: offene, abgelehnte und
/// übernommene, deren Zeile der Spiegel noch nicht hat.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Vec<SpiegelAntragAnzeige>, AppError> {
    let zeilen: Vec<(i64, String, String, Option<String>, String, String, String)> =
        sqlx::query_as(
            "SELECT a.id, a.art, a.zustand, a.grund, a.erfasst_at, a.pfad_lokal, a.daten \
         FROM spiegel_antrag a WHERE a.einsatz_id = ? AND a.benutzer_id = ? \
         AND (a.zustand <> 'uebernommen' OR (a.ergebnis_schluessel IS NOT NULL AND NOT EXISTS ( \
             SELECT 1 FROM spiegel_herkunft h WHERE h.einsatz_id = a.einsatz_id \
             AND h.art = a.ergebnis_art AND h.fremder_schluessel = a.ergebnis_schluessel))) \
         ORDER BY a.id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .fetch_all(pool)
        .await?;
    Ok(zeilen
        .into_iter()
        .map(
            |(id, art, zustand, grund, erfasst_at, ziel, daten)| SpiegelAntragAnzeige {
                id,
                art,
                zustand,
                grund,
                erfasst_at,
                ziel: serde_json::from_str(&ziel).unwrap_or(Value::Null),
                daten: serde_json::from_str(&daten).unwrap_or(Value::Null),
            },
        )
        .collect())
}

/// Verwirft einen eigenen, abgelehnten Antrag; sonst 404.
pub async fn verwerfen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    antrag_id: i64,
) -> Result<(), AppError> {
    let geloescht = crate::write_retry!(pool, |conn| {
        Ok(sqlx::query(
            "DELETE FROM spiegel_antrag WHERE id = ? AND einsatz_id = ? AND benutzer_id = ? \
             AND zustand = 'abgelehnt'",
        )
        .bind(antrag_id)
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&mut *conn)
        .await?
        .rows_affected())
    })?;
    if geloescht == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Frist abgelehnter Anträge (Spec `spiegel-antraege`, wie die Offline-Warteschlange).
pub const ABGELEHNT_TAGE: i64 = 30;

/// Räumt abgelehnte Anträge nach [`ABGELEHNT_TAGE`] und übernommene, deren Zeile der Spiegel hat.
pub async fn aufraeumen(pool: &SqlitePool) -> Result<u64, AppError> {
    let grenze =
        crate::zeit::formatiere_utc(chrono::Utc::now() - chrono::Duration::days(ABGELEHNT_TAGE));
    let a = sqlx::query(
        "DELETE FROM spiegel_antrag WHERE (zustand = 'abgelehnt' AND geaendert_at < ?) \
         OR (zustand = 'uebernommen' AND (ergebnis_schluessel IS NULL OR EXISTS ( \
             SELECT 1 FROM spiegel_herkunft h WHERE h.einsatz_id = spiegel_antrag.einsatz_id \
             AND h.art = spiegel_antrag.ergebnis_art \
             AND h.fremder_schluessel = spiegel_antrag.ergebnis_schluessel)))",
    )
    .bind(grenze)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Jede beantragbare Art sagt, wo ihre Route die Erfassungszeit annimmt (oder dass sie keine
    /// braucht); eine neue Art ohne Eintrag landete beim Führer mit der Zeit der Ausführung.
    #[test]
    fn jede_beantragbare_art_nennt_ihre_erfassungszeit() {
        let arten: BTreeSet<&str> = BEANTRAGBAR.iter().map(|b| b.art).collect();
        let genannt: BTreeSet<&str> = ERFASSUNGSZEIT.iter().map(|(a, _)| *a).collect();
        assert_eq!(arten, genannt);
    }

    /// Jede Art der Offline-Warteschlange ist beantragbar oder mit Grund ausgenommen (Spec
    /// `spiegel-antraege`, „Neue vormerkbare Erfassungen werden eingeordnet“). Die ETB-Erfassung
    /// hat eine eigene Warteschlange und heißt hier `etb`.
    #[test]
    fn jede_vormerkbare_art_ist_eingeordnet() {
        let wurzel = env!("CARGO_MANIFEST_DIR");
        let queue = std::fs::read_to_string(format!("{wurzel}/frontend/src/offline/queue.ts"))
            .expect("queue.ts");
        let person =
            std::fs::read_to_string(format!("{wurzel}/frontend/src/offline/personEintrag.ts"))
                .expect("personEintrag.ts");
        let mut arten: BTreeSet<String> = BTreeSet::new();
        let typ = &queue[queue.find("export type OfflineSchreibaktion").unwrap()..];
        let typ = &typ[..typ.find("PersonEintragAktion;").unwrap()];
        for teil in typ.split("art: '").skip(1) {
            arten.insert(teil.split('\'').next().unwrap().to_string());
        }
        let liste = &person[person.find("PERSON_EINTRAG_ARTEN = [").unwrap()..];
        let liste = &liste[..liste.find(']').unwrap()];
        for teil in liste.split('\'').skip(1).step_by(2) {
            arten.insert(teil.to_string());
        }
        arten.insert("etb".into());
        let bekannt: BTreeSet<String> = BEANTRAGBAR
            .iter()
            .map(|b| b.art.to_string())
            .chain(NICHT_BEANTRAGBAR.iter().map(|(a, _)| a.to_string()))
            .collect();
        assert_eq!(
            arten, bekannt,
            "BEANTRAGBAR/NICHT_BEANTRAGBAR passen nicht zur Warteschlange"
        );
    }

    /// Jede Routenvorlage gibt es im Router, und ihre Pfadparameter sind abgebildet.
    #[test]
    fn jede_vorlage_steht_im_router_und_jeder_parameter_ist_abgebildet() {
        let app = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/app.rs"))
            .expect("app.rs");
        for b in BEANTRAGBAR {
            assert!(
                app.contains(&format!("\"{}\"", b.pfad)),
                "{} fehlt im Router",
                b.pfad
            );
            for teil in b.pfad.split('{').skip(1) {
                let name = teil.split('}').next().unwrap();
                assert!(
                    name == "id" || b.pfad_verweise.iter().any(|(n, _)| *n == name),
                    "{}: Parameter {name} ohne Ziel",
                    b.pfad
                );
            }
            for (_, t) in b.pfad_verweise {
                assert!(
                    super::super::art::kategorie(t).is_some(),
                    "{t} wird nicht gespiegelt"
                );
            }
        }
    }

    #[test]
    fn werte_am_pfad_auch_in_listen() {
        let mut v = json!({"a": {"b": 1}, "l": [{"x": 2}, {"x": 3}], "p": [4, 5]});
        let mut werte = Vec::new();
        jeder_wert(&mut v, "l[].x", &mut werte);
        for w in werte {
            *w = Value::from(w.as_i64().unwrap() * 10);
        }
        let mut werte = Vec::new();
        jeder_wert(&mut v, "p[]", &mut werte);
        assert_eq!(werte.len(), 2);
        assert_eq!(v["l"], json!([{"x": 20}, {"x": 30}]));
        let mut werte = Vec::new();
        jeder_wert(&mut v, "a.b", &mut werte);
        assert_eq!(werte.len(), 1);
    }
}
