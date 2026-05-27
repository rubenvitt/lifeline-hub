use super::{EinheitMitgliedFahrzeug, EinheitMitgliedPerson};
use crate::error::AppError;
use crate::staerke::{Staerke, StaerkePosition};
use sqlx::SqlitePool;

/// Prüft, ob eine Einheit zum Einsatz gehört. `NotFound` sonst.
async fn pruefe_einheit(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64) -> Result<(), AppError> {
    let t: Option<i64> = sqlx::query_scalar("SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id).bind(einsatz_id).fetch_optional(pool).await?;
    t.map(|_| ()).ok_or(AppError::NotFound)
}

/// Ordnet eine Personal-Dispozeile einer Einheit zu (exklusiv). Eine bereits andernorts
/// zugeordnete Kraft wechselt; war sie dort Führer, wird dieser Verweis bereinigt.
/// `NotFound`, falls Dispozeile oder Einheit nicht zum Einsatz gehören. Liefert den Namen.
pub async fn ordne_personal_zu(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, ep_id: i64) -> Result<String, AppError> {
    pruefe_einheit(pool, einsatz_id, einheit_id).await?;
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    ).bind(ep_id).bind(einsatz_id).fetch_optional(pool).await?;
    let name = name.ok_or(AppError::NotFound)?;

    let mut tx = pool.begin().await?;
    // Stale Führer-Verweis bereinigen (Person war evtl. anderswo Führer).
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = NULL WHERE fuehrer_id = ? AND einsatz_id = ?")
        .bind(ep_id).bind(einsatz_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id).bind(ep_id).bind(einsatz_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(name)
}

/// Gibt eine Personal-Dispozeile aus ihrer Einheit frei (`einheit_id = NULL`). War sie
/// Führer dieser Einheit, wird `fuehrer_id` geleert. `NotFound`, falls nicht zu dieser
/// Einheit gehörend. Liefert den Namen.
pub async fn gib_personal_frei(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, ep_id: i64) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ? AND einheit_id = ?",
    ).bind(ep_id).bind(einsatz_id).bind(einheit_id).fetch_optional(pool).await?;
    let name = name.ok_or(AppError::NotFound)?;

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = NULL WHERE id = ? AND fuehrer_id = ?")
        .bind(einheit_id).bind(ep_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE einsatz_personal SET einheit_id = NULL WHERE id = ?")
        .bind(ep_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(name)
}

/// Ordnet ein Fahrzeug einer Einheit zu (exklusiv). `NotFound` analog. Liefert den Funkrufnamen.
pub async fn ordne_fahrzeug_zu(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, ef_id: i64) -> Result<String, AppError> {
    pruefe_einheit(pool, einsatz_id, einheit_id).await?;
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_funkrufname FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    ).bind(ef_id).bind(einsatz_id).fetch_optional(pool).await?;
    let name = name.ok_or(AppError::NotFound)?;
    sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id).bind(ef_id).bind(einsatz_id).execute(pool).await?;
    Ok(name)
}

/// Gibt ein Fahrzeug aus seiner Einheit frei. `NotFound`, falls nicht zu dieser Einheit.
pub async fn gib_fahrzeug_frei(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, ef_id: i64) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_funkrufname FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ? AND einheit_id = ?",
    ).bind(ef_id).bind(einsatz_id).bind(einheit_id).fetch_optional(pool).await?;
    let name = name.ok_or(AppError::NotFound)?;
    sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = NULL WHERE id = ?")
        .bind(ef_id).execute(pool).await?;
    Ok(name)
}

#[derive(sqlx::FromRow)]
struct PersonRow {
    ep_id: i64,
    name: String,
    funktion: Option<String>,
    staerke_position: Option<String>,
    ist_fuehrer: i64,
}

