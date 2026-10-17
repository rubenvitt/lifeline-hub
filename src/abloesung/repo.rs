//! Persistenz der Ablösung (LFH-635).
//!
//! **Alles, was eine Ablösung verändert, läuft in EINER `write_retry!`-Transaktion**: Schicht,
//! Auto-Fristen des Erinnerungs-Schedulers, Folgeschicht und ETB-Eintrag. Ein 422 mitten im
//! Ablauf lässt deshalb nichts zurück (Spec: „Vollzug mit Folgeschicht", Atomarität).
//!
//! Die Fristen hängen polymorph an der Schicht (`bezug_typ` `abloesung` /
//! `abloesung_vorwarnung`, `bezug_id` = Schicht-ID) — ohne FK, wie alle Auto-Fristen.

use chrono_tz::Tz;
use sqlx::{SqliteConnection, SqlitePool};

use std::collections::{HashMap, HashSet};

use super::{
    einstufung, faelligkeit, rhythmus_text, vererbung, vorwarnzeit, AbloesungAbloeser,
    AbloesungAnzeige, AbloesungEinsatzVorgabeAnzeige, AbloesungErbe, AbloesungFolge,
    AbloesungStatus, AbloesungVollzugAnzeige, AbloesungVorgabeAnzeige, BeendetGrund,
    RhythmusQuelle, VORWARNUNG_VORGABE_MINUTEN,
};
use crate::einsatz::einstellungen::etb_startwert;
use crate::erinnerung::repo as erinnerung_repo;
use crate::error::AppError;
use crate::etb::repo::EintragDaten;
use crate::etb::{TYP_BERICHTIGUNG, TYP_ENTSCHEIDUNG, TYP_MELDUNG};
use crate::kommunikation::{OBJEKT_ABLOESUNG, OBJEKT_ABLOESUNG_VORWARNUNG};
use crate::schichtmodell::repo as schichtmodell_repo;
use crate::schichtmodell::{Regel, Werte};
use crate::write_retry;
use crate::zeitachse::repo::Beruehrt;

/// Was Vollzug oder Rücknahme außerhalb der Ablösung geändert haben; die Route meldet danach
/// `einheit` und `personal` (LLH-1189).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Wirkung {
    /// Je Einheit mit geschriebenem bzw. gestrichenem Ereignis `abloesung` (die abgelöste und
    /// ihre erbenden Untereinheiten, LLH-1132) die per Fan-out berührten Personen.
    pub zeitachse: Vec<(i64, Beruehrt)>,
    /// Einheiten, deren Abschnitt die Übergabe oder ihre Rücknahme geändert hat.
    pub einheiten: Vec<i64>,
}

/// Eingabe „Schicht beginnen" — von der Route validiert (Zeit normalisiert, Rhythmus im
/// Wertebereich).
#[derive(Debug, Clone)]
pub struct BeginnEingabe {
    pub einheit_id: i64,
    /// `None` = das Eintreffen der offenen Einsatzperiode der Einheit (Kräfte-Zeitachse,
    /// LFH-552), ohne ein solches der Zeitpunkt der Anlage.
    pub beginn_at: Option<String>,
    /// `None` = Vorgabe übernehmen: die des Abschnitts, sonst die des Einsatzes.
    pub rhythmus_minuten: Option<i64>,
}

/// Eingabe „Schicht ändern" — jedes Feld tri-state: fehlt = unverändert.
#[derive(Debug, Clone, Default)]
pub struct AenderungEingabe {
    pub beginn_at: Option<String>,
    /// `Some(None)` = zurück zur Vorgabe: der des Abschnitts, sonst der des Einsatzes.
    pub rhythmus_minuten: Option<Option<i64>>,
    /// Die geplanten Ablöser in ihrer Reihenfolge, von der Route begrenzt und entdoppelt;
    /// `Some(vec![])` = Planung aufheben.
    pub abloeser: Option<Vec<i64>>,
}

/// Eingabe „Vollzug" (LLH-1132) — von der Route validiert (Zeit normalisiert, Liste begrenzt
/// und entdoppelt).
#[derive(Debug, Clone, Default)]
pub struct VollzugEingabe {
    pub vollzogen_at: String,
    /// Die Ablöser in ihrer Reihenfolge; leer = ohne ablösende Einheit.
    pub abloeser: Vec<i64>,
    /// Den Abschnitt der abgelösten Einheit an die Ablöser übergeben, die den Knoten bilden.
    pub abschnitt_uebergeben: bool,
}

/// Eine Zeile, wie sie die Anzeige-Projektion liefert.
#[derive(sqlx::FromRow)]
struct Zeile {
    id: i64,
    einsatz_id: i64,
    einheit_id: i64,
    einheit_name: String,
    abschnitt_id: Option<i64>,
    abschnitt_name: Option<String>,
    beginn_at: String,
    rhythmus_minuten: i64,
    #[sqlx(try_from = "String")]
    rhythmus_quelle: RhythmusQuelle,
    faellig_at: String,
    vorwarnung_minuten: i64,
    abloesende_einheit_id: Option<i64>,
    abloesende_einheit_name: Option<String>,
    #[sqlx(try_from = "String")]
    status: AbloesungStatus,
    vollzogen_at: Option<String>,
    vollzogen_von_id: Option<i64>,
    vorgaenger_id: Option<i64>,
    folgeschicht_id: Option<i64>,
    folgen_unberuehrt: bool,
    einheit_laeuft_anderswo: i64,
    beendet_at: Option<String>,
    beendet_von_id: Option<i64>,
    beendet_grund: Option<String>,
    uebernommen_bei_vollzug: bool,
    abschnitt_uebergeben: bool,
    uebergebener_abschnitt_name: Option<String>,
    angelegt_at: String,
}

impl Zeile {
    fn anzeige(self, jetzt: &str) -> AbloesungAnzeige {
        let einstufung = match self.status {
            AbloesungStatus::Laufend => {
                Some(einstufung(&self.faellig_at, jetzt, self.vorwarnung_minuten))
            }
            AbloesungStatus::Abgeloest | AbloesungStatus::Beendet => None,
        };
        let ruecknehmbar = self.status == AbloesungStatus::Abgeloest
            && self.folgen_unberuehrt
            && self.einheit_laeuft_anderswo == 0;
        AbloesungAnzeige {
            id: self.id,
            einsatz_id: self.einsatz_id,
            einheit_id: self.einheit_id,
            einheit_name: self.einheit_name,
            abschnitt_id: self.abschnitt_id,
            abschnitt_name: self.abschnitt_name,
            beginn_at: self.beginn_at,
            rhythmus_minuten: self.rhythmus_minuten,
            rhythmus_quelle: self.rhythmus_quelle,
            faellig_at: self.faellig_at,
            vorwarnung_minuten: self.vorwarnung_minuten,
            abloesende_einheit_id: self.abloesende_einheit_id,
            abloesende_einheit_name: self.abloesende_einheit_name,
            abloeser: Vec::new(),
            status: self.status,
            einstufung,
            vollzogen_at: self.vollzogen_at,
            vollzogen_von_id: self.vollzogen_von_id,
            vorgaenger_id: self.vorgaenger_id,
            folgeschicht_id: self.folgeschicht_id,
            folgeschichten: Vec::new(),
            uebernommen_bei_vollzug: self.uebernommen_bei_vollzug,
            abschnitt_uebergeben: self.abschnitt_uebergeben,
            uebergebener_abschnitt_name: self.uebergebener_abschnitt_name,
            ruecknehmbar,
            beendet_at: self.beendet_at,
            beendet_von_id: self.beendet_von_id,
            beendet_grund: self.beendet_grund.as_deref().and_then(BeendetGrund::parse),
            erbende_einheiten: Vec::new(),
            angelegt_at: self.angelegt_at,
        }
    }
}

/// Anzeige-Projektion. Die Folgeschicht ist die jüngste Schicht mit `vorgaenger_id` = diese
/// (`MAX(id)` über `idx_abloesung_vorgaenger`, Migration 0153); unberührt ist der Vollzug, wenn
/// keine seiner Folgeschichten (LLH-1132: je Ablöser eine) aufgehört hat zu laufen — dieselbe
/// Index-Suche. Ohne den Index war jede Unterabfrage ein Scan über die Ablösungen aller Einsätze
/// (LFH-933); `liste_plan_ohne_scan` hält das fest. Ablöser und Folgeschichten hängt
/// [`attach_listen`] an.
/// Die Vorwarnung kommt aus der Kopie des Schichtmodells am Einsatz (LLH-1122), ohne sie 30 min
/// ([`VORWARNUNG_VORGABE_MINUTEN`], im SQL als Literal; `vorwarnung_vorgabe_im_sql` hält beide
/// gleich).
const ANZEIGE_SELECT: &str = "SELECT a.id, a.einsatz_id, a.einheit_id, e.name AS einheit_name, \
            a.abschnitt_id, s.name AS abschnitt_name, a.beginn_at, a.rhythmus_minuten, \
            a.rhythmus_quelle, a.faellig_at, \
            COALESCE(m.vorwarnung_minuten, 30) AS vorwarnung_minuten, a.abloesende_einheit_id, \
            ae.name AS abloesende_einheit_name, a.status, a.vollzogen_at, a.vollzogen_von_id, \
            a.vorgaenger_id, \
            (SELECT MAX(fv.id) FROM einsatz_abloesung fv WHERE fv.vorgaenger_id = a.id) \
               AS folgeschicht_id, \
            NOT EXISTS (SELECT 1 FROM einsatz_abloesung fu WHERE fu.vorgaenger_id = a.id \
               AND fu.status <> 'laufend') AS folgen_unberuehrt, \
            EXISTS (SELECT 1 FROM einsatz_abloesung o WHERE o.einheit_id = a.einheit_id \
               AND o.status = 'laufend' AND o.id <> a.id) AS einheit_laeuft_anderswo, \
            a.beendet_at, a.beendet_von_id, a.beendet_grund, a.uebernommen_bei_vollzug, \
            a.abschnitt_uebergeben, ua.name AS uebergebener_abschnitt_name, a.angelegt_at \
     FROM einsatz_abloesung a \
     JOIN einsatz_einheit e ON e.id = a.einheit_id \
     LEFT JOIN einsatzabschnitt s ON s.id = a.abschnitt_id \
     LEFT JOIN einsatz_einheit ae ON ae.id = a.abloesende_einheit_id \
     LEFT JOIN einsatz_schichtmodell m ON m.einsatz_id = a.einsatz_id \
     LEFT JOIN einsatzabschnitt ua ON ua.id = a.abgeloest_abschnitt_vorher_id \
               AND a.abschnitt_uebergeben = 1";

