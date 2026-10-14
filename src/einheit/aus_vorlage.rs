//! Einheit aus Vorlage bilden (LLH-1049, Spec `kraefte-disposition`, „Einheit aus Vorlage
//! bilden“, und `einheit-vorlagen`, „Vorschau im Einsatz“; Change `h997wi4l-einheit-aus-vorlage`).
//!
//! Aus einer Einheiten-Vorlage (LLH-1042) entsteht im Einsatz in einer Transaktion die ganze
//! Einheit: Einheiten top-down mit den Kopfdaten der Vorlage, die gewählten Fahrzeuge und
//! Personen neu disponiert (über den Baustein `kraefte_disposition`, LLH-1100) oder, wenn schon
//! im Einsatz, zugeordnet. Eine Kraft in einer anderen Einheit oder auf einem anderen Fahrzeug
//! kommt nur mit ausdrücklichem „umhängen“ mit; sonst lehnt der Abgleich mit Gründen je Zeile ab
//! (`AppError::Zeilen`, 422), bevor etwas geschrieben ist.
//!
//! Vorschau und Bilden rechnen dieselbe Planung ([`plan_tx`]): Baum der Vorlage, dann je Art
//! eine `json_each`-Abfrage für den Zustand aller Kräfte (`src/AGENTS.md`, „Eingabegrenzen“).
//! Maßgeblich ist nur die Planung in der Transaktion des Bildens.

use crate::einheit::mitglied_repo;
use crate::einheit::repo::{self as einheit_repo, EinheitDaten};
use crate::einheit_vorlage::{repo as vorlage_repo, EinheitVorlage};
use crate::error::{AppError, ZeilenArt, ZeilenGrund};
use crate::fahrzeug::besatzung_repo;
use crate::katalog::DIENSTSTATUS_IN_DIENST;
use crate::kraefte_disposition::{self, Kontext, PersonalWahl, Regeln, Ziel};
use crate::staerke::{Staerke, StaerkePosition};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::SqliteConnection;
use std::collections::HashMap;
use utoipa::ToSchema;

/// Höchstens so viele Einheiten hat der Baum einer Vorlage, die gebildet wird (D7). Das ist
/// keine Eingabe, sondern der Zustand der Vorlage: 422 in Vorschau und Bilden.
pub const KNOTEN_MAX: usize = 20;

/// Grund: die ID steht nicht (mehr) in der Vorlage.
pub const GRUND_NICHT_IN_VORLAGE: &str = "nicht in der Vorlage";

/// Meldung des 422 mit Gründen je Zeile.
pub const MELDUNG_ZEILEN: &str = "Nicht alle Kräfte lassen sich übernehmen";

wire_enum! {
    /// Zustand einer Kraft der Vorlage im Einsatz (D4). Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VorschauZustand {
        /// Nicht im Einsatz (oder storniert): wird disponiert.
        Neu => "neu",
        /// Im Einsatz, ohne Einheit und (Person) ohne Fahrzeug oder schon auf ihrem Fahrzeug der
        /// Vorlage: wird zugeordnet.
        Frei => "frei",
        /// In einer anderen Einheit oder (Person) auf einem anderen Fahrzeug: nur mit „umhängen“.
        Gebunden => "gebunden",
        /// Im Stamm außer Dienst und nicht im Einsatz: gesperrt.
        AusserDienst => "ausser_dienst",
        /// Aus dem Einsatz entlassen: wird erneut disponiert (Fahrzeuge erst mit LLH-1079 II).
        Entlassen => "entlassen",
    }
    try_from = |s| format!("Ungültiger Zustand: {s}");
}

/// Vorschau einer Vorlage im Einsatz (D2): der Baum mit dem Zustand jeder Kraft. Schreibt nichts.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct VorlageVorschau {
    pub vorlage_id: i64,
    /// Die Einheiten des Baums, die Wurzel vorn, Eltern vor ihren Kindern.
    pub knoten: Vec<VorschauKnoten>,
    /// Das Modul Fahrzeuge ist für die Rolle nicht freigegeben: keine Fahrzeugzeilen.
    pub fahrzeuge_gesperrt: bool,
    /// Das Modul Personal ist für die Rolle nicht freigegeben: keine Personenzeilen.
    pub personal_gesperrt: bool,
}

