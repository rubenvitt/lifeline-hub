//! Taktische Fernmeldeskizze des S6 (LFH-893): was die Skizze speichert, weil es sonst nirgends
//! steht — Komponenten samt Kanälen, Punkt-zu-Punkt-Verbindungen, Bereiche, die verschobene Lage
//! und das Schriftfeld.
//!
//! **Zuordnungen bleiben, wo sie liegen.** Abschnitt, Einheit und Führungsstelle tragen ihre
//! Sprechgruppen selbst (`sprechgruppe::repo::Zuordnungsziel`), externe Stellen ihre Kanäle am
//! Datensatz des Kommunikationsplans (`stab::kommunikation`). Die Skizze liest sie, sie kopiert
//! sie nicht.
//!
//! **Polymorphe Bezüge** (`von_art`/`von_id`, `nach_art`/`nach_id`, `element`) tragen keinen
//! Fremdschlüssel. Jeder Löschpfad von Abschnitt, Einheit, Kommunikationsstelle und Komponente
//! ruft deshalb [`vergiss`] im selben Transaktionsschritt; der Guard
//! `tests::jeder_loeschpfad_vergisst_die_skizzenbezuege` listet die Pfade.
//!
//! **Kein ETB** je Skizzenänderung: die Skizze ist ein Arbeitsmittel des S6 wie der
//! Kommunikationsplan. Jede wirksame Änderung meldet das Stab-Ereignis (Route).
//!
//! Herleitung: `openspec/changes/lfh-893-taktische-fernmeldeskizze/design.md` (D3, D4, D14).

use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use super::repo::fordere_aktiv_in_tx;
use crate::error::AppError;
use crate::sprechgruppe::{Sprechgruppe, SprechgruppeAnzeige};
use crate::wire_enum::wire_enum;
use crate::write_retry;

wire_enum! {
    /// Komponente der Fernmeldeskizze (DV 810.3 J.3). Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Komponentenart {
        Repeater => "repeater",
        Gateway => "gateway",
        Basisstation => "basisstation",
        MobileBasisstation => "mobile_basisstation",
        Antenne => "antenne",
        Vermittlung => "vermittlung",
    }
}

wire_enum! {
    /// Art einer Punkt-zu-Punkt-Verbindung (J.2). Wire == `as_str()`. Keine Rufnummer: die
    /// Erreichbarkeit steht im Kommunikationsplan.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Verbindungsart {
        Telefon => "telefon",
        Fax => "fax",
        Daten => "daten",
        Melder => "melder",
        Bild => "bild",
        Livestream => "livestream",
        Richtfunk => "richtfunk",
        Satellit => "satellit",
        Sonstige => "sonstige",
    }
}

wire_enum! {
    /// Übertragungsweg einer Verbindung: Funk (Zickzack-Marke) oder leitergebunden.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Verbindungsmedium {
        Funk => "funk",
        Leitung => "leitung",
    }
}

wire_enum! {
    /// Status einer skizzeneigenen Verbindung oder eines Kanals einer externen Stelle (D7).
    /// „Geplant“ ist nur Darstellung: kein ETB, keine Erinnerung.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Verbindungsstatus {
        Bestehend => "bestehend",
        Geplant => "geplant",
    }
}

wire_enum! {
    /// Betriebsart einer Verbindung: Wechsel- oder Gegenverkehr.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Verkehrsart {
        Wechsel => "wechsel",
        Gegen => "gegen",
    }
}

wire_enum! {
    /// VS-Vermerk im Schriftfeld (J.5).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VsVermerk {
        Keiner => "keiner",
        VsNfd => "vs_nfd",
    }
}

wire_enum! {
    /// Art eines Endpunkts einer Verbindung (`SkizzenBezug.art`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum SkizzenBezugArt {
        /// Die eigene Führungsstelle; eine je Einsatz, deshalb ohne id.
        Fuehrungsstelle => "fuehrungsstelle",
        Abschnitt => "abschnitt",
        Einheit => "einheit",
        /// Externe Stelle des Kommunikationsplans (nicht `funktion`).
        Stelle => "stelle",
        Komponente => "komponente",
    }
}

/// Höchstlänge der Bezeichnung einer Komponente und eines Bereichs (Zeichen, getrimmt).
pub const BEZEICHNUNG_MAX: usize = 100;
/// Höchstlänge des Hinweises einer Verbindung.
pub const HINWEIS_MAX: usize = 200;
/// Höchstlänge des Herausgebers im Schriftfeld.
pub const HERAUSGEBER_MAX: usize = 200;
/// Höchstlänge des Namens bei „gez.“.
pub const GEZ_NAME_MAX: usize = 100;
/// Vorgabe der Bezeichnung eines neuen Bereichs (D3).
pub const BEREICH_VORGABE: &str = "Rückwärtiger Bereich";

// ── Antworten (D14) ──────────────────────────────────────────────────────────────────────────

/// Alles, was die Skizze selbst speichert. Zuordnungen von Abschnitt, Einheit, Führungsstelle und
/// externen Stellen liest der Client aus ihren Datensätzen.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Fernmeldeskizze {
    pub lage: Vec<SkizzenLage>,
    pub komponenten: Vec<SkizzenKomponente>,
    pub verbindungen: Vec<SkizzenVerbindung>,
    pub bereiche: Vec<SkizzenBereich>,
    pub schriftfeld: Schriftfeld,
    /// Jüngster Änderungszeitpunkt aller Skizzendaten (Lage, Komponenten samt Kanälen,
    /// Verbindungen, Bereiche, Schriftfeld, Kanäle externer Stellen); `null`, solange nichts
    /// gespeichert ist. Ein Entfernen hinterlässt keinen Zeitpunkt.
    #[schema(required)]
    pub stand: Option<String>,
}

