//! Persistenz der Ablösung (LFH-635).
//!
//! **Alles, was eine Ablösung verändert, läuft in EINER `write_retry!`-Transaktion**: Schicht,
//! Auto-Fristen des Erinnerungs-Schedulers, Folgeschicht und ETB-Eintrag. Ein 422 mitten im
//! Ablauf lässt deshalb nichts zurück (Spec: „Vollzug mit Folgeschicht", Atomarität).
//!
//! Die Fristen hängen polymorph an der Schicht (`bezug_typ` `abloesung` /
//! `abloesung_vorwarnung` / `abloesung_planung`, `bezug_id` = Schicht-ID) — ohne FK, wie alle
//! Auto-Fristen.

use sqlx::{SqliteConnection, SqlitePool};

use std::collections::{HashMap, HashSet};

use super::hinweis::{self, Wirkung};
use super::{
    einstufung, faelligkeit, planung_warnungen, rhythmus_text, vererbung, vorwarnzeit,
    AbloesungAbloeser, AbloesungAnzeige, AbloesungArt, AbloesungBesatzung, AbloesungBesatzungPlan,
    AbloesungEinsatzVorgabeAnzeige, AbloesungErbe, AbloesungFolge, AbloesungPlanungEntfallen,
    AbloesungStatus, AbloesungVerbleib, AbloesungVollzugAnzeige, AbloesungVorgabeAnzeige,
    BeendetGrund, BeginnQuelle, BesatzungRolle, BesatzungZiel, PlanungEntfallenGrund,
    PlanungsStand, RhythmusQuelle, PLANUNGSVORLAUF_VORGABE_MINUTEN, VORWARNUNG_VORGABE_MINUTEN,
};
use crate::benachrichtigung::BenachrichtigungBezugTyp;
use crate::einsatz::einstellungen::etb_startwert;
use crate::erinnerung::repo as erinnerung_repo;
use crate::error::AppError;
use crate::etb::repo::EintragDaten;
use crate::etb::{TYP_BERICHTIGUNG, TYP_ENTSCHEIDUNG, TYP_MELDUNG};
use crate::kommunikation::{
    OBJEKT_ABLOESUNG, OBJEKT_ABLOESUNG_PLANUNG, OBJEKT_ABLOESUNG_VORWARNUNG,
};
use crate::schichtmodell::repo as schichtmodell_repo;
use crate::schichtmodell::{Regel, Werte};
use crate::write_retry;
use crate::zeitachse::repo::Beruehrt;
use crate::zeitdarstellung::{Zeitdarstellung, Zeitstil};

/// Was Vollzug oder Rücknahme außerhalb der Ablösung geändert haben; die Route meldet danach
/// `einheit` und `personal` (LLH-1189).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VollzugWirkung {
    /// Je Einheit mit geschriebenem bzw. gestrichenem Ereignis `abloesung` (die abgelöste und
    /// ihre erbenden Untereinheiten, LLH-1132) die per Fan-out berührten Personen.
    pub zeitachse: Vec<(i64, Beruehrt)>,
    /// Einheiten, deren Abschnitt die Übergabe oder ihre Rücknahme geändert hat, beim
    /// Besatzungswechsel die, deren Personal er geändert hat (LLH-1150).
    pub einheiten: Vec<i64>,
    /// Personen, deren Einheit oder Zeitachse der Besatzungswechsel oder seine Rücknahme geändert
    /// hat (LLH-1150).
    pub personen: Vec<i64>,
    /// Bereitstellungsräume, deren Belegung Vollzug oder Rücknahme geändert haben (LLH-1308).
    pub raeume: Vec<i64>,
    /// ETB-Einträge und Hinweise der Kopplung an die Zeitachse (LLH-1128/LLH-1131), etwa eine
    /// entfallene Planung der entlassenen Einheit; nach dem Commit über `publish_kopplung`.
    pub kopplung: Wirkung,
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
    /// Der geplante Besatzungswechsel (LLH-1319), von der Route begrenzt und nach Person
    /// entdoppelt; `Some(vec![])` = Planung aufheben. Nach der Änderung plant die Schicht
    /// entweder Ablöser oder einen Besatzungswechsel (sonst 422).
    pub besatzung_plan: Option<Vec<BesatzungZiel>>,
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
    /// Ganze Einheit oder Besatzungswechsel (LLH-1150); beim Besatzungswechsel sind `abloeser`
    /// leer und `abschnitt_uebergeben` aus (die Route prüft das).
    pub art: AbloesungArt,
    /// Beim Besatzungswechsel die neue Besatzung mit ihrem Ziel (LLH-1319), begrenzt und nach
    /// Person entdoppelt; sonst leer.
    pub besatzung: Vec<BesatzungZiel>,
    /// Was danach mit der abgelösten Einheit geschieht (LLH-1308); beim Besatzungswechsel
    /// immer `ruhe` (die Route prüft das).
    pub verbleib: AbloesungVerbleib,
    /// Der Raum genau beim Verbleib `bereitstellungsraum` (die Route prüft das).
    pub verbleib_br_id: Option<i64>,
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
    #[sqlx(try_from = "String")]
    beginn_quelle: BeginnQuelle,
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
    #[sqlx(try_from = "String")]
    art: AbloesungArt,
    planung_entfallen_at: Option<String>,
    planung_entfallen_grund: Option<String>,
    planung_entfallen_einheit_name: Option<String>,
    #[sqlx(try_from = "String")]
    verbleib: AbloesungVerbleib,
    verbleib_br_bezeichnung: Option<String>,
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
        // Der Vermerk zählt nur, solange die Schicht läuft und keinen Ablöser trägt (der Spiegel
        // ist genau dann leer, LLH-1309).
        let planung_entfallen = match (
            self.status,
            self.abloesende_einheit_id,
            self.planung_entfallen_at,
            self.planung_entfallen_grund
                .as_deref()
                .and_then(PlanungEntfallenGrund::parse),
            self.planung_entfallen_einheit_name,
        ) {
            (AbloesungStatus::Laufend, None, Some(at), Some(grund), Some(einheit_name)) => {
                Some(AbloesungPlanungEntfallen {
                    at,
                    grund,
                    einheit_name,
                })
            }
            _ => None,
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
            beginn_quelle: self.beginn_quelle,
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
            art: self.art,
            besatzung: Vec::new(),
            besatzung_plan: Vec::new(),
            nach_besatzungswechsel: Vec::new(),
            verbleib: self.verbleib,
            verbleib_br_bezeichnung: self.verbleib_br_bezeichnung,
            ruecknehmbar,
            beendet_at: self.beendet_at,
            beendet_von_id: self.beendet_von_id,
            beendet_grund: self.beendet_grund.as_deref().and_then(BeendetGrund::parse),
            erbende_einheiten: Vec::new(),
            planung_warnungen: Vec::new(),
            planung_entfallen,
            angelegt_at: self.angelegt_at,
        }
    }
}

/// Anzeige-Projektion. Die Folgeschicht ist die jüngste Schicht mit `vorgaenger_id` = diese
/// (`MAX(id)` über `idx_abloesung_vorgaenger`, Migration 0153); unberührt ist der Vollzug, wenn
/// keine seiner Folgeschichten (LLH-1132: je Ablöser eine) aufgehört hat zu laufen — dieselbe
/// Index-Suche. Eine laufende Schicht derselben Einheit sperrt die Rücknahme, außer sie ist die
/// eigene Folgeschicht eines Besatzungswechsels (LLH-1150). Ohne den Index war jede Unterabfrage ein Scan über die Ablösungen aller Einsätze
/// (LFH-933); `liste_plan_ohne_scan` hält das fest. Ablöser und Folgeschichten hängt
/// [`attach_listen`] an.
/// Die Vorwarnung kommt aus der Kopie des Schichtmodells am Einsatz (LLH-1122), ohne sie 30 min
/// ([`VORWARNUNG_VORGABE_MINUTEN`], im SQL als Literal; `vorwarnung_vorgabe_im_sql` hält beide
/// gleich).
const ANZEIGE_SELECT: &str = "SELECT a.id, a.einsatz_id, a.einheit_id, e.name AS einheit_name, \
            a.abschnitt_id, s.name AS abschnitt_name, a.beginn_at, a.beginn_quelle, \
            a.rhythmus_minuten, \
            a.rhythmus_quelle, a.faellig_at, \
            COALESCE(m.vorwarnung_minuten, 30) AS vorwarnung_minuten, a.abloesende_einheit_id, \
            ae.name AS abloesende_einheit_name, a.status, a.vollzogen_at, a.vollzogen_von_id, \
            a.vorgaenger_id, \
            (SELECT MAX(fv.id) FROM einsatz_abloesung fv WHERE fv.vorgaenger_id = a.id) \
               AS folgeschicht_id, \
            NOT EXISTS (SELECT 1 FROM einsatz_abloesung fu WHERE fu.vorgaenger_id = a.id \
               AND fu.status <> 'laufend') AS folgen_unberuehrt, \
            EXISTS (SELECT 1 FROM einsatz_abloesung o WHERE o.einheit_id = a.einheit_id \
               AND o.status = 'laufend' AND o.id <> a.id \
               AND (o.vorgaenger_id IS NULL OR o.vorgaenger_id <> a.id)) \
               AS einheit_laeuft_anderswo, \
            a.beendet_at, a.beendet_von_id, a.beendet_grund, a.uebernommen_bei_vollzug, \
            a.abschnitt_uebergeben, ua.name AS uebergebener_abschnitt_name, a.art, \
            a.planung_entfallen_at, a.planung_entfallen_grund, \
            a.planung_entfallen_einheit_name, a.verbleib, \
            vb.bezeichnung AS verbleib_br_bezeichnung, a.angelegt_at \
     FROM einsatz_abloesung a \
     JOIN einsatz_einheit e ON e.id = a.einheit_id \
     LEFT JOIN einsatzabschnitt s ON s.id = a.abschnitt_id \
     LEFT JOIN einsatz_einheit ae ON ae.id = a.abloesende_einheit_id \
     LEFT JOIN einsatz_schichtmodell m ON m.einsatz_id = a.einsatz_id \
     LEFT JOIN einsatzabschnitt ua ON ua.id = a.abgeloest_abschnitt_vorher_id \
               AND a.abschnitt_uebergeben = 1 \
     LEFT JOIN bereitstellungsraum vb ON vb.id = a.verbleib_br_id";

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
    // Besatzung beim Besatzungswechsel (LLH-1150): erst die alte, dann die neue, je in der
    // Reihenfolge des Vollzugs. Der Name ist der der Dispositionszeile, wie in der Einheit.
    let besatzung: Vec<(i64, i64, String, String)> = sqlx::query_as(
        "SELECT b.abloesung_id, b.personal_id, p.snap_name, b.rolle \
         FROM einsatz_abloesung_besatzung b \
         JOIN einsatz_abloesung a ON a.id = b.abloesung_id \
         JOIN einsatz_personal p ON p.id = b.personal_id \
         WHERE a.einsatz_id = ? ORDER BY b.abloesung_id, b.rolle, b.rowid",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut je_besatzung: HashMap<i64, Vec<AbloesungBesatzung>> = HashMap::new();
    for (abloesung_id, personal_id, name, rolle) in besatzung {
        let Some(rolle) = BesatzungRolle::parse(&rolle) else {
            continue;
        };
        je_besatzung
            .entry(abloesung_id)
            .or_default()
            .push(AbloesungBesatzung {
                personal_id,
                name,
                rolle,
            });
    }
    // Die neue Besatzung je Besatzungswechsel, für die Kennzeichnung seiner Folgeschicht
    // (LLH-1319); vor dem Verteilen der Listen, weil der Vorgänger nicht in `liste` stehen muss.
    let mut neu_je_wechsel: HashMap<i64, Vec<AbloesungBesatzung>> = HashMap::new();
    for (abloesung_id, besatzung) in &je_besatzung {
        let neu: Vec<AbloesungBesatzung> = besatzung
            .iter()
            .filter(|b| b.rolle == BesatzungRolle::Neu)
            .cloned()
            .collect();
        if !neu.is_empty() {
            neu_je_wechsel.insert(*abloesung_id, neu);
        }
    }
    let mut je_plan = load_besatzung_plaene(pool, einsatz_id).await?;
    for a in liste.iter_mut() {
        a.abloeser = je_schicht.remove(&a.id).unwrap_or_default();
        a.folgeschichten = je_vorgaenger.remove(&a.id).unwrap_or_default();
        a.besatzung = je_besatzung.remove(&a.id).unwrap_or_default();
        if a.status == AbloesungStatus::Laufend {
            a.besatzung_plan = je_plan.remove(&a.id).unwrap_or_default();
        }
        if let Some(v) = a.vorgaenger_id {
            a.nach_besatzungswechsel = neu_je_wechsel.get(&v).cloned().unwrap_or_default();
        }
    }
    Ok(())
}

