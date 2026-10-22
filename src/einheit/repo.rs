use super::{
    mitglied_repo, EinheitAnzeige, EinheitMitgliedFahrzeug, EinheitStatus, EinheitStatusQuelle,
    StatusAnteil, StatusWert,
};
use crate::error::AppError;
use crate::katalog::StatusKategorie;
use crate::staerke::Staerke;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::{HashMap, HashSet};

/// Editierbare Felder einer Einheit. Der Führer wird über `setze_fuehrer` gesetzt, weil er
/// Mitgliedschaft voraussetzt und eine eigene ETB-Aktion ist.
#[derive(Debug)]
pub struct EinheitDaten<'a> {
    pub name: &'a str,
    pub abschnitt_id: Option<i64>,
    pub ueber_einheit_id: Option<i64>,
    pub typ_id: Option<i64>,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub bemerkung: Option<&'a str>,
    /// Eigener Rufname der Einheit (Freitext, z. B. „Florian HM 12/44“).
    pub funkrufname: Option<&'a str>,
    pub kommunikationsmittel: Option<&'a str>,
    pub erreichbarkeit: Option<&'a str>,
    pub sortier: i64,
    /// Taktisches Zeichen (Fachaufgabe, Organisation) schon beim Anlegen, etwa aus einer
    /// Einheiten-Vorlage (LLH-1049); später pflegt es `aktualisiere_position`.
    pub tz_fachaufgabe: Option<&'a str>,
    pub tz_organisation: Option<&'a str>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    abschnitt_id: Option<i64>,
    abschnitt_name: Option<String>,
    ueber_einheit_id: Option<i64>,
    typ_id: Option<i64>,
    typ_label: Option<String>,
    name: String,
    fuehrer_id: Option<i64>,
    fuehrer_name: Option<String>,
    bemerkung: Option<String>,
    funkrufname: Option<String>,
    kommunikationsmittel: Option<String>,
    erreichbarkeit: Option<String>,
    sortier: i64,
    lat: Option<f64>,
    lon: Option<f64>,
    tz_fachaufgabe: Option<String>,
    tz_organisation: Option<String>,
    aktueller_br_id: Option<i64>,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    typ_soll_fuehrer: Option<i64>,
    typ_soll_unterfuehrer: Option<i64>,
    typ_soll_mannschaft: Option<i64>,
    status_seit: Option<String>,
    hand_status_id: Option<i64>,
    hand_status_label: Option<String>,
    hand_status_kategorie: Option<StatusKategorie>,
    hand_status_farbe: Option<String>,
    hand_status_fms_anker: Option<i64>,
    hand_status_sortier: Option<i64>,
    aufgeloest_at: Option<String>,
    aufgeloest_von: Option<i64>,
    nicht_uebernommen_seit: Option<String>,
    unangemeldet: bool,
    nachforderung_id: Option<i64>,
}

impl Row {
    /// Der Handstatus als aufgelöster Katalogeintrag; `None` ohne (gültigen) Eintrag.
    fn hand_status(&self) -> Option<StatusWert> {
        match (
            self.hand_status_id,
            self.hand_status_label.as_ref(),
            self.hand_status_kategorie,
        ) {
            (Some(status_id), Some(label), Some(kategorie)) => Some(StatusWert {
                status_id,
                label: label.clone(),
                kategorie,
                farbe: self.hand_status_farbe.clone(),
                fms_anker: self.hand_status_fms_anker,
                sortier: self.hand_status_sortier.unwrap_or(0),
            }),
            _ => None,
        }
    }
}

/// Status einer Einheit (LFH-609).
///
/// - **Mit Fahrzeugen abgeleitet:** tragen alle denselben Status, gilt er; „Seit“ ist der
///   JÜNGSTE Wechsel und `None`, sobald ein Fahrzeug keinen Zeitpunkt kennt (ein Maximum über
///   die bekannten Werte wäre erfunden). Sonst `Gemischt` mit Verteilung ohne „Seit“; eine
///   gemeinsame Kategorie (S3 + S4 → gebunden) bleibt erhalten. Ohne jeden Status `Ohne`.
/// - **Ohne Fahrzeug:** der Handstatus als Rückfall, sonst `Ohne`.
///
/// Ein Handstatus an einer Einheit MIT Fahrzeugen wird nicht gezeigt, bleibt aber stehen und
/// gilt wieder, wenn die Einheit ihre Fahrzeuge abgibt — mit seinem damaligen „Seit“.
pub fn leite_status_ab(
    fahrzeuge: &[EinheitMitgliedFahrzeug],
    hand: Option<StatusWert>,
    hand_seit: Option<String>,
) -> EinheitStatus {
    let leer = |quelle| EinheitStatus {
        quelle,
        status: None,
        kategorie: None,
        seit: None,
        verteilung: Vec::new(),
    };
    if fahrzeuge.is_empty() {
        return match hand {
            Some(h) => EinheitStatus {
                quelle: EinheitStatusQuelle::Hand,
                kategorie: Some(h.kategorie),
                status: Some(h),
                seit: hand_seit,
                verteilung: Vec::new(),
            },
            None => leer(EinheitStatusQuelle::Ohne),
        };
    }
    if fahrzeuge.iter().all(|f| f.status.is_none()) {
        return leer(EinheitStatusQuelle::Ohne);
    }
    let erster = fahrzeuge[0].status.as_ref().map(|s| s.status_id);
    if erster.is_some()
        && fahrzeuge
            .iter()
            .all(|f| f.status.as_ref().map(|s| s.status_id) == erster)
    {
        let seit = fahrzeuge
            .iter()
            .map(|f| f.status_seit.clone())
            .collect::<Option<Vec<String>>>()
            .and_then(|v| v.into_iter().max());
        let status = fahrzeuge[0].status.clone();
        return EinheitStatus {
            quelle: EinheitStatusQuelle::Fahrzeuge,
            kategorie: status.as_ref().map(|s| s.kategorie),
            status,
            seit,
            verteilung: Vec::new(),
        };
    }

    // Gemischt: je Status zählen, in Katalogreihenfolge, „ohne Status“ zuletzt.
    let mut anteile: Vec<StatusAnteil> = Vec::new();
    for f in fahrzeuge {
        let id = f.status.as_ref().map(|s| s.status_id);
        match anteile
            .iter_mut()
            .find(|a| a.status.as_ref().map(|s| s.status_id) == id)
        {
            Some(a) => a.anzahl += 1,
            None => anteile.push(StatusAnteil {
                status: f.status.clone(),
                anzahl: 1,
            }),
        }
    }
    anteile.sort_by_key(|a| match &a.status {
        Some(s) => (0, s.sortier, s.status_id),
        None => (1, 0, 0),
    });
    let erste_kat = fahrzeuge[0].status.as_ref().map(|s| s.kategorie);
    let kategorie = if erste_kat.is_some()
        && fahrzeuge
            .iter()
            .all(|f| f.status.as_ref().map(|s| s.kategorie) == erste_kat)
    {
        erste_kat
    } else {
        None
    };
    EinheitStatus {
        quelle: EinheitStatusQuelle::Gemischt,
        status: None,
        kategorie,
        seit: None,
        verteilung: anteile,
    }
}

// Ein einziges Literal statt `concat!`: Der Zustandswächter (`entlassung::tests`) prüft die
// Konstante erst im zusammengesetzten `{SELECT_AUFGELOEST} WHERE …`. Die beiden Kennzeichen sind
// deshalb ausgeschrieben; `kennzeichen_gleichen_den_makros` hält sie gleich mit
// `nicht_uebernommen_seit_sql!` und `unangemeldet_sql!`.
const SELECT_AUFGELOEST: &str = "\
    SELECT e.id, e.einsatz_id, e.abschnitt_id, ab.name AS abschnitt_name, \
           e.ueber_einheit_id, e.typ_id, t.label AS typ_label, e.name, \
           e.fuehrer_id, fp.snap_name AS fuehrer_name, e.bemerkung, e.funkrufname, \
           e.kommunikationsmittel, e.erreichbarkeit, e.sortier, \
           e.lat, e.lon, e.tz_fachaufgabe, e.tz_organisation, \
           e.aktueller_br_id, \
           e.soll_fuehrer, e.soll_unterfuehrer, e.soll_mannschaft, \
           t.soll_fuehrer AS typ_soll_fuehrer, t.soll_unterfuehrer AS typ_soll_unterfuehrer, \
           t.soll_mannschaft AS typ_soll_mannschaft, \
           e.status_seit, hs.id AS hand_status_id, hs.label AS hand_status_label, \
           hs.kategorie AS hand_status_kategorie, hs.farbe AS hand_status_farbe, \
           hs.fms_anker AS hand_status_fms_anker, hs.sortier AS hand_status_sortier, \
           e.aufgeloest_at, e.aufgeloest_von, \
           CASE WHEN e.uebernahme_offen_seit IS NOT NULL AND e.uebernommen_at IS NULL \
              AND e.aufgeloest_at IS NULL THEN e.uebernahme_offen_seit END \
             AS nicht_uebernommen_seit, \
           (e.uebernahme_offen_seit IS NOT NULL) AS unangemeldet, \
           e.nachforderung_id \
    FROM einsatz_einheit e \
    LEFT JOIN einheit_typ t ON t.id = e.typ_id \
    LEFT JOIN fahrzeug_status hs ON hs.id = e.status_id \
    LEFT JOIN einsatzabschnitt ab ON ab.id = e.abschnitt_id \
    LEFT JOIN einsatz_personal fp ON fp.id = e.fuehrer_id";

/// Eigene Ist-Stärke je Einheit und die Unterstellungskanten EINES Einsatzes — die eine Quelle
/// der Stärken für `GET …/einheiten` und die Empfängerliste der Verpflegung (LLH-1055,
/// design.md D3: eine Heimat je Zahl). Aufgelöste Einheiten tragen keine Kräfte und keine Kanten.
pub struct StaerkenJeEinheit {
    /// Eigene Ist-Stärke je Einheit; fehlender Eintrag = keine wertbaren Kräfte.
    eigene: HashMap<i64, Staerke>,
    /// Unmittelbar unterstellte Einheiten je Einheit (Kanten des ganzen Einsatzes).
    kinder: HashMap<i64, Vec<i64>>,
}

impl StaerkenJeEinheit {
    /// Kumulierte Ist-Stärke (eigene + alle unterstellten Einheiten), über [`kumuliere`].
    pub fn kumuliert(&self, wurzel_id: i64) -> Staerke {
        kumuliere(&self.eigene, &self.kinder, wurzel_id)
    }

    /// Eigene Ist-Stärke einer Einheit; ohne Kräfte `0/0/0`.
    pub fn eigene(&self, einheit_id: i64) -> Staerke {
        self.eigene
            .get(&einheit_id)
            .copied()
            .unwrap_or(Staerke::neu(0, 0, 0))
    }
}

