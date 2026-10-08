use super::{
    Ausmass, SchadenAnzeige, SchadenAuswahl, SchadenKennzahlen, SchadenMarker, SchadenStatus,
    SchadenTyp,
};
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

const SELECT_ALLE: &str = "\
    SELECT s.id, s.einsatz_id, s.registrier_nr, s.status, s.typ, s.ausmass, s.ort, \
           s.lat, s.lon, \
           s.beschreibung, s.geschaedigt_person_id, s.geschaedigt_kontakt, \
           s.geschaedigt_personal_id, s.geschaedigt_organisation_id, \
           s.uebergeben_an, s.uebergeben_at, s.abschluss_grund, s.abschluss_at, \
           s.erfasst_at, s.erfasst_von, s.geaendert_at, s.geaendert_von, \
           s.storniert_at, s.storniert_von, \
           gp.registrier_nr AS geschaedigt_registrier_nr, \
           gp.storniert_at  AS geschaedigt_storniert_at, \
           gpe.snap_name    AS geschaedigt_personal_name, \
           go.name          AS geschaedigt_organisation_name \
    FROM einsatz_schaden s \
    LEFT JOIN einsatz_person gp ON gp.id = s.geschaedigt_person_id \
                               AND gp.einsatz_id = s.einsatz_id \
    LEFT JOIN einsatz_personal gpe ON gpe.id = s.geschaedigt_personal_id \
                                  AND gpe.einsatz_id = s.einsatz_id \
    LEFT JOIN organisation     go  ON go.id  = s.geschaedigt_organisation_id";

#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub typ: &'a str,
    pub ausmass: &'a str,
    pub ort: &'a str,
    pub beschreibung: Option<&'a str>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub geschaedigt_person_id: Option<i64>,
    pub geschaedigt_kontakt: Option<&'a str>,
    pub geschaedigt_personal_id: Option<i64>,
    pub geschaedigt_organisation_id: Option<i64>,
}

#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub typ: Option<&'a str>,
    pub ausmass: Option<&'a str>,
    pub ort: Option<&'a str>,
    pub beschreibung: Option<&'a str>,
    /// `Some(Some(id))` = setzen, `Some(None)` = auf NULL, `None` = unverändert.
    pub geschaedigt_person_id: Option<Option<i64>>,
    pub geschaedigt_kontakt: Option<Option<&'a str>>,
    pub geschaedigt_personal_id: Option<Option<i64>>,
    pub geschaedigt_organisation_id: Option<Option<i64>>,
    pub uebergeben_an: Option<Option<&'a str>>,
    pub abschluss_grund: Option<Option<&'a str>>,
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
}

/// Filter einer Schadenliste (LFH-1075). Liste und Kennzahlen lesen dieselbe Bedingung
/// ([`filter_bedingung`]); `status` gilt nur für die Liste, die Kennzahlen zählen je Status.
#[derive(Debug, Default, Clone)]
pub struct SchadenFilter {
    pub status: Option<SchadenStatus>,
    /// Mehrere Werte: einer muss zutreffen. Leer = kein Filter.
    pub typen: Vec<SchadenTyp>,
    pub ausmasse: Vec<Ausmass>,
    /// `Some(true)` nur verortete, `Some(false)` nur unverortete.
    pub verortet: Option<bool>,
    pub geschaedigt_person_id: Option<i64>,
    pub inkl_storniert: bool,
    /// Suchbegriff (getrimmt, nicht leer): Teil von Nummer, Ort, Beschreibung oder Geschädigt.
    pub suche: Option<String>,
}

/// Sortierschlüssel der Modulseite (LFH-1075, D3). Gleichstand bricht immer die Nummer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortSpalte {
    Nr,
    Typ,
    Ausmass,
    Ort,
    Erfasst,
    Verortet,
}