/// Die geplanten Besatzungswechsel der laufenden Schichten eines Einsatzes (LLH-1319), je Schicht
/// in der Reihenfolge der Planung, mit den Namen der Ziele. EINE Abfrage für den ganzen Einsatz.
async fn load_besatzung_plaene(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<HashMap<i64, Vec<AbloesungBesatzungPlan>>, AppError> {
    #[derive(sqlx::FromRow)]
    struct PlanZeile {
        abloesung_id: i64,
        personal_id: i64,
        name: String,
        einheit_id: Option<i64>,
        einheit_name: Option<String>,
        fahrzeug_id: Option<i64>,
        funkrufname: Option<String>,
    }
    let zeilen: Vec<PlanZeile> = sqlx::query_as(
        "SELECT p.abloesung_id, p.personal_id, ep.snap_name AS name, p.einheit_id, \
                e.name AS einheit_name, p.fahrzeug_id, \
                CASE WHEN ef.id IS NULL THEN NULL \
                     ELSE coalesce(f.funkrufname, ef.snap_funkrufname, '') END AS funkrufname \
         FROM einsatz_abloesung_besatzung_plan p \
         JOIN einsatz_abloesung a ON a.id = p.abloesung_id \
         JOIN einsatz_personal ep ON ep.id = p.personal_id \
         LEFT JOIN einsatz_einheit e ON e.id = p.einheit_id \
         LEFT JOIN einsatz_fahrzeug ef ON ef.id = p.fahrzeug_id \
         LEFT JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
         WHERE a.einsatz_id = ? AND a.status = 'laufend' ORDER BY p.abloesung_id, p.rowid",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut je_schicht: HashMap<i64, Vec<AbloesungBesatzungPlan>> = HashMap::new();
    for z in zeilen {
        je_schicht
            .entry(z.abloesung_id)
            .or_default()
            .push(AbloesungBesatzungPlan {
                personal_id: z.personal_id,
                name: z.name,
                einheit_id: z.einheit_id,
                einheit_name: z.einheit_name,
                fahrzeug_id: z.fahrzeug_id,
                funkrufname: z.funkrufname,
            });
    }
    Ok(je_schicht)
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

/// Hängt an jede laufende Schicht die Untereinheiten, die sie erben (nach Name, dann ID), und
/// die Warnungen zu ihrer geplanten ablösenden Einheit (LLH-1131).
async fn attach_erben(
    pool: &SqlitePool,
    einsatz_id: i64,
    liste: &mut [AbloesungAnzeige],
) -> Result<(), AppError> {
    if !liste.iter().any(|a| a.status == AbloesungStatus::Laufend) {
        return Ok(());
    }
    let g = load_gliederung(pool, einsatz_id).await?;
    let erbt = vererbung(&g.ueber, &g.mit_schicht);
    attach_warnungen(pool, einsatz_id, &g, &erbt, liste).await?;
    let mut je_traeger: HashMap<i64, Vec<AbloesungErbe>> = HashMap::new();
    for (&erbe, &traeger) in &erbt {
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

/// Die Planungswarnungen der laufenden Schichten in `liste` ([`planung_warnungen`]), gegen
/// alle laufenden Schichten des Einsatzes: Einzelplanung und Ablöser-Liste. Ohne laufende Schicht
/// in `liste` liest sie nichts.
async fn attach_warnungen(
    pool: &SqlitePool,
    einsatz_id: i64,
    g: &Gliederung,
    erbt: &HashMap<i64, i64>,
    liste: &mut [AbloesungAnzeige],
) -> Result<(), AppError> {
    let ziel: HashSet<i64> = liste
        .iter()
        .filter(|a| a.status == AbloesungStatus::Laufend)
        .map(|a| a.id)
        .collect();
    if ziel.is_empty() {
        return Ok(());
    }
    let zeilen: Vec<(i64, i64, String, String, Option<i64>)> = sqlx::query_as(
        "SELECT a.id, a.einheit_id, e.name, a.beginn_at, a.abloesende_einheit_id \
         FROM einsatz_abloesung a JOIN einsatz_einheit e ON e.id = a.einheit_id \
         WHERE a.einsatz_id = ? AND a.status = 'laufend' ORDER BY a.id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let liste_eintraege: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT l.abloesung_id, l.einheit_id FROM einsatz_abloesung_abloeser l \
         JOIN einsatz_abloesung a ON a.id = l.abloesung_id \
         WHERE a.einsatz_id = ? AND a.status = 'laufend' ORDER BY l.rowid",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let stand: Vec<PlanungsStand> = zeilen
        .into_iter()
        .map(
            |(id, einheit_id, einheit_name, beginn_at, abloesende)| PlanungsStand {
                id,
                einheit_id,
                einheit_name,
                beginn_at,
                abloeser: abloesende
                    .into_iter()
                    .chain(
                        liste_eintraege
                            .iter()
                            .filter(|(s, _)| *s == id)
                            .map(|(_, e)| *e),
                    )
                    .collect(),
            },
        )
        .collect();
    if !stand
        .iter()
        .any(|s| ziel.contains(&s.id) && !s.abloeser.is_empty())
    {
        return Ok(());
    }
    let mut warnungen = planung_warnungen(&stand, erbt, &g.namen);
    for a in liste.iter_mut().filter(|a| ziel.contains(&a.id)) {
        if let Some(w) = warnungen.remove(&a.id) {
            a.planung_warnungen = w;
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
/// `abloesende_einheit_id` (= erster Eintrag, Migration 0215) neben [`sync_spiegel_tx`]. Räumt
/// den Vermerk einer entfallenen Planung (LLH-1309): jede Planung, Umplanung, Leerung und der
/// Vollzug machen ihn gegenstandslos.
async fn set_abloeser_tx(
    conn: &mut SqliteConnection,
    id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE einsatz_abloesung SET planung_entfallen_at = NULL, \
            planung_entfallen_grund = NULL, planung_entfallen_einheit_name = NULL WHERE id = ?",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
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

/// Ziele einer neuen Besatzung als JSON für `json_each` (`p` Person, `e` Einheit, `f` Fahrzeug).
fn ziele_json(ziele: &[BesatzungZiel]) -> Result<String, AppError> {
    serde_json::to_string(
        &ziele
            .iter()
            .map(|z| serde_json::json!({"p": z.personal_id, "e": z.einheit_id, "f": z.fahrzeug_id}))
            .collect::<Vec<_>>(),
    )
    .map_err(|e| AppError::Internal(e.to_string()))
}

/// Der geplante Besatzungswechsel einer Schicht in seiner Reihenfolge (LLH-1319).
async fn load_besatzung_plan_tx(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Vec<BesatzungZiel>, AppError> {
    let zeilen: Vec<(i64, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT personal_id, einheit_id, fahrzeug_id FROM einsatz_abloesung_besatzung_plan \
         WHERE abloesung_id = ? ORDER BY rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|(personal_id, einheit_id, fahrzeug_id)| BesatzungZiel {
            personal_id,
            einheit_id,
            fahrzeug_id,
        })
        .collect())
}

/// Ersetzt den geplanten Besatzungswechsel einer Schicht (LLH-1319, Reihenfolge wie übergeben,
/// EINE Anweisung über `json_each`). Einziger Schreibweg von `einsatz_abloesung_besatzung_plan`;
/// eine leere Liste hebt die Planung auf. Der Vollzug lässt die Zeilen stehen, damit die Rücknahme
/// die Planung wiederfindet.
async fn set_besatzung_plan_tx(
    conn: &mut SqliteConnection,
    id: i64,
    ziele: &[BesatzungZiel],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_abloesung_besatzung_plan WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    if !ziele.is_empty() {
        let json = ziele_json(ziele)?;
        sqlx::query(
            "INSERT INTO einsatz_abloesung_besatzung_plan \
                (abloesung_id, personal_id, einheit_id, fahrzeug_id) \
             SELECT ?, json_extract(j.value, '$.p'), json_extract(j.value, '$.e'), \
                    json_extract(j.value, '$.f') \
             FROM json_each(?) j ORDER BY j.key",
        )
        .bind(id)
        .bind(json)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
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
    #[sqlx(try_from = "String")]
    art: AbloesungArt,
    #[sqlx(try_from = "String")]
    verbleib: AbloesungVerbleib,
}

async fn roh_tx(conn: &mut SqliteConnection, einsatz_id: i64, id: i64) -> Result<Roh, AppError> {
    sqlx::query_as(
        "SELECT einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle, \
                faellig_at, status, vollzogen_at, etb_vollzug_id, art, verbleib \
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

/// Was eine Schicht vom Einsatz liest (LLH-1122): die Kopie des Schichtmodells und Zone und
/// Darstellung des Einsatzes (`zeitdarstellung::zeitstil_laden`, Einsatz → Org → Vorgabe). In
/// der Zone gelten die Wechselzeiten, in der Darstellung stehen sie im ETB (LLH-1469).
pub(crate) struct EinsatzVorgabe {
    pub werte: Option<Werte>,
    pub stil: Zeitstil,
}

impl EinsatzVorgabe {
    /// Vorwarnzeit aller Schichten des Einsatzes.
    pub fn vorwarnung(&self) -> i64 {
        self.werte
            .as_ref()
            .map_or(VORWARNUNG_VORGABE_MINUTEN, |w| w.vorwarnung_minuten)
    }

    /// Vorlauf des Planungshinweises aller Schichten des Einsatzes (LLH-1131): aus dem
    /// Schichtmodell, ohne eines [`PLANUNGSVORLAUF_VORGABE_MINUTEN`] (2 h).
    pub fn planungsvorlauf(&self) -> i64 {
        self.werte
            .as_ref()
            .map_or(PLANUNGSVORLAUF_VORGABE_MINUTEN, |w| {
                w.planungsvorlauf_minuten
            })
    }
}

pub(crate) async fn load_einsatz_vorgabe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<EinsatzVorgabe, AppError> {
    Ok(EinsatzVorgabe {
        werte: schichtmodell_repo::load_einsatz_tx(conn, einsatz_id)
            .await?
            .map(|(w, _)| w),
        stil: crate::zeitdarstellung::zeitstil_laden(&mut *conn, einsatz_id).await?,
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
            .faelligkeit(beginn_at, vorgabe.stil.zone)
            .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{beginn_at}'"))),
        _ => Ok((faellig_oder_400(beginn_at, rhythmus)?, rhythmus)),
    }
}

/// Wie der Rhythmus einer Schicht im ETB heißt: bei Wechselzeiten aus der Einsatzvorgabe deren
/// Regel in der Darstellung des Einsatzes („Wechsel 0600/1800, Mindestdauer 4 h“), sonst die
/// Dauer („6 h“).
fn rhythmus_label(rhythmus: i64, quelle: RhythmusQuelle, vorgabe: &EinsatzVorgabe) -> String {
    match (quelle, &vorgabe.werte) {
        (RhythmusQuelle::Einsatz, Some(w)) if matches!(w.regel, Regel::Wechselzeiten { .. }) => {
            w.regel.text(vorgabe.stil.darstellung)
        }
        _ => rhythmus_text(rhythmus),
    }
}

/// Setzt die Auto-Fristen einer laufenden Schicht auf ihre Fälligkeit; die Vorwarnung liegt
/// die Vorwarnzeit davor, der Planungshinweis den Planungsvorlauf (beide aus dem Schichtmodell
/// des Einsatzes, [`set_planung_frist_tx`]). Liegt die Vorwarnzeit schon hinter `jetzt`, wird
/// eine offene Vorwarnung geschlossen statt verschoben — eine Vorwarnung in der Vergangenheit ist
/// keine mehr.
#[allow(clippy::too_many_arguments)]
async fn set_fristen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    vorgabe: &EinsatzVorgabe,
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
        vorgabe.vorwarnung(),
        jetzt,
    )
    .await?;
    set_planung_frist_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        faellig_at,
        vorgabe.planungsvorlauf(),
        jetzt,
    )
    .await
}

/// Ob für die Schicht eine Ablösung geplant ist: Einzelplanung, Ablöser-Liste oder ein
/// geplanter Besatzungswechsel (LLH-1319).
async fn has_planung_tx(conn: &mut SqliteConnection, id: i64) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_abloesung a WHERE a.id = ? \
           AND (a.abloesende_einheit_id IS NOT NULL \
                OR EXISTS (SELECT 1 FROM einsatz_abloesung_abloeser l \
                           WHERE l.abloesung_id = a.id) \
                OR EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung_plan p \
                           WHERE p.abloesung_id = a.id))",
    )
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.is_some())
}

/// Zeitpunkt des Planungshinweises: `planungsvorlauf_minuten` vor der Fälligkeit.
fn planungszeit(faellig_at: &str, planungsvorlauf_minuten: i64) -> Option<String> {
    crate::zeit::plus_minuten(faellig_at, -planungsvorlauf_minuten)
}

/// Setzt die Planungs-Frist einer laufenden Schicht (LLH-1131): `planungsvorlauf_minuten` vor
/// der Fälligkeit, aber nur, solange keine ablösende Einheit geplant ist und der Zeitpunkt noch
/// vor `jetzt` liegt; sonst wird eine offene geschlossen (wie die Vorwarnung). Der Hinweis kommt
/// damit einmal je Zustand: Planen schließt die Frist, eine aufgehobene oder entfallene Planung
/// setzt sie neu, eine neue Fälligkeit verschiebt sie.
#[allow(clippy::too_many_arguments)]
async fn set_planung_frist_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    planungsvorlauf_minuten: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    let zeit = planungszeit(faellig_at, planungsvorlauf_minuten).filter(|p| p.as_str() > jetzt);
    match zeit {
        Some(p) if !has_planung_tx(conn, id).await? => {
            erinnerung_repo::setze_auto_frist_tx(
                conn,
                einsatz_id,
                benutzer_id,
                OBJEKT_ABLOESUNG_PLANUNG,
                id,
                &format!("Keine ablösende Einheit geplant: {einheit_name}"),
                &p,
            )
            .await?;
        }
        _ => {
            erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id, jetzt)
                .await?;
        }
    }
    Ok(())
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
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id, jetzt).await?;
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id, jetzt).await
}

async fn delete_fristen_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG, id).await?;
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await?;
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id).await
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
/// Vollzug. Plant eine laufende Schicht sie als ablösende, entfällt die Planung mit Hinweis und
/// ETB ([`drop_planungen_tx`], LLH-1131), bevor ein FK `SET NULL` sie still leeren könnte;
/// Verweise abgelöster Schichten werden still geleert. Liefert, ob sich die Ablösung geändert
/// hat, und die Wirkung der entfallenen Planungen.
pub async fn release_einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(bool, Wirkung), AppError> {
    let wirkung = drop_planungen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        einheit_id,
        PlanungEntfallenGrund::Aufloesung,
        jetzt,
    )
    .await?;
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
    let geaendert = laufend.is_some() || geleert > 0 || !wirkung.is_empty();
    Ok((geaendert, wirkung))
}