/// Lädt [`StaerkenJeEinheit`] eines Einsatzes in zwei Abfragen, gleich wie viele Einheiten.
pub async fn load_staerken_je_einheit(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<StaerkenJeEinheit, AppError> {
    let kanten: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "SELECT id, ueber_einheit_id FROM einsatz_einheit \
         WHERE einsatz_id = ? AND aufgeloest_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut kinder: HashMap<i64, Vec<i64>> = HashMap::new();
    for (id, vater) in &kanten {
        if let Some(v) = vater {
            kinder.entry(*v).or_default().push(*id);
        }
    }
    Ok(StaerkenJeEinheit {
        eigene: mitglied_repo::ist_staerke_map(pool, einsatz_id).await?,
        kinder,
    })
}

/// Satzweise geladene Anreicherung EINES Einsatzes: Mitglieder, Stärken, Sprechgruppen und
/// Unterstellungskanten — je eine Abfrage über den ganzen Einsatz statt sechs je Einheit.
struct Anreicherung {
    staerken: StaerkenJeEinheit,
    personal: HashMap<i64, Vec<super::EinheitMitgliedPerson>>,
    fahrzeuge: HashMap<i64, Vec<super::EinheitMitgliedFahrzeug>>,
    material: HashMap<i64, Vec<super::EinheitMitgliedMaterial>>,
    sprechgruppen: HashMap<i64, Vec<crate::sprechgruppe::SprechgruppeAnzeige>>,
}

/// Kumulierte Ist-Stärke einer Einheit: eigene plus alle unterstellten, rein im Speicher.
/// `eigene` sind die eigenen Ist-Stärken (fehlender Eintrag = keine wertbaren Kräfte), `kinder`
/// die unmittelbar unterstellten Einheiten je Einheit.
///
/// Iterativ mit Visited-Set statt `WITH RECURSIVE`, damit korrupte Zyklen terminieren. Die
/// Regel steht im gemeinsamen Fixture `tests/fixtures/verdichtung/regeln.json` (LFH-550): der
/// Client summiert Abschnitte und Bereitstellungsräume über genau diese Werte.
pub fn kumuliere(
    eigene: &HashMap<i64, Staerke>,
    kinder: &HashMap<i64, Vec<i64>>,
    wurzel_id: i64,
) -> Staerke {
    let mut summe = Staerke::neu(0, 0, 0);
    let mut stack = vec![wurzel_id];
    let mut besucht: HashSet<i64> = HashSet::new();
    while let Some(id) = stack.pop() {
        if !besucht.insert(id) {
            continue;
        }
        if let Some(s) = eigene.get(&id) {
            summe = Staerke::neu(
                summe.fuehrer.saturating_add(s.fuehrer),
                summe.unterfuehrer.saturating_add(s.unterfuehrer),
                summe.mannschaft.saturating_add(s.mannschaft),
            );
        }
        if let Some(cs) = kinder.get(&id) {
            stack.extend(cs.iter().copied());
        }
    }
    summe
}

/// Lädt die Anreicherung eines ganzen Einsatzes in konstant vielen Abfragen (6).
async fn anreicherung_laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Anreicherung, AppError> {
    Ok(Anreicherung {
        staerken: load_staerken_je_einheit(pool, einsatz_id).await?,
        personal: mitglied_repo::personal_mitglieder_map(pool, einsatz_id).await?,
        fahrzeuge: mitglied_repo::fahrzeug_mitglieder_map(pool, einsatz_id).await?,
        material: mitglied_repo::material_mitglieder_map(pool, einsatz_id).await?,
        sprechgruppen: crate::sprechgruppe::repo::lade_einheit_sprechgruppen_map(pool, einsatz_id)
            .await?,
    })
}

/// Setzt die Anzeigen für Zeilen desselben Einsatzes zusammen; die Anreicherung wird einmal für
/// den ganzen Einsatz geladen. Auch `laden()` nutzt diese Funktion, damit es genau eine
/// Anreicherungslogik gibt. `soll` ist der Override (falls vollständig), sonst das Typ-Soll,
/// sonst `None`.
async fn zu_anzeige_batch(
    pool: &SqlitePool,
    einsatz_id: i64,
    rows: Vec<Row>,
) -> Result<Vec<EinheitAnzeige>, AppError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let mut anreicherung = anreicherung_laden(pool, einsatz_id).await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let override_soll =
            Staerke::from_options(row.soll_fuehrer, row.soll_unterfuehrer, row.soll_mannschaft)
                .unwrap_or(None);
        let typ_soll = Staerke::from_options(
            row.typ_soll_fuehrer,
            row.typ_soll_unterfuehrer,
            row.typ_soll_mannschaft,
        )
        .unwrap_or(None);
        let soll = override_soll.or(typ_soll);

        let ist = anreicherung.staerken.eigene(row.id);
        let ist_kumuliert = anreicherung.staerken.kumuliert(row.id);
        // Jede Einheit kommt im Satz genau einmal vor → entnehmen statt klonen.
        let personal_mitglieder = anreicherung.personal.remove(&row.id).unwrap_or_default();
        let fahrzeug_mitglieder = anreicherung.fahrzeuge.remove(&row.id).unwrap_or_default();
        let status = leite_status_ab(
            &fahrzeug_mitglieder,
            row.hand_status(),
            row.status_seit.clone(),
        );
        let material_mitglieder = anreicherung.material.remove(&row.id).unwrap_or_default();
        let sprechgruppen = anreicherung
            .sprechgruppen
            .remove(&row.id)
            .unwrap_or_default();

        out.push(EinheitAnzeige {
            id: row.id,
            einsatz_id: row.einsatz_id,
            abschnitt_id: row.abschnitt_id,
            abschnitt_name: row.abschnitt_name,
            ueber_einheit_id: row.ueber_einheit_id,
            typ_id: row.typ_id,
            typ_label: row.typ_label,
            name: row.name,
            fuehrer_id: row.fuehrer_id,
            fuehrer_name: row.fuehrer_name,
            bemerkung: row.bemerkung,
            funkrufname: row.funkrufname,
            kommunikationsmittel: row.kommunikationsmittel,
            erreichbarkeit: row.erreichbarkeit,
            sortier: row.sortier,
            lat: row.lat,
            lon: row.lon,
            tz_fachaufgabe: row.tz_fachaufgabe,
            tz_organisation: row.tz_organisation,
            aktueller_br_id: row.aktueller_br_id,
            soll,
            ist,
            ist_kumuliert,
            personal_mitglieder,
            fahrzeug_mitglieder,
            material_mitglieder,
            sprechgruppen,
            status,
            aufgeloest_at: row.aufgeloest_at,
            aufgeloest_von: row.aufgeloest_von,
            nicht_uebernommen_seit: row.nicht_uebernommen_seit,
            unangemeldet: row.unangemeldet,
            nachforderung_id: row.nachforderung_id,
        });
    }
    Ok(out)
}

/// Alle aktiven Einheiten eines Einsatzes (flach, aufgelöst inkl. Mitgliedern/Stärke). Aufgelöste
/// fehlen (LLH-1079).
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<EinheitAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE e.einsatz_id = ? AND e.aufgeloest_at IS NULL \
         ORDER BY e.sortier, e.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    zu_anzeige_batch(pool, einsatz_id, rows).await
}

/// Aufgelöste Einheiten eines Einsatzes, zuletzt aufgelöste zuerst — der Nachweis hinter
/// `GET …/einheiten?aufgeloeste=1` (LLH-1079). Ohne Mitglieder: die Auflösung hat sie gelöst.
pub async fn list_aufgeloeste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<EinheitAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE e.einsatz_id = ? AND e.aufgeloest_at IS NOT NULL \
         ORDER BY e.aufgeloest_at DESC, e.id DESC"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    zu_anzeige_batch(pool, einsatz_id, rows).await
}

/// Lädt eine Einheit (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<EinheitAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE e.id = ? AND e.einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    zu_anzeige_batch(pool, einsatz_id, vec![row])
        .await?
        .pop()
        .ok_or(AppError::NotFound)
}

/// `NotFound`, falls die Einheit nicht (mehr) zum Einsatz gehört, `Conflict`, falls sie
/// aufgelöst ist (wie [`require_aktiv_tx`], LLH-1079). Eine nackte Abfrage, weil `laden()` die
/// Anreicherung des ganzen Einsatzes zöge. Executor-generisch, damit [`anlegen_tx`] auf der
/// offenen Verbindung prüft.
async fn check_gehoert_zum_einsatz(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    id: i64,
) -> Result<(), AppError> {
    let aufgeloest: Option<Option<String>> = sqlx::query_scalar(
        "SELECT aufgeloest_at FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(executor)
    .await?;
    match aufgeloest.ok_or(AppError::NotFound)? {
        None => Ok(()),
        Some(_) => Err(aufgeloest_conflict()),
    }
}

/// Der 409 an einer aufgelösten Einheit (Lebenszyklus, `src/AGENTS.md`).
fn aufgeloest_conflict() -> AppError {
    AppError::Conflict("Die Einheit ist aufgelöst".into())
}

/// `NotFound`, falls der Abschnitt nicht zum Einsatz gehört. Executor-generisch (s.
/// [`anlegen_tx`]).
async fn check_abschnitt(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    abschnitt_id: i64,
) -> Result<(), AppError> {
    let t: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
            .bind(abschnitt_id)
            .bind(einsatz_id)
            .fetch_optional(executor)
            .await?;
    t.map(|_| ()).ok_or(AppError::NotFound)
}

/// Zyklus, wenn beim Setzen von `ueber_einheit_id = kandidat` für `start_id` der
/// Kandidat (oder ein Vorfahr) gleich `start_id` wäre. Läuft von `kandidat` nach oben.
async fn waere_zyklus(
    pool: &SqlitePool,
    start_id: i64,
    kandidat_parent: i64,
) -> Result<bool, AppError> {
    let mut aktuell = Some(kandidat_parent);
    let mut schritte = 0;
    while let Some(id) = aktuell {
        if id == start_id {
            return Ok(true);
        }
        schritte += 1;
        if schritte > 10_000 {
            return Ok(true);
        }
        aktuell = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT ueber_einheit_id FROM einsatz_einheit WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .flatten();
    }
    Ok(false)
}

/// Validiert typ (eigene Org), abschnitt und parent (selber Einsatz) beim Anlegen auf der
/// Verbindung des Aufrufers (so sieht die Prüfung auch Zeilen derselben offenen Transaktion).
/// Keine Zyklenprüfung: eine neue Einheit kann nicht eigener Vorfahr sein; beim Umhängen prüft
/// [`validiere_patch`].
async fn validiere(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    daten: &EinheitDaten<'_>,
) -> Result<(), AppError> {
    if let Some(typ) = daten.typ_id {
        if !crate::einheit::typ_repo::ist_in_org(&mut *conn, org_id, typ).await? {
            return Err(AppError::Validation("Unbekannter Einheitstyp".into()));
        }
    }
    if let Some(abschnitt) = daten.abschnitt_id {
        check_abschnitt(&mut *conn, einsatz_id, abschnitt).await?;
    }
    if let Some(parent) = daten.ueber_einheit_id {
        check_gehoert_zum_einsatz(&mut *conn, einsatz_id, parent).await?;
    }
    Ok(())
}

/// Legt eine Einheit an; `org_id` für die Typ-Prüfung. Pool-Hülle um [`anlegen_tx`] ohne eigene
/// Transaktion; die Anzeige wird nach Rückgabe der Verbindung über den Pool geladen.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    daten: EinheitDaten<'_>,
    angelegt_von: i64,
) -> Result<EinheitAnzeige, AppError> {
    let id = {
        let mut conn = pool.acquire().await?;
        anlegen_tx(&mut conn, einsatz_id, org_id, &daten, angelegt_von).await?
    };
    laden(pool, einsatz_id, id).await
}

/// Legt eine Einheit auf einer offenen Verbindung an, samt Prüfung von Typ, Abschnitt und
/// übergeordneter Einheit auf derselben Verbindung (Demo-Import in EINER Transaktion). Öffnet
/// und committet nichts. Liefert die `id`, weil die Anreicherung über den Pool liest.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    daten: &EinheitDaten<'_>,
    angelegt_von: i64,
) -> Result<i64, AppError> {
    validiere(&mut *conn, einsatz_id, org_id, daten).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_einheit \
            (einsatz_id, abschnitt_id, ueber_einheit_id, typ_id, name, \
             soll_fuehrer, soll_unterfuehrer, soll_mannschaft, bemerkung, funkrufname, \
             kommunikationsmittel, erreichbarkeit, sortier, angelegt_von, \
             tz_fachaufgabe, tz_organisation) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.abschnitt_id)
    .bind(daten.ueber_einheit_id)
    .bind(daten.typ_id)
    .bind(daten.name)
    .bind(daten.soll_fuehrer)
    .bind(daten.soll_unterfuehrer)
    .bind(daten.soll_mannschaft)
    .bind(daten.bemerkung)
    .bind(daten.funkrufname)
    .bind(daten.kommunikationsmittel)
    .bind(daten.erreichbarkeit)
    .bind(daten.sortier)
    .bind(angelegt_von)
    .bind(daten.tz_fachaufgabe)
    .bind(daten.tz_organisation)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Teil-Patch (Tri-State, ohne Führer): äußere `Option` = „im Patch?“, innere = Wert
/// (`Some(None)` setzt NULL).
#[derive(Debug, Default)]
pub struct EinheitPatch<'a> {
    pub name: Option<&'a str>,
    pub abschnitt_id: Option<Option<i64>>,
    pub ueber_einheit_id: Option<Option<i64>>,
    pub typ_id: Option<Option<i64>>,
    pub soll_fuehrer: Option<Option<i64>>,
    pub soll_unterfuehrer: Option<Option<i64>>,
    pub soll_mannschaft: Option<Option<i64>>,
    pub bemerkung: Option<Option<&'a str>>,
    pub funkrufname: Option<Option<&'a str>>,
    pub kommunikationsmittel: Option<Option<&'a str>>,
    pub erreichbarkeit: Option<Option<&'a str>>,
    pub sortier: Option<i64>,
}