/// Gespeicherte Lage eines Elements. Ein Element ohne Zeile setzt das Auto-Layout (D4).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema, sqlx::FromRow)]
pub struct SkizzenLage {
    /// `fs` | `ab-<id>` | `eh-<id>` | `ks-<id>` | `ko-<id>` | `sg-<id>`.
    pub element: String,
    pub x: f64,
    pub y: f64,
    /// Nur bei Schienen (`sg-<id>`).
    #[schema(required)]
    pub breite: Option<f64>,
    /// Erwarteter Stand für das nächste Verschieben (409 bei Abweichung).
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SkizzenKomponente {
    pub id: i64,
    pub art: Komponentenart,
    #[schema(required)]
    pub bezeichnung: Option<String>,
    /// Kanäle der Komponente, sortiert wie an Abschnitt und Einheit.
    pub sprechgruppen: Vec<SprechgruppeAnzeige>,
}

/// Endpunkt einer Verbindung. `id` ist `null` genau bei der Führungsstelle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct SkizzenBezug {
    pub art: SkizzenBezugArt,
    #[schema(required)]
    pub id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SkizzenVerbindung {
    pub id: i64,
    pub von: SkizzenBezug,
    pub nach: SkizzenBezug,
    pub art: Verbindungsart,
    pub medium: Verbindungsmedium,
    pub status: Verbindungsstatus,
    #[schema(required)]
    pub verkehr: Option<Verkehrsart>,
    #[schema(required)]
    pub hinweis: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema, sqlx::FromRow)]
pub struct SkizzenBereich {
    pub id: i64,
    pub bezeichnung: String,
    pub x: f64,
    pub y: f64,
    pub breite: f64,
    pub hoehe: f64,
    pub version: i64,
}

/// Schriftfeld der Skizze (J.5). Jedes Feld trägt den gespeicherten Wert, `null` = leer. Die
/// Vorgabe des Herausgebers (Einsatzbezeichnung) setzt erst die Darstellung ein, damit
/// Bearbeiten und Rückgängig „leer“ von „Einsatzbezeichnung“ unterscheiden (Review O1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Schriftfeld {
    #[schema(required)]
    pub herausgeber: Option<String>,
    pub vs_vermerk: VsVermerk,
    #[schema(required)]
    pub gueltig_ab: Option<String>,
    /// Personenbezogen: wird bei der Aufbewahrung geschwärzt.
    #[schema(required)]
    pub gez_name: Option<String>,
    #[schema(required)]
    pub gez_at: Option<String>,
}

/// 409-Antwort auf `PUT …/lage/{element}`: der Fehlertext und der gespeicherte Stand (`null`,
/// wenn es keine Zeile gibt, etwa nach „Neu anordnen“).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct SkizzenLageKonflikt {
    pub error: String,
    #[schema(required)]
    pub aktuell: Option<SkizzenLage>,
}

/// 409-Antwort auf `PATCH …/bereiche/{bid}` mit dem gespeicherten Stand.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct SkizzenBereichKonflikt {
    pub error: String,
    pub aktuell: SkizzenBereich,
}

// ── Elemente und Bezüge ──────────────────────────────────────────────────────────────────────

/// Ein Element der Skizze, wie es Lage und Verbindungen ansprechen (D2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Element {
    Fuehrungsstelle,
    Abschnitt(i64),
    Einheit(i64),
    Stelle(i64),
    Komponente(i64),
    /// Schiene einer Sprechgruppe; nur in der Lage, nie Endpunkt einer Verbindung.
    Sprechgruppe(i64),
}

impl Element {
    /// Liest einen Schlüssel (`fs`, `ab-12` …). Kleinbuchstaben, id ohne Vorzeichen und ohne
    /// führende Null, damit ein Element genau einen Schlüssel hat.
    pub fn parse(s: &str) -> Option<Element> {
        if s == "fs" {
            return Some(Element::Fuehrungsstelle);
        }
        let (praefix, rest) = s.split_once('-')?;
        if rest.is_empty() || rest.starts_with('0') || !rest.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let id: i64 = rest.parse().ok()?;
        Some(match praefix {
            "ab" => Element::Abschnitt(id),
            "eh" => Element::Einheit(id),
            "ks" => Element::Stelle(id),
            "ko" => Element::Komponente(id),
            "sg" => Element::Sprechgruppe(id),
            _ => return None,
        })
    }

    pub fn schluessel(self) -> String {
        match self {
            Element::Fuehrungsstelle => "fs".into(),
            Element::Abschnitt(id) => format!("ab-{id}"),
            Element::Einheit(id) => format!("eh-{id}"),
            Element::Stelle(id) => format!("ks-{id}"),
            Element::Komponente(id) => format!("ko-{id}"),
            Element::Sprechgruppe(id) => format!("sg-{id}"),
        }
    }

    /// Der Bezug als Endpunkt einer Verbindung; `None` für eine Schiene.
    pub fn bezug(self) -> Option<SkizzenBezug> {
        let (art, id) = match self {
            Element::Fuehrungsstelle => (SkizzenBezugArt::Fuehrungsstelle, None),
            Element::Abschnitt(id) => (SkizzenBezugArt::Abschnitt, Some(id)),
            Element::Einheit(id) => (SkizzenBezugArt::Einheit, Some(id)),
            Element::Stelle(id) => (SkizzenBezugArt::Stelle, Some(id)),
            Element::Komponente(id) => (SkizzenBezugArt::Komponente, Some(id)),
            Element::Sprechgruppe(_) => return None,
        };
        Some(SkizzenBezug { art, id })
    }

    /// Ein Endpunkt aus dem Body. Die Kombination Art/id ist ein Zusammenhang → 422.
    pub fn aus_bezug(art: SkizzenBezugArt, id: Option<i64>) -> Result<Element, AppError> {
        match (art, id) {
            (SkizzenBezugArt::Fuehrungsstelle, None) => Ok(Element::Fuehrungsstelle),
            (SkizzenBezugArt::Fuehrungsstelle, Some(_)) => Err(AppError::UnprocessableEntity(
                "Die Führungsstelle wird ohne id angegeben".into(),
            )),
            (_, None) => Err(AppError::UnprocessableEntity(format!(
                "Ein Bezug der Art '{}' braucht eine id",
                art.as_str()
            ))),
            (SkizzenBezugArt::Abschnitt, Some(id)) => Ok(Element::Abschnitt(id)),
            (SkizzenBezugArt::Einheit, Some(id)) => Ok(Element::Einheit(id)),
            (SkizzenBezugArt::Stelle, Some(id)) => Ok(Element::Stelle(id)),
            (SkizzenBezugArt::Komponente, Some(id)) => Ok(Element::Komponente(id)),
        }
    }
}