/// Hebt jede Planung auf, mit der eine laufende Schicht `einheit_id` als ablösende Einheit
/// trägt (Einzelplanung und Ablöser-Liste), weil die Einheit aufgelöst oder entlassen ist
/// (LLH-1131, Spec `kraefte-abloesung` „Planung entfällt“): je Schicht ein ETB-Eintrag
/// „Ablösung «…»: Planung der ablösenden Einheit entfallen, «…» aufgelöst“, ein Hinweis
/// `abloeser_entfallen`, der Vermerk an der Schicht (LLH-1309, der jüngste gewinnt) und, ohne
/// verbleibende Planung, wieder die Planungs-Frist. Läuft in der Transaktion des Aufrufers.
pub(crate) async fn drop_planungen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    grund: PlanungEntfallenGrund,
    jetzt: &str,
) -> Result<Wirkung, AppError> {
    let schichten = hinweis::load_geplante_tx(conn, einsatz_id, einheit_id).await?;
    if schichten.is_empty() {
        return Ok(Wirkung::default());
    }
    let abloeser_name: String =
        sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
            .bind(einheit_id)
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
    let startwert = etb_startwert(&mut *conn, einsatz_id).await?;
    let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
    let mut wirkung = Wirkung::default();
    for id in schichten {
        sqlx::query(
            "UPDATE einsatz_abloesung SET abloesende_einheit_id = NULL \
             WHERE id = ? AND abloesende_einheit_id = ?",
        )
        .bind(id)
        .bind(einheit_id)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "DELETE FROM einsatz_abloesung_abloeser WHERE abloesung_id = ? AND einheit_id = ?",
        )
        .bind(id)
        .bind(einheit_id)
        .execute(&mut *conn)
        .await?;
        // Rückt ein weiterer Ablöser der Liste nach, wird er der Spiegel (LLH-1132).
        sync_spiegel_tx(conn, id).await?;
        // Vermerk für die Karte (LLH-1309); er zeigt sich nur, solange kein Ablöser bleibt.
        sqlx::query(
            "UPDATE einsatz_abloesung SET planung_entfallen_at = ?, planung_entfallen_grund = ?, \
                planung_entfallen_einheit_name = ? WHERE id = ?",
        )
        .bind(jetzt)
        .bind(grund.as_str())
        .bind(&abloeser_name)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        let (name, faellig_at): (String, String) = sqlx::query_as(
            "SELECT e.name, a.faellig_at FROM einsatz_abloesung a \
             JOIN einsatz_einheit e ON e.id = a.einheit_id WHERE a.id = ?",
        )
        .bind(id)
        .fetch_one(&mut *conn)
        .await?;
        set_planung_frist_tx(
            conn,
            einsatz_id,
            benutzer_id,
            id,
            &name,
            &faellig_at,
            vorgabe.planungsvorlauf(),
            jetzt,
        )
        .await?;
        wirkung.etb.push(
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                benutzer_id,
                startwert,
                &format!(
                    "Ablösung «{name}»: Planung der ablösenden Einheit entfallen, \
                     «{abloeser_name}» {}",
                    grund.partizip()
                ),
            )
            .await?,
        );
        wirkung.anlaesse.push(hinweis::anlass(
            einsatz_id,
            id,
            BenachrichtigungBezugTyp::AbloeserEntfallen,
            benutzer_id,
        ));
    }
    Ok(wirkung)
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
    beginn_quelle: BeginnQuelle,
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
             faellig_at, vorgaenger_id, angelegt_von_id, beginn_quelle) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
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
    .bind(beginn_quelle.as_str())
    .fetch_one(&mut *conn)
    .await?;
    set_fristen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        &faellig_at,
        vorgabe,
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
                beginn_quelle: BeginnQuelle::Hand,
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
    /// Herkunft an der Schicht (LLH-1312): `hand` oder `eintreffen`.
    pub beginn_quelle: BeginnQuelle,
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
        s.beginn_quelle,
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

        // Geplanter Besatzungswechsel (LLH-1319): eine Liste von Personen mit Ziel; ein Ziel gleich
        // der Einheit der Schicht steht als „kein Ziel“.
        let neuer_plan = match &eingabe.besatzung_plan {
            Some(neu) => {
                let neu: Vec<BesatzungZiel> = neu
                    .iter()
                    .map(|z| BesatzungZiel {
                        einheit_id: z.einheit_id.filter(|e| *e != roh.einheit_id),
                        ..*z
                    })
                    .collect();
                let bisher = load_besatzung_plan_tx(conn, id).await?;
                if neu == bisher {
                    None
                } else {
                    let geprueft = if neu.is_empty() {
                        Vec::new()
                    } else {
                        let g = load_gliederung(&mut *conn, einsatz_id).await?;
                        let einheiten: Vec<i64> = std::iter::once(roh.einheit_id)
                            .chain(erben_von(&g, roh.einheit_id))
                            .collect();
                        check_neue_besatzung_tx(conn, einsatz_id, &einheiten, &neu).await?
                    };
                    let gleiche_personen = {
                        let mut a: Vec<i64> = neu.iter().map(|z| z.personal_id).collect();
                        let mut b: Vec<i64> = bisher.iter().map(|z| z.personal_id).collect();
                        a.sort_unstable();
                        b.sort_unstable();
                        a == b
                    };
                    teile.push(if geprueft.is_empty() {
                        "Planung des Besatzungswechsels aufgehoben".into()
                    } else if gleiche_personen {
                        "Besatzungswechsel umgeplant".into()
                    } else {
                        format!(
                            "Besatzungswechsel geplant, neu {}",
                            personen_text(geprueft.iter().map(|p| p.name.as_str()))
                        )
                    });
                    Some(neu)
                }
            }
            None => None,
        };
        // Eine Planung je Schicht: Ablöser oder Besatzungswechsel (design.md D1).
        let hat_abloeser = match neue_abloeser {
            Some(neu) => !neu.is_empty(),
            None => !load_abloeser_ids_tx(conn, id).await?.is_empty(),
        };
        let hat_plan = match &neuer_plan {
            Some(neu) => !neu.is_empty(),
            None => !load_besatzung_plan_tx(conn, id).await?.is_empty(),
        };
        if hat_abloeser && hat_plan {
            return Err(AppError::UnprocessableEntity(
                "Geplant ist entweder eine Ablösung durch Einheiten oder ein Besatzungswechsel"
                    .into(),
            ));
        }

        if teile.is_empty() {
            return Ok(None);
        }
        // Ein geänderter Beginn ist nicht mehr das Eintreffen: die Schicht gilt danach als von Hand
        // begonnen; eine Folgeschicht bleibt Folgeschicht (LLH-1312, design.md D2).
        sqlx::query(
            "UPDATE einsatz_abloesung SET beginn_at = ?, rhythmus_minuten = ?, \
                rhythmus_quelle = ?, faellig_at = ?, \
                beginn_quelle = CASE WHEN ? AND beginn_quelle = 'eintreffen' THEN 'hand' \
                    ELSE beginn_quelle END \
             WHERE id = ?",
        )
        .bind(&beginn_at)
        .bind(rhythmus)
        .bind(quelle.as_str())
        .bind(&faellig_at)
        .bind(beginn_at != roh.beginn_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        let abloeser_geaendert = neue_abloeser.is_some() || neuer_plan.is_some();
        if let Some(neu) = neue_abloeser {
            set_abloeser_tx(conn, id, neu).await?;
        }
        if let Some(neu) = &neuer_plan {
            set_besatzung_plan_tx(conn, id, neu).await?;
        }
        if faellig_at != roh.faellig_at {
            set_fristen_tx(
                conn,
                einsatz_id,
                benutzer_id,
                id,
                &name,
                &faellig_at,
                &vorgabe,
                jetzt,
            )
            .await?;
        } else if abloeser_geaendert {
            // Geplant schließt den Planungshinweis, aufgehoben setzt ihn wieder (LLH-1131).
            set_planung_frist_tx(
                conn,
                einsatz_id,
                benutzer_id,
                id,
                &name,
                &faellig_at,
                vorgabe.planungsvorlauf(),
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
            let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
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
                    &vorgabe,
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
            stil: vorher.stil,
        };
        let vorwarnung_geaendert = vorgabe.vorwarnung() != vorher.vorwarnung();
        let planungsvorlauf_geaendert = vorgabe.planungsvorlauf() != vorher.planungsvorlauf();

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
                    &vorgabe,
                    jetzt,
                )
                .await?;
            } else if vorwarnung_geaendert || planungsvorlauf_geaendert {
                // Nur die geänderte Vorlauf-Frist wandert; die Fälligkeitsfrist bleibt (Review
                // PR #833), eine schon ausgelöste andere auch.
                let (name, _) = einheit_tx(conn, einsatz_id, s.einheit_id).await?;
                if vorwarnung_geaendert {
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
                if planungsvorlauf_geaendert {
                    set_planung_frist_tx(
                        conn,
                        einsatz_id,
                        benutzer_id,
                        s.id,
                        &name,
                        &faellig_at,
                        vorgabe.planungsvorlauf(),
                        jetzt,
                    )
                    .await?;
                }
            }
        }

        let darstellung = vorher.stil.darstellung;
        let beschreibung =
            |w: &Werte| format!("«{}», {}", w.bezeichnung, modell_text(w, darstellung));
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