/// Validiert nur die gesendeten FK-Felder; `Some(None)` und ein fehlendes Feld bringen keinen
/// neuen Bezug. Jede Prüfung hängt an EINER Spalte (anders als das Soll-Trio im Handler).
async fn validiere_patch(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    self_id: i64,
    patch: &EinheitPatch<'_>,
) -> Result<(), AppError> {
    if let Some(Some(typ)) = patch.typ_id {
        if !crate::einheit::typ_repo::ist_in_org(pool, org_id, typ).await? {
            return Err(AppError::Validation("Unbekannter Einheitstyp".into()));
        }
    }
    if let Some(Some(abschnitt)) = patch.abschnitt_id {
        check_abschnitt(pool, einsatz_id, abschnitt).await?;
    }
    if let Some(Some(parent)) = patch.ueber_einheit_id {
        check_gehoert_zum_einsatz(pool, einsatz_id, parent).await?;
        if waere_zyklus(pool, self_id, parent).await? {
            return Err(AppError::Validation(
                "Einheit darf nicht eigener Vorfahr werden".into(),
            ));
        }
    }
    Ok(())
}

/// Die drei Soll-Spalten roh, für die Effektivzustands-Prüfung des Trios beim Teil-PATCH.
/// `EinheitAnzeige.soll` glättet ein inkonsistentes Trio auf `None`; dagegen darf der Handler
/// nicht validieren. `NotFound`, falls die Einheit nicht zum Einsatz gehört.
pub async fn soll_roh(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<(Option<i64>, Option<i64>, Option<i64>), AppError> {
    sqlx::query_as::<_, (Option<i64>, Option<i64>, Option<i64>)>(
        "SELECT soll_fuehrer, soll_unterfuehrer, soll_mannschaft \
         FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Teil-Patch der editierbaren Felder (ohne Führer), Parent-Wechsel zyklenfrei; `NotFound`,
/// falls die Einheit nicht zum Einsatz gehört.
///
/// Flag/Wert-Paare mit nummerierten Parametern: nur gesendete Spalten werden angefasst, und
/// eine verschobene Bind-Kette kann gleichtypige Nachbarn (`kommunikationsmittel`↔
/// `erreichbarkeit`, `abschnitt_id`↔`ueber_einheit_id`) nicht still vertauschen.
pub async fn patche(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    id: i64,
    patch: EinheitPatch<'_>,
) -> Result<EinheitAnzeige, AppError> {
    check_gehoert_zum_einsatz(pool, einsatz_id, id).await?;
    validiere_patch(pool, einsatz_id, org_id, id, &patch).await?;
    let resultat = sqlx::query(
        "UPDATE einsatz_einheit SET \
            abschnitt_id = CASE WHEN ?1 IS NULL THEN abschnitt_id ELSE ?2 END, \
            ueber_einheit_id = CASE WHEN ?3 IS NULL THEN ueber_einheit_id ELSE ?4 END, \
            typ_id = CASE WHEN ?5 IS NULL THEN typ_id ELSE ?6 END, \
            name = CASE WHEN ?7 IS NULL THEN name ELSE ?8 END, \
            soll_fuehrer = CASE WHEN ?9 IS NULL THEN soll_fuehrer ELSE ?10 END, \
            soll_unterfuehrer = CASE WHEN ?11 IS NULL THEN soll_unterfuehrer ELSE ?12 END, \
            soll_mannschaft = CASE WHEN ?13 IS NULL THEN soll_mannschaft ELSE ?14 END, \
            bemerkung = CASE WHEN ?15 IS NULL THEN bemerkung ELSE ?16 END, \
            kommunikationsmittel = CASE WHEN ?17 IS NULL THEN kommunikationsmittel ELSE ?18 END, \
            erreichbarkeit = CASE WHEN ?19 IS NULL THEN erreichbarkeit ELSE ?20 END, \
            sortier = CASE WHEN ?21 IS NULL THEN sortier ELSE ?22 END, \
            funkrufname = CASE WHEN ?23 IS NULL THEN funkrufname ELSE ?24 END \
         WHERE id = ?25 AND einsatz_id = ?26",
    )
    .bind(patch.abschnitt_id.map(|_| 1_i64))
    .bind(patch.abschnitt_id.and_then(|v| v))
    .bind(patch.ueber_einheit_id.map(|_| 1_i64))
    .bind(patch.ueber_einheit_id.and_then(|v| v))
    .bind(patch.typ_id.map(|_| 1_i64))
    .bind(patch.typ_id.and_then(|v| v))
    .bind(patch.name.map(|_| 1_i64))
    .bind(patch.name)
    .bind(patch.soll_fuehrer.map(|_| 1_i64))
    .bind(patch.soll_fuehrer.and_then(|v| v))
    .bind(patch.soll_unterfuehrer.map(|_| 1_i64))
    .bind(patch.soll_unterfuehrer.and_then(|v| v))
    .bind(patch.soll_mannschaft.map(|_| 1_i64))
    .bind(patch.soll_mannschaft.and_then(|v| v))
    .bind(patch.bemerkung.map(|_| 1_i64))
    .bind(patch.bemerkung.and_then(|v| v))
    .bind(patch.kommunikationsmittel.map(|_| 1_i64))
    .bind(patch.kommunikationsmittel.and_then(|v| v))
    .bind(patch.erreichbarkeit.map(|_| 1_i64))
    .bind(patch.erreichbarkeit.and_then(|v| v))
    .bind(patch.sortier.map(|_| 1_i64))
    .bind(patch.sortier)
    .bind(patch.funkrufname.map(|_| 1_i64))
    .bind(patch.funkrufname.and_then(|v| v))
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Ergebnis von [`setze_hand_status_tx`]: die Labels vor und nach dem Setzen.
pub struct HandStatusWechsel {
    pub name: String,
    pub vorher: Option<String>,
    pub nachher: Option<String>,
    /// Kategorien vor und nach dem Setzen (Benachrichtigung `wieder_verfuegbar`, D11).
    pub vorher_kategorie: Option<StatusKategorie>,
    pub nachher_kategorie: Option<StatusKategorie>,
}

/// Setzt den Handstatus einer Einheit auf einer offenen Transaktion; `status_id` ist gegen den
/// Katalog der Org geprüft (`None` = löschen). Mit Fahrzeugen führen die Fahrzeuge, SETZEN ist
/// dann `UnprocessableEntity`; Löschen bleibt erlaubt. `status_seit` springt nur bei einem
/// echten Wechsel. `None`, wenn der Status unverändert blieb.
pub async fn setze_hand_status_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    status_id: Option<i64>,
) -> Result<Option<HandStatusWechsel>, AppError> {
    let (name, alt_id, alt_label, alt_kategorie): (
        String,
        Option<i64>,
        Option<String>,
        Option<StatusKategorie>,
    ) = sqlx::query_as(
        "SELECT e.name, e.status_id, s.label, s.kategorie FROM einsatz_einheit e \
         LEFT JOIN fahrzeug_status s ON s.id = e.status_id \
         WHERE e.id = ? AND e.einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    let fahrzeuge: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_fahrzeug WHERE einheit_id = ? AND beendet_at IS NULL",
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    if alt_id == status_id {
        return Ok(None);
    }
    // LÖSCHEN bleibt mit Fahrzeugen erlaubt: sonst tauchte ein gespeicherter Handstatus beim
    // Abgeben der Fahrzeuge wieder auf, ohne dass ihn vorher jemand entfernen konnte.
    if fahrzeuge > 0 && status_id.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Die Einheit führt ihren Status über ihre Fahrzeuge".into(),
        ));
    }
    sqlx::query(
        "UPDATE einsatz_einheit SET status_id = ?1, \
         status_seit = CASE WHEN ?1 IS NULL THEN NULL ELSE datetime('now') END \
         WHERE id = ?2 AND einsatz_id = ?3",
    )
    .bind(status_id)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    let (neu_label, neu_kategorie): (Option<String>, Option<StatusKategorie>) = match status_id {
        Some(sid) => sqlx::query_as::<_, (String, StatusKategorie)>(
            "SELECT label, kategorie FROM fahrzeug_status WHERE id = ?",
        )
        .bind(sid)
        .fetch_optional(&mut *conn)
        .await?
        .map_or((None, None), |(l, k)| (Some(l), Some(k))),
        None => (None, None),
    };
    Ok(Some(HandStatusWechsel {
        name,
        vorher: alt_label,
        nachher: neu_label,
        vorher_kategorie: alt_kategorie,
        nachher_kategorie: neu_kategorie,
    }))
}

/// Geo-/Symbol-Felder einer Einheit. `Some(None)` = NULL, `None` = unverändert.
#[derive(Debug, Default)]
pub struct PositionPatch<'a> {
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
}

/// Setzt/ändert/löscht Position und Symbol-Felder; schreibt kein ETB.
pub async fn aktualisiere_position(
    pool: &SqlitePool,
    einsatz_id: i64,
    einheit_id: i64,
    daten: PositionPatch<'_>,
) -> Result<EinheitAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_einheit SET \
            lat = CASE WHEN ? THEN ? ELSE lat END, \
            lon = CASE WHEN ? THEN ? ELSE lon END, \
            tz_fachaufgabe  = CASE WHEN ? THEN ? ELSE tz_fachaufgabe END, \
            tz_organisation = CASE WHEN ? THEN ? ELSE tz_organisation END \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.lat.is_some())
    .bind(daten.lat.flatten())
    .bind(daten.lon.is_some())
    .bind(daten.lon.flatten())
    .bind(daten.tz_fachaufgabe.is_some())
    .bind(daten.tz_fachaufgabe.flatten())
    .bind(daten.tz_organisation.is_some())
    .bind(daten.tz_organisation.flatten())
    .bind(einheit_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, einheit_id).await
}

/// Reine Validierung: die Einheit gehört zum Einsatz, und bei `Some(ep)` ist die Person Mitglied
/// dieser Einheit. Wird vor jedem Write gerufen, damit ein ungültiger Führer kein Teil-Update
/// hinterlässt.
pub async fn check_fuehrer(
    pool: &SqlitePool,
    einsatz_id: i64,
    einheit_id: i64,
    fuehrer_ep_id: Option<i64>,
) -> Result<(), AppError> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
            .bind(einheit_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    exists.ok_or(AppError::NotFound)?;
    if let Some(ep) = fuehrer_ep_id {
        let mitglied: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM einsatz_personal WHERE id = ? AND einheit_id = ? AND einsatz_id = ?",
        )
        .bind(ep)
        .bind(einheit_id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
        if mitglied.is_none() {
            return Err(AppError::Validation(
                "Einheitsführer muss Mitglied dieser Einheit sein".into(),
            ));
        }
    }
    Ok(())
}

