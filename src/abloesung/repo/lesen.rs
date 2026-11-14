//! Lesemodell der Ablösung: Liste, Detail und Vorgaben mit Besatzung, Erben und Warnungen.

use super::*;

/// Eine Zeile, wie sie die Anzeige-Projektion liefert.
#[derive(sqlx::FromRow)]
pub(super) struct Zeile {
    pub(super) id: i64,
    pub(super) einsatz_id: i64,
    pub(super) einheit_id: i64,
    pub(super) einheit_name: String,
    pub(super) abschnitt_id: Option<i64>,
    pub(super) abschnitt_name: Option<String>,
    pub(super) beginn_at: String,
    #[sqlx(try_from = "String")]
    pub(super) beginn_quelle: BeginnQuelle,
    pub(super) rhythmus_minuten: i64,
    #[sqlx(try_from = "String")]
    pub(super) rhythmus_quelle: RhythmusQuelle,
    pub(super) faellig_at: String,
    pub(super) vorwarnung_minuten: i64,
    pub(super) abloesende_einheit_id: Option<i64>,
    pub(super) abloesende_einheit_name: Option<String>,
    #[sqlx(try_from = "String")]
    pub(super) status: AbloesungStatus,
    pub(super) vollzogen_at: Option<String>,
    pub(super) vollzogen_von_id: Option<i64>,
    pub(super) vorgaenger_id: Option<i64>,
    pub(super) folgeschicht_id: Option<i64>,
    pub(super) folgen_unberuehrt: bool,
    pub(super) einheit_laeuft_anderswo: i64,
    pub(super) beendet_at: Option<String>,
    pub(super) beendet_von_id: Option<i64>,
    pub(super) beendet_grund: Option<String>,
    pub(super) uebernommen_bei_vollzug: bool,
    pub(super) abschnitt_uebergeben: bool,
    pub(super) uebergebener_abschnitt_name: Option<String>,
    #[sqlx(try_from = "String")]
    pub(super) art: AbloesungArt,
    pub(super) planung_entfallen_at: Option<String>,
    pub(super) planung_entfallen_grund: Option<String>,
    pub(super) planung_entfallen_einheit_name: Option<String>,
    #[sqlx(try_from = "String")]
    pub(super) verbleib: AbloesungVerbleib,
    pub(super) verbleib_br_bezeichnung: Option<String>,
    pub(super) faellig_laut_plan: bool,
    pub(super) plan_block_id: Option<i64>,
    pub(super) folgeblock_id: Option<i64>,
    pub(super) folgeblock_von: Option<String>,
    pub(super) folgeblock_bis: Option<String>,
    pub(super) folgeblock_personen: i64,
    pub(super) angelegt_at: String,
}

impl Zeile {
    pub(super) fn anzeige(self, jetzt: &str) -> AbloesungAnzeige {
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
            faellig_laut_plan: self.faellig_laut_plan,
            plan_block_id: self.plan_block_id,
            plan_folgeblock: match (self.folgeblock_id, self.folgeblock_von, self.folgeblock_bis) {
                (Some(id), Some(von), Some(bis)) => Some(AbloesungPlanFolgeblock {
                    id,
                    von,
                    bis,
                    personen: self.folgeblock_personen,
                }),
                _ => None,
            },
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
pub(super) const ANZEIGE_SELECT: &str = concat!(
    "SELECT a.id, a.einsatz_id, a.einheit_id, e.name AS einheit_name, \
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
            vb.bezeichnung AS verbleib_br_bezeichnung, a.faellig_laut_plan, a.plan_block_id, \
            fb.id AS folgeblock_id, fb.von AS folgeblock_von, fb.bis AS folgeblock_bis, \
            (SELECT COUNT(*) FROM einsatz_planschicht_person fp WHERE fp.planschicht_id = fb.id) \
               AS folgeblock_personen, \
            a.angelegt_at \
     FROM einsatz_abloesung a \
     JOIN einsatz_einheit e ON e.id = a.einheit_id \
     LEFT JOIN einsatzabschnitt s ON s.id = a.abschnitt_id \
     LEFT JOIN einsatz_einheit ae ON ae.id = a.abloesende_einheit_id \
     LEFT JOIN einsatz_schichtmodell m ON m.einsatz_id = a.einsatz_id \
     LEFT JOIN einsatzabschnitt ua ON ua.id = a.abgeloest_abschnitt_vorher_id \
               AND a.abschnitt_uebergeben = 1 \
     LEFT JOIN bereitstellungsraum vb ON vb.id = a.verbleib_br_id \
     LEFT JOIN einsatz_planschicht fb \
            ON a.faellig_laut_plan = 1 AND a.status = 'laufend' AND fb.id = ",
    kopplung::folgeblock_sql!()
);

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
    // Erst die Listen: die Erben hängen an die Ablöser ihre Untereinheiten (LLH-1509).
    attach_listen(pool, einsatz_id, &mut liste).await?;
    attach_erben(pool, einsatz_id, &mut liste).await?;
    Ok(liste)
}

/// Hängt an jede Schicht ihre Ablöser (Reihenfolge der Planung) und ihre Folgeschichten (nach
/// ID). Je eine Abfrage für den ganzen Einsatz, unabhängig von der Zahl der Schichten.
pub(super) async fn attach_listen(
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
                untereinheiten: Vec::new(),
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
pub(super) async fn load_besatzung_plaene(
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
pub(super) struct Gliederung {
    pub(super) ueber: HashMap<i64, Option<i64>>,
    pub(super) namen: HashMap<i64, String>,
    pub(super) mit_schicht: HashSet<i64>,
}

pub(super) async fn load_gliederung(
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

/// Hängt an jede laufende Schicht die Untereinheiten, die sie erben (nach Name, dann ID), die
/// Warnungen zu ihrer geplanten ablösenden Einheit (LLH-1131) und an ihre Ablöser deren
/// Untereinheiten (LLH-1509). Läuft nach [`attach_listen`].
pub(super) async fn attach_erben(
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
        for abloeser in &mut a.abloeser {
            abloeser.untereinheiten = untereinheiten(&g.ueber, abloeser.einheit_id);
        }
    }
    Ok(())
}

/// Die aktiven Untereinheiten einer Einheit (LLH-1509, [`untereinheiten`]): derselbe Teilbaum,
/// den die Karte zum Stand eines Ablösers liest.
pub(crate) async fn load_untereinheiten_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<Vec<i64>, AppError> {
    let g = load_gliederung(&mut *conn, einsatz_id).await?;
    Ok(untereinheiten(&g.ueber, einheit_id))
}

/// Die Planungswarnungen der laufenden Schichten in `liste` ([`planung_warnungen`]), gegen
/// alle laufenden Schichten des Einsatzes: Einzelplanung und Ablöser-Liste. Ohne laufende Schicht
/// in `liste` liest sie nichts.
pub(super) async fn attach_warnungen(
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
pub(super) fn liste_sql(status: Option<AbloesungStatus>) -> String {
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
    // Erst die Listen: die Erben hängen an die Ablöser ihre Untereinheiten (LLH-1509).
    attach_listen(pool, einsatz_id, &mut eine).await?;
    attach_erben(pool, einsatz_id, &mut eine).await?;
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