/// Prüft, dass das Element im Einsatz besteht; sonst 422 (Bezug außerhalb des Einsatzes).
/// Eine Funktion des Kommunikationsplans ist keine Stelle der Skizze (D2).
async fn pruefe_im_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    element: Element,
) -> Result<(), AppError> {
    let sql = match element {
        Element::Fuehrungsstelle => return Ok(()),
        Element::Abschnitt(_) => "SELECT 1 FROM einsatzabschnitt WHERE id = ?1 AND einsatz_id = ?2",
        Element::Einheit(_) => "SELECT 1 FROM einsatz_einheit WHERE id = ?1 AND einsatz_id = ?2",
        Element::Stelle(_) => {
            "SELECT 1 FROM einsatz_kommunikation_stelle \
             WHERE id = ?1 AND einsatz_id = ?2 AND stellenart <> 'funktion'"
        }
        Element::Komponente(_) => {
            "SELECT 1 FROM fernmeldeskizze_komponente WHERE id = ?1 AND einsatz_id = ?2"
        }
        Element::Sprechgruppe(_) => {
            "SELECT 1 FROM sprechgruppe \
             WHERE id = ?1 AND org_id = (SELECT org_id FROM einsatz WHERE id = ?2) \
               AND (einsatz_id IS NULL OR einsatz_id = ?2)"
        }
    };
    let id = match element {
        Element::Abschnitt(id)
        | Element::Einheit(id)
        | Element::Stelle(id)
        | Element::Komponente(id)
        | Element::Sprechgruppe(id) => id,
        Element::Fuehrungsstelle => unreachable!("oben beantwortet"),
    };
    let da: Option<i64> = sqlx::query_scalar(sql)
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
    if da.is_none() {
        return Err(AppError::UnprocessableEntity(format!(
            "'{}' gehört nicht zu diesem Einsatz",
            element.schluessel()
        )));
    }
    Ok(())
}