impl SortSpalte {
    /// SQL-Ausdruck des Schlüssels. Typ über den Wire-Wert (dieselbe Folge wie die
    /// Beschriftung), Ausmaß über den Rang, Ort ohne Unterschied der Groß-/Kleinschreibung.
    fn ausdruck(self) -> &'static str {
        match self {
            SortSpalte::Nr => "s.registrier_nr",
            SortSpalte::Typ => "s.typ",
            SortSpalte::Ausmass => {
                "(CASE s.ausmass WHEN 'gering' THEN 0 WHEN 'mittel' THEN 1 \
                 WHEN 'gross' THEN 2 ELSE 3 END)"
            }
            SortSpalte::Ort => "s.ort COLLATE NOCASE",
            SortSpalte::Erfasst => "s.erfasst_at",
            SortSpalte::Verortet => {
                "(CASE WHEN s.lat IS NOT NULL AND s.lon IS NOT NULL THEN 1 ELSE 0 END)"
            }
        }
    }

    /// Ob der Cursorwert des Schlüssels eine Zahl ist (sonst Text).
    pub fn zahl(self) -> bool {
        matches!(
            self,
            SortSpalte::Nr | SortSpalte::Ausmass | SortSpalte::Verortet
        )
    }

    /// Cursorwert einer Zeile für diesen Schlüssel.
    pub fn wert(self, s: &SchadenAnzeige) -> CursorWert {
        match self {
            SortSpalte::Nr => CursorWert::Zahl(s.registrier_nr),
            SortSpalte::Typ => CursorWert::Text(s.typ.as_str().to_string()),
            SortSpalte::Ausmass => CursorWert::Zahl(match s.ausmass {
                Ausmass::Gering => 0,
                Ausmass::Mittel => 1,
                Ausmass::Gross => 2,
                Ausmass::Katastrophal => 3,
            }),
            SortSpalte::Ort => CursorWert::Text(s.ort.clone()),
            SortSpalte::Erfasst => CursorWert::Text(s.erfasst_at.clone()),
            SortSpalte::Verortet => CursorWert::Zahl(i64::from(s.lat.is_some() && s.lon.is_some())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CursorWert {
    Zahl(i64),
    Text(String),
}

/// Cursor: Schlüsselwert und Nummer des letzten gelesenen Schadens. Bei [`SortSpalte::Nr`]
/// ist `wert` `None`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchadenCursor {
    pub wert: Option<CursorWert>,
    pub nr: i64,
}

/// Eine angeforderte Seite der Schadenliste.
#[derive(Debug, Clone)]
pub struct SchadenSeite {
    pub spalte: SortSpalte,
    pub absteigend: bool,
    pub vor: Option<SchadenCursor>,
    pub limit: i64,
}

enum Bind {
    Text(String),
    Zahl(i64),
}

/// Maskiert `%`, `_` und `\` für `LIKE … ESCAPE '\'`.
fn like_muster(begriff: &str) -> String {
    let mut m = String::with_capacity(begriff.len() + 2);
    m.push('%');
    for c in begriff.chars() {
        if matches!(c, '%' | '_' | '\\') {
            m.push('\\');
        }
        m.push(c);
    }
    m.push('%');
    m
}

/// WHERE-Ergänzungen (nach `s.einsatz_id = ?`) samt Bindwerten in textueller Reihenfolge.
/// `mit_status = false` lässt den Statusfilter weg (Kennzahlen zählen je Status).
fn filter_bedingung(f: &SchadenFilter, mit_status: bool) -> (String, Vec<Bind>) {
    let mut sql = String::new();
    let mut werte = Vec::new();
    if !f.inkl_storniert {
        sql.push_str(" AND s.storniert_at IS NULL");
    }
    if let (true, Some(st)) = (mit_status, f.status) {
        sql.push_str(" AND s.status = ?");
        werte.push(Bind::Text(st.as_str().to_string()));
    }
    if !f.typen.is_empty() {
        sql.push_str(" AND s.typ IN (");
        sql.push_str(&vec!["?"; f.typen.len()].join(", "));
        sql.push(')');
        werte.extend(f.typen.iter().map(|t| Bind::Text(t.as_str().to_string())));
    }
    if !f.ausmasse.is_empty() {
        sql.push_str(" AND s.ausmass IN (");
        sql.push_str(&vec!["?"; f.ausmasse.len()].join(", "));
        sql.push(')');
        werte.extend(
            f.ausmasse
                .iter()
                .map(|a| Bind::Text(a.as_str().to_string())),
        );
    }
    match f.verortet {
        Some(true) => sql.push_str(" AND s.lat IS NOT NULL AND s.lon IS NOT NULL"),
        Some(false) => sql.push_str(" AND (s.lat IS NULL OR s.lon IS NULL)"),
        None => {}
    }
    if let Some(pid) = f.geschaedigt_person_id {
        sql.push_str(" AND s.geschaedigt_person_id = ?");
        werte.push(Bind::Zahl(pid));
    }
    if let Some(begriff) = f.suche.as_deref() {
        // Dieselben Felder wie die Suche der Modulseite vorher im Client (`suchText` der
        // Spalten Reg.-Nr., Ort, Geschädigt): Nummer als „S-007“, Ort, Beschreibung, Name des
        // Personals oder der Organisation, sonst der Kontakt.
        sql.push_str(
            " AND (printf('S-%03d', s.registrier_nr) LIKE ? ESCAPE '\\' \
             OR s.ort LIKE ? ESCAPE '\\' OR s.beschreibung LIKE ? ESCAPE '\\' \
             OR COALESCE(gpe.snap_name, go.name, s.geschaedigt_kontakt, '') LIKE ? ESCAPE '\\')",
        );
        let m = like_muster(begriff);
        // Vier Platzhalter, vier Bindungen (positionell, wie alle übrigen).
        for _ in 0..4 {
            werte.push(Bind::Text(m.clone()));
        }
    }
    (sql, werte)
}

/// Listet Schäden eines Einsatzes. Ohne `seite` vollständig nach Nummer absteigend (Druck,
/// Einsatzbericht, Lage-Snapshot); mit `seite` höchstens `limit` Zeilen ab dem Cursor
/// (LFH-1075, D1/D3).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &SchadenFilter,
    seite: Option<&SchadenSeite>,
) -> Result<Vec<SchadenAnzeige>, AppError> {
    let (bedingung, mut werte) = filter_bedingung(filter, true);
    let mut q = format!("{SELECT_ALLE} WHERE s.einsatz_id = ?{bedingung}");
    match seite {
        None => q.push_str(" ORDER BY s.registrier_nr DESC"),
        Some(seite) => {
            let schluessel = seite.spalte.ausdruck();
            let (vgl, richtung) = if seite.absteigend {
                ("<", "DESC")
            } else {
                (">", "ASC")
            };
            if let Some(vor) = &seite.vor {
                match &vor.wert {
                    Some(w) if seite.spalte != SortSpalte::Nr => {
                        q.push_str(&format!(
                            " AND ({schluessel} {vgl} ? OR ({schluessel} = ? \
                             AND s.registrier_nr {vgl} ?))"
                        ));
                        for _ in 0..2 {
                            werte.push(match w {
                                CursorWert::Zahl(z) => Bind::Zahl(*z),
                                CursorWert::Text(t) => Bind::Text(t.clone()),
                            });
                        }
                    }
                    _ => q.push_str(&format!(" AND s.registrier_nr {vgl} ?")),
                }
                werte.push(Bind::Zahl(vor.nr));
            }
            if seite.spalte == SortSpalte::Nr {
                q.push_str(&format!(" ORDER BY s.registrier_nr {richtung} LIMIT ?"));
            } else {
                q.push_str(&format!(
                    " ORDER BY {schluessel} {richtung}, s.registrier_nr {richtung} LIMIT ?"
                ));
            }
            werte.push(Bind::Zahl(seite.limit));
        }
    }
    let mut query = sqlx::query_as::<_, SchadenAnzeige>(sqlx::AssertSqlSafe(&*q)).bind(einsatz_id);
    for w in werte {
        query = match w {
            Bind::Text(t) => query.bind(t),
            Bind::Zahl(z) => query.bind(z),
        };
    }
    Ok(query.fetch_all(pool).await?)
}

/// Zahl der Schäden gesamt und je Status zum Filter (ohne dessen Status), in EINER
/// gruppierten Abfrage über dieselbe Bedingung wie [`liste`] (LFH-1075, D4).
pub async fn kennzahlen(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &SchadenFilter,
) -> Result<SchadenKennzahlen, AppError> {
    let (bedingung, werte) = filter_bedingung(filter, false);
    let q = format!(
        "SELECT s.status, COUNT(*) FROM einsatz_schaden s \
         LEFT JOIN einsatz_personal gpe ON gpe.id = s.geschaedigt_personal_id \
                                        AND gpe.einsatz_id = s.einsatz_id \
         LEFT JOIN organisation go ON go.id = s.geschaedigt_organisation_id \
         WHERE s.einsatz_id = ?{bedingung} GROUP BY s.status"
    );
    let mut query = sqlx::query_as::<_, (String, i64)>(sqlx::AssertSqlSafe(&*q)).bind(einsatz_id);
    for w in werte {
        query = match w {
            Bind::Text(t) => query.bind(t),
            Bind::Zahl(z) => query.bind(z),
        };
    }
    let mut k = SchadenKennzahlen::default();
    for (status, n) in query.fetch_all(pool).await? {
        k.gesamt += n;
        match SchadenStatus::parse(&status) {
            Some(SchadenStatus::Offen) => k.offen = n,
            Some(SchadenStatus::Uebergeben) => k.uebergeben = n,
            Some(SchadenStatus::Abgeschlossen) => k.abgeschlossen = n,
            None => {}
        }
    }
    Ok(k)
}

/// Schadenauswahl für Auswahlfelder und Sprungpalette (LFH-1075, D5): alle nicht stornierten,
/// nach Nummer absteigend, ohne Beschreibung und ohne Angaben zu Geschädigten.
pub async fn auswahl(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<SchadenAuswahl>, AppError> {
    Ok(sqlx::query_as::<_, SchadenAuswahl>(
        "SELECT id, registrier_nr, status, typ, ausmass, ort, \
                (geschaedigt_person_id IS NULL AND geschaedigt_personal_id IS NULL \
                 AND geschaedigt_organisation_id IS NULL AND geschaedigt_kontakt IS NULL) AS frei \
         FROM einsatz_schaden WHERE einsatz_id = ? AND storniert_at IS NULL \
         ORDER BY registrier_nr DESC",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

/// Marker aller nicht stornierten Schäden eines Einsatzes, neueste Registriernummer zuerst
/// (LFH-931). Ohne Joins und Freitexte.
pub async fn marker(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<SchadenMarker>, AppError> {
    Ok(sqlx::query_as::<_, SchadenMarker>(
        "SELECT id, registrier_nr, status, typ, ausmass, lat, lon FROM einsatz_schaden \
         WHERE einsatz_id = ? AND storniert_at IS NULL ORDER BY registrier_nr DESC",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
) -> Result<SchadenAnzeige, AppError> {
    sqlx::query_as::<_, SchadenAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE s.id = ? AND s.einsatz_id = ?"
    )))
    .bind(schaden_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Wie [`laden`], aber auf einer offenen Connection/Transaktion (für den In-Tx-Reload
/// beim atomaren Anlegen — liefert die frische Anzeige samt geparster Felder für ETB-Text
/// und Response in EINER Tx).
pub async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    schaden_id: i64,
) -> Result<SchadenAnzeige, AppError> {
    sqlx::query_as::<_, SchadenAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE s.id = ? AND s.einsatz_id = ?"
    )))
    .bind(schaden_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt einen Schaden an INNERHALB einer offenen Transaktion (F06/LFH-244, Tier-A:
/// atomar mit dem System-ETB-Eintrag). Liefert `(id, registrier_nr)` — die registrier_nr
/// wird für die ETB-Spur gebraucht und ist erst nach dem INSERT (COALESCE(MAX)+1) bekannt.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<(i64, i64), AppError> {
    let row: (i64, i64) = sqlx::query_as(
        "INSERT INTO einsatz_schaden \
            (einsatz_id, registrier_nr, status, typ, ausmass, ort, beschreibung, \
             geschaedigt_person_id, geschaedigt_kontakt, geschaedigt_personal_id, \
             geschaedigt_organisation_id, erfasst_von, geaendert_von, lat, lon) \
         SELECT ?1, COALESCE(MAX(registrier_nr), 0) + 1, 'offen', ?2, ?3, ?4, \
                COALESCE(?5, ''), ?6, ?7, ?9, ?10, ?8, ?8, ?11, ?12 \
         FROM einsatz_schaden WHERE einsatz_id = ?1 \
         RETURNING id, registrier_nr",
    )
    .bind(einsatz_id)
    .bind(daten.typ)
    .bind(daten.ausmass)
    .bind(daten.ort)
    .bind(daten.beschreibung)
    .bind(daten.geschaedigt_person_id)
    .bind(daten.geschaedigt_kontakt)
    .bind(erfasser_id)
    .bind(daten.geschaedigt_personal_id)
    .bind(daten.geschaedigt_organisation_id)
    .bind(daten.lat)
    .bind(daten.lon)
    .fetch_one(&mut *conn)
    .await?;

    Ok(row)
}

/// Pool-Wrapper: legt an (eigene Tx) und lädt die Anzeige.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<SchadenAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    let (id, _) = anlegen_tx(&mut conn, einsatz_id, erfasser_id, daten).await?;
    drop(conn);
    laden(pool, einsatz_id, id).await
}

/// Aktualisiert Stammfelder. Setzt `geaendert_at`/`geaendert_von`. `NotFound`, falls nicht
/// zum Einsatz.
///
/// Optimistisches Lock (LFH-300/F10, Muster aus `person::repo::aktualisiere`): trägt der
/// Aufrufer `erwartet_geaendert_at` (den beim Laden gelesenen Stand), schreibt das UPDATE nur,
/// solange `geaendert_at` unverändert ist — sonst `Conflict` (409) statt eines stillen
/// Last-write-wins-Overwrites. `None` = bewusstes Overwrite (Escape-Hatch des Konfliktdialogs,
/// des Lagekarten-Drags und der Geschädigt-Zuordnung aus der Personen-Detailseite). Bei 0
/// betroffenen Zeilen wird 404 (Zeile fehlt) von 409 (Zeile existiert, Stand veraltet)
/// unterschieden.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    geaendert_von: i64,
    erwartet_geaendert_at: Option<&str>,
    daten: PatchDaten<'_>,
) -> Result<SchadenAnzeige, AppError> {
    let mut sql = String::from(
        "UPDATE einsatz_schaden SET \
            typ = COALESCE(?, typ), \
            ausmass = COALESCE(?, ausmass), \
            ort = COALESCE(?, ort), \
            beschreibung = COALESCE(?, beschreibung), \
            geschaedigt_person_id = CASE WHEN ? THEN ? ELSE geschaedigt_person_id END, \
            geschaedigt_kontakt   = CASE WHEN ? THEN ? ELSE geschaedigt_kontakt END, \
            geschaedigt_personal_id = CASE WHEN ? THEN ? ELSE geschaedigt_personal_id END, \
            geschaedigt_organisation_id = CASE WHEN ? THEN ? ELSE geschaedigt_organisation_id END, \
            uebergeben_an   = CASE WHEN ? THEN ? ELSE uebergeben_an END, \
            abschluss_grund = CASE WHEN ? THEN ? ELSE abschluss_grund END, \
            lat = CASE WHEN ? THEN ? ELSE lat END, \
            lon = CASE WHEN ? THEN ? ELSE lon END, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    );
    if erwartet_geaendert_at.is_some() {
        sql.push_str(" AND geaendert_at = ?");
    }
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(daten.typ)
        .bind(daten.ausmass)
        .bind(daten.ort)
        .bind(daten.beschreibung)
        .bind(daten.geschaedigt_person_id.is_some())
        .bind(daten.geschaedigt_person_id.flatten())
        .bind(daten.geschaedigt_kontakt.is_some())
        .bind(daten.geschaedigt_kontakt.flatten())
        .bind(daten.geschaedigt_personal_id.is_some())
        .bind(daten.geschaedigt_personal_id.flatten())
        .bind(daten.geschaedigt_organisation_id.is_some())
        .bind(daten.geschaedigt_organisation_id.flatten())
        .bind(daten.uebergeben_an.is_some())
        .bind(daten.uebergeben_an.flatten())
        .bind(daten.abschluss_grund.is_some())
        .bind(daten.abschluss_grund.flatten())
        .bind(daten.lat.is_some())
        .bind(daten.lat.flatten())
        .bind(daten.lon.is_some())
        .bind(daten.lon.flatten())
        .bind(geaendert_von)
        .bind(schaden_id)
        .bind(einsatz_id);
    if let Some(stand) = erwartet_geaendert_at {
        q = q.bind(stand);
    }
    let betroffen = q.execute(pool).await?.rows_affected();
    if betroffen == 0 {
        // Mit Guard: existiert die Zeile → veralteter Stand (409), sonst fehlt sie (404).
        if erwartet_geaendert_at.is_some() {
            let existiert: Option<i64> =
                sqlx::query_scalar("SELECT 1 FROM einsatz_schaden WHERE id = ? AND einsatz_id = ?")
                    .bind(schaden_id)
                    .bind(einsatz_id)
                    .fetch_optional(pool)
                    .await?;
            if existiert.is_some() {
                return Err(AppError::Conflict(
                    "Der Datensatz wurde zwischenzeitlich geändert. Bitte neu laden.".into(),
                ));
            }
        }
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, schaden_id).await
}

/// Setzt den Status auf `uebergeben` INNERHALB einer offenen Transaktion (F06/LFH-244,
/// Tier-A: atomar mit dem System-ETB-Eintrag). Fremd → `NotFound`, schon storniert →
/// `Conflict`.
pub async fn uebergebe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    schaden_id: i64,
    uebergeben_an: &str,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_schaden SET status = 'uebergeben', uebergeben_an = ?, \
            uebergeben_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(uebergeben_an)
    .bind(geaendert_von)
    .bind(schaden_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Schließt einen Schaden ab INNERHALB einer offenen Transaktion (F06/LFH-244, Tier-A:
/// atomar mit dem System-ETB-Eintrag). `NotFound`, falls nicht zum Einsatz.
pub async fn schliesse_ab_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    schaden_id: i64,
    abschluss_grund: &str,
    notiz: Option<&str>,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = if let Some(notiz) = notiz {
        sqlx::query(
            "UPDATE einsatz_schaden SET status = 'abgeschlossen', abschluss_grund = ?, \
                abschluss_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
                beschreibung = beschreibung || (CASE WHEN beschreibung = '' THEN '' ELSE char(10) END) \
                    || '[' || strftime('%Y-%m-%d %H:%M:%S','now') || '] ' || ?, \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(abschluss_grund)
        .bind(notiz)
        .bind(geaendert_von)
        .bind(schaden_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE einsatz_schaden SET status = 'abgeschlossen', abschluss_grund = ?, \
                abschluss_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(abschluss_grund)
        .bind(geaendert_von)
        .bind(schaden_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?
        .rows_affected()
    };
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Storniert einen Schaden (Soft-Delete) INNERHALB einer offenen Transaktion (F06/LFH-244,
/// Tier-A: atomar mit dem System-ETB-Eintrag). Fremd → `NotFound`, storniert → `Conflict`.
pub async fn storniere_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    schaden_id: i64,
    storniert_von: i64,
) -> Result<(), AppError> {
    crate::storno::storniere(
        conn,
        "einsatz_schaden",
        "einsatz_id",
        einsatz_id,
        schaden_id,
        crate::storno::Vermerk::GeaendertUndStorniert(storniert_von),
        Some("Schaden ist bereits storniert"),
    )
    .await
}

/// Prüft, ob eine Einsatzkraft (einsatz_personal) zu diesem Einsatz gehört
/// (Org-Isolation der Geschädigt-FK). Liefert `false` für fremde/unbekannte ids.
pub async fn personal_im_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    ep_id: i64,
) -> Result<bool, AppError> {
    let vorhanden: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einsatz_personal WHERE id = ? AND einsatz_id = ?")
            .bind(ep_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(vorhanden.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use crate::schaden::{AbschlussGrund, SchadenStatus};

    async fn setup(pool: &sqlx::SqlitePool) -> (i64, i64) {
        // Spalten gemäß Migr. 0002/0003: benutzer.org_id, system_rolle ∈ {admin,keiner};
        // einsatz.org_id NOT NULL, KEIN erstellt_von.
        sqlx::query("INSERT INTO organisation (name) VALUES ('O')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle) VALUES (1,'A','a','x','keiner','keine') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status) VALUES (1,'L','aktiv') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    fn minimal<'a>() -> NeueDaten<'a> {
        NeueDaten {
            typ: "sachschaden",
            ausmass: "gering",
            ort: "Hauptstr. 1",
            beschreibung: None,
            lat: None,
            lon: None,
            geschaedigt_person_id: None,
            geschaedigt_kontakt: None,
            geschaedigt_personal_id: None,
            geschaedigt_organisation_id: None,
        }
    }

    #[tokio::test]
    async fn anlegen_vergibt_fortlaufende_nr_und_status_offen() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s1 = anlegen(&pool, e, b, minimal()).await.unwrap();
        let s2 = anlegen(&pool, e, b, minimal()).await.unwrap();
        assert_eq!(s1.registrier_nr, 1);
        assert_eq!(s2.registrier_nr, 2);
        assert_eq!(s1.status, SchadenStatus::Offen);
    }

    #[tokio::test]
    async fn uebergebe_setzt_status_und_zeit() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, minimal()).await.unwrap();
        uebergebe_tx(
            &mut *pool.acquire().await.unwrap(),
            e,
            s.id,
            "Stadtwerke",
            b,
        )
        .await
        .unwrap();
        let neu = laden(&pool, e, s.id).await.unwrap();
        assert_eq!(neu.status, SchadenStatus::Uebergeben);
        assert_eq!(neu.uebergeben_an.as_deref(), Some("Stadtwerke"));
        assert!(neu.uebergeben_at.is_some());
    }

    #[tokio::test]
    async fn schliesse_ab_haengt_notiz_an_beschreibung() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(
            &pool,
            e,
            b,
            NeueDaten {
                beschreibung: Some("Erstbefund"),
                ..minimal()
            },
        )
        .await
        .unwrap();
        schliesse_ab_tx(
            &mut *pool.acquire().await.unwrap(),
            e,
            s.id,
            "behoben",
            Some("vor Ort erledigt"),
            b,
        )
        .await
        .unwrap();
        let neu = laden(&pool, e, s.id).await.unwrap();
        assert_eq!(neu.status, SchadenStatus::Abgeschlossen);
        assert_eq!(neu.abschluss_grund, Some(AbschlussGrund::Behoben));
        assert!(neu.abschluss_at.is_some());
        assert!(neu.beschreibung.contains("Erstbefund"));
        assert!(
            neu.beschreibung.contains("vor Ort erledigt"),
            "Notiz angehängt"
        );
    }

    #[tokio::test]
    async fn storniere_setzt_at_und_von() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, minimal()).await.unwrap();
        storniere_tx(&mut *pool.acquire().await.unwrap(), e, s.id, b)
            .await
            .unwrap();
        let neu = laden(&pool, e, s.id).await.unwrap();
        assert!(neu.storniert_at.is_some());
        assert_eq!(neu.storniert_von, Some(b));
    }

    #[tokio::test]
    async fn liste_blendet_storniert_aus_default_und_zeigt_mit_flag() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, minimal()).await.unwrap();
        storniere_tx(&mut *pool.acquire().await.unwrap(), e, s.id, b)
            .await
            .unwrap();
        let ohne = liste(&pool, e, &SchadenFilter::default(), None)
            .await
            .unwrap();
        assert_eq!(ohne.len(), 0, "storniert nicht in Default-Liste");
        let mit = liste(
            &pool,
            e,
            &SchadenFilter {
                inkl_storniert: true,
                ..Default::default()
            },
            None,
        )
        .await
        .unwrap();
        assert_eq!(mit.len(), 1, "mit inkl_storniert sichtbar");
    }

    #[tokio::test]
    async fn liste_filtert_nach_status_typ_ausmass() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(
            &pool,
            e,
            b,
            NeueDaten {
                typ: "umweltschaden",
                ausmass: "gross",
                ..minimal()
            },
        )
        .await
        .unwrap();
        anlegen(&pool, e, b, minimal()).await.unwrap();
        let nur_umwelt = liste(
            &pool,
            e,
            &SchadenFilter {
                typen: vec![SchadenTyp::Umweltschaden],
                ..Default::default()
            },
            None,
        )
        .await
        .unwrap();
        assert_eq!(nur_umwelt.len(), 1);
        let nur_gross = liste(
            &pool,
            e,
            &SchadenFilter {
                ausmasse: vec![Ausmass::Gross],
                ..Default::default()
            },
            None,
        )
        .await
        .unwrap();
        assert_eq!(nur_gross.len(), 1);
    }

    #[tokio::test]
    async fn laden_fremder_einsatz_ist_notfound() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, minimal()).await.unwrap();
        let res = laden(&pool, 999, s.id).await;
        assert!(matches!(res, Err(AppError::NotFound)));
    }

    #[tokio::test]
    async fn aktualisiere_geschaedigt_toggle() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(
            &pool,
            e,
            b,
            NeueDaten {
                geschaedigt_kontakt: Some("Herr Meier"),
                ..minimal()
            },
        )
        .await
        .unwrap();
        aktualisiere(
            &pool,
            e,
            s.id,
            b,
            None,
            PatchDaten {
                geschaedigt_kontakt: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let neu = laden(&pool, e, s.id).await.unwrap();
        assert!(neu.geschaedigt_kontakt.is_none());
    }

    #[tokio::test]
    async fn anlegen_mit_geschaedigt_personal_zeigt_snap_name() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Einsatzkraft A') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let s = anlegen(
            &pool,
            e,
            b,
            NeueDaten {
                geschaedigt_personal_id: Some(ep),
                ..minimal()
            },
        )
        .await
        .unwrap();
        assert_eq!(s.geschaedigt_personal_id, Some(ep));
        assert_eq!(
            s.geschaedigt_personal_name.as_deref(),
            Some("Einsatzkraft A")
        );
        assert!(s.geschaedigt_organisation_name.is_none());
    }

    #[tokio::test]
    async fn aktualisiere_setzt_geschaedigt_personal_und_loescht_kontakt() {
        // Deckt die neuen CASE-Toggles + Bind-Reihenfolge in `aktualisiere` ab:
        // von Freitext-Kontakt auf eine Einsatzkraft umstellen (Kontakt → NULL).
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Kraft B') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let s = anlegen(
            &pool,
            e,
            b,
            NeueDaten {
                geschaedigt_kontakt: Some("Stadtwerke"),
                ..minimal()
            },
        )
        .await
        .unwrap();
        aktualisiere(
            &pool,
            e,
            s.id,
            b,
            None,
            PatchDaten {
                geschaedigt_kontakt: Some(None),
                geschaedigt_personal_id: Some(Some(ep)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let neu = laden(&pool, e, s.id).await.unwrap();
        assert!(neu.geschaedigt_kontakt.is_none());
        assert_eq!(neu.geschaedigt_personal_id, Some(ep));
        assert_eq!(neu.geschaedigt_personal_name.as_deref(), Some("Kraft B"));
    }

    #[tokio::test]
    async fn anlegen_mit_geschaedigt_organisation_zeigt_org_name() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        // setup legt organisation id 1 namens 'O' an.
        let s = anlegen(
            &pool,
            e,
            b,
            NeueDaten {
                geschaedigt_organisation_id: Some(1),
                ..minimal()
            },
        )
        .await
        .unwrap();
        assert_eq!(s.geschaedigt_organisation_id, Some(1));
        assert_eq!(s.geschaedigt_organisation_name.as_deref(), Some("O"));
        assert!(s.geschaedigt_personal_name.is_none());
    }

    /// LFH-300/F10: optimistisches Lock über `geaendert_at`. Deterministische Zeitstempel
    /// (nicht `now`) vermeiden das 1s-Aliasing im Test.
    #[tokio::test]
    async fn aktualisiere_optimistisches_lock_ueber_geaendert_at() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, minimal()).await.unwrap();
        // Bekannten, klar von „jetzt" verschiedenen Stand setzen.
        sqlx::query("UPDATE einsatz_schaden SET geaendert_at = '2000-01-01 00:00:00' WHERE id = ?")
            .bind(s.id)
            .execute(&pool)
            .await
            .unwrap();
        let stand = "2000-01-01 00:00:00";

        // Korrekter Stand → Erfolg (und bumpt geaendert_at auf „jetzt").
        aktualisiere(
            &pool,
            e,
            s.id,
            b,
            Some(stand),
            PatchDaten {
                beschreibung: Some("A"),
                ..Default::default()
            },
        )
        .await
        .expect("korrekter Stand muss durchgehen");

        // Derselbe (jetzt veraltete) Stand → Conflict, kein Overwrite.
        let err = aktualisiere(
            &pool,
            e,
            s.id,
            b,
            Some(stand),
            PatchDaten {
                beschreibung: Some("B"),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "veralteter Stand muss 409 (Conflict) sein, war: {err:?}"
        );
        assert_eq!(
            laden(&pool, e, s.id).await.unwrap().beschreibung.as_str(),
            "A",
            "Konflikt darf den Overwrite nicht durchlassen"
        );

        // Ohne Stand (None) = bewusstes Overwrite (Lagekarten-Drag, Konfliktdialog) → Erfolg.
        aktualisiere(
            &pool,
            e,
            s.id,
            b,
            None,
            PatchDaten {
                beschreibung: Some("C"),
                ..Default::default()
            },
        )
        .await
        .expect("None = bewusstes Overwrite");
        assert_eq!(
            laden(&pool, e, s.id).await.unwrap().beschreibung.as_str(),
            "C"
        );

        // Guard gesetzt, Zeile existiert nicht → 404 (nicht 409).
        let err = aktualisiere(
            &pool,
            e,
            999_999,
            b,
            Some(stand),
            PatchDaten {
                beschreibung: Some("D"),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, AppError::NotFound),
            "fehlende Zeile bleibt 404, war: {err:?}"
        );
    }
}