/// Ein Schichtmodell im ETB: Regel und Vorwarnung („Rhythmus 12 h, Vorwarnung 30 min“), die
/// Wechselzeiten in der Darstellung des Einsatzes.
fn modell_text(w: &Werte, darstellung: Zeitdarstellung) -> String {
    format!(
        "{}, Vorwarnung {}",
        w.regel.text(darstellung),
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

/// Was Vollzug und Rücknahme in der Transaktion brauchen.
struct Vorgang<'a> {
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &'a str,
}

/// Vollzieht eine laufende Schicht (LLH-1132, LLH-1150). Gemeinsam ist beiden Arten: die Schicht
/// wird `abgeloest`, ihre Fristen schließen, und ein ETB-Eintrag nennt, was geschah.
///
/// **Ganze Einheit** ([`AbloesungArt::Einheit`]): die Ablöser kommen als Liste und werden zur Liste
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
///
/// **Besatzungswechsel** ([`AbloesungArt::Besatzung`], [`vollziehen_besatzung_tx`]): die
/// Einheit, ihr Fahrzeug und ihr Abschnitt bleiben; nur das Personal wechselt.
pub async fn vollziehen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    eingabe: &VollzugEingabe,
    jetzt: &str,
) -> Result<(AbloesungVollzugAnzeige, i64, VollzugWirkung), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let vollzogen_at = eingabe.vollzogen_at.as_str();
    let vorgang = Vorgang {
        einsatz_id,
        id,
        benutzer_id,
        jetzt,
    };
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
        // Die Planung für die Rücknahme sichern, bevor der Vollzug die Liste ersetzt (LLH-1319).
        save_planung_tx(conn, id).await?;
        let (folge_ids, inhalt, wirkung) = match eingabe.art {
            AbloesungArt::Einheit => vollziehen_einheit_tx(conn, &vorgang, &roh, eingabe).await?,
            AbloesungArt::Besatzung => {
                vollziehen_besatzung_tx(conn, &vorgang, &roh, vollzogen_at, &eingabe.besatzung)
                    .await?
            }
        };
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

/// Die Untereinheiten, die die laufende Schicht der Einheit `traeger` gerade erben, nach ID —
/// aus einer schon geladenen Gliederung.
fn erben_von(g: &Gliederung, traeger: i64) -> Vec<i64> {
    let mut erben: Vec<i64> = vererbung(&g.ueber, &g.mit_schicht)
        .into_iter()
        .filter_map(|(erbe, t)| (t == traeger).then_some(erbe))
        .collect();
    erben.sort_unstable();
    erben
}