/// Räumt Lage und Verbindungen eines Elements ab, das gleich gelöscht wird — im Transaktions-
/// schritt des Löschpfads (D3). Kanäle hängen per `ON DELETE CASCADE` und brauchen das nicht.
pub async fn vergiss(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    element: Element,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM fernmeldeskizze_lage WHERE einsatz_id = ? AND element = ?")
        .bind(einsatz_id)
        .bind(element.schluessel())
        .execute(&mut *conn)
        .await?;
    if let Some(bezug) = element.bezug() {
        sqlx::query(
            "DELETE FROM fernmeldeskizze_verbindung WHERE einsatz_id = ?1 \
               AND ((von_art = ?2 AND von_id IS ?3) OR (nach_art = ?2 AND nach_id IS ?3))",
        )
        .bind(einsatz_id)
        .bind(bezug.art.as_str())
        .bind(bezug.id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

// ── Lesen ────────────────────────────────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct KomponenteRoh {
    id: i64,
    art: String,
    bezeichnung: Option<String>,
}

#[derive(sqlx::FromRow)]
struct KanalRoh {
    bezug_id: i64,
    #[sqlx(flatten)]
    sprechgruppe: Sprechgruppe,
}

#[derive(sqlx::FromRow)]
struct VerbindungRoh {
    id: i64,
    von_art: String,
    von_id: Option<i64>,
    nach_art: String,
    nach_id: Option<i64>,
    art: String,
    medium: String,
    status: String,
    verkehr: Option<String>,
    hinweis: Option<String>,
}

#[derive(sqlx::FromRow)]
struct SchriftfeldRoh {
    herausgeber: Option<String>,
    vs_vermerk: Option<String>,
    gueltig_ab: Option<String>,
    gez_name: Option<String>,
    gez_at: Option<String>,
}

const BEREICH_SPALTEN: &str = "id, bezeichnung, x, y, breite, hoehe, version";

/// Die Skizzendaten eines Einsatzes.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Fernmeldeskizze, AppError> {
    let mut conn = pool.acquire().await?;
    let conn = &mut *conn;
    let lage = sqlx::query_as::<_, SkizzenLage>(
        "SELECT element, x, y, breite, version FROM fernmeldeskizze_lage \
         WHERE einsatz_id = ? ORDER BY element",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let komponenten = komponenten_laden(conn, einsatz_id, None).await?;
    let verbindungen = verbindungen_laden(conn, einsatz_id, None).await?;
    let bereiche = sqlx::query_as::<_, SkizzenBereich>(sqlx::AssertSqlSafe(format!(
        "SELECT {BEREICH_SPALTEN} FROM fernmeldeskizze_bereich WHERE einsatz_id = ? ORDER BY id"
    )))
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let schriftfeld = schriftfeld_laden(conn, einsatz_id).await?;
    let stand: Option<String> = sqlx::query_scalar(
        "SELECT MAX(t) FROM ( \
            SELECT MAX(geaendert_at) AS t FROM fernmeldeskizze_lage WHERE einsatz_id = ?1 \
            UNION ALL SELECT MAX(geaendert_at) FROM fernmeldeskizze_komponente \
                WHERE einsatz_id = ?1 \
            UNION ALL SELECT MAX(ks.geaendert_at) FROM fernmeldeskizze_komponente_sprechgruppe ks \
                JOIN fernmeldeskizze_komponente k ON k.id = ks.komponente_id \
                WHERE k.einsatz_id = ?1 \
            UNION ALL SELECT MAX(geaendert_at) FROM fernmeldeskizze_verbindung \
                WHERE einsatz_id = ?1 \
            UNION ALL SELECT MAX(geaendert_at) FROM fernmeldeskizze_bereich WHERE einsatz_id = ?1 \
            UNION ALL SELECT geaendert_at FROM fernmeldeskizze_schriftfeld WHERE einsatz_id = ?1 \
            UNION ALL SELECT MAX(ss.geaendert_at) \
                FROM einsatz_kommunikation_stelle_sprechgruppe ss \
                JOIN einsatz_kommunikation_stelle s ON s.id = ss.stelle_id \
                WHERE s.einsatz_id = ?1)",
    )
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(Fernmeldeskizze {
        lage,
        komponenten,
        verbindungen,
        bereiche,
        schriftfeld,
        stand,
    })
}

/// Komponenten des Einsatzes samt Kanälen; mit `nur` genau diese eine.
async fn komponenten_laden(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    nur: Option<i64>,
) -> Result<Vec<SkizzenKomponente>, AppError> {
    let zeilen = sqlx::query_as::<_, KomponenteRoh>(
        "SELECT id, art, bezeichnung FROM fernmeldeskizze_komponente \
         WHERE einsatz_id = ?1 AND (?2 IS NULL OR id = ?2) ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(nur)
    .fetch_all(&mut *conn)
    .await?;
    let kanaele = sqlx::query_as::<_, KanalRoh>(
        "SELECT ks.komponente_id AS bezug_id, \
                sg.id AS id, sg.org_id AS org_id, sg.einsatz_id AS einsatz_id, \
                sg.bezeichnung AS bezeichnung, sg.betriebsart AS betriebsart, \
                sg.hinweis AS hinweis, sg.aktiv AS aktiv, sg.sortier AS sortier, \
                sg.angelegt_at AS angelegt_at \
         FROM fernmeldeskizze_komponente_sprechgruppe ks \
         JOIN fernmeldeskizze_komponente k ON k.id = ks.komponente_id \
         JOIN sprechgruppe sg ON sg.id = ks.sprechgruppe_id \
         WHERE k.einsatz_id = ?1 AND (?2 IS NULL OR k.id = ?2) \
         ORDER BY sg.betriebsart, sg.sortier, sg.bezeichnung",
    )
    .bind(einsatz_id)
    .bind(nur)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|k| SkizzenKomponente {
            id: k.id,
            // Ein unbekannter Wert ist wegen des CHECKs unmöglich.
            art: Komponentenart::parse(&k.art).unwrap_or(Komponentenart::Repeater),
            bezeichnung: k.bezeichnung,
            sprechgruppen: kanaele
                .iter()
                .filter(|z| z.bezug_id == k.id)
                .map(|z| z.sprechgruppe.anzeige())
                .collect(),
        })
        .collect())
}

fn bezug_aus(art: &str, id: Option<i64>) -> SkizzenBezug {
    SkizzenBezug {
        art: SkizzenBezugArt::parse(art).unwrap_or(SkizzenBezugArt::Fuehrungsstelle),
        id,
    }
}

async fn verbindungen_laden(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    nur: Option<i64>,
) -> Result<Vec<SkizzenVerbindung>, AppError> {
    let zeilen = sqlx::query_as::<_, VerbindungRoh>(
        "SELECT id, von_art, von_id, nach_art, nach_id, art, medium, status, verkehr, hinweis \
         FROM fernmeldeskizze_verbindung \
         WHERE einsatz_id = ?1 AND (?2 IS NULL OR id = ?2) ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(nur)
    .fetch_all(&mut *conn)
    .await?;
    // Unbekannte Werte sind wegen der CHECKs unmöglich; die Rückfallwerte lassen die Skizze
    // lesbar statt sie ganz scheitern zu lassen.
    Ok(zeilen
        .into_iter()
        .map(|v| SkizzenVerbindung {
            id: v.id,
            von: bezug_aus(&v.von_art, v.von_id),
            nach: bezug_aus(&v.nach_art, v.nach_id),
            art: Verbindungsart::parse(&v.art).unwrap_or(Verbindungsart::Sonstige),
            medium: Verbindungsmedium::parse(&v.medium).unwrap_or(Verbindungsmedium::Leitung),
            status: Verbindungsstatus::parse(&v.status).unwrap_or(Verbindungsstatus::Bestehend),
            verkehr: v.verkehr.as_deref().and_then(Verkehrsart::parse),
            hinweis: v.hinweis,
        })
        .collect())
}

async fn schriftfeld_laden(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Schriftfeld, AppError> {
    // LEFT JOIN vom Einsatz: ohne Zeile gelten die Vorgaben (D3). Der Herausgeber kommt, wie er
    // gespeichert ist; die Einsatzbezeichnung als Vorgabe setzt der Client (Review O1).
    let z = sqlx::query_as::<_, SchriftfeldRoh>(
        "SELECT s.herausgeber AS herausgeber, s.vs_vermerk, \
                s.gueltig_ab, s.gez_name, s.gez_at \
         FROM einsatz e LEFT JOIN fernmeldeskizze_schriftfeld s ON s.einsatz_id = e.id \
         WHERE e.id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Schriftfeld {
        herausgeber: z.herausgeber,
        vs_vermerk: z
            .vs_vermerk
            .as_deref()
            .and_then(VsVermerk::parse)
            .unwrap_or(VsVermerk::Keiner),
        gueltig_ab: z.gueltig_ab,
        gez_name: z.gez_name,
        gez_at: z.gez_at,
    })
}

// ── Lage (D4) ────────────────────────────────────────────────────────────────────────────────

/// Validierte Eingabe für `PUT …/lage/{element}`.
#[derive(Debug, Clone, PartialEq)]
pub struct LageEingabe {
    pub x: f64,
    pub y: f64,
    /// `None` = unverändert (bei neuer Zeile: keine), `Some(None)` = leeren.
    pub breite: Option<Option<f64>>,
    /// Erwartete Version; `None` = noch keine Zeile erwartet.
    pub version: Option<i64>,
}

/// Ergebnis eines Verschiebens: gespeichert oder abgewiesen mit dem gespeicherten Stand.
#[derive(Debug, Clone, PartialEq)]
pub enum LageErgebnis {
    Gesetzt(SkizzenLage),
    Konflikt(Option<SkizzenLage>),
}

async fn lage_zeile(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    schluessel: &str,
) -> Result<Option<SkizzenLage>, AppError> {
    Ok(sqlx::query_as::<_, SkizzenLage>(
        "SELECT element, x, y, breite, version FROM fernmeldeskizze_lage \
         WHERE einsatz_id = ? AND element = ?",
    )
    .bind(einsatz_id)
    .bind(schluessel)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Speichert die Lage eines Elements, nur wenn der gespeicherte Stand dem erwarteten entspricht
/// (Muster erwarteter Stand → 409, `uhs::repo`). Nichts wird still überschrieben.
pub async fn lage_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    element: Element,
    eingabe: &LageEingabe,
) -> Result<LageErgebnis, AppError> {
    let schluessel = element.schluessel();
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        pruefe_im_einsatz(conn, einsatz_id, element).await?;
        if !matches!(element, Element::Sprechgruppe(_)) && matches!(eingabe.breite, Some(Some(_))) {
            return Err(AppError::UnprocessableEntity(
                "breite gibt es nur bei Schienen (sg-…)".into(),
            ));
        }
        let aktuell = lage_zeile(conn, einsatz_id, &schluessel).await?;
        match (&aktuell, eingabe.version) {
            (None, None) => {
                sqlx::query(
                    "INSERT INTO fernmeldeskizze_lage \
                        (einsatz_id, element, x, y, breite, version, geaendert_von_id) \
                     VALUES (?, ?, ?, ?, ?, 1, ?)",
                )
                .bind(einsatz_id)
                .bind(&schluessel)
                .bind(eingabe.x)
                .bind(eingabe.y)
                .bind(eingabe.breite.flatten())
                .bind(benutzer_id)
                .execute(&mut *conn)
                .await?;
            }
            (Some(z), Some(v)) if z.version == v => {
                sqlx::query(
                    "UPDATE fernmeldeskizze_lage SET x = ?1, y = ?2, \
                        breite = CASE WHEN ?3 = 1 THEN ?4 ELSE breite END, \
                        version = version + 1, geaendert_von_id = ?5, \
                        geaendert_at = datetime('now') \
                     WHERE einsatz_id = ?6 AND element = ?7 AND version = ?8",
                )
                .bind(eingabe.x)
                .bind(eingabe.y)
                .bind(eingabe.breite.is_some())
                .bind(eingabe.breite.flatten())
                .bind(benutzer_id)
                .bind(einsatz_id)
                .bind(&schluessel)
                .bind(v)
                .execute(&mut *conn)
                .await?;
            }
            _ => return Ok(LageErgebnis::Konflikt(aktuell)),
        }
        let neu = lage_zeile(conn, einsatz_id, &schluessel)
            .await?
            .ok_or_else(|| AppError::Internal("Lage nach dem Schreiben verschwunden".into()))?;
        Ok(LageErgebnis::Gesetzt(neu))
    })
}

/// Ergebnis des Verwerfens einer einzelnen Lage.
#[derive(Debug, Clone, PartialEq)]
pub enum LageVerworfen {
    /// Die Zeile ist weg (Live-Ereignis).
    Entfernt,
    /// Es gab keine Zeile: nichts zu tun, idempotent (kein Ereignis).
    Unveraendert,
    /// Die gespeicherte Version weicht ab: nichts gelöscht.
    Konflikt(SkizzenLage),
}

/// Verwirft die Lage EINES Elements, nur wenn der gespeicherte Stand dem erwarteten entspricht
/// (Review O3: Rückgängig nach dem ersten Verschieben eines auto-gelegten Elements; danach stellt
/// es wieder das Auto-Layout). Ohne Zeile idempotent; das Element selbst wird nicht geprüft, es
/// kann inzwischen gelöscht sein und hat dann ohnehin keine Zeile (`vergiss`).
pub async fn lage_entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    element: Element,
    version: i64,
) -> Result<LageVerworfen, AppError> {
    let schluessel = element.schluessel();
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let Some(aktuell) = lage_zeile(conn, einsatz_id, &schluessel).await? else {
            return Ok(LageVerworfen::Unveraendert);
        };
        if aktuell.version != version {
            return Ok(LageVerworfen::Konflikt(aktuell));
        }
        sqlx::query(
            "DELETE FROM fernmeldeskizze_lage WHERE einsatz_id = ? AND element = ? AND version = ?",
        )
        .bind(einsatz_id)
        .bind(&schluessel)
        .bind(version)
        .execute(&mut *conn)
        .await?;
        Ok(LageVerworfen::Entfernt)
    })
}