/// Laufende nach Fälligkeit (die dringendste zuerst), abgelöste nach Vollzug und beendete
/// nach ihrem Ende, beide absteigend. Laufende tragen ihre erbenden Untereinheiten.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<AbloesungStatus>,
    jetzt: &str,
) -> Result<Vec<AbloesungAnzeige>, AppError> {
    let zeilen = sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(liste_sql(status)))
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
    let mut liste: Vec<AbloesungAnzeige> = zeilen.into_iter().map(|z| z.anzeige(jetzt)).collect();
    attach_erben(pool, einsatz_id, &mut liste).await?;
    attach_listen(pool, einsatz_id, &mut liste).await?;
    Ok(liste)
}

/// Hängt an jede Schicht ihre Ablöser (Reihenfolge der Planung) und ihre Folgeschichten (nach
/// ID). Je eine Abfrage für den ganzen Einsatz, unabhängig von der Zahl der Schichten.
async fn attach_listen(
    pool: &SqlitePool,
    einsatz_id: i64,
    liste: &mut [AbloesungAnzeige],
) -> Result<(), AppError> {
    if liste.is_empty() {
        return Ok(());
    }
    let abloeser: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT l.abloesung_id, l.einheit_id, e.name FROM einsatz_abloesung_abloeser l \
         JOIN einsatz_abloesung a ON a.id = l.abloesung_id \
         JOIN einsatz_einheit e ON e.id = l.einheit_id \
         WHERE a.einsatz_id = ? ORDER BY l.abloesung_id, l.rowid",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut je_schicht: HashMap<i64, Vec<AbloesungAbloeser>> = HashMap::new();
    for (abloesung_id, einheit_id, einheit_name) in abloeser {
        je_schicht
            .entry(abloesung_id)
            .or_default()
            .push(AbloesungAbloeser {
                einheit_id,
                einheit_name,
            });
    }
    #[derive(sqlx::FromRow)]
    struct Folge {
        vorgaenger_id: i64,
        id: i64,
        einheit_id: i64,
        einheit_name: String,
        #[sqlx(try_from = "String")]
        status: AbloesungStatus,
        uebernommen: bool,
    }
    let folgen: Vec<Folge> = sqlx::query_as(
        "SELECT f.vorgaenger_id, f.id, f.einheit_id, e.name AS einheit_name, f.status, \
                f.uebernommen_bei_vollzug AS uebernommen \
         FROM einsatz_abloesung f JOIN einsatz_einheit e ON e.id = f.einheit_id \
         WHERE f.einsatz_id = ? AND f.vorgaenger_id IS NOT NULL ORDER BY f.id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut je_vorgaenger: HashMap<i64, Vec<AbloesungFolge>> = HashMap::new();
    for f in folgen {
        je_vorgaenger
            .entry(f.vorgaenger_id)
            .or_default()
            .push(AbloesungFolge {
                id: f.id,
                einheit_id: f.einheit_id,
                einheit_name: f.einheit_name,
                status: f.status,
                uebernommen: f.uebernommen,
            });
    }
    for a in liste.iter_mut() {
        a.abloeser = je_schicht.remove(&a.id).unwrap_or_default();
        a.folgeschichten = je_vorgaenger.remove(&a.id).unwrap_or_default();
    }
    Ok(())
}

/// Die Gliederung eines Einsatzes für die Knoten-Vererbung: je aktive Einheit ihre
/// übergeordnete und ihr Name, dazu die Einheiten mit eigener laufender Schicht. Aufgelöste
/// fehlen (ihre Kinder hängt das Auflösen um, `einheit::repo::aufloesen_tx`).
struct Gliederung {
    ueber: HashMap<i64, Option<i64>>,
    namen: HashMap<i64, String>,
    mit_schicht: HashSet<i64>,
}

async fn load_gliederung(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
) -> Result<Gliederung, AppError> {
    let zeilen: Vec<(i64, Option<i64>, String, bool)> = sqlx::query_as(
        "SELECT e.id, e.ueber_einheit_id, e.name, \
                EXISTS (SELECT 1 FROM einsatz_abloesung a \
                        WHERE a.einheit_id = e.id AND a.status = 'laufend') \
         FROM einsatz_einheit e WHERE e.einsatz_id = ? AND e.aufgeloest_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_all(executor)
    .await?;
    let mut g = Gliederung {
        ueber: HashMap::new(),
        namen: HashMap::new(),
        mit_schicht: HashSet::new(),
    };
    for (id, ueber, name, hat) in zeilen {
        g.ueber.insert(id, ueber);
        g.namen.insert(id, name);
        if hat {
            g.mit_schicht.insert(id);
        }
    }
    Ok(g)
}

/// Hängt an jede laufende Schicht die Untereinheiten, die sie erben (nach Name, dann ID).
async fn attach_erben(
    pool: &SqlitePool,
    einsatz_id: i64,
    liste: &mut [AbloesungAnzeige],
) -> Result<(), AppError> {
    if !liste.iter().any(|a| a.status == AbloesungStatus::Laufend) {
        return Ok(());
    }
    let g = load_gliederung(pool, einsatz_id).await?;
    let mut je_traeger: HashMap<i64, Vec<AbloesungErbe>> = HashMap::new();
    for (erbe, traeger) in vererbung(&g.ueber, &g.mit_schicht) {
        je_traeger.entry(traeger).or_default().push(AbloesungErbe {
            einheit_id: erbe,
            einheit_name: g.namen.get(&erbe).cloned().unwrap_or_default(),
        });
    }
    for a in liste
        .iter_mut()
        .filter(|a| a.status == AbloesungStatus::Laufend)
    {
        if let Some(mut erben) = je_traeger.remove(&a.einheit_id) {
            erben.sort_by(|x, y| {
                x.einheit_name
                    .cmp(&y.einheit_name)
                    .then(x.einheit_id.cmp(&y.einheit_id))
            });
            a.erbende_einheiten = erben;
        }
    }
    Ok(())
}

/// Die Einheit, deren laufende Schicht für `einheit_id` gilt: sie selbst, sonst ihr nächster
/// Vorfahr mit laufender Schicht (Knoten-Modell). `None` ohne eine.
pub(crate) async fn load_wirksamen_traeger_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<Option<i64>, AppError> {
    let g = load_gliederung(&mut *conn, einsatz_id).await?;
    if g.mit_schicht.contains(&einheit_id) {
        return Ok(Some(einheit_id));
    }
    Ok(vererbung(&g.ueber, &g.mit_schicht)
        .get(&einheit_id)
        .copied())
}

/// SQL der Liste je Statusfilter; ein Platzhalter (`einsatz_id`).
fn liste_sql(status: Option<AbloesungStatus>) -> String {
    match status {
        Some(AbloesungStatus::Laufend) => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.status = 'laufend' \
             ORDER BY a.faellig_at, a.id"
        ),
        Some(AbloesungStatus::Abgeloest) => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.status = 'abgeloest' \
             ORDER BY a.vollzogen_at DESC, a.id DESC"
        ),
        Some(AbloesungStatus::Beendet) => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.status = 'beendet' \
             ORDER BY a.beendet_at DESC, a.id DESC"
        ),
        // Laufende zuerst: eine beendete Schicht steht nie zwischen laufenden.
        None => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? \
             ORDER BY a.status <> 'laufend', a.faellig_at, a.id"
        ),
    }
}

/// Lädt eine Schicht. `NotFound`, wenn sie nicht zum Einsatz gehört.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    jetzt: &str,
) -> Result<AbloesungAnzeige, AppError> {
    let a = sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.id = ?"
    )))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .map(|z| z.anzeige(jetzt))
    .ok_or(AppError::NotFound)?;
    let mut eine = [a];
    attach_erben(pool, einsatz_id, &mut eine).await?;
    attach_listen(pool, einsatz_id, &mut eine).await?;
    let [a] = eine;
    Ok(a)
}