/// Eine Einheit des Vorlagen-Baums mit ihren Kopfdaten.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct VorschauKnoten {
    pub vorlage_id: i64,
    /// Übergeordnete Vorlage im gebildeten Baum; fehlt an der Wurzel.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ueber_vorlage_id: Option<i64>,
    pub name: String,
    pub typ_id: i64,
    pub typ_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funkrufname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz_fachaufgabe: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz_organisation: Option<String>,
    /// Wirksames Soll (eigenes, sonst das des Typs); fehlt, wenn keins gilt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soll: Option<Staerke>,
    pub soll_eigen: bool,
    pub fahrzeuge: Vec<VorschauFahrzeug>,
    pub personal: Vec<VorschauPersonal>,
}

/// Ein Stamm-Fahrzeug der Vorlage und sein Zustand im Einsatz.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VorschauFahrzeug {
    pub fahrzeug_id: i64,
    pub funkrufname: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fahrzeugtyp: Option<String>,
    pub zustand: VorschauZustand,
    /// Die Dispositionszeile (`einsatz_fahrzeug.id`), wenn das Fahrzeug im Einsatz ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ef_id: Option<i64>,
    /// Die Einheit, der das Fahrzeug angehört (bei `gebunden`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_name: Option<String>,
}

/// Eine Person der Stammbesetzung und ihr Zustand im Einsatz.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VorschauPersonal {
    pub personal_id: i64,
    pub name: String,
    /// Position aus der Vorlage; fehlt, wenn die Stamm-Vorgabe der Person gilt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staerke_position: Option<StaerkePosition>,
    /// Fahrzeug der Vorlage (Stamm-ID), auf dem die Person sitzt, wenn es mitkommt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fahrzeug_id: Option<i64>,
    pub zustand: VorschauZustand,
    /// Die Dispositionszeile (`einsatz_personal.id`), wenn die Person aktiv im Einsatz ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ep_id: Option<i64>,
    /// Die Einheit, der die Person angehört (bei `gebunden`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_name: Option<String>,
    /// Das Fahrzeug, auf dem die Person sitzt (`einsatz_fahrzeug.id`; bei `gebunden`, oder bei
    /// `frei`, wenn es schon ihr Fahrzeug der Vorlage ist).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ef_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fahrzeug_name: Option<String>,
}

/// Antwort des Bildens (D3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AusVorlageErgebnis {
    /// Die oberste neue Einheit (Sprungziel ins Meldebild).
    pub einheit_id: i64,
    /// Alle neuen Einheiten, die oberste vorn, Eltern vor ihren Kindern.
    pub einheit_ids: Vec<i64>,
    /// Die übernommenen Fahrzeuge (`einsatz_fahrzeug.id`).
    pub fahrzeuge: Vec<i64>,
    /// Die übernommenen Personen (`einsatz_personal.id`).
    pub personal: Vec<i64>,
}

/// Ein benannter Bezug im Einsatz (ID und Name).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bezug {
    pub id: i64,
    pub name: String,
}

/// Lage eines Stamm-Fahrzeugs der Vorlage im Einsatz.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FahrzeugLage {
    pub zustand: VorschauZustand,
    pub ef_id: Option<i64>,
    pub einheit: Option<Bezug>,
}

/// Lage einer Stamm-Person der Vorlage im Einsatz.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonalLage {
    pub zustand: VorschauZustand,
    /// Nur bei einer aktiven Dispositionszeile.
    pub ep_id: Option<i64>,
    pub einheit: Option<Bezug>,
    pub fahrzeug: Option<Bezug>,
}

/// Welche Arten [`plan_tx`] liest: ein gesperrtes Modul (Vorschau) oder eine leere Wahl
/// (Bilden) braucht keine Abfrage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lesen {
    pub fahrzeuge: bool,
    pub personal: bool,
}

/// Die Planung einer Bildung: der aktive Baum der Vorlage und je Kraft ihre Lage im Einsatz.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    /// Die Vorlagen des Baums, die Wurzel vorn, Eltern vor ihren Kindern.
    pub knoten: Vec<EinheitVorlage>,
    /// Stamm-ID → Lage; leer, wenn die Art nicht gelesen wurde.
    pub fahrzeuge: HashMap<i64, FahrzeugLage>,
    pub personal: HashMap<i64, PersonalLage>,
}

/// Zustand eines Stamm-Fahrzeugs (D4). `zeile` ist die Dispositionszeile im Einsatz
/// (`beendet`, Einheit vorhanden). Eine aktive Zeile zählt vor dem Dienststatus des Stamms: das
/// Fahrzeug ist schon im Einsatz.
pub fn fahrzeug_zustand(in_dienst: bool, zeile: Option<(bool, bool)>) -> VorschauZustand {
    match zeile {
        Some((false, true)) => VorschauZustand::Gebunden,
        Some((false, false)) => VorschauZustand::Frei,
        _ if !in_dienst => VorschauZustand::AusserDienst,
        Some((true, _)) => VorschauZustand::Entlassen,
        None => VorschauZustand::Neu,
    }
}

