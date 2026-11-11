//! Nicht übernommene Änderungen ansehen und nachreichen (LLH-1646, Entwurf N1–N6, mit Ruben am
//! 11.11.2026 abgestimmt; Nachzug aus LLH-1641 E6).
//!
//! Nach einer Notübernahme sichert die abgelöste Seite ihre Zeilen, die der neue Führer nicht
//! kannte, in `einsatz_bruchstelle` und entfernt sie aus dem Einsatz
//! ([`super::fuehrung::uebernimm_bruch_antworten`]). Gesichert wird je Tabellenzeile, gezeigt und
//! nachgereicht je **Erfassung**:
//!
//! - [`ordne_folgen`] hängt Folgezeilen an ihren Ursprung (`folge_von`): Eine Zeile, die auf eine
//!   andere entfernte Zeile verweist, gehört zu deren Erfassung (der ETB-Eintrag einer Meldung,
//!   die Sichtung einer neuen Person). Zwei Erfassungen, die aufeinander zeigen, sind in
//!   [`KEINE_FOLGE`] ausgenommen.
//! - [`liste`] zeigt die offenen Erfassungen (N2): entfernt, mit Inhalt, kein Folgezeile, weder
//!   nachgereicht noch verworfen. Inhalte nur, wo die Person das Modul nutzen darf.
//! - [`stellen_tx`] macht aus einer Erfassung einen Antrag an den Führer (N1: ETB-Eintrag und
//!   Meldung), im Namen der Person, die stellt (N3), mit Wortlaut und Ereigniszeit von damals.
//!   Genau einmal: Der Antrag trägt die `client_id` der Erfassung; ein zweites Stellen liefert
//!   den vorhandenen Antrag, und der Führer erkennt Doppelte an derselben `client_id`.
//! - [`verwerfen`] legt eine Erfassung ab (N6); sie bleibt gesichert, bis der Einsatz geht.
//!
//! Ein abgelehnter Antrag macht seine Erfassung wieder offen
//! ([`quittung_uebernehmen`], aus `antrag::quittungen_uebernehmen`).

use super::antrag::{self, Beantragbar, BEANTRAGBAR};
use super::schema::{self, Ziel};
use super::SpiegelKategorie;
use crate::error::AppError;
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;

/// Tabellen, deren neue Zeilen sich als Antrag nachreichen lassen (N1), mit der Art des Antrags.
pub const NACHREICHBAR: &[(&str, &str)] = &[("etb_eintrag", "etb"), ("meldung", "meldung")];

/// Verweise, die keine Folge begründen: Beide Seiten sind eigene Erfassungen (die Berichtigung
/// eines Eintrags), oder der Verweis zeigt vom Ursprung auf seine Folge (`meldung.etb_meldung_id`
/// zeigt auf den ETB-Eintrag, den die Meldung selbst angelegt hat).
pub const KEINE_FOLGE: &[(&str, &str)] = &[
    ("meldung", "etb_meldung_id"),
    ("etb_eintrag", "berichtigt_eintrag_id"),
];

/// Verweise der ETB-Zeile auf den Vorgang, der sie geschrieben hat. Ein ETB-Eintrag mit einem
/// davon ist kein eigener Eintrag, sondern die Spur dieses Vorgangs, und lässt sich nicht für
/// sich nachreichen.
const ETB_VORGANG: &[&str] = &[
    "meldung_id",
    "auftrag_id",
    "lagebericht_id",
    "nachforderung_id",
    "befehl_id",
];

/// Verweise, die beim Nachreichen wegfallen dürfen, wenn der Führer ihr Ziel nicht kennt: Die
/// Route stuft sie dann ohnehin zu „ungebunden“ herab (Absender einer Meldung, LFH-610).
const VERZICHTBAR: &[(&str, &str)] = &[("meldung", "einheit_id"), ("meldung", "abschnitt_id")];

/// Höchstlänge des Kurzinhalts in der Liste (Zeichen).
pub const KURZ_MAX: usize = 200;