/// Rhythmus-Vorgaben aller Abschnitte eines Einsatzes, in Abschnitts-Reihenfolge.
pub async fn vorgaben(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<AbloesungVorgabeAnzeige>, AppError> {
    let zeilen: Vec<(i64, String, Option<i64>, i64)> = sqlx::query_as(
        "SELECT s.id, s.name, s.abloesung_rhythmus_minuten, \
                (SELECT COUNT(*) FROM einsatz_abloesung a \
                 WHERE a.abschnitt_id = s.id AND a.status = 'laufend') \
         FROM einsatzabschnitt s WHERE s.einsatz_id = ? ORDER BY s.sortier, s.id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(
            |(abschnitt_id, abschnitt_name, rhythmus_minuten, laufende_schichten)| {
                AbloesungVorgabeAnzeige {
                    abschnitt_id,
                    abschnitt_name,
                    rhythmus_minuten,
                    laufende_schichten,
                }
            },
        )
        .collect())
}

// ── Hilfen innerhalb der Transaktion ────────────────────────────────────────────────────────

/// Name und Abschnitt einer aktiven Einheit des Einsatzes. `NotFound`, wenn sie nicht
/// dazugehört, `Conflict`, wenn sie aufgelöst ist: eine aufgelöste Einheit bekommt keine
/// Schicht und löst niemanden ab (LLH-1079, Spec `kraefte-entlassung`).
async fn einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<(String, Option<i64>), AppError> {
    crate::einheit::repo::require_aktiv_tx(conn, einsatz_id, einheit_id).await?;
    sqlx::query_as("SELECT name, abschnitt_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
}

/// Name und Vorgabe eines Abschnitts.
async fn abschnitt_tx(
    conn: &mut SqliteConnection,
    abschnitt_id: i64,
) -> Result<Option<(String, Option<i64>)>, AppError> {
    Ok(
        sqlx::query_as(
            "SELECT name, abloesung_rhythmus_minuten FROM einsatzabschnitt WHERE id = ?",
        )
        .bind(abschnitt_id)
        .fetch_optional(&mut *conn)
        .await?,
    )
}

async fn has_laufende_tx(conn: &mut SqliteConnection, einheit_id: i64) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_abloesung WHERE einheit_id = ? AND status = 'laufend'",
    )
    .bind(einheit_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.is_some())
}

/// Ein geprüfter Ablöser: aktive Einheit des Einsatzes, nicht die abgelöste selbst.
#[derive(Debug, Clone)]
struct Abloeser {
    id: i64,
    name: String,
}

/// Prüft eine Liste von Ablösern (LLH-1132) mit EINER Abfrage über `json_each` (`src/AGENTS.md`,
/// „Eingabegrenzen“): die Einheit selbst → 422, eine fremde oder unbekannte → 404, eine
/// aufgelöste → 409 (wie [`einheit_tx`]). Liefert die Ablöser in der Reihenfolge der Liste.
async fn check_abloeser_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    selbst: i64,
    ids: &[i64],
) -> Result<Vec<Abloeser>, AppError> {
    if ids.contains(&selbst) {
        return Err(AppError::UnprocessableEntity(
            "Eine Einheit kann sich nicht selbst ablösen".into(),
        ));
    }
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let json = serde_json::to_string(ids).map_err(|e| AppError::Internal(e.to_string()))?;
    let zeilen: Vec<(i64, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT j.value, e.name, e.aufgeloest_at FROM json_each(?) j \
         LEFT JOIN einsatz_einheit e ON e.id = j.value AND e.einsatz_id = ? ORDER BY j.key",
    )
    .bind(json)
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    zeilen
        .into_iter()
        .map(|(id, name, aufgeloest)| match (name, aufgeloest) {
            (None, _) => Err(AppError::NotFound),
            (Some(name), Some(_)) => Err(AppError::Conflict(format!(
                "Die Einheit «{name}» ist aufgelöst"
            ))),
            (Some(name), None) => Ok(Abloeser { id, name }),
        })
        .collect()
}

/// Die Ablöser einer Schicht in ihrer Reihenfolge (`rowid` = Reihenfolge der Anlage).
async fn load_abloeser_ids_tx(conn: &mut SqliteConnection, id: i64) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT einheit_id FROM einsatz_abloesung_abloeser WHERE abloesung_id = ? ORDER BY rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Ersetzt die Liste der Ablöser einer Schicht (Reihenfolge wie übergeben, EINE Anweisung über
/// `json_each`) und zieht den Spiegel nach. Einziger Schreibweg der Liste und des Spiegels
/// `abloesende_einheit_id` (= erster Eintrag, Migration 0215) neben [`sync_spiegel_tx`].
async fn set_abloeser_tx(
    conn: &mut SqliteConnection,
    id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_abloesung_abloeser WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    if !ids.is_empty() {
        let json = serde_json::to_string(ids).map_err(|e| AppError::Internal(e.to_string()))?;
        sqlx::query(
            "INSERT INTO einsatz_abloesung_abloeser (abloesung_id, einheit_id) \
             SELECT ?, j.value FROM json_each(?) j ORDER BY j.key",
        )
        .bind(id)
        .bind(json)
        .execute(&mut *conn)
        .await?;
    }
    sync_spiegel_tx(conn, id).await
}

/// `abloesende_einheit_id` = erster Ablöser der Liste, NULL ohne einen.
async fn sync_spiegel_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE einsatz_abloesung SET abloesende_einheit_id = \
            (SELECT einheit_id FROM einsatz_abloesung_abloeser WHERE abloesung_id = ?1 \
             ORDER BY rowid LIMIT 1) \
         WHERE id = ?1",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Ob ein Vorfahr der Einheit (über `ueber_einheit_id`) in `menge` liegt. Löst ein Verband ab,
/// bilden nur die Ablöser ohne Vorfahren in der Liste den Knoten (LLH-1118 Punkt 3); die übrigen
/// erben dessen Folgeschicht. Iterativ mit Besucht-Menge wie [`vererbung`].
fn has_vorfahr_in(ueber: &HashMap<i64, Option<i64>>, einheit: i64, menge: &HashSet<i64>) -> bool {
    let mut besucht = HashSet::from([einheit]);
    let mut knoten = ueber.get(&einheit).copied().flatten();
    while let Some(k) = knoten {
        if !besucht.insert(k) {
            return false;
        }
        if menge.contains(&k) {
            return true;
        }
        knoten = ueber.get(&k).copied().flatten();
    }
    false
}

/// Die Untereinheiten, die die laufende Schicht von `traeger` gerade erben, nach ID.
async fn load_erben_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    traeger: i64,
) -> Result<Vec<i64>, AppError> {
    let g = load_gliederung(&mut *conn, einsatz_id).await?;
    let mut erben: Vec<i64> = vererbung(&g.ueber, &g.mit_schicht)
        .into_iter()
        .filter_map(|(erbe, t)| (t == traeger).then_some(erbe))
        .collect();
    erben.sort_unstable();
    Ok(erben)
}

/// Rohdaten einer Schicht für die Schreibpfade.
#[derive(sqlx::FromRow)]
struct Roh {
    einheit_id: i64,
    abschnitt_id: Option<i64>,
    beginn_at: String,
    rhythmus_minuten: i64,
    #[sqlx(try_from = "String")]
    rhythmus_quelle: RhythmusQuelle,
    faellig_at: String,
    #[sqlx(try_from = "String")]
    status: AbloesungStatus,
    vollzogen_at: Option<String>,
    etb_vollzug_id: Option<i64>,
}

