use super::{Sprechgruppe, SprechgruppeAnzeige};
use crate::error::AppError;
use sqlx::SqlitePool;
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

/// Vollersatz der editierbaren Felder einer Katalog-Sprechgruppe (org-scoped,
/// `einsatz_id IS NULL`). `NotFound` bei fremder Org oder einsatz-lokaler Sprechgruppe,
/// `Conflict` bei Bezeichnung-/Betriebsart-Dublette.
pub async fn aktualisiere_katalog(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: KatalogDaten<'_>,
) -> Result<Sprechgruppe, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE sprechgruppe \
         SET bezeichnung = ?, betriebsart = ?, hinweis = ?, sortier = ? \
         WHERE id = ? AND org_id = ? AND einsatz_id IS NULL",
    )
    .bind(daten.bezeichnung)
    .bind(daten.betriebsart)
    .bind(daten.hinweis)
    .bind(daten.sortier)
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

/// Legt eine einsatz-lokale Sprechgruppe an — idempotent: trifft die Zeile
/// bereits den Unique-Index `(einsatz_id, betriebsart, bezeichnung)`, wird der
/// vorhandene Eintrag zurückgegeben statt ein Fehler ausgelöst.
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
async fn pruefe_zuordenbar(
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
    sqlx::query("DELETE FROM einsatzabschnitt_sprechgruppe WHERE abschnitt_id = ?")
        .bind(abschnitt_id)
        .execute(&mut *tx)
        .await?;
    for &id in ids {
        sqlx::query(
            "INSERT OR IGNORE INTO einsatzabschnitt_sprechgruppe (abschnitt_id, sprechgruppe_id) VALUES (?, ?)",
        )
        .bind(abschnitt_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
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
    sqlx::query("DELETE FROM einsatz_einheit_sprechgruppe WHERE einheit_id = ?")
        .bind(einheit_id)
        .execute(&mut *tx)
        .await?;
    for &id in ids {
        sqlx::query(
            "INSERT OR IGNORE INTO einsatz_einheit_sprechgruppe (einheit_id, sprechgruppe_id) VALUES (?, ?)",
        )
        .bind(einheit_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
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

/// Sprechgruppen ALLER Einheiten eines Einsatzes in EINER Abfrage (kein N+1,
/// LFH-225/F23), gruppiert je `einheit_id`. Einheiten ohne Zuordnung fehlen in der Map.
/// Das globale `ORDER BY betriebsart, sortier, bezeichnung` erhält die Sortierung
/// innerhalb jeder Gruppe exakt so, wie sie `lade_einheit_sprechgruppen` liefert.
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

/// Sprechgruppen ALLER Abschnitte eines Einsatzes in EINER Abfrage (kein N+1,
/// LFH-225/F23), gruppiert je `abschnitt_id`. Sortierung wie in
/// `lade_abschnitt_sprechgruppen`.
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

/// Gruppiert die Sammelzeilen je Bezug und wandelt in die Anzeige — in Ergebnis-
/// reihenfolge, damit das `ORDER BY` der Abfrage je Gruppe erhalten bleibt.
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
    /// LFH-225/F23: Die Sprechgruppen-Sammelabfragen müssen je Einheit/Abschnitt exakt
    /// das liefern, was die Einzelabfragen liefern — inklusive der Sortierung nach
    /// `betriebsart, sortier, bezeichnung`. Koppelt beide Fassungen gegen Drift.
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

        // Der Vergleich oben muss etwas zu vergleichen haben — und die erwartete
        // Sortierung explizit festhalten.
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
    #[tokio::test]
    async fn aktualisieren_ersetzt_felder() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        let neu = KatalogDaten {
            bezeichnung: "490_F_DRK",
            betriebsart: "TMO",
            hinweis: Some("Marschkanal"),
            sortier: 5,
        };
        let g = aktualisiere_katalog(&pool, 1, sg.id, neu).await.unwrap();
        assert_eq!(g.bezeichnung, "490_F_DRK");
        assert_eq!(g.hinweis.as_deref(), Some("Marschkanal"));
        assert_eq!(g.sortier, 5);
        // laden reflektiert die neuen Werte.
        let geladen = laden(&pool, 1, sg.id).await.unwrap();
        assert_eq!(geladen.bezeichnung, "490_F_DRK");
        assert_eq!(geladen.hinweis.as_deref(), Some("Marschkanal"));
        assert_eq!(geladen.sortier, 5);
    }
    #[tokio::test]
    async fn aktualisieren_auf_geschwister_ist_conflict() {
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
            aktualisiere_katalog(&pool, 1, zweite.id, daten("412_F_DRK", "TMO"))
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }
    #[tokio::test]
    async fn aktualisieren_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO"))
            .await
            .unwrap();
        assert!(matches!(
            aktualisiere_katalog(&pool, 2, sg.id, daten("490_F_DRK", "TMO"))
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }
    #[tokio::test]
    async fn aktualisieren_trifft_einsatz_lokale_zeile_nicht() {
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
            aktualisiere_katalog(&pool, 1, lokal_id, daten("umbenannt", "TMO"))
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