/// Zustand einer Stamm-Person (D4). `beendet_als` ist der Endzustand einer beendeten Zeile
/// (`None` = aktiv), `gebunden` heißt Einheit oder ein anderes Fahrzeug als das der Vorlage.
/// Eine stornierte Zeile gilt als nicht im Einsatz (`neu`): sie steht in keinem Nachweis.
pub fn personal_zustand(in_dienst: bool, zeile: Option<(Option<&str>, bool)>) -> VorschauZustand {
    match zeile {
        Some((None, true)) => VorschauZustand::Gebunden,
        Some((None, false)) => VorschauZustand::Frei,
        _ if !in_dienst => VorschauZustand::AusserDienst,
        Some((Some("entlassen"), _)) => VorschauZustand::Entlassen,
        _ => VorschauZustand::Neu,
    }
}

fn ids_json(ids: impl IntoIterator<Item = i64>) -> String {
    serde_json::to_string(&ids.into_iter().collect::<Vec<i64>>())
        .expect("Zahlenliste ist serialisierbar")
}

fn bezug(id: Option<i64>, name: Option<String>) -> Option<Bezug> {
    match (id, name) {
        (Some(id), Some(name)) => Some(Bezug { id, name }),
        _ => None,
    }
}

#[derive(sqlx::FromRow)]
struct FahrzeugZeile {
    fahrzeug_id: i64,
    dienststatus: String,
    ef_id: Option<i64>,
    ef_beendet_at: Option<String>,
    einheit_id: Option<i64>,
    einheit_name: Option<String>,
}

#[derive(sqlx::FromRow)]
struct PersonalZeile {
    personal_id: i64,
    dienststatus: String,
    ep_id: Option<i64>,
    ep_beendet_at: Option<String>,
    ep_beendet_als: Option<String>,
    einheit_id: Option<i64>,
    einheit_name: Option<String>,
    ef_id: Option<i64>,
    /// Stamm-ID des Fahrzeugs, auf dem die Person sitzt.
    ef_fahrzeug_id: Option<i64>,
    fahrzeug_name: Option<String>,
}

/// Lage aller Stamm-Fahrzeuge in **einer** Anweisung. Eine aufgelöste Einheit zählt nicht. Liest
/// absichtlich auch beendete Zeilen (entlassen gegen neu); Ausnahme mit Grund in der ALLOWLIST
/// des Wächters (`src/entlassung.rs`).
async fn load_fahrzeug_lagen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    ids: &[i64],
) -> Result<HashMap<i64, FahrzeugLage>, AppError> {
    let zeilen: Vec<FahrzeugZeile> = sqlx::query_as(
        "SELECT j.value AS fahrzeug_id, f.dienststatus, ef.id AS ef_id, \
                ef.beendet_at AS ef_beendet_at, e.id AS einheit_id, e.name AS einheit_name \
         FROM json_each(?1) j \
         JOIN fahrzeug f ON f.id = j.value AND f.org_id = ?2 \
         LEFT JOIN einsatz_fahrzeug ef ON ef.fahrzeug_id = j.value AND ef.einsatz_id = ?3 \
         LEFT JOIN einsatz_einheit e ON e.id = ef.einheit_id AND e.aufgeloest_at IS NULL",
    )
    .bind(ids_json(ids.iter().copied()))
    .bind(org_id)
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|z| {
            let einheit = bezug(z.einheit_id, z.einheit_name);
            let zeile = z
                .ef_id
                .map(|_| (z.ef_beendet_at.is_some(), einheit.is_some()));
            let zustand = fahrzeug_zustand(z.dienststatus == DIENSTSTATUS_IN_DIENST, zeile);
            let aktiv = z.ef_id.is_some() && z.ef_beendet_at.is_none();
            (
                z.fahrzeug_id,
                FahrzeugLage {
                    zustand,
                    ef_id: if aktiv { z.ef_id } else { None },
                    einheit,
                },
            )
        })
        .collect())
}