async fn roh_tx(conn: &mut SqliteConnection, einsatz_id: i64, id: i64) -> Result<Roh, AppError> {
    sqlx::query_as(
        "SELECT einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle, \
                faellig_at, status, vollzogen_at, etb_vollzug_id \
         FROM einsatz_abloesung WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

fn faellig_oder_400(beginn_at: &str, rhythmus: i64) -> Result<String, AppError> {
    faelligkeit(beginn_at, rhythmus)
        .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{beginn_at}'")))
}

/// Was eine Schicht vom Einsatz liest (LLH-1122): die Kopie des Schichtmodells und die
/// wirksame Zone (Einsatz → Org → Europe/Berlin), in der Wechselzeiten gelten.
pub(crate) struct EinsatzVorgabe {
    pub werte: Option<Werte>,
    pub zone: Tz,
}

impl EinsatzVorgabe {
    /// Vorwarnzeit aller Schichten des Einsatzes.
    pub fn vorwarnung(&self) -> i64 {
        self.werte
            .as_ref()
            .map_or(VORWARNUNG_VORGABE_MINUTEN, |w| w.vorwarnung_minuten)
    }
}

/// Die wirksame Zone eines Einsatzes: die erste gültige aus seiner Einstellung und der der
/// Organisation, sonst Europe/Berlin (`einsatz::nummer::ZEITZONE_VORGABE`). Jeder Name wird
/// für sich gelesen: eine ungültige Einsatzzone („MEZ“) verdrängt keine gültige der
/// Organisation (Review PR #833).
async fn zone_tx(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<Tz, AppError> {
    let namen: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT ee.zeitzone, oe.zeitzone FROM einsatz e \
         LEFT JOIN einsatz_einstellungen ee ON ee.einsatz_id = e.id \
         LEFT JOIN org_einstellungen oe ON oe.org_id = e.org_id WHERE e.id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (einsatz, org) = namen.unwrap_or_default();
    Ok([einsatz, org]
        .into_iter()
        .flatten()
        .find_map(|name| {
            let zone = name.trim().parse::<Tz>().ok();
            if zone.is_none() && !name.trim().is_empty() {
                tracing::warn!(
                    zeitzone = name,
                    "Unbekannte Zeitzone für die Ablösung übergangen"
                );
            }
            zone
        })
        .unwrap_or(crate::einsatz::nummer::ZEITZONE_VORGABE))
}

pub(crate) async fn load_einsatz_vorgabe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<EinsatzVorgabe, AppError> {
    Ok(EinsatzVorgabe {
        werte: schichtmodell_repo::load_einsatz_tx(conn, einsatz_id)
            .await?
            .map(|(w, _)| w),
        zone: zone_tx(conn, einsatz_id).await?,
    })
}

/// Fälligkeit und Rhythmus einer Schicht. Folgt sie der Vorgabe des Einsatzes und gibt es eine,
/// rechnet deren Regel (bei Wechselzeiten wird der Rhythmus die Dauer bis zum Wechsel); sonst
/// Beginn + Rhythmus. Eine entfernte Einsatzvorgabe lässt den zuletzt gültigen Rhythmus stehen.
fn compute_faellig(
    beginn_at: &str,
    rhythmus: i64,
    quelle: RhythmusQuelle,
    vorgabe: &EinsatzVorgabe,
) -> Result<(String, i64), AppError> {
    match (quelle, &vorgabe.werte) {
        (RhythmusQuelle::Einsatz, Some(w)) => w
            .regel
            .faelligkeit(beginn_at, vorgabe.zone)
            .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{beginn_at}'"))),
        _ => Ok((faellig_oder_400(beginn_at, rhythmus)?, rhythmus)),
    }
}

/// Wie der Rhythmus einer Schicht im ETB heißt: bei Wechselzeiten aus der Einsatzvorgabe deren
/// Regel („Wechsel 06:00/18:00, Mindestdauer 4 h“), sonst die Dauer („6 h“).
fn rhythmus_label(rhythmus: i64, quelle: RhythmusQuelle, vorgabe: &EinsatzVorgabe) -> String {
    match (quelle, &vorgabe.werte) {
        (RhythmusQuelle::Einsatz, Some(w)) if matches!(w.regel, Regel::Wechselzeiten { .. }) => {
            w.regel.text()
        }
        _ => rhythmus_text(rhythmus),
    }
}

/// Setzt die beiden Auto-Fristen einer laufenden Schicht auf ihre Fälligkeit; die Vorwarnung
/// liegt `vorwarnung_minuten` davor (Schichtmodell des Einsatzes). Liegt die Vorwarnzeit schon
/// hinter `jetzt`, wird eine offene Vorwarnung geschlossen statt verschoben — eine Vorwarnung in
/// der Vergangenheit ist keine mehr.
#[allow(clippy::too_many_arguments)]
async fn set_fristen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    vorwarnung_minuten: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    erinnerung_repo::setze_auto_frist_tx(
        conn,
        einsatz_id,
        benutzer_id,
        OBJEKT_ABLOESUNG,
        id,
        &format!("Ablösung fällig: {einheit_name}"),
        faellig_at,
    )
    .await?;
    set_vorwarn_frist_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        faellig_at,
        vorwarnung_minuten,
        jetzt,
    )
    .await
}

/// Setzt nur die Vorwarn-Frist einer laufenden Schicht (Regeln wie [`set_fristen_tx`]). Für eine
/// reine Änderung der Vorwarnzeit: die Fälligkeitsfrist bleibt unberührt, sonst leerte
/// `setze_auto_frist_tx` ihr `zuletzt_ausgeloest_at`, und eine überfällige Schicht meldete
/// „fällig“ ein zweites Mal (Spec „Einmaliges Auslösen“, Review PR #833).
#[allow(clippy::too_many_arguments)]
async fn set_vorwarn_frist_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    vorwarnung_minuten: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    match vorwarnzeit(faellig_at, vorwarnung_minuten) {
        Some(v) if v.as_str() > jetzt => {
            erinnerung_repo::setze_auto_frist_tx(
                conn,
                einsatz_id,
                benutzer_id,
                OBJEKT_ABLOESUNG_VORWARNUNG,
                id,
                &format!(
                    "Ablösung in {}: {einheit_name}",
                    rhythmus_text(vorwarnung_minuten)
                ),
                &v,
            )
            .await?;
        }
        _ => {
            erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id, jetzt)
                .await?;
        }
    }
    Ok(())
}

/// Zeitpunkt der offenen Auto-Frist eines Bezugs, `None` ohne eine.
async fn open_frist_at_tx(
    conn: &mut SqliteConnection,
    bezug_typ: &str,
    id: i64,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT faellig_at FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_typ = ? AND bezug_id = ?",
    )
    .bind(bezug_typ)
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?)
}

async fn close_fristen_tx(
    conn: &mut SqliteConnection,
    id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG, id, jetzt).await?;
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id, jetzt).await
}

async fn delete_fristen_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG, id).await?;
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await
}

/// Beendet eine laufende Schicht ohne Ablösung (LLH-1128): Status `beendet` mit Zeitpunkt,
/// Person und Grund als Spur, offene Fristen geschlossen (nicht gelöscht: die Streichung einer
/// Entlassung öffnet sie wieder). Keine Folgeschicht, kein ETB (das schreibt der Aufrufer).
/// Liefert, ob eine laufende Schicht beendet wurde.
pub(crate) async fn end_schicht_tx(
    conn: &mut SqliteConnection,
    id: i64,
    benutzer_id: i64,
    grund: BeendetGrund,
    beendet_at: &str,
    jetzt: &str,
) -> Result<bool, AppError> {
    let n = sqlx::query(
        "UPDATE einsatz_abloesung SET status = 'beendet', beendet_at = ?, beendet_von_id = ?, \
            beendet_grund = ? WHERE id = ? AND status = 'laufend'",
    )
    .bind(beendet_at)
    .bind(benutzer_id)
    .bind(grund.as_str())
    .bind(id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if n > 0 {
        close_fristen_tx(conn, id, jetzt).await?;
    }
    Ok(n > 0)
}

/// Die laufende Schicht einer Einheit: ID und Name der Einheit, `None` ohne eine.
pub(crate) async fn load_laufende_tx(
    conn: &mut SqliteConnection,
    einheit_id: i64,
) -> Result<Option<(i64, String)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT a.id, e.name FROM einsatz_abloesung a \
         JOIN einsatz_einheit e ON e.id = a.einheit_id \
         WHERE a.einheit_id = ? AND a.status = 'laufend'",
    )
    .bind(einheit_id)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Auflösen einer Einheit (LLH-1079, LLH-1128, Spec `kraefte-abloesung` „Auflösen beendet die
/// laufende Schicht“): ihre laufende Schicht wird mit Grund `aufloesung` beendet (Spur statt
/// Löschen, Entscheidung vom 15.10.2026), ihre Fristen geschlossen; abgelöste bleiben mit ihrem
/// Vollzug. Verweist eine Schicht einer anderen Einheit auf sie als ablösende, wird der Verweis
/// geleert. Liefert, ob sich die Ablösung geändert hat.
pub async fn release_einheit_tx(
    conn: &mut SqliteConnection,
    einheit_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let laufend = load_laufende_tx(conn, einheit_id).await?;
    if let Some((id, _)) = laufend {
        end_schicht_tx(
            conn,
            id,
            benutzer_id,
            BeendetGrund::Aufloesung,
            jetzt,
            jetzt,
        )
        .await?;
    }
    let geleert = sqlx::query(
        "UPDATE einsatz_abloesung SET abloesende_einheit_id = NULL WHERE abloesende_einheit_id = ?",
    )
    .bind(einheit_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    // LLH-1132: aus der Liste laufender Schichten fällt sie heraus, der Spiegel rückt nach;
    // abgelöste behalten sie als Spur ihres Vollzugs.
    let aus_liste: Vec<i64> = sqlx::query_scalar(
        "DELETE FROM einsatz_abloesung_abloeser WHERE einheit_id = ? AND abloesung_id IN \
            (SELECT id FROM einsatz_abloesung WHERE status = 'laufend') \
         RETURNING abloesung_id",
    )
    .bind(einheit_id)
    .fetch_all(&mut *conn)
    .await?;
    for id in &aus_liste {
        sync_spiegel_tx(conn, *id).await?;
    }
    Ok(laufend.is_some() || geleert > 0 || !aus_liste.is_empty())
}

/// Legt eine laufende Schicht an und setzt ihre Fristen. Rhythmus und Fälligkeit rechnet
/// [`compute_faellig`] aus der Quelle. Liefert die neue ID und den Rhythmus.
#[allow(clippy::too_many_arguments)]
async fn create_schicht_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    einheit_name: &str,
    abschnitt_id: Option<i64>,
    beginn_at: &str,
    rhythmus: i64,
    quelle: RhythmusQuelle,
    vorgabe: &EinsatzVorgabe,
    vorgaenger_id: Option<i64>,
    jetzt: &str,
) -> Result<(i64, i64), AppError> {
    if has_laufende_tx(conn, einheit_id).await? {
        return Err(AppError::UnprocessableEntity(format!(
            "Einheit «{einheit_name}» hat bereits eine laufende Schicht"
        )));
    }
    let (faellig_at, rhythmus) = compute_faellig(beginn_at, rhythmus, quelle, vorgabe)?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_abloesung \
            (einsatz_id, einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle, \
             faellig_at, vorgaenger_id, angelegt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(abschnitt_id)
    .bind(beginn_at)
    .bind(rhythmus)
    .bind(quelle.as_str())
    .bind(&faellig_at)
    .bind(vorgaenger_id)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    set_fristen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        &faellig_at,
        vorgabe.vorwarnung(),
        jetzt,
    )
    .await?;
    Ok((id, rhythmus))
}

// ── Schreibpfade ────────────────────────────────────────────────────────────────────────────

/// Schicht beginnen. Rangfolge (LLH-1122): eigener Rhythmus → Vorgabe des Abschnitts der
/// Einheit → Vorgabe des Einsatzes; fehlt alles, ist das ein fehlender Pflichtwert → 400
/// (Spec: „Ungültiger Rhythmus").
pub async fn beginnen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &BeginnEingabe,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, i64), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let (id, etb_id) = write_retry!(pool, |conn| {
        let beginn_at = match &eingabe.beginn_at {
            Some(b) => b.clone(),
            None => crate::zeitachse::repo::offenes_eintreffen_tx(conn, eingabe.einheit_id)
                .await?
                .unwrap_or_else(|| jetzt.to_string()),
        };
        start_schicht_tx(
            conn,
            &Start {
                einsatz_id,
                benutzer_id,
                startwert,
                einheit_id: eingabe.einheit_id,
                beginn_at: &beginn_at,
                rhythmus_minuten: eingabe.rhythmus_minuten,
                wie: "begonnen",
            },
            jetzt,
        )
        .await?
        .ok_or_else(|| {
            AppError::Validation(
                "rhythmus_minuten fehlt, und weder der Abschnitt der Einheit noch der Einsatz \
                 hat eine Vorgabe"
                    .into(),
            )
        })
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id))
}