/// „Neu anordnen“: verwirft alle Lagen des Einsatzes. `true`, wenn es welche gab.
pub async fn lage_verwerfen(pool: &SqlitePool, einsatz_id: i64) -> Result<bool, AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let r = sqlx::query("DELETE FROM fernmeldeskizze_lage WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
        Ok(r.rows_affected() > 0)
    })
}

// ── Schriftfeld ──────────────────────────────────────────────────────────────────────────────

/// Validierte Teiländerung des Schriftfelds: äußeres `None` = unverändert, `Some(None)` = leeren.
/// Zeiten sind schon normalisiert (Route).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SchriftfeldPatch {
    pub herausgeber: Option<Option<String>>,
    pub vs_vermerk: Option<VsVermerk>,
    pub gueltig_ab: Option<Option<String>>,
    pub gez_name: Option<Option<String>>,
    pub gez_at: Option<Option<String>>,
}

pub async fn schriftfeld_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    patch: &SchriftfeldPatch,
) -> Result<Schriftfeld, AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        sqlx::query(
            "INSERT OR IGNORE INTO fernmeldeskizze_schriftfeld (einsatz_id, geaendert_von_id) \
             VALUES (?, ?)",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "UPDATE fernmeldeskizze_schriftfeld SET \
                herausgeber = CASE WHEN ?1 = 1 THEN ?2 ELSE herausgeber END, \
                vs_vermerk = COALESCE(?3, vs_vermerk), \
                gueltig_ab = CASE WHEN ?4 = 1 THEN ?5 ELSE gueltig_ab END, \
                gez_name = CASE WHEN ?6 = 1 THEN ?7 ELSE gez_name END, \
                gez_at = CASE WHEN ?8 = 1 THEN ?9 ELSE gez_at END, \
                geaendert_von_id = ?10, geaendert_at = datetime('now') \
             WHERE einsatz_id = ?11",
        )
        .bind(patch.herausgeber.is_some())
        .bind(patch.herausgeber.clone().flatten())
        .bind(patch.vs_vermerk.map(|v| v.as_str()))
        .bind(patch.gueltig_ab.is_some())
        .bind(patch.gueltig_ab.clone().flatten())
        .bind(patch.gez_name.is_some())
        .bind(patch.gez_name.clone().flatten())
        .bind(patch.gez_at.is_some())
        .bind(patch.gez_at.clone().flatten())
        .bind(benutzer_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
        schriftfeld_laden(conn, einsatz_id).await
    })
}