/// Lage aller Stamm-Personen in **einer** Anweisung. Liest absichtlich auch beendete Zeilen
/// (entlassen gegen storniert); Ausnahme mit Grund in der ALLOWLIST des Wächters
/// (`src/entlassung.rs`). `vorlagen_fahrzeug` ist je Person das Stamm-Fahrzeug der Vorlage: wer
/// ohne Einheit schon darauf sitzt, ist frei, nicht gebunden (Spec `kraefte-disposition`,
/// „Umhängen nur auf Wunsch“).
async fn load_personal_lagen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    ids: &[i64],
    vorlagen_fahrzeug: &HashMap<i64, i64>,
) -> Result<HashMap<i64, PersonalLage>, AppError> {
    let zeilen: Vec<PersonalZeile> = sqlx::query_as(
        "SELECT j.value AS personal_id, p.dienststatus, ep.id AS ep_id, \
                ep.beendet_at AS ep_beendet_at, ep.beendet_als AS ep_beendet_als, \
                e.id AS einheit_id, e.name AS einheit_name, \
                ef.id AS ef_id, ef.fahrzeug_id AS ef_fahrzeug_id, \
                ef.snap_funkrufname AS fahrzeug_name \
         FROM json_each(?1) j \
         JOIN personal p ON p.id = j.value AND p.org_id = ?2 \
         LEFT JOIN einsatz_personal ep ON ep.personal_id = j.value AND ep.einsatz_id = ?3 \
         LEFT JOIN einsatz_einheit e ON e.id = ep.einheit_id AND e.aufgeloest_at IS NULL \
         LEFT JOIN einsatz_fahrzeug ef ON ef.id = ep.fahrzeug_id",
    )
    .bind(ids_json(ids.iter().copied()))
    .bind(org_id)
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|z| {
            let aktiv = z.ep_id.is_some() && z.ep_beendet_at.is_none();
            // An einer beendeten Zeile hängt nichts mehr (LLH-1079 löst Einheit und Fahrzeug).
            let einheit = if aktiv {
                bezug(z.einheit_id, z.einheit_name)
            } else {
                None
            };
            let fahrzeug = if aktiv {
                bezug(z.ef_id, z.fahrzeug_name)
            } else {
                None
            };
            let ende = if aktiv {
                None
            } else {
                Some(z.ep_beendet_als.as_deref().unwrap_or("entlassen"))
            };
            let auf_eigenem = z.ef_fahrzeug_id.is_some()
                && z.ef_fahrzeug_id == vorlagen_fahrzeug.get(&z.personal_id).copied();
            let anderes_fahrzeug = fahrzeug.is_some() && !auf_eigenem;
            let zeile = z
                .ep_id
                .map(|_| (ende, einheit.is_some() || anderes_fahrzeug));
            let zustand = personal_zustand(z.dienststatus == DIENSTSTATUS_IN_DIENST, zeile);
            (
                z.personal_id,
                PersonalLage {
                    zustand,
                    ep_id: if aktiv { z.ep_id } else { None },
                    einheit,
                    fahrzeug,
                },
            )
        })
        .collect())
}

/// Plant die Bildung aus der Vorlage `vorlage_id` (D2): fremd oder unbekannt → 404, deaktivierte
/// Wurzel → 422, mehr als [`KNOTEN_MAX`] Einheiten → 422. Danach je gelesener Art eine Abfrage für
/// die Lage aller Kräfte des Baums. Schreibt nichts.
pub async fn plan_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    vorlage_id: i64,
    lesen: Lesen,
) -> Result<Plan, AppError> {
    let knoten = vorlage_repo::load_tree_tx(conn, org_id, vorlage_id).await?;
    if !knoten[0].aktiv {
        return Err(AppError::UnprocessableEntity(
            "Die Vorlage ist deaktiviert".into(),
        ));
    }
    if knoten.len() > KNOTEN_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Vorlage hat mehr als {KNOTEN_MAX} Einheiten"
        )));
    }
    let fahrzeug_ids: Vec<i64> = knoten
        .iter()
        .flat_map(|k| k.fahrzeuge.iter().map(|f| f.fahrzeug_id))
        .collect();
    let personal_ids: Vec<i64> = knoten
        .iter()
        .flat_map(|k| k.personal.iter().map(|p| p.personal_id))
        .collect();
    let fahrzeuge = if lesen.fahrzeuge && !fahrzeug_ids.is_empty() {
        load_fahrzeug_lagen_tx(conn, einsatz_id, org_id, &fahrzeug_ids).await?
    } else {
        HashMap::new()
    };
    let personal = if lesen.personal && !personal_ids.is_empty() {
        let vorlagen_fahrzeug: HashMap<i64, i64> = knoten
            .iter()
            .flat_map(|k| k.personal.iter())
            .filter_map(|p| p.fahrzeug_id.map(|f| (p.personal_id, f)))
            .collect();
        load_personal_lagen_tx(conn, einsatz_id, org_id, &personal_ids, &vorlagen_fahrzeug).await?
    } else {
        HashMap::new()
    };
    Ok(Plan {
        knoten,
        fahrzeuge,
        personal,
    })
}