/// Was der Beginn einer Schicht braucht — von Hand ([`beginnen`]) oder mit dem Eintreffen
/// ([`super::kopplung`]).
pub(crate) struct Start<'a> {
    pub einsatz_id: i64,
    pub benutzer_id: i64,
    pub startwert: i64,
    pub einheit_id: i64,
    pub beginn_at: &'a str,
    /// `None` = Vorgabe übernehmen: die des Abschnitts, sonst die des Einsatzes.
    pub rhythmus_minuten: Option<i64>,
    /// Wie der ETB-Eintrag den Beginn nennt („begonnen“, „mit dem Eintreffen begonnen“).
    pub wie: &'a str,
}

/// Beginnt eine Schicht in der Transaktion des Aufrufers. Rangfolge (LLH-1122): eigener
/// Rhythmus → Vorgabe des Abschnitts der Einheit → Vorgabe des Einsatzes. `None`, wenn es
/// nichts davon gibt (keine erfundene Zahl): der Handweg macht daraus eine 400, der Autostart
/// legt nichts an. Sonst Schicht samt Fristen und ETB-Eintrag mit der Herkunft; liefert ihre ID
/// und die des ETB-Eintrags.
pub(crate) async fn start_schicht_tx(
    conn: &mut SqliteConnection,
    s: &Start<'_>,
    jetzt: &str,
) -> Result<Option<(i64, i64)>, AppError> {
    let (name, abschnitt_id) = einheit_tx(conn, s.einsatz_id, s.einheit_id).await?;
    let abschnitt = match abschnitt_id {
        Some(a) => abschnitt_tx(conn, a).await?,
        None => None,
    };
    let vorgabe = load_einsatz_vorgabe_tx(conn, s.einsatz_id).await?;
    let (rhythmus, quelle) = match (s.rhythmus_minuten, &abschnitt, &vorgabe.werte) {
        (Some(r), _, _) => (r, RhythmusQuelle::Einheit),
        (None, Some((_, Some(v))), _) => (*v, RhythmusQuelle::Abschnitt),
        // Der Rhythmus folgt aus der Regel der Einsatzvorgabe (`compute_faellig`).
        (None, _, Some(_)) => (0, RhythmusQuelle::Einsatz),
        (None, _, None) => return Ok(None),
    };
    let (id, rhythmus) = create_schicht_tx(
        conn,
        s.einsatz_id,
        s.benutzer_id,
        s.einheit_id,
        &name,
        abschnitt_id,
        s.beginn_at,
        rhythmus,
        quelle,
        &vorgabe,
        None,
        jetzt,
    )
    .await?;
    let herkunft = match (quelle, &abschnitt, &vorgabe.werte) {
        (RhythmusQuelle::Abschnitt, Some((a, _)), _) => format!(" (Vorgabe Abschnitt «{a}»)"),
        (RhythmusQuelle::Einsatz, _, Some(w)) => {
            format!(" (Vorgabe Einsatz «{}»)", w.bezeichnung)
        }
        _ => String::new(),
    };
    let etb_id = crate::etb::system_audit_tx(
        conn,
        s.einsatz_id,
        s.benutzer_id,
        s.startwert,
        &format!(
            "Ablösung: Schicht von «{name}» {}, Rhythmus {}{herkunft}",
            s.wie,
            rhythmus_label(rhythmus, quelle, &vorgabe)
        ),
    )
    .await?;
    Ok(Some((id, etb_id)))
}

/// Schicht ändern (Beginn, Rhythmus, geplante ablösende Einheit). Liefert den ETB-Eintrag nur,
/// wenn sich etwas geändert hat.
pub async fn aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    eingabe: &AenderungEingabe,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, Option<i64>), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let etb_id = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Laufend {
            return Err(AppError::UnprocessableEntity(nicht_laufend(
                roh.status,
                "lässt sich nicht ändern",
            )));
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        let mut teile: Vec<String> = Vec::new();

        // Rhythmus. Zurück zur Vorgabe heißt: die des Abschnitts, sonst die des Einsatzes.
        let (rhythmus, quelle) = match eingabe.rhythmus_minuten {
            None => (roh.rhythmus_minuten, roh.rhythmus_quelle),
            Some(Some(r)) => (r, RhythmusQuelle::Einheit),
            Some(None) => {
                let abschnitt = match roh.abschnitt_id {
                    Some(a) => abschnitt_tx(conn, a).await?.and_then(|(_, v)| v),
                    None => None,
                };
                match (abschnitt, &vorgabe.werte) {
                    (Some(v), _) => (v, RhythmusQuelle::Abschnitt),
                    (None, Some(_)) => (roh.rhythmus_minuten, RhythmusQuelle::Einsatz),
                    (None, None) => {
                        return Err(AppError::UnprocessableEntity(
                            "Weder der Abschnitt der Schicht noch der Einsatz hat eine \
                             Rhythmus-Vorgabe"
                                .into(),
                        ))
                    }
                }
            }
        };

        // Beginn
        let beginn_at = eingabe.beginn_at.clone().unwrap_or(roh.beginn_at.clone());
        // Ohne neuen Beginn und ohne Rhythmusangabe bleibt die gespeicherte Fälligkeit: nach einer
        // entfernten Wechselzeiten-Vorgabe ergäbe Beginn + aufgerundeter Rhythmus sonst eine um
        // Sekunden verschobene Fälligkeit samt neu gesetzter Fristen (Review PR #833).
        let (faellig_at, rhythmus) =
            if eingabe.rhythmus_minuten.is_none() && beginn_at == roh.beginn_at {
                (roh.faellig_at.clone(), roh.rhythmus_minuten)
            } else {
                compute_faellig(&beginn_at, rhythmus, quelle, &vorgabe)?
            };
        // Bei der Einsatzvorgabe folgt der Rhythmus der Regel; ändert ihn nur der Beginn
        // (Wechselzeiten), ist das keine Rhythmusänderung.
        let rhythmus_geaendert = quelle != roh.rhythmus_quelle
            || (quelle != RhythmusQuelle::Einsatz && rhythmus != roh.rhythmus_minuten);
        if rhythmus_geaendert {
            let wie = match quelle {
                RhythmusQuelle::Abschnitt => " (Vorgabe des Abschnitts)",
                RhythmusQuelle::Einsatz => " (Vorgabe des Einsatzes)",
                RhythmusQuelle::Einheit => "",
            };
            teile.push(format!(
                "Rhythmus {} → {}{wie}",
                rhythmus_text(roh.rhythmus_minuten),
                rhythmus_label(rhythmus, quelle, &vorgabe)
            ));
        }
        if beginn_at != roh.beginn_at {
            teile.push("Einsatzbeginn geändert".into());
        }

        // Ablöser (LLH-1132: eine Liste, `einsatz_abloesung_abloeser`)
        let neue_abloeser = match &eingabe.abloeser {
            Some(neu) if *neu != load_abloeser_ids_tx(conn, id).await? => {
                let geprueft = check_abloeser_tx(conn, einsatz_id, roh.einheit_id, neu).await?;
                teile.push(match geprueft.as_slice() {
                    [] => "Planung der ablösenden Einheit aufgehoben".into(),
                    [a] => format!("ablösende Einheit «{}» geplant", a.name),
                    viele => format!("ablösende Einheiten {} geplant", namen_text(viele)),
                });
                Some(neu)
            }
            _ => None,
        };

        if teile.is_empty() {
            return Ok(None);
        }
        sqlx::query(
            "UPDATE einsatz_abloesung SET beginn_at = ?, rhythmus_minuten = ?, \
                rhythmus_quelle = ?, faellig_at = ? WHERE id = ?",
        )
        .bind(&beginn_at)
        .bind(rhythmus)
        .bind(quelle.as_str())
        .bind(&faellig_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        if let Some(neu) = neue_abloeser {
            set_abloeser_tx(conn, id, neu).await?;
        }
        if faellig_at != roh.faellig_at {
            set_fristen_tx(
                conn,
                einsatz_id,
                benutzer_id,
                id,
                &name,
                &faellig_at,
                vorgabe.vorwarnung(),
                jetzt,
            )
            .await?;
        }
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &format!("Ablösung «{name}»: {}", teile.join(", ")),
        )
        .await?;
        Ok(Some(etb_id))
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id))
}

