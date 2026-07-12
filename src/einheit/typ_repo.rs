use super::EinheitTyp;
use crate::error::AppError;
use crate::staerke::Staerke;
use sqlx::SqlitePool;

/// Editierbare Katalog-Felder. Soll-Werte folgen der Regel „alle drei oder keiner"
/// (im Handler über `Staerke::aus_optionen` validiert).
#[derive(Debug)]
pub struct TypDaten<'a> {
    pub label: &'a str,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub sortier: i64,
}

/// Roh-Zeile aus der Tabelle (Soll noch als drei Optionen).
#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    label: String,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    sortier: i64,
}

const SPALTEN: &str = "id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier";

/// Baut die Anzeige; Soll wird best-effort aus den drei Spalten zusammengesetzt
/// (gespeicherte Werte sind durch den Handler bereits konsistent).
fn zu_typ(row: Row) -> EinheitTyp {
    let soll = Staerke::aus_optionen(row.soll_fuehrer, row.soll_unterfuehrer, row.soll_mannschaft)
        .unwrap_or(None);
    EinheitTyp {
        id: row.id,
        label: row.label,
        soll,
        sortier: row.sortier,
    }
}

fn label_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Einheitstyp-Label ist bereits vorhanden".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt einen Typ der Org; `NotFound` bei fremder/unbekannter id (ignoriert aktiv-Flag).
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<EinheitTyp, AppError> {
    sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM einheit_typ WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .map(zu_typ)
    .ok_or(AppError::NotFound)
}

/// Nur aktive Typen der Org, sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<EinheitTyp>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM einheit_typ WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id"
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(zu_typ).collect())
}

/// Legt einen Typ an. Dublette `label` je Org → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: TypDaten<'_>,
) -> Result<EinheitTyp, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier) \
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id).bind(daten.label)
    .bind(daten.soll_fuehrer).bind(daten.soll_unterfuehrer).bind(daten.soll_mannschaft)
    .bind(daten.sortier)
    .fetch_one(pool).await;
    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return label_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound`/`Conflict` analog.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: TypDaten<'_>,
) -> Result<EinheitTyp, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE einheit_typ SET label = ?, soll_fuehrer = ?, soll_unterfuehrer = ?, \
                soll_mannschaft = ?, sortier = ? WHERE id = ? AND org_id = ?",
    )
    .bind(daten.label)
    .bind(daten.soll_fuehrer)
    .bind(daten.soll_unterfuehrer)
    .bind(daten.soll_mannschaft)
    .bind(daten.sortier)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;
    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return label_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Deaktiviert einen Typ (Soft-Delete `aktiv = 0`); referenzierte Einheiten bleiben gültig.
pub async fn deaktivieren(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query("UPDATE einheit_typ SET aktiv = 0 WHERE id = ? AND org_id = ?")
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Ob ein Typ mit dieser id zur Org gehört (POST/PATCH-Einheit-Validierung). Bewusst
/// **ohne** `aktiv`-Filter: ein deaktivierter Typ bleibt für bestehende Einheiten-
/// Referenzen gültig (Entscheidung 4), damit das PATCH einer Einheit, deren Typ
/// inzwischen deaktiviert wurde, nicht fehlschlägt. Die Auswahl *neuer* Typen filtert
/// das FE über `GET /api/einheit-typen` (nur aktive).
pub async fn ist_in_org(pool: &SqlitePool, org_id: i64, typ_id: i64) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einheit_typ WHERE id = ? AND org_id = ?")
            .bind(typ_id)
            .bind(org_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn daten<'a>(label: &'a str, soll: Option<(i64, i64, i64)>, sortier: i64) -> TypDaten<'a> {
        let (f, u, m) = match soll {
            Some((f, u, m)) => (Some(f), Some(u), Some(m)),
            None => (None, None, None),
        };
        TypDaten {
            label,
            soll_fuehrer: f,
            soll_unterfuehrer: u,
            soll_mannschaft: m,
            sortier,
        }
    }

    #[tokio::test]
    async fn anlegen_liste_sortiert_nur_aktiv() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Zug", Some((1, 3, 18)), 40))
            .await
            .unwrap();
        anlegen(&pool, 1, daten("Trupp", Some((0, 0, 2)), 10))
            .await
            .unwrap();

        let liste = liste(&pool, 1).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].label, "Trupp", "nach sortier");
        assert_eq!(liste[0].soll, Some(Staerke::neu(0, 0, 2)));
        assert_eq!(liste[1].label, "Zug");
    }

    #[tokio::test]
    async fn soll_komplett_leer_ist_none() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let t = anlegen(&pool, 1, daten("Sonstige", None, 50))
            .await
            .unwrap();
        assert_eq!(t.soll, None);
    }

    #[tokio::test]
    async fn dublette_label_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Zug", None, 10)).await.unwrap();
        assert!(matches!(
            anlegen(&pool, 1, daten("Zug", None, 20)).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn aktualisiere_ersetzt_felder() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let t = anlegen(&pool, 1, daten("Zug", Some((1, 3, 18)), 40))
            .await
            .unwrap();
        let neu = aktualisiere(&pool, 1, t.id, daten("Verstärkter Zug", None, 45))
            .await
            .unwrap();
        assert_eq!(neu.label, "Verstärkter Zug");
        assert_eq!(neu.soll, None);
        assert_eq!(neu.sortier, 45);
    }

    #[tokio::test]
    async fn deaktivieren_versteckt_und_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let t = anlegen(&pool, 1, daten("Zug", None, 40)).await.unwrap();
        deaktivieren(&pool, 1, t.id).await.unwrap();
        assert!(
            liste(&pool, 1).await.unwrap().is_empty(),
            "nicht mehr in der aktiven Liste"
        );
        assert_eq!(
            laden(&pool, 1, t.id).await.unwrap().id,
            t.id,
            "laden ignoriert aktiv-Flag"
        );
    }

    #[tokio::test]
    async fn fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let t = anlegen(&pool, 1, daten("Zug", None, 40)).await.unwrap();
        assert!(matches!(
            laden(&pool, 2, t.id).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            aktualisiere(&pool, 2, t.id, daten("X", None, 0))
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }
}
