use super::qualifikation_repo;
use super::{status_repo, EinsatzPersonalAnzeige, FuehrungskraftKarte};
use crate::error::AppError;
use crate::katalog::{StatusKategorie, DIENSTSTATUS_IN_DIENST, KATEGORIE_GEBUNDEN};
use sqlx::{SqliteConnection, SqlitePool};

/// SELECT mit aufgelöster Live-Identität (LEFT JOIN personal), Live-Funktion (geordnete
/// Subquery über aktive Qualifikationen, identisch zu `qualifikation_repo::funktion_text`) und
/// Status. Live oder Snapshot wählt `zu_anzeige`. `ist_demo` liest die Demo-Marke der
/// Stamm-Person live (LFH-733, design.md D2); ad-hoc findet keine Marke.
const SELECT_AUFGELOEST: &str = "\
    SELECT ep.id, ep.einsatz_id, ep.personal_id, ep.einheit_id, ep.fahrzeug_id, ep.uhs_id, \
           ep.status_id, \
           ep.staerke_position AS ep_staerke_position, \
           ep.snap_name, ep.snap_funktion, ep.snap_traegerorganisation, \
           ep.bemerkung, ep.einsatzfunktion, ep.disponiert_at, ep.disponiert_von, \
           ep.beendet_at, ep.beendet_von, ep.beendet_als, \
           p.name AS live_name, p.traegerorganisation AS live_traegerorganisation, \
           p.dienststatus AS live_dienststatus, p.staerke_position AS live_staerke_position, \
           (SELECT GROUP_CONCAT(label, ', ') FROM ( \
                SELECT q.label FROM personal_qualifikation pq \
                JOIN qualifikation q ON q.id = pq.qualifikation_id \
                WHERE pq.personal_id = ep.personal_id AND q.aktiv = 1 \
                ORDER BY q.sortier, q.id \
           )) AS live_funktion, \
           s.label AS status_label, s.kategorie AS status_kategorie, s.farbe AS status_farbe, \
           EXISTS(SELECT 1 FROM demo_herkunft dh \
                  WHERE dh.tabelle = 'personal' AND dh.datensatz_id = ep.personal_id) AS ist_demo \
    FROM einsatz_personal ep \
    LEFT JOIN personal p ON p.id = ep.personal_id \
    LEFT JOIN personal_status s ON s.id = ep.status_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    personal_id: Option<i64>,
    einheit_id: Option<i64>,
    fahrzeug_id: Option<i64>,
    uhs_id: Option<i64>,
    status_id: Option<i64>,
    ep_staerke_position: Option<String>,
    snap_name: String,
    snap_funktion: Option<String>,
    snap_traegerorganisation: Option<String>,
    bemerkung: Option<String>,
    einsatzfunktion: Option<String>,
    disponiert_at: String,
    disponiert_von: Option<i64>,
    beendet_at: Option<String>,
    beendet_von: Option<i64>,
    beendet_als: Option<String>,
    live_name: Option<String>,
    live_traegerorganisation: Option<String>,
    live_dienststatus: Option<String>,
    live_staerke_position: Option<String>,
    live_funktion: Option<String>,
    status_label: Option<String>,
    status_kategorie: Option<StatusKategorie>,
    status_farbe: Option<String>,
    /// LFH-733: Demo-Marke des Stamm-Datensatzes (D2), bei Ad-hoc ohne Treffer und damit `false`.
    ist_demo: bool,
}

/// Auflösungsregel: Identität/Funktion live nur mit Stamm-Bezug, aktivem Einsatz UND Person in
/// Dienst, sonst Snapshot. Die Stärke-Position wird IMMER live aufgelöst (Dispo-Override vor
/// Stamm-Default).
fn zu_anzeige(row: Row, einsatz_aktiv: bool) -> EinsatzPersonalAnzeige {
    let live = row.personal_id.is_some()
        && einsatz_aktiv
        && row.live_dienststatus.as_deref() == Some(DIENSTSTATUS_IN_DIENST);

    let (name, funktion, traeger) = if live {
        (
            row.live_name
                .clone()
                .unwrap_or_else(|| row.snap_name.clone()),
            row.live_funktion,
            row.live_traegerorganisation,
        )
    } else {
        (
            row.snap_name,
            row.snap_funktion,
            row.snap_traegerorganisation,
        )
    };

    EinsatzPersonalAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        personal_id: row.personal_id,
        einheit_id: row.einheit_id,
        fahrzeug_id: row.fahrzeug_id,
        uhs_id: row.uhs_id,
        ist_adhoc: row.personal_id.is_none(),
        name,
        funktion,
        traegerorganisation: traeger,
        staerke_position: row.ep_staerke_position.or(row.live_staerke_position),
        status_id: row.status_id,
        status_label: row.status_label,
        status_kategorie: row.status_kategorie,
        status_farbe: row.status_farbe,
        bemerkung: row.bemerkung,
        einsatzfunktion: row.einsatzfunktion,
        disponiert_at: row.disponiert_at,
        disponiert_von: row.disponiert_von,
        ist_demo: row.ist_demo,
        beendet_at: row.beendet_at,
        beendet_von: row.beendet_von,
        beendet_als: row.beendet_als,
    }
}

/// Daten für eine Ad-hoc-externe Person (kein Stamm-Bezug); bereits getrimmt/validiert.
#[derive(Debug)]
pub struct AdhocDaten<'a> {
    pub name: &'a str,
    pub funktion: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub staerke_position: Option<&'a str>,
}

/// Aktives Personal eines Einsatzes (aufgelöst), sortiert nach Dispo-Zeit. Entlassene und
/// stornierte Kräfte fehlen (LLH-1079, Spec `kraefte-entlassung`).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzPersonalAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ep.einsatz_id = ? AND ep.beendet_at IS NULL \
         ORDER BY ep.disponiert_at, ep.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| zu_anzeige(r, einsatz_aktiv))
        .collect())
}

/// Entlassenes Personal eines Einsatzes (aufgelöst), zuletzt entlassene zuerst — der Nachweis
/// hinter `GET …/personal?entlassene=1` (LLH-1079). Stornierte erscheinen nie.
pub async fn list_entlassene(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzPersonalAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ep.einsatz_id = ? AND ep.beendet_als = 'entlassen' \
         ORDER BY ep.beendet_at DESC, ep.id DESC"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| zu_anzeige(r, einsatz_aktiv))
        .collect())
}

/// Aktives Personal einer UHS (`Some`) oder ohne UHS (`None`), aufgelöst und nach Namen
/// sortiert (LFH-1045, Spec `uhs-staerke`).
pub async fn liste_je_uhs(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: Option<i64>,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzPersonalAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ep.einsatz_id = ?1 AND ep.uhs_id IS ?2 \
         AND ep.beendet_at IS NULL ORDER BY ep.id"
    )))
    .bind(einsatz_id)
    .bind(uhs_id)
    .fetch_all(pool)
    .await?;
    let mut liste: Vec<_> = rows
        .into_iter()
        .map(|r| zu_anzeige(r, einsatz_aktiv))
        .collect();
    liste.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(liste)
}

/// Lädt eine Dispositionszeile (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn load_anzeige(
    pool: &SqlitePool,
    einsatz_id: i64,
    ep_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzPersonalAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ep.id = ? AND ep.einsatz_id = ?"
    )))
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Wie [`load_anzeige`], auf einer offenen Verbindung — für ETB-Text und Response aus EINER
/// Transaktion beim atomaren Status-Update.
pub async fn load_anzeige_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzPersonalAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_AUFGELOEST} WHERE ep.id = ? AND ep.einsatz_id = ?"
    )))
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Ergebnis einer Disposition: die Zeile und ob sie eine beendete Zeile derselben Stamm-Person
/// wieder aufgenommen hat (LLH-1079, design.md D7). Der Aufrufer wählt danach den ETB-Text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Disponiert {
    pub id: i64,
    pub reaktiviert: bool,
}

/// Disponiert eine Stamm-Person: prüft Org und Dienststatus, friert den Identitäts-Snapshot ein
/// (`snap_funktion` aus den aktiven Qualifikationen) und setzt den ersten `gebunden`-Status.
/// `staerke_position` ist der optionale Override. `NotFound` bei fremder/unbekannter Person,
/// `UnprocessableEntity` bei außer Dienst, `Conflict` bei Doppel-Disposition. Eine entlassene oder
/// stornierte Zeile derselben Person wird wieder aufgenommen statt abgelehnt (LLH-1079, D7):
/// `UNIQUE(einsatz_id, personal_id)` lässt keine zweite Zeile zu.
///
/// Pool-Hülle um [`disponieren_stamm_tx`] ohne eigene Transaktion.
pub async fn disponieren_stamm(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    personal_id: i64,
    staerke_position: Option<&str>,
    disponiert_von: i64,
) -> Result<Disponiert, AppError> {
    let mut conn = pool.acquire().await?;
    disponieren_stamm_tx(
        &mut conn,
        einsatz_id,
        org_id,
        personal_id,
        staerke_position,
        disponiert_von,
    )
    .await
}