// ── Komponenten ──────────────────────────────────────────────────────────────────────────────

async fn komponente_im_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    komponente_id: i64,
) -> Result<SkizzenKomponente, AppError> {
    komponenten_laden(conn, einsatz_id, Some(komponente_id))
        .await?
        .into_iter()
        .next()
        .ok_or(AppError::NotFound)
}

pub async fn komponente_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    art: Komponentenart,
    bezeichnung: Option<&str>,
) -> Result<SkizzenKomponente, AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO fernmeldeskizze_komponente \
                (einsatz_id, art, bezeichnung, geaendert_von_id) \
             VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(art.as_str())
        .bind(bezeichnung)
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
        komponente_im_einsatz(conn, einsatz_id, id).await
    })
}

/// Teiländerung einer Komponente; `bezeichnung: Some(None)` leert.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct KomponentePatch {
    pub art: Option<Komponentenart>,
    pub bezeichnung: Option<Option<String>>,
}

pub async fn komponente_aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    komponente_id: i64,
    benutzer_id: i64,
    patch: &KomponentePatch,
) -> Result<SkizzenKomponente, AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let r = sqlx::query(
            "UPDATE fernmeldeskizze_komponente SET \
                art = COALESCE(?1, art), \
                bezeichnung = CASE WHEN ?2 = 1 THEN ?3 ELSE bezeichnung END, \
                geaendert_von_id = ?4, geaendert_at = datetime('now') \
             WHERE id = ?5 AND einsatz_id = ?6",
        )
        .bind(patch.art.map(|a| a.as_str()))
        .bind(patch.bezeichnung.is_some())
        .bind(patch.bezeichnung.clone().flatten())
        .bind(benutzer_id)
        .bind(komponente_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
        if r.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        komponente_im_einsatz(conn, einsatz_id, komponente_id).await
    })
}

/// Entfernt eine Komponente samt Kanälen (CASCADE), Lage und Verbindungen ([`vergiss`]).
pub async fn komponente_entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    komponente_id: i64,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        komponente_im_einsatz(conn, einsatz_id, komponente_id).await?;
        vergiss(conn, einsatz_id, Element::Komponente(komponente_id)).await?;
        sqlx::query("DELETE FROM fernmeldeskizze_komponente WHERE id = ? AND einsatz_id = ?")
            .bind(komponente_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
}

/// Bindet eine Sprechgruppe an die Komponente, idempotent. Erst die Komponente (404), dann die
/// Sprechgruppe wie an Abschnitt und Einheit (`sprechgruppe::repo::pruefe_zuordenbar`, 422).
/// `true`, wenn die Bindung neu ist.
pub async fn komponente_kanal_setzen(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    komponente_id: i64,
    sprechgruppe_id: i64,
) -> Result<bool, AppError> {
    komponente_im_einsatz(&mut *pool.acquire().await?, einsatz_id, komponente_id).await?;
    crate::sprechgruppe::repo::pruefe_zuordenbar(pool, org_id, einsatz_id, &[sprechgruppe_id])
        .await?;
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        komponente_im_einsatz(conn, einsatz_id, komponente_id).await?;
        let r = sqlx::query(
            "INSERT OR IGNORE INTO fernmeldeskizze_komponente_sprechgruppe \
                (komponente_id, sprechgruppe_id) VALUES (?, ?)",
        )
        .bind(komponente_id)
        .bind(sprechgruppe_id)
        .execute(&mut *conn)
        .await?;
        Ok(r.rows_affected() > 0)
    })
}

/// Löst eine Sprechgruppe von der Komponente, idempotent. `true`, wenn es die Bindung gab.
pub async fn komponente_kanal_loesen(
    pool: &SqlitePool,
    einsatz_id: i64,
    komponente_id: i64,
    sprechgruppe_id: i64,
) -> Result<bool, AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        komponente_im_einsatz(conn, einsatz_id, komponente_id).await?;
        let r = sqlx::query(
            "DELETE FROM fernmeldeskizze_komponente_sprechgruppe \
             WHERE komponente_id = ? AND sprechgruppe_id = ?",
        )
        .bind(komponente_id)
        .bind(sprechgruppe_id)
        .execute(&mut *conn)
        .await?;
        Ok(r.rows_affected() > 0)
    })
}

// ── Verbindungen ─────────────────────────────────────────────────────────────────────────────

/// Validierte Eingabe einer neuen Verbindung (Felder geprüft in der Route).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerbindungEingabe {
    pub von: Element,
    pub nach: Element,
    pub art: Verbindungsart,
    pub medium: Verbindungsmedium,
    pub status: Verbindungsstatus,
    pub verkehr: Option<Verkehrsart>,
    pub hinweis: Option<String>,
}