/// Vollzug als Ablösung der ganzen Einheit (siehe [`vollziehen`]). Liefert die Folgeschichten,
/// den ETB-Text und die Wirkung außerhalb der Ablösung.
async fn vollziehen_einheit_tx(
    conn: &mut SqliteConnection,
    v: &Vorgang<'_>,
    roh: &Roh,
    eingabe: &VollzugEingabe,
) -> Result<(Vec<i64>, String, VollzugWirkung), AppError> {
    let Vorgang {
        einsatz_id,
        id,
        benutzer_id,
        jetzt,
    } = *v;
    let vollzogen_at = eingabe.vollzogen_at.as_str();
    let (name, abschnitt_vorher) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
    let abloeser = check_abloeser_tx(conn, einsatz_id, roh.einheit_id, &eingabe.abloeser).await?;

    // Vor jedem Schreiben: Knoten der Ablöser und Erben der abgelösten Schicht.
    let g = load_gliederung(&mut *conn, einsatz_id).await?;
    let menge: HashSet<i64> = abloeser.iter().map(|a| a.id).collect();
    let knoten: Vec<&Abloeser> = abloeser
        .iter()
        .filter(|a| !has_vorfahr_in(&g.ueber, a.id, &menge))
        .collect();
    let erben = erben_von(&g, roh.einheit_id);
    // Übergeben wird nur, was es gibt: ein Abschnitt und mindestens ein Knoten-Ablöser.
    let uebergabe = abschnitt_vorher.filter(|_| eingabe.abschnitt_uebergeben && !knoten.is_empty());

    let verbleib_br_id = match eingabe.verbleib {
        AbloesungVerbleib::Bereitstellungsraum => eingabe.verbleib_br_id,
        AbloesungVerbleib::Ruhe | AbloesungVerbleib::Entlassen => None,
    };
    // Der Raum des Verbleibs vor jedem Schreiben (LLH-1308, design.md D4).
    let verbleib_br = match verbleib_br_id {
        Some(br_id) => Some(check_verbleib_raum_tx(conn, einsatz_id, br_id, roh.einheit_id).await?),
        None => None,
    };
    // Die Schicht ist `abgeloest`, BEVOR die Zeitachse schreibt: so findet die Kopplung „Ende mit
    // der Entlassung“ (LLH-1128) beim Verbleib „entlassen“ keine laufende Schicht und beendet
    // nichts ein zweites Mal (LLH-1308, design.md D3).
    sqlx::query(
        "UPDATE einsatz_abloesung SET status = 'abgeloest', vollzogen_at = ?, \
            vollzogen_von_id = ?, abschnitt_uebergeben = ?, \
            abgeloest_abschnitt_vorher_id = ?, verbleib = ?, verbleib_br_id = ? WHERE id = ?",
    )
    .bind(vollzogen_at)
    .bind(benutzer_id)
    .bind(uebergabe.is_some())
    .bind(uebergabe)
    .bind(eingabe.verbleib.as_str())
    .bind(verbleib_br_id)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    set_abloeser_tx(conn, id, &eingabe.abloeser).await?;
    close_fristen_tx(conn, id, jetzt).await?;

    // LFH-552/LLH-1132: der Vollzug beendet die Einsatzperiode der abgelösten Einheit und
    // jeder erbenden Untereinheit (je samt Fan-out); ohne offene Periode bleibt die jeweilige
    // Zeitachse unberührt. Mit dem Verbleib „entlassen“ endet sie mit der Entlassung statt der
    // Ablösung (LLH-1308, design.md D2).
    let ende = ende_art(eingabe.verbleib);
    let mut wirkung = VollzugWirkung::default();
    for einheit in std::iter::once(roh.einheit_id).chain(erben.iter().copied()) {
        if let Some(w) = crate::zeitachse::repo::vollzug_ende_tx(
            conn,
            einsatz_id,
            benutzer_id,
            einheit,
            ende,
            vollzogen_at,
        )
        .await?
        {
            wirkung.kopplung.append(Wirkung {
                etb: w.1.abloesung.clone(),
                anlaesse: w.1.hinweise.clone(),
            });
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
                    BeginnQuelle::Vollzug,
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
        .bind(crate::kraefte_disposition::ids_json(&knoten_ids))
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

    // LLH-1308 (design.md D4/D5): Belegungsbuchungen im Bereitstellungsraum. Alles, was dieser
    // Vollzug dort bucht, hat eine id über `marke`; die Liste der Schicht hält sie für die
    // Rücknahme fest.
    let marke: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(id), 0) FROM br_belegung")
        .fetch_one(&mut *conn)
        .await?;
    let br_saetze =
        abloeser_ausruecken_tx(conn, einsatz_id, benutzer_id, &abloeser, &mut wirkung).await?;
    let verbleib_satz = match (eingabe.verbleib, verbleib_br_id.zip(verbleib_br)) {
        (AbloesungVerbleib::Bereitstellungsraum, Some((br_id, bezeichnung))) => {
            verbleib_eintritt_tx(conn, einsatz_id, benutzer_id, br_id, roh.einheit_id).await?;
            wirkung.raeume.push(br_id);
            wirkung.einheiten.push(roh.einheit_id);
            Some(format!(
                " «{name}» danach in Bereitstellungsraum {bezeichnung}."
            ))
        }
        (AbloesungVerbleib::Entlassen, _) => Some(format!(" «{name}» danach entlassen.")),
        _ => None,
    };
    sqlx::query(
        "INSERT INTO einsatz_abloesung_br_buchung (abloesung_id, belegung_id) \
         SELECT ?, id FROM br_belegung \
         WHERE id > ? AND einsatz_id = ? AND art IN ('eintritt', 'austritt') ORDER BY id",
    )
    .bind(id)
    .bind(marke)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;

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
    let inhalt = vollzug_inhalt_gekappt(
        inhalt,
        &br_saetze,
        verbleib_satz.as_deref(),
        crate::etb::INHALT_MAX,
    );
    Ok((folge_ids, inhalt, wirkung))
}

/// Hängt die Sätze der aus einem Raum ausgerückten Ablöser und den Verbleib an den ETB-Text des
/// Vollzugs, so dass er höchstens `max` Zeichen lang bleibt (`src/AGENTS.md`, Eingabegrenzen):
/// passt ein Raum-Satz nicht mehr, fällt er mit allen folgenden weg, ein Zählsatz nennt ihre
/// Anzahl. Der Verbleib bleibt immer stehen; ein Systemtext darf nicht scheitern.
fn vollzug_inhalt_gekappt(
    mut inhalt: String,
    br_saetze: &[String],
    verbleib_satz: Option<&str>,
    max: usize,
) -> String {
    let verbleib_len = verbleib_satz.map_or(0, |s| s.chars().count());
    let zaehlsatz = |n: usize| {
        if n == 1 {
            " 1 weitere ablösende Einheit aus einem Bereitstellungsraum ausgerückt.".to_string()
        } else {
            format!(" {n} weitere ablösende Einheiten aus Bereitstellungsräumen ausgerückt.")
        }
    };
    let mut laenge = inhalt.chars().count();
    for (i, satz) in br_saetze.iter().enumerate() {
        let teil = satz.chars().count() + 2;
        let weitere = br_saetze.len() - i - 1;
        let danach = if weitere > 0 {
            zaehlsatz(weitere).chars().count()
        } else {
            0
        };
        if laenge + teil + danach + verbleib_len > max {
            inhalt.push_str(&zaehlsatz(br_saetze.len() - i));
            break;
        }
        inhalt.push(' ');
        inhalt.push_str(satz);
        inhalt.push('.');
        laenge += teil;
    }
    if let Some(satz) = verbleib_satz {
        inhalt.push_str(satz);
    }
    inhalt
}

/// Das Ende-Ereignis der Zeitachse zum Verbleib (LLH-1308, design.md D2): „entlassen“ endet mit
/// der Entlassung, Ruhe und Bereitstellungsraum mit der Ablösung.
fn ende_art(verbleib: AbloesungVerbleib) -> crate::zeitachse::ZeitachseArt {
    match verbleib {
        AbloesungVerbleib::Entlassen => crate::zeitachse::ZeitachseArt::Entlassung,
        AbloesungVerbleib::Ruhe | AbloesungVerbleib::Bereitstellungsraum => {
            crate::zeitachse::ZeitachseArt::Abloesung
        }
    }
}

/// Ablöser, die beim Vollzug in einem Bereitstellungsraum stehen, rücken aus (LLH-1308,
/// design.md D5, Entscheidung 31.10.2026): nicht abgerufen → Abruf mit Ausrücken über
/// [`crate::bereitstellungsraum::abruf::abruf_tx`] (ohne Abschnitt, ohne Auftrag, der Verband
/// geht mit), schon abgerufen → nur der Austritt über `belege_tx` (das Ausrücken samt
/// Mitgenommenen). In der Reihenfolge der Liste; wer mit einem Vorgänger ausgerückt ist, steht in
/// keinem Raum mehr und wird übersprungen. Keine eigene Freigabe des Moduls
/// Bereitstellungsräume: der Abruf ist Folge des Vollzugs. Liefert je Abruf einen Teilsatz für den
/// einen ETB-Eintrag des Vollzugs (`abruf_tx` schreibt kein ETB).
async fn abloeser_ausruecken_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    abloeser: &[Abloeser],
    wirkung: &mut VollzugWirkung,
) -> Result<Vec<String>, AppError> {
    use crate::bereitstellungsraum::abruf::{abruf_tx, AbrufDaten, Startwerte};
    use crate::bereitstellungsraum::belegung_repo::{self, Buchung};
    use crate::bereitstellungsraum::{BrBelegungsArt, ObjektTyp};
    let mut saetze = Vec::new();
    for a in abloeser {
        let raum: Option<i64> = sqlx::query_scalar(
            "SELECT aktueller_br_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
        )
        .bind(a.id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .flatten();
        let Some(br_id) = raum else {
            continue;
        };
        let bezeichnung: String =
            sqlx::query_scalar("SELECT bezeichnung FROM bereitstellungsraum WHERE id = ?")
                .bind(br_id)
                .fetch_one(&mut *conn)
                .await?;
        let abgerufen = belegung_repo::offener_abruf_tx(
            &mut *conn,
            einsatz_id,
            ObjektTyp::Einheit,
            a.id,
            br_id,
        )
        .await?
        .is_some();
        let mitgenommen = if abgerufen {
            let belegt = belegung_repo::belege_tx(
                &mut *conn,
                einsatz_id,
                br_id,
                ObjektTyp::Einheit,
                a.id,
                &Buchung {
                    art: BrBelegungsArt::Austritt,
                    notiz: None,
                    client_id: None,
                    zeitpunkt_at: None,
                },
                benutzer_id,
            )
            .await?;
            let namen: Vec<String> = belegt
                .mitgenommen
                .iter()
                .map(|(_, n)| format!("«{n}»"))
                .collect();
            saetze.push(crate::bereitstellungsraum::etb_text_ausgerueckt(
                &format!("«{}»", a.name),
                &namen,
                &bezeichnung,
                None,
            ));
            belegt.mitgenommen
        } else {
            // Ohne Auftrag braucht der Abruf keine Startwerte (`abruf_tx` legt dann nichts an).
            let startwerte = Startwerte {
                auftrag: 0,
                etb: 0,
                auto_etb: false,
            };
            let ergebnis = abruf_tx(
                &mut *conn,
                einsatz_id,
                br_id,
                &AbrufDaten {
                    objekt_typ: ObjektTyp::Einheit,
                    objekt_id: a.id,
                    abschnitt: None,
                    auftrag: None,
                    ausgerueckt: true,
                },
                startwerte,
                benutzer_id,
            )
            .await?;
            let namen: Vec<String> = ergebnis
                .mitgenommen
                .iter()
                .map(|(_, n)| format!("«{n}»"))
                .collect();
            saetze.push(crate::bereitstellungsraum::etb_text_abruf(
                &crate::bereitstellungsraum::AbrufText {
                    name: &format!("«{}»", a.name),
                    mitgenommen: &namen,
                    br_bezeichnung: &bezeichnung,
                    ziel: None,
                    auftrag_nr: None,
                    ausgerueckt: true,
                },
            ));
            ergebnis.mitgenommen
        };
        wirkung.raeume.push(br_id);
        wirkung.einheiten.push(a.id);
        wirkung
            .einheiten
            .extend(mitgenommen.into_iter().map(|(id, _)| id));
    }
    Ok(saetze)
}

/// Prüft den Raum des Verbleibs vor jedem Schreiben (LLH-1308, design.md D4): fremder oder
/// unbekannter Raum → 404, nicht aktiv oder storniert → 422, die abgelöste Einheit steht schon in
/// einem Raum → 422. Liefert die Bezeichnung des Raums. `belege_tx` prüft beim Buchen noch
/// einmal; so bricht jeder Fehler den ganzen Vollzug, nichts bleibt halb geschrieben.
async fn check_verbleib_raum_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    einheit_id: i64,
) -> Result<String, AppError> {
    let br = crate::bereitstellungsraum::belegung_repo::require_belegbar_tx(
        &mut *conn, einsatz_id, br_id,
    )
    .await?;
    let schon: Option<String> = sqlx::query_scalar(
        "SELECT r.bezeichnung FROM einsatz_einheit e \
         JOIN bereitstellungsraum r ON r.id = e.aktueller_br_id \
         WHERE e.id = ? AND e.einsatz_id = ?",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(raum) = schon {
        return Err(AppError::UnprocessableEntity(format!(
            "Die abgelöste Einheit steht schon im Bereitstellungsraum {raum}"
        )));
    }
    Ok(br.bezeichnung)
}

/// Eintritt der abgelösten Einheit in den Raum ihres Verbleibs (LLH-1308, design.md D4) über
/// `belege_tx`, nach [`check_verbleib_raum_tx`].
async fn verbleib_eintritt_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    br_id: i64,
    einheit_id: i64,
) -> Result<(), AppError> {
    use crate::bereitstellungsraum::belegung_repo::{self, Buchung};
    use crate::bereitstellungsraum::{BrBelegungsArt, ObjektTyp};
    belegung_repo::belege_tx(
        &mut *conn,
        einsatz_id,
        br_id,
        ObjektTyp::Einheit,
        einheit_id,
        &Buchung {
            art: BrBelegungsArt::Eintritt,
            notiz: None,
            client_id: None,
            zeitpunkt_at: None,
        },
        benutzer_id,
    )
    .await?;
    Ok(())
}

/// Eine Person der neuen Besatzung nach der Prüfung.
#[derive(Debug, Clone)]
struct NeuePerson {
    id: i64,
    name: String,
    /// Ihre bisherige Einheit (keine = `None`).
    einheit_id: Option<i64>,
    /// Ihr bisheriges Fahrzeug (keins = `None`).
    fahrzeug_id: Option<i64>,
    /// Wohin der Wechsel sie verteilt (LLH-1319): die Einheit der Schicht oder eine erbende
    /// Untereinheit, mit Namen für den ETB-Text.
    ziel_einheit: i64,
    ziel_einheit_name: String,
    /// Das Ziel-Fahrzeug samt Funkrufnamen; `None` = ihr Fahrzeug bleibt.
    ziel_fahrzeug: Option<(i64, String)>,
}

