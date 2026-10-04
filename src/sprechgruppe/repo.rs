use super::{Sprechgruppe, SprechgruppeAnzeige};
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Sprechgruppe` (FromRow).
const SPALTEN: &str =
    "id, org_id, einsatz_id, bezeichnung, betriebsart, hinweis, aktiv, sortier, angelegt_at";

/// Editierbare Katalog-Felder einer Sprechgruppe.
#[derive(Debug)]
pub struct KatalogDaten<'a> {
    pub bezeichnung: &'a str,
    pub betriebsart: &'a str,
    pub hinweis: Option<&'a str>,
    pub sortier: i64,
}

/// Übersetzt einen Unique-Verstoß auf dem Katalog-Index in `Conflict`.
fn sprechgruppe_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Sprechgruppe mit dieser Bezeichnung und Betriebsart ist in dieser Organisation bereits aktiv".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt eine Sprechgruppe der eigenen Org; `NotFound`, falls unbekannt oder fremde Org.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Sprechgruppe, AppError> {
    sqlx::query_as::<_, Sprechgruppe>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM sprechgruppe WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Alle Katalog-Sprechgruppen der Org (`einsatz_id IS NULL`), sortiert nach
/// `betriebsart, sortier, bezeichnung`. `nur_aktive` filtert auf `aktiv = 1`.
pub async fn liste_katalog(
    pool: &SqlitePool,
    org_id: i64,
    nur_aktive: bool,
) -> Result<Vec<Sprechgruppe>, AppError> {
    let sql = if nur_aktive {
        format!(
            "SELECT {SPALTEN} FROM sprechgruppe \
             WHERE org_id = ? AND einsatz_id IS NULL AND aktiv = 1 \
             ORDER BY betriebsart, sortier, bezeichnung"
        )
    } else {
        format!(
            "SELECT {SPALTEN} FROM sprechgruppe \
             WHERE org_id = ? AND einsatz_id IS NULL \
             ORDER BY betriebsart, sortier, bezeichnung"
        )
    };
    sqlx::query_as::<_, Sprechgruppe>(sqlx::AssertSqlSafe(&*sql))
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Legt eine Katalog-Sprechgruppe an (`einsatz_id` bleibt NULL).
/// Dublette (org_id, betriebsart, bezeichnung) unter aktiven → `Conflict`.
pub async fn anlegen_katalog(
    pool: &SqlitePool,
    org_id: i64,
    daten: KatalogDaten<'_>,
) -> Result<Sprechgruppe, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart, hinweis, sortier) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.bezeichnung)
    .bind(daten.betriebsart)
    .bind(daten.hinweis)
    .bind(daten.sortier)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return sprechgruppe_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Teil-Patch (Tri-State): äußere `Option` = „im Patch?“; bei der nullable Spalte `hinweis`
/// setzt `Some(None)` NULL.
#[derive(Debug, Default)]
pub struct KatalogPatch<'a> {
    pub bezeichnung: Option<&'a str>,
    pub betriebsart: Option<&'a str>,
    pub hinweis: Option<Option<&'a str>>,
    pub sortier: Option<i64>,
}

/// Teil-Patch einer Katalog-Sprechgruppe (org-scoped, `einsatz_id IS NULL`). `NotFound` bei
/// fremder Org oder einsatz-lokaler Sprechgruppe, `Conflict` bei Dublette.
///
/// Flag/Wert-Paare statt Vollersatz: so lässt sich `hinweis` wieder auf NULL setzen, und ein
/// nicht gesendetes Feld (etwa `sortier`, das das Formular nicht mitschickt) bleibt stehen.
/// Nummerierte Parameter, damit eine verschobene Bind-Kette `bezeichnung`↔`betriebsart` nicht
/// still vertauscht (`patche_katalog_setzt_jede_spalte_an_ihren_platz`).
pub async fn patche_katalog(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    patch: KatalogPatch<'_>,
) -> Result<Sprechgruppe, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE sprechgruppe SET \
            bezeichnung = CASE WHEN ?1 IS NULL THEN bezeichnung ELSE ?2 END, \
            betriebsart = CASE WHEN ?3 IS NULL THEN betriebsart ELSE ?4 END, \
            hinweis = CASE WHEN ?5 IS NULL THEN hinweis ELSE ?6 END, \
            sortier = CASE WHEN ?7 IS NULL THEN sortier ELSE ?8 END \
         WHERE id = ?9 AND org_id = ?10 AND einsatz_id IS NULL",
    )
    .bind(patch.bezeichnung.map(|_| 1_i64))
    .bind(patch.bezeichnung)
    .bind(patch.betriebsart.map(|_| 1_i64))
    .bind(patch.betriebsart)
    .bind(patch.hinweis.map(|_| 1_i64))
    .bind(patch.hinweis.and_then(|v| v))
    .bind(patch.sortier.map(|_| 1_i64))
    .bind(patch.sortier)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return sprechgruppe_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Legt eine einsatz-lokale Sprechgruppe an, idempotent: trifft die Zeile den Unique-Index
/// `(einsatz_id, betriebsart, bezeichnung)`, kommt der vorhandene Eintrag zurück.
pub async fn anlegen_einsatz_lokal(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    bezeichnung: &str,
    betriebsart: &str,
    hinweis: Option<&str>,
) -> Result<Sprechgruppe, AppError> {
    sqlx::query(
        "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart, hinweis) \
         VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
    )
    .bind(org_id)
    .bind(einsatz_id)
    .bind(bezeichnung)
    .bind(betriebsart)
    .bind(hinweis)
    .execute(pool)
    .await?;

    let sg = sqlx::query_as::<_, Sprechgruppe>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM sprechgruppe \
         WHERE org_id = ? AND einsatz_id = ? AND betriebsart = ? AND bezeichnung = ?",
    )))
    .bind(org_id)
    .bind(einsatz_id)
    .bind(betriebsart)
    .bind(bezeichnung)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(sg)
}

/// Gibt den aktiven Katalog (`einsatz_id IS NULL AND aktiv = 1`) **plus** alle
/// einsatz-lokalen Sprechgruppen dieses Einsatzes zurück, sortiert nach
/// `betriebsart, sortier, bezeichnung`.
pub async fn liste_fuer_einsatz(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
) -> Result<Vec<Sprechgruppe>, AppError> {
    sqlx::query_as::<_, Sprechgruppe>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM sprechgruppe \
         WHERE org_id = ? AND (einsatz_id IS NULL AND aktiv = 1 OR einsatz_id = ?) \
         ORDER BY betriebsart, sortier, bezeichnung",
    )))
    .bind(org_id)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Prüft, ob alle `ids` zur `org_id` als Katalog-Eintrag (`einsatz_id IS NULL`)
/// **oder** als einsatz-lokale Sprechgruppe mit genau diesem `einsatz_id` gehören.
/// Jede ID, die diese Bedingung nicht erfüllt, ergibt `UnprocessableEntity`.
pub(crate) async fn pruefe_zuordenbar(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    for &id in ids {
        let ok: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM sprechgruppe \
             WHERE id = ? AND org_id = ? AND (einsatz_id IS NULL OR einsatz_id = ?)",
        )
        .bind(id)
        .bind(org_id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
        if ok.is_none() {
            return Err(AppError::UnprocessableEntity(format!(
                "Sprechgruppe {id} ist für diese Organisation/diesen Einsatz nicht zuordenbar"
            )));
        }
    }
    Ok(())
}

/// Wer eine Sprechgruppe trägt (Zuordnungen aus 0073 und 0145). Eine Zuordnung entsteht und
/// vergeht für alle Wege — PATCH mit `sprechgruppe_ids` als ganze Menge und die Einzel-Endpunkte
/// `PUT/DELETE …/sprechgruppen/{sg}` (LFH-893, design.md D5) — nur über [`zuordnen_tx`] und
/// [`loesen_tx`]. Die IDs prüft der Aufrufer vorher ([`pruefe_zuordenbar`]); dass der Datensatz
/// zum Einsatz gehört, ebenfalls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Zuordnungsziel {
    Abschnitt(i64),
    Einheit(i64),
    /// Die eigene Führungsstelle; die id ist die des Einsatzes.
    Fuehrungsstelle(i64),
}

impl Zuordnungsziel {
    /// Tabelle, Bezugsspalte und Bezugs-id. Compile-time-Konstanten → `AssertSqlSafe` sicher.
    fn ort(self) -> (&'static str, &'static str, i64) {
        match self {
            Zuordnungsziel::Abschnitt(id) => ("einsatzabschnitt_sprechgruppe", "abschnitt_id", id),
            Zuordnungsziel::Einheit(id) => ("einsatz_einheit_sprechgruppe", "einheit_id", id),
            Zuordnungsziel::Fuehrungsstelle(id) => {
                ("einsatz_fuehrungsstelle_sprechgruppe", "einsatz_id", id)
            }
        }
    }
}

/// Ordnet dem Ziel eine Sprechgruppe zu, idempotent. `true`, wenn die Zuordnung neu ist.
pub async fn zuordnen_tx(
    conn: &mut SqliteConnection,
    ziel: Zuordnungsziel,
    sprechgruppe_id: i64,
) -> Result<bool, AppError> {
    let (tabelle, spalte, bezug) = ziel.ort();
    let r = sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT OR IGNORE INTO {tabelle} ({spalte}, sprechgruppe_id) VALUES (?, ?)"
    )))
    .bind(bezug)
    .bind(sprechgruppe_id)
    .execute(&mut *conn)
    .await?;
    Ok(r.rows_affected() > 0)
}

/// Löst eine Zuordnung, idempotent. `true`, wenn es sie gab.
pub async fn loesen_tx(
    conn: &mut SqliteConnection,
    ziel: Zuordnungsziel,
    sprechgruppe_id: i64,
) -> Result<bool, AppError> {
    let (tabelle, spalte, bezug) = ziel.ort();
    let r = sqlx::query(sqlx::AssertSqlSafe(format!(
        "DELETE FROM {tabelle} WHERE {spalte} = ? AND sprechgruppe_id = ?"
    )))
    .bind(bezug)
    .bind(sprechgruppe_id)
    .execute(&mut *conn)
    .await?;
    Ok(r.rows_affected() > 0)
}

/// Ersetzt die Zuordnung des Ziels durch genau `ids` (PATCH mit `sprechgruppe_ids`): löst, was
/// nicht mehr dazugehört, und ordnet jede ID über [`zuordnen_tx`] zu.
pub async fn ersetzen_tx(
    conn: &mut SqliteConnection,
    ziel: Zuordnungsziel,
    ids: &[i64],
) -> Result<(), AppError> {
    let (tabelle, spalte, bezug) = ziel.ort();
    let vorhanden: Vec<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT sprechgruppe_id FROM {tabelle} WHERE {spalte} = ?"
    )))
    .bind(bezug)
    .fetch_all(&mut *conn)
    .await?;
    for sg in vorhanden.into_iter().filter(|sg| !ids.contains(sg)) {
        loesen_tx(conn, ziel, sg).await?;
    }
    for &id in ids {
        zuordnen_tx(conn, ziel, id).await?;
    }
    Ok(())
}

/// Prüft, dass das Ziel zum Einsatz gehört; fremd oder unbekannt → 404.
async fn pruefe_ziel(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ziel: Zuordnungsziel,
) -> Result<(), AppError> {
    let (sql, id) = match ziel {
        Zuordnungsziel::Abschnitt(id) => (
            "SELECT 1 FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?",
            id,
        ),
        Zuordnungsziel::Einheit(id) => (
            "SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
            id,
        ),
        Zuordnungsziel::Fuehrungsstelle(id) if id == einsatz_id => return Ok(()),
        Zuordnungsziel::Fuehrungsstelle(_) => return Err(AppError::NotFound),
    };
    let da: Option<i64> = sqlx::query_scalar(sql)
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
    da.map(|_| ()).ok_or(AppError::NotFound)
}

/// Einzel-Zuordnung `PUT …/sprechgruppen/{sg}` (LFH-893, design.md D5): dieselbe Prüfung wie der
/// PATCH ([`pruefe_zuordenbar`], 422) und dieselbe Zuordnung ([`zuordnen_tx`]). Idempotent;
/// `true`, wenn die Zuordnung neu ist. Ein fremdes Ziel ist 404.
pub async fn einzeln_zuordnen(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    ziel: Zuordnungsziel,
    sprechgruppe_id: i64,
) -> Result<bool, AppError> {
    // Erst das Ziel (404), dann die Sprechgruppe (422) — und das Ziel in der Transaktion noch
    // einmal, gegen ein gleichzeitiges Löschen.
    pruefe_ziel(&mut *pool.acquire().await?, einsatz_id, ziel).await?;
    pruefe_zuordenbar(pool, org_id, einsatz_id, &[sprechgruppe_id]).await?;
    crate::write_retry!(pool, |conn| {
        pruefe_ziel(conn, einsatz_id, ziel).await?;
        zuordnen_tx(conn, ziel, sprechgruppe_id).await
    })
}

/// Einzel-Lösung `DELETE …/sprechgruppen/{sg}`: idempotent über [`loesen_tx`]; `true`, wenn es
/// die Zuordnung gab. Ein fremdes Ziel ist 404.
pub async fn einzeln_loesen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ziel: Zuordnungsziel,
    sprechgruppe_id: i64,
) -> Result<bool, AppError> {
    crate::write_retry!(pool, |conn| {
        pruefe_ziel(conn, einsatz_id, ziel).await?;
        loesen_tx(conn, ziel, sprechgruppe_id).await
    })
}

/// Ersetzt die Sprechgruppen-Zuordnung eines Abschnitts vollständig.
/// Validiert jede ID gegen `org_id`/`einsatz_id` — fremde oder falsche Einsätze → `UnprocessableEntity`.
pub async fn setze_abschnitt_sprechgruppen(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    abschnitt_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    pruefe_zuordenbar(pool, org_id, einsatz_id, ids).await?;
    let mut tx = pool.begin().await?;
    ersetzen_tx(&mut tx, Zuordnungsziel::Abschnitt(abschnitt_id), ids).await?;
    tx.commit().await?;
    Ok(())
}

/// Lädt alle Sprechgruppen eines Abschnitts, sortiert nach `betriebsart, sortier, bezeichnung`.
pub async fn lade_abschnitt_sprechgruppen(
    pool: &SqlitePool,
    abschnitt_id: i64,
) -> Result<Vec<Sprechgruppe>, AppError> {
    sqlx::query_as::<_, Sprechgruppe>(
        "SELECT sg.id, sg.org_id, sg.einsatz_id, sg.bezeichnung, sg.betriebsart, \
                sg.hinweis, sg.aktiv, sg.sortier, sg.angelegt_at \
         FROM sprechgruppe sg \
         JOIN einsatzabschnitt_sprechgruppe eas ON eas.sprechgruppe_id = sg.id \
         WHERE eas.abschnitt_id = ? \
         ORDER BY sg.betriebsart, sg.sortier, sg.bezeichnung",
    )
    .bind(abschnitt_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Zeile der Sprechgruppen-Sammelabfragen: eine Sprechgruppe samt der Einheit bzw.
/// dem Abschnitt, an der/dem sie hängt.
#[derive(sqlx::FromRow)]
struct SprechgruppeMitBezug {
    bezug_id: i64,
    #[sqlx(flatten)]
    sprechgruppe: Sprechgruppe,
}

/// Ersetzt die Sprechgruppen-Zuordnung einer Einheit vollständig.
/// Validiert jede ID gegen `org_id`/`einsatz_id` — fremde oder falsche Einsätze → `UnprocessableEntity`.
pub async fn setze_einheit_sprechgruppen(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    einheit_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    pruefe_zuordenbar(pool, org_id, einsatz_id, ids).await?;
    let mut tx = pool.begin().await?;
    ersetzen_tx(&mut tx, Zuordnungsziel::Einheit(einheit_id), ids).await?;
    tx.commit().await?;
    Ok(())
}

/// Lädt alle Sprechgruppen einer Einheit, sortiert nach `betriebsart, sortier, bezeichnung`.
pub async fn lade_einheit_sprechgruppen(
    pool: &SqlitePool,
    einheit_id: i64,
) -> Result<Vec<Sprechgruppe>, AppError> {
    sqlx::query_as::<_, Sprechgruppe>(
        "SELECT sg.id, sg.org_id, sg.einsatz_id, sg.bezeichnung, sg.betriebsart, \
                sg.hinweis, sg.aktiv, sg.sortier, sg.angelegt_at \
         FROM sprechgruppe sg \
         JOIN einsatz_einheit_sprechgruppe ees ON ees.sprechgruppe_id = sg.id \
         WHERE ees.einheit_id = ? \
         ORDER BY sg.betriebsart, sg.sortier, sg.bezeichnung",
    )
    .bind(einheit_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Sprechgruppen ALLER Einheiten eines Einsatzes in EINER Abfrage, je `einheit_id`; Einheiten
/// ohne Zuordnung fehlen. Das globale `ORDER BY` erhält die Sortierung je Gruppe wie
/// `lade_einheit_sprechgruppen`.
pub async fn lade_einheit_sprechgruppen_map(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<HashMap<i64, Vec<SprechgruppeAnzeige>>, AppError> {
    let zeilen = sqlx::query_as::<_, SprechgruppeMitBezug>(
        "SELECT ees.einheit_id AS bezug_id, \
                sg.id AS id, sg.org_id AS org_id, sg.einsatz_id AS einsatz_id, \
                sg.bezeichnung AS bezeichnung, sg.betriebsart AS betriebsart, \
                sg.hinweis AS hinweis, sg.aktiv AS aktiv, sg.sortier AS sortier, \
                sg.angelegt_at AS angelegt_at \
         FROM sprechgruppe sg \
         JOIN einsatz_einheit_sprechgruppe ees ON ees.sprechgruppe_id = sg.id \
         JOIN einsatz_einheit e ON e.id = ees.einheit_id \
         WHERE e.einsatz_id = ? \
         ORDER BY sg.betriebsart, sg.sortier, sg.bezeichnung",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(gruppiere(zeilen))
}

/// Sprechgruppen ALLER Abschnitte eines Einsatzes in EINER Abfrage, je `abschnitt_id`;
/// Sortierung wie `lade_abschnitt_sprechgruppen`.
pub async fn lade_abschnitt_sprechgruppen_map(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<HashMap<i64, Vec<SprechgruppeAnzeige>>, AppError> {
    let zeilen = sqlx::query_as::<_, SprechgruppeMitBezug>(
        "SELECT eas.abschnitt_id AS bezug_id, \
                sg.id AS id, sg.org_id AS org_id, sg.einsatz_id AS einsatz_id, \
                sg.bezeichnung AS bezeichnung, sg.betriebsart AS betriebsart, \
                sg.hinweis AS hinweis, sg.aktiv AS aktiv, sg.sortier AS sortier, \
                sg.angelegt_at AS angelegt_at \
         FROM sprechgruppe sg \
         JOIN einsatzabschnitt_sprechgruppe eas ON eas.sprechgruppe_id = sg.id \
         JOIN einsatzabschnitt a ON a.id = eas.abschnitt_id \
         WHERE a.einsatz_id = ? \
         ORDER BY sg.betriebsart, sg.sortier, sg.bezeichnung",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(gruppiere(zeilen))
}

/// Gruppiert die Sammelzeilen je Bezug in Ergebnisreihenfolge, damit das `ORDER BY` je Gruppe
/// erhalten bleibt.
fn gruppiere(zeilen: Vec<SprechgruppeMitBezug>) -> HashMap<i64, Vec<SprechgruppeAnzeige>> {
    let mut map: HashMap<i64, Vec<SprechgruppeAnzeige>> = HashMap::new();
    for z in zeilen {
        map.entry(z.bezug_id)
            .or_default()
            .push(z.sprechgruppe.anzeige());
    }
    map
}

/// Deaktiviert eine Katalog-Sprechgruppe (Soft-Delete `aktiv = 0`).
/// Nur für Katalog-Einträge (`einsatz_id IS NULL`); rows_affected == 0 → `NotFound`.
pub async fn deaktiviere(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE sprechgruppe SET aktiv = 0 WHERE id = ? AND org_id = ? AND einsatz_id IS NULL",
    )
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await?;

    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;
    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }
    fn daten<'a>(bez: &'a str, ba: &'a str) -> KatalogDaten<'a> {
        KatalogDaten {
            bezeichnung: bez,
            betriebsart: ba,
            hinweis: None,
            sortier: 0,
        }
    }

    async fn setup_einsatz_abschnitt(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1,'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let a: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        (e, a)
    }
    #[tokio::test]
    async fn setze_und_lade_abschnitt_sprechgruppen() {
        let pool = crate::db::test_pool().await;
        let (e, a) = setup_einsatz_abschnitt(&pool).await;
        let kat = anlegen_katalog(
            &pool,
            1,
            KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
        let lokal = anlegen_einsatz_lokal(&pool, 1, e, "Sonder 1", "DMO", None)
            .await
            .unwrap();
        setze_abschnitt_sprechgruppen(&pool, 1, e, a, &[kat.id, lokal.id])
            .await
            .unwrap();
        assert_eq!(
            lade_abschnitt_sprechgruppen(&pool, a).await.unwrap().len(),
            2
        );
        // Ersetzen: nur noch eine.
        setze_abschnitt_sprechgruppen(&pool, 1, e, a, &[kat.id])
            .await
            .unwrap();
        let nach = lade_abschnitt_sprechgruppen(&pool, a).await.unwrap();
        assert_eq!(nach.len(), 1);
        assert_eq!(nach[0].id, kat.id);
    }
    #[tokio::test]
    async fn fremde_oder_anderer_einsatz_sprechgruppe_ist_unprocessable() {
        let pool = crate::db::test_pool().await;
        let (e, a) = setup_einsatz_abschnitt(&pool).await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (2,'Fremd')")
            .execute(&pool)
            .await
            .unwrap();
        let fremd = anlegen_katalog(
            &pool,
            2,
            KatalogDaten {
                bezeichnung: "X",
                betriebsart: "TMO",
                hinweis: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
        let anderer_einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Andere') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let lokal_woanders =
            anlegen_einsatz_lokal(&pool, 1, anderer_einsatz, "Sonder 9", "DMO", None)
                .await
                .unwrap();
        assert!(matches!(
            setze_abschnitt_sprechgruppen(&pool, 1, e, a, &[fremd.id])
                .await
                .unwrap_err(),
            AppError::UnprocessableEntity(_)
        ));
        assert!(matches!(
            setze_abschnitt_sprechgruppen(&pool, 1, e, a, &[lokal_woanders.id])
                .await
                .unwrap_err(),
            AppError::UnprocessableEntity(_)
        ));
    }
    #[tokio::test]
    async fn setze_abschnitt_sprechgruppen_duplikat_in_ids_ignoriert() {
        let pool = crate::db::test_pool().await;
        let (e, a) = setup_einsatz_abschnitt(&pool).await;
        let kat = anlegen_katalog(
            &pool,
            1,
            KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
        // Gleiche ID zweimal — darf keinen PK-Fehler auslösen.
        setze_abschnitt_sprechgruppen(&pool, 1, e, a, &[kat.id, kat.id])
            .await
            .unwrap();
        let nach = lade_abschnitt_sprechgruppen(&pool, a).await.unwrap();
        assert_eq!(nach.len(), 1, "Duplikat-ID darf nur einen Eintrag erzeugen");
    }
    #[tokio::test]
    async fn setze_und_lade_einheit_sprechgruppen() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1,'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einheit_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Zug') RETURNING id",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        let kat = anlegen_katalog(
            &pool,
            1,
            KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
        setze_einheit_sprechgruppen(&pool, 1, e, einheit_id, &[kat.id])
            .await
            .unwrap();
        assert_eq!(
            lade_einheit_sprechgruppen(&pool, einheit_id)
                .await
                .unwrap()
                .len(),
            1
        );
        // Ersetzen: leer.
        setze_einheit_sprechgruppen(&pool, 1, e, einheit_id, &[])
            .await
            .unwrap();
        assert_eq!(
            lade_einheit_sprechgruppen(&pool, einheit_id)
                .await
                .unwrap()
                .len(),
            0
        );
    }
    /// Die Sammelabfragen liefern je Einheit/Abschnitt exakt das, was die Einzelabfragen liefern,
    /// inklusive Sortierung.
    #[tokio::test]
    async fn sammelabfragen_sind_deckungsgleich_mit_den_einzelabfragen() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Alle drei Sortierschlüssel diskriminierend belegt.
        let mut katalog = Vec::new();
        for (bez, art, sortier) in [
            ("410_F_DRK", "TMO", 5),
            ("112_D_LEIT", "DMO", 9),
            ("999_T_ZUG", "TMO", 1),
            ("111_D_ALPHA", "DMO", 9),
        ] {
            katalog.push(
                anlegen_katalog(
                    &pool,
                    1,
                    KatalogDaten {
                        bezeichnung: bez,
                        betriebsart: art,
                        hinweis: None,
                        sortier,
                    },
                )
                .await
                .unwrap()
                .id,
            );
        }

        let mut einheiten = Vec::new();
        for name in ["Zug 1", "Zug 2", "Ohne"] {
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
        let mut abschnitte = Vec::new();
        for name in ["Nord", "Süd", "Ohne"] {
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
        // Zuweisung bewusst in „falscher" Reihenfolge; je eine Einheit/ein Abschnitt leer.
        setze_einheit_sprechgruppen(&pool, 1, e, einheiten[0], &katalog)
            .await
            .unwrap();
        setze_einheit_sprechgruppen(&pool, 1, e, einheiten[1], &[katalog[0], katalog[3]])
            .await
            .unwrap();
        setze_abschnitt_sprechgruppen(&pool, 1, e, abschnitte[0], &katalog)
            .await
            .unwrap();
        setze_abschnitt_sprechgruppen(&pool, 1, e, abschnitte[1], &[katalog[2]])
            .await
            .unwrap();

        let einheit_map = lade_einheit_sprechgruppen_map(&pool, e).await.unwrap();
        for einheit in &einheiten {
            let einzeln: Vec<_> = lade_einheit_sprechgruppen(&pool, *einheit)
                .await
                .unwrap()
                .into_iter()
                .map(|s| s.anzeige())
                .collect();
            assert_eq!(
                einheit_map.get(einheit).cloned().unwrap_or_default(),
                einzeln,
                "Einheit-Sammelabfrage weicht bei {einheit} ab"
            );
        }
        let abschnitt_map = lade_abschnitt_sprechgruppen_map(&pool, e).await.unwrap();
        for abschnitt in &abschnitte {
            let einzeln: Vec<_> = lade_abschnitt_sprechgruppen(&pool, *abschnitt)
                .await
                .unwrap()
                .into_iter()
                .map(|s| s.anzeige())
                .collect();
            assert_eq!(
                abschnitt_map.get(abschnitt).cloned().unwrap_or_default(),
                einzeln,
                "Abschnitt-Sammelabfrage weicht bei {abschnitt} ab"
            );
        }

        // Der Vergleich braucht Inhalt, und die erwartete Sortierung steht explizit da.
        assert_eq!(
            einheit_map[&einheiten[0]]
                .iter()
                .map(|s| s.bezeichnung.as_str())
                .collect::<Vec<_>>(),
            vec!["111_D_ALPHA", "112_D_LEIT", "999_T_ZUG", "410_F_DRK"],
            "DMO vor TMO; dann sortier; bei Gleichstand die Bezeichnung"
        );
        assert!(!einheit_map.contains_key(&einheiten[2]));
        assert!(!abschnitt_map.contains_key(&abschnitte[2]));
    }

    #[tokio::test]
    async fn anlegen_listen_und_laden() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        assert_eq!(sg.einsatz_id, None);
        assert_eq!(liste_katalog(&pool, 1, true).await.unwrap().len(), 1);
        assert_eq!(
            laden(&pool, 1, sg.id).await.unwrap().bezeichnung,
            "412_F_DRK"
        );
    }
    #[tokio::test]
    async fn dublette_im_katalog_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        assert!(matches!(
            anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        // gleiche Bezeichnung, andere Betriebsart → erlaubt
        assert!(anlegen_katalog(&pool, 1, daten("412_F_DRK", "DMO"))
            .await
            .is_ok());
    }
    #[tokio::test]
    async fn katalog_je_org_isoliert() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        assert!(matches!(
            laden(&pool, 2, sg.id).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(liste_katalog(&pool, 2, true).await.unwrap().is_empty());
    }
    #[tokio::test]
    async fn deaktivieren_versteckt_aus_nur_aktive() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        deaktiviere(&pool, 1, sg.id).await.unwrap();
        assert!(liste_katalog(&pool, 1, true).await.unwrap().is_empty());
        assert_eq!(liste_katalog(&pool, 1, false).await.unwrap().len(), 1);
        // Nach Deaktivierung ist die gleiche Bezeichnung neu anlegbar (Partial-Index nur aktiv).
        assert!(anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .is_ok());
    }
    /// Gesendete Felder landen in ihren Spalten, und `laden` sieht sie.
    #[tokio::test]
    async fn patche_katalog_ersetzt_gesendete_felder() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        let g = patche_katalog(
            &pool,
            1,
            sg.id,
            KatalogPatch {
                bezeichnung: Some("490_F_DRK"),
                betriebsart: Some("TMO"),
                hinweis: Some(Some("Marschkanal")),
                sortier: Some(5),
            },
        )
        .await
        .unwrap();
        assert_eq!(g.bezeichnung, "490_F_DRK");
        assert_eq!(g.hinweis.as_deref(), Some("Marschkanal"));
        assert_eq!(g.sortier, 5);
        // laden reflektiert die neuen Werte.
        let geladen = laden(&pool, 1, sg.id).await.unwrap();
        assert_eq!(geladen.bezeichnung, "490_F_DRK");
        assert_eq!(geladen.hinweis.as_deref(), Some("Marschkanal"));
        assert_eq!(geladen.sortier, 5);
    }

    /// Bind-Reihenfolge: alle vier Spalten distinkt setzen und einzeln prüfen.
    #[tokio::test]
    async fn patche_katalog_setzt_jede_spalte_an_ihren_platz() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        let g = patche_katalog(
            &pool,
            1,
            sg.id,
            KatalogPatch {
                bezeichnung: Some("490_F_DRK"),
                betriebsart: Some("DMO"),
                hinweis: Some(Some("Marschkanal")),
                sortier: Some(7),
            },
        )
        .await
        .unwrap();
        assert_eq!(g.bezeichnung, "490_F_DRK");
        assert_eq!(g.betriebsart.as_str(), "DMO");
        assert_eq!(g.hinweis.as_deref(), Some("Marschkanal"));
        assert_eq!(g.sortier, 7);
    }

    /// Ein Patch fasst NUR die gesendeten Spalten an.
    #[tokio::test]
    async fn patche_katalog_laesst_nicht_gesendete_spalten_stehen() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let sg = anlegen_katalog(
            &pool,
            1,
            KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: Some("Marschkanal"),
                sortier: 5,
            },
        )
        .await
        .unwrap();
        let g = patche_katalog(
            &pool,
            1,
            sg.id,
            KatalogPatch {
                bezeichnung: Some("490_F_DRK"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(g.bezeichnung, "490_F_DRK");
        assert_eq!(g.betriebsart.as_str(), "TMO", "unberührt");
        assert_eq!(g.hinweis.as_deref(), Some("Marschkanal"), "unberührt");
        assert_eq!(g.sortier, 5, "unberührt");

        // Leerer Patch → alles bleibt, insbesondere kein NotFound.
        let unveraendert = patche_katalog(&pool, 1, sg.id, KatalogPatch::default())
            .await
            .unwrap();
        assert_eq!(unveraendert.bezeichnung, "490_F_DRK");
        assert_eq!(unveraendert.sortier, 5);
    }

    /// `Some(None)` ist der Leerwunsch und von „absent“ unterscheidbar.
    #[tokio::test]
    async fn patche_katalog_hinweis_none_loescht_die_spalte() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let sg = anlegen_katalog(
            &pool,
            1,
            KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: Some("Marschkanal"),
                sortier: 5,
            },
        )
        .await
        .unwrap();
        let g = patche_katalog(
            &pool,
            1,
            sg.id,
            KatalogPatch {
                hinweis: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(g.hinweis, None);
        assert_eq!(g.bezeichnung, "412_F_DRK", "Nachbarfeld unberührt");
        assert_eq!(g.sortier, 5, "Nachbarfeld unberührt");
    }

    /// Die Conflict-Zusage des Unique-Index gilt auch am Teil-Patch.
    #[tokio::test]
    async fn patche_katalog_auf_geschwister_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        let zweite = anlegen_katalog(&pool, 1, daten("490_F_DRK", "TMO"))
            .await
            .unwrap();
        // Umbenennen auf die Bezeichnung des Geschwisters (gleiche Betriebsart) → Conflict.
        assert!(matches!(
            patche_katalog(
                &pool,
                1,
                zweite.id,
                KatalogPatch {
                    bezeichnung: Some("412_F_DRK"),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    /// Mandantengrenze.
    #[tokio::test]
    async fn patche_katalog_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        assert!(matches!(
            patche_katalog(
                &pool,
                2,
                sg.id,
                KatalogPatch {
                    bezeichnung: Some("490_F_DRK"),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
    }

    /// Der `einsatz_id IS NULL`-Guard trennt Katalog von einsatz-lokalen Zeilen.
    #[tokio::test]
    async fn patche_katalog_trifft_einsatz_lokale_zeile_nicht() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let lokal_id: i64 = sqlx::query_scalar(
            "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart) \
             VALUES (1, ?, 'lokal', 'TMO') RETURNING id",
        )
        .bind(einsatz_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        // Der einsatz_id IS NULL-Guard darf einsatz-lokale Zeilen nicht treffen → NotFound.
        assert!(matches!(
            patche_katalog(
                &pool,
                1,
                lokal_id,
                KatalogPatch {
                    bezeichnung: Some("umbenannt"),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
    }
    #[tokio::test]
    async fn einsatz_lokal_anlegen_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1,'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let a = anlegen_einsatz_lokal(&pool, 1, e, "Sonder 1", "DMO", None)
            .await
            .unwrap();
        let b = anlegen_einsatz_lokal(&pool, 1, e, "Sonder 1", "DMO", None)
            .await
            .unwrap();
        assert_eq!(a.id, b.id, "kein Duplikat, gleicher Eintrag");
        assert_eq!(a.einsatz_id, Some(e));
    }
    #[tokio::test]
    async fn liste_fuer_einsatz_vereint_katalog_und_lokal() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1,'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let kat = anlegen_katalog(
            &pool,
            1,
            KatalogDaten {
                bezeichnung: "412_F_DRK",
                betriebsart: "TMO",
                hinweis: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
        deaktiviere(
            &pool,
            1,
            anlegen_katalog(
                &pool,
                1,
                KatalogDaten {
                    bezeichnung: "alt",
                    betriebsart: "TMO",
                    hinweis: None,
                    sortier: 0,
                },
            )
            .await
            .unwrap()
            .id,
        )
        .await
        .unwrap();
        let lokal = anlegen_einsatz_lokal(&pool, 1, e, "Sonder 1", "DMO", None)
            .await
            .unwrap();
        let ids: Vec<i64> = liste_fuer_einsatz(&pool, 1, e)
            .await
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert!(ids.contains(&kat.id) && ids.contains(&lokal.id));
        assert_eq!(ids.len(), 2, "inaktiver Katalogeintrag nicht enthalten");
    }
}