/// Disponiert eine Stamm-Person auf einer offenen Verbindung (Demo-Import in EINER
/// Transaktion). Person, Funktionstext und Status werden auf derselben Verbindung gelesen und
/// sehen so auch gerade angelegte Stammdaten. Öffnet und committet nichts; Fehler wie
/// [`disponieren_stamm`].
pub async fn disponieren_stamm_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    personal_id: i64,
    staerke_position: Option<&str>,
    disponiert_von: i64,
) -> Result<Disponiert, AppError> {
    let bestehend: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT id, beendet_at FROM einsatz_personal WHERE einsatz_id = ? AND personal_id = ?",
    )
    .bind(einsatz_id)
    .bind(personal_id)
    .fetch_optional(&mut *conn)
    .await?;
    match bestehend {
        Some((_, None)) => {
            return Err(AppError::Conflict(
                "Person ist bereits in diesem Einsatz disponiert".into(),
            ))
        }
        Some((id, Some(_))) => {
            reaktivieren_tx(
                conn,
                einsatz_id,
                org_id,
                id,
                Some(staerke_position),
                disponiert_von,
            )
            .await?;
            return Ok(Disponiert {
                id,
                reaktiviert: true,
            });
        }
        None => {}
    }
    let (name, traeger) = stamm_snapshot_tx(conn, org_id, personal_id).await?;
    let funktion = qualifikation_repo::funktion_text(&mut *conn, personal_id).await?;
    let status_id =
        status_repo::erster_der_kategorie(&mut *conn, org_id, KATEGORIE_GEBUNDEN).await?;

    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_personal \
            (einsatz_id, personal_id, status_id, staerke_position, snap_name, snap_funktion, \
             snap_traegerorganisation, disponiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(personal_id)
    .bind(status_id)
    .bind(staerke_position)
    .bind(&name)
    .bind(&funktion)
    .bind(&traeger)
    .bind(disponiert_von)
    .fetch_one(&mut *conn)
    .await;

    match ergebnis {
        Ok(id) => Ok(Disponiert {
            id,
            reaktiviert: false,
        }),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Person ist bereits in diesem Einsatz disponiert".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Name und Trägerorganisation einer Stamm-Person der Org; `NotFound` bei fremder/unbekannter,
/// `UnprocessableEntity` bei außer Dienst.
async fn stamm_snapshot_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    personal_id: i64,
) -> Result<(String, Option<String>), AppError> {
    let snap = sqlx::query_as::<_, (String, Option<String>, String)>(
        "SELECT name, traegerorganisation, dienststatus FROM personal WHERE id = ? AND org_id = ?",
    )
    .bind(personal_id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    let (name, traeger, dienststatus) = snap;
    if dienststatus != DIENSTSTATUS_IN_DIENST {
        return Err(ausser_dienst_fehler());
    }
    Ok((name, traeger))
}

/// Eine Stamm-Person außer Dienst lässt sich nicht disponieren: ein Zustand, also 422
/// (`src/AGENTS.md`, Statuscode-Konvention; bis LLH-1100 war es 400).
pub fn ausser_dienst_fehler() -> AppError {
    AppError::UnprocessableEntity("Person ist außer Dienst und kann nicht disponiert werden".into())
}

/// Disponiert eine Ad-hoc-externe Person (`personal_id = NULL`); `snap_*` sind die eigentlichen
/// Daten. Initialstatus ist der erste `gebunden`. Liefert die `ep_id`.
///
/// Pool-Hülle um [`disponieren_adhoc_tx`] ohne eigene Transaktion.
pub async fn disponieren_adhoc(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    daten: AdhocDaten<'_>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let mut conn = pool.acquire().await?;
    disponieren_adhoc_tx(&mut conn, einsatz_id, org_id, daten, disponiert_von).await
}

/// Wie [`disponieren_adhoc`] auf einer offenen Verbindung (LFH-552: die Route schreibt die
/// Zeitachse des Initialstatus in derselben Transaktion).
pub async fn disponieren_adhoc_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    daten: AdhocDaten<'_>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let status_id =
        status_repo::erster_der_kategorie(&mut *conn, org_id, KATEGORIE_GEBUNDEN).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_personal \
            (einsatz_id, personal_id, status_id, staerke_position, snap_name, snap_funktion, \
             snap_traegerorganisation, disponiert_von) \
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(status_id)
    .bind(daten.staerke_position)
    .bind(daten.name)
    .bind(daten.funktion)
    .bind(daten.traegerorganisation)
    .bind(disponiert_von)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Änderungen an einer Dispositionszeile (PATCH), schon getrimmt und geprüft in der Route.
/// `status_id` und `name`: `None` = unverändert. Die übrigen Felder sind Tri-State: `None` =
/// unverändert, `Some(None)` = NULL, `Some(Some(x))` = setzen.
#[derive(Debug, Default, Clone, Copy)]
pub struct DispositionPatch<'a> {
    pub status_id: Option<i64>,
    pub staerke_position: Option<Option<&'a str>>,
    pub bemerkung: Option<Option<&'a str>>,
    /// Einsatzfunktion (LLH-1067): was die Kraft gerade tut, für Stamm und Ad-hoc gleich.
    pub einsatzfunktion: Option<Option<&'a str>>,
    /// Ad-hoc-Angaben (LLH-1067, design.md D3): nur an einer Zeile ohne Stamm-Bezug, sonst 422.
    pub name: Option<&'a str>,
    /// Qualifikation einer Ad-hoc-Person (`snap_funktion`).
    pub funktion: Option<Option<&'a str>>,
    pub traegerorganisation: Option<Option<&'a str>>,
}

impl DispositionPatch<'_> {
    /// Ändert der Patch eine Angabe, die bei einer Stamm-Person der Stamm trägt?
    pub fn has_adhoc_angaben(&self) -> bool {
        self.name.is_some() || self.funktion.is_some() || self.traegerorganisation.is_some()
    }
}

/// Der 422 an einer Stamm-Person, deren Name, Qualifikation oder Träger über den Einsatz geändert
/// werden soll (LLH-1067, design.md D3).
pub fn stamm_angaben_fehler() -> AppError {
    AppError::UnprocessableEntity(
        "Name, Qualifikation und Trägerorganisation einer Stamm-Person im Stamm pflegen".into(),
    )
}