/// Setzt oder entfernt die Rhythmus-Vorgabe eines Abschnitts und zieht die laufenden
/// Schichten nach, die ihr folgen. `NotFound`, wenn der Abschnitt nicht zum Einsatz gehört.
/// Liefert den Entscheidungseintrag nur, wenn sich der Wert geändert hat.
pub async fn vorgabe_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    abschnitt_id: i64,
    benutzer_id: i64,
    rhythmus_minuten: Option<i64>,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    write_retry!(pool, |conn| {
        let (abschnitt_name, vorher): (String, Option<i64>) = sqlx::query_as(
            "SELECT name, abloesung_rhythmus_minuten FROM einsatzabschnitt \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(abschnitt_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        if vorher == rhythmus_minuten {
            return Ok(None);
        }
        sqlx::query("UPDATE einsatzabschnitt SET abloesung_rhythmus_minuten = ? WHERE id = ?")
            .bind(rhythmus_minuten)
            .bind(abschnitt_id)
            .execute(&mut *conn)
            .await?;

        // Weitergabe: nur bei einem neuen Wert. Eine entfernte Vorgabe lässt den zuletzt
        // gültigen Rhythmus stehen (Spec: „Vorgabe entfernen").
        if let Some(neu) = rhythmus_minuten {
            let vorwarnung = load_einsatz_vorgabe_tx(conn, einsatz_id)
                .await?
                .vorwarnung();
            let folgende: Vec<(i64, String, i64)> = sqlx::query_as(
                "SELECT a.id, a.beginn_at, a.einheit_id FROM einsatz_abloesung a \
                 WHERE a.einsatz_id = ? AND a.abschnitt_id = ? AND a.status = 'laufend' \
                   AND a.rhythmus_quelle = 'abschnitt'",
            )
            .bind(einsatz_id)
            .bind(abschnitt_id)
            .fetch_all(&mut *conn)
            .await?;
            for (id, beginn_at, einheit_id) in folgende {
                let faellig_at = faellig_oder_400(&beginn_at, neu)?;
                sqlx::query(
                    "UPDATE einsatz_abloesung SET rhythmus_minuten = ?, faellig_at = ? WHERE id = ?",
                )
                .bind(neu)
                .bind(&faellig_at)
                .bind(id)
                .execute(&mut *conn)
                .await?;
                let (name, _) = einheit_tx(conn, einsatz_id, einheit_id).await?;
                set_fristen_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    id,
                    &name,
                    &faellig_at,
                    vorwarnung,
                    jetzt,
                )
                .await?;
            }
        }

        let inhalt = match (rhythmus_minuten, vorher) {
            (Some(n), Some(v)) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus auf {} gesetzt (vorher {}).",
                rhythmus_text(n),
                rhythmus_text(v)
            ),
            (Some(n), None) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus auf {} gesetzt.",
                rhythmus_text(n)
            ),
            (None, Some(v)) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus-Vorgabe aufgehoben (vorher {}).",
                rhythmus_text(v)
            ),
            (None, None) => unreachable!("gleiche Werte sind oben ausgestiegen"),
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_ENTSCHEIDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        Ok(Some(etb_id))
    })
}

/// Vorgabe des Einsatzes (LLH-1122) samt wirksamer Vorwarnung und der Zahl der laufenden
/// Schichten, die ihr folgen.
pub async fn load_einsatz_vorgabe(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<AbloesungEinsatzVorgabeAnzeige, AppError> {
    let schichtmodell = schichtmodell_repo::load_einsatz(pool, einsatz_id).await?;
    let laufende_schichten: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_abloesung \
         WHERE einsatz_id = ? AND status = 'laufend' AND rhythmus_quelle = 'einsatz'",
    )
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;
    Ok(AbloesungEinsatzVorgabeAnzeige {
        vorwarnung_minuten: schichtmodell
            .as_ref()
            .map_or(VORWARNUNG_VORGABE_MINUTEN, |m| m.vorwarnung_minuten),
        schichtmodell,
        laufende_schichten,
    })
}

/// Was die Einsatzvorgabe werden soll.
#[derive(Debug, Clone)]
pub enum EinsatzVorgabeInput {
    /// Kopie eines Schichtmodells der Organisation des Einsatzes (fremd oder unbekannt: 404).
    FromStammdaten(i64),
    /// Eigene Werte, von der Route geprüft.
    Werte(Werte),
    /// Keine Vorgabe mehr.
    Remove,
}

/// Setzt oder entfernt die Vorgabe des Einsatzes und zieht die laufenden Schichten nach: wer der
/// Einsatzvorgabe folgt, bekommt Rhythmus und Fälligkeit aus der neuen Regel; ändert sich die
/// Vorwarnung, wandern die Vorwarn-Fristen aller laufenden Schichten mit. Fristen über
/// `setze_auto_frist_tx` (wie bei der Abschnittsvorgabe). Eine entfernte Vorgabe lässt den
/// zuletzt gültigen Rhythmus stehen; die Vorwarnung fällt auf 30 min zurück. Liefert den
/// Entscheidungseintrag nur, wenn sich etwas geändert hat. Die Stammdaten bleiben unberührt.
pub async fn set_einsatz_vorgabe(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &EinsatzVorgabeInput,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    write_retry!(pool, |conn| {
        let neu = match eingabe {
            EinsatzVorgabeInput::FromStammdaten(id) => {
                let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
                    .bind(einsatz_id)
                    .fetch_one(&mut *conn)
                    .await?;
                Some(schichtmodell_repo::load_werte_tx(conn, org_id, *id).await?)
            }
            EinsatzVorgabeInput::Werte(w) => Some(w.clone()),
            EinsatzVorgabeInput::Remove => None,
        };
        let vorher = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        if vorher.werte == neu {
            return Ok(None);
        }
        schichtmodell_repo::set_einsatz_tx(conn, einsatz_id, neu.as_ref(), benutzer_id).await?;
        let vorgabe = EinsatzVorgabe {
            werte: neu.clone(),
            zone: vorher.zone,
        };
        let vorwarnung_geaendert = vorgabe.vorwarnung() != vorher.vorwarnung();

        #[derive(sqlx::FromRow)]
        struct Laufend {
            id: i64,
            einheit_id: i64,
            beginn_at: String,
            rhythmus_minuten: i64,
            #[sqlx(try_from = "String")]
            rhythmus_quelle: RhythmusQuelle,
            faellig_at: String,
        }
        let laufende: Vec<Laufend> = sqlx::query_as(
            "SELECT id, einheit_id, beginn_at, rhythmus_minuten, rhythmus_quelle, faellig_at \
             FROM einsatz_abloesung WHERE einsatz_id = ? AND status = 'laufend' ORDER BY id",
        )
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
        for s in laufende {
            // Neu gerechnet wird nur, wer der neuen Vorgabe folgt. Eine entfernte Vorgabe lässt
            // die gespeicherte Fälligkeit sekundengenau stehen (Review PR #833).
            let (faellig_at, rhythmus) = match (s.rhythmus_quelle, &vorgabe.werte) {
                (RhythmusQuelle::Einsatz, Some(_)) => compute_faellig(
                    &s.beginn_at,
                    s.rhythmus_minuten,
                    s.rhythmus_quelle,
                    &vorgabe,
                )?,
                _ => (s.faellig_at.clone(), s.rhythmus_minuten),
            };
            let faellig_geaendert = faellig_at != s.faellig_at;
            if faellig_geaendert || rhythmus != s.rhythmus_minuten {
                sqlx::query(
                    "UPDATE einsatz_abloesung SET rhythmus_minuten = ?, faellig_at = ? \
                     WHERE id = ?",
                )
                .bind(rhythmus)
                .bind(&faellig_at)
                .bind(s.id)
                .execute(&mut *conn)
                .await?;
            }
            if faellig_geaendert {
                let (name, _) = einheit_tx(conn, einsatz_id, s.einheit_id).await?;
                set_fristen_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    s.id,
                    &name,
                    &faellig_at,
                    vorgabe.vorwarnung(),
                    jetzt,
                )
                .await?;
            } else if vorwarnung_geaendert {
                let (name, _) = einheit_tx(conn, einsatz_id, s.einheit_id).await?;
                set_vorwarn_frist_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    s.id,
                    &name,
                    &faellig_at,
                    vorgabe.vorwarnung(),
                    jetzt,
                )
                .await?;
            }
        }

        let beschreibung = |w: &Werte| format!("«{}», {}", w.bezeichnung, modell_text(w));
        let inhalt = match (&neu, &vorher.werte) {
            (Some(n), Some(v)) => format!(
                "Ablösung Einsatz: Schichtmodell {} gesetzt (vorher {}).",
                beschreibung(n),
                beschreibung(v)
            ),
            (Some(n), None) => format!(
                "Ablösung Einsatz: Schichtmodell {} gesetzt.",
                beschreibung(n)
            ),
            (None, Some(v)) => format!(
                "Ablösung Einsatz: Vorgabe aufgehoben (vorher {}).",
                beschreibung(v)
            ),
            (None, None) => unreachable!("gleiche Werte sind oben ausgestiegen"),
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_ENTSCHEIDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        Ok(Some(etb_id))
    })
}

/// Ein Schichtmodell im ETB: Regel und Vorwarnung („Rhythmus 12 h, Vorwarnung 30 min“).
fn modell_text(w: &Werte) -> String {
    format!(
        "{}, Vorwarnung {}",
        w.regel.text(),
        rhythmus_text(w.vorwarnung_minuten)
    )
}