/// Die Vorschau aus einer Planung; ein gesperrtes Modul bleibt leer (D8).
pub fn vorschau(plan: &Plan, gesperrt: Lesen) -> VorlageVorschau {
    let knoten = plan
        .knoten
        .iter()
        .enumerate()
        .map(|(i, k)| VorschauKnoten {
            vorlage_id: k.id,
            ueber_vorlage_id: if i == 0 { None } else { k.ueber_vorlage_id },
            name: k.name.clone(),
            typ_id: k.typ_id,
            typ_label: k.typ_label.clone(),
            funkrufname: k.funkrufname.clone(),
            tz_fachaufgabe: k.tz_fachaufgabe.clone(),
            tz_organisation: k.tz_organisation.clone(),
            soll: k.soll,
            soll_eigen: k.soll_eigen,
            fahrzeuge: if gesperrt.fahrzeuge {
                Vec::new()
            } else {
                k.fahrzeuge
                    .iter()
                    .filter_map(|f| {
                        let lage = plan.fahrzeuge.get(&f.fahrzeug_id)?;
                        Some(VorschauFahrzeug {
                            fahrzeug_id: f.fahrzeug_id,
                            funkrufname: f.funkrufname.clone(),
                            fahrzeugtyp: f.fahrzeugtyp.clone(),
                            zustand: lage.zustand,
                            ef_id: lage.ef_id,
                            einheit_id: lage.einheit.as_ref().map(|e| e.id),
                            einheit_name: lage.einheit.as_ref().map(|e| e.name.clone()),
                        })
                    })
                    .collect()
            },
            personal: if gesperrt.personal {
                Vec::new()
            } else {
                k.personal
                    .iter()
                    .filter_map(|p| {
                        let lage = plan.personal.get(&p.personal_id)?;
                        Some(VorschauPersonal {
                            personal_id: p.personal_id,
                            name: p.name.clone(),
                            staerke_position: p.staerke_position,
                            fahrzeug_id: p.fahrzeug_id,
                            zustand: lage.zustand,
                            ep_id: lage.ep_id,
                            einheit_id: lage.einheit.as_ref().map(|e| e.id),
                            einheit_name: lage.einheit.as_ref().map(|e| e.name.clone()),
                            ef_id: lage.fahrzeug.as_ref().map(|f| f.id),
                            fahrzeug_name: lage.fahrzeug.as_ref().map(|f| f.name.clone()),
                        })
                    })
                    .collect()
            },
        })
        .collect();
    VorlageVorschau {
        vorlage_id: plan.knoten[0].id,
        knoten,
        fahrzeuge_gesperrt: gesperrt.fahrzeuge,
        personal_gesperrt: gesperrt.personal,
    }
}

/// Eine gewählte Kraft der Anfrage: Stamm-ID und der ausdrückliche Wunsch, sie umzuhängen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Wahl {
    pub id: i64,
    pub umhaengen: bool,
}

/// Grund an einer gebundenen Kraft ohne „umhängen“: „in «2. Zug»“, sonst „auf «83-4»“.
pub fn grund_gebunden(einheit: Option<&Bezug>, fahrzeug: Option<&Bezug>) -> String {
    match (einheit, fahrzeug) {
        (Some(e), _) => format!("in «{}»", e.name),
        (None, Some(f)) => format!("auf «{}»", f.name),
        (None, None) => "gebunden".into(),
    }
}