/// Eine nicht übernommene Erfassung, wie die Liste am Band sie zeigt (N2).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BruchErfassung {
    pub id: i64,
    /// Tabelle der Zeile (`etb_eintrag`, `meldung`, `einsatz_person` …).
    pub tabelle: String,
    pub kategorie: SpiegelKategorie,
    /// Art des Antrags, wenn sie sich nachreichen lässt (`etb`, `meldung`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub antrag_art: Option<String>,
    /// Typ eines ETB-Eintrags (`meldung`, `lage`, …).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typ: Option<String>,
    /// Ereignis- oder Erfassungszeit der Zeile (UTC); fehlt, wenn sie keine trägt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zeit: Option<String>,
    /// Absender oder „von“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub von: Option<String>,
    /// Inhalt in Kurzform (höchstens [`KURZ_MAX`] Zeichen).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kurz: Option<String>,
    /// Die Person darf das Modul der Zeile nicht nutzen: kein Inhalt, kein Antrag.
    pub verborgen: bool,
    /// Zahl der Folgezeilen, die mit ihr gingen.
    pub folgen: i64,
    pub gesichert_at: String,
}

/// Ergebnis von „Alle stellen“ (N5).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BruchAlleErgebnis {
    pub gestellt: i64,
    /// Erfassungen, die offen bleiben, mit Grund (etwa „Bezug noch nicht beim Führer.“).
    pub offen: Vec<BruchOffen>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BruchOffen {
    pub id: i64,
    pub grund: String,
}

/// Das Modul, dessen Freigabe den Inhalt einer Zeile zeigt: wo eine Tabelle zu einem Modul
/// gehört, das Modul, sonst das ihrer Kategorie.
pub fn modul_der_zeile(tabelle: &str, kategorie: SpiegelKategorie) -> &'static str {
    match tabelle {
        "meldung" => "meldungen",
        "auftrag" | "auftrag_empfaenger" => "auftraege",
        "befehl" | "befehl_verteiler" | "lagebericht" | "lagebericht_verteiler" => "lageberichte",
        "nachforderung" => "nachforderungen",
        "infotelefon_anruf" => "infotelefon",
        t if t.starts_with("chat_") => "chat",
        "erinnerung" => "erinnerungen",
        "uhs" | "uhs_platz" | "person_uhs_belegung" => "unfallhilfsstellen",
        "evakuierungsbezirk" | "evakuierung_stand" => "evakuierung",
        t if t.starts_with("verpflegung") => "verpflegung",
        "bereitstellungsraum" | "br_belegung" => "bereitstellungsraeume",
        "einsatz_tier" => "tiere",
        "einsatz_schaden" => "schaeden",
        _ => match kategorie {
            SpiegelKategorie::Fuehrung => "einsatzdaten",
            SpiegelKategorie::Etb => "etb",
            SpiegelKategorie::Lage => "lagekarte",
            SpiegelKategorie::Kraefte => "einheiten",
            SpiegelKategorie::Personen => "personen",
            SpiegelKategorie::Betreuung => "betreuung",
            SpiegelKategorie::Kommunikation => "fernmeldewesen",
            SpiegelKategorie::Anhaenge => "dokumente",
        },
    }
}

/// Das Modul, das ein Antrag der Art `art` braucht.
pub fn modul_des_antrags(art: &str) -> &'static str {
    match art {
        "meldung" => "meldungen",
        _ => "etb",
    }
}