/// Legt eine Verbindung an. `von == nach` und ein Bezug außerhalb des Einsatzes sind 422.
pub async fn verbindung_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &VerbindungEingabe,
) -> Result<SkizzenVerbindung, AppError> {
    let (Some(von), Some(nach)) = (eingabe.von.bezug(), eingabe.nach.bezug()) else {
        return Err(AppError::UnprocessableEntity(
            "Eine Schiene ist kein Endpunkt einer Verbindung".into(),
        ));
    };
    if eingabe.von == eingabe.nach {
        return Err(AppError::UnprocessableEntity(
            "Eine Verbindung braucht zwei verschiedene Endpunkte".into(),
        ));
    }
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        pruefe_im_einsatz(conn, einsatz_id, eingabe.von).await?;
        pruefe_im_einsatz(conn, einsatz_id, eingabe.nach).await?;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO fernmeldeskizze_verbindung \
                (einsatz_id, von_art, von_id, nach_art, nach_id, art, medium, status, verkehr, \
                 hinweis, geaendert_von_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(von.art.as_str())
        .bind(von.id)
        .bind(nach.art.as_str())
        .bind(nach.id)
        .bind(eingabe.art.as_str())
        .bind(eingabe.medium.as_str())
        .bind(eingabe.status.as_str())
        .bind(eingabe.verkehr.map(|v| v.as_str()))
        .bind(eingabe.hinweis.as_deref())
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
        verbindung_im_einsatz(conn, einsatz_id, id).await
    })
}

async fn verbindung_im_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    verbindung_id: i64,
) -> Result<SkizzenVerbindung, AppError> {
    verbindungen_laden(conn, einsatz_id, Some(verbindung_id))
        .await?
        .into_iter()
        .next()
        .ok_or(AppError::NotFound)
}

/// Teiländerung einer Verbindung ohne Endpunkte; `Some(None)` leert `verkehr` bzw. `hinweis`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VerbindungPatch {
    pub art: Option<Verbindungsart>,
    pub medium: Option<Verbindungsmedium>,
    pub status: Option<Verbindungsstatus>,
    pub verkehr: Option<Option<Verkehrsart>>,
    pub hinweis: Option<Option<String>>,
}

pub async fn verbindung_aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    verbindung_id: i64,
    benutzer_id: i64,
    patch: &VerbindungPatch,
) -> Result<SkizzenVerbindung, AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let r = sqlx::query(
            "UPDATE fernmeldeskizze_verbindung SET \
                art = COALESCE(?1, art), \
                medium = COALESCE(?2, medium), \
                status = COALESCE(?3, status), \
                verkehr = CASE WHEN ?4 = 1 THEN ?5 ELSE verkehr END, \
                hinweis = CASE WHEN ?6 = 1 THEN ?7 ELSE hinweis END, \
                geaendert_von_id = ?8, geaendert_at = datetime('now') \
             WHERE id = ?9 AND einsatz_id = ?10",
        )
        .bind(patch.art.map(|a| a.as_str()))
        .bind(patch.medium.map(|m| m.as_str()))
        .bind(patch.status.map(|s| s.as_str()))
        .bind(patch.verkehr.is_some())
        .bind(patch.verkehr.flatten().map(|v| v.as_str()))
        .bind(patch.hinweis.is_some())
        .bind(patch.hinweis.clone().flatten())
        .bind(benutzer_id)
        .bind(verbindung_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
        if r.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        verbindung_im_einsatz(conn, einsatz_id, verbindung_id).await
    })
}

pub async fn verbindung_entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    verbindung_id: i64,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let r =
            sqlx::query("DELETE FROM fernmeldeskizze_verbindung WHERE id = ? AND einsatz_id = ?")
                .bind(verbindung_id)
                .bind(einsatz_id)
                .execute(&mut *conn)
                .await?;
        if r.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    })
}

// ── Bereiche ─────────────────────────────────────────────────────────────────────────────────

/// Validierte Eingabe eines neuen Bereichs.
#[derive(Debug, Clone, PartialEq)]
pub struct BereichEingabe {
    pub bezeichnung: String,
    pub x: f64,
    pub y: f64,
    pub breite: f64,
    pub hoehe: f64,
}

async fn bereich_zeile(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bereich_id: i64,
) -> Result<SkizzenBereich, AppError> {
    sqlx::query_as::<_, SkizzenBereich>(sqlx::AssertSqlSafe(format!(
        "SELECT {BEREICH_SPALTEN} FROM fernmeldeskizze_bereich WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(bereich_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

pub async fn bereich_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &BereichEingabe,
) -> Result<SkizzenBereich, AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO fernmeldeskizze_bereich \
                (einsatz_id, bezeichnung, x, y, breite, hoehe, geaendert_von_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(&eingabe.bezeichnung)
        .bind(eingabe.x)
        .bind(eingabe.y)
        .bind(eingabe.breite)
        .bind(eingabe.hoehe)
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
        bereich_zeile(conn, einsatz_id, id).await
    })
}

/// Teiländerung eines Bereichs mit erwarteter Version.
#[derive(Debug, Clone, PartialEq)]
pub struct BereichPatch {
    pub bezeichnung: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub breite: Option<f64>,
    pub hoehe: Option<f64>,
    pub version: i64,
}

/// Ergebnis einer Bereichsänderung: gespeichert oder abgewiesen mit dem gespeicherten Stand.
#[derive(Debug, Clone, PartialEq)]
pub enum BereichErgebnis {
    Geaendert(SkizzenBereich),
    Konflikt(SkizzenBereich),
}

pub async fn bereich_aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    bereich_id: i64,
    benutzer_id: i64,
    patch: &BereichPatch,
) -> Result<BereichErgebnis, AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let aktuell = bereich_zeile(conn, einsatz_id, bereich_id).await?;
        if aktuell.version != patch.version {
            return Ok(BereichErgebnis::Konflikt(aktuell));
        }
        sqlx::query(
            "UPDATE fernmeldeskizze_bereich SET \
                bezeichnung = COALESCE(?1, bezeichnung), x = COALESCE(?2, x), \
                y = COALESCE(?3, y), breite = COALESCE(?4, breite), hoehe = COALESCE(?5, hoehe), \
                version = version + 1, geaendert_von_id = ?6, geaendert_at = datetime('now') \
             WHERE id = ?7 AND einsatz_id = ?8 AND version = ?9",
        )
        .bind(patch.bezeichnung.as_deref())
        .bind(patch.x)
        .bind(patch.y)
        .bind(patch.breite)
        .bind(patch.hoehe)
        .bind(benutzer_id)
        .bind(bereich_id)
        .bind(einsatz_id)
        .bind(patch.version)
        .execute(&mut *conn)
        .await?;
        Ok(BereichErgebnis::Geaendert(
            bereich_zeile(conn, einsatz_id, bereich_id).await?,
        ))
    })
}