/// Personal-Mitglieder einer Einheit; Position aufgelöst (Dispo-Override vor Stamm-Default),
/// `ist_fuehrer` markiert die als `fuehrer_id` eingetragene Person.
pub async fn personal_mitglieder(pool: &SqlitePool, einheit_id: i64) -> Result<Vec<EinheitMitgliedPerson>, AppError> {
    let rows = sqlx::query_as::<_, PersonRow>(
        "SELECT ep.id AS ep_id, ep.snap_name AS name, ep.snap_funktion AS funktion, \
                COALESCE(ep.staerke_position, p.staerke_position) AS staerke_position, \
                COALESCE(ep.id = e.fuehrer_id, 0) AS ist_fuehrer \
         FROM einsatz_personal ep \
         JOIN einsatz_einheit e ON e.id = ep.einheit_id \
         LEFT JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.einheit_id = ? ORDER BY ep.id",
    ).bind(einheit_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| EinheitMitgliedPerson {
        ep_id: r.ep_id, name: r.name, funktion: r.funktion,
        staerke_position: r.staerke_position, ist_fuehrer: r.ist_fuehrer != 0,
    }).collect())
}

#[derive(sqlx::FromRow)]
struct FahrzeugRow { ef_id: i64, funkrufname: String, fahrzeugtyp: Option<String> }

/// Fahrzeug-Mitglieder einer Einheit (Snapshot-Funkrufname/-typ).
pub async fn fahrzeug_mitglieder(pool: &SqlitePool, einheit_id: i64) -> Result<Vec<EinheitMitgliedFahrzeug>, AppError> {
    let rows = sqlx::query_as::<_, FahrzeugRow>(
        "SELECT id AS ef_id, snap_funkrufname AS funkrufname, snap_fahrzeugtyp AS fahrzeugtyp \
         FROM einsatz_fahrzeug WHERE einheit_id = ? ORDER BY id",
    ).bind(einheit_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| EinheitMitgliedFahrzeug {
        ef_id: r.ef_id, funkrufname: r.funkrufname, fahrzeugtyp: r.fahrzeugtyp,
    }).collect())
}