/// Abgleich Anfrage ↔ Plan (D6, Schritt 2), rein und **vor dem ersten Schreiben**: je Zeile ein
/// Grund für „nicht in der Vorlage“, „außer Dienst“, ein entlassenes Fahrzeug (noch ohne
/// erneutes Disponieren, LLH-1079 II) und „gebunden ohne umhängen“; Fahrzeuge vor Personen, in
/// der Reihenfolge der Anfrage. Leer = alles übernehmbar.
pub fn check_against_plan(plan: &Plan, fahrzeuge: &[Wahl], personal: &[Wahl]) -> Vec<ZeilenGrund> {
    let mut zeilen = Vec::new();
    let zeile = |art, id, grund: String| ZeilenGrund { art, id, grund };
    for w in fahrzeuge {
        let grund = match plan.fahrzeuge.get(&w.id) {
            None => Some(GRUND_NICHT_IN_VORLAGE.to_string()),
            Some(l) => match l.zustand {
                VorschauZustand::AusserDienst => {
                    Some(kraefte_disposition::GRUND_AUSSER_DIENST.to_string())
                }
                VorschauZustand::Entlassen => {
                    Some(kraefte_disposition::GRUND_ENTLASSEN.to_string())
                }
                VorschauZustand::Gebunden if !w.umhaengen => {
                    Some(grund_gebunden(l.einheit.as_ref(), None))
                }
                _ => None,
            },
        };
        if let Some(g) = grund {
            zeilen.push(zeile(ZeilenArt::Fahrzeug, w.id, g));
        }
    }
    for w in personal {
        let grund = match plan.personal.get(&w.id) {
            None => Some(GRUND_NICHT_IN_VORLAGE.to_string()),
            Some(l) => match l.zustand {
                VorschauZustand::AusserDienst => {
                    Some(kraefte_disposition::GRUND_AUSSER_DIENST.to_string())
                }
                VorschauZustand::Gebunden if !w.umhaengen => {
                    Some(grund_gebunden(l.einheit.as_ref(), l.fahrzeug.as_ref()))
                }
                _ => None,
            },
        };
        if let Some(g) = grund {
            zeilen.push(zeile(ZeilenArt::Personal, w.id, g));
        }
    }
    zeilen
}

/// Eine umgehängte Kraft für den ETB-Text: Name und woher („aus «2. Zug»“, „von «83-4»“).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Umgehaengt {
    pub name: String,
    pub woher: String,
}

/// Was [`bilde_tx`] angelegt und berührt hat (für ETB-Text, Antwort und Ereignisse).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Gebildet {
    /// Neue Einheiten (ID, Name), die oberste vorn.
    pub einheiten: Vec<Bezug>,
    /// Übernommene Fahrzeuge (`einsatz_fahrzeug.id`, Funkrufname) in Vorlagenreihenfolge.
    pub fahrzeuge: Vec<Bezug>,
    /// Übernommene Personen (`einsatz_personal.id`, Name) in Vorlagenreihenfolge.
    pub personal: Vec<Bezug>,
    pub umgehaengt: Vec<Umgehaengt>,
    /// Einheiten, aus denen umgehängt wurde (Ereignis `einheit` nach dem Commit).
    pub alte_einheiten: Vec<i64>,
    /// Fahrzeuge, von denen eine Person gelöst wurde (Ereignis `fahrzeug`).
    pub alte_fahrzeuge: Vec<i64>,
}

/// Die Anfrage des Bildens, schon geprüft und entdoppelt.
#[derive(Debug, Clone)]
pub struct Anfrage<'a> {
    /// Name der obersten Einheit; `None` übernimmt den Namen der Vorlage.
    pub name: Option<&'a str>,
    pub abschnitt_id: Option<i64>,
    pub fahrzeuge: &'a [Wahl],
    pub personal: &'a [Wahl],
}

fn push_unique(list: &mut Vec<i64>, id: i64) {
    if !list.contains(&id) {
        list.push(id);
    }
}

