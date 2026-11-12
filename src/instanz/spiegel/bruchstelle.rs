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
//!
//! Personen samt Verlauf (LLH-1657, Entwurf K1–K6, von Ruben am 12.11.2026 freigegeben): Eine
//! Person ist eine Erfassung, ihre Einträge (Sichtung, Verbleib, Notiz, Transport, Anlass,
//! Maßnahme, Verletzung) hängen über `person_id` an ihr ([`URSPRUNG`]). Gestellt wird die Person;
//! ihre Einträge bilden eine **Kette**, die [`ketten_fortsetzen`] im Takt selbst stellt, sobald
//! die Person beim Spiegel zurück ist, in Zeitfolge und im Namen derselben Person (K1). Danach
//! geht die Nachreich-Notiz an die Person (K3–K5). Ein Eintrag, der sich nicht stellen lässt oder
//! abgelehnt wird, löst sich mit `grund` von der Kette und steht als eigene Zeile da. Einträge an
//! einer Person, die der Führer kennt, sind sofort stellbar.

use super::antrag::{self, Beantragbar, BEANTRAGBAR};
use super::schema::{self, Ziel};
use super::SpiegelKategorie;
use crate::error::AppError;
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;
use utoipa::ToSchema;

/// Tabellen, deren neue Zeilen sich als Antrag nachreichen lassen (N1; Personen samt Verlauf
/// LLH-1657), mit der Art des Antrags.
pub const NACHREICHBAR: &[(&str, &str)] = &[
    ("etb_eintrag", "etb"),
    ("meldung", "meldung"),
    ("einsatz_person", "person"),
    ("person_sichtung", "sichtung"),
    ("person_verbleib", "verbleib"),
    ("person_verlaufsnotiz", "notiz"),
    ("person_transport", "transport"),
    ("person_anlass", "anlass"),
    ("person_massnahme", "massnahme"),
    ("person_verletzung", "verletzung"),
];

/// Antragsarten, deren Route die Person im Pfad trägt (`…/personen/{pid}/…`).
const AN_DER_PERSON: &[&str] = &[
    "sichtung",
    "verbleib",
    "notiz",
    "transport",
    "anlass",
    "massnahme",
    "verletzung",
];

/// Verweise, über die eine Zeile dieser Tabellen Folge einer anderen wird (LLH-1657). Die übrigen
/// Verweise zeigen auf ein Ziel (die UHS, die versorgende Einheit, die Betreuungsstelle eines
/// Verbleibs), nicht auf den Ursprung: Ein Verbleib an einer neuen Betreuungsstelle hängt an
/// seiner Person. Eine Person ist immer eigene Erfassung, auch an einer neuen Meldung oder in
/// einem neuen Haushalt; ein Haushalt und die Aufnahme in eine UHS ebenso (lesbar, verwerfbar).
/// Tabellen ohne Eintrag folgen jedem Verweis.
pub const URSPRUNG: &[(&str, &[&str])] = &[
    ("einsatz_person", &[]),
    ("haushalt", &[]),
    ("person_uhs_belegung", &[]),
    ("person_sichtung", &["person_id"]),
    ("person_verbleib", &["person_id"]),
    ("person_verlaufsnotiz", &["person_id"]),
    ("person_transport", &["person_id"]),
    ("person_anlass", &["person_id"]),
    ("person_massnahme", &["person_id"]),
    ("person_verletzung", &["person_id"]),
];

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

/// Verweise, die beim Nachreichen wegfallen dürfen, wenn der Führer ihr Ziel nicht kennt und nie
/// kennen wird (nicht, solange es nur auf seine Quittung wartet): Die
/// Route stuft sie dann ohnehin zu „ungebunden“ herab (Absender einer Meldung, LFH-610).
const VERZICHTBAR: &[(&str, &str)] = &[
    ("meldung", "einheit_id"),
    ("meldung", "abschnitt_id"),
    // Die Person kommt auch ohne versorgende Einheit und ohne Meldung an, die der Führer nicht
    // kennt (LLH-1657, K6). Wartet der Bezug nur auf seine Quittung, wartet auch sie.
    ("einsatz_person", "versorgende_einheit_id"),
    ("einsatz_person", "meldung_id"),
];

/// Grund, wenn ein Bezug einer Erfassung schon nachgereicht, aber noch nicht wieder hier ist: Die
/// Kette wartet ([`ketten_fortsetzen`]), ein einzelnes Stellen meldet ihn.
pub const BEZUG_WARTET: &str = "Bezug noch nicht beim Führer.";

/// Grund, wenn ein Bezug selbst nicht nachgereicht wird (verworfen, nicht nachreichbar, offen).
pub const BEZUG_FEHLT: &str = "Bezug ist nicht nachgereicht.";

/// Grund an einem Eintrag einer Kette, wenn der Einsatz hier wieder selbst geführt wird.
pub const FUEHRUNG_GEWECHSELT: &str = "Führung gewechselt; bitte neu erfassen.";

/// Höchstlänge des Kurzinhalts in der Liste (Zeichen).
pub const KURZ_MAX: usize = 200;

/// Eine nicht übernommene Erfassung, wie die Liste am Band sie zeigt (N2).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BruchErfassung {
    pub id: i64,
    /// Tabelle der Zeile (`etb_eintrag`, `meldung`, `einsatz_person` …).
    pub tabelle: String,
    pub kategorie: SpiegelKategorie,
    /// Art des Antrags, wenn sie sich nachreichen lässt (`etb`, `meldung`, `person`, `sichtung` …,
    /// siehe [`NACHREICHBAR`]).
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
    /// Schon gestellt; die Zeile steht nur noch da, weil Einträge ihrer Kette folgen (LLH-1657).
    /// Kein Stellen, kein Verwerfen, zählt nicht im Band.
    pub nachgereicht: bool,
    /// Einträge der Kette, die der Spiegel noch selbst stellt, sobald ihr Bezug beim Führer ist.
    pub folgen_offen: i64,
    /// Warum ein Eintrag der Kette als eigene Zeile zurück ist (abgelehnt, ein Bezug fehlt).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grund: Option<String>,
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
        "etb" => "etb",
        _ => "personen",
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

/// Eine Zeile für [`ordne_folgen`]: Kennung, Tabelle, Schlüssel, Daten, Sicherung, Ursprung,
/// Grund.
type OrdnungsZeile = (
    i64,
    String,
    String,
    String,
    String,
    Option<i64>,
    Option<String>,
);