/// Eigene Ist-Stärke einer Einheit: Aggregation der aufgelösten Personal-Positionen der
/// Mitglieder. Fahrzeuge zählen nicht in F/UF/M. Positionen ohne Wert werden ignoriert.
pub async fn ist_staerke(pool: &SqlitePool, einheit_id: i64) -> Result<Staerke, AppError> {
    let positionen: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT COALESCE(ep.staerke_position, p.staerke_position) \
         FROM einsatz_personal ep LEFT JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.einheit_id = ?",
    ).bind(einheit_id).fetch_all(pool).await?;
    let iter = positionen.into_iter().flatten().filter_map(|s| StaerkePosition::parse(&s));
    Ok(Staerke::aus_positionen(iter))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org(1) + Einsatz + zwei Einheiten; liefert (einsatz, einheit_a, einheit_b).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')").execute(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let a: i64 = sqlx::query_scalar("INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'A') RETURNING id")
            .bind(einsatz).fetch_one(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar("INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'B') RETURNING id")
            .bind(einsatz).fetch_one(pool).await.unwrap();
        (einsatz, a, b)
    }

    /// Disponiert eine Ad-hoc-Person mit Position; liefert ep_id.
    async fn person(pool: &SqlitePool, einsatz: i64, name: &str, position: Option<&str>) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name, staerke_position) VALUES (?, ?, ?) RETURNING id",
        ).bind(einsatz).bind(name).bind(position).fetch_one(pool).await.unwrap()
    }

    async fn einheit_von(pool: &SqlitePool, ep: i64) -> Option<i64> {
        sqlx::query_scalar("SELECT einheit_id FROM einsatz_personal WHERE id = ?").bind(ep).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn zuordnen_wechseln_freigeben() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Anna", Some("mannschaft")).await;

        assert_eq!(ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap(), "Anna");
        assert_eq!(einheit_von(&pool, ep).await, Some(a));

        // Wechsel zu B: A verliert sie.
        ordne_personal_zu(&pool, einsatz, b, ep).await.unwrap();
        assert_eq!(einheit_von(&pool, ep).await, Some(b));

        // Freigeben.
        assert_eq!(gib_personal_frei(&pool, einsatz, b, ep).await.unwrap(), "Anna");
        assert_eq!(einheit_von(&pool, ep).await, None);
    }

    #[tokio::test]
    async fn freigeben_falscher_einheit_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Anna", None).await;
        ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap();
        // Freigeben aus B (gehört aber zu A) → NotFound.
        assert!(matches!(gib_personal_frei(&pool, einsatz, b, ep).await.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn freigeben_des_fuehrers_leert_fuehrer_id() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Chef", Some("fuehrer")).await;
        ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap();
        sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?").bind(ep).bind(a).execute(&pool).await.unwrap();

        gib_personal_frei(&pool, einsatz, a, ep).await.unwrap();
        let fuehrer: Option<i64> = sqlx::query_scalar("SELECT fuehrer_id FROM einsatz_einheit WHERE id = ?").bind(a).fetch_one(&pool).await.unwrap();
        assert_eq!(fuehrer, None, "Freigeben des Führer-Mitglieds muss fuehrer_id leeren");
    }

    #[tokio::test]
    async fn zuordnen_bereinigt_stale_fuehrer_in_alter_einheit() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Chef", Some("fuehrer")).await;
        ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap();
        sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?").bind(ep).bind(a).execute(&pool).await.unwrap();

        // Wechsel nach B → A darf keinen dangling Führer behalten.
        ordne_personal_zu(&pool, einsatz, b, ep).await.unwrap();
        let fuehrer_a: Option<i64> = sqlx::query_scalar("SELECT fuehrer_id FROM einsatz_einheit WHERE id = ?").bind(a).fetch_one(&pool).await.unwrap();
        assert_eq!(fuehrer_a, None);
    }

    #[tokio::test]
    async fn fremde_dispozeile_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id")
            .fetch_one(&pool).await.unwrap();
        let fremder_ep = person(&pool, fremd, "Fremd", None).await;
        assert!(matches!(ordne_personal_zu(&pool, einsatz, a, fremder_ep).await.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn ist_staerke_aggregiert_positionen_fahrzeuge_zaehlen_nicht() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        for (name, pos) in [("F", "fuehrer"), ("UF", "unterfuehrer"), ("M1", "mannschaft"), ("M2", "mannschaft")] {
            let ep = person(&pool, einsatz, name, Some(pos)).await;
            ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap();
        }
        // Person ohne Position zählt nicht.
        let ohne = person(&pool, einsatz, "Ohne", None).await;
        ordne_personal_zu(&pool, einsatz, a, ohne).await.unwrap();
        // Ein Fahrzeug zuordnen — darf die Stärke nicht beeinflussen.
        let ef: i64 = sqlx::query_scalar("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id")
            .bind(einsatz).fetch_one(&pool).await.unwrap();
        ordne_fahrzeug_zu(&pool, einsatz, a, ef).await.unwrap();

        assert_eq!(ist_staerke(&pool, a).await.unwrap(), Staerke::neu(1, 1, 2));
    }

    #[tokio::test]
    async fn personal_mitglieder_markiert_fuehrer() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        let chef = person(&pool, einsatz, "Chef", Some("fuehrer")).await;
        let mann = person(&pool, einsatz, "Mann", Some("mannschaft")).await;
        ordne_personal_zu(&pool, einsatz, a, chef).await.unwrap();
        ordne_personal_zu(&pool, einsatz, a, mann).await.unwrap();
        sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?").bind(chef).bind(a).execute(&pool).await.unwrap();

        let mitglieder = personal_mitglieder(&pool, a).await.unwrap();
        assert_eq!(mitglieder.len(), 2);
        assert!(mitglieder.iter().find(|m| m.ep_id == chef).unwrap().ist_fuehrer);
        assert!(!mitglieder.iter().find(|m| m.ep_id == mann).unwrap().ist_fuehrer);
    }

    #[tokio::test]
    async fn fahrzeug_zuordnen_und_freigeben() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        let ef: i64 = sqlx::query_scalar("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id")
            .bind(einsatz).fetch_one(&pool).await.unwrap();
        assert_eq!(ordne_fahrzeug_zu(&pool, einsatz, a, ef).await.unwrap(), "Florian 1");
        assert_eq!(fahrzeug_mitglieder(&pool, a).await.unwrap().len(), 1);
        assert_eq!(gib_fahrzeug_frei(&pool, einsatz, a, ef).await.unwrap(), "Florian 1");
        assert!(fahrzeug_mitglieder(&pool, a).await.unwrap().is_empty());
    }
}