/// Bildet die Einheit aus dem Plan in der Transaktion des Aufrufers (D6, Schritte 2–5): Abgleich
/// (422 mit Gründen je Zeile, nichts geschrieben), Einheiten top-down mit den Kopfdaten der
/// Vorlage (D9), Fahrzeuge vor Personen (neu und entlassen über den Baustein je Einheit, Bestand
/// zugeordnet), Besatzung nach der Vorlage. Schreibt kein ETB, sendet nichts; ein Fehler mitten
/// darin rollt der Aufrufer mit der ganzen Transaktion zurück.
pub async fn bilde_tx(
    conn: &mut SqliteConnection,
    kontext: Kontext,
    plan: &Plan,
    anfrage: &Anfrage<'_>,
) -> Result<Gebildet, AppError> {
    let zeilen = check_against_plan(plan, anfrage.fahrzeuge, anfrage.personal);
    if !zeilen.is_empty() {
        return Err(AppError::Zeilen {
            meldung: MELDUNG_ZEILEN.into(),
            zeilen,
        });
    }
    let einsatz_id = kontext.einsatz_id;
    let mut gebildet = Gebildet::default();

    // Einheiten top-down; Vorlage → neue Einheit.
    let mut einheit_von: HashMap<i64, i64> = HashMap::new();
    for (i, k) in plan.knoten.iter().enumerate() {
        let wurzel = i == 0;
        let name = match (wurzel, anfrage.name) {
            (true, Some(n)) => n,
            _ => k.name.as_str(),
        };
        let soll = if k.soll_eigen { k.soll } else { None };
        // Eltern stehen vor ihren Kindern (`load_tree_tx`); ein fehlender Elternteil ist ein
        // Programmfehler, keine eigenständige Einheit.
        let ueber = if wurzel {
            None
        } else {
            let eltern = k
                .ueber_vorlage_id
                .and_then(|u| einheit_von.get(&u).copied())
                .ok_or_else(|| {
                    AppError::Internal(format!(
                        "Vorlage {} steht im Plan vor ihrem Elternteil",
                        k.id
                    ))
                })?;
            Some(eltern)
        };
        let id = einheit_repo::anlegen_tx(
            conn,
            einsatz_id,
            kontext.org_id,
            &EinheitDaten {
                name,
                abschnitt_id: if wurzel { anfrage.abschnitt_id } else { None },
                ueber_einheit_id: ueber,
                typ_id: Some(k.typ_id),
                soll_fuehrer: soll.map(|s| i64::from(s.fuehrer)),
                soll_unterfuehrer: soll.map(|s| i64::from(s.unterfuehrer)),
                soll_mannschaft: soll.map(|s| i64::from(s.mannschaft)),
                bemerkung: None,
                funkrufname: k.funkrufname.as_deref(),
                kommunikationsmittel: None,
                erreichbarkeit: None,
                sortier: k.sortier,
                tz_fachaufgabe: k.tz_fachaufgabe.as_deref(),
                tz_organisation: k.tz_organisation.as_deref(),
            },
            kontext.benutzer_id,
        )
        .await?;
        einheit_von.insert(k.id, id);
        gebildet.einheiten.push(Bezug {
            id,
            name: name.to_string(),
        });
    }

    let fahrzeug_wahl: HashMap<i64, bool> = anfrage
        .fahrzeuge
        .iter()
        .map(|w| (w.id, w.umhaengen))
        .collect();
    let personal_wahl: HashMap<i64, bool> = anfrage
        .personal
        .iter()
        .map(|w| (w.id, w.umhaengen))
        .collect();

    // Fahrzeuge je Einheit; Stamm-ID → neue Zeile im Einsatz für die Besatzung.
    let mut ef_von: HashMap<i64, i64> = HashMap::new();
    for k in &plan.knoten {
        let eid = einheit_von[&k.id];
        let gewaehlt: Vec<i64> = k
            .fahrzeuge
            .iter()
            .map(|f| f.fahrzeug_id)
            .filter(|id| fahrzeug_wahl.contains_key(id))
            .collect();
        let neu: Vec<i64> = gewaehlt
            .iter()
            .copied()
            .filter(|id| plan.fahrzeuge[id].zustand == VorschauZustand::Neu)
            .collect();
        let mut neue: HashMap<i64, Bezug> = HashMap::new();
        if !neu.is_empty() {
            let ergebnis =
                kraefte_disposition::disponiere_fahrzeuge_tx(conn, kontext, &neu, Some(eid))
                    .await?;
            for (fid, f) in neu.iter().zip(ergebnis.fahrzeuge) {
                neue.insert(
                    *fid,
                    Bezug {
                        id: f.ef_id,
                        name: f.funkrufname,
                    },
                );
            }
        }
        for fid in gewaehlt {
            let b = match neue.remove(&fid) {
                Some(b) => b,
                None => {
                    let lage = &plan.fahrzeuge[&fid];
                    let ef_id = lage.ef_id.ok_or_else(|| {
                        AppError::Internal("Fahrzeug im Einsatz ohne Zeile".into())
                    })?;
                    let name = mitglied_repo::zuordnen_fahrzeug_tx(conn, einsatz_id, eid, ef_id)
                        .await?
                        .funkrufname;
                    if let Some(alt) = &lage.einheit {
                        push_unique(&mut gebildet.alte_einheiten, alt.id);
                        gebildet.umgehaengt.push(Umgehaengt {
                            name: name.clone(),
                            woher: format!("aus «{}»", alt.name),
                        });
                    }
                    Bezug { id: ef_id, name }
                }
            };
            ef_von.insert(fid, b.id);
            gebildet.fahrzeuge.push(b);
        }
    }

    // Personen je Einheit und Fahrzeug der Vorlage (falls es mitkommt).
    for k in &plan.knoten {
        let eid = einheit_von[&k.id];
        let gewaehlt: Vec<_> = k
            .personal
            .iter()
            .filter(|p| personal_wahl.contains_key(&p.personal_id))
            .collect();
        // Gruppen der neu oder erneut disponierten Personen in Vorlagenreihenfolge.
        let mut gruppen: Vec<(Option<i64>, Vec<PersonalWahl>)> = Vec::new();
        for p in &gewaehlt {
            let lage = &plan.personal[&p.personal_id];
            if !matches!(
                lage.zustand,
                VorschauZustand::Neu | VorschauZustand::Entlassen
            ) {
                continue;
            }
            let ef = p.fahrzeug_id.and_then(|f| ef_von.get(&f).copied());
            let wahl = PersonalWahl {
                personal_id: p.personal_id,
                staerke_position: p.staerke_position.map(|s| s.as_str().to_string()),
            };
            match gruppen.iter_mut().find(|(g, _)| *g == ef) {
                Some((_, liste)) => liste.push(wahl),
                None => gruppen.push((ef, vec![wahl])),
            }
        }
        let mut neue: HashMap<i64, Bezug> = HashMap::new();
        for (ef, wahl) in gruppen {
            let ergebnis = kraefte_disposition::disponiere_personal_tx(
                conn,
                kontext,
                &wahl,
                Ziel {
                    einheit_id: Some(eid),
                    fahrzeug_id: ef,
                },
                Regeln::EINZEL,
            )
            .await?;
            for (w, kraft) in wahl.iter().zip(ergebnis.kraefte) {
                neue.insert(
                    w.personal_id,
                    Bezug {
                        id: kraft.ep_id,
                        name: kraft.name,
                    },
                );
            }
        }
        for p in gewaehlt {
            let b = match neue.remove(&p.personal_id) {
                Some(b) => b,
                None => {
                    let lage = &plan.personal[&p.personal_id];
                    let ep_id = lage
                        .ep_id
                        .ok_or_else(|| AppError::Internal("Person im Einsatz ohne Zeile".into()))?;
                    let name =
                        mitglied_repo::zuordnen_personal_tx(conn, einsatz_id, eid, ep_id).await?;
                    let ziel_ef = p.fahrzeug_id.and_then(|f| ef_von.get(&f).copied());
                    match (ziel_ef, &lage.fahrzeug) {
                        (Some(ef), _) => {
                            besatzung_repo::ordne_besatzung_zu_tx(conn, einsatz_id, ef, ep_id)
                                .await?;
                        }
                        (None, Some(alt)) => {
                            besatzung_repo::gib_besatzung_frei_tx(conn, einsatz_id, alt.id, ep_id)
                                .await?;
                        }
                        (None, None) => {}
                    }
                    if let Some(alt) = &lage.fahrzeug {
                        if ziel_ef != Some(alt.id) {
                            push_unique(&mut gebildet.alte_fahrzeuge, alt.id);
                        }
                    }
                    match (&lage.einheit, &lage.fahrzeug) {
                        (Some(alt), _) => {
                            push_unique(&mut gebildet.alte_einheiten, alt.id);
                            gebildet.umgehaengt.push(Umgehaengt {
                                name: name.clone(),
                                woher: format!("aus «{}»", alt.name),
                            });
                        }
                        (None, Some(alt)) if ziel_ef != Some(alt.id) => {
                            gebildet.umgehaengt.push(Umgehaengt {
                                name: name.clone(),
                                woher: format!("von «{}»", alt.name),
                            })
                        }
                        _ => {}
                    }
                    Bezug { id: ep_id, name }
                }
            };
            gebildet.personal.push(b);
        }
    }
    Ok(gebildet)
}

/// Text des einen ETB-Sammeleintrags (D11) aus dem Ergebnis des Bildens.
pub fn etb_text(vorlage: &str, g: &Gebildet) -> String {
    let namen = |liste: &[Bezug]| liste.iter().map(|b| b.name.clone()).collect::<Vec<_>>();
    let unter: Vec<String> = g.einheiten.iter().skip(1).map(|b| b.name.clone()).collect();
    super::etb_text_aus_vorlage(
        g.einheiten.first().map_or("", |b| b.name.as_str()),
        vorlage,
        &unter,
        &namen(&g.fahrzeuge),
        &namen(&g.personal),
        &g.umgehaengt
            .iter()
            .map(|u| format!("{} {}", u.name, u.woher))
            .collect::<Vec<_>>(),
    )
}

#[cfg(test)]
mod tests;