/// Setzt (oder leert mit `None`) den Führer einer Einheit. Validiert vorab über
/// `check_fuehrer`. `NotFound`/`Validation` wie dort.
pub async fn setze_fuehrer(
    pool: &SqlitePool,
    einsatz_id: i64,
    einheit_id: i64,
    fuehrer_ep_id: Option<i64>,
) -> Result<(), AppError> {
    check_fuehrer(pool, einsatz_id, einheit_id, fuehrer_ep_id).await?;
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(fuehrer_ep_id)
        .bind(einheit_id)
        .bind(einsatz_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Jeder Schreibweg an einer Einheit fragt zuerst hier (LLH-1079, design.md D6): `NotFound`,
/// wenn sie nicht zum Einsatz gehört, `Conflict` (Lebenszyklus), wenn sie aufgelöst ist. Eine
/// aufgelöste Einheit wird nicht wieder aktiv (design.md D5).
pub async fn require_aktiv_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<(), AppError> {
    let aufgeloest: Option<Option<String>> = sqlx::query_scalar(
        "SELECT aufgeloest_at FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    match aufgeloest.ok_or(AppError::NotFound)? {
        None => Ok(()),
        Some(_) => Err(aufgeloest_conflict()),
    }
}

// ─── Übernehmen und Abweisen (LLH-1075, design.md D10/D11) ───────────────────────────────

/// Gewählte Unterstellung beim Übernehmen; beide optional, beide erlaubt wie im PATCH.
#[derive(Debug, Clone, Copy, Default)]
pub struct Uebernahme {
    pub abschnitt_id: Option<i64>,
    pub ueber_einheit_id: Option<i64>,
}

/// Was das Übernehmen geschrieben hat (ETB-Text und Live).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Uebernommen {
    pub name: String,
    pub abschnitt: Option<String>,
    pub ueber: Option<String>,
    /// Raum, in dem die Einheit steht (das Übernehmen verlässt ihn nicht).
    pub br_id: Option<i64>,
    /// Die Meldung des Eintreffens, falls noch vorhanden.
    pub meldung_id: Option<i64>,
}

/// Bezüge der Übernahme vor der Transaktion prüfen wie der PATCH (`validiere_patch`): fremder
/// Abschnitt oder fremde/aufgelöste Über-Einheit 404/409, Zyklus 400.
pub async fn check_uebernahme(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    id: i64,
    u: &Uebernahme,
) -> Result<(), AppError> {
    check_gehoert_zum_einsatz_oder_aufgeloest(pool, einsatz_id, id).await?;
    validiere_patch(
        pool,
        einsatz_id,
        org_id,
        id,
        &EinheitPatch {
            abschnitt_id: u.abschnitt_id.map(Some),
            ueber_einheit_id: u.ueber_einheit_id.map(Some),
            ..Default::default()
        },
    )
    .await
}

/// Existiert die Einheit im Einsatz (404)? Aufgelöst ist hier kein Fehler: den 409 meldet die
/// Transaktion, vor der Offen-Prüfung (design.md D10).
async fn check_gehoert_zum_einsatz_oder_aufgeloest(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<(), AppError> {
    let da: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    da.map(|_| ()).ok_or(AppError::NotFound)
}

/// Offene Übernahme: `(name, aktueller_br_id, uebernahme_meldung_id)`; aufgelöst 409, sonst
/// ohne offene Übernahme 422.
async fn require_offen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<(String, Option<i64>, Option<i64>), AppError> {
    require_aktiv_tx(&mut *conn, einsatz_id, id).await?;
    let (name, offen_seit, uebernommen_at, br_id, meldung_id): (
        String,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
    ) = sqlx::query_as(
        "SELECT name, uebernahme_offen_seit, uebernommen_at, aktueller_br_id, \
                uebernahme_meldung_id \
         FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    if offen_seit.is_none() || uebernommen_at.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Einheit wartet nicht auf Übernahme".into(),
        ));
    }
    Ok((name, br_id, meldung_id))
}

/// Übernimmt eine unangemeldete Einheit (D10) in der Transaktion des Aufrufers: aufgelöst 409,
/// ohne offene Übernahme 422; setzt `uebernommen_at/_von` und die gewählte Unterstellung und
/// bestätigt die Meldung des Eintreffens (schon bestätigt: ohne Fehler). Kein Austritt aus dem
/// Raum. Die Bezüge prüft [`check_uebernahme`] vorher.
#[allow(clippy::too_many_arguments)]
pub async fn uebernehmen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    einsatz_id: i64,
    id: i64,
    u: &Uebernahme,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Uebernommen, AppError> {
    let (name, br_id, meldung_id) = require_offen_tx(&mut *conn, einsatz_id, id).await?;
    sqlx::query(
        "UPDATE einsatz_einheit SET uebernommen_at = ?1, uebernommen_von = ?2, \
            abschnitt_id = COALESCE(?3, abschnitt_id), \
            ueber_einheit_id = COALESCE(?4, ueber_einheit_id) \
         WHERE id = ?5 AND einsatz_id = ?6",
    )
    .bind(jetzt)
    .bind(benutzer_id)
    .bind(u.abschnitt_id)
    .bind(u.ueber_einheit_id)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    if let Some(m) = meldung_id {
        crate::meldung::repo::bestaetige_tx(&mut *conn, org_id, einsatz_id, m, benutzer_id, jetzt)
            .await?;
    }
    let abschnitt: Option<String> = match u.abschnitt_id {
        Some(a) => Some(
            sqlx::query_scalar("SELECT name FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
                .bind(a)
                .bind(einsatz_id)
                .fetch_one(&mut *conn)
                .await?,
        ),
        None => None,
    };
    let ueber: Option<String> = match u.ueber_einheit_id {
        Some(p) => Some(
            sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
                .bind(p)
                .bind(einsatz_id)
                .fetch_one(&mut *conn)
                .await?,
        ),
        None => None,
    };
    Ok(Uebernommen {
        name,
        abschnitt,
        ueber,
        br_id,
        meldung_id,
    })
}

/// Was das Abweisen geschrieben hat (ETB-Text und Live).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Abgewiesen {
    pub name: String,
    /// Bezeichnung des verlassenen Raums.
    pub br_bezeichnung: Option<String>,
    pub aufgeloest: Aufgeloest,
    /// Je entlassenem Fahrzeug: (`einsatz_fahrzeug.id`, Funkrufname, Ergebnis).
    pub entlassen: Vec<(i64, String, crate::fahrzeug::disposition_repo::Entlassen)>,
    pub meldung_id: Option<i64>,
}

/// Weist eine unangemeldete Einheit ab (D11) in der Transaktion des Aufrufers: aufgelöst 409,
/// ohne offene Übernahme 422; dann auflösen (Austritt mit Notiz „Einheit aufgelöst“,
/// Zeitachsen-Entlassung, Mitglieder frei), jedes gelöste Fahrzeug entlassen und die Meldung des
/// Eintreffens bestätigen. Endgültig.
pub async fn abweisen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Abgewiesen, AppError> {
    let (name, br_id, meldung_id) = require_offen_tx(&mut *conn, einsatz_id, id).await?;
    let br_bezeichnung: Option<String> = match br_id {
        Some(b) => {
            sqlx::query_scalar("SELECT bezeichnung FROM bereitstellungsraum WHERE id = ?")
                .bind(b)
                .fetch_optional(&mut *conn)
                .await?
        }
        None => None,
    };
    let aufgeloest = aufloesen_tx(
        &mut *conn,
        einsatz_id,
        id,
        benutzer_id,
        jetzt,
        Aufloesung::Aufloesen,
    )
    .await?;
    let mut entlassen = Vec::with_capacity(aufgeloest.fahrzeuge.len());
    for ef_id in &aufgeloest.fahrzeuge {
        let funkrufname: String = sqlx::query_scalar(
            "SELECT coalesce(f.funkrufname, ef.snap_funkrufname, '') FROM einsatz_fahrzeug ef \
             LEFT JOIN fahrzeug f ON f.id = ef.fahrzeug_id WHERE ef.id = ? AND ef.einsatz_id = ?",
        )
        .bind(ef_id)
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
        let e = crate::fahrzeug::disposition_repo::entlassen_tx(
            &mut *conn,
            einsatz_id,
            *ef_id,
            benutzer_id,
            jetzt,
        )
        .await?;
        entlassen.push((*ef_id, funkrufname, e));
    }
    if let Some(m) = meldung_id {
        crate::meldung::repo::bestaetige_tx(&mut *conn, org_id, einsatz_id, m, benutzer_id, jetzt)
            .await?;
    }
    Ok(Abgewiesen {
        name,
        br_bezeichnung,
        aufgeloest,
        entlassen,
        meldung_id,
    })
}

/// Spurprüfungen vor dem echten Löschen einer Einheit, je SQL und Grund ([`find_spur_tx`]).
const SPUREN_EINHEIT: &[(&str, &str)] = &[
    (
        "SELECT EXISTS(SELECT 1 FROM einsatz_kraft_zeitachse WHERE einheit_id = ?)",
        "Die Einheit hat eine Zeitachse",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM einsatz_abloesung \
                       WHERE einheit_id = ?1 OR abloesende_einheit_id = ?1)",
        "Die Einheit steht in der Ablösung",
    ),
    // LLH-1122 (Mig 0212): die Liste der Ablöser (befüllt ab LLH-1132) zählt wie die
    // Einzelplanung `abloesende_einheit_id` oben.
    (
        "SELECT EXISTS(SELECT 1 FROM einsatz_abloesung_abloeser WHERE einheit_id = ?)",
        "Die Einheit ist als Ablösung geplant",
    ),
    // LLH-1150 (Mig 0216): eine Besatzung stand beim Besatzungswechsel in der Einheit.
    (
        "SELECT EXISTS(SELECT 1 FROM einsatz_abloesung_besatzung WHERE einheit_vorher_id = ?)",
        "Ein Besatzungswechsel nennt die Einheit",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM etb_eintrag_einheit WHERE einheit_id = ?)",
        "Einträge im Einsatztagebuch nennen die Einheit",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM br_belegung WHERE objekt_typ = 'einheit' AND objekt_id = ?)",
        "Die Einheit war in einem Bereitstellungsraum",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM auftrag_empfaenger WHERE einheit_id = ?)",
        "Die Einheit ist Empfänger eines Auftrags",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM meldung WHERE einheit_id = ?)",
        "Eine Meldung oder Rückmeldung nennt die Einheit",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM einsatz_dokument WHERE bezug_einheit_id = ?)",
        "Ein Dokument bezieht sich auf die Einheit",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM befehl_verteiler WHERE einheit_id = ?1) \
             OR EXISTS(SELECT 1 FROM lagebericht_verteiler WHERE einheit_id = ?1)",
        "Ein Verteiler nennt die Einheit",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM verpflegung_ausgabe WHERE einheit_id = ?)",
        "Eine Verpflegungsausgabe nennt die Einheit",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM einsatz_personal WHERE einheit_id = ?)",
        "Der Einheit gehört Personal an",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM einsatz_fahrzeug WHERE einheit_id = ?)",
        "Der Einheit gehören Fahrzeuge an",
    ),
    (
        "SELECT EXISTS(SELECT 1 FROM einsatz_material WHERE einheit_id = ?)",
        "Der Einheit gehört Material an",
    ),
];

/// Der erste Grund, warum eine Einheit nicht spurlos gelöscht werden darf (design.md D3): eine
/// Zeitachse, eine Schicht der Ablösung, eine ETB-Verknüpfung, eine Belegung eines
/// Bereitstellungsraums, ein Auftrag, eine Meldung, ein Dokument, ein Verteiler, eine (auch
/// zurückgenommene) Verpflegungsausgabe an sie (LLH-1055, design.md D9) oder eine (auch
/// beendete) Kraft mit Verweis auf sie. `None` = keine Spur.
pub async fn find_spur_tx(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Option<&'static str>, AppError> {
    for &(sql, grund) in SPUREN_EINHEIT {
        let hat: bool = sqlx::query_scalar(sql)
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
        if hat {
            return Ok(Some(grund));
        }
    }
    Ok(None)
}

/// Wie eine Einheit gehen soll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Aufloesung {
    /// Auflösen (Normalweg): mit Spur weich, ohne Spur echt gelöscht (Spec
    /// `kraefte-entlassung` „Leere Einheit gelöscht“).
    Aufloesen,
    /// Stornieren einer Fehlanlage: nur ohne Spur, echt gelöscht; mit Spur 422.
    Stornieren,
}

/// Was das Auflösen über die Einheit hinaus berührt hat — für die Live-Ereignisse.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Aufgeloest {
    /// Echt gelöscht (keine Spur) statt weich aufgelöst.
    pub geloescht: bool,
    pub personal: Vec<i64>,
    pub fahrzeuge: Vec<i64>,
    pub material: Vec<i64>,
    /// Unter-Einheiten, die an die Über-Einheit gewandert sind.
    pub kinder: Vec<i64>,
    /// Bereitstellungsraum, aus dem die Einheit ausgetreten ist.
    pub br: Option<i64>,
    /// Laufende Schicht beendet oder ein fremder Verweis auf sie geleert.
    pub abloesung: bool,
    /// Entfallene Planungen als ablösende Einheit (LLH-1131): ETB-Einträge und Hinweise, nach
    /// dem Commit über `routes::abloesung::publish_kopplung`.
    pub abloesung_wirkung: crate::abloesung::hinweis::Wirkung,
}

