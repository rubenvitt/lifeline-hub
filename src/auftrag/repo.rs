use crate::error::AppError;
use crate::kommunikation::{
    repo as krepo, OBJEKT_AUFTRAG, VOLLZUG_IN_ARBEIT, VOLLZUG_OFFEN, VOLLZUG_VOLLZOGEN,
};
use crate::zeitdarstellung::Zeitstil;
use sqlx::SqlitePool;
use std::collections::HashMap;

use super::{
    empfaenger_typ_gueltig, prioritaet_gueltig, AuftragAnzeige, AuftragDetail,
    AuftragEmpfaengerAnzeige,
};

/// Validierte Eingabe für eine Empfänger-Zeile (genau ein Ziel-Slot belegt).
#[derive(Debug, Clone)]
pub struct EmpfaengerEingabe {
    pub empfaenger_typ: String,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    /// Freitext — oder, bei `funktion` Führungshilfspersonal/Fachberater, die Bezeichnung
    /// (Doppelrolle, LFH-549).
    pub funktion_text: Option<String>,
    /// Katalogcode bei `empfaenger_typ = 'funktion'` (LFH-549); `None` = Freitext.
    pub funktion: Option<crate::fuehrung::Fuehrungsfunktion>,
    pub extern_kategorie: Option<String>,
    pub extern_bezeichnung: Option<String>,
}

/// Validierte Eingabe für einen neuen Auftrag (Handler hat getrimmt/normalisiert).
#[derive(Debug)]
pub struct AuftragDaten<'a> {
    pub auftrag_text: &'a str,
    pub absicht: Option<&'a str>,
    pub lage: Option<&'a str>,
    pub ort: Option<&'a str>,
    /// Koordinate des Ziels (LLH-1114), nur neben `ort` (geprüft in `auftrag::eingabe`).
    pub ort_punkt: Option<(f64, f64)>,
    pub zeit: Option<&'a str>,
    pub mittel: Option<&'a str>,
    pub verbindung: Option<&'a str>,
    pub sicherheit: Option<&'a str>,
    pub weg: Option<&'a str>,
    pub prioritaet: &'a str,
    pub richtung: &'a str,
    pub frist_at: Option<&'a str>,
    pub erteilt_at: &'a str,
    pub empfaenger: Vec<EmpfaengerEingabe>,
}

/// Empfänger-Filter fürs Board (genau ein Ziel-Slot gesetzt). Wirkt in SQL (`EXISTS` auf
/// `auftrag_empfaenger`, LFH-933): ein Auftrag passt, wenn MINDESTENS EIN Empfänger den Slot
/// trägt. Sind beide Slots leer, passt jeder Auftrag mit mindestens einem Empfänger. Ist beides
/// gesetzt, gilt der Abschnitt (die Route lässt nur einen zu).
#[derive(Debug, Default)]
pub struct EmpfaengerFilter {
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
}

/// Bereich eines Abschnittsgeräts (LFH-1043): ein Auftrag passt, wenn MINDESTENS EIN Empfänger
/// einen der Abschnitte oder eine der Einheiten trägt. Beide Listen als JSON für `json_each(?)`,
/// damit die Zahl der Anweisungen nicht von der Größe des Teilbaums abhängt.
#[derive(Debug, Default)]
pub struct EmpfaengerBereich {
    pub abschnitte_json: String,
    pub einheiten_json: String,
}

/// Bearbeitungsstatus als SQL-Ausdruck: `'aufgehoben'`, wenn `aufgehoben_at` gesetzt ist
/// (LLH-1098, schlägt jeden anderen), sonst `'abgenommen'`, wenn `abgenommen_at` gesetzt ist,
/// sonst die Vollzugs-Achse. EINMAL definiert für die Spalte in [`ANZEIGE_SELECT`] und den
/// Status-Filter in [`liste`] (LFH-933).
macro_rules! bearbeitungsstatus_sql {
    () => {
        "(CASE WHEN a.aufgehoben_at IS NOT NULL THEN 'aufgehoben' \
              WHEN a.abgenommen_at IS NOT NULL THEN 'abgenommen' \
              ELSE COALESCE(ks.vollzug_status, 'offen') END)"
    };
}

/// Überfällig: nicht aufgehoben, Frist abgelaufen und mindestens ein Empfänger hat nicht
/// quittiert. Trägt EIN `?` für `jetzt`. EINMAL definiert für [`ANZEIGE_SELECT`] und den
/// Modulzähler [`zaehlen`] (LFH-935). Ein aufgehobener Auftrag erwartet keine Quittung mehr
/// (LLH-1098).
macro_rules! ist_ueberfaellig_sql {
    () => {
        "(a.aufgehoben_at IS NULL AND a.frist_at IS NOT NULL AND a.frist_at <= ? \
          AND EXISTS (SELECT 1 FROM auftrag_empfaenger ae WHERE ae.auftrag_id = a.id AND ae.quittiert_at IS NULL))"
    };
}

/// Berichtigbar (LLH-1098): Bearbeitungsstatus `offen` und kein Empfänger hat quittiert. EINMAL
/// definiert für das Feld `berichtigbar` in [`ANZEIGE_SELECT`] und die Prüfung in
/// [`berichtigen_tx`]; der Client rechnet die Regel nicht nach.
macro_rules! ist_berichtigbar_sql {
    () => {
        concat!(
            "(",
            bearbeitungsstatus_sql!(),
            " = 'offen' AND NOT EXISTS (SELECT 1 FROM auftrag_empfaenger aq \
               WHERE aq.auftrag_id = a.id AND aq.quittiert_at IS NOT NULL))"
        )
    };
}

/// Die Vollzugs-Achse eines Auftrags (Alias `ks`), geteilt von Liste und Zählung.
macro_rules! vollzug_join_sql {
    () => {
        " LEFT JOIN kommunikation_status ks ON ks.objekt_typ = 'auftrag' AND ks.objekt_id = a.id"
    };
}

/// SELECT-Projektion inkl. Vollzugs-Achse (LEFT JOIN kommunikation_status),
/// Quittungs-Aggregat (Subquery auf auftrag_empfaenger) und abgeleiteten Feldern.
/// `jetzt` wird als ERSTER `?` gebunden (computed columns vor WHERE), dann WHERE.
const ANZEIGE_SELECT: &str = concat!(
    "SELECT a.id, a.einsatz_id, a.lfd_nr, a.auftrag_text, a.absicht, a.lage, a.ort, a.ort_lat, a.ort_lon, a.zeit, a.mittel, \
            a.verbindung, a.sicherheit, a.weg, a.prioritaet, a.richtung, a.frist_at, a.erteilt_at, a.in_arbeit_at, \
            a.vollzugsmeldung, a.abgenommen_at, a.abgenommen_von_id, a.etb_anordnung_id, \
            a.quell_etb_eintrag_id, \
            a.erstellt_von_id, a.erstellt_at, \
            COALESCE(ks.vollzug_status, 'offen') AS vollzug_status, \
            ks.vollzogen_at AS vollzogen_at, ks.vollzogen_von_id AS vollzogen_von_id, \
            (SELECT COUNT(*) FROM auftrag_empfaenger ae WHERE ae.auftrag_id = a.id) AS empfaenger_anzahl, \
            (SELECT COUNT(*) FROM auftrag_empfaenger ae WHERE ae.auftrag_id = a.id AND ae.quittiert_at IS NOT NULL) AS quittiert_anzahl, ",
    ist_ueberfaellig_sql!(),
    " AS ist_ueberfaellig, ",
    bearbeitungsstatus_sql!(),
    " AS bearbeitungsstatus, \
     a.aufgehoben_at, a.aufgehoben_von_id, \
     (SELECT b.anzeigename FROM benutzer b WHERE b.id = a.aufgehoben_von_id) AS aufgehoben_von_name, \
     a.aufhebungsgrund, ",
    ist_berichtigbar_sql!(),
    " AS berichtigbar \
     FROM auftrag a",
    vollzug_join_sql!()
);

/// Eine Gruppe gleicher Zählmerkmale mit ihrer Anzahl ([`zaehlen`]).
#[derive(sqlx::FromRow)]
struct MerkmalGruppe {
    #[sqlx(try_from = "String")]
    bearbeitungsstatus: super::AuftragBearbeitungsstatus,
    ist_ueberfaellig: bool,
    anzahl: i64,
}

/// Modulzähler der Aufträge (LFH-935): EINE Abfrage, gruppiert nach Bearbeitungsstatus und
/// Überfälligkeit, gezählt mit [`crate::einsatz::zaehler::zaehle_auftraege_gewichtet`]. Dieselben
/// Fragmente wie [`ANZEIGE_SELECT`]; Empfängerzeilen werden nicht geladen, nur die
/// `EXISTS`-Prüfung der Überfälligkeit läuft je Auftrag. Bind-Reihenfolge: `jetzt`, dann
/// `einsatz_id`.
pub async fn zaehlen(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<crate::einsatz::zaehler::AuftragsZaehler, AppError> {
    const SQL: &str = concat!(
        "SELECT ",
        bearbeitungsstatus_sql!(),
        " AS bearbeitungsstatus, ",
        ist_ueberfaellig_sql!(),
        " AS ist_ueberfaellig, COUNT(*) AS anzahl FROM auftrag a",
        vollzug_join_sql!(),
        " WHERE a.einsatz_id = ? GROUP BY 1, 2"
    );
    let gruppen = sqlx::query_as::<_, MerkmalGruppe>(SQL)
        .bind(jetzt)
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
    Ok(crate::einsatz::zaehler::zaehle_auftraege_gewichtet(
        gruppen.into_iter().map(|g| {
            (
                crate::einsatz::zaehler::AuftragsMerkmale {
                    bearbeitungsstatus: g.bearbeitungsstatus,
                    ist_ueberfaellig: g.ist_ueberfaellig,
                },
                g.anzahl,
            )
        }),
    ))
}

/// Lädt einen Auftrag samt Empfängern. `NotFound`, wenn unbekannt.
/// Bind-Reihenfolge: zuerst `jetzt` (computed column), dann `id` (WHERE).
pub async fn laden(pool: &SqlitePool, id: i64, jetzt: &str) -> Result<AuftragDetail, AppError> {
    let auftrag = sqlx::query_as::<_, AuftragAnzeige>(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE a.id = ?"
    )))
    .bind(jetzt)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let empfaenger = empfaenger_von(pool, id).await?;
    Ok(AuftragDetail {
        auftrag,
        empfaenger,
    })
}

/// Spalten einer Empfänger-Zeile, geteilt von [`empfaenger_von`] und [`empfaenger_von_allen`].
const EMPFAENGER_SPALTEN: &str =
    "id, auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id, \
     funktion_text, funktion, extern_kategorie, extern_bezeichnung, snap_anzeige, quittiert_at, \
     quittiert_von_id";