fn als_schluessel(w: &Value) -> Option<String> {
    match w {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn text(daten: &Map<String, Value>, feld: &str) -> Option<String> {
    daten
        .get(feld)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn kuerze(s: String) -> String {
    if s.chars().count() <= KURZ_MAX {
        return s;
    }
    let mut k: String = s.chars().take(KURZ_MAX - 1).collect();
    k.push('…');
    k
}

/// Ordnet die entfernten Zeilen eines Einsatzes ihren Erfassungen zu (`folge_von`, N2). Läuft,
/// sobald Zeilen der Bruchstelle entfernt sind. Gruppiert wird je Sicherung (`gesichert_at`),
/// denn SQLite vergibt die Kennung einer gelöschten Zeile neu.
pub async fn ordne_folgen(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<(), AppError> {
    let zeilen: Vec<(i64, String, String, String, String, Option<i64>)> = sqlx::query_as(
        "SELECT id, art, schluessel, daten, gesichert_at, folge_von FROM einsatz_bruchstelle \
         WHERE einsatz_id = ? AND entfernt = 1 AND daten IS NOT NULL ORDER BY id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    if zeilen.is_empty() {
        return Ok(());
    }
    let schema = schema::schema(conn).await?;
    let mut index: HashMap<(&str, &str, &str), i64> = HashMap::new();
    for (id, art, schluessel, _, gesichert, _) in &zeilen {
        index.insert((gesichert.as_str(), art.as_str(), schluessel.as_str()), *id);
    }
    let mut eltern: HashMap<i64, i64> = HashMap::new();
    for (id, art, _, daten, gesichert, _) in &zeilen {
        let (Some(t), Ok(Value::Object(d))) =
            (schema.tabelle(art), serde_json::from_str::<Value>(daten))
        else {
            continue;
        };
        for sp in &t.spalten {
            if KEINE_FOLGE.contains(&(art.as_str(), sp.name.as_str())) {
                continue;
            }
            let ziel = match &sp.verweis {
                Some(Ziel::Einsatz(z)) => *z,
                Some(Ziel::Polymorph { typ_spalte, ziele }) => {
                    let typ = d.get(*typ_spalte).and_then(Value::as_str);
                    match ziele.iter().find(|(w, _)| Some(*w) == typ) {
                        Some((_, z)) => *z,
                        None => continue,
                    }
                }
                _ => continue,
            };
            let Some(wert) = d.get(&sp.name).and_then(als_schluessel) else {
                continue;
            };
            if let Some(e) = index.get(&(gesichert.as_str(), ziel, wert.as_str())) {
                if e != id {
                    eltern.insert(*id, *e);
                    break;
                }
            }
        }
    }
    // Ein Kreis (zwei Zeilen, die aufeinander zeigen und nicht ausgenommen sind) hätte keinen
    // Ursprung: die kleinste Kennung im Kreis wird Ursprung.
    let ids: Vec<i64> = zeilen.iter().map(|z| z.0).collect();
    for id in &ids {
        let mut gesehen = HashSet::new();
        let mut k = *id;
        while let Some(e) = eltern.get(&k).copied() {
            if !gesehen.insert(k) {
                let kleinste = *gesehen.iter().min().unwrap_or(&k);
                eltern.remove(&kleinste);
                break;
            }
            k = e;
        }
    }
    for (id, _, _, _, _, vorher) in &zeilen {
        let neu = eltern.get(id).copied();
        if neu != *vorher {
            sqlx::query("UPDATE einsatz_bruchstelle SET folge_von = ? WHERE id = ?")
                .bind(neu)
                .bind(id)
                .execute(&mut *conn)
                .await?;
        }
    }
    Ok(())
}

/// Ob eine Zeile sich nachreichen lässt (N1), und als welche Antragsart.
fn nachreichbar_als(tabelle: &str, d: &Map<String, Value>) -> Option<&'static str> {
    let (_, art) = NACHREICHBAR.iter().find(|(t, _)| *t == tabelle)?;
    let frei = |feld: &str| d.get(feld).is_none_or(Value::is_null);
    let geht = match tabelle {
        "etb_eintrag" => {
            text(d, "typ").as_deref() != Some(crate::etb::TYP_SYSTEM)
                && ETB_VORGANG.iter().all(|f| frei(f))
        }
        "meldung" => frei("auftrag_id"),
        _ => false,
    };
    geht.then_some(*art)
}

const ZEIT_FELDER: &[&str] = &[
    "ereigniszeit",
    "zeitpunkt_at",
    "gesichtet_at",
    "eingang_at",
    "erfasst_at",
    "erstellt_at",
    "angelegt_at",
    "created_at",
];

const KURZ_FELDER: &[&str] = &[
    "inhalt",
    "text",
    "nachricht",
    "bezeichnung",
    "titel",
    "name",
    "beschreibung",
    "notiz",
    "ziel",
    "kategorie",
];

fn kurzinhalt(tabelle: &str, d: &Map<String, Value>) -> Option<String> {
    if tabelle == "einsatz_person" {
        let name: Vec<String> = ["name", "vorname"]
            .iter()
            .filter_map(|f| text(d, f))
            .collect();
        if !name.is_empty() {
            return Some(kuerze(name.join(", ")));
        }
    }
    KURZ_FELDER.iter().find_map(|f| text(d, f)).map(kuerze)
}

/// Die offenen Erfassungen der Bruchstelle eines Einsatzes, nach Zeit (N2). `darf` sagt je Modul,
/// ob die Person es nutzen darf; ohne Freigabe steht nur Art und Zeit da.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    darf: impl Fn(&str) -> bool,
) -> Result<Vec<BruchErfassung>, AppError> {
    let mut conn = pool.acquire().await?;
    let schema = schema::schema(&mut conn).await?;
    let zeilen: Vec<(i64, String, String, String, i64)> = sqlx::query_as(
        "SELECT b.id, b.art, b.daten, b.gesichert_at, \
         (SELECT COUNT(*) FROM einsatz_bruchstelle f WHERE f.folge_von = b.id) \
         FROM einsatz_bruchstelle b WHERE b.einsatz_id = ? AND b.entfernt = 1 \
         AND b.daten IS NOT NULL AND b.folge_von IS NULL AND b.erledigt IS NULL ORDER BY b.id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut liste = Vec::with_capacity(zeilen.len());
    for (id, tabelle, daten, gesichert_at, folgen) in zeilen {
        let d = match serde_json::from_str::<Value>(&daten) {
            Ok(Value::Object(d)) => d,
            _ => Map::new(),
        };
        let kategorie = schema
            .tabelle(&tabelle)
            .map(|t| t.kategorie)
            .unwrap_or(SpiegelKategorie::Fuehrung);
        let verborgen = !darf(modul_der_zeile(&tabelle, kategorie));
        let zeit = ZEIT_FELDER.iter().find_map(|f| text(&d, f));
        let (antrag_art, typ, von, kurz) = if verborgen {
            (None, None, None, None)
        } else {
            let art = nachreichbar_als(&tabelle, &d).filter(|a| darf(modul_des_antrags(a)));
            let typ = (tabelle == "etb_eintrag")
                .then(|| text(&d, "typ"))
                .flatten();
            let von = text(&d, "von").or_else(|| text(&d, "absender"));
            (art.map(str::to_string), typ, von, kurzinhalt(&tabelle, &d))
        };
        liste.push(BruchErfassung {
            id,
            tabelle,
            kategorie,
            antrag_art,
            typ,
            zeit,
            von,
            kurz,
            verborgen,
            folgen,
            gesichert_at,
        });
    }
    liste.sort_by(|a, b| {
        a.zeit
            .as_deref()
            .unwrap_or(&a.gesichert_at)
            .cmp(b.zeit.as_deref().unwrap_or(&b.gesichert_at))
            .then(a.id.cmp(&b.id))
    });
    Ok(liste)
}

/// Felder der Route je Antragsart: (Feld der Route, Spalte der Zeile).
const ETB_FELDER: &[(&str, &str)] = &[
    ("typ", "typ"),
    ("inhalt", "inhalt"),
    ("von", "von"),
    ("an", "an"),
    ("meldeweg", "meldeweg"),
    ("veranlassung", "veranlassung"),
    ("ereigniszeit", "ereigniszeit"),
    ("erfasst_lokal_at", "erfasst_lokal_at"),
    ("berichtigt_eintrag_id", "berichtigt_eintrag_id"),
    ("client_id", "client_id"),
];

const MELDUNG_FELDER: &[(&str, &str)] = &[
    ("absender", "absender"),
    ("empfaenger", "empfaenger"),
    ("empfaenger_funktion", "empfaenger_funktion"),
    ("meldeweg", "meldeweg"),
    ("inhalt", "inhalt"),
    ("meldungsart", "meldungsart"),
    ("prioritaet", "prioritaet"),
    ("richtung", "richtung"),
    ("ereigniszeit", "ereigniszeit"),
    ("bestaetigung_pflicht", "bestaetigung_pflicht"),
    ("client_id", "client_id"),
    ("einheit_id", "einheit_id"),
    ("abschnitt_id", "abschnitt_id"),
    ("lat", "lat"),
    ("lon", "lon"),
];

/// Ein Verweis auf eine Zeile, die selbst in der Bruchstelle lag: Ist sie nachgereicht und beim
/// Spiegel wieder angekommen, ihre neue lokale Kennung. `Ok(None)`, wenn der Verweis keine
/// entfernte Zeile trifft; `Err(())`, wenn er eine trifft, die noch nicht wieder da ist.
async fn neuer_lokaler_schluessel(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    tabelle: &str,
    schluessel: &str,
) -> Result<Result<Option<String>, ()>, AppError> {
    let zeile: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT nachgereicht_als FROM einsatz_bruchstelle \
         WHERE einsatz_id = ? AND art = ? AND schluessel = ? AND entfernt = 1 \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(tabelle)
    .bind(schluessel)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((fremd,)) = zeile else {
        return Ok(Ok(None));
    };
    let Some(fremd) = fremd else {
        return Ok(Err(()));
    };
    let lokal: Option<String> = sqlx::query_scalar(
        "SELECT lokaler_schluessel FROM spiegel_herkunft WHERE einsatz_id = ? AND art = ? \
         AND fremder_schluessel = ?",
    )
    .bind(einsatz_id)
    .bind(tabelle)
    .bind(&fremd)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(lokal.map(Some).ok_or(()))
}

/// Baut aus der gesicherten Zeile den Body der Route (mit den Kennungen dieses Spiegels; die
/// Abbildung auf den Führer macht [`antrag::lege_an_tx`]).
async fn body_der_zeile(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    tabelle: &str,
    b: &Beantragbar,
    d: &Map<String, Value>,
) -> Result<Value, AppError> {
    let felder = match tabelle {
        "meldung" => MELDUNG_FELDER,
        _ => ETB_FELDER,
    };
    let mut body = Map::new();
    for (feld, spalte) in felder {
        let Some(w) = d.get(*spalte).filter(|w| !w.is_null()) else {
            continue;
        };
        let w = match (*feld, w) {
            ("bestaetigung_pflicht", Value::Number(n)) => Value::Bool(n.as_i64() != Some(0)),
            _ => w.clone(),
        };
        body.insert((*feld).to_string(), w);
    }
    for v in b.body_verweise {
        let antrag::AntragZiel::Einsatz(ziel) = v.ziel else {
            continue;
        };
        let Some(wert) = body.get(v.pfad).and_then(als_schluessel) else {
            continue;
        };
        match neuer_lokaler_schluessel(conn, einsatz_id, ziel, &wert).await? {
            Ok(None) => {}
            Ok(Some(neu)) => {
                let neu = neu
                    .parse::<i64>()
                    .map(Value::from)
                    .unwrap_or(Value::from(neu));
                body.insert(v.pfad.to_string(), neu);
            }
            Err(()) if VERZICHTBAR.contains(&(tabelle, v.pfad)) => {
                body.remove(v.pfad);
            }
            Err(()) => {
                return Err(AppError::Validation("Bezug noch nicht beim Führer.".into()));
            }
        }
    }
    Ok(Value::Object(body))
}

/// Ergebnis des Stellens: der Antrag, sein Zustand und ob er neu ist.
#[derive(Debug, Clone)]
pub struct Gestellt {
    pub antrag_id: i64,
    pub zustand: String,
    pub neu: bool,
}

/// Stellt eine Erfassung der Bruchstelle als Antrag an den Führer (N1, N3), auf einer offenen
/// Transaktion. Ein zweites Stellen liefert den vorhandenen Antrag. 404, wenn es die Erfassung
/// hier nicht gibt; 409, wenn sie verworfen ist; 422, wenn sie sich nicht nachreichen lässt oder
/// ein Bezug noch fehlt.
pub async fn stellen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bruch_id: i64,
    benutzer_id: i64,
) -> Result<Gestellt, AppError> {
    let zeile: Option<(String, String, Option<String>, Option<i64>, Option<String>)> =
        sqlx::query_as(
            "SELECT art, daten, erledigt, antrag_id, client_id FROM einsatz_bruchstelle \
             WHERE id = ? AND einsatz_id = ? AND entfernt = 1 AND daten IS NOT NULL \
             AND folge_von IS NULL",
        )
        .bind(bruch_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
    let Some((tabelle, daten, erledigt, antrag_id, eigene_client_id)) = zeile else {
        return Err(AppError::NotFound);
    };
    match erledigt.as_deref() {
        Some("verworfen") => return Err(AppError::Conflict("Schon verworfen.".into())),
        Some(_) => {
            let vorhanden: Option<String> = match antrag_id {
                Some(a) => {
                    sqlx::query_scalar("SELECT zustand FROM spiegel_antrag WHERE id = ?")
                        .bind(a)
                        .fetch_optional(&mut *conn)
                        .await?
                }
                None => None,
            };
            return match (antrag_id, vorhanden) {
                (Some(a), Some(zustand)) => Ok(Gestellt {
                    antrag_id: a,
                    zustand,
                    neu: false,
                }),
                _ => Err(AppError::Conflict("Schon nachgereicht.".into())),
            };
        }
        None => {}
    }
    let d = match serde_json::from_str::<Value>(&daten) {
        Ok(Value::Object(d)) => d,
        _ => Map::new(),
    };
    let unmoeglich = || AppError::Validation("Lässt sich nicht als Antrag stellen.".into());
    let art = nachreichbar_als(&tabelle, &d).ok_or_else(unmoeglich)?;
    let b = BEANTRAGBAR
        .iter()
        .find(|b| b.art == art)
        .ok_or_else(unmoeglich)?;
    let body = body_der_zeile(conn, einsatz_id, &tabelle, b, &d).await?;
    // Die `client_id` der Erfassung, sonst eine feste für diese Zeile: Über eine Ablehnung und ein
    // erneutes Stellen bleibt sie gleich.
    let client_id = text(&d, "client_id")
        .or(eigene_client_id)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    // Ein abgelehnter Antrag derselben Erfassung macht dem neuen Platz.
    sqlx::query(
        "DELETE FROM spiegel_antrag WHERE einsatz_id = ? AND art = ? AND client_id = ? \
         AND zustand = 'abgelehnt'",
    )
    .bind(einsatz_id)
    .bind(art)
    .bind(&client_id)
    .execute(&mut *conn)
    .await?;
    let (id, zustand, neu) = antrag::lege_an_tx(
        conn,
        b,
        einsatz_id,
        benutzer_id,
        &[],
        body,
        Some(&client_id),
    )
    .await?;
    sqlx::query(
        "UPDATE einsatz_bruchstelle SET erledigt = 'nachgereicht', erledigt_at = ?, \
         erledigt_von_id = ?, antrag_id = ?, client_id = ? WHERE id = ?",
    )
    .bind(crate::zeit::jetzt())
    .bind(benutzer_id)
    .bind(id)
    .bind(&client_id)
    .bind(bruch_id)
    .execute(&mut *conn)
    .await?;
    Ok(Gestellt {
        antrag_id: id,
        zustand,
        neu,
    })
}

/// Stellt alle nachreichbaren offenen Erfassungen in der Reihenfolge ihrer Zeit (N5), jede in
/// eigener Transaktion. Was scheitert (ein Bezug fehlt noch), bleibt offen und steht mit Grund im
/// Ergebnis. `darf` wie bei [`liste`].
pub async fn alle_stellen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    darf: impl Fn(&str) -> bool,
) -> Result<BruchAlleErgebnis, AppError> {
    let offen: Vec<BruchErfassung> = liste(pool, einsatz_id, &darf)
        .await?
        .into_iter()
        .filter(|e| e.antrag_art.is_some())
        .collect();
    let mut ergebnis = BruchAlleErgebnis {
        gestellt: 0,
        offen: Vec::new(),
    };
    for e in offen {
        let lauf = crate::write_retry!(pool, |conn| {
            stellen_tx(conn, einsatz_id, e.id, benutzer_id).await
        });
        match lauf {
            Ok(_) => ergebnis.gestellt += 1,
            Err(AppError::Validation(grund) | AppError::Conflict(grund)) => {
                ergebnis.offen.push(BruchOffen { id: e.id, grund });
            }
            Err(f) => return Err(f),
        }
    }
    if ergebnis.gestellt > 0 {
        super::takt::wecken();
    }
    Ok(ergebnis)
}

/// Legt eine offene Erfassung ab (N6). 404, wenn es sie hier nicht gibt; 409, wenn sie schon
/// nachgereicht oder verworfen ist.
pub async fn verwerfen(
    pool: &SqlitePool,
    einsatz_id: i64,
    bruch_id: i64,
    benutzer_id: i64,
) -> Result<(), AppError> {
    crate::write_retry!(pool, |conn| {
        let erledigt: Option<Option<String>> = sqlx::query_scalar(
            "SELECT erledigt FROM einsatz_bruchstelle WHERE id = ? AND einsatz_id = ? \
             AND entfernt = 1 AND daten IS NOT NULL AND folge_von IS NULL",
        )
        .bind(bruch_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        match erledigt {
            None => Err(AppError::NotFound),
            Some(Some(_)) => Err(AppError::Conflict("Schon erledigt.".into())),
            Some(None) => {
                sqlx::query(
                    "UPDATE einsatz_bruchstelle SET erledigt = 'verworfen', erledigt_at = ?, \
                     erledigt_von_id = ? WHERE id = ?",
                )
                .bind(crate::zeit::jetzt())
                .bind(benutzer_id)
                .bind(bruch_id)
                .execute(&mut *conn)
                .await?;
                Ok(())
            }
        }
    })
}

/// Übernimmt die Quittung eines Antrags in die Erfassung, die mit ihm nachgereicht war: Ein
/// abgelehnter Antrag macht sie wieder offen (N2; der Antrag bleibt verbunden, ein erneutes
/// Stellen ersetzt ihn). Ein übernommener merkt sich den Schlüssel beim Führer
/// (`nachgereicht_als`), damit spätere Erfassungen, die auf sie verweisen, sie wiederfinden.
pub async fn quittung_uebernehmen(
    conn: &mut SqliteConnection,
    antrag_id: i64,
    abgelehnt: bool,
    ergebnis_schluessel: Option<&str>,
) -> Result<(), AppError> {
    if abgelehnt {
        sqlx::query(
            "UPDATE einsatz_bruchstelle SET erledigt = NULL, erledigt_at = NULL, \
             erledigt_von_id = NULL WHERE antrag_id = ? AND erledigt = 'nachgereicht'",
        )
        .bind(antrag_id)
        .execute(&mut *conn)
        .await?;
    } else if let Some(s) = ergebnis_schluessel {
        sqlx::query("UPDATE einsatz_bruchstelle SET nachgereicht_als = ? WHERE antrag_id = ?")
            .bind(s)
            .bind(antrag_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::repo::{anlegen, NeuerEinsatzDaten};

    async fn einsatz(pool: &SqlitePool) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let leit: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        anlegen(
            pool,
            NeuerEinsatzDaten {
                bezeichnung: "Lage",
                stichwort: None,
                einsatzart: None,
                begonnen_at: None,
                ort: Default::default(),
                vorlage_id: None,
            },
            leit,
        )
        .await
        .unwrap()
        .id
    }

    /// Legt eine entfernte Zeile der Bruchstelle an; liefert ihre Kennung.
    async fn gesichert(
        pool: &SqlitePool,
        e: i64,
        art: &str,
        schluessel: &str,
        daten: Value,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_bruchstelle (einsatz_id, art, schluessel, stand, daten, entfernt, \
             geklaert, gesichert_at) VALUES (?, ?, ?, 1, ?, 1, 1, '2026-11-11 10:00:00') \
             RETURNING id",
        )
        .bind(e)
        .bind(art)
        .bind(schluessel)
        .bind(daten.to_string())
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn ordnen(pool: &SqlitePool, e: i64) {
        let mut conn = pool.acquire().await.unwrap();
        ordne_folgen(&mut conn, e).await.unwrap();
    }

    async fn folge_von(pool: &SqlitePool, id: i64) -> Option<i64> {
        sqlx::query_scalar("SELECT folge_von FROM einsatz_bruchstelle WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    fn alles(_: &str) -> bool {
        true
    }

    #[tokio::test]
    async fn eine_meldung_ist_eine_erfassung_mit_ihrem_etb_eintrag() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        let m = gesichert(
            &pool,
            e,
            "meldung",
            "7",
            serde_json::json!({"id": 7, "inhalt": "Deich hält", "absender": "Florian 1",
                               "etb_meldung_id": 40, "ereigniszeit": "2026-11-11 09:05:00"}),
        )
        .await;
        let etb = gesichert(
            &pool,
            e,
            "etb_eintrag",
            "40",
            serde_json::json!({"id": 40, "typ": "meldung", "inhalt": "Deich hält",
                               "meldung_id": 7, "ereigniszeit": "2026-11-11 09:05:00"}),
        )
        .await;
        let eigen = gesichert(
            &pool,
            e,
            "etb_eintrag",
            "41",
            serde_json::json!({"id": 41, "typ": "lage", "inhalt": "Lage ruhig", "von": "S2",
                               "ereigniszeit": "2026-11-11 09:00:00"}),
        )
        .await;
        let berichtigung = gesichert(
            &pool,
            e,
            "etb_eintrag",
            "42",
            serde_json::json!({"id": 42, "typ": "berichtigung", "inhalt": "Lage unruhig",
                               "berichtigt_eintrag_id": 41,
                               "ereigniszeit": "2026-11-11 09:10:00"}),
        )
        .await;
        ordnen(&pool, e).await;
        assert_eq!(
            folge_von(&pool, etb).await,
            Some(m),
            "ETB-Eintrag der Meldung"
        );
        assert_eq!(
            folge_von(&pool, m).await,
            None,
            "die Meldung ist der Ursprung"
        );
        assert_eq!(
            folge_von(&pool, berichtigung).await,
            None,
            "eigene Erfassung"
        );

        let liste = liste(&pool, e, alles).await.unwrap();
        let ids: Vec<i64> = liste.iter().map(|l| l.id).collect();
        assert_eq!(ids, [eigen, m, berichtigung], "nach Zeit, ohne Folgezeile");
        assert_eq!(liste[1].folgen, 1);
        assert_eq!(liste[1].antrag_art.as_deref(), Some("meldung"));
        assert_eq!(liste[1].von.as_deref(), Some("Florian 1"));
        assert_eq!(liste[0].antrag_art.as_deref(), Some("etb"));
        assert_eq!(liste[0].typ.as_deref(), Some("lage"));
    }

    #[tokio::test]
    async fn spur_eines_vorgangs_und_systemeintrag_sind_nur_lesbar() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        gesichert(
            &pool,
            e,
            "etb_eintrag",
            "1",
            serde_json::json!({"id": 1, "typ": "system", "inhalt": "Person registriert"}),
        )
        .await;
        gesichert(
            &pool,
            e,
            "etb_eintrag",
            "2",
            serde_json::json!({"id": 2, "typ": "meldung", "inhalt": "Auftrag erledigt",
                               "auftrag_id": 3}),
        )
        .await;
        gesichert(
            &pool,
            e,
            "einsatz_person",
            "5",
            serde_json::json!({"id": 5, "name": "Muster", "vorname": "Max"}),
        )
        .await;
        ordnen(&pool, e).await;
        let liste = liste(&pool, e, alles).await.unwrap();
        assert_eq!(liste.len(), 3);
        assert!(liste.iter().all(|l| l.antrag_art.is_none()), "{liste:?}");
        let person = liste
            .iter()
            .find(|l| l.tabelle == "einsatz_person")
            .unwrap();
        assert_eq!(person.kurz.as_deref(), Some("Muster, Max"));

        // Ohne Freigabe des Moduls Personen kein Inhalt.
        let ohne = super::liste(&pool, e, |m| m != "personen").await.unwrap();
        let person = ohne.iter().find(|l| l.tabelle == "einsatz_person").unwrap();
        assert!(person.verborgen && person.kurz.is_none());
    }

    #[tokio::test]
    async fn verworfen_zaehlt_nicht_und_kann_nicht_gestellt_werden() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        let b = gesichert(
            &pool,
            e,
            "etb_eintrag",
            "1",
            serde_json::json!({"id": 1, "typ": "lage", "inhalt": "x", "von": "a", "an": "b"}),
        )
        .await;
        ordnen(&pool, e).await;
        verwerfen(&pool, e, b, 1).await.unwrap();
        assert!(liste(&pool, e, alles).await.unwrap().is_empty());
        assert!(matches!(
            verwerfen(&pool, e, b, 1).await,
            Err(AppError::Conflict(_))
        ));
        let mut conn = pool.acquire().await.unwrap();
        assert!(matches!(
            stellen_tx(&mut conn, e, b, 1).await,
            Err(AppError::Conflict(_))
        ));
        drop(conn);
        assert!(matches!(
            verwerfen(&pool, e + 1, b, 1).await,
            Err(AppError::NotFound)
        ));
    }

    #[tokio::test]
    async fn schwaerzung_des_einsatzes_leert_die_liste() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        gesichert(
            &pool,
            e,
            "etb_eintrag",
            "1",
            serde_json::json!({"id": 1, "typ": "lage", "inhalt": "x"}),
        )
        .await;
        ordnen(&pool, e).await;
        assert_eq!(liste(&pool, e, alles).await.unwrap().len(), 1);
        let mut conn = pool.acquire().await.unwrap();
        crate::einsatz::schwaerzung_registry::scrubbe_aus_registry(
            &mut conn,
            e,
            crate::einsatz::schwaerzung_registry::Umfang::Alles,
        )
        .await
        .unwrap();
        drop(conn);
        assert!(liste(&pool, e, alles).await.unwrap().is_empty());
    }
}