/// Löst eine Einheit auf einer offenen Verbindung auf (atomar mit dem System-ETB, LLH-1079,
/// design.md D5): Mitglieder freigeben (`einheit_id = NULL` an Personal, Fahrzeug, Material),
/// Unter-Einheiten an die Über-Einheit hängen (ohne sie werden sie Wurzeln), Sprechgruppen und
/// Skizzenbezüge lösen, laufende Schicht beenden (Grund `aufloesung`, LLH-1128), einen
/// Bereitstellungsraum verlassen. Mit Spur ([`find_spur_tx`]) bleibt die Zeile als aufgelöst stehen und bekommt die
/// Entlassung in die Zeitachse (der Fan-out erreicht niemanden mehr); ohne Spur wird sie gelöscht.
/// [`Aufloesung::Stornieren`] lehnt eine Spur mit 422 ab. `NotFound`/`Conflict` wie
/// [`require_aktiv_tx`].
pub async fn aufloesen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &str,
    art: Aufloesung,
) -> Result<Aufgeloest, AppError> {
    require_aktiv_tx(conn, einsatz_id, id).await?;
    let spur = find_spur_tx(conn, id).await?;
    if let (Aufloesung::Stornieren, Some(grund)) = (art, spur) {
        return Err(AppError::UnprocessableEntity(format!(
            "{grund}; die Einheit lässt sich nur auflösen"
        )));
    }
    let parent: Option<i64> = sqlx::query_scalar(
        "SELECT ueber_einheit_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;

    let mut ergebnis = Aufgeloest {
        geloescht: spur.is_none(),
        ..Aufgeloest::default()
    };
    for (tabelle, ziel) in [
        ("einsatz_personal", &mut ergebnis.personal),
        ("einsatz_fahrzeug", &mut ergebnis.fahrzeuge),
        ("einsatz_material", &mut ergebnis.material),
    ] {
        *ziel = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "UPDATE {tabelle} SET einheit_id = NULL WHERE einheit_id = ? RETURNING id"
        )))
        .bind(id)
        .fetch_all(&mut *conn)
        .await?;
        ziel.sort_unstable();
    }
    ergebnis.kinder = sqlx::query_scalar(
        "UPDATE einsatz_einheit SET ueber_einheit_id = ? \
         WHERE ueber_einheit_id = ? AND einsatz_id = ? RETURNING id",
    )
    .bind(parent)
    .bind(id)
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    ergebnis.kinder.sort_unstable();
    // Polymorphe Bezüge der Fernmeldeskizze haben keinen FK (LFH-893, design.md D3).
    crate::stab::fernmeldeskizze::vergiss(
        conn,
        einsatz_id,
        crate::stab::fernmeldeskizze::Element::Einheit(id),
    )
    .await?;
    sqlx::query("DELETE FROM einsatz_einheit_sprechgruppe WHERE einheit_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    (ergebnis.abloesung, ergebnis.abloesung_wirkung) =
        crate::abloesung::repo::release_einheit_tx(conn, einsatz_id, id, benutzer_id, jetzt)
            .await?;
    ergebnis.br = crate::bereitstellungsraum::belegung_repo::austritt_bei_aufloesung_tx(
        conn,
        einsatz_id,
        id,
        benutzer_id,
    )
    .await?;

    if ergebnis.geloescht {
        sqlx::query("DELETE FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
        return Ok(ergebnis);
    }
    // Erst nach dem Lösen der Mitglieder: die Entlassung bleibt an der Einheit (design.md D5).
    crate::zeitachse::repo::schreibe_tx(
        conn,
        einsatz_id,
        benutzer_id,
        crate::zeitachse::repo::Kraft::Einheit(id),
        crate::zeitachse::repo::Neu {
            art: crate::zeitachse::ZeitachseArt::Entlassung,
            zeitpunkt_at: jetzt,
            quelle: crate::zeitachse::ZeitachseQuelle::Disposition,
            notiz: None,
        },
    )
    .await?;
    sqlx::query(
        "UPDATE einsatz_einheit SET aufgeloest_at = ?, aufgeloest_von = ?, fuehrer_id = NULL \
         WHERE id = ? AND einsatz_id = ? AND aufgeloest_at IS NULL",
    )
    .bind(jetzt)
    .bind(benutzer_id)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(ergebnis)
}

/// Pool-Wrapper mit eigener Transaktion (Auflösen als Normalweg).
pub async fn aufloesen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
) -> Result<Aufgeloest, AppError> {
    let mut tx = pool.begin().await?;
    let r = aufloesen_tx(
        &mut tx,
        einsatz_id,
        id,
        benutzer_id,
        &crate::zeit::jetzt(),
        Aufloesung::Aufloesen,
    )
    .await?;
    tx.commit().await?;
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Die ausgeschriebenen Kennzeichen in `SELECT_AUFGELOEST` gleichen den Makros, die auch
    /// die Belegung des Bereitstellungsraums nutzt.
    #[test]
    fn kennzeichen_gleichen_den_makros() {
        let flach = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
        let select = flach(SELECT_AUFGELOEST);
        for (makro, alias) in [
            (
                super::super::nicht_uebernommen_seit_sql!(),
                "nicht_uebernommen_seit",
            ),
            (super::super::unangemeldet_sql!(), "unangemeldet"),
        ] {
            let erwartet = format!("{} AS {alias}", flach(makro));
            assert!(
                select.contains(&erwartet),
                "fehlt in SELECT_AUFGELOEST: {erwartet}"
            );
        }
    }

    // ── Ableitung des Einheitenstatus ──────────────────────────────────────────────

    fn sw(id: i64, kategorie: crate::katalog::StatusKategorie, sortier: i64) -> StatusWert {
        StatusWert {
            status_id: id,
            label: format!("S{id}"),
            kategorie,
            farbe: None,
            fms_anker: Some(id),
            sortier,
        }
    }

    fn fz(ef_id: i64, status: Option<StatusWert>, seit: Option<&str>) -> EinheitMitgliedFahrzeug {
        EinheitMitgliedFahrzeug {
            ef_id,
            funkrufname: format!("F{ef_id}"),
            fahrzeugtyp: None,
            status,
            status_seit: seit.map(str::to_string),
        }
    }

    use crate::katalog::StatusKategorie::{Gebunden, NichtVerfuegbar, Verfuegbar};

    #[test]
    fn kumuliere_summiert_unterstellte_und_terminiert_im_zyklus() {
        let eigene = HashMap::from([
            (1, Staerke::neu(1, 1, 2)),
            (2, Staerke::neu(0, 1, 3)),
            (3, Staerke::neu(0, 0, 1)),
        ]);
        // 1 → 2 → 3 → 1: ein korrupter Zyklus; jede Einheit zählt trotzdem genau einmal.
        let kinder = HashMap::from([(1, vec![2]), (2, vec![3]), (3, vec![1])]);
        assert_eq!(kumuliere(&eigene, &kinder, 1), Staerke::neu(1, 2, 6));
        assert_eq!(
            kumuliere(&eigene, &HashMap::new(), 2),
            Staerke::neu(0, 1, 3)
        );
        // Ohne eigenen Eintrag: keine wertbaren Kräfte.
        assert_eq!(kumuliere(&eigene, &kinder, 99), Staerke::neu(0, 0, 0));
    }

    #[test]
    fn ohne_fahrzeug_gilt_der_handstatus() {
        let s = leite_status_ab(
            &[],
            Some(sw(2, Verfuegbar, 20)),
            Some("2026-09-22 08:00:00".into()),
        );
        assert_eq!(s.quelle, EinheitStatusQuelle::Hand);
        assert_eq!(s.status.unwrap().status_id, 2);
        assert_eq!(s.kategorie, Some(Verfuegbar));
        assert_eq!(s.seit.as_deref(), Some("2026-09-22 08:00:00"));
    }

    #[test]
    fn ohne_fahrzeug_und_ohne_hand_gibt_es_keinen() {
        let s = leite_status_ab(&[], None, None);
        assert_eq!(s.quelle, EinheitStatusQuelle::Ohne);
        assert!(s.status.is_none() && s.seit.is_none() && s.kategorie.is_none());
    }

    #[test]
    fn gleicher_status_seit_ist_der_juengste_wechsel_und_hand_zaehlt_nicht() {
        let s = leite_status_ab(
            &[
                fz(1, Some(sw(4, Gebunden, 40)), Some("2026-09-22 09:12:00")),
                fz(2, Some(sw(4, Gebunden, 40)), Some("2026-09-22 09:40:00")),
            ],
            Some(sw(2, Verfuegbar, 20)),
            Some("2026-09-22 07:00:00".into()),
        );
        assert_eq!(s.quelle, EinheitStatusQuelle::Fahrzeuge);
        assert_eq!(s.status.unwrap().status_id, 4);
        assert_eq!(s.seit.as_deref(), Some("2026-09-22 09:40:00"));
    }

    #[test]
    fn ein_unbekannter_zeitpunkt_macht_seit_unbekannt() {
        let s = leite_status_ab(
            &[
                fz(1, Some(sw(4, Gebunden, 40)), Some("2026-09-22 09:12:00")),
                fz(2, Some(sw(4, Gebunden, 40)), None),
            ],
            None,
            None,
        );
        assert_eq!(s.quelle, EinheitStatusQuelle::Fahrzeuge);
        assert_eq!(
            s.seit, None,
            "das Maximum über bekannte Werte wäre erfunden"
        );
    }

    #[test]
    fn alle_fahrzeuge_ohne_status_ergibt_ohne() {
        let s = leite_status_ab(
            &[fz(1, None, None), fz(2, None, None)],
            Some(sw(2, Verfuegbar, 20)),
            None,
        );
        assert_eq!(s.quelle, EinheitStatusQuelle::Ohne);
    }

    #[test]
    fn gemischt_mit_gleicher_kategorie_behaelt_die_kategorie() {
        let s = leite_status_ab(
            &[
                fz(1, Some(sw(4, Gebunden, 40)), Some("2026-09-22 09:12:00")),
                fz(2, Some(sw(3, Gebunden, 30)), Some("2026-09-22 09:40:00")),
                fz(3, Some(sw(4, Gebunden, 40)), Some("2026-09-22 09:50:00")),
            ],
            None,
            None,
        );
        assert_eq!(s.quelle, EinheitStatusQuelle::Gemischt);
        assert_eq!(s.kategorie, Some(Gebunden));
        assert_eq!(s.seit, None);
        let v: Vec<(Option<i64>, u32)> = s
            .verteilung
            .iter()
            .map(|a| (a.status.as_ref().map(|x| x.status_id), a.anzahl))
            .collect();
        assert_eq!(v, vec![(Some(3), 1), (Some(4), 2)], "Katalogreihenfolge");
    }

    #[test]
    fn gemischt_ueber_kategorien_und_ohne_status_zuletzt() {
        let s = leite_status_ab(
            &[
                fz(1, None, None),
                fz(2, Some(sw(6, NichtVerfuegbar, 60)), None),
                fz(3, Some(sw(4, Gebunden, 40)), None),
            ],
            None,
            None,
        );
        assert_eq!(s.quelle, EinheitStatusQuelle::Gemischt);
        assert_eq!(s.kategorie, None);
        let v: Vec<Option<i64>> = s
            .verteilung
            .iter()
            .map(|a| a.status.as_ref().map(|x| x.status_id))
            .collect();
        assert_eq!(v, vec![Some(4), Some(6), None]);
    }

    /// Org(1) + Einsatz + ein Benutzer (angelegt_von); liefert (einsatz, benutzer).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar("INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1, 'U', 'u', 'h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz, benutzer)
    }

    fn daten<'a>(
        name: &'a str,
        typ: Option<i64>,
        abschnitt: Option<i64>,
        parent: Option<i64>,
        soll: Option<(i64, i64, i64)>,
    ) -> EinheitDaten<'a> {
        let (f, u, m) = match soll {
            Some((f, u, m)) => (Some(f), Some(u), Some(m)),
            None => (None, None, None),
        };
        EinheitDaten {
            name,
            abschnitt_id: abschnitt,
            ueber_einheit_id: parent,
            typ_id: typ,
            soll_fuehrer: f,
            soll_unterfuehrer: u,
            soll_mannschaft: m,
            bemerkung: None,
            funkrufname: None,
            kommunikationsmittel: None,
            erreichbarkeit: None,
            sortier: 0,
            tz_fachaufgabe: None,
            tz_organisation: None,
        }
    }

    async fn ad_hoc_person(pool: &SqlitePool, einsatz: i64, name: &str, pos: &str) -> i64 {
        sqlx::query_scalar("INSERT INTO einsatz_personal (einsatz_id, snap_name, staerke_position) VALUES (?, ?, ?) RETURNING id")
            .bind(einsatz).bind(name).bind(pos).fetch_one(pool).await.unwrap()
    }

    /// Einsatz + Org + Benutzer + eine Einheit; liefert (einsatz_id, einheit_id).
    async fn seed_einheit(pool: &SqlitePool) -> (i64, i64) {
        let (einsatz, b) = setup(pool).await;
        let e = anlegen(pool, einsatz, 1, daten("Trupp", None, None, None, None), b)
            .await
            .unwrap();
        (einsatz, e.id)
    }

    /// Abschnitt, Einheit und Untereinheit entstehen in EINER Transaktion; die Prüfungen müssen die
    /// noch nicht committeten Zeilen sehen.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn einheit_auf_abschnitt_aus_derselben_transaktion() {
        let (_dir, pool) = crate::db::test_pool_datei().await;
        let (einsatz, b) = setup(&pool).await;
        let (abschnitt, einheit, trupp) = crate::write_retry!(&pool, |conn| {
            let abschnitt = crate::einsatzabschnitt::repo::create_tx(
                &mut *conn,
                einsatz,
                &crate::einsatzabschnitt::repo::AbschnittDaten {
                    name: "Nord",
                    ueber_abschnitt_id: None,
                    leiter_id: None,
                    bemerkung: None,
                    kommunikationsmittel: None,
                    erreichbarkeit: None,
                    sortier: 0,
                    kurzbezeichnung: None,
                    lagezustand: None,
                    abschnittsauftrag: None,
                },
            )
            .await?;
            let zug = daten("1. Zug", None, Some(abschnitt), None, None);
            let einheit = anlegen_tx(&mut *conn, einsatz, 1, &zug, b).await?;
            let trupp = daten("Trupp", None, None, Some(einheit), None);
            let trupp = anlegen_tx(&mut *conn, einsatz, 1, &trupp, b).await?;
            Ok((abschnitt, einheit, trupp))
        })
        .unwrap();
        let e = laden(&pool, einsatz, einheit).await.unwrap();
        assert_eq!(e.abschnitt_id, Some(abschnitt));
        let t = laden(&pool, einsatz, trupp).await.unwrap();
        assert_eq!(t.ueber_einheit_id, Some(einheit));
    }

    /// Das taktische Zeichen kommt schon beim Anlegen mit (LLH-1049, Kopfdaten aus der Vorlage).
    #[tokio::test]
    async fn zeichen_beim_anlegen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let mut d = daten("Rettungsstaffel", None, None, None, None);
        d.tz_fachaufgabe = Some("rettungswesen");
        d.tz_organisation = Some("hilfsorganisation");
        let e = anlegen(&pool, einsatz, 1, d, b).await.unwrap();
        assert_eq!(e.tz_fachaufgabe.as_deref(), Some("rettungswesen"));
        assert_eq!(e.tz_organisation.as_deref(), Some("hilfsorganisation"));
        let ohne = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, None, None), b)
            .await
            .unwrap();
        assert_eq!(ohne.tz_fachaufgabe, None);
        assert_eq!(ohne.tz_organisation, None);
    }

    #[tokio::test]
    async fn position_setzen_und_loeschen() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, einheit_id) = seed_einheit(&pool).await;

        let a = aktualisiere_position(
            &pool,
            einsatz_id,
            einheit_id,
            PositionPatch {
                lat: Some(Some(50.1)),
                lon: Some(Some(8.6)),
                tz_fachaufgabe: Some(Some("rettungswesen")),
                tz_organisation: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(a.lat, Some(50.1));
        assert_eq!(a.lon, Some(8.6));
        assert_eq!(a.tz_fachaufgabe.as_deref(), Some("rettungswesen"));

        let b = aktualisiere_position(
            &pool,
            einsatz_id,
            einheit_id,
            PositionPatch {
                lat: Some(None),
                lon: Some(None),
                tz_fachaufgabe: None,
                tz_organisation: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(b.lat, None);
        assert_eq!(b.lon, None);
        assert_eq!(b.tz_fachaufgabe.as_deref(), Some("rettungswesen")); // unverändert
    }

    #[tokio::test]
    async fn anlegen_loest_typ_und_abschnitt_auf() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18) RETURNING id")
            .fetch_one(&pool).await.unwrap();
        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();

        let e = anlegen(
            &pool,
            einsatz,
            1,
            daten("1. Zug", Some(typ), Some(abschnitt), None, None),
            b,
        )
        .await
        .unwrap();
        assert_eq!(e.typ_label.as_deref(), Some("Zug"));
        assert_eq!(e.abschnitt_name.as_deref(), Some("Nord"));
        // Kein Override → Soll kommt aus dem Typ.
        assert_eq!(e.soll, Some(Staerke::neu(1, 3, 18)));
        assert_eq!(e.ist, Staerke::neu(0, 0, 0));
    }

    #[tokio::test]
    async fn soll_override_schlaegt_typ_default_und_ohne_typ_ist_none() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18) RETURNING id")
            .fetch_one(&pool).await.unwrap();
        // Override 0/2/10 schlägt Typ-Default.
        let mit_override = anlegen(
            &pool,
            einsatz,
            1,
            daten("Sonderzug", Some(typ), None, None, Some((0, 2, 10))),
            b,
        )
        .await
        .unwrap();
        assert_eq!(mit_override.soll, Some(Staerke::neu(0, 2, 10)));
        // Kein Typ, kein Override → None.
        let ohne = anlegen(
            &pool,
            einsatz,
            1,
            daten("Freie Einheit", None, None, None, None),
            b,
        )
        .await
        .unwrap();
        assert_eq!(ohne.soll, None);
    }

    #[tokio::test]
    async fn typ_aus_fremder_org_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')")
            .execute(&pool)
            .await
            .unwrap();
        let fremd_typ: i64 = sqlx::query_scalar(
            "INSERT INTO einheit_typ (org_id, label) VALUES (2, 'Zug') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(matches!(
            anlegen(
                &pool,
                einsatz,
                1,
                daten("X", Some(fremd_typ), None, None, None),
                b
            )
            .await
            .unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn deaktivierter_typ_bleibt_beim_aktualisieren_gueltig() {
        // Ein deaktivierter Typ bleibt für bestehende Einheiten gültig.
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar(
            "INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e = anlegen(
            &pool,
            einsatz,
            1,
            daten("1. Zug", Some(typ), None, None, None),
            b,
        )
        .await
        .unwrap();
        // Typ deaktivieren.
        crate::einheit::typ_repo::deaktivieren(&pool, 1, typ)
            .await
            .unwrap();
        // PATCH nur des Namens gelingt. Der zweite Patch sendet `typ_id` ausdrücklich mit, damit
        // „deaktivierter Typ bleibt setzbar“ geprüft wird und nicht bloß am Nicht-Anfassen hängt.
        let nachher = patche(
            &pool,
            einsatz,
            1,
            e.id,
            EinheitPatch {
                name: Some("1. Zug umbenannt"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(nachher.name, "1. Zug umbenannt");
        assert_eq!(nachher.typ_id, Some(typ));

        let erneut = patche(
            &pool,
            einsatz,
            1,
            e.id,
            EinheitPatch {
                typ_id: Some(Some(typ)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(erneut.typ_id, Some(typ), "deaktivierter Typ bleibt setzbar");
    }

    #[tokio::test]
    async fn parent_in_fremdem_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let fremd_einheit = anlegen(&pool, fremd, 1, daten("F", None, None, None, None), b)
            .await
            .unwrap();
        assert!(matches!(
            anlegen(
                &pool,
                einsatz,
                1,
                daten("X", None, None, Some(fremd_einheit.id), None),
                b
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn zyklus_transitiv_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let a = anlegen(&pool, einsatz, 1, daten("A", None, None, None, None), b)
            .await
            .unwrap();
        let c = anlegen(
            &pool,
            einsatz,
            1,
            daten("B", None, None, Some(a.id), None),
            b,
        )
        .await
        .unwrap();
        let d = anlegen(
            &pool,
            einsatz,
            1,
            daten("C", None, None, Some(c.id), None),
            b,
        )
        .await
        .unwrap();
        // A unter C (Nachfahre) → transitiver Zyklus.
        assert!(matches!(
            patche(
                &pool,
                einsatz,
                1,
                a.id,
                EinheitPatch {
                    ueber_einheit_id: Some(Some(d.id)),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::Validation(_)
        ));
        // `null` löst die Zuordnung und läuft nicht in die Zyklenprüfung.
        assert!(patche(
            &pool,
            einsatz,
            1,
            a.id,
            EinheitPatch {
                ueber_einheit_id: Some(None),
                ..Default::default()
            }
        )
        .await
        .is_ok());
    }

    /// Nicht gesendete Spalten bleiben stehen (Bemerkung, Kommunikation, Soll-Trio, `sortier`).
    #[tokio::test]
    async fn patche_laesst_nicht_gesendete_spalten_stehen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let e = anlegen(
            &pool,
            einsatz,
            1,
            EinheitDaten {
                name: "1. Zug",
                abschnitt_id: None,
                ueber_einheit_id: None,
                typ_id: None,
                soll_fuehrer: Some(1),
                soll_unterfuehrer: Some(3),
                soll_mannschaft: Some(18),
                bemerkung: Some("Bem"),
                funkrufname: Some("Florian HM 12/44"),
                kommunikationsmittel: Some("digitalfunk"),
                erreichbarkeit: Some("0170/1"),
                sortier: 42,
                tz_fachaufgabe: None,
                tz_organisation: None,
            },
            b,
        )
        .await
        .unwrap();
        let nachher = patche(
            &pool,
            einsatz,
            1,
            e.id,
            EinheitPatch {
                name: Some("Umbenannt"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(nachher.name, "Umbenannt");
        assert_eq!(nachher.bemerkung.as_deref(), Some("Bem"));
        assert_eq!(nachher.funkrufname.as_deref(), Some("Florian HM 12/44"));
        assert_eq!(nachher.kommunikationsmittel.as_deref(), Some("digitalfunk"));
        assert_eq!(nachher.erreichbarkeit.as_deref(), Some("0170/1"));
        assert_eq!(nachher.soll, Some(crate::staerke::Staerke::neu(1, 3, 18)));
        assert_eq!(nachher.sortier, 42);
    }

    /// Bind-Reihenfolge der zwölf Flag/Wert-Paare: alle Spalten in EINEM Patch auf distinkte Werte
    /// setzen und einzeln prüfen.
    #[tokio::test]
    async fn patche_setzt_jede_spalte_an_ihren_platz() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar(
            "INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let parent = anlegen(&pool, einsatz, 1, daten("Oben", None, None, None, None), b)
            .await
            .unwrap();
        let e = anlegen(
            &pool,
            einsatz,
            1,
            daten("1. Zug", None, None, None, None),
            b,
        )
        .await
        .unwrap();
        let nachher = patche(
            &pool,
            einsatz,
            1,
            e.id,
            EinheitPatch {
                name: Some("Neu"),
                abschnitt_id: Some(None),
                ueber_einheit_id: Some(Some(parent.id)),
                typ_id: Some(Some(typ)),
                soll_fuehrer: Some(Some(2)),
                soll_unterfuehrer: Some(Some(5)),
                soll_mannschaft: Some(Some(30)),
                bemerkung: Some(Some("B")),
                funkrufname: Some(Some("F")),
                kommunikationsmittel: Some(Some("K")),
                erreichbarkeit: Some(Some("E")),
                sortier: Some(7),
            },
        )
        .await
        .unwrap();
        assert_eq!(nachher.name, "Neu");
        assert_eq!(nachher.abschnitt_id, None);
        assert_eq!(nachher.ueber_einheit_id, Some(parent.id));
        assert_eq!(nachher.typ_id, Some(typ));
        assert_eq!(nachher.soll, Some(crate::staerke::Staerke::neu(2, 5, 30)));
        assert_eq!(nachher.bemerkung.as_deref(), Some("B"));
        assert_eq!(nachher.funkrufname.as_deref(), Some("F"));
        assert_eq!(nachher.kommunikationsmittel.as_deref(), Some("K"));
        assert_eq!(nachher.erreichbarkeit.as_deref(), Some("E"));
        assert_eq!(nachher.sortier, 7);
    }

    #[tokio::test]
    async fn patche_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e = anlegen(&pool, einsatz, 1, daten("X", None, None, None, None), b)
            .await
            .unwrap();
        assert!(matches!(
            patche(
                &pool,
                fremd,
                1,
                e.id,
                EinheitPatch {
                    name: Some("Y"),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            soll_roh(&pool, fremd, e.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn fuehrer_muss_mitglied_dieser_einheit_sein() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let e = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, None, None), b)
            .await
            .unwrap();
        let chef = ad_hoc_person(&pool, einsatz, "Chef", "fuehrer").await;
        // Noch nicht Mitglied → Validation.
        assert!(matches!(
            setze_fuehrer(&pool, einsatz, e.id, Some(chef))
                .await
                .unwrap_err(),
            AppError::Validation(_)
        ));
        // Nach Zuordnung erlaubt.
        mitglied_repo::zuordnen_personal(&pool, einsatz, e.id, chef)
            .await
            .unwrap();
        setze_fuehrer(&pool, einsatz, e.id, Some(chef))
            .await
            .unwrap();
        assert_eq!(
            laden(&pool, einsatz, e.id).await.unwrap().fuehrer_id,
            Some(chef)
        );
        // fuehrer_name aufgelöst.
        assert_eq!(
            laden(&pool, einsatz, e.id)
                .await
                .unwrap()
                .fuehrer_name
                .as_deref(),
            Some("Chef")
        );
    }

    #[tokio::test]
    async fn ist_kumuliert_summiert_unterstellte_rekursiv() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        // Zug → Gruppe → Trupp (3 Ebenen).
        let zug = anlegen(&pool, einsatz, 1, daten("Zug", None, None, None, None), b)
            .await
            .unwrap();
        let gruppe = anlegen(
            &pool,
            einsatz,
            1,
            daten("Gruppe", None, None, Some(zug.id), None),
            b,
        )
        .await
        .unwrap();
        let trupp = anlegen(
            &pool,
            einsatz,
            1,
            daten("Trupp", None, None, Some(gruppe.id), None),
            b,
        )
        .await
        .unwrap();
        // je Ebene ein Mannschafter.
        for (einheit, name) in [(zug.id, "Z"), (gruppe.id, "G"), (trupp.id, "T")] {
            let ep = ad_hoc_person(&pool, einsatz, name, "mannschaft").await;
            mitglied_repo::zuordnen_personal(&pool, einsatz, einheit, ep)
                .await
                .unwrap();
        }
        let zug_geladen = laden(&pool, einsatz, zug.id).await.unwrap();
        assert_eq!(zug_geladen.ist, Staerke::neu(0, 0, 1), "eigene Ist");
        assert_eq!(
            zug_geladen.ist_kumuliert,
            Staerke::neu(0, 0, 3),
            "eigene + Gruppe + Trupp"
        );
        let gruppe_geladen = laden(&pool, einsatz, gruppe.id).await.unwrap();
        assert_eq!(gruppe_geladen.ist_kumuliert, Staerke::neu(0, 0, 2));
    }

    #[tokio::test]
    async fn aufloesen_gibt_mitglieder_frei_und_zieht_unter_einheiten_hoch() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let zug = anlegen(&pool, einsatz, 1, daten("Zug", None, None, None, None), b)
            .await
            .unwrap();
        let gruppe = anlegen(
            &pool,
            einsatz,
            1,
            daten("Gruppe", None, None, Some(zug.id), None),
            b,
        )
        .await
        .unwrap();
        let trupp = anlegen(
            &pool,
            einsatz,
            1,
            daten("Trupp", None, None, Some(gruppe.id), None),
            b,
        )
        .await
        .unwrap();
        let ep = ad_hoc_person(&pool, einsatz, "Mann", "mannschaft").await;
        mitglied_repo::zuordnen_personal(&pool, einsatz, gruppe.id, ep)
            .await
            .unwrap();

        aufloesen(&pool, einsatz, gruppe.id, b).await.unwrap();

        // Mitglied frei.
        let einheit_id: Option<i64> =
            sqlx::query_scalar("SELECT einheit_id FROM einsatz_personal WHERE id = ?")
                .bind(ep)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(einheit_id, None);
        // Trupp hängt jetzt direkt unter Zug.
        assert_eq!(
            laden(&pool, einsatz, trupp.id)
                .await
                .unwrap()
                .ueber_einheit_id,
            Some(zug.id)
        );
        // Die Gruppe hatte ein Mitglied (eine Spur): sie bleibt als aufgelöst stehen und fehlt in
        // der Liste (LLH-1079).
        assert!(laden(&pool, einsatz, gruppe.id)
            .await
            .unwrap()
            .aufgeloest_at
            .is_some());
        assert!(!liste(&pool, einsatz)
            .await
            .unwrap()
            .iter()
            .any(|e| e.id == gruppe.id));
    }

    #[tokio::test]
    async fn einheit_anzeige_enthaelt_zugeordnete_sprechgruppen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let e = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, None, None), b)
            .await
            .unwrap();
        let kat = crate::sprechgruppe::repo::anlegen_katalog(
            &pool,
            1,
            crate::sprechgruppe::repo::KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: None,
                netz: None,
                sicherheit: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
        crate::sprechgruppe::repo::setze_einheit_sprechgruppen(&pool, 1, einsatz, e.id, &[kat.id])
            .await
            .unwrap();
        let geladen = laden(&pool, einsatz, e.id).await.unwrap();
        assert_eq!(geladen.sprechgruppen.len(), 1);
        assert_eq!(geladen.sprechgruppen[0].bezeichnung, "412_F_DRK");
        // Leeren: kein Eintrag mehr.
        crate::sprechgruppe::repo::setze_einheit_sprechgruppen(&pool, 1, einsatz, e.id, &[])
            .await
            .unwrap();
        let geleert = laden(&pool, einsatz, e.id).await.unwrap();
        assert_eq!(geleert.sprechgruppen.len(), 0);
    }

    #[tokio::test]
    async fn aufloesen_gibt_material_frei() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let gruppe = anlegen(
            &pool,
            einsatz,
            1,
            daten("Gruppe", None, None, None, None),
            b,
        )
        .await
        .unwrap();
        let em: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, einheit_id, snap_bezeichnung, menge, art) VALUES (?, ?, 'Wolldecke', 50, 'verbrauchsgut') RETURNING id",
        ).bind(einsatz).bind(gruppe.id).fetch_one(&pool).await.unwrap();

        aufloesen(&pool, einsatz, gruppe.id, b).await.unwrap();
        let einheit_id: Option<i64> =
            sqlx::query_scalar("SELECT einheit_id FROM einsatz_material WHERE id = ?")
                .bind(em)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(einheit_id, None, "Material muss beim Auflösen frei werden");
    }

    // ── Auflösen und Stornieren (LLH-1079) ───────────────────────────────────────────

    async fn aufloesen_als(
        pool: &SqlitePool,
        einsatz: i64,
        id: i64,
        b: i64,
        art: Aufloesung,
    ) -> Result<Aufgeloest, AppError> {
        let mut tx = pool.begin().await.unwrap();
        let r = aufloesen_tx(&mut tx, einsatz, id, b, "2026-10-13 15:00:00", art).await;
        if r.is_ok() {
            tx.commit().await.unwrap();
        }
        r
    }

    async fn exists(pool: &SqlitePool, id: i64) -> bool {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM einsatz_einheit WHERE id = ?)")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// Spec `kraefte-entlassung`, Schreibwege an beendeten Kräften: eine aufgelöste Einheit
    /// wird keiner Einheit mehr übergeordnet, weder beim Bilden noch per PATCH (409).
    #[tokio::test]
    async fn aufgeloeste_einheit_ist_keine_uebergeordnete() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let alt = anlegen(&pool, einsatz, 1, daten("Alt", None, None, None, None), b)
            .await
            .unwrap();
        let trupp = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, None, None), b)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE einsatz_einheit SET aufgeloest_at = '2026-10-13 15:00:00' WHERE id = ?",
        )
        .bind(alt.id)
        .execute(&pool)
        .await
        .unwrap();

        let neu = anlegen(
            &pool,
            einsatz,
            1,
            daten("Neu", None, None, Some(alt.id), None),
            b,
        )
        .await;
        assert!(matches!(neu, Err(AppError::Conflict(_))), "{neu:?}");
        let patch = patche(
            &pool,
            einsatz,
            1,
            trupp.id,
            EinheitPatch {
                ueber_einheit_id: Some(Some(alt.id)),
                ..Default::default()
            },
        )
        .await;
        assert!(matches!(patch, Err(AppError::Conflict(_))), "{patch:?}");
    }

    /// Spec „Leere Einheit gelöscht“: ohne jede Spur geht die Zeile, beim Auflösen wie beim
    /// Stornieren.
    #[tokio::test]
    async fn leere_einheit_wird_geloescht() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        for art in [Aufloesung::Aufloesen, Aufloesung::Stornieren] {
            let e = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, None, None), b)
                .await
                .unwrap();
            let r = aufloesen_als(&pool, einsatz, e.id, b, art).await.unwrap();
            assert!(r.geloescht, "{art:?}");
            assert!(!exists(&pool, e.id).await, "{art:?}");
        }
    }

    /// Spec „Aufgelöste Einheit bleibt im Nachweis“: mit Spur bleibt die Zeile als aufgelöst, ist
    /// aus der Liste heraus und unter `list_aufgeloeste` zu finden, verlässt ihren
    /// Bereitstellungsraum und ihre Sprechgruppen; ein zweites Auflösen ist 409.
    #[tokio::test]
    async fn einheit_mit_spur_bleibt_aufgeloest_stehen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let e = anlegen(
            &pool,
            einsatz,
            1,
            daten("Florian 1", None, None, None, None),
            b,
        )
        .await
        .unwrap();
        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, status, erfasst_von, geaendert_von) \
             VALUES (?1, 'BR Nord', 'aktiv', ?2, ?2) RETURNING id",
        )
        .bind(einsatz)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        crate::bereitstellungsraum::belegung_repo::belege(
            &pool, einsatz, br, "einheit", e.id, "eintritt", None, b,
        )
        .await
        .unwrap();
        let kat = crate::sprechgruppe::repo::anlegen_katalog(
            &pool,
            1,
            crate::sprechgruppe::repo::KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: None,
                netz: None,
                sicherheit: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
        crate::sprechgruppe::repo::setze_einheit_sprechgruppen(&pool, 1, einsatz, e.id, &[kat.id])
            .await
            .unwrap();

        // Stornieren einer Einheit mit Spur ist ein Zustand: 422 mit dem Grund.
        let err = aufloesen_als(&pool, einsatz, e.id, b, Aufloesung::Stornieren)
            .await
            .unwrap_err();
        match err {
            AppError::UnprocessableEntity(m) => {
                assert_eq!(
                    m,
                    "Die Einheit war in einem Bereitstellungsraum; die Einheit lässt sich nur \
                     auflösen"
                )
            }
            e => panic!("{e:?}"),
        }

        let r = aufloesen_als(&pool, einsatz, e.id, b, Aufloesung::Aufloesen)
            .await
            .unwrap();
        assert_eq!(r.br, Some(br));
        assert!(!r.geloescht);
        let anzeige = laden(&pool, einsatz, e.id).await.unwrap();
        assert_eq!(
            anzeige.aufgeloest_at.as_deref(),
            Some("2026-10-13 15:00:00")
        );
        assert_eq!(anzeige.aufgeloest_von, Some(b));
        assert!(anzeige.sprechgruppen.is_empty());
        assert!(liste(&pool, einsatz).await.unwrap().is_empty());
        let aufgeloest = list_aufgeloeste(&pool, einsatz).await.unwrap();
        assert_eq!(aufgeloest.iter().map(|e| e.id).collect::<Vec<_>>(), [e.id]);
        let austritt: String = sqlx::query_scalar(
            "SELECT art FROM br_belegung WHERE objekt_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(e.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(austritt, "austritt");

        for art in [Aufloesung::Aufloesen, Aufloesung::Stornieren] {
            assert!(matches!(
                aufloesen_als(&pool, einsatz, e.id, b, art)
                    .await
                    .unwrap_err(),
                AppError::Conflict(_)
            ));
        }
    }

    // ── Kantenfälle der Satz-Aggregation ────────────────────────────────────────────
    // Die Anreicherung von `liste()`/`laden()` läuft satzbasiert; diese Tests pinnen die Ränder,
    // an denen eine Sammelabfrage anders reagieren könnte als Einzelabfragen.

    /// Einsatz ohne Einheiten: leere Liste; die Sammelabfragen laufen bei leerer Eingabe nicht.
    #[tokio::test]
    async fn liste_ohne_einheiten_ist_leer() {
        let pool = crate::db::test_pool().await;
        let (einsatz, _b) = setup(&pool).await;
        assert!(liste(&pool, einsatz).await.unwrap().is_empty());
    }

    /// Einheit ohne Mitglied: leere Listen und Null-Stärke; ein fehlender Map-Eintrag führt nicht
    /// zu `NotFound`.
    #[tokio::test]
    async fn einheit_ohne_mitglieder_liefert_leere_listen_und_nullstaerke() {
        let pool = crate::db::test_pool().await;
        let (einsatz, einheit_id) = seed_einheit(&pool).await;
        let liste = liste(&pool, einsatz).await.unwrap();
        assert_eq!(liste.len(), 1);
        let e = &liste[0];
        assert_eq!(e.id, einheit_id);
        assert_eq!(e.ist, Staerke::neu(0, 0, 0));
        assert_eq!(e.ist_kumuliert, Staerke::neu(0, 0, 0));
        assert!(e.personal_mitglieder.is_empty());
        assert!(e.fahrzeug_mitglieder.is_empty());
        assert!(e.material_mitglieder.is_empty());
        assert!(e.sprechgruppen.is_empty());
    }

    /// Korrupte Altdaten mit Zyklus in der Unterstellung: das Visited-Set lässt die Summierung
    /// terminieren, sonst hinge jeder Listenabruf. Der Zyklus wird per UPDATE gelegt, weil
    /// `waere_zyklus` ihn über die API verhindert.
    #[tokio::test]
    async fn ist_kumuliert_terminiert_bei_korruptem_zyklus() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        // A → B → C, je ein Mannschafter.
        let a = anlegen(&pool, einsatz, 1, daten("A", None, None, None, None), b)
            .await
            .unwrap();
        let c_ = anlegen(
            &pool,
            einsatz,
            1,
            daten("B", None, None, Some(a.id), None),
            b,
        )
        .await
        .unwrap();
        let d = anlegen(
            &pool,
            einsatz,
            1,
            daten("C", None, None, Some(c_.id), None),
            b,
        )
        .await
        .unwrap();
        for einheit in [a.id, c_.id, d.id] {
            let ep = ad_hoc_person(&pool, einsatz, "M", "mannschaft").await;
            mitglied_repo::zuordnen_personal(&pool, einsatz, einheit, ep)
                .await
                .unwrap();
        }
        // Korruption: C wird Vater von A → Zyklus A → B → C → A.
        sqlx::query("UPDATE einsatz_einheit SET ueber_einheit_id = ? WHERE id = ?")
            .bind(d.id)
            .bind(a.id)
            .execute(&pool)
            .await
            .unwrap();

        // Darf terminieren und jede Einheit genau EINMAL zählen (Visited-Set).
        let alle = liste(&pool, einsatz).await.unwrap();
        assert_eq!(alle.len(), 3);
        for e in &alle {
            assert_eq!(
                e.ist_kumuliert,
                Staerke::neu(0, 0, 3),
                "im Zyklus sieht jeder Knoten alle drei — genau einmal"
            );
        }
        // Auch der Einzelabruf terminiert.
        assert_eq!(
            laden(&pool, einsatz, a.id).await.unwrap().ist_kumuliert,
            Staerke::neu(0, 0, 3)
        );
    }

    /// `laden()` und der passende Eintrag aus `liste()` sind Feld für Feld identisch.
    #[tokio::test]
    async fn laden_ist_identisch_zum_eintrag_aus_liste() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let zug = anlegen(&pool, einsatz, 1, daten("Zug", None, None, None, None), b)
            .await
            .unwrap();
        let gruppe = anlegen(
            &pool,
            einsatz,
            1,
            daten("Gruppe", None, None, Some(zug.id), None),
            b,
        )
        .await
        .unwrap();
        // Personal (mehrere, für die Reihenfolge), Fahrzeug, Material, Sprechgruppe.
        for (name, pos) in [
            ("Chef", "fuehrer"),
            ("M1", "mannschaft"),
            ("M2", "mannschaft"),
        ] {
            let ep = ad_hoc_person(&pool, einsatz, name, pos).await;
            mitglied_repo::zuordnen_personal(&pool, einsatz, zug.id, ep)
                .await
                .unwrap();
        }
        let ep_gruppe = ad_hoc_person(&pool, einsatz, "G1", "unterfuehrer").await;
        mitglied_repo::zuordnen_personal(&pool, einsatz, gruppe.id, ep_gruppe)
            .await
            .unwrap();
        let ef: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();
        mitglied_repo::zuordnen_fahrzeug(&pool, einsatz, zug.id, ef)
            .await
            .unwrap();
        let em: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, menge, art) VALUES (?, 'Wolldecke', 50, 'verbrauchsgut') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();
        crate::material::ort::set_ort_tx(
            &mut pool.acquire().await.unwrap(),
            einsatz,
            em,
            Some(crate::material::ort::MaterialOrt::Einheit(zug.id)),
        )
        .await
        .unwrap();
        let kat = crate::sprechgruppe::repo::anlegen_katalog(
            &pool,
            1,
            crate::sprechgruppe::repo::KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: None,
                netz: None,
                sicherheit: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
        crate::sprechgruppe::repo::setze_einheit_sprechgruppen(
            &pool,
            1,
            einsatz,
            zug.id,
            &[kat.id],
        )
        .await
        .unwrap();

        let alle = liste(&pool, einsatz).await.unwrap();
        for erwartet in &alle {
            let einzeln = laden(&pool, einsatz, erwartet.id).await.unwrap();
            assert_eq!(
                &einzeln, erwartet,
                "laden() muss dem Listeneintrag Feld für Feld entsprechen"
            );
        }
        // Nicht-leer, damit der Vergleich oben etwas prüft.
        assert_eq!(alle.len(), 2);
        assert_eq!(alle[0].ist_kumuliert, Staerke::neu(1, 1, 2));
    }

    /// Jeder Fremdschlüssel auf `einsatz_einheit` ist eine Spur (Review LLH-1079, O1, wie D4 bei
    /// Personen): eine Einheit, auf die etwas verweist, wird aufgelöst statt gelöscht. Ausgenommen
    /// sind nur die Unterstellung (rückt beim Auflösen hoch) und die Sprechgruppen (gehen mit).
    #[tokio::test]
    async fn jeder_verweis_auf_eine_einheit_ist_spur() {
        const KEINE_SPUR: &[(&str, &str)] = &[
            ("einsatz_einheit", "ueber_einheit_id"),
            ("einsatz_einheit_sprechgruppe", "einheit_id"),
        ];
        let pool = crate::db::test_pool().await;
        let verweise: Vec<(String, String)> = sqlx::query_as(
            "SELECT m.name, f.\"from\" FROM sqlite_master m \
             JOIN pragma_foreign_key_list(m.name) f \
             WHERE m.type = 'table' AND f.\"table\" = 'einsatz_einheit' ORDER BY 1, 2",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(verweise.len() > 5, "{verweise:?}");
        let fehlend: Vec<_> = verweise
            .iter()
            .filter(|(t, c)| !KEINE_SPUR.contains(&(t.as_str(), c.as_str())))
            .filter(|(t, c)| {
                !SPUREN_EINHEIT.iter().any(|(sql, _)| {
                    sql.contains(&format!("FROM {t} WHERE")) && sql.contains(&format!("{c} = ?"))
                })
            })
            .collect();
        assert!(fehlend.is_empty(), "Verweise ohne Spurprüfung: {fehlend:?}");
    }

    /// Eine als Auftrag-Empfänger referenzierte Einheit auflösen: der Verweis ist Spur, die
    /// Einheit bleibt aufgelöst stehen und der Empfänger behält sie (Review LLH-1079, O1).
    #[tokio::test]
    async fn aufloesen_behaelt_den_auftragsempfaenger() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let bn: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'L', 'l', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let auftrag: i64 = sqlx::query_scalar(
            "INSERT INTO auftrag (einsatz_id, auftrag_text, erteilt_at, erstellt_von_id) \
             VALUES (?, 'X', '2026-07-17 10:00:00', ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(bn)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, einheit_id, snap_anzeige) \
             VALUES (?, 'einheit', ?, '1. Zug')",
        )
        .bind(auftrag)
        .bind(einheit)
        .execute(&pool)
        .await
        .unwrap();

        let ergebnis = aufloesen(&pool, einsatz, einheit, bn)
            .await
            .expect("Einheit auflösen darf nicht am FK scheitern");
        assert!(!ergebnis.geloescht, "{ergebnis:?}");
        let emp: Option<i64> =
            sqlx::query_scalar("SELECT einheit_id FROM auftrag_empfaenger WHERE auftrag_id = ?")
                .bind(auftrag)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            emp,
            Some(einheit),
            "der Empfänger nennt die aufgelöste Einheit weiter"
        );
    }

    /// Eine zurückgenommene Verpflegungsausgabe an die Einheit `einheit`; liefert die Ausgabe.
    async fn verpflegungsausgabe_an(pool: &SqlitePool, einsatz: i64, b: i64, einheit: i64) -> i64 {
        let zf: i64 = sqlx::query_scalar(
            "INSERT INTO verpflegung_zeitfenster \
                (einsatz_id, bezeichnung, von_at, bis_at, bedarf_kraefte, bedarf_betreute, \
                 angelegt_von_id) \
             VALUES (?, 'Mittag', '2026-10-13 10:00:00', '2026-10-13 11:30:00', 9, 0, ?) \
             RETURNING id",
        )
        .bind(einsatz)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query_scalar(
            "INSERT INTO verpflegung_ausgabe \
                (einsatz_id, zeitfenster_id, zeitpunkt_at, menge, erfasst_von_id, einheit_id, \
                 zurueckgenommen_at, zurueckgenommen_von_id) \
             VALUES (?, ?, '2026-10-13 10:10:00', 9, ?, ?, '2026-10-13 10:12:00', ?) \
             RETURNING id",
        )
        .bind(einsatz)
        .bind(zf)
        .bind(b)
        .bind(einheit)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// LLH-1055, Spec `kraefte-entlassung` „Verpflegte Einheit bleibt“: eine Einheit ohne andere
    /// Spur, an die eine (auch zurückgenommene) Verpflegungsausgabe ging, wird aufgelöst statt
    /// gelöscht, und die Ausgabe nennt sie weiter.
    #[tokio::test]
    async fn aufloesen_behaelt_den_verpflegungsempfaenger() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let e = anlegen(
            &pool,
            einsatz,
            1,
            daten("2. Gruppe", None, None, None, None),
            b,
        )
        .await
        .unwrap();
        let ausgabe = verpflegungsausgabe_an(&pool, einsatz, b, e.id).await;

        let r = aufloesen_als(&pool, einsatz, e.id, b, Aufloesung::Aufloesen)
            .await
            .unwrap();
        assert!(!r.geloescht, "{r:?}");
        assert!(exists(&pool, e.id).await);
        let empfaenger: Option<i64> =
            sqlx::query_scalar("SELECT einheit_id FROM verpflegung_ausgabe WHERE id = ?")
                .bind(ausgabe)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            empfaenger,
            Some(e.id),
            "die Ausgabe nennt die Einheit weiter"
        );
    }

    /// LLH-1055, Spec „Verpflegte Einheit stornieren“: 422 mit dem Grund, dass eine
    /// Verpflegungsausgabe die Einheit nennt; die Einheit bleibt unverändert.
    #[tokio::test]
    async fn stornieren_mit_verpflegungsausgabe_ist_422() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let e = anlegen(
            &pool,
            einsatz,
            1,
            daten("2. Gruppe", None, None, None, None),
            b,
        )
        .await
        .unwrap();
        verpflegungsausgabe_an(&pool, einsatz, b, e.id).await;

        match aufloesen_als(&pool, einsatz, e.id, b, Aufloesung::Stornieren).await {
            Err(AppError::UnprocessableEntity(m)) => assert_eq!(
                m,
                "Eine Verpflegungsausgabe nennt die Einheit; die Einheit lässt sich nur auflösen"
            ),
            r => panic!("{r:?}"),
        }
        assert!(laden(&pool, einsatz, e.id)
            .await
            .unwrap()
            .aufgeloest_at
            .is_none());
    }
}