/// Prüft die neue Besatzung samt Verteilung (LLH-1150, LLH-1319) mit EINER Abfrage über
/// `json_each` (`src/AGENTS.md`, „Eingabegrenzen“), in dieser Reihenfolge je Person: fremd oder
/// unbekannt → 404, entlassen oder storniert → 409 (wie
/// `personal::disposition_repo::require_nicht_beendet`), schon in der bisherigen Besatzung
/// (`einheiten`: die Einheit und ihre Erben) → 422, Führung einer anderen aktiven Einheit → 422
/// (die neue Besatzung nimmt niemandem die Führung); Ziel-Einheit außerhalb von `einheiten` → 422;
/// Ziel-Fahrzeug fremd oder unbekannt → 404, entlassen oder storniert → 409, keiner dieser
/// Einheiten zugeordnet → 422. Ohne Ziel-Einheit gilt `einheiten[0]` (die Einheit der Schicht).
/// Liefert die Personen in der Reihenfolge der Liste.
async fn check_neue_besatzung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheiten: &[i64],
    ziele: &[BesatzungZiel],
) -> Result<Vec<NeuePerson>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Pruefung {
        id: i64,
        name: Option<String>,
        einheit_id: Option<i64>,
        fahrzeug_id: Option<i64>,
        beendet_als: Option<String>,
        beendet: bool,
        in_besatzung: bool,
        fuehrt: Option<String>,
        ziel_einheit: i64,
        ziel_einheit_name: Option<String>,
        ziel_einheit_passt: bool,
        ziel_fahrzeug: Option<i64>,
        fahrzeug_bekannt: bool,
        fahrzeug_beendet_als: Option<String>,
        fahrzeug_passt: bool,
        funkrufname: String,
    }
    let Some(&selbst) = einheiten.first() else {
        return Ok(Vec::new());
    };
    let json = ziele_json(ziele)?;
    let zeilen: Vec<Pruefung> = sqlx::query_as(
        "SELECT json_extract(j.value, '$.p') AS id, p.snap_name AS name, p.einheit_id, \
                p.fahrzeug_id, p.beendet_als, p.beendet_at IS NOT NULL AS beendet, \
                COALESCE(p.einheit_id IN (SELECT value FROM json_each(?3)), 0) AS in_besatzung, \
                (SELECT e.name FROM einsatz_einheit e \
                 WHERE e.fuehrer_id = p.id AND e.aufgeloest_at IS NULL \
                   AND e.id NOT IN (SELECT value FROM json_each(?3)) \
                 ORDER BY e.id LIMIT 1) AS fuehrt, \
                COALESCE(json_extract(j.value, '$.e'), ?4) AS ziel_einheit, \
                ze.name AS ziel_einheit_name, \
                COALESCE(json_extract(j.value, '$.e'), ?4) IN (SELECT value FROM json_each(?3)) \
                   AS ziel_einheit_passt, \
                json_extract(j.value, '$.f') AS ziel_fahrzeug, \
                zf.id IS NOT NULL AS fahrzeug_bekannt, zf.beendet_als AS fahrzeug_beendet_als, \
                COALESCE(zf.einheit_id IN (SELECT value FROM json_each(?3)), 0) AS fahrzeug_passt, \
                coalesce(fz.funkrufname, zf.snap_funkrufname, '') AS funkrufname \
         FROM json_each(?1) j \
         LEFT JOIN einsatz_personal p ON p.id = json_extract(j.value, '$.p') AND p.einsatz_id = ?2 \
         LEFT JOIN einsatz_einheit ze \
                ON ze.id = COALESCE(json_extract(j.value, '$.e'), ?4) AND ze.einsatz_id = ?2 \
         LEFT JOIN einsatz_fahrzeug zf \
                ON zf.id = json_extract(j.value, '$.f') AND zf.einsatz_id = ?2 \
         LEFT JOIN fahrzeug fz ON fz.id = zf.fahrzeug_id \
         ORDER BY j.key",
    )
    .bind(json)
    .bind(einsatz_id)
    .bind(crate::kraefte_disposition::ids_json(einheiten))
    .bind(selbst)
    .fetch_all(&mut *conn)
    .await?;
    let einheit_name: String = sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ?")
        .bind(selbst)
        .fetch_one(&mut *conn)
        .await?;
    zeilen
        .into_iter()
        .map(|z| {
            let Some(name) = z.name else {
                return Err(AppError::NotFound);
            };
            if z.beendet {
                return Err(crate::personal::disposition_repo::beendet_conflict(
                    z.beendet_als.as_deref().unwrap_or_default(),
                ));
            }
            if z.in_besatzung {
                return Err(AppError::UnprocessableEntity(format!(
                    "«{name}» gehört schon zur bisherigen Besatzung"
                )));
            }
            if let Some(einheit) = z.fuehrt {
                return Err(AppError::UnprocessableEntity(format!(
                    "«{name}» führt die Einheit «{einheit}»"
                )));
            }
            let ziel_einheit_name = match (z.ziel_einheit_passt, z.ziel_einheit_name) {
                (true, Some(n)) => n,
                _ => {
                    return Err(AppError::UnprocessableEntity(format!(
                        "«{name}»: die Ziel-Einheit gehört nicht zu «{einheit_name}» oder ihren \
                         Untereinheiten"
                    )))
                }
            };
            let ziel_fahrzeug = match z.ziel_fahrzeug {
                None => None,
                Some(_) if !z.fahrzeug_bekannt => return Err(AppError::NotFound),
                Some(_) if z.fahrzeug_beendet_als.is_some() => {
                    return Err(crate::fahrzeug::disposition_repo::beendet_conflict(
                        z.fahrzeug_beendet_als.as_deref().unwrap_or_default(),
                    ))
                }
                Some(_) if !z.fahrzeug_passt => {
                    return Err(AppError::UnprocessableEntity(format!(
                        "«{name}»: das Fahrzeug «{}» gehört nicht zu «{einheit_name}» oder ihren \
                         Untereinheiten",
                        z.funkrufname
                    )))
                }
                Some(f) => Some((f, z.funkrufname)),
            };
            Ok(NeuePerson {
                id: z.id,
                name,
                einheit_id: z.einheit_id,
                fahrzeug_id: z.fahrzeug_id,
                ziel_einheit: z.ziel_einheit,
                ziel_einheit_name,
                ziel_fahrzeug,
            })
        })
        .collect()
}

/// Schreibt ein Ereignis der Person aus dem Besatzungswechsel (Quelle `abloesung`) über den
/// einzigen Schreibpfad. Liefert seine ID; `None`, wenn die Perioden-Regeln es auslassen (ohne
/// offene Periode keine Ablösung, mit offener kein zweites Eintreffen) — der Vollzug gelingt
/// trotzdem.
async fn besatzung_ereignis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    person: i64,
    art: crate::zeitachse::ZeitachseArt,
    zeitpunkt_at: &str,
) -> Result<Option<i64>, AppError> {
    use crate::zeitachse::repo::{schreibe_tx, Kraft, Neu, Schreibergebnis};
    let (r, _) = schreibe_tx(
        conn,
        einsatz_id,
        benutzer_id,
        Kraft::Person(person),
        Neu {
            art,
            zeitpunkt_at,
            quelle: crate::zeitachse::ZeitachseQuelle::Abloesung,
            notiz: None,
        },
    )
    .await?;
    Ok(match r {
        Schreibergebnis::Geschrieben(z) => Some(z),
        Schreibergebnis::Ausgelassen(_) => None,
    })
}