/// Namen für ETB-Texte: „«A», «B»“.
fn namen_text(abloeser: &[Abloeser]) -> String {
    abloeser
        .iter()
        .map(|a| format!("«{}»", a.name))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Vollzieht eine laufende Schicht (LLH-1132). Die Ablöser kommen als Liste und werden zur Liste
/// der Schicht (`einsatz_abloesung_abloeser`). Je Ablöser, der den Knoten bildet (kein Vorfahr
/// ebenfalls in der Liste), entsteht eine Folgeschicht (Beginn = Vollzug, Rhythmus und
/// Einsatzstelle der abgelösten Schicht; folgt sie der Vorgabe des Einsatzes, rechnet deren Regel
/// neu, etwa bis zum nächsten Wechsel). Hat ein Ablöser schon eine eigene laufende Schicht ohne
/// Vorgänger (ungeplant eingetroffen, Autostart), wird sie als Folgeschicht übernommen; ist seine
/// laufende Schicht selbst schon eine Folgeschicht → 422. Das Ereignis `abloesung` der
/// Zeitachse geht an die abgelöste Einheit und an jede Untereinheit, die ihre Schicht erbt
/// (Knoten-Vererbung beim Lesen, samt Personen). Mit `abschnitt_uebergeben` geht der Abschnitt
/// der abgelösten Einheit an die Knoten-Ablöser, ihr eigener wird geleert; die alten Werte
/// stehen an der Schicht und an der Liste für die Rücknahme.
pub async fn vollziehen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    eingabe: &VollzugEingabe,
    jetzt: &str,
) -> Result<(AbloesungVollzugAnzeige, i64, Wirkung), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let vollzogen_at = eingabe.vollzogen_at.as_str();
    let (folge_ids, etb_id, wirkung) = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Laufend {
            return Err(AppError::UnprocessableEntity(nicht_laufend(
                roh.status,
                "lässt sich nicht vollziehen",
            )));
        }
        if vollzogen_at < roh.beginn_at.as_str() {
            return Err(AppError::UnprocessableEntity(
                "Der Vollzug liegt vor dem Beginn der Schicht".into(),
            ));
        }
        let (name, abschnitt_vorher) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        let abloeser =
            check_abloeser_tx(conn, einsatz_id, roh.einheit_id, &eingabe.abloeser).await?;

        // Vor jedem Schreiben: Knoten der Ablöser und Erben der abgelösten Schicht.
        let g = load_gliederung(&mut *conn, einsatz_id).await?;
        let menge: HashSet<i64> = abloeser.iter().map(|a| a.id).collect();
        let knoten: Vec<&Abloeser> = abloeser
            .iter()
            .filter(|a| !has_vorfahr_in(&g.ueber, a.id, &menge))
            .collect();
        let mut erben: Vec<i64> = vererbung(&g.ueber, &g.mit_schicht)
            .into_iter()
            .filter_map(|(erbe, t)| (t == roh.einheit_id).then_some(erbe))
            .collect();
        erben.sort_unstable();
        // Übergeben wird nur, was es gibt: ein Abschnitt und mindestens ein Knoten-Ablöser.
        let uebergabe =
            abschnitt_vorher.filter(|_| eingabe.abschnitt_uebergeben && !knoten.is_empty());

        sqlx::query(
            "UPDATE einsatz_abloesung SET status = 'abgeloest', vollzogen_at = ?, \
                vollzogen_von_id = ?, abschnitt_uebergeben = ?, \
                abgeloest_abschnitt_vorher_id = ? WHERE id = ?",
        )
        .bind(vollzogen_at)
        .bind(benutzer_id)
        .bind(uebergabe.is_some())
        .bind(uebergabe)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        set_abloeser_tx(conn, id, &eingabe.abloeser).await?;
        close_fristen_tx(conn, id, jetzt).await?;

        // LFH-552/LLH-1132: der Vollzug beendet die Einsatzperiode der abgelösten Einheit und
        // jeder erbenden Untereinheit (je samt Fan-out); ohne offene Periode bleibt die jeweilige
        // Zeitachse unberührt.
        let mut wirkung = Wirkung::default();
        for einheit in std::iter::once(roh.einheit_id).chain(erben.iter().copied()) {
            if let Some(w) = crate::zeitachse::repo::abloesung_vollzogen_tx(
                conn,
                einsatz_id,
                benutzer_id,
                einheit,
                vollzogen_at,
            )
            .await?
            {
                wirkung.zeitachse.push(w);
            }
        }

        let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        let mut folge_ids = Vec::with_capacity(knoten.len());
        let mut uebernommen: Vec<Abloeser> = Vec::new();
        for a in &knoten {
            let laufend: Option<(i64, Option<i64>)> = sqlx::query_as(
                "SELECT id, vorgaenger_id FROM einsatz_abloesung \
                 WHERE einheit_id = ? AND status = 'laufend'",
            )
            .bind(a.id)
            .fetch_optional(&mut *conn)
            .await?;
            match laufend {
                None => {
                    let (f, _) = create_schicht_tx(
                        conn,
                        einsatz_id,
                        benutzer_id,
                        a.id,
                        &a.name,
                        roh.abschnitt_id,
                        vollzogen_at,
                        roh.rhythmus_minuten,
                        roh.rhythmus_quelle,
                        &vorgabe,
                        Some(id),
                        jetzt,
                    )
                    .await?;
                    folge_ids.push(f);
                }
                Some((f, None)) => {
                    sqlx::query(
                        "UPDATE einsatz_abloesung SET vorgaenger_id = ?, \
                            uebernommen_bei_vollzug = 1 WHERE id = ?",
                    )
                    .bind(id)
                    .bind(f)
                    .execute(&mut *conn)
                    .await?;
                    folge_ids.push(f);
                    uebernommen.push((*a).clone());
                }
                Some((_, Some(_))) => {
                    return Err(AppError::UnprocessableEntity(format!(
                        "Einheit «{}» führt schon eine Folgeschicht aus einer anderen Ablösung",
                        a.name
                    )))
                }
            }
        }

        let mut abschnitt_name = None;
        if let Some(abschnitt) = uebergabe {
            // Vorher-Werte aller Listeneinträge, damit die Rücknahme jeden auf seinen Stand legt.
            sqlx::query(
                "UPDATE einsatz_abloesung_abloeser SET abschnitt_vorher_id = \
                    (SELECT e.abschnitt_id FROM einsatz_einheit e \
                     WHERE e.id = einsatz_abloesung_abloeser.einheit_id) \
                 WHERE abloesung_id = ?",
            )
            .bind(id)
            .execute(&mut *conn)
            .await?;
            let knoten_ids: Vec<i64> = knoten.iter().map(|a| a.id).collect();
            sqlx::query(
                "UPDATE einsatz_einheit SET abschnitt_id = ? \
                 WHERE id IN (SELECT value FROM json_each(?))",
            )
            .bind(abschnitt)
            .bind(
                serde_json::to_string(&knoten_ids)
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            )
            .execute(&mut *conn)
            .await?;
            sqlx::query("UPDATE einsatz_einheit SET abschnitt_id = NULL WHERE id = ?")
                .bind(roh.einheit_id)
                .execute(&mut *conn)
                .await?;
            wirkung.einheiten.push(roh.einheit_id);
            wirkung.einheiten.extend(knoten_ids);
            abschnitt_name = abschnitt_tx(conn, abschnitt).await?.map(|(n, _)| n);
        }

        let mut inhalt = if abloeser.is_empty() {
            format!("Ablösung vollzogen: «{name}» (ohne ablösende Einheit).")
        } else {
            format!(
                "Ablösung vollzogen: «{name}» durch {}.",
                namen_text(&abloeser)
            )
        };
        if !uebernommen.is_empty() {
            inhalt.push_str(&format!(
                " Laufende Schicht übernommen: {}.",
                namen_text(&uebernommen)
            ));
        }
        if let Some(a) = &abschnitt_name {
            let an: Vec<Abloeser> = knoten.iter().map(|k| (*k).clone()).collect();
            inhalt.push_str(&format!(
                " Abschnitt «{a}» an {} übergeben.",
                namen_text(&an)
            ));
        }
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_MELDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: Some(vollzogen_at),
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        sqlx::query("UPDATE einsatz_abloesung SET etb_vollzug_id = ? WHERE id = ?")
            .bind(etb_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok((folge_ids, etb_id, wirkung))
    })?;
    let abgeloest = laden(pool, einsatz_id, id, jetzt).await?;
    let mut folgeschichten = Vec::with_capacity(folge_ids.len());
    for f in folge_ids {
        folgeschichten.push(laden(pool, einsatz_id, f, jetzt).await?);
    }
    Ok((
        AbloesungVollzugAnzeige {
            abgeloest,
            folgeschicht: folgeschichten.first().cloned(),
            folgeschichten,
        },
        etb_id,
        wirkung,
    ))
}