/// Lädt die Empfänger-Zeilen eines Auftrags (Quittung pro Empfänger).
pub async fn empfaenger_von(
    pool: &SqlitePool,
    auftrag_id: i64,
) -> Result<Vec<AuftragEmpfaengerAnzeige>, AppError> {
    sqlx::query_as::<_, AuftragEmpfaengerAnzeige>(sqlx::AssertSqlSafe(format!(
        "SELECT {EMPFAENGER_SPALTEN} FROM auftrag_empfaenger WHERE auftrag_id = ? ORDER BY id"
    )))
    .bind(auftrag_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Lädt die Empfänger-Zeilen VIELER Aufträge in EINER Abfrage (kein N+1, LFH-933), je Auftrag
/// nach `id` sortiert wie [`empfaenger_von`]. Die ids reisen als EIN JSON-Array (`json_each`,
/// Muster `pegel::repo`): eine Bind-Variable, gleich wie viele Aufträge, also keine Grenze
/// `SQLITE_MAX_VARIABLE_NUMBER`. Aufträge ohne Empfänger fehlen in der Karte.
pub async fn empfaenger_von_allen(
    pool: &SqlitePool,
    auftrag_ids: &[i64],
) -> Result<HashMap<i64, Vec<AuftragEmpfaengerAnzeige>>, AppError> {
    let mut je_auftrag: HashMap<i64, Vec<AuftragEmpfaengerAnzeige>> = HashMap::new();
    if auftrag_ids.is_empty() {
        return Ok(je_auftrag);
    }
    let ids = serde_json::to_string(auftrag_ids)
        .map_err(|e| AppError::Internal(format!("Auftrags-ids serialisieren: {e}")))?;
    let zeilen = sqlx::query_as::<_, AuftragEmpfaengerAnzeige>(sqlx::AssertSqlSafe(format!(
        "SELECT {EMPFAENGER_SPALTEN} FROM auftrag_empfaenger \
         WHERE auftrag_id IN (SELECT value FROM json_each(?)) ORDER BY auftrag_id, id"
    )))
    .bind(ids)
    .fetch_all(pool)
    .await?;
    for e in zeilen {
        je_auftrag.entry(e.auftrag_id).or_default().push(e);
    }
    Ok(je_auftrag)
}

/// Abgeschlossen heißt vollzogen, abgenommen oder aufgehoben (LFH-1071, D1; LLH-1098); `offen`
/// ist das Gegenteil. EINMAL definiert für Liste und [`kennzahlen`].
macro_rules! ist_abgeschlossen_sql {
    () => {
        concat!(
            "(",
            bearbeitungsstatus_sql!(),
            " IN ('vollzogen', 'abgenommen', 'aufgehoben'))"
        )
    };
}

/// Ordnungszeitpunkt der Abgeschlossen-Ansicht (LFH-1071, D2): zuletzt aufgehoben, abgenommen
/// bzw. vollzogen oben, ohne Stempel die Anlage. Liste und Cursor lesen denselben Ausdruck; der
/// Client-Cursor `auftragAbschlussCursor` (`frontend/src/api/auftraege.ts`) dieselbe Reihenfolge.
macro_rules! abschluss_zeit_sql {
    () => {
        "COALESCE(a.aufgehoben_at, a.abgenommen_at, ks.vollzogen_at, a.erstellt_at)"
    };
}

/// Filter einer Auftragsliste. `seite` gilt nur zusammen mit `phase = Abgeschlossen`
/// ([`crate::kommunikation::phase_und_seite`]).
#[derive(Debug, Default)]
pub struct AuftragFilter<'a> {
    pub status: Option<&'a str>,
    pub richtung: Option<&'a str>,
    pub empfaenger: Option<&'a EmpfaengerFilter>,
    /// Zusätzlich zum Empfängerfilter: nur Aufträge im Bereich eines Abschnittsgeräts.
    pub bereich: Option<&'a EmpfaengerBereich>,
    pub phase: Option<crate::kommunikation::ListenPhase>,
    pub seite: Option<crate::kommunikation::Seite>,
    /// Suchbegriff (getrimmt, nicht leer): Teil der Kennung „#n“, des Auftragstexts oder der
    /// Anzeige eines Empfängers.
    pub suche: Option<&'a str>,
}

/// WHERE-Ergänzungen (ohne Cursor) samt Bindwerten in textueller Reihenfolge.
fn filter_bedingung(f: &AuftragFilter<'_>) -> (String, Vec<FilterWert>) {
    use crate::kommunikation::ListenPhase;
    let mut sql = String::new();
    let mut werte = Vec::new();
    match f.phase {
        Some(ListenPhase::Offen) => sql.push_str(concat!(" AND NOT ", ist_abgeschlossen_sql!())),
        Some(ListenPhase::Abgeschlossen) => {
            sql.push_str(concat!(" AND ", ist_abgeschlossen_sql!()))
        }
        None => {}
    }
    if let Some(r) = f.richtung {
        sql.push_str(" AND a.richtung = ?");
        werte.push(FilterWert::Text(r.to_string()));
    }
    if let Some(s) = f.status {
        sql.push_str(concat!(" AND ", bearbeitungsstatus_sql!(), " = ?"));
        werte.push(FilterWert::Text(s.to_string()));
    }
    let empfaenger_slot = f.empfaenger.map(|f| match (f.abschnitt_id, f.einheit_id) {
        (Some(a), _) => Some(("abschnitt_id", a)),
        (None, Some(u)) => Some(("einheit_id", u)),
        (None, None) => None,
    });
    match empfaenger_slot {
        Some(Some((spalte, id))) => {
            sql.push_str(&format!(
                " AND EXISTS (SELECT 1 FROM auftrag_empfaenger fe \
                   WHERE fe.auftrag_id = a.id AND fe.{spalte} = ?)"
            ));
            werte.push(FilterWert::Zahl(id));
        }
        Some(None) => sql.push_str(
            " AND EXISTS (SELECT 1 FROM auftrag_empfaenger fe WHERE fe.auftrag_id = a.id)",
        ),
        None => {}
    }
    if let Some(b) = f.bereich {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM auftrag_empfaenger be WHERE be.auftrag_id = a.id \
               AND (be.abschnitt_id IN (SELECT value FROM json_each(?)) \
                 OR be.einheit_id IN (SELECT value FROM json_each(?))))",
        );
        werte.push(FilterWert::Text(b.abschnitte_json.clone()));
        werte.push(FilterWert::Text(b.einheiten_json.clone()));
    }
    if let Some(begriff) = f.suche {
        // Kennung „#12“, Auftragstext und die Anzeige jedes Empfängers (`src/AGENTS.md`, Suche
        // der geblätterten Listen). Drei Platzhalter, drei Bindungen. Ein Auftrag von vor 0067
        // hat keine Nummer: `printf('#%d', NULL)` ergäbe „#0“ und träfe die Suche nach „0“.
        sql.push_str(
            " AND ((a.lfd_nr IS NOT NULL AND printf('#%d', a.lfd_nr) LIKE ? ESCAPE '\\') \
             OR a.auftrag_text LIKE ? ESCAPE '\\' \
             OR EXISTS (SELECT 1 FROM auftrag_empfaenger se WHERE se.auftrag_id = a.id \
               AND se.snap_anzeige LIKE ? ESCAPE '\\'))",
        );
        let m = crate::db::suche::like_muster(begriff);
        for _ in 0..3 {
            werte.push(FilterWert::Text(m.clone()));
        }
    }
    (sql, werte)
}

enum FilterWert {
    Text(String),
    Zahl(i64),
}

/// Listet Aufträge eines Einsatzes (optional gefiltert nach Bearbeitungsstatus, Richtung
/// und/oder Empfänger), ohne Phase. Kurzform von [`liste_gefiltert`].
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status_filter: Option<&str>,
    richtung_filter: Option<&str>,
    empfaenger_filter: Option<&EmpfaengerFilter>,
    jetzt: &str,
) -> Result<Vec<AuftragDetail>, AppError> {
    liste_gefiltert(
        pool,
        einsatz_id,
        &AuftragFilter {
            status: status_filter,
            richtung: richtung_filter,
            empfaenger: empfaenger_filter,
            ..Default::default()
        },
        jetzt,
    )
    .await
}

/// Listet Aufträge eines Einsatzes.
///
/// - ohne Phase und `offen`: Priorität (sofort→normal), dann Frist, dann ID; ungeblättert.
/// - `abgeschlossen`: zuletzt abgeschlossen oben ([`abschluss_zeit_sql`]), bei Gleichstand die
///   höhere id; eine Seite ab dem Cursor (LFH-1071).
///
/// Zwei Statements, gleich wie viele Aufträge (LFH-933): alle Filter wirken im WHERE, die
/// Empfänger kommen gebündelt aus [`empfaenger_von_allen`]. Kein `empfaenger_von` je Zeile —
/// das war N+1 hinter Board, Kräfteübersicht und Modulzähler.
pub async fn liste_gefiltert(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &AuftragFilter<'_>,
    jetzt: &str,
) -> Result<Vec<AuftragDetail>, AppError> {
    let (bedingung, werte) = filter_bedingung(filter);
    let mut sql = format!("{ANZEIGE_SELECT} WHERE a.einsatz_id = ?{bedingung}");
    let seite = match filter.phase {
        Some(crate::kommunikation::ListenPhase::Abgeschlossen) => filter.seite.as_ref(),
        _ => None,
    };
    if let Some(seite) = seite {
        if seite.vor.is_some() {
            sql.push_str(concat!(
                " AND (",
                abschluss_zeit_sql!(),
                " < ? OR (",
                abschluss_zeit_sql!(),
                " = ? AND a.id < ?))"
            ));
        }
        sql.push_str(concat!(
            " ORDER BY ",
            abschluss_zeit_sql!(),
            " DESC, a.id DESC LIMIT ?"
        ));
    } else {
        sql.push_str(
            " ORDER BY CASE a.prioritaet WHEN 'sofort' THEN 0 WHEN 'dringend' THEN 1 ELSE 2 END, \
              a.frist_at IS NULL, a.frist_at, a.id",
        );
    }
    // Bind-Reihenfolge = textuelle ?-Reihenfolge: jetzt (computed), einsatz_id, Filter,
    // [Cursor], [limit].
    let mut q = sqlx::query_as::<_, AuftragAnzeige>(sqlx::AssertSqlSafe(&*sql))
        .bind(jetzt)
        .bind(einsatz_id);
    for w in werte {
        q = match w {
            FilterWert::Text(t) => q.bind(t),
            FilterWert::Zahl(z) => q.bind(z),
        };
    }
    if let Some(seite) = seite {
        if let Some(vor) = &seite.vor {
            q = q.bind(vor.zeit.clone()).bind(vor.zeit.clone()).bind(vor.id);
        }
        q = q.bind(seite.limit);
    }
    let auftraege = q.fetch_all(pool).await?;

    let ids: Vec<i64> = auftraege.iter().map(|a| a.id).collect();
    let mut empfaenger = empfaenger_von_allen(pool, &ids).await?;
    Ok(auftraege
        .into_iter()
        .map(|auftrag| AuftragDetail {
            empfaenger: empfaenger.remove(&auftrag.id).unwrap_or_default(),
            auftrag,
        })
        .collect())
}

/// Kennzahlen des Auftragsboards (LFH-1071, D3): EINE gruppierte Abfrage über dieselben
/// Fragmente wie die Liste, mit deren Richtungs-, Empfänger- und Suchfilter (ohne Status, Phase
/// und Seite). Bind-Reihenfolge: `einsatz_id`, Filter.
pub async fn kennzahlen(
    pool: &SqlitePool,
    einsatz_id: i64,
    richtung: Option<&str>,
    empfaenger: Option<&EmpfaengerFilter>,
    suche: Option<&str>,
) -> Result<super::AuftragKennzahlen, AppError> {
    let (bedingung, werte) = filter_bedingung(&AuftragFilter {
        richtung,
        empfaenger,
        suche,
        ..Default::default()
    });
    let sql = format!(
        concat!(
            "SELECT ",
            ist_abgeschlossen_sql!(),
            " AS ist_abgeschlossen, COUNT(*) AS anzahl FROM auftrag a",
            vollzug_join_sql!(),
            " WHERE a.einsatz_id = ?{} GROUP BY 1"
        ),
        bedingung
    );
    let mut q = sqlx::query_as::<_, (bool, i64)>(sqlx::AssertSqlSafe(&*sql)).bind(einsatz_id);
    for w in werte {
        q = match w {
            FilterWert::Text(t) => q.bind(t),
            FilterWert::Zahl(z) => q.bind(z),
        };
    }
    let mut k = super::AuftragKennzahlen::default();
    for (ist_abgeschlossen, anzahl) in q.fetch_all(pool).await? {
        if ist_abgeschlossen {
            k.abgeschlossen += anzahl;
        } else {
            k.offen += anzahl;
        }
    }
    Ok(k)
}

/// Lädt einen Auftrag des Einsatzes samt Empfängern (LFH-1071, Einzelabruf für den Deeplink).
/// `NotFound` für eine unbekannte oder einsatzfremde Kennung.
pub async fn laden_im_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    jetzt: &str,
) -> Result<AuftragDetail, AppError> {
    let d = laden(pool, id, jetzt).await?;
    if d.auftrag.einsatz_id != einsatz_id {
        return Err(AppError::NotFound);
    }
    Ok(d)
}

/// Prüft, ob ein Auftrag zum Einsatz gehört (Cross-Einsatz-Schutz).
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM auftrag WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Setzt die Quittung einer Empfänger-Zeile (idempotent: hält den ersten Zeitstempel) und
/// liefert, ob diese Anfrage sie gesetzt hat; eine schon quittierte Zeile bleibt unverändert und
/// liefert `false` (nur die erste Quittung benachrichtigt den Auftraggeber, LLH-1212). Ein
/// aufgehobener Auftrag erwartet keine Quittung mehr (LLH-1098): die Bedingung steht im `UPDATE`
/// selbst, damit eine gleichzeitige Aufhebung nicht übergangen wird; dann 422.
pub async fn quittiere_empfaenger(
    pool: &SqlitePool,
    empfaenger_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let getroffen = sqlx::query(
        "UPDATE auftrag_empfaenger SET quittiert_at = ?, quittiert_von_id = ? \
         WHERE id = ? AND quittiert_at IS NULL AND NOT EXISTS (SELECT 1 FROM auftrag a \
           WHERE a.id = auftrag_empfaenger.auftrag_id AND a.aufgehoben_at IS NOT NULL)",
    )
    .bind(jetzt)
    .bind(von_id)
    .bind(empfaenger_id)
    .execute(pool)
    .await?
    .rows_affected();
    if getroffen == 1 {
        return Ok(true);
    }
    // Schon quittiert (idempotent), aufgehoben (422) oder die Zeile ist weg, etwa durch eine
    // Berichtigung (404).
    let stand: Option<(bool, bool)> = sqlx::query_as(
        "SELECT a.aufgehoben_at IS NOT NULL, ae.quittiert_at IS NOT NULL \
         FROM auftrag_empfaenger ae JOIN auftrag a ON a.id = ae.auftrag_id WHERE ae.id = ?",
    )
    .bind(empfaenger_id)
    .fetch_optional(pool)
    .await?;
    match stand {
        Some((true, _)) => Err(AppError::UnprocessableEntity(
            "Der Auftrag ist aufgehoben und erwartet keine Quittung mehr".into(),
        )),
        Some((false, true)) => Ok(false),
        _ => Err(AppError::NotFound),
    }
}

