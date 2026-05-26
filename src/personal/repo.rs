use super::{Personal, PersonalAnzeige, PersonalVorschlaege, QualifikationRef};
use crate::error::AppError;
use crate::katalog::{DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};
use sqlx::SqlitePool;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Personal` (FromRow).
const SPALTEN: &str = "id, org_id, benutzer_id, name, personalnummer, traegerorganisation, \
     telefon, staerke_position, bemerkung, dienststatus, angelegt_at";

/// Editierbare Stammfelder. Optional-Strings sind bereits getrimmt (leer → `None`),
/// `staerke_position` bereits gegen das Enum validiert.
#[derive(Debug)]
pub struct PersonalDaten<'a> {
    pub name: &'a str,
    pub benutzer_id: Option<i64>,
    pub personalnummer: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub telefon: Option<&'a str>,
    pub staerke_position: Option<&'a str>,
    pub bemerkung: Option<&'a str>,
}

/// Übersetzt einen Unique-Verstoß auf einem der beiden partiellen Indizes der
/// `personal`-Tabelle (`idx_personal_personalnummer`, `idx_personal_benutzer`) in
/// die passende `Conflict`-Meldung. Da `personal` zwei Unique-Indizes hat (und der
/// Benutzer-Link trotz Vorab-Check durch eine Race zwischen `pruefe_benutzer_link`
/// und dem Commit feuern kann), wird anhand der SQLite-Fehlermeldung unterschieden.
/// SQLite nennt in `UNIQUE constraint failed: ...` die verletzten Spalten (nicht
/// den Indexnamen), daher wird auf die Spalte `personal.benutzer_id` geprüft;
/// alles andere ist die Personalnummer.
fn unique_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            let text = if db.message().contains("personal.benutzer_id") {
                "Benutzerkonto ist bereits mit Personal verknüpft"
            } else {
                "Personalnummer ist in dieser Organisation bereits vergeben"
            };
            return Err(AppError::Conflict(text.into()));
        }
    }
    Err(e.into())
}

/// Validiert den optionalen Benutzer-Link: Konto muss zur Org gehören
/// (`Validation`) und darf nicht schon mit einer anderen Person verknüpft sein
/// (`Conflict`). `eigene_id` schließt die zu aktualisierende Person aus.
async fn pruefe_benutzer_link(
    pool: &SqlitePool,
    org_id: i64,
    benutzer_id: i64,
    eigene_id: Option<i64>,
) -> Result<(), AppError> {
    let gehoert: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM benutzer WHERE id = ? AND org_id = ?")
            .bind(benutzer_id).bind(org_id).fetch_optional(pool).await?;
    if gehoert.is_none() {
        return Err(AppError::Validation("Benutzerkonto gehört nicht zur Organisation".into()));
    }
    let belegt: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM personal WHERE benutzer_id = ? AND org_id = ? AND (? IS NULL OR id <> ?)",
    )
    .bind(benutzer_id).bind(org_id).bind(eigene_id).bind(eigene_id).fetch_optional(pool).await?;
    if belegt.is_some() {
        return Err(AppError::Conflict("Benutzerkonto ist bereits mit Personal verknüpft".into()));
    }
    Ok(())
}

/// Setzt die Qualifikations-Zuordnung einer Person als Vollersatz (löscht alle und
/// fügt die übergebenen wieder ein). Org-geschützt: nur ids, die zur Org gehören,
/// werden eingefügt (unbekannte/fremde werden still ignoriert — die UI bietet
/// ohnehin nur eigene Qualifikationen an).
async fn setze_qualifikationen(
    tx: &mut sqlx::SqliteConnection,
    org_id: i64,
    personal_id: i64,
    qualifikation_ids: &[i64],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM personal_qualifikation WHERE personal_id = ?")
        .bind(personal_id).execute(&mut *tx).await?;
    for &qid in qualifikation_ids {
        sqlx::query(
            "INSERT OR IGNORE INTO personal_qualifikation (personal_id, qualifikation_id) \
             SELECT ?, id FROM qualifikation WHERE id = ? AND org_id = ?",
        )
        .bind(personal_id).bind(qid).bind(org_id).execute(&mut *tx).await?;
    }
    Ok(())
}

/// Lädt eine Person der eigenen Org (roh); `NotFound` bei fremder/unbekannter id.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Personal, AppError> {
    sqlx::query_as::<_, Personal>(&format!(
        "SELECT {SPALTEN} FROM personal WHERE id = ? AND org_id = ?"
    ))
    .bind(id).bind(org_id).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

/// Qualifikationen einer Person (inkl. deaktivierter Zuordnungen), nach `sortier`.
async fn qualifikationen_von(
    pool: &SqlitePool,
    personal_id: i64,
) -> Result<Vec<QualifikationRef>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String)>(
        "SELECT q.id, q.label FROM personal_qualifikation pq \
         JOIN qualifikation q ON q.id = pq.qualifikation_id \
         WHERE pq.personal_id = ? ORDER BY q.sortier, q.id",
    )
    .bind(personal_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(id, label)| QualifikationRef { id, label }).collect())
}

/// Person als Anzeige (inkl. aufgelöster Qualifikationen). `NotFound` bei fremder id.
pub async fn laden_anzeige(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
) -> Result<PersonalAnzeige, AppError> {
    let p = laden(pool, org_id, id).await?;
    let qualifikationen = qualifikationen_von(pool, id).await?;
    Ok(zu_anzeige(p, qualifikationen))
}

/// Baut die Anzeige aus dem Rohdatensatz + aufgelösten Qualifikationen.
fn zu_anzeige(p: Personal, qualifikationen: Vec<QualifikationRef>) -> PersonalAnzeige {
    PersonalAnzeige {
        id: p.id,
        benutzer_id: p.benutzer_id,
        name: p.name,
        personalnummer: p.personalnummer,
        traegerorganisation: p.traegerorganisation,
        telefon: p.telefon,
        staerke_position: p.staerke_position,
        bemerkung: p.bemerkung,
        dienststatus: p.dienststatus,
        angelegt_at: p.angelegt_at,
        qualifikationen,
    }
}

/// Alle Personen der Org (Anzeige), sortiert nach Name; `nur_im_dienst` filtert
/// auf `dienststatus = 'in_dienst'` (Dispositions-Auswahl). Lädt Qualifikationen in
/// einer zweiten Sammelabfrage (kein N+1).
pub async fn liste_anzeige(
    pool: &SqlitePool,
    org_id: i64,
    nur_im_dienst: bool,
) -> Result<Vec<PersonalAnzeige>, AppError> {
    let sql = if nur_im_dienst {
        format!("SELECT {SPALTEN} FROM personal WHERE org_id = ? AND dienststatus = 'in_dienst' ORDER BY name")
    } else {
        format!("SELECT {SPALTEN} FROM personal WHERE org_id = ? ORDER BY name")
    };
    let personen = sqlx::query_as::<_, Personal>(&sql).bind(org_id).fetch_all(pool).await?;

    // Alle Qualifikations-Zuordnungen der Org in einer Abfrage holen und gruppieren.
    let zuordnungen = sqlx::query_as::<_, (i64, i64, String)>(
        "SELECT pq.personal_id, q.id, q.label FROM personal_qualifikation pq \
         JOIN qualifikation q ON q.id = pq.qualifikation_id \
         JOIN personal p ON p.id = pq.personal_id \
         WHERE p.org_id = ? ORDER BY q.sortier, q.id",
    )
    .bind(org_id).fetch_all(pool).await?;

    Ok(personen
        .into_iter()
        .map(|p| {
            let quals = zuordnungen
                .iter()
                .filter(|(pid, _, _)| *pid == p.id)
                .map(|(_, qid, label)| QualifikationRef { id: *qid, label: label.clone() })
                .collect();
            zu_anzeige(p, quals)
        })
        .collect())
}

/// DISTINCT Trägerorganisationen der Org (nicht-leer, sortiert) für die AutoComplete.
pub async fn vorschlaege(pool: &SqlitePool, org_id: i64) -> Result<PersonalVorschlaege, AppError> {
    let traegerorganisation = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT traegerorganisation FROM personal \
         WHERE org_id = ? AND traegerorganisation IS NOT NULL AND traegerorganisation <> '' \
         ORDER BY traegerorganisation",
    )
    .bind(org_id).fetch_all(pool).await?;
    Ok(PersonalVorschlaege { traegerorganisation })
}

/// Legt eine Person an (mit optionaler Qualifikations-Zuordnung). Validiert den
/// Benutzer-Link; Personalnummer-Dublette → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: PersonalDaten<'_>,
    qualifikation_ids: &[i64],
) -> Result<Personal, AppError> {
    if let Some(bid) = daten.benutzer_id {
        pruefe_benutzer_link(pool, org_id, bid, None).await?;
    }
    let mut tx = pool.begin().await?;
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO personal \
            (org_id, benutzer_id, name, personalnummer, traegerorganisation, telefon, \
             staerke_position, bemerkung) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.benutzer_id)
    .bind(daten.name)
    .bind(daten.personalnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.telefon)
    .bind(daten.staerke_position)
    .bind(daten.bemerkung)
    .fetch_one(&mut *tx)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return unique_conflict(e),
    };
    setze_qualifikationen(&mut tx, org_id, id, qualifikation_ids).await?;
    tx.commit().await?;
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder + Qualifikations-Zuordnung (org-scoped).
/// `NotFound` bei fremder Org; `Validation`/`Conflict` für den Benutzer-Link;
/// `Conflict` bei Personalnummer-Dublette.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: PersonalDaten<'_>,
    qualifikation_ids: &[i64],
) -> Result<Personal, AppError> {
    // Existenz/Org sicherstellen (sonst NotFound statt stiller No-Op).
    laden(pool, org_id, id).await?;
    if let Some(bid) = daten.benutzer_id {
        pruefe_benutzer_link(pool, org_id, bid, Some(id)).await?;
    }
    let mut tx = pool.begin().await?;
    let ergebnis = sqlx::query(
        "UPDATE personal SET \
            benutzer_id = ?, name = ?, personalnummer = ?, traegerorganisation = ?, \
            telefon = ?, staerke_position = ?, bemerkung = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.benutzer_id)
    .bind(daten.name)
    .bind(daten.personalnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.telefon)
    .bind(daten.staerke_position)
    .bind(daten.bemerkung)
    .bind(id)
    .bind(org_id)
    .execute(&mut *tx)
    .await;

    if let Err(e) = ergebnis {
        return unique_conflict(e);
    }
    setze_qualifikationen(&mut tx, org_id, id, qualifikation_ids).await?;
    tx.commit().await?;
    laden(pool, org_id, id).await
}

/// Setzt den Dienststatus (Soft-Delete bzw. Reaktivierung). `NotFound` bei fremder
/// Org; `Conflict`, wenn beim Reaktivieren die Personalnummer inzwischen aktiv vergeben ist.
pub async fn setze_dienststatus(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    in_dienst: bool,
) -> Result<Personal, AppError> {
    let neuer = if in_dienst { DIENSTSTATUS_IN_DIENST } else { DIENSTSTATUS_AUSSER_DIENST };
    let ergebnis = sqlx::query("UPDATE personal SET dienststatus = ? WHERE id = ? AND org_id = ?")
        .bind(neuer).bind(id).bind(org_id).execute(pool).await;
    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return unique_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id).execute(pool).await.unwrap();
    }

    /// Legt einen Benutzer in einer Org an und liefert dessen id.
    async fn benutzer(pool: &SqlitePool, org_id: i64, name: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (?, ?, ?, 'h') RETURNING id",
        )
        .bind(org_id).bind(name).bind(name).fetch_one(pool).await.unwrap()
    }

    fn daten(name: &str) -> PersonalDaten<'_> {
        PersonalDaten {
            name,
            benutzer_id: None,
            personalnummer: None,
            traegerorganisation: None,
            telefon: None,
            staerke_position: None,
            bemerkung: None,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden_anzeige() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Thomas Müller");
        d.staerke_position = Some("fuehrer"); // Repo validiert die Position nicht (das macht die Route)
        let p = anlegen(&pool, 1, d, &[]).await.unwrap();
        let a = laden_anzeige(&pool, 1, p.id).await.unwrap();
        assert_eq!(a.name, "Thomas Müller");
        assert_eq!(a.staerke_position.as_deref(), Some("fuehrer"));
        assert_eq!(a.dienststatus, "in_dienst");
    }

    #[tokio::test]
    async fn namens_dubletten_erlaubt_personalnummer_dublette_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut a = daten("Thomas Müller");
        a.personalnummer = Some("4711");
        anlegen(&pool, 1, a, &[]).await.unwrap();
        // gleicher Name, KEINE Nummer → erlaubt (Namen sind nicht eindeutig).
        anlegen(&pool, 1, daten("Thomas Müller"), &[]).await.unwrap();
        // gleiche Personalnummer (unter aktiven) → Conflict.
        let mut dup = daten("Anders Anders");
        dup.personalnummer = Some("4711");
        assert!(matches!(anlegen(&pool, 1, dup, &[]).await.unwrap_err(), AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn personalnummer_je_org_unabhaengig_und_null_mehrfach() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let mut a = daten("A");
        a.personalnummer = Some("1");
        anlegen(&pool, 1, a, &[]).await.unwrap();
        let mut b = daten("B");
        b.personalnummer = Some("1");
        assert!(anlegen(&pool, 2, b, &[]).await.is_ok(), "andere Org unabhängig");
        // mehrere ohne Nummer in derselben Org erlaubt.
        anlegen(&pool, 1, daten("C"), &[]).await.unwrap();
        anlegen(&pool, 1, daten("D"), &[]).await.unwrap();
    }

    #[tokio::test]
    async fn benutzer_link_fremde_org_ist_validation_belegt_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let fremd = benutzer(&pool, 2, "fremd").await;
        let mut d = daten("X");
        d.benutzer_id = Some(fremd);
        assert!(matches!(anlegen(&pool, 1, d, &[]).await.unwrap_err(), AppError::Validation(_)));

        let eigen = benutzer(&pool, 1, "eigen").await;
        let mut ok = daten("Y");
        ok.benutzer_id = Some(eigen);
        anlegen(&pool, 1, ok, &[]).await.unwrap();
        // dasselbe Konto erneut → Conflict.
        let mut zwei = daten("Z");
        zwei.benutzer_id = Some(eigen);
        assert!(matches!(anlegen(&pool, 1, zwei, &[]).await.unwrap_err(), AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn soft_delete_versteckt_aus_nur_im_dienst_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let p = anlegen(&pool, 1, daten("Thomas"), &[]).await.unwrap();
        setze_dienststatus(&pool, 1, p.id, false).await.unwrap();
        assert!(liste_anzeige(&pool, 1, true).await.unwrap().is_empty(), "nicht in nur_im_dienst");
        assert_eq!(liste_anzeige(&pool, 1, false).await.unwrap().len(), 1, "aber referenzierbar");
        assert_eq!(laden(&pool, 1, p.id).await.unwrap().dienststatus, "ausser_dienst");
    }

    #[tokio::test]
    async fn reaktivieren_auf_vergebene_personalnummer_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut alt = daten("Alt");
        alt.personalnummer = Some("7");
        let alt = anlegen(&pool, 1, alt, &[]).await.unwrap();
        setze_dienststatus(&pool, 1, alt.id, false).await.unwrap();
        // Nummer inzwischen neu vergeben.
        let mut neu = daten("Neu");
        neu.personalnummer = Some("7");
        anlegen(&pool, 1, neu, &[]).await.unwrap();
        // Reaktivieren des alten kollidiert.
        assert!(matches!(
            setze_dienststatus(&pool, 1, alt.id, true).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn qualifikations_zuordnung_vollersatz_inkl_deaktivierter_sichtbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let q1: i64 = sqlx::query_scalar("INSERT INTO qualifikation (org_id, label, sortier) VALUES (1, 'Sanitäter', 10) RETURNING id").fetch_one(&pool).await.unwrap();
        let q2: i64 = sqlx::query_scalar("INSERT INTO qualifikation (org_id, label, sortier) VALUES (1, 'Gruppenführer', 20) RETURNING id").fetch_one(&pool).await.unwrap();
        let p = anlegen(&pool, 1, daten("Thomas"), &[q1, q2]).await.unwrap();
        let a = laden_anzeige(&pool, 1, p.id).await.unwrap();
        assert_eq!(a.qualifikationen.iter().map(|q| q.label.as_str()).collect::<Vec<_>>(), vec!["Sanitäter", "Gruppenführer"]);

        // q2 deaktivieren → bleibt in bestehender Zuordnung sichtbar.
        sqlx::query("UPDATE qualifikation SET aktiv = 0 WHERE id = ?").bind(q2).execute(&pool).await.unwrap();
        let a2 = laden_anzeige(&pool, 1, p.id).await.unwrap();
        assert!(a2.qualifikationen.iter().any(|q| q.id == q2), "deaktivierte Qualifikation bleibt sichtbar");

        // Vollersatz auf nur q1.
        aktualisiere(&pool, 1, p.id, daten("Thomas"), &[q1]).await.unwrap();
        let a3 = laden_anzeige(&pool, 1, p.id).await.unwrap();
        assert_eq!(a3.qualifikationen.len(), 1);
        assert_eq!(a3.qualifikationen[0].id, q1);
    }

    #[tokio::test]
    async fn vorschlaege_distinct_traeger() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut a = daten("A");
        a.traegerorganisation = Some("DRK");
        anlegen(&pool, 1, a, &[]).await.unwrap();
        let mut b = daten("B");
        b.traegerorganisation = Some("DRK");
        anlegen(&pool, 1, b, &[]).await.unwrap();
        let mut c = daten("C");
        c.traegerorganisation = Some("THW");
        anlegen(&pool, 1, c, &[]).await.unwrap();
        let v = vorschlaege(&pool, 1).await.unwrap();
        assert_eq!(v.traegerorganisation, vec!["DRK".to_string(), "THW".to_string()]);
    }
}