/// Ordnet die entfernten Zeilen eines Einsatzes ihren Erfassungen zu (`folge_von`, N2). Läuft,
/// sobald Zeilen der Bruchstelle entfernt sind. Gruppiert wird je Sicherung (`gesichert_at`),
/// denn SQLite vergibt die Kennung einer gelöschten Zeile neu.
pub async fn ordne_folgen(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<(), AppError> {
    let zeilen: Vec<OrdnungsZeile> = sqlx::query_as(
        "SELECT id, art, schluessel, daten, gesichert_at, folge_von, grund FROM einsatz_bruchstelle \
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
    for (id, art, schluessel, _, gesichert, _, _) in &zeilen {
        index.insert((gesichert.as_str(), art.as_str(), schluessel.as_str()), *id);
    }
    let mut eltern: HashMap<i64, i64> = HashMap::new();
    for (id, art, _, daten, gesichert, _, _) in &zeilen {
        let (Some(t), Ok(Value::Object(d))) =
            (schema.tabelle(art), serde_json::from_str::<Value>(daten))
        else {
            continue;
        };
        let ursprung = URSPRUNG.iter().find(|(t, _)| t == art).map(|(_, s)| *s);
        for sp in &t.spalten {
            if KEINE_FOLGE.contains(&(art.as_str(), sp.name.as_str())) {
                continue;
            }
            if ursprung.is_some_and(|u| !u.contains(&sp.name.as_str())) {
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
            // An einer Person hängt nur, was `URSPRUNG` über `person_id` an sie bindet (und ihre
            // Systemeinträge): Ein Schaden, ein Anhang, ein Abgleich mit ihr bleibt eigene Zeile,
            // sonst verschwände er ungesehen, sobald die Person gestellt ist.
            if ziel == "einsatz_person" && ursprung.is_none() {
                continue;
            }
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
    spur_der_personen(conn, einsatz_id, &zeilen, &mut eltern).await?;
    // Ein Kreis (zwei Zeilen, die aufeinander zeigen und nicht ausgenommen sind) hätte keinen
    // Ursprung: die kleinste Kennung im Kreis wird Ursprung. Nur die Zeilen ab dem Wiedereintritt
    // gehören zum Kreis; eine Zeile auf dem Weg dorthin bleibt an ihm hängen.
    let ids: Vec<i64> = zeilen.iter().map(|z| z.0).collect();
    loese_kreise(&mut eltern, &ids);
    for (id, _, _, _, _, vorher, grund) in &zeilen {
        // Ein Eintrag, der mit Grund aus seiner Kette zurück ist, bleibt eigene Zeile (LLH-1657).
        if grund.is_some() {
            continue;
        }
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

/// Die Registriernummer, die ein Systemeintrag des ETB nennt («Person R-002 erfasst»,
/// «Person R-002: Sichtung SK II»), aus den Texten in `person`.
fn registrier_nr_im_systemeintrag(inhalt: &str) -> Option<i64> {
    let rest = inhalt.strip_prefix("Person R-")?;
    let ziffern: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let danach = rest[ziffern.len()..].chars().next();
    if ziffern.is_empty() || !matches!(danach, Some(' ' | ':' | ',')) {
        return None;
    }
    ziffern.parse().ok()
}

/// Systemeinträge des ETB zu einer Person sind ihre Spur (LLH-1657): Der Führer schreibt sie
/// beim Nachreichen selbst. Sie hängen an der nachgereichten Person, bei einer Person, die der
/// Führer kennt, am ersten ihrer Einträge derselben Sicherung; sonst bleiben sie eigene Zeile.
async fn spur_der_personen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    zeilen: &[OrdnungsZeile],
    eltern: &mut HashMap<i64, i64>,
) -> Result<(), AppError> {
    let mut neue: HashMap<(&str, i64), i64> = HashMap::new();
    let mut eintraege: HashMap<(&str, String), i64> = HashMap::new();
    let mut systemeintraege = Vec::new();
    for (id, art, _, daten, gesichert, _, _) in zeilen {
        let Ok(Value::Object(d)) = serde_json::from_str::<Value>(daten) else {
            continue;
        };
        match art.as_str() {
            "einsatz_person" => {
                if let Some(nr) = d.get("registrier_nr").and_then(Value::as_i64) {
                    neue.entry((gesichert.as_str(), nr)).or_insert(*id);
                }
            }
            "etb_eintrag" if text(&d, "typ").as_deref() == Some(crate::etb::TYP_SYSTEM) => {
                if let Some(nr) =
                    text(&d, "inhalt").and_then(|i| registrier_nr_im_systemeintrag(&i))
                {
                    systemeintraege.push((*id, gesichert.as_str(), nr));
                }
            }
            a if NACHREICHBAR
                .iter()
                .any(|(t, art)| *t == a && AN_DER_PERSON.contains(art)) =>
            {
                if let Some(p) = d.get("person_id").and_then(als_schluessel) {
                    eintraege.entry((gesichert.as_str(), p)).or_insert(*id);
                }
            }
            _ => {}
        }
    }
    if systemeintraege.is_empty() {
        return Ok(());
    }
    let bekannt: HashMap<i64, i64> =
        sqlx::query_as("SELECT registrier_nr, id FROM einsatz_person WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_all(&mut *conn)
            .await?
            .into_iter()
            .collect();
    for (id, gesichert, nr) in systemeintraege {
        if eltern.contains_key(&id) {
            continue;
        }
        let ziel = neue.get(&(gesichert, nr)).copied().or_else(|| {
            bekannt
                .get(&nr)
                .and_then(|p| eintraege.get(&(gesichert, p.to_string())).copied())
        });
        if let Some(ziel) = ziel {
            eltern.insert(id, ziel);
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
        // Eine am ELW stornierte Person war eine Fehleingabe (LLH-1657, K6).
        "einsatz_person" => frei("storniert_at"),
        _ => true,
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
    if matches!(
        tabelle,
        "person_sichtung" | "person_massnahme" | "person_verletzung"
    ) {
        return eintrag_wert(tabelle, d)
            .filter(|w| !w.trim().is_empty())
            .map(kuerze);
    }
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

/// Name einer Person („Muster, Max“): aus der Bruchstelle, sonst aus dem Einsatz.
async fn person_name(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    zeilen: &[BruchZeile],
    person: &str,
) -> Result<Option<String>, AppError> {
    if let Some(z) = zeilen
        .iter()
        .find(|z| z.art == "einsatz_person" && z.schluessel == person)
    {
        return Ok(kurzinhalt("einsatz_person", &z.daten()));
    }
    let name: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT name, vorname FROM einsatz_person WHERE einsatz_id = ? AND id = ?")
            .bind(einsatz_id)
            .bind(person)
            .fetch_optional(&mut *conn)
            .await?;
    Ok(name.and_then(|(n, v)| {
        let teile: Vec<String> = [n, v]
            .into_iter()
            .flatten()
            .filter(|t| !t.trim().is_empty())
            .collect();
        (!teile.is_empty()).then(|| kuerze(teile.join(", ")))
    }))
}

/// Eine entfernte Zeile der Bruchstelle mit allem, was Liste und Kette brauchen.
#[derive(Debug, Clone, sqlx::FromRow)]
struct BruchZeile {
    id: i64,
    art: String,
    schluessel: String,
    daten: String,
    gesichert_at: String,
    folge_von: Option<i64>,
    erledigt: Option<String>,
    erledigt_von_id: Option<i64>,
    antrag_id: Option<i64>,
    grund: Option<String>,
    notiz_at: Option<String>,
}

impl BruchZeile {
    fn daten(&self) -> Map<String, Value> {
        match serde_json::from_str::<Value>(&self.daten) {
            Ok(Value::Object(d)) => d,
            _ => Map::new(),
        }
    }
}

/// Die entfernten Zeilen eines Einsatzes mit Inhalt, nach Kennung.
async fn bruch_zeilen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<BruchZeile>, AppError> {
    Ok(sqlx::query_as(
        "SELECT id, art, schluessel, daten, gesichert_at, folge_von, erledigt, erledigt_von_id, \
         antrag_id, grund, notiz_at FROM einsatz_bruchstelle \
         WHERE einsatz_id = ? AND entfernt = 1 AND daten IS NOT NULL ORDER BY id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Die Zeilen eines Einsatzes als Baum: Ursprung jeder Zeile und die Einträge, die in einer
/// Kette noch zu stellen sind (LLH-1657).
struct Ketten<'a> {
    nach_id: HashMap<i64, &'a BruchZeile>,
}

impl<'a> Ketten<'a> {
    fn neu(zeilen: &'a [BruchZeile]) -> Self {
        Self {
            nach_id: zeilen.iter().map(|z| (z.id, z)).collect(),
        }
    }

    /// Der Ursprung einer Zeile (sie selbst, wenn sie keinen hat). Ein Kreis endet an der Zeile,
    /// an der er sich schließt; `ordne_folgen` lässt keinen stehen.
    fn ursprung(&self, z: &'a BruchZeile) -> &'a BruchZeile {
        let mut k = z;
        let mut schritte = 0;
        while let Some(e) = k.folge_von.and_then(|e| self.nach_id.get(&e)) {
            k = e;
            schritte += 1;
            if schritte > self.nach_id.len() {
                break;
            }
        }
        k
    }

    /// Ein Eintrag, den die Kette noch stellt: Folge eines nachgereichten Ursprungs, selbst
    /// nachreichbar, weder gestellt noch erledigt noch mit Grund zurück.
    fn wartet(&self, z: &'a BruchZeile) -> bool {
        z.folge_von.is_some()
            && z.erledigt.is_none()
            && z.antrag_id.is_none()
            && z.grund.is_none()
            && nachreichbar_als(&z.art, &z.daten()).is_some()
            && self.ursprung(z).erledigt.as_deref() == Some("nachgereicht")
    }
}

/// Die offenen Erfassungen der Bruchstelle eines Einsatzes, nach Zeit (N2). `darf` sagt je Modul,
/// ob die Person es nutzen darf; ohne Freigabe steht nur Art und Zeit da. Eine gestellte
/// Erfassung, deren Kette noch Einträge stellt, bleibt ohne Knöpfe stehen (LLH-1657, K1).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    darf: impl Fn(&str) -> bool,
) -> Result<Vec<BruchErfassung>, AppError> {
    let mut conn = pool.acquire().await?;
    let schema = schema::schema(&mut conn).await?;
    let zeilen = bruch_zeilen(&mut conn, einsatz_id).await?;
    let ketten = Ketten::neu(&zeilen);
    let mut folgen: HashMap<i64, i64> = HashMap::new();
    let mut folgen_offen: HashMap<i64, i64> = HashMap::new();
    for z in &zeilen {
        if let Some(e) = z.folge_von {
            *folgen.entry(e).or_default() += 1;
        }
        if ketten.wartet(z) {
            *folgen_offen.entry(ketten.ursprung(z).id).or_default() += 1;
        }
    }
    let mut liste = Vec::new();
    for z in &zeilen {
        let offen_in_kette = folgen_offen.get(&z.id).copied().unwrap_or(0);
        let nachgereicht = z.erledigt.as_deref() == Some("nachgereicht");
        if z.folge_von.is_some() || !(z.erledigt.is_none() || nachgereicht && offen_in_kette > 0) {
            continue;
        }
        let tabelle = z.art.clone();
        let d = z.daten();
        let kategorie = schema
            .tabelle(&tabelle)
            .map(|t| t.kategorie)
            .unwrap_or(SpiegelKategorie::Fuehrung);
        let verborgen = !darf(modul_der_zeile(&tabelle, kategorie));
        let zeit = ZEIT_FELDER.iter().find_map(|f| text(&d, f));
        let (antrag_art, typ, von, kurz, grund) = if verborgen {
            (None, None, None, None, None)
        } else {
            let art = nachreichbar_als(&tabelle, &d)
                .filter(|a| darf(modul_des_antrags(a)))
                .filter(|_| !nachgereicht);
            let typ = (tabelle == "etb_eintrag")
                .then(|| text(&d, "typ"))
                .flatten();
            let von = text(&d, "von").or_else(|| text(&d, "absender"));
            let kurz = match tabelle.as_str() {
                // Die Aufnahme in eine UHS nennt ihre Person, der Haushalt seine Nummer.
                "person_uhs_belegung" => match d.get("person_id").and_then(als_schluessel) {
                    Some(p) => person_name(&mut conn, einsatz_id, &zeilen, &p).await?,
                    None => None,
                },
                "haushalt" => d
                    .get("nummer")
                    .and_then(Value::as_i64)
                    .map(|n| format!("Nr. {n}")),
                _ => kurzinhalt(&tabelle, &d),
            };
            (art.map(str::to_string), typ, von, kurz, z.grund.clone())
        };
        liste.push(BruchErfassung {
            id: z.id,
            tabelle,
            kategorie,
            antrag_art,
            typ,
            zeit,
            von,
            kurz,
            verborgen,
            folgen: folgen.get(&z.id).copied().unwrap_or(0),
            gesichert_at: z.gesichert_at.clone(),
            nachgereicht,
            folgen_offen: offen_in_kette,
            grund,
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

/// Felder der Personen-Anlage (LLH-1657). `status` und `vermisst_seit` bildet
/// [`body_der_zeile`], die Bestätigung am Gerät geht nicht mit (K5). Was nur die Bearbeitung
/// setzt, nimmt die Anlage seit K2 mit (PAT-Nummer, Kontamination, Kostform, Unverträglichkeiten).
const PERSON_FELDER: &[(&str, &str)] = &[
    ("name", "name"),
    ("vorname", "vorname"),
    ("geschlecht", "geschlecht"),
    ("geburtsdatum", "geburtsdatum"),
    ("alter_geschaetzt", "alter_geschaetzt"),
    ("herkunft_adresse", "herkunft_adresse"),
    ("antreff_ort", "antreff_ort"),
    ("melder_kontakt", "melder_kontakt"),
    ("notiz", "notiz"),
    ("zustand", "zustand"),
    ("antreff_lat", "antreff_lat"),
    ("antreff_lon", "antreff_lon"),
    ("client_id", "client_id"),
    ("zeitpunkt_at", "erfasst_at"),
    ("versorgende_einheit_id", "versorgende_einheit_id"),
    ("meldung_id", "meldung_id"),
    ("pat_nummer", "pat_nummer"),
    ("kontamination", "kontamination"),
    ("kostform", "kostform"),
    ("unvertraeglichkeiten", "unvertraeglichkeiten"),
];

const SICHTUNG_FELDER: &[(&str, &str)] = &[
    ("kategorie", "kategorie"),
    ("notiz", "notiz"),
    ("zeitpunkt_at", "gesichtet_at"),
    ("client_id", "client_id"),
];

const VERBLEIB_FELDER: &[(&str, &str)] = &[
    ("art", "art"),
    ("transportmittel", "transportmittel"),
    ("ziel", "ziel"),
    ("status", "status"),
    ("notiz", "notiz"),
    ("betreuungsstelle_id", "betreuungsstelle_id"),
    ("zeitpunkt_at", "zeitpunkt_at"),
    ("client_id", "client_id"),
    ("transport_durch", "transport_durch"),
    ("einsatz_fahrzeug_id", "einsatz_fahrzeug_id"),
    ("leitstelle_einsatznummer", "leitstelle_einsatznummer"),
    ("entlassen_an", "entlassen_an"),
    ("gegen_rat", "gegen_rat"),
    ("unterschrift", "unterschrift"),
];

const NOTIZ_FELDER: &[(&str, &str)] = &[
    ("text", "text"),
    ("zeitpunkt_at", "erfasst_at"),
    ("client_id", "client_id"),
];

const TRANSPORT_FELDER: &[(&str, &str)] = &[
    ("prioritaet", "prioritaet"),
    ("art", "art"),
    ("fachrichtung", "fachrichtung"),
    ("zeitpunkt_at", "zeitpunkt_at"),
    ("client_id", "client_id"),
];

const ANLASS_FELDER: &[(&str, &str)] = &[
    ("anlass", "anlass"),
    ("zeitpunkt_at", "zeitpunkt_at"),
    ("client_id", "client_id"),
];

const MASSNAHME_FELDER: &[(&str, &str)] = &[
    ("art", "art"),
    ("zeitpunkt_at", "zeitpunkt_at"),
    ("client_id", "client_id"),
];

const VERLETZUNG_FELDER: &[(&str, &str)] = &[
    ("ansicht", "ansicht"),
    ("region", "region"),
    ("art", "art"),
    ("schwere", "schwere"),
    ("x", "x"),
    ("y", "y"),
    ("notiz", "notiz"),
    ("zeitpunkt_at", "zeitpunkt_at"),
    ("client_id", "client_id"),
];

fn felder_der_tabelle(tabelle: &str) -> &'static [(&'static str, &'static str)] {
    match tabelle {
        "meldung" => MELDUNG_FELDER,
        "einsatz_person" => PERSON_FELDER,
        "person_sichtung" => SICHTUNG_FELDER,
        "person_verbleib" => VERBLEIB_FELDER,
        "person_verlaufsnotiz" => NOTIZ_FELDER,
        "person_transport" => TRANSPORT_FELDER,
        "person_anlass" => ANLASS_FELDER,
        "person_massnahme" => MASSNAHME_FELDER,
        "person_verletzung" => VERLETZUNG_FELDER,
        _ => ETB_FELDER,
    }
}

/// Wie ein Verweis auf eine Zeile steht, die vielleicht selbst in der Bruchstelle lag.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Bezug {
    /// Der Verweis trifft keine entfernte Zeile; er gilt, wie er ist.
    Unberuehrt,
    /// Die Zeile ist nachgereicht und wieder hier, unter dieser lokalen Kennung.
    Neu(String),
    /// Die Zeile ist nachgereicht oder steht in einer laufenden Kette, ist aber noch nicht hier.
    Wartet,
    /// Die Zeile ist noch offen und ließe sich stellen (auch mit Grund zurück, oder in der Kette
    /// eines offenen Ursprungs): erst sie stellen oder verwerfen.
    Offen,
    /// Die Zeile wird nicht nachgereicht (verworfen, nicht nachreichbar).
    Fehlt,
}

/// Wie steht der Verweis auf `schluessel` in `tabelle` (LLH-1646, Drei-Wege-Antwort LLH-1657)?
async fn bezug(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    tabelle: &str,
    schluessel: &str,
) -> Result<Bezug, AppError> {
    type Zeile = (
        i64,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
    );
    let zeile: Option<Zeile> = sqlx::query_as(
        "SELECT id, nachgereicht_als, erledigt, folge_von, antrag_id, grund \
         FROM einsatz_bruchstelle \
         WHERE einsatz_id = ? AND art = ? AND schluessel = ? AND entfernt = 1 \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(tabelle)
    .bind(schluessel)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((id, fremd, erledigt, folge_von, antrag_id, grund)) = zeile else {
        return Ok(Bezug::Unberuehrt);
    };
    if let Some(fremd) = fremd {
        let lokal: Option<String> = sqlx::query_scalar(
            "SELECT lokaler_schluessel FROM spiegel_herkunft WHERE einsatz_id = ? AND art = ? \
             AND fremder_schluessel = ?",
        )
        .bind(einsatz_id)
        .bind(tabelle)
        .bind(&fremd)
        .fetch_optional(&mut *conn)
        .await?;
        return Ok(lokal.map_or(Bezug::Wartet, Bezug::Neu));
    }
    match erledigt.as_deref() {
        Some("nachgereicht") => return Ok(Bezug::Wartet),
        Some(_) => return Ok(Bezug::Fehlt),
        None => {}
    }
    // Offen: Ein Eintrag einer Kette, der noch gestellt wird, wartet; eine Zeile, die sich noch
    // stellen ließe, ist offen; eine Folgezeile, die nie gestellt wird, fehlt.
    let zeilen = bruch_zeilen(conn, einsatz_id).await?;
    let ketten = Ketten::neu(&zeilen);
    let Some(z) = zeilen.iter().find(|z| z.id == id) else {
        return Ok(Bezug::Fehlt);
    };
    if folge_von.is_some() && antrag_id.is_none() && grund.is_none() && ketten.wartet(z) {
        return Ok(Bezug::Wartet);
    }
    let ursprung = ketten.ursprung(z);
    let stellbar = |z: &BruchZeile| nachreichbar_als(&z.art, &z.daten()).is_some();
    Ok(
        if ursprung.erledigt.is_none() && stellbar(z) && stellbar(ursprung) {
            Bezug::Offen
        } else {
            Bezug::Fehlt
        },
    )
}

fn bezug_fehler(b: &Bezug) -> AppError {
    AppError::Validation(
        match b {
            Bezug::Wartet => BEZUG_WARTET,
            _ => BEZUG_FEHLT,
        }
        .into(),
    )
}

/// Der Pfad einer Antragsart an der Person (`pid` mit der lokalen Kennung der Person): eine
/// Person, die selbst nachgereicht ist, unter ihrer neuen Kennung (LLH-1657).
async fn pfad_der_zeile(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    art: &str,
    d: &Map<String, Value>,
) -> Result<Vec<(String, String)>, AppError> {
    if !AN_DER_PERSON.contains(&art) {
        return Ok(Vec::new());
    }
    let person = d
        .get("person_id")
        .and_then(als_schluessel)
        .ok_or_else(|| AppError::Validation("Lässt sich nicht als Antrag stellen.".into()))?;
    let pid = match bezug(conn, einsatz_id, "einsatz_person", &person).await? {
        Bezug::Unberuehrt => person,
        Bezug::Neu(neu) => neu,
        b => return Err(bezug_fehler(&b)),
    };
    Ok(vec![("pid".to_string(), pid)])
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
    let mut body = Map::new();
    for (feld, spalte) in felder_der_tabelle(tabelle) {
        let Some(w) = d.get(*spalte).filter(|w| !w.is_null()) else {
            continue;
        };
        let w = match (*feld, w) {
            ("bestaetigung_pflicht" | "kontamination", Value::Number(n)) => {
                Value::Bool(n.as_i64() != Some(0))
            }
            _ => w.clone(),
        };
        body.insert((*feld).to_string(), w);
    }
    if tabelle == "einsatz_person" {
        // Der Anfangsstatus (K1/K6): Sichtung, Verbleib und Abmeldung kommen als eigene Einträge
        // nach und heben ihn wie am ELW. Ein Status, den nur ein Statuswechsel setzt, steht in der
        // Nachreich-Notiz.
        let status = match text(d, "status").as_deref() {
            Some(s @ ("erfasst" | "vermisst" | "betroffen")) => s.to_string(),
            _ => "erfasst".to_string(),
        };
        if status == "vermisst" {
            if let Some(seit) = text(d, "vermisst_seit") {
                body.insert("vermisst_seit".into(), Value::from(seit));
            }
        }
        body.insert("status".into(), Value::from(status));
    }
    for v in b.body_verweise {
        let antrag::AntragZiel::Einsatz(ziel) = v.ziel else {
            continue;
        };
        let Some(wert) = body.get(v.pfad).and_then(als_schluessel) else {
            continue;
        };
        match bezug(conn, einsatz_id, ziel, &wert).await? {
            Bezug::Unberuehrt => {}
            Bezug::Neu(neu) => {
                let neu = neu
                    .parse::<i64>()
                    .map(Value::from)
                    .unwrap_or(Value::from(neu));
                body.insert(v.pfad.to_string(), neu);
            }
            Bezug::Fehlt if VERZICHTBAR.contains(&(tabelle, v.pfad)) => {
                body.remove(v.pfad);
            }
            f => return Err(bezug_fehler(&f)),
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
    stelle_zeile_tx(conn, einsatz_id, bruch_id, benutzer_id, true).await
}

/// Kern von [`stellen_tx`]; `nur_erfassung` = false nimmt auch einen Eintrag einer Kette
/// ([`ketten_fortsetzen`], LLH-1657).
async fn stelle_zeile_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bruch_id: i64,
    benutzer_id: i64,
    nur_erfassung: bool,
) -> Result<Gestellt, AppError> {
    // Tabelle, Daten, erledigt, Antrag, eigene client_id, Ursprung.
    type Zeile = (
        String,
        String,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<i64>,
    );
    let zeile: Option<Zeile> = sqlx::query_as(
        "SELECT art, daten, erledigt, antrag_id, client_id, folge_von FROM einsatz_bruchstelle \
             WHERE id = ? AND einsatz_id = ? AND entfernt = 1 AND daten IS NOT NULL",
    )
    .bind(bruch_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((tabelle, daten, erledigt, antrag_id, eigene_client_id, folge_von)) = zeile else {
        return Err(AppError::NotFound);
    };
    if nur_erfassung && folge_von.is_some() {
        return Err(AppError::NotFound);
    }
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
    let pfad = pfad_der_zeile(conn, einsatz_id, art, &d).await?;
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
        &pfad,
        body,
        Some(&client_id),
    )
    .await?;
    sqlx::query(
        "UPDATE einsatz_bruchstelle SET erledigt = 'nachgereicht', erledigt_at = ?, \
         erledigt_von_id = ?, antrag_id = ?, client_id = ?, grund = NULL WHERE id = ?",
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

/// Setzt die Ketten aller Einsätze fort (LLH-1657, K1): Einträge, deren Person (oder anderer
/// Bezug) inzwischen beim Spiegel zurück ist, gehen als Antrag an den Führer, in Zeitfolge und im
/// Namen dessen, der den Ursprung gestellt hat. Ein Eintrag, der sich nicht stellen lässt, löst
/// sich mit Grund von der Kette. Danach bekommt jede angekommene Person ihre Nachreich-Notiz
/// (K3–K5). Läuft im Takt nach dem Abgleich; liefert die Einsätze, an denen sich etwas geändert hat.
pub async fn ketten_fortsetzen(pool: &SqlitePool) -> Result<Vec<i64>, AppError> {
    // Nur Ketten, deren Ursprung gestellt ist: Was nie gestellt wird, liest der Takt nicht jede
    // Sekunde neu. Führt der Einsatz hier wieder selbst, lösen sich die Einträge mit Grund (409);
    // die Notiz geht nur an einen Spiegel.
    let tabellen: Vec<&str> = NACHREICHBAR
        .iter()
        .filter(|(_, art)| AN_DER_PERSON.contains(art))
        .map(|(t, _)| *t)
        .collect();
    let platzhalter = vec!["?"; tabellen.len()].join(", ");
    let sql = format!(
        "WITH RECURSIVE weg(id, oben) AS ( \
           SELECT id, folge_von FROM einsatz_bruchstelle WHERE entfernt = 1 \
             AND daten IS NOT NULL AND folge_von IS NOT NULL AND erledigt IS NULL \
             AND antrag_id IS NULL AND grund IS NULL AND art IN ({platzhalter}) \
           UNION SELECT w.id, b.folge_von FROM weg w JOIN einsatz_bruchstelle b ON b.id = w.oben \
             WHERE b.folge_von IS NOT NULL) \
         SELECT DISTINCT b.einsatz_id FROM weg w JOIN einsatz_bruchstelle b ON b.id = w.oben \
           WHERE b.folge_von IS NULL AND b.erledigt = 'nachgereicht' \
         UNION SELECT b.einsatz_id FROM einsatz_bruchstelle b JOIN einsatz e ON e.id = b.einsatz_id \
           WHERE b.art = 'einsatz_person' AND b.entfernt = 1 AND b.daten IS NOT NULL \
           AND b.erledigt = 'nachgereicht' AND b.notiz_at IS NULL \
           AND b.nachgereicht_als IS NOT NULL AND e.spiegel = 1"
    );
    // Nur Platzhalter eingesetzt, die Tabellen gehen als Parameter.
    let mut abfrage = sqlx::query_scalar(sqlx::AssertSqlSafe(sql));
    for t in &tabellen {
        abfrage = abfrage.bind(*t);
    }
    let einsaetze: Vec<i64> = abfrage.fetch_all(pool).await?;
    let mut geaendert = Vec::new();
    for e in einsaetze {
        match kette_des_einsatzes(pool, e).await {
            Ok(true) => geaendert.push(e),
            Ok(false) => {}
            Err(f) => {
                tracing::warn!(einsatz = e, error = %f, "Bruchstelle: Kette nicht fortgesetzt");
            }
        }
    }
    Ok(geaendert)
}

/// Ob ein Eintrag sich jetzt stellen ließe, ohne auf einen Bezug zu warten (nur lesend; das
/// Stellen prüft in seiner Transaktion noch einmal).
async fn ohne_wartenden_bezug(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    z: &BruchZeile,
) -> Result<bool, AppError> {
    let d = z.daten();
    let Some(art) = nachreichbar_als(&z.art, &d) else {
        return Ok(true);
    };
    let Some(b) = BEANTRAGBAR.iter().find(|b| b.art == art) else {
        return Ok(true);
    };
    fn wartet<T>(r: &Result<T, AppError>) -> bool {
        matches!(r, Err(AppError::Validation(g)) if g == BEZUG_WARTET)
    }
    if wartet(&pfad_der_zeile(conn, einsatz_id, art, &d).await) {
        return Ok(false);
    }
    Ok(!wartet(
        &body_der_zeile(conn, einsatz_id, &z.art, b, &d).await,
    ))
}

/// Die Zeit, nach der eine Kette ihre Einträge stellt.
fn zeit_der_zeile(z: &BruchZeile) -> String {
    let d = z.daten();
    ZEIT_FELDER
        .iter()
        .find_map(|f| text(&d, f))
        .unwrap_or_else(|| z.gesichert_at.clone())
}

async fn kette_des_einsatzes(pool: &SqlitePool, einsatz_id: i64) -> Result<bool, AppError> {
    let mut conn = pool.acquire().await?;
    let zeilen = bruch_zeilen(&mut conn, einsatz_id).await?;
    let ketten = Ketten::neu(&zeilen);
    // Führt der Einsatz hier wieder selbst, stellt die Kette nichts mehr: Ihre Einträge lösen sich
    // mit Grund, statt auf eine Quittung zu warten, die nicht mehr kommt.
    let spiegel: bool = sqlx::query_scalar("SELECT spiegel = 1 FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .unwrap_or(false);
    if !spiegel {
        let wartend: Vec<i64> = zeilen
            .iter()
            .filter(|z| ketten.wartet(z))
            .map(|z| z.id)
            .collect();
        drop(conn);
        if wartend.is_empty() {
            return Ok(false);
        }
        crate::write_retry!(pool, |conn| {
            for id in &wartend {
                sqlx::query(
                    "UPDATE einsatz_bruchstelle SET grund = ?, folge_von = NULL WHERE id = ? \
                     AND erledigt IS NULL AND antrag_id IS NULL",
                )
                .bind(FUEHRUNG_GEWECHSELT)
                .bind(id)
                .execute(&mut *conn)
                .await?;
            }
            Ok::<_, AppError>(())
        })?;
        return Ok(true);
    }
    let mut eintraege: Vec<(i64, Option<i64>, String)> = Vec::new();
    for z in &zeilen {
        if !ketten.wartet(z) || !ohne_wartenden_bezug(&mut conn, einsatz_id, z).await? {
            continue;
        }
        eintraege.push((z.id, ketten.ursprung(z).erledigt_von_id, zeit_der_zeile(z)));
    }
    eintraege.sort_by(|a, b| a.2.cmp(&b.2).then(a.0.cmp(&b.0)));
    let mut personen = Vec::new();
    for z in zeilen.iter().filter(|z| {
        z.art == "einsatz_person"
            && z.erledigt.as_deref() == Some("nachgereicht")
            && z.notiz_at.is_none()
    }) {
        if let Bezug::Neu(lokal) =
            bezug(&mut conn, einsatz_id, "einsatz_person", &z.schluessel).await?
        {
            personen.push((z.id, lokal));
        }
    }
    drop(conn);
    let mut geaendert = false;
    for (id, benutzer, _) in eintraege {
        let lauf = match benutzer {
            Some(benutzer) => {
                crate::write_retry!(pool, |conn| {
                    stelle_zeile_tx(conn, einsatz_id, id, benutzer, false).await
                })
            }
            // Das Konto, das den Ursprung gestellt hat, gibt es nicht mehr.
            None => Err(AppError::Validation(
                "Niemand mehr, in dessen Namen der Eintrag ginge.".into(),
            )),
        };
        let grund = match lauf {
            Ok(_) => {
                geaendert = true;
                continue;
            }
            Err(AppError::Validation(g)) if g == BEZUG_WARTET => continue,
            Err(AppError::NotFound) => continue,
            Err(
                AppError::Validation(g) | AppError::Conflict(g) | AppError::UnprocessableEntity(g),
            ) => g,
            Err(AppError::Forbidden) => "Keine Berechtigung.".to_string(),
            Err(f) => return Err(f),
        };
        crate::write_retry!(pool, |conn| {
            sqlx::query(
                "UPDATE einsatz_bruchstelle SET grund = ?, folge_von = NULL WHERE id = ? \
                 AND erledigt IS NULL AND antrag_id IS NULL",
            )
            .bind(&grund)
            .bind(id)
            .execute(&mut *conn)
            .await?;
            Ok::<_, AppError>(())
        })?;
        geaendert = true;
    }
    for (id, lokal) in personen {
        crate::write_retry!(pool, |conn| {
            nachreich_notiz_tx(conn, einsatz_id, id, &lokal).await
        })?;
        geaendert = true;
    }
    if geaendert {
        super::takt::wecken();
    }
    Ok(geaendert)
}

/// Das Wort einer Maßnahme, wie das Paneel es zeigt (`frontend/src/personen/personMeta.ts`).
/// Die Region einer Verletzung als Wort, wie im Körperschema (`koerperschemaKern.ts`).
fn region_wort(region: &str) -> String {
    match region {
        "kopf" => "Kopf",
        "gesicht" => "Gesicht",
        "hals" => "Hals",
        "thorax" => "Thorax",
        "abdomen" => "Abdomen",
        "becken" => "Becken",
        "ruecken" => "Rücken",
        "wirbelsaeule" => "Wirbelsäule",
        "gesaess" => "Gesäß",
        "oberarm_l" => "Oberarm links",
        "oberarm_r" => "Oberarm rechts",
        "unterarm_l" => "Unterarm links",
        "unterarm_r" => "Unterarm rechts",
        "hand_l" => "Hand links",
        "hand_r" => "Hand rechts",
        "oberschenkel_l" => "Oberschenkel links",
        "oberschenkel_r" => "Oberschenkel rechts",
        "unterschenkel_l" => "Unterschenkel links",
        "unterschenkel_r" => "Unterschenkel rechts",
        "fuss_l" => "Fuß links",
        "fuss_r" => "Fuß rechts",
        andere => return andere.replace('_', " "),
    }
    .to_string()
}

fn massnahme_wort(art: &str) -> String {
    match art {
        "blutstillung" => "Blutstillung",
        "zugang" => "Zugang",
        "infusion" => "Infusion",
        "sauerstoff" => "Sauerstoff",
        "atemweg" => "Atemweg",
        "analgesie" => "Analgesie",
        "immobilisation" => "Immobilisation",
        "waermeerhalt" => "Wärmeerhalt",
        "dekontamination" => "Dekontamination",
        "wundversorgung" => "Wundversorgung",
        "kuehlung" => "Kühlung",
        "lagerung" => "Lagerung",
        "betreuung_gespraech" => "Betreuung / Gespräch",
        andere => return andere.replace('_', " "),
    }
    .to_string()
}

/// Ein Eintrag an der Person in Kurzform: „Sichtung SK II“, „Maßnahme Blutstillung“.
fn eintrag_wort(tabelle: &str, d: &Map<String, Value>) -> Option<String> {
    let art = match tabelle {
        "person_sichtung" => "Sichtung",
        "person_massnahme" => "Maßnahme",
        "person_verletzung" => "Verletzung",
        "person_verbleib" => return Some("Verbleib".to_string()),
        "person_transport" => return Some("Transport".to_string()),
        _ => return None,
    };
    Some(format!("{art} {}", eintrag_wert(tabelle, d)?))
}

/// Was ein Eintrag an einer Person festhält, ohne seine Art: „SK II“, „Blutstillung“, „Kopf“.
/// Die Liste nennt die Art schon davor.
fn eintrag_wert(tabelle: &str, d: &Map<String, Value>) -> Option<String> {
    let wert = |f: &str| text(d, f).unwrap_or_default();
    Some(match tabelle {
        "person_sichtung" => crate::person::Sichtungskategorie::parse(&wert("kategorie"))
            .map_or_else(|| wert("kategorie"), |k| k.etb_label().to_string()),
        "person_massnahme" => massnahme_wort(&wert("art")),
        "person_verletzung" => region_wort(&wert("region")),
        _ => return None,
    })
}

/// Die Nachreich-Notiz einer Person (K3–K5): ihre Nummer vor der Notübernahme, ein Status, den nur
/// ein Statuswechsel setzt, aufgehobene Maßnahmen und Verletzungen und namentliche Bestätigungen
/// am Gerät. Höchstens [`crate::person::VERLAUFSNOTIZ_MAX`] Zeichen.
fn nachreich_notiz_text(
    stil: &crate::zeitdarstellung::Zeitstil,
    person: &Map<String, Value>,
    eintraege: &[(String, Map<String, Value>)],
) -> String {
    let mut teile = Vec::new();
    match person.get("registrier_nr").and_then(Value::as_i64) {
        Some(nr) => teile.push(format!(
            "Als {} erfasst, nach der Notübernahme nachgereicht.",
            crate::person::registrier_anzeige(nr)
        )),
        None => teile.push("Nach der Notübernahme nachgereicht.".to_string()),
    }
    if let Some(status) = text(person, "status") {
        if !matches!(status.as_str(), "erfasst" | "vermisst" | "betroffen") {
            teile.push(format!("Status vorher: {status}."));
        }
    }
    if person.get("haushalt_id").is_some_and(|h| !h.is_null()) {
        teile.push("Haushaltszuordnung nicht nachgereicht.".to_string());
    }
    for (tabelle, d) in eintraege {
        let Some(wort) = eintrag_wort(tabelle, d) else {
            continue;
        };
        if let Some(name) = text(d, "bestaetigt_name") {
            let zeit = ZEIT_FELDER
                .iter()
                .find_map(|f| text(d, f))
                .map(|t| format!(" {}", stil.zeitpunkt_text(&t)))
                .unwrap_or_default();
            teile.push(format!("{wort}{zeit} bestätigt von {name}."));
        }
        if let Some(aufgehoben) = text(d, "aufgehoben_at") {
            teile.push(format!(
                "Aufgehoben: {wort} {}.",
                stil.zeitpunkt_text(&aufgehoben)
            ));
        }
    }
    let ganz = teile.join(" ");
    if ganz.chars().count() <= crate::person::VERLAUFSNOTIZ_MAX {
        return ganz;
    }
    let mut k: String = ganz
        .chars()
        .take(crate::person::VERLAUFSNOTIZ_MAX - 1)
        .collect();
    k.push('…');
    k
}

/// Stellt die Nachreich-Notiz an eine angekommene Person (`lokal` = ihre Kennung hier), genau
/// einmal: `notiz_at` und der Antrag entstehen in derselben Transaktion.
async fn nachreich_notiz_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bruch_id: i64,
    lokal: &str,
) -> Result<(), AppError> {
    let zeile: Option<(String, String, Option<i64>)> = sqlx::query_as(
        "SELECT daten, gesichert_at, erledigt_von_id FROM einsatz_bruchstelle WHERE id = ? \
         AND einsatz_id = ? AND erledigt = 'nachgereicht' AND notiz_at IS NULL \
         AND daten IS NOT NULL",
    )
    .bind(bruch_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((daten, gesichert_at, benutzer)) = zeile else {
        return Ok(());
    };
    let jetzt = crate::zeit::jetzt();
    let Some(benutzer) = benutzer else {
        // Ohne Konto keine Notiz; nicht jede Sekunde neu versuchen.
        sqlx::query("UPDATE einsatz_bruchstelle SET notiz_at = ? WHERE id = ?")
            .bind(&jetzt)
            .bind(bruch_id)
            .execute(&mut *conn)
            .await?;
        return Ok(());
    };
    let person = match serde_json::from_str::<Value>(&daten) {
        Ok(Value::Object(d)) => d,
        _ => Map::new(),
    };
    let schluessel = person.get("id").and_then(als_schluessel);
    let mut eintraege: Vec<(String, Map<String, Value>)> = Vec::new();
    let zeilen: Vec<(String, String)> = sqlx::query_as(
        "SELECT art, daten FROM einsatz_bruchstelle WHERE einsatz_id = ? AND entfernt = 1 \
         AND daten IS NOT NULL AND gesichert_at = ? AND art LIKE 'person\\_%' ESCAPE '\\' \
         ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(&gesichert_at)
    .fetch_all(&mut *conn)
    .await?;
    for (art, d) in zeilen {
        let Ok(Value::Object(d)) = serde_json::from_str::<Value>(&d) else {
            continue;
        };
        if d.get("person_id").and_then(als_schluessel) == schluessel {
            eintraege.push((art, d));
        }
    }
    eintraege.sort_by_key(|(_, d)| ZEIT_FELDER.iter().find_map(|f| text(d, f)));
    let stil = crate::zeitdarstellung::zeitstil_laden(&mut *conn, einsatz_id).await?;
    let b = BEANTRAGBAR
        .iter()
        .find(|b| b.art == "notiz")
        .ok_or(AppError::NotFound)?;
    let body = serde_json::json!({
        "text": nachreich_notiz_text(&stil, &person, &eintraege),
        "client_id": uuid::Uuid::new_v4().to_string(),
    });
    match antrag::lege_an_tx(
        conn,
        b,
        einsatz_id,
        benutzer,
        &[("pid".to_string(), lokal.to_string())],
        body,
        None,
    )
    .await
    {
        // Geht kein Antrag mehr (Abgleich beendet), bleibt es bei dem Versuch.
        Ok(_) | Err(AppError::Conflict(_) | AppError::Validation(_)) => {}
        Err(f) => return Err(f),
    }
    sqlx::query("UPDATE einsatz_bruchstelle SET notiz_at = ? WHERE id = ?")
        .bind(&jetzt)
        .bind(bruch_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Legt eine offene Erfassung ab (N6). 404, wenn es sie hier nicht gibt; 409, wenn sie schon
/// nachgereicht oder verworfen ist.
pub async fn verwerfen(
    pool: &SqlitePool,
    einsatz_id: i64,
    bruch_id: i64,
    benutzer_id: i64,
    darf: impl Fn(&str) -> bool,
) -> Result<(), AppError> {
    crate::write_retry!(pool, |conn| {
        let zeile: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT art, erledigt FROM einsatz_bruchstelle WHERE id = ? AND einsatz_id = ? \
             AND entfernt = 1 AND daten IS NOT NULL AND folge_von IS NULL",
        )
        .bind(bruch_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some((tabelle, erledigt)) = zeile else {
            return Err(AppError::NotFound);
        };
        // Ablegen nur, was die Person sehen darf: am Modul der Zeile, in derselben Transaktion.
        let kategorie = schema::schema(&mut *conn)
            .await?
            .tabelle(&tabelle)
            .map(|t| t.kategorie)
            .unwrap_or(SpiegelKategorie::Fuehrung);
        if !darf(modul_der_zeile(&tabelle, kategorie)) {
            return Err(AppError::Forbidden);
        }
        if erledigt.is_some() {
            return Err(AppError::Conflict("Schon erledigt.".into()));
        }
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
    grund: Option<&str>,
) -> Result<(), AppError> {
    if abgelehnt {
        // Ein Eintrag einer Kette löst sich mit dem Grund von ihr und steht als eigene Zeile da
        // (LLH-1657, K1); jede abgelehnte Zeile zeigt ihren Grund, auch beim zweiten Mal.
        // Gekürzt wie der Grund am Antrag (`antrag::quittungen_uebernehmen`).
        let grund: String = grund
            .map(str::trim)
            .filter(|g| !g.is_empty())
            .unwrap_or("Abgelehnt.")
            .chars()
            .take(antrag::GRUND_MAX)
            .collect();
        sqlx::query(
            "UPDATE einsatz_bruchstelle SET erledigt = NULL, erledigt_at = NULL, \
             erledigt_von_id = NULL, grund = ?, folge_von = NULL \
             WHERE antrag_id = ? AND erledigt = 'nachgereicht'",
        )
        .bind(grund)
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

/// Bricht Kreise in `eltern` (Zeile → Ursprung): je Kreis verliert die kleinste Kennung ihren
/// Ursprung. Zeilen auf dem Weg in einen Kreis bleiben angebunden.
fn loese_kreise(eltern: &mut HashMap<i64, i64>, ids: &[i64]) {
    for id in ids {
        let mut weg: Vec<i64> = Vec::new();
        let mut k = *id;
        while let Some(e) = eltern.get(&k).copied() {
            if let Some(pos) = weg.iter().position(|x| *x == k) {
                let kleinste = *weg[pos..].iter().min().unwrap_or(&k);
                eltern.remove(&kleinste);
                break;
            }
            weg.push(k);
            k = e;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ein_kreis_trennt_nur_seine_eigenen_zeilen() {
        // 1 → 2, 2 → 3, 3 → 2: der Kreis ist 2 ↔ 3, Zeile 1 hängt an 2.
        let mut eltern = HashMap::from([(1, 2), (2, 3), (3, 2)]);
        loese_kreise(&mut eltern, &[1, 2, 3]);
        assert_eq!(eltern, HashMap::from([(1, 2), (3, 2)]));
    }
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
    async fn person_an_neuer_meldung_ist_eigene_erfassung_und_kommt_ohne_sie_an() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        gesichert(
            &pool,
            e,
            "meldung",
            "4",
            serde_json::json!({"id": 4, "inhalt": "2 Verletzte", "von": "Abschnitt"}),
        )
        .await;
        let p = gesichert(
            &pool,
            e,
            "einsatz_person",
            "5",
            serde_json::json!({"id": 5, "name": "Muster", "meldung_id": 4, "haushalt_id": 9,
                               "uhs_id": null, "aktuelle_uhs_id": 3}),
        )
        .await;
        let b = gesichert(
            &pool,
            e,
            "person_uhs_belegung",
            "6",
            serde_json::json!({"id": 6, "person_id": 5, "uhs_id": 3}),
        )
        .await;
        ordnen(&pool, e).await;
        assert_eq!(
            folge_von(&pool, p).await,
            None,
            "die Person hängt nicht an der Meldung"
        );
        assert_eq!(
            folge_von(&pool, b).await,
            None,
            "die Aufnahme in die UHS steht für sich"
        );
        let liste = liste(&pool, e, alles).await.unwrap();
        let person = liste.iter().find(|l| l.id == p).unwrap();
        assert_eq!(person.antrag_art.as_deref(), Some("person"));
        let belegung_id = b;
        let belegung = liste.iter().find(|l| l.id == b).unwrap();
        assert!(
            belegung.antrag_art.is_none(),
            "nur lesbar und verwerfbar (K6)"
        );

        // Eine offene Meldung ist erst zu stellen oder zu verwerfen.
        let b = BEANTRAGBAR.iter().find(|b| b.art == "person").unwrap();
        let body_jetzt = |pool: SqlitePool| async move {
            let mut conn = pool.acquire().await.unwrap();
            let zeile = bruch_zeilen(&mut conn, e)
                .await
                .unwrap()
                .into_iter()
                .find(|z| z.id == p)
                .unwrap();
            body_der_zeile(&mut conn, e, "einsatz_person", b, &zeile.daten()).await
        };
        assert!(
            matches!(body_jetzt(pool.clone()).await, Err(AppError::Validation(g)) if g == BEZUG_FEHLT)
        );
        // Gestellt, aber noch nicht zurück: Die Person wartet auf sie.
        sqlx::query(
            "UPDATE einsatz_bruchstelle SET erledigt = 'nachgereicht' WHERE art = 'meldung'",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            matches!(body_jetzt(pool.clone()).await, Err(AppError::Validation(g)) if g == BEZUG_WARTET)
        );
        // Verworfen: Die Person geht ohne Meldung und ohne UHS.
        sqlx::query("UPDATE einsatz_bruchstelle SET erledigt = 'verworfen' WHERE art = 'meldung'")
            .execute(&pool)
            .await
            .unwrap();
        let body = body_jetzt(pool.clone()).await.unwrap();
        assert!(body.get("meldung_id").is_none(), "{body}");
        assert!(body.get("uhs_id").is_none(), "{body}");
        assert!(body.get("haushalt_id").is_none(), "{body}");
        let liste = super::liste(&pool, e, alles).await.unwrap();
        let belegung = liste.iter().find(|l| l.id == belegung_id).unwrap();
        assert_eq!(
            belegung.kurz.as_deref(),
            Some("Muster"),
            "die Aufnahme nennt ihre Person"
        );
    }

    #[tokio::test]
    async fn was_nur_auf_eine_person_zeigt_bleibt_eigene_zeile() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        gesichert(
            &pool,
            e,
            "einsatz_person",
            "5",
            serde_json::json!({"id": 5, "name": "Muster"}),
        )
        .await;
        let schaden = gesichert(
            &pool,
            e,
            "einsatz_schaden",
            "9",
            serde_json::json!({"id": 9, "geschaedigt_person_id": 5, "beschreibung": "Pkw"}),
        )
        .await;
        ordnen(&pool, e).await;
        assert_eq!(
            folge_von(&pool, schaden).await,
            None,
            "sonst verschwände der Schaden mit der gestellten Person"
        );
    }

    #[tokio::test]
    async fn folgezeile_eines_nicht_gestellten_ursprungs_fehlt_statt_zu_warten() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        gesichert(
            &pool,
            e,
            "einsatz_einheit",
            "7",
            serde_json::json!({"id": 7, "name": "Neue Einheit"}),
        )
        .await;
        let f = gesichert(
            &pool,
            e,
            "einsatz_fahrzeug",
            "8",
            serde_json::json!({"id": 8, "einheit_id": 7, "funkrufname": "RTW 1"}),
        )
        .await;
        ordnen(&pool, e).await;
        assert!(
            folge_von(&pool, f).await.is_some(),
            "das Fahrzeug hängt an der Einheit"
        );
        let mut conn = pool.acquire().await.unwrap();
        assert!(matches!(
            bezug(&mut conn, e, "einsatz_fahrzeug", "8").await.unwrap(),
            Bezug::Fehlt
        ));
    }

    #[tokio::test]
    async fn jede_ablehnung_haelt_ihren_grund_fest_gekuerzt() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        let z = gesichert(
            &pool,
            e,
            "person_massnahme",
            "3",
            serde_json::json!({"id": 3, "person_id": 5, "art": "zugang"}),
        )
        .await;
        let abgelehnt = |grund: String| {
            let pool = pool.clone();
            async move {
                let mut conn = pool.acquire().await.unwrap();
                // Der Antrag selbst spielt hier keine Rolle.
                sqlx::query("PRAGMA foreign_keys = OFF")
                    .execute(&mut *conn)
                    .await
                    .unwrap();
                sqlx::query(
                    "UPDATE einsatz_bruchstelle SET erledigt = 'nachgereicht', antrag_id = 41, \
                     grund = NULL WHERE id = ?",
                )
                .bind(z)
                .execute(&mut *conn)
                .await
                .unwrap();
                quittung_uebernehmen(&mut conn, 41, true, None, Some(&grund))
                    .await
                    .unwrap();
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(&mut *conn)
                    .await
                    .unwrap();
                let g: Option<String> =
                    sqlx::query_scalar("SELECT grund FROM einsatz_bruchstelle WHERE id = ?")
                        .bind(z)
                        .fetch_one(&mut *conn)
                        .await
                        .unwrap();
                g
            }
        };
        // Schon ohne Ursprung (wie nach der ersten Ablehnung): Der Grund steht trotzdem da.
        assert_eq!(
            abgelehnt("Unbekannte Maßnahme".into()).await.as_deref(),
            Some("Unbekannte Maßnahme")
        );
        let lang = abgelehnt("x".repeat(10_000)).await.unwrap();
        assert_eq!(lang.chars().count(), antrag::GRUND_MAX);
    }

    #[test]
    fn systemeintrag_nennt_die_registriernummer() {
        assert_eq!(
            registrier_nr_im_systemeintrag("Person R-002 erfasst"),
            Some(2)
        );
        assert_eq!(
            registrier_nr_im_systemeintrag("Person R-1234: Sichtung SK II, bestätigt: Anna"),
            Some(1234)
        );
        assert_eq!(registrier_nr_im_systemeintrag("Person registriert"), None);
        assert_eq!(registrier_nr_im_systemeintrag("Person R-12a erfasst"), None);
        assert_eq!(registrier_nr_im_systemeintrag("Person R-"), None);
    }

    #[test]
    fn nachreich_notiz_nennt_nummer_status_bestaetigung_und_aufhebung() {
        let stil = crate::zeitdarstellung::Zeitstil::VORGABE;
        let person =
            serde_json::json!({"registrier_nr": 2, "status": "verstorben", "haushalt_id": 4});
        let Value::Object(person) = person else {
            unreachable!()
        };
        let eintrag = |v: Value| match v {
            Value::Object(m) => m,
            _ => unreachable!(),
        };
        let text = nachreich_notiz_text(
            &stil,
            &person,
            &[
                (
                    "person_sichtung".into(),
                    eintrag(serde_json::json!({"kategorie": "sk1",
                        "gesichtet_at": "2026-11-12T09:30:00Z", "bestaetigt_name": "Anna"})),
                ),
                (
                    "person_massnahme".into(),
                    eintrag(serde_json::json!({"art": "blutstillung",
                        "zeitpunkt_at": "2026-11-12T09:36:00Z",
                        "aufgehoben_at": "2026-11-12T09:40:00Z"})),
                ),
                (
                    "person_verletzung".into(),
                    eintrag(serde_json::json!({"zeitpunkt_at": "2026-11-12T09:41:00Z",
                        "region": "oberarm_l", "aufgehoben_at": "2026-11-12T09:45:00Z"})),
                ),
            ],
        );
        assert!(
            text.starts_with("Als R-002 erfasst, nach der Notübernahme nachgereicht."),
            "{text}"
        );
        assert!(text.contains("Status vorher: verstorben."), "{text}");
        assert!(text.contains("Sichtung SK I "), "{text}");
        assert!(text.contains(" bestätigt von Anna."), "{text}");
        assert!(
            text.contains("Aufgehoben: Maßnahme Blutstillung "),
            "{text}"
        );
        assert!(
            text.contains("Aufgehoben: Verletzung Oberarm links "),
            "{text}"
        );
        assert!(
            text.contains("Haushaltszuordnung nicht nachgereicht."),
            "{text}"
        );

        // Lang bleibt sie unter der Grenze einer Verlaufsnotiz.
        let viele: Vec<_> = (0..200)
            .map(|_| {
                (
                    "person_massnahme".to_string(),
                    eintrag(serde_json::json!({"art": "blutstillung",
                        "aufgehoben_at": "2026-11-12T09:40:00Z"})),
                )
            })
            .collect();
        let lang = nachreich_notiz_text(&stil, &person, &viele);
        assert_eq!(lang.chars().count(), crate::person::VERLAUFSNOTIZ_MAX);
        assert!(lang.ends_with('…'));
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
        assert!(
            liste
                .iter()
                .filter(|l| l.tabelle == "etb_eintrag")
                .all(|l| l.antrag_art.is_none()),
            "{liste:?}"
        );
        let person = liste
            .iter()
            .find(|l| l.tabelle == "einsatz_person")
            .unwrap();
        assert_eq!(person.kurz.as_deref(), Some("Muster, Max"));
        // Seit LLH-1657 geht eine Person als Antrag.
        assert_eq!(person.antrag_art.as_deref(), Some("person"));

        // Ohne Freigabe des Moduls Personen kein Inhalt.
        let ohne = super::liste(&pool, e, |m| m != "personen").await.unwrap();
        let person = ohne.iter().find(|l| l.tabelle == "einsatz_person").unwrap();
        assert!(person.verborgen && person.kurz.is_none() && person.antrag_art.is_none());
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
        // Ohne Freigabe des Moduls bleibt die Zeile offen (Prüfung in der Schreibtransaktion).
        assert!(matches!(
            verwerfen(&pool, e, b, 1, |_: &str| false).await,
            Err(AppError::Forbidden)
        ));
        assert_eq!(liste(&pool, e, alles).await.unwrap().len(), 1);
        verwerfen(&pool, e, b, 1, alles).await.unwrap();
        assert!(liste(&pool, e, alles).await.unwrap().is_empty());
        assert!(matches!(
            verwerfen(&pool, e, b, 1, alles).await,
            Err(AppError::Conflict(_))
        ));
        let mut conn = pool.acquire().await.unwrap();
        assert!(matches!(
            stellen_tx(&mut conn, e, b, 1).await,
            Err(AppError::Conflict(_))
        ));
        drop(conn);
        assert!(matches!(
            verwerfen(&pool, e + 1, b, 1, alles).await,
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