/// Prüft, ob eine Empfänger-Zeile zum Auftrag gehört (Cross-Objekt-Schutz).
pub async fn empfaenger_gehoert_zu_auftrag(
    pool: &SqlitePool,
    empfaenger_id: i64,
    auftrag_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM auftrag_empfaenger WHERE id = ? AND auftrag_id = ?")
            .bind(empfaenger_id)
            .bind(auftrag_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Legt einen Auftrag inkl. Empfänger an und erzeugt im selben Commit den
/// ETB-Anordnungseintrag (Pattern B: anlegen_tx + Backlink auftrag_id auf BEIDEN
/// Seiten). Arbeitet auf einer offenen Verbindung/Transaktion und committet NICHT
/// selbst — so kann ein Aufrufer (z. B. die Chat-Heraufstufung, LFH-101) im selben
/// Commit weitere Rückverweise setzen. Liefert die neue `auftrag_id`. `daten` ist
/// vom Handler validiert (auftrag_text + >=1 Empfänger, Slots/Zugehörigkeit geprüft).
pub async fn anlegen_tx(
    tx: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    ersteller_id: i64,
    auftrag_startwert: i64,
    etb_startwert: i64,
    auto_etb: bool,
    daten: &AuftragDaten<'_>,
) -> Result<i64, AppError> {
    // Enum-Invariante auch im Release durchsetzen (LFH-259/F34): ein debug_assert wäre
    // wegkompiliert → ein interner Aufrufer (Scheduler/Seed) könnte still ungültige Werte
    // persistieren. Der Handler validiert bereits, hier ist es das Repo-Sicherheitsnetz.
    if !prioritaet_gueltig(daten.prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    if !super::richtung_gueltig(daten.richtung) {
        return Err(AppError::Validation("Ungültige Richtung".into()));
    }

    // lfd_nr atomar je Einsatz (Muster etb/meldung: INSERT … SELECT COALESCE(MAX(lfd_nr)+1, ?)
    // FROM auftrag WHERE einsatz_id = ? — die Vergabe liegt in derselben Transaktion wie der
    // Insert, kein read-then-write). Startwert aus den Einstellungen (Default 1).
    let auftrag_id: i64 = sqlx::query_scalar(
        "INSERT INTO auftrag \
           (einsatz_id, lfd_nr, auftrag_text, absicht, lage, ort, ort_lat, ort_lon, zeit, mittel, \
            verbindung, sicherheit, weg, prioritaet, richtung, frist_at, erteilt_at, erstellt_von_id) \
         SELECT ?, COALESCE(MAX(lfd_nr) + 1, ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? \
         FROM auftrag WHERE einsatz_id = ? \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(auftrag_startwert)
    .bind(daten.auftrag_text)
    .bind(daten.absicht)
    .bind(daten.lage)
    .bind(daten.ort)
    .bind(daten.ort_punkt.map(|p| p.0))
    .bind(daten.ort_punkt.map(|p| p.1))
    .bind(daten.zeit)
    .bind(daten.mittel)
    .bind(daten.verbindung)
    .bind(daten.sicherheit)
    .bind(daten.weg)
    .bind(daten.prioritaet)
    .bind(daten.richtung)
    .bind(daten.frist_at)
    .bind(daten.erteilt_at)
    .bind(ersteller_id)
    .bind(einsatz_id)
    .fetch_one(&mut *tx)
    .await?;

    let namen =
        empfaenger_einfuegen_tx(&mut *tx, einsatz_id, auftrag_id, &daten.empfaenger).await?;

    // ETB-Anordnung (Pattern B): erst NACH den Inserts, im selben Commit.
    // Auto-ETB-Schalter (LFH-133): bei abgeschaltetem Dual-Publish wird kein
    // ETB-Folgeeintrag erzeugt; etb_anordnung_id bleibt NULL.
    if auto_etb {
        // Gekappt auf `etb::PARTEI_MAX`; die vollständige Liste steht in `auftrag_empfaenger`.
        let an = super::kappe_an(&namen);
        let etb_id = crate::etb::repo::anlegen_tx(
            &mut *tx,
            einsatz_id,
            ersteller_id,
            etb_startwert,
            crate::etb::repo::EintragDaten {
                typ: crate::etb::TYP_ANORDNUNG,
                inhalt: daten.auftrag_text,
                von: None,
                an: Some(&an),
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: Some(daten.erteilt_at),
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        link_etb_tx(&mut *tx, etb_id, auftrag_id).await?;
        sqlx::query("UPDATE auftrag SET etb_anordnung_id = ? WHERE id = ?")
            .bind(etb_id)
            .bind(auftrag_id)
            .execute(&mut *tx)
            .await?;
    }

    Ok(auftrag_id)
}

/// Schreibt die Empfänger-Zeilen eines Auftrags samt Snapshot und liefert die Anzeigenamen in
/// derselben Reihenfolge. Geteilt von Erteilen und Berichtigen (LLH-1098).
async fn empfaenger_einfuegen_tx(
    tx: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    auftrag_id: i64,
    empfaenger: &[EmpfaengerEingabe],
) -> Result<Vec<String>, AppError> {
    // Wirksame Mandantenlabels für den Snapshot eines Katalogempfängers (LFH-549).
    let karte = crate::fuehrung::repo::labelkarte_fuer_einsatz(&mut *tx, einsatz_id).await?;
    // Jeder Anzeigename entsteht einmal: für die Zeile und für das ETB-`an` (LFH-937, D3).
    let mut namen = Vec::new();
    for e in empfaenger {
        debug_assert!(empfaenger_typ_gueltig(&e.empfaenger_typ));
        let snap = snap_anzeige_fuer(&mut *tx, e, &karte).await?;
        sqlx::query(
            "INSERT INTO auftrag_empfaenger \
               (auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id, funktion_text, \
                funktion, extern_kategorie, extern_bezeichnung, snap_anzeige) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(auftrag_id)
        .bind(&e.empfaenger_typ)
        .bind(e.abschnitt_id)
        .bind(e.einheit_id)
        .bind(e.person_id)
        .bind(e.fahrzeug_id)
        .bind(e.funktion_text.as_deref())
        .bind(e.funktion.map(|f| f.as_str()))
        .bind(e.extern_kategorie.as_deref())
        .bind(e.extern_bezeichnung.as_deref())
        .bind(&snap)
        .execute(&mut *tx)
        .await?;
        namen.push(snap);
    }
    Ok(namen)
}

/// Legt einen Auftrag an (eigener Commit) und liefert das Detail. Dünner Wrapper
/// um [`anlegen_tx`].
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    daten: AuftragDaten<'_>,
    jetzt: &str,
) -> Result<AuftragDetail, AppError> {
    let einst = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id).await?;
    let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let org_einst =
        crate::org::einstellungen::laden_oder_default(pool, org_id.unwrap_or(0)).await?;
    let mut tx = pool.begin().await?;
    let auftrag_id = anlegen_tx(
        &mut tx,
        einsatz_id,
        ersteller_id,
        einst.auftrag_startwert(),
        einst.etb_startwert(),
        crate::einsatz::effektiv::effektiv_auto_etb_aktiv(&einst, &org_einst),
        &daten,
    )
    .await?;
    tx.commit().await?;
    laden(pool, auftrag_id, jetzt).await
}

/// Erteilt aus einem ETB-Eintrag einen Auftrag (ETB→Auftrag, LFH-112) — in EINEM Commit:
/// legt den Auftrag inkl. seiner ETB-Anordnung an (`anlegen_tx`, Pattern B) und setzt am
/// ERZEUGTEN Auftrag den Rückbezug `quell_etb_eintrag_id` auf den Quell-Eintrag. Anders als
/// Meldung→Auftrag gibt es hier KEINEN first-write-wins-Guard: die Link-Spalte sitzt auf dem
/// Auftrag, nicht auf der einwertigen Quelle — ein ETB-Eintrag darf mehrere Aufträge auslösen.
/// `etb_anordnung_id` (vom Auftrag erzeugt) und `quell_etb_eintrag_id` (Quelle) sind verschieden.
/// `daten` ist vom Handler validiert; `quell_etb_eintrag_id` muss zum Einsatz gehören (Guard).
pub async fn erteile_aus_etb_tx(
    pool: &SqlitePool,
    einsatz_id: i64,
    quell_etb_eintrag_id: i64,
    erteiler_id: i64,
    daten: AuftragDaten<'_>,
) -> Result<i64, AppError> {
    let einst = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id).await?;
    let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let org_einst =
        crate::org::einstellungen::laden_oder_default(pool, org_id.unwrap_or(0)).await?;
    let mut tx = pool.begin().await?;
    let auftrag_id = anlegen_tx(
        &mut tx,
        einsatz_id,
        erteiler_id,
        einst.auftrag_startwert(),
        einst.etb_startwert(),
        crate::einsatz::effektiv::effektiv_auto_etb_aktiv(&einst, &org_einst),
        &daten,
    )
    .await?;
    sqlx::query("UPDATE auftrag SET quell_etb_eintrag_id = ? WHERE id = ?")
        .bind(quell_etb_eintrag_id)
        .bind(auftrag_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(auftrag_id)
}

/// Ermittelt den Anzeigenamen einer Empfänger-Zeile (snap zum Erfassungszeitpunkt).
/// EA/Einheit/Person/Fahrzeug → Name aus der jeweiligen Tabelle; Funktion → Freitext.
///
/// Katalogfunktion (LFH-549) → „S3 Einsatz“/„Fachberater: THW“ mit wirksamem Label, **nie**
/// der Name der Person, die die Funktion gerade besetzt: der Snapshot steht im ETB der
/// Anordnung, die Besetzung wechselt — sie kommt zur Lesezeit (`fuehrung::aufloesung`).
pub(crate) async fn snap_anzeige_fuer(
    tx: &mut sqlx::SqliteConnection,
    e: &EmpfaengerEingabe,
    karte: &crate::fuehrung::Labelkarte,
) -> Result<String, AppError> {
    if let Some(f) = e.funktion {
        return Ok(karte.anzeige(f, e.funktion_text.as_deref()));
    }
    let name: Option<String> = match e.empfaenger_typ.as_str() {
        "abschnitt" => {
            sqlx::query_scalar("SELECT name FROM einsatzabschnitt WHERE id = ?")
                .bind(e.abschnitt_id)
                .fetch_optional(&mut *tx)
                .await?
        }
        "einheit" => {
            sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ?")
                .bind(e.einheit_id)
                .fetch_optional(&mut *tx)
                .await?
        }
        "person" => {
            sqlx::query_scalar("SELECT snap_name FROM einsatz_personal WHERE id = ?")
                .bind(e.person_id)
                .fetch_optional(&mut *tx)
                .await?
        }
        "fahrzeug" => {
            sqlx::query_scalar("SELECT snap_funkrufname FROM einsatz_fahrzeug WHERE id = ?")
                .bind(e.fahrzeug_id)
                .fetch_optional(&mut *tx)
                .await?
        }
        "extern" => e.extern_bezeichnung.clone(),
        _ => e.funktion_text.clone(),
    };
    Ok(name
        .or_else(|| e.funktion_text.clone())
        .or_else(|| e.extern_bezeichnung.clone())
        .unwrap_or_else(|| "—".to_string()))
}

/// Setzt Vollzug → 'in_arbeit' (geteilte Achse) und hält den Zeitstempel am Auftrag.
pub async fn setze_in_arbeit(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    krepo::setze_vollzug(
        pool,
        org_id,
        einsatz_id,
        OBJEKT_AUFTRAG,
        auftrag_id,
        VOLLZUG_IN_ARBEIT,
        von_id,
        jetzt,
    )
    .await?;
    sqlx::query("UPDATE auftrag SET in_arbeit_at = COALESCE(in_arbeit_at, ?) WHERE id = ?")
        .bind(jetzt)
        .bind(auftrag_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Nimmt den Bearbeitungsfortschritt auf 'offen' zurück (LFH-343 · C8, Befund H50).
///
/// Der Gegenweg zu {@link setze_in_arbeit}: seit C8 kostet „In Bearbeitung" einen
/// Klick statt zweier, und der Rückgängig-Toast braucht einen Weg, den der Server
/// annimmt. Der Zeitstempel geht MIT zurück — bliebe er stehen, behauptete der
/// Auftrag einen Fortschritt, den es nicht mehr gibt, und `COALESCE` in
/// `setze_in_arbeit` schriebe beim nächsten Mal den alten Stempel fort.
///
/// Anders als der Vollzug erzeugt die Rücknahme KEINEN ETB-Eintrag: das Setzen auf
/// „In Bearbeitung" erzeugt selbst keinen, ein Eintrag nur für dessen Rücknahme
/// hinterließe im Tagebuch eine Zeile ohne Gegenstück.
pub async fn setze_offen(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    krepo::setze_vollzug(
        pool,
        org_id,
        einsatz_id,
        OBJEKT_AUFTRAG,
        auftrag_id,
        VOLLZUG_OFFEN,
        von_id,
        jetzt,
    )
    .await?;
    sqlx::query("UPDATE auftrag SET in_arbeit_at = NULL WHERE id = ?")
        .bind(auftrag_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Meldet Vollzug: Rückmeldetext am Auftrag, Vollzug-Achse → 'vollzogen' und ein
/// ETB-Folgeeintrag (typ='meldung', gemeinsames auftrag_id). Liefert die ETB-`id`.
///
/// Pool-Hülle um [`melde_vollzug_tx`], im Verhalten wie vor dem Split: den ETB-Startwert liest
/// sie über den Pool, danach öffnet sie ein deferred `pool.begin()`, ruft den Rumpf und
/// committet. Die erste Anweisung der Transaktion ist ein Schreibzugriff.
pub async fn melde_vollzug(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    vollzugsmeldung: &str,
    jetzt: &str,
) -> Result<i64, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let mut tx = pool.begin().await?;
    let etb_id = melde_vollzug_tx(
        &mut tx,
        org_id,
        einsatz_id,
        auftrag_id,
        von_id,
        etb_startwert,
        vollzugsmeldung,
        jetzt,
    )
    .await?;
    tx.commit().await?;
    Ok(etb_id)
}

/// Rumpf von [`melde_vollzug`] auf einer offenen Verbindung/Transaktion (LFH-690, Demo-Import
/// in EINER Transaktion). Den ETB-Startwert bringt der Aufrufer mit, nach dem Muster von
/// [`anlegen_tx`]; der Import lädt ihn auf seiner eigenen Verbindung. Öffnet und committet
/// selbst nichts.
#[allow(clippy::too_many_arguments)]
pub async fn melde_vollzug_tx(
    conn: &mut sqlx::SqliteConnection,
    org_id: i64,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    etb_startwert: i64,
    vollzugsmeldung: &str,
    jetzt: &str,
) -> Result<i64, AppError> {
    // Die Bedingung im UPDATE hält einen gleichzeitig aufgehobenen Auftrag draußen (LLH-1098);
    // der Fehler rollt die Transaktion samt ETB-Meldung zurück.
    let getroffen = sqlx::query(
        "UPDATE auftrag SET vollzugsmeldung = ? WHERE id = ? AND aufgehoben_at IS NULL",
    )
    .bind(vollzugsmeldung)
    .bind(auftrag_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if getroffen == 0 {
        return Err(AppError::UnprocessableEntity(
            "Der Auftrag ist aufgehoben".into(),
        ));
    }
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut *conn,
        einsatz_id,
        von_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_MELDUNG,
            inhalt: vollzugsmeldung,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some(jetzt),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    link_etb_tx(&mut *conn, etb_id, auftrag_id).await?;
    // Vollzug-Achse im SELBEN Commit wie ETB-Meldung + Rückmeldetext (atomar):
    // ein Teilfehler rollt alles zurück, kein verwaister ETB-Eintrag.
    krepo::setze_vollzug_tx(
        &mut *conn,
        org_id,
        einsatz_id,
        OBJEKT_AUFTRAG,
        auftrag_id,
        VOLLZUG_VOLLZOGEN,
        von_id,
        jetzt,
    )
    .await?;
    Ok(etb_id)
}

/// Abnahme durch die Führung (4. Stufe). Setzt abgenommen_at/_von_id am Auftrag.
/// Idempotent (first-write-wins via `abgenommen_at IS NULL`) — eine bereits
/// erfolgte Abnahme (Zeitstempel + verantwortliche Person) bleibt unveränderlich.
pub async fn nimm_ab(
    pool: &SqlitePool,
    auftrag_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE auftrag SET abgenommen_at = ?, abgenommen_von_id = ? \
         WHERE id = ? AND abgenommen_at IS NULL AND aufgehoben_at IS NULL",
    )
    .bind(jetzt)
    .bind(von_id)
    .bind(auftrag_id)
    .execute(pool)
    .await?;
    // Ein gleichzeitig aufgehobener Auftrag wird nicht abgenommen (LLH-1098); eine schon erfolgte
    // Abnahme bleibt idempotent.
    let aufgehoben: Option<bool> =
        sqlx::query_scalar("SELECT aufgehoben_at IS NOT NULL FROM auftrag WHERE id = ?")
            .bind(auftrag_id)
            .fetch_optional(pool)
            .await?;
    if aufgehoben == Some(true) {
        return Err(AppError::UnprocessableEntity(
            "Ein aufgehobener Auftrag lässt sich nicht abnehmen".into(),
        ));
    }
    Ok(())
}

/// Bearbeitungsstatus und Nummer eines Auftrags des Einsatzes, in der Transaktion gelesen
/// (LLH-1098). `NotFound` für einen unbekannten oder einsatzfremden Auftrag.
async fn stand_in_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    auftrag_id: i64,
) -> Result<(super::AuftragBearbeitungsstatus, Option<i64>, bool), AppError> {
    const SQL: &str = concat!(
        "SELECT ",
        bearbeitungsstatus_sql!(),
        ", a.lfd_nr, ",
        ist_berichtigbar_sql!(),
        " FROM auftrag a",
        vollzug_join_sql!(),
        " WHERE a.id = ? AND a.einsatz_id = ?"
    );
    let (status, lfd_nr, berichtigbar): (String, Option<i64>, bool) = sqlx::query_as(SQL)
        .bind(auftrag_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
    let status = super::AuftragBearbeitungsstatus::try_from(status)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok((status, lfd_nr, berichtigbar))
}

/// Die Anzeigenamen der Empfänger eines Auftrags in ihrer Reihenfolge (für das ETB-`an`).
async fn empfaenger_namen_tx(
    conn: &mut sqlx::SqliteConnection,
    auftrag_id: i64,
) -> Result<Vec<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT snap_anzeige FROM auftrag_empfaenger WHERE auftrag_id = ? ORDER BY id",
    )
    .bind(auftrag_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Schreibt eine Anordnung zu einem Auftrag ins ETB (LLH-1098, design.md D5): Ereigniszeit
/// jetzt, `von` die Systemkennung, `an` die Empfänger, Rückverweis `auftrag_id`. Unabhängig vom
/// Auto-ETB-Schalter: Aufheben und Berichtigen sind Führungsvorgänge, kein Spiegel.
#[allow(clippy::too_many_arguments)]
async fn anordnung_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    etb_startwert: i64,
    inhalt: &str,
    an: &str,
    jetzt: &str,
) -> Result<i64, AppError> {
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut *conn,
        einsatz_id,
        von_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_ANORDNUNG,
            inhalt,
            von: None,
            an: Some(an),
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some(jetzt),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    link_etb_tx(&mut *conn, etb_id, auftrag_id).await?;
    Ok(etb_id)
}

/// Koppelt einen ETB-Eintrag an seinen Auftrag (Rückverweis `auftrag_id`) und hält die
/// Einheiten fest, an die er sich jetzt richtet (LLH-1175, Tabelle `etb_eintrag_einheit`). Der
/// ETB-Filter „Einheit“ liest diesen Stand, nicht die aktuellen Empfänger: eine Berichtigung
/// ersetzt sie, und alte Einträge wanderten sonst zum neuen Empfänger.
async fn link_etb_tx(
    conn: &mut sqlx::SqliteConnection,
    etb_id: i64,
    auftrag_id: i64,
) -> Result<(), AppError> {
    sqlx::query("UPDATE etb_eintrag SET auftrag_id = ? WHERE id = ?")
        .bind(auftrag_id)
        .bind(etb_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT OR IGNORE INTO etb_eintrag_einheit (eintrag_id, einheit_id) \
         SELECT ?, einheit_id FROM auftrag_empfaenger \
         WHERE auftrag_id = ? AND empfaenger_typ = 'einheit' AND einheit_id IS NOT NULL",
    )
    .bind(etb_id)
    .bind(auftrag_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Hebt einen Auftrag auf (LLH-1098, Spec `auftrag-aufheben-berichtigen`) und liefert die id der
/// ETB-Anordnung. In EINER Transaktion: Prüfung des Stands (abgenommen oder schon aufgehoben →
/// 422), Aufhebung am Auftrag, Anordnung „Auftrag #N aufgehoben: <Grund>“ und das Schließen der
/// Auto-Frist-Erinnerung. Manuelle Erinnerungen bleiben. `grund` ist vom Handler geprüft.
#[allow(clippy::too_many_arguments)]
pub async fn aufheben_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    etb_startwert: i64,
    grund: &str,
    jetzt: &str,
) -> Result<i64, AppError> {
    use super::AuftragBearbeitungsstatus as S;
    let (status, lfd_nr, _) = stand_in_tx(&mut *conn, einsatz_id, auftrag_id).await?;
    match status {
        S::Aufgehoben => {
            return Err(AppError::UnprocessableEntity(
                "Der Auftrag ist bereits aufgehoben".into(),
            ))
        }
        S::Abgenommen => {
            return Err(AppError::UnprocessableEntity(
                "Ein abgenommener Auftrag lässt sich nicht aufheben".into(),
            ))
        }
        S::Offen | S::InArbeit | S::Vollzogen => {}
    }
    sqlx::query(
        "UPDATE auftrag SET aufgehoben_at = ?, aufgehoben_von_id = ?, aufhebungsgrund = ? \
         WHERE id = ? AND aufgehoben_at IS NULL AND abgenommen_at IS NULL",
    )
    .bind(jetzt)
    .bind(von_id)
    .bind(grund)
    .bind(auftrag_id)
    .execute(&mut *conn)
    .await?;
    let an = super::kappe_an(&empfaenger_namen_tx(&mut *conn, auftrag_id).await?);
    let etb_id = anordnung_tx(
        &mut *conn,
        einsatz_id,
        auftrag_id,
        von_id,
        etb_startwert,
        &super::etb_text::aufgehoben(lfd_nr, grund),
        &an,
        jetzt,
    )
    .await?;
    crate::erinnerung::repo::schliesse_offene_auto_tx(
        &mut *conn,
        crate::kommunikation::OBJEKT_AUFTRAG,
        auftrag_id,
        jetzt,
    )
    .await?;
    Ok(etb_id)
}

/// Was eine Empfänger-Zeile als Ziel meint, ohne Snapshot und Quittung: der Vergleichsschlüssel
/// der Berichtigung.
type EmpfaengerZiel = (
    String,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn ziel_von(e: &EmpfaengerEingabe) -> EmpfaengerZiel {
    (
        e.empfaenger_typ.clone(),
        e.abschnitt_id,
        e.einheit_id,
        e.person_id,
        e.fahrzeug_id,
        e.funktion_text.clone(),
        e.funktion.map(|f| f.as_str().to_string()),
        e.extern_kategorie.clone(),
        e.extern_bezeichnung.clone(),
    )
}

/// Die gespeicherten Empfänger eines Auftrags in der Form der Eingabe, damit eine Berichtigung
/// unveränderte Empfänger übernehmen kann, statt sie neu zu prüfen (LLH-1176).
pub async fn empfaenger_bestand(
    pool: &SqlitePool,
    auftrag_id: i64,
) -> Result<Vec<EmpfaengerEingabe>, AppError> {
    let zeilen: Vec<EmpfaengerZiel> = sqlx::query_as(
        "SELECT empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id, funktion_text, \
                funktion, extern_kategorie, extern_bezeichnung \
         FROM auftrag_empfaenger WHERE auftrag_id = ? ORDER BY id",
    )
    .bind(auftrag_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|(t, a, e, p, f, ft, fc, ek, eb)| EmpfaengerEingabe {
            empfaenger_typ: t,
            abschnitt_id: a,
            einheit_id: e,
            person_id: p,
            fahrzeug_id: f,
            funktion_text: ft,
            funktion: fc
                .as_deref()
                .and_then(crate::fuehrung::Fuehrungsfunktion::parse),
            extern_kategorie: ek,
            extern_bezeichnung: eb,
        })
        .collect())
}

/// Der fachliche Stand eines Auftrags, den eine Berichtigung ändern kann.
#[derive(sqlx::FromRow)]
struct BerichtigungsStand {
    auftrag_text: String,
    prioritaet: String,
    frist_at: Option<String>,
    absicht: Option<String>,
    lage: Option<String>,
    ort: Option<String>,
    ort_lat: Option<f64>,
    ort_lon: Option<f64>,
    zeit: Option<String>,
    mittel: Option<String>,
    verbindung: Option<String>,
    sicherheit: Option<String>,
    weg: Option<String>,
}

impl BerichtigungsStand {
    fn schema(&self) -> [&Option<String>; 8] {
        [
            &self.absicht,
            &self.lage,
            &self.ort,
            &self.zeit,
            &self.mittel,
            &self.verbindung,
            &self.sicherheit,
            &self.weg,
        ]
    }
}

/// Frist für den ETB-Text in Zone und Darstellung des Einsatzes („121600okt26“, LLH-1061).
fn frist_text(frist: &Option<String>, stil: Zeitstil) -> Option<String> {
    frist.as_deref().map(|f| stil.zeitpunkt_text(f))
}

/// Ergebnis einer Berichtigung: die ETB-Anordnung (`None` ohne fachliche Änderung, dann wurde
/// nichts geschrieben) und die hinzugekommenen Empfänger, die erst jetzt vom Auftrag erfahren
/// (Benachrichtigung „Neuer Auftrag“, LLH-1212).
#[derive(Debug, Default)]
pub struct Berichtigt {
    pub etb_id: Option<i64>,
    pub hinzu: Vec<EmpfaengerEingabe>,
}

/// Berichtigt einen Auftrag (LLH-1098, Spec `auftrag-aufheben-berichtigen`, design.md D6/D7) und
/// liefert die ETB-Anordnung samt den hinzugekommenen Empfängern ([`Berichtigt`]). In EINER
/// Transaktion: Prüfung „offen und unquittiert“ (sonst 422), Felder, gegebenenfalls neue
/// Empfänger-Zeilen, Erinnerung „Quittierfrist“ und die Anordnung „Auftrag #N geändert: …“. `b`
/// ist vom Handler geprüft.
#[allow(clippy::too_many_arguments)]
pub async fn berichtigen_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    etb_startwert: i64,
    stil: Zeitstil,
    b: &super::ValidierteBerichtigung,
    jetzt: &str,
) -> Result<Berichtigt, AppError> {
    use super::etb_text::Aenderung;
    use super::AuftragBearbeitungsstatus as S;
    let (status, lfd_nr, berichtigbar) = stand_in_tx(&mut *conn, einsatz_id, auftrag_id).await?;
    if !berichtigbar {
        return Err(AppError::UnprocessableEntity(
            match status {
                S::Aufgehoben => "Der Auftrag ist aufgehoben",
                S::Offen => {
                    "Ein Empfänger hat schon quittiert: den Auftrag aufheben und neu erteilen"
                }
                S::InArbeit | S::Vollzogen | S::Abgenommen => {
                    "Nur ein offener Auftrag lässt sich berichtigen"
                }
            }
            .into(),
        ));
    }
    let alt: BerichtigungsStand = sqlx::query_as(
        "SELECT auftrag_text, prioritaet, frist_at, absicht, lage, ort, ort_lat, ort_lon, zeit, \
                mittel, verbindung, sicherheit, weg FROM auftrag WHERE id = ?",
    )
    .bind(auftrag_id)
    .fetch_one(&mut *conn)
    .await?;
    let alte_ziele: Vec<(i64, EmpfaengerZiel, String)> = sqlx::query_as::<
        _,
        (
            i64,
            String,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        ),
    >(
        "SELECT id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id, \
                funktion_text, funktion, extern_kategorie, extern_bezeichnung, snap_anzeige \
         FROM auftrag_empfaenger WHERE auftrag_id = ? ORDER BY id",
    )
    .bind(auftrag_id)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|(id, t, a, e, p, f, ft, fc, ek, eb, snap)| (id, (t, a, e, p, f, ft, fc, ek, eb), snap))
    .collect();
    let alte_namen: Vec<String> = alte_ziele.iter().map(|(_, _, n)| n.clone()).collect();

    let mut aenderungen = Vec::new();
    let text = match &b.auftrag_text {
        Some(t) if *t != alt.auftrag_text => {
            aenderungen.push(Aenderung::Text(t.clone()));
            t.clone()
        }
        _ => alt.auftrag_text.clone(),
    };
    // Die Empfänger sind eine Menge (LLH-1176): eine andere Reihenfolge ist keine Berichtigung,
    // und gleiche Zeilen zählen einmal. Gleich werden sie etwa, wenn zwei Empfänger-Einheiten
    // aufgelöst sind (ON DELETE SET NULL), oder wenn zwei Eingabezeilen dasselbe Ziel meinen.
    let ist_alt = |z: &EmpfaengerZiel| alte_ziele.iter().any(|(_, a, _)| a == z);
    let neue_empfaenger = b.empfaenger.as_ref().filter(|neu| {
        let mut neue: Vec<EmpfaengerZiel> = neu.iter().map(ziel_von).collect();
        let mut alte: Vec<&EmpfaengerZiel> = alte_ziele.iter().map(|(_, z, _)| z).collect();
        neue.sort();
        neue.dedup();
        alte.sort();
        alte.dedup();
        neue.iter().collect::<Vec<_>>() != alte
    });
    let empfaenger_index = aenderungen.len();
    let prioritaet = match &b.prioritaet {
        Some(p) if *p != alt.prioritaet => {
            aenderungen.push(Aenderung::Prioritaet {
                neu: p.clone(),
                vorher: alt.prioritaet.clone(),
            });
            p.clone()
        }
        _ => alt.prioritaet.clone(),
    };
    let frist = match &b.frist_at {
        Some(f) if *f != alt.frist_at => {
            aenderungen.push(Aenderung::Frist {
                neu: frist_text(f, stil),
                vorher: frist_text(&alt.frist_at, stil),
            });
            Some(f.clone())
        }
        _ => None,
    };
    // Koordinate des Ziels (LLH-1114, design.md D3/D4): hängt am Text — ohne Text kein Punkt,
    // ein geleerter Text leert ihn mit. Ein neuer Punkt ist eine Änderung von „Ziel/Ort“.
    let alt_punkt = alt.ort_lat.zip(alt.ort_lon);
    let ort_nachher = b.schema[2].as_ref().unwrap_or(&alt.ort);
    let ort_punkt = match (ort_nachher, b.ort_punkt) {
        (None, Some(Some(_))) => {
            return Err(AppError::UnprocessableEntity(
                "Eine Koordinate des Ziels braucht einen Text „Ziel/Ort“".into(),
            ))
        }
        (None, _) => None,
        (Some(_), Some(neu)) => neu,
        (Some(_), None) => alt_punkt,
    };
    let mut schema: Vec<Option<String>> = alt.schema().into_iter().cloned().collect();
    for (i, neu) in b.schema.iter().enumerate() {
        let text_neu = neu.as_ref().filter(|n| **n != schema[i]);
        // Index 2 ist „Ziel/Ort“ (`SCHEMAFELDER`): dort zählt auch ein neuer Punkt.
        if text_neu.is_some() || (i == 2 && ort_punkt != alt_punkt) {
            aenderungen.push(Aenderung::Schemafeld(super::eingabe::SCHEMAFELDER[i].1));
        }
        if let Some(n) = text_neu {
            schema[i] = n.clone();
        }
    }
    if aenderungen.is_empty() && neue_empfaenger.is_none() {
        return Ok(Berichtigt::default());
    }

    let frist_wert = frist.clone().unwrap_or(alt.frist_at.clone());
    sqlx::query(
        "UPDATE auftrag SET auftrag_text = ?, prioritaet = ?, frist_at = ?, absicht = ?, lage = ?, \
           ort = ?, ort_lat = ?, ort_lon = ?, zeit = ?, mittel = ?, verbindung = ?, sicherheit = ?, \
           weg = ? WHERE id = ?",
    )
    .bind(&text)
    .bind(&prioritaet)
    .bind(&frist_wert)
    .bind(&schema[0])
    .bind(&schema[1])
    .bind(&schema[2])
    .bind(ort_punkt.map(|p| p.0))
    .bind(ort_punkt.map(|p| p.1))
    .bind(&schema[3])
    .bind(&schema[4])
    .bind(&schema[5])
    .bind(&schema[6])
    .bind(&schema[7])
    .bind(auftrag_id)
    .execute(&mut *conn)
    .await?;

    let mut hinzugekommen = Vec::new();
    let namen = match neue_empfaenger {
        Some(neu) => {
            // Sicher, weil niemand quittiert hat (Prüfung oben, in derselben Transaktion). Ein
            // bleibender Empfänger behält seine Zeile samt Anzeige, auch wenn sein Ziel inzwischen
            // aufgelöst ist (LLH-1176); nur weggefallene gehen, nur hinzugekommene entstehen.
            let mut neue_ziele: Vec<EmpfaengerZiel> = Vec::new();
            let mut hinzu: Vec<EmpfaengerEingabe> = Vec::new();
            for e in neu {
                let z = ziel_von(e);
                if !neue_ziele.contains(&z) {
                    if !ist_alt(&z) {
                        hinzu.push(e.clone());
                    }
                    neue_ziele.push(z);
                }
            }
            for (id, ziel, _) in &alte_ziele {
                if !neue_ziele.contains(ziel) {
                    sqlx::query("DELETE FROM auftrag_empfaenger WHERE id = ?")
                        .bind(id)
                        .execute(&mut *conn)
                        .await?;
                }
            }
            let mut hinzu_namen =
                empfaenger_einfuegen_tx(&mut *conn, einsatz_id, auftrag_id, &hinzu)
                    .await?
                    .into_iter();
            hinzugekommen = hinzu;
            let namen: Vec<String> = neue_ziele
                .iter()
                .flat_map(|z| {
                    let behalten: Vec<String> = alte_ziele
                        .iter()
                        .filter(|(_, a, _)| a == z)
                        .map(|(_, _, n)| n.clone())
                        .collect();
                    if behalten.is_empty() {
                        hinzu_namen.next().into_iter().collect()
                    } else {
                        behalten
                    }
                })
                .collect();
            aenderungen.insert(
                empfaenger_index,
                Aenderung::Empfaenger {
                    neu: super::kappe_an(&namen),
                    vorher: super::kappe_an(&alte_namen),
                },
            );
            namen
        }
        None => alte_namen,
    };

    if let Some(f) = &frist {
        match f {
            Some(f) => {
                crate::erinnerung::repo::setze_auto_frist_tx(
                    &mut *conn,
                    einsatz_id,
                    von_id,
                    crate::kommunikation::OBJEKT_AUFTRAG,
                    auftrag_id,
                    &super::quittierfrist_titel(lfd_nr),
                    f,
                )
                .await?;
            }
            None => {
                crate::erinnerung::repo::schliesse_offene_auto_tx(
                    &mut *conn,
                    crate::kommunikation::OBJEKT_AUFTRAG,
                    auftrag_id,
                    jetzt,
                )
                .await?;
            }
        }
    }

    let etb_id = anordnung_tx(
        &mut *conn,
        einsatz_id,
        auftrag_id,
        von_id,
        etb_startwert,
        &super::etb_text::geaendert(lfd_nr, &aenderungen),
        &super::kappe_an(&namen),
        jetzt,
    )
    .await?;
    // Die Anordnung nennt den alten Kreis („vorher …“), also steht sie auch unter ihm (LLH-1175);
    // den neuen hat `anordnung_tx` schon festgehalten.
    if neue_empfaenger.is_some() {
        for (_, ziel, _) in &alte_ziele {
            if let ("einheit", Some(einheit_id)) = (ziel.0.as_str(), ziel.2) {
                sqlx::query(
                    "INSERT OR IGNORE INTO etb_eintrag_einheit (eintrag_id, einheit_id) \
                     VALUES (?, ?)",
                )
                .bind(etb_id)
                .bind(einheit_id)
                .execute(&mut *conn)
                .await?;
            }
        }
    }
    Ok(Berichtigt {
        etb_id: Some(etb_id),
        hinzu: hinzugekommen,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auftrag::{AuftragBearbeitungsstatus, EmpfaengerTyp};
    use crate::kommunikation::{
        repo as krepo, AdressatKategorie, Richtung, OBJEKT_AUFTRAG, VOLLZUG_VOLLZOGEN,
    };

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'L','l','h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    fn daten<'a>(
        text: &'a str,
        frist: Option<&'a str>,
        empf: Vec<EmpfaengerEingabe>,
    ) -> AuftragDaten<'a> {
        AuftragDaten {
            auftrag_text: text,
            absicht: None,
            lage: None,
            ort: None,
            ort_punkt: None,
            zeit: None,
            mittel: None,
            verbindung: None,
            sicherheit: None,
            weg: None,
            prioritaet: super::super::PRIO_NORMAL,
            richtung: super::super::RICHTUNG_INTERN,
            frist_at: frist,
            erteilt_at: "2026-06-11 09:00:00",
            empfaenger: empf,
        }
    }

    fn funktion(t: &str) -> EmpfaengerEingabe {
        EmpfaengerEingabe {
            empfaenger_typ: "funktion".into(),
            abschnitt_id: None,
            einheit_id: None,
            person_id: None,
            fahrzeug_id: None,
            funktion_text: Some(t.into()),
            funktion: None,
            extern_kategorie: None,
            extern_bezeichnung: None,
        }
    }

    fn extern_empf(kat: &str, bez: &str) -> EmpfaengerEingabe {
        EmpfaengerEingabe {
            empfaenger_typ: "extern".into(),
            abschnitt_id: None,
            einheit_id: None,
            person_id: None,
            fahrzeug_id: None,
            funktion_text: None,
            funktion: None,
            extern_kategorie: Some(kat.into()),
            extern_bezeichnung: Some(bez.into()),
        }
    }

    /// Wie `daten`, aber mit frei wählbarer Priorität (für Sortier-Tests).
    fn daten_prio<'a>(
        text: &'a str,
        prio: &'a str,
        frist: Option<&'a str>,
        empf: Vec<EmpfaengerEingabe>,
    ) -> AuftragDaten<'a> {
        AuftragDaten {
            prioritaet: prio,
            ..daten(text, frist, empf)
        }
    }

    #[tokio::test]
    async fn lfd_nr_startet_bei_eins_und_zaehlt_hoch() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let a1 = anlegen(
            &pool,
            e,
            b,
            daten("erster", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        let a2 = anlegen(
            &pool,
            e,
            b,
            daten("zweiter", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert_eq!(a1.auftrag.lfd_nr, Some(1));
        assert_eq!(a2.auftrag.lfd_nr, Some(2));
    }

    #[tokio::test]
    async fn auftrag_startwert_aus_einstellungen_wirkt_und_etb_eigener_startwert() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // Auftrags-Startwert 20, ETB-Startwert 200 — getrennte Nummernkreise.
        crate::einsatz::einstellungen::speichern(
            &pool,
            e,
            b,
            crate::einsatz::einstellungen::EinstellungenDaten {
                auftrag_nummer_start: Some(20),
                etb_nummer_start: Some(200),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let a = anlegen(
            &pool,
            e,
            b,
            daten("Deich sichern", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert_eq!(
            a.auftrag.lfd_nr,
            Some(20),
            "Auftrags-lfd_nr startet beim Auftrags-Startwert"
        );
        // Die im selben Commit erzeugte ETB-Anordnung nutzt ihren EIGENEN Startwert (200).
        let etb_lfd: i64 = sqlx::query_scalar("SELECT lfd_nr FROM etb_eintrag WHERE id = ?")
            .bind(a.auftrag.etb_anordnung_id.unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            etb_lfd, 200,
            "ETB-Anordnung nutzt den ETB-Startwert, nicht den Auftrags-Startwert"
        );
    }

    #[tokio::test]
    async fn auto_etb_aus_unterdrueckt_die_anordnung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // Auto-ETB abschalten (Some(0)).
        crate::einsatz::einstellungen::speichern(
            &pool,
            e,
            b,
            crate::einsatz::einstellungen::EinstellungenDaten {
                auto_etb_eintraege: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let d = anlegen(
            &pool,
            e,
            b,
            daten("ohne ETB", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert!(
            d.auftrag.etb_anordnung_id.is_none(),
            "Auto-ETB aus → keine ETB-Anordnung"
        );
        // Kein ETB-Eintrag im Einsatz.
        let etb_anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(etb_anzahl, 0);
    }

    #[tokio::test]
    async fn auto_etb_default_an_erzeugt_anordnung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // Ohne Setting (NULL) = Default an → Anordnung wie heute.
        let d = anlegen(
            &pool,
            e,
            b,
            daten("mit ETB", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert!(
            d.auftrag.etb_anordnung_id.is_some(),
            "Default an → ETB-Anordnung"
        );
    }

    #[tokio::test]
    async fn lfd_nr_ist_pro_einsatz_unabhaengig() {
        let pool = crate::db::test_pool().await;
        let (b, e_a) = setup(&pool).await;
        let e_b: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage B') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        anlegen(
            &pool,
            e_a,
            b,
            daten("A1", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        let b1 = anlegen(
            &pool,
            e_b,
            b,
            daten("B1", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        // Fremder Einsatz mit Auftrag darf die Nummerierung dieses Einsatzes nicht beeinflussen.
        assert_eq!(b1.auftrag.lfd_nr, Some(1));
    }

    #[tokio::test]
    async fn anlegen_speichert_auftrag_mit_empfaenger_und_default_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("Deich sichern", None, vec![funktion("Abschnitt Nord")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert_eq!(d.auftrag.auftrag_text, "Deich sichern");
        assert_eq!(d.auftrag.vollzug_status, "offen");
        assert_eq!(
            d.auftrag.bearbeitungsstatus,
            AuftragBearbeitungsstatus::Offen
        );
        assert_eq!(d.auftrag.empfaenger_anzahl, 1);
        assert_eq!(d.auftrag.quittiert_anzahl, 0);
        assert_eq!(d.empfaenger.len(), 1);
        assert_eq!(d.empfaenger[0].snap_anzeige, "Abschnitt Nord");
        assert!(
            d.auftrag.etb_anordnung_id.is_some(),
            "ETB-Anordnung wird erzeugt"
        );
    }

    #[tokio::test]
    async fn anlegen_erzeugt_etb_anordnung_mit_backlink() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("Lage erkunden", None, vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        let etb_id = d.auftrag.etb_anordnung_id.unwrap();
        let typ: String = sqlx::query_scalar("SELECT typ FROM etb_eintrag WHERE id = ?")
            .bind(etb_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(typ, "anordnung");
        let backlink: i64 = sqlx::query_scalar("SELECT auftrag_id FROM etb_eintrag WHERE id = ?")
            .bind(etb_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(backlink, d.auftrag.id);
    }

    #[tokio::test]
    async fn liste_liefert_auftraege_mit_empfaenger() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(
            &pool,
            e,
            b,
            daten("A", None, vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        anlegen(
            &pool,
            e,
            b,
            daten("B", None, vec![funktion("EA2")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        let liste = liste(&pool, e, None, None, None, "2026-06-11 10:00:00")
            .await
            .unwrap();
        assert_eq!(liste.len(), 2);
        assert!(liste.iter().all(|d| d.empfaenger.len() == 1));
    }

    #[tokio::test]
    async fn ueberfaellig_wenn_frist_ueberschritten_und_unquittiert() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("Frist", Some("2026-06-11 10:00:00"), vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        let vor = laden(&pool, d.auftrag.id, "2026-06-11 09:30:00")
            .await
            .unwrap();
        assert!(!vor.auftrag.ist_ueberfaellig, "vor Frist nicht überfällig");
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:30:00")
            .await
            .unwrap();
        assert!(
            nach.auftrag.ist_ueberfaellig,
            "nach Frist + unquittiert: überfällig"
        );
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_schuetzt_cross_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", None, vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert!(gehoert_zu_einsatz(&pool, d.auftrag.id, e).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, d.auftrag.id, 999).await.unwrap());
    }

    #[tokio::test]
    async fn bearbeitungsstatus_spiegelt_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", None, vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        krepo::setze_vollzug(
            &pool,
            1,
            e,
            OBJEKT_AUFTRAG,
            d.auftrag.id,
            VOLLZUG_VOLLZOGEN,
            b,
            "2026-06-11 11:00:00",
        )
        .await
        .unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 11:30:00")
            .await
            .unwrap();
        assert_eq!(nach.auftrag.vollzug_status, "vollzogen");
        assert_eq!(
            nach.auftrag.bearbeitungsstatus,
            AuftragBearbeitungsstatus::Vollzogen
        );
    }

    #[tokio::test]
    async fn quittieren_setzt_nur_quittung_nicht_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", None, vec![funktion("EA1"), funktion("EA2")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        let empf1 = d.empfaenger[0].id;

        assert!(
            quittiere_empfaenger(&pool, empf1, b, "2026-06-11 10:00:00")
                .await
                .unwrap(),
            "die erste Quittung setzt"
        );
        assert!(
            !quittiere_empfaenger(&pool, empf1, b, "2026-06-11 10:00:30")
                .await
                .unwrap(),
            "eine wiederholte Quittung ändert nichts"
        );
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:01:00")
            .await
            .unwrap();
        assert_eq!(nach.auftrag.quittiert_anzahl, 1, "ein Empfänger quittiert");
        assert_eq!(nach.auftrag.empfaenger_anzahl, 2);
        assert_eq!(
            nach.auftrag.vollzug_status, "offen",
            "Quittung ändert Vollzug nicht"
        );
        assert_eq!(
            nach.auftrag.bearbeitungsstatus,
            AuftragBearbeitungsstatus::Offen
        );
        let e1 = nach.empfaenger.iter().find(|x| x.id == empf1).unwrap();
        assert_eq!(e1.quittiert_at.as_deref(), Some("2026-06-11 10:00:00"));
        assert_eq!(e1.quittiert_von_id, Some(b));
    }

    #[tokio::test]
    async fn empfaenger_gehoert_zu_auftrag_schuetzt() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", None, vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert!(
            empfaenger_gehoert_zu_auftrag(&pool, d.empfaenger[0].id, d.auftrag.id)
                .await
                .unwrap()
        );
        assert!(
            !empfaenger_gehoert_zu_auftrag(&pool, d.empfaenger[0].id, 999)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn in_arbeit_setzt_zeitstempel_und_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", None, vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        setze_in_arbeit(&pool, 1, e, d.auftrag.id, b, "2026-06-11 10:00:00")
            .await
            .unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:01:00")
            .await
            .unwrap();
        assert_eq!(
            nach.auftrag.bearbeitungsstatus,
            AuftragBearbeitungsstatus::InArbeit
        );
        assert_eq!(
            nach.auftrag.in_arbeit_at.as_deref(),
            Some("2026-06-11 10:00:00")
        );
    }

    #[tokio::test]
    async fn melde_vollzug_setzt_text_status_und_etb_meldung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", None, vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        let etb_id = melde_vollzug(
            &pool,
            1,
            e,
            d.auftrag.id,
            b,
            "Deich gehalten",
            "2026-06-11 11:00:00",
        )
        .await
        .unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 11:01:00")
            .await
            .unwrap();
        assert_eq!(
            nach.auftrag.bearbeitungsstatus,
            AuftragBearbeitungsstatus::Vollzogen
        );
        assert_eq!(
            nach.auftrag.vollzugsmeldung.as_deref(),
            Some("Deich gehalten")
        );
        let (typ, backlink): (String, i64) =
            sqlx::query_as("SELECT typ, auftrag_id FROM etb_eintrag WHERE id = ?")
                .bind(etb_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(typ, "meldung");
        assert_eq!(backlink, d.auftrag.id);
    }

    #[tokio::test]
    async fn nimm_ab_setzt_abnahme_nach_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", None, vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        melde_vollzug(
            &pool,
            1,
            e,
            d.auftrag.id,
            b,
            "fertig",
            "2026-06-11 11:00:00",
        )
        .await
        .unwrap();
        nimm_ab(&pool, d.auftrag.id, b, "2026-06-11 12:00:00")
            .await
            .unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 12:01:00")
            .await
            .unwrap();
        assert_eq!(
            nach.auftrag.bearbeitungsstatus,
            AuftragBearbeitungsstatus::Abgenommen
        );
        assert_eq!(nach.auftrag.abgenommen_von_id, Some(b));
    }

    /// Setzt die Aufhebung direkt in der Tabelle (LLH-1098): die Tests hier prüfen die
    /// Ableitung, nicht den Schreibweg.
    async fn hebe_auf_roh(pool: &SqlitePool, auftrag_id: i64, von_id: i64, at: &str) {
        sqlx::query(
            "UPDATE auftrag SET aufgehoben_at = ?, aufgehoben_von_id = ?, aufhebungsgrund = 'Lage erledigt' \
             WHERE id = ?",
        )
        .bind(at)
        .bind(von_id)
        .bind(auftrag_id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn aufgehoben_schlaegt_vollzug_und_ist_nie_ueberfaellig() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", Some("2026-06-11 10:00:00"), vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        melde_vollzug(
            &pool,
            1,
            e,
            d.auftrag.id,
            b,
            "fertig",
            "2026-06-11 09:30:00",
        )
        .await
        .unwrap();
        hebe_auf_roh(&pool, d.auftrag.id, b, "2026-06-11 11:00:00").await;

        let nach = laden(&pool, d.auftrag.id, "2026-06-11 12:00:00")
            .await
            .unwrap();
        assert_eq!(
            nach.auftrag.bearbeitungsstatus,
            AuftragBearbeitungsstatus::Aufgehoben
        );
        assert!(
            !nach.auftrag.ist_ueberfaellig,
            "Frist abgelaufen und unquittiert, aber aufgehoben: nicht überfällig"
        );
        assert_eq!(
            nach.auftrag.vollzugsmeldung.as_deref(),
            Some("fertig"),
            "die Vollzugsmeldung bleibt lesbar"
        );
        assert_eq!(
            nach.auftrag.aufgehoben_at.as_deref(),
            Some("2026-06-11 11:00:00")
        );
        assert_eq!(nach.auftrag.aufgehoben_von_id, Some(b));
        assert_eq!(
            nach.auftrag.aufhebungsgrund.as_deref(),
            Some("Lage erledigt")
        );
        assert!(!nach.auftrag.berichtigbar);
    }

    /// Gegen den Wettlauf mit dem Aufheben (LLH-1098): die Schreibwege prüfen selbst, nicht nur
    /// der Handler davor.
    #[tokio::test]
    async fn vollzug_abnahme_und_quittung_lehnen_den_aufgehobenen_ab() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", None, vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        hebe_auf_roh(&pool, d.auftrag.id, b, "2026-06-11 10:00:00").await;

        let vollzug =
            melde_vollzug(&pool, 1, e, d.auftrag.id, b, "doch", "2026-06-11 11:00:00").await;
        assert!(
            matches!(vollzug, Err(AppError::UnprocessableEntity(_))),
            "{vollzug:?}"
        );
        let meldungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE typ = 'meldung'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(meldungen, 0, "keine ETB-Meldung am aufgehobenen Auftrag");

        let abnahme = nimm_ab(&pool, d.auftrag.id, b, "2026-06-11 12:00:00").await;
        assert!(
            matches!(abnahme, Err(AppError::UnprocessableEntity(_))),
            "{abnahme:?}"
        );

        let quittung =
            quittiere_empfaenger(&pool, d.empfaenger[0].id, b, "2026-06-11 12:00:00").await;
        assert!(
            matches!(quittung, Err(AppError::UnprocessableEntity(_))),
            "{quittung:?}"
        );
        // Eine inzwischen ersetzte Empfängerzeile (Berichtigung) ist weg, nicht aufgehoben.
        let weg = quittiere_empfaenger(&pool, 99_999, b, "2026-06-11 12:00:00").await;
        assert!(matches!(weg, Err(AppError::NotFound)), "{weg:?}");
    }

    #[tokio::test]
    async fn aufgehoben_ist_abgeschlossen_in_liste_kennzahlen_und_zaehler() {
        use crate::kommunikation::{ListenPhase, Seite};
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let neu = |t: &'static str| daten(t, Some("2026-06-11 10:00:00"), vec![funktion("EA1")]);
        let vollzogen = anlegen(&pool, e, b, neu("vollzogen"), "2026-06-11 09:00:00")
            .await
            .unwrap();
        melde_vollzug(
            &pool,
            1,
            e,
            vollzogen.auftrag.id,
            b,
            "ok",
            "2026-06-11 11:00:00",
        )
        .await
        .unwrap();
        let aufgehoben = anlegen(&pool, e, b, neu("aufgehoben"), "2026-06-11 09:00:00")
            .await
            .unwrap();
        hebe_auf_roh(&pool, aufgehoben.auftrag.id, b, "2026-06-11 12:00:00").await;
        let offen = anlegen(&pool, e, b, neu("offen"), "2026-06-11 09:00:00")
            .await
            .unwrap();
        let jetzt = "2026-06-11 13:00:00";

        let abgeschlossen = liste_gefiltert(
            &pool,
            e,
            &AuftragFilter {
                phase: Some(ListenPhase::Abgeschlossen),
                seite: Some(Seite {
                    vor: None,
                    limit: 10,
                }),
                ..Default::default()
            },
            jetzt,
        )
        .await
        .unwrap();
        let ids: Vec<i64> = abgeschlossen.iter().map(|d| d.auftrag.id).collect();
        assert_eq!(
            ids,
            vec![aufgehoben.auftrag.id, vollzogen.auftrag.id],
            "aufgehoben um 12:00 steht vor vollzogen um 11:00"
        );
        let offene = liste_gefiltert(
            &pool,
            e,
            &AuftragFilter {
                phase: Some(ListenPhase::Offen),
                ..Default::default()
            },
            jetzt,
        )
        .await
        .unwrap();
        assert_eq!(
            offene.iter().map(|d| d.auftrag.id).collect::<Vec<_>>(),
            vec![offen.auftrag.id]
        );

        let k = kennzahlen(&pool, e, None, None, None).await.unwrap();
        assert_eq!((k.offen, k.abgeschlossen), (1, 2));

        let z = zaehlen(&pool, e, jetzt).await.unwrap();
        assert_eq!((z.offen, z.ueberfaellig), (1, 1));
    }

    #[tokio::test]
    async fn liste_sortiert_nach_prio_dann_frist() {
        use super::super::{PRIO_DRINGEND, PRIO_NORMAL, PRIO_SOFORT};
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // In gemischter Reihenfolge anlegen → erzwingt echtes ORDER BY (nicht Insert-Reihenfolge).
        // Erwartete Sortierung: sofort, dringend, dann drei 'normal' nach frist_at
        // (frühere Frist vor späterer, NULL-Frist zuletzt).
        anlegen(
            &pool,
            e,
            b,
            daten_prio(
                "normal-spaet",
                PRIO_NORMAL,
                Some("2026-06-11 12:00:00"),
                vec![funktion("EA")],
            ),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        anlegen(
            &pool,
            e,
            b,
            daten_prio("normal-ohne", PRIO_NORMAL, None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        anlegen(
            &pool,
            e,
            b,
            daten_prio("sofort", PRIO_SOFORT, None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        anlegen(
            &pool,
            e,
            b,
            daten_prio(
                "normal-frueh",
                PRIO_NORMAL,
                Some("2026-06-11 10:00:00"),
                vec![funktion("EA")],
            ),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        anlegen(
            &pool,
            e,
            b,
            daten_prio("dringend", PRIO_DRINGEND, None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();

        let liste = liste(&pool, e, None, None, None, "2026-06-11 09:30:00")
            .await
            .unwrap();
        let reihenfolge: Vec<&str> = liste
            .iter()
            .map(|d| d.auftrag.auftrag_text.as_str())
            .collect();
        assert_eq!(
            reihenfolge,
            vec![
                "sofort",
                "dringend",
                "normal-frueh",
                "normal-spaet",
                "normal-ohne"
            ]
        );
    }

    #[tokio::test]
    async fn ueberfaellig_false_wenn_alle_quittiert() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten("Frist", Some("2026-06-11 10:00:00"), vec![funktion("EA1")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        // Einzigen Empfänger quittieren → EXISTS(unquittiert) wird leer.
        quittiere_empfaenger(&pool, d.empfaenger[0].id, b, "2026-06-11 09:30:00")
            .await
            .unwrap();
        // Laden NACH der Frist: nicht überfällig, weil alle quittiert.
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:30:00")
            .await
            .unwrap();
        assert!(
            !nach.auftrag.ist_ueberfaellig,
            "alle quittiert → nicht überfällig trotz überschrittener Frist"
        );
    }

    #[tokio::test]
    async fn richtung_default_intern_und_liste_filtert_extern() {
        use super::super::RICHTUNG_EXTERN;
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d_int = anlegen(
            &pool,
            e,
            b,
            daten("intern-a", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert_eq!(d_int.auftrag.richtung, Richtung::Intern, "Default intern");
        let ext = AuftragDaten {
            richtung: RICHTUNG_EXTERN,
            ..daten("extern-a", None, vec![funktion("Leitstelle")])
        };
        anlegen(&pool, e, b, ext, "2026-06-11 09:00:00")
            .await
            .unwrap();

        let nur_extern = liste(&pool, e, None, Some("extern"), None, "2026-06-11 10:00:00")
            .await
            .unwrap();
        assert_eq!(nur_extern.len(), 1);
        assert_eq!(nur_extern[0].auftrag.richtung, Richtung::Extern);
        assert_eq!(nur_extern[0].auftrag.auftrag_text, "extern-a");
    }

    #[tokio::test]
    async fn erteile_aus_etb_setzt_quell_und_anordnung_verschieden() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // Quell-ETB-Eintrag, aus dem der Auftrag erteilt wird.
        let quell_etb = crate::etb::repo::anlegen(
            &pool,
            e,
            b,
            crate::etb::repo::EintragDaten {
                typ: crate::etb::TYP_MELDUNG,
                inhalt: "Deich instabil — Auftrag nötig",
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await
        .unwrap();

        let auftrag_id = erteile_aus_etb_tx(
            &pool,
            e,
            quell_etb.id,
            b,
            daten("Deich sichern", None, vec![funktion("EA1")]),
        )
        .await
        .unwrap();

        let detail = laden(&pool, auftrag_id, "2026-06-11 10:00:00")
            .await
            .unwrap();
        // Quell-Bezug auf den auslösenden Eintrag gesetzt.
        assert_eq!(detail.auftrag.quell_etb_eintrag_id, Some(quell_etb.id));
        // Eigene Anordnung im selben Commit erzeugt (Pattern B) …
        assert!(detail.auftrag.etb_anordnung_id.is_some());
        // … und VERSCHIEDEN vom Quell-Eintrag (getrennte Spalten, keine Heraufstufung der Quelle).
        assert_ne!(
            detail.auftrag.etb_anordnung_id,
            detail.auftrag.quell_etb_eintrag_id
        );
        assert_eq!(detail.auftrag.auftrag_text, "Deich sichern");
    }

    #[tokio::test]
    async fn erteile_aus_etb_mehrfach_aus_einem_eintrag_erlaubt() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let quell_etb = crate::etb::repo::anlegen(
            &pool,
            e,
            b,
            crate::etb::repo::EintragDaten {
                typ: crate::etb::TYP_MELDUNG,
                inhalt: "Lage",
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await
        .unwrap();
        // Anders als Meldung→Auftrag: ein ETB-Eintrag darf mehrere Aufträge auslösen (kein Conflict).
        let a1 = erteile_aus_etb_tx(
            &pool,
            e,
            quell_etb.id,
            b,
            daten("erster", None, vec![funktion("EA1")]),
        )
        .await
        .unwrap();
        let a2 = erteile_aus_etb_tx(
            &pool,
            e,
            quell_etb.id,
            b,
            daten("zweiter", None, vec![funktion("EA2")]),
        )
        .await
        .unwrap();
        assert_ne!(a1, a2);
        let d1 = laden(&pool, a1, "2026-06-11 10:00:00").await.unwrap();
        let d2 = laden(&pool, a2, "2026-06-11 10:00:00").await.unwrap();
        assert_eq!(d1.auftrag.quell_etb_eintrag_id, Some(quell_etb.id));
        assert_eq!(d2.auftrag.quell_etb_eintrag_id, Some(quell_etb.id));
    }

    #[tokio::test]
    async fn externer_adressat_wird_gespeichert_und_snap_aus_bezeichnung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(
            &pool,
            e,
            b,
            daten(
                "an Leitstelle",
                None,
                vec![extern_empf("leitstelle", "Leitstelle Nord")],
            ),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert_eq!(d.empfaenger.len(), 1);
        let empf = &d.empfaenger[0];
        assert_eq!(empf.empfaenger_typ, EmpfaengerTyp::Extern);
        assert_eq!(empf.extern_kategorie, Some(AdressatKategorie::Leitstelle));
        assert_eq!(empf.extern_bezeichnung.as_deref(), Some("Leitstelle Nord"));
        assert_eq!(empf.snap_anzeige, "Leitstelle Nord", "snap aus Bezeichnung");
    }

    #[tokio::test]
    async fn auto_etb_einsatz_null_org_aus_kein_etb_anordnung() {
        // Einsatz-Setting NULL + Org=0 → effektiv aus → kein ETB-Folgeeintrag
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        crate::org::einstellungen::speichern(
            &pool,
            1,
            b,
            crate::org::einstellungen::OrgEinstellungenDaten {
                auto_etb_eintraege: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        // Einsatz-Setting bleibt NULL (kein Override)
        let d = anlegen(
            &pool,
            e,
            b,
            daten("X", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert!(
            d.auftrag.etb_anordnung_id.is_none(),
            "Einsatz=NULL, Org=0 → kein ETB-Folgeeintrag"
        );
    }

    #[tokio::test]
    async fn auto_etb_einsatz_an_schlaegt_org_aus_anordnung() {
        // Einsatz=1 schlägt Org=0 → ETB-Folgeeintrag wird trotz Org-Aus erzeugt
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        crate::org::einstellungen::speichern(
            &pool,
            1,
            b,
            crate::org::einstellungen::OrgEinstellungenDaten {
                auto_etb_eintraege: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        crate::einsatz::einstellungen::speichern(
            &pool,
            e,
            b,
            crate::einsatz::einstellungen::EinstellungenDaten {
                auto_etb_eintraege: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let d = anlegen(
            &pool,
            e,
            b,
            daten("Y", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        assert!(
            d.auftrag.etb_anordnung_id.is_some(),
            "Einsatz=1 schlägt Org=0 → ETB-Folgeeintrag erzeugt"
        );
    }

    /// LFH-259/F34: Eine ungültige Priorität wird an der Repo-Grenze als Validation-Fehler
    /// abgewiesen (nicht nur per debug_assert, das im Release wegkompiliert wäre).
    #[tokio::test]
    async fn anlegen_ungueltige_prioritaet_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let mut d = daten("Erkunden", None, vec![funktion("Melder")]);
        d.prioritaet = "quatsch";
        assert!(matches!(
            anlegen(&pool, e, b, d, "2026-06-11 09:00:00")
                .await
                .unwrap_err(),
            AppError::Validation(_)
        ));
    }

    /// Empfänger, der auf einen Abschnitt oder eine Einheit zeigt (Filter-Tests, LFH-933).
    fn ziel(typ: &str, abschnitt_id: Option<i64>, einheit_id: Option<i64>) -> EmpfaengerEingabe {
        EmpfaengerEingabe {
            empfaenger_typ: typ.into(),
            abschnitt_id,
            einheit_id,
            person_id: None,
            fahrzeug_id: None,
            funktion_text: None,
            funktion: None,
            extern_kategorie: None,
            extern_bezeichnung: None,
        }
    }

    /// LFH-933: Status-, Richtungs- und Empfänger-Filter wirken in SQL und liefern genau, was
    /// das frühere Filtern in Rust über die ungefilterte Liste lieferte — dieselben Aufträge, in
    /// derselben Reihenfolge, mit allen Empfängern in `id`-Reihenfolge.
    #[tokio::test]
    async fn liste_filter_in_sql_wie_rust_filter_ueber_alle() {
        use crate::auftrag::{
            PRIO_DRINGEND, PRIO_NORMAL, PRIO_SOFORT, RICHTUNG_EXTERN, RICHTUNG_INTERN,
        };
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let mut abschnitte = Vec::new();
        for name in ["Nord", "Süd"] {
            abschnitte.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, ?) RETURNING id",
                )
                .bind(e)
                .bind(name)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let mut einheiten = Vec::new();
        for name in ["TLF 1", "GW 2"] {
            einheiten.push(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id",
                )
                .bind(e)
                .bind(name)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        let (a1, a2, u1, u2) = (abschnitte[0], abschnitte[1], einheiten[0], einheiten[1]);
        let abschnitt = |id| ziel("abschnitt", Some(id), None);
        let einheit = |id| ziel("einheit", None, Some(id));

        // (Text, Priorität, Frist, Richtung, Empfänger) — gemischt, damit die Sortierung trägt.
        let faelle = vec![
            ("a", PRIO_NORMAL, None, RICHTUNG_INTERN, vec![abschnitt(a1)]),
            (
                "b",
                PRIO_SOFORT,
                Some("2026-06-11 12:00:00"),
                RICHTUNG_INTERN,
                vec![einheit(u1), abschnitt(a2)],
            ),
            (
                "c",
                PRIO_DRINGEND,
                None,
                RICHTUNG_EXTERN,
                vec![einheit(u2), funktion("S3")],
            ),
            (
                "d",
                PRIO_NORMAL,
                Some("2026-06-11 08:00:00"),
                RICHTUNG_INTERN,
                vec![funktion("EA")],
            ),
            (
                "e",
                PRIO_SOFORT,
                None,
                RICHTUNG_INTERN,
                vec![abschnitt(a1), einheit(u2), einheit(u1)],
            ),
            (
                "f",
                PRIO_NORMAL,
                Some("2026-06-11 08:00:00"),
                RICHTUNG_EXTERN,
                vec![einheit(u1)],
            ),
        ];
        let mut ids = Vec::new();
        for (text, prio, frist, richtung, empf) in faelle {
            let d = AuftragDaten {
                richtung,
                ..daten_prio(text, prio, frist, empf)
            };
            ids.push(
                anlegen(&pool, e, b, d, "2026-06-11 09:00:00")
                    .await
                    .unwrap()
                    .auftrag
                    .id,
            );
        }
        // Bearbeitungsstatus streuen: in Arbeit, vollzogen, abgenommen, Rest offen.
        for (id, status) in [
            (ids[1], VOLLZUG_IN_ARBEIT),
            (ids[2], VOLLZUG_VOLLZOGEN),
            (ids[4], VOLLZUG_VOLLZOGEN),
        ] {
            krepo::setze_vollzug(
                &pool,
                1,
                e,
                OBJEKT_AUFTRAG,
                id,
                status,
                b,
                "2026-06-11 10:00:00",
            )
            .await
            .unwrap();
        }
        sqlx::query("UPDATE auftrag SET abgenommen_at = '2026-06-11 10:30:00' WHERE id = ?")
            .bind(ids[4])
            .execute(&pool)
            .await
            .unwrap();

        let jetzt = "2026-06-11 11:00:00";
        let alle = liste(&pool, e, None, None, None, jetzt).await.unwrap();
        assert_eq!(alle.len(), 6);
        assert_eq!(
            alle.iter().map(|d| d.empfaenger.len()).sum::<usize>(),
            10,
            "alle Empfänger geladen"
        );
        let als_json = |l: &[AuftragDetail]| serde_json::to_value(l).unwrap();

        let filter = [
            None,
            Some((None, None)),
            Some((Some(a1), None)),
            Some((Some(a2), None)),
            Some((None, Some(u1))),
            Some((None, Some(u2))),
            Some((Some(a2), Some(u1))),
        ];
        let status = [
            None,
            Some("offen"),
            Some("in_arbeit"),
            Some("vollzogen"),
            Some("abgenommen"),
            Some("unbekannt"),
        ];
        let richtungen = [None, Some(RICHTUNG_INTERN), Some(RICHTUNG_EXTERN)];
        let mut treffer_gesamt = 0;
        for f in filter {
            let ef = f.map(|(abschnitt_id, einheit_id)| EmpfaengerFilter {
                abschnitt_id,
                einheit_id,
            });
            for s in status {
                for r in richtungen {
                    // Referenz: das frühere Verhalten — Rust-Filter über die volle Liste.
                    let erwartet: Vec<AuftragDetail> = alle
                        .iter()
                        .filter(|d| s.is_none_or(|s| d.auftrag.bearbeitungsstatus.as_str() == s))
                        .filter(|d| r.is_none_or(|r| d.auftrag.richtung.as_str() == r))
                        .filter(|d| match &ef {
                            None => true,
                            Some(f) => {
                                d.empfaenger
                                    .iter()
                                    .any(|x| match (f.abschnitt_id, f.einheit_id) {
                                        (Some(a), _) => x.abschnitt_id == Some(a),
                                        (None, Some(u)) => x.einheit_id == Some(u),
                                        (None, None) => true,
                                    })
                            }
                        })
                        .cloned()
                        .collect();
                    let ist = liste(&pool, e, s, r, ef.as_ref(), jetzt).await.unwrap();
                    assert_eq!(
                        als_json(&ist),
                        als_json(&erwartet),
                        "Filter {f:?}, Status {s:?}, Richtung {r:?}"
                    );
                    treffer_gesamt += ist.len();
                }
            }
        }
        assert!(
            treffer_gesamt > 50,
            "die Filter treffen tatsächlich etwas: {treffer_gesamt}"
        );

        // LFH-1043: Bereich eines Abschnittsgeräts — Abschnitte ODER Einheiten aus Listen.
        let bereiche: [(&[i64], &[i64]); 5] = [
            (&[a1], &[]),
            (&[], &[u2]),
            (&[a1, a2], &[u1]),
            (&[a2], &[u2]),
            (&[], &[]),
        ];
        for (abschnitte, einheiten) in bereiche {
            let bereich = EmpfaengerBereich {
                abschnitte_json: serde_json::to_string(abschnitte).unwrap(),
                einheiten_json: serde_json::to_string(einheiten).unwrap(),
            };
            let erwartet: Vec<AuftragDetail> = alle
                .iter()
                .filter(|d| {
                    d.empfaenger.iter().any(|x| {
                        x.abschnitt_id.is_some_and(|a| abschnitte.contains(&a))
                            || x.einheit_id.is_some_and(|u| einheiten.contains(&u))
                    })
                })
                .cloned()
                .collect();
            let ist = liste_gefiltert(
                &pool,
                e,
                &AuftragFilter {
                    bereich: Some(&bereich),
                    ..Default::default()
                },
                jetzt,
            )
            .await
            .unwrap();
            assert_eq!(
                als_json(&ist),
                als_json(&erwartet),
                "Bereich {abschnitte:?}/{einheiten:?}"
            );
        }
    }

    /// LFH-933: die Empfänger vieler Aufträge kommen gebündelt, je Auftrag in `id`-Reihenfolge,
    /// und gleich denen aus [`empfaenger_von`]. Aufträge ohne Empfänger und fremde ids fehlen.
    #[tokio::test]
    async fn empfaenger_von_allen_wie_einzeln() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let x = anlegen(
            &pool,
            e,
            b,
            daten("x", None, vec![funktion("A"), funktion("B"), funktion("C")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        let y = anlegen(
            &pool,
            e,
            b,
            daten("y", None, vec![funktion("D")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        let karte = empfaenger_von_allen(&pool, &[y.auftrag.id, x.auftrag.id, 9999])
            .await
            .unwrap();
        assert_eq!(karte.len(), 2);
        for id in [x.auftrag.id, y.auftrag.id] {
            let einzeln = empfaenger_von(&pool, id).await.unwrap();
            assert_eq!(
                serde_json::to_value(&karte[&id]).unwrap(),
                serde_json::to_value(&einzeln).unwrap()
            );
        }
        assert!(empfaenger_von_allen(&pool, &[]).await.unwrap().is_empty());
    }

    /// Kennungen der Treffer einer Suche, in Listenordnung.
    async fn treffer(pool: &SqlitePool, e: i64, filter: &AuftragFilter<'_>) -> Vec<i64> {
        liste_gefiltert(pool, e, filter, "2026-06-11 10:00:00")
            .await
            .unwrap()
            .into_iter()
            .map(|d| d.auftrag.id)
            .collect()
    }

    fn suche(begriff: &str) -> AuftragFilter<'_> {
        AuftragFilter {
            suche: Some(begriff),
            ..Default::default()
        }
    }

    /// Oxgob5gk, D9: die Suche trifft Text, Empfänger und Kennung „#n“, ohne Rücksicht auf
    /// ASCII-Groß-/Kleinschreibung; `%` und `_` suchen wörtlich.
    #[tokio::test]
    async fn suche_trifft_text_empfaenger_und_kennung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let mut ids = Vec::new();
        for (text, empf) in [
            ("Keller auspumpen", "EA Nord"),
            ("Straße sperren", "Polizei Süd"),
            ("50% Wasser abpumpen", "EA Nord"),
            ("50 Prozent Wasser abpumpen", "EA Nord"),
            ("500 Liter bereitstellen", "EA Nord"),
            ("Pumpe a_b holen", "EA Nord"),
            ("Pumpe axb holen", "EA Nord"),
        ] {
            let d = anlegen(
                &pool,
                e,
                b,
                daten(text, None, vec![funktion(empf)]),
                "2026-06-11 09:00:00",
            )
            .await
            .unwrap();
            ids.push(d.auftrag.id);
        }
        // Bis #12 auffüllen, damit die Kennung eindeutig ist.
        while ids.len() < 12 {
            let d = anlegen(
                &pool,
                e,
                b,
                daten("Füllung", None, vec![funktion("EA Nord")]),
                "2026-06-11 09:00:00",
            )
            .await
            .unwrap();
            ids.push(d.auftrag.id);
        }

        assert_eq!(treffer(&pool, e, &suche("keller")).await, vec![ids[0]]);
        assert_eq!(treffer(&pool, e, &suche("KELLER")).await, vec![ids[0]]);
        assert_eq!(treffer(&pool, e, &suche("polizei")).await, vec![ids[1]]);
        assert_eq!(treffer(&pool, e, &suche("#12")).await, vec![ids[11]]);
        assert_eq!(treffer(&pool, e, &suche("50%")).await, vec![ids[2]]);
        assert_eq!(treffer(&pool, e, &suche("a_b")).await, vec![ids[5]]);
        assert!(treffer(&pool, e, &suche("nirgends")).await.is_empty());
        // Ohne Nummer (Altbestand vor 0067) trifft keine Kennungssuche, auch nicht „#0“.
        sqlx::query("UPDATE auftrag SET lfd_nr = NULL WHERE id = ?")
            .bind(ids[6])
            .execute(&pool)
            .await
            .unwrap();
        assert!(treffer(&pool, e, &suche("#0")).await.is_empty());
        // Die Suche verengt die übrigen Filter, sie ersetzt sie nicht.
        assert!(treffer(
            &pool,
            e,
            &AuftragFilter {
                suche: Some("keller"),
                richtung: Some("extern"),
                ..Default::default()
            }
        )
        .await
        .is_empty());
    }

    /// Oxgob5gk, D9: die Suche wirkt vor dem `LIMIT` — der älteste von 150 Abgeschlossenen steht
    /// auf der ersten Seite, wenn nach seinem Text gesucht wird; die Kennzahlen zählen nur Treffer.
    #[tokio::test]
    async fn suche_wirkt_vor_der_seite_und_in_den_kennzahlen() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let mut ids = Vec::new();
        for i in 0..150 {
            let text = if i == 0 {
                "Ältester Sandsackauftrag".to_string()
            } else {
                format!("Auftrag {i}")
            };
            let d = anlegen(
                &pool,
                e,
                b,
                daten(&text, None, vec![funktion("EA")]),
                "2026-06-11 09:00:00",
            )
            .await
            .unwrap();
            ids.push(d.auftrag.id);
        }
        for (i, id) in ids.iter().enumerate() {
            sqlx::query("UPDATE auftrag SET abgenommen_at = ? WHERE id = ?")
                .bind(format!("2026-06-11 {:02}:{:02}:00", 8 + i / 60, i % 60))
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
        // Ein offener Treffer zählt in den Kennzahlen als offen.
        anlegen(
            &pool,
            e,
            b,
            daten("Sandsack nachfüllen", None, vec![funktion("EA")]),
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();

        let seite = |s| AuftragFilter {
            suche: s,
            phase: Some(crate::kommunikation::ListenPhase::Abgeschlossen),
            seite: Some(crate::kommunikation::Seite {
                vor: None,
                limit: 100,
            }),
            ..Default::default()
        };
        let ohne = treffer(&pool, e, &seite(None)).await;
        assert_eq!(ohne.len(), 100);
        assert!(!ohne.contains(&ids[0]), "ohne Suche nicht auf Seite 1");
        assert_eq!(
            treffer(&pool, e, &seite(Some("sandsackauftrag"))).await,
            vec![ids[0]]
        );

        let k = kennzahlen(&pool, e, None, None, Some("sandsack"))
            .await
            .unwrap();
        assert_eq!((k.offen, k.abgeschlossen), (1, 1));
        let k = kennzahlen(&pool, e, None, None, None).await.unwrap();
        assert_eq!((k.offen, k.abgeschlossen), (1, 150));
    }
}