pub async fn bereich_entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    bereich_id: i64,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let r = sqlx::query("DELETE FROM fernmeldeskizze_bereich WHERE id = ? AND einsatz_id = ?")
            .bind(bereich_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
        if r.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn element_schluessel_rundreise() {
        for e in [
            Element::Fuehrungsstelle,
            Element::Abschnitt(1),
            Element::Einheit(12),
            Element::Stelle(3),
            Element::Komponente(40),
            Element::Sprechgruppe(7),
        ] {
            assert_eq!(Element::parse(&e.schluessel()), Some(e), "{e:?}");
        }
        for falsch in [
            "",
            "fs-1",
            "FS",
            "ab",
            "ab-",
            "ab-0",
            "ab-01",
            "ab--1",
            "ab-+1",
            "ab-1x",
            "xx-1",
            "EH-1",
            "eh-99999999999999999999",
        ] {
            assert_eq!(Element::parse(falsch), None, "{falsch}");
        }
    }

    #[test]
    fn bezug_kombinationen() {
        use axum::http::StatusCode;
        assert_eq!(
            Element::aus_bezug(SkizzenBezugArt::Fuehrungsstelle, None).unwrap(),
            Element::Fuehrungsstelle
        );
        for (art, id) in [
            (SkizzenBezugArt::Fuehrungsstelle, Some(1)),
            (SkizzenBezugArt::Abschnitt, None),
            (SkizzenBezugArt::Komponente, None),
        ] {
            assert_eq!(
                Element::aus_bezug(art, id).unwrap_err().status(),
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        assert_eq!(
            Element::Sprechgruppe(1).bezug(),
            None,
            "Schiene ist kein Endpunkt"
        );
    }

    /// Ein Ausschnitt aus einer Funktion: von `fn {name}(` bis zur nächsten Funktion auf
    /// oberster Ebene bzw. dem Testmodul.
    fn funktionsrumpf<'a>(quelle: &'a str, name: &str) -> Option<&'a str> {
        let start = quelle.find(&format!("fn {name}("))?;
        let rest = &quelle[start..];
        let ende = [
            "\npub async fn ",
            "\nasync fn ",
            "\npub fn ",
            "\nfn ",
            "\n#[cfg(test)]",
        ]
        .iter()
        .filter_map(|m| rest[1..].find(m).map(|i| i + 1))
        .min()
        .unwrap_or(rest.len());
        Some(&rest[..ende])
    }

    /// Guard (D3): Jede Stelle, die einen Abschnitt, eine Einheit, eine Kommunikationsstelle
    /// oder eine Komponente löscht, ist hier gelistet und ruft im selben Funktionsrumpf (also im
    /// selben Transaktionsschritt) [`vergiss`]. Ein neuer Löschpfad ohne Eintrag macht den Test
    /// rot; das Löschen ganzer Einsätze erledigt `ON DELETE CASCADE` (`einsatz_id`).
    #[test]
    fn jeder_loeschpfad_vergisst_die_skizzenbezuege() {
        const LOESCHPFADE: &[(&str, &str, &str)] = &[
            (
                "einsatzabschnitt",
                "src/einsatzabschnitt/repo.rs",
                "loese_auf_tx",
            ),
            ("einsatz_einheit", "src/einheit/repo.rs", "loese_auf_tx"),
            (
                "einsatz_kommunikation_stelle",
                "src/stab/kommunikation.rs",
                "stelle_entfernen",
            ),
            (
                "fernmeldeskizze_komponente",
                "src/stab/fernmeldeskizze.rs",
                "komponente_entfernen",
            ),
        ];
        let wurzel = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        // 1. Jeder gelistete Pfad räumt ab.
        for (tabelle, datei, funktion) in LOESCHPFADE {
            let quelle = std::fs::read_to_string(wurzel.join(datei)).unwrap();
            let rumpf = funktionsrumpf(&quelle, funktion)
                .unwrap_or_else(|| panic!("{datei}: fn {funktion} fehlt"));
            assert!(
                rumpf.contains(&format!("DELETE FROM {tabelle} ")),
                "{datei}::{funktion} löscht nicht (mehr) aus {tabelle} — Liste nachziehen"
            );
            assert!(
                rumpf.contains("vergiss("),
                "{datei}::{funktion} löscht aus {tabelle}, ruft aber nicht \
                 stab::fernmeldeskizze::vergiss im selben Transaktionsschritt"
            );
        }
        // 2. Es gibt keinen weiteren Löschpfad im Produktivcode.
        let mut funde = Vec::new();
        sammle(&wurzel.join("src"), &mut funde);
        for (pfad, quelle) in funde {
            let produktiv = quelle.split("#[cfg(test)]").next().unwrap_or("");
            for (tabelle, _, _) in LOESCHPFADE {
                let muster = format!("DELETE FROM {tabelle} ");
                let anzahl = produktiv.matches(&muster).count();
                let gelistet = LOESCHPFADE
                    .iter()
                    .filter(|(t, d, _)| t == tabelle && pfad.ends_with(d))
                    .count();
                assert!(
                    anzahl <= gelistet,
                    "{pfad} löscht aus {tabelle} an {anzahl} Stelle(n), gelistet sind \
                     {gelistet}: neuen Löschpfad mit vergiss() versehen und hier eintragen"
                );
            }
        }
    }

    fn sammle(dir: &std::path::Path, funde: &mut Vec<(String, String)>) {
        for eintrag in std::fs::read_dir(dir).unwrap() {
            let pfad = eintrag.unwrap().path();
            if pfad.is_dir() {
                sammle(&pfad, funde);
            } else if pfad.extension().is_some_and(|e| e == "rs")
                && pfad.file_name().is_some_and(|n| n != "tests.rs")
            {
                let text = std::fs::read_to_string(&pfad).unwrap();
                funde.push((pfad.to_string_lossy().replace('\\', "/"), text));
            }
        }
    }
}