/// Nimmt einen Vollzug zurück, solange jede Folgeschicht unberührt (laufend) ist (LLH-1132):
/// neu angelegte Folgeschichten werden samt Fristen entfernt, übernommene nur vom Vorgänger
/// gelöst. Das Ereignis `abloesung` wird an der Einheit und an jeder Untereinheit gestrichen,
/// die die wieder laufende Schicht erbt. Eine Abschnittsübergabe wird zurückgegeben, wo der
/// Vollzug den Stand hinterlassen hat: die abgelöste Einheit bekommt ihren Abschnitt, solange sie
/// noch ohne ist, jeder Ablöser seinen alten, solange er noch im übergebenen steht. Die Liste
/// der Ablöser bleibt als Planung stehen.
pub async fn zuruecknehmen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, i64, Wirkung), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let (etb_id, wirkung) = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Abgeloest {
            return Err(AppError::UnprocessableEntity(
                "Die Schicht ist nicht abgelöst — es gibt keinen Vollzug zurückzunehmen".into(),
            ));
        }
        let folgen: Vec<(i64, String, bool)> = sqlx::query_as(
            "SELECT id, status, uebernommen_bei_vollzug FROM einsatz_abloesung \
             WHERE vorgaenger_id = ? ORDER BY id",
        )
        .bind(id)
        .fetch_all(&mut *conn)
        .await?;
        if folgen
            .iter()
            .any(|(_, status, _)| status.as_str() != AbloesungStatus::Laufend.as_str())
        {
            return Err(AppError::UnprocessableEntity(
                "Die Folgeschicht ist bereits selbst abgelöst oder beendet — der Vollzug lässt sich nicht mehr zurücknehmen"
                    .into(),
            ));
        }
        for (folge_id, _, uebernommen) in &folgen {
            if *uebernommen {
                sqlx::query(
                    "UPDATE einsatz_abloesung SET vorgaenger_id = NULL, \
                        uebernommen_bei_vollzug = 0 WHERE id = ?",
                )
                .bind(folge_id)
                .execute(&mut *conn)
                .await?;
            } else {
                delete_fristen_tx(conn, *folge_id).await?;
                sqlx::query("DELETE FROM einsatz_abloesung WHERE id = ?")
                    .bind(folge_id)
                    .execute(&mut *conn)
                    .await?;
            }
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        if has_laufende_tx(conn, roh.einheit_id).await? {
            return Err(AppError::UnprocessableEntity(format!(
                "Einheit «{name}» hat inzwischen eine neue laufende Schicht"
            )));
        }
        let (uebergeben, abschnitt): (bool, Option<i64>) = sqlx::query_as(
            "SELECT abschnitt_uebergeben, abgeloest_abschnitt_vorher_id FROM einsatz_abloesung \
             WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&mut *conn)
        .await?;
        sqlx::query(
            "UPDATE einsatz_abloesung SET status = 'laufend', vollzogen_at = NULL, \
                vollzogen_von_id = NULL, etb_vollzug_id = NULL, abschnitt_uebergeben = 0, \
                abgeloest_abschnitt_vorher_id = NULL WHERE id = ?",
        )
        .bind(id)
        .execute(&mut *conn)
        .await?;

        // LFH-552/LLH-1132: das Ablösungsereignis an der Einheit und an ihren Erben streichen,
        // ihre Perioden sind wieder offen. Die Erben ermittelt die Vererbung jetzt, da die
        // Schicht wieder läuft.
        let mut wirkung = Wirkung::default();
        if let Some(vollzogen_at) = &roh.vollzogen_at {
            let erben = load_erben_tx(conn, einsatz_id, roh.einheit_id).await?;
            for einheit in std::iter::once(roh.einheit_id).chain(erben) {
                if let Some(w) = crate::zeitachse::repo::abloesung_zurueckgenommen_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    einheit,
                    vollzogen_at,
                )
                .await?
                {
                    wirkung.zeitachse.push(w);
                }
            }
        }

        let mut zurueck = None;
        if let (true, Some(abschnitt)) = (uebergeben, abschnitt) {
            let abloeser: Vec<i64> = sqlx::query_scalar(
                "UPDATE einsatz_einheit SET abschnitt_id = \
                    (SELECT l.abschnitt_vorher_id FROM einsatz_abloesung_abloeser l \
                     WHERE l.abloesung_id = ?1 AND l.einheit_id = einsatz_einheit.id) \
                 WHERE abschnitt_id = ?2 AND id IN \
                    (SELECT einheit_id FROM einsatz_abloesung_abloeser WHERE abloesung_id = ?1) \
                 RETURNING id",
            )
            .bind(id)
            .bind(abschnitt)
            .fetch_all(&mut *conn)
            .await?;
            let selbst = sqlx::query(
                "UPDATE einsatz_einheit SET abschnitt_id = ? WHERE id = ? AND abschnitt_id IS NULL",
            )
            .bind(abschnitt)
            .bind(roh.einheit_id)
            .execute(&mut *conn)
            .await?
            .rows_affected();
            if selbst > 0 {
                wirkung.einheiten.push(roh.einheit_id);
            }
            wirkung.einheiten.extend(abloeser);
            zurueck = abschnitt_tx(conn, abschnitt).await?.map(|(n, _)| n);
        }
        sqlx::query(
            "UPDATE einsatz_abloesung_abloeser SET abschnitt_vorher_id = NULL \
             WHERE abloesung_id = ?",
        )
        .bind(id)
        .execute(&mut *conn)
        .await?;
        restore_fristen_tx(conn, einsatz_id, benutzer_id, id, &roh, &name, jetzt).await?;

        let mut inhalt = format!("Vollzug der Ablösung «{name}» zurückgenommen.");
        if let Some(a) = zurueck {
            inhalt.push_str(&format!(" Abschnitt «{a}» zurückgegeben."));
        }
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_BERICHTIGUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: roh.etb_vollzug_id,
            },
        )
        .await?;
        Ok((etb_id, wirkung))
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id, wirkung))
}

/// Fristen einer wieder laufenden Schicht (Rücknahme des Vollzugs, gestrichene Entlassung) nach
/// der aktuellen Vorgabe (Review PR #833). Folgt die Schicht der Vorgabe des Einsatzes und
/// rechnet deren Regel inzwischen anders, gilt die neue Fälligkeit samt neuer Fristen. Sonst
/// öffnet das die alte Fälligkeitsfrist, ohne eine schon erfolgte Auslösung zu wiederholen, und
/// legt die Vorwarnung auf die aktuelle Vorwarnzeit — nur, solange sie noch vor uns liegt.
async fn restore_fristen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    roh: &Roh,
    name: &str,
    jetzt: &str,
) -> Result<(), AppError> {
    let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
    let vorwarnung = vorgabe.vorwarnung();
    let (faellig_at, rhythmus) = match (roh.rhythmus_quelle, &vorgabe.werte) {
        (RhythmusQuelle::Einsatz, Some(_)) => compute_faellig(
            &roh.beginn_at,
            roh.rhythmus_minuten,
            roh.rhythmus_quelle,
            &vorgabe,
        )?,
        _ => (roh.faellig_at.clone(), roh.rhythmus_minuten),
    };
    if faellig_at != roh.faellig_at {
        sqlx::query(
            "UPDATE einsatz_abloesung SET rhythmus_minuten = ?, faellig_at = ? WHERE id = ?",
        )
        .bind(rhythmus)
        .bind(&faellig_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        set_fristen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            id,
            name,
            &faellig_at,
            vorwarnung,
            jetzt,
        )
        .await?;
    } else {
        erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG, id).await?;
        if let Some(v) = vorwarnzeit(&faellig_at, vorwarnung).filter(|v| v.as_str() > jetzt) {
            erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await?;
            if open_frist_at_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await? != Some(v) {
                set_vorwarn_frist_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    id,
                    name,
                    &faellig_at,
                    vorwarnung,
                    jetzt,
                )
                .await?;
            }
        }
    }
    Ok(())
}

/// Öffnet die mit einer Entlassung beendete Schicht einer Einheit wieder, wenn genau diese
/// Entlassung gestrichen wurde (LLH-1128): Grund `entlassung`, Ende = Zeitpunkt der
/// gestrichenen Entlassung, die jüngste solche Schicht. Hat die Einheit inzwischen eine neue
/// laufende Schicht, bleibt sie beendet. Fristen wie bei der Rücknahme eines Vollzugs. Liefert
/// die ID der Schicht und den Namen der Einheit, `None` ohne Wirkung.
pub(crate) async fn reopen_nach_entlassung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    entlassung_at: &str,
    jetzt: &str,
) -> Result<Option<(i64, String)>, AppError> {
    let id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_abloesung \
         WHERE einsatz_id = ? AND einheit_id = ? AND status = 'beendet' \
           AND beendet_grund = ? AND beendet_at = ? \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(BeendetGrund::Entlassung.as_str())
    .bind(entlassung_at)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(id) = id else {
        return Ok(None);
    };
    if has_laufende_tx(conn, einheit_id).await? {
        return Ok(None);
    }
    let roh = roh_tx(conn, einsatz_id, id).await?;
    let (name, _) = einheit_tx(conn, einsatz_id, einheit_id).await?;
    sqlx::query(
        "UPDATE einsatz_abloesung SET status = 'laufend', beendet_at = NULL, \
            beendet_von_id = NULL, beendet_grund = NULL WHERE id = ?",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    restore_fristen_tx(conn, einsatz_id, benutzer_id, id, &roh, &name, jetzt).await?;
    Ok(Some((id, name)))
}

/// Text der 422 für eine Schicht, die nicht mehr läuft.
fn nicht_laufend(status: AbloesungStatus, was: &str) -> String {
    match status {
        AbloesungStatus::Beendet => format!("Eine beendete Schicht {was}"),
        _ => format!("Eine abgelöste Schicht {was}"),
    }
}

#[cfg(test)]
mod tests;