/// Aktualisiert eine Dispositionszeile nach [`DispositionPatch`]. `NotFound`, falls die Zeile
/// nicht zum Einsatz gehört, `Conflict` an einer beendeten Kraft (LLH-1079),
/// `UnprocessableEntity` bei Ad-hoc-Angaben an einer Stamm-Person; dann schreibt sie nichts.
pub async fn update_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    patch: DispositionPatch<'_>,
) -> Result<(), AppError> {
    require_aktiv_tx(conn, einsatz_id, ep_id).await?;
    if patch.has_adhoc_angaben() {
        let stamm: Option<i64> = sqlx::query_scalar(
            "SELECT personal_id FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
        )
        .bind(ep_id)
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
        if stamm.is_some() {
            return Err(stamm_angaben_fehler());
        }
    }
    let resultat = sqlx::query(
        "UPDATE einsatz_personal \
         SET status_id = COALESCE(?, status_id), \
             staerke_position = CASE WHEN ? THEN ? ELSE staerke_position END, \
             bemerkung = CASE WHEN ? THEN ? ELSE bemerkung END, \
             einsatzfunktion = CASE WHEN ? THEN ? ELSE einsatzfunktion END, \
             snap_name = COALESCE(?, snap_name), \
             snap_funktion = CASE WHEN ? THEN ? ELSE snap_funktion END, \
             snap_traegerorganisation = CASE WHEN ? THEN ? ELSE snap_traegerorganisation END \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(patch.status_id)
    .bind(patch.staerke_position.is_some())
    .bind(patch.staerke_position.flatten())
    .bind(patch.bemerkung.is_some())
    .bind(patch.bemerkung.flatten())
    .bind(patch.einsatzfunktion.is_some())
    .bind(patch.einsatzfunktion.flatten())
    .bind(patch.name)
    .bind(patch.funktion.is_some())
    .bind(patch.funktion.flatten())
    .bind(patch.traegerorganisation.is_some())
    .bind(patch.traegerorganisation.flatten())
    .bind(ep_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Pool-Hülle um [`update_tx`] ohne eigene Transaktion.
pub async fn update(
    pool: &SqlitePool,
    einsatz_id: i64,
    ep_id: i64,
    patch: DispositionPatch<'_>,
) -> Result<(), AppError> {
    let mut conn = pool.acquire().await?;
    update_tx(&mut conn, einsatz_id, ep_id, patch).await
}

// ── Lebenszustand (LLH-1079, Spec `kraefte-entlassung`) ──────────────────────────────────

/// Jeder Schreibweg an einer Kraft fragt zuerst hier (design.md D6): `NotFound`, wenn die Zeile
/// nicht zum Einsatz gehört, `Conflict` (Lebenszyklus, `src/AGENTS.md`), wenn sie entlassen oder
/// storniert ist. Nur das erneute Disponieren schreibt an einer beendeten Kraft.
pub async fn require_aktiv_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
) -> Result<(), AppError> {
    let ende: Option<Option<String>> = sqlx::query_scalar(
        "SELECT beendet_als FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    match ende.ok_or(AppError::NotFound)? {
        None => Ok(()),
        Some(als) => Err(beendet_conflict(&als)),
    }
}

/// Der 409 an einer beendeten Kraft (Lebenszyklus), je Endzustand.
pub fn beendet_conflict(beendet_als: &str) -> AppError {
    AppError::Conflict(match beendet_als {
        "storniert" => "Die Person ist storniert; erst erneut disponieren".into(),
        _ => "Die Person ist aus dem Einsatz entlassen; erst erneut disponieren".into(),
    })
}

/// Wie [`require_aktiv_tx`] für Schreibwege anderer Module, die die Zugehörigkeit zum Einsatz
/// selbst prüfen (mit eigenem Statuscode) oder nur einen Pool haben: eine unbekannte Kraft ist
/// hier kein Fehler, eine beendete der 409 aus [`beendet_conflict`] (design.md D6).
pub async fn require_nicht_beendet(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    ep_id: i64,
) -> Result<(), AppError> {
    let ende: Option<Option<String>> = sqlx::query_scalar(
        "SELECT beendet_als FROM einsatz_personal \
         WHERE id = ? AND einsatz_id = ? AND beendet_at IS NOT NULL",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(executor)
    .await?;
    match ende.flatten() {
        None => Ok(()),
        Some(als) => Err(beendet_conflict(&als)),
    }
}

/// Was das Entlassen über die Kraft selbst hinaus berührt hat.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Entlassen {
    /// Name der Einheit, der die Person angehörte — nur für den ETB-Text (design.md D4).
    pub einheit_name: Option<String>,
    /// Ist die Entlassung in die Zeitachse eingegangen? Ohne offene Periode nicht.
    pub zeitachse: bool,
}

/// Entlässt eine Person aus dem Einsatz (design.md D4/D5): die Zeile bleibt mit Zeitpunkt und
/// entlassender Person stehen. Gelöst werden Einheit, Fahrzeug, UHS, die Führung einer Einheit,
/// die Leitung eines Abschnitts, Stab und Einsatzleitung (Spec `einsatz-fuehrungsstelle`:
/// „nicht mehr disponiert“). Auftragsempfänger, Schadensbezug und Bestätigungen bleiben. In die
/// Zeitachse geht die Entlassung mit Quelle `disposition`, sofern eine Periode offen ist.
/// `NotFound`/`Conflict` wie [`require_aktiv_tx`].
pub async fn entlassen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Entlassen, AppError> {
    require_aktiv_tx(conn, einsatz_id, ep_id).await?;
    let einheit_name: Option<String> = sqlx::query_scalar(
        "SELECT e.name FROM einsatz_personal ep \
         JOIN einsatz_einheit e ON e.id = ep.einheit_id \
         WHERE ep.id = ? AND ep.einsatz_id = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    release_bindungen_tx(conn, einsatz_id, ep_id).await?;
    let (ergebnis, _) = crate::zeitachse::repo::schreibe_tx(
        conn,
        einsatz_id,
        benutzer_id,
        crate::zeitachse::repo::Kraft::Person(ep_id),
        crate::zeitachse::repo::Neu {
            art: crate::zeitachse::ZeitachseArt::Entlassung,
            zeitpunkt_at: jetzt,
            quelle: crate::zeitachse::ZeitachseQuelle::Disposition,
            notiz: None,
        },
    )
    .await?;
    set_beendet_tx(
        conn,
        einsatz_id,
        ep_id,
        benutzer_id,
        jetzt,
        crate::entlassung::BeendetAls::Entlassen,
    )
    .await?;
    Ok(Entlassen {
        einheit_name,
        zeitachse: matches!(
            ergebnis,
            crate::zeitachse::repo::Schreibergebnis::Geschrieben(_)
        ),
    })
}

/// Löst jede Bindung einer Person (design.md D4). Führungsrollen werden ausdrücklich geleert:
/// ohne DELETE greift kein `ON DELETE SET NULL` mehr.
async fn release_bindungen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
) -> Result<(), AppError> {
    for sql in [
        "UPDATE einsatz_einheit SET fuehrer_id = NULL WHERE fuehrer_id = ? AND einsatz_id = ?",
        "UPDATE einsatzabschnitt SET leiter_id = NULL WHERE leiter_id = ? AND einsatz_id = ?",
        "UPDATE einsatz_stabsfunktion SET personal_id = NULL \
         WHERE personal_id = ? AND einsatz_id = ?",
        "UPDATE einsatz_fuehrungsstelle SET einsatzleiter_personal_id = NULL \
         WHERE einsatzleiter_personal_id = ? AND einsatz_id = ?",
        "UPDATE einsatz_personal SET einheit_id = NULL, fahrzeug_id = NULL, uhs_id = NULL \
         WHERE id = ? AND einsatz_id = ?",
    ] {
        sqlx::query(sql)
            .bind(ep_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// Setzt den Endzustand genau einmal; die Bedingung `beendet_at IS NULL` steht im UPDATE, so
/// trifft ein gleichzeitiger zweiter Versuch keine Zeile mehr (`Conflict`).
async fn set_beendet_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    benutzer_id: i64,
    jetzt: &str,
    als: crate::entlassung::BeendetAls,
) -> Result<(), AppError> {
    // `zuletzt_entlassen_at` überdauert das erneute Disponieren (Storno-Sperre, design.md D3).
    let r = sqlx::query(
        "UPDATE einsatz_personal SET beendet_at = ?1, beendet_von = ?2, beendet_als = ?3, \
             zuletzt_entlassen_at = CASE WHEN ?3 = 'entlassen' THEN ?1 \
                                         ELSE zuletzt_entlassen_at END \
         WHERE id = ?4 AND einsatz_id = ?5 AND beendet_at IS NULL",
    )
    .bind(jetzt)
    .bind(benutzer_id)
    .bind(als.as_str())
    .bind(ep_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Die Person ist bereits aus dem Einsatz genommen".into(),
        ));
    }
    Ok(())
}

/// Storniert eine Fehldisposition (design.md D3): die Zeile endet als `storniert`, jedes nicht
/// gestrichene Ereignis der Person wird mit [`crate::entlassung::GRUND_STORNO`] gestrichen. Nur
/// solange die Kraft aktiv ist (sonst `Conflict`), nur Ereignisse aus der Disposition trägt,
/// keine Bindung hat und höchstens [`crate::entlassung::STORNO_FRIST_MINUTEN`] seit der
/// Disposition vergangen sind; sonst 422 mit dem ersten verletzten Grund als Satz.
pub async fn stornieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    require_aktiv_tx(conn, einsatz_id, ep_id).await?;
    if let Some(grund) = find_storno_hindernis_tx(conn, einsatz_id, ep_id, jetzt).await? {
        return Err(AppError::UnprocessableEntity(grund));
    }
    let ereignisse: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_kraft_zeitachse \
         WHERE personal_id = ? AND gestrichen_at IS NULL ORDER BY zeitpunkt_at DESC, id DESC",
    )
    .bind(ep_id)
    .fetch_all(&mut *conn)
    .await?;
    for id in ereignisse {
        crate::zeitachse::repo::streiche_tx(
            conn,
            einsatz_id,
            benutzer_id,
            crate::zeitachse::repo::Kraft::Person(ep_id),
            id,
            crate::entlassung::GRUND_STORNO,
            false,
        )
        .await?;
    }
    set_beendet_tx(
        conn,
        einsatz_id,
        ep_id,
        benutzer_id,
        jetzt,
        crate::entlassung::BeendetAls::Storniert,
    )
    .await
}