/// Die neue Besatzung für den ETB-Text (LLH-1319): „«A» (Gruppe 1, Florian 1-44), «B»“; die
/// Klammer nennt nur, was von der Vorgabe abweicht (eine andere Einheit als `selbst`, ein
/// Fahrzeug). Ohne Person „keine“.
fn verteilung_text(neu: &[NeuePerson], selbst: i64) -> String {
    if neu.is_empty() {
        return "keine".into();
    }
    neu.iter()
        .map(|p| {
            let mut wohin: Vec<&str> = Vec::new();
            if p.ziel_einheit != selbst {
                wohin.push(&p.ziel_einheit_name);
            }
            if let Some((_, f)) = &p.ziel_fahrzeug {
                wohin.push(f);
            }
            if wohin.is_empty() {
                format!("«{}»", p.name)
            } else {
                format!("«{}» ({})", p.name, wohin.join(", "))
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Namen für ETB-Texte: „«A», «B»“, ohne einen „keine“.
fn personen_text<'a>(namen: impl Iterator<Item = &'a str>) -> String {
    let text = namen
        .map(|n| format!("«{n}»"))
        .collect::<Vec<_>>()
        .join(", ");
    if text.is_empty() {
        "keine".into()
    } else {
        text
    }
}

/// Vollzug als Besatzungswechsel (LLH-1150, Entscheidung LLH-1118 Punkt 4): die Einheit, ihr
/// Fahrzeug und ihr Abschnitt bleiben, die Folgeschicht hängt an derselben Einheit (Beginn =
/// Vollzug, Rhythmus und Einsatzstelle der abgelösten Schicht). Die alte Besatzung ist die
/// Personalzuordnung der Einheit und jeder Untereinheit, die ihre Schicht erbt (Knoten-Modell,
/// dieselbe Menge wie der Fan-out der ganzen Einheit); jede Person geht aus ihrer Einheit, von
/// einem Fahrzeug dieser Einheiten und aus deren Führung und bekommt das Ereignis `abloesung`.
/// Die neue Besatzung kommt in die Einheit selbst und bekommt `eintreffen`; die Einheiten selbst
/// bekommen kein Ereignis, ihre Periode läuft weiter. Keine Grenzwerte, keine Ruhezeitrechnung
/// (LFH-860). Was die Rücknahme braucht, steht in `einsatz_abloesung_besatzung`.
///
/// LLH-1319: die neue Besatzung kommt je Person in ihre Ziel-Einheit (die Einheit oder eine
/// erbende Untereinheit) und, mit Ziel-Fahrzeug, auf dieses; die Zeile hält Ziel und vorheriges
/// Fahrzeug für die Rücknahme.
async fn vollziehen_besatzung_tx(
    conn: &mut SqliteConnection,
    v: &Vorgang<'_>,
    roh: &Roh,
    vollzogen_at: &str,
    ziele: &[BesatzungZiel],
) -> Result<(Vec<i64>, String, VollzugWirkung), AppError> {
    use crate::zeitachse::ZeitachseArt;
    let Vorgang {
        einsatz_id,
        id,
        benutzer_id,
        jetzt,
    } = *v;
    let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
    let g = load_gliederung(&mut *conn, einsatz_id).await?;
    let einheiten: Vec<i64> = std::iter::once(roh.einheit_id)
        .chain(erben_von(&g, roh.einheit_id))
        .collect();
    let einheiten_json = crate::kraefte_disposition::ids_json(&einheiten);
    let neu = check_neue_besatzung_tx(conn, einsatz_id, &einheiten, ziele).await?;

    // Die alte Besatzung, wie der Vollzug sie vorfindet: das Fahrzeug nur, wenn es einer dieser
    // Einheiten gehört, die Führung nur die der eigenen Einheit.
    let alt: Vec<(i64, String, i64, Option<i64>, bool)> = sqlx::query_as(
        "SELECT p.id, p.snap_name, p.einheit_id, \
                (SELECT f.id FROM einsatz_fahrzeug f WHERE f.id = p.fahrzeug_id \
                   AND f.einheit_id IN (SELECT value FROM json_each(?2))), \
                EXISTS (SELECT 1 FROM einsatz_einheit e \
                        WHERE e.id = p.einheit_id AND e.fuehrer_id = p.id) \
         FROM einsatz_personal p \
         WHERE p.einsatz_id = ?1 AND p.beendet_at IS NULL \
           AND p.einheit_id IN (SELECT value FROM json_each(?2)) \
         ORDER BY p.id",
    )
    .bind(einsatz_id)
    .bind(&einheiten_json)
    .fetch_all(&mut *conn)
    .await?;

    sqlx::query(
        "UPDATE einsatz_abloesung SET status = 'abgeloest', vollzogen_at = ?, \
            vollzogen_von_id = ?, art = ?, abschnitt_uebergeben = 0, \
            abgeloest_abschnitt_vorher_id = NULL WHERE id = ?",
    )
    .bind(vollzogen_at)
    .bind(benutzer_id)
    .bind(AbloesungArt::Besatzung.as_str())
    .bind(id)
    .execute(&mut *conn)
    .await?;
    // Beim Vollzug genannt wird keine ablösende Einheit (die Liste nennt die beim Vollzug
    // genannten, LLH-1132).
    set_abloeser_tx(conn, id, &[]).await?;
    close_fristen_tx(conn, id, jetzt).await?;

    let zeile = "INSERT INTO einsatz_abloesung_besatzung \
            (abloesung_id, personal_id, rolle, einheit_vorher_id, fahrzeug_vorher_id, \
             war_fuehrer, zeitachse_id, einheit_nachher_id, fahrzeug_nachher_id) \
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    for (person, _, einheit, fahrzeug, fuehrer) in &alt {
        let z = besatzung_ereignis_tx(
            conn,
            einsatz_id,
            benutzer_id,
            *person,
            ZeitachseArt::Abloesung,
            vollzogen_at,
        )
        .await?;
        sqlx::query(zeile)
            .bind(id)
            .bind(person)
            .bind(BesatzungRolle::Alt.as_str())
            .bind(einheit)
            .bind(fahrzeug)
            .bind(fuehrer)
            .bind(z)
            .bind(None::<i64>)
            .bind(None::<i64>)
            .execute(&mut *conn)
            .await?;
    }
    for p in &neu {
        let z = besatzung_ereignis_tx(
            conn,
            einsatz_id,
            benutzer_id,
            p.id,
            ZeitachseArt::Eintreffen,
            vollzogen_at,
        )
        .await?;
        // Das vorherige Fahrzeug zählt nur, wenn der Wechsel ihr eines gibt (LLH-1319).
        let ziel_fahrzeug = p.ziel_fahrzeug.as_ref().map(|(f, _)| *f);
        sqlx::query(zeile)
            .bind(id)
            .bind(p.id)
            .bind(BesatzungRolle::Neu.as_str())
            .bind(p.einheit_id)
            .bind(ziel_fahrzeug.and(p.fahrzeug_id))
            .bind(false)
            .bind(z)
            .bind(p.ziel_einheit)
            .bind(ziel_fahrzeug)
            .execute(&mut *conn)
            .await?;
    }

    // Zugehörigkeit in je einer Anweisung: die alte Besatzung verlässt Führung, Fahrzeug und
    // Einheit, die neue kommt in ihre Ziel-Einheit und, wo eines genannt ist, auf ihr Fahrzeug.
    sqlx::query(
        "UPDATE einsatz_einheit SET fuehrer_id = NULL WHERE id IN \
            (SELECT einheit_vorher_id FROM einsatz_abloesung_besatzung \
             WHERE abloesung_id = ? AND rolle = 'alt' AND war_fuehrer = 1)",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einsatz_personal SET einheit_id = NULL, \
            fahrzeug_id = CASE WHEN EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung b \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id \
                  AND b.fahrzeug_vorher_id IS NOT NULL) THEN NULL ELSE fahrzeug_id END \
         WHERE id IN (SELECT personal_id FROM einsatz_abloesung_besatzung \
                      WHERE abloesung_id = ?1 AND rolle = 'alt')",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einsatz_personal SET \
            einheit_id = (SELECT b.einheit_nachher_id FROM einsatz_abloesung_besatzung b \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id), \
            fahrzeug_id = COALESCE((SELECT b.fahrzeug_nachher_id FROM einsatz_abloesung_besatzung b \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id), fahrzeug_id) \
         WHERE id IN (SELECT personal_id FROM einsatz_abloesung_besatzung \
                      WHERE abloesung_id = ?1 AND rolle = 'neu')",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;

    let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
    let (folge, _) = create_schicht_tx(
        conn,
        einsatz_id,
        benutzer_id,
        roh.einheit_id,
        &name,
        roh.abschnitt_id,
        vollzogen_at,
        roh.rhythmus_minuten,
        roh.rhythmus_quelle,
        &vorgabe,
        Some(id),
        BeginnQuelle::Vollzug,
        jetzt,
    )
    .await?;

    let mut wirkung = VollzugWirkung::default();
    wirkung.einheiten.extend(einheiten.iter().copied());
    wirkung
        .einheiten
        .extend(neu.iter().filter_map(|p| p.einheit_id));
    wirkung.personen.extend(alt.iter().map(|(p, ..)| *p));
    wirkung.personen.extend(neu.iter().map(|p| p.id));
    let inhalt = format!(
        "Ablösung vollzogen: Besatzungswechsel «{name}», Einheit und Fahrzeug bleiben. \
         Alte Besatzung: {}. Neue Besatzung: {}.",
        personen_text(alt.iter().map(|(_, n, ..)| n.as_str())),
        verteilung_text(&neu, roh.einheit_id),
    );
    Ok((vec![folge], inhalt, wirkung))
}

/// Nimmt einen Vollzug zurück, solange jede Folgeschicht unberührt (laufend) ist (LLH-1132):
/// neu angelegte Folgeschichten werden samt Fristen entfernt, übernommene nur vom Vorgänger
/// gelöst. Das Ereignis `abloesung` wird an der Einheit und an jeder Untereinheit gestrichen,
/// die die wieder laufende Schicht erbt. Eine Abschnittsübergabe wird zurückgegeben, wo der
/// Vollzug den Stand hinterlassen hat: die abgelöste Einheit bekommt ihren Abschnitt, solange sie
/// noch ohne ist, jeder Ablöser seinen alten, solange er noch im übergebenen steht. Die Planung
/// von vor dem Vollzug gilt wieder (LLH-1319, [`restore_planung_tx`]): die gesicherte Liste der
/// Ablöser, ein geplanter Besatzungswechsel steht ohnehin noch; ohne Sicherung (Vollzug vor
/// Migration 0263) bleibt die Liste des Vollzugs als Planung stehen. Einen Besatzungswechsel
/// nimmt [`zuruecknehmen_besatzung_tx`] zurück (LLH-1150).
pub async fn zuruecknehmen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, i64, VollzugWirkung), AppError> {
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
                abgeloest_abschnitt_vorher_id = NULL, art = ?, verbleib = 'ruhe', \
                verbleib_br_id = NULL WHERE id = ?",
        )
        .bind(AbloesungArt::Einheit.as_str())
        .bind(id)
        .execute(&mut *conn)
        .await?;

        let mut wirkung = VollzugWirkung::default();
        match roh.art {
            // LLH-1150: Personen-Ereignisse streichen und die Besatzung zurücklegen; die
            // Einheiten hatten kein Ereignis.
            AbloesungArt::Besatzung => {
                wirkung = zuruecknehmen_besatzung_tx(
                    conn,
                    &Vorgang {
                        einsatz_id,
                        id,
                        benutzer_id,
                        jetzt,
                    },
                    roh.einheit_id,
                )
                .await?;
            }
            // LFH-552/LLH-1132: das Ablösungsereignis (beim Verbleib „entlassen“ die
            // Entlassung, LLH-1308) an der Einheit und an ihren Erben streichen, ihre Perioden
            // sind wieder offen. Die Erben ermittelt die Vererbung jetzt, da die Schicht wieder
            // läuft — darum findet die Kopplung beim Streichen der Entlassung keine mit ihr
            // beendete Schicht (design.md D3).
            AbloesungArt::Einheit => {
                if let Some(vollzogen_at) = &roh.vollzogen_at {
                    let ende = ende_art(roh.verbleib);
                    let erben = load_erben_tx(conn, einsatz_id, roh.einheit_id).await?;
                    for einheit in std::iter::once(roh.einheit_id).chain(erben) {
                        if let Some(w) = crate::zeitachse::repo::vollzug_ende_zurueck_tx(
                            conn,
                            einsatz_id,
                            benutzer_id,
                            einheit,
                            ende,
                            vollzogen_at,
                        )
                        .await?
                        {
                            wirkung.kopplung.append(Wirkung {
                                etb: w.1.abloesung.clone(),
                                anlaesse: w.1.hinweise.clone(),
                            });
                            wirkung.zeitachse.push(w);
                        }
                    }
                }
            }
        }
        let br_saetze =
            buchungen_zuruecknehmen_tx(conn, einsatz_id, benutzer_id, id, &mut wirkung).await?;

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
        // Die Planung von vor dem Vollzug gilt wieder (LLH-1319), bevor die Fristen den
        // Planungshinweis setzen; nach der Abschnittsrückgabe, die die Liste noch liest.
        restore_planung_tx(conn, id).await?;
        restore_fristen_tx(conn, einsatz_id, benutzer_id, id, &roh, &name, jetzt).await?;

        let mut inhalt = format!("Vollzug der Ablösung «{name}» zurückgenommen.");
        if let Some(a) = zurueck {
            inhalt.push_str(&format!(" Abschnitt «{a}» zurückgegeben."));
        }
        if roh.art == AbloesungArt::Besatzung {
            inhalt.push_str(" Besatzungswechsel rückgängig.");
        }
        if roh.verbleib == AbloesungVerbleib::Entlassen {
            inhalt.push_str(" Entlassung gestrichen.");
        }
        for satz in br_saetze {
            inhalt.push(' ');
            inhalt.push_str(&satz);
            inhalt.push('.');
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

/// Sichert die geplante Ablöser-Liste einer Schicht vor dem Vollzug (LLH-1319, design.md D4) in
/// `einsatz_abloesung_planung_vorher` und markiert die Schicht (`planung_gesichert`), auch bei
/// leerer Planung. Ein geplanter Besatzungswechsel braucht keine Sicherung: der Vollzug lässt
/// seine Zeilen stehen.
async fn save_planung_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_abloesung_planung_vorher WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO einsatz_abloesung_planung_vorher (abloesung_id, einheit_id) \
         SELECT abloesung_id, einheit_id FROM einsatz_abloesung_abloeser \
         WHERE abloesung_id = ? ORDER BY rowid",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE einsatz_abloesung SET planung_gesichert = 1 WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Stellt bei der Rücknahme die vor dem Vollzug gesicherte Ablöser-Liste wieder her (LLH-1319),
/// ohne inzwischen aufgelöste Einheiten, und räumt die Sicherung. Ohne Sicherung (Vollzug vor
/// Migration 0263) bleibt die Liste des Vollzugs als Planung, wie bisher.
async fn restore_planung_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    let gesichert: bool =
        sqlx::query_scalar("SELECT planung_gesichert FROM einsatz_abloesung WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
    if !gesichert {
        return Ok(());
    }
    let ids: Vec<i64> = sqlx::query_scalar(
        "SELECT v.einheit_id FROM einsatz_abloesung_planung_vorher v \
         JOIN einsatz_einheit e ON e.id = v.einheit_id AND e.aufgeloest_at IS NULL \
         WHERE v.abloesung_id = ? ORDER BY v.rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    set_abloeser_tx(conn, id, &ids).await?;
    sqlx::query("DELETE FROM einsatz_abloesung_planung_vorher WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE einsatz_abloesung SET planung_gesichert = 0 WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Legt die Belegungsbuchungen eines Vollzugs im Bereitstellungsraum zurück (LLH-1308, design.md
/// D4/D5), je Buchung nur, solange sie noch das jüngste Ereignis ihrer Einheit ist, der Raum aktiv
/// und die Einheit nicht aufgelöst ist: ein Eintritt bekommt den Austritt, ein Austritt den
/// Eintritt in denselben Raum (Notiz „Ablösung zurückgenommen“). Hat sich seitdem etwas bewegt,
/// bleibt der Raum, wie er ist. Die Reihe bleibt angehängt, wie ETB und Zeitachse. Danach fallen
/// die Zeilen. Liefert je Buchung einen Teilsatz für die Berichtigung.
async fn buchungen_zuruecknehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    wirkung: &mut VollzugWirkung,
) -> Result<Vec<String>, AppError> {
    use crate::bereitstellungsraum::belegung_repo::{self, Buchung};
    use crate::bereitstellungsraum::{BrBelegungsArt, ObjektTyp};
    /// `(Raum, Einheit, Art, Raum-Bezeichnung, Einheit-Name)` je Buchung, die noch den Stand des
    /// Vollzugs trägt.
    type Offen = (i64, i64, String, String, String);
    let offen: Vec<Offen> = sqlx::query_as(
        "SELECT b.br_id, b.objekt_id, b.art, r.bezeichnung, e.name \
         FROM einsatz_abloesung_br_buchung x \
         JOIN br_belegung b ON b.id = x.belegung_id \
         JOIN bereitstellungsraum r ON r.id = b.br_id \
         JOIN einsatz_einheit e ON e.id = b.objekt_id AND e.einsatz_id = b.einsatz_id \
         WHERE x.abloesung_id = ? AND b.objekt_typ = 'einheit' \
           AND r.status = 'aktiv' AND r.storniert_at IS NULL AND e.aufgeloest_at IS NULL \
           AND b.id = (SELECT MAX(y.id) FROM br_belegung y WHERE y.einsatz_id = b.einsatz_id \
                         AND y.objekt_typ = 'einheit' AND y.objekt_id = b.objekt_id) \
         ORDER BY b.id",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    let mut saetze = Vec::new();
    for (br_id, einheit_id, art, bezeichnung, name) in offen {
        let (gegen, satz) = if art == BrBelegungsArt::Eintritt.as_str() {
            (
                BrBelegungsArt::Austritt,
                format!("«{name}» verlässt Bereitstellungsraum {bezeichnung} wieder"),
            )
        } else {
            (
                BrBelegungsArt::Eintritt,
                format!("«{name}» wieder in Bereitstellungsraum {bezeichnung}"),
            )
        };
        belegung_repo::belege_tx(
            &mut *conn,
            einsatz_id,
            br_id,
            ObjektTyp::Einheit,
            einheit_id,
            &Buchung {
                art: gegen,
                notiz: Some(crate::zeitachse::repo::GRUND_ABLOESUNG_ZURUECK),
                client_id: None,
                zeitpunkt_at: None,
            },
            benutzer_id,
        )
        .await?;
        saetze.push(satz);
        wirkung.raeume.push(br_id);
        wirkung.einheiten.push(einheit_id);
    }
    sqlx::query("DELETE FROM einsatz_abloesung_br_buchung WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(saetze)
}

/// Nimmt einen Besatzungswechsel zurück (LLH-1150): streicht die Ereignisse der Personen aus dem
/// Vollzug (Grund „Ablösung zurückgenommen“; bräche das die Folge einer Person → 422 mit ihrem
/// Namen, nichts geändert) und legt jede Person zurück, solange sie noch so steht, wie der
/// Vollzug sie hinterlassen hat: die neue verlässt die Einheit wieder, in die der Vollzug sie
/// verteilt hat (zurück in ihre bisherige, solange die aktiv ist), und das Ziel-Fahrzeug (zurück
/// auf ihr bisheriges, solange es aktiv ist; LLH-1319), die alte kommt in ihre Einheit
/// (solange sie ohne Einheit und aktiv ist und die Einheit nicht aufgelöst), auf ihr Fahrzeug
/// (solange sie auf keinem sitzt und es aktiv ist) und in ihre Führung (solange die Einheit
/// keine hat). Danach fallen die Zeilen.
async fn zuruecknehmen_besatzung_tx(
    conn: &mut SqliteConnection,
    v: &Vorgang<'_>,
    einheit_id: i64,
) -> Result<VollzugWirkung, AppError> {
    use crate::zeitachse::repo::{streiche_tx, Kraft, GRUND_ABLOESUNG_ZURUECK};
    let Vorgang {
        einsatz_id,
        id,
        benutzer_id,
        ..
    } = *v;
    let ereignisse: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT b.personal_id, z.id, p.snap_name FROM einsatz_abloesung_besatzung b \
         JOIN einsatz_kraft_zeitachse z ON z.id = b.zeitachse_id AND z.gestrichen_at IS NULL \
         JOIN einsatz_personal p ON p.id = b.personal_id \
         WHERE b.abloesung_id = ? ORDER BY b.rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    for (person, ereignis, name) in ereignisse {
        streiche_tx(
            conn,
            einsatz_id,
            benutzer_id,
            Kraft::Person(person),
            ereignis,
            GRUND_ABLOESUNG_ZURUECK,
            true,
        )
        .await
        .map_err(|e| match e {
            AppError::UnprocessableEntity(m) => AppError::UnprocessableEntity(format!(
                "Die Zeitachse von «{name}» verlöre ihre Ordnung: {m}"
            )),
            e => e,
        })?;
    }

    let mut wirkung = VollzugWirkung::default();
    // Die neue Besatzung zurück, solange sie noch in ihrer Ziel-Einheit steht (LLH-1319; ohne
    // Ziel, Bestand vor 0263, die Einheit der Schicht).
    let neu: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "UPDATE einsatz_personal SET einheit_id = \
            (SELECT e.id FROM einsatz_abloesung_besatzung b \
             JOIN einsatz_einheit e ON e.id = b.einheit_vorher_id AND e.aufgeloest_at IS NULL \
             WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id) \
         WHERE EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung b \
                       WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id \
                         AND b.rolle = 'neu' \
                         AND einsatz_personal.einheit_id = COALESCE(b.einheit_nachher_id, ?2)) \
         RETURNING id, einheit_id",
    )
    .bind(id)
    .bind(einheit_id)
    .fetch_all(&mut *conn)
    .await?;
    // Ihr Fahrzeug zurück, solange sie noch auf dem sitzt, das der Wechsel ihr gab: auf das
    // vorherige, solange es aktiv ist, sonst auf keins (LLH-1319).
    sqlx::query(
        "UPDATE einsatz_personal SET fahrzeug_id = \
            (SELECT f.id FROM einsatz_abloesung_besatzung b \
             JOIN einsatz_fahrzeug f ON f.id = b.fahrzeug_vorher_id AND f.beendet_at IS NULL \
             WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id) \
         WHERE EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung b \
                       WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id \
                         AND b.rolle = 'neu' \
                         AND b.fahrzeug_nachher_id = einsatz_personal.fahrzeug_id)",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    // Die alte Besatzung zurück, solange sie ohne Einheit und noch im Einsatz ist.
    let alt: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "UPDATE einsatz_personal SET \
            einheit_id = (SELECT e.id FROM einsatz_abloesung_besatzung b \
                JOIN einsatz_einheit e ON e.id = b.einheit_vorher_id AND e.aufgeloest_at IS NULL \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id), \
            fahrzeug_id = COALESCE(fahrzeug_id, (SELECT f.id FROM einsatz_abloesung_besatzung b \
                JOIN einsatz_fahrzeug f ON f.id = b.fahrzeug_vorher_id AND f.beendet_at IS NULL \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id)) \
         WHERE einheit_id IS NULL AND beendet_at IS NULL \
           AND id IN (SELECT personal_id FROM einsatz_abloesung_besatzung \
                      WHERE abloesung_id = ?1 AND rolle = 'alt') \
         RETURNING id, einheit_id",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    // Die Führung zurück, wo die Person wieder in ihrer Einheit steht und die Einheit keine hat.
    sqlx::query(
        "UPDATE einsatz_einheit SET fuehrer_id = \
            (SELECT b.personal_id FROM einsatz_abloesung_besatzung b \
             JOIN einsatz_personal p ON p.id = b.personal_id AND p.einheit_id = b.einheit_vorher_id \
             WHERE b.abloesung_id = ?1 AND b.rolle = 'alt' AND b.war_fuehrer = 1 \
               AND b.einheit_vorher_id = einsatz_einheit.id) \
         WHERE fuehrer_id IS NULL AND id IN (SELECT einheit_vorher_id \
            FROM einsatz_abloesung_besatzung \
            WHERE abloesung_id = ?1 AND rolle = 'alt' AND war_fuehrer = 1)",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    let alle: Vec<i64> = sqlx::query_scalar(
        "DELETE FROM einsatz_abloesung_besatzung WHERE abloesung_id = ? RETURNING personal_id",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    wirkung.einheiten.push(einheit_id);
    wirkung
        .einheiten
        .extend(neu.iter().chain(alt.iter()).filter_map(|(_, e)| *e));
    wirkung.personen = alle;
    Ok(wirkung)
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
            &vorgabe,
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
        // Planungshinweis (LLH-1131) wie die Vorwarnung: nur vor uns und ohne Planung, ein schon
        // ausgelöster wird nicht wiederholt.
        let vorlauf = vorgabe.planungsvorlauf();
        if let Some(p) = planungszeit(&faellig_at, vorlauf).filter(|p| p.as_str() > jetzt) {
            if !has_planung_tx(conn, id).await? {
                erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id).await?;
                if open_frist_at_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id).await? != Some(p) {
                    set_planung_frist_tx(
                        conn,
                        einsatz_id,
                        benutzer_id,
                        id,
                        name,
                        &faellig_at,
                        vorlauf,
                        jetzt,
                    )
                    .await?;
                }
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