/// Der erste Grund, der einen Storno verbietet (design.md D3, Regeln 2–4), oder `None`.
async fn find_storno_hindernis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ep_id: i64,
    jetzt: &str,
) -> Result<Option<String>, AppError> {
    let (disponiert_at, einheit, fahrzeug, uhs, entlassen_at): (
        String,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT disponiert_at, einheit_id, fahrzeug_id, uhs_id, zuletzt_entlassen_at \
         FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    // Wer einmal entlassen war, war im Einsatz: das erneute Disponieren setzt die Frist nicht
    // zurück (Review LLH-1079).
    if entlassen_at.is_some() {
        return Ok(Some(
            "Die Person war schon einmal aus dem Einsatz entlassen; \
             die Person lässt sich entlassen"
                .into(),
        ));
    }
    let fremde_ereignisse: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_kraft_zeitachse \
         WHERE personal_id = ? AND gestrichen_at IS NULL \
           AND (quelle <> 'status' OR zeitpunkt_at <> ?)",
    )
    .bind(ep_id)
    .bind(&disponiert_at)
    .fetch_one(&mut *conn)
    .await?;
    if fremde_ereignisse > 0 {
        return Ok(Some(
            "Die Zeitachse der Person trägt schon mehr als die Disposition; \
             die Person lässt sich entlassen"
                .into(),
        ));
    }
    let bindung = if einheit.is_some() {
        Some("Die Person gehört einer Einheit an")
    } else if fahrzeug.is_some() {
        Some("Die Person ist Besatzung eines Fahrzeugs")
    } else if uhs.is_some() {
        Some("Die Person arbeitet an einer UHS")
    } else {
        None
    };
    if let Some(b) = bindung {
        return Ok(Some(format!("{b}; erst lösen oder die Person entlassen")));
    }
    // Rollen und Spuren außerhalb der eigenen Zeile, in fester Reihenfolge.
    const SPUREN: [(&str, &str); 7] = [
        (
            "SELECT EXISTS(SELECT 1 FROM einsatz_einheit \
                           WHERE fuehrer_id = ?1 AND einsatz_id = ?2 AND aufgeloest_at IS NULL)",
            "Die Person führt eine Einheit",
        ),
        (
            "SELECT EXISTS(SELECT 1 FROM einsatzabschnitt WHERE leiter_id = ?1 AND einsatz_id = ?2)",
            "Die Person leitet einen Einsatzabschnitt",
        ),
        (
            "SELECT EXISTS(SELECT 1 FROM einsatz_stabsfunktion \
                           WHERE personal_id = ?1 AND einsatz_id = ?2)",
            "Die Person besetzt eine Stabsfunktion",
        ),
        (
            "SELECT EXISTS(SELECT 1 FROM einsatz_fuehrungsstelle \
                           WHERE einsatzleiter_personal_id = ?1 AND einsatz_id = ?2)",
            "Die Person ist Einsatzleiter",
        ),
        (
            "SELECT EXISTS(SELECT 1 FROM auftrag_empfaenger ae JOIN auftrag a ON a.id = ae.auftrag_id \
                           WHERE ae.person_id = ?1 AND a.einsatz_id = ?2)",
            "Die Person ist Empfänger eines Auftrags",
        ),
        (
            "SELECT EXISTS(SELECT 1 FROM einsatz_schaden \
                           WHERE geschaedigt_personal_id = ?1 AND einsatz_id = ?2)",
            "Die Person ist an einem Schaden als geschädigt eingetragen",
        ),
        (
            "SELECT EXISTS(SELECT 1 FROM person_sichtung WHERE bestaetigt_personal_id = ?1) \
                 OR EXISTS(SELECT 1 FROM person_verbleib WHERE bestaetigt_personal_id = ?1)",
            "Die Person hat eine Sichtung oder einen Verbleib bestätigt",
        ),
    ];
    for (sql, grund) in SPUREN {
        let hat: bool = sqlx::query_scalar(sql)
            .bind(ep_id)
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
        if hat {
            return Ok(Some(format!("{grund}; die Person lässt sich entlassen")));
        }
    }
    if !crate::entlassung::is_in_storno_frist(&disponiert_at, jetzt) {
        return Ok(Some(crate::entlassung::storno_frist_text()));
    }
    Ok(None)
}

/// Nimmt eine entlassene oder stornierte Person wieder auf (design.md D7): Endzustand weg,
/// Initialstatus und Dispositionszeit neu, die Stärke-Position nach `staerke_position`
/// (`None` = unverändert, `Some(x)` = setzen). Eine Stamm-Person muss in Dienst sein, ihr
/// Snapshot wird erneuert. Gestrichene Ereignisse bleiben gestrichen; die Zeitachse des
/// Initialstatus schreibt der Aufrufer über [`start_zeitachse_tx`]. `NotFound` bei fremder
/// Zeile, `Conflict` bei einer aktiven.
pub async fn reaktivieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    ep_id: i64,
    staerke_position: Option<Option<&str>>,
    benutzer_id: i64,
) -> Result<(), AppError> {
    let zeile: Option<(Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT personal_id, beendet_at FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (personal_id, beendet_at) = zeile.ok_or(AppError::NotFound)?;
    if beendet_at.is_none() {
        return Err(AppError::Conflict(
            "Person ist bereits in diesem Einsatz disponiert".into(),
        ));
    }
    if let Some(pid) = personal_id {
        let (name, traeger) = stamm_snapshot_tx(conn, org_id, pid).await?;
        let funktion = qualifikation_repo::funktion_text(&mut *conn, pid).await?;
        sqlx::query(
            "UPDATE einsatz_personal SET snap_name = ?, snap_funktion = ?, \
                 snap_traegerorganisation = ? WHERE id = ?",
        )
        .bind(&name)
        .bind(&funktion)
        .bind(&traeger)
        .bind(ep_id)
        .execute(&mut *conn)
        .await?;
    }
    let status_id =
        status_repo::erster_der_kategorie(&mut *conn, org_id, KATEGORIE_GEBUNDEN).await?;
    sqlx::query(
        "UPDATE einsatz_personal SET beendet_at = NULL, beendet_von = NULL, beendet_als = NULL, \
             status_id = ?, \
             staerke_position = CASE WHEN ? THEN ? ELSE staerke_position END, \
             disponiert_at = datetime('now'), disponiert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(status_id)
    .bind(staerke_position.is_some())
    .bind(staerke_position.flatten())
    .bind(benutzer_id)
    .bind(ep_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Schreibt die Zeitachse des Initialstatus einer frisch (wieder) disponierten Person zum
/// Zeitpunkt ihrer Disposition (LFH-552). Gleicher Zeitpunkt wie `disponiert_at`: daran erkennt
/// der Storno die Ereignisse aus der Disposition (design.md D3, Regel 2).
pub async fn start_zeitachse_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    ep_id: i64,
) -> Result<(), AppError> {
    let (status_id, disponiert_at): (Option<i64>, String) = sqlx::query_as(
        "SELECT status_id, disponiert_at FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ep_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    if let Some(sid) = status_id {
        crate::zeitachse::repo::aus_personalstatus_tx(
            conn,
            einsatz_id,
            benutzer_id,
            ep_id,
            sid,
            &disponiert_at,
        )
        .await?;
    }
    Ok(())
}

/// Lesepfad für die Karte: ALLE aktiven Personen des Einsatzes mit Position;
/// Führungsrollen als Flags (`ist_einheitsfuehrer`/`ist_abschnittsleiter`). Getrennt vom
/// `liste`-Pfad, der kein lat/lon liefert.
pub async fn liste_fuehrungskraefte(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<FuehrungskraftKarte>, AppError> {
    let rows = sqlx::query_as::<_, FuehrungskraftKarte>(
        "SELECT ep.id, ep.einsatz_id, ep.snap_name AS name, \
                ep.lat, ep.lon, ep.tz_fachaufgabe, ep.tz_organisation, \
                ep.snap_funktion AS funktion, \
                EXISTS(SELECT 1 FROM einsatz_einheit e \
                       WHERE e.einsatz_id = ep.einsatz_id AND e.fuehrer_id = ep.id \
                         AND e.aufgeloest_at IS NULL) AS ist_einheitsfuehrer, \
                EXISTS(SELECT 1 FROM einsatzabschnitt a \
                       WHERE a.einsatz_id = ep.einsatz_id AND a.leiter_id = ep.id) AS ist_abschnittsleiter \
         FROM einsatz_personal ep \
         WHERE ep.einsatz_id = ?1 AND ep.beendet_at IS NULL \
         ORDER BY ep.snap_name, ep.id",
    ).bind(einsatz_id).fetch_all(pool).await?;
    Ok(rows)
}

/// PATCH-Daten der Position, Tri-State je Feld: `None` = unverändert, `Some(None)` = NULL,
/// `Some(Some(x))` = setzen.
#[derive(Debug, Default)]
pub struct PositionPatch<'a> {
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
}

/// Aktualisiert lat/lon/tz_* einer Person des Einsatzes (s. `PositionPatch`); `NotFound`, falls
/// die Zeile nicht zum Einsatz gehört. Liefert die frische Karten-Sicht.
pub async fn update_position(
    pool: &SqlitePool,
    einsatz_id: i64,
    ep_id: i64,
    daten: PositionPatch<'_>,
) -> Result<FuehrungskraftKarte, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_personal SET \
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
    .bind(ep_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    let liste = liste_fuehrungskraefte(pool, einsatz_id).await?;
    liste
        .into_iter()
        .find(|f| f.id == ep_id)
        .ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::katalog::{StatusKategorie, KATEGORIE_GEBUNDEN};
    use crate::personal::qualifikation_repo;
    use crate::personal::repo::{self as p_repo, PersonalDaten};
    use crate::personal::status_repo::{self, StatusDaten};

    /// Org(1) + Benutzer + Einsatz + ein 'gebunden'-Status; liefert (benutzer, einsatz).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        status_repo::anlegen(
            pool,
            1,
            StatusDaten {
                label: "alarmiert",
                kategorie: KATEGORIE_GEBUNDEN,
                farbe: None,
                sortier: 20,
                zeitachse_marke: None,
            },
        )
        .await
        .unwrap();
        (benutzer, einsatz)
    }

    fn p_daten(name: &str) -> PersonalDaten<'_> {
        PersonalDaten {
            name,
            benutzer_id: None,
            personalnummer: None,
            traegerorganisation: Some("DRK"),
            telefon: None,
            staerke_position: Some("fuehrer"),
            bemerkung: None,
        }
    }

    /// Org/Benutzer/Einsatz, drei `einsatz_personal` (nur snap_name), eine Einheit mit
    /// `fuehrer_id = p1` und ein Abschnitt mit `leiter_id = p2`; p3 ohne Führungsrolle. Liefert
    /// (einsatz, p1, p2, p3).
    async fn seed_personal_mit_fuehrung(pool: &SqlitePool) -> (i64, i64, i64, i64) {
        let (_benutzer, einsatz) = setup(pool).await;
        let mut ids = Vec::new();
        for name in ["Anton Abel", "Berta Busch", "Cäsar Crom"] {
            let id: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, ?) RETURNING id",
            )
            .bind(einsatz)
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap();
            ids.push(id);
        }
        let (p1, p2, p3) = (ids[0], ids[1], ids[2]);
        sqlx::query(
            "INSERT INTO einsatz_einheit (einsatz_id, name, fuehrer_id) VALUES (?, 'Trupp', ?)",
        )
        .bind(einsatz)
        .bind(p1)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO einsatzabschnitt (einsatz_id, name, leiter_id) VALUES (?, 'Abschnitt Nord', ?)")
            .bind(einsatz).bind(p2).execute(pool).await.unwrap();
        (einsatz, p1, p2, p3)
    }

    /// Stamm-Person, Qualifikation, Personalstatus und Disposition in EINER Transaktion: die
    /// Disposition liest auf der Verbindung; über den Pool fände sie die Person nicht bzw. schriebe
    /// still `snap_funktion`/`status_id = NULL`.
    #[tokio::test]
    async fn disponiere_stamm_mit_stammdaten_aus_derselben_transaktion() {
        let (_dir, pool) = crate::db::test_pool_datei().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (7, 'Import-Org')")
            .execute(&pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (7, 'Leit', 'leit7', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let (ep_id, status_id) = crate::write_retry!(&pool, |conn| {
            let einsatz: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz (org_id, bezeichnung) VALUES (7, 'Import') RETURNING id",
            )
            .fetch_one(&mut *conn)
            .await?;
            let status_id: i64 = sqlx::query_scalar(
                "INSERT INTO personal_status (org_id, label, kategorie, sortier) \
                 VALUES (7, 'alarmiert', 'gebunden', 20) RETURNING id",
            )
            .fetch_one(&mut *conn)
            .await?;
            let quali: i64 = sqlx::query_scalar(
                "INSERT INTO qualifikation (org_id, label, sortier) VALUES (7, 'Zugführer', 1) \
                 RETURNING id",
            )
            .fetch_one(&mut *conn)
            .await?;
            let personal =
                crate::personal::repo::anlegen_tx(&mut *conn, 7, &p_daten("Anna Import"), &[quali])
                    .await?;
            let ep_id = disponieren_stamm_tx(&mut *conn, einsatz, 7, personal.id, None, benutzer)
                .await?
                .id;
            Ok((ep_id, status_id))
        })
        .unwrap();
        let (snap_funktion, gesetzter_status): (Option<String>, Option<i64>) =
            sqlx::query_as("SELECT snap_funktion, status_id FROM einsatz_personal WHERE id = ?")
                .bind(ep_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(snap_funktion.as_deref(), Some("Zugführer"));
        assert_eq!(gesetzter_status, Some(status_id));
    }

    #[tokio::test]
    async fn alle_disponierten_und_position() {
        let pool = crate::db::test_pool().await;
        let (einsatz_id, p1, p2, p3) = seed_personal_mit_fuehrung(&pool).await;

        // Die Liste liefert ALLE disponierten Personen; Führungsrollen bleiben als Flags kenntlich.
        let liste = liste_fuehrungskraefte(&pool, einsatz_id).await.unwrap();
        let ids: Vec<i64> = liste.iter().map(|f| f.id).collect();
        assert_eq!(liste.len(), 3);
        assert!(ids.contains(&p1) && ids.contains(&p2) && ids.contains(&p3));
        assert!(
            liste
                .iter()
                .find(|f| f.id == p1)
                .unwrap()
                .ist_einheitsfuehrer
        );
        assert!(
            liste
                .iter()
                .find(|f| f.id == p2)
                .unwrap()
                .ist_abschnittsleiter
        );
        let f3 = liste.iter().find(|f| f.id == p3).unwrap();
        assert!(!f3.ist_einheitsfuehrer && !f3.ist_abschnittsleiter);

        // Auch eine Nicht-Führungskraft ist verortbar.
        update_position(
            &pool,
            einsatz_id,
            p3,
            PositionPatch {
                lat: Some(Some(50.1)),
                lon: Some(Some(8.6)),
                tz_fachaufgabe: None,
                tz_organisation: None,
            },
        )
        .await
        .unwrap();
        let liste2 = liste_fuehrungskraefte(&pool, einsatz_id).await.unwrap();
        assert_eq!(liste2.iter().find(|f| f.id == p3).unwrap().lat, Some(50.1));
    }

    #[tokio::test]
    async fn disponiere_stamm_fuellt_snapshot_status_und_funktion() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let san = qualifikation_repo::anlegen(&pool, 1, "Sanitäter", 10)
            .await
            .unwrap();
        let gf = qualifikation_repo::anlegen(&pool, 1, "Gruppenführer", 60)
            .await
            .unwrap();
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas Müller"), &[san.id, gf.id])
            .await
            .unwrap();

        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap()
            .id;
        let a = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.name, "Thomas Müller");
        assert_eq!(a.funktion.as_deref(), Some("Sanitäter, Gruppenführer"));
        assert_eq!(a.status_kategorie, Some(StatusKategorie::Gebunden));
        assert_eq!(
            a.staerke_position.as_deref(),
            Some("fuehrer"),
            "Stamm-Default greift"
        );
        assert!(!a.ist_adhoc);
    }

    #[tokio::test]
    async fn staerke_position_override_schlaegt_stamm_default() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[])
            .await
            .unwrap(); // Stamm = fuehrer
        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, Some("mannschaft"), benutzer)
            .await
            .unwrap()
            .id;
        let a = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(
            a.staerke_position.as_deref(),
            Some("mannschaft"),
            "Override schlägt Default"
        );
    }

    #[tokio::test]
    async fn doppelte_stamm_disposition_ist_conflict() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[])
            .await
            .unwrap();
        disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap();
        assert!(matches!(
            disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')")
            .execute(&pool)
            .await
            .unwrap();
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO personal (org_id, name) VALUES (2, 'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(matches!(
            disponieren_stamm(&pool, einsatz, 1, fremd, None, benutzer)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }

    /// Außer Dienst ist ein Zustand: 422 (LLH-1100, Statuscode-Konvention), nicht mehr 400.
    #[tokio::test]
    async fn disponiere_stamm_ausser_dienst_ist_unprocessable() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[])
            .await
            .unwrap();
        p_repo::setze_dienststatus(&pool, 1, person.id, false)
            .await
            .unwrap();
        assert!(matches!(
            disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
                .await
                .unwrap_err(),
            AppError::UnprocessableEntity(_)
        ));
    }

    #[tokio::test]
    async fn adhoc_mehrfach_erlaubt_nur_dispo_position() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for name in ["Notarzt Extern", "Helfer Extern"] {
            disponieren_adhoc(
                &pool,
                einsatz,
                1,
                AdhocDaten {
                    name,
                    funktion: Some("Notarzt"),
                    traegerorganisation: Some("KV"),
                    staerke_position: Some("unterfuehrer"),
                },
                benutzer,
            )
            .await
            .unwrap();
        }
        let l = liste(&pool, einsatz, true).await.unwrap();
        assert_eq!(l.len(), 2);
        assert!(l.iter().all(|a| a.ist_adhoc && a.personal_id.is_none()));
        assert_eq!(l[0].staerke_position.as_deref(), Some("unterfuehrer"));
    }

    #[tokio::test]
    async fn snapshot_stabil_live_vs_snapshot() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas Müller"), &[])
            .await
            .unwrap();
        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap()
            .id;

        // Stamm nachträglich umbenennen.
        p_repo::aktualisiere(&pool, 1, person.id, p_daten("Thomas NEU"), &[])
            .await
            .unwrap();
        // Aktiver Einsatz → Live (neuer Name).
        assert_eq!(
            load_anzeige(&pool, einsatz, ep, true).await.unwrap().name,
            "Thomas NEU"
        );
        // Abgeschlossen → Snapshot (alter Name).
        assert_eq!(
            load_anzeige(&pool, einsatz, ep, false).await.unwrap().name,
            "Thomas Müller"
        );
        // Außer Dienst → auch bei aktivem Einsatz Snapshot.
        p_repo::setze_dienststatus(&pool, 1, person.id, false)
            .await
            .unwrap();
        assert_eq!(
            load_anzeige(&pool, einsatz, ep, true).await.unwrap().name,
            "Thomas Müller"
        );
    }

    #[tokio::test]
    async fn staerke_position_immer_live_ohne_override() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        // Stamm-Default = fuehrer (aus p_daten), KEIN Dispo-Override.
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[])
            .await
            .unwrap();
        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap()
            .id;
        assert_eq!(
            load_anzeige(&pool, einsatz, ep, true)
                .await
                .unwrap()
                .staerke_position
                .as_deref(),
            Some("fuehrer")
        );

        // Stamm-Position nachträglich ändern → live reflektiert (kein Snapshot).
        let mut geaendert = p_daten("Thomas");
        geaendert.staerke_position = Some("mannschaft");
        p_repo::aktualisiere(&pool, 1, person.id, geaendert, &[])
            .await
            .unwrap();
        assert_eq!(
            load_anzeige(&pool, einsatz, ep, true)
                .await
                .unwrap()
                .staerke_position
                .as_deref(),
            Some("mannschaft"),
            "Position ist immer live, kein Snapshot"
        );
    }

    #[tokio::test]
    async fn funktion_komposition_identisch() {
        // `snap_funktion` (beim Disponieren) und Live-Funktion (in der Anzeige) liefern dieselbe
        // Komposition.
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let san = qualifikation_repo::anlegen(&pool, 1, "Sanitäter", 10)
            .await
            .unwrap();
        let gf = qualifikation_repo::anlegen(&pool, 1, "Gruppenführer", 60)
            .await
            .unwrap();
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[gf.id, san.id])
            .await
            .unwrap();
        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap()
            .id;

        let live = load_anzeige(&pool, einsatz, ep, true)
            .await
            .unwrap()
            .funktion;
        let snap = load_anzeige(&pool, einsatz, ep, false)
            .await
            .unwrap()
            .funktion;
        let helper = qualifikation_repo::funktion_text(&pool, person.id)
            .await
            .unwrap();
        assert_eq!(live, snap, "Live == Snapshot bei unverändertem Stamm");
        assert_eq!(live, helper, "Anzeige == funktion_text-Helper");
        assert_eq!(live.as_deref(), Some("Sanitäter, Gruppenführer"));
    }

    #[tokio::test]
    async fn einheit_id_wird_in_anzeige_geliefert() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[])
            .await
            .unwrap();
        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap()
            .id;

        // Frisch disponiert → keiner Einheit zugeordnet.
        assert_eq!(
            load_anzeige(&pool, einsatz, ep, true)
                .await
                .unwrap()
                .einheit_id,
            None
        );

        // Direkt einer Einheit zuordnen (roh).
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Trupp') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(ep)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            load_anzeige(&pool, einsatz, ep, true)
                .await
                .unwrap()
                .einheit_id,
            Some(einheit)
        );
    }

    #[tokio::test]
    async fn aktualisiere_status_position_bemerkung_dann_entferne() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[])
            .await
            .unwrap();
        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap()
            .id;
        let neuer = status_repo::anlegen(
            &pool,
            1,
            StatusDaten {
                label: "im Einsatz",
                kategorie: KATEGORIE_GEBUNDEN,
                farbe: None,
                sortier: 40,
                zeitachse_marke: None,
            },
        )
        .await
        .unwrap();

        update(
            &pool,
            einsatz,
            ep,
            DispositionPatch {
                status_id: Some(neuer.id),
                staerke_position: Some(Some("mannschaft")),
                bemerkung: Some(Some("vor Ort")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let a = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.status_id, Some(neuer.id));
        assert_eq!(a.staerke_position.as_deref(), Some("mannschaft"));
        assert_eq!(a.bemerkung.as_deref(), Some("vor Ort"));

        // status_id None → bleibt; position None → bleibt; nur Bemerkung leeren.
        update(
            &pool,
            einsatz,
            ep,
            DispositionPatch {
                bemerkung: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let b = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(b.status_id, Some(neuer.id), "Status unverändert");
        assert_eq!(
            b.staerke_position.as_deref(),
            Some("mannschaft"),
            "Position unverändert"
        );
        assert!(b.bemerkung.is_none(), "Bemerkung geleert (Spalte auf NULL)");

        // LLH-1079: Entlassen löscht nicht; die Zeile bleibt mit Endzustand lesbar, fällt aus
        // der Liste und nimmt keine Änderung mehr an.
        entlasse(&pool, einsatz, ep, benutzer, "2026-10-13 14:00:00")
            .await
            .unwrap();
        let c = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(c.beendet_als.as_deref(), Some("entlassen"));
        assert_eq!(c.beendet_at.as_deref(), Some("2026-10-13 14:00:00"));
        assert_eq!(c.beendet_von, Some(benutzer));
        assert!(liste(&pool, einsatz, true).await.unwrap().is_empty());
        assert_eq!(
            list_entlassene(&pool, einsatz, true)
                .await
                .unwrap()
                .iter()
                .map(|a| a.id)
                .collect::<Vec<_>>(),
            vec![ep]
        );
        assert!(matches!(
            update(
                &pool,
                einsatz,
                ep,
                DispositionPatch {
                    bemerkung: Some(Some("x")),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    /// Tri-State von `staerke_position` auf der rohen Override-Spalte (ohne die
    /// `.or(live)`-Auflösung der Anzeige).
    #[tokio::test]
    async fn aktualisiere_staerke_position_tri_state() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[])
            .await
            .unwrap();
        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, Some("mannschaft"), benutzer)
            .await
            .unwrap()
            .id;

        async fn roh(pool: &SqlitePool, ep: i64) -> Option<String> {
            sqlx::query_scalar("SELECT staerke_position FROM einsatz_personal WHERE id = ?")
                .bind(ep)
                .fetch_one(pool)
                .await
                .unwrap()
        }
        assert_eq!(roh(&pool, ep).await.as_deref(), Some("mannschaft"));

        // None = unverändert.
        update(&pool, einsatz, ep, DispositionPatch::default())
            .await
            .unwrap();
        assert_eq!(
            roh(&pool, ep).await.as_deref(),
            Some("mannschaft"),
            "absent lässt Override"
        );

        // Some(Some(x)) = setzen.
        update(
            &pool,
            einsatz,
            ep,
            DispositionPatch {
                staerke_position: Some(Some("unterfuehrer")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            roh(&pool, ep).await.as_deref(),
            Some("unterfuehrer"),
            "Wert setzt Override"
        );

        // Some(None) = explizit auf NULL.
        update(
            &pool,
            einsatz,
            ep,
            DispositionPatch {
                staerke_position: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            roh(&pool, ep).await,
            None,
            "explizit null entfernt Override"
        );
    }

    /// Die Besatzungs-FK `fahrzeug_id` wird serialisiert (sonst zeigte der Frei-Pool-Picker bereits
    /// zugeteilte Kräfte). NULL → `None`.
    #[tokio::test]
    async fn fahrzeug_id_wird_serialisiert() {
        let pool = crate::db::test_pool().await;
        let (_benutzer, einsatz) = setup(&pool).await;
        let frei: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Frei') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let crew: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Crew') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        let ef: i64 = sqlx::query_scalar("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id")
            .bind(einsatz).fetch_one(&pool).await.unwrap();
        sqlx::query("UPDATE einsatz_personal SET fahrzeug_id = ? WHERE id = ?")
            .bind(ef)
            .bind(crew)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            load_anzeige(&pool, einsatz, frei, true)
                .await
                .unwrap()
                .fahrzeug_id,
            None
        );
        assert_eq!(
            load_anzeige(&pool, einsatz, crew, true)
                .await
                .unwrap()
                .fahrzeug_id,
            Some(ef)
        );
    }

    /// Entlassen auf eigener Verbindung (LLH-1079).
    async fn entlasse(
        pool: &SqlitePool,
        einsatz: i64,
        ep: i64,
        benutzer: i64,
        jetzt: &str,
    ) -> Result<Entlassen, AppError> {
        let mut conn = pool.acquire().await.unwrap();
        entlassen_tx(&mut conn, einsatz, ep, benutzer, jetzt).await
    }

    /// Stornieren auf eigener Verbindung (LLH-1079).
    async fn storniere(
        pool: &SqlitePool,
        einsatz: i64,
        ep: i64,
        benutzer: i64,
        jetzt: &str,
    ) -> Result<(), AppError> {
        let mut conn = pool.acquire().await.unwrap();
        stornieren_tx(&mut conn, einsatz, ep, benutzer, jetzt).await
    }

    /// Eine Person, die Einheitsführer bzw. Abschnittsleiter und Auftrag-Empfänger ist, lässt sich
    /// entlassen (LLH-1079, Spec `kraefte-entlassung` „Bindungen gelöst“, „Auftrag bleibt“): die
    /// Führungsrollen werden geleert, der Empfänger-Bezug bleibt samt `snap_anzeige`.
    #[tokio::test]
    async fn entlassen_loest_fuehrungsrollen_und_behaelt_den_auftrag() {
        let pool = crate::db::test_pool().await;
        let (einsatz, p1, p2, _p3) = seed_personal_mit_fuehrung(&pool).await;
        let bn: i64 = sqlx::query_scalar("SELECT id FROM benutzer LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let auftrag: i64 = sqlx::query_scalar(
            "INSERT INTO auftrag (einsatz_id, auftrag_text, erteilt_at, erstellt_von_id) \
             VALUES (?, 'Erkunden', '2026-07-17 10:00:00', ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(bn)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, person_id, snap_anzeige) \
             VALUES (?, 'person', ?, 'Anton Abel')",
        )
        .bind(auftrag)
        .bind(p1)
        .execute(&pool)
        .await
        .unwrap();
        let trupp: i64 = sqlx::query_scalar("SELECT id FROM einsatz_einheit WHERE name = 'Trupp'")
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
            .bind(trupp)
            .bind(p1)
            .execute(&pool)
            .await
            .unwrap();

        let e = entlasse(&pool, einsatz, p1, bn, "2026-10-13 14:00:00")
            .await
            .expect("Führer entlassen");
        assert_eq!(e.einheit_name.as_deref(), Some("Trupp"), "für den ETB-Text");
        let (fuehrer,): (Option<i64>,) =
            sqlx::query_as("SELECT fuehrer_id FROM einsatz_einheit WHERE id = ?")
                .bind(trupp)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(fuehrer, None, "fuehrer_id geleert");
        let einheit: Option<i64> =
            sqlx::query_scalar("SELECT einheit_id FROM einsatz_personal WHERE id = ?")
                .bind(p1)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(einheit, None, "gehört keiner Einheit mehr an");
        let (person_ref, snap): (Option<i64>, String) = sqlx::query_as(
            "SELECT person_id, snap_anzeige FROM auftrag_empfaenger WHERE auftrag_id = ?",
        )
        .bind(auftrag)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(person_ref, Some(p1), "der Auftrag nennt sie weiter");
        assert_eq!(snap, "Anton Abel");

        entlasse(&pool, einsatz, p2, bn, "2026-10-13 14:00:00")
            .await
            .expect("Leiter entlassen");
        let leiter: Option<i64> = sqlx::query_scalar(
            "SELECT leiter_id FROM einsatzabschnitt WHERE name = 'Abschnitt Nord'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(leiter, None, "leiter_id geleert");

        assert!(
            matches!(
                entlasse(&pool, einsatz, p2, bn, "2026-10-13 15:00:00")
                    .await
                    .unwrap_err(),
                AppError::Conflict(_)
            ),
            "Bereits entlassen → 409"
        );
    }

    /// Org-Startliste: „alarmiert“ trägt die Marke Alarmierung, „im Einsatz“ Eintreffen.
    async fn setup_mit_marken(pool: &SqlitePool) -> (i64, i64, i64) {
        let (benutzer, einsatz) = setup(pool).await;
        sqlx::query("UPDATE personal_status SET zeitachse_marke = 'alarmierung'")
            .execute(pool)
            .await
            .unwrap();
        let eingetroffen = status_repo::anlegen(
            pool,
            1,
            StatusDaten {
                label: "im Einsatz",
                kategorie: KATEGORIE_GEBUNDEN,
                farbe: None,
                sortier: 40,
                zeitachse_marke: Some("eintreffen"),
            },
        )
        .await
        .unwrap();
        (benutzer, einsatz, eingetroffen.id)
    }

    /// Disponiert eine Ad-hoc-Person samt Zeitachse des Initialstatus, wie die Route; setzt die
    /// Dispositionszeit fest.
    async fn disponiere_zur_zeit(
        pool: &SqlitePool,
        einsatz: i64,
        benutzer: i64,
        zeit: &str,
    ) -> i64 {
        let mut conn = pool.acquire().await.unwrap();
        let ep = disponieren_adhoc_tx(
            &mut conn,
            einsatz,
            1,
            AdhocDaten {
                name: "Helga Helfer",
                funktion: None,
                traegerorganisation: None,
                staerke_position: None,
            },
            benutzer,
        )
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_personal SET disponiert_at = ? WHERE id = ?")
            .bind(zeit)
            .bind(ep)
            .execute(&mut *conn)
            .await
            .unwrap();
        start_zeitachse_tx(&mut conn, einsatz, benutzer, ep)
            .await
            .unwrap();
        ep
    }

    async fn zeitachse_folge(
        pool: &SqlitePool,
        einsatz: i64,
        ep: i64,
    ) -> Vec<(String, String, String, bool)> {
        crate::zeitachse::repo::laden(pool, einsatz, crate::zeitachse::repo::Kraft::Person(ep))
            .await
            .unwrap()
            .ereignisse
            .into_iter()
            .map(|e| {
                (
                    e.art.as_str().to_string(),
                    e.zeitpunkt_at,
                    e.quelle.as_str().to_string(),
                    e.gestrichen_at.is_some(),
                )
            })
            .collect()
    }

    /// Spec `kraefte-entlassung` „Zeitachse überlebt Entlassen“: Alarmierung 06:10, Eintreffen
    /// 06:40, entlassen 14:00 — alle drei stehen, die Entlassung mit Quelle `disposition`, und die
    /// Person ist weiter im Einsatz geführt.
    #[tokio::test]
    async fn zeitachse_ueberlebt_entlassen() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz, eingetroffen) = setup_mit_marken(&pool).await;
        let ep = disponiere_zur_zeit(&pool, einsatz, benutzer, "2026-10-13 06:10:00").await;
        {
            let mut conn = pool.acquire().await.unwrap();
            update_tx(
                &mut conn,
                einsatz,
                ep,
                DispositionPatch {
                    status_id: Some(eingetroffen),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            crate::zeitachse::repo::aus_personalstatus_tx(
                &mut conn,
                einsatz,
                benutzer,
                ep,
                eingetroffen,
                "2026-10-13 06:40:00",
            )
            .await
            .unwrap();
        }
        let e = entlasse(&pool, einsatz, ep, benutzer, "2026-10-13 14:00:00")
            .await
            .unwrap();
        assert!(e.zeitachse);
        assert_eq!(
            zeitachse_folge(&pool, einsatz, ep).await,
            vec![
                (
                    "alarmierung".into(),
                    "2026-10-13 06:10:00".into(),
                    "status".into(),
                    false
                ),
                (
                    "eintreffen".into(),
                    "2026-10-13 06:40:00".into(),
                    "status".into(),
                    false
                ),
                (
                    "entlassung".into(),
                    "2026-10-13 14:00:00".into(),
                    "disposition".into(),
                    false
                ),
            ]
        );
        assert_eq!(
            list_entlassene(&pool, einsatz, true).await.unwrap().len(),
            1
        );
    }

    /// Spec „Storno direkt nach dem Disponieren“: das Alarmierungsereignis ist gestrichen, die
    /// Person steht in keiner Liste und keinem Nachweis.
    #[tokio::test]
    async fn storno_streicht_die_disposition_und_blendet_aus() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz, _) = setup_mit_marken(&pool).await;
        let ep = disponiere_zur_zeit(&pool, einsatz, benutzer, "2026-10-13 10:00:00").await;
        storniere(&pool, einsatz, ep, benutzer, "2026-10-13 10:05:00")
            .await
            .unwrap();
        assert_eq!(
            zeitachse_folge(&pool, einsatz, ep).await,
            vec![(
                "alarmierung".into(),
                "2026-10-13 10:00:00".into(),
                "status".into(),
                true
            )]
        );
        let grund: Option<String> = sqlx::query_scalar(
            "SELECT streichgrund FROM einsatz_kraft_zeitachse WHERE personal_id = ?",
        )
        .bind(ep)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(grund.as_deref(), Some(crate::entlassung::GRUND_STORNO));
        assert!(liste(&pool, einsatz, true).await.unwrap().is_empty());
        assert!(list_entlassene(&pool, einsatz, true)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            load_anzeige(&pool, einsatz, ep, true)
                .await
                .unwrap()
                .beendet_als
                .as_deref(),
            Some("storniert")
        );
        assert!(matches!(
            storniere(&pool, einsatz, ep, benutzer, "2026-10-13 10:06:00")
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        assert!(matches!(
            entlasse(&pool, einsatz, ep, benutzer, "2026-10-13 10:06:00")
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    /// Spec „Storno mit Spur“ und „Frist abgelaufen“: 422 mit dem Grund als Satz, und nichts ist
    /// gestrichen oder beendet.
    #[tokio::test]
    async fn storno_mit_spur_oder_nach_der_frist_ist_422() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz, eingetroffen) = setup_mit_marken(&pool).await;

        let eingetroffene =
            disponiere_zur_zeit(&pool, einsatz, benutzer, "2026-10-13 10:00:00").await;
        {
            let mut conn = pool.acquire().await.unwrap();
            crate::zeitachse::repo::aus_personalstatus_tx(
                &mut conn,
                einsatz,
                benutzer,
                eingetroffene,
                eingetroffen,
                "2026-10-13 10:02:00",
            )
            .await
            .unwrap();
        }
        let AppError::UnprocessableEntity(grund) = storniere(
            &pool,
            einsatz,
            eingetroffene,
            benutzer,
            "2026-10-13 10:05:00",
        )
        .await
        .unwrap_err() else {
            panic!("422 erwartet")
        };
        assert!(grund.contains("mehr als die Disposition"), "{grund}");

        let spaet = disponiere_zur_zeit(&pool, einsatz, benutzer, "2026-10-13 10:00:00").await;
        let AppError::UnprocessableEntity(grund) =
            storniere(&pool, einsatz, spaet, benutzer, "2026-10-13 10:20:00")
                .await
                .unwrap_err()
        else {
            panic!("422 erwartet")
        };
        assert!(
            grund.contains("nur in den ersten 15 Minuten nach der Disposition"),
            "{grund}"
        );

        let gebunden = disponiere_zur_zeit(&pool, einsatz, benutzer, "2026-10-13 10:00:00").await;
        let trupp: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Trupp') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
            .bind(trupp)
            .bind(gebunden)
            .execute(&pool)
            .await
            .unwrap();
        let AppError::UnprocessableEntity(grund) =
            storniere(&pool, einsatz, gebunden, benutzer, "2026-10-13 10:05:00")
                .await
                .unwrap_err()
        else {
            panic!("422 erwartet")
        };
        assert!(grund.contains("Einheit"), "{grund}");

        let beendet: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_personal WHERE beendet_at IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(beendet, 0, "abgelehnt heißt: nichts geschrieben");
        let gestrichen: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_kraft_zeitachse WHERE gestrichen_at IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(gestrichen, 0);
    }

    /// Spec „Erneut disponieren“, „Stamm-Person kommt zurück“: dieselbe Zeile wird wieder aktiv
    /// (statt 409 am UNIQUE), mit neuem Initialstatus und einer zweiten Periode.
    #[tokio::test]
    async fn entlassene_stamm_person_kommt_auf_dieselbe_zeile_zurueck() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz, eingetroffen) = setup_mit_marken(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[])
            .await
            .unwrap();
        let erste = disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap();
        assert!(!erste.reaktiviert);
        {
            let mut conn = pool.acquire().await.unwrap();
            sqlx::query("UPDATE einsatz_personal SET disponiert_at = '2026-10-13 06:10:00'")
                .execute(&mut *conn)
                .await
                .unwrap();
            start_zeitachse_tx(&mut conn, einsatz, benutzer, erste.id)
                .await
                .unwrap();
            update_tx(
                &mut conn,
                einsatz,
                erste.id,
                DispositionPatch {
                    status_id: Some(eingetroffen),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        }
        entlasse(&pool, einsatz, erste.id, benutzer, "2026-10-13 14:00:00")
            .await
            .unwrap();

        let zweite = disponieren_stamm(&pool, einsatz, 1, person.id, Some("mannschaft"), benutzer)
            .await
            .unwrap();
        assert_eq!(zweite.id, erste.id, "dieselbe Zeile");
        assert!(zweite.reaktiviert);
        {
            let mut conn = pool.acquire().await.unwrap();
            start_zeitachse_tx(&mut conn, einsatz, benutzer, zweite.id)
                .await
                .unwrap();
        }
        let a = load_anzeige(&pool, einsatz, zweite.id, true).await.unwrap();
        assert_eq!(a.beendet_at, None);
        assert_eq!(a.beendet_als, None);
        assert_eq!(
            a.status_label.as_deref(),
            Some("alarmiert"),
            "Initialstatus neu"
        );
        assert_eq!(a.staerke_position.as_deref(), Some("mannschaft"));
        let perioden = crate::zeitachse::repo::laden(
            &pool,
            einsatz,
            crate::zeitachse::repo::Kraft::Person(zweite.id),
        )
        .await
        .unwrap()
        .perioden;
        assert_eq!(
            perioden.len(),
            2,
            "zweite Periode ab der erneuten Disposition"
        );
        assert!(perioden[1].ende_at.is_none());

        assert!(
            matches!(
                disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
                    .await
                    .unwrap_err(),
                AppError::Conflict(_)
            ),
            "aktiv bleibt 409"
        );
    }

    /// Eine stornierte Ad-hoc-Kraft kommt über `reaktivieren_tx` zurück; ihre gestrichenen
    /// Ereignisse bleiben gestrichen.
    #[tokio::test]
    async fn stornierte_kraft_kommt_zurueck_und_die_streichung_bleibt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz, _) = setup_mit_marken(&pool).await;
        let ep = disponiere_zur_zeit(&pool, einsatz, benutzer, "2026-10-13 10:00:00").await;
        storniere(&pool, einsatz, ep, benutzer, "2026-10-13 10:01:00")
            .await
            .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        reaktivieren_tx(&mut conn, einsatz, 1, ep, None, benutzer)
            .await
            .unwrap();
        start_zeitachse_tx(&mut conn, einsatz, benutzer, ep)
            .await
            .unwrap();
        assert!(matches!(
            reaktivieren_tx(&mut conn, einsatz, 1, ep, None, benutzer)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        drop(conn);
        let folge = zeitachse_folge(&pool, einsatz, ep).await;
        assert_eq!(folge.len(), 2);
        assert!(folge[0].3, "die alte Alarmierung bleibt gestrichen");
        assert!(!folge[1].3, "die neue zählt");
        assert_eq!(liste(&pool, einsatz, true).await.unwrap().len(), 1);
    }

    /// LFH-733 (design.md D2): `ist_demo` folgt der Marke der Stamm-Person, unabhängig von der
    /// Live-oder-Snapshot-Regel; eine Ad-hoc-Person ist nie Demo.
    #[tokio::test]
    async fn ist_demo_folgt_der_stamm_marke() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let demo = p_repo::anlegen(&pool, 1, p_daten("Dora Demo"), &[])
            .await
            .unwrap();
        let echt = p_repo::anlegen(&pool, 1, p_daten("Erna Echt"), &[])
            .await
            .unwrap();
        crate::demo::test_hilfen::demo_markieren(&pool, 1, "personal", demo.id).await;
        // Dieselbe ID unter den anderen Tabellen markiert: ohne den Filter `dh.tabelle`
        // meldete auch echt Demo.
        crate::demo::test_hilfen::demo_markieren(&pool, 1, "fahrzeug", echt.id).await;
        crate::demo::test_hilfen::demo_markieren(&pool, 1, "material", echt.id).await;
        // Erst das echte, dann das Demo-Stück disponieren: so trägt die Disposition des
        // Demo-Stücks eine andere ID als sein Stamm, und `datensatz_id = ep.id` statt
        // `ep.personal_id` fiele auf.
        let ep_echt = disponieren_stamm(&pool, einsatz, 1, echt.id, None, benutzer)
            .await
            .unwrap()
            .id;
        let ep_adhoc = disponieren_adhoc(
            &pool,
            einsatz,
            1,
            AdhocDaten {
                name: "Externe Kraft",
                funktion: None,
                traegerorganisation: None,
                staerke_position: None,
            },
            benutzer,
        )
        .await
        .unwrap();
        let ep_demo = disponieren_stamm(&pool, einsatz, 1, demo.id, None, benutzer)
            .await
            .unwrap()
            .id;
        assert_ne!(ep_demo, demo.id, "Vorbedingung: IDs entkoppelt");

        for einsatz_aktiv in [true, false] {
            let alle = liste(&pool, einsatz, einsatz_aktiv).await.unwrap();
            let marke = |id| alle.iter().find(|a| a.id == id).unwrap().ist_demo;
            assert!(marke(ep_demo), "einsatz_aktiv={einsatz_aktiv}");
            assert!(!marke(ep_echt), "einsatz_aktiv={einsatz_aktiv}");
            assert!(!marke(ep_adhoc), "einsatz_aktiv={einsatz_aktiv}");
        }
        assert!(
            load_anzeige(&pool, einsatz, ep_demo, true)
                .await
                .unwrap()
                .ist_demo
        );
    }

    // ── Einsatzfunktion und Ad-hoc-Angaben (LLH-1067, Spec `personal-einsatzangaben`) ──────

    #[tokio::test]
    async fn einsatzfunktion_setzen_leeren_und_qualifikation_bleibt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let q = qualifikation_repo::anlegen(&pool, 1, "Notfallsanitäter", 5)
            .await
            .unwrap();
        let person = p_repo::anlegen(&pool, 1, p_daten("Max Mustermann"), &[q.id])
            .await
            .unwrap();
        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap()
            .id;
        let vorher = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(vorher.einsatzfunktion, None);

        update(
            &pool,
            einsatz,
            ep,
            DispositionPatch {
                einsatzfunktion: Some(Some("Sprechfunker")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let a = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.einsatzfunktion.as_deref(), Some("Sprechfunker"));
        assert_eq!(
            a.funktion.as_deref(),
            Some("Notfallsanitäter"),
            "Qualifikation bleibt"
        );

        // Fehlend = unverändert.
        update(&pool, einsatz, ep, DispositionPatch::default())
            .await
            .unwrap();
        let b = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(b.einsatzfunktion.as_deref(), Some("Sprechfunker"));

        // `Some(None)` = leeren.
        update(
            &pool,
            einsatz,
            ep,
            DispositionPatch {
                einsatzfunktion: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let c = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(c.einsatzfunktion, None);
    }

    #[tokio::test]
    async fn adhoc_angaben_aenderbar() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let ep = disponieren_adhoc(
            &pool,
            einsatz,
            1,
            AdhocDaten {
                name: "Maier",
                funktion: Some("Sanitäter"),
                traegerorganisation: Some("ASB"),
                staerke_position: None,
            },
            benutzer,
        )
        .await
        .unwrap();
        update(
            &pool,
            einsatz,
            ep,
            DispositionPatch {
                name: Some("Meier"),
                funktion: Some(Some("Rettungssanitäter")),
                traegerorganisation: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let a = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.name, "Meier");
        assert_eq!(a.funktion.as_deref(), Some("Rettungssanitäter"));
        assert_eq!(a.traegerorganisation, None);
    }

    #[tokio::test]
    async fn stamm_person_lehnt_adhoc_angaben_ab_ohne_zu_schreiben() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Max Mustermann"), &[])
            .await
            .unwrap();
        let ep = disponieren_stamm(&pool, einsatz, 1, person.id, None, benutzer)
            .await
            .unwrap()
            .id;
        for patch in [
            DispositionPatch {
                name: Some("Moritz"),
                einsatzfunktion: Some(Some("Melder")),
                ..Default::default()
            },
            DispositionPatch {
                funktion: Some(None),
                ..Default::default()
            },
            DispositionPatch {
                traegerorganisation: Some(Some("THW")),
                ..Default::default()
            },
        ] {
            let fehler = update(&pool, einsatz, ep, patch).await.unwrap_err();
            assert!(
                matches!(&fehler, AppError::UnprocessableEntity(m) if m.contains("im Stamm pflegen")),
                "{fehler:?}"
            );
        }
        let a = load_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.name, "Max Mustermann");
        assert_eq!(a.einsatzfunktion, None, "nichts geschrieben");
        assert_eq!(a.traegerorganisation.as_deref(), Some("DRK"));
    }
}
